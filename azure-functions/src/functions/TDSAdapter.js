const { app } = require('@azure/functions');
const axios = require('axios');
const crypto = require('crypto');
const { PollingSettingsManager } = require('./PollingSettings');
const { getSalesforceAuthHeader } = require('../../shared-services/shared/salesforce-auth');
const { sanitizeForLogging, getDepositSummary } = require('../../shared-services/shared/sanitized-logger');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');
const { validateEntraToken, hasRole } = require('../../shared-services/shared/entra-auth-middleware');
const { OrganizationMappingService } = require('./OrganizationMapping');
const { loadTDSSettings } = require('../../shared-services/shared/service-helpers');

/**
 * Sanitize string for Salesforce API - removes special characters that Salesforce rejects
 * Keeps alphanumeric, spaces, hyphens, and basic punctuation, removes dots and other special chars
 */
function sanitizeForSalesforce(str) {
    if (!str) return str;
    // Remove periods, keep letters, numbers, spaces, hyphens, apostrophes, commas
    // Replace multiple spaces with single space and trim
    return str
        .replace(/\./g, '') // Remove periods (St. -> St)
        .replace(/[^\w\s\-',]/g, '') // Remove special chars except word chars, spaces, hyphens, apostrophes, commas
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();
}

/**
 * TDS Provider Interface - Abstract base for all TDS implementations
 */
class TDSProviderInterface {
    async createDeposit(depositData) {
        throw new Error('createDeposit must be implemented');
    }

    async getDepositStatus(depositId) {
        throw new Error('getDepositStatus must be implemented');
    }

    async updateDeposit(depositId, updateData) {
        throw new Error('updateDeposit must be implemented');
    }
}

/**
 * Current TDS Provider Implementation
 */
class CurrentTDSProvider extends TDSProviderInterface {
    constructor(config) {
        super();
        this.baseUrl = config.baseUrl || 'https://api.tds.gov.uk';
        this.apiKey = config.apiKey;
        this.memberId = config.memberId;
        this.branchId = config.branchId;
        this.timeout = config.timeout || 30000; // 30 seconds for individual HTTP requests
        this.context = config.context; // Store context for polling settings
    }

    async createDeposit(depositData, orgConfig) {
        // Load polling settings if context is available
        let depositCheckInterval = 1; // Default to 1 minute
        let maxPollAttempts = 8; // Default to 8 attempts
        if (this.context) {
            try {
                const settingsManager = new PollingSettingsManager(this.context);
                const settings = await settingsManager.getSettings();
                depositCheckInterval = settings.depositCheckInterval || 1;
                maxPollAttempts = settings.maxPollAttempts || 8;
                this.context.log(`📊 Using deposit check interval: ${depositCheckInterval} minutes, max attempts: ${maxPollAttempts}`);
            } catch (error) {
                this.context.log(`⚠️ Could not load polling settings, using defaults: ${error.message}`);
            }
        }
        try {
            // Build TDS payload in the format expected by the real API
            const tdsPayload = this.buildTDSPayload(depositData, orgConfig || {
                memberId: this.memberId,
                branchId: this.branchId,
                apiKey: this.apiKey
            });

            // ✅ SECURITY: Log sanitized payload (masks PII) for debugging
            console.log('📦 TDS Payload Structure (sanitized):');
            console.log(JSON.stringify(sanitizeForLogging(tdsPayload), null, 2));
            console.log('📝 Summary:', getDepositSummary(depositData));

            // Submit to real TDS API
            console.log('📤 Submitting deposit to TDS CreateDeposit endpoint');
            const submitResponse = await this.makeRequest('POST', '/CreateDeposit', tdsPayload);

            console.log('📨 TDS Submit Response:', JSON.stringify(sanitizeForLogging(submitResponse), null, 2));

            if (!submitResponse.success || !submitResponse.batch_id) {
                throw new Error(`TDS deposit submission failed: ${submitResponse.error || 'Unknown error'}`);
            }

            console.log(`✅ Deposit submitted successfully with batch_id: ${submitResponse.batch_id}`);

            // Wait initial delay before polling status
            console.log('⏳ Waiting 10 seconds before starting status polling...');
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Poll for completion using configured settings
            const statusResponse = await this.pollForCompletion(
                submitResponse.batch_id,
                orgConfig || {
                    memberId: this.memberId,
                    branchId: this.branchId,
                    apiKey: this.apiKey
                },
                maxPollAttempts, // from settings
                depositCheckInterval // polling interval in minutes from settings
            );

            return {
                success: true,
                depositId: `DEP_${Date.now()}`,
                dan: statusResponse.dan,
                status: statusResponse.status,
                batch_id: submitResponse.batch_id,
                provider: 'current-tds',
                memberId: this.memberId,
                branchId: this.branchId
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                provider: 'current-tds'
            };
        }
    }

    // Build TDS payload in the format expected by the real API (from your PoC)
    buildTDSPayload(depositData, orgConfig) {
        return {
            member_id: orgConfig.memberId,
            branch_id: orgConfig.branchId,
            api_key: orgConfig.apiKey,
            region: 'EW',
            scheme_type: 'Custodial',
            tenancy: [{
                user_tenancy_reference: depositData.tenancyId,
                property_id: depositData.property?.id || 1,
                property_paon: depositData.property.address.nameNo,
                property_saon: depositData.property.address.subDwelling || '',
                property_street: depositData.property.address.street,
                property_town: depositData.property.address.town || depositData.property.address.locality,
                property_administrative_area: depositData.property.county,
                property_postcode: depositData.property.address.postcode,
                tenancy_start_date: this.formatDateForTDS(depositData.tenancyStartDate),
                tenancy_expected_end_date: this.formatDateForTDS(depositData.tenancyEndDate),
                number_of_bedrooms: depositData.property.bedrooms,
                number_of_living_rooms: depositData.property.receptions || 1,
                furnished_status: 'furnished',
                rent_amount: depositData.rentAmount,
                deposit_amount: depositData.depositAmount,
                deposit_amount_to_protect: depositData.depositAmount,
                deposit_received_date: this.formatDateForTDS(new Date()),
                number_of_tenants: depositData.tenants.length,
                number_of_landlords: depositData.landlords ? depositData.landlords.length : 1,
                people: this.buildPeopleArray(depositData)
            }]
        };
    }

    // Build people array (tenants + landlords) - NO FALLBACKS
    buildPeopleArray(depositData) {
        const people = [];

        // Add tenants - NO FALLBACKS
        if (!depositData.tenants || depositData.tenants.length === 0) {
            throw new Error('No tenant data provided. At least one tenant is required for deposit creation.');
        }

        depositData.tenants.forEach((tenant, index) => {
            const tenantPerson = {
                person_classification: index === 0 ? 'Lead Tenant' : 'Joint Tenant',
                person_title: tenant.title,
                person_firstname: tenant.firstName,
                person_surname: tenant.lastName,
                is_business: 'N'
            };

            // Only add email/phone if they have values (TDS may reject null values)
            if (tenant.email) {
                tenantPerson.person_email = tenant.email;
            }
            if (tenant.phone) {
                tenantPerson.person_mobile = tenant.phone;
            }

            people.push(tenantPerson);
        });

        // Add all landlords with complete address information - NO FALLBACKS
        const landlords = depositData.landlords || [depositData.landlord];
        if (!landlords || landlords.length === 0 || !landlords[0]) {
            throw new Error('No landlord data provided. Landlord information is required for deposit creation.');
        }

        landlords.forEach((landlord, index) => {
            const landlordPerson = {
                person_classification: index === 0 ? 'Primary Landlord' : 'Joint Landlord',
                person_title: landlord.title,
                person_firstname: landlord.firstName,
                person_surname: landlord.lastName,
                is_business: 'N',
                person_paon: landlord.address.nameNo,
                person_street: landlord.address.street,
                person_town: landlord.address.town || landlord.address.locality,
                person_administrative_area: landlord.county,  // Use county from postcode lookup
                person_postcode: landlord.address.postcode,
                person_country: 'United Kingdom'
            };

            // Only add email/phone if they have values (TDS may reject null values)
            if (landlord.email) {
                landlordPerson.person_email = landlord.email;
            }
            if (landlord.phone) {
                landlordPerson.person_mobile = landlord.phone;
            }

            people.push(landlordPerson);
        });

        return people;
    }

    // Format date for TDS API (DD/MM/YYYY)
    formatDateForTDS(date) {
        if (!date) return '01/01/2024';

        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) return '01/01/2024';

        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();

        return `${day}/${month}/${year}`;
    }

    // Poll for deposit completion (limited to 8 attempts for Azure Functions timeout)
    async pollForCompletion(batchId, orgConfig, maxAttempts = 8, pollingIntervalMinutes = null) {
        // Use provided interval or default to 1 minute (converted to milliseconds)
        // pollingIntervalMinutes comes from settings in minutes, convert to ms
        const pollingInterval = pollingIntervalMinutes
            ? pollingIntervalMinutes * 60 * 1000
            : 60000; // Default: 60 seconds

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const statusUrl = `/CreateDepositStatus/${orgConfig.memberId}/${orgConfig.branchId}/${orgConfig.apiKey}/${batchId}`;
                console.log(`📊 Checking status at: ${this.baseUrl}${statusUrl}`);
                const statusResponse = await this.makeRequest('GET', statusUrl);
                console.log(`📊 Status Response:`, JSON.stringify(sanitizeForLogging(statusResponse), null, 2));

                switch (statusResponse.status) {
                    case 'created':
                        console.log(`✅ Deposit created successfully! DAN: ${statusResponse.dan}`);
                        return statusResponse;
                    case 'failed':
                        // Analyze errors to determine if they're permanent or temporary
                        const errorAnalysis = this.analyzeErrors(statusResponse.errors);

                        if (errorAnalysis.isPermanent) {
                            // Permanent error - don't retry, return immediately
                            console.log(`❌ Permanent TDS error detected: ${errorAnalysis.description}`);
                            throw new Error(`TDS validation error: ${errorAnalysis.description}`);
                        } else {
                            // Temporary error - continue retry logic
                            console.log(`⚠️ Temporary TDS error, will retry: ${errorAnalysis.description}`);
                            throw new Error(`TDS temporary error: ${errorAnalysis.description}`);
                        }
                    case 'pending':
                        console.log(`⏳ TDS still processing... attempt ${attempt}/${maxAttempts}, waiting ${pollingInterval/1000}s`);
                        if (attempt < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, pollingInterval));
                        }
                        break;
                    default:
                        throw new Error(`Unknown TDS status: ${statusResponse.status}`);
                }
            } catch (error) {
                // Check if this is a permanent error that shouldn't be retried
                if (error.message.includes('TDS validation error:')) {
                    console.log(`❌ Permanent error detected, stopping retries: ${error.message}`);
                    throw error;
                }

                // For temporary errors or network issues, continue retry logic
                if (attempt === maxAttempts) throw error;
                console.warn(`⚠️ Polling attempt ${attempt} failed, retrying: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }
        }

        throw new Error(`TDS polling timeout: Deposit status not resolved after ${maxAttempts} attempts (8 minutes)`);
    }

    /**
     * Analyze TDS errors to determine if they're permanent (validation/business logic)
     * or temporary (system/network issues)
     */
    analyzeErrors(errors) {
        if (!errors || !Array.isArray(errors)) {
            return {
                isPermanent: false,
                description: 'Unknown error format'
            };
        }

        // Permanent error patterns (from TDS API v1.13 documentation)
        const permanentErrorPatterns = [
            // Validation errors (from CreateDepositStatus examples)
            'must be present',                           // Required field validation
            'must be from 1 to 8 alphanumeric characters', // Length validation
            'should match the number of tenants',        // Count validation
            'format incorrect for field type',           // Format validation
            'length out of bounds',                      // Length validation

            // Business logic errors
            'Attempt to update an existing tenancy',     // Duplicate tenancy (line 1082)
            'Invalid authentication key',               // Auth errors (line 957)
            'Failed authentication',                    // Auth errors (line 976)
            'Invalid scheme_type',                      // Invalid scheme (line 962)
            'Member is not part of a valid scheme',     // Member validation (line 966)
            'Invalid JSON',                             // Request format (line 969)

            // DAN-related validation
            'Invalid DAN',                              // DAN validation
            'the DAN supplied could not be found',     // DAN not found (line 2014)
            'not authorised to manage',                // Authorization (line 2032)
            'Tenancy is not in correct state',         // State validation (line 1950)

            // Field-specific validation errors
            'invalid_limit',                            // Parameter validation
            'invalid_after_id',                         // Parameter validation
            'must be supplied',                         // Required field (line 2242)
            'must be unique',                           // Uniqueness validation
            'should conform to BS7666:2000',           // Postcode format
            'value must be UNITED_KINGDOM',            // Country validation

            // Payment/financial validation
            'Unable to calculate tenant repayment values', // Payment calc (line 1956)
            'The repayment values do not match',        // Payment validation (line 1962)
            'There is an existing case for this tenancy', // Case conflict (line 1984)
            'Invalid tenancy scheme',                   // Scheme validation (line 1995)
        ];

        // Temporary error patterns (system/network issues)
        const temporaryErrorPatterns = [
            'service unavailable',               // Service outage
            'timeout',                          // Request timeout
            'connection refused',               // Network issues
            'internal server error',            // Server errors (5xx)
            'database unavailable',             // Database issues
            'rate limit exceeded',              // Rate limiting (temporary)
            'network error',                    // Network connectivity
            'connection reset',                 // Connection issues
            'gateway timeout',                  // Gateway issues
            'bad gateway',                      // Proxy issues
            'service temporarily unavailable',  // Temporary outage
        ];

        // Extract error messages
        const errorMessages = errors.map(err => {
            if (typeof err === 'string') return err.toLowerCase();
            if (err.value) return err.value.toLowerCase();
            if (err.message) return err.message.toLowerCase();
            return JSON.stringify(err).toLowerCase();
        });

        const allErrorText = errorMessages.join(' ');

        // Check for permanent errors first
        for (const pattern of permanentErrorPatterns) {
            if (allErrorText.includes(pattern.toLowerCase())) {
                return {
                    isPermanent: true,
                    description: this.formatErrorsForUser(errors),
                    category: 'validation'
                };
            }
        }

        // Check for temporary errors
        for (const pattern of temporaryErrorPatterns) {
            if (allErrorText.includes(pattern.toLowerCase())) {
                return {
                    isPermanent: false,
                    description: this.formatErrorsForUser(errors),
                    category: 'temporary'
                };
            }
        }

        // Default: treat unknown errors as permanent (safer approach)
        return {
            isPermanent: true,
            description: this.formatErrorsForUser(errors),
            category: 'unknown'
        };
    }

    /**
     * Format errors in a user-friendly way
     */
    formatErrorsForUser(errors) {
        if (!errors || !Array.isArray(errors)) {
            return 'Unknown error occurred';
        }

        const formattedErrors = errors.map(err => {
            if (typeof err === 'string') return err;

            // Handle structured errors
            if (err.field && err.value) {
                return `${err.field}: ${err.value}`;
            }

            if (err.name && err.value) {
                return `${err.name}: ${err.value}`;
            }

            if (err.value) return err.value;
            if (err.message) return err.message;

            return JSON.stringify(err);
        }).filter(msg => msg && msg.trim() !== '');

        return formattedErrors.join('; ');
    }

    async getDepositStatus(depositId) {
        try {
            const response = await this.makeRequest('GET', `/deposits/${depositId}`);
            return {
                success: true,
                depositId,
                status: response.status,
                dan: response.dan,
                provider: 'current-tds'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                provider: 'current-tds'
            };
        }
    }

    async makeRequest(method, endpoint, data = null, orgConfig = null) {
        const url = `${this.baseUrl}${endpoint}`;

        console.log(`🌐 TDS Legacy API Request: ${method} ${url}`);

        try {
            const config = {
                method,
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: this.timeout
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;

        } catch (error) {
            if (error.response) {
                throw new Error(`TDS API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                throw new Error(`TDS Network Error: ${error.message}`);
            } else {
                throw new Error(`TDS Request Error: ${error.message}`);
            }
        }
    }
}

