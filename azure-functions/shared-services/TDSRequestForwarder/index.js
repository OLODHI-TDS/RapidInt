/**
 * Azure Function: TDS Request Forwarder
 *
 * Intercepts requests destined for the legacy TDS API and intelligently routes them
 * to either the legacy API, new Salesforce API, or both based on configuration.
 *
 * Key Features:
 * - Automatic request transformation between legacy and Salesforce formats
 * - Traffic splitting for gradual migration (0-100% rollout)
 * - Dual-execution mode for validation and comparison
 * - Automatic fallback to legacy API on Salesforce errors
 * - Comprehensive logging and metrics for migration tracking
 * - Zero-downtime API switching via configuration
 *
 * Routing Modes:
 * - "legacy-only": All requests to legacy API (default/safe mode)
 * - "salesforce-only": All requests to Salesforce API
 * - "both": Dual execution - send to both, compare results
 * - "forwarding": Percentage-based routing for gradual rollout
 * - "shadow": Send to Salesforce but return legacy response (testing)
 *
 * Environment Variables:
 * - TDS_ROUTING_MODE: Routing strategy (default: "legacy-only")
 * - TDS_FORWARDING_PERCENTAGE: 0-100, traffic to route to Salesforce
 * - TDS_ENABLE_FALLBACK: Boolean, fallback to legacy on Salesforce errors
 * - TDS_ENABLE_RESPONSE_COMPARISON: Boolean, log response differences
 */

const { app } = require('@azure/functions');
const axios = require('axios');
const { transformLegacyToSalesforce } = require('./transformers/legacy-to-salesforce');
const { transformSalesforceToLegacy } = require('./transformers/salesforce-to-legacy');
const { getSalesforceAuthHeader, healthCheck: authHealthCheck } = require('../shared/salesforce-auth');
const { getOrganizationCredentials, getTestCredentials } = require('../shared/organization-credentials');
const {
  TransientError,
  PermanentError,
  ProviderError,
  TransformationError,
  classifyError
} = require('../shared/errors');
const { manager: circuitBreakerManager } = require('../shared/circuit-breaker');
const {
  storeBatchTracking,
  getBatchProvider,
  updateBatchStatus,
  getBatchDetails,
  getBatchStatusCached
} = require('../shared/batch-tracking');
const telemetry = require('../shared/telemetry');
const { checkRateLimit } = require('../shared/rate-limiter');

// Configuration
const CONFIG = {
  routingMode: process.env.TDS_ROUTING_MODE || 'legacy-only',
  forwardingPercentage: parseInt(process.env.TDS_FORWARDING_PERCENTAGE || '0', 10),
  enableFallback: process.env.TDS_ENABLE_FALLBACK === 'true',
  enableComparison: process.env.TDS_ENABLE_RESPONSE_COMPARISON === 'true',

  legacyApi: {
    baseUrl: process.env.TDS_CURRENT_BASE_URL || 'https://sandbox.api.custodial.tenancydepositscheme.com/v1.2',
    timeout: 30000,
    name: 'Legacy TDS API'
  },

  salesforceApi: {
    baseUrl: process.env.TDS_SALESFORCE_BASE_URL || 'https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com',
    timeout: 45000,
    name: 'Salesforce EWC TDS API'
  },

  // Retry configuration
  retry: {
    maxAttempts: parseInt(process.env.TDS_MAX_RETRY_ATTEMPTS || '3', 10),
    initialDelay: parseInt(process.env.TDS_RETRY_INITIAL_DELAY || '1000', 10), // 1 second
    maxDelay: parseInt(process.env.TDS_RETRY_MAX_DELAY || '8000', 10), // 8 seconds
    backoffMultiplier: parseFloat(process.env.TDS_RETRY_BACKOFF_MULTIPLIER || '2'), // Exponential backoff
    jitterFactor: parseFloat(process.env.TDS_RETRY_JITTER_FACTOR || '0.1') // 10% jitter
  }
};

