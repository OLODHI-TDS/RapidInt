/**
 * Salesforce TDS API Authentication Module
 *
 * Supports two authentication methods:
 * 1. API Key - Simple static AccessToken (Scheme-Type-MemberID-BranchID-ApiKey)
 * 2. OAuth2 - TDS custom OAuth2 with session token (5-minute expiry)
 *
 * TDS OAuth2 Implementation:
 * - Step 1: GET {baseUrl}/authorise with header auth_code: "Scheme-Type-ClientID-ClientSecret-MemberID"
 * - Step 2: Response contains AccessToken field
 * - Step 3: Use cached AccessToken for API calls with header auth_code: "<AccessToken>"
 * - Returns AccessToken (not standard OAuth2 format)
 * - No expires_in field (uses configured expiry time)
 *
 * TDS API Key Implementation:
 * - Header: AccessToken: "Scheme-Type-MemberID-BranchID-ApiKey"
 * - No authorization step required
 *
 * Features:
 * - Automatic method selection based on configuration
 * - Token caching and automatic refresh for OAuth2
 * - Thread-safe token management
 * - Configurable via environment variables or org credentials
 * - Detailed logging for troubleshooting
 *
 * Environment Variables:
 * - SALESFORCE_AUTH_METHOD: "api-key" or "oauth2" (default: "oauth2")
 * - SALESFORCE_API_KEY: Static API key (if using api-key method)
 * - SALESFORCE_CLIENT_ID: OAuth2 client ID (if using oauth2 method)
 * - SALESFORCE_CLIENT_SECRET: OAuth2 client secret (if using oauth2 method)
 * - SALESFORCE_AUTH_URL: OAuth2 auth endpoint URL (optional, can derive from baseUrl)
 * - SALESFORCE_TOKEN_EXPIRY_SECONDS: Token expiry time (default: 300 = 5 minutes)
 */

const axios = require('axios');

// Configuration
const CONFIG = {
  authMethod: process.env.SALESFORCE_AUTH_METHOD || 'oauth2',
  apiKey: process.env.SALESFORCE_API_KEY,
  clientId: process.env.SALESFORCE_CLIENT_ID,
  clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
  authUrl: process.env.SALESFORCE_AUTH_URL || 'https://login.salesforce.com/services/oauth2/token',
  tokenExpirySeconds: parseInt(process.env.SALESFORCE_TOKEN_EXPIRY_SECONDS || '300', 10), // 5 minutes default
  tokenRefreshBuffer: 60 // Refresh token 60 seconds before expiry
};

// Token cache (in-memory) - Per-branch isolation to prevent cross-contamination
// Key format: "memberId:branchId" to ensure complete isolation between organizations
const tokenCaches = new Map();

/**
 * Get or create a token cache for a specific member/branch combination
 * This ensures complete isolation between different organizations
 */
function getTokenCacheForBranch(memberId, branchId) {
  const cacheKey = `${memberId}:${branchId}`;

  if (!tokenCaches.has(cacheKey)) {
    tokenCaches.set(cacheKey, {
      token: null,
      expiresAt: null,
      isRefreshing: false,
      refreshPromise: null
    });
  }

  return tokenCaches.get(cacheKey);
}

/**
 * Get authentication header for Salesforce API requests
 * Automatically handles token retrieval, caching, and refresh
 *
 * @param {Object} context - Azure Function context (for logging)
 * @param {Object} orgCredentials - Organization-specific credentials (optional)
 * @param {string} orgCredentials.memberId - TDS Member ID
 * @param {string} orgCredentials.branchId - TDS Branch ID
 * @param {string} orgCredentials.apiKey - TDS API Key (decrypted)
 * @param {string} orgCredentials.region - Region (EW, Scotland, NI)
 * @param {string} orgCredentials.schemeType - Scheme type (Custodial, Insured)
 * @param {string} orgCredentials.authMethod - Auth method override (api-key or oauth2)
 * @returns {Promise<Object>} - Authorization header object
 */
