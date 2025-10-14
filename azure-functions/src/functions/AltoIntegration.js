const { app } = require('@azure/functions');
const axios = require('axios');
const telemetry = require('../../shared-services/shared/telemetry');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');

/**
 * Alto Integration Service Azure Function
 * Fetches tenancy, property, and contact data from Alto APIs
 */
app.http('AltoIntegration', {
    methods: ['POST', 'GET'],
    authLevel: 'function',
    route: 'alto/{action?}/{tenancyId?}',
    handler: async (request, context) => {
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
                const altoSettingsResponse = await fetch(
                    `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/settings/alto`
                );

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
                context.log.warn('Failed to load Alto settings, using defaults:', error.message);
            }

            // Remove trailing slash from base URL to prevent double slashes
            altoApiUrl = altoApiUrl.replace(/\/$/, '');

            // Initialize Alto API client - auth and API use same base URL
            const altoClient = new AltoAPIClient({
                baseUrl: altoApiUrl,
                clientId: process.env.ALTO_CLIENT_ID,
                clientSecret: process.env.ALTO_CLIENT_SECRET,
                timeout: 30000
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

/**
 * Alto API Client Class
 */
class AltoAPIClient {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.timeout = config.timeout || 90000;
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Generate Basic Auth header for token endpoint
     */
    generateBasicAuth() {
        const credentials = `${this.clientId}:${this.clientSecret}`;
        return Buffer.from(credentials).toString('base64');
    }

    /**
     * Get access token from Alto using Basic Auth + client credentials
     */
    async getAccessToken() {
        if (this.accessToken && this.tokenExpiry > Date.now()) {
            return this.accessToken;
        }

        try {
            // For development, use mock token
            if (process.env.NODE_ENV === 'development') {
                this.accessToken = 'mock_token_' + Date.now();
                this.tokenExpiry = Date.now() + (3600 * 1000); // 1 hour
                return this.accessToken;
            }

            const tokenUrl = `${this.baseUrl}/token`;
            console.log('🔐 Attempting Alto authentication:');
            console.log(`   URL: ${tokenUrl}`);
            console.log(`   Client ID: ${this.clientId ? this.clientId.substring(0, 10) + '...' : 'NOT SET'}`);
            console.log(`   Client Secret: ${this.clientSecret ? '***SET***' : 'NOT SET'}`);

            // Token endpoint uses same base URL as API endpoints
            const response = await axios.post(tokenUrl, 'grant_type=client_credentials', {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${this.generateBasicAuth()}`
                }
            });

            if (!response.data.access_token) {
                throw new Error('No access token in response');
            }

            this.accessToken = response.data.access_token;

            // Calculate expiry time (default to 1 hour if not provided)
            const expiresIn = response.data.expires_in || 3600;
            this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000; // Subtract 60 seconds for safety

            console.log('✅ Alto authentication successful');
            return this.accessToken;

        } catch (error) {
            console.log('❌ Alto authentication failed:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw new Error(`Failed to get Alto access token: ${error.message}`);
        }
    }

    /**
     * Make authenticated API request with AgencyRef header
     */
    async makeRequest(method, endpoint, data = null, agencyRef = null) {
        const token = await this.getAccessToken();

        const config = {
            method,
            url: `${this.baseUrl}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: this.timeout
        };

        // Add AgencyRef header if provided
        if (agencyRef) {
            config.headers['AgencyRef'] = agencyRef;
        }

        if (data) {
            config.data = data;
        }

        // For development, return mock data
        if (process.env.NODE_ENV === 'development') {
            return this.getMockData(endpoint, method);
        }

        const response = await axios(config);
        return response.data;
    }

    /**
     * Fetch complete tenancy data including property and contacts
     * @param {string} tenancyId - The tenancy ID to fetch
     * @param {string} agencyRef - The agency reference for authorization
     * @param {string} expectedBranchId - The branch ID that should own this tenancy (for authorization)
     * @param {boolean} testMode - If true, verify OAuth then return fake data
     * @param {Object} testConfig - Configuration for fake data generation
     */
    async fetchFullTenancyData(tenancyId, agencyRef, expectedBranchId, testMode = false, testConfig = {}) {
        if (!agencyRef) {
            throw new Error('agencyRef is required to fetch tenancy data from Alto API');
        }

        // ✅ TEST MODE: Verify OAuth then return fake data
        if (testMode) {
            console.log('🧪 TEST MODE: Verifying Alto OAuth credentials...');

            // Verify OAuth works (will throw error if credentials invalid)
            await this.getAccessToken();
            console.log('✅ TEST MODE: Alto OAuth verified successfully');

            // Generate fake data using test-data-generator
            const { generateAltoTenancyData } = require('../../shared-services/shared/test-data-generator');

            const fakeData = generateAltoTenancyData({
                ...testConfig,
                agencyRef: agencyRef,
                branchId: expectedBranchId || 'DEFAULT'
            });

            console.log('🎭 TEST MODE: Generated fake Alto data');
            console.log('   Tenancy ID:', fakeData.tenancy.id);
            console.log('   Rent:', fakeData.tenancy.rent);
            console.log('   Deposit:', fakeData.tenancy.depositRequested);
            console.log('   Property:', fakeData.property.displayAddress);
            console.log('   Landlords:', fakeData.landlords.totalCount);
            console.log('   Tenants:', fakeData.tenants.length);

            return fakeData;
        }

        // ✅ PRODUCTION MODE: Normal Alto API calls
        try {
            // Fetch tenancy details first
            const tenancy = await this.makeRequest('GET', `/tenancies/${tenancyId}`, null, agencyRef);

            // ✅ SECURITY: Validate branch authorization
            // Ensure the tenancy belongs to the branch that requested it
            if (expectedBranchId && tenancy.branchId) {
                const returnedBranchId = String(tenancy.branchId);
                const requestedBranchId = String(expectedBranchId);

                // Skip validation for "DEFAULT" branch (org-wide access)
                const isDefaultBranch = requestedBranchId.toUpperCase() === 'DEFAULT';

                if (!isDefaultBranch && returnedBranchId !== requestedBranchId) {
                    // Log security event for unauthorized access attempt
                    console.error('🚨 SECURITY: Cross-branch access attempt blocked', {
                        tenancyId,
                        requestedBranch: requestedBranchId,
                        actualBranch: returnedBranchId,
                        agencyRef,
                        timestamp: new Date().toISOString()
                    });

                    // Track security event in telemetry
                    telemetry.trackEvent('Security_CrossBranchAccessBlocked', {
                        tenancyId: tenancyId.toString(),
                        requestedBranch: requestedBranchId,
                        actualBranch: returnedBranchId,
                        agencyRef,
                        severity: 'HIGH'
                    });

                    // Throw authorization error
                    throw new Error(
                        `Authorization failed: Tenancy ${tenancyId} belongs to branch ${returnedBranchId}, ` +
                        `but was requested by branch ${requestedBranchId}`
                    );
                }
            }

            // Extract inventory ID from tenancy data
            const inventoryId = tenancy.propertyId || tenancy.inventoryId;
            if (!inventoryId) {
                throw new Error('Could not extract inventory/property ID from tenancy data');
            }

            // Fetch property, landlord, and tenant contact IDs in parallel
            const [
                property,
                landlordData,
                tenantContactIds
            ] = await Promise.all([
                this.makeRequest('GET', `/inventory/${inventoryId}`, null, agencyRef),
                this.makeRequest('GET', `/inventory/${inventoryId}/landlords`, null, agencyRef),
                this.makeRequest('GET', `/tenancies/${tenancyId}/tenantIds`, null, agencyRef)
            ]);

            // Fetch detailed tenant contact information
            let tenants = [];
            if (tenantContactIds && tenantContactIds.items && tenantContactIds.items.length > 0) {
                const contactIds = tenantContactIds.items.map(item => item.contactId.toString());

                // Get individual contact details for each tenant
                const tenantPromises = contactIds.map(contactId =>
                    this.makeRequest('GET', `/contacts?id=${contactId}`, null, agencyRef)
                );
                tenants = await Promise.all(tenantPromises);
            }

            // Extract all landlords
            // The /landlords endpoint returns {items: [...]} structure
            const landlords = landlordData && landlordData.items && landlordData.items.length > 0
                ? landlordData.items
                : [];

            return {
                tenancy,
                property,
                landlords,  // Array of all landlords
                landlord: landlords[0] || null,  // Keep backwards compatibility - first landlord
                tenants,
                fetchedAt: new Date().toISOString()
            };

        } catch (error) {
            throw new Error(`Failed to fetch tenancy data: ${error.message}`);
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const token = await this.getAccessToken();

            if (process.env.NODE_ENV === 'development') {
                return {
                    success: true,
                    status: 'healthy',
                    message: 'Alto API connection healthy (mock)',
                    hasToken: !!token
                };
            }

            await this.makeRequest('GET', '/health');

            return {
                success: true,
                status: 'healthy',
                message: 'Alto API connection healthy',
                hasToken: !!token
            };

        } catch (error) {
            return {
                success: false,
                status: 'unhealthy',
                message: error.message,
                hasToken: false
            };
        }
    }

    /**
     * Test connection
     */
    async testConnection() {
        try {
            const token = await this.getAccessToken();
            return {
                success: true,
                hasCredentials: !!(this.clientId && this.clientSecret),
                hasToken: !!token,
                baseUrl: this.baseUrl,
                environment: process.env.NODE_ENV || 'production'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                hasCredentials: !!(this.clientId && this.clientSecret),
                hasToken: false
            };
        }
    }

    /**
     * Get mock data for development
     */
    getMockData(endpoint, method) {
        const mockResponses = {
            '/tenancies/': {
                id: 'TEN_123456',
                inventoryId: 'INV_789012',
                landlordId: 'CONTACT_LL_001',
                tenantIds: ['CONTACT_T_001', 'CONTACT_T_002'],
                depositAmount: 1500.00,
                rentAmount: 1200.00,
                startDate: '2024-01-15',
                endDate: '2024-07-14',
                status: 'active',
                agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
                branchId: 'MAIN'
            },
            '/properties/': {
                id: 'INV_789012',
                address: {
                    line1: '123 Test Street',
                    line2: 'Test Area',
                    town: 'Milton Keynes',
                    county: 'Buckinghamshire',
                    postcode: 'MK18 1AA'
                },
                propertyType: 'House',
                bedrooms: 3,
                bathrooms: 2
            },
            '/contacts/': {
                id: 'CONTACT_001',
                title: 'Mr',
                firstName: 'Test',
                lastName: 'Contact',
                email: 'test@example.com',
                phone: '01234567890',
                address: {
                    line1: '456 Contact Street',
                    town: 'Milton Keynes',
                    county: 'Buckinghamshire',
                    postcode: 'MK18 2BB'
                }
            },
            '/health': { status: 'healthy' }
        };

        const baseEndpoint = endpoint.split('/').slice(0, -1).join('/') + '/';
        return mockResponses[baseEndpoint] || mockResponses[endpoint] || { mock: true };
    }
}