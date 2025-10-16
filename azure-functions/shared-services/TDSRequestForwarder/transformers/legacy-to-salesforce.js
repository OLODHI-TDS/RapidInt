/**
 * Legacy TDS API to Salesforce EWC API Transformer
 *
 * Converts request payloads from the legacy TDS API format (v1.2)
 * to the Salesforce EWC TDS API format.
 *
 * Key Differences:
 * - Field naming: snake_case (SAME in both APIs - no Field__c suffix!)
 * - Date formats: ISO 8601 (YYYY-MM-DD) → UK format (DD-MM-YYYY)
 * - Booleans: true/false → "true"/"false" (strings)
 * - Numbers: 1500 → "1500" (strings)
 * - Structure: people[] array with person_classification field
 * - UPDATED: v2.0 - Fixed is_business uppercase and null field handling
 */

/**
 * Convert ISO date (YYYY-MM-DD) to UK format (DD-MM-YYYY)
 */
function convertDateToUKFormat(isoDate) {
  if (!isoDate) return null;

  // Handle both YYYY-MM-DD and YYYY-MM-DDTHH:mm:ss formats
  const dateStr = isoDate.split('T')[0];
  const [year, month, day] = dateStr.split('-');

  return `${day}-${month}-${year}`;
}

/**
 * Convert boolean to string "true" or "false"
 */
function booleanToString(value) {
  if (value === null || value === undefined) return null;
  return value ? "true" : "false";
}

/**
 * Convert number to string
 */
function numberToString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * Convert Y/N to "true"/"false" string for Salesforce
 * Legacy TDS API uses Y/N, Salesforce uses "true"/"false" strings
 */
function convertYNToTrueFalse(value) {
  if (!value) return "false";
  const normalized = value.toString().toUpperCase();
  return (normalized === "Y" || normalized === "YES" || normalized === "TRUE") ? "true" : "false";
}

/**
 * Transform legacy deposit creation payload to Salesforce EWC format
 */
function transformLegacyToSalesforce(legacyPayload, context) {
  try {
    context?.log('Transforming legacy payload to Salesforce EWC format');

    // Handle both standard model and legacy format
    const isStandardModel = legacyPayload.metadata?.sourceSystem !== undefined;

    if (isStandardModel) {
      return transformStandardModelToSalesforce(legacyPayload, context);
    } else {
      return transformLegacyModelToSalesforce(legacyPayload, context);
    }

  } catch (error) {
    context?.error('Error transforming legacy to Salesforce:', error);
    throw new Error(`Transformation failed: ${error.message}`);
  }
}

/**
 * Transform standard model (from adapter) to Salesforce EWC format
 */
function transformStandardModelToSalesforce(standardPayload, context) {
  const deposit = standardPayload.deposit || {};
  const property = standardPayload.property || {};
  const landlord = standardPayload.landlord || {};
  const tenants = standardPayload.tenants || [];

  // Build people array combining landlords and tenants
  const people = [];

  // Add primary landlord
  if (landlord.firstName || landlord.lastName) {
    people.push({
      person_classification: "Primary Landlord",
      person_id: landlord.id || standardPayload.metadata?.integrationId,
      person_reference: landlord.reference || "",
      person_title: landlord.title || "",
      person_firstname: landlord.firstName || "",
      person_surname: landlord.lastName || "",
      is_business: booleanToString(landlord.isBusiness || false),
      business_name: landlord.businessName || "",
      person_paon: landlord.address?.line1 || "",
      person_saon: landlord.address?.line2 || "",
      person_street: landlord.address?.street || "",
      person_locality: landlord.address?.locality || "",
      person_town: landlord.address?.city || landlord.address?.town || "",
      person_postcode: landlord.address?.postcode || "",
      person_country: landlord.address?.country || "United Kingdom",
      person_phone: landlord.phone || "",
      person_email: landlord.email || "",
      person_mobile: landlord.mobile || ""
    });
  }

  // Add tenants
  tenants.forEach((tenant, index) => {
    people.push({
      person_classification: "Tenant",
      person_id: tenant.id || `tenant_${index + 1}`,
      person_reference: tenant.reference || "",
      person_title: tenant.title || "",
      person_firstname: tenant.firstName || "",
      person_surname: tenant.lastName || "",
      is_business: booleanToString(tenant.isBusiness || false),
      business_name: tenant.businessName || "",
      person_paon: tenant.address?.line1 || "",
      person_saon: tenant.address?.line2 || "",
      person_street: tenant.address?.street || "",
      person_locality: tenant.address?.locality || "",
      person_town: tenant.address?.city || tenant.address?.town || "",
      person_postcode: tenant.address?.postcode || "",
      person_country: tenant.address?.country || "United Kingdom",
      person_phone: tenant.phone || "",
      person_email: tenant.email || "",
      person_mobile: tenant.mobile || ""
    });
  });

  const salesforcePayload = {
    tenancy: {
      user_tenancy_reference: standardPayload.metadata?.integrationId || deposit.reference || "",
      deposit_reference: deposit.reference || "",
      property_id: property.id || "",
      property_paon: property.address?.line1 || "",
      property_saon: property.address?.line2 || "",
      property_street: property.address?.street || "",
      property_town: property.address?.city || property.address?.town || "",
      property_administrative_area: property.address?.county || property.address?.administrativeArea || "",
      property_postcode: property.address?.postcode || "",
      tenancy_start_date: convertDateToUKFormat(deposit.tenancyStartDate),
      tenancy_expected_end_date: convertDateToUKFormat(deposit.tenancyEndDate),
      number_of_living_rooms: numberToString(property.livingRooms || 1),
      number_of_bedrooms: numberToString(property.bedrooms || 0),
      furnished_status: booleanToString(property.furnished || false),
      rent_amount: numberToString(deposit.rentAmount || 0),
      deposit_amount: numberToString(deposit.amount || 0),
      deposit_amount_to_protect: numberToString(deposit.amountToProtect || deposit.amount || 0),
      deposit_received_date: convertDateToUKFormat(deposit.allocationDateTime || deposit.receivedDate),
      number_of_tenants: numberToString(tenants.length),
      number_of_landlords: "1",
      people: people
    }
  };

  context?.log('Standard model transformed to Salesforce EWC format');

  return salesforcePayload;
}

