/**
 * Telemetry Module
 *
 * Provides comprehensive telemetry and monitoring capabilities for the TDS API versioning system
 * Integrates with Azure Application Insights for metrics, events, dependencies, and exceptions
 *
 * Features:
 * - Request tracking with duration and success metrics
 * - Dependency tracking for external API calls
 * - Custom event tracking for business metrics
 * - Exception tracking with context
 * - Custom dimensions for filtering and analysis
 * - Correlation IDs for distributed tracing
 * - Performance metrics and counters
 */

const appInsights = require('applicationinsights');

// Initialize Application Insights if connection string is provided
let telemetryClient = null;
let isEnabled = false;

function initializeTelemetry() {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

  if (connectionString) {
    try {
      appInsights.setup(connectionString)
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true, true)
        .setUseDiskRetryCaching(true)
        .setSendLiveMetrics(true)
        .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
        .start();

      telemetryClient = appInsights.defaultClient;
      isEnabled = true;

      console.log('Application Insights telemetry initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Application Insights:', error.message);
      isEnabled = false;
    }
  } else {
    console.log('Application Insights connection string not found, telemetry disabled');
    isEnabled = false;
  }
}

// Initialize on module load
initializeTelemetry();

/**
 * Generate correlation ID for request tracking
 * @returns {string} - Unique correlation ID
 */
function generateCorrelationId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build common custom dimensions for all telemetry
 * @param {Object} additionalDimensions - Additional dimensions to include
 * @returns {Object} - Custom dimensions object
 */
function buildCustomDimensions(additionalDimensions = {}) {
  return {
    environment: process.env.AZURE_FUNCTIONS_ENVIRONMENT || 'development',
    routingMode: process.env.TDS_ROUTING_MODE || 'legacy-only',
    enableFallback: process.env.TDS_ENABLE_FALLBACK || 'false',
    enableComparison: process.env.TDS_ENABLE_RESPONSE_COMPARISON || 'false',
    ...additionalDimensions
  };
}

/**
 * Track a request with duration and success status
 * @param {string} name - Request name (e.g., 'CreateDeposit', 'GetDepositStatus')
 * @param {number} duration - Duration in milliseconds
 * @param {boolean} success - Whether the request succeeded
 * @param {string} provider - Provider name ('legacy' or 'salesforce')
 * @param {string} mode - Execution mode ('single', 'dual', 'shadow')
 * @param {Object} properties - Additional properties
 */
function trackRequest(name, duration, success, provider, mode, properties = {}) {
  if (!isEnabled) return;

  try {
    const customDimensions = buildCustomDimensions({
      provider,
      mode,
      operation: name,
      ...properties
    });

    telemetryClient.trackRequest({
      name: `TDS_${name}`,
      duration,
      resultCode: success ? 200 : 500,
      success,
      properties: customDimensions
    });

    // Also track as a metric for easier aggregation
    telemetryClient.trackMetric({
      name: `TDS_Request_Duration`,
      value: duration,
      properties: customDimensions
    });

  } catch (error) {
    console.error('Failed to track request:', error.message);
  }
}

/**
 * Track an external dependency call (API call to TDS providers)
 * @param {string} provider - Provider name ('legacy' or 'salesforce')
 * @param {string} operation - Operation name (e.g., 'CreateDeposit', 'GetStatus')
 * @param {number} duration - Duration in milliseconds
 * @param {boolean} success - Whether the call succeeded
 * @param {Object} properties - Additional properties
 */
function trackDependency(provider, operation, duration, success, properties = {}) {
  if (!isEnabled) return;

  try {
    const dependencyType = provider === 'legacy' ? 'HTTP_Legacy' : 'HTTP_Salesforce';
    const baseUrl = provider === 'legacy'
      ? process.env.TDS_CURRENT_BASE_URL
      : process.env.TDS_SALESFORCE_BASE_URL;

    const customDimensions = buildCustomDimensions({
      provider,
      operation,
      ...properties
    });

    telemetryClient.trackDependency({
      target: baseUrl,
      name: `${provider}_${operation}`,
      data: operation,
      duration,
      resultCode: success ? 200 : 500,
      success,
      dependencyTypeName: dependencyType,
      properties: customDimensions
    });

  } catch (error) {
    console.error('Failed to track dependency:', error.message);
  }
}

