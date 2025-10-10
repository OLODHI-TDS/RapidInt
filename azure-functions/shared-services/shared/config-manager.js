/**
 * Configuration Manager
 *
 * Centralized configuration management for TDS API versioning system
 * Handles:
 * - Global routing configuration
 * - Per-organization provider preferences
 * - Configuration validation
 * - Hot-reload capability
 * - Configuration caching
 */

// Configuration cache
let configCache = {
  global: null,
  organizations: new Map(),
  timestamp: null,
  ttl: 5 * 60 * 1000 // 5 minutes
};

/**
 * Get global routing configuration from environment
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Object} - Global configuration
 */
function getGlobalConfig(context) {
  // Check cache
  const now = Date.now();
  if (configCache.global && configCache.timestamp && (now - configCache.timestamp < configCache.ttl)) {
    context?.log('Using cached global configuration');
    return configCache.global;
  }

  context?.log('Loading global configuration from environment');

  const config = {
    // Routing configuration
    routingMode: process.env.TDS_ROUTING_MODE || 'legacy-only', // legacy-only, salesforce-only, both, shadow, forwarding
    forwardingPercentage: parseInt(process.env.TDS_FORWARDING_PERCENTAGE || '0', 10),
    activeProvider: process.env.TDS_ACTIVE_PROVIDER || 'current', // current, salesforce

    // Feature flags
    enableDualMode: process.env.TDS_DUAL_MODE === 'true',
    enableFallback: process.env.TDS_ENABLE_FALLBACK === 'true',
    enableComparison: process.env.TDS_ENABLE_RESPONSE_COMPARISON === 'true',

    // Retry and timeout configuration
    maxRetries: parseInt(process.env.TDS_MAX_RETRIES || '3', 10),
    retryDelayMs: parseInt(process.env.TDS_RETRY_DELAY_MS || '1000', 10),
    requestTimeoutMs: parseInt(process.env.TDS_REQUEST_TIMEOUT_MS || '30000', 10),

    // Circuit breaker configuration
    circuitBreakerThreshold: parseInt(process.env.TDS_CIRCUIT_BREAKER_THRESHOLD || '5', 10),
    circuitBreakerTimeoutMs: parseInt(process.env.TDS_CIRCUIT_BREAKER_TIMEOUT_MS || '60000', 10),

    // API URLs
    legacyApiUrl: process.env.TDS_CURRENT_BASE_URL || 'https://sandbox.api.custodial.tenancydepositscheme.com/v1.2',
    salesforceApiUrl: process.env.TDS_SALESFORCE_BASE_URL || 'https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com',

    // Logging and monitoring
    enableDetailedLogging: process.env.TDS_ENABLE_DETAILED_LOGGING === 'true',
    logComparisonResults: process.env.TDS_LOG_COMPARISON_RESULTS === 'true',

    // Organization overrides enabled
    allowOrganizationOverrides: process.env.TDS_ALLOW_ORG_OVERRIDES !== 'false' // Default true
  };

  // Validate configuration
  validateGlobalConfig(config, context);

  // Cache the configuration
  configCache.global = config;
  configCache.timestamp = Date.now();

  return config;
}

/**
 * Validate global configuration
 * @param {Object} config - Configuration object
 * @param {Object} context - Azure Function context (for logging)
 * @throws {Error} - If configuration is invalid
 */
function validateGlobalConfig(config, context) {
  const validModes = ['legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding'];
  if (!validModes.includes(config.routingMode)) {
    throw new Error(`Invalid routing mode: ${config.routingMode}. Must be one of: ${validModes.join(', ')}`);
  }

  if (config.forwardingPercentage < 0 || config.forwardingPercentage > 100) {
    throw new Error(`Invalid forwarding percentage: ${config.forwardingPercentage}. Must be between 0 and 100`);
  }

  const validProviders = ['current', 'salesforce'];
  if (!validProviders.includes(config.activeProvider)) {
    throw new Error(`Invalid active provider: ${config.activeProvider}. Must be one of: ${validProviders.join(', ')}`);
  }

  context?.log('Global configuration validated successfully');
}

/**
 * Get organization-specific configuration
 * Combines global config with organization overrides
 *
 * @param {string} altoAgencyRef - Alto agency reference
 * @param {string} altoBranchId - Alto branch ID for cache isolation
 * @param {Object} orgCredentials - Organization credentials object (includes providerPreference)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Object} - Organization-specific configuration
 */