/**
 * Transform legacy API format to Salesforce EWC format
 *
 * Legacy TDS API v1.2 format:
 * {
 *   "member_id": "...",
 *   "branch_id": "...",
 *   "api_key": "...",
 *   "region": "EW",
 *   "scheme_type": "Custodial",
 *   "tenancy": [{
 *     "user_tenancy_reference": "...",
 *     "property_id": "...",
 *     "property_paon": "...",
 *     ...all fields directly on tenancy object...
 *     "people": [...]  // Combined landlords and tenants
 *   }]
 * }
 */
function transformLegacyModelToSalesforce(legacyPayload, context) {
  // Legacy TDS API v1.2 has tenancy as array
  const tenancies = legacyPayload.tenancy || [];

  // Handle only first tenancy (Salesforce expects single tenancy per request)
  const tenancy = tenancies[0] || {};

  // In Legacy TDS API, all fields are directly on tenancy object (not nested)
  // People array already contains both landlords and tenants with person_classification
  const people = (tenancy.people || []).map(person => {
    // Clean up person object - ensure proper formatting for Salesforce
    const cleanPerson = {
      person_classification: normalizePersonClassification(person.person_classification),
      person_title: normalizeTitleForSalesforce(person.person_title),
      person_firstname: person.person_firstname || "",
      person_surname: person.person_surname || "",
      is_business: convertYNToTrueFalse(person.is_business) // Convert Y/N to "true"/"false"
    };

    // Only add optional fields if they have non-empty values
    if (person.person_id) cleanPerson.person_id = person.person_id;
    if (person.person_email) cleanPerson.person_email = person.person_email;
    if (person.person_mobile) cleanPerson.person_mobile = person.person_mobile;
    if (person.person_phone) cleanPerson.person_phone = person.person_phone;
    if (person.person_paon) cleanPerson.person_paon = person.person_paon;
    if (person.person_saon) cleanPerson.person_saon = person.person_saon;
    if (person.person_street) cleanPerson.person_street = person.person_street;
    if (person.person_town) cleanPerson.person_town = person.person_town;
    if (person.person_locality) cleanPerson.person_locality = person.person_locality;
    if (person.person_postcode) cleanPerson.person_postcode = person.person_postcode;
    if (person.person_country) cleanPerson.person_country = person.person_country;
    if (person.business_name) cleanPerson.business_name = person.business_name;

    return cleanPerson;
  });

  // Build base tenancy object
  const salesforceTenancy = {
    // Tenancy/deposit fields - directly from tenancy object
    user_tenancy_reference: tenancy.user_tenancy_reference || "",

    // Property fields - directly from tenancy object
    property_id: numberToString(tenancy.property_id) || "",
    property_paon: tenancy.property_paon || "",
    property_street: tenancy.property_street || "",
    property_town: tenancy.property_town || "",
    property_administrative_area: tenancy.property_administrative_area || "",
    property_postcode: tenancy.property_postcode || "",

    // Tenancy dates and details
    tenancy_start_date: convertDateToUKFormat(tenancy.tenancy_start_date),
    tenancy_expected_end_date: convertDateToUKFormat(tenancy.tenancy_expected_end_date),

    // Property details
    number_of_living_rooms: numberToString(tenancy.number_of_living_rooms),
    number_of_bedrooms: numberToString(tenancy.number_of_bedrooms),
    furnished_status: tenancy.furnished_status === "furnished" ? "true" : "false",

    // Financial details
    rent_amount: numberToString(tenancy.rent_amount),
    deposit_amount: numberToString(tenancy.deposit_amount),
    deposit_amount_to_protect: numberToString(tenancy.deposit_amount_to_protect || tenancy.deposit_amount),
    deposit_received_date: convertDateToUKFormat(tenancy.deposit_received_date),

    // Counts
    number_of_tenants: numberToString(tenancy.number_of_tenants),
    number_of_landlords: numberToString(tenancy.number_of_landlords),

    // People array
    people: people
  };

  // Only add optional fields if they have non-empty values (Salesforce rejects empty strings)
  if (tenancy.deposit_reference && tenancy.deposit_reference.trim()) {
    salesforceTenancy.deposit_reference = tenancy.deposit_reference;
  }
  if (tenancy.property_saon && tenancy.property_saon.trim()) {
    salesforceTenancy.property_saon = tenancy.property_saon;
  }
  if (tenancy.property_locality && tenancy.property_locality.trim()) {
    salesforceTenancy.property_locality = tenancy.property_locality;
  }

  const salesforcePayload = {
    tenancy: salesforceTenancy
  };

  context?.log('Legacy TDS API v1.2 payload transformed to Salesforce EWC format');

  return salesforcePayload;
}