/**
 * Calculate retry delay with exponential backoff and jitter
 *
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} - Delay in milliseconds
 */
function calculateRetryDelay(attempt) {
  const { initialDelay, maxDelay, backoffMultiplier, jitterFactor } = CONFIG.retry;

  // Exponential backoff: delay = initialDelay * (backoffMultiplier ^ attempt)
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelay);

  // Add jitter: randomize ±jitterFactor of the delay
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
  delay = delay + jitter;

  return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute function with retry logic and exponential backoff
 * SECURITY FIX (HIGH-002): Organization-scoped circuit breakers
 *
 * @param {Function} fn - Async function to execute
 * @param {string} provider - Provider name ('legacy' or 'salesforce')
 * @param {object} context - Azure Function context for logging
 * @param {string} organizationId - Organization identifier for circuit breaker isolation (optional)
 * @returns {Promise} - Result of the function
 */
async function executeWithRetry(fn, provider, context, organizationId = null) {
  const { maxAttempts } = CONFIG.retry;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Execute through organization-scoped circuit breaker
      const result = await circuitBreakerManager.execute(provider, organizationId, fn);

      if (attempt > 0) {
        context.log(`[${provider}${organizationId ? ':' + organizationId : ''}] Request succeeded on attempt ${attempt + 1}/${maxAttempts}`);
      }

      return result;

    } catch (error) {
      // Classify the error
      const classifiedError = classifyError(error, provider, {
        attempt: attempt + 1,
        maxAttempts
      });

      lastError = classifiedError;

      // Log error with context
      context.warn(`[${provider}] Request failed on attempt ${attempt + 1}/${maxAttempts}`, {
        error: classifiedError.toJSON(),
        isRetryable: classifiedError.isRetryable
      });

      // Don't retry if error is not retryable
      if (!classifiedError.isRetryable) {
        context.warn(`[${provider}] Error is not retryable, failing immediately`, {
          errorType: classifiedError.name
        });
        throw classifiedError;
      }

      // Don't retry if circuit breaker is open
      if (error.circuitBreakerOpen) {
        context.warn(`[${provider}] Circuit breaker is open, failing immediately`);
        throw classifiedError;
      }

      // Don't retry on last attempt
      if (attempt === maxAttempts - 1) {
        context.error(`[${provider}] Max retry attempts (${maxAttempts}) exceeded`);
        throw classifiedError;
      }

      // Calculate retry delay
      const retryDelay = classifiedError.retryAfter
        ? classifiedError.retryAfter * 1000 // Use Retry-After header if available
        : calculateRetryDelay(attempt);

      context.log(`[${provider}] Retrying in ${retryDelay}ms (attempt ${attempt + 2}/${maxAttempts})`);

      // Wait before retry
      await sleep(retryDelay);
    }
  }

  // This should never be reached, but just in case
  throw lastError;
}

/**
 * Determine which API to route request to based on configuration
 */
function determineRouting(context) {
  const mode = CONFIG.routingMode;

  switch (mode) {
    case 'legacy-only':
      return { target: 'legacy', execute: ['legacy'] };

    case 'salesforce-only':
      return { target: 'salesforce', execute: ['salesforce'] };

    case 'both':
      return { target: 'both', execute: ['legacy', 'salesforce'] };

    case 'shadow':
      // Execute Salesforce in background but return legacy response
      return { target: 'legacy', execute: ['legacy', 'salesforce'], returnFrom: 'legacy' };

    case 'forwarding':
      // Percentage-based routing
      const random = Math.random() * 100;
      const useSalesforce = random < CONFIG.forwardingPercentage;

      context.log(`Forwarding decision: ${random.toFixed(2)}% < ${CONFIG.forwardingPercentage}% = ${useSalesforce ? 'Salesforce' : 'Legacy'}`);

      return {
        target: useSalesforce ? 'salesforce' : 'legacy',
        execute: [useSalesforce ? 'salesforce' : 'legacy']
      };

    default:
      context.warn(`Unknown routing mode: ${mode}, defaulting to legacy-only`);
      return { target: 'legacy', execute: ['legacy'] };
  }
}

