/**
 * Rate Limiter Module
 *
 * Provides per-integration, per-organization rate limiting to prevent:
 * - Cost overruns from runaway processes
 * - Service degradation from resource exhaustion
 * - Cascade failures across organizations
 *
 * Features:
 * - Per-integration isolation (Alto, Jupix, PayProp, Vision+)
 * - Per-organization tracking within each integration
 * - Configurable limits: requests/minute, requests/hour, burst allowance
 * - Default limits + organization-specific overrides
 * - Automatic cleanup of expired request timestamps
 * - Azure Table Storage backed configuration
 *
 * Rate Limit Buckets:
 * - Each organization gets separate bucket per integration
 * - Example: "alto:org-abc-001" tracks ABC Lettings' Alto requests
 * - Example: "jupix:org-abc-001" tracks ABC Lettings' Jupix requests
 * - Organizations can use full allowance on each integration independently
 */

const { TableClient } = require('@azure/data-tables');

// In-memory request tracking buckets
// Format: { "integration:organizationId": { requests: [timestamps...], warnings: 0 } }
const requestBuckets = new Map();

// Configuration cache
// Format: { "integration:organizationId": { reqPerMinute, reqPerHour, burstAllowance, enabled } }
const configCache = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Default rate limits (applied if no specific config exists)
const DEFAULT_LIMITS = {
  reqPerMinute: 100,
  reqPerHour: 5000,
  burstAllowance: 20,
  enabled: true
};

/**
 * Get Azure Table Storage client for rate limit configuration
 * @returns {TableClient} - Table client for RateLimitConfig table
 */
function getTableClient() {
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  return TableClient.fromConnectionString(connectionString, 'RateLimitConfig');
}

/**
 * Get rate limit configuration for integration and organization
 *
 * @param {string} integration - Integration name (e.g., 'alto', 'jupix', 'payprop')
 * @param {string} organizationId - Universal organization ID (e.g., 'org-abc-001')
 * @param {Object} context - Azure Function context for logging
 * @returns {Promise<Object>} - Rate limit configuration
 */
async function getConfig(integration, organizationId, context) {
  const cacheKey = `${integration}:${organizationId}`;

  // Check cache first
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  try {
    const tableClient = getTableClient();

    // Try to get organization-specific override
    let config;
    try {
      const entity = await tableClient.getEntity(integration, organizationId);
      config = {
        reqPerMinute: entity.reqPerMinute || DEFAULT_LIMITS.reqPerMinute,
        reqPerHour: entity.reqPerHour || DEFAULT_LIMITS.reqPerHour,
        burstAllowance: entity.burstAllowance || DEFAULT_LIMITS.burstAllowance,
        enabled: entity.enabled !== undefined ? entity.enabled : true
      };
      context?.log(`Loaded rate limit override for ${integration}:${organizationId}`);
    } catch (error) {
      if (error.statusCode === 404) {
        // No override, try to get integration defaults
        try {
          const defaultEntity = await tableClient.getEntity(integration, '_default');
          config = {
            reqPerMinute: defaultEntity.reqPerMinute || DEFAULT_LIMITS.reqPerMinute,
            reqPerHour: defaultEntity.reqPerHour || DEFAULT_LIMITS.reqPerHour,
            burstAllowance: defaultEntity.burstAllowance || DEFAULT_LIMITS.burstAllowance,
            enabled: defaultEntity.enabled !== undefined ? defaultEntity.enabled : true
          };
          context?.log(`Loaded default rate limits for ${integration}`);
        } catch (defaultError) {
          if (defaultError.statusCode === 404) {
            // No defaults configured, use hardcoded defaults
            config = { ...DEFAULT_LIMITS };
            context?.log(`Using hardcoded default rate limits for ${integration}:${organizationId}`);
          } else {
            throw defaultError;
          }
        }
      } else {
        throw error;
      }
    }

    // Cache the configuration
    configCache.set(cacheKey, {
      config,
      timestamp: Date.now()
    });

    return config;

  } catch (error) {
    context?.error(`Error loading rate limit config for ${integration}:${organizationId}:`, error);
    // Fall back to defaults on error
    return { ...DEFAULT_LIMITS };
  }
}

/**
 * Get or create request bucket for integration and organization
 *
 * @param {string} integration - Integration name
 * @param {string} organizationId - Universal organization ID
 * @returns {Object} - Request bucket { requests: [...], warnings: 0 }
 */
