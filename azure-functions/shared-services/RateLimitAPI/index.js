/**
 * Azure Function: Rate Limit Management API
 *
 * Provides REST endpoints for configuring and monitoring rate limits
 * across all integrations (Alto, Jupix, PayProp, Vision+, etc.)
 *
 * Endpoints:
 * - GET    /api/rate-limits/{integration}/config                 - Get default limits
 * - PUT    /api/rate-limits/{integration}/config                 - Update default limits
 * - GET    /api/rate-limits/{integration}/organizations          - List org overrides
 * - GET    /api/rate-limits/{integration}/organizations/{orgId}  - Get org limits
 * - PUT    /api/rate-limits/{integration}/organizations/{orgId}  - Set org override
 * - DELETE /api/rate-limits/{integration}/organizations/{orgId}  - Remove override
 * - GET    /api/rate-limits/{integration}/stats                  - Get usage stats
 *
 * Security:
 * - Function key required (authLevel: 'function')
 * - Input validation on all endpoints
 * - Audit logging for configuration changes
 */

const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { getStats, clearConfigCache, DEFAULT_LIMITS } = require('../shared/rate-limiter');
const telemetry = require('../shared/telemetry');

/**
 * Get Azure Table Storage client for rate limit configuration
 */
function getTableClient() {
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  return TableClient.fromConnectionString(connectionString, 'RateLimitConfig');
}

/**
 * Validate integration name
 */
function validateIntegration(integration) {
  const validIntegrations = ['alto', 'jupix', 'payprop', 'vision', 'reapit'];
  if (!validIntegrations.includes(integration.toLowerCase())) {
    throw new Error(`Invalid integration: ${integration}. Valid values: ${validIntegrations.join(', ')}`);
  }
  return integration.toLowerCase();
}

/**
 * Validate rate limit configuration values
 */