/**
 * Salesforce TDS Provider Implementation (Future)
 */
/**
 * Salesforce TDS Provider Implementation
 */
class SalesforceTDSProvider extends TDSProviderInterface {
    constructor(config) {
        super();
        this.instanceUrl = config.instanceUrl;
        this.apiKey = config.apiKey;
        this.memberId = config.memberId;
        this.branchId = config.branchId;
        this.region = config.region || 'EW';
        this.schemeType = config.schemeType || 'Custodial';
        this.authMethod = config.authMethod; // Store auth method from config
        this.clientId = config.clientId; // Store OAuth2 client ID
        this.clientSecret = config.clientSecret; // Store OAuth2 client secret
        this.context = config.context;
    }

    /**
     * Format date for Salesforce (ISO → DD-MM-YYYY)
     */
    formatDateForSalesforce(date) {
        if (!date) return '';

        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        return `${day}-${month}-${year}`;
    }

    /**
     * Build people array for Salesforce (tenants + landlords)
     */
    buildSalesforcePeopleArray(depositData) {
        const people = [];

        // Add tenants
        if (depositData.tenants && depositData.tenants.length > 0) {
            depositData.tenants.forEach((tenant, index) => {
                // ✅ SECURITY: Log sanitized tenant object (masks PII) for debugging
                console.log(`🔍 Tenant ${index + 1} object (sanitized):`, JSON.stringify(sanitizeForLogging(tenant), null, 2));

                const tenantPerson = {
                    person_classification: "Tenant",
                    person_id: String(tenant.id || `tenant_${index + 1}`), // Use Alto contact ID
                    // person_reference should NOT be populated - omit it
                    person_title: tenant.title || 'Mr',
                    person_firstname: sanitizeForSalesforce(tenant.firstName),
                    person_surname: sanitizeForSalesforce(tenant.lastName),
                    is_business: "false",
                    person_country: "United Kingdom"
                };

                // Only add email/phone if they have values
                if (tenant.email) {
                    tenantPerson.person_email = tenant.email;
                }

                // Add phone - only populate person_mobile (not person_phone)
                // Alto doesn't distinguish between mobile/home, so we use mobile by default
                if (tenant.phone) {
                    tenantPerson.person_mobile = tenant.phone;
                }

                // Note: Tenants don't have addresses in Alto workflow
                // Salesforce TDS does not require tenant address

                people.push(tenantPerson);
            });
        }

        // Add all landlords
        const landlords = depositData.landlords || [depositData.landlord];
        if (landlords && landlords.length > 0) {
            landlords.forEach((landlord, index) => {
                if (!landlord) return; // Skip null/undefined

                const landlordPerson = {
                    person_classification: index === 0 ? "Primary Landlord" : "Joint Landlord",
                    person_id: String(landlord.id || `landlord_${index + 1}`), // Use Alto contact ID
                    // person_reference should NOT be populated - omit it
                    person_title: landlord.title || 'Mr',
                    person_firstname: sanitizeForSalesforce(landlord.firstName),
                    person_surname: sanitizeForSalesforce(landlord.lastName),
                    is_business: "false",
                    person_paon: sanitizeForSalesforce(landlord.address?.nameNo || ''),
                    person_street: sanitizeForSalesforce(landlord.address?.street || ''),
                    person_town: sanitizeForSalesforce(landlord.address?.town || ''),
                    person_postcode: landlord.address?.postcode || '',
                    person_country: "United Kingdom"
                };

                // Only add optional address fields if they have non-empty values
                if (landlord.address?.subDwelling && landlord.address.subDwelling.trim()) {
                    landlordPerson.person_saon = sanitizeForSalesforce(landlord.address.subDwelling);
                }
                if (landlord.address?.locality && landlord.address.locality.trim()) {
                    landlordPerson.person_locality = sanitizeForSalesforce(landlord.address.locality);
                }

                // Only add email/phone if they have values
                if (landlord.email) {
                    landlordPerson.person_email = landlord.email;
                }

                // Add phone - only populate person_mobile (not person_phone)
                // Alto doesn't distinguish between mobile/home, so we use mobile by default
                if (landlord.phone) {
                    landlordPerson.person_mobile = landlord.phone;
                }

                people.push(landlordPerson);
            });
        }

        return people;
    }

