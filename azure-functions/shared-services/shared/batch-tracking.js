/**
 * Batch Tracking Helper Module
 *
 * Provides Azure Table Storage interaction functions for tracking TDS deposit batch creation
 * and status across different providers (legacy vs Salesforce).
 *
 * Key Features:
 * - Track which provider created each batch
 * - Store batch metadata (organization, request/response payloads)
 * - Update batch status and DAN numbers
 * - Query batch details for status checking
 * - Support dual-mode execution tracking
 * - PII encryption for request/response payloads (GDPR Article 32 compliance)
 *
 * Storage:
 * - Uses Azure Table Storage (BatchTracking table)
 * - PII fields encrypted at rest using AES-256-GCM
 */

const { TableClient } = require('@azure/data-tables');
const { encryptPII, decryptPII } = require('./pii-encryption');

/**
 * Get or create table client
 * @returns {TableClient} - Table client instance
 */
function getTableClient() {
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  return TableClient.fromConnectionString(connectionString, 'BatchTracking');
}

/**
 * Store batch tracking record when deposit is created
 *
 * @param {string} batchId - TDS batch ID
 * @param {string} provider - Provider used ('current' or 'salesforce')
 * @param {string} organizationId - Organization ID (agencyRef:branchId)
 * @param {string} altoTenancyId - Alto tenancy ID
 * @param {Object} requestPayload - Original request payload (will be stringified and encrypted)
 * @param {Object} responsePayload - TDS API response (will be stringified and encrypted)
 * @param {Object} options - Additional options
 * @param {string} options.endpoint - API endpoint called (e.g., 'CreateDeposit', 'TenancyInformation')
 * @param {string} options.executionMode - Execution mode ('single', 'dual', 'shadow', 'forwarding')
 * @param {string} options.altoAgencyRef - Alto agency reference
 * @param {string} options.altoBranchId - Alto branch ID
 * @param {string} options.altoWorkflowId - Alto workflow ID
 * @param {number} options.requestDurationMs - Request duration in milliseconds
 * @param {number} options.providerResponseTimeMs - Provider response time
 * @param {string} options.legacyBatchId - Batch ID from legacy provider (dual mode)
 * @param {string} options.salesforceBatchId - Batch ID from Salesforce provider (dual mode)
 * @param {Object} options.dualModeResults - Dual mode comparison results
 * @param {Object} options.userContext - User context for audit logging (optional)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Created batch tracking record
 */
async function storeBatchTracking(
  batchId,
  provider,
  organizationId,
  altoTenancyId,
  requestPayload,
  responsePayload,
  options = {},
  context
) {
  try {
    // ✅ SECURITY: Validate organization ID is provided (GDPR Article 32 compliance)
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for batch tracking - cannot proceed without data segregation');
    }

    const {
      endpoint = null,
      executionMode = 'single',
      altoAgencyRef = null,
      altoBranchId = null,
      altoWorkflowId = null,
      requestDurationMs = null,
      providerResponseTimeMs = null,
      legacyBatchId = null,
      salesforceBatchId = null,
      dualModeResults = null,
      userContext = null
    } = options;

    context?.log(`Storing batch tracking: ${batchId}, provider: ${provider}, mode: ${executionMode}, org: ${organizationId}`);

    const tableClient = getTableClient();

    // ✅ SECURITY: Encrypt PII fields before storing (GDPR Article 32 - Security of Processing)
    // Encrypt request and response payloads containing tenant names, emails, addresses, etc.
    const encryptedRequestPayload = requestPayload
      ? await encryptPII(JSON.stringify(requestPayload), userContext, context)
      : null;

    const encryptedResponsePayload = responsePayload
      ? await encryptPII(JSON.stringify(responsePayload), userContext, context)
      : null;

    context?.log(`[PII-ENC] Payloads encrypted: request=${!!encryptedRequestPayload}, response=${!!encryptedResponsePayload}`);

    // Create entity for Azure Tables
    // ✅ SECURITY: Use organizationId as partition key for data isolation
    const entity = {
      partitionKey: organizationId,
      rowKey: batchId,
      batchId: batchId,
      provider: provider,
      endpoint: endpoint,  // API endpoint called (CreateDeposit, TenancyInformation, etc.)
      executionMode: executionMode,
      organizationId: organizationId,
      altoAgencyRef: altoAgencyRef,
      altoBranchId: altoBranchId,
      altoTenancyId: altoTenancyId,
      altoWorkflowId: altoWorkflowId,
      requestPayload: encryptedRequestPayload,  // ✅ Encrypted PII
      responsePayload: encryptedResponsePayload,  // ✅ Encrypted PII
      requestDurationMs: requestDurationMs,
      providerResponseTimeMs: providerResponseTimeMs,
      legacyBatchId: legacyBatchId,
      salesforceBatchId: salesforceBatchId,
      dualModeResults: dualModeResults ? JSON.stringify(dualModeResults) : null,
      currentStatus: 'submitted',
      statusCheckCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await tableClient.createEntity(entity);

    context?.log(`Batch tracking stored successfully: ${batchId}`);

    return entity;

  } catch (error) {
    context?.error('Error storing batch tracking:', error);
    throw new Error(`Failed to store batch tracking: ${error.message}`);
  }
}

