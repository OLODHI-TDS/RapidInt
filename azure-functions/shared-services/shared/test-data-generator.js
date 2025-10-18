/**
 * Test Data Generator
 *
 * Generates realistic fake data for Alto integration testing using faker.js
 * Data structure matches Alto API responses exactly
 */

const { faker } = require('@faker-js/faker');

/**
 * Calculate deposit from rent using TDS formula
 * Formula: (rent / 4) * 5 = weekly rent * 5 weeks
 *
 * @param {number} rentAmount - Monthly rent amount
 * @returns {number} - Calculated deposit amount (rounded to 2 decimals)
 */
function calculateDeposit(rentAmount) {
    const weeklyRent = rentAmount / 4;
    const deposit = weeklyRent * 5;
    return Math.round(deposit * 100) / 100;
}

/**
 * Generate UK building number (1-9999) with unique suffix for test data
 * This prevents Salesforce from matching existing properties in high-concurrency scenarios
 */
function generateBuildingNumber() {
    const baseNumber = faker.number.int({ min: 1, max: 999 });
    const uniqueSuffix = Math.random().toString(36).substring(2, 5);
    return `${baseNumber}${uniqueSuffix}`;
}

/**
 * Generate realistic UK street name with unique suffix for test data
 * This prevents Salesforce from matching existing properties
 */