/**
 * Execute request against legacy TDS API
 * SECURITY FIX (HIGH-002): Pass organizationId for circuit breaker isolation
 */
async function executeLegacyRequest(endpoint, payload, context, organizationId = null) {
  const startTime = Date.now();

  const makeRequest = async () => {
    const url = `${CONFIG.legacyApi.baseUrl}${endpoint}`;

    context.log(`Executing legacy API request: ${url}${organizationId ? ' [Org: ' + organizationId + ']' : ''}`);

    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: CONFIG.legacyApi.timeout
    });

    const duration = Date.now() - startTime;

    return {
      success: true,
      provider: 'legacy',
      status: response.status,
      data: response.data,
      duration,
      timestamp: new Date().toISOString()
    };
  };

  try {
    // Execute with retry logic and organization-scoped circuit breaker
    const result = await executeWithRetry(makeRequest, 'legacy', context, organizationId);

    // Track successful dependency
    telemetry.trackDependency('legacy', endpoint, result.duration, true, {
      statusCode: result.status
    });

    telemetry.trackProviderRequest('legacy', true);

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;

    // Track failed dependency
    telemetry.trackDependency('legacy', endpoint, duration, false, {
      statusCode: error.statusCode || error.response?.status || 500,
      errorType: error.name
    });

    telemetry.trackProviderRequest('legacy', false);
    telemetry.trackProviderError('legacy', error.name);
    telemetry.trackException(error, {
      provider: 'legacy',
      endpoint
    });

    // Return error result in expected format
    return {
      success: false,
      provider: 'legacy',
      error: error.message,
      errorType: error.name,
      status: error.statusCode || error.response?.status || 500,
      data: error.response?.data || null,
      duration,
      timestamp: new Date().toISOString(),
      isRetryable: error.isRetryable,
      severity: error.severity
    };
  }
}

/**
 * Execute request against Salesforce TDS API
 * SECURITY FIX (HIGH-002): Pass organizationId for circuit breaker isolation
 */
async function executeSalesforceRequest(endpoint, legacyPayload, context, orgCredentials = null, organizationId = null) {
  const startTime = Date.now();

  const makeRequest = async () => {
    // Transform legacy format to Salesforce format
    let transformedPayload;
    try {
      transformedPayload = transformLegacyToSalesforce(legacyPayload, context);
    } catch (transformError) {
      throw new TransformationError('Failed to transform legacy payload to Salesforce format', {
        cause: transformError,
        transformationType: 'legacy-to-salesforce',
        sourceData: legacyPayload
      });
    }

    // Map endpoint to Salesforce equivalent
    const salesforceEndpoint = mapEndpointToSalesforce(endpoint);
    const url = `${CONFIG.salesforceApi.baseUrl}${salesforceEndpoint}`;

    context.log(`Executing Salesforce API request: ${url}${organizationId ? ' [Org: ' + organizationId + ']' : ''}`);

    // Get Salesforce authentication headers with organization-specific credentials
    const authHeaders = await getSalesforceAuthHeader(context, orgCredentials);

    const response = await axios.post(url, transformedPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders
      },
      timeout: CONFIG.salesforceApi.timeout
    });

    const duration = Date.now() - startTime;

    // Transform Salesforce response back to legacy format
    let legacyFormatResponse;
    try {
      legacyFormatResponse = transformSalesforceToLegacy(response.data, context);
    } catch (transformError) {
      throw new TransformationError('Failed to transform Salesforce response to legacy format', {
        cause: transformError,
        transformationType: 'salesforce-to-legacy',
        sourceData: response.data
      });
    }

    return {
      success: true,
      provider: 'salesforce',
      status: response.status,
      data: legacyFormatResponse,
      originalData: response.data,
      duration,
      timestamp: new Date().toISOString()
    };
  };

  try {
    // Execute with retry logic and organization-scoped circuit breaker
    const result = await executeWithRetry(makeRequest, 'salesforce', context, organizationId);

    // Track successful dependency
    telemetry.trackDependency('salesforce', endpoint, result.duration, true, {
      statusCode: result.status
    });

    telemetry.trackProviderRequest('salesforce', true);

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;

    // Track failed dependency
    telemetry.trackDependency('salesforce', endpoint, duration, false, {
      statusCode: error.statusCode || error.response?.status || 500,
      errorType: error.name
    });

    telemetry.trackProviderRequest('salesforce', false);
    telemetry.trackProviderError('salesforce', error.name);
    telemetry.trackException(error, {
      provider: 'salesforce',
      endpoint
    });

    // Return error result in expected format
    return {
      success: false,
      provider: 'salesforce',
      error: error.message,
      errorType: error.name,
      status: error.statusCode || error.response?.status || 500,
      data: error.response?.data || null,
      duration,
      timestamp: new Date().toISOString(),
      isRetryable: error.isRetryable,
      severity: error.severity
    };
  }
}

