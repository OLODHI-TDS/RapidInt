/**
 * Organization Credentials Retrieval Module
 *
 * Retrieves TDS credentials from the organization mapping table
 * for use in Salesforce EWC API authentication.
 *
 * This module handles:
 * - Database connection and queries
 * - API key decryption
 * - Credential caching (optional)
 * - Error handling
 */

const crypto = require('crypto');

// Encryption key cache
let encryptionKeyCache = {
  key: null,
  timestamp: null,
  ttl: 60 * 60 * 1000 // 1 hour
};

/**
 * Get encryption key from Azure Key Vault with caching
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<string>} - Encryption secret key
 */
async function getEncryptionKey(context) {
  // Check cache first
  const now = Date.now();
  if (encryptionKeyCache.key && encryptionKeyCache.timestamp && (now - encryptionKeyCache.timestamp < encryptionKeyCache.ttl)) {
    context?.log('Using cached encryption key');
    return encryptionKeyCache.key;
  }

  try {
    // Check if using Azure Key Vault
    const useKeyVault = process.env.USE_KEY_VAULT === 'true';
    const keyVaultName = process.env.KEY_VAULT_NAME;

    if (useKeyVault && keyVaultName) {
      context?.log('Retrieving encryption key from Azure Key Vault');

      const { DefaultAzureCredential } = require('@azure/identity');
      const { SecretClient } = require('@azure/keyvault-secrets');

      const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;
      const credential = new DefaultAzureCredential();
      const secretClient = new SecretClient(keyVaultUrl, credential);

      const secretName = process.env.ENCRYPTION_SECRET_NAME || 'encryption-secret';
      const secret = await secretClient.getSecret(secretName);

      const encryptionKey = secret.value;

      // Cache the key
      encryptionKeyCache.key = encryptionKey;
      encryptionKeyCache.timestamp = Date.now();

      context?.log('Encryption key retrieved and cached from Key Vault');
      return encryptionKey;

    } else {
      // Fall back to environment variable (for local development)
      context?.warn('Using encryption key from environment variable (not recommended for production)');

      const encryptionKey = process.env.ENCRYPTION_SECRET;

      if (!encryptionKey) {
        throw new Error('ENCRYPTION_SECRET environment variable is not set and Key Vault is not configured');
      }

      // Cache the key
      encryptionKeyCache.key = encryptionKey;
      encryptionKeyCache.timestamp = Date.now();

      return encryptionKey;
    }

  } catch (error) {
    context?.error('Failed to retrieve encryption key:', error);
    throw new Error(`Failed to retrieve encryption key: ${error.message}`);
  }
}

/**
 * Clear encryption key cache (useful for key rotation)
 */
function clearEncryptionKeyCache() {
  encryptionKeyCache.key = null;
  encryptionKeyCache.timestamp = null;
  console.log('Encryption key cache cleared');
}

/**
 * Decrypt TDS API key from database
 * Uses the same algorithm as OrganizationMapping model
 * @param {string} encryptedApiKey - Encrypted API key (format: iv:encrypted_value)
 * @param {Object} context - Azure Function context (for logging, optional)
 * @returns {Promise<string>} - Decrypted API key
 */
async function decryptApiKey(encryptedApiKey, context = null) {
  try {
    const algorithm = 'aes-256-cbc';

    // Get encryption key (from Key Vault or environment)
    const secretKey = await getEncryptionKey(context);
    const key = crypto.scryptSync(secretKey, 'salt', 32);

    const [ivHex, encrypted] = encryptedApiKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    context?.error('Failed to decrypt API key:', error);
    throw new Error('Failed to decrypt TDS API key');
  }
}

/**
 * Encrypt TDS API key for storage in database
 * @param {string} plainApiKey - Plain text API key
 * @param {Object} context - Azure Function context (for logging, optional)
 * @returns {Promise<string>} - Encrypted API key (format: iv:encrypted_value)
 */
