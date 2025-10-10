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
 */
function transformLegacyModelToSalesforce(legacyPayload, context) {
  // Legacy API format might have deposits array
  const deposits = legacyPayload.deposits || [legacyPayload];

  // For now, handle only first deposit (TDS EWC API expects single tenancy per request)
  const deposit = deposits[0] || {};
  const property = deposit.property || {};
  const landlord = deposit.landlord || {};
  const tenants = deposit.tenants || [];

  // Build people array
  const people = [];

  // Add primary landlord
  if (landlord.first_name || landlord.last_name) {
    people.push({
      person_classification: "Primary Landlord",
      person_id: landlord.id || landlord.landlord_id || "",
      person_reference: landlord.reference || "",
      person_title: landlord.title || "",
      person_firstname: landlord.first_name || "",
      person_surname: landlord.last_name || "",
      is_business: booleanToString(landlord.is_business || false),
      business_name: landlord.business_name || "",
      person_paon: landlord.address_line_1 || landlord.address?.line1 || "",
      person_saon: landlord.address_line_2 || landlord.address?.line2 || "",
      person_street: landlord.street || landlord.address?.street || "",
      person_locality: landlord.locality || landlord.address?.locality || "",
      person_town: landlord.town || landlord.address?.town || "",
      person_postcode: landlord.postcode || landlord.address?.postcode || "",
      person_country: landlord.country || landlord.address?.country || "United Kingdom",
      person_phone: landlord.phone || "",
      person_email: landlord.email || "",
      person_mobile: landlord.mobile || ""
    });
  }

  // Add tenants
  tenants.forEach((tenant, index) => {
    people.push({
      person_classification: "Tenant",
      person_id: tenant.id || tenant.tenant_id || `tenant_${index + 1}`,
      person_reference: tenant.reference || "",
      person_title: tenant.title || "",
      person_firstname: tenant.first_name || "",
      person_surname: tenant.last_name || "",
      is_business: booleanToString(tenant.is_business || false),
      business_name: tenant.business_name || "",
      person_paon: tenant.address_line_1 || tenant.address?.line1 || "",
      person_saon: tenant.address_line_2 || tenant.address?.line2 || "",
      person_street: tenant.street || tenant.address?.street || "",
      person_locality: tenant.locality || tenant.address?.locality || "",
      person_town: tenant.town || tenant.address?.town || "",
      person_postcode: tenant.postcode || tenant.address?.postcode || "",
      person_country: tenant.country || tenant.address?.country || "United Kingdom",
      person_phone: tenant.phone || "",
      person_email: tenant.email || "",
      person_mobile: tenant.mobile || ""
    });
  });

  const salesforcePayload = {
    tenancy: {
      user_tenancy_reference: deposit.tenancy_reference || deposit.reference || "",
      deposit_reference: deposit.deposit_reference || deposit.reference || "",
      property_id: property.property_id || property.id || "",
      property_paon: property.address_line_1 || property.paon || "",
      property_saon: property.address_line_2 || property.saon || "",
      property_street: property.street || property.address_line_3 || "",
      property_town: property.town || property.city || "",
      property_administrative_area: property.county || property.administrative_area || "",
      property_postcode: property.postcode || "",
      tenancy_start_date: convertDateToUKFormat(deposit.tenancy_start_date),
      tenancy_expected_end_date: convertDateToUKFormat(deposit.tenancy_end_date || deposit.tenancy_expected_end_date),
      number_of_living_rooms: numberToString(property.living_rooms || property.number_of_living_rooms || 1),
      number_of_bedrooms: numberToString(property.bedrooms || property.number_of_bedrooms || 0),
      furnished_status: booleanToString(property.furnished || property.furnished_status || false),
      rent_amount: numberToString(deposit.rent_amount || 0),
      deposit_amount: numberToString(deposit.deposit_amount || 0),
      deposit_amount_to_protect: numberToString(deposit.deposit_amount_to_protect || deposit.deposit_amount || 0),
      deposit_received_date: convertDateToUKFormat(deposit.deposit_received_date || deposit.tenancy_deposit_allocation_datetime),
      number_of_tenants: numberToString(tenants.length),
      number_of_landlords: "1",
      people: people
    }
  };

  context?.log('Legacy model transformed to Salesforce EWC format');

  return salesforcePayload;
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
