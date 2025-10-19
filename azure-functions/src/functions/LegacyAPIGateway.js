const { app } = require('@azure/functions');

// Clear transformer module cache to force reload (fixes Node.js caching issue)
const transformerPath = require.resolve('../../shared-services/TDSRequestForwarder/transformers/legacy-to-salesforce');
delete require.cache[transformerPath];

const { transformLegacyToSalesforce } = require('../../shared-services/TDSRequestForwarder/transformers/legacy-to-salesforce');
const { transformSalesforceToLegacy } = require('../../shared-services/TDSRequestForwarder/transformers/salesforce-to-legacy');
const { getSalesforceAuthHeader } = require('../../shared-services/shared/salesforce-auth');
const { sanitizeForLogging } = require('../../shared-services/shared/sanitized-logger');
const { storeBatchTracking } = require('../../shared-services/shared/batch-tracking');
const { OrganizationMappingService } = require('./OrganizationMapping');
const telemetry = require('../../shared-services/shared/telemetry');
const axios = require('axios');

/**
 * Legacy API Gateway
 *
 * Provides backward compatibility for integration partners using the Legacy TDS API.
 * Transparently forwards requests to Salesforce TDS API with automatic payload transformation.
 *
 * DNS forwarding routes legacy endpoints to these middleware endpoints:
 * - POST /v1.2/CreateDeposit → /api/legacy/CreateDeposit
 * - GET /v1.2/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId} → /api/legacy/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId}
 *
 * Features:
 * - Automatic Legacy → Salesforce payload transformation
 * - Organization-specific credential lookup
 * - Response transformation (Salesforce → Legacy format)
 * - Comprehensive logging for monitoring and troubleshooting
 * - Rate limiting and error handling
 *
 * Architecture:
 * Integration Partner (unchanged Legacy API client)
 *   ↓ DNS forwarding
 * LegacyAPIGateway (this file)
 *   ↓ transformLegacyToSalesforce()
 * Salesforce TDS API
 *   ↓ Response
 *   ↓ transformSalesforceToLegacy()
 * Integration Partner (receives Legacy-formatted response)
 */

/**
 * Authenticate and lookup organization by Legacy TDS credentials
 *
 * @param {Object} legacyPayload - Legacy TDS API payload
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Organization mapping with Salesforce credentials
 */
