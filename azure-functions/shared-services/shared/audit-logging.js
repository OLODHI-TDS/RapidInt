/**
 * Legacy API Audit Logging Service
 *
 * Provides Azure Table Storage interaction functions for auditing all Legacy API requests/responses.
 *
 * Key Features:
 * - Track all Legacy API endpoint calls (GET, POST, PUT, DELETE)
 * - Store request/response details with timing information
 * - Support filtering by organization, endpoint, method, status, date
 * - PII encryption for sensitive data (GDPR Article 32 compliance)
 * - Efficient pagination for large audit logs
 *
 * Storage:
 * - Uses Azure Table Storage (LegacyAPIAuditLog table)
 * - PartitionKey: organizationId (for efficient querying by org)
 * - RowKey: timestamp_requestId (for sorting and uniqueness)
 */

const { TableClient } = require('@azure/data-tables');
const { encryptPII, decryptPII } = require('./pii-encryption');
const { v4: uuidv4 } = require('uuid');

/**
 * Get or create audit log table client
 * @returns {TableClient} - Table client instance
 */
function getAuditTableClient() {
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  return TableClient.fromConnectionString(connectionString, 'LegacyAPIAuditLog');
}

/**
 * Ensure audit log table exists
 * @param {Object} context - Azure Function context
 * @returns {Promise<void>}
 */
async function ensureAuditTableExists(context) {
  try {
    const tableClient = getAuditTableClient();
    await tableClient.createTable();
    context?.log('[AUDIT] LegacyAPIAuditLog table created');
  } catch (error) {
    // Ignore error if table already exists
    if (error.statusCode !== 409) {
      context?.warn(`[AUDIT] Failed to create table: ${error.message}`);
    }
  }
}

/**
 * Log an audit entry for a Legacy API request
 *
 * @param {Object} auditData - Audit log data
 * @param {string} auditData.organizationId - Organization ID (for partitioning)
 * @param {string} auditData.organizationName - Organization display name
 * @param {string} auditData.endpoint - Endpoint name (e.g., 'TenancyInformation')
 * @param {string} auditData.method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} auditData.requestUrl - Full request URL
 * @param {Object} auditData.requestHeaders - Request headers (sanitized)
 * @param {Object} auditData.requestBody - Request body (for POST/PUT)
 * @param {Object} auditData.requestParams - URL parameters (for GET)
 * @param {number} auditData.responseStatus - HTTP response status code
 * @param {number} auditData.responseTime - Response time in milliseconds
 * @param {Object} auditData.responseBody - Response body
 * @param {boolean} auditData.success - Whether request was successful
 * @param {string} auditData.errorMessage - Error message if failed
 * @param {string} auditData.legacyMemberId - Legacy member ID
 * @param {string} auditData.legacyBranchId - Legacy branch ID
 * @param {string} auditData.batchId - Batch ID (for CreateDeposit)
 * @param {string} auditData.danNumber - DAN number (for deposit-related endpoints)
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Created audit log entry
 */
