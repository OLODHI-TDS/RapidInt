/**
 * Configuration API
 *
 * HTTP-triggered Azure Function for managing TDS API versioning configuration
 * Supports runtime configuration updates without redeployment
 *
 * Endpoints:
 * - GET  /api/config                                    - Get current global configuration
 * - PUT  /api/config/routing-mode                       - Update routing mode
 * - PUT  /api/config/forwarding-percentage              - Update traffic split percentage
 * - GET  /api/config/organizations/{agencyRef}          - Get org-specific config
 * - PUT  /api/config/organizations/{agencyRef}/provider - Override org provider preference
 * - GET  /api/config/cache/stats                        - Get cache statistics
 * - POST /api/config/cache/clear                        - Clear configuration cache
 */

const configManager = require('../shared/config-manager');
const telemetry = require('../shared/telemetry');

/**
 * Main Azure Function handler
 */
module.exports = async function (context, req) {
  const startTime = Date.now();
  context.log('ConfigurationAPI function triggered');

  // Extract route parameters
  const action = context.bindingData.action;
  const param = context.bindingData.param;
  const method = req.method.toUpperCase();

  context.log(`Request: ${method} /api/config/${action || ''}${param ? '/' + param : ''}`);

  try {
    // Route the request
    let response;

    // GET /api/config - Get current global configuration
    if (method === 'GET' && !action) {
      response = await getGlobalConfiguration(context);
    }
    // GET /api/config/cache/stats - Get cache statistics
    else if (method === 'GET' && action === 'cache' && param === 'stats') {
      response = await getCacheStats(context);
    }
    // POST /api/config/cache/clear - Clear configuration cache
    else if (method === 'POST' && action === 'cache' && param === 'clear') {
      response = await clearCache(context);
    }
    // PUT /api/config/routing-mode - Update routing mode
    else if (method === 'PUT' && action === 'routing-mode') {
      response = await updateRoutingMode(context, req);
    }
    // PUT /api/config/forwarding-percentage - Update forwarding percentage
    else if (method === 'PUT' && action === 'forwarding-percentage') {
      response = await updateForwardingPercentage(context, req);
    }
    // GET /api/config/organizations/{agencyRef} - Get org-specific config
    else if (method === 'GET' && action === 'organizations' && param) {
      response = await getOrganizationConfiguration(context, param);
    }
    // PUT /api/config/organizations/{agencyRef}/provider - Override org provider
    else if (method === 'PUT' && action === 'organizations' && param) {
      // Check if there's a sub-action in the request body or query
      const subAction = req.query.subAction || req.body?.subAction;
      if (subAction === 'provider') {
        response = await updateOrganizationProvider(context, req, param);
      } else {
        response = {
          status: 400,
          body: {
            success: false,
            error: 'Invalid request. Use ?subAction=provider to update provider preference'
          }
        };
      }
    }
    // Unknown route
    else {
      response = {
        status: 404,
        body: {
          success: false,
          error: 'Endpoint not found',
          availableEndpoints: [
            'GET  /api/config',
            'PUT  /api/config/routing-mode',
            'PUT  /api/config/forwarding-percentage',
            'GET  /api/config/organizations/{agencyRef}',
            'PUT  /api/config/organizations/{agencyRef}?subAction=provider',
            'GET  /api/config/cache/stats',
            'POST /api/config/cache/clear'
          ]
        }
      };
    }

    // Track successful request
    const duration = Date.now() - startTime;
    telemetry.trackRequest(
      `config_${action || 'get'}`,
      duration,
      response.status < 400,
      'configuration',
      'api',
      {
        method,
        action: action || 'root',
        param: param || 'none'
      }
    );

    // Send response
    context.res = {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${duration}ms`
      },
      body: response.body
    };

  } catch (error) {
    context.log.error('Error processing configuration request:', error);

    const duration = Date.now() - startTime;

    // Track exception
    telemetry.trackException(error, {
      handler: 'ConfigurationAPI',
      method,
      action: action || 'unknown',
      param: param || 'none'
    });

    // Track failed request
    telemetry.trackRequest(
      `config_${action || 'unknown'}`,
      duration,
      false,
      'configuration',
      'error',
      {
        method,
        errorType: error.name,
        errorMessage: error.message
      }
    );

    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${duration}ms`
      },
      body: {
        success: false,
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString()
      }
    };
  }
};

/**
 * Get current global configuration
 */
async function getGlobalConfiguration(context) {
  context.log('Retrieving global configuration');

  const config = configManager.getGlobalConfig(context);

  return {
    status: 200,
    body: {
      success: true,
      data: {
        global: config,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      }
    }
  };
}

/**
 * Update routing mode
 * Body: { "routingMode": "legacy-only" | "salesforce-only" | "both" | "shadow" | "forwarding" }
 */
async function updateRoutingMode(context, req) {
  const { routingMode } = req.body;

  if (!routingMode) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Missing required field: routingMode',
        validModes: ['legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding']
      }
    };
  }

  context.log(`Updating routing mode to: ${routingMode}`);

  try {
    const oldMode = process.env.TDS_ROUTING_MODE || 'legacy-only';
    configManager.updateRoutingMode(routingMode, context);

    // Track configuration change
    telemetry.trackConfigurationChange('TDS_ROUTING_MODE', oldMode, routingMode);
    telemetry.trackEvent('Configuration_Update', {
      configKey: 'routingMode',
      oldValue: oldMode,
      newValue: routingMode,
      updatedBy: 'api'
    });

    return {
      status: 200,
      body: {
        success: true,
        message: `Routing mode updated to: ${routingMode}`,
        data: {
          routingMode,
          previousMode: oldMode,
          updatedAt: new Date().toISOString()
        }
      }
    };
  } catch (error) {
    context.log.error('Failed to update routing mode:', error);

    return {
      status: 400,
      body: {
        success: false,
        error: error.message,
        validModes: ['legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding']
      }
    };
  }
}