/**
 * Get provider that created a specific batch
 *
 * @param {string} batchId - TDS batch ID
 * @param {string} organizationId - Organization ID (required for data segregation)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<string>} - Provider name ('current' or 'salesforce')
 */
async function getBatchProvider(batchId, organizationId, context) {
  try {
    // ✅ SECURITY: Validate organization ID is provided
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for batch lookup - data segregation required');
    }

    context?.log(`Looking up provider for batch: ${batchId}, org: ${organizationId}`);

    const tableClient = getTableClient();
    // ✅ SECURITY: Use organizationId as partition key to ensure data isolation
    const entity = await tableClient.getEntity(organizationId, batchId);

    if (!entity) {
      throw new Error(`No batch tracking found for batch ID: ${batchId} in organization: ${organizationId}`);
    }

    const provider = entity.provider;
    context?.log(`Batch ${batchId} (org: ${organizationId}) was created by provider: ${provider}`);

    return provider;

  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`No batch tracking found for batch ID: ${batchId} in organization: ${organizationId}`);
    }
    context?.error('Error retrieving batch provider:', error);
    throw new Error(`Failed to get batch provider: ${error.message}`);
  }
}

/**
 * Update batch status after status check
 *
 * @param {string} batchId - TDS batch ID
 * @param {string} organizationId - Organization ID (required for data segregation)
 * @param {string} status - Current status ('submitted', 'processing', 'created', 'failed')
 * @param {string} dan - DAN number (optional, if available)
 * @param {Object} responsePayload - Latest status response from TDS (will be stringified and encrypted)
 * @param {Object} errorDetails - Error details if failed (will be stringified)
 * @param {Object} userContext - User context for audit logging (optional)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Updated batch tracking record
 */
async function updateBatchStatus(batchId, organizationId, status, dan = null, responsePayload = null, errorDetails = null, userContext = null, context) {
  try {
    // ✅ SECURITY: Validate organization ID is provided
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for batch update - data segregation required');
    }

    context?.log(`Updating batch status: ${batchId}, org: ${organizationId}, status: ${status}, DAN: ${dan || 'N/A'}`);

    const tableClient = getTableClient();

    // Get existing entity - ✅ SECURITY: Use organizationId partition key
    const entity = await tableClient.getEntity(organizationId, batchId);

    // Update fields
    entity.currentStatus = status;
    if (dan) entity.danNumber = dan;

    // ✅ SECURITY: Encrypt response payload before storing (contains PII)
    if (responsePayload) {
      entity.responsePayload = await encryptPII(JSON.stringify(responsePayload), userContext, context);
      context?.log(`[PII-ENC] Response payload encrypted for batch ${batchId}`);
    }

    if (errorDetails) entity.errorDetails = JSON.stringify(errorDetails);
    entity.statusLastChecked = new Date().toISOString();
    entity.statusCheckCount = (entity.statusCheckCount || 0) + 1;

    // Set completed timestamp if final status
    if (status === 'created' || status === 'failed') {
      if (!entity.completedAt) {
        entity.completedAt = new Date().toISOString();
      }
    }

    entity.updatedAt = new Date().toISOString();

    // Update entity
    await tableClient.updateEntity(entity, 'Merge');

    context?.log(`Batch status updated successfully: ${batchId}`);

    return entity;

  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`Batch tracking record not found for batch ID: ${batchId}`);
    }
    context?.error('Error updating batch status:', error);
    throw new Error(`Failed to update batch status: ${error.message}`);
  }
}