/**
 * Track a custom event (e.g., fallback activation, comparison result, configuration change)
 * @param {string} name - Event name
 * @param {Object} properties - Event properties
 */
function trackEvent(name, properties = {}) {
  if (!isEnabled) return;

  try {
    const customDimensions = buildCustomDimensions(properties);

    telemetryClient.trackEvent({
      name: `TDS_${name}`,
      properties: customDimensions
    });

  } catch (error) {
    console.error('Failed to track event:', error.message);
  }
}

/**
 * Track a custom metric
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 * @param {Object} properties - Additional properties
 */
function trackMetric(name, value, properties = {}) {
  if (!isEnabled) return;

  try {
    const customDimensions = buildCustomDimensions(properties);

    telemetryClient.trackMetric({
      name: `TDS_${name}`,
      value,
      properties: customDimensions
    });

  } catch (error) {
    console.error('Failed to track metric:', error.message);
  }
}

/**
 * Track an exception with context
 * @param {Error} error - Error object
 * @param {Object} properties - Additional context properties
 */
function trackException(error, properties = {}) {
  if (!isEnabled) return;

  try {
    const customDimensions = buildCustomDimensions({
      errorType: error.name,
      errorMessage: error.message,
      statusCode: error.statusCode || error.response?.status,
      isRetryable: error.isRetryable,
      severity: error.severity,
      ...properties
    });

    telemetryClient.trackException({
      exception: error,
      properties: customDimensions
    });

  } catch (trackError) {
    console.error('Failed to track exception:', trackError.message);
  }
}

/**
 * Track provider request count
 * @param {string} provider - Provider name
 * @param {boolean} success - Whether the request succeeded
 */
function trackProviderRequest(provider, success) {
  if (!isEnabled) return;

  trackMetric('Provider_Request_Count', 1, {
    provider,
    success: success.toString()
  });
}

/**
 * Track provider error rate
 * @param {string} provider - Provider name
 * @param {string} errorType - Type of error
 */
function trackProviderError(provider, errorType) {
  if (!isEnabled) return;

  trackMetric('Provider_Error_Count', 1, {
    provider,
    errorType
  });
}

/**
 * Track fallback activation
 * @param {string} fromProvider - Provider that failed
 * @param {string} toProvider - Provider used as fallback
 * @param {string} reason - Reason for fallback
 */
function trackFallback(fromProvider, toProvider, reason) {
  if (!isEnabled) return;

  trackEvent('Fallback_Activated', {
    fromProvider,
    toProvider,
    reason
  });

  trackMetric('Fallback_Count', 1, {
    fromProvider,
    toProvider
  });
}

/**
 * Track dual-mode execution result
 * @param {boolean} legacySuccess - Whether legacy API succeeded
 * @param {boolean} salesforceSuccess - Whether Salesforce API succeeded
 * @param {boolean} resultsMatch - Whether responses matched
 * @param {number} legacyDuration - Legacy API duration in ms
 * @param {number} salesforceDuration - Salesforce API duration in ms
 */
function trackDualModeExecution(legacySuccess, salesforceSuccess, resultsMatch, legacyDuration, salesforceDuration) {
  if (!isEnabled) return;

  const outcome = legacySuccess && salesforceSuccess
    ? (resultsMatch ? 'both_success_match' : 'both_success_mismatch')
    : legacySuccess
      ? 'legacy_only_success'
      : salesforceSuccess
        ? 'salesforce_only_success'
        : 'both_failed';

  trackEvent('Dual_Mode_Execution', {
    outcome,
    legacySuccess: legacySuccess.toString(),
    salesforceSuccess: salesforceSuccess.toString(),
    resultsMatch: resultsMatch.toString()
  });

  // Track performance comparison
  if (legacySuccess && salesforceSuccess) {
    const performanceDelta = salesforceDuration - legacyDuration;
    const percentageDiff = ((performanceDelta / legacyDuration) * 100).toFixed(2);

    trackMetric('Dual_Mode_Performance_Delta', performanceDelta, {
      percentageDiff,
      legacyDuration: legacyDuration.toString(),
      salesforceDuration: salesforceDuration.toString()
    });
  }

  // Track mismatch
  if (legacySuccess && salesforceSuccess && !resultsMatch) {
    trackEvent('Dual_Mode_Mismatch', {
      legacyDuration: legacyDuration.toString(),
      salesforceDuration: salesforceDuration.toString()
    });
  }
}