async function getSalesforceAuthHeader(context, orgCredentials = null) {
  // Use org-specific auth method if provided, otherwise fall back to global config
  const method = (orgCredentials?.authMethod || CONFIG.authMethod).toLowerCase();

  context?.log(`Getting Salesforce auth header using method: ${method}`);

  // Normalize method name (handle both 'api-key' and 'api_key' formats)
  const normalizedMethod = method.replace(/_/g, '-');

  switch (normalizedMethod) {
    case 'api-key':
      return await getApiKeyHeader(context, orgCredentials);

    case 'oauth2':
      return await getOAuth2Header(context, orgCredentials);

    default:
      throw new Error(`Unsupported Salesforce auth method: ${method} (normalized: ${normalizedMethod})`);
  }
}

/**
 * API Key Authentication
 * TDS EWC format: Scheme-SchemeType-MemberID-BranchID-ApiKey
 * Passed in custom AccessToken header
 */
async function getApiKeyHeader(context, orgCredentials = null) {
  let accessToken;

  if (orgCredentials) {
    // Build AccessToken from organization-specific credentials
    context?.log('Building Salesforce EWC AccessToken from organization credentials');

    const { memberId, branchId, apiKey, region, schemeType } = orgCredentials;

    // Validate required fields
    if (!memberId || !branchId || !apiKey) {
      throw new Error('Organization credentials missing required fields: memberId, branchId, apiKey');
    }

    // Map region to scheme name
    const schemeMap = {
      'EW': 'England & Wales Custodial',
      'Scotland': 'Scotland Custodial',
      'NI': 'Northern Ireland Custodial'
    };

    const scheme = schemeMap[region] || 'England & Wales Custodial';
    const type = schemeType || 'Custodial';

    // Build AccessToken: Scheme-SchemeType-MemberID-BranchID-ApiKey
    accessToken = `${scheme}-${type}-${memberId}-${branchId}-${apiKey}`;

    context?.log(`🔑 Built AccessToken components:`, {
      scheme,
      type,
      memberId,
      branchId,
      apiKeyLength: apiKey?.length || 0,
      fullTokenLength: accessToken.length
    });
    context?.log(`🔑 Full AccessToken format: ${scheme}-${type}-${memberId}-${branchId}-[API_KEY_${apiKey?.length || 0}_CHARS]`);

  } else {
    // Fall back to environment variable (for testing/default)
    if (!CONFIG.apiKey) {
      throw new Error('SALESFORCE_API_KEY environment variable is not set and no organization credentials provided');
    }

    accessToken = CONFIG.apiKey;
    context?.log('Using Salesforce EWC AccessToken from environment variable');
  }

  // TDS EWC API uses 'AccessToken' header, not 'Authorization'
  return {
    'AccessToken': accessToken
  };
}

/**
 * OAuth2 Authentication
 * TDS custom OAuth2 flow with per-branch token caching
 */
async function getOAuth2Header(context, orgCredentials = null) {
  // Determine which credentials to use
  const clientId = orgCredentials?.clientId || CONFIG.clientId;
  const clientSecret = orgCredentials?.clientSecret || CONFIG.clientSecret;
  const baseUrl = orgCredentials?.baseUrl || null;
  const memberId = orgCredentials?.memberId || null;
  const branchId = orgCredentials?.branchId || null;
  const region = orgCredentials?.region || null;
  const schemeType = orgCredentials?.schemeType || null;

  // Get the branch-specific token cache to ensure isolation
  const tokenCache = getTokenCacheForBranch(memberId, branchId);

  // Check if token is valid and not expiring soon
  if (isTokenValid(tokenCache)) {
    context?.log(`Using cached TDS OAuth2 AccessToken for ${memberId}:${branchId}`);
    return {
      'AccessToken': tokenCache.token
    };
  }

  // If another thread is refreshing THIS branch's token, wait for it
  if (tokenCache.isRefreshing && tokenCache.refreshPromise) {
    context?.log(`Waiting for ongoing token refresh for ${memberId}:${branchId}...`);
    await tokenCache.refreshPromise;
    return {
      'AccessToken': tokenCache.token
    };
  }

  // Refresh token for this specific branch
  context?.log(`Refreshing TDS OAuth2 token for ${memberId}:${branchId}...`);
  await refreshOAuth2Token(context, clientId, clientSecret, baseUrl, memberId, branchId, region, schemeType);

  return {
    'AccessToken': tokenCache.token
  };
}