/**
 * Map legacy endpoint to Salesforce EWC equivalent
 */
function mapEndpointToSalesforce(legacyEndpoint) {
  const mapping = {
    '/CreateDeposit': '/services/apexrest/depositcreation',
    '/CreateDepositStatus': '/services/apexrest/CreateDepositStatus',
    '/health': '/services/apexrest/branches'
  };

  return mapping[legacyEndpoint] || legacyEndpoint;
}

/**
 * Compare responses from legacy and Salesforce APIs
 */
function compareResponses(legacyResult, salesforceResult, context) {
  if (!CONFIG.enableComparison) {
    return null;
  }

  const comparison = {
    timestamp: new Date().toISOString(),
    bothSucceeded: legacyResult.success && salesforceResult.success,
    bothFailed: !legacyResult.success && !salesforceResult.success,
    divergent: legacyResult.success !== salesforceResult.success,

    statusMatch: legacyResult.status === salesforceResult.status,

    timeDifference: {
      legacy: legacyResult.duration,
      salesforce: salesforceResult.duration,
      delta: salesforceResult.duration - legacyResult.duration,
      percentageDifference: ((salesforceResult.duration - legacyResult.duration) / legacyResult.duration * 100).toFixed(2)
    },

    dataMatch: JSON.stringify(legacyResult.data) === JSON.stringify(salesforceResult.data)
  };

  // Track comparison results in telemetry
  telemetry.trackComparisonResult(comparison.statusMatch, comparison.dataMatch, {
    bothSucceeded: comparison.bothSucceeded.toString(),
    divergent: comparison.divergent.toString(),
    legacyDuration: legacyResult.duration.toString(),
    salesforceDuration: salesforceResult.duration.toString(),
    performanceDelta: comparison.timeDifference.delta.toString()
  });

  // Log significant differences
  if (comparison.divergent) {
    context.warn('API response divergence detected', {
      legacy: { success: legacyResult.success, status: legacyResult.status },
      salesforce: { success: salesforceResult.success, status: salesforceResult.status }
    });
  }

  if (!comparison.dataMatch && comparison.bothSucceeded) {
    context.warn('Response data mismatch between APIs', {
      legacyKeys: Object.keys(legacyResult.data || {}),
      salesforceKeys: Object.keys(salesforceResult.data || {})
    });
  }

  return comparison;
}

/**
 * Execute dual API calls and handle results
 * SECURITY FIX (HIGH-002): Pass organizationId for circuit breaker isolation
 */