    /**
     * Build Salesforce deposit payload
     */
    buildSalesforcePayload(depositData) {
        const payload = {
            tenancy: {
                user_tenancy_reference: String(depositData.tenancyId),
                // deposit_reference should NOT be populated - omit it
                property_id: String(depositData.property?.id),
                property_paon: sanitizeForSalesforce(depositData.property?.address?.nameNo || '1'),
                property_street: sanitizeForSalesforce(depositData.property?.address?.street || 'Unknown Street'),
                property_town: sanitizeForSalesforce(depositData.property?.address?.town || depositData.property?.address?.locality || 'London'),
                property_administrative_area: sanitizeForSalesforce(depositData.property?.county || 'London'),
                property_postcode: depositData.property?.address?.postcode || 'NW1 6XE',
                tenancy_start_date: this.formatDateForSalesforce(depositData.tenancyStartDate),
                tenancy_expected_end_date: this.formatDateForSalesforce(depositData.tenancyEndDate),
                number_of_bedrooms: String(depositData.property?.bedrooms || 1),
                number_of_living_rooms: String(depositData.property?.receptions || 1),
                furnished_status: "true",
                rent_amount: String(depositData.rentAmount || 0),
                deposit_amount: String(depositData.depositAmount || 0),
                deposit_amount_to_protect: String(depositData.depositAmount || 0),
                deposit_received_date: this.formatDateForSalesforce(new Date()),
                number_of_tenants: String(depositData.tenants?.length || 1),
                number_of_landlords: String(depositData.landlords?.length || 1),
                people: this.buildSalesforcePeopleArray(depositData)
            }
        };

        // Add optional fields only if they have non-empty values
        if (depositData.property?.address?.subDwelling && depositData.property.address.subDwelling.trim()) {
            payload.tenancy.property_saon = sanitizeForSalesforce(depositData.property.address.subDwelling);
        }

        return payload;
    }

