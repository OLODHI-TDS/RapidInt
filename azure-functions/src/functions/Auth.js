/**
 * Azure AD OAuth2 Authentication Endpoint
 *
 * Handles Microsoft SSO authentication flow:
 * 1. /api/auth/login - Redirects user to Microsoft login page
 * 2. /api/auth/callback - Handles redirect from Azure AD, exchanges code for token
 * 3. /api/auth/me - Returns current user info
 * 4. /api/auth/logout - Logs out user
 *
 * This endpoint is required for the test bench and any other front-end applications
 * that need to authenticate users with Microsoft SSO.
 */

const { app } = require('@azure/functions');
const {
  getAuthorizationUrl,
  acquireTokenByCode,
  getAuthenticatedUser,
  isDevelopmentMode,
  MOCK_USER
} = require('../../shared-services/shared/auth-middleware');

/**
 * GET /api/auth/login
 * Initiates OAuth2 login flow - redirects to Microsoft login page
 */
app.http('authLogin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: async (request, context) => {
    context.log('[AUTH] Login request received');

    try {
      // Development mode: Return mock user token
      if (isDevelopmentMode()) {
        context.log('[AUTH] Development mode - using mock authentication');

        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'Development mode - mock user authenticated',
            user: MOCK_USER,
            // In development, we'll use a simple mock token
            accessToken: 'dev-mock-token-' + Date.now()
          })
        };
      }

      // Production: Redirect to Azure AD login page
      const state = Math.random().toString(36).substring(7); // CSRF protection
      const authUrl = await getAuthorizationUrl(state);

      context.log('[AUTH] Redirecting to Azure AD login:', authUrl);

      return {
        status: 302,
        headers: {
          'Location': authUrl,
          'Set-Cookie': `auth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600` // 10 minutes
        },
        body: ''
      };

    } catch (error) {
      context.error('[AUTH] Login flow error:', error.message);

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Authentication initialization failed',
          message: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});

/**
 * GET /api/auth/callback
 * OAuth2 callback handler - exchanges authorization code for access token
 */
app.http('authCallback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/callback',
  handler: async (request, context) => {
    context.log('[AUTH] OAuth2 callback received');

    try {
      // Get authorization code from query string
      const code = request.query.get('code');
      const state = request.query.get('state');
      const error = request.query.get('error');
      const errorDescription = request.query.get('error_description');

      // Check for OAuth2 errors
      if (error) {
        context.error('[AUTH] OAuth2 error:', error, errorDescription);

        return {
          status: 400,
          headers: { 'Content-Type': 'text/html' },
          body: `
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
              <h1>Authentication Failed</h1>
              <p><strong>Error:</strong> ${error}</p>
              <p><strong>Description:</strong> ${errorDescription || 'Unknown error'}</p>
              <p><a href="/tools/test-bench.html">Return to Test Bench</a></p>
            </body>
            </html>
          `
        };
      }

      if (!code) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Missing authorization code',
            timestamp: new Date().toISOString()
          })
        };
      }

      // TODO: Verify state parameter for CSRF protection
      // const cookieState = extractStateFromCookie(request);
      // if (state !== cookieState) { throw new Error('State mismatch - CSRF attack?'); }

      // Exchange authorization code for access token
      context.log('[AUTH] Exchanging authorization code for access token');
      const tokenResponse = await acquireTokenByCode(code);

      context.log('[AUTH] Token acquired successfully');
      context.log('[AUTH] User:', tokenResponse.account.username);

      // Return HTML page that stores token in localStorage and redirects back
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
              }
              .container {
                text-align: center;
                background: rgba(255, 255, 255, 0.1);
                padding: 40px;
                border-radius: 10px;
                backdrop-filter: blur(10px);
              }
              .spinner {
                border: 4px solid rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                border-top: 4px solid white;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Authentication Successful</h1>
              <div class="spinner"></div>
              <p>Redirecting back to Test Bench...</p>
            </div>
            <script>
              // Store authentication info in localStorage
              const authData = {
                accessToken: ${JSON.stringify(tokenResponse.accessToken)},
                expiresOn: ${JSON.stringify(tokenResponse.expiresOn)},
                account: {
                  username: ${JSON.stringify(tokenResponse.account.username)},
                  name: ${JSON.stringify(tokenResponse.account.name)},
                  localAccountId: ${JSON.stringify(tokenResponse.account.localAccountId)}
                },
                timestamp: new Date().toISOString()
              };

              localStorage.setItem('alto_auth', JSON.stringify(authData));

              // Redirect back to test bench after 1 second
              setTimeout(() => {
                window.location.href = '/tools/test-bench.html';
              }, 1000);
            </script>
          </body>
          </html>
        `
      };

    } catch (error) {
      context.error('[AUTH] Callback error:', error.message);

      return {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>Authentication Error</title></head>
          <body>
            <h1>Authentication Failed</h1>
            <p><strong>Error:</strong> ${error.message}</p>
            <p><a href="/api/auth/login">Try Again</a></p>
            <p><a href="/tools/test-bench.html">Return to Test Bench</a></p>
          </body>
          </html>
        `
      };
    }
  }
});

/**
 * GET /api/auth/me
 * Returns current user information (requires valid access token)
 */
app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: async (request, context) => {
    context.log('[AUTH] User info request');

    try {
      // Get authenticated user from token
      const userContext = await getAuthenticatedUser(request, context);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          user: userContext,
          timestamp: new Date().toISOString()
        })
      };

    } catch (error) {
      context.error('[AUTH] User info error:', error.message);

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
});

/**
 * POST /api/auth/logout
 * Logs out current user
 */
app.http('authLogout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: async (request, context) => {
    context.log('[AUTH] Logout request');

    try {
      // In a full implementation, you'd invalidate the token server-side
      // For now, client-side will clear localStorage

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Logged out successfully',
          timestamp: new Date().toISOString()
        })
      };

    } catch (error) {
      context.error('[AUTH] Logout error:', error.message);

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Logout failed',
          message: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});