async function executeDualMode(endpoint, payload, context, orgCredentials = null, organizationId = null) {
  context.log(`Executing dual-mode API calls (legacy + Salesforce)${organizationId ? ' [Org: ' + organizationId + ']' : ''}`);

  // Execute both in parallel with organization-scoped circuit breakers
  const [legacyResult, salesforceResult] = await Promise.all([
    executeLegacyRequest(endpoint, payload, context, organizationId),
    executeSalesforceRequest(endpoint, payload, context, orgCredentials, organizationId)
  ]);

  // Compare results
  const comparison = compareResponses(legacyResult, salesforceResult, context);

  // Track dual-mode execution
  telemetry.trackDualModeExecution(
    legacyResult.success,
    salesforceResult.success,
    comparison?.dataMatch || false,
    legacyResult.duration,
    salesforceResult.duration
  );

  return {
    mode: 'dual',
    legacy: legacyResult,
    salesforce: salesforceResult,
    comparison,

    // Return the successful one, prefer Salesforce if both succeed
    response: salesforceResult.success ? salesforceResult.data : legacyResult.data,
    provider: salesforceResult.success ? 'salesforce' : 'legacy'
  };
}

/**
 * Main request forwarder logic
 * SECURITY FIX (HIGH-002): Extract and pass organizationId for circuit breaker isolation
 */
async function forwardRequest(action, requestBody, context, orgCredentials = null) {
  const routing = determineRouting(context);

  // Determine endpoint based on action
  const endpoint = mapActionToEndpoint(action);

  // Extract organizationId from request metadata or credentials
  // Format: "agencyRef:branchId"
  let organizationId = null;
  if (requestBody.metadata?.altoAgencyRef && requestBody.metadata?.altoBranchId) {
    organizationId = `${requestBody.metadata.altoAgencyRef}:${requestBody.metadata.altoBranchId}`;
  } else if (orgCredentials?.organizationId) {
    organizationId = orgCredentials.organizationId;
  }

  context.log(`Routing configuration: ${JSON.stringify(routing)}`);
  context.log(`Endpoint: ${endpoint}${organizationId ? ', Organization: ' + organizationId : ''}`);

  // Handle dual execution mode
  if (routing.execute.length > 1) {
    return await executeDualMode(endpoint, requestBody, context, orgCredentials, organizationId);
  }

  // Single API execution
  const targetApi = routing.execute[0];
  let result;

  if (targetApi === 'legacy') {
    result = await executeLegacyRequest(endpoint, requestBody, context, organizationId);
  } else {
    result = await executeSalesforceRequest(endpoint, requestBody, context, orgCredentials, organizationId);
  }

  // Handle fallback if enabled
  if (!result.success && CONFIG.enableFallback && targetApi === 'salesforce') {
    context.warn('Salesforce API failed, falling back to legacy API');

    // Track fallback activation
    telemetry.trackFallback('salesforce', 'legacy', result.error || 'Salesforce API failure');

    result = await executeLegacyRequest(endpoint, requestBody, context, organizationId);
    result.fallback = true;
  }

  return {
    mode: 'single',
    target: targetApi,
    result,
    response: result.data,
    provider: result.provider
  };
}

/**
 * Map action to API endpoint
 */
function mapActionToEndpoint(action) {
  const mapping = {
    'create': '/CreateDeposit',
    'status': '/CreateDepositStatus',
    'health': '/health'
  };

  return mapping[action] || '/CreateDeposit';
}

/**
 * Azure Function HTTP Handler
 */
