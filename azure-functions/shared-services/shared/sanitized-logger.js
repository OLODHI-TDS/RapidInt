/**
 * Sanitized Logger Utility
 *
 * Prevents PII (Personal Identifiable Information) from appearing in console logs,
 * Application Insights, and other logging systems.
 *
 * ✅ GDPR Compliance: Ensures console logs don't contain PII (Article 32)
 * ✅ Security: Prevents accidental PII exposure in log aggregation systems
 * ✅ Debugging: Still provides useful information for troubleshooting
 *
 * Usage:
 *   const sanitizedPayload = sanitizeForLogging(fullPayload);
 *   context.log('Processing deposit:', sanitizedPayload);
 */

/**
 * Sanitize a full payload for safe logging
 * Masks PII fields while keeping useful debugging info
 *
 * @param {Object} data - Data object to sanitize
 * @returns {Object} - Sanitized object safe for logging
 */
function sanitizeForLogging(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    // If it's an array, sanitize each element
    if (Array.isArray(data)) {
        return data.map(item => sanitizeForLogging(item));
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();

        // PII fields to completely mask
        if (lowerKey.includes('email')) {
            sanitized[key] = value ? maskEmail(value) : null;
        } else if (lowerKey.includes('phone') || lowerKey.includes('mobile') || lowerKey.includes('telephone')) {
            sanitized[key] = value ? maskPhone(value) : null;
        } else if (lowerKey.includes('firstname') || lowerKey.includes('first_name')) {
            sanitized[key] = value ? maskName(value) : null;
        } else if (lowerKey.includes('surname') || lowerKey.includes('lastname') || lowerKey.includes('last_name')) {
            sanitized[key] = value ? maskName(value) : null;
        } else if (lowerKey.includes('address') && !lowerKey.includes('email')) {
            sanitized[key] = value ? (typeof value === 'object' ? sanitizeAddress(value) : maskAddress(value)) : null;
        } else if (lowerKey.includes('postcode') || lowerKey.includes('zipcode')) {
            sanitized[key] = value ? maskPostcode(value) : null;
        } else if (lowerKey.includes('people') && Array.isArray(value)) {
            // Sanitize people array (tenants, landlords)
            sanitized[key] = value.map(person => sanitizePerson(person));
        } else if (typeof value === 'object' && value !== null) {
            // Recursively sanitize nested objects
            sanitized[key] = sanitizeForLogging(value);
        } else {
            // Keep non-PII fields as-is
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Mask email address
 * Example: john.smith@example.com → j***@example.com
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return '***';

    const parts = email.split('@');
    if (parts.length !== 2) return '***@***';

    const local = parts[0];
    const domain = parts[1];

    const maskedLocal = local.length > 1 ? local[0] + '***' : '***';
    return `${maskedLocal}@${domain}`;
}

/**
 * Mask phone number
 * Example: +447700900123 → +44***123
 */
function maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return '***';

    // Remove non-numeric characters for analysis
    const digits = phone.replace(/\D/g, '');

    if (digits.length < 4) return '***';

    // Show first 2 digits and last 3 digits
    const prefix = digits.substring(0, 2);
    const suffix = digits.substring(digits.length - 3);

    return `+${prefix}***${suffix}`;
}

/**
 * Mask name
 * Example: John Smith → J*** S***
 */
function maskName(name) {
    if (!name || typeof name !== 'string') return '***';

    // Handle multiple parts (first name, middle name, last name)
    const parts = name.trim().split(/\s+/);

    return parts.map(part => {
        if (part.length === 0) return '***';
        if (part.length === 1) return part[0] + '***';
        return part[0] + '***';
    }).join(' ');
}

/**
 * Mask address string
 * Example: 123 Main Street, London → 1** Main Street, L***
 */
function maskAddress(address) {
    if (!address || typeof address !== 'string') return '***';

    // Just mask house number and first letter of each word
    return address.replace(/\b\d+\b/g, '***').replace(/\b(\w)\w+/g, '$1***');
}

/**
 * Sanitize address object
 * Keeps structure but masks sensitive fields
 */
function sanitizeAddress(addressObj) {
    if (!addressObj || typeof addressObj !== 'object') return null;

    return {
        nameNo: addressObj.nameNo ? '***' : null,
        paon: addressObj.paon ? '***' : null,
        street: addressObj.street ? maskAddressField(addressObj.street) : null,
        town: addressObj.town ? maskAddressField(addressObj.town) : null,
        locality: addressObj.locality ? maskAddressField(addressObj.locality) : null,
        postcode: addressObj.postcode ? maskPostcode(addressObj.postcode) : null,
        // Keep non-PII fields
        county: addressObj.county,
        country: addressObj.country
    };
}

/**
 * Mask address field (street, town)
 * Example: Chestnut Crescent → C*** C***
 */
function maskAddressField(field) {
    if (!field || typeof field !== 'string') return '***';

    return field.split(/\s+/).map(word => {
        if (word.length === 0) return '***';
        return word[0] + '***';
    }).join(' ');
}

/**
 * Mask postcode
 * Example: SW1A 1AA → SW** ***
 */
function maskPostcode(postcode) {
    if (!postcode || typeof postcode !== 'string') return '***';

    const trimmed = postcode.trim();
    if (trimmed.length < 3) return '***';

    // Show first 2 characters only
    return trimmed.substring(0, 2) + '*** ***';
}

/**
 * Sanitize person object (tenant, landlord)
 * Masks all PII but keeps classification and IDs
 */
function sanitizePerson(person) {
    if (!person || typeof person !== 'object') return null;

    return {
        person_classification: person.person_classification, // Keep (not PII)
        person_id: person.person_id, // Keep (for debugging)
        person_title: person.person_title ? '***' : null,
        person_firstname: person.person_firstname ? maskName(person.person_firstname) : null,
        person_surname: person.person_surname ? maskName(person.person_surname) : null,
        is_business: person.is_business, // Keep (not PII)
        person_email: person.person_email ? maskEmail(person.person_email) : null,
        person_mobile: person.person_mobile ? maskPhone(person.person_mobile) : null,
        person_phone: person.person_phone ? maskPhone(person.person_phone) : null,
        // Address fields
        person_paon: person.person_paon ? '***' : null,
        person_street: person.person_street ? maskAddressField(person.person_street) : null,
        person_town: person.person_town ? maskAddressField(person.person_town) : null,
        person_postcode: person.person_postcode ? maskPostcode(person.person_postcode) : null,
        person_country: person.person_country // Keep (not PII)
    };
}

/**
 * Get summary string for logging
 * Provides a one-line summary without PII
 *
 * @param {Object} depositData - Deposit data
 * @returns {string} - Safe summary string
 */
function getDepositSummary(depositData) {
    if (!depositData || typeof depositData !== 'object') {
        return 'Unknown deposit';
    }

    const tenancyId = depositData.tenancyId || depositData.user_tenancy_reference || 'unknown';
    const propertyId = depositData.propertyId || depositData.property_id || 'unknown';
    const depositAmount = depositData.deposit_amount || depositData.depositAmount || 'unknown';
    const numTenants = depositData.number_of_tenants || depositData.numberOfTenants || '?';
    const numLandlords = depositData.number_of_landlords || depositData.numberOfLandlords || '?';

    return `Tenancy ${tenancyId}, Property ${propertyId}, Deposit £${depositAmount}, ${numTenants} tenant(s), ${numLandlords} landlord(s)`;
}

/**
 * Example usage helper
 * Shows how to log payloads safely
 */
function logPayloadSafely(context, label, fullPayload) {
    // Log sanitized version
    const sanitized = sanitizeForLogging(fullPayload);
    context.log(`${label}:`, sanitized);

    // Also log a one-line summary
    context.log(`${label} Summary:`, getDepositSummary(fullPayload));
}

module.exports = {
    sanitizeForLogging,
    maskEmail,
    maskPhone,
    maskName,
    maskAddress,
    maskPostcode,
    sanitizePerson,
    getDepositSummary,
    logPayloadSafely
};
