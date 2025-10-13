const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { encryptPII, decryptPII } = require('../../shared-services/shared/pii-encryption');
const { getAuthenticatedUser } = require('../../shared-services/shared/auth-middleware');

/**
 * Centralized Integration Audit Logger
 * Handles consistent audit logging for all integration attempts across the system
 *
 * ✅ SECURITY: PII fields (tdsResponse, workflowSteps, lastError) are encrypted at rest
 * to comply with GDPR Article 32 (Security of Processing)
 */
class IntegrationAuditLogger {
    constructor(context) {
        this.context = context;
        this.integrationLogTableName = 'AltoIntegrationLog';

        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        this.logTableClient = TableClient.fromConnectionString(
            connectionString,
            this.integrationLogTableName
        );
    }

    /**
     * Log a successful integration completion
     */
    async logSuccess(integrationData) {
        try {
            // Create table if it doesn't exist
            await this.logTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err; // Ignore 'already exists' error
            });

            // ✅ SECURITY: Encrypt PII fields before storing (GDPR Article 32)
            const tdsResponseString = integrationData.tdsResponse ?
                (typeof integrationData.tdsResponse === 'string' ?
                    integrationData.tdsResponse :
                    JSON.stringify(integrationData.tdsResponse)) : '';

            const workflowStepsString = integrationData.workflowSteps ?
                JSON.stringify(integrationData.workflowSteps) : '';

            // Encrypt PII-containing fields
            const encryptedTdsResponse = tdsResponseString ?
                await encryptPII(tdsResponseString, null, this.context) : '';

            const encryptedWorkflowSteps = workflowStepsString ?
                await encryptPII(workflowStepsString, null, this.context) : '';

            this.context.log(`[PII-ENC] Encrypted audit log fields for tenancy ${integrationData.tenancyId}`);

            const logEntity = {
                partitionKey: 'Integration',
                rowKey: `${Date.now()}-${integrationData.tenancyId}`,
                tenancyId: integrationData.tenancyId,
                agencyRef: integrationData.agencyRef || '',
                branchId: integrationData.branchId || '',
                workflowId: integrationData.workflowId || '',
                integrationStatus: 'COMPLETED',
                source: integrationData.source || 'UNKNOWN',
                testMode: integrationData.testMode || false,
                startedAt: integrationData.startedAt || new Date().toISOString(),
                completedAt: new Date().toISOString(),

                // TDS Results (non-PII)
                danNumber: integrationData.dan || '',
                tdsDepositId: integrationData.depositId || '',

                // ✅ ENCRYPTED: TDS response (may contain echoed PII)
                tdsResponse: encryptedTdsResponse,

                // Workflow step tracking (non-PII counts)
                totalSteps: integrationData.totalSteps || 6,
                completedSteps: integrationData.completedSteps || 6,

                // ✅ ENCRYPTED: Workflow steps (may contain Alto data with PII)
                workflowSteps: encryptedWorkflowSteps,

                // Processing metrics
                processingTimeMs: integrationData.processingTimeMs || 0,

                // Optional fields
                webhookId: integrationData.webhookId || '',

                etag: '*'
            };

            // Remove any undefined/null values
            Object.keys(logEntity).forEach(key => {
                if (logEntity[key] === undefined || logEntity[key] === null) {
                    logEntity[key] = '';
                }
            });

            await this.logTableClient.createEntity(logEntity);

            this.context.log(`📝 [AUDIT] Logged successful integration for ${integrationData.tenancyId} (${integrationData.source})`);
            this.context.log(`    DAN: ${logEntity.danNumber}, Deposit: ${logEntity.tdsDepositId}, Steps: ${logEntity.completedSteps}/${logEntity.totalSteps}`);