    /**
     * Make HTTP request to Salesforce
     */
    async makeRequest(method, endpoint, payload = null) {
        // For OAuth2, prefix endpoint with /auth
        // For API Key, use endpoint as-is (no /auth prefix)
        let finalEndpoint = endpoint;

        if (this.authMethod && this.authMethod.toLowerCase() === 'oauth2') {
            // Add /auth prefix for OAuth2 requests only
            // Handle both /services/apexrest/... and other formats
            if (endpoint.startsWith('/services/apexrest/')) {
                finalEndpoint = endpoint.replace('/services/apexrest/', '/services/apexrest/auth/');
            } else if (endpoint.startsWith('/')) {
                finalEndpoint = '/auth' + endpoint;
            } else {
                finalEndpoint = '/auth/' + endpoint;
            }

            if (this.context) {
                this.context.log(`🔐 OAuth2 mode: Modified endpoint from ${endpoint} to ${finalEndpoint}`);
            }
        } else {
            if (this.context) {
                this.context.log(`🔐 API Key mode: Using endpoint as-is: ${endpoint}`);
            }
        }

        const url = `${this.instanceUrl}${finalEndpoint}`;

        // Get authentication header using shared auth module
        const orgCredentials = {
            memberId: this.memberId,
            branchId: this.branchId,
            apiKey: this.apiKey,
            region: this.region,
            schemeType: this.schemeType,
            authMethod: this.authMethod, // Pass auth method preference
            clientId: this.clientId, // Pass OAuth2 client ID if available
            clientSecret: this.clientSecret, // Pass OAuth2 client secret if available
            baseUrl: this.instanceUrl // Pass base URL for OAuth2 /authorise endpoint
        };

        const authHeaders = await getSalesforceAuthHeader(this.context, orgCredentials);

        const config = {
            method,
            url,
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        };

        if (payload) {
            config.data = payload;
        }

        const response = await axios(config);
        return response.data;
    }