function getBucket(integration, organizationId) {
  const bucketKey = `${integration}:${organizationId}`;

  if (!requestBuckets.has(bucketKey)) {
    requestBuckets.set(bucketKey, {
      requests: [],
      warnings: 0
    });
  }

  return requestBuckets.get(bucketKey);
}

/**
 * Clean up expired request timestamps from bucket
 *
 * @param {Object} bucket - Request bucket
 * @param {number} maxAgeMs - Maximum age of timestamps to keep (in milliseconds)
 */
function cleanupBucket(bucket, maxAgeMs) {
  const now = Date.now();
  bucket.requests = bucket.requests.filter(timestamp => now - timestamp < maxAgeMs);
}

/**
 * Check if request is allowed under rate limits
 *
 * @param {string} integration - Integration name (e.g., 'alto', 'jupix')
 * @param {string} organizationId - Universal organization ID
 * @param {Object} context - Azure Function context for logging
 * @returns {Promise<Object>} - Rate limit check result
 */
async function checkRateLimit(integration, organizationId, context) {
  try {
    // Validate inputs
    if (!integration || !organizationId) {
      throw new Error('Integration and organizationId are required for rate limiting');
    }

    // Get configuration
    const config = await getConfig(integration, organizationId, context);

    // If rate limiting is disabled for this org, allow the request
    if (!config.enabled) {
      context?.log(`Rate limiting disabled for ${integration}:${organizationId}`);
      return {
        allowed: true,
        limit: 'unlimited',
        remaining: 'unlimited',
        resetAt: null
      };
    }

    const now = Date.now();
    const bucket = getBucket(integration, organizationId);

    // Clean up old requests (keep last hour for hourly limit check)
    const oneHourMs = 60 * 60 * 1000;
    cleanupBucket(bucket, oneHourMs);

    // Count requests in last minute
    const oneMinuteMs = 60 * 1000;
    const lastMinuteRequests = bucket.requests.filter(timestamp => now - timestamp < oneMinuteMs).length;

    // Count requests in last hour
    const lastHourRequests = bucket.requests.length;

    // Calculate when the oldest request in the minute window will expire
    const requestsInMinute = bucket.requests.filter(timestamp => now - timestamp < oneMinuteMs);
    const oldestInMinute = requestsInMinute.length > 0 ? Math.min(...requestsInMinute) : now;
    const resetInSeconds = requestsInMinute.length > 0
      ? Math.ceil((oneMinuteMs - (now - oldestInMinute)) / 1000)
      : 60;

    // Check minute limit (with burst allowance)
    const effectiveMinuteLimit = config.reqPerMinute + config.burstAllowance;
    if (lastMinuteRequests >= effectiveMinuteLimit) {
      context?.warn(`Rate limit exceeded for ${integration}:${organizationId} - minute limit (${lastMinuteRequests}/${effectiveMinuteLimit})`);

      return {
        allowed: false,
        limit: config.reqPerMinute,
        remaining: 0,
        resetAt: new Date(Date.now() + resetInSeconds * 1000).toISOString(),
        retryAfter: resetInSeconds,
        reason: 'minute_limit_exceeded',
        message: `Rate limit exceeded: ${lastMinuteRequests} requests in last minute (limit: ${config.reqPerMinute}/min with ${config.burstAllowance} burst allowance)`
      };
    }

    // Check hour limit
    if (lastHourRequests >= config.reqPerHour) {
      // Calculate when the oldest request in the hour will expire
      const oldestInHour = bucket.requests.length > 0 ? Math.min(...bucket.requests) : now;
      const hourResetInSeconds = Math.ceil((oneHourMs - (now - oldestInHour)) / 1000);

      context?.warn(`Rate limit exceeded for ${integration}:${organizationId} - hour limit (${lastHourRequests}/${config.reqPerHour})`);

      return {
        allowed: false,
        limit: config.reqPerHour,
        remaining: 0,
        resetAt: new Date(Date.now() + hourResetInSeconds * 1000).toISOString(),
        retryAfter: hourResetInSeconds,
        reason: 'hour_limit_exceeded',
        message: `Rate limit exceeded: ${lastHourRequests} requests in last hour (limit: ${config.reqPerHour}/hour)`
      };
    }

    // Request is allowed - record it
    bucket.requests.push(now);

    // Calculate remaining requests
    const remainingMinute = config.reqPerMinute - lastMinuteRequests - 1;
    const remainingHour = config.reqPerHour - lastHourRequests - 1;
    const remaining = Math.min(remainingMinute, remainingHour);

    // Log warning if approaching limit (>80% usage)
    const minuteUsagePercent = ((lastMinuteRequests + 1) / config.reqPerMinute) * 100;
    if (minuteUsagePercent > 80 && bucket.warnings < 3) {
      context?.warn(`${integration}:${organizationId} approaching rate limit: ${lastMinuteRequests + 1}/${config.reqPerMinute} (${minuteUsagePercent.toFixed(1)}%)`);
      bucket.warnings++;
    }

    // Reset warning counter if usage drops below 50%
    if (minuteUsagePercent < 50) {
      bucket.warnings = 0;
    }

    return {
      allowed: true,
      limit: config.reqPerMinute,
      remaining: Math.max(0, remaining),
      resetAt: new Date(Date.now() + 60000).toISOString(),
      currentUsage: {
        minute: lastMinuteRequests + 1,
        hour: lastHourRequests + 1,
        minutePercent: minuteUsagePercent,
        hourPercent: ((lastHourRequests + 1) / config.reqPerHour) * 100
      }
    };

  } catch (error) {
    context?.error(`Error checking rate limit for ${integration}:${organizationId}:`, error);

    // On error, allow the request (fail open) to prevent service disruption
    // This prevents rate limiter bugs from blocking legitimate traffic
    return {
      allowed: true,
      limit: 'error',
      remaining: 'error',
      resetAt: null,
      error: error.message
    };
  }
}