            return { success: true, auditId: logEntity.rowKey };

        } catch (error) {
            this.context.log(`❌ [AUDIT] Failed to log successful integration for ${integrationData.tenancyId}:`, error.message);
            // Don't throw - audit logging is secondary
            return { success: false, error: error.message };
        }
    }

    /**
     * Log a failed integration attempt
     */
    async logFailure(integrationData) {
        try {
            // Create table if it doesn't exist
            await this.logTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err; // Ignore 'already exists' error
            });

            // ✅ SECURITY: Encrypt PII fields before storing (GDPR Article 32)
            const lastErrorString = integrationData.lastError ?
                (typeof integrationData.lastError === 'string' ?
                    integrationData.lastError :
                    JSON.stringify(integrationData.lastError)) : '';

            const tdsResponseString = integrationData.tdsResponse ?
                (typeof integrationData.tdsResponse === 'string' ?
                    integrationData.tdsResponse :
                    JSON.stringify(integrationData.tdsResponse)) : '';

            const workflowStepsString = integrationData.workflowSteps ?
                JSON.stringify(integrationData.workflowSteps) : '';

            // Encrypt PII-containing fields
            const encryptedLastError = lastErrorString ?
                await encryptPII(lastErrorString, null, this.context) : '';

            const encryptedTdsResponse = tdsResponseString ?
                await encryptPII(tdsResponseString, null, this.context) : '';

            const encryptedWorkflowSteps = workflowStepsString ?
                await encryptPII(workflowStepsString, null, this.context) : '';

            this.context.log(`[PII-ENC] Encrypted audit log fields for failed tenancy ${integrationData.tenancyId}`);

            const logEntity = {
                partitionKey: 'Integration',
                rowKey: `${Date.now()}-${integrationData.tenancyId}`,
                tenancyId: integrationData.tenancyId,
                agencyRef: integrationData.agencyRef || '',
                branchId: integrationData.branchId || '',
                workflowId: integrationData.workflowId || '',
                integrationStatus: 'FAILED',
                source: integrationData.source || 'UNKNOWN',
                testMode: integrationData.testMode || false,
                startedAt: integrationData.startedAt || new Date().toISOString(),
                completedAt: new Date().toISOString(),

                // Failure details (non-PII)
                failureReason: integrationData.failureReason || 'UNKNOWN_ERROR',
                failureDescription: integrationData.failureDescription || 'No description provided',
                failureCategory: integrationData.failureCategory || 'unknown',

                // ✅ ENCRYPTED: Error message (may contain PII from data validation)
                lastError: encryptedLastError,

                // TDS attempt results (may be partial)
                danNumber: '',
                tdsDepositId: '',

                // ✅ ENCRYPTED: TDS response (may contain echoed PII)
                tdsResponse: encryptedTdsResponse,

                // Workflow step tracking (non-PII counts)
                totalSteps: integrationData.totalSteps || 6,
                completedSteps: integrationData.completedSteps || 0,
                failedStep: integrationData.failedStep || 'unknown',

                // ✅ ENCRYPTED: Workflow steps (may contain Alto data with PII)
                workflowSteps: encryptedWorkflowSteps,

                // Processing metrics
                processingTimeMs: integrationData.processingTimeMs || 0,

                // Optional fields
                webhookId: integrationData.webhookId || '',

                etag: '*'
            };

            // Remove any undefined/null values
            Object.keys(logEntity).forEach(key => {
                if (logEntity[key] === undefined || logEntity[key] === null) {
                    logEntity[key] = '';
                }
            });

            await this.logTableClient.createEntity(logEntity);

            this.context.log(`📝 [AUDIT] Logged failed integration for ${integrationData.tenancyId} (${integrationData.source})`);
            this.context.log(`    Reason: ${logEntity.failureReason}, Steps: ${logEntity.completedSteps}/${logEntity.totalSteps}, Failed at: ${logEntity.failedStep}`);

            return { success: true, auditId: logEntity.rowKey };

        } catch (error) {
            this.context.log(`❌ [AUDIT] Failed to log failed integration for ${integrationData.tenancyId}:`, error.message);
            // Don't throw - audit logging is secondary
            return { success: false, error: error.message };
        }
    }

    /**
     * Helper method to calculate completed steps from steps array
     */
    static calculateCompletedSteps(steps) {
        if (!steps || !Array.isArray(steps)) return 0;
        return steps.filter(step => step.status === 'completed').length;
    }

    /**
     * Helper method to extract processing time from start time
     */
    static calculateProcessingTime(startTime) {
        if (!startTime) return 0;
        return Date.now() - startTime;
    }

    /**
     * Helper method to determine failure reason from error
     */
    static determineFailureReason(error, failedStep) {
        if (!error) return 'UNKNOWN_ERROR';

        const errorText = error.toString().toLowerCase();

        // TDS-specific errors
        if (errorText.includes('tds') || errorText.includes('deposit')) {
            if (errorText.includes('validation') || errorText.includes('invalid')) {
                return 'TDS_VALIDATION_ERROR';
            } else if (errorText.includes('timeout') || errorText.includes('network')) {
                return 'TDS_NETWORK_ERROR';
            } else if (errorText.includes('authentication') || errorText.includes('unauthorized')) {
                return 'TDS_AUTH_ERROR';
            } else {
                return 'TDS_API_ERROR';
            }
        }

        // Alto-specific errors
        if (errorText.includes('alto') || failedStep === 'fetch_alto_data') {
            if (errorText.includes('timeout') || errorText.includes('network')) {
                return 'ALTO_NETWORK_ERROR';
            } else {
                return 'ALTO_API_ERROR';
            }
        }

        // Validation errors
        if (failedStep === 'validate_data' || errorText.includes('validation')) {
            return 'DATA_VALIDATION_ERROR';
        }

        // Generic errors
        if (errorText.includes('timeout')) {
            return 'TIMEOUT_ERROR';
        } else if (errorText.includes('network') || errorText.includes('connection')) {
            return 'NETWORK_ERROR';
        } else {
            return 'SYSTEM_ERROR';
        }
    }

    /**
     * Get all audit logs from the table
     *
     * @param {number} limit - Maximum number of records to return
     * @param {Object} userContext - User context for PII decryption (optional)
     * @returns {Promise<Array>} - Array of audit log entries (PII fields decrypted if user has permission)
     */
    async getAllLogs(limit = 100, userContext = null) {
        try {
            // Create table if it doesn't exist
            await this.logTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err;
            });

            const logs = [];
            const entities = this.logTableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq 'Integration'`
                }
            });

            // Retrieve ALL entities first (don't limit during retrieval)
            // This ensures we can properly sort and then limit to get the most recent records
            for await (const entity of entities) {
                // ✅ SECURITY: Decrypt PII fields if user has permission
                let decryptedTdsResponse = entity.tdsResponse;
                let decryptedWorkflowSteps = entity.workflowSteps;
                let decryptedLastError = entity.lastError;

                // Attempt decryption (handles backwards compatibility for unencrypted data)
                try {
                    if (entity.tdsResponse) {
                        const decrypted = await decryptPII(entity.tdsResponse, userContext, this.context);
                        decryptedTdsResponse = decrypted;
                    }

                    if (entity.workflowSteps) {
                        const decrypted = await decryptPII(entity.workflowSteps, userContext, this.context);
                        decryptedWorkflowSteps = decrypted;
                    }

                    if (entity.lastError) {
                        const decrypted = await decryptPII(entity.lastError, userContext, this.context);
                        decryptedLastError = decrypted;
                    }
                } catch (decryptError) {
                    // If decryption fails (e.g., insufficient permissions), log warning
                    this.context.warn(`[PII-ENC] Failed to decrypt PII for audit log: ${decryptError.message}`);
                    // Leave fields encrypted (user will see encrypted strings)
                }

                // Parse JSON fields (now decrypted)
                const log = {
                    ...entity,
                    tdsResponse: this.safeJsonParse(decryptedTdsResponse),
                    workflowSteps: this.safeJsonParse(decryptedWorkflowSteps),
                    lastError: this.safeJsonParse(decryptedLastError)
                };
                logs.push(log);
            }

            // Sort by timestamp (newest first) - do this BEFORE limiting
            logs.sort((a, b) => {
                const timeA = a.completedAt || a.timestamp;
                const timeB = b.completedAt || b.timestamp;
                return new Date(timeB) - new Date(timeA);
            });

            // Now limit to the most recent N records
            const limitedLogs = logs.slice(0, limit);

            const decryptedCount = userContext ? ' (PII decrypted)' : ' (PII encrypted)';
            this.context.log(`📖 Retrieved ${limitedLogs.length} audit log entries (out of ${logs.length} total)${decryptedCount}`);
            return limitedLogs;

        } catch (error) {
            this.context.log(`❌ Failed to retrieve audit logs:`, error.message);
            return [];
        }
    }

    /**
     * Safely parse JSON strings
     */
    safeJsonParse(value) {
        if (!value || value === '') return null;
        if (typeof value === 'object') return value;
        try {
            return JSON.parse(value);
        } catch (e) {
            return value; // Return as-is if not valid JSON
        }
    }
}

// HTTP endpoint to retrieve audit logs
app.http('GetIntegrationAuditLog', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'integration-audit/list',
    handler: async (request, context) => {
        try {
            context.log('📖 Fetching integration audit logs...');

            // ✅ SECURITY: Get authenticated user for PII decryption
            let userContext = null;
            try {
                userContext = await getAuthenticatedUser(request, context);
                context.log(`[AUTH] User ${userContext.email} requesting audit logs`);
            } catch (authError) {
                // User not authenticated - will return encrypted PII fields
                context.log('[AUTH] No authentication provided - PII fields will remain encrypted');
            }

            const logger = new IntegrationAuditLogger(context);
            const auditLog = await logger.getAllLogs(200, userContext); // Pass user context for decryption

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    auditLog: auditLog,
                    count: auditLog.length,
                    authenticated: !!userContext,
                    piiDecrypted: !!userContext,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            context.log('❌ Error fetching audit logs:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    error: 'Failed to fetch audit logs',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

module.exports = { IntegrationAuditLogger };