    /**
     * Poll for deposit completion
     */
    async pollForCompletion(batchId, maxAttempts = 8, intervalMinutes = 1) {
        if (this.context) {
            this.context.log(`🔄 Starting status polling for batch ${batchId} (${maxAttempts} attempts, ${intervalMinutes} min interval)`);
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (this.context) {
                this.context.log(`📊 Polling attempt ${attempt}/${maxAttempts} for batch ${batchId}`);
            }

            // Wait before checking (except first attempt which waits 10 seconds)
            const waitTime = attempt === 1 ? 10000 : intervalMinutes * 60 * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));

            try {
                const statusResponse = await this.makeRequest(
                    'GET',
                    `/services/apexrest/CreateDepositStatus/${batchId}`
                );

                if (this.context) {
                    this.context.log(`📨 Status response:`, JSON.stringify(sanitizeForLogging(statusResponse), null, 2));
                }

                // Check if completed successfully
                if (statusResponse.status === 'completed' && statusResponse.dan) {
                    if (this.context) {
                        this.context.log(`✅ Deposit completed successfully with DAN: ${statusResponse.dan}`);
                    }
                    return {
                        status: 'completed',
                        dan: statusResponse.dan,
                        depositId: statusResponse.depositId || statusResponse.dan
                    };
                }

                // Check if failed
                if (statusResponse.status === 'failed' || statusResponse.error) {
                    throw new Error(`Salesforce deposit creation failed: ${statusResponse.error || 'Unknown error'}`);
                }

                // Still processing
                if (this.context) {
                    this.context.log(`⏳ Deposit still processing (status: ${statusResponse.status})`);
                }

            } catch (error) {
                if (error.response?.status === 404) {
                    // Batch not found yet, continue polling
                    if (this.context) {
                        this.context.log(`⚠️ Batch not found yet, continuing to poll...`);
                    }
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Salesforce polling timeout after ${maxAttempts} attempts (${maxAttempts * intervalMinutes} minutes)`);
    }

    /**
     * Create deposit in Salesforce TDS with retry logic for concurrent request conflicts
     */
    async createDeposit(depositData, orgConfig) {
        const maxAttempts = 3;
        const baseDelay = 1000; // 1 second

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (this.context) {
                    this.context.log(`💼 Creating Salesforce TDS deposit... (attempt ${attempt}/${maxAttempts})`);
                }

                // Build Salesforce payload
                const payload = this.buildSalesforcePayload(depositData);

                // ✅ SECURITY: Log sanitized payload (masks PII) for debugging
                console.log('📦 Salesforce TDS Payload (sanitized):');
                console.log(JSON.stringify(sanitizeForLogging(payload), null, 2));
                console.log('📝 Summary:', getDepositSummary(depositData));

                // Submit to Salesforce
                console.log('📤 Submitting deposit to Salesforce depositcreation endpoint');
                const submitResponse = await this.makeRequest(
                    'POST',
                    '/services/apexrest/depositcreation',
                    payload
                );

                console.log('📨 Salesforce Submit Response:', JSON.stringify(sanitizeForLogging(submitResponse), null, 2));

                // Salesforce returns "Success" (capital S) not "success"
                const isSuccess = submitResponse.Success === 'true' || submitResponse.Success === true || submitResponse.success === true;

                if (!isSuccess || !submitResponse.batch_id) {
                    throw new Error(`Salesforce deposit submission failed: ${submitResponse.error || 'Unknown error'}`);
                }

                console.log(`✅ Deposit submitted successfully with batch_id: ${submitResponse.batch_id}`);

                // Check if DAN is already in the response (Salesforce returns it immediately)
                if (submitResponse.DAN) {
                    console.log(`✅ Deposit completed immediately with DAN: ${submitResponse.DAN}`);
                    return {
                        success: true,
                        depositId: submitResponse.DAN,
                        dan: submitResponse.DAN,
                        status: 'completed',
                        batch_id: submitResponse.batch_id,
                        provider: 'salesforce-tds',
                        memberId: this.memberId,
                        branchId: this.branchId,
                        attemptNumber: attempt
                    };
                }

                // Otherwise, poll for completion
                // Load polling settings
                let maxPollAttempts = 8;
                let depositCheckInterval = 1;

                if (this.context) {
                    try {
                        const settingsManager = new PollingSettingsManager(this.context);
                        const settings = await settingsManager.getSettings();
                        depositCheckInterval = settings.depositCheckInterval || 1;
                        maxPollAttempts = settings.maxPollAttempts || 8;
                        this.context.log(`📊 Using deposit check interval: ${depositCheckInterval} minutes, max attempts: ${maxPollAttempts}`);
                    } catch (error) {
                        this.context.log(`⚠️ Could not load polling settings, using defaults: ${error.message}`);
                    }
                }

                const statusResponse = await this.pollForCompletion(
                    submitResponse.batch_id,
                    maxPollAttempts,
                    depositCheckInterval
                );

                return {
                    success: true,
                    depositId: statusResponse.depositId,
                    dan: statusResponse.dan,
                    status: statusResponse.status,
                    batch_id: submitResponse.batch_id,
                    provider: 'salesforce-tds',
                    memberId: this.memberId,
                    branchId: this.branchId,
                    attemptNumber: attempt
                };

            } catch (error) {
                // Check if error is UNABLE_TO_LOCK_ROW from Salesforce
                const errorDetails = error.response?.data;
                let isLockError = false;

                if (Array.isArray(errorDetails)) {
                    // Handle array of error objects (most common format)
                    isLockError = errorDetails.some(err =>
                        err.message?.includes('UNABLE_TO_LOCK_ROW') ||
                        err.value?.includes('UNABLE_TO_LOCK_ROW') ||
                        (typeof err === 'string' && err.includes('UNABLE_TO_LOCK_ROW'))
                    );
                } else if (typeof errorDetails === 'object' && errorDetails !== null) {
                    // Handle single error object
                    const errorStr = JSON.stringify(errorDetails);
                    isLockError = errorStr.includes('UNABLE_TO_LOCK_ROW');
                } else if (typeof errorDetails === 'string') {
                    // Handle string error response
                    isLockError = errorDetails.includes('UNABLE_TO_LOCK_ROW');
                }

                // If it's a lock error and we have attempts remaining, retry
                if (isLockError && attempt < maxAttempts) {
                    // Calculate exponential backoff delay (1s, 2s, 4s)
                    const delay = baseDelay * Math.pow(2, attempt - 1);

                    if (this.context) {
                        this.context.log(`⚠️ Deposit creation failed (UNABLE_TO_LOCK_ROW - database row locked by concurrent request), retrying in ${delay/1000}s (attempt ${attempt}/${maxAttempts})`);
                    } else {
                        console.log(`⚠️ Deposit creation failed (UNABLE_TO_LOCK_ROW - database row locked by concurrent request), retrying in ${delay/1000}s (attempt ${attempt}/${maxAttempts})`);
                    }

                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry the loop
                }

                // Not a lock error or out of attempts - log and return failure
                if (this.context) {
                    this.context.log(`❌ Salesforce deposit creation error (attempt ${attempt}/${maxAttempts}):`, error.message);
                    this.context.log('Error details:', JSON.stringify(error.response?.data || error, null, 2));
                } else {
                    console.error(`❌ Salesforce deposit creation error (attempt ${attempt}/${maxAttempts}):`, error.message);
                    console.error('Error details:', JSON.stringify(error.response?.data || error, null, 2));
                }

                return {
                    success: false,
                    error: error.message,
                    provider: 'salesforce-tds',
                    details: error.response?.data || error.message,
                    attemptNumber: attempt,
                    wasLockError: isLockError
                };
            }
        }

        // If we exit the loop without returning, it means all retries failed
        return {
            success: false,
            error: 'Maximum retry attempts reached',
            provider: 'salesforce-tds',
            details: 'All retry attempts exhausted',
            attemptNumber: maxAttempts
        };
    }

    async getDepositStatus(depositId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/services/apexrest/tenancyinformation/${depositId}`
            );

            return {
                success: true,
                depositId,
                status: response.status || 'active',
                data: response,
                provider: 'salesforce-tds'
            };
        } catch (error) {
            return {
                success: false,
                depositId,
                error: error.message,
                provider: 'salesforce-tds'
            };
        }
    }
}

