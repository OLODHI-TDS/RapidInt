const { app } = require('@azure/functions');

// Clear transformer module cache to force reload (fixes Node.js caching issue)
const transformerPath = require.resolve('../../shared-services/TDSRequestForwarder/transformers/legacy-to-salesforce');
delete require.cache[transformerPath];

const { transformLegacyToSalesforce } = require('../../shared-services/TDSRequestForwarder/transformers/legacy-to-salesforce');
const { transformSalesforceToLegacy } = require('../../shared-services/TDSRequestForwarder/transformers/salesforce-to-legacy');
const { getSalesforceAuthHeader } = require('../../shared-services/shared/salesforce-auth');
const { sanitizeForLogging } = require('../../shared-services/shared/sanitized-logger');
const { storeBatchTracking } = require('../../shared-services/shared/batch-tracking');
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
 * - POST /v1.2/CreateDepositStatus/{memberId}/{branchId}/{apiKey}/{batchId} → /api/legacy/CreateDepositStatus/{batchId}
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

    // Query OrganizationMapping to find org with matching Legacy credentials
    const orgMappingResponse = await axios.get(
      `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/organization/list`
    );

    if (!orgMappingResponse.data.success) {
      throw new Error('Failed to retrieve organization mappings');
    }

    // Find organization with matching Legacy credentials
    const matchingOrg = orgMappingResponse.data.mappings.find(mapping => {
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

    context.log(`✅ Authentication successful: ${matchingOrg.organizationName} (${matchingOrg.agencyRef})`);

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

    // Log detailed Salesforce error response
    if (error.response) {
      context.error('Salesforce error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: JSON.stringify(error.response.data, null, 2)
      });
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
      error: error.message
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        success: false,
        error: error.message,
        details: error.response?.data || null
      },
      duration
    };
  }
}

/**
 * CreateDepositStatus endpoint handler
 */
async function handleCreateDepositStatus(batchId, legacyPayload, orgMapping, context) {
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

    // Track telemetry for failure
    telemetry.trackException(error, {
      endpoint: 'CreateDepositStatus',
      organization: orgMapping.organizationName,
      duration: duration.toString()
    });

    // Return Legacy-formatted error response
    return {
      statusCode: error.response?.status || 500,
      body: {
        batch_id: batchId,
        status: 'error',
        error: error.message,
        details: error.response?.data || null
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
 * - GET /api/legacy/CreateDepositStatus/{batchId}
 * - GET /api/legacy/health
 */
app.http('LegacyAPIGateway', {
  methods: ['POST', 'GET'],
  authLevel: 'anonymous', // External partners call this
  route: 'legacy/{endpoint?}/{batchId?}',
  handler: async (request, context) => {
    const requestStartTime = Date.now();

    try {
      const endpoint = request.params.endpoint || 'health';
      const batchId = request.params.batchId;

      context.log(`🌐 Legacy API Gateway - Endpoint: ${endpoint}, Method: ${request.method}`);

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
              'GET /api/legacy/CreateDepositStatus/{batchId}',
              'GET /api/legacy/activity'
            ]
          }
        };
      }

      // Activity endpoint for dashboard monitoring
      if (endpoint === 'activity') {
        try {
          const { getRecentBatches } = require('../../shared-services/shared/batch-tracking');

          // Get recent batches for all organizations (for monitoring)
          // In production, this should be restricted to admin users
          const allBatches = [];

          // Get list of organizations with Legacy credentials
          const orgMappingResponse = await axios.get(
            `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/organization/list`
          );

          if (orgMappingResponse.data.success) {
            const orgs = orgMappingResponse.data.mappings.filter(org => org.legacyMemberId && org.isActive);

            // Track which batches we've already added (by batchId) to prevent duplicates
            const seenBatches = new Set();

            // Fetch recent batches for each organization using Legacy credentials as organizationId
            for (const org of orgs) {
              try {
                // Use Legacy credentials (member_id:branch_id) as organizationId, not agencyRef
                const legacyOrgId = `${org.legacyMemberId}:${org.legacyBranchId}`;
                const batches = await getRecentBatches(legacyOrgId, { limit: 10 }, context);

                context.log(`Found ${batches.length} batches for org: ${org.organizationName} (${legacyOrgId})`);

                batches.forEach(batch => {
                  // Skip if we've already added this batch (prevents duplicates)
                  if (seenBatches.has(batch.batchId)) {
                    context.log(`Skipping duplicate batch: ${batch.batchId}`);
                    return;
                  }

                  seenBatches.add(batch.batchId);

                  // The batch's organizationId MUST match the legacyOrgId we just queried (partition key filtering)
                  // So we can safely use the current org's name
                  context.log(`Adding batch ${batch.batchId} for org ${org.organizationName} (batch orgId: ${batch.organizationId})`);

                  allBatches.push({
                    ...batch,
                    organizationName: org.organizationName // Use the org we queried for, since getRecentBatches filters by partition key
                  });
                });
              } catch (err) {
                context.warn(`Failed to get batches for ${org.organizationName}:`, err.message);
              }
            }
          }

          // Sort by creation date (most recent first)
          allBatches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

          // Calculate stats
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const recentBatches = allBatches.filter(b => new Date(b.createdAt) > oneHourAgo);
          const successfulBatches = recentBatches.filter(b => b.currentStatus === 'submitted' || b.danNumber);
          const successRate = recentBatches.length > 0 ? (successfulBatches.length / recentBatches.length * 100).toFixed(0) : 100;
          const avgDuration = recentBatches.length > 0
            ? Math.round(recentBatches.reduce((sum, b) => sum + (b.requestDurationMs || 0), 0) / recentBatches.length)
            : 0;

          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: true,
              batches: allBatches.slice(0, 50), // Return last 50 batches
              stats: {
                requestsLastHour: recentBatches.length,
                successRate: `${successRate}%`,
                avgResponseTime: avgDuration > 0 ? `${avgDuration}ms` : '--',
                activeOrgs: new Set(allBatches.map(b => b.organizationId)).size
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

      // Parse request body for POST requests
      let legacyPayload = null;
      if (request.method === 'POST') {
        const bodyText = await request.text();

        try {
          legacyPayload = JSON.parse(bodyText);
        } catch (parseError) {
          context.error('Failed to parse request body as JSON:', parseError);
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              success: false,
              error: 'Invalid JSON in request body',
              message: parseError.message,
              timestamp: new Date().toISOString()
            }
          };
        }
      }

      // Authenticate request (extract org mapping from Legacy credentials)
      let orgMapping;
      try {
        orgMapping = await authenticateLegacyRequest(legacyPayload || {}, context);
      } catch (authError) {
        context.error('Authentication failed:', authError.message);
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          jsonBody: {
            success: false,
            error: 'Authentication failed',
            message: authError.message,
            timestamp: new Date().toISOString()
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

        case 'CreateDepositStatus':
          if (!batchId) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              jsonBody: { error: 'batch_id required in URL path' }
            };
          }
          result = await handleCreateDepositStatus(batchId, legacyPayload, orgMapping, context);
          break;

        default:
          return {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            jsonBody: {
              error: 'Unknown endpoint',
              availableEndpoints: ['CreateDeposit', 'CreateDepositStatus', 'health']
            }
          };
      }

      const totalDuration = Date.now() - requestStartTime;

      context.log(`✅ Request completed in ${totalDuration}ms`);

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
          success: false,
          error: 'Internal server error',
          message: error.message,
          duration: totalDuration,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
});

module.exports = {
  authenticateLegacyRequest,
  handleCreateDeposit,
  handleCreateDepositStatus
};
