const { app } = require('@azure/functions');

// Load all function modules
require('./PostcodeLookup');
require('./TDSAdapter');
require('./OrganizationMapping');
require('./AltoWebhook');
require('./AltoIntegration');
require('./WorkflowOrchestrator');
require('./PendingIntegrationsManager');
require('./PendingPollingService');
require('./PollingSettings');
require('./TDSSettings');
require('./AltoSettings');
require('./Auth');

// Simple test function
app.http('test', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'test',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);

        const name = request.query.get('name') || 'World';

        return {
            status: 200,
            body: `Hello, ${name}! Azure Functions is working with Node.js v20! 🎉`,
            headers: {
                'Content-Type': 'text/plain'
            }
        };
    }
});

// Health check endpoint
app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health',
    handler: async (request, context) => {
        return {
            status: 200,
            jsonBody: {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                nodeVersion: process.version,
                platform: process.platform,
                functions: {
                    test: 'GET /api/test',
                    postcodeLookup: 'GET /api/postcode/{postcode}',
                    postcodeBatch: 'POST /api/postcode',
                    tdsCreate: 'POST /api/tds/create',
                    tdsStatus: 'GET /api/tds/status/{depositId}',
                    tdsHealth: 'GET /api/tds/health',
                    organizationLookup: 'GET /api/organization/lookup?agencyRef={ref}',
                    organizationList: 'GET /api/organization/list',
                    organizationAdd: 'POST /api/organization/add',
                    altoWebhook: 'POST /api/webhooks/alto',
                    altoFetchTenancy: 'POST /api/alto/fetch-tenancy/{tenancyId}',
                    altoHealth: 'GET /api/alto/health',
                    workflowOrchestrator: 'POST /api/workflows/alto-tds',
                    pendingIntegrationsList: 'GET /api/pending-integrations/list',
                    pendingIntegrationsGet: 'GET /api/pending-integrations/get/{id}',
                    pendingIntegrationsRetry: 'POST /api/pending-integrations/retry/{id}',
                    pendingIntegrationsCancel: 'DELETE /api/pending-integrations/cancel/{id}',
                    pendingIntegrationsStats: 'GET /api/pending-integrations/stats',
                    pendingIntegrationsForcePoll: 'POST /api/pending-integrations/force-poll',
                    pollingSettingsGet: 'GET /api/polling/settings',
                    pollingSettingsSave: 'POST /api/polling/settings',
                    tdsSettingsGet: 'GET /api/settings/tds',
                    tdsSettingsSave: 'POST /api/settings/tds',
                    altoSettingsGet: 'GET /api/settings/alto',
                    altoSettingsSave: 'POST /api/settings/alto',
                    authLogin: 'GET /api/auth/login',
                    authCallback: 'GET /api/auth/callback',
                    authMe: 'GET /api/auth/me',
                    authLogout: 'POST /api/auth/logout'
                }
            }
        };
    }
});