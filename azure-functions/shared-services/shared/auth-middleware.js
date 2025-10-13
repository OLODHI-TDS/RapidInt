/**
 * Azure AD Authentication Middleware
 *
 * Provides Microsoft SSO authentication and authorization for Azure Functions.
 * Supports both development (mock user) and production (Azure AD JWT validation).
 *
 * Key Features:
 * - JWT token validation with Azure AD
 * - User context extraction (email, name, roles)
 * - Role-based access control
 * - Audit logging for authentication events
 * - Development mode with mock user
 *
 * Environment Variables Required:
 * - AZURE_AD_TENANT_ID: Your Azure AD tenant ID
 * - AZURE_AD_CLIENT_ID: App registration client ID
 * - AZURE_AD_CLIENT_SECRET: App registration client secret (optional for token validation)
 * - NODE_ENV: Set to 'development' for mock auth, 'production' for real Azure AD
 */

const msal = require('@azure/msal-node');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Azure AD configuration
const AZURE_AD_CONFIG = {
  tenantId: process.env.AZURE_AD_TENANT_ID,
  clientId: process.env.AZURE_AD_CLIENT_ID,
  clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
  authority: process.env.AZURE_AD_TENANT_ID
    ? `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`
    : null,
  redirectUri: process.env.AZURE_AD_REDIRECT_URI || 'http://localhost:7071/api/auth/callback',
  scopes: ['User.Read', 'email', 'profile', 'openid']
};

// JWKS client for token validation (caches public keys from Azure AD)
let jwksClientInstance = null;
if (AZURE_AD_CONFIG.tenantId) {
  jwksClientInstance = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${AZURE_AD_CONFIG.tenantId}/discovery/v2.0/keys`,
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
    rateLimit: true
  });
}

// MSAL Confidential Client (for auth code flow)
let msalClient = null;
if (AZURE_AD_CONFIG.tenantId && AZURE_AD_CONFIG.clientId) {
  const msalConfig = {
    auth: {
      clientId: AZURE_AD_CONFIG.clientId,
      authority: AZURE_AD_CONFIG.authority,
      clientSecret: AZURE_AD_CONFIG.clientSecret
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          console.log(`[MSAL ${level}]: ${message}`);
        },
        piiLoggingEnabled: false,
        logLevel: process.env.NODE_ENV === 'development' ? msal.LogLevel.Verbose : msal.LogLevel.Warning
      }
    }
  };

  msalClient = new msal.ConfidentialClientApplication(msalConfig);
}

/**
 * Development mode mock user
 * Used when NODE_ENV=development or Azure AD not configured
 */
const MOCK_USER = {
  email: 'dev@tds.co.uk',
  name: 'Development User',
  roles: ['admin', 'support'],
  authenticated: true,
  authMethod: 'mock',
  sub: 'dev-user-id',
  tid: 'dev-tenant-id'
};

/**
 * Check if we're in development mode
 */
function isDevelopmentMode() {
  return process.env.NODE_ENV === 'development' || !AZURE_AD_CONFIG.tenantId;
}

/**
 * Get signing key from Azure AD JWKS endpoint
 * Used for JWT token validation
 */
function getSigningKey(header, callback) {
  if (!jwksClientInstance) {
    return callback(new Error('JWKS client not initialized - Azure AD not configured'));
  }

  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Validate Azure AD JWT token
 *
 * @param {string} token - JWT token from Authorization header
 * @returns {Promise<Object>} - Decoded token payload
 * @throws {Error} - If token is invalid
 */
async function validateToken(token) {
  return new Promise((resolve, reject) => {
    // Verify token signature with Azure AD public key
    jwt.verify(token, getSigningKey, {
      audience: AZURE_AD_CONFIG.clientId, // Token must be issued for our app
      issuer: `https://login.microsoftonline.com/${AZURE_AD_CONFIG.tenantId}/v2.0`, // Token must come from our tenant
      algorithms: ['RS256'] // Azure AD uses RS256
    }, (err, decoded) => {
      if (err) {
        reject(new Error(`Token validation failed: ${err.message}`));
      } else {
        resolve(decoded);
      }
    });
  });
}

/**
 * Extract user context from Azure AD token
 * Maps Azure AD claims to our user context format
 *
 * @param {Object} decodedToken - Decoded JWT token from Azure AD
 * @returns {Object} - User context object
 */
function extractUserContext(decodedToken) {
  // Extract roles from token claims
  // Azure AD can store roles in 'roles' or 'groups' claim
  const roles = decodedToken.roles || [];

  // Default to 'viewer' role if no roles assigned
  if (roles.length === 0) {
    roles.push('viewer');
  }

  return {
    email: decodedToken.preferred_username || decodedToken.email || decodedToken.upn,
    name: decodedToken.name || decodedToken.preferred_username,
    roles: roles,
    authenticated: true,
    authMethod: 'azure-ad',
    sub: decodedToken.sub, // Subject (unique user ID)
    tid: decodedToken.tid, // Tenant ID
    oid: decodedToken.oid  // Object ID (user's Azure AD object ID)
  };
}

/**
 * Get authenticated user from HTTP request
 * Validates token and returns user context
 *
 * @param {Object} req - HTTP request object (or Azure Function context.req)
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - User context object
 * @throws {Error} - If authentication fails
 */