/**
 * Normalize person classification to Salesforce accepted values
 * Legacy TDS API uses: "Lead Tenant", "Joint Tenant", "Primary Landlord", "Joint Landlord"
 * Salesforce accepts: "Tenant", "Primary Landlord"
 */
function normalizePersonClassification(classification) {
  if (!classification) return "Tenant";

  const normalized = classification.toLowerCase().trim();

  // Map Legacy TDS classifications to Salesforce accepted values
  if (normalized.includes('tenant')) {
    return "Tenant"; // Both "Lead Tenant" and "Joint Tenant" → "Tenant"
  }
  if (normalized.includes('landlord')) {
    return "Primary Landlord"; // Both "Primary Landlord" and "Joint Landlord" → "Primary Landlord"
  }

  return "Tenant"; // Default to Tenant
}

/**
 * Normalize person title to Salesforce accepted values
 * Salesforce accepts: Mr, Mrs, Miss, Dr, Prof, Rev
 */
function normalizeTitleForSalesforce(title) {
  if (!title) return "Mr"; // Default to Mr if not provided

  const normalizedTitle = title.trim();

  // Map common variations to Salesforce accepted values
  const titleMap = {
    'Ms': 'Miss',      // Ms → Miss
    'MS': 'Miss',
    'ms': 'Miss',
    'Mr': 'Mr',
    'MR': 'Mr',
    'mr': 'Mr',
    'Mrs': 'Mrs',
    'MRS': 'Mrs',
    'mrs': 'Mrs',
    'Miss': 'Miss',
    'MISS': 'Miss',
    'miss': 'Miss',
    'Dr': 'Dr',
    'DR': 'Dr',
    'dr': 'Dr',
    'Prof': 'Prof',
    'PROF': 'Prof',
    'prof': 'Prof',
    'Rev': 'Rev',
    'REV': 'Rev',
    'rev': 'Rev'
  };

  return titleMap[normalizedTitle] || 'Mr'; // Default to Mr if unknown
}

/**
 * Transform deposit status request to Salesforce format
 */
function transformStatusRequestToSalesforce(legacyStatusRequest, context) {
  // Salesforce uses REST-style URL parameters instead of POST body
  return {
    batchId: legacyStatusRequest.batch_id,
    // Credentials might be handled differently in Salesforce (OAuth vs basic auth)
    organizationId: legacyStatusRequest.organisation?.member_number
  };
}

module.exports = {
  transformLegacyToSalesforce,
  transformStandardModelToSalesforce,
  transformLegacyModelToSalesforce,
  transformStatusRequestToSalesforce
};
