const { app } = require('@azure/functions');
const axios = require('axios');
const telemetry = require('../../shared-services/shared/telemetry');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');
const { validateEntraToken, hasRole } = require('../../shared-services/shared/entra-auth-middleware');
const { AltoAPIClient } = require('../../shared-services/shared/alto-api-client');

/**
 * Alto Integration Service Azure Function
 * Fetches tenancy, property, and contact data from Alto APIs
 */
app.http('AltoIntegration', {
    methods: ['POST', 'GET'],
    authLevel: 'anonymous',
    route: 'alto/{action?}/{tenancyId?}',
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
            const action = request.params.action;
            const tenancyId = request.params.tenancyId;

            // Get environment from request body or default to development
            let environment = 'development';
            let requestBody = {};
            let testMode = false;
            let testConfig = {};

            if (request.method === 'POST') {
                try {
                    requestBody = await request.json();

                    // ✅ HIGH-006 FIX: Validate request body for fetch-tenancy action
                    if (action === 'fetch-tenancy') {
                        try {
                            requestBody = validateRequestBody(requestBody, schemas.fetchTenancyRequest);
                            context.log('✅ Fetch tenancy request validation passed');
                        } catch (validationError) {
                            if (validationError.name === 'ValidationError') {
                                context.warn('❌ Fetch tenancy request validation failed:', validationError.validationErrors);

                                // Track validation failure
                                telemetry.trackEvent('AltoIntegration_Validation_Failed', {
                                    action: 'fetch-tenancy',
                                    errorCount: validationError.validationErrors.length.toString(),
                                    firstError: validationError.validationErrors[0]?.param || 'unknown'
                                });

                                return {
                                    status: 400,
                                    jsonBody: formatValidationError(validationError)
                                };
                            }
                            // Re-throw unexpected errors
                            throw validationError;
                        }
                    }

                    environment = requestBody.environment || 'development';
                    testMode = requestBody.testMode || false;
                    testConfig = requestBody.testConfig || {};
                } catch (error) {
                    // Body might be empty, use default
                }
            }

            // Fetch Alto Settings to get dynamic API URLs
            let altoApiUrl = process.env.ALTO_API_BASE_URL || 'https://api.alto.zoopladev.co.uk';

            try {
                const functionKey = process.env.AZURE_FUNCTION_KEY || process.env.FUNCTION_KEY || '';
                const altoSettingsUrl = new URL(`${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/settings/alto`);
                if (functionKey) {
                    altoSettingsUrl.searchParams.append('code', functionKey);
                }

                const altoSettingsResponse = await fetch(altoSettingsUrl.toString());

                if (altoSettingsResponse.ok) {
                    const settingsResult = await altoSettingsResponse.json();
                    if (settingsResult.success && settingsResult.settings) {
                        // API URL based on environment (dev or prod)
                        // Auth and API use the same base URL
                        altoApiUrl = environment === 'production'
                            ? settingsResult.settings.production.altoApi || altoApiUrl
                            : settingsResult.settings.development.altoApi || altoApiUrl;

                        context.log(`✅ Using Alto API URL for ${environment}: ${altoApiUrl}`);
                    }
                }
            } catch (error) {
                context.warn('Failed to load Alto settings, using defaults:', error.message);
            }

            // Remove trailing slash from base URL to prevent double slashes
            altoApiUrl = altoApiUrl.replace(/\/$/, '');

            // Initialize Alto API client - auth and API use same base URL
            const altoClient = new AltoAPIClient({
                baseUrl: altoApiUrl,
                clientId: process.env.ALTO_CLIENT_ID,
                clientSecret: process.env.ALTO_CLIENT_SECRET,
                timeout: 30000,
                context: context
            });

            switch (action) {
                case 'fetch-tenancy':
                    if (!tenancyId) {
                        return { status: 400, jsonBody: { error: 'Tenancy ID required' } };
                    }

                    // Get agencyRef and branchId from request body
                    const agencyRef = requestBody.agencyRef;
                    const branchId = requestBody.branchId;

                    context.log('📋 Fetch tenancy request:', { tenancyId, agencyRef, branchId, method: request.method, requestBody });

                    if (!agencyRef) {
                        return {
                            status: 400,
                            jsonBody: {
                                error: 'agencyRef is required',
                                receivedBody: requestBody,
                                method: request.method
                            }
                        };
                    }

                    const tenancyData = await altoClient.fetchFullTenancyData(
                        tenancyId,
                        agencyRef,
                        branchId,
                        testMode,
                        testConfig
                    );
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            tenancyId,
                            data: tenancyData,
                            testMode: testMode,  // Include test mode flag in response
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'health':
                    const healthCheck = await altoClient.healthCheck();
                    return {
                        status: healthCheck.success ? 200 : 503,
                        jsonBody: {
                            ...healthCheck,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'test':
                    // Test with sample data
                    const testResult = await altoClient.testConnection();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            message: 'Alto API connection test',
                            result: testResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                default:
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Invalid action',
                            availableActions: ['fetch-tenancy', 'health', 'test'],
                            usage: {
                                fetchTenancy: 'POST /api/alto/fetch-tenancy/{tenancyId}',
                                health: 'GET /api/alto/health',
                                test: 'GET /api/alto/test'
                            }
                        }
                    };
            }

        } catch (error) {
            context.log('❌ Alto integration error:', error);

            // Determine if this is an authorization error
            const isAuthError = error.message && error.message.includes('Authorization failed');

            return {
                status: isAuthError ? 403 : 500,
                jsonBody: {
                    error: isAuthError ? 'Access denied' : 'Alto integration failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

// AltoAPIClient class now imported from shared-services/shared/alto-api-client.js