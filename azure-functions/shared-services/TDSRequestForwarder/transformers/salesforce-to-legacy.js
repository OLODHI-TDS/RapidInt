/**
 * Salesforce EWC API to Legacy TDS API Transformer
 *
 * Converts response payloads from the Salesforce EWC TDS API
 * back to the legacy TDS API format (v1.2) for backward compatibility.
 *
 * This ensures that existing integrations continue to work seamlessly
 * when routing switches to Salesforce API.
 *
 * Key Transformations:
 * - Field names: snake_case (SAME in both - minimal transformation needed)
 * - Dates: UK format (DD-MM-YYYY) → ISO 8601 (YYYY-MM-DD)
 * - Booleans: "true"/"false" strings → true/false booleans
 * - Numbers: "1500" strings → 1500 numbers
 */

/**
 * Convert UK date format (DD-MM-YYYY) to ISO format (YYYY-MM-DD)
 */
function convertUKDateToISO(ukDate) {
  if (!ukDate) return null;

  const [day, month, year] = ukDate.split('-');
  return `${year}-${month}-${day}`;
}

/**
 * Convert string boolean to actual boolean
 */
function stringToBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return value === "true";
}

/**
 * Convert string number to actual number
 */
function stringToNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Transform Salesforce EWC response to legacy format
 */
function transformSalesforceToLegacy(salesforceResponse, context) {
  try {
    context?.log('Transforming Salesforce EWC response to legacy format');

    // TDS EWC API responses are already in snake_case format
    // We just need to convert data types (dates, booleans, numbers)

    // Check if it's a success/error response (Salesforce uses uppercase Success)
    if (salesforceResponse.success !== undefined || salesforceResponse.Success !== undefined) {
      return transformSuccessErrorResponse(salesforceResponse, context);
    }

    // Check if it's a batch status response
    if (salesforceResponse.batch_id || salesforceResponse.status) {
      return transformStatusResponse(salesforceResponse, context);
    }

    // Generic transformation
    return transformGenericResponse(salesforceResponse, context);

  } catch (error) {
    context?.error('Error transforming Salesforce to legacy:', error);
    throw new Error(`Transformation failed: ${error.message}`);
  }
}

/**
 * Transform Salesforce EWC success/error response
 * Handles CreateDeposit response with DAN
 *
 * Legacy TDS API Success format:
 * { "batch_id": "167237", "success": "true" }
 *
 * Legacy TDS API Error format:
 * { "error": "Invalid authentication key", "success": "false" }
 */
function transformSuccessErrorResponse(salesforceResponse, context) {
  // Check if the response indicates success
  const isSuccess = salesforceResponse.success === true ||
                    salesforceResponse.Success === true ||
                    salesforceResponse.success === 'true' ||
                    salesforceResponse.Success === 'true';

  if (isSuccess) {
    // Success response - Legacy format
    // Legacy API returns only batch_id and success in CreateDeposit response
    // DAN is retrieved separately via CreateDepositStatus endpoint
    const legacyResponse = {
      batch_id: salesforceResponse.batch_id || salesforceResponse.batchId || null,
      success: "true"  // String "true" for Legacy API compatibility
    };

    context?.log('✅ Success response transformed to legacy format:', legacyResponse);
    return legacyResponse;
  } else {
    // Error response - Legacy format
    const errorMessage = salesforceResponse.error ||
                         salesforceResponse.message ||
                         salesforceResponse.errorMessage ||
                         (salesforceResponse.errors && salesforceResponse.errors[0]) ||
                         'An error occurred';

    const legacyResponse = {
      error: errorMessage,
      success: "false"  // String "false" for Legacy API compatibility
    };

    context?.log('❌ Error response transformed to legacy format:', legacyResponse);
    return legacyResponse;
  }
}

/**
 * Transform Salesforce EWC create deposit response (no longer needed - same format)
 * Keeping for backward compatibility
 */
function transformCreateDepositResponse(salesforceResponse, context) {
  // TDS EWC API already returns snake_case, just ensure data types are correct
  const legacyResponse = {
    batch_id: salesforceResponse.batch_id || null,
    status: salesforceResponse.status || 'unknown',
    message: salesforceResponse.message || 'Deposit submitted successfully',
    timestamp: new Date().toISOString(),
    success: stringToBoolean(salesforceResponse.success)
  };

  // Add errors if present
  if (salesforceResponse.errors) {
    legacyResponse.errors = Array.isArray(salesforceResponse.errors)
      ? salesforceResponse.errors
      : [salesforceResponse.errors];
  }

  // Add warnings if present
  if (salesforceResponse.warnings) {
    legacyResponse.warnings = Array.isArray(salesforceResponse.warnings)
      ? salesforceResponse.warnings
      : [salesforceResponse.warnings];
  }

  context?.log('Create deposit response transformed to legacy format');

  return legacyResponse;
}