async function logAuditEntry(auditData, context) {
  try {
    const {
      organizationId,
      organizationName,
      endpoint,
      method,
      requestUrl,
      requestHeaders = {},
      requestBody = null,
      requestParams = null,
      responseStatus,
      responseTime,
      responseBody = null,
      success,
      errorMessage = null,
      legacyMemberId = null,
      legacyBranchId = null,
      batchId = null,
      danNumber = null
    } = auditData;

    // Validate required fields
    if (!organizationId || !endpoint || !method) {
      context?.error('Missing required audit fields: organizationId, endpoint, or method');
      return null;
    }

    // Ensure table exists before logging
    await ensureAuditTableExists(context);

    const tableClient = getAuditTableClient();
    const timestamp = new Date().toISOString();
    const requestId = uuidv4();

    // Sanitize sensitive data from headers (remove authorization tokens, API keys)
    const sanitizedHeaders = { ...requestHeaders };
    delete sanitizedHeaders.authorization;
    delete sanitizedHeaders.Authorization;
    delete sanitizedHeaders['x-api-key'];

    // Encrypt request and response bodies containing PII
    // Azure Table Storage has a 64KB limit per property AND uses UTF-16 encoding
    // This means 32K characters max (32K chars × 2 bytes = 64KB in UTF-16)
    // Encryption adds ~33% overhead, so we need to be VERY conservative
    const MAX_PROPERTY_SIZE = 15000; // 15K chars → ~20K encrypted → ~40KB in UTF-16 (safe margin)

    context?.log(`[AUDIT] Processing request body size: ${requestBody ? JSON.stringify(requestBody).length : 0} bytes`);
    context?.log(`[AUDIT] Processing response body size: ${responseBody ? JSON.stringify(responseBody).length : 0} bytes`);

    let encryptedRequestBody = null;
    if (requestBody) {
      const requestJson = JSON.stringify(requestBody);
      // If request is too large, store summary instead
      if (requestJson.length > MAX_PROPERTY_SIZE) {
        const summary = {
          _truncated: true,
          _originalSize: requestJson.length,
          _message: 'Request body too large to store'
        };
        encryptedRequestBody = await encryptPII(JSON.stringify(summary), null, context);
        context?.warn(`[AUDIT] Request body truncated: ${requestJson.length} bytes -> ${JSON.stringify(summary).length} bytes`);
      } else {
        encryptedRequestBody = await encryptPII(requestJson, null, context);
      }
    }

    let encryptedResponseBody = null;
    if (responseBody) {
      const responseJson = JSON.stringify(responseBody);
      // If response is too large, store summary instead
      if (responseJson.length > MAX_PROPERTY_SIZE) {
        const summary = {
          _truncated: true,
          _originalSize: responseJson.length,
          _recordCount: Array.isArray(responseBody) ? responseBody.length : null,
          _message: 'Response body too large to store'
        };
        encryptedResponseBody = await encryptPII(JSON.stringify(summary), null, context);
        context?.warn(`[AUDIT] Response body truncated: ${responseJson.length} bytes (${Array.isArray(responseBody) ? responseBody.length + ' records' : 'large object'}) -> ${JSON.stringify(summary).length} bytes`);
      } else {
        encryptedResponseBody = await encryptPII(responseJson, null, context);
      }
    }

    // Verify encrypted sizes don't exceed UTF-16 limit after encryption
    // Azure Table Storage: 32K characters max (stored as UTF-16 = 64KB)
    const MAX_UTF16_CHARS = 30000; // 30K characters = 60KB in UTF-16 (leave buffer)

    if (encryptedRequestBody && encryptedRequestBody.length > MAX_UTF16_CHARS) {
      context?.error(`[AUDIT] CRITICAL: Encrypted request still too large (${encryptedRequestBody.length} chars), storing minimal summary`);
      encryptedRequestBody = await encryptPII(JSON.stringify({ _truncated: true, _message: 'Request too large' }), null, context);
    }

    if (encryptedResponseBody && encryptedResponseBody.length > MAX_UTF16_CHARS) {
      context?.error(`[AUDIT] CRITICAL: Encrypted response still too large (${encryptedResponseBody.length} chars), storing minimal summary`);
      const recordCount = Array.isArray(responseBody) ? responseBody.length : null;
      encryptedResponseBody = await encryptPII(JSON.stringify({
        _truncated: true,
        _recordCount: recordCount,
        _message: 'Response too large'
      }), null, context);
    }

    context?.log(`[AUDIT] Final encrypted sizes - request: ${encryptedRequestBody ? encryptedRequestBody.length : 0} chars, response: ${encryptedResponseBody ? encryptedResponseBody.length : 0} chars (UTF-16: ~${encryptedResponseBody ? encryptedResponseBody.length * 2 : 0} bytes)`);

    // Truncate any field that exceeds Azure Table Storage limits
    // UTF-16 encoding: 32K characters = 64KB
    const MAX_FIELD_CHARS = 30000; // 30K characters = 60KB in UTF-16 (safe margin)

    const truncateField = (value, fieldName) => {
      if (!value) return value;
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      if (str.length > MAX_FIELD_CHARS) {
        context?.warn(`[AUDIT] ${fieldName} truncated from ${str.length} to ${MAX_FIELD_CHARS} chars`);
        return str.substring(0, MAX_FIELD_CHARS) + '...[TRUNCATED]';
      }
      return str;
    };

    // Create audit log entity
    // PartitionKey: organizationId (for efficient org-based queries)
    // RowKey: reversedTimestamp_requestId (for newest-first sorting)
    const reversedTimestamp = (new Date('9999-12-31T23:59:59Z').getTime() - new Date(timestamp).getTime()).toString().padStart(20, '0');

    const entity = {
      partitionKey: organizationId,
      rowKey: `${reversedTimestamp}_${requestId}`,
      requestId: requestId,
      timestamp: timestamp,
      organizationId: organizationId,
      organizationName: organizationName || 'Unknown',
      endpoint: endpoint,
      method: method,
      requestUrl: truncateField(requestUrl, 'requestUrl'),
      requestHeaders: truncateField(sanitizedHeaders, 'requestHeaders'),
      requestBody: encryptedRequestBody,  // Already size-checked
      requestParams: requestParams ? truncateField(requestParams, 'requestParams') : null,
      responseStatus: responseStatus || 0,
      responseTime: responseTime || 0,
      responseBody: encryptedResponseBody,  // Already size-checked
      success: success,
      errorMessage: truncateField(errorMessage, 'errorMessage'),
      legacyMemberId: legacyMemberId || '',
      legacyBranchId: legacyBranchId || '',
      batchId: batchId || '',
      danNumber: danNumber || ''
    };

    // Final safety check - log all field sizes (in characters, which become UTF-16 in Azure)
    const fieldSizes = {
      requestUrl: entity.requestUrl?.length || 0,
      requestHeaders: entity.requestHeaders?.length || 0,
      requestBody: entity.requestBody?.length || 0,
      requestParams: entity.requestParams?.length || 0,
      responseBody: entity.responseBody?.length || 0,
      errorMessage: entity.errorMessage?.length || 0
    };
    const utf16Size = Object.values(fieldSizes).reduce((sum, size) => sum + size, 0) * 2;
    context?.log(`[AUDIT] Entity field sizes (chars):`, fieldSizes);
    context?.log(`[AUDIT] Total UTF-16 size: ~${utf16Size} bytes`);

    await tableClient.createEntity(entity);

    context?.log(`[AUDIT] Logged ${method} ${endpoint} for ${organizationName} (${requestId})`);

    return {
      requestId,
      timestamp,
      success: true
    };

  } catch (error) {
    context?.error(`Failed to log audit entry: ${error.message}`);
    // Don't throw - audit logging should not break the main request
    return null;
  }
}