function validateConfig(config) {
  const errors = [];

  if (config.reqPerMinute !== undefined) {
    const val = parseInt(config.reqPerMinute, 10);
    if (isNaN(val) || val < 1 || val > 10000) {
      errors.push('reqPerMinute must be between 1 and 10000');
    }
  }

  if (config.reqPerHour !== undefined) {
    const val = parseInt(config.reqPerHour, 10);
    if (isNaN(val) || val < 10 || val > 1000000) {
      errors.push('reqPerHour must be between 10 and 1000000');
    }
  }

  if (config.burstAllowance !== undefined) {
    const val = parseInt(config.burstAllowance, 10);
    if (isNaN(val) || val < 0 || val > 1000) {
      errors.push('burstAllowance must be between 0 and 1000');
    }
  }

  // Validate hour limit is greater than minute limit
  if (config.reqPerMinute && config.reqPerHour) {
    const perMin = parseInt(config.reqPerMinute, 10);
    const perHour = parseInt(config.reqPerHour, 10);
    if (perHour < perMin) {
      errors.push('reqPerHour must be greater than or equal to reqPerMinute');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors: ${errors.join(', ')}`);
  }

  return true;
}

/**
 * Get default rate limits for an integration
 */
async function getDefaultConfig(integration, context) {
  try {
    integration = validateIntegration(integration);
    const tableClient = getTableClient();

    try {
      const entity = await tableClient.getEntity(integration, '_default');
      return {
        integration,
        reqPerMinute: entity.reqPerMinute || DEFAULT_LIMITS.reqPerMinute,
        reqPerHour: entity.reqPerHour || DEFAULT_LIMITS.reqPerHour,
        burstAllowance: entity.burstAllowance || DEFAULT_LIMITS.burstAllowance,
        enabled: entity.enabled !== undefined ? entity.enabled : true,
        lastUpdated: entity.lastUpdated || null
      };
    } catch (error) {
      if (error.statusCode === 404) {
        // No custom defaults, return hardcoded defaults
        return {
          integration,
          ...DEFAULT_LIMITS,
          lastUpdated: null,
          isDefaultConfig: true
        };
      }
      throw error;
    }
  } catch (error) {
    context.error(`Error getting default config for ${integration}:`, error);
    throw error;
  }
}

/**
 * Update default rate limits for an integration
 */
async function updateDefaultConfig(integration, config, context) {
  try {
    integration = validateIntegration(integration);
    validateConfig(config);

    const tableClient = getTableClient();

    const entity = {
      partitionKey: integration,
      rowKey: '_default',
      reqPerMinute: parseInt(config.reqPerMinute, 10) || DEFAULT_LIMITS.reqPerMinute,
      reqPerHour: parseInt(config.reqPerHour, 10) || DEFAULT_LIMITS.reqPerHour,
      burstAllowance: parseInt(config.burstAllowance, 10) || DEFAULT_LIMITS.burstAllowance,
      enabled: config.enabled !== undefined ? config.enabled : true,
      lastUpdated: new Date().toISOString()
    };

    await tableClient.upsertEntity(entity, 'Replace');

    // Clear config cache to force reload
    clearConfigCache();

    context.log(`Updated default rate limits for ${integration}`);

    // Track configuration change in telemetry
    telemetry.trackEvent('RateLimit_DefaultConfig_Updated', {
      integration,
      reqPerMinute: entity.reqPerMinute.toString(),
      reqPerHour: entity.reqPerHour.toString(),
      burstAllowance: entity.burstAllowance.toString()
    });

    return {
      integration,
      reqPerMinute: entity.reqPerMinute,
      reqPerHour: entity.reqPerHour,
      burstAllowance: entity.burstAllowance,
      enabled: entity.enabled,
      lastUpdated: entity.lastUpdated
    };

  } catch (error) {
    context.error(`Error updating default config for ${integration}:`, error);
    throw error;
  }
}

/**
 * Get organization-specific rate limit override
 */
async function getOrgConfig(integration, organizationId, context) {
  try {
    integration = validateIntegration(integration);

    if (!organizationId || organizationId === '_default') {
      throw new Error('Invalid organizationId');
    }

    const tableClient = getTableClient();

    try {
      const entity = await tableClient.getEntity(integration, organizationId);
      return {
        integration,
        organizationId,
        organizationName: entity.organizationName || 'Unknown',
        reqPerMinute: entity.reqPerMinute,
        reqPerHour: entity.reqPerHour,
        burstAllowance: entity.burstAllowance,
        enabled: entity.enabled !== undefined ? entity.enabled : true,
        lastUpdated: entity.lastUpdated || null,
        isOverride: true
      };
    } catch (error) {
      if (error.statusCode === 404) {
        // No override, return default config
        const defaultConfig = await getDefaultConfig(integration, context);
        return {
          integration,
          organizationId,
          ...defaultConfig,
          isOverride: false,
          message: 'Using default configuration (no override set)'
        };
      }
      throw error;
    }
  } catch (error) {
    context.error(`Error getting org config for ${integration}:${organizationId}:`, error);
    throw error;
  }
}

/**
 * Set organization-specific rate limit override
 */
async function setOrgConfig(integration, organizationId, config, context) {
  try {
    integration = validateIntegration(integration);

    if (!organizationId || organizationId === '_default') {
      throw new Error('Invalid organizationId');
    }

    validateConfig(config);

    const tableClient = getTableClient();

    const entity = {
      partitionKey: integration,
      rowKey: organizationId,
      organizationId,
      organizationName: config.organizationName || 'Unknown',
      reqPerMinute: parseInt(config.reqPerMinute, 10),
      reqPerHour: parseInt(config.reqPerHour, 10),
      burstAllowance: parseInt(config.burstAllowance, 10),
      enabled: config.enabled !== undefined ? config.enabled : true,
      lastUpdated: new Date().toISOString()
    };

    await tableClient.upsertEntity(entity, 'Replace');

    // Clear config cache to force reload
    clearConfigCache();

    context.log(`Set rate limit override for ${integration}:${organizationId}`);

    // Track configuration change in telemetry
    telemetry.trackEvent('RateLimit_OrgOverride_Set', {
      integration,
      organizationId,
      reqPerMinute: entity.reqPerMinute.toString(),
      reqPerHour: entity.reqPerHour.toString()
    });

    return {
      integration,
      organizationId,
      organizationName: entity.organizationName,
      reqPerMinute: entity.reqPerMinute,
      reqPerHour: entity.reqPerHour,
      burstAllowance: entity.burstAllowance,
      enabled: entity.enabled,
      lastUpdated: entity.lastUpdated
    };

  } catch (error) {
    context.error(`Error setting org config for ${integration}:${organizationId}:`, error);
    throw error;
  }
}

/**
 * Remove organization-specific rate limit override
 */
async function removeOrgConfig(integration, organizationId, context) {
  try {
    integration = validateIntegration(integration);

    if (!organizationId || organizationId === '_default') {
      throw new Error('Invalid organizationId');
    }

    const tableClient = getTableClient();

    await tableClient.deleteEntity(integration, organizationId);

    // Clear config cache to force reload
    clearConfigCache();

    context.log(`Removed rate limit override for ${integration}:${organizationId}`);

    // Track configuration change in telemetry
    telemetry.trackEvent('RateLimit_OrgOverride_Removed', {
      integration,
      organizationId
    });

    return {
      success: true,
      message: `Rate limit override removed for ${integration}:${organizationId}. Organization will now use default limits.`
    };

  } catch (error) {
    if (error.statusCode === 404) {
      return {
        success: false,
        message: `No override found for ${integration}:${organizationId}`
      };
    }

    context.error(`Error removing org config for ${integration}:${organizationId}:`, error);
    throw error;
  }
}

/**
 * List all organizations from OrganizationMappings table
 */
async function listAllOrganizations(context) {
  try {
    const { TableClient } = require('@azure/data-tables');
    const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
    const tableClient = TableClient.fromConnectionString(connectionString, 'OrganizationMappings');

    const entities = tableClient.listEntities({
      queryOptions: { filter: `PartitionKey eq 'OrganizationMapping'` }
    });

    const organizations = [];
    for await (const entity of entities) {
      organizations.push({
        organizationId: entity.rowKey, // Format: "agencyRef:branchId"
        organizationName: entity.memberName || entity.organizationName || 'Unknown Organization',
        altoAgencyRef: entity.altoAgencyRef,
        altoBranchId: entity.altoBranchId,
        isActive: entity.isActive
      });
    }

    return {
      success: true,
      organizations: organizations.filter(org => org.isActive)
    };

  } catch (error) {
    context.error('Error listing organizations:', error);
    // Return empty list if table doesn't exist yet
    return {
      success: true,
      organizations: []
    };
  }
}

/**
 * List all organization overrides for an integration
 */
async function listOrgOverrides(integration, context) {
  try {
    integration = validateIntegration(integration);
    const tableClient = getTableClient();

    const entities = tableClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${integration}' and RowKey ne '_default'` }
    });

    const overrides = [];
    for await (const entity of entities) {
      overrides.push({
        organizationId: entity.rowKey,
        organizationName: entity.organizationName || 'Unknown',
        reqPerMinute: entity.reqPerMinute,
        reqPerHour: entity.reqPerHour,
        burstAllowance: entity.burstAllowance,
        enabled: entity.enabled,
        lastUpdated: entity.lastUpdated
      });
    }

    return {
      integration,
      totalOverrides: overrides.length,
      overrides
    };

  } catch (error) {
    context.error(`Error listing org overrides for ${integration}:`, error);
    throw error;
  }
}