/**
 * Transform Salesforce EWC deposit status response to legacy format
 *
 * Legacy TDS API format:
 * Success: { "success": "true", "status": "created", "dan": "NI0000123", "branch_id": "123456", "warnings": [...] }
 * Error: { "batch_id": "1033783", "success": true, "status": "Failed", "dan": "", "errors": [...], "warnings": [...] }
 */
function transformStatusResponse(salesforceResponse, context) {
  // Check if this is a success or error response
  const isSuccess = salesforceResponse.success === true ||
                    salesforceResponse.success === 'true' ||
                    salesforceResponse.dan ||
                    salesforceResponse.DAN;

  // Build Legacy TDS API response
  const legacyResponse = {
    success: isSuccess ? "true" : true,  // String "true" for success, boolean true for errors
    status: salesforceResponse.status || (isSuccess ? 'created' : 'Failed'),
    dan: salesforceResponse.dan || salesforceResponse.DAN || salesforceResponse.dan_number || ''
  };

  // Add batch_id (especially for error responses)
  if (salesforceResponse.batch_id) {
    legacyResponse.batch_id = salesforceResponse.batch_id;
  }

  // Add branch_id if available
  if (salesforceResponse.branch_id) {
    legacyResponse.branch_id = salesforceResponse.branch_id;
  }

  // Add errors array if present
  if (salesforceResponse.errors) {
    // Transform Salesforce error format to Legacy format
    if (salesforceResponse.errors.failure) {
      // Salesforce format: { "errors": { "failure": "message" } }
      const failureMsg = salesforceResponse.errors.failure;
      legacyResponse.errors = Array.isArray(failureMsg) ? failureMsg : [{ value: failureMsg }];
    } else if (Array.isArray(salesforceResponse.errors)) {
      legacyResponse.errors = salesforceResponse.errors;
    } else {
      legacyResponse.errors = [salesforceResponse.errors];
    }
  }

  // Add warnings array if present
  if (salesforceResponse.warnings) {
    legacyResponse.warnings = Array.isArray(salesforceResponse.warnings)
      ? salesforceResponse.warnings
      : [salesforceResponse.warnings];
  }

  context?.log('Status response transformed to legacy format');

  return legacyResponse;
}

/**
 * Transform generic Salesforce EWC response
 */
function transformGenericResponse(salesforceResponse, context) {
  // TDS EWC already uses snake_case, just convert data types where needed
  const legacyResponse = {};

  for (const [key, value] of Object.entries(salesforceResponse)) {
    // Convert data types based on field patterns
    if (key.includes('date') && typeof value === 'string' && value.includes('-')) {
      // Convert dates from DD-MM-YYYY to YYYY-MM-DD
      legacyResponse[key] = convertUKDateToISO(value);
    } else if (key.includes('amount') || key.includes('number_of') || key.includes('bedrooms')) {
      // Convert string numbers to actual numbers
      legacyResponse[key] = stringToNumber(value);
    } else if (key.includes('furnished') || key.includes('is_')) {
      // Convert string booleans to actual booleans
      legacyResponse[key] = stringToBoolean(value);
    } else {
      // Keep as-is
      legacyResponse[key] = value;
    }
  }

  return legacyResponse;
}

/**
 * Map Salesforce EWC status values to legacy status values
 * (TDS EWC uses similar status values, minimal mapping needed)
 */
function mapSalesforceStatusToLegacy(salesforceStatus) {
  const statusMapping = {
    'New': 'submitted',
    'Submitted': 'submitted',
    'Processing': 'processing',
    'Processed': 'processing',
    'Completed': 'created',
    'Created': 'created',
    'Failed': 'failed',
    'Error': 'failed',
    'Rejected': 'failed',
    'Pending': 'processing',
    'In Progress': 'processing'
  };

  return statusMapping[salesforceStatus] || salesforceStatus || 'unknown';
}

/**
 * Transform Salesforce error response to legacy format
 */
function transformErrorResponse(salesforceError, context) {
  return {
    error: true,
    error_code: salesforceError.errorCode || 'SALESFORCE_ERROR',
    message: salesforceError.message || 'An error occurred',
    fields: salesforceError.fields || [],
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  transformSalesforceToLegacy,
  transformCreateDepositResponse,
  transformStatusResponse,
  transformGenericResponse,
  transformErrorResponse,
  mapSalesforceStatusToLegacy
};