function generateStreetName() {
    const streetTypes = ['Street', 'Road', 'Avenue', 'Lane', 'Way', 'Close', 'Drive', 'Court', 'Place', 'Crescent'];
    const name = faker.location.street();
    const type = faker.helpers.arrayElement(streetTypes);

    // Remove existing type if present
    const baseName = name.replace(/\s+(Street|Road|Avenue|Lane|Way|Close|Drive|Court|Place|Crescent)$/i, '');

    // Add unique suffix to street name for test data uniqueness
    const uniqueSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${baseName} Test${uniqueSuffix} ${type}`;
}

/**
 * Generate realistic UK town/city
 */
function generateUKTown() {
    const ukTowns = [
        'Milton Keynes', 'Buckingham', 'Aylesbury', 'High Wycombe', 'Bletchley',
        'Newport Pagnell', 'Wolverton', 'Stony Stratford', 'Olney', 'Winslow',
        'Bedford', 'Northampton', 'Luton', 'Oxford', 'Cambridge',
        'Reading', 'Slough', 'Watford', 'St Albans', 'Hemel Hempstead'
    ];
    return faker.helpers.arrayElement(ukTowns);
}

/**
 * Generate realistic UK postcode
 * Format: AA9A 9AA or A9A 9AA or A9 9AA or A99 9AA or AA9 9AA or AA99 9AA
 */
function generateUKPostcode() {
    const areas = ['MK', 'HP', 'LU', 'NN', 'OX', 'CB', 'RG', 'SL', 'WD', 'AL', 'SG', 'PE', 'LE', 'CV', 'B', 'L', 'M', 'S', 'W', 'E', 'N', 'SW', 'SE', 'NW', 'NE'];
    const area = faker.helpers.arrayElement(areas);
    const district = faker.number.int({ min: 1, max: 99 });
    const sector = faker.number.int({ min: 0, max: 9 });
    const unit = faker.string.alpha({ length: 2, casing: 'upper' });

    return `${area}${district} ${sector}${unit}`;
}

/**
 * Generate ISO date string with timezone
 * @param {Date} date - Date object
 * @returns {string} - ISO format with timezone (e.g., 2025-11-10T00:00:00+00:00)
 */
function formatAltoDate(date) {
    return date.toISOString().replace('Z', '+00:00');
}

/**
 * Calculate tenancy dates based on start date and term
 * @param {Date} startDate - Tenancy start date
 * @param {number} termYears - Years
 * @param {number} termMonths - Additional months
 * @returns {Object} - Object with all calculated dates
 */
function calculateTenancyDates(startDate, termYears, termMonths) {
    const start = new Date(startDate);

    // End date = start + term - 1 day
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + termYears);
    end.setMonth(end.getMonth() + termMonths);
    end.setDate(end.getDate() - 1);

    // Renewal date = end + 1 day
    const renewal = new Date(end);
    renewal.setDate(renewal.getDate() + 1);

    // Notice to quit = 2 months before end
    const noticeToQuit = new Date(end);
    noticeToQuit.setMonth(noticeToQuit.getMonth() - 2);

    // Target vacate = 1 year after start
    const targetVacate = new Date(start);
    targetVacate.setFullYear(targetVacate.getFullYear() + 1);

    return {
        startDate: formatAltoDate(start),
        firstFullRentDate: formatAltoDate(start),
        endDate: formatAltoDate(end),
        renewalDate: formatAltoDate(renewal),
        noticeToQuitDate: formatAltoDate(noticeToQuit),
        targetVacateDate: formatAltoDate(targetVacate)
    };
}

/**
 * Generate complete address object
 * @param {boolean} includeFullAddress - If false, return empty address (except country)
 * @returns {Object} - Address object
 */
function generateAddress(includeFullAddress = true) {
    if (!includeFullAddress) {
        return {
            subDwelling: '',
            nameNo: '',
            street: '',
            locality: '',
            town: '',
            county: '',
            postcode: '',
            country: 'GB'
        };
    }

    const nameNo = generateBuildingNumber();
    const street = generateStreetName();
    const town = generateUKTown();
    const postcode = generateUKPostcode();

    return {
        subDwelling: '',
        nameNo,
        street,
        locality: '', // Always empty per requirements
        town,
        county: '', // Will be populated via postcode lookup
        postcode,
        country: 'GB'
    };
}

/**
 * Generate property-specific address (uses 'countryCode' instead of 'country')
 */
function generatePropertyAddress(includeFullAddress = true) {
    const address = generateAddress(includeFullAddress);

    // Replace 'country' with 'countryCode' for property structure
    const { country, ...rest } = address;
    return {
        ...rest,
        countryCode: country
    };
}

/**
 * Generate tenant contact address (uses 'nameNumber' instead of 'nameNo')
 */
function generateTenantAddress(includeFullAddress = true) {
    const address = generateAddress(includeFullAddress);

    // Replace 'nameNo' with 'nameNumber' and 'country' with 'countryCode'
    const { nameNo, country, ...rest } = address;
    return {
        ...rest,
        nameNumber: nameNo,
        countryCode: country
    };
}

/**
 * Generate UK mobile phone number
 */
function generateUKMobile() {
    const prefix = '07';
    const middle = faker.number.int({ min: 100, max: 999 });
    const end = faker.number.int({ min: 100000, max: 999999 });
    return `${prefix}${middle}${end}`;
}

/**
 * Generate UK landline phone number
 */
function generateUKLandline() {
    const prefix = '01';
    const area = faker.number.int({ min: 100, max: 999 });
    const number = faker.number.int({ min: 100000, max: 999999 });
    return `${prefix}${area}${number}`;
}

/**
 * Generate email address with unique identifier to prevent Salesforce conflicts
 * In high-concurrency scenarios, faker can generate duplicate emails which cause
 * UNABLE_TO_LOCK_ROW errors in Salesforce when it tries to upsert the same contact
 */
function generateEmail() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const random2 = Math.random().toString(36).substring(2, 8);
    return `test.user.${timestamp}.${random}.${random2}@example.com`;
}

/**
 * Generate property type
 */
function generatePropertyType() {
    const types = [
        'House - Semi-Detached',
        'House - Terraced',
        'House - Detached'
    ];
    return faker.helpers.arrayElement(types);
}

/**
 * Map property type to subTypeId
 */
function getPropertySubTypeId(propertyType) {
    const typeMap = {
        'House - Semi-Detached': 2,
        'House - Terraced': 3,
        'House - Detached': 1
    };
    return typeMap[propertyType] || 2;
}

/**
 * Generate tenancy object matching Alto API structure
 */
function generateTenancy(tenancyId, propertyId, address, rentAmount, depositAmount, config) {
    const dates = calculateTenancyDates(
        config.tenancyStartDate,
        config.termYears,
        config.termMonths
    );

    return {
        id: tenancyId,
        groupId: config.groupId,
        branchId: parseInt(config.branchId),
        propertyId: propertyId,
        termYears: config.termYears,
        termMonths: config.termMonths,
        occupantCount: config.numberOfTenants,
        rent: rentAmount,
        rentalFrequency: config.rentalFrequency,
        depositRequested: depositAmount,
        currencyCode: 'GBP',
        rentalAddress: address,
        startDate: dates.startDate,
        targetVacateDate: dates.targetVacateDate,
        firstFullRentDate: dates.firstFullRentDate,
        noticeToQuitDate: dates.noticeToQuitDate,
        endDate: dates.endDate,
        renewalDate: dates.renewalDate,
        nextTermTenancyId: 0
    };
}

/**
 * Generate property object matching Alto API structure
 */
function generateProperty(propertyId, address, rentAmount, landlords, config) {
    const propertyType = generatePropertyType();
    const now = new Date();

    return {
        id: propertyId.toString(),
        branchId: config.branchId,
        category: 'Residential',
        recordType: 'Rent',
        address: address,
        priceQualifier: 'Unspecified',
        currency: 'GBP',
        yearBuilt: null,
        newBuild: false,
        floorAreaInSquareFeet: null,
        landAreaInAcres: null,
        price: rentAmount,
        bedrooms: faker.number.int({ min: 1, max: 5 }),
        receptions: faker.number.int({ min: 0, max: 2 }),
        bathrooms: faker.number.int({ min: 1, max: 3 }),
        propertySubTypeId: getPropertySubTypeId(propertyType),
        propertyType: propertyType,
        status: 'Let Agreed',
        inventoryStatus: 'LetAgreed',
        archived: false,
        isAtActiveStatus: true,
        tenureId: 0,
        tenure: '',
        rentalFrequency: 'Monthly',
        owners: landlords.items.map(landlord => ({
            ownerId: landlord.id,
            contactId: parseInt(landlord.id.split('-')[0]),
            name: {
                title: landlord.title,
                forename: landlord.forename,
                surname: landlord.surname
            },
            phoneNumbers: landlord.phone ? [{
                preferenceOrder: 1,
                type: 'Mobile',
                number: landlord.phone
            }] : [],
            emailAddresses: landlord.email ? [{
                preferenceOrder: 1,
                address: landlord.email
            }] : []
        })),
        taxBand: '',
        taxBandExemptReason: '',
        serviceCharge: null,
        groundRent: null,
        localAuthority: '',
        leaseRemainingYears: null,
        leaseTerm: null,
        leaseEndDate: null,
        groundRentReviewPeriod: null,
        groundRentPercentageIncrease: null,
        sharedOwnership: null,
        sharedOwnershipPercentageShare: null,
        sharedOwnershipRent: null,
        sharedOwnershipRentFrequencyId: null,
        leaseNotes: '',
        privateViewingNotes: '',
        displayAddress: `${address.street}, ${address.town}`,
        hasAsbestos: false,
        rentalDateAvailable: null,
        groundRentFixedForTerm: null,
        groundRentNotes: null,
        serviceChargeNotes: null,
        negotiator: {
            id: faker.number.int({ min: 10000, max: 99999 }),
            name: ''
        },
        negotiatorName: '',
        instructionDate: formatAltoDate(now),
        managementType: 'Unspecified',
        maintenanceType: 'Unspecified',
        accessibilityRequirements: {
            accessibility: []
        },
        broadband: {
            supply: [],
            speed: null
        },
        buildingSafety: {
            issue: []
        },
        construction: {
            material: []
        },
        coastalErosion: null,
        electricity: {
            supply: []
        },
        floodingRisks: {
            sourcesOfFlooding: {
                source: []
            },
            floodedWithinLast5Years: null,
            floodDefensesPresent: null
        },
        heating: {
            source: []
        },
        knownPlanningConsiderations: null,
        miningRisks: {
            coalfields: null,
            otherMiningActivities: null
        },
        mobileCoverage: null,
        parking: {
            parkingType: []
        },
        restrictions: {
            conservationArea: null,
            leaseRestrictions: null,
            listedBuilding: null,
            permittedDevelopment: null,
            realBurdens: null,
            holidayHomeRental: null,
            restrictiveCovenant: null,
            businessFromProperty: null,
            propertySubletting: null,
            treePreservationOrder: null,
            other: null
        },
        rightsAndEasements: {
            rightOfWayPublic: null,
            rightOfWayPrivate: null,
            registeredEasementsHmlr: null,
            servitudes: null,
            sharedDriveway: null,
            loftAccess: null,
            drainAccess: null,
            other: null
        },
        sewerage: {
            supply: []
        },
        water: {
            supply: []
        },
        epc: {
            energyEfficiencyRatingCurrent: null,
            energyEfficiencyRatingPotential: null,
            exempt: false,
            exemptionReason: null
        },
        uprn: null,
        createdDate: formatAltoDate(now),
        modifiedDate: formatAltoDate(now)
    };
}

/**
 * Generate landlords array matching Alto /landlords endpoint structure
 */
function generateLandlords(count, config) {
    const items = [];

    for (let i = 0; i < count; i++) {
        const contactId = faker.number.int({ min: 10000000, max: 99999999 });
        const landlordId = `${contactId}-${i + 1}`;
        const now = new Date();

        // Generate Salesforce-supported titles (without periods - Alto format)
        // These will be converted to Salesforce format with periods: Mr., Mrs., Ms., Dr., Prof., Mx.
        const title = faker.helpers.arrayElement(['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Mx']);
        const forename = faker.person.firstName();
        // Add unique suffix to surname to prevent Salesforce contact matching conflicts
        const baseSurname = faker.person.lastName();
        const uniqueSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const surname = `${baseSurname}${uniqueSuffix}`;

        // Random: email only, phone only, or both
        const contactType = faker.number.int({ min: 1, max: 3 });
        const email = contactType === 1 || contactType === 3 ? generateEmail() : null;
        const phone = contactType === 2 || contactType === 3 ? generateUKLandline() : null;

        // Generate full address for landlords (success scenario)
        const address = generateAddress(true);

        items.push({
            id: landlordId,
            title,
            forename,
            surname,
            phone,
            email,
            address,
            createdDate: formatAltoDate(now),
            modifiedDate: formatAltoDate(now),
            links: [{
                href: `/contacts/${contactId}`,
                rel: 'self'
            }]
        });
    }

    return {
        totalCount: count,
        items
    };
}

/**
 * Generate tenants array matching Alto contact structure
 */
function generateTenants(count, config) {
    const tenants = [];

    for (let i = 0; i < count; i++) {
        const contactId = faker.number.int({ min: 10000000, max: 99999999 });

        // Generate Salesforce-supported titles (without periods - Alto format)
        // These will be converted to Salesforce format with periods: Mr., Mrs., Ms., Mx.
        const title = faker.helpers.arrayElement(['Mr', 'Mrs', 'Miss', 'Ms', 'Mx']);
        const forename = faker.person.firstName();
        // Add unique suffix to surname to prevent Salesforce contact matching conflicts
        const baseSurname = faker.person.lastName();
        const uniqueSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const surname = `${baseSurname}${uniqueSuffix}`;

        // Random: email only, phone only, or both
        const contactType = faker.number.int({ min: 1, max: 3 });
        const hasEmail = contactType === 1 || contactType === 3;
        const hasPhone = contactType === 2 || contactType === 3;

        const phoneNumbers = hasPhone ? [{
            preferenceOrder: 1,
            type: 'Mobile',
            number: generateUKMobile(),
            description: 'Home'
        }] : [];

        const emailAddresses = hasEmail ? [{
            preferenceOrder: 1,
            type: 'Personal',
            address: generateEmail()
        }] : [];

        // Random: empty address or full address
        const includeAddress = faker.datatype.boolean();
        const address = generateTenantAddress(includeAddress);

        tenants.push({
            items: [{
                address,
                branch: {
                    id: config.branchId
                },
                people: [{
                    title,
                    forename,
                    surname,
                    phoneNumbers,
                    emailAddresses,
                    id: '1',
                    links: [{
                        href: `/contacts/${contactId}/persons/1`,
                        rel: 'self'
                    }]
                }],
                category: 'Client',
                intention: {
                    code: '89',
                    name: 'Not looking'
                },
                notes: '',
                archived: false,
                applicantRequirements: [{
                    profileIntention: 'Buy',
                    isNewBuild: null,
                    priceFrom: null,
                    priceTo: null,
                    bedsMin: null,
                    isActiveProfile: true,
                    rentalIntention: null,
                    id: faker.number.int({ min: 10000000, max: 99999999 }).toString(),
                    links: []
                }],
                id: contactId.toString(),
                links: [{
                    href: `/contacts/${contactId}`,
                    rel: 'self'
                }]
            }]
        });
    }

    return tenants;
}

/**
 * Main generator function - Generate complete Alto tenancy data for testing
 *
 * @param {Object} options - Configuration options
 * @param {number} options.rentAmount - Monthly rent (or null for random £800-£3000)
 * @param {number} options.termYears - Tenancy term in years (default: 1)
 * @param {number} options.termMonths - Additional months (default: 0)
 * @param {number} options.numberOfTenants - Number of tenants (1-4, default: 1)
 * @param {number} options.numberOfLandlords - Number of landlords (1-2, default: 1)
 * @param {Date} options.tenancyStartDate - Start date (default: today)
 * @param {string} options.rentalFrequency - Frequency (default: 'Monthly')
 * @param {string} options.agencyRef - Agency reference
 * @param {string} options.branchId - Branch ID
 * @param {number} options.groupId - Group ID (default: 2419)
 * @param {string} options.scenario - Test scenario (default: 'complete')
 *
 * @returns {Object} - Complete Alto API formatted response
 */
function generateAltoTenancyData(options = {}) {
    // Set defaults
    const config = {
        rentAmount: options.rentAmount || faker.number.int({ min: 800, max: 3000 }),
        termYears: options.termYears !== undefined ? options.termYears : 1,
        termMonths: options.termMonths !== undefined ? options.termMonths : 0,
        numberOfTenants: options.numberOfTenants || 1,
        numberOfLandlords: options.numberOfLandlords || 1,
        tenancyStartDate: options.tenancyStartDate || new Date(),
        rentalFrequency: options.rentalFrequency || 'Monthly',

        // Organization
        agencyRef: options.agencyRef || '1af89d60-662c-475b-bcc8-9bcbf04b6322',
        branchId: options.branchId || '8282',
        groupId: options.groupId !== undefined ? options.groupId : 2419,

        // Test scenario
        scenario: options.scenario || 'complete'
    };

    // Calculate deposit from rent using TDS formula
    const depositAmount = calculateDeposit(config.rentAmount);

    // Generate unique IDs
    // Property IDs: 10000000-99999999 (normal range)
    // Tenancy IDs: 9000000-9999999 (start with 9 for easy identification)
    const propertyId = faker.number.int({ min: 10000000, max: 99999999 });
    const tenancyId = faker.number.int({ min: 9000000, max: 9999999 });

    // Generate address (used by both tenancy and property)
    const baseAddress = generateAddress(true);
    const tenancyAddress = { ...baseAddress }; // For tenancy (uses 'country')
    const propertyAddress = generatePropertyAddress(true); // For property (uses 'countryCode')

    // Copy values from base address
    Object.keys(baseAddress).forEach(key => {
        if (key !== 'country' && key !== 'countryCode') {
            propertyAddress[key] = baseAddress[key];
        }
    });

    // Generate landlords
    const landlords = generateLandlords(config.numberOfLandlords, config);

    // Generate property (includes owners from landlords)
    const property = generateProperty(propertyId, propertyAddress, config.rentAmount, landlords, config);

    // Generate tenants
    const tenants = generateTenants(config.numberOfTenants, config);

    // Generate tenancy
    const tenancy = generateTenancy(tenancyId, propertyId, tenancyAddress, config.rentAmount, depositAmount, config);

    return {
        tenancy,
        property,
        landlords,
        landlord: landlords.items[0], // First landlord for backward compatibility
        tenants,
        fetchedAt: new Date().toISOString()
    };
}

module.exports = {
    generateAltoTenancyData,
    calculateDeposit
};