/**
 * Check if cached token is valid and not expiring soon
 * @param {Object} tokenCache - The branch-specific token cache
 */
function isTokenValid(tokenCache) {
  if (!tokenCache || !tokenCache.token || !tokenCache.expiresAt) {
    return false;
  }

  const now = Date.now();
  const expiresAt = tokenCache.expiresAt;
  const bufferMs = CONFIG.tokenRefreshBuffer * 1000;

  // Token is valid if it expires more than buffer seconds in the future
  return (expiresAt - now) > bufferMs;
}

/**
 * Refresh OAuth2 token using client credentials for a specific branch
 */
async function refreshOAuth2Token(context, clientId = null, clientSecret = null, baseUrl = null, memberId = null, branchId = null, region = null, schemeType = null) {
  // Use provided credentials or fall back to config
  const effectiveClientId = clientId || CONFIG.clientId;
  const effectiveClientSecret = clientSecret || CONFIG.clientSecret;

  // Validate configuration
  if (!effectiveClientId || !effectiveClientSecret) {
    throw new Error('SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set for OAuth2');
  }

  // Validate auth URL (either from config or from baseUrl)
  if (!CONFIG.authUrl && !baseUrl) {
    throw new Error('SALESFORCE_AUTH_URL or baseUrl must be provided for OAuth2');
  }

  // Get the branch-specific token cache
  const tokenCache = getTokenCacheForBranch(memberId, branchId);

  // Set refreshing flag and create promise for THIS branch
  tokenCache.isRefreshing = true;
  tokenCache.refreshPromise = performTokenRefresh(
    context,
    effectiveClientId,
    effectiveClientSecret,
    baseUrl,
    memberId,
    branchId,
    region,
    schemeType,
    tokenCache // Pass the branch-specific cache
  );

  try {
    await tokenCache.refreshPromise;
  } finally {
    tokenCache.isRefreshing = false;
    tokenCache.refreshPromise = null;
  }
}

/**
 * Perform the actual token refresh API call
 *
 * TDS Salesforce OAuth2 uses a custom implementation:
 * - GET request (not POST)
 * - Custom auth_code header (not standard OAuth2)
 * - Returns AccessToken (not access_token)
 * - No expires_in field (uses configured expiry)
 *
 * @param {Object} tokenCache - The branch-specific token cache to update
 */