/**
 * Track comparison result between providers
 * @param {boolean} statusMatch - Whether status codes matched
 * @param {boolean} dataMatch - Whether response data matched
 * @param {Object} differences - Detailed differences
 */
function trackComparisonResult(statusMatch, dataMatch, differences = {}) {
  if (!isEnabled) return;

  trackEvent('Response_Comparison', {
    statusMatch: statusMatch.toString(),
    dataMatch: dataMatch.toString(),
    ...differences
  });

  if (!dataMatch) {
    trackMetric('Comparison_Mismatch_Count', 1, {
      statusMatch: statusMatch.toString()
    });
  }
}

/**
 * Track configuration change
 * @param {string} configKey - Configuration key that changed
 * @param {string} oldValue - Previous value
 * @param {string} newValue - New value
 */
function trackConfigurationChange(configKey, oldValue, newValue) {
  if (!isEnabled) return;

  trackEvent('Configuration_Changed', {
    configKey,
    oldValue: oldValue?.toString() || 'undefined',
    newValue: newValue?.toString() || 'undefined'
  });
}

/**
 * Track circuit breaker state change
 * @param {string} provider - Provider name
 * @param {string} oldState - Previous state ('closed', 'open', 'half-open')
 * @param {string} newState - New state
 * @param {string} reason - Reason for state change
 */
function trackCircuitBreakerStateChange(provider, oldState, newState, reason) {
  if (!isEnabled) return;

  trackEvent('Circuit_Breaker_State_Change', {
    provider,
    oldState,
    newState,
    reason
  });

  // Track open circuit breaker as critical metric
  if (newState === 'open') {
    trackMetric('Circuit_Breaker_Open_Count', 1, {
      provider,
      reason
    });
  }
}

/**
 * Track organization routing decision
 * @param {string} organizationId - Organization identifier
 * @param {string} provider - Provider chosen
 * @param {string} routingMode - Routing mode used
 * @param {string} reason - Reason for routing decision
 */
function trackOrganizationRouting(organizationId, provider, routingMode, reason = '') {
  if (!isEnabled) return;

  trackEvent('Organization_Routing', {
    organizationId,
    provider,
    routingMode,
    reason
  });
}

/**
 * Track migration progress for an organization
 * @param {string} organizationId - Organization identifier
 * @param {string} phase - Migration phase ('legacy', 'testing', 'migrated')
 * @param {number} successRate - Success rate percentage
 */
function trackMigrationProgress(organizationId, phase, successRate) {
  if (!isEnabled) return;

  trackMetric('Migration_Progress', successRate, {
    organizationId,
    phase
  });
}

/**
 * Track traffic distribution percentage
 * @param {string} provider - Provider name
 * @param {number} percentage - Traffic percentage
 */
function trackTrafficDistribution(provider, percentage) {
  if (!isEnabled) return;

  trackMetric('Traffic_Distribution', percentage, {
    provider
  });
}

/**
 * Flush telemetry data (useful before shutdown)
 */
function flush() {
  if (!isEnabled) return Promise.resolve();

  return new Promise((resolve) => {
    telemetryClient.flush({
      callback: (response) => {
        console.log('Telemetry flushed:', response);
        resolve();
      }
    });
  });
}

/**
 * Check if telemetry is enabled
 * @returns {boolean}
 */
function isTelemetryEnabled() {
  return isEnabled;
}

module.exports = {
  // Core tracking functions
  trackRequest,
  trackDependency,
  trackEvent,
  trackMetric,
  trackException,

  // Specialized tracking functions
  trackProviderRequest,
  trackProviderError,
  trackFallback,
  trackDualModeExecution,
  trackComparisonResult,
  trackConfigurationChange,
  trackCircuitBreakerStateChange,
  trackOrganizationRouting,
  trackMigrationProgress,
  trackTrafficDistribution,

  // Utility functions
  generateCorrelationId,
  flush,
  isTelemetryEnabled
};