app.http('TDSRequestForwarder', {
  methods: ['POST', 'GET'],
  route: 'tds-forwarder/{action?}',
  authLevel: 'function',
  handler: async (request, context) => {
    const startTime = Date.now();

    try {
      const action = request.params.action || 'create';

      context.log(`TDS Request Forwarder - Action: ${action}, Mode: ${CONFIG.routingMode}`);

      // Handle health check
      if (action === 'health') {
        // Check Salesforce authentication health
        const authHealth = await authHealthCheck(context);

        // Get circuit breaker stats
        const circuitBreakerStats = circuitBreakerManager.getAllStats();

        // Determine overall status
        let overallStatus = 'healthy';
        if (authHealth.status === 'unhealthy') {
          overallStatus = 'degraded';
        }

        // Check if any circuit breakers are open
        const hasOpenCircuits = Object.values(circuitBreakerStats).some(
          stats => stats.state === 'OPEN'
        );
        if (hasOpenCircuits) {
          overallStatus = 'degraded';
        }

        return {
          status: overallStatus === 'healthy' ? 200 : 503,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: overallStatus,
            mode: CONFIG.routingMode,
            forwardingPercentage: CONFIG.forwardingPercentage,
            enableFallback: CONFIG.enableFallback,
            apis: {
              legacy: CONFIG.legacyApi.baseUrl,
              salesforce: CONFIG.salesforceApi.baseUrl
            },
            authentication: authHealth,
            circuitBreakers: circuitBreakerStats,
            retryConfig: {
              maxAttempts: CONFIG.retry.maxAttempts,
              initialDelay: CONFIG.retry.initialDelay,
              maxDelay: CONFIG.retry.maxDelay,
              backoffMultiplier: CONFIG.retry.backoffMultiplier
            },
            timestamp: new Date().toISOString()
          })
        };
      }

      // Handle config endpoint
      if (action === 'config') {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routingMode: CONFIG.routingMode,
            forwardingPercentage: CONFIG.forwardingPercentage,
            enableFallback: CONFIG.enableFallback,
            enableComparison: CONFIG.enableComparison,
            apis: {
              legacy: {
                name: CONFIG.legacyApi.name,
                baseUrl: CONFIG.legacyApi.baseUrl
              },
              salesforce: {
                name: CONFIG.salesforceApi.name,
                baseUrl: CONFIG.salesforceApi.baseUrl
              }
            }
          })
        };
      }

      // Parse request body
      const bodyText = await request.text();
      const requestBody = JSON.parse(bodyText);

      // Retrieve organization credentials from request metadata or headers
      let orgCredentials = null;

      // Option 1: Credentials in request body metadata
      if (requestBody.metadata?.altoAgencyRef && requestBody.metadata?.altoBranchId) {
        try {
          context.log('Retrieving organization credentials from database');
          orgCredentials = await getOrganizationCredentials(
            requestBody.metadata.altoAgencyRef,
            requestBody.metadata.altoBranchId,
            context
          );
        } catch (error) {
          context.warn(`Failed to retrieve organization credentials: ${error.message}`);
          // Will fall back to environment variable credentials
        }
      }

      // Option 2: Credentials in custom headers (fallback)
      if (!orgCredentials && request.headers.get('X-Alto-Agency-Ref') && request.headers.get('X-Alto-Branch-Id')) {
        try {
          context.log('Retrieving organization credentials from headers');
          orgCredentials = await getOrganizationCredentials(
            request.headers.get('X-Alto-Agency-Ref'),
            request.headers.get('X-Alto-Branch-Id'),
            context
          );
        } catch (error) {
          context.warn(`Failed to retrieve organization credentials from headers: ${error.message}`);
        }
      }

      // Option 3: Use test credentials if enabled (for development/testing)
      if (!orgCredentials && process.env.USE_TEST_CREDENTIALS === 'true') {
        context.warn('Using test credentials - not for production use!');
        orgCredentials = getTestCredentials(context);
      }

      // ✅ RATE LIMITING: Check rate limits before processing request
      // Extract universal organizationId for rate limiting
      let organizationId = null;
      let rateLimitCheck = null;

      if (requestBody.metadata?.altoAgencyRef && requestBody.metadata?.altoBranchId) {
        // Construct organizationId from Alto metadata (format: agencyRef:branchId)
        organizationId = `${requestBody.metadata.altoAgencyRef}:${requestBody.metadata.altoBranchId}`;
      } else if (orgCredentials?.organizationId) {
        // Use organizationId from credentials if available (future integrations)
        organizationId = orgCredentials.organizationId;
      }

      if (organizationId) {
        rateLimitCheck = await checkRateLimit('alto', organizationId, context);

        if (!rateLimitCheck.allowed) {
          context.warn(`Rate limit exceeded for Alto integration: ${organizationId}`, {
            reason: rateLimitCheck.reason,
            retryAfter: rateLimitCheck.retryAfter
          });

          // Track rate limit exceeded event
          telemetry.trackEvent('RateLimit_Exceeded', {
            integration: 'alto',
            organizationId,
            reason: rateLimitCheck.reason,
            limit: rateLimitCheck.limit.toString(),
            retryAfter: rateLimitCheck.retryAfter.toString()
          });

          return {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': rateLimitCheck.limit.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': rateLimitCheck.resetAt,
              'Retry-After': rateLimitCheck.retryAfter.toString()
            },
            body: JSON.stringify({
              success: false,
              error: 'Rate limit exceeded',
              message: rateLimitCheck.message,
              limit: rateLimitCheck.limit,
              resetAt: rateLimitCheck.resetAt,
              retryAfter: rateLimitCheck.retryAfter,
              timestamp: new Date().toISOString()
            })
          };
        }

        context.log(`Rate limit check passed for Alto:${organizationId} - ${rateLimitCheck.remaining} requests remaining`);
      } else {
        context.warn('Unable to determine organizationId for rate limiting - proceeding without rate limit check');
      }

      // Forward the request
      const forwardResult = await forwardRequest(action, requestBody, context, orgCredentials);

      const totalDuration = Date.now() - startTime;
      const success = forwardResult.result ? forwardResult.result.success : true;

      // Track overall request
      telemetry.trackRequest(
        action,
        totalDuration,
        success,
        forwardResult.provider,
        forwardResult.mode,
        {
          fallback: forwardResult.result?.fallback?.toString() || 'false',
          organizationId: requestBody.metadata?.altoAgencyRef || 'unknown'
        }
      );

      // Build response
      const responseBody = {
        success,
        data: forwardResult.response,
        metadata: {
          mode: forwardResult.mode,
          provider: forwardResult.provider,
          duration: totalDuration,
          timestamp: new Date().toISOString()
        }
      };

      // Add comparison data if available
      if (forwardResult.comparison) {
        responseBody.metadata.comparison = forwardResult.comparison;
      }

      // Add fallback indicator if applicable
      if (forwardResult.result?.fallback) {
        responseBody.metadata.fallback = true;
      }

      // Add error details if request failed
      if (forwardResult.result && !forwardResult.result.success) {
        responseBody.metadata.error = {
          type: forwardResult.result.errorType,
          message: forwardResult.result.error,
          isRetryable: forwardResult.result.isRetryable,
          severity: forwardResult.result.severity
        };
      }

      // Build response headers with rate limit information
      const responseHeaders = {
        'Content-Type': 'application/json',
        'X-TDS-Provider': forwardResult.provider,
        'X-TDS-Mode': forwardResult.mode,
        'X-Response-Time': `${totalDuration}ms`
      };

      // Add rate limit headers if rate limiting was checked
      if (rateLimitCheck && rateLimitCheck.limit) {
        responseHeaders['X-RateLimit-Limit'] = rateLimitCheck.limit?.toString() || 'unknown';
        responseHeaders['X-RateLimit-Remaining'] = rateLimitCheck.remaining?.toString() || 'unknown';
        if (rateLimitCheck.resetAt) {
          responseHeaders['X-RateLimit-Reset'] = rateLimitCheck.resetAt;
        }
      }

      return {
        status: success ? 200 : 500,
        headers: responseHeaders,
        body: JSON.stringify(responseBody)
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;

      context.error('TDS Request Forwarder error:', error);

      // Track exception
      telemetry.trackException(error, {
        handler: 'TDSRequestForwarder',
        action: request.params.action || 'unknown',
        duration: totalDuration.toString()
      });

      // Track failed request
      telemetry.trackRequest(
        request.params.action || 'unknown',
        totalDuration,
        false,
        'unknown',
        'error',
        {
          errorType: error.name,
          errorMessage: error.message
        }
      );

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Request forwarding failed',
          message: error.message,
          duration: totalDuration,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});
