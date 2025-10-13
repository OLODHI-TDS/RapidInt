const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

/**
 * Centralized Integration Audit Logger
 * Handles consistent audit logging for all integration attempts across the system
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

            const logEntity = {
                partitionKey: 'Integration',
                rowKey: `${Date.now()}-${integrationData.tenancyId}`,
                tenancyId: integrationData.tenancyId,
                agencyRef: integrationData.agencyRef || '',
                branchId: integrationData.branchId || '',
                workflowId: integrationData.workflowId || '',
                integrationStatus: 'COMPLETED',
                source: integrationData.source || 'UNKNOWN',
                testMode: integrationData.testMode || false,             // NEW: Test mode flag
                startedAt: integrationData.startedAt || new Date().toISOString(),
                completedAt: new Date().toISOString(),

                // TDS Results
                danNumber: integrationData.dan || '',
                tdsDepositId: integrationData.depositId || '',
                tdsResponse: integrationData.tdsResponse ?
                    (typeof integrationData.tdsResponse === 'string' ?
                        integrationData.tdsResponse :
                        JSON.stringify(integrationData.tdsResponse)) : '',

                // Workflow step tracking
                totalSteps: integrationData.totalSteps || 6,
                completedSteps: integrationData.completedSteps || 6,
                workflowSteps: integrationData.workflowSteps ? JSON.stringify(integrationData.workflowSteps) : '',

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

            const logEntity = {
                partitionKey: 'Integration',
                rowKey: `${Date.now()}-${integrationData.tenancyId}`,
                tenancyId: integrationData.tenancyId,
                agencyRef: integrationData.agencyRef || '',
                branchId: integrationData.branchId || '',
                workflowId: integrationData.workflowId || '',
                integrationStatus: 'FAILED',
                source: integrationData.source || 'UNKNOWN',
                testMode: integrationData.testMode || false,             // NEW: Test mode flag
                startedAt: integrationData.startedAt || new Date().toISOString(),
                completedAt: new Date().toISOString(),

                // Failure details
                failureReason: integrationData.failureReason || 'UNKNOWN_ERROR',
                failureDescription: integrationData.failureDescription || 'No description provided',
                failureCategory: integrationData.failureCategory || 'unknown',
                lastError: integrationData.lastError ?
                    (typeof integrationData.lastError === 'string' ?
                        integrationData.lastError :
                        JSON.stringify(integrationData.lastError)) : '',

                // TDS attempt results (may be partial)
                danNumber: '',
                tdsDepositId: '',
                tdsResponse: integrationData.tdsResponse ?
                    (typeof integrationData.tdsResponse === 'string' ?
                        integrationData.tdsResponse :
                        JSON.stringify(integrationData.tdsResponse)) : '',

                // Workflow step tracking
                totalSteps: integrationData.totalSteps || 6,
                completedSteps: integrationData.completedSteps || 0,
                failedStep: integrationData.failedStep || 'unknown',
                workflowSteps: integrationData.workflowSteps ? JSON.stringify(integrationData.workflowSteps) : '',

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
     */
    async getAllLogs(limit = 100) {
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
                // Parse JSON fields
                const log = {
                    ...entity,
                    tdsResponse: this.safeJsonParse(entity.tdsResponse),
                    workflowSteps: this.safeJsonParse(entity.workflowSteps),
                    lastError: this.safeJsonParse(entity.lastError)
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

            this.context.log(`📖 Retrieved ${limitedLogs.length} audit log entries (out of ${logs.length} total)`);
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

            const logger = new IntegrationAuditLogger(context);
            const auditLog = await logger.getAllLogs(200); // Get last 200 entries

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    auditLog: auditLog,
                    count: auditLog.length,
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