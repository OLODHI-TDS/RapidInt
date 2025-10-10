const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

/**
 * Polling Settings Management Azure Function
 * Manages polling configuration settings for the integration system
 */

// Get polling settings
app.http('GetPollingSettings', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'polling/settings',
    handler: async (request, context) => {
        try {
            context.log('📊 Getting polling settings...');

            const settingsManager = new PollingSettingsManager(context);
            const settings = await settingsManager.getSettings();

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    settings: settings
                }
            };

        } catch (error) {
            context.log('❌ Error getting polling settings:', error);
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

// Save polling settings
app.http('SavePollingSettings', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'polling/settings',
    handler: async (request, context) => {
        try {
            context.log('💾 Saving polling settings...');

            const body = await request.json();
            const { pendingPollInterval, depositCheckInterval, maxPollAttempts, backoffMultiplier } = body;

            // Validate settings
            if (!pendingPollInterval || pendingPollInterval < 1 || pendingPollInterval > 60) {
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Pending poll interval must be between 1 and 60 minutes'
                    }
                };
            }

            if (!depositCheckInterval || depositCheckInterval < 1 || depositCheckInterval > 9) {
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Deposit check interval must be between 1 and 9 minutes'
                    }
                };
            }

            if (!maxPollAttempts || maxPollAttempts < 5 || maxPollAttempts > 100) {
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Max poll attempts must be between 5 and 100'
                    }
                };
            }

            if (!backoffMultiplier || backoffMultiplier < 1 || backoffMultiplier > 3) {
                return {
                    status: 400,
                    jsonBody: {
                        success: false,
                        error: 'Backoff multiplier must be between 1 and 3'
                    }
                };
            }

            const settingsManager = new PollingSettingsManager(context);
            const settings = await settingsManager.saveSettings({
                pendingPollInterval: parseInt(pendingPollInterval),
                depositCheckInterval: parseInt(depositCheckInterval),
                maxPollAttempts: parseInt(maxPollAttempts),
                backoffMultiplier: parseFloat(backoffMultiplier)
            });

            context.log('✅ Polling settings saved successfully');

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    message: 'Polling settings saved successfully',
                    settings: settings
                }
            };

        } catch (error) {
            context.log('❌ Error saving polling settings:', error);
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

/**
 * Polling Settings Manager Class
 */
class PollingSettingsManager {
    constructor(context) {
        this.context = context;
        this.tableName = 'PollingSettings';

        // Use Azurite for local development
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        this.tableClient = TableClient.fromConnectionString(connectionString, this.tableName);

        // Initialize table (creates if doesn't exist)
        this.initializeTable();
    }

    async initializeTable() {
        try {
            await this.tableClient.createTable();
            this.context.log(`✅ Table '${this.tableName}' ready`);
        } catch (error) {
            if (error.statusCode !== 409) { // 409 = table already exists
                this.context.log(`❌ Error creating table '${this.tableName}':`, error.message);
            }
        }
    }

    async getSettings() {
        try {
            const partitionKey = 'PollingSettings';
            const rowKey = 'current';

            try {
                const entity = await this.tableClient.getEntity(partitionKey, rowKey);
                return {
                    pendingPollInterval: entity.pendingPollInterval || 5,
                    depositCheckInterval: entity.depositCheckInterval || 10,
                    maxPollAttempts: entity.maxPollAttempts || 20,
                    backoffMultiplier: entity.backoffMultiplier || 1.5,
                    lastUpdated: entity.lastUpdated,
                    updatedBy: entity.updatedBy || 'system'
                };
            } catch (error) {
                if (error.statusCode === 404) {
                    // Return default settings if not found
                    this.context.log('📋 No polling settings found, returning defaults');
                    return {
                        pendingPollInterval: 5,
                        depositCheckInterval: 10,
                        maxPollAttempts: 20,
                        backoffMultiplier: 1.5,
                        lastUpdated: null,
                        updatedBy: 'system'
                    };
                }
                throw error;
            }
        } catch (error) {
            this.context.log('❌ Error getting polling settings:', error.message);
            throw error;
        }
    }

    async saveSettings(settings) {
        try {
            const partitionKey = 'PollingSettings';
            const rowKey = 'current';
            const timestamp = new Date().toISOString();

            const entity = {
                partitionKey,
                rowKey,
                pendingPollInterval: settings.pendingPollInterval,
                depositCheckInterval: settings.depositCheckInterval,
                maxPollAttempts: settings.maxPollAttempts,
                backoffMultiplier: settings.backoffMultiplier,
                lastUpdated: timestamp,
                updatedBy: 'settings-ui'
            };

            // Upsert the settings (create or update)
            await this.tableClient.upsertEntity(entity);

            this.context.log('✅ Polling settings saved to table storage');

            return {
                ...settings,
                lastUpdated: timestamp,
                updatedBy: 'settings-ui'
            };

        } catch (error) {
            this.context.log('❌ Error saving polling settings:', error.message);
            throw error;
        }
    }
}

module.exports = { PollingSettingsManager };