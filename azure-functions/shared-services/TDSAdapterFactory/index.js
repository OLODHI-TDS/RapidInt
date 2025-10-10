/**
 * Azure Function: TDS Adapter Factory
 *
 * Provides abstraction layer for different TDS API providers with hot-swappable capability.
 * Supports current TDS API and future Salesforce-based TDS API.
 *
 * Features:
 * - Provider abstraction with unified interface
 * - Configuration-driven provider switching
 * - Zero-downtime provider migration
 * - Comprehensive error handling and retry logic
 * - Status polling with exponential backoff
 * - Health checks for all providers
 *
 * Endpoints:
 * - POST /api/tds/create/{provider?} - Create deposit
 * - POST /api/tds/status/{provider?} - Check deposit status
 * - GET /api/tds/health/{provider?} - Health check
 * - GET /api/tds/config - Get current configuration
 */

const { app } = require('@azure/functions');
const axios = require('axios');
const { getSalesforceAuthHeader } = require('../shared/salesforce-auth');
const telemetry = require('../shared/telemetry');

// Provider configurations
const PROVIDERS = {
  current: {
    name: 'Current TDS API',
    version: '1.2',
    baseUrl: process.env.TDS_CURRENT_BASE_URL || 'https://sandbox.api.custodial.tenancydepositscheme.com/v1.2',
    authType: 'basic',
    healthEndpoint: '/health',
    createEndpoint: '/CreateDeposit',
    statusEndpoint: '/CreateDepositStatus',
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000
  },
  salesforce: {
    name: 'Salesforce EWC TDS API',
    version: '1.0',
    baseUrl: process.env.TDS_SALESFORCE_BASE_URL || 'https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com',
    authType: 'api-key',
    healthEndpoint: '/services/apexrest/branches',
    createEndpoint: '/services/apexrest/depositcreation',
    statusEndpoint: '/services/apexrest/CreateDepositStatus',
    infoEndpoint: '/services/apexrest/tenancyinformation',
    timeout: 45000,
    maxRetries: 3,
    retryDelay: 2000
  }
};

// Get active provider from configuration
function getActiveProvider() {
  const activeProvider = process.env.TDS_ACTIVE_PROVIDER || 'current';

  if (!PROVIDERS[activeProvider]) {
    throw new Error(`Invalid TDS provider: ${activeProvider}`);
  }

  return {
    name: activeProvider,
    config: PROVIDERS[activeProvider]
  };
}

/**
 * Abstract TDS Provider Interface
 */
class TDSProviderInterface {
  constructor(config) {
    this.config = config;
  }

  async createDeposit(payload) {
    throw new Error('createDeposit must be implemented by provider');
  }

  async getDepositStatus(batchId, credentials) {
    throw new Error('getDepositStatus must be implemented by provider');
  }

  async healthCheck() {
    throw new Error('healthCheck must be implemented by provider');
  }

  transformPayload(standardPayload) {
    throw new Error('transformPayload must be implemented by provider');
  }
}

/**
 * Current TDS API Implementation
 */
class CurrentTDSProvider extends TDSProviderInterface {
  constructor(config) {
    super(config);
  }