/**
 * Get full batch details including all tracking information
 *
 * @param {string} batchId - TDS batch ID
 * @param {string} organizationId - Organization ID (required for data segregation)
 * @param {Object} userContext - User context for decryption access control (optional)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Complete batch tracking record with decrypted payloads
 */
async function getBatchDetails(batchId, organizationId, userContext = null, context) {
  try {
    // ✅ SECURITY: Validate organization ID is provided
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for batch details lookup - data segregation required');
    }

    context?.log(`Retrieving batch details for: ${batchId}, org: ${organizationId}`);

    const tableClient = getTableClient();
    // ✅ SECURITY: Use organizationId as partition key to ensure data isolation
    const entity = await tableClient.getEntity(organizationId, batchId);

    if (!entity) {
      throw new Error(`No batch tracking found for batch ID: ${batchId} in organization: ${organizationId}`);
    }

    const batch = { ...entity };

    // ✅ SECURITY: Decrypt and parse PII fields
    // Decryption requires proper authentication (enforced in production)
    if (batch.requestPayload) {
      try {
        // Decrypt first (handles backwards compatibility for plain text)
        const decrypted = await decryptPII(batch.requestPayload, userContext, context);
        batch.requestPayload = JSON.parse(decrypted);
        context?.log(`[PII-ENC] Request payload decrypted for batch ${batchId}`);
      } catch (e) {
        context?.warn(`Failed to decrypt/parse requestPayload for batch ${batchId}: ${e.message}`);
      }
    }

    if (batch.responsePayload) {
      try {
        // Decrypt first (handles backwards compatibility for plain text)
        const decrypted = await decryptPII(batch.responsePayload, userContext, context);
        batch.responsePayload = JSON.parse(decrypted);
        context?.log(`[PII-ENC] Response payload decrypted for batch ${batchId}`);
      } catch (e) {
        context?.warn(`Failed to decrypt/parse responsePayload for batch ${batchId}: ${e.message}`);
      }
    }

    if (batch.errorDetails) {
      try {
        batch.errorDetails = JSON.parse(batch.errorDetails);
      } catch (e) {
        context?.warn(`Failed to parse errorDetails for batch ${batchId}`);
      }
    }

    if (batch.dualModeResults) {
      try {
        batch.dualModeResults = JSON.parse(batch.dualModeResults);
      } catch (e) {
        context?.warn(`Failed to parse dualModeResults for batch ${batchId}`);
      }
    }

    context?.log(`Batch details retrieved successfully: ${batchId}`);

    return batch;

  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`No batch tracking found for batch ID: ${batchId}`);
    }
    context?.error('Error retrieving batch details:', error);
    throw new Error(`Failed to get batch details: ${error.message}`);
  }
}

/**
 * Get batch status with caching support
 * Returns cached status if available and not expired
 *
 * @param {string} batchId - TDS batch ID
 * @param {string} organizationId - Organization ID (required for data segregation)
 * @param {Object} userContext - User context for decryption access control (optional)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Batch status object with cache metadata
 */
async function getBatchStatusCached(batchId, organizationId, userContext = null, context) {
  try {
    // ✅ SECURITY: Validate organization ID is provided
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for cached batch status - data segregation required');
    }

    const batch = await getBatchDetails(batchId, organizationId, userContext, context);

    // Check if status was recently checked (within cache TTL)
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const now = new Date();
    const lastChecked = batch.statusLastChecked ? new Date(batch.statusLastChecked) : null;

    const isCached = lastChecked && (now - lastChecked) < CACHE_TTL_MS;

    return {
      batchId: batch.batchId,
      status: batch.currentStatus,
      dan: batch.danNumber,
      provider: batch.provider,
      executionMode: batch.executionMode,
      statusLastChecked: batch.statusLastChecked,
      statusCheckCount: batch.statusCheckCount,
      isCached,
      cacheAge: lastChecked ? Math.floor((now - lastChecked) / 1000) : null,
      organizationId: batch.organizationId,
      altoTenancyId: batch.altoTenancyId,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      completedAt: batch.completedAt
    };

  } catch (error) {
    context?.error('Error retrieving cached batch status:', error);
    throw error;
  }
}