/**
 * Query audit logs with filtering and pagination
 *
 * @param {Object} filters - Filter criteria
 * @param {string} filters.organizationId - Filter by organization
 * @param {string} filters.endpoint - Filter by endpoint name
 * @param {string} filters.method - Filter by HTTP method
 * @param {string} filters.status - Filter by success/failed
 * @param {string} filters.startDate - Filter by start date (ISO string)
 * @param {string} filters.endDate - Filter by end date (ISO string)
 * @param {number} filters.limit - Maximum number of results (default 50)
 * @param {string} filters.continuationToken - Token for pagination
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Query results with pagination
 */
async function queryAuditLogs(filters = {}, context) {
  try {
    // Ensure table exists before querying
    await ensureAuditTableExists(context);

    const {
      organizationId = null,
      endpoint = null,
      method = null,
      status = null,
      startDate = null,
      endDate = null,
      limit = 50,
      continuationToken = null
    } = filters;

    const tableClient = getAuditTableClient();

    // Build query filter
    let queryFilter = '';
    const filterParts = [];

    if (organizationId) {
      filterParts.push(`PartitionKey eq '${organizationId}'`);
    }

    if (endpoint) {
      filterParts.push(`endpoint eq '${endpoint}'`);
    }

    if (method) {
      filterParts.push(`method eq '${method}'`);
    }

    if (status) {
      const successValue = status === 'success';
      filterParts.push(`success eq ${successValue}`);
    }

    if (startDate) {
      const reversedStart = (new Date('9999-12-31T23:59:59Z').getTime() - new Date(startDate).getTime()).toString().padStart(20, '0');
      filterParts.push(`RowKey le '${reversedStart}'`);
    }

    if (endDate) {
      const reversedEnd = (new Date('9999-12-31T23:59:59Z').getTime() - new Date(endDate).getTime()).toString().padStart(20, '0');
      filterParts.push(`RowKey ge '${reversedEnd}'`);
    }

    queryFilter = filterParts.join(' and ');

    // Query with pagination
    const queryOptions = {
      filter: queryFilter || undefined
    };

    const logs = [];
    let count = 0;
    let nextToken = null;

    const iterator = tableClient.listEntities({ queryOptions }).byPage({ maxPageSize: limit, continuationToken });

    for await (const page of iterator) {
      for (const entity of page) {
        if (count >= limit) break;

        // Don't decrypt bodies for list view (performance optimization)
        logs.push({
          requestId: entity.requestId,
          timestamp: entity.timestamp,
          organizationId: entity.organizationId,
          organizationName: entity.organizationName,
          endpoint: entity.endpoint,
          method: entity.method,
          success: entity.success,
          responseTime: entity.responseTime,
          responseStatus: entity.responseStatus,
          errorMessage: entity.errorMessage || null,
          batchId: entity.batchId || null,  // Include batch ID for CreateDeposit
          danNumber: entity.danNumber || null  // Include DAN for deposit-related endpoints
        });

        count++;
      }

      nextToken = page.continuationToken || null;
      break; // Only get first page
    }

    return {
      success: true,
      logs: logs,
      continuationToken: nextToken,
      hasMore: !!nextToken,
      count: logs.length
    };

  } catch (error) {
    context?.error(`Failed to query audit logs: ${error.message}`);
    return {
      success: false,
      error: error.message,
      logs: [],
      continuationToken: null,
      hasMore: false,
      count: 0
    };
  }
}