  async createDeposit(payload) {
    const url = `${this.config.baseUrl}${this.config.createEndpoint}`;
    const startTime = Date.now();

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: this.config.timeout
      });

      const duration = Date.now() - startTime;

      // Track successful dependency
      telemetry.trackDependency('current', 'CreateDeposit', duration, true, {
        statusCode: response.status
      });

      telemetry.trackProviderRequest('current', true);

      return {
        success: true,
        batch_id: response.data.batch_id,
        status: response.data.status || 'submitted',
        provider: 'current',
        response: response.data
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      // Track failed dependency
      telemetry.trackDependency('current', 'CreateDeposit', duration, false, {
        statusCode: error.response?.status || 500,
        errorType: error.name
      });

      telemetry.trackProviderRequest('current', false);
      telemetry.trackProviderError('current', error.name);
      telemetry.trackException(error, {
        provider: 'current',
        operation: 'createDeposit'
      });

      throw this.formatError(error, 'create_deposit');
    }
  }

  async getDepositStatus(batchId, credentials) {
    const url = `${this.config.baseUrl}${this.config.statusEndpoint}`;

    const statusPayload = {
      batch_id: batchId,
      ...credentials
    };

    try {
      const response = await axios.post(url, statusPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: this.config.timeout
      });

      return {
        batch_id: batchId,
        status: response.data.status,
        dan: response.data.dan,
        errors: response.data.errors,
        warnings: response.data.warnings,
        provider: 'current',
        response: response.data
      };

    } catch (error) {
      throw this.formatError(error, 'get_status');
    }
  }

  async healthCheck() {
    try {
      const response = await axios.get(`${this.config.baseUrl}/health`, {
        timeout: 10000
      });

      return {
        provider: 'current',
        status: 'healthy',
        version: this.config.version,
        responseTime: response.headers['x-response-time'],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        provider: 'current',
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  transformPayload(standardPayload) {
    // Transform standard payload to current TDS format
    return {
      organisation: {
        member_number: standardPayload.organization.memberNumber,
        branch_id: standardPayload.organization.branchId
      },
      deposits: [{
        deposit_amount: standardPayload.deposit.amount,
        tenancy_deposit_allocation_datetime: new Date().toISOString(),
        tenancy_start_date: standardPayload.deposit.tenancyStartDate,
        tenancy_end_date: standardPayload.deposit.tenancyEndDate,
        tenancy_term: standardPayload.deposit.tenancyTerm,
        property: {
          address_line_1: standardPayload.property.address.line1,
          address_line_2: standardPayload.property.address.line2 || '',
          address_line_3: standardPayload.property.address.line3 || '',
          address_line_4: standardPayload.property.address.line4 || '',
          postcode: standardPayload.property.address.postcode,
          county: standardPayload.property.address.county,
          property_type: standardPayload.property.type,
          bedrooms: standardPayload.property.bedrooms
        },
        landlord: {
          title: standardPayload.landlord.title,
          first_name: standardPayload.landlord.firstName,
          last_name: standardPayload.landlord.lastName,
          email: standardPayload.landlord.email,
          phone: standardPayload.landlord.phone,
          address: standardPayload.landlord.address
        },
        tenants: standardPayload.tenants.map(tenant => ({
          title: tenant.title,
          first_name: tenant.firstName,
          last_name: tenant.lastName,
          email: tenant.email,
          phone: tenant.phone
        }))
      }]
    };
  }

  formatError(error, operation) {
    if (error.response) {
      return new Error(`Current TDS API Error (${error.response.status}): ${error.response.data?.error || error.message}`);
    } else if (error.request) {
      return new Error(`Current TDS Network Error: ${error.message}`);
    } else {
      return new Error(`Current TDS ${operation} Error: ${error.message}`);
    }
  }
}

/**
 * Salesforce TDS API Implementation
 */
class SalesforceTDSProvider extends TDSProviderInterface {
  constructor(config, context) {
    super(config);
    this.context = context;
  }

  async createDeposit(payload) {
    const url = `${this.config.baseUrl}${this.config.createEndpoint}`;
    const startTime = Date.now();

    try {
      // Get Salesforce authentication headers
      const authHeaders = await getSalesforceAuthHeader(this.context);

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: this.config.timeout
      });

      const duration = Date.now() - startTime;

      // Track successful dependency
      telemetry.trackDependency('salesforce', 'CreateDeposit', duration, true, {
        statusCode: response.status
      });

      telemetry.trackProviderRequest('salesforce', true);

      return {
        success: true,
        batch_id: response.data.id, // Salesforce uses 'id' instead of 'batch_id'
        status: response.data.status || 'submitted',
        provider: 'salesforce',
        response: response.data
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      // Track failed dependency
      telemetry.trackDependency('salesforce', 'CreateDeposit', duration, false, {
        statusCode: error.response?.status || 500,
        errorType: error.name
      });

      telemetry.trackProviderRequest('salesforce', false);
      telemetry.trackProviderError('salesforce', error.name);
      telemetry.trackException(error, {
        provider: 'salesforce',
        operation: 'createDeposit'
      });

      throw this.formatError(error, 'create_deposit');
    }
  }

  async getDepositStatus(batchId, credentials) {
    const url = `${this.config.baseUrl}${this.config.statusEndpoint}/${batchId}`;

    try {
      // Get Salesforce authentication headers
      const authHeaders = await getSalesforceAuthHeader(this.context);

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          ...authHeaders
        },
        timeout: this.config.timeout
      });

      return {
        batch_id: batchId,
        status: response.data.Status__c, // Salesforce field naming
        dan: response.data.DAN_Number__c,
        errors: response.data.Errors__c,
        warnings: response.data.Warnings__c,
        provider: 'salesforce',
        response: response.data
      };

    } catch (error) {
      throw this.formatError(error, 'get_status');
    }
  }

  async healthCheck() {
    try {
      // Get Salesforce authentication headers
      const authHeaders = await getSalesforceAuthHeader(this.context);

      const response = await axios.get(`${this.config.baseUrl}${this.config.healthEndpoint}`, {
        headers: {
          ...authHeaders
        },
        timeout: 10000
      });

      return {
        provider: 'salesforce',
        status: 'healthy',
        version: this.config.version,
        responseTime: response.headers['x-response-time'],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        provider: 'salesforce',
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  transformPayload(standardPayload) {
    // Transform standard payload to Salesforce TDS format
    return {
      Organization__c: {
        Member_Number__c: standardPayload.organization.memberNumber,
        Branch_Id__c: standardPayload.organization.branchId
      },
      Deposits__c: [{
        Amount__c: standardPayload.deposit.amount,
        Allocation_DateTime__c: new Date().toISOString(),
        Tenancy_Start_Date__c: standardPayload.deposit.tenancyStartDate,
        Tenancy_End_Date__c: standardPayload.deposit.tenancyEndDate,
        Tenancy_Term__c: standardPayload.deposit.tenancyTerm,
        Property__c: {
          Address_Line_1__c: standardPayload.property.address.line1,
          Postcode__c: standardPayload.property.address.postcode,
          County__c: standardPayload.property.address.county,
          Property_Type__c: standardPayload.property.type,
          Bedrooms__c: standardPayload.property.bedrooms
        },
        Landlord__c: {
          First_Name__c: standardPayload.landlord.firstName,
          Last_Name__c: standardPayload.landlord.lastName,
          Email__c: standardPayload.landlord.email,
          Phone__c: standardPayload.landlord.phone
        },
        Tenants__c: standardPayload.tenants.map(tenant => ({
          First_Name__c: tenant.firstName,
          Last_Name__c: tenant.lastName,
          Email__c: tenant.email,
          Phone__c: tenant.phone
        }))
      }]
    };
  }

  formatError(error, operation) {
    if (error.response) {
      return new Error(`Salesforce TDS API Error (${error.response.status}): ${error.response.data?.error || error.message}`);
    } else if (error.request) {
      return new Error(`Salesforce TDS Network Error: ${error.message}`);
    } else {
      return new Error(`Salesforce TDS ${operation} Error: ${error.message}`);
    }
  }
}

/**
 * Factory function to create provider instance
 */
function createProvider(providerName, context) {
  const config = PROVIDERS[providerName];

  if (!config) {
    throw new Error(`Unknown TDS provider: ${providerName}`);
  }

  switch (providerName) {
    case 'current':
      return new CurrentTDSProvider(config);
    case 'salesforce':
      return new SalesforceTDSProvider(config, context);
    default:
      throw new Error(`Unsupported TDS provider: ${providerName}`);
  }
}

/**
 * Retry mechanism with exponential backoff
 */
async function withRetry(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      const backoffDelay = delay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Dual-execution mode: Execute request on both providers
 */
async function executeDualMode(standardPayload, action, credentials, context) {
  const currentProvider = createProvider('current', context);
  const salesforceProvider = createProvider('salesforce', context);

  context.log('Executing dual-mode: both Current and Salesforce providers');

  // Transform payload for each provider
  const currentPayload = currentProvider.transformPayload(standardPayload);
  const salesforcePayload = salesforceProvider.transformPayload(standardPayload);

  // Execute both in parallel
  const [currentResult, salesforceResult] = await Promise.allSettled([
    action === 'create'
      ? currentProvider.createDeposit(currentPayload)
      : currentProvider.getDepositStatus(credentials.batch_id, credentials),
    action === 'create'
      ? salesforceProvider.createDeposit(salesforcePayload)
      : salesforceProvider.getDepositStatus(credentials.batch_id, credentials)
  ]);

  // Compile results
  const result = {
    mode: 'dual',
    current: {
      success: currentResult.status === 'fulfilled',
      data: currentResult.status === 'fulfilled' ? currentResult.value : null,
      error: currentResult.status === 'rejected' ? currentResult.reason.message : null
    },
    salesforce: {
      success: salesforceResult.status === 'fulfilled',
      data: salesforceResult.status === 'fulfilled' ? salesforceResult.value : null,
      error: salesforceResult.status === 'rejected' ? salesforceResult.reason.message : null
    },
    comparison: null
  };

  // Compare results if both succeeded
  if (result.current.success && result.salesforce.success) {
    result.comparison = {
      statusMatch: result.current.data.status === result.salesforce.data.status,
      batchIdMatch: result.current.data.batch_id === result.salesforce.data.batch_id,
      dataMatch: JSON.stringify(result.current.data) === JSON.stringify(result.salesforce.data)
    };

    // Track comparison result
    telemetry.trackComparisonResult(
      result.comparison.statusMatch,
      result.comparison.dataMatch,
      {
        batchIdMatch: result.comparison.batchIdMatch.toString(),
        action
      }
    );

    if (!result.comparison.dataMatch) {
      context.warn('Dual-mode detected differences between providers', result.comparison);
    }
  }

  // Track dual-mode execution (get durations from provider data if available)
  const currentDuration = result.current.data?.duration || 0;
  const salesforceDuration = result.salesforce.data?.duration || 0;

  telemetry.trackDualModeExecution(
    result.current.success,
    result.salesforce.success,
    result.comparison?.dataMatch || false,
    currentDuration,
    salesforceDuration
  );

  // Return primary result (prefer Salesforce if both succeeded)
  result.primaryResult = result.salesforce.success ? result.salesforce.data : result.current.data;
  result.provider = result.salesforce.success ? 'salesforce' : 'current';

  return result;
}

// Azure Function: TDS Adapter Factory
app.http('TDSAdapterFactory', {
  methods: ['POST', 'GET'],
  route: 'tds/{action}/{provider?}',
  authLevel: 'function',
  handler: async (request, context) => {
    const startTime = Date.now();

    try {
      const action = request.params.action;
      const requestedProvider = request.params.provider;

      // Get provider (use requested or active)
      const providerName = requestedProvider || getActiveProvider().name;
      const provider = createProvider(providerName, context);

      context.log(`TDS ${action} request using ${providerName} provider`);

      // Check if dual-mode is enabled
      const dualMode = process.env.TDS_DUAL_MODE === 'true';

      switch (action) {
        case 'create':
          const body = await request.text();
          const createPayload = JSON.parse(body);

          let createResult;

          if (dualMode) {
            // Execute on both providers
            createResult = await executeDualMode(createPayload, 'create', null, context);
          } else {
            // Single provider execution
            // Transform payload to provider format
            const transformedPayload = provider.transformPayload(createPayload);

            // Create deposit with retry
            createResult = await withRetry(
              () => provider.createDeposit(transformedPayload),
              provider.config.maxRetries,
              provider.config.retryDelay
            );
          }

          const duration = Date.now() - startTime;
          const success = dualMode ? (createResult.primaryResult?.success !== false) : createResult.success;

          // Track request
          telemetry.trackRequest(
            'create',
            duration,
            success,
            dualMode ? createResult.provider : providerName,
            dualMode ? 'dual' : 'single'
          );

          return {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Response-Time': `${duration}ms`,
              'X-TDS-Provider': dualMode ? 'dual' : providerName,
              'X-TDS-Mode': dualMode ? 'dual' : 'single'
            },
            body: JSON.stringify(dualMode ? createResult : createResult)
          };

        case 'status':
          const statusBody = await request.text();
          const statusRequest = JSON.parse(statusBody);

          let statusResult;

          if (dualMode) {
            // Execute on both providers
            statusResult = await executeDualMode(null, 'status', statusRequest, context);
          } else {
            // Single provider execution
            statusResult = await withRetry(
              () => provider.getDepositStatus(statusRequest.batch_id, statusRequest.credentials),
              provider.config.maxRetries,
              provider.config.retryDelay
            );
          }

          return {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Response-Time': `${Date.now() - startTime}ms`,
              'X-TDS-Provider': dualMode ? 'dual' : providerName,
              'X-TDS-Mode': dualMode ? 'dual' : 'single'
            },
            body: JSON.stringify(dualMode ? statusResult : statusResult)
          };

        case 'health':
          const healthResult = await provider.healthCheck();

          return {
            status: healthResult.status === 'healthy' ? 200 : 503,
            headers: {
              'Content-Type': 'application/json',
              'X-Response-Time': `${Date.now() - startTime}ms`,
              'X-TDS-Provider': providerName
            },
            body: JSON.stringify(healthResult)
          };

        case 'config':
          if (request.method === 'GET') {
            const activeProvider = getActiveProvider();
            return {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                activeProvider: activeProvider.name,
                availableProviders: Object.keys(PROVIDERS),
                configuration: {
                  [activeProvider.name]: {
                    name: activeProvider.config.name,
                    version: activeProvider.config.version,
                    baseUrl: activeProvider.config.baseUrl,
                    authType: activeProvider.config.authType
                  }
                },
                switchingInstructions: {
                  environment: 'Set TDS_ACTIVE_PROVIDER environment variable',
                  values: Object.keys(PROVIDERS),
                  restartRequired: false
                }
              })
            };
          }
          break;

        default:
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: 'Invalid action',
              validActions: ['create', 'status', 'health', 'config'],
              usage: 'POST /api/tds/{action}/{provider?}'
            })
          };
      }

    } catch (error) {
      context.error('TDS Adapter Factory error:', error);

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'TDS operation failed',
          message: error.message,
          provider: request.params.provider || 'unknown',
          action: request.params.action,
          requestId: context.invocationId,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});