/**
 * TDS Adapter Factory
 */
class TDSAdapterFactory {
    static getProvider(providerType, config) {
        switch (providerType) {
            case 'current':
                return new CurrentTDSProvider(config);
            case 'salesforce':
                return new SalesforceTDSProvider(config);
            default:
                throw new Error(`Unknown TDS provider: ${providerType}`);
        }
    }
}

/**
 * TDS Adapter Azure Function
 * Handles deposit operations with hot-swappable TDS providers
 */
app.http('TDSAdapter', {
    methods: ['POST', 'GET', 'PUT'],
    authLevel: 'anonymous',
    route: 'tds/{action?}/{depositId?}',
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
            const depositId = request.params.depositId;

            // Get organization mapping if provided
            let legacyConfig = {};
            let salesforceConfig = {};
            let orgEnvironment = 'development'; // Default to development
            let tdsProviderPreference = process.env.TDS_ACTIVE_PROVIDER || 'current'; // Default from env or 'current'
            let requestData = {};

            // Read request data only once
            if (request.method === 'POST' && action === 'create') {
                requestData = await request.json();
            }

            if (requestData.agencyRef) {
                try {
                    // Use direct OrganizationMappingService (no HTTP, no auth needed for internal calls)
                    const mappingService = new OrganizationMappingService(context);
                    const result = await mappingService.getMapping(
                        requestData.agencyRef,
                        requestData.branchId || 'DEFAULT'
                    );

                    if (result && result.mapping) {
                        const mapping = result.mapping;

                        // Store both sets of credentials separately
                        legacyConfig = {
                            apiKey: mapping.legacy?.apiKey,
                            memberId: mapping.legacy?.memberId,
                            branchId: mapping.legacy?.branchId
                        };

                        salesforceConfig = {
                            apiKey: mapping.salesforce?.apiKey,
                            memberId: mapping.salesforce?.memberId,
                            branchId: mapping.salesforce?.branchId,
                            region: mapping.salesforce?.region,
                            schemeType: mapping.salesforce?.schemeType,
                            authMethod: mapping.salesforce?.authMethod,
                            clientId: mapping.salesforce?.clientId,
                            clientSecret: mapping.salesforce?.clientSecret
                        };

                        // Get environment from organization mapping
                        orgEnvironment = mapping.environment || 'development';
                        // Get TDS provider preference from organization mapping
                        tdsProviderPreference = mapping.tdsProviderPreference || 'auto';

                        context.log(`📊 Organization Mapping Found:`);
                        context.log(`   Environment: ${orgEnvironment}`);
                        context.log(`   TDS Provider: ${tdsProviderPreference}`);
                        if (legacyConfig.memberId) {
                            context.log(`   Legacy - Member: ${legacyConfig.memberId}, Branch: ${legacyConfig.branchId}`);
                        }
                        if (salesforceConfig.memberId) {
                            context.log(`   Salesforce - Member: ${salesforceConfig.memberId}, Branch: ${salesforceConfig.branchId}`);
                        }
                    }
                } catch (error) {
                    context.warn('Failed to lookup organization mapping, using defaults:', error.message);
                }
            }

            // Fetch TDS Settings to get dynamic API URLs
            // Use direct loadTDSSettings helper (no HTTP, no auth needed for internal calls)
            let tdsSettings = null;
            try {
                tdsSettings = await loadTDSSettings(context);
                context.log(`✅ TDS Settings loaded successfully for ${orgEnvironment} environment`);
            } catch (error) {
                context.warn('Failed to load TDS settings, using defaults:', error.message);
            }

            // Determine TDS URLs based on environment and settings
            const legacyTdsUrl = tdsSettings
                ? (orgEnvironment === 'production' ? tdsSettings.production.legacyTdsApi : tdsSettings.development.legacyTdsApi)
                : (process.env.TDS_CURRENT_BASE_URL || 'https://sandbox.api.custodial.tenancydepositscheme.com/v1.2');

            const salesforceTdsUrl = tdsSettings
                ? (orgEnvironment === 'production' ? tdsSettings.production.salesforceTdsApi : tdsSettings.development.salesforceTdsApi)
                : process.env.SALESFORCE_INSTANCE_URL;

            // Provider configuration with dynamic URLs and provider-specific credentials
            const providerConfigs = {
                current: {
                    baseUrl: legacyTdsUrl,
                    apiKey: legacyConfig.apiKey || process.env.TDS_API_KEY,
                    memberId: legacyConfig.memberId || process.env.TDS_MEMBER_ID,
                    branchId: legacyConfig.branchId || process.env.TDS_BRANCH_ID
                },
                salesforce: {
                    instanceUrl: salesforceTdsUrl,
                    apiKey: salesforceConfig.apiKey || process.env.SALESFORCE_API_KEY,
                    memberId: salesforceConfig.memberId || process.env.SALESFORCE_MEMBER_ID,
                    branchId: salesforceConfig.branchId || process.env.SALESFORCE_BRANCH_ID,
                    region: salesforceConfig.region,
                    schemeType: salesforceConfig.schemeType,
                    authMethod: salesforceConfig.authMethod,
                    clientId: salesforceConfig.clientId,
                    clientSecret: salesforceConfig.clientSecret
                }
            };

            context.log(`🎯 TDS operation: ${action} using provider preference: ${tdsProviderPreference}`);

            switch (action) {
                case 'create':
                    if (request.method !== 'POST') {
                        return { status: 405, jsonBody: { error: 'POST method required for create' } };
                    }

                    // Use the requestData we already read
                    let depositData = requestData;

                    // ✅ HIGH-006 FIX: Validate TDS deposit create request body
                    try {
                        depositData = validateRequestBody(depositData, schemas.tdsDepositCreate);
                        context.log('✅ TDS deposit create validation passed');
                    } catch (validationError) {
                        if (validationError.name === 'ValidationError') {
                            context.warn('❌ TDS deposit create validation failed:', validationError.validationErrors);

                            return {
                                status: 400,
                                jsonBody: formatValidationError(validationError)
                            };
                        }
                        // Re-throw unexpected errors
                        throw validationError;
                    }

                    // Handle different provider preferences
                    if (tdsProviderPreference === 'auto') {
                        // Dual Mode - Send to BOTH providers
                        context.log('🔄 Dual Mode: Sending to both Legacy and Salesforce TDS APIs');

                        const currentProvider = TDSAdapterFactory.getProvider('current', {
                            ...providerConfigs.current,
                            context: context
                        });

                        const salesforceProvider = TDSAdapterFactory.getProvider('salesforce', {
                            ...providerConfigs.salesforce,
                            context: context
                        });

                        // Send to both in parallel (credentials already in provider configs)
                        const [currentResult, salesforceResult] = await Promise.allSettled([
                            currentProvider.createDeposit(depositData, legacyConfig),
                            salesforceProvider.createDeposit(depositData, salesforceConfig)
                        ]);

                        const currentData = currentResult.status === 'fulfilled' ? currentResult.value : { success: false, error: currentResult.reason?.message };
                        const salesforceData = salesforceResult.status === 'fulfilled' ? salesforceResult.value : { success: false, error: salesforceResult.reason?.message };

                        context.log(`📊 Legacy Result: ${currentData.success ? '✅ Success' : '❌ Failed'}`);
                        context.log(`📊 Salesforce Result: ${salesforceData.success ? '✅ Success' : '❌ Failed'}`);

                        // Return combined result (consider successful if at least one succeeded)
                        const overallSuccess = currentData.success || salesforceData.success;

                        return {
                            status: overallSuccess ? 201 : 400,
                            jsonBody: {
                                success: overallSuccess,
                                mode: 'dual',
                                legacy: currentData,
                                salesforce: salesforceData,
                                timestamp: new Date().toISOString()
                            }
                        };

                    } else {
                        // Single Mode - Send to specific provider
                        const activeProvider = tdsProviderPreference; // 'current' or 'salesforce'

                        const provider = TDSAdapterFactory.getProvider(activeProvider, {
                            ...providerConfigs[activeProvider],
                            context: context
                        });

                        // Pass the correct credentials based on provider
                        const providerCredentials = activeProvider === 'current' ? legacyConfig : salesforceConfig;
                        const createResult = await provider.createDeposit(depositData, providerCredentials);

                        return {
                            status: createResult.success ? 201 : 400,
                            jsonBody: {
                                ...createResult,
                                provider: activeProvider,
                                timestamp: new Date().toISOString()
                            }
                        };
                    }

                case 'status':
                    if (!depositId) {
                        return { status: 400, jsonBody: { error: 'Deposit ID required' } };
                    }

                    // ✅ HIGH-006 FIX: Validate deposit ID parameter
                    try {
                        const { error: depositIdError } = schemas.depositId.validate(depositId);
                        if (depositIdError) {
                            context.warn('❌ Deposit ID validation failed:', depositIdError.message);

                            return {
                                status: 400,
                                jsonBody: {
                                    success: false,
                                    error: 'Invalid deposit ID format',
                                    message: depositIdError.message,
                                    timestamp: new Date().toISOString()
                                }
                            };
                        }
                        context.log('✅ Deposit ID validation passed');
                    } catch (validationError) {
                        throw validationError;
                    }

                    // For status, use primary provider (current for 'auto', otherwise use preference)
                    const statusProvider = tdsProviderPreference === 'auto' ? 'current' : tdsProviderPreference;
                    const provider = TDSAdapterFactory.getProvider(statusProvider, {
                        ...providerConfigs[statusProvider],
                        context: context
                    });

                    const statusResult = await provider.getDepositStatus(depositId);

                    return {
                        status: statusResult.success ? 200 : 404,
                        jsonBody: {
                            ...statusResult,
                            provider: statusProvider,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'health':
                    return {
                        status: 200,
                        jsonBody: {
                            status: 'healthy',
                            tdsProviderPreference,
                            availableProviders: ['current', 'salesforce', 'auto'],
                            timestamp: new Date().toISOString()
                        }
                    };

                default:
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Invalid action',
                            availableActions: ['create', 'status', 'health'],
                            usage: {
                                create: 'POST /api/tds/create',
                                status: 'GET /api/tds/status/{depositId}',
                                health: 'GET /api/tds/health'
                            }
                        }
                    };
            }

        } catch (error) {
            context.log('TDS Adapter error:', error.message);
            context.log('Error stack:', error.stack);
            return {
                status: 500,
                jsonBody: {
                    error: 'Internal server error',
                    message: error.message
                }
            };
        }
    }
});