async function authenticateLegacyRequest(legacyPayload, context) {
  try {
    // Extract Legacy credentials from payload
    const { member_id, branch_id, api_key } = legacyPayload;

    if (!member_id || !branch_id || !api_key) {
      throw new Error('Missing required Legacy TDS credentials (member_id, branch_id, api_key)');
    }

    context.log(`🔐 Authenticating Legacy API request: Member ID: ${member_id}, Branch ID: ${branch_id}`);

    // Query OrganizationMapping directly using the service class
    const orgMappingService = new OrganizationMappingService(context);
    const allMappings = await orgMappingService.getAllMappings();

    // Find organization with matching Legacy credentials
    const matchingOrg = allMappings.find(mapping => {
      return mapping.legacyMemberId === member_id &&
             mapping.legacyBranchId === branch_id &&
             mapping.isActive === true;
    });

    if (!matchingOrg) {
      throw new Error(`No active organization found for Legacy credentials: ${member_id}/${branch_id}`);
    }

    // Validate API key (basic check - in production, use encrypted comparison)
    if (matchingOrg.legacyApiKey !== api_key) {
      throw new Error('Invalid Legacy API key');
    }

    context.log(`✅ Authentication successful: ${matchingOrg.organizationName}`);

    // Determine Salesforce baseUrl based on environment
    const salesforceBaseUrl = matchingOrg.environment === 'production'
      ? (process.env.TDS_SALESFORCE_PROD_URL || 'https://thedisputeservice.my.salesforce-sites.com')
      : (process.env.TDS_SALESFORCE_DEV_URL || 'https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com');

    return {
      organizationName: matchingOrg.organizationName,
      organizationId: `${member_id}:${branch_id}`, // Use Legacy credentials as unique ID (not agencyRef!)
      legacyMemberId: member_id,
      legacyBranchId: branch_id,
      environment: matchingOrg.environment,

      // Salesforce credentials for forwarding
      salesforce: {
        memberId: matchingOrg.sfMemberId,
        branchId: matchingOrg.sfBranchId,
        region: matchingOrg.sfRegion,
        schemeType: matchingOrg.sfSchemeType,
        authMethod: matchingOrg.sfAuthMethod,
        apiKey: matchingOrg.sfApiKey,
        clientId: matchingOrg.sfClientId,
        clientSecret: matchingOrg.sfClientSecret,
        baseUrl: salesforceBaseUrl  // ← Add baseUrl for OAuth2
      }
    };

  } catch (error) {
    context.error(`❌ Authentication failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get Salesforce TDS API URL based on environment
 */
function getSalesforceUrl(environment) {
  // Load from TDS Settings or use environment variables
  if (environment === 'production') {
    return process.env.TDS_SALESFORCE_PROD_URL || 'https://thedisputeservice.my.salesforce-sites.com';
  } else {
    return process.env.TDS_SALESFORCE_DEV_URL || 'https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com';
  }
}

/**
 * CreateDeposit endpoint handler
 */
async function handleCreateDeposit(legacyPayload, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log('📦 Processing CreateDeposit request...');

    // Transform Legacy payload to Salesforce format
    context.log('🔄 Transforming Legacy payload to Salesforce format...');
    const salesforcePayload = transformLegacyToSalesforce(legacyPayload, context);

    context.log('📝 Salesforce payload (sanitized):', JSON.stringify(sanitizeForLogging(salesforcePayload), null, 2));

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/depositcreation
    // API Key: Use /services/apexrest/depositcreation
    let endpointPath = '/services/apexrest/depositcreation';
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = '/services/apexrest/auth/depositcreation';
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    const endpoint = `${salesforceUrl}${endpointPath}`;

    context.log(`📤 Forwarding to Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    context.log('🔑 Salesforce credentials:', {
      memberId: orgMapping.salesforce.memberId,
      branchId: orgMapping.salesforce.branchId,
      authMethod: orgMapping.salesforce.authMethod,
      hasClientId: !!orgMapping.salesforce.clientId,
      hasClientSecret: !!orgMapping.salesforce.clientSecret,
      hasApiKey: !!orgMapping.salesforce.apiKey,
      baseUrl: orgMapping.salesforce.baseUrl
    });
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.post(
      endpoint,
      salesforcePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 60000 // 60 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    context.log('🔄 Transforming Salesforce response to Legacy format...');
    const legacyResponse = transformSalesforceToLegacy(salesforceResponse.data, context);

    // Check if Salesforce returned an error (success: false in response body)
    if (legacyResponse.success === "false") {
      context.warn('⚠️ Salesforce returned error response:', legacyResponse.error);

      // Track as failed request
      telemetry.trackEvent('Legacy_API_Request', {
        endpoint: 'CreateDeposit',
        organization: orgMapping.organizationName,
        success: 'false',
        error: legacyResponse.error
      });

      return {
        statusCode: 400,  // Return 400 for business logic errors
        body: legacyResponse,
        duration
      };
    }

    // Log transaction for audit (optional - don't fail request if tracking fails)
    try {
      const batchId = legacyResponse.batch_id || `LEGACY_${Date.now()}`;

      // Store batch tracking using Legacy credentials as organizationId
      await storeBatchTracking(
        batchId,
        'salesforce', // provider
        orgMapping.organizationId, // organizationId (legacyMemberId:legacyBranchId)
        null, // altoTenancyId (not applicable for legacy gateway)
        legacyPayload, // requestPayload (for audit)
        salesforceResponse.data, // responsePayload (for audit)
        {
          endpoint: 'CreateDeposit',  // Track which Legacy API endpoint was called
          requestDurationMs: duration,
          executionMode: 'forwarding',
          metadata: {
            source: 'legacy_api_gateway',
            environment: orgMapping.environment,
            legacyMemberId: legacyPayload.member_id,
            legacyBranchId: legacyPayload.branch_id
          }
        },
        context
      );

      // If we got a DAN, update the batch status to 'created' with DAN
      if (legacyResponse.dan) {
        const { updateBatchStatus } = require('../../shared-services/shared/batch-tracking');
        await updateBatchStatus(
          batchId,
          orgMapping.organizationId, // Use same organizationId (legacyMemberId:legacyBranchId)
          'created',
          legacyResponse.dan,
          salesforceResponse.data,
          null,
          null,
          context
        );
        context.log(`✅ Batch tracking updated with DAN: ${legacyResponse.dan}`);
      }
    } catch (trackingError) {
      context.warn('⚠️ Batch tracking failed (deposit creation succeeded):', trackingError.message);
    }

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'CreateDeposit',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ CreateDeposit completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ CreateDeposit failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    // Log detailed Salesforce error response
    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          // Format: { "errors": { "failure": "error message" } } OR { "errors": { "failure": ["error"] } }
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          }
          // Format: { "errors": ["error message"] }
          else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          }
          // Format: { "errors": "error message" }
          else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        }
        // Format: { "error": "error message" }
        else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        }
        // Format: { "message": "error message" }
        else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
        // Keep the original error.message if parsing fails
      }
    }

    context.error('Error stack:', error.stack);

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'CreateDeposit',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'CreateDeposit',
      organization: orgMapping.organizationName,
      success: 'false',
      error: errorMessage
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        error: errorMessage,
        success: "false"  // String "false" for Legacy API compatibility
      },
      duration
    };
  }
}

/**
 * CreateDepositStatus endpoint handler
 * Credentials are extracted from URL path and authenticated before this is called
 */
async function handleCreateDepositStatus(batchId, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`📊 Processing CreateDepositStatus request for batch: ${batchId}`);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/CreateDepositStatus/{batchId}
    // API Key: Use /services/apexrest/CreateDepositStatus/{batchId}
    let endpointPath = `/services/apexrest/CreateDepositStatus/${batchId}`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/CreateDepositStatus/${batchId}`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    const endpoint = `${salesforceUrl}${endpointPath}`;

    context.log(`📤 Checking status at Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.get(
      endpoint,
      {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce status response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    // Note: Status responses have a similar structure, but may need specific transformation
    const legacyResponse = {
      batch_id: batchId,
      status: salesforceResponse.data.status || salesforceResponse.data.Status__c || 'unknown',
      dan: salesforceResponse.data.dan || salesforceResponse.data.DAN_Number__c || null,
      errors: salesforceResponse.data.errors || salesforceResponse.data.Errors__c || [],
      warnings: salesforceResponse.data.warnings || salesforceResponse.data.Warnings__c || []
    };

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'CreateDepositStatus',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ CreateDepositStatus completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ CreateDepositStatus failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          // Format: { "errors": { "failure": "error message" } } OR { "errors": { "failure": ["error"] } }
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          }
          // Format: { "errors": ["error message"] }
          else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          }
          // Format: { "errors": "error message" }
          else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        } else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        } else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
      }
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'CreateDepositStatus',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    // Legacy format: { "batch_id": "...", "success": true, "status": "Failed", "dan": "", "errors": [...] }
    return {
      statusCode: error.response?.status || 500,
      body: {
        batch_id: batchId,
        success: true,  // Boolean true for error responses (Legacy API convention)
        status: 'Failed',
        dan: '',
        errors: [{ value: errorMessage }]
      },
      duration
    };
  }
}