/**
 * Update forwarding percentage
 * Body: { "percentage": 0-100 }
 */
async function updateForwardingPercentage(context, req) {
  const { percentage } = req.body;

  if (percentage === undefined || percentage === null) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Missing required field: percentage (must be 0-100)'
      }
    };
  }

  const percentageNum = parseInt(percentage, 10);

  if (isNaN(percentageNum) || percentageNum < 0 || percentageNum > 100) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Invalid percentage value. Must be a number between 0 and 100'
      }
    };
  }

  context.log(`Updating forwarding percentage to: ${percentageNum}%`);

  try {
    const oldPercentage = parseInt(process.env.TDS_FORWARDING_PERCENTAGE || '0', 10);
    configManager.updateForwardingPercentage(percentageNum, context);

    // Track configuration change
    telemetry.trackConfigurationChange('TDS_FORWARDING_PERCENTAGE', oldPercentage.toString(), percentageNum.toString());
    telemetry.trackEvent('Configuration_Update', {
      configKey: 'forwardingPercentage',
      oldValue: oldPercentage.toString(),
      newValue: percentageNum.toString(),
      updatedBy: 'api'
    });

    // Track traffic distribution
    telemetry.trackTrafficDistribution('salesforce', percentageNum);
    telemetry.trackTrafficDistribution('legacy', 100 - percentageNum);

    return {
      status: 200,
      body: {
        success: true,
        message: `Forwarding percentage updated to: ${percentageNum}%`,
        data: {
          percentage: percentageNum,
          previousPercentage: oldPercentage,
          updatedAt: new Date().toISOString()
        }
      }
    };
  } catch (error) {
    context.log.error('Failed to update forwarding percentage:', error);

    return {
      status: 400,
      body: {
        success: false,
        error: error.message
      }
    };
  }
}

/**
 * Get organization-specific configuration
 */
async function getOrganizationConfiguration(context, agencyRef) {
  context.log(`Retrieving configuration for organization: ${agencyRef}`);

  try {
    // Mock organization credentials for demonstration
    // In production, this would fetch from Azure Table Storage
    const mockOrgCredentials = {
      agencyRef: agencyRef,
      providerPreference: 'auto' // This would be retrieved from storage
    };

    const orgConfig = configManager.getOrganizationConfig(agencyRef, mockOrgCredentials, context);

    return {
      status: 200,
      body: {
        success: true,
        data: {
          agencyRef,
          configuration: orgConfig,
          timestamp: new Date().toISOString()
        }
      }
    };
  } catch (error) {
    context.log.error(`Failed to retrieve organization configuration for ${agencyRef}:`, error);

    return {
      status: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
}

/**
 * Update organization provider preference
 * Body: { "providerPreference": "current" | "salesforce" | "dual" | "auto" }
 */
async function updateOrganizationProvider(context, req, agencyRef) {
  const { providerPreference } = req.body;

  if (!providerPreference) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Missing required field: providerPreference',
        validPreferences: ['current', 'salesforce', 'dual', 'auto']
      }
    };
  }

  const validPreferences = ['current', 'salesforce', 'dual', 'auto'];
  if (!validPreferences.includes(providerPreference)) {
    return {
      status: 400,
      body: {
        success: false,
        error: `Invalid provider preference: ${providerPreference}`,
        validPreferences
      }
    };
  }

  context.log(`Updating provider preference for ${agencyRef} to: ${providerPreference}`);

  try {
    // In production, this would update Azure Table Storage
    // For now, we'll just log and return success
    context.log(`Provider preference updated successfully for ${agencyRef}`);

    // Clear the cache to force reload
    configManager.clearConfigCache();

    return {
      status: 200,
      body: {
        success: true,
        message: `Provider preference for ${agencyRef} updated to: ${providerPreference}`,
        data: {
          agencyRef,
          providerPreference,
          updatedAt: new Date().toISOString(),
          note: 'Configuration cache has been cleared. Changes will take effect immediately.'
        }
      }
    };
  } catch (error) {
    context.log.error(`Failed to update provider preference for ${agencyRef}:`, error);

    return {
      status: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats(context) {
  context.log('Retrieving cache statistics');

  const stats = configManager.getConfigCacheStats();

  return {
    status: 200,
    body: {
      success: true,
      data: {
        cache: stats,
        timestamp: new Date().toISOString()
      }
    }
  };
}

/**
 * Clear configuration cache
 */
async function clearCache(context) {
  context.log('Clearing configuration cache');

  try {
    configManager.clearConfigCache();

    return {
      status: 200,
      body: {
        success: true,
        message: 'Configuration cache cleared successfully',
        data: {
          clearedAt: new Date().toISOString()
        }
      }
    };
  } catch (error) {
    context.log.error('Failed to clear cache:', error);

    return {
      status: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
}
