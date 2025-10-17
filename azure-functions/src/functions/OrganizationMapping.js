const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');
const { validateEntraToken, hasRole } = require('../../shared-services/shared/entra-auth-middleware');

/**
 * Organization Mapping Service Azure Function
 * Maps Alto Agency Ref + Branch ID to TDS Member ID + Branch ID + API Key
 *
 * Authentication: Microsoft Entra ID
 * - Anonymous auth level (Entra ID tokens validated in handler)
 * - Read operations: Any authenticated user
 * - Write operations (add/update/delete): Requires 'Admin' role
 */
app.http('OrganizationMapping', {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',  // Changed from 'function' - now using Entra ID
    route: 'organization/{action?}',
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

        // Get action from request
        const action = request.params.action || 'lookup';

        // Check role-based access for write operations
        const writeActions = ['add', 'update', 'delete'];
        if (writeActions.includes(action) && !hasRole(authResult.user, 'Admin')) {
            context.log(`❌ User ${authResult.user.email} lacks Admin role for action: ${action}`);
            return {
                status: 403,
                jsonBody: {
                    error: 'Forbidden',
                    message: 'Admin role required for this operation',
                    requiredRole: 'Admin',
                    userRoles: authResult.user.roles
                }
            };
        }

        try {
            const mappingService = new OrganizationMappingService(context);

            switch (action) {
                case 'lookup':
                    // Parse query parameters manually from URL if request.query is empty
                    let queryParams;

                    if (request.query && Object.keys(request.query).length > 0) {
                        // Standard query parsing worked
                        queryParams = { ...request.query };
                    } else {
                        // Manual parsing from URL
                        const url = new URL(request.url, 'http://localhost');
                        queryParams = {
                            agencyRef: url.searchParams.get('agencyRef'),
                            branchId: url.searchParams.get('branchId')
                        };
                    }

                    // ✅ HIGH-006 FIX: Validate organization lookup query parameters
                    let validatedQuery;
                    try {
                        validatedQuery = validateRequestBody(queryParams, schemas.organizationLookupQuery);
                        context.log('✅ Organization lookup query validation passed');
                    } catch (validationError) {
                        if (validationError.name === 'ValidationError') {
                            context.warn('❌ Organization lookup query validation failed:', validationError.validationErrors);

                            return {
                                status: 400,
                                jsonBody: formatValidationError(validationError)
                            };
                        }
                        // Re-throw unexpected errors
                        throw validationError;
                    }

                    const { agencyRef, branchId } = validatedQuery;
                    const result = await mappingService.getMapping(agencyRef, branchId);

                    if (!result || !result.mapping) {
                        return {
                            status: 404,
                            jsonBody: {
                                error: 'Organization mapping not found',
                                agencyRef,
                                branchId
                            }
                        };
                    }

                    const { mapping, storedBranchId } = result;

                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            agencyRef,
                            branchId: branchId || 'DEFAULT',  // Requested branch ID
                            organizationBranchId: storedBranchId,  // ✅ Actual stored branch ID from mapping
                            environment: mapping.environment,
                            tdsMapping: mapping,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'list':
                    const allMappings = await mappingService.getAllMappings();
                    return {
                        status: 200,
                        jsonBody: {
                            success: true,
                            mappings: allMappings,
                            count: allMappings.length,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'add':
                    if (request.method !== 'POST') {
                        return { status: 405, jsonBody: { error: 'POST method required for add' } };
                    }

                    let newMapping = await request.json();

                    // ✅ HIGH-006 FIX: Validate organization mapping add request body
                    try {
                        newMapping = validateRequestBody(newMapping, schemas.organizationMappingAdd);
                        context.log('✅ Organization mapping add validation passed');
                    } catch (validationError) {
                        if (validationError.name === 'ValidationError') {
                            context.warn('❌ Organization mapping add validation failed:', validationError.validationErrors);

                            return {
                                status: 400,
                                jsonBody: formatValidationError(validationError)
                            };
                        }
                        // Re-throw unexpected errors
                        throw validationError;
                    }

                    const addResult = await mappingService.addMapping(newMapping);

                    return {
                        status: addResult.success ? 201 : 400,
                        jsonBody: {
                            ...addResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'update':
                    if (request.method !== 'PUT') {
                        return { status: 405, jsonBody: { error: 'PUT method required for update' } };
                    }

                    let updateMapping = await request.json();

                    // ✅ HIGH-006 FIX: Validate organization mapping update request body
                    try {
                        updateMapping = validateRequestBody(updateMapping, schemas.organizationMappingUpdate);
                        context.log('✅ Organization mapping update validation passed');
                    } catch (validationError) {
                        if (validationError.name === 'ValidationError') {
                            context.warn('❌ Organization mapping update validation failed:', validationError.validationErrors);

                            return {
                                status: 400,
                                jsonBody: formatValidationError(validationError)
                            };
                        }
                        // Re-throw unexpected errors
                        throw validationError;
                    }

                    const updateResult = await mappingService.updateMapping(updateMapping);

                    return {
                        status: updateResult.success ? 200 : 404,
                        jsonBody: {
                            ...updateResult,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'health':
                    const healthCheck = await mappingService.healthCheck();
                    return {
                        status: 200,
                        jsonBody: {
                            status: 'healthy',
                            mappingCount: healthCheck.count,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'debug':
                    const debugInfo = await mappingService.getDebugInfo();
                    return {
                        status: 200,
                        jsonBody: {
                            ...debugInfo,
                            timestamp: new Date().toISOString()
                        }
                    };

                case 'delete':
                    if (request.method !== 'DELETE') {
                        return { status: 405, jsonBody: { error: 'DELETE method required for delete' } };
                    }

                    let requestData = await request.json();

                    // ✅ HIGH-006 FIX: Validate organization mapping delete request body
                    try {
                        requestData = validateRequestBody(requestData, schemas.organizationMappingDelete);
                        context.log('✅ Organization mapping delete validation passed');
                    } catch (validationError) {
                        if (validationError.name === 'ValidationError') {
                            context.warn('❌ Organization mapping delete validation failed:', validationError.validationErrors);

                            return {
                                status: 400,
                                jsonBody: formatValidationError(validationError)
                            };
                        }
                        // Re-throw unexpected errors
                        throw validationError;
                    }

                    const deleteResult = await mappingService.deleteMapping(requestData.agencyRef, requestData.branchId);

                    return {
                        status: deleteResult.success ? 200 : 404,
                        jsonBody: {
                            success: deleteResult.success,
                            message: deleteResult.message,
                            timestamp: new Date().toISOString()
                        }
                    };

                default:
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Invalid action',
                            availableActions: ['lookup', 'list', 'add', 'update', 'delete', 'health', 'debug'],
                            usage: {
                                lookup: 'GET /api/organization/lookup?agencyRef={ref}&branchId={id}',
                                list: 'GET /api/organization/list',
                                add: 'POST /api/organization/add',
                                update: 'PUT /api/organization/update',
                                delete: 'DELETE /api/organization/delete',
                                health: 'GET /api/organization/health',
                                debug: 'GET /api/organization/debug'
                            }
                        }
                    };
            }

        } catch (error) {
            context.log.error('Organization mapping error:', error);
            return {
                status: 500,
                jsonBody: {
                    error: 'Organization mapping service failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

/**
 * Organization Mapping Service Class with Azure Storage Table persistence
 */
class OrganizationMappingService {
    constructor(context) {
        this.context = context;
        this.tableName = 'OrganizationMappings';

        // Use Azurite for local development
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        this.tableClient = TableClient.fromConnectionString(connectionString, this.tableName);

        // Initialize table (creates if doesn't exist)
        this.initializeTable();
    }

    /**
     * Initialize Azure Storage Table
     */
    async initializeTable() {
        try {
            await this.tableClient.createTable();
            this.context.log('✅ Organization mappings table initialized');
        } catch (error) {
            if (error.statusCode !== 409) { // 409 = table already exists
                this.context.log.error('❌ Failed to initialize table:', error.message);
            }
        }
    }

    /**
     * Get TDS mapping for Alto Agency Ref + Branch ID
     */
    async getMapping(agencyRef, branchId = 'DEFAULT') {
        try {
            this.context.log(`🔍 Looking up organization mapping for agencyRef: ${agencyRef}, branchId: ${branchId}`);

            // Priority: Production ACTIVE mappings first, then Development ACTIVE mappings
            const environments = ['production', 'development'];

            for (const env of environments) {
                const partitionKey = `OrgMapping_${env}`;
                const rowKey = `${agencyRef}:${branchId}`;

                this.context.log(`🔍 Searching in ${env} environment (${partitionKey})`);

                // Try specific branch first
                let entity = await this.getEntity(partitionKey, rowKey);

                // If not found and not DEFAULT, try DEFAULT branch
                if (!entity && branchId !== 'DEFAULT') {
                    const defaultRowKey = `${agencyRef}:DEFAULT`;
                    this.context.log(`🔍 Trying DEFAULT branch: ${defaultRowKey}`);
                    entity = await this.getEntity(partitionKey, defaultRowKey);
                }

                // Check if found and active
                if (entity) {
                    const isActive = entity.isActive === true || entity.isActive === 'true';

                    if (isActive) {
                        // Extract stored branch ID from rowKey (format: "agencyRef:branchId")
                        const rowKeyParts = entity.rowKey.split(':');
                        const storedBranchId = rowKeyParts[1] || 'DEFAULT';

                        this.context.log(`✅ Found ACTIVE mapping in ${env} environment`);
                        this.context.log(`📊 TDS Provider Preference: ${entity.tdsProviderPreference || 'auto'}`);
                        this.context.log(`🔑 Stored Branch ID: ${storedBranchId}`);

                        return {
                            mapping: {
                                // Legacy/Current TDS credentials
                                legacy: {
                                    memberId: entity.legacyMemberId || entity.tdsMemberId,
                                    branchId: entity.legacyBranchId || entity.tdsBranchId,
                                    apiKey: entity.legacyApiKey || entity.tdsApiKey
                                },
                                // Salesforce TDS credentials
                                salesforce: {
                                    memberId: entity.sfMemberId,
                                    branchId: entity.sfBranchId,
                                    apiKey: entity.sfApiKey,
                                    region: entity.sfRegion,
                                    schemeType: entity.sfSchemeType,
                                    authMethod: entity.sfAuthMethod,
                                    clientId: entity.sfClientId,
                                    clientSecret: entity.sfClientSecret
                                },
                                // Metadata
                                organizationName: entity.organizationName,
                                environment: env,
                                integrationType: entity.integrationType,
                                tdsProviderPreference: entity.tdsProviderPreference || 'auto',
                                isActive: true,

                                // Deprecated fields (for backward compatibility)
                                tdsMemberId: entity.tdsMemberId,
                                tdsBranchId: entity.tdsBranchId,
                                tdsApiKey: entity.tdsApiKey
                            },
                            storedBranchId  // ✅ Return the stored branch ID
                        };
                    } else {
                        this.context.log(`⚠️ Found mapping in ${env} but it's INACTIVE, continuing search...`);
                    }
                }
            }

            this.context.log(`❌ No ACTIVE mapping found for agencyRef: ${agencyRef}, branchId: ${branchId}`);
            return null;
        } catch (error) {
            this.context.log.error('❌ Error getting mapping:', error.message);
            return null;
        }
    }

    /**
     * Helper method to get entity from table
     */
    async getEntity(partitionKey, rowKey) {
        try {
            const entity = await this.tableClient.getEntity(partitionKey, rowKey);
            return entity;
        } catch (error) {
            if (error.statusCode === 404) {
                return null; // Entity not found
            }
            throw error;
        }
    }

    /**
     * Get all organization mappings
     */
    async getAllMappings() {
        try {
            // Query both development and production environments
            const environments = ['development', 'production'];
            const mappings = [];

            for (const env of environments) {
                const partitionKey = `OrgMapping_${env}`;
                const entities = this.tableClient.listEntities({
                    queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
                });

                for await (const entity of entities) {
                    // Parse integration credentials
                    let integrationCredentials = {};
                    try {
                        integrationCredentials = JSON.parse(entity.integrationCredentials || '{}');
                    } catch (e) {
                        this.context.log.error('Failed to parse integrationCredentials:', e);
                    }

                    // Extract agencyRef and branchId from rowKey (format: "agencyRef:branchId")
                    const rowKeyParts = entity.rowKey.split(':');
                    const agencyRef = rowKeyParts[0];
                    const branchId = rowKeyParts[1] || 'DEFAULT';

                    mappings.push({
                        agencyRef: agencyRef,  // NEW: Extract from rowKey
                        branchId: branchId,    // NEW: Extract from rowKey
                        organizationName: entity.organizationName,
                        environment: env,      // Use the env from the loop
                        integrationType: entity.integrationType,
                        integrationCredentials: integrationCredentials,
                        legacyMemberId: entity.legacyMemberId,
                        legacyBranchId: entity.legacyBranchId,
                        legacyApiKey: entity.legacyApiKey,
                        sfMemberId: entity.sfMemberId,
                        sfBranchId: entity.sfBranchId,
                        sfRegion: entity.sfRegion,
                        sfSchemeType: entity.sfSchemeType,
                        sfAuthMethod: entity.sfAuthMethod,
                        sfApiKey: entity.sfApiKey,
                        sfClientId: entity.sfClientId,
                        sfClientSecret: entity.sfClientSecret,  // ← ADD THIS!
                        tdsProviderPreference: entity.tdsProviderPreference,
                        isActive: entity.isActive,
                        createdAt: entity.createdAt,
                        updatedAt: entity.updatedAt
                    });
                }
            }

            this.context.log(`📊 Retrieved ${mappings.length} organization mappings from storage`);
            return mappings;
        } catch (error) {
            this.context.log.error('❌ Error getting all mappings:', error.message);
            return [];
        }
    }

    /**
     * Check for duplicate mappings based on multiple criteria
     * @param {string} agencyRef - Alto Agency Reference
     * @param {string} branchId - Alto Branch ID
     * @param {string} tdsMemberId - TDS Member ID
     * @param {string} tdsBranchId - TDS Branch ID
     * @param {string} excludeRowKey - Row key to exclude from duplicate check (for edits)
     */
    async checkForDuplicates(agencyRef, branchId, tdsMemberId, tdsBranchId, excludeRowKey = null) {
        try {
            // Get all existing mappings
            const allMappings = await this.getAllMappings();

            const conflictingMappings = [];
            let duplicateTypes = [];

            for (const mapping of allMappings) {
                // Skip the current mapping being edited (if provided)
                const currentRowKey = `${mapping.agencyRef}:${mapping.branchId}`;
                if (excludeRowKey && currentRowKey === excludeRowKey) {
                    continue;
                }

                // Check for Alto side duplicates (Agency Ref + Branch ID)
                if (mapping.agencyRef === agencyRef && mapping.branchId === branchId) {
                    duplicateTypes.push('ALTO_DUPLICATE');
                    conflictingMappings.push({
                        type: 'Alto Duplicate',
                        mapping: mapping,
                        conflict: `Agency Ref "${agencyRef}" + Branch ID "${branchId}" already exists`
                    });
                }

                // Check for TDS side duplicates (TDS Member ID + TDS Branch ID)
                if (mapping.tdsMemberId === tdsMemberId && mapping.tdsBranchId === tdsBranchId) {
                    duplicateTypes.push('TDS_DUPLICATE');
                    conflictingMappings.push({
                        type: 'TDS Duplicate',
                        mapping: mapping,
                        conflict: `TDS Member "${tdsMemberId}" + TDS Branch "${tdsBranchId}" already exists`
                    });
                }
            }

            // Remove duplicate types
            duplicateTypes = [...new Set(duplicateTypes)];

            if (conflictingMappings.length > 0) {
                let errorMessage = 'Duplicate mapping detected:\n';

                if (duplicateTypes.includes('ALTO_DUPLICATE') && duplicateTypes.includes('TDS_DUPLICATE')) {
                    errorMessage = 'Both Alto and TDS mappings already exist. This would create duplicate mappings on both sides.';
                } else if (duplicateTypes.includes('ALTO_DUPLICATE')) {
                    errorMessage = `Alto mapping already exists: Agency Ref "${agencyRef}" with Branch ID "${branchId}" is already mapped.`;
                } else if (duplicateTypes.includes('TDS_DUPLICATE')) {
                    errorMessage = `TDS mapping already exists: TDS Member "${tdsMemberId}" with TDS Branch "${tdsBranchId}" is already mapped.`;
                }

                return {
                    isValid: false,
                    error: errorMessage,
                    duplicateType: duplicateTypes,
                    conflictingMappings: conflictingMappings
                };
            }

            return {
                isValid: true,
                message: 'No duplicates found'
            };

        } catch (error) {
            this.context.log.error('❌ Error checking for duplicates:', error.message);
            return {
                isValid: false,
                error: `Failed to check for duplicates: ${error.message}`,
                duplicateType: ['CHECK_ERROR'],
                conflictingMappings: []
            };
        }
    }

    /**
     * Add new organization mapping
     */
    async addMapping(mappingData) {
        const {
            organizationName,
            environment = 'development',
            integrationType,
            integrationCredentials,
            tdsLegacyConfig,
            tdsSalesforceConfig,
            isActive = true
        } = mappingData;

        // Validation
        if (!organizationName || !integrationType) {
            return {
                success: false,
                error: 'Missing required fields: organizationName, integrationType'
            };
        }

        if (!tdsLegacyConfig || !tdsLegacyConfig.memberId || !tdsLegacyConfig.branchId || !tdsLegacyConfig.apiKey) {
            return {
                success: false,
                error: 'Missing required Legacy TDS configuration fields'
            };
        }

        if (!tdsSalesforceConfig || !tdsSalesforceConfig.memberId || !tdsSalesforceConfig.branchId) {
            return {
                success: false,
                error: 'Missing required Salesforce TDS configuration fields'
            };
        }

        try {
            // Extract integration identifier for rowKey
            let integrationId;
            if (integrationType === 'alto' && integrationCredentials.alto) {
                integrationId = `${integrationCredentials.alto.agencyRef}:${integrationCredentials.alto.branchId || 'DEFAULT'}`;
            } else {
                integrationId = `${integrationType}:${Date.now()}`; // Fallback for other integrations
            }

            const partitionKey = `OrgMapping_${environment}`;
            const rowKey = integrationId;

            // Check if mapping already exists
            const existingEntity = await this.getEntity(partitionKey, rowKey);
            if (existingEntity) {
                return {
                    success: false,
                    error: `Organization mapping already exists for ${integrationId} in ${environment} environment`
                };
            }

            // Create new entity with new structure
            const entity = {
                partitionKey,
                rowKey,
                // Organization details
                organizationName,
                environment,
                integrationType,
                integrationCredentials: JSON.stringify(integrationCredentials),
                // Legacy TDS
                legacyMemberId: tdsLegacyConfig.memberId,
                legacyBranchId: tdsLegacyConfig.branchId,
                legacyApiKey: tdsLegacyConfig.apiKey, // TODO: Encrypt
                // Salesforce TDS
                sfMemberId: tdsSalesforceConfig.memberId,
                sfBranchId: tdsSalesforceConfig.branchId,
                sfRegion: tdsSalesforceConfig.region,
                sfSchemeType: tdsSalesforceConfig.schemeType,
                sfAuthMethod: tdsSalesforceConfig.authMethod,
                sfApiKey: tdsSalesforceConfig.apiKey || null, // TODO: Encrypt
                sfClientId: tdsSalesforceConfig.clientId || null,
                sfClientSecret: tdsSalesforceConfig.clientSecret || null, // TODO: Encrypt
                // Provider preference (default to 'auto')
                tdsProviderPreference: 'auto',
                // Status
                isActive,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await this.tableClient.createEntity(entity);

            this.context.log(`✅ Added organization mapping: ${organizationName} (${rowKey}) in ${environment}`);

            return {
                success: true,
                message: 'Organization mapping added successfully',
                mapping: entity
            };
        } catch (error) {
            this.context.log.error('❌ Error adding mapping:', error.message);
            return {
                success: false,
                error: `Failed to add mapping: ${error.message}`
            };
        }
    }

    /**
     * Update existing organization mapping
     */
    async updateMapping(mappingData) {
        const {
            organizationName,
            environment,
            integrationType,
            updatedOrganizationName,
            legacyMemberId,
            legacyBranchId,
            legacyApiKey,
            sfMemberId,
            sfBranchId,
            sfRegion,
            sfSchemeType,
            sfAuthMethod,
            sfApiKey,
            sfClientId,
            sfClientSecret,
            tdsProviderPreference,
            isActive
        } = mappingData;

        try {
            // Build the integration identifier for rowKey lookup
            let integrationId;
            if (integrationType === 'alto') {
                // For Alto, we need to get the agencyRef and branchId from the existing mapping
                // We'll search for it by organization details
                const allMappings = await this.getAllMappings();
                const existingMapping = allMappings.find(m =>
                    m.organizationName === organizationName &&
                    m.environment === environment &&
                    m.integrationType === integrationType
                );

                if (!existingMapping) {
                    return {
                        success: false,
                        error: 'Organization mapping not found'
                    };
                }

                // Extract integrationId from existing mapping
                const existingCreds = existingMapping.integrationCredentials;
                if (existingCreds && existingCreds.alto) {
                    integrationId = `${existingCreds.alto.agencyRef}:${existingCreds.alto.branchId || 'DEFAULT'}`;
                } else {
                    return {
                        success: false,
                        error: 'Could not determine integration ID from existing mapping'
                    };
                }
            } else {
                return {
                    success: false,
                    error: `Update not yet implemented for integration type: ${integrationType}`
                };
            }

            const partitionKey = `OrgMapping_${environment}`;
            const rowKey = integrationId;

            // Get existing entity
            const existingEntity = await this.getEntity(partitionKey, rowKey);
            if (!existingEntity) {
                return {
                    success: false,
                    error: 'Organization mapping not found in storage'
                };
            }

            // Update entity with new values (keep existing values if not provided)
            const updatedEntity = {
                ...existingEntity,
                organizationName: updatedOrganizationName || existingEntity.organizationName,
                legacyMemberId: legacyMemberId || existingEntity.legacyMemberId,
                legacyBranchId: legacyBranchId || existingEntity.legacyBranchId,
                sfMemberId: sfMemberId || existingEntity.sfMemberId,
                sfBranchId: sfBranchId || existingEntity.sfBranchId,
                sfRegion: sfRegion || existingEntity.sfRegion,
                sfSchemeType: sfSchemeType || existingEntity.sfSchemeType,
                sfAuthMethod: sfAuthMethod || existingEntity.sfAuthMethod,
                tdsProviderPreference: tdsProviderPreference || existingEntity.tdsProviderPreference,
                isActive: typeof isActive === 'boolean' ? isActive : existingEntity.isActive,
                updatedAt: new Date().toISOString()
            };

            // Update API keys/secrets only if provided (don't overwrite with empty values)
            if (legacyApiKey && legacyApiKey.trim()) {
                updatedEntity.legacyApiKey = legacyApiKey;
            }
            if (sfApiKey && sfApiKey.trim()) {
                updatedEntity.sfApiKey = sfApiKey;
            }
            if (sfClientId && sfClientId.trim()) {
                updatedEntity.sfClientId = sfClientId;
            }
            if (sfClientSecret && sfClientSecret.trim()) {
                updatedEntity.sfClientSecret = sfClientSecret;
            }

            await this.tableClient.updateEntity(updatedEntity, 'Replace');

            this.context.log(`✅ Updated organization mapping: ${updatedEntity.organizationName} (${rowKey})`);

            return {
                success: true,
                message: 'Organization mapping updated successfully',
                mapping: updatedEntity
            };
        } catch (error) {
            this.context.log.error('❌ Error updating mapping:', error.message);
            return {
                success: false,
                error: `Failed to update mapping: ${error.message}`
            };
        }
    }

    /**
     * Delete organization mapping
     */
    async deleteMapping(agencyRef, branchId = 'DEFAULT') {
        try {
            const partitionKey = 'OrganizationMapping';
            const rowKey = `${agencyRef}:${branchId}`;

            this.context.log(`🗑️ Attempting to delete organization mapping: ${rowKey}`);

            // Check if mapping exists first
            const existingEntity = await this.getEntity(partitionKey, rowKey);
            if (!existingEntity) {
                this.context.log(`❌ Organization mapping not found: ${rowKey}`);
                return {
                    success: false,
                    error: 'Organization mapping not found',
                    agencyRef,
                    branchId
                };
            }

            // Delete the entity
            await this.tableClient.deleteEntity(partitionKey, rowKey);

            this.context.log(`✅ Successfully deleted organization mapping: ${rowKey}`);

            return {
                success: true,
                message: `Organization mapping deleted successfully`,
                deletedMapping: {
                    agencyRef,
                    branchId,
                    memberName: existingEntity.memberName,
                    tdsMemberId: existingEntity.tdsMemberId
                }
            };

        } catch (error) {
            this.context.log.error('❌ Error deleting mapping:', error.message);
            return {
                success: false,
                error: `Failed to delete mapping: ${error.message}`
            };
        }
    }

    /**
     * Health check - return mapping count
     */
    async healthCheck() {
        try {
            const mappings = await this.getAllMappings();
            return {
                count: mappings.length,
                status: 'healthy',
                storage: 'Azure Storage Table'
            };
        } catch (error) {
            return {
                count: 0,
                status: 'error',
                error: error.message,
                storage: 'Azure Storage Table'
            };
        }
    }

    /**
     * Debug info - return detailed mapping information
     */
    async getDebugInfo() {
        try {
            const mappings = await this.getAllMappings();
            return {
                totalMappings: mappings.length,
                storage: 'Azure Storage Table',
                tableName: this.tableName,
                connectionString: process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true',
                mappings: mappings
            };
        } catch (error) {
            return {
                totalMappings: 0,
                storage: 'Azure Storage Table',
                tableName: this.tableName,
                error: error.message
            };
        }
    }

}