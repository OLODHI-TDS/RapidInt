const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { validateEntraToken, hasRole } = require('../../shared-services/shared/entra-auth-middleware');

/**
 * TDS Settings Azure Function
 * Manages centralized TDS API endpoint configuration for all integrations
 */
app.http('TDSSettings', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'settings/tds',
    handler: async (request, context) => {
        // Validate Entra ID token
        const authResult = await validateEntraToken(request, context);

        if (!authResult.isValid) {
            return {
                status: 401,
                jsonBody: {
                    error: 'Unauthorized',
                    message: authResult.error,
                    errorCode: authResult.errorCode
                }
            };
        }

        context.log(`✅ Authenticated user: ${authResult.user.email}`);

        try {
            const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
            const tableClient = TableClient.fromConnectionString(connectionString, 'TDSSettings');

            // Create table if it doesn't exist
            await tableClient.createTable().catch(() => {});

            if (request.method === 'GET') {
                try {
                    const entity = await tableClient.getEntity('Settings', 'TDSConfig');

                    context.log('📖 TDS settings retrieved successfully');

                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            settings: {
                                development: JSON.parse(entity.developmentSettings || '{}'),
                                production: JSON.parse(entity.productionSettings || '{}')
                            },
                            lastUpdated: entity.lastUpdated
                        }
                    };
                } catch (error) {
                    if (error.statusCode === 404) {
                        // Return defaults if settings not found
                        context.log('⚠️ TDS settings not found, returning defaults');

                        return {
                            status: 200,
                            jsonBody: {
                                success: true,
                                settings: {
                                    development: {
                                        legacyTdsApi: '',
                                        salesforceTdsApi: 'https://thedisputeservice--fullcopy.sandbox.my.salesforce.com'
                                    },
                                    production: {
                                        legacyTdsApi: '',
                                        salesforceTdsApi: 'https://thedisputeservice.my.salesforce.com'
                                    }
                                },
                                lastUpdated: null
                            }
                        };
                    }
                    throw error;
                }
            }

            if (request.method === 'POST') {
                const { development, production } = await request.json();

                // Validation
                if (!development || !production) {
                    return {
                        status: 400,
                        jsonBody: {
                            success: false,
                            error: 'Both development and production settings are required'
                        }
                    };
                }

                if (!development.salesforceTdsApi || !production.salesforceTdsApi) {
                    return {
                        status: 400,
                        jsonBody: {
                            success: false,
                            error: 'Salesforce TDS API URLs are required for both environments'
                        }
                    };
                }

                const entity = {
                    partitionKey: 'Settings',
                    rowKey: 'TDSConfig',
                    developmentSettings: JSON.stringify(development),
                    productionSettings: JSON.stringify(production),
                    lastUpdated: new Date().toISOString()
                };

                await tableClient.upsertEntity(entity, 'Replace');

                context.log('✅ TDS settings saved successfully');
                context.log(`   Development - Legacy: ${development.legacyTdsApi || 'Not set'}`);
                context.log(`   Development - Salesforce: ${development.salesforceTdsApi}`);
                context.log(`   Production - Legacy: ${production.legacyTdsApi || 'Not set'}`);
                context.log(`   Production - Salesforce: ${production.salesforceTdsApi}`);

                return {
                    status: 200,
                    jsonBody: {
                        success: true,
                        message: 'TDS settings saved successfully',
                        lastUpdated: entity.lastUpdated
                    }
                };
            }

        } catch (error) {
            context.log.error('❌ TDS settings error:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: error.message
                }
            };
        }
    }
});
