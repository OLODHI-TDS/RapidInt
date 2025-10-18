const { app } = require('@azure/functions');
const axios = require('axios');
const { IntegrationAuditLogger } = require('./IntegrationAuditLogger');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');
const { validateEntraToken, hasRole } = require('../../shared-services/shared/entra-auth-middleware');
const { AltoAPIClient } = require('../../shared-services/shared/alto-api-client');
const { OrganizationMappingService } = require('./OrganizationMapping');
const { lookupPostcode } = require('../../shared-services/shared/service-helpers');

/**
 * Workflow Orchestrator Azure Function
 * Orchestrates the complete Alto → TDS integration workflow
 */
app.http('WorkflowOrchestrator', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'workflows/alto-tds',
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

        // Extract Bearer token for internal API calls
        const authHeader = request.headers.get('authorization');
        const bearerToken = authHeader ? authHeader.substring(7) : null; // Remove 'Bearer ' prefix

        try {
            let workflowData = await request.json();

            // ✅ HIGH-006 FIX: Validate workflow orchestrator request body
            try {
                workflowData = validateRequestBody(workflowData, schemas.workflowOrchestratorRequest);
                context.log('✅ Workflow orchestrator request validation passed');
            } catch (validationError) {
                if (validationError.name === 'ValidationError') {
                    context.warn('❌ Workflow orchestrator request validation failed:', validationError.validationErrors);

                    return {
                        status: 400,
                        jsonBody: formatValidationError(validationError)
                    };
                }
                // Re-throw unexpected errors
                throw validationError;
            }

            context.log('🚀 Starting Alto → TDS workflow:', workflowData);

            const orchestrator = new AltoTDSOrchestrator(context, bearerToken);
            const result = await orchestrator.execute(workflowData);

            // Determine status code:
            // - 200 for successful completion
            // - 202 for pending integration (accepted for processing)
            // - 500 for errors
            let statusCode = 500;
            if (result.success) {
                statusCode = 200;
            } else if (result.pendingCreated) {
                statusCode = 202; // Accepted - will be processed later
            }

            return {
                status: statusCode,
                jsonBody: result
            };

        } catch (error) {
            context.log('❌ Workflow orchestration failed:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: 'Workflow orchestration failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

/**
 * Alto to TDS Integration Orchestrator
 */
class AltoTDSOrchestrator {
    constructor(context, bearerToken = null) {
        this.context = context;
        this.bearerToken = bearerToken;
        this.workflowId = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        this.startTime = Date.now();
        this.auditLogger = new IntegrationAuditLogger(context);
    }

    /**
     * Normalize title to Salesforce TDS-accepted values
     * Salesforce TDS API accepts: "Mr.", "Ms.", "Mrs.", "Dr.", "Prof.", "Mx." (with periods)
     * Title is optional - if not recognized, return null and omit from payload
     */
    normalizeTitle(title) {
        if (!title) return null; // No title provided - will be omitted

        // Remove any existing periods and convert to lowercase for matching
        const titleLower = title.toLowerCase().trim().replace(/\./g, '');

        // Map common variations to Salesforce-accepted titles (WITH periods)
        const titleMap = {
            'mr': 'Mr.',
            'mrs': 'Mrs.',
            'miss': 'Ms.',  // Convert Miss to Ms.
            'ms': 'Ms.',
            'dr': 'Dr.',
            'prof': 'Prof.',
            'mx': 'Mx.'
        };

        // Return matched title or null if not supported
        // Null means don't send title field (it's optional in Salesforce API)
        return titleMap[titleLower] || null;
    }

    /**
     * Execute the complete Alto → TDS workflow
     */
    async execute(workflowData) {
        const steps = [];
        let currentStep = null;

        // Store workflow data for access in other methods
        this.workflowData = workflowData;

        try {
            this.context.log(`🔄 Executing workflow ${this.workflowId} for tenancy ${workflowData.tenancyId}`);

            // Step 1: Fetch Alto tenancy data
            currentStep = 'fetch_alto_data';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const altoData = await this.fetchAltoData(workflowData);
            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = { dataFetched: true, hasProperty: !!altoData.property };

            // Step 2: Validate and enrich data
            currentStep = 'validate_data';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const validationResult = await this.validateAndEnrichData(altoData);

            // Check if this tenancy is permanently rejected (wrong deposit scheme type)
            if (!validationResult.isValid && validationResult.validationResult?.isPermanentRejection) {
                this.context.log('🚫 Tenancy rejected: ' + validationResult.validationResult.rejectionReason);

                // Archive this integration immediately - no polling needed
                const rejectionResult = await this.archiveTenancyRejection(
                    workflowData,
                    altoData,
                    validationResult.validationResult.rejectionReason
                );

                steps[steps.length - 1].status = 'completed';
                steps[steps.length - 1].result = {
                    rejected: true,
                    reason: validationResult.validationResult.rejectionReason
                };

                const processingTime = Date.now() - this.startTime;

                return {
                    success: false,
                    rejected: true,
                    workflowId: this.workflowId,
                    tenancyId: workflowData.tenancyId,
                    status: 'REJECTED',
                    message: 'Tenancy rejected - not for TDS Custodial scheme',
                    rejectionReason: validationResult.validationResult.rejectionReason,
                    processingTime: `${processingTime}ms`,
                    steps,
                    timestamp: new Date().toISOString()
                };
            }

            // Check if data is incomplete but can be handled with delayed processing
            if (!validationResult.isValid && validationResult.validationResult?.canPendForPolling) {
                this.context.log('💤 Data incomplete but suitable for delayed processing');

                // Create pending integration and return early
                const pendingResult = await this.createPendingIntegrationForMissingData(
                    workflowData,
                    altoData,
                    validationResult.validationResult
                );

                steps[steps.length - 1].status = 'completed';
                steps[steps.length - 1].result = {
                    pendingIntegration: true,
                    status: pendingResult.status,
                    reason: pendingResult.pendingReason
                };

                const processingTime = Date.now() - this.startTime;

                return {
                    success: false, // Changed from true - this is not a completed workflow
                    pendingCreated: true, // New field to indicate pending integration was created
                    workflowId: this.workflowId,
                    tenancyId: workflowData.tenancyId,
                    integrationId: pendingResult.integrationId,
                    status: pendingResult.status,
                    message: pendingResult.message,
                    pendingReason: pendingResult.pendingReason,
                    missingFields: pendingResult.missingFields,
                    nextPollAt: pendingResult.nextPollAt,
                    processingTime: `${processingTime}ms`,
                    steps,
                    timestamp: new Date().toISOString()
                };
            }

            if (!validationResult.isValid) {
                throw new Error(`Data validation failed: ${validationResult.errors.join(', ')}`);
            }
            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = validationResult;

            // Step 3: Lookup postcode county for property and landlord
            currentStep = 'lookup_postcode';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const propertyPostcodeResult = await this.lookupPostcode(altoData.property?.address?.postcode);

            // Also lookup landlord postcode (may be different from property)
            const landlordSource = altoData.landlord || altoData.property?.owners?.[0];
            const landlordPostcode = landlordSource?.address?.postcode;
            const landlordPostcodeResult = landlordPostcode ? await this.lookupPostcode(landlordPostcode) : propertyPostcodeResult;

            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = { property: propertyPostcodeResult, landlord: landlordPostcodeResult };

            // Step 4: Prepare TDS deposit payload
            currentStep = 'prepare_tds_payload';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const tdsPayload = await this.prepareTDSPayload(altoData, propertyPostcodeResult, landlordPostcodeResult);

            // Log the prepared TDS payload for debugging (like Alto-POC)
            console.log('📋 Prepared TDS Payload Data:');
            console.log(JSON.stringify(tdsPayload, null, 2));

            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = {
                payloadPrepared: true,
                payload: tdsPayload  // Include payload in response for debugging
            };

            // Step 5: Create TDS deposit
            currentStep = 'create_tds_deposit';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const tdsResult = await this.createTDSDeposit(tdsPayload);
            if (!tdsResult.success) {
                throw new Error(`TDS deposit creation failed: ${tdsResult.error}`);
            }
            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = tdsResult;

            // Step 6: Store integration record
            currentStep = 'store_integration';
            steps.push({ step: currentStep, status: 'started', timestamp: new Date().toISOString() });

            const integrationRecord = await this.storeIntegrationRecord(workflowData, altoData, tdsResult);
            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].result = { recordStored: true, integrationId: integrationRecord.id };

            const processingTime = Date.now() - this.startTime;

            // Log successful integration to audit log
            await this.auditLogger.logSuccess({
                tenancyId: workflowData.tenancyId,
                agencyRef: altoData.tenancy?.agencyRef || workflowData.agencyRef,
                branchId: altoData.tenancy?.branchId || workflowData.branchId,
                workflowId: this.workflowId,
                source: workflowData.testMode ? 'TEST_WEBHOOK' : 'DIRECT_WEBHOOK',  // Tag test integrations
                testMode: workflowData.testMode || false,                           // Add test mode flag
                startedAt: new Date(this.startTime).toISOString(),
                dan: tdsResult.dan,
                depositId: tdsResult.depositId,
                tdsResponse: tdsResult,
                totalSteps: 6,
                completedSteps: IntegrationAuditLogger.calculateCompletedSteps(steps),
                workflowSteps: steps,
                processingTimeMs: processingTime,
                webhookId: workflowData.webhookId || ''
            });

            return {
                success: true,
                workflowId: this.workflowId,
                tenancyId: workflowData.tenancyId,
                depositId: tdsResult.depositId,
                dan: tdsResult.dan,
                integrationId: integrationRecord.id,
                processingTime: `${processingTime}ms`,
                steps,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.context.log(`❌ Workflow failed at step '${currentStep}':`, error);

            // Mark current step as failed
            if (steps.length > 0 && steps[steps.length - 1].status === 'started') {
                steps[steps.length - 1].status = 'failed';
                steps[steps.length - 1].error = error.message;
            }

            const processingTime = Date.now() - this.startTime;

            // Log failed integration to audit log
            await this.auditLogger.logFailure({
                tenancyId: workflowData.tenancyId,
                agencyRef: workflowData.agencyRef || '',
                branchId: workflowData.branchId || '',
                workflowId: this.workflowId,
                source: workflowData.testMode ? 'TEST_WEBHOOK' : 'DIRECT_WEBHOOK',  // Tag test integrations
                testMode: workflowData.testMode || false,                           // Add test mode flag
                startedAt: new Date(this.startTime).toISOString(),
                failureReason: IntegrationAuditLogger.determineFailureReason(error, currentStep),
                failureDescription: error.message,
                failureCategory: 'workflow_execution',
                lastError: error,
                totalSteps: 6,
                completedSteps: IntegrationAuditLogger.calculateCompletedSteps(steps),
                failedStep: currentStep,
                workflowSteps: steps,
                processingTimeMs: processingTime,
                webhookId: workflowData.webhookId || ''
            });

            return {
                success: false,
                workflowId: this.workflowId,
                error: error.message,
                failedStep: currentStep,
                processingTime: `${processingTime}ms`,
                steps,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Fetch complete Alto tenancy data
     */
    async fetchAltoData(workflowData) {
        this.context.log('📡 Fetching Alto tenancy data...');

        try {
            // Get environment AND branchId from organization mapping
            let environment = 'development';
            let effectiveBranchId = workflowData.branchId; // Default to webhook's branch ID

            if (workflowData.agencyRef) {
                // ✅ Get organization mapping - use direct service call (no HTTP, no auth needed for internal calls)
                // If org mapping doesn't exist, workflow should fail immediately
                const mappingService = new OrganizationMappingService(this.context);
                const result = await mappingService.getMapping(
                    workflowData.agencyRef,
                    workflowData.branchId || 'DEFAULT'
                );

                if (!result || !result.mapping) {
                    throw new Error(`Organization mapping not found for agencyRef: ${workflowData.agencyRef}, branchId: ${workflowData.branchId || 'DEFAULT'}`);
                }

                environment = result.mapping.environment || 'development';
                // ✅ Use organization mapping's branch ID (handles DEFAULT wildcard)
                effectiveBranchId = result.storedBranchId || workflowData.branchId;

                this.context.log(`📊 Using environment from org mapping: ${environment}`);
                this.context.log(`🔑 Using branch ID from org mapping: ${effectiveBranchId}`);
            } else {
                throw new Error('agencyRef is required to lookup organization mapping');
            }

            // Use direct AltoAPIClient (no HTTP, no auth needed for internal calls)
            // Get Alto API URL from settings
            let altoApiUrl = process.env.ALTO_API_BASE_URL || 'https://api.alto.zoopladev.co.uk';

            try {
                const { TableClient } = require('@azure/data-tables');
                const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
                const settingsTableClient = TableClient.fromConnectionString(connectionString, 'AltoSettings');

                const settingsEntity = await settingsTableClient.getEntity('Settings', 'AltoConfig');
                const settings = {
                    development: JSON.parse(settingsEntity.developmentSettings || '{}'),
                    production: JSON.parse(settingsEntity.productionSettings || '{}')
                };

                altoApiUrl = environment === 'production'
                    ? settings.production.altoApi || altoApiUrl
                    : settings.development.altoApi || altoApiUrl;

                this.context.log(`✅ Using Alto API URL for ${environment}: ${altoApiUrl}`);
            } catch (error) {
                this.context.log('⚠️ Failed to load Alto settings, using defaults:', error.message);
            }

            // Remove trailing slash
            altoApiUrl = altoApiUrl.replace(/\/$/, '');

            // Initialize Alto API client
            const altoClient = new AltoAPIClient({
                baseUrl: altoApiUrl,
                clientId: process.env.ALTO_CLIENT_ID,
                clientSecret: process.env.ALTO_CLIENT_SECRET,
                timeout: 600000,
                context: this.context
            });

            // Fetch tenancy data directly
            const altoData = await altoClient.fetchFullTenancyData(
                workflowData.tenancyId,
                workflowData.agencyRef,
                effectiveBranchId,  // ✅ Use organization mapping's branch ID
                workflowData.testMode || false,
                workflowData.testConfig || {}
            );

            return altoData;

        } catch (error) {
            // No fallback - throw real error
            this.context.log('❌ Failed to fetch Alto data:', error.message);
            throw new Error(`Alto API Error: ${error.message}`);
        }
    }

    /**
     * Validate data completeness with detailed missing field tracking
     */
    validateDataCompleteness(altoData) {
        const missingFields = {
            tenancy: [],
            property: [],
            contacts: [],
            deposit: []
        };

        let isComplete = true;

        // Check deposit scheme type - critical filter for TDS custodial tenancies
        const depositSchemeType = altoData.tenancy?.depositSchemeType;

        // If depositSchemeType is present but not TDS Custodial or Unspecified, this is a permanent rejection
        if (depositSchemeType &&
            depositSchemeType !== 'DisputeServiceCustodial' &&
            depositSchemeType !== 'Unspecified') {
            this.context.log(`🚫 Tenancy rejected: Tenancy is not for TDS Custodial (scheme type: ${depositSchemeType})`);
            // This tenancy is for a different scheme - permanently reject
            return {
                isComplete: false,
                isPermanentRejection: true,
                rejectionReason: `Tenancy is not for TDS Custodial scheme (scheme type: ${depositSchemeType})`,
                missingFields: {},
                summary: `Tenancy is not for TDS Custodial scheme (scheme type: ${depositSchemeType})`,
                canPendForPolling: false
            };
        }

        // If depositSchemeType is "Unspecified", treat as missing field (can pend for polling)
        if (!depositSchemeType || depositSchemeType === 'Unspecified') {
            missingFields.tenancy.push('deposit scheme type');
            isComplete = false;
            this.context.log(`⏳ Deposit scheme type is unspecified - will pend for polling`);
        }

        // Required tenancy fields
        const requiredTenancyFields = ['id', 'startDate'];
        if (altoData.tenancy) {
            requiredTenancyFields.forEach(field => {
                if (!altoData.tenancy[field]) {
                    missingFields.tenancy.push(field);
                    isComplete = false;
                }
            });
        } else {
            missingFields.tenancy.push('entire tenancy data');
            isComplete = false;
        }

        // Required property fields
        if (altoData.property) {
            if (!altoData.property.address) {
                missingFields.property.push('address');
                isComplete = false;
            }
            if (!altoData.property.id) {
                missingFields.property.push('id');
                isComplete = false;
            }
        } else {
            missingFields.property.push('entire property data');
            isComplete = false;
        }

        // Contact information validation (Alto API structure)
        // Validate ALL tenants - handle both structures:
        // 1. Multiple people in same contact: tenants[0].items[0].people[]
        // 2. Multiple separate contacts: tenants[].items[0].people[0]
        if (!altoData.tenants || altoData.tenants.length === 0) {
            missingFields.contacts.push('tenant contacts');
            isComplete = false;
        } else {
            // Collect all tenants from all contact records
            const allTenants = [];
            altoData.tenants.forEach(tenantContact => {
                if (tenantContact.items && tenantContact.items.length > 0) {
                    const people = tenantContact.items[0].people || [];
                    allTenants.push(...people);
                }
            });

            if (allTenants.length === 0) {
                missingFields.contacts.push('tenant contacts');
                isComplete = false;
            } else {
                // Check ALL tenants for name and contact completeness
                allTenants.forEach((tenant, index) => {
                    const tenantLabel = index === 0 ? 'lead tenant' : `tenant ${index + 1}`;

                    if (!tenant.forename || !tenant.surname) {
                        missingFields.contacts.push(`${tenantLabel} name (${tenant.forename || 'unknown'} ${tenant.surname || 'unknown'})`);
                        isComplete = false;
                    }

                    // Check if tenant has either email or phone
                    const hasEmail = tenant.emailAddresses && tenant.emailAddresses.length > 0;
                    const hasPhone = tenant.phoneNumbers && tenant.phoneNumbers.length > 0;

                    if (!hasEmail && !hasPhone) {
                        missingFields.contacts.push(`${tenantLabel} contact (${tenant.forename} ${tenant.surname})`);
                        isComplete = false;
                    }
                });
            }
        }

        // Validate ALL landlords - try /landlords endpoint first, fall back to property.owners
        // Handle both structures: landlords object with items array, or direct array
        let allLandlords = [];
        if (altoData.landlords) {
            // /landlords endpoint returns { totalCount, items: [] }
            allLandlords = altoData.landlords.items || altoData.landlords;
        } else if (altoData.property?.owners) {
            // property.owners is a direct array
            allLandlords = altoData.property.owners;
        }

        if (!allLandlords || allLandlords.length === 0) {
            missingFields.contacts.push('landlord information');
            isComplete = false;
        } else {
            // Check ALL landlords for name, contact, and address completeness
            allLandlords.forEach((landlordSource, index) => {
                const landlordLabel = index === 0 ? 'primary landlord' : `landlord ${index + 1}`;

                // Handle both /landlords structure (flat: forename, surname) and property.owners structure (nested: name.forename)
                const landlordForename = landlordSource.forename || landlordSource.name?.forename;
                const landlordSurname = landlordSource.surname || landlordSource.name?.surname;

                if (!landlordForename || !landlordSurname) {
                    missingFields.contacts.push(`${landlordLabel} name`);
                    isComplete = false;
                }

                // Check landlord has either email or phone
                // Handle both structures: flat (email, phone) vs nested (emailAddresses[], phoneNumbers[])
                const landlordEmail = landlordSource.email ||
                    (landlordSource.emailAddresses && landlordSource.emailAddresses.length > 0 ? landlordSource.emailAddresses[0].address : null);
                const landlordPhone = landlordSource.phone ||
                    (landlordSource.phoneNumbers && landlordSource.phoneNumbers.length > 0 ? landlordSource.phoneNumbers[0].number : null);

                if (!landlordEmail && !landlordPhone) {
                    missingFields.contacts.push(`${landlordLabel} contact (${landlordForename} ${landlordSurname})`);
                    isComplete = false;
                }

                // Check landlord address - must have all required TDS fields
                if (!landlordSource.address ||
                    !landlordSource.address.postcode || landlordSource.address.postcode.trim() === '' ||
                    !landlordSource.address.nameNo || landlordSource.address.nameNo.trim() === '' ||
                    !landlordSource.address.street || landlordSource.address.street.trim() === '' ||
                    (!landlordSource.address.town && !landlordSource.address.locality) ||
                    ((landlordSource.address.town || '').trim() === '' && (landlordSource.address.locality || '').trim() === '')) {
                    missingFields.contacts.push(`${landlordLabel} address (${landlordForename} ${landlordSurname})`);
                    isComplete = false;
                }
            });
        }

        // Deposit validation
        const hasDeposit = this.checkDepositAvailability(altoData);
        if (!hasDeposit) {
            missingFields.deposit.push('deposit amount');
            isComplete = false;
        }

        // Create human-readable summary of missing fields
        const missingSummary = this.createHumanReadableSummary(missingFields);

        return {
            isComplete,
            missingFields,
            summary: missingSummary,
            canPendForPolling: this.canCreatePendingIntegration(missingFields)
        };
    }

    /**
     * Create human-readable summary from missing fields
     */
    createHumanReadableSummary(missingFields) {
        const messages = [];

        // Handle deposit
        if (missingFields.deposit.length > 0) {
            messages.push('Please add the deposit amount in Alto');
        }

        // Handle tenancy fields
        if (missingFields.tenancy.length > 0) {
            // Check for specific tenancy fields to provide better messaging
            if (missingFields.tenancy.includes('deposit scheme type')) {
                messages.push('Please specify the deposit scheme type in Alto');
            } else {
                messages.push('Please complete tenancy details in Alto');
            }
        }

        // Handle property fields
        if (missingFields.property.length > 0) {
            messages.push('Please complete property details in Alto');
        }

        // Handle contact fields with more specific messaging
        if (missingFields.contacts.length > 0) {
            const contactMessages = [];

            missingFields.contacts.forEach(field => {
                // Parse the field to create better messages
                if (field.includes('tenant 2 contact') || field.includes('tenant 3 contact') || field.includes('tenant 4 contact')) {
                    // Extract tenant name if present
                    const nameMatch = field.match(/\(([^)]+)\)/);
                    const name = nameMatch ? nameMatch[1] : 'joint tenant';
                    contactMessages.push(`Please add email or phone number for ${name} in Alto`);
                } else if (field.includes('lead tenant contact')) {
                    const nameMatch = field.match(/\(([^)]+)\)/);
                    const name = nameMatch ? nameMatch[1] : 'lead tenant';
                    contactMessages.push(`Please add email or phone number for ${name} in Alto`);
                } else if (field.includes('landlord 2 contact') || field.includes('landlord 3 contact') || field.includes('landlord 4 contact')) {
                    const nameMatch = field.match(/\(([^)]+)\)/);
                    const name = nameMatch ? nameMatch[1] : 'joint landlord';
                    contactMessages.push(`Please add email or phone number for ${name} in Alto`);
                } else if (field.includes('primary landlord contact')) {
                    const nameMatch = field.match(/\(([^)]+)\)/);
                    const name = nameMatch ? nameMatch[1] : 'primary landlord';
                    contactMessages.push(`Please add email or phone number for ${name} in Alto`);
                } else if (field.includes('landlord') && field.includes('address')) {
                    const nameMatch = field.match(/\(([^)]+)\)/);
                    const name = nameMatch ? nameMatch[1] : 'landlord';
                    contactMessages.push(`Please add complete address for ${name} in Alto`);
                } else if (field.includes('landlord') && field.includes('name')) {
                    contactMessages.push('Please add landlord name in Alto');
                } else if (field.includes('tenant') && field.includes('name')) {
                    contactMessages.push('Please add tenant name in Alto');
                } else if (field.includes('tenant contacts')) {
                    contactMessages.push('Please add tenant information in Alto');
                } else if (field.includes('landlord information')) {
                    contactMessages.push('Please add landlord information in Alto');
                }
            });

            messages.push(...contactMessages);
        }

        return messages.length > 0 ? messages.join('. ') : 'Missing required information';
    }

    /**
     * Check if deposit information is available from Alto data
     */
    checkDepositAvailability(altoData) {
        const { tenancy } = altoData;

        if (!tenancy) {
            this.context.log('❌ No tenancy data available');
            return false;
        }

        // Check if depositRequested or depositAmount is available and > 0
        const depositRequested = tenancy.depositRequested;
        const depositAmount = tenancy.depositAmount;

        this.context.log('🔍 Deposit availability check:', {
            depositRequested,
            depositAmount,
            hasDeposit: !!(depositRequested && depositRequested > 0) || !!(depositAmount && depositAmount > 0)
        });

        return !!(depositRequested && depositRequested > 0) || !!(depositAmount && depositAmount > 0);
    }

    /**
     * Determine if missing fields are suitable for pending/polling
     */
    canCreatePendingIntegration(missingFields) {
        // We can create pending integrations for:
        // 1. Missing deposit amounts (already supported)
        // 2. Missing optional tenancy fields like startDate (may be filled later)
        // 3. Missing contact information (may be added later)

        // We cannot create pending integrations for:
        // 1. Missing core tenancy or property data (fundamental data structure issues)

        const hasCoreTenancyData = !missingFields.tenancy.includes('entire tenancy data') && !missingFields.tenancy.includes('id');
        const hasCorePropertyData = !missingFields.property.includes('entire property data') && !missingFields.property.includes('id');

        return hasCoreTenancyData && hasCorePropertyData;
    }

    /**
     * Validate and enrich the fetched data (legacy method for compatibility)
     */
    async validateAndEnrichData(altoData) {
        this.context.log('✅ Validating and enriching data...');

        // Debug: Log the actual Alto API response structure
        this.context.log('🔍 Alto API Response Structure:');
        this.context.log('📋 Tenancy:', JSON.stringify(altoData.tenancy, null, 2));
        this.context.log('🏠 Property:', JSON.stringify(altoData.property, null, 2));
        this.context.log('👤 Landlord:', JSON.stringify(altoData.landlord, null, 2));
        this.context.log('👥 Tenants:', JSON.stringify(altoData.tenants, null, 2));

        // Use new comprehensive validation
        const validationResult = this.validateDataCompleteness(altoData);

        return {
            isValid: validationResult.isComplete,
            errors: validationResult.isComplete ? [] : [validationResult.summary],
            enrichedData: {
                ...altoData,
                validatedAt: new Date().toISOString()
            },
            validationResult // Include full validation details
        };
    }

    /**
     * Lookup postcode county
     */
    async lookupPostcode(postcode) {
        if (!postcode) {
            return { success: false, error: 'No postcode provided' };
        }

        try {
            // Use direct lookupPostcode helper (no HTTP, no auth needed for internal calls)
            const result = await lookupPostcode(postcode, this.context);

            return {
                success: true,
                postcode,
                county: result.region
            };

        } catch (error) {
            // In test mode, provide a default county if postcode lookup fails
            // (faker.js generates fake postcodes that don't exist in the real database)
            if (this.workflowData.testMode) {
                this.context.log(`⚠️ TEST MODE: Postcode lookup failed for ${postcode}, using default county: Buckinghamshire`);
                return {
                    success: true,
                    postcode,
                    county: 'Buckinghamshire',
                    isDefault: true
                };
            }

            return {
                success: false,
                postcode,
                error: error.response?.data?.error || error.message
            };
        }
    }

    /**
     * Prepare TDS deposit payload
     */
    async prepareTDSPayload(altoData, propertyPostcodeResult, landlordPostcodeResult) {
        this.context.log('📝 Preparing TDS deposit payload...');

        const { tenancy, property, tenants } = altoData;

        // Get agencyRef and branchId from workflow data (not from Alto API response)
        const agencyRef = this.workflowData.agencyRef;
        const branchId = this.workflowData.branchId;

        // Validate required organization/technical fields (these should never be missing from a webhook)
        if (!agencyRef) {
            throw new Error('Missing required field: agencyRef. Please ensure the webhook payload includes a valid agencyRef.');
        }

        if (!branchId) {
            throw new Error('Missing required field: branchId. Please ensure the webhook payload includes a valid branchId.');
        }

        // Extract all landlords and tenants (validation already done in validateDataCompleteness)
        // Prefer altoData.landlords from /landlords endpoint (has addresses), fall back to property.owners
        // Handle both structures: landlords object with items array, or direct array
        let allLandlords = [];
        if (altoData.landlords) {
            // /landlords endpoint returns { totalCount, items: [] }
            allLandlords = altoData.landlords.items || altoData.landlords;
        } else if (property.owners) {
            // property.owners is a direct array
            allLandlords = property.owners;
        }

        // Extract all tenants - handle both structures:
        // 1. Multiple people in same contact: tenants[0].items[0].people[]
        // 2. Multiple separate contacts: tenants[].items[0].people[0]
        const allTenants = [];
        if (tenants && tenants.length > 0) {
            tenants.forEach(tenantContact => {
                if (tenantContact.items && tenantContact.items.length > 0) {
                    const people = tenantContact.items[0].people || [];
                    const contactId = tenantContact.items[0].id; // Get the contact ID from items[0]
                    // Add contact ID to each person
                    const peopleWithContactId = people.map(person => ({
                        ...person,
                        contactId: contactId  // Add contact ID to person object
                    }));
                    allTenants.push(...peopleWithContactId);
                }
            });
        }

        // Process all landlords
        const processedLandlords = allLandlords.map((landlord, index) => {
            // Extract landlord contact information - Handle both flat and nested structures
            // /landlords endpoint: {email, phone, forename, surname, title}
            // property.owners: {emailAddresses[], phoneNumbers[], name: {forename, surname, title}}
            const landlordEmail = landlord.email ||
                (landlord.emailAddresses && landlord.emailAddresses.length > 0 ? landlord.emailAddresses[0].address : null);
            const landlordPhone = landlord.phone ||
                (landlord.phoneNumbers && landlord.phoneNumbers.length > 0 ? landlord.phoneNumbers[0].number : null);

            // All landlords require email or phone (TDS API requirement)
            if (!landlordEmail && !landlordPhone) {
                throw new Error(`Landlord ${index + 1} (${landlord.forename || landlord.name?.forename} ${landlord.surname || landlord.name?.surname}) must have either email or phone number - both are missing from Alto data`);
            }

            // Extract landlord name - handle both structures
            const landlordTitle = landlord.title || landlord.name?.title;
            const landlordForename = landlord.forename || landlord.name?.forename;
            const landlordSurname = landlord.surname || landlord.name?.surname;

            // Normalize title to TDS-accepted values (returns null if not supported)
            const normalizedTitle = this.normalizeTitle(landlordTitle);

            // Build landlord object - only include title if it's supported
            const landlordData = {
                id: landlord.id || landlord.ownerId || landlord.contactId,  // Use available ID field
                firstName: landlordForename,
                lastName: landlordSurname,
                email: landlordEmail,
                phone: landlordPhone,
                address: landlord.address,
                county: landlordPostcodeResult.county  // All landlords use same postcode lookup for now
            };

            // Only include title if it's a valid Salesforce title
            if (normalizedTitle) {
                landlordData.title = normalizedTitle;
            }

            return landlordData;
        });

        // Process all tenants
        const processedTenants = allTenants.map((tenant, index) => {
            // Extract tenant contact information - TDS requires at least ONE (email OR mobile, not both mandatory)
            const hasEmail = tenant.emailAddresses && tenant.emailAddresses.length > 0;
            const hasPhone = tenant.phoneNumbers && tenant.phoneNumbers.length > 0;

            // All tenants require email or phone (TDS API requirement)
            if (!hasEmail && !hasPhone) {
                throw new Error(`Tenant ${index + 1} (${tenant.forename} ${tenant.surname}) must have either email or phone number - both are missing from Alto data`);
            }

            const tenantEmail = hasEmail ? tenant.emailAddresses[0].address : null;
            const tenantPhone = hasPhone ? tenant.phoneNumbers[0].number : null;

            // Normalize title to TDS-accepted values (returns null if not supported)
            const normalizedTitle = this.normalizeTitle(tenant.title);

            // Debug: Log the contactId to see if it exists
            this.context.log(`🔍 Processing tenant ${index + 1}, contactId:`, tenant.contactId);

            // Build tenant object - only include title if it's supported
            const tenantData = {
                id: tenant.contactId,  // Use the contact ID we added earlier
                firstName: tenant.forename,
                lastName: tenant.surname,
                email: tenantEmail,
                phone: tenantPhone
            };

            // Only include title if it's a valid Salesforce title
            if (normalizedTitle) {
                tenantData.title = normalizedTitle;
            }

            return tenantData;
        });

        return {
            tenancyId: tenancy.id,
            depositAmount: tenancy.depositRequested,  // Alto API field name
            rentAmount: property.rent || tenancy.rent,  // Prefer property.rent per PoC
            tenancyStartDate: tenancy.startDate,
            tenancyEndDate: tenancy.endDate,
            property: {
                id: property.id,  // Include property ID from Alto
                address: property.address,
                county: propertyPostcodeResult.county,
                propertyType: property.propertyType,
                bedrooms: property.bedrooms,
                receptions: property.receptions
            },
            landlords: processedLandlords,  // Array of all landlords
            landlord: processedLandlords[0],  // Keep backwards compatibility - first landlord
            tenants: processedTenants,  // Array of all tenants
            // Include organization mapping data for TDS adapter
            agencyRef: agencyRef,
            branchId: branchId,
            agency: {
                ref: agencyRef,
                branchId: branchId
            },
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Create TDS deposit
     */
    async createTDSDeposit(payload) {
        this.context.log('💰 Creating TDS deposit...');

        try {
            // Call our TDS adapter function
            const response = await axios.post(
                `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/tds/create`,
                payload,
                {
                    headers: this.bearerToken ? {
                        'Authorization': `Bearer ${this.bearerToken}`,
                        'Content-Type': 'application/json'
                    } : {
                        'Content-Type': 'application/json'
                    },
                    timeout: 600000
                }
            );

            return response.data;

        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || error.message
            };
        }
    }

    /**
     * Create pending integration record for missing data
     */
    async createPendingIntegrationForMissingData(workflowData, altoData, validationResult) {
        this.context.log('💤 Creating pending integration for missing data...');

        const { TableClient } = require('@azure/data-tables');

        try {
            // Determine the appropriate integration status based on what's missing
            let integrationStatus = 'PENDING_DATA';
            let pendingReason = `Waiting for: ${validationResult.summary}`;

            // Use legacy status for deposit-only issues
            if (validationResult.missingFields.deposit.length > 0 &&
                validationResult.missingFields.tenancy.length === 0 &&
                validationResult.missingFields.property.length === 0 &&
                validationResult.missingFields.contacts.length === 0) {
                integrationStatus = 'PENDING_DEPOSIT';
                pendingReason = 'Awaiting deposit amount in Alto tenancy';
            }

            const integrationId = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
            const partitionKey = 'PendingIntegration';
            const rowKey = integrationId;

            const integrationEntity = {
                partitionKey,
                rowKey,
                workflowId: this.workflowId,
                tenancyId: workflowData.tenancyId,
                agencyRef: workflowData.agencyRef || altoData.tenancy?.agencyRef || '',
                branchId: workflowData.branchId || altoData.tenancy?.branchId || '',

                // Status tracking
                webhookStatus: 'COMPLETED',
                altoDataRetrievalStatus: altoData ? 'COMPLETED' : 'PARTIAL',
                tdsCreationStatus: 'PENDING',
                integrationStatus: integrationStatus,

                // Store retrieved data for later processing (even if partial)
                webhookData: JSON.stringify(workflowData),
                altoTenancyData: altoData?.tenancy ? JSON.stringify(altoData.tenancy) : null,
                altoPropertyData: altoData?.property ? JSON.stringify(altoData.property) : null,
                altoLandlordData: altoData?.property?.owners ? JSON.stringify(altoData.property.owners) : null,
                altoTenantData: altoData?.tenants ? JSON.stringify(altoData.tenants) : null,

                // References and timestamps
                externalReference: workflowData.tenancyId,
                webhookReceivedAt: new Date().toISOString(),
                altoDataRetrievedAt: altoData ? new Date().toISOString() : null,

                // Pending-specific fields
                pendingReason: pendingReason,
                missingFields: JSON.stringify(validationResult.missingFields),
                lastPolledAt: new Date().toISOString(),
                pollCount: 0,
                maxPollCount: null, // Will use settings-based value in polling service
                nextPollAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // Next poll in 2 minutes

                // Will be populated later
                tdsPayloadData: null,
                tdsResponse: null,
                danNumber: null,
                tdsDepositId: null,
                tdsCreatedAt: null,
                danReceivedAt: null,

                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Store to Azure Storage Table
            const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
            const tableClient = TableClient.fromConnectionString(connectionString, 'PendingIntegrations');

            // Create table if it doesn't exist
            await tableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err; // Ignore 'already exists' error
            });

            // Check if a pending integration already exists for this tenancyId
            const existingEntities = tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq 'PendingIntegration' and tenancyId eq '${workflowData.tenancyId}'` }
            });

            let existingPendingIntegration = null;
            for await (const entity of existingEntities) {
                // Only consider truly pending integrations (not completed/failed)
                if (entity.integrationStatus && ['PENDING_DEPOSIT', 'PENDING_DATA', 'PROCESSING'].includes(entity.integrationStatus)) {
                    existingPendingIntegration = entity;
                    break;
                }
            }

            if (existingPendingIntegration) {
                // Update existing pending integration instead of creating duplicate
                this.context.log(`🔄 Updating existing pending integration ${existingPendingIntegration.rowKey} for tenancy ${workflowData.tenancyId}`);

                const updatedEntity = {
                    ...existingPendingIntegration,
                    integrationStatus: integrationStatus,
                    pendingReason: pendingReason,
                    missingFields: JSON.stringify(validationResult.missingFields),
                    lastPolledAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    // Update Alto data if we have fresher data
                    altoTenancyData: altoData?.tenancy ? JSON.stringify(altoData.tenancy) : existingPendingIntegration.altoTenancyData,
                    altoPropertyData: altoData?.property ? JSON.stringify(altoData.property) : existingPendingIntegration.altoPropertyData,
                    altoLandlordData: altoData?.property?.owners ? JSON.stringify(altoData.property.owners) : existingPendingIntegration.altoLandlordData,
                    altoTenantData: altoData?.tenants ? JSON.stringify(altoData.tenants) : existingPendingIntegration.altoTenantData
                };

                await tableClient.updateEntity(updatedEntity, 'Replace');

                this.context.log(`💤 Updated pending integration record: ${existingPendingIntegration.rowKey} for tenancy: ${workflowData.tenancyId}`);
                this.context.log(`📋 Missing data: ${validationResult.summary}`);

                return {
                    success: false,
                    status: 'pending',
                    pendingId: existingPendingIntegration.rowKey,
                    pendingReason: pendingReason,
                    missingFields: validationResult.missingFields
                };
            } else {
                // No existing pending integration, create new one
                await tableClient.createEntity(integrationEntity);
            }

            this.context.log(`💤 Created pending integration record: ${integrationId} for tenancy: ${workflowData.tenancyId}`);
            this.context.log(`📋 Missing data: ${validationResult.summary}`);

            return {
                success: true,
                integrationId: integrationId,
                status: integrationStatus,
                message: 'Integration created in pending state',
                missingFields: validationResult.missingFields,
                pendingReason: pendingReason,
                nextPollAt: integrationEntity.nextPollAt
            };

        } catch (error) {
            this.context.log('❌ Failed to create pending integration record:', error);
            throw error;
        }
    }

    /**
     * Archive a rejected tenancy (not for TDS Custodial scheme)
     */
    async archiveTenancyRejection(workflowData, altoData, rejectionReason) {
        this.context.log('📦 Archiving rejected tenancy...');

        const { TableClient } = require('@azure/data-tables');

        try {
            const integrationId = `rejected_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
            const archiveEntity = {
                partitionKey: 'ArchivedIntegration',
                rowKey: integrationId,
                workflowId: this.workflowId || '',
                tenancyId: workflowData.tenancyId || '',
                agencyRef: workflowData.agencyRef || altoData.tenancy?.agencyRef || '',
                branchId: workflowData.branchId || altoData.tenancy?.branchId || '',

                // Status tracking
                webhookStatus: 'COMPLETED',
                altoDataRetrievalStatus: 'COMPLETED',
                tdsCreationStatus: 'NOT_ATTEMPTED',
                integrationStatus: 'REJECTED',
                finalStatus: 'REJECTED',
                archiveReason: rejectionReason || '',
                depositSchemeType: altoData.tenancy?.depositSchemeType || '',
                pendingReason: rejectionReason || '',

                // Store retrieved data for audit trail
                webhookData: workflowData ? JSON.stringify(workflowData) : '',
                altoTenancyData: altoData?.tenancy ? JSON.stringify(altoData.tenancy) : '',
                altoPropertyData: altoData?.property ? JSON.stringify(altoData.property) : '',
                altoLandlordData: '',
                altoTenantData: altoData?.tenants ? JSON.stringify(altoData.tenants) : '',

                // Empty fields
                externalReference: workflowData.tenancyId || '',
                tdsPayloadData: '',
                tdsResponse: '',
                danNumber: '',
                tdsDepositId: '',
                lastError: '',
                missingFields: '',

                // Timestamps
                webhookReceivedAt: new Date().toISOString(),
                altoDataRetrievedAt: new Date().toISOString(),
                tdsCreatedAt: '',
                danReceivedAt: '',
                lastPolledAt: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archivedAt: new Date().toISOString(),
                originalPartitionKey: 'PendingIntegration',

                // Polling fields
                pollCount: 0,
                maxPollCount: 0,
                nextPollAt: ''
            };

            // Store to archive table
            const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
            const archiveTableClient = TableClient.fromConnectionString(connectionString, 'PendingIntegrationArchive');

            // Create table if it doesn't exist
            this.context.log('📦 Creating archive table if needed...');
            await archiveTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) { // 409 = already exists
                    this.context.log('⚠️ Table creation warning:', err.message);
                    throw err;
                }
            });

            this.context.log('📦 Creating archive entity...');
            await archiveTableClient.createEntity(archiveEntity);

            this.context.log(`✅ Archived rejected tenancy: ${integrationId} to table PendingIntegrationArchive`);

            return {
                success: true,
                integrationId: integrationId,
                status: 'REJECTED'
            };

        } catch (error) {
            this.context.log('❌ Failed to archive rejected tenancy:', error);
            this.context.log('❌ Error details:', error.message);
            this.context.log('❌ Error stack:', error.stack);
            // Don't throw - archival failure shouldn't break the workflow response
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Store integration record (Step 6 of workflow)
     * Note: Audit logging is now handled separately by IntegrationAuditLogger
     */
    async storeIntegrationRecord(workflowData, altoData, tdsResult) {
        this.context.log('💾 Storing integration record...');

        // Create integration record with proper audit trail
        const integrationRecord = {
            id: `int_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
            workflowId: this.workflowId,
            tenancyId: workflowData.tenancyId,
            agencyRef: altoData.tenancy?.agencyRef || workflowData.agencyRef,
            branchId: altoData.tenancy?.branchId || workflowData.branchId,
            depositId: tdsResult.depositId,
            dan: tdsResult.dan,
            status: 'completed',
            source: workflowData.testMode ? 'TEST_WEBHOOK' : 'DIRECT_WEBHOOK',  // Tag test integrations
            testMode: workflowData.testMode || false,                           // Add test mode flag
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
        };

        // TODO: Optionally store to a separate IntegrationRecords table for detailed tracking
        // For now, the audit logging in AltoIntegrationLog provides the main audit trail

        this.context.log('📝 Integration record created:', integrationRecord.id);
        this.context.log('   ✅ Audit logging will be handled by IntegrationAuditLogger');

        return integrationRecord;
    }

    /**
     * Mock Alto data for development
     */
    getMockAltoData(tenancyId) {
        // For testing delayed processing, use zero deposit for specific tenancy IDs
        const isZeroDepositTest = tenancyId === 'TEN_ZERO_DEPOSIT' || tenancyId === 'TEN_000000';
        const depositAmount = isZeroDepositTest ? 0 : 1500.00;

        return {
            tenancy: {
                id: tenancyId,
                inventoryId: 'INV_789012',
                landlordId: 'CONTACT_LL_001',
                tenantIds: ['CONTACT_T_001'],
                depositRequested: depositAmount, // Alto API field name
                depositAmount: depositAmount,
                rentAmount: 1200.00,
                startDate: '2024-01-15',
                endDate: '2024-07-14',
                status: 'active',
                agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
                branchId: 'MAIN'
            },
            property: {
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
                bathrooms: 2,
                owners: [{
                    name: {
                        title: 'Mr',
                        forename: 'Test',
                        surname: 'Landlord'
                    },
                    emailAddresses: [{
                        address: 'landlord@example.com',
                        type: 'Business'
                    }],
                    phoneNumbers: [{
                        number: '01234567890',
                        type: 'Mobile'
                    }]
                }]
            },
            tenants: [{
                items: [{
                    people: [{
                        title: 'Ms',
                        forename: 'Test',
                        surname: 'Tenant',
                        emailAddresses: [{
                            address: 'tenant@example.com',
                            type: 'Personal'
                        }],
                        phoneNumbers: [{
                            number: '01234567891',
                            type: 'Mobile'
                        }]
                    }]
                }]
            }],
            fetchedAt: new Date().toISOString()
        };
    }
}
// Export for internal use by PendingPollingService (no HTTP, no auth needed)
module.exports = { AltoTDSOrchestrator };
