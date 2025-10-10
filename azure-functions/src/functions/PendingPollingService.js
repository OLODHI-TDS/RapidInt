const { app } = require('@azure/functions');
const axios = require('axios');
const { TableClient } = require('@azure/data-tables');
const { IntegrationAuditLogger } = require('./IntegrationAuditLogger');

/**
 * Pending Integration Polling Service Azure Function
 * Polls pending integrations to check if missing data is now available
 */
// Timer function for automatic polling every 5 minutes
app.timer('PendingPollingService', {
    schedule: '0 */5 * * * *', // Run every 5 minutes
    handler: async (myTimer, context) => {
        try {
            context.log('🔄 Starting pending integration polling service...');

            const pollingService = new PendingPollingServiceClass(context);
            const results = await pollingService.processPendingIntegrations();

            context.log('✅ Polling service completed:', results);

            return {
                processed: results.processed,
                completed: results.completed,
                failed: results.failed,
                stillPending: results.stillPending,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            context.log('❌ Polling service failed:', error);
            throw error;
        }
    }
});

// Manual trigger endpoint for testing
app.http('PendingPollingServiceManual', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'polling/manual-trigger',
    handler: async (request, context) => {
        try {
            context.log('🔄 Manual pending integration polling triggered...');

            const pollingService = new PendingPollingServiceClass(context);
            const results = await pollingService.processPendingIntegrations();

            context.log('✅ Manual polling completed:', results);

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'Manual polling completed',
                    results: {
                        processed: results.processed,
                        completed: results.completed,
                        failed: results.failed,
                        stillPending: results.stillPending
                    },
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log('❌ Manual polling failed:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: 'Manual polling failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

// Get archived pending integrations
app.http('GetArchivedPendingIntegrations', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'pending-integrations/archive',
    handler: async (request, context) => {
        try {
            context.log('📦 Fetching archived pending integrations...');

            const pollingService = new PendingPollingServiceClass(context);
            const archived = await pollingService.getArchivedIntegrations();

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    archived: archived,
                    count: archived.length,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log('❌ Error fetching archived integrations:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: 'Failed to fetch archived integrations',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

/**
 * Pending Integration Polling Service Class
 */
class PendingPollingServiceClass {
    constructor(context) {
        this.context = context;
        this.tableName = 'PendingIntegrations';
        this.archiveTableName = 'PendingIntegrationArchive';

        // Use Azurite for local development
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        this.tableClient = TableClient.fromConnectionString(connectionString, this.tableName);
        this.archiveTableClient = TableClient.fromConnectionString(connectionString, this.archiveTableName);

        // Initialize audit logger
        this.auditLogger = new IntegrationAuditLogger(context);

        // Initialize polling settings manager
        const { PollingSettingsManager } = require('./PollingSettings');
        this.pollingSettingsManager = new PollingSettingsManager(context);
        this.settings = null;

        // Track initialization state
        this.tablesInitialized = false;
    }

    /**
     * Ensure tables are initialized (call this before any table operations)
     */
    async ensureTablesInitialized() {
        if (this.tablesInitialized) return;

        await this.initializeTable();
        await this.initializeArchiveTable();
        this.tablesInitialized = true;
    }

    /**
     * Initialize Azure Storage Table
     */
    async initializeTable() {
        try {
            await this.tableClient.createTable();
            this.context.log('✅ Pending integrations table initialized');
        } catch (error) {
            if (error.statusCode !== 409) { // 409 = table already exists
                this.context.log('❌ Failed to initialize table:', error.message);
            }
        }
    }

    /**
     * Initialize Archive Table
     */
    async initializeArchiveTable() {
        try {
            await this.archiveTableClient.createTable();
            this.context.log('✅ Pending integrations archive table initialized');
        } catch (error) {
            if (error.statusCode !== 409) { // 409 = table already exists
                this.context.log('❌ Failed to initialize archive table:', error.message);
            }
        }
    }

    /**
     * Process all pending integrations ready for polling
     */
    async processPendingIntegrations() {
        this.context.log('🔍 Checking for pending integrations ready for polling...');

        try {
            // Ensure tables are initialized
            await this.ensureTablesInitialized();

            // First, clean up any stale integrations that should be archived
            await this.cleanupStaleIntegrations();

            // Find pending integrations ready for polling
            const pendingIntegrations = await this.getPendingIntegrations();

            if (pendingIntegrations.length === 0) {
                this.context.log('📭 No pending integrations ready for polling');
                return { processed: 0, completed: 0, failed: 0, stillPending: 0 };
            }

            this.context.log(`📋 Found ${pendingIntegrations.length} pending integrations to check`);

            const results = {
                processed: 0,
                completed: 0,
                failed: 0,
                stillPending: 0
            };

            // Process each pending integration
            for (const integration of pendingIntegrations) {
                try {
                    const result = await this.processPendingIntegration(integration);
                    results.processed++;

                    if (result.status === 'completed') {
                        results.completed++;
                    } else if (result.status === 'failed' || result.status === 'permanently_failed') {
                        results.failed++;
                    } else {
                        results.stillPending++;
                    }

                } catch (error) {
                    this.context.log(`❌ Failed to process integration ${integration.id}:`, error.message);
                    results.failed++;
                }
            }

            return results;

        } catch (error) {
            this.context.log('❌ Error processing pending integrations:', error.message);
            throw error;
        }
    }

    /**
     * Cleanup stale integrations - archive terminal states and exceeded attempts
     */
    async cleanupStaleIntegrations() {
        try {
            const partitionKey = 'PendingIntegration';
            const settings = await this.loadSettings();

            this.context.log('🧹 Running cleanup for stale integrations...');

            // Get ALL pending integrations (not filtered by time)
            const entities = this.tableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${partitionKey}'`
                }
            });

            let archivedCount = 0;
            let totalCount = 0;

            for await (const entity of entities) {
                totalCount++;
                const maxPollCount = entity.maxPollCount || settings.maxPollAttempts || 20;

                this.context.log(`🔍 Checking ${entity.rowKey}: status=${entity.integrationStatus}, pollCount=${entity.pollCount}/${maxPollCount}`);

                // Archive if: exceeded max attempts, COMPLETED, FAILED, EXPIRED, or CANCELLED
                if ((entity.pollCount || 0) >= maxPollCount) {
                    this.context.log(`📦 Archiving ${entity.rowKey}: exceeded max attempts`);
                    await this.archiveIntegration(entity, 'FAILED', `Exceeded maximum poll attempts (${maxPollCount})`);
                    archivedCount++;
                } else if (entity.integrationStatus === 'COMPLETED') {
                    this.context.log(`📦 Archiving ${entity.rowKey}: COMPLETED`);
                    await this.archiveIntegration(entity, 'COMPLETED', entity.pendingReason || 'Successfully completed');
                    archivedCount++;
                } else if (entity.integrationStatus === 'FAILED') {
                    this.context.log(`📦 Archiving ${entity.rowKey}: FAILED`);
                    await this.archiveIntegration(entity, 'FAILED', entity.failureDescription || entity.pendingReason || 'Failed');
                    archivedCount++;
                } else if (entity.integrationStatus === 'EXPIRED') {
                    this.context.log(`📦 Archiving ${entity.rowKey}: EXPIRED`);
                    await this.archiveIntegration(entity, 'FAILED', entity.pendingReason || 'Expired');
                    archivedCount++;
                } else if (entity.integrationStatus === 'CANCELLED') {
                    this.context.log(`📦 Archiving ${entity.rowKey}: CANCELLED`);
                    await this.archiveIntegration(entity, 'FAILED', entity.pendingReason || 'Manually cancelled');
                    archivedCount++;
                } else if (entity.integrationStatus === 'PROCESSING') {
                    // Check if PROCESSING is abandoned (stuck for > 15 minutes)
                    const processingStartedAt = entity.processingStartedAt ? new Date(entity.processingStartedAt) : null;
                    if (processingStartedAt) {
                        const minutesSinceProcessingStarted = (Date.now() - processingStartedAt.getTime()) / 1000 / 60;
                        if (minutesSinceProcessingStarted > 15) {
                            this.context.log(`📦 Archiving ${entity.rowKey}: abandoned PROCESSING (stuck for ${Math.round(minutesSinceProcessingStarted)} minutes)`);
                            await this.archiveIntegration(entity, 'FAILED', `Processing abandoned after ${Math.round(minutesSinceProcessingStarted)} minutes`);
                            archivedCount++;
                        } else {
                            this.context.log(`⏭️ Skipping ${entity.rowKey}: currently PROCESSING (${Math.round(minutesSinceProcessingStarted)} minutes)`);
                        }
                    } else {
                        // No processingStartedAt timestamp - assume abandoned
                        this.context.log(`📦 Archiving ${entity.rowKey}: PROCESSING without timestamp (likely abandoned)`);
                        await this.archiveIntegration(entity, 'FAILED', 'Processing abandoned (no timestamp)');
                        archivedCount++;
                    }
                } else {
                    this.context.log(`⏭️ Skipping ${entity.rowKey}: still active (status=${entity.integrationStatus})`);
                }
            }

            this.context.log(`🧹 Cleanup complete: Checked ${totalCount} integrations, archived ${archivedCount}`);

        } catch (error) {
            this.context.log('❌ Error during cleanup:', error.message);
            this.context.log('❌ Stack:', error.stack);
            // Don't throw - cleanup failure shouldn't break polling
        }
    }

    /**
     * Get pending integrations ready for polling
     */
    async getPendingIntegrations() {
        try {
            const now = new Date();
            const partitionKey = 'PendingIntegration';

            // Get only active integrations that are truly pending and ready for next poll
            const entities = this.tableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${partitionKey}' and nextPollAt le datetime'${now.toISOString()}' and (integrationStatus eq 'PENDING_DEPOSIT' or integrationStatus eq 'PENDING_DATA')`
                }
            });

            const pendingIntegrations = [];

            for await (const entity of entities) {
                pendingIntegrations.push(entity);
            }

            // Sort by nextPollAt (oldest first) and limit to 10 to avoid overwhelming
            const result = pendingIntegrations
                .sort((a, b) => new Date(a.nextPollAt) - new Date(b.nextPollAt))
                .slice(0, 10);

            if (result.length > 0) {
                this.context.log(`📋 Processing ${result.length} integrations ready for polling`);
            }
            return result;

        } catch (error) {
            this.context.log('❌ Error getting pending integrations:', error.message);
            return [];
        }
    }

    /**
     * Process a single pending integration
     */
    async processPendingIntegration(integration) {
        this.context.log(`🔄 Processing ${integration.rowKey}: attempt ${integration.pollCount + 1}`);

        try {
            // IMMEDIATELY mark as PROCESSING to prevent duplicate processing by concurrent polls
            integration.integrationStatus = 'PROCESSING';
            integration.processingStartedAt = new Date().toISOString();
            integration.pollCount = (integration.pollCount || 0) + 1;
            integration.lastPolledAt = new Date().toISOString();
            await this.updateIntegration(integration);

            // Check if max polls exceeded using settings
            const settings = await this.loadSettings();
            const maxPollCount = integration.maxPollCount || settings.maxPollAttempts || 20;

            if (integration.pollCount >= maxPollCount) {
                this.context.log(`⏰ ${integration.rowKey} exceeded max attempts (${maxPollCount}) - archiving`);
                integration.integrationStatus = 'EXPIRED';
                integration.pendingReason = `Exceeded maximum polling attempts (${maxPollCount})`;
                await this.archiveIntegration(integration, 'FAILED', `Exceeded maximum polling attempts (${maxPollCount})`);
                return { status: 'failed', reason: 'expired' };
            }

            // Re-fetch Alto data to check if missing fields are now available
            const altoData = await this.fetchAltoData(integration);
            if (!altoData) {
                // Revert status back to PENDING_DATA and schedule next poll
                integration.integrationStatus = 'PENDING_DATA';
                integration.pendingReason = 'Alto data unavailable';
                integration.nextPollAt = (await this.calculateNextPollTime(integration.pollCount)).toISOString();
                await this.updateIntegration(integration);
                return { status: 'pending', reason: 'alto_data_unavailable' };
            }

            // Check if data is now complete
            // Parse missing fields if it's a string
            let parsedMissingFields;
            try {
                parsedMissingFields = typeof integration.missingFields === 'string'
                    ? JSON.parse(integration.missingFields)
                    : integration.missingFields;
            } catch (error) {
                parsedMissingFields = { tenancy: [], property: [], contacts: [], deposit: ['deposit amount'] };
            }

            const validationResult = this.validateDataCompleteness(altoData, parsedMissingFields);

            if (validationResult.isComplete) {
                this.context.log(`✅ ${integration.rowKey} data complete - triggering workflow`);

                // Update pending reason (status already set to PROCESSING at start of function)
                integration.pendingReason = 'Submitting to TDS for deposit creation';
                await this.updateIntegration(integration);

                // Trigger the workflow orchestrator with complete data
                const workflowResult = await this.triggerWorkflowOrchestrator({
                    tenancyId: integration.tenancyId,
                    agencyRef: integration.agencyRef,
                    branchId: integration.branchId
                });

                if (workflowResult.success) {
                    // Mark as completed and store results
                    integration.integrationStatus = 'COMPLETED';
                    integration.tdsResponse = JSON.stringify(workflowResult); // Stringify to avoid EDM type error
                    integration.danNumber = workflowResult.dan || '';
                    integration.tdsDepositId = workflowResult.depositId || '';
                    integration.tdsCreatedAt = new Date().toISOString();
                    integration.danReceivedAt = new Date().toISOString();
                    integration.tdsCreationStatus = 'COMPLETED';
                    integration.pendingReason = 'Completed via polling service';

                    // Log successful integration to audit log using centralized logger
                    await this.auditLogger.logSuccess({
                        tenancyId: integration.tenancyId,
                        agencyRef: integration.agencyRef,
                        branchId: integration.branchId,
                        workflowId: integration.workflowId,
                        source: 'PENDING_POLLING',
                        startedAt: new Date().toISOString(),
                        dan: workflowResult.dan,
                        depositId: workflowResult.depositId,
                        tdsResponse: workflowResult,
                        totalSteps: 6,
                        completedSteps: 6, // Polling service only completes when full workflow succeeds
                        workflowSteps: [], // Could be populated if needed
                        processingTimeMs: 0, // Could calculate from poll start time if needed
                        webhookId: integration.webhookId || ''
                    });

                    // Archive completed integration
                    await this.archiveIntegration(integration, 'COMPLETED', 'Successfully processed via polling service');

                    return { status: 'completed', workflowResult };
                } else {
                    // Analyze the error to determine if it's retryable
                    const errorAnalysis = this.analyzeTDSError(workflowResult.error);

                    if (errorAnalysis.isPermanent) {
                        this.context.log(`🚫 ${integration.rowKey} permanent error - archiving: ${errorAnalysis.description}`);

                        // Mark as permanently failed
                        integration.integrationStatus = 'FAILED';
                        integration.lastError = JSON.stringify(workflowResult); // Stringify to avoid EDM type error
                        integration.failureReason = 'PERMANENT_TDS_ERROR';
                        integration.failureDescription = errorAnalysis.description || '';
                        integration.failureCategory = errorAnalysis.category || '';
                        integration.failedAt = new Date().toISOString();
                        integration.tdsCreationStatus = 'FAILED';

                        // Log failed integration to audit log using centralized logger
                        await this.auditLogger.logFailure({
                            tenancyId: integration.tenancyId,
                            agencyRef: integration.agencyRef,
                            branchId: integration.branchId,
                            workflowId: integration.workflowId,
                            source: 'PENDING_POLLING',
                            startedAt: new Date().toISOString(),
                            failureReason: errorAnalysis.category === 'validation' ? 'TDS_VALIDATION_ERROR' : 'TDS_PERMANENT_ERROR',
                            failureDescription: errorAnalysis.description,
                            failureCategory: errorAnalysis.category,
                            lastError: workflowResult,
                            totalSteps: 6,
                            completedSteps: 0, // Failed before completing workflow
                            failedStep: 'create_tds_deposit',
                            workflowSteps: [], // Could be populated if needed
                            processingTimeMs: 0,
                            webhookId: integration.webhookId || ''
                        });

                        // Archive failed integration
                        await this.archiveIntegration(integration, 'FAILED', errorAnalysis.description);

                        return { status: 'permanently_failed', reason: 'non_retryable_tds_error', errorAnalysis };
                    } else {
                        // Retryable TDS error - revert to PENDING_DEPOSIT and schedule retry
                        integration.integrationStatus = 'PENDING_DEPOSIT';
                        integration.lastError = JSON.stringify(workflowResult); // Stringify to avoid EDM type error
                        integration.pendingReason = `TDS error (retryable): ${errorAnalysis.description}`;
                        integration.nextPollAt = (await this.calculateNextPollTime(integration.pollCount)).toISOString();

                        await this.updateIntegration(integration);
                        return { status: 'pending', reason: 'retryable_tds_error' };
                    }
                }
            } else {
                // Data still incomplete - revert status back to PENDING and schedule next poll
                integration.integrationStatus = validationResult.missingFields.deposit?.length > 0 ? 'PENDING_DEPOSIT' : 'PENDING_DATA';
                integration.missingFields = validationResult.missingFields;
                integration.pendingReason = `Waiting for: ${validationResult.summary}`;
                integration.nextPollAt = (await this.calculateNextPollTime(integration.pollCount)).toISOString();

                await this.updateIntegration(integration);
                return { status: 'pending', reason: 'data_still_incomplete' };
            }

        } catch (error) {
            this.context.log(`❌ Error processing ${integration.rowKey}:`, error.message);

            // Revert to PENDING_DEPOSIT on unexpected error and schedule retry
            integration.integrationStatus = 'PENDING_DEPOSIT';
            integration.lastError = {
                message: error.message,
                timestamp: new Date().toISOString()
            };
            integration.pendingReason = `Processing error: ${error.message}`;
            integration.nextPollAt = (await this.calculateNextPollTime(integration.pollCount)).toISOString();

            await this.updateIntegration(integration);
            throw error;
        }
    }

    /**
     * Load polling settings from storage
     */
    async loadSettings() {
        if (!this.settings) {
            try {
                this.settings = await this.pollingSettingsManager.getSettings();
                this.context.log(`📊 Loaded polling settings: pendingPollInterval=${this.settings.pendingPollInterval}min, maxPollAttempts=${this.settings.maxPollAttempts}`);
            } catch (error) {
                this.context.log('⚠️ Failed to load polling settings, using defaults:', error.message);
                this.settings = {
                    pendingPollInterval: 5,
                    depositCheckInterval: 10,
                    maxPollAttempts: 20,
                    backoffMultiplier: 1.5
                };
            }
        }
        return this.settings;
    }

    /**
     * Calculate next poll time with configurable exponential backoff
     */
    async calculateNextPollTime(pollCount) {
        const settings = await this.loadSettings();

        // Use settings-based intervals with exponential backoff
        const baseInterval = settings.pendingPollInterval || 5; // minutes
        const multiplier = settings.backoffMultiplier || 1.5;

        // Calculate interval with exponential backoff: baseInterval * (multiplier ^ (pollCount - 1))
        // Cap at 60 minutes maximum
        const intervalMinutes = Math.min(
            baseInterval * Math.pow(multiplier, Math.max(0, pollCount - 1)),
            60
        );

        this.context.log(`⏰ Next poll for attempt ${pollCount} in ${intervalMinutes} minutes (base: ${baseInterval}, multiplier: ${multiplier})`);

        return new Date(Date.now() + intervalMinutes * 60 * 1000);
    }

    /**
     * Fetch Alto data for re-validation
     */
    async fetchAltoData(integration) {
        try {
            const response = await axios.post(
                `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/alto/fetch-tenancy/${integration.tenancyId}`,
                {
                    agencyRef: integration.agencyRef,
                    branchId: integration.branchId,
                    environment: integration.environment || 'development'
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000
                }
            );

            return response.data.success ? response.data.data : null;

        } catch (error) {
            this.context.log(`❌ Failed to fetch Alto data for ${integration.tenancyId}:`, error.message);
            return null;
        }
    }

    /**
     * Validate data completeness (synchronized with WorkflowOrchestrator logic)
     */
    validateDataCompleteness(altoData, previousMissingFields) {
        const missingFields = {
            tenancy: [],
            property: [],
            contacts: [],
            deposit: []
        };

        let isComplete = true;

        // Check deposit availability
        const depositRequested = altoData.tenancy?.depositRequested;
        const depositAmount = altoData.tenancy?.depositAmount;
        const hasDepositInfo = (depositRequested !== undefined && depositRequested !== null) ||
                              (depositAmount !== undefined && depositAmount !== null);

        if (!hasDepositInfo) {
            missingFields.deposit.push('deposit amount');
            isComplete = false;
        }

        // Check tenancy fields
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

        // Check property fields
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

        // Check tenant contact information
        if (!altoData.tenants || altoData.tenants.length === 0 ||
            !altoData.tenants[0]?.items || altoData.tenants[0].items.length === 0 ||
            !altoData.tenants[0].items[0]?.people || altoData.tenants[0].items[0].people.length === 0) {
            missingFields.contacts.push('tenant contacts');
            isComplete = false;
        } else {
            const tenant = altoData.tenants[0].items[0].people[0];
            if (!tenant.forename || !tenant.surname) {
                missingFields.contacts.push('tenant name (forename and surname)');
                isComplete = false;
            }

            // Check tenant has either email or phone
            const tenantHasEmail = tenant.emailAddresses && tenant.emailAddresses.length > 0;
            const tenantHasPhone = tenant.phoneNumbers && tenant.phoneNumbers.length > 0;
            if (!tenantHasEmail && !tenantHasPhone) {
                missingFields.contacts.push('tenant contact (email or phone)');
                isComplete = false;
            }
        }

        // Check landlord - try /landlords endpoint first, fall back to property.owners
        const landlordSource = altoData.landlord || altoData.property?.owners?.[0];

        if (!landlordSource) {
            missingFields.contacts.push('landlord information');
            isComplete = false;
        } else {
            // Handle both /landlords structure (flat: forename, surname) and property.owners structure (nested: name.forename)
            const landlordForename = landlordSource.forename || landlordSource.name?.forename;
            const landlordSurname = landlordSource.surname || landlordSource.name?.surname;

            if (!landlordForename || !landlordSurname) {
                missingFields.contacts.push('landlord name (forename and surname)');
                isComplete = false;
            }

            // Check landlord has either email or phone
            // Handle both structures: flat (email, phone) vs nested (emailAddresses[], phoneNumbers[])
            const landlordEmail = landlordSource.email ||
                (landlordSource.emailAddresses && landlordSource.emailAddresses.length > 0 ? landlordSource.emailAddresses[0].address : null);
            const landlordPhone = landlordSource.phone ||
                (landlordSource.phoneNumbers && landlordSource.phoneNumbers.length > 0 ? landlordSource.phoneNumbers[0].number : null);

            if (!landlordEmail && !landlordPhone) {
                missingFields.contacts.push('landlord contact (email or phone)');
                isComplete = false;
            }

            // Check landlord address - must have all required TDS fields
            if (!landlordSource.address ||
                !landlordSource.address.postcode || landlordSource.address.postcode.trim() === '' ||
                !landlordSource.address.nameNo || landlordSource.address.nameNo.trim() === '' ||
                !landlordSource.address.street || landlordSource.address.street.trim() === '' ||
                (!landlordSource.address.town && !landlordSource.address.locality) ||
                ((landlordSource.address.town || '').trim() === '' && (landlordSource.address.locality || '').trim() === '')) {
                missingFields.contacts.push('landlord address (nameNo, street, town, postcode required)');
                isComplete = false;
            }
        }

        const missingSummary = [];
        Object.keys(missingFields).forEach(category => {
            if (missingFields[category].length > 0) {
                missingSummary.push(`${category}: ${missingFields[category].join(', ')}`);
            }
        });

        return {
            isComplete,
            missingFields,
            summary: missingSummary.join('; ')
        };
    }

    /**
     * Trigger workflow orchestrator
     */
    async triggerWorkflowOrchestrator(workflowData) {
        try {
            const response = await axios.post(
                `${process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071'}/api/workflows/alto-tds`,
                workflowData,
                {
                    headers: { 'Content-Type': 'application/json' },
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
     * Update integration in storage
     */
    async updateIntegration(integration) {
        try {
            integration.updatedAt = new Date().toISOString();

            // Serialize complex objects for Azure Table Storage
            const updateEntity = { ...integration };
            if (updateEntity.lastError && typeof updateEntity.lastError === 'object') {
                updateEntity.lastError = JSON.stringify(updateEntity.lastError);
            }
            if (updateEntity.missingFields && typeof updateEntity.missingFields === 'object') {
                updateEntity.missingFields = JSON.stringify(updateEntity.missingFields);
            }

            await this.tableClient.updateEntity(updateEntity, 'Replace');
            this.context.log(`✅ Updated integration ${integration.rowKey}`);
        } catch (error) {
            this.context.log(`❌ Failed to update integration ${integration.rowKey}:`, error.message);
            throw error;
        }
    }

    /**
     * Archive an integration to the archive table and remove from active table
     */
    async archiveIntegration(integration, finalStatus, reason) {
        try {
            const archiveEntity = {
                partitionKey: 'ArchivedIntegration',
                rowKey: integration.rowKey,
                // Copy all original fields
                ...integration,
                // Add archive-specific metadata
                finalStatus: finalStatus,
                archiveReason: reason,
                archivedAt: new Date().toISOString(),
                originalPartitionKey: integration.partitionKey,
                // Ensure complex objects are serialized
                missingFields: typeof integration.missingFields === 'object'
                    ? JSON.stringify(integration.missingFields)
                    : integration.missingFields,
                lastError: typeof integration.lastError === 'object'
                    ? JSON.stringify(integration.lastError)
                    : integration.lastError,
                tdsResponse: typeof integration.tdsResponse === 'object'
                    ? JSON.stringify(integration.tdsResponse)
                    : integration.tdsResponse
            };

            // Add to archive table
            await this.archiveTableClient.createEntity(archiveEntity);

            // Remove from active table
            await this.tableClient.deleteEntity(integration.partitionKey, integration.rowKey);

            this.context.log(`📦 Archived integration ${integration.rowKey} with status ${finalStatus}`);
        } catch (error) {
            this.context.log(`❌ Failed to archive integration ${integration.rowKey}:`, error.message);
            // Don't throw - archival failure shouldn't break the flow
        }
    }

    /**
     * Get archived integrations
     */
    async getArchivedIntegrations() {
        try {
            // Ensure tables are initialized
            await this.ensureTablesInitialized();

            const partitionKey = 'ArchivedIntegration';

            this.context.log(`📦 Querying archive table for partition: ${partitionKey}`);

            // Get all archived integrations
            const entities = this.archiveTableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${partitionKey}'`
                }
            });

            const archivedIntegrations = [];
            let count = 0;
            for await (const entity of entities) {
                archivedIntegrations.push(entity);
                count++;
            }

            this.context.log(`📦 Found ${count} entities in archive table`);

            // Sort by archivedAt (most recent first)
            archivedIntegrations.sort((a, b) =>
                new Date(b.archivedAt) - new Date(a.archivedAt)
            );

            this.context.log(`📦 Retrieved ${archivedIntegrations.length} archived integrations`);
            return archivedIntegrations;

        } catch (error) {
            this.context.log('❌ Error getting archived integrations:', error.message);
            this.context.log('❌ Stack:', error.stack);
            return [];
        }
    }

    /**
     * Analyze TDS error to determine if it's permanent or temporary
     * Uses the same logic as the TDS adapter
     */
    analyzeTDSError(errorMessage) {
        if (!errorMessage || typeof errorMessage !== 'string') {
            return {
                isPermanent: false,
                description: 'Unknown error format',
                category: 'unknown'
            };
        }

        const errorText = errorMessage.toLowerCase();

        // Permanent error patterns (same as TDS adapter)
        const permanentErrorPatterns = [
            // Validation errors
            'must be present',
            'must be from 1 to 8 alphanumeric characters',
            'should match the number of tenants',
            'format incorrect for field type',
            'length out of bounds',
            // Business logic errors
            'attempt to update an existing tenancy',
            'validation: :',  // This is the pattern we saw with duplicate tenancy
            'invalid authentication key',
            'failed authentication',
            'invalid scheme_type',
            'member is not part of a valid scheme',
            'invalid json',
            // DAN-related validation
            'invalid dan',
            'the dan supplied could not be found',
            'not authorised to manage',
            'tenancy is not in correct state',
            // Field-specific validation errors
            'invalid_limit',
            'invalid_after_id',
            'must be supplied',
            'must be unique',
            'should conform to bs7666:2000',
            'value must be united_kingdom',
            // Payment/financial validation
            'unable to calculate tenant repayment values',
            'the repayment values do not match',
            'there is an existing case for this tenancy',
            'invalid tenancy scheme'
        ];

        // Temporary error patterns
        const temporaryErrorPatterns = [
            'service unavailable',
            'timeout',
            'connection refused',
            'internal server error',
            'database unavailable',
            'rate limit exceeded',
            'network error',
            'connection reset',
            'gateway timeout',
            'bad gateway',
            'service temporarily unavailable'
        ];

        // Check for permanent errors first
        for (const pattern of permanentErrorPatterns) {
            if (errorText.includes(pattern)) {
                return {
                    isPermanent: true,
                    description: errorMessage,
                    category: 'validation'
                };
            }
        }

        // Check for temporary errors
        for (const pattern of temporaryErrorPatterns) {
            if (errorText.includes(pattern)) {
                return {
                    isPermanent: false,
                    description: errorMessage,
                    category: 'temporary'
                };
            }
        }

        // Default: treat unknown errors as permanent (safer approach)
        return {
            isPermanent: true,
            description: errorMessage,
            category: 'unknown'
        };
    }

    // Note: Integration audit logging methods have been replaced by the centralized IntegrationAuditLogger
    // This ensures consistent audit logging across all sources (DIRECT_WEBHOOK, PENDING_POLLING)
}