/**
 * Get recent batches for monitoring and debugging
 *
 * @param {string} organizationId - Organization ID (required for data segregation)
 * @param {Object} options - Query options
 * @param {string} options.provider - Filter by provider ('current' or 'salesforce')
 * @param {string} options.status - Filter by status
 * @param {number} options.limit - Maximum number of records to return
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Array>} - Array of batch tracking records
 */
async function getRecentBatches(organizationId, options = {}, context) {
  try {
    // ✅ SECURITY: Validate organization ID is provided
    if (!organizationId) {
      throw new Error('Organization ID is REQUIRED for batch listing - data segregation required');
    }

    const { provider = null, status = null, limit = 50 } = options;

    context?.log(`Retrieving recent batches for org ${organizationId}: provider=${provider || 'all'}, status=${status || 'all'}`);

    const tableClient = getTableClient();
    // ✅ SECURITY: Query by organizationId partition to ensure data isolation
    const entities = tableClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${organizationId}'` }
    });

    const batches = [];
    for await (const entity of entities) {
      // Apply filters
      if (provider && entity.provider !== provider) continue;
      if (status && entity.currentStatus !== status) continue;

      batches.push({
        batchId: entity.batchId,
        provider: entity.provider,
        endpoint: entity.endpoint,  // Include endpoint for activity log display
        executionMode: entity.executionMode,
        currentStatus: entity.currentStatus,
        danNumber: entity.danNumber,
        altoTenancyId: entity.altoTenancyId,
        statusCheckCount: entity.statusCheckCount,
        requestDurationMs: entity.requestDurationMs,
        organizationId: entity.organizationId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        completedAt: entity.completedAt
      });

      // Limit results
      if (batches.length >= limit) break;
    }

    // Sort by creation date (descending)
    batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    context?.log(`Retrieved ${batches.length} recent batches`);

    return batches;

  } catch (error) {
    context?.error('Error retrieving recent batches:', error);
    throw new Error(`Failed to get recent batches: ${error.message}`);
  }
}

/**
 * Get batch tracking statistics
 *
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Statistics object
 */
async function getBatchStatistics(context) {
  try {
    context?.log('Retrieving batch tracking statistics');

    const tableClient = getTableClient();
    const entities = tableClient.listEntities({
      queryOptions: { filter: `PartitionKey eq 'BatchTracking'` }
    });

    // Aggregate statistics
    const stats = {};
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for await (const entity of entities) {
      // Filter to last 7 days
      if (new Date(entity.createdAt) < sevenDaysAgo) continue;

      const key = `${entity.provider}|${entity.executionMode}|${entity.currentStatus}`;

      if (!stats[key]) {
        stats[key] = {
          provider: entity.provider,
          executionMode: entity.executionMode,
          currentStatus: entity.currentStatus,
          batchCount: 0,
          totalDuration: 0,
          totalStatusChecks: 0,
          firstCreated: entity.createdAt,
          lastCreated: entity.createdAt
        };
      }

      stats[key].batchCount++;
      stats[key].totalDuration += entity.requestDurationMs || 0;
      stats[key].totalStatusChecks += entity.statusCheckCount || 0;

      if (new Date(entity.createdAt) < new Date(stats[key].firstCreated)) {
        stats[key].firstCreated = entity.createdAt;
      }
      if (new Date(entity.createdAt) > new Date(stats[key].lastCreated)) {
        stats[key].lastCreated = entity.createdAt;
      }
    }

    // Calculate averages and format results
    const results = Object.values(stats).map(stat => ({
      provider: stat.provider,
      executionMode: stat.executionMode,
      currentStatus: stat.currentStatus,
      batchCount: stat.batchCount,
      avgDurationMs: stat.batchCount > 0 ? Math.round(stat.totalDuration / stat.batchCount) : 0,
      avgStatusChecks: stat.batchCount > 0 ? Math.round(stat.totalStatusChecks / stat.batchCount) : 0,
      firstCreated: stat.firstCreated,
      lastCreated: stat.lastCreated
    }));

    context?.log(`Retrieved statistics for ${results.length} provider/mode/status combinations`);

    return results;

  } catch (error) {
    context?.error('Error retrieving batch statistics:', error);
    throw new Error(`Failed to get batch statistics: ${error.message}`);
  }
}

module.exports = {
  storeBatchTracking,
  getBatchProvider,
  updateBatchStatus,
  getBatchDetails,
  getBatchStatusCached,
  getRecentBatches,
  getBatchStatistics
};