/**
 * Azure Function HTTP Handler
 */
app.http('RateLimitAPI', {
  methods: ['GET', 'PUT', 'DELETE'],
  route: 'rate-limits/{integration}/{action?}/{param?}',
  authLevel: 'function',
  handler: async (request, context) => {
    const startTime = Date.now();

    try {
      const method = request.method.toUpperCase();
      const integration = request.params.integration;
      const action = request.params.action;
      const param = request.params.param;

      context.log(`Rate Limit API: ${method} ${integration}/${action || ''}${param ? '/' + param : ''}`);

      let response;

      // GET /api/rate-limits/{integration}/config - Get default limits
      if (method === 'GET' && action === 'config') {
        const config = await getDefaultConfig(integration, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: config
          }
        };
      }
      // PUT /api/rate-limits/{integration}/config - Update default limits
      else if (method === 'PUT' && action === 'config') {
        const bodyText = await request.text();
        const config = JSON.parse(bodyText);
        const updated = await updateDefaultConfig(integration, config, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: updated,
            message: `Default rate limits updated for ${integration}`
          }
        };
      }
      // GET /api/rate-limits/{integration}/organizations - List org overrides
      else if (method === 'GET' && action === 'organizations' && !param) {
        const overrides = await listOrgOverrides(integration, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: overrides
          }
        };
      }
      // GET /api/rate-limits/{integration}/organizations/{orgId} - Get org limits
      else if (method === 'GET' && action === 'organizations' && param) {
        const config = await getOrgConfig(integration, param, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: config
          }
        };
      }
      // PUT /api/rate-limits/{integration}/organizations/{orgId} - Set org override
      else if (method === 'PUT' && action === 'organizations' && param) {
        const bodyText = await request.text();
        const config = JSON.parse(bodyText);
        const updated = await setOrgConfig(integration, param, config, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: updated,
            message: `Rate limit override set for ${integration}:${param}`
          }
        };
      }
      // DELETE /api/rate-limits/{integration}/organizations/{orgId} - Remove override
      else if (method === 'DELETE' && action === 'organizations' && param) {
        const result = await removeOrgConfig(integration, param, context);
        response = {
          status: result.success ? 200 : 404,
          body: result
        };
      }
      // GET /api/rate-limits/{integration}/stats - Get usage stats
      else if (method === 'GET' && action === 'stats') {
        const stats = await getStats(integration, context);
        response = {
          status: 200,
          body: {
            success: true,
            data: {
              integration,
              timestamp: new Date().toISOString(),
              stats
            }
          }
        };
      }
      // Unknown endpoint
      else {
        response = {
          status: 404,
          body: {
            success: false,
            error: 'Endpoint not found',
            availableEndpoints: [
              'GET    /api/rate-limits/{integration}/config',
              'PUT    /api/rate-limits/{integration}/config',
              'GET    /api/rate-limits/{integration}/organizations',
              'GET    /api/rate-limits/{integration}/organizations/{orgId}',
              'PUT    /api/rate-limits/{integration}/organizations/{orgId}',
              'DELETE /api/rate-limits/{integration}/organizations/{orgId}',
              'GET    /api/rate-limits/{integration}/stats'
            ]
          }
        };
      }

      const duration = Date.now() - startTime;

      // Track successful request
      telemetry.trackRequest(
        `ratelimit_${action || 'unknown'}`,
        duration,
        response.status < 400,
        integration,
        method,
        {
          action: action || 'none',
          param: param || 'none'
        }
      );

      return {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'X-Response-Time': `${duration}ms`
        },
        body: JSON.stringify(response.body)
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      context.error('Rate Limit API error:', error);

      // Track exception
      telemetry.trackException(error, {
        handler: 'RateLimitAPI',
        integration: request.params.integration || 'unknown',
        action: request.params.action || 'unknown'
      });

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Internal server error',
          message: error.message,
          duration,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});
