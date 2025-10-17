/**
 * Microsoft Entra ID Authentication Middleware
 *
 * Validates JWT tokens issued by Microsoft Entra ID (Azure AD)
 * Supports role-based access control (RBAC)
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// JWKS client for token validation (cached for performance)
let jwksClientInstance = null;

/**
 * Get or create JWKS client
 */
function getJwksClient() {
    if (!jwksClientInstance) {
        const tenantId = process.env.ENTRA_TENANT_ID;

        if (!tenantId) {
            throw new Error('ENTRA_TENANT_ID environment variable not set');
        }

        jwksClientInstance = jwksClient({
            jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
            cache: true,
            cacheMaxAge: 86400000, // 24 hours
            rateLimit: true,
            jwksRequestsPerMinute: 10
        });
    }

    return jwksClientInstance;
}

/**
 * Get signing key from JWKS
 */
function getKey(header, callback) {
    try {
        const client = getJwksClient();

        client.getSigningKey(header.kid, (err, key) => {
            if (err) {
                callback(err);
                return;
            }

            const signingKey = key.publicKey || key.rsaPublicKey;
            callback(null, signingKey);
        });
    } catch (error) {
        callback(error);
    }
}

/**
 * Validate Microsoft Entra ID access token
 *
 * @param {Object} request - Azure Function HTTP request
 * @param {Object} context - Azure Function context (for logging)
 * @returns {Promise<Object>} - Validation result with user info
 */
async function validateEntraToken(request, context) {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        context?.log('❌ No bearer token provided in Authorization header');
        return {
            isValid: false,
            error: 'No bearer token provided',
            errorCode: 'NO_TOKEN'
        };
    }

    const token = authHeader.substring(7);

    // Validate required environment variables
    const requiredEnvVars = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_AUDIENCE'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        context?.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
        return {
            isValid: false,
            error: `Server configuration error: Missing ${missingVars.join(', ')}`,
            errorCode: 'CONFIG_ERROR'
        };
    }

    const tenantId = process.env.ENTRA_TENANT_ID;
    const clientId = process.env.ENTRA_CLIENT_ID;
    const audience = process.env.ENTRA_AUDIENCE;

    return new Promise((resolve) => {
        jwt.verify(token, getKey, {
            audience: audience,
            issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
            algorithms: ['RS256']
        }, (err, decoded) => {
            if (err) {
                context?.log('❌ Token validation failed:', err.message);

                // Categorize error types for better debugging
                let errorCode = 'VALIDATION_ERROR';
                if (err.name === 'TokenExpiredError') {
                    errorCode = 'TOKEN_EXPIRED';
                } else if (err.name === 'JsonWebTokenError') {
                    errorCode = 'INVALID_TOKEN';
                } else if (err.name === 'NotBeforeError') {
                    errorCode = 'TOKEN_NOT_ACTIVE';
                }

                resolve({
                    isValid: false,
                    error: err.message,
                    errorCode: errorCode,
                    errorName: err.name
                });
            } else {
                context?.log('✅ Token validated successfully for user:', decoded.preferred_username || decoded.upn || decoded.sub);

                resolve({
                    isValid: true,
                    user: {
                        id: decoded.sub,
                        email: decoded.preferred_username || decoded.upn || decoded.email,
                        name: decoded.name,
                        roles: decoded.roles || [],
                        oid: decoded.oid, // Object ID in Entra ID
                        tid: decoded.tid  // Tenant ID
                    },
                    token: decoded
                });
            }
        });
    });
}

/**
 * Check if user has required role
 *
 * @param {Object} user - User object from validateEntraToken
 * @param {string|string[]} requiredRole - Required role(s)
 * @returns {boolean} - True if user has the role
 */
function hasRole(user, requiredRole) {
    if (!user || !user.roles) {
        return false;
    }

    if (Array.isArray(requiredRole)) {
        // User needs at least one of the required roles
        return requiredRole.some(role => user.roles.includes(role));
    }

    return user.roles.includes(requiredRole);
}

/**
 * Check if user has ALL required roles
 *
 * @param {Object} user - User object from validateEntraToken
 * @param {string[]} requiredRoles - Array of required roles
 * @returns {boolean} - True if user has all roles
 */
function hasAllRoles(user, requiredRoles) {
    if (!user || !user.roles || !Array.isArray(requiredRoles)) {
        return false;
    }

    return requiredRoles.every(role => user.roles.includes(role));
}

/**
 * Middleware wrapper for Azure Functions
 * Returns 401 if token is invalid
 *
 * @param {Function} handler - The actual function handler
 * @param {Object} options - Middleware options
 * @param {string|string[]} options.requiredRole - Required role(s) for access
 * @param {boolean} options.requireAllRoles - If true, user must have all roles (default: false)
 * @returns {Function} - Wrapped handler
 */
function withEntraAuth(handler, options = {}) {
    return async (request, context) => {
        // Validate token
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

        // Check role requirements if specified
        if (options.requiredRole) {
            const hasRequiredRole = options.requireAllRoles
                ? hasAllRoles(authResult.user, options.requiredRole)
                : hasRole(authResult.user, options.requiredRole);

            if (!hasRequiredRole) {
                context?.log(`❌ User ${authResult.user.email} lacks required role(s):`, options.requiredRole);

                return {
                    status: 403,
                    jsonBody: {
                        error: 'Forbidden',
                        message: 'Insufficient permissions',
                        requiredRole: options.requiredRole
                    }
                };
            }
        }

        // Add user info to request for use in handler
        request.user = authResult.user;
        request.token = authResult.token;

        // Call the actual handler
        return await handler(request, context);
    };
}

/**
 * Health check for Entra ID authentication
 * Verifies configuration without validating a token
 */
function getAuthConfig() {
    const tenantId = process.env.ENTRA_TENANT_ID;
    const clientId = process.env.ENTRA_CLIENT_ID;
    const audience = process.env.ENTRA_AUDIENCE;

    return {
        configured: !!(tenantId && clientId && audience),
        tenantId: tenantId ? `${tenantId.substring(0, 8)}...` : 'NOT_SET',
        clientId: clientId ? `${clientId.substring(0, 8)}...` : 'NOT_SET',
        audience: audience || 'NOT_SET',
        issuer: tenantId ? `https://login.microsoftonline.com/${tenantId}/v2.0` : 'NOT_SET'
    };
}

module.exports = {
    // Main validation function
    validateEntraToken,

    // Role checking functions
    hasRole,
    hasAllRoles,

    // Middleware wrapper
    withEntraAuth,

    // Configuration
    getAuthConfig
};
