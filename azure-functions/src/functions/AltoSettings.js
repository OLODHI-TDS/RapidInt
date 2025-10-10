const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

/**
 * Alto Settings Azure Function
 * Manages Alto API endpoint configuration for development and production environments
 */
app.http('AltoSettings', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    route: 'settings/alto',
    handler: async (request, context) => {
        try {
            const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
            const tableClient = TableClient.fromConnectionString(connectionString, 'AltoSettings');

            // Create table if it doesn't exist
            await tableClient.createTable().catch(() => {});

            if (request.method === 'GET') {
                try {
                    const entity = await tableClient.getEntity('Settings', 'AltoConfig');

                    context.log('📖 Alto settings retrieved successfully');

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
                        context.log('⚠️ Alto settings not found, returning defaults');

                        return {
                            status: 200,
                            jsonBody: {
                                success: true,
                                settings: {
                                    development: {
                                        altoApi: 'https://sandbox-api.alto.property'
                                    },
                                    production: {
                                        altoApi: ''
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

                if (!development.altoApi) {
                    return {
                        status: 400,
                        jsonBody: {
                            success: false,
                            error: 'Development Alto API URL is required'
                        }
                    };
                }

                const entity = {
                    partitionKey: 'Settings',
                    rowKey: 'AltoConfig',
                    developmentSettings: JSON.stringify(development),
                    productionSettings: JSON.stringify(production),
                    lastUpdated: new Date().toISOString()
                };

                await tableClient.upsertEntity(entity, 'Replace');

                context.log('✅ Alto settings saved successfully');
                context.log(`   Development - Alto API: ${development.altoApi}`);
                context.log(`   Production - Alto API: ${production.altoApi || 'Not set'}`);

                return {
                    status: 200,
                    jsonBody: {
                        success: true,
                        message: 'Alto settings saved successfully',
                        lastUpdated: entity.lastUpdated
                    }
                };
            }

        } catch (error) {
            context.log.error('❌ Alto settings error:', error);
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
