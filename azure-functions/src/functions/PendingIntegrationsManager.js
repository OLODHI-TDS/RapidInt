const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { schemas } = require('../../shared-services/shared/validation-schemas');

/**
 * Pending Integrations Manager Azure Function
 * Provides HTTP endpoints to view and manage pending integrations
 */
app.http('PendingIntegrationsManager', {
    methods: ['GET', 'POST', 'DELETE'],
    authLevel: 'function',
    route: 'pending-integrations/{action?}/{id?}',
    handler: async (request, context) => {
        try {
            const action = request.params.action || 'list';
            let id = request.params.id;

            // ✅ HIGH-006 FIX: Validate pending integration ID for actions that require it
            const actionsRequiringId = ['get', 'retry', 'cancel', 'debug', 'delete', 'status'];
            if (actionsRequiringId.includes(action) && id) {
                try {
                    const { error: idError } = schemas.pendingIntegrationId.validate(id);
                    if (idError) {
                        context.warn('❌ Pending integration ID validation failed:', idError.message);

                        return {
                            status: 400,
                            jsonBody: {
                                success: false,
                                error: 'Invalid integration ID format',
                                message: idError.message,
                                expectedFormat: 'pending_<timestamp>_<8-char-hash>',
                                timestamp: new Date().toISOString()
                            }
                        };
                    }
                    context.log('✅ Pending integration ID validation passed');
                } catch (validationError) {
                    throw validationError;
                }
            }

            const manager = new PendingIntegrationsManagerClass(context);

            switch (action) {
                case 'list':
                    const integrations = await manager.getAllPendingIntegrations();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            integrations,
                            count: integrations.length,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'get':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required' }
                        };
                    }

                    const integration = await manager.getPendingIntegration(id);
                    if (!integration) {
                        return {
                            status: 404,
                            jsonBody: { error: 'Integration not found' }
                        };
                    }

                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            integration,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'retry':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required' }
                        };
                    }

                    const retryResult = await manager.retryPendingIntegration(id);
                    return {
                        status: retryResult.success ? 200 : 404,
                        jsonBody: {
                            ...retryResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'cancel':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required' }
                        };
                    }

                    const cancelResult = await manager.cancelPendingIntegration(id);
                    return {
                        status: cancelResult.success ? 200 : 404,
                        jsonBody: {
                            ...cancelResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'stats':
                    const stats = await manager.getPendingIntegrationsStats();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            stats,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'force-poll':
                    const pollResult = await manager.forcePollAll();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            message: 'Force polling initiated',
                            result: pollResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'debug':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required for debug' }
                        };
                    }

                    const debugResult = await manager.debugIntegration(id);
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            debug: debugResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'delete':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required for delete' }
                        };
                    }

                    const deleteResult = await manager.deleteIntegration(id);
                    return {
                        status: deleteResult.success ? 200 : 404,
                        jsonBody: {
                            ...deleteResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'clear-all':
                    const clearResult = await manager.clearAllRecords();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            message: 'All integration records cleared',
                            result: clearResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'status':
                    if (!id) {
                        return {
                            status: 400,
                            jsonBody: { error: 'Integration ID required for status check' }
                        };
                    }

                    const statusResult = await manager.getIntegrationStatus(id);
                    if (!statusResult) {
                        return {
                            status: 404,
                            jsonBody: { error: 'Integration not found' }
                        };
                    }

                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            integration: statusResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'summary':
                    const summaryResult = await manager.getAllIntegrationsSummary();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            summary: summaryResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'audit-log':
                    const auditResult = await manager.getAuditLog();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            auditLog: auditResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'archive':
                    const archivedIntegrations = await manager.getArchivedIntegrations();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            archived: archivedIntegrations,
                            count: archivedIntegrations.length,
                            timestamp: new Date().toISOString()
                        }
                    };

                default:
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Invalid action',
                            availableActions: ['list', 'get', 'retry', 'cancel', 'stats', 'force-poll', 'debug', 'delete', 'clear-all', 'status', 'summary', 'audit-log', 'archive'],
                            usage: {
                                list: 'GET /api/pending-integrations/list',
                                get: 'GET /api/pending-integrations/get/{id}',
                                retry: 'POST /api/pending-integrations/retry/{id}',
                                cancel: 'DELETE /api/pending-integrations/cancel/{id}',
                                stats: 'GET /api/pending-integrations/stats',
                                forcePoll: 'POST /api/pending-integrations/force-poll',
                                debug: 'GET /api/pending-integrations/debug/{id}',
                                delete: 'DELETE /api/pending-integrations/delete/{id}',
                                clearAll: 'POST /api/pending-integrations/clear-all',
                                status: 'GET /api/pending-integrations/status/{id}',
                                summary: 'GET /api/pending-integrations/summary',
                                auditLog: 'GET /api/pending-integrations/audit-log',
                                archive: 'GET /api/pending-integrations/archive'
                            }
                        }
                    };
            }

        } catch (error) {
            context.log('❌ Pending integrations manager error:', error);
            return {
                status: 500,
                jsonBody: {
                    error: 'Pending integrations manager failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

/**
 * Pending Integrations Manager Class
 */
class PendingIntegrationsManagerClass {
    constructor(context) {
        this.context = context;
        this.tableName = 'PendingIntegrations';
        this.archiveTableName = 'PendingIntegrationArchive';

        // Use Azurite for local development
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        this.tableClient = TableClient.fromConnectionString(connectionString, this.tableName);
        this.archiveTableClient = TableClient.fromConnectionString(connectionString, this.archiveTableName);
    }

    /**
     * Get all pending integrations
     */
    async getAllPendingIntegrations() {
        try {
            const partitionKey = 'PendingIntegration';

            // Get all integrations with basic filter
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
            });

            const integrations = [];
            for await (const entity of entities) {
                // Client-side filtering for pending statuses only
                const status = entity.integrationStatus;
                this.context.log(`🔍 Found integration ${entity.rowKey} with status: ${status}`);

                if (status && ['PENDING_DEPOSIT', 'PENDING_DATA'].includes(status)) {
                    integrations.push(this.formatIntegrationEntity(entity));
                } else {
                    this.context.log(`⏭️ Skipping integration ${entity.rowKey} with status: ${status} (not pending)`);
                }
            }

            // Sort by creation date (newest first)
            integrations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            this.context.log(`📊 Retrieved ${integrations.length} truly pending integrations`);
            return integrations;

        } catch (error) {
            this.context.log('❌ Error getting pending integrations:', error.message);
            return [];
        }
    }

    /**
     * Get specific pending integration
     */
    async getPendingIntegration(id) {
        try {
            const partitionKey = 'PendingIntegration';
            const rowKey = id;

            const entity = await this.tableClient.getEntity(partitionKey, rowKey);
            return this.formatIntegrationEntity(entity);

        } catch (error) {
            if (error.statusCode === 404) {
                return null;
            }
            this.context.log('❌ Error getting pending integration:', error.message);
            throw error;
        }
    }

    /**
     * Retry a pending integration (reset poll count and immediately run validation)
     */
    async retryPendingIntegration(id) {
        try {
            const integration = await this.getPendingIntegration(id);
            if (!integration) {
                return { success: false, error: 'Integration not found' };
            }

            this.context.log(`🔄 Starting immediate retry for integration ${id}`);

            // Reset polling state
            integration.pollCount = 0;
            integration.lastPolledAt = new Date().toISOString();

            // Re-fetch Alto data to check if missing fields are now available
            const altoData = await this.fetchAltoDataForRetry(integration);
            if (!altoData) {
                this.context.log(`❌ Could not fetch Alto data for ${integration.tenancyId}`);
                // Schedule next poll and return
                const updatedEntity = this.createCleanEntity(integration, {
                    pollCount: 0,
                    nextPollAt: this.calculateNextPollTime(1).toISOString(),
                    lastPolledAt: new Date().toISOString(),
                    pendingReason: `Manual retry failed - ${integration.pendingReason || 'Unknown reason'}`
                });

                // Remove any undefined/null values that could cause EDM errors
                Object.keys(updatedEntity).forEach(key => {
                    if (updatedEntity[key] === undefined || updatedEntity[key] === null) {
                        updatedEntity[key] = '';
                    }
                });

                await this.tableClient.updateEntity(updatedEntity, 'Replace');
                return { success: false, error: 'Could not fetch Alto data' };
            }

            // Debug: Log what we received from Alto
            this.context.log(`🔍 Fresh Alto data for ${integration.tenancyId}:`);
            this.context.log(`   Deposit Requested: ${altoData.tenancy?.depositRequested}`);
            this.context.log(`   Deposit Amount: ${altoData.tenancy?.depositAmount}`);
            this.context.log(`   Landlord Data: ${JSON.stringify(altoData.landlord)}`);
            this.context.log(`   Property Owners: ${JSON.stringify(altoData.property?.owners)}`);

            // Parse missing fields if it's a string
            let parsedMissingFields;
            try {
                parsedMissingFields = typeof integration.missingFields === 'string'
                    ? JSON.parse(integration.missingFields)
                    : integration.missingFields;
            } catch (error) {
                this.context.log(`⚠️ Failed to parse missing fields for ${integration.tenancyId}, using default structure`);
                parsedMissingFields = { tenancy: [], property: [], contacts: [], deposit: ['deposit amount'] };
            }

            // Check if data is now complete
            const validationResult = this.validateDataCompleteness(altoData, parsedMissingFields);

            // Debug: Log validation result
            this.context.log(`🔍 Validation result for ${integration.tenancyId}:`);
            this.context.log(`   Is Complete: ${validationResult.isComplete}`);
            this.context.log(`   Missing Fields: ${JSON.stringify(validationResult.missingFields)}`);
            this.context.log(`   Summary: ${validationResult.summary}`);

            if (validationResult.isComplete) {
                this.context.log(`✅ Data now complete for ${integration.tenancyId} - triggering workflow`);

                // IMMEDIATELY mark as PROCESSING to prevent duplicate processing by polling service
                const processingEntity = this.createCleanEntity(integration, {
                    integrationStatus: 'PROCESSING',
                    processingStartedAt: new Date().toISOString(),
                    pendingReason: 'Submitting to TDS for deposit creation (manual retry)'
                });

                // Remove any undefined/null values that could cause EDM errors
                Object.keys(processingEntity).forEach(key => {
                    if (processingEntity[key] === undefined || processingEntity[key] === null) {
                        processingEntity[key] = '';
                    }
                });

                await this.tableClient.updateEntity(processingEntity, 'Replace');
                this.context.log(`🔄 Marked ${integration.tenancyId} as PROCESSING`);

                // Trigger the workflow orchestrator with complete data
                const workflowResult = await this.triggerWorkflowOrchestrator({
                    tenancyId: integration.tenancyId,
                    agencyRef: integration.agencyRef,
                    branchId: integration.branchId
                });

                if (workflowResult.success) {
                    // Mark as completed and store results
                    const completedEntity = this.createCleanEntity(integration, {
                        integrationStatus: 'COMPLETED',
                        tdsCreationStatus: 'COMPLETED',
                        tdsResponse: JSON.stringify(workflowResult),
                        danNumber: workflowResult.dan || '',
                        tdsDepositId: workflowResult.depositId || '',
                        tdsCreatedAt: new Date().toISOString(),
                        danReceivedAt: new Date().toISOString(),
                        pendingReason: 'Completed via manual retry'
                    });

                    // Remove any undefined/null values that could cause EDM errors
                    Object.keys(completedEntity).forEach(key => {
                        if (completedEntity[key] === undefined || completedEntity[key] === null) {
                            completedEntity[key] = '';
                        }
                    });

                    await this.tableClient.updateEntity(completedEntity, 'Replace');

                    // Immediately archive the completed integration
                    await this.archiveIntegration(completedEntity, 'COMPLETED', 'Completed via manual retry');

                    this.context.log(`🎉 Integration ${id} completed successfully with DAN: ${workflowResult.dan}`);

                    // Note: Integration audit logging is handled by PendingPollingService for full workflow completions

                    return {
                        success: true,
                        message: 'Integration completed successfully',
                        status: 'completed',
                        dan: workflowResult.dan,
                        depositId: workflowResult.depositId
                    };
                } else if (workflowResult.status === 'pending') {
                    // Workflow identified data is still incomplete - return to pending state
                    this.context.log(`⏳ Workflow indicates data still incomplete for ${integration.tenancyId}`);

                    const integrationStatus = workflowResult.missingFields?.deposit?.length > 0 ? 'PENDING_DEPOSIT' : 'PENDING_DATA';

                    const stillPendingEntity = this.createCleanEntity(integration, {
                        integrationStatus: integrationStatus,
                        pollCount: 0,
                        nextPollAt: this.calculateNextPollTime(1).toISOString(),
                        lastPolledAt: new Date().toISOString(),
                        pendingReason: `Manual retry - ${workflowResult.pendingReason || 'Data still incomplete'}`,
                        missingFields: JSON.stringify(workflowResult.missingFields || {})
                    });

                    // Remove any undefined/null values that could cause EDM errors
                    Object.keys(stillPendingEntity).forEach(key => {
                        if (stillPendingEntity[key] === undefined || stillPendingEntity[key] === null) {
                            stillPendingEntity[key] = '';
                        }
                    });

                    await this.tableClient.updateEntity(stillPendingEntity, 'Replace');

                    this.context.log(`⏳ Integration ${id} returned to pending state: ${workflowResult.pendingReason}`);

                    return {
                        success: false,
                        message: 'Data still incomplete',
                        status: 'pending',
                        pendingReason: workflowResult.pendingReason,
                        missingFields: workflowResult.missingFields
                    };
                } else {
                    // True workflow failure (not just incomplete data)
                    this.context.log(`❌ Workflow failed for ${integration.tenancyId}:`, workflowResult.error);

                    const failedEntity = this.createCleanEntity(integration, {
                        integrationStatus: 'FAILED',
                        tdsCreationStatus: 'FAILED',
                        lastError: JSON.stringify(workflowResult),
                        pendingReason: `Workflow failed: ${workflowResult.error || 'Unknown error'}`
                    });

                    // Remove any undefined/null values that could cause EDM errors
                    Object.keys(failedEntity).forEach(key => {
                        if (failedEntity[key] === undefined || failedEntity[key] === null) {
                            failedEntity[key] = '';
                        }
                    });

                    await this.tableClient.updateEntity(failedEntity, 'Replace');

                    // Immediately archive the failed integration
                    await this.archiveIntegration(failedEntity, 'FAILED', `Workflow failed: ${workflowResult.error || 'Unknown error'}`);

                    // Note: Integration audit logging is handled by PendingPollingService for full workflow attempts

                    return {
                        success: false,
                        error: `Workflow failed: ${workflowResult.error}`,
                        status: 'failed'
                    };
                }
            } else {
                // Still missing data - revert to PENDING_DEPOSIT/PENDING_DATA and schedule next poll
                const integrationStatus = validationResult.missingFields.deposit?.length > 0 ? 'PENDING_DEPOSIT' : 'PENDING_DATA';

                const updatedEntity = this.createCleanEntity(integration, {
                    integrationStatus: integrationStatus,
                    pollCount: 0,
                    nextPollAt: this.calculateNextPollTime(1).toISOString(),
                    lastPolledAt: new Date().toISOString(),
                    pendingReason: `Manual retry - Still awaiting: ${validationResult.summary}`,
                    missingFields: JSON.stringify(validationResult.missingFields)
                });

                // Remove any undefined/null values that could cause EDM errors
                Object.keys(updatedEntity).forEach(key => {
                    if (updatedEntity[key] === undefined || updatedEntity[key] === null) {
                        updatedEntity[key] = '';
                    }
                });

                await this.tableClient.updateEntity(updatedEntity, 'Replace');

                this.context.log(`⏳ Integration ${id} still pending: ${validationResult.summary}`);

                return {
                    success: true,
                    message: 'Integration still pending - data not yet complete',
                    status: 'still_pending',
                    missingFields: validationResult.missingFields,
                    summary: validationResult.summary,
                    nextPollAt: updatedEntity.nextPollAt
                };
            }

        } catch (error) {
            this.context.log('❌ Error retrying integration:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel a pending integration
     */
    async cancelPendingIntegration(id) {
        try {
            const integration = await this.getPendingIntegration(id);
            if (!integration) {
                return { success: false, error: 'Integration not found' };
            }

            // Mark as cancelled
            const updatedEntity = this.createCleanEntity(integration, {
                integrationStatus: 'CANCELLED',
                pendingReason: 'Manually cancelled'
            });

            // Remove any undefined/null values that could cause EDM errors
            Object.keys(updatedEntity).forEach(key => {
                if (updatedEntity[key] === undefined || updatedEntity[key] === null) {
                    updatedEntity[key] = '';
                }
            });

            // Update first (in case archive fails)
            await this.tableClient.updateEntity(updatedEntity, 'Replace');

            this.context.log(`❌ Cancelled integration ${id}`);

            // Immediately archive the cancelled integration
            await this.archiveIntegration(updatedEntity, 'FAILED', 'Manually cancelled by user');

            return {
                success: true,
                message: 'Integration cancelled and archived successfully'
            };

        } catch (error) {
            this.context.log('❌ Error cancelling integration:', error.message);
            return { success: false, error: error.message };
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

            // Ensure archive table exists
            await this.archiveTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err; // Ignore 'already exists' error
            });

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
     * Get pending integrations statistics
     */
    async getPendingIntegrationsStats() {
        try {
            const integrations = await this.getAllPendingIntegrations();

            const stats = {
                total: integrations.length,
                byStatus: {},
                averagePollCount: 0,
                oldestPending: null,
                newestPending: null,
                readyForPoll: 0,
                expiredSoon: 0 // Within 1 hour of max polls
            };

            let totalPollCount = 0;
            const now = new Date();

            integrations.forEach(integration => {
                // Count by status
                const status = integration.integrationStatus;
                stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

                // Calculate averages and extremes
                totalPollCount += integration.pollCount || 0;

                if (!stats.oldestPending || new Date(integration.createdAt) < new Date(stats.oldestPending)) {
                    stats.oldestPending = integration.createdAt;
                }

                if (!stats.newestPending || new Date(integration.createdAt) > new Date(stats.newestPending)) {
                    stats.newestPending = integration.createdAt;
                }

                // Check if ready for polling
                if (['PENDING_DEPOSIT', 'PENDING_DATA'].includes(status) &&
                    new Date(integration.nextPollAt) <= now) {
                    stats.readyForPoll++;
                }

                // Check if expiring soon
                const pollsRemaining = (integration.maxPollCount || 288) - (integration.pollCount || 0);
                if (pollsRemaining <= 12) { // 1 hour at 5-minute intervals
                    stats.expiredSoon++;
                }
            });

            stats.averagePollCount = integrations.length > 0 ? Math.round(totalPollCount / integrations.length) : 0;

            return stats;

        } catch (error) {
            this.context.log('❌ Error getting stats:', error.message);
            return { error: error.message };
        }
    }

    /**
     * Delete integration from table completely
     */
    async deleteIntegration(id) {
        try {
            const partitionKey = 'PendingIntegration';
            const rowKey = id;

            this.context.log(`🗑️ Deleting integration: ${id}`);

            // Check if it exists first
            try {
                await this.tableClient.getEntity(partitionKey, rowKey);
            } catch (error) {
                if (error.statusCode === 404) {
                    return { success: false, error: 'Integration not found' };
                }
                throw error;
            }

            // Delete the entity
            await this.tableClient.deleteEntity(partitionKey, rowKey);

            this.context.log(`✅ Successfully deleted integration: ${id}`);

            return {
                success: true,
                message: `Integration ${id} deleted successfully`
            };

        } catch (error) {
            this.context.log('❌ Error deleting integration:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Debug integration - get raw entity data
     */
    async debugIntegration(id) {
        try {
            const partitionKey = 'PendingIntegration';
            const rowKey = id;

            this.context.log(`🔍 Debug lookup for integration: ${id}`);

            const entity = await this.tableClient.getEntity(partitionKey, rowKey);

            this.context.log(`📋 Raw entity data:`, JSON.stringify(entity, null, 2));

            return {
                found: true,
                rawEntity: entity,
                key: { partitionKey, rowKey },
                integrationStatus: entity.integrationStatus,
                danNumber: entity.danNumber,
                tdsDepositId: entity.tdsDepositId,
                pollCount: entity.pollCount,
                maxPollCount: entity.maxPollCount,
                nextPollAt: entity.nextPollAt,
                lastPolledAt: entity.lastPolledAt,
                createdAt: entity.createdAt,
                updatedAt: entity.updatedAt
            };

        } catch (error) {
            if (error.statusCode === 404) {
                this.context.log(`❌ Integration ${id} not found in table`);
                return { found: false, error: 'Integration not found' };
            }
            this.context.log('❌ Error debugging integration:', error.message);
            return { found: false, error: error.message };
        }
    }

    /**
     * Force poll all pending integrations
     */
    async forcePollAll() {
        try {
            const integrations = await this.getAllPendingIntegrations();
            const pendingIntegrations = integrations.filter(i =>
                ['PENDING_DEPOSIT', 'PENDING_DATA'].includes(i.integrationStatus)
            );

            let updated = 0;

            for (const integration of pendingIntegrations) {
                try {
                    const updatedEntity = this.createCleanEntity(integration, {
                        nextPollAt: new Date().toISOString() // Poll immediately
                    });

                    // Remove any undefined/null values that could cause EDM errors
                    Object.keys(updatedEntity).forEach(key => {
                        if (updatedEntity[key] === undefined || updatedEntity[key] === null) {
                            updatedEntity[key] = '';
                        }
                    });

                    await this.tableClient.updateEntity(updatedEntity, 'Replace');
                    updated++;

                } catch (error) {
                    this.context.log(`❌ Failed to update integration ${integration.id}:`, error.message);
                }
            }

            this.context.log(`🔄 Scheduled ${updated} integrations for immediate polling`);

            return {
                totalPending: pendingIntegrations.length,
                updated,
                message: `${updated} integrations scheduled for immediate polling`
            };

        } catch (error) {
            this.context.log('❌ Error force polling:', error.message);
            return { error: error.message };
        }
    }

    /**
     * Clear all pending integrations and integration log records
     */
    async clearAllRecords() {
        try {
            let pendingDeleted = 0;
            let logDeleted = 0;

            this.context.log('🧹 Starting cleanup of all integration records...');

            // Clear pending integrations table
            const partitionKey = 'PendingIntegration';
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
            });

            for await (const entity of entities) {
                try {
                    await this.tableClient.deleteEntity(partitionKey, entity.rowKey);
                    pendingDeleted++;
                    this.context.log(`✅ Deleted pending integration: ${entity.rowKey}`);
                } catch (error) {
                    this.context.log(`❌ Failed to delete pending integration ${entity.rowKey}:`, error.message);
                }
            }

            // Clear integration log table
            try {
                const logTableClient = TableClient.fromConnectionString(
                    process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true',
                    'AltoIntegrationLog'
                );

                const logPartitionKey = 'Integration';
                const logEntities = logTableClient.listEntities({
                    queryOptions: { filter: `PartitionKey eq '${logPartitionKey}'` }
                });

                for await (const entity of logEntities) {
                    try {
                        await logTableClient.deleteEntity(logPartitionKey, entity.rowKey);
                        logDeleted++;
                        this.context.log(`✅ Deleted integration log: ${entity.rowKey}`);
                    } catch (error) {
                        this.context.log(`❌ Failed to delete integration log ${entity.rowKey}:`, error.message);
                    }
                }
            } catch (error) {
                this.context.log('⚠️ Integration log table may not exist or is empty:', error.message);
            }

            this.context.log(`🧹 Cleanup completed: ${pendingDeleted} pending integrations deleted, ${logDeleted} log entries deleted`);

            return {
                pendingIntegrationsDeleted: pendingDeleted,
                integrationLogsDeleted: logDeleted,
                totalDeleted: pendingDeleted + logDeleted
            };

        } catch (error) {
            this.context.log('❌ Error during cleanup:', error.message);
            return {
                error: error.message,
                pendingIntegrationsDeleted: 0,
                integrationLogsDeleted: 0,
                totalDeleted: 0
            };
        }
    }

    /**
     * Create clean entity object for Azure Storage updates (avoids EDM type errors)
     */
    createCleanEntity(integration, overrides = {}) {
        const entity = integration._entity;
        return {
            partitionKey: entity.partitionKey,
            rowKey: entity.rowKey,
            workflowId: entity.workflowId || '',
            tenancyId: entity.tenancyId || '',
            agencyRef: entity.agencyRef || '',
            branchId: entity.branchId || '',
            webhookStatus: entity.webhookStatus || '',
            altoDataRetrievalStatus: entity.altoDataRetrievalStatus || '',
            tdsCreationStatus: entity.tdsCreationStatus || '',
            integrationStatus: entity.integrationStatus || '',
            webhookData: entity.webhookData || '',
            altoTenancyData: entity.altoTenancyData || '',
            altoPropertyData: entity.altoPropertyData || '',
            altoLandlordData: entity.altoLandlordData || '',
            altoTenantData: entity.altoTenantData || '',
            externalReference: entity.externalReference || '',
            webhookReceivedAt: entity.webhookReceivedAt || '',
            altoDataRetrievedAt: entity.altoDataRetrievedAt || '',
            pendingReason: entity.pendingReason || '',
            missingFields: entity.missingFields || '',
            lastPolledAt: entity.lastPolledAt || '',
            pollCount: entity.pollCount || 0,
            maxPollCount: entity.maxPollCount || 288,
            nextPollAt: entity.nextPollAt || '',
            tdsPayloadData: entity.tdsPayloadData || '',
            tdsResponse: entity.tdsResponse || '',
            danNumber: entity.danNumber || '',
            tdsDepositId: entity.tdsDepositId || '',
            tdsCreatedAt: entity.tdsCreatedAt || '',
            danReceivedAt: entity.danReceivedAt || '',
            lastError: entity.lastError || '',
            createdAt: entity.createdAt || '',
            updatedAt: new Date().toISOString(),
            ...overrides
        };
    }

    /**
     * Format integration entity for response
     */
    formatIntegrationEntity(entity) {
        const formatted = {
            id: entity.rowKey,
            workflowId: entity.workflowId,
            tenancyId: entity.tenancyId,
            agencyRef: entity.agencyRef,
            branchId: entity.branchId,
            integrationStatus: entity.integrationStatus,
            pendingReason: entity.pendingReason,
            pollCount: entity.pollCount || 0,
            maxPollCount: entity.maxPollCount || 288,
            nextPollAt: entity.nextPollAt,
            lastPolledAt: entity.lastPolledAt,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            webhookReceivedAt: entity.webhookReceivedAt,
            altoDataRetrievedAt: entity.altoDataRetrievedAt,
            danNumber: entity.danNumber,
            tdsDepositId: entity.tdsDepositId,
            _entity: entity // Keep full entity for updates
        };

        // Parse JSON fields
        try {
            if (entity.missingFields) {
                formatted.missingFields = JSON.parse(entity.missingFields);
            }
            if (entity.webhookData) {
                formatted.webhookData = JSON.parse(entity.webhookData);
            }
        } catch (error) {
            this.context.log('⚠️ Error parsing JSON fields for integration:', entity.rowKey);
        }

        return formatted;
    }

    /**
     * Fetch Alto data for retry validation
     */
    async fetchAltoDataForRetry(integration) {
        try {
            const axios = require('axios');
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
     * Validate data completeness for retry (synchronized with WorkflowOrchestrator logic)
     */
    validateDataCompleteness(altoData, previousMissingFields) {
        const missingFields = {
            tenancy: [],
            property: [],
            contacts: [],
            deposit: []
        };

        let isComplete = true;

        // Check deposit availability - synchronized with WorkflowOrchestrator.checkDepositAvailability
        // Consider deposit information available if the field exists (even if it's 0)
        // This allows zero-deposit tenancies to proceed
        const depositRequested = altoData.tenancy?.depositRequested;
        const depositAmount = altoData.tenancy?.depositAmount;

        const hasDepositInfo = (depositRequested !== undefined && depositRequested !== null) ||
                              (depositAmount !== undefined && depositAmount !== null);

        if (!hasDepositInfo) {
            missingFields.deposit.push('deposit amount');
            isComplete = false;
        }

        // Check other required tenancy fields
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
     * Calculate next poll time with exponential backoff
     */
    calculateNextPollTime(pollCount) {
        // Start with 2 minutes, then 5, 10, 15, 30, then stay at 60 minutes
        const intervals = [2, 5, 10, 15, 30, 60]; // minutes
        const intervalIndex = Math.min(pollCount - 1, intervals.length - 1);
        const intervalMinutes = intervals[intervalIndex];

        return new Date(Date.now() + intervalMinutes * 60 * 1000);
    }

    /**
     * Trigger workflow orchestrator
     */
    async triggerWorkflowOrchestrator(workflowData) {
        try {
            const axios = require('axios');
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

    // Note: Integration audit logging has been moved to PendingPollingService
    // The audit log should only contain integrations that have attempted the full 6-step workflow,
    // not partial retries or manual trigger attempts. Only the PendingPollingService performs
    // complete workflow executions and should create audit log entries.

    /**
     * Get integration status by ID (simplified view)
     */
    async getIntegrationStatus(integrationId) {
        try {
            const partitionKey = 'PendingIntegration';
            const rowKey = integrationId;

            const entity = await this.tableClient.getEntity(partitionKey, rowKey);

            if (!entity) {
                return null;
            }

            return {
                id: entity.rowKey,
                status: entity.integrationStatus || 'PENDING',
                tdsCreationStatus: entity.tdsCreationStatus || 'NOT_ATTEMPTED',
                tenancyId: entity.tenancyId,
                agencyRef: entity.agencyRef,
                createdAt: entity.createdAt,
                lastChecked: entity.lastPolledAt,
                attemptCount: entity.pollCount || 0,
                missingFields: entity.missingFields ? JSON.parse(entity.missingFields) : [],
                tdsResponse: entity.tdsResponse ? JSON.parse(entity.tdsResponse) : null,
                danNumber: entity.danNumber,
                tdsDepositId: entity.tdsDepositId,
                error: entity.lastError
            };
        } catch (error) {
            if (error.statusCode === 404) {
                return null;
            }
            this.context.log('❌ Error getting integration status:', error.message);
            return null;
        }
    }

    /**
     * Get all integrations summary report
     */
    async getAllIntegrationsSummary() {
        try {
            const partitionKey = 'PendingIntegration';

            const summary = {
                total: 0,
                pending: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
                byTdsStatus: {
                    NOT_ATTEMPTED: 0,
                    IN_PROGRESS: 0,
                    COMPLETED: 0,
                    FAILED: 0
                },
                recentIntegrations: [],
                pendingIntegrations: [],
                completedIntegrations: [],
                failedIntegrations: []
            };

            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
            });

            const allIntegrations = [];

            for await (const entity of entities) {
                summary.total++;

                const status = entity.integrationStatus || 'PENDING';
                const tdsStatus = entity.tdsCreationStatus || 'NOT_ATTEMPTED';

                // Count by status
                if (status === 'PENDING_DEPOSIT' || status === 'PENDING_DATA') {
                    summary.pending++;
                } else if (status === 'COMPLETED') {
                    summary.completed++;
                } else if (status === 'FAILED') {
                    summary.failed++;
                } else if (status === 'CANCELLED') {
                    summary.cancelled++;
                }

                // Count by TDS status
                if (summary.byTdsStatus[tdsStatus] !== undefined) {
                    summary.byTdsStatus[tdsStatus]++;
                }

                const integrationInfo = {
                    id: entity.rowKey,
                    tenancyId: entity.tenancyId,
                    status: status,
                    tdsCreationStatus: tdsStatus,
                    attemptCount: entity.pollCount || 0,
                    createdAt: entity.createdAt,
                    lastChecked: entity.lastPolledAt,
                    danNumber: entity.danNumber,
                    tdsDepositId: entity.tdsDepositId,
                    hasDeposit: entity.tdsResponse ? true : false
                };

                allIntegrations.push(integrationInfo);

                // Categorize integrations
                if (status === 'PENDING_DEPOSIT' || status === 'PENDING_DATA') {
                    summary.pendingIntegrations.push(integrationInfo);
                } else if (status === 'COMPLETED') {
                    summary.completedIntegrations.push(integrationInfo);
                } else if (status === 'FAILED') {
                    summary.failedIntegrations.push(integrationInfo);
                }
            }

            // Sort and get recent integrations (last 10)
            allIntegrations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            summary.recentIntegrations = allIntegrations.slice(0, 10);

            // Limit pending/completed/failed lists to 20 each
            summary.pendingIntegrations = summary.pendingIntegrations.slice(0, 20);
            summary.completedIntegrations = summary.completedIntegrations.slice(0, 20);
            summary.failedIntegrations = summary.failedIntegrations.slice(0, 20);

            return summary;
        } catch (error) {
            this.context.log('❌ Error getting integrations summary:', error.message);
            throw error;
        }
    }

    /**
     * Get audit log entries from the backend Azure Table
     */
    async getAuditLog() {
        try {
            const logTableName = 'AltoIntegrationLog';
            const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
            const logTableClient = TableClient.fromConnectionString(connectionString, logTableName);

            const partitionKey = 'Integration';
            const auditEntries = [];

            this.context.log('📖 Fetching audit log entries from Azure Table...');

            const entities = logTableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
            });

            for await (const entity of entities) {
                // Convert Azure Table entity to frontend audit log format
                const auditEntry = {
                    timestamp: entity.completedAt || entity.startedAt || new Date().toISOString(),
                    tenancyId: entity.tenancyId,
                    agencyRef: entity.agencyRef,
                    branchId: entity.branchId,
                    status: entity.integrationStatus === 'COMPLETED' ? 'Success' :
                            entity.integrationStatus === 'FAILED' ? 'Failed' : 'Pending',
                    dan: entity.danNumber || '-',
                    depositId: entity.tdsDepositId || '-',
                    processingTime: entity.processingTimeMs ? `${entity.processingTimeMs}ms` : '-',
                    steps: entity.totalSteps || 6,
                    completedSteps: entity.completedSteps || 0,
                    failedStep: entity.failedStep || '-',
                    error: entity.failureDescription || entity.lastError || '',
                    workflowId: entity.workflowId || entity.rowKey,
                    source: entity.source || 'UNKNOWN',
                    fullResult: {
                        success: entity.integrationStatus === 'COMPLETED',
                        dan: entity.danNumber,
                        depositId: entity.tdsDepositId,
                        processingTime: entity.processingTimeMs,
                        steps: this.safeJsonParse(entity.workflowSteps, []),
                        source: entity.source,
                        tdsResponse: this.safeJsonParse(entity.tdsResponse, null)
                    }
                };

                auditEntries.push(auditEntry);
            }

            // Sort by timestamp (newest first)
            auditEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            this.context.log(`📖 Retrieved ${auditEntries.length} audit log entries from backend`);

            return auditEntries;

        } catch (error) {
            this.context.log('❌ Error fetching audit log from Azure Table:', error.message);
            // Return empty array if table doesn't exist yet or other error
            return [];
        }
    }

    /**
     * Get archived integrations from the archive table
     */
    async getArchivedIntegrations() {
        try {
            const archivedIntegrations = [];

            this.context.log('📖 Fetching archived integrations from Azure Table...');

            // Ensure archive table exists
            await this.archiveTableClient.createTable().catch(err => {
                if (err.statusCode !== 409) throw err;
            });

            const entities = this.archiveTableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq 'ArchivedIntegration'` }
            });

            for await (const entity of entities) {
                // Parse JSON fields
                const archivedIntegration = {
                    ...entity,
                    missingFields: this.safeJsonParse(entity.missingFields, {}),
                    lastError: this.safeJsonParse(entity.lastError, null),
                    tdsResponse: this.safeJsonParse(entity.tdsResponse, null)
                };

                archivedIntegrations.push(archivedIntegration);
            }

            // Sort by archived date (newest first)
            archivedIntegrations.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

            this.context.log(`📖 Retrieved ${archivedIntegrations.length} archived integrations`);

            return archivedIntegrations;

        } catch (error) {
            this.context.log('❌ Error fetching archived integrations:', error.message);
            return [];
        }
    }

    /**
     * Helper method to safely parse JSON strings
     */
    safeJsonParse(jsonString, defaultValue = null) {
        if (!jsonString) return defaultValue;
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            return defaultValue;
        }
    }
}