function getOrganizationConfig(altoAgencyRef, altoBranchId, orgCredentials, context) {
  const globalConfig = getGlobalConfig(context);

  // Check if organization overrides are allowed
  if (!globalConfig.allowOrganizationOverrides) {
    context?.log('Organization overrides disabled, using global configuration');
    return globalConfig;
  }

  // Check cache - SECURITY FIX: Include branch ID for proper isolation (HIGH-007)
  const cacheKey = `${altoAgencyRef}:${altoBranchId}`;
  const now = Date.now();
  const cached = configCache.organizations.get(cacheKey);

  if (cached && (now - cached.timestamp < configCache.ttl)) {
    context?.log(`Using cached organization configuration for ${altoAgencyRef}:${altoBranchId}`);
    return cached.config;
  }

  context?.log(`Building organization configuration for ${altoAgencyRef}:${altoBranchId}`);

  // Start with global config
  const orgConfig = { ...globalConfig };

  // Apply organization-specific overrides
  if (orgCredentials && orgCredentials.providerPreference) {
    const preference = orgCredentials.providerPreference;

    context?.log(`Organization ${altoAgencyRef} has provider preference: ${preference}`);

    if (preference === 'current') {
      // Force legacy API
      orgConfig.routingMode = 'legacy-only';
      orgConfig.activeProvider = 'current';
      orgConfig.enableDualMode = false;

    } else if (preference === 'salesforce') {
      // Force Salesforce API
      orgConfig.routingMode = 'salesforce-only';
      orgConfig.activeProvider = 'salesforce';
      orgConfig.enableDualMode = false;

    } else if (preference === 'dual') {
      // Enable dual-mode execution
      orgConfig.routingMode = 'both';
      orgConfig.enableDualMode = true;
      orgConfig.enableComparison = true;

    } else if (preference === 'auto') {
      // Use global configuration (no override)
      context?.log('Organization using auto (global) configuration');
    }
  }

  // Cache the organization config
  configCache.organizations.set(cacheKey, {
    config: orgConfig,
    timestamp: Date.now()
  });

  return orgConfig;
}

/**
 * Determine which provider to use for a request
 * Based on organization config and routing mode
 *
 * @param {Object} orgConfig - Organization-specific configuration
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Object} - Routing decision { target: 'current'|'salesforce'|'both', execute: ['current', 'salesforce'] }
 */
function determineProvider(orgConfig, context) {
  const mode = orgConfig.routingMode;

  switch (mode) {
    case 'legacy-only':
      return { target: 'current', execute: ['current'] };

    case 'salesforce-only':
      return { target: 'salesforce', execute: ['salesforce'] };

    case 'both':
      return { target: 'both', execute: ['current', 'salesforce'] };

    case 'shadow':
      // Execute Salesforce in background but return legacy response
      return { target: 'current', execute: ['current', 'salesforce'], returnFrom: 'current' };

    case 'forwarding':
      // Percentage-based routing
      const random = Math.random() * 100;
      const useSalesforce = random < orgConfig.forwardingPercentage;

      context?.log(`Forwarding decision: ${random.toFixed(2)}% < ${orgConfig.forwardingPercentage}% = ${useSalesforce ? 'Salesforce' : 'Current'}`);

      return {
        target: useSalesforce ? 'salesforce' : 'current',
        execute: [useSalesforce ? 'salesforce' : 'current']
      };

    default:
      context?.warn(`Unknown routing mode: ${mode}, defaulting to legacy-only`);
      return { target: 'current', execute: ['current'] };
  }
}

/**
 * Clear configuration cache
 * Useful for forcing config reload or after updates
 */
function clearConfigCache() {
  configCache.global = null;
  configCache.organizations.clear();
  configCache.timestamp = null;
  console.log('Configuration cache cleared');
}

/**
 * Get cache statistics
 * @returns {Object} - Cache stats
 */
function getConfigCacheStats() {
  return {
    globalCached: !!configCache.global,
    organizationCount: configCache.organizations.size,
    cacheAge: configCache.timestamp ? Date.now() - configCache.timestamp : null,
    ttl: configCache.ttl
  };
}

/**
 * Update routing mode dynamically
 * @param {string} newMode - New routing mode
 * @param {Object} context - Azure Function context (for logging)
 */
function updateRoutingMode(newMode, context) {
  const validModes = ['legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding'];

  if (!validModes.includes(newMode)) {
    throw new Error(`Invalid routing mode: ${newMode}. Must be one of: ${validModes.join(', ')}`);
  }

  context?.log(`Updating routing mode to: ${newMode}`);

  // Update environment variable (in-memory only, not persisted)
  process.env.TDS_ROUTING_MODE = newMode;

  // Clear cache to force reload
  clearConfigCache();

  context?.log('Routing mode updated successfully');
}

/**
 * Update forwarding percentage dynamically
 * @param {number} percentage - New forwarding percentage (0-100)
 * @param {Object} context - Azure Function context (for logging)
 */
function updateForwardingPercentage(percentage, context) {
  if (percentage < 0 || percentage > 100) {
    throw new Error(`Invalid forwarding percentage: ${percentage}. Must be between 0 and 100`);
  }

  context?.log(`Updating forwarding percentage to: ${percentage}%`);

  // Update environment variable (in-memory only, not persisted)
  process.env.TDS_FORWARDING_PERCENTAGE = percentage.toString();

  // Clear cache to force reload
  clearConfigCache();

  context?.log('Forwarding percentage updated successfully');
}

/**
 * Enable or disable dual-mode globally
 * @param {boolean} enabled - Whether to enable dual-mode
 * @param {Object} context - Azure Function context (for logging)
 */
function updateDualMode(enabled, context) {
  context?.log(`${enabled ? 'Enabling' : 'Disabling'} dual-mode globally`);

  process.env.TDS_DUAL_MODE = enabled ? 'true' : 'false';

  // Clear cache to force reload
  clearConfigCache();

  context?.log(`Dual-mode ${enabled ? 'enabled' : 'disabled'} successfully`);
}

module.exports = {
  // Configuration retrieval
  getGlobalConfig,
  getOrganizationConfig,
  determineProvider,

  // Cache management
  clearConfigCache,
  getConfigCacheStats,

  // Dynamic updates
  updateRoutingMode,
  updateForwardingPercentage,
  updateDualMode,

  // Validation
  validateGlobalConfig
};