async function performTokenRefresh(context, clientId, clientSecret, baseUrl = null, memberId = null, branchId = null, region = null, schemeType = null, tokenCache) {
  const startTime = Date.now();

  // Determine auth URL (declare outside try block so it's accessible in catch)
  let authUrl = CONFIG.authUrl;
  if (baseUrl) {
    // OAuth2 token endpoint does NOT use /auth/ prefix (it's the authentication endpoint itself)
    // Only API endpoints like /depositcreation use /auth/ prefix for OAuth2

    // ✅ Strip trailing /services/apexrest if already present (prevent duplication)
    const cleanBaseUrl = baseUrl.replace(/\/services\/apexrest\/?$/, '');
    authUrl = `${cleanBaseUrl}/services/apexrest/authorise`;
  }

  try {
    context?.log(`Using base URL to construct auth endpoint: ${authUrl}`);

    // Build auth_code header value
    // Format: "England & Wales Custodial-Custodial-<SF Client Id>-<SF Client Secret>-<SF Member Id>"
    const schemeMap = {
      'EW': 'England & Wales Custodial',
      'Scotland': 'Scotland Custodial',
      'NI': 'Northern Ireland Custodial'
    };

    const scheme = schemeMap[region] || 'England & Wales Custodial';
    const type = schemeType || 'Custodial';
    const effectiveMemberId = memberId || '0'; // Default to 0 if not provided

    const authCode = `${scheme}-${type}-${clientId}-${clientSecret}-${effectiveMemberId}`;

    context?.log(`🔐 OAuth2 auth_code components:`, {
      region,
      scheme,
      schemeType,
      type,
      memberId,
      effectiveMemberId,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret
    });
    context?.log(`🔐 OAuth2 auth_code format: [scheme]-[type]-[clientId]-[clientSecret]-[memberId]`);
    context?.log(`Requesting TDS OAuth2 token from: ${authUrl}`);

    // Make token request - TDS uses GET with auth_code header
    const response = await axios.get(
      authUrl,
      {
        headers: {
          'auth_code': authCode
        },
        timeout: 10000 // 10 second timeout for auth requests
      }
    );

    const duration = Date.now() - startTime;

    // Extract token from TDS response format
    const { success, AccessToken } = response.data;

    if (success !== 'true' && success !== true) {
      throw new Error(`TDS OAuth2 request failed: success=${success}`);
    }

    if (!AccessToken) {
      throw new Error('No AccessToken in TDS OAuth2 response');
    }

    // Replace the "0" in the AccessToken with the actual Branch ID
    // AccessToken format: "England & Wales Custodial-Custodial-0-1760036124563-<token>"
    // We need to replace the "0" (3rd segment) with the actual Branch ID
    let finalAccessToken = AccessToken;
    if (branchId && branchId !== '0') {
      const tokenParts = AccessToken.split('-');
      // The Branch ID is at index 2 (third position): Scheme-Type-BranchID-Timestamp-Token
      if (tokenParts.length >= 3 && tokenParts[2] === '0') {
        tokenParts[2] = branchId;
        finalAccessToken = tokenParts.join('-');
        context?.log(`✅ Replaced Branch ID "0" with "${branchId}" in AccessToken`);
      }
    }

    // Calculate expiry time (TDS doesn't provide expires_in, so use configured value)
    const expirySeconds = CONFIG.tokenExpirySeconds;
    const expiresAt = Date.now() + (expirySeconds * 1000);

    // Update cache
    tokenCache.token = finalAccessToken;
    tokenCache.expiresAt = expiresAt;

    context?.log(`TDS OAuth2 token received successfully in ${duration}ms (will expire in ${expirySeconds}s)`);

    return finalAccessToken;

  } catch (error) {
    const duration = Date.now() - startTime;

    context?.error('TDS OAuth2 token request failed', {
      duration,
      error: error.message,
      authUrl: authUrl, // Use actual authUrl, not CONFIG.authUrl
      status: error.response?.status,
      data: JSON.stringify(error.response?.data, null, 2) // Stringify to see full error details
    });

    // Clear cache on error
    tokenCache.token = null;
    tokenCache.expiresAt = null;

    // Include actual error details in exception
    const errorDetails = error.response?.data?.errors?.failure || [error.message];
    throw new Error(`TDS Salesforce OAuth2 authentication failed: ${JSON.stringify(errorDetails)}`);
  }
}

/**
 * Manually refresh the token for a specific branch (useful for warming up cache)
 */
async function forceTokenRefresh(context, memberId, branchId) {
  if (CONFIG.authMethod.toLowerCase() !== 'oauth2') {
    context?.warn('Force refresh requested but auth method is not OAuth2');
    return;
  }

  context?.log(`Force refreshing Salesforce OAuth2 token for ${memberId}:${branchId}...`);
  const tokenCache = getTokenCacheForBranch(memberId, branchId);
  tokenCache.token = null;
  tokenCache.expiresAt = null;

  await refreshOAuth2Token(context, null, null, null, memberId, branchId, null, null);
}

/**
 * Clear token cache for a specific branch (useful for testing or error recovery)
 * If no memberId/branchId provided, clears ALL caches
 */
function clearTokenCache(context, memberId = null, branchId = null) {
  if (memberId && branchId) {
    context?.log(`Clearing Salesforce token cache for ${memberId}:${branchId}`);
    const tokenCache = getTokenCacheForBranch(memberId, branchId);
    tokenCache.token = null;
    tokenCache.expiresAt = null;
    tokenCache.isRefreshing = false;
    tokenCache.refreshPromise = null;
  } else {
    context?.log('Clearing ALL Salesforce token caches');
    tokenCaches.clear();
  }
}