async function getAuthenticatedUser(req, context = null) {
  // Development mode: Return mock user
  if (isDevelopmentMode()) {
    context?.log('[AUTH] Development mode - using mock user');
    return MOCK_USER;
  }

  // Extract token from Authorization header
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new Error('Empty authorization token');
  }

  try {
    // Validate token with Azure AD
    const decodedToken = await validateToken(token);

    // Extract user context
    const userContext = extractUserContext(decodedToken);

    context?.log(`[AUTH] User authenticated: ${userContext.email} (roles: ${userContext.roles.join(', ')})`);

    return userContext;

  } catch (error) {
    context?.error('[AUTH] Token validation failed:', error.message);
    throw new Error('Invalid or expired authentication token');
  }
}

/**
 * Check if user has required role
 *
 * @param {Object} userContext - User context from getAuthenticatedUser()
 * @param {string|Array<string>} requiredRoles - Required role(s) (e.g., 'admin' or ['admin', 'support'])
 * @returns {boolean} - True if user has at least one required role
 */
function hasRole(userContext, requiredRoles) {
  if (!userContext || !userContext.authenticated) {
    return false;
  }

  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return roles.some(role => userContext.roles.includes(role));
}

/**
 * Require authentication for Azure Function endpoint
 * Returns 401 if not authenticated
 *
 * @param {Object} req - HTTP request
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object|null>} - User context if authenticated, or HTTP 401 response
 */
async function requireAuth(req, context) {
  try {
    const userContext = await getAuthenticatedUser(req, context);
    return userContext;
  } catch (error) {
    context.error('[AUTH] Authentication failed:', error.message);

    // Return 401 Unauthorized response
    return {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Authentication required',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}

/**
 * Require specific role for Azure Function endpoint
 * Returns 401 if not authenticated, 403 if insufficient permissions
 *
 * @param {Object} req - HTTP request
 * @param {Object} context - Azure Function context
 * @param {string|Array<string>} requiredRoles - Required role(s)
 * @returns {Promise<Object|null>} - User context if authorized, or HTTP error response
 */
async function requireRole(req, context, requiredRoles) {
  try {
    const userContext = await getAuthenticatedUser(req, context);

    if (!hasRole(userContext, requiredRoles)) {
      const rolesStr = Array.isArray(requiredRoles) ? requiredRoles.join(', ') : requiredRoles;
      context.warn(`[AUTH] Insufficient permissions: ${userContext.email} lacks required role(s): ${rolesStr}`);

      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Insufficient permissions',
          message: `Required role(s): ${rolesStr}`,
          timestamp: new Date().toISOString()
        })
      };
    }

    return userContext;

  } catch (error) {
    context.error('[AUTH] Authentication failed:', error.message);

    return {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Authentication required',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}

/**
 * Generate Azure AD authorization URL
 * Used for initiating SSO login flow
 *
 * @param {string} state - Optional state parameter for CSRF protection
 * @returns {Promise<string>} - Authorization URL to redirect user to
 */
async function getAuthorizationUrl(state = null) {
  if (!msalClient) {
    throw new Error('MSAL client not initialized - Azure AD not configured');
  }

  const authCodeUrlParameters = {
    scopes: AZURE_AD_CONFIG.scopes,
    redirectUri: AZURE_AD_CONFIG.redirectUri,
    state: state || Math.random().toString(36).substring(7)
  };

  const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParameters);
  return authUrl;
}

/**
 * Exchange authorization code for access token
 * Used in OAuth2 callback handler
 *
 * @param {string} code - Authorization code from Azure AD
 * @returns {Promise<Object>} - Token response with access token
 */
async function acquireTokenByCode(code) {
  if (!msalClient) {
    throw new Error('MSAL client not initialized - Azure AD not configured');
  }

  const tokenRequest = {
    code: code,
    scopes: AZURE_AD_CONFIG.scopes,
    redirectUri: AZURE_AD_CONFIG.redirectUri
  };

  const response = await msalClient.acquireTokenByCode(tokenRequest);
  return response;
}

/**
 * Audit log for authentication events
 * Logs who accessed what and when (GDPR Article 30 compliance)
 *
 * @param {string} event - Event type (e.g., 'login', 'logout', 'access_denied')
 * @param {Object} userContext - User context
 * @param {Object} details - Additional details
 * @param {Object} context - Azure Function context (for logging)
 */
function auditLog(event, userContext, details = {}, context = null) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    event: event,
    user: userContext?.email || 'unknown',
    authenticated: userContext?.authenticated || false,
    authMethod: userContext?.authMethod || 'none',
    roles: userContext?.roles || [],
    details: details
  };

  context?.log(`[AUDIT] ${JSON.stringify(auditEntry)}`);

  // TODO: Store in dedicated audit log table for compliance
  // await auditLogger.record(auditEntry);
}

module.exports = {
  // Core authentication functions
  getAuthenticatedUser,
  requireAuth,
  requireRole,
  hasRole,

  // OAuth2 flow helpers
  getAuthorizationUrl,
  acquireTokenByCode,

  // Utility functions
  isDevelopmentMode,
  auditLog,

  // Constants
  AZURE_AD_CONFIG,
  MOCK_USER
};
