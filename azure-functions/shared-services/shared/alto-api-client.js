/**
 * Alto API Client - Shared Service
 *
 * Handles authentication and API calls to Alto property management system
 */

const axios = require('axios');
const telemetry = require('./telemetry');

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
        this.context = config.context || null; // Optional context for logging
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
            const tokenUrl = `${this.baseUrl}/token`;
            this.context?.log('🔐 Attempting Alto authentication:', {
                url: tokenUrl,
                clientIdPreview: this.clientId ? this.clientId.substring(0, 10) + '...' : 'NOT SET'
            });

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

            this.context?.log('✅ Alto authentication successful');
            return this.accessToken;

        } catch (error) {
            this.context?.log('❌ Alto authentication failed:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText
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
            this.context?.log('🧪 TEST MODE: Verifying Alto OAuth credentials...');

            // Verify OAuth works (will throw error if credentials invalid)
            await this.getAccessToken();
            this.context?.log('✅ TEST MODE: Alto OAuth verified successfully');

            // Generate fake data using test-data-generator
            const { generateAltoTenancyData } = require('./test-data-generator');

            const fakeData = generateAltoTenancyData({
                ...testConfig,
                agencyRef: agencyRef,
                branchId: expectedBranchId || 'DEFAULT'
            });

            this.context?.log('🎭 TEST MODE: Generated fake Alto data', {
                tenancyId: fakeData.tenancy.id,
                rent: fakeData.tenancy.rent,
                deposit: fakeData.tenancy.depositRequested,
                property: fakeData.property.displayAddress,
                landlords: fakeData.landlords.totalCount,
                tenants: fakeData.tenants.length
            });

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
                    this.context?.error('🚨 SECURITY: Cross-branch access attempt blocked', {
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
}

module.exports = { AltoAPIClient };