/**
 * Transform Salesforce errors format to Legacy array format
 * Salesforce can return errors in multiple formats:
 * - { "errors": { "failure": "message" } }
 * - { "errors": ["error1", "error2"] }
 * - { "errors": "single error" }
 *
 * Legacy expects: [{ "field": "error message" }] or [{ "value": "error message" }]
 */
function transformErrorsToLegacyFormat(salesforceErrors) {
  // If errors is an object with "failure" key
  if (salesforceErrors.failure) {
    const failureMsg = salesforceErrors.failure;
    if (Array.isArray(failureMsg)) {
      return failureMsg.map(msg => ({ value: msg }));
    } else if (typeof failureMsg === 'string') {
      return [{ value: failureMsg }];
    }
  }

  // If errors is already an array
  if (Array.isArray(salesforceErrors)) {
    return salesforceErrors.map(error => {
      // If array item is already an object with name/value/field, keep it
      if (typeof error === 'object' && (error.name || error.value || error.field)) {
        return error;
      }
      // If array item is a string, wrap it
      return { value: error };
    });
  }

  // If errors is a simple string
  if (typeof salesforceErrors === 'string') {
    return [{ value: salesforceErrors }];
  }

  // If errors is a single object
  if (typeof salesforceErrors === 'object') {
    return [salesforceErrors];
  }

  return [];
}

/**
 * Transform Salesforce warnings format to Legacy array format
 * Same logic as errors transformation
 */
function transformWarningsToLegacyFormat(salesforceWarnings) {
  // Use same transformation logic as errors
  return transformErrorsToLegacyFormat(salesforceWarnings);
}

/**
 * TenancyInformation endpoint handler
 * Credentials are extracted from URL path and authenticated before this is called
 */
async function handleTenancyInformation(dan, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`📊 Processing TenancyInformation request for DAN: ${dan}`);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/tenancyinformation/{dan}
    // API Key: Use /services/apexrest/tenancyinformation/{dan}
    let endpointPath = `/services/apexrest/tenancyinformation/${dan}`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/tenancyinformation/${dan}`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    const endpoint = `${salesforceUrl}${endpointPath}`;

    context.log(`📤 Querying tenancy info at Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.get(
      endpoint,
      {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce tenancy info response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    const legacyResponse = {
      success: salesforceResponse.data.success || "true",
      dan: salesforceResponse.data.dan || dan,
      status: salesforceResponse.data.status || ""
    };

    // Optional field - case_status (only present if there's an active case)
    if (salesforceResponse.data.case_status) {
      legacyResponse.case_status = salesforceResponse.data.case_status;
    }

    // Convert protected_amount from string to number for Legacy API compatibility
    if (salesforceResponse.data.protected_amount) {
      legacyResponse.protected_amount = parseFloat(salesforceResponse.data.protected_amount);
    }

    // CONDITIONAL FIELD: adjudication_decision_published
    // Only present when an adjudication report has been written
    if (salesforceResponse.data.adjudication_decision_published !== undefined) {
      legacyResponse.adjudication_decision_published = salesforceResponse.data.adjudication_decision_published;
    }

    // Transform errors array from Salesforce format to Legacy format
    if (salesforceResponse.data.errors) {
      legacyResponse.errors = transformErrorsToLegacyFormat(salesforceResponse.data.errors);
    }

    // Transform warnings array from Salesforce format to Legacy format
    if (salesforceResponse.data.warnings) {
      legacyResponse.warnings = transformWarningsToLegacyFormat(salesforceResponse.data.warnings);
    }

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'TenancyInformation',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ TenancyInformation completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ TenancyInformation failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          } else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          } else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        } else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        } else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
      }
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'TenancyInformation',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: "false",
        dan: dan,
        errors: [{
          "Invalid DAN": errorMessage
        }]
      },
      duration
    };
  }
}

/**
 * Landlords endpoint handler
 * Credentials are extracted from URL path and authenticated before this is called
 */
async function handleLandlords(queryParams, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`🔍 Processing Landlords search request with params:`, queryParams);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/nonmemberlandlord
    // API Key: Use /services/apexrest/nonmemberlandlord
    let endpointPath = `/services/apexrest/nonmemberlandlord`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/nonmemberlandlord`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    // Build query string from parameters
    const queryString = new URLSearchParams(queryParams).toString();
    const endpoint = `${salesforceUrl}${endpointPath}${queryString ? '?' + queryString : ''}`;

    context.log(`📤 Querying landlords at Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.get(
      endpoint,
      {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce landlords response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    const legacyResponse = {
      success: salesforceResponse.data.isSuccess === "true" || salesforceResponse.data.isSuccess === true
    };

    // Convert totalResults from string to number
    if (salesforceResponse.data.totalResults !== undefined) {
      legacyResponse.totalResults = parseInt(salesforceResponse.data.totalResults) || 0;
    }

    // Transform landlords array - convert string numbers to actual numbers and order fields
    if (salesforceResponse.data.landlords) {
      legacyResponse.landlords = salesforceResponse.data.landlords.map(landlord => ({
        // Order fields as per Legacy API specification
        nonmemberlandlordid: landlord.nonmemberlandlordid,
        organisationname: landlord.organisationname || "",
        tradingname: landlord.tradingname || "",
        companyregisteredname: landlord.companyregisteredname || "",
        companyregistrationnumber: landlord.companyregistrationnumber || "",
        telephone: landlord.telephone || "",
        alttelephone: landlord.alttelephone || "",
        fax: landlord.fax || "",
        addresslines: landlord.addresslines || "",
        addresscity: landlord.addresscity || "",
        addresscounty: landlord.addresscounty || "",
        addresspostcode: landlord.addresspostcode || "",
        addresscountry: landlord.addresscountry || "",
        branchname: landlord.branchname || "",
        branchid: landlord.branchid && !isNaN(landlord.branchid) ? parseInt(landlord.branchid) : landlord.branchid,
        archivestatus: landlord.archivestatus || "",
        email: landlord.email || "",
        correspondenceaddresslines: landlord.correspondenceaddresslines || landlord.addresslines || "",
        correspondenceaddresscity: landlord.correspondenceaddresscity || landlord.addresscity || "",
        correspondenceaddresscounty: landlord.correspondenceaddresscounty || landlord.addresscounty || "",
        correspondenceaddresspostcode: landlord.correspondenceaddresspostcode || landlord.addresspostcode || "",
        correspondenceaddresscountry: landlord.correspondenceaddresscountry || landlord.addresscountry || "",
        correspondencetelephone: landlord.correspondencetelephone || landlord.telephone || "",
        ca_is_diff_from_add: "No",
        live_deposits: parseInt(landlord.live_deposits) || 0,
        honorific: landlord.honorific || "",
        first_name: landlord.first_name || "",
        last_name: landlord.last_name || "",
        updated: landlord.updated || "",
        refreshed: landlord.refreshed || "",
        is_organisation: landlord.is_organisation || "",
        has_current_dpc: parseInt(landlord.has_current_dpc) || 0,
        nonmembertype: "Landlord"
      }));
    }

    // Transform errors array from Salesforce format to Legacy format
    if (salesforceResponse.data.errors) {
      legacyResponse.errors = transformErrorsToLegacyFormat(salesforceResponse.data.errors);
    }

    // Transform warnings array from Salesforce format to Legacy format
    if (salesforceResponse.data.warnings) {
      legacyResponse.warnings = transformWarningsToLegacyFormat(salesforceResponse.data.warnings);
    }

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'Landlords',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ Landlords search completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ Landlords search failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          } else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          } else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        } else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        } else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
      }
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'Landlords',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: false,
        errors: [{
          "search_error": errorMessage
        }]
      },
      duration
    };
  }
}

/**
 * Properties endpoint handler
 * Credentials are extracted from URL path and authenticated before this is called
 */
async function handleProperties(queryParams, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`🏠 Processing Properties search request with params:`, queryParams);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/property
    // API Key: Use /services/apexrest/property
    let endpointPath = `/services/apexrest/property`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/property`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    // Build query string from parameters
    const queryString = new URLSearchParams(queryParams).toString();
    const endpoint = `${salesforceUrl}${endpointPath}${queryString ? '?' + queryString : ''}`;

    context.log(`📤 Querying properties at Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.get(
      endpoint,
      {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce properties response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    const legacyResponse = {
      success: salesforceResponse.data.isSuccess === "true" || salesforceResponse.data.isSuccess === true
    };

    // Convert totalResults from string to number
    if (salesforceResponse.data.totalResults !== undefined) {
      legacyResponse.totalResults = parseInt(salesforceResponse.data.totalResults) || 0;
    }

    // Transform properties array - convert string numbers to actual numbers
    if (salesforceResponse.data.properties) {
      legacyResponse.properties = salesforceResponse.data.properties.map(property => ({
        ...property,
        // Convert string numbers to actual numbers for consistency
        // Note: propertyid can be alphanumeric (e.g., "PR-00426266"), keep as string
        // memberid can be alphanumeric (e.g., "A02099SC"), keep as string
        branchid: property.branchid && !isNaN(property.branchid) ? parseInt(property.branchid) : property.branchid,
        nonmemberid: property.nonmemberid && !isNaN(property.nonmemberid) ? parseInt(property.nonmemberid) : property.nonmemberid,
        live_deposits: parseInt(property.live_deposits) || 0,
        has_current_dpc: parseInt(property.has_current_dpc) || 0,
        numberofbedrooms: parseInt(property.numberofbedrooms) || 0,
        numberoflivingrooms: parseInt(property.numberoflivingrooms) || 0,
        lockversion: parseInt(property.lockversion) || 0
      }));
    }

    // Transform errors array from Salesforce format to Legacy format
    if (salesforceResponse.data.errors) {
      legacyResponse.errors = transformErrorsToLegacyFormat(salesforceResponse.data.errors);
    }

    // Transform warnings array from Salesforce format to Legacy format
    if (salesforceResponse.data.warnings) {
      legacyResponse.warnings = transformWarningsToLegacyFormat(salesforceResponse.data.warnings);
    }

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'Properties',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ Properties search completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ Properties search failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          } else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          } else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        } else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        } else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
      }
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'Properties',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: false,
        errors: [{
          "search_error": errorMessage
        }]
      },
      duration
    };
  }
}

/**
 * RaiseRepaymentRequest endpoint handler
 * Credentials are in POST body and authenticated before this is called
 */
async function handleRaiseRepaymentRequest(legacyPayload, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`💰 Processing RaiseRepaymentRequest for DAN: ${legacyPayload.dan}`);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/raiserepaymentrequest/
    // API Key: Use /services/apexrest/raiserepaymentrequest/
    let endpointPath = `/services/apexrest/raiserepaymentrequest/`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/raiserepaymentrequest/`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    const endpoint = `${salesforceUrl}${endpointPath}`;

    context.log(`📍 Salesforce URL: ${endpoint}`);

    // Transform Legacy payload to Salesforce format
    const salesforcePayload = {
      dan: legacyPayload.dan,
      tenancy_end_date: legacyPayload.tenancy_end_date,
      tenant_repayment: String(legacyPayload.tenant_repayment), // Convert to string
      agent_repayment: {
        total: String(legacyPayload.agent_repayment.total),
        cleaning: String(legacyPayload.agent_repayment.cleaning),
        rent_arrears: String(legacyPayload.agent_repayment.rent_arrears),
        damage: String(legacyPayload.agent_repayment.damage),
        redecoration: String(legacyPayload.agent_repayment.redecoration),
        gardening: String(legacyPayload.agent_repayment.gardening),
        other: String(legacyPayload.agent_repayment.other),
        other_text: legacyPayload.agent_repayment.other_text || ""
      }
    };

    // Convert date format from dd/mm/yyyy to dd-mm-yyyy if needed
    if (salesforcePayload.tenancy_end_date && salesforcePayload.tenancy_end_date.includes('/')) {
      salesforcePayload.tenancy_end_date = salesforcePayload.tenancy_end_date.replace(/\//g, '-');
    }

    context.log('📤 Submitting repayment request to Salesforce:', JSON.stringify(sanitizeForLogging(salesforcePayload), null, 2));

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.post(
      endpoint,
      salesforcePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce repayment request response:', JSON.stringify(salesforceResponse.data, null, 2));

    // Transform Salesforce response back to Legacy format
    const legacyResponse = {
      success: salesforceResponse.data.Success === "true" || salesforceResponse.data.Success === true ||
               salesforceResponse.data.success === "true" || salesforceResponse.data.success === true
    };

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'RaiseRepaymentRequest',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ RaiseRepaymentRequest completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ RaiseRepaymentRequest failed:', error.message);

    // Extract error message from Salesforce response
    let errorDetails = {};

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error details from Salesforce response
        if (salesforceError.errors) {
          errorDetails = salesforceError.errors;
        } else if (salesforceError.error) {
          errorDetails = { error: salesforceError.error };
        } else if (salesforceError.message) {
          errorDetails = { error: salesforceError.message };
        } else {
          errorDetails = { failure: error.message };
        }

        context.log(`📝 Extracted error details:`, errorDetails);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
        errorDetails = { failure: error.message };
      }
    } else {
      errorDetails = { failure: error.message };
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'RaiseRepaymentRequest',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: false,
        errors: errorDetails
      },
      duration
    };
  }
}

/**
 * DPC (Deposit Protection Certificate) endpoint handler
 * Credentials are extracted from URL path and authenticated before this is called
 */
async function handleDPC(dan, orgMapping, context) {
  const startTime = Date.now();

  try {
    context.log(`📜 Processing DPC request for DAN: ${dan}`);

    // Get Salesforce API URL
    const salesforceUrl = getSalesforceUrl(orgMapping.environment);

    // Construct endpoint based on auth method
    // OAuth2: Use /services/apexrest/auth/dpc/{dan}
    // API Key: Use /services/apexrest/dpc/{dan}
    let endpointPath = `/services/apexrest/dpc/${dan}`;
    if (orgMapping.salesforce.authMethod && orgMapping.salesforce.authMethod.toLowerCase() === 'oauth2') {
      endpointPath = `/services/apexrest/auth/dpc/${dan}`;
      context.log('🔐 OAuth2 mode: Using /auth/ endpoint prefix');
    }

    const endpoint = `${salesforceUrl}${endpointPath}`;

    context.log(`📤 Requesting DPC certificate at Salesforce: ${endpoint}`);

    // Get Salesforce authentication headers
    const authHeaders = await getSalesforceAuthHeader(context, orgMapping.salesforce);

    // Call Salesforce API
    const salesforceResponse = await axios.get(
      endpoint,
      {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: 30000 // 30 seconds
      }
    );

    const duration = Date.now() - startTime;

    context.log('📨 Salesforce DPC response (sanitized):', JSON.stringify(sanitizeForLogging(salesforceResponse.data), null, 2));

    // Transform Salesforce response back to Legacy format
    const legacyResponse = {
      success: salesforceResponse.data.success === "true" || salesforceResponse.data.success === true,
      dan: salesforceResponse.data.dan || dan,
      certificate: salesforceResponse.data.certificate || ""
    };

    // Transform errors array from Salesforce format to Legacy format
    if (salesforceResponse.data.errors) {
      legacyResponse.errors = transformErrorsToLegacyFormat(salesforceResponse.data.errors);
    }

    // Track telemetry
    telemetry.trackDependency('salesforce', endpoint, duration, true, {
      statusCode: salesforceResponse.status,
      organizationId: orgMapping.organizationId
    });

    telemetry.trackEvent('Legacy_API_Request', {
      endpoint: 'DPC',
      organization: orgMapping.organizationName,
      success: 'true',
      duration: duration.toString()
    });

    context.log(`✅ DPC request completed successfully in ${duration}ms`);

    return {
      statusCode: 200,
      body: legacyResponse,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    context.error('❌ DPC request failed:', error.message);

    // Extract error message from Salesforce response
    let errorMessage = error.message;

    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });

      // Parse Salesforce error response to get the actual error message
      try {
        let salesforceError = error.response.data;

        // If data is a string, try to parse it as JSON
        if (typeof salesforceError === 'string') {
          salesforceError = JSON.parse(salesforceError);
        }

        // Extract error message from various Salesforce error formats
        if (salesforceError.errors) {
          if (salesforceError.errors.failure) {
            if (Array.isArray(salesforceError.errors.failure)) {
              errorMessage = salesforceError.errors.failure[0];
            } else if (typeof salesforceError.errors.failure === 'string') {
              errorMessage = salesforceError.errors.failure;
            }
          } else if (Array.isArray(salesforceError.errors)) {
            errorMessage = salesforceError.errors[0];
          } else if (typeof salesforceError.errors === 'string') {
            errorMessage = salesforceError.errors;
          }
        } else if (salesforceError.error) {
          errorMessage = salesforceError.error;
        } else if (salesforceError.message) {
          errorMessage = salesforceError.message;
        }

        context.log(`📝 Extracted error message: ${errorMessage}`);
      } catch (parseError) {
        context.warn('⚠️ Failed to parse Salesforce error response:', parseError.message);
      }
    }

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'DPC',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: false,
        dan: dan,
        errors: [{
          "not_found": errorMessage
        }]
      },
      duration
    };
  }
}

/**
 * Azure Function HTTP Handler
 *
 * Routes:
 * - POST /api/legacy/CreateDeposit
 * - POST /api/legacy/RaiseRepaymentRequest
 * - GET /api/legacy/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId}
 * - GET /api/legacy/TenancyInformation/{memberId}/{branchId}/{apiKey}/{dan}
 * - GET /api/legacy/DPC/{memberId}/{branchId}/{apiKey}/{dan}
 * - GET /api/legacy/Landlords/{memberId}/{branchId}/{apiKey}?queryParams
 * - GET /api/legacy/Properties/{memberId}/{branchId}/{apiKey}?queryParams
 * - GET /api/legacy/health
 */
app.http('LegacyAPIGateway', {
  methods: ['POST', 'GET'],
  authLevel: 'anonymous', // External partners call this
  route: 'legacy/{endpoint?}/{param1?}/{param2?}/{param3?}/{param4?}',
  handler: async (request, context) => {
    const requestStartTime = Date.now();

    try {
      const endpoint = request.params.endpoint || 'health';

      // Parse parameters based on endpoint
      // CreateDepositStatus: /api/legacy/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId}
      // TenancyInformation: /api/legacy/TenancyInformation/{memberId}/{branchId}/{apiKey}/{dan}
      // DPC: /api/legacy/DPC/{memberId}/{branchId}/{apiKey}/{dan}
      // Landlords: /api/legacy/Landlords/{memberId}/{branchId}/{apiKey}?queryParams
      // Properties: /api/legacy/Properties/{memberId}/{branchId}/{apiKey}?queryParams
      let memberId, branchId, apiKey, batchId, dan;

      if (endpoint === 'CreateDepositStatus') {
        memberId = request.params.param1;
        branchId = request.params.param2;
        apiKey = request.params.param3;
        batchId = request.params.param4;
        context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}, BatchId: ${batchId}`);
      } else if (endpoint === 'TenancyInformation' || endpoint === 'DPC') {
        memberId = request.params.param1;
        branchId = request.params.param2;
        apiKey = request.params.param3;
        dan = request.params.param4;
        context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}, DAN: ${dan}`);
      } else if (endpoint === 'Landlords' || endpoint === 'Properties') {
        memberId = request.params.param1;
        branchId = request.params.param2;
        apiKey = request.params.param3;
        context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}, Query: ${request.url}`);
      } else if (endpoint === 'audit') {
        const auditRequestId = request.params.param1;
        context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}, RequestId: ${auditRequestId || 'none'}`);
      } else {
        context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}`);
      }

      // Health check endpoint
      if (endpoint === 'health') {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          jsonBody: {
            status: 'healthy',
            service: 'Legacy API Gateway',
            timestamp: new Date().toISOString(),
            endpoints: [
              'POST /api/legacy/CreateDeposit',
              'POST /api/legacy/RaiseRepaymentRequest',
              'GET /api/legacy/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId}',
              'GET /api/legacy/TenancyInformation/{memberId}/{branchId}/{apiKey}/{dan}',
              'GET /api/legacy/DPC/{memberId}/{branchId}/{apiKey}/{dan}',
              'GET /api/legacy/Landlords/{memberId}/{branchId}/{apiKey}?queryParams',
              'GET /api/legacy/Properties/{memberId}/{branchId}/{apiKey}?queryParams',
              'GET /api/legacy/activity',
              'GET /api/legacy/audit/{requestId}'
            ]
          }
        };
      }

      // Activity endpoint for dashboard monitoring
      if (endpoint === 'activity') {
        try {
          const { queryAuditLogs } = require('../../shared-services/shared/audit-logging');

          // Get recent audit logs for all organizations (for monitoring)
          // In production, this should be restricted to admin users
          const allLogs = [];

          // Get list of organizations with Legacy credentials directly from service
          const orgMappingService = new OrganizationMappingService(context);
          const allMappings = await orgMappingService.getAllMappings();
          const orgs = allMappings.filter(org => org.legacyMemberId && org.isActive);

          context.log(`Fetching activity for ${orgs.length} organizations with Legacy credentials`);

          if (orgs.length > 0) {
            // Track which requests we've already added (by requestId) to prevent duplicates
            const seenRequests = new Set();

            // Fetch recent audit logs for each organization using Legacy credentials as organizationId
            for (const org of orgs) {
              try {
                // Use Legacy credentials (member_id:branch_id) as organizationId, not agencyRef
                const legacyOrgId = `${org.legacyMemberId}:${org.legacyBranchId}`;
                const result = await queryAuditLogs({ organizationId: legacyOrgId, limit: 20 }, context);

                if (result.success) {
                  context.log(`Found ${result.logs.length} audit logs for org: ${org.organizationName} (${legacyOrgId})`);

                  result.logs.forEach(log => {
                    // Skip if we've already added this request (prevents duplicates)
                    if (seenRequests.has(log.requestId)) {
                      context.log(`Skipping duplicate request: ${log.requestId}`);
                      return;
                    }

                    seenRequests.add(log.requestId);

                    // Add to all logs with organization name
                    allLogs.push({
                      requestId: log.requestId,
                      batchId: log.batchId || null,  // For CreateDeposit requests
                      endpoint: log.endpoint,
                      organizationId: log.organizationId,
                      organizationName: org.organizationName,
                      createdAt: log.timestamp,
                      currentStatus: log.success ? 'submitted' : 'failed',
                      danNumber: log.danNumber || null,
                      requestDurationMs: log.responseTime || 0,
                      success: log.success,
                      errorMessage: log.errorMessage || null
                    });
                  });
                }
              } catch (err) {
                context.warn(`Failed to get audit logs for ${org.organizationName}:`, err.message);
              }
            }
          }

          // Sort by timestamp (most recent first)
          allLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

          // Calculate stats
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const recentLogs = allLogs.filter(log => new Date(log.createdAt) > oneHourAgo);
          const successfulLogs = recentLogs.filter(log => log.success);
          const successRate = recentLogs.length > 0 ? (successfulLogs.length / recentLogs.length * 100).toFixed(0) : 100;
          const avgDuration = recentLogs.length > 0
            ? Math.round(recentLogs.reduce((sum, log) => sum + (log.requestDurationMs || 0), 0) / recentLogs.length)
            : 0;

          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: true,
              batches: allLogs.slice(0, 50), // Return last 50 requests (keeping 'batches' key for compatibility)
              stats: {
                requestsLastHour: recentLogs.length,
                successRate: `${successRate}%`,
                avgResponseTime: avgDuration > 0 ? `${avgDuration}ms` : '--',
                activeOrgs: new Set(allLogs.map(log => log.organizationId)).size
              }
            }
          };
        } catch (error) {
          context.error('Failed to fetch activity:', error);
          return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: false,
              error: error.message
            }
          };
        }
      }

      // Parse request body for POST requests (CreateDeposit, RaiseRepaymentRequest)
      let legacyPayload = null;
      if (request.method === 'POST' && (endpoint === 'CreateDeposit' || endpoint === 'RaiseRepaymentRequest')) {
        const bodyText = await request.text();

        try {
          legacyPayload = JSON.parse(bodyText);
        } catch (parseError) {
          context.error('Failed to parse request body as JSON:', parseError);
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              error: 'Invalid JSON in request body',
              success: "false"  // String "false" for Legacy API compatibility
            }
          };
        }
      }

      // Audit log endpoint - query audit logs with filtering
      // Route: GET /api/legacy/audit?organizationId=xxx&endpoint=yyy
      if (endpoint === 'audit' && !request.params.param1) {
        try {
          const { queryAuditLogs, getAuditStats } = require('../../shared-services/shared/audit-logging');

          // Parse query parameters
          const url = new URL(request.url);
          const filters = {
            organizationId: url.searchParams.get('organizationId') || null,
            endpoint: url.searchParams.get('endpoint') || null,
            method: url.searchParams.get('method') || null,
            status: url.searchParams.get('status') || null,
            startDate: url.searchParams.get('startDate') || null,
            endDate: url.searchParams.get('endDate') || null,
            limit: parseInt(url.searchParams.get('limit')) || 50,
            continuationToken: url.searchParams.get('continuationToken') || null
          };

          context.log(`Querying audit logs with filters:`, filters);

          // Query logs and stats in parallel
          const [logsResult, statsResult] = await Promise.all([
            queryAuditLogs(filters, context),
            getAuditStats(context)
          ]);

          if (!logsResult.success) {
            return {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                success: false,
                error: logsResult.error
              }
            };
          }

          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: true,
              logs: logsResult.logs,
              continuationToken: logsResult.continuationToken,
              hasMore: logsResult.hasMore,
              stats: statsResult.stats
            }
          };

        } catch (error) {
          context.error('Failed to query audit logs:', error);
          return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: false,
              error: error.message
            }
          };
        }
      }

      // Audit log details endpoint - get single audit entry by requestId
      // Route: GET /api/legacy/audit/{requestId}
      if (endpoint === 'audit') {
        const requestId = request.params.param1;

        if (!requestId) {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: false,
              error: 'Request ID is required. Usage: GET /api/legacy/audit/{requestId}'
            }
          };
        }

        try {
          const { getAuditLogDetails } = require('../../shared-services/shared/audit-logging');

          context.log(`Fetching audit log details for requestId: ${requestId}`);

          const result = await getAuditLogDetails(requestId, context);

          if (!result.success) {
            return {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                success: false,
                error: result.error
              }
            };
          }

          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: result
          };

        } catch (error) {
          context.error('Failed to fetch audit log details:', error);
          return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: false,
              error: error.message
            }
          };
        }
      }

      // Authenticate request (extract org mapping from Legacy credentials)
      let orgMapping;
      try {
        // For CreateDepositStatus, TenancyInformation, DPC, Landlords, and Properties, credentials are in URL path
        if (endpoint === 'CreateDepositStatus' || endpoint === 'TenancyInformation' || endpoint === 'DPC' || endpoint === 'Landlords' || endpoint === 'Properties') {
          const urlCredentials = {
            member_id: memberId,
            branch_id: branchId,
            api_key: apiKey
          };
          orgMapping = await authenticateLegacyRequest(urlCredentials, context);
        }
        // For CreateDeposit and RaiseRepaymentRequest, credentials are in POST body
        else if (legacyPayload) {
          orgMapping = await authenticateLegacyRequest(legacyPayload, context);
        }
        // For other endpoints (health, activity), skip authentication
        else {
          orgMapping = null;
        }
      } catch (authError) {
        context.error('Authentication failed:', authError.message);
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          jsonBody: {
            error: authError.message,
            success: "false"  // String "false" for Legacy API compatibility
          }
        };
      }

      // Route to appropriate handler
      let result;

      switch (endpoint) {
        case 'CreateDeposit':
          if (request.method !== 'POST') {
            return {
              status: 405,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: { error: 'POST method required for CreateDeposit' }
            };
          }
          result = await handleCreateDeposit(legacyPayload, orgMapping, context);
          break;

        case 'RaiseRepaymentRequest':
          if (request.method !== 'POST') {
            return {
              status: 405,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: { error: 'POST method required for RaiseRepaymentRequest' }
            };
          }
          result = await handleRaiseRepaymentRequest(legacyPayload, orgMapping, context);
          break;

        case 'CreateDepositStatus':
          if (!batchId) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'batch_id required in URL path',
                success: "false"
              }
            };
          }
          if (!memberId || !branchId || !apiKey) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'Missing required credentials in URL path (memberId, branchId, apiKey)',
                success: "false"
              }
            };
          }
          result = await handleCreateDepositStatus(batchId, orgMapping, context);
          break;

        case 'TenancyInformation':
          if (!dan) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'DAN required in URL path',
                success: "false"
              }
            };
          }
          if (!memberId || !branchId || !apiKey) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'Missing required credentials in URL path (memberId, branchId, apiKey)',
                success: "false"
              }
            };
          }
          result = await handleTenancyInformation(dan, orgMapping, context);
          break;

        case 'DPC':
          if (!dan) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'DAN required in URL path',
                success: "false"
              }
            };
          }
          if (!memberId || !branchId || !apiKey) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'Missing required credentials in URL path (memberId, branchId, apiKey)',
                success: "false"
              }
            };
          }
          result = await handleDPC(dan, orgMapping, context);
          break;

        case 'Landlords':
          if (!memberId || !branchId || !apiKey) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'Missing required credentials in URL path (memberId, branchId, apiKey)',
                success: "false"
              }
            };
          }
          // Extract query parameters from request
          const queryParams = {};
          const url = new URL(request.url);
          url.searchParams.forEach((value, key) => {
            queryParams[key] = value;
          });
          result = await handleLandlords(queryParams, orgMapping, context);
          break;

        case 'Properties':
          if (!memberId || !branchId || !apiKey) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: {
                error: 'Missing required credentials in URL path (memberId, branchId, apiKey)',
                success: "false"
              }
            };
          }
          // Extract query parameters from request
          const propertyQueryParams = {};
          const propertyUrl = new URL(request.url);
          propertyUrl.searchParams.forEach((value, key) => {
            propertyQueryParams[key] = value;
          });
          result = await handleProperties(propertyQueryParams, orgMapping, context);
          break;

        default:
          return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              error: 'Unknown endpoint',
              availableEndpoints: ['CreateDeposit', 'RaiseRepaymentRequest', 'CreateDepositStatus', 'TenancyInformation', 'DPC', 'Landlords', 'Properties', 'health']
            }
          };
      }

      const totalDuration = Date.now() - requestStartTime;

      context.log(`✅ Request completed in ${totalDuration}ms`);

      // Log audit entry for all endpoints
      try {
        const { logAuditEntry } = require('../../shared-services/shared/audit-logging');

        // Determine request method
        const method = request.method;

        // Build request parameters based on endpoint type
        let requestParams = null;
        let requestBodyForAudit = null;

        if (method === 'POST') {
          requestBodyForAudit = legacyPayload;
        } else {
          // For GET requests, capture URL parameters
          requestParams = {
            memberId,
            branchId,
            apiKey: '***',  // Sanitized
            dan,
            batchId
          };

          // Add query parameters for search endpoints
          if (endpoint === 'Landlords' || endpoint === 'Properties') {
            const url = new URL(request.url);
            url.searchParams.forEach((value, key) => {
              if (key !== 'apiKey') {  // Don't log API key
                requestParams[key] = value;
              }
            });
          }
        }

        // Determine success (check for various success indicators)
        // For CreateDeposit/RaiseRepaymentRequest: success = batch_id present
        // For other endpoints: success = success field true OR no error
        let isSuccess = false;
        if (endpoint === 'CreateDeposit' || endpoint === 'RaiseRepaymentRequest') {
          // CreateDeposit/RaiseRepaymentRequest is successful if batch_id is returned
          isSuccess = result.statusCode === 200 && result.body.batch_id;
        } else {
          // Other endpoints use standard success indicators
          isSuccess = result.statusCode === 200 &&
                     (result.body.success === true ||
                      result.body.success === "true" ||
                      !result.body.error);
        }

        await logAuditEntry({
          organizationId: `${orgMapping.legacyMemberId}:${orgMapping.legacyBranchId}`,
          organizationName: orgMapping.organizationName,
          endpoint: endpoint,
          method: method,
          requestUrl: request.url,
          requestHeaders: {
            'content-type': request.headers['content-type'],
            'user-agent': request.headers['user-agent']
          },
          requestBody: requestBodyForAudit,
          requestParams: requestParams,
          responseStatus: result.statusCode,
          responseTime: totalDuration,
          responseBody: result.body,
          success: isSuccess,
          errorMessage: result.body.error || null,
          legacyMemberId: orgMapping.legacyMemberId,
          legacyBranchId: orgMapping.legacyBranchId,
          batchId: result.body.batch_id || null,
          danNumber: result.body.dan || null
        }, context);
      } catch (auditError) {
        // Don't let audit logging failures break the response
        context.warn('Failed to log audit entry:', auditError.message);
      }

      // Return response
      return {
        status: result.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'X-TDS-Provider': 'salesforce',
          'X-Response-Time': `${totalDuration}ms`,
          'X-Gateway': 'Legacy-API-Gateway'
        },
        jsonBody: result.body
      };

    } catch (error) {
      const totalDuration = Date.now() - requestStartTime;

      context.error('Legacy API Gateway error:', error.message);
      context.error('Error stack:', error.stack);

      // Track exception
      telemetry.trackException(error, {
        handler: 'LegacyAPIGateway',
        endpoint: request.params.endpoint || 'unknown',
        duration: totalDuration.toString()
      });

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          error: error.message || 'Internal server error',
          success: "false"  // String "false" for Legacy API compatibility
        }
      };
    }
  }
});

module.exports = {
  authenticateLegacyRequest,
  handleCreateDeposit,
  handleRaiseRepaymentRequest,
  handleCreateDepositStatus,
  handleTenancyInformation,
  handleDPC,
  handleLandlords,
  handleProperties
};