/**
 * Get current rate limit statistics for monitoring
 *
 * @param {string} integration - Integration name (optional, returns all if not specified)
 * @param {Object} context - Azure Function context for logging
 * @returns {Array<Object>} - Statistics for each organization
 */
async function getStats(integration = null, context) {
  const now = Date.now();
  const oneMinuteMs = 60 * 1000;
  const stats = [];

  for (const [bucketKey, bucket] of requestBuckets.entries()) {
    const [bucketIntegration, organizationId] = bucketKey.split(':');

    // Filter by integration if specified
    if (integration && bucketIntegration !== integration) {
      continue;
    }

    // Get configuration
    const config = await getConfig(bucketIntegration, organizationId, context);

    // Count recent requests
    const lastMinuteRequests = bucket.requests.filter(timestamp => now - timestamp < oneMinuteMs).length;
    const lastHourRequests = bucket.requests.length;

    stats.push({
      integration: bucketIntegration,
      organizationId,
      current: {
        minute: lastMinuteRequests,
        hour: lastHourRequests
      },
      limits: {
        minute: config.reqPerMinute,
        hour: config.reqPerHour,
        burst: config.burstAllowance
      },
      usage: {
        minutePercent: Math.round((lastMinuteRequests / config.reqPerMinute) * 100),
        hourPercent: Math.round((lastHourRequests / config.reqPerHour) * 100)
      },
      warnings: bucket.warnings,
      status: lastMinuteRequests >= config.reqPerMinute * 0.9 ? 'critical' :
              lastMinuteRequests >= config.reqPerMinute * 0.8 ? 'warning' : 'ok'
    });
  }

  return stats;
}

/**
 * Clear rate limit configuration cache
 * Useful for forcing immediate reload of updated configurations
 */
function clearConfigCache() {
  configCache.clear();
  console.log('Rate limit configuration cache cleared');
}

/**
 * Clear request buckets (for testing purposes)
 */
function clearBuckets() {
  requestBuckets.clear();
  console.log('Rate limit request buckets cleared');
}

/**
 * Get cache statistics for monitoring
 * @returns {Object} - Cache statistics
 */
function getCacheStats() {
  return {
    configs: {
      size: configCache.size,
      ttlMs: CONFIG_CACHE_TTL
    },
    buckets: {
      size: requestBuckets.size,
      entries: Array.from(requestBuckets.keys())
    }
  };
}

module.exports = {
  checkRateLimit,
  getStats,
  getConfig,
  clearConfigCache,
  clearBuckets,
  getCacheStats,
  DEFAULT_LIMITS
};