/**
 * Get detailed audit log entry by request ID
 *
 * @param {string} requestId - Request ID to retrieve
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Full audit log entry with decrypted data
 */
async function getAuditLogDetails(requestId, context) {
  try {
    // Ensure table exists before querying
    await ensureAuditTableExists(context);

    const tableClient = getAuditTableClient();

    // Query by requestId across all partitions
    const queryFilter = `requestId eq '${requestId}'`;
    const entities = tableClient.listEntities({ queryOptions: { filter: queryFilter } });

    for await (const entity of entities) {
      // Decrypt request and response bodies
      let requestBody = null;
      let responseBody = null;

      if (entity.requestBody) {
        try {
          const decrypted = await decryptPII(entity.requestBody, null, context);
          requestBody = JSON.parse(decrypted);
        } catch (e) {
          context?.warn(`Failed to decrypt request body: ${e.message}`);
          requestBody = { error: 'Failed to decrypt' };
        }
      }

      if (entity.responseBody) {
        try {
          const decrypted = await decryptPII(entity.responseBody, null, context);
          responseBody = JSON.parse(decrypted);
        } catch (e) {
          context?.warn(`Failed to decrypt response body: ${e.message}`);
          responseBody = { error: 'Failed to decrypt' };
        }
      }

      return {
        success: true,
        log: {
          requestId: entity.requestId,
          timestamp: entity.timestamp,
          organizationId: entity.organizationId,
          organizationName: entity.organizationName,
          endpoint: entity.endpoint,
          method: entity.method,
          requestUrl: entity.requestUrl,
          requestHeaders: entity.requestHeaders ? JSON.parse(entity.requestHeaders) : {},
          requestBody: requestBody,
          requestParams: entity.requestParams ? JSON.parse(entity.requestParams) : null,
          responseStatus: entity.responseStatus,
          responseTime: entity.responseTime,
          responseBody: responseBody,
          success: entity.success,
          errorMessage: entity.errorMessage || null,
          metadata: {
            legacyMemberId: entity.legacyMemberId || null,
            legacyBranchId: entity.legacyBranchId || null,
            batchId: entity.batchId || null,
            danNumber: entity.danNumber || null
          }
        }
      };
    }

    return {
      success: false,
      error: 'Audit log entry not found'
    };

  } catch (error) {
    context?.error(`Failed to get audit log details: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get audit log statistics
 *
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Statistics about audit logs
 */
async function getAuditStats(context) {
  try {
    // Ensure table exists before querying
    await ensureAuditTableExists(context);

    const tableClient = getAuditTableClient();

    // Get logs from last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const reversedOneHourAgo = (new Date('9999-12-31T23:59:59Z').getTime() - new Date(oneHourAgo).getTime()).toString().padStart(20, '0');

    const recentFilter = `RowKey le '${reversedOneHourAgo}'`;
    const recentLogs = tableClient.listEntities({ queryOptions: { filter: recentFilter } });

    let totalRequests = 0;
    let successCount = 0;
    let totalResponseTime = 0;
    const orgSet = new Set();
    const endpointCounts = {};

    for await (const entity of recentLogs) {
      totalRequests++;
      if (entity.success) successCount++;
      totalResponseTime += entity.responseTime || 0;
      orgSet.add(entity.organizationId);
      endpointCounts[entity.endpoint] = (endpointCounts[entity.endpoint] || 0) + 1;
    }

    const successRate = totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(1) + '%' : '0%';
    const avgResponseTime = totalRequests > 0 ? Math.round(totalResponseTime / totalRequests) + 'ms' : '0ms';

    return {
      success: true,
      stats: {
        requestsLastHour: totalRequests,
        successRate: successRate,
        avgResponseTime: avgResponseTime,
        activeOrganizations: orgSet.size,
        requestsByEndpoint: endpointCounts
      }
    };

  } catch (error) {
    context?.error(`Failed to get audit stats: ${error.message}`);
    return {
      success: false,
      stats: {
        requestsLastHour: 0,
        successRate: '0%',
        avgResponseTime: '0ms',
        activeOrganizations: 0,
        requestsByEndpoint: {}
      }
    };
  }
}

module.exports = {
  logAuditEntry,
  queryAuditLogs,
  getAuditLogDetails,
  getAuditStats,
  ensureAuditTableExists
};