async function encryptApiKey(plainApiKey, context = null) {
  try {
    const algorithm = 'aes-256-cbc';

    // Get encryption key (from Key Vault or environment)
    const secretKey = await getEncryptionKey(context);
    const key = crypto.scryptSync(secretKey, 'salt', 32);

    // Generate random IV
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(plainApiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return in format: iv:encrypted_value
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    context?.error('Failed to encrypt API key:', error);
    throw new Error('Failed to encrypt TDS API key');
  }
}

/**
 * Get organization credentials from Azure Table Storage
 *
 * @param {string} altoAgencyRef - Alto agency reference
 * @param {string} altoBranchId - Alto branch ID
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Organization credentials object
 */
async function getOrganizationCredentials(altoAgencyRef, altoBranchId, context) {
  try {
    // Build cache key
    const cacheKey = `${altoAgencyRef}:${altoBranchId}`;

    // Check cache first
    const cached = getCachedCredentials(cacheKey);
    if (cached) {
      context?.log(`Using cached credentials for agency ${altoAgencyRef}, branch ${altoBranchId}`);
      return cached;
    }

    context?.log(`Fetching organization credentials for agency ${altoAgencyRef}, branch ${altoBranchId}`);

    // Use Azure Table Storage instead of SQL
    const { TableClient } = require('@azure/data-tables');
    const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
    const tableClient = TableClient.fromConnectionString(connectionString, 'OrganizationMappings');

    // Query organization mapping table
    const rowKey = `${altoAgencyRef}:${altoBranchId}`;

    let org;
    try {
      org = await tableClient.getEntity('OrganizationMapping', rowKey);
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`No active organization mapping found for agency ${altoAgencyRef}, branch ${altoBranchId}`);
      }
      throw error;
    }

    // Check if active
    if (!org.isActive) {
      throw new Error(`Organization mapping for agency ${altoAgencyRef}, branch ${altoBranchId} is not active`);
    }

    // Decrypt API key if encrypted
    let apiKey = org.tdsApiKey;
    if (org.tdsApiKey && org.tdsApiKey.includes(':')) {
      // Encrypted format: iv:encrypted_value
      apiKey = await decryptApiKey(org.tdsApiKey, context);
    }

    // Build credentials object
    const credentials = {
      memberId: org.tdsMemberId,
      branchId: org.tdsBranchId,
      apiKey: apiKey,
      region: org.region || 'EW',
      schemeType: org.schemeType || 'Custodial',
      organizationName: org.memberName || org.organizationName || 'Unknown Organization',
      providerPreference: org.tdsProviderPreference || org.providerPreference || 'auto' // current, salesforce, or auto
    };

    context?.log(`Successfully retrieved credentials for ${credentials.organizationName}`);

    // Cache the credentials
    cacheCredentials(cacheKey, credentials);

    return credentials;

  } catch (error) {
    context?.error('Error retrieving organization credentials:', error);
    throw new Error(`Failed to retrieve organization credentials: ${error.message}`);
  }
}

// Database connection pool
let connectionPool = null;

// Credential cache
const credentialCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Get or create database connection pool
 * @returns {Promise<Object>} - Database connection pool
 */
async function getConnectionPool() {
  if (connectionPool && connectionPool.connected) {
    return connectionPool;
  }

  const sql = require('mssql');
  const connectionString = process.env.SQL_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error('SQL_CONNECTION_STRING environment variable is not set');
  }

  const config = {
    connectionString: connectionString,
    options: {
      encrypt: true, // Required for Azure SQL
      trustServerCertificate: false,
      connectTimeout: 30000,
      requestTimeout: 30000
    },
    pool: {
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000
    }
  };

  connectionPool = await sql.connect(config);
  return connectionPool;
}

/**
 * Execute database query with retry logic
 *
 * @param {string} connectionString - Database connection string (ignored, uses pool)
 * @param {string} query - SQL query
 * @param {Object} parameters - Query parameters
 * @returns {Promise<Array>} - Query results
 */
async function executeQuery(connectionString, query, parameters) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = await getConnectionPool();
      const request = pool.request();

      // Add parameters to request
      if (parameters) {
        Object.entries(parameters).forEach(([key, value]) => {
          request.input(key, value);
        });
      }

      const result = await request.query(query);
      return result.recordset;

    } catch (error) {
      lastError = error;
      console.error(`Database query failed (attempt ${attempt}/${maxRetries}):`, error.message);

      // If it's a connection error, reset the pool
      if (error.code === 'ECONNRESET' || error.code === 'ESOCKET') {
        connectionPool = null;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`Database query failed after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Clear credential cache (useful for testing or after updates)
 */
function clearCredentialCache() {
  credentialCache.clear();
  console.log('Credential cache cleared');
}

/**
 * Get cached credentials if available and not expired
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} - Cached credentials or null
 */
function getCachedCredentials(cacheKey) {
  const cached = credentialCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    // Expired
    credentialCache.delete(cacheKey);
    return null;
  }

  return cached.credentials;
}

/**
 * Store credentials in cache
 * @param {string} cacheKey - Cache key
 * @param {Object} credentials - Credentials to cache
 */
function cacheCredentials(cacheKey, credentials) {
  credentialCache.set(cacheKey, {
    credentials,
    timestamp: Date.now()
  });
}

/**
 * Get credentials from environment variable (for testing/fallback)
 *
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Object} - Test credentials
 */
function getTestCredentials(context) {
  context?.warn('Using test credentials from environment variables');

  return {
    memberId: process.env.TEST_TDS_MEMBER_ID || 'TEST123',
    branchId: process.env.TEST_TDS_BRANCH_ID || '0',
    apiKey: process.env.TEST_TDS_API_KEY || 'test-api-key',
    region: process.env.TEST_TDS_REGION || 'EW',
    schemeType: process.env.TEST_TDS_SCHEME_TYPE || 'Custodial',
    organizationName: 'Test Organization'
  };
}

module.exports = {
  getOrganizationCredentials,
  getTestCredentials,
  decryptApiKey,
  encryptApiKey,
  clearCredentialCache,
  clearEncryptionKeyCache,
  getConnectionPool,
  executeQuery,
  // For testing and monitoring
  getCacheStats: () => ({
    size: credentialCache.size,
    ttlMs: CACHE_TTL_MS
  })
};