/**
 * Get authentication configuration info (for debugging)
 * If memberId/branchId provided, includes info for that specific cache
 */
function getAuthInfo(context, memberId = null, branchId = null) {
  const info = {
    method: CONFIG.authMethod,
    configured: false,
    cachedBranches: tokenCaches.size
  };

  // If specific branch requested, include its cache info
  if (memberId && branchId) {
    const tokenCache = getTokenCacheForBranch(memberId, branchId);
    info.branchKey = `${memberId}:${branchId}`;
    info.tokenCached = !!tokenCache.token;
    info.tokenExpiry = tokenCache.expiresAt ? new Date(tokenCache.expiresAt).toISOString() : null;
    info.tokenValid = isTokenValid(tokenCache);
  }

  switch (CONFIG.authMethod.toLowerCase()) {
    case 'api-key':
      info.configured = !!CONFIG.apiKey;
      break;

    case 'oauth2':
      info.configured = !!(CONFIG.clientId && CONFIG.clientSecret);
      info.authUrl = CONFIG.authUrl;
      info.clientIdSet = !!CONFIG.clientId;
      info.clientSecretSet = !!CONFIG.clientSecret;
      break;
  }

  context?.log('Salesforce auth info:', info);

  return info;
}

/**
 * Test authentication by making a simple request
 */
async function testAuthentication(baseUrl, context) {
  context?.log('Testing Salesforce authentication...');

  try {
    const authHeader = await getSalesforceAuthHeader(context);

    // Try to call health endpoint or any simple endpoint
    const testUrl = `${baseUrl}/health`;

    const response = await axios.get(testUrl, {
      headers: authHeader,
      timeout: 10000
    });

    context?.log('Authentication test successful', {
      status: response.status,
      method: CONFIG.authMethod
    });

    return {
      success: true,
      method: CONFIG.authMethod,
      status: response.status
    };

  } catch (error) {
    context?.error('Authentication test failed', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    return {
      success: false,
      method: CONFIG.authMethod,
      error: error.message,
      status: error.response?.status
    };
  }
}

/**
 * Health check for authentication system
 */
async function healthCheck(context, memberId = null, branchId = null) {
  const info = getAuthInfo(context, memberId, branchId);

  const health = {
    status: 'healthy',
    method: CONFIG.authMethod,
    configured: info.configured,
    cachedBranches: info.cachedBranches,
    issues: []
  };

  // Check configuration
  if (!info.configured) {
    health.status = 'unhealthy';
    health.issues.push('Authentication not properly configured');
  }

  // Check token cache for specific branch (for OAuth2)
  if (CONFIG.authMethod.toLowerCase() === 'oauth2' && memberId && branchId) {
    if (!info.tokenCached) {
      health.status = 'warning';
      health.issues.push(`No OAuth2 token cached for ${memberId}:${branchId} (will be fetched on first request)`);
    } else if (!info.tokenValid) {
      health.status = 'warning';
      health.issues.push(`Cached OAuth2 token for ${memberId}:${branchId} is expired or expiring soon`);
    }
  }

  context?.log('Salesforce auth health check:', health);

  return health;
}

// Export functions
module.exports = {
  // Main authentication function
  getSalesforceAuthHeader,

  // Utility functions
  forceTokenRefresh,
  clearTokenCache,
  getAuthInfo,
  testAuthentication,
  healthCheck,

  // For testing
  isTokenValid,
  _getTokenCache: (memberId, branchId) => getTokenCacheForBranch(memberId, branchId), // Expose branch-specific cache for testing
  _getAllCaches: () => tokenCaches, // Expose all caches for testing
  _resetCache: (memberId = null, branchId = null) => {
    if (memberId && branchId) {
      // Reset specific branch cache
      const tokenCache = getTokenCacheForBranch(memberId, branchId);
      tokenCache.token = null;
      tokenCache.expiresAt = null;
      tokenCache.isRefreshing = false;
      tokenCache.refreshPromise = null;
    } else {
      // Reset all caches
      tokenCaches.clear();
    }
  }
};
