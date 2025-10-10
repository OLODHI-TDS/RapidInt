/**
 * Unit Tests for Salesforce Authentication Module
 *
 * Tests:
 * - API key header building
 * - OAuth2 token caching
 * - Token expiry and refresh
 * - Azure identity credentials mocking
 */

const axios = require('axios');
const salesforceAuth = require('../salesforce-auth');

// Mock axios
jest.mock('axios');

describe('Salesforce Authentication Module', () => {
  let mockContext;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Mock context
    mockContext = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    // Reset token cache before each test
    salesforceAuth._resetCache();

    // Clear axios mock
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    salesforceAuth.clearTokenCache();
  });

  describe('API Key Authentication', () => {
    beforeEach(() => {
      process.env.SALESFORCE_AUTH_METHOD = 'api-key';
    });

    test('should build AccessToken from organization credentials', async () => {
      const orgCredentials = {
        memberId: 'MEM123',
        branchId: 'BR456',
        apiKey: 'test-api-key-789',
        region: 'EW',
        schemeType: 'Custodial'
      };

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext, orgCredentials);

      expect(header).toHaveProperty('AccessToken');
      expect(header.AccessToken).toBe('England & Wales Custodial-Custodial-MEM123-BR456-test-api-key-789');
      expect(mockContext.log).toHaveBeenCalled();
    });

    test('should handle Scotland region', async () => {
      const orgCredentials = {
        memberId: 'MEM123',
        branchId: 'BR456',
        apiKey: 'test-api-key',
        region: 'Scotland',
        schemeType: 'Custodial'
      };

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext, orgCredentials);

      expect(header.AccessToken).toContain('Scotland Custodial');
    });

    test('should handle Northern Ireland region', async () => {
      const orgCredentials = {
        memberId: 'MEM123',
        branchId: 'BR456',
        apiKey: 'test-api-key',
        region: 'NI',
        schemeType: 'Custodial'
      };

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext, orgCredentials);

      expect(header.AccessToken).toContain('Northern Ireland Custodial');
    });

    test('should default to England & Wales for unknown region', async () => {
      const orgCredentials = {
        memberId: 'MEM123',
        branchId: 'BR456',
        apiKey: 'test-api-key',
        region: 'Unknown',
        schemeType: 'Custodial'
      };

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext, orgCredentials);

      expect(header.AccessToken).toContain('England & Wales Custodial');
    });

    test('should use environment variable when no org credentials provided', async () => {
      process.env.SALESFORCE_API_KEY = 'env-api-key';

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext);

      expect(header.AccessToken).toBe('env-api-key');
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('environment variable'));
    });

    test('should throw error when missing required credentials', async () => {
      const invalidCredentials = {
        memberId: 'MEM123',
        branchId: null,
        apiKey: 'test-api-key'
      };

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext, invalidCredentials)
      ).rejects.toThrow('Organization credentials missing required fields');
    });

    test('should throw error when no credentials available', async () => {
      delete process.env.SALESFORCE_API_KEY;

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ).rejects.toThrow('SALESFORCE_API_KEY environment variable is not set');
    });
  });

  describe('OAuth2 Authentication', () => {
    beforeEach(() => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';
      process.env.SALESFORCE_AUTH_URL = 'https://test.salesforce.com/oauth2/token';
    });

    test('should fetch OAuth2 token on first request', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-access-token',
          expires_in: 300
        }
      });

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext);

      expect(header).toHaveProperty('Authorization');
      expect(header.Authorization).toBe('Bearer test-access-token');
      expect(axios.post).toHaveBeenCalledWith(
        'https://test.salesforce.com/oauth2/token',
        'grant_type=client_credentials',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': expect.stringMatching(/^Basic /)
          })
        })
      );
    });

    test('should cache OAuth2 token', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'cached-token',
          expires_in: 300
        }
      });

      // First request
      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      // Second request
      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      // Should only call API once
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('cached'));
    });

    test('should refresh token when expired', async () => {
      // First token
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'first-token',
          expires_in: 0 // Expires immediately
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second token
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'second-token',
          expires_in: 300
        }
      });

      const header = await salesforceAuth.getSalesforceAuthHeader(mockContext);

      expect(header.Authorization).toBe('Bearer second-token');
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    test('should refresh token before expiry (buffer)', async () => {
      process.env.SALESFORCE_TOKEN_EXPIRY_SECONDS = '60'; // 60 seconds

      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-token',
          expires_in: 60
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      // Check that token is marked as expiring soon
      const cache = salesforceAuth._getTokenCache();
      const timeUntilExpiry = cache.expiresAt - Date.now();

      // Should expire in ~60 seconds
      expect(timeUntilExpiry).toBeLessThanOrEqual(60000);
      expect(timeUntilExpiry).toBeGreaterThan(50000);
    });

    test('should handle concurrent refresh requests', async () => {
      axios.post.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              data: {
                access_token: 'concurrent-token',
                expires_in: 300
              }
            });
          }, 100);
        });
      });

      // Make multiple concurrent requests
      const promises = [
        salesforceAuth.getSalesforceAuthHeader(mockContext),
        salesforceAuth.getSalesforceAuthHeader(mockContext),
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ];

      await Promise.all(promises);

      // Should only call API once
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('should use default expiry when not provided in response', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-token'
          // No expires_in
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      const cache = salesforceAuth._getTokenCache();
      const timeUntilExpiry = cache.expiresAt - Date.now();

      // Should use default 300 seconds (5 minutes)
      expect(timeUntilExpiry).toBeLessThanOrEqual(300000);
      expect(timeUntilExpiry).toBeGreaterThan(290000);
    });

    test('should throw error when OAuth2 request fails', async () => {
      axios.post.mockRejectedValue({
        message: 'Network error',
        response: {
          status: 500,
          data: { error: 'Internal server error' }
        }
      });

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ).rejects.toThrow('Salesforce OAuth2 authentication failed');

      expect(mockContext.error).toHaveBeenCalled();
    });

    test('should throw error when access token missing in response', async () => {
      axios.post.mockResolvedValue({
        data: {
          // No access_token
          expires_in: 300
        }
      });

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ).rejects.toThrow('No access_token in OAuth2 response');
    });

    test('should throw error when client credentials not configured', async () => {
      delete process.env.SALESFORCE_CLIENT_ID;
      delete process.env.SALESFORCE_CLIENT_SECRET;

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ).rejects.toThrow('SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set');
    });

    test('should encode client credentials in base64', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-token',
          expires_in: 300
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      const expectedCredentials = Buffer.from('test-client-id:test-client-secret').toString('base64');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Basic ${expectedCredentials}`
          })
        })
      );
    });
  });

  describe('Token Cache Management', () => {
    beforeEach(() => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';
    });

    test('should check if token is valid', () => {
      const cache = salesforceAuth._getTokenCache();
      cache.token = 'test-token';
      cache.expiresAt = Date.now() + 300000; // 5 minutes from now

      expect(salesforceAuth.isTokenValid()).toBe(true);
    });

    test('should return false for expired token', () => {
      const cache = salesforceAuth._getTokenCache();
      cache.token = 'test-token';
      cache.expiresAt = Date.now() - 1000; // 1 second ago

      expect(salesforceAuth.isTokenValid()).toBe(false);
    });

    test('should return false for token expiring within buffer', () => {
      const cache = salesforceAuth._getTokenCache();
      cache.token = 'test-token';
      cache.expiresAt = Date.now() + 30000; // 30 seconds from now (within 60s buffer)

      expect(salesforceAuth.isTokenValid()).toBe(false);
    });

    test('should clear token cache', () => {
      const cache = salesforceAuth._getTokenCache();
      cache.token = 'test-token';
      cache.expiresAt = Date.now() + 300000;

      salesforceAuth.clearTokenCache(mockContext);

      expect(cache.token).toBeNull();
      expect(cache.expiresAt).toBeNull();
      expect(mockContext.log).toHaveBeenCalled();
    });

    test('should force token refresh', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'refreshed-token',
          expires_in: 300
        }
      });

      await salesforceAuth.forceTokenRefresh(mockContext);

      expect(axios.post).toHaveBeenCalled();
      const cache = salesforceAuth._getTokenCache();
      expect(cache.token).toBe('refreshed-token');
    });

    test('should not force refresh for non-OAuth2 methods', async () => {
      process.env.SALESFORCE_AUTH_METHOD = 'api-key';

      await salesforceAuth.forceTokenRefresh(mockContext);

      expect(axios.post).not.toHaveBeenCalled();
      expect(mockContext.warn).toHaveBeenCalled();
    });
  });

  describe('Configuration and Info', () => {
    test('should get auth info for API key method', () => {
      process.env.SALESFORCE_AUTH_METHOD = 'api-key';
      process.env.SALESFORCE_API_KEY = 'test-key';

      const info = salesforceAuth.getAuthInfo(mockContext);

      expect(info.method).toBe('api-key');
      expect(info.configured).toBe(true);
      expect(info.tokenCached).toBe(false);
    });

    test('should get auth info for OAuth2 method', () => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';

      const info = salesforceAuth.getAuthInfo(mockContext);

      expect(info.method).toBe('oauth2');
      expect(info.configured).toBe(true);
      expect(info.clientIdSet).toBe(true);
      expect(info.clientSecretSet).toBe(true);
    });

    test('should indicate when OAuth2 is not configured', () => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      delete process.env.SALESFORCE_CLIENT_ID;

      const info = salesforceAuth.getAuthInfo(mockContext);

      expect(info.configured).toBe(false);
    });

    test('should perform health check - healthy', async () => {
      process.env.SALESFORCE_AUTH_METHOD = 'api-key';
      process.env.SALESFORCE_API_KEY = 'test-key';

      const health = await salesforceAuth.healthCheck(mockContext);

      expect(health.status).toBe('healthy');
      expect(health.method).toBe('api-key');
      expect(health.configured).toBe(true);
      expect(health.issues).toHaveLength(0);
    });

    test('should perform health check - unhealthy', async () => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      delete process.env.SALESFORCE_CLIENT_ID;

      const health = await salesforceAuth.healthCheck(mockContext);

      expect(health.status).toBe('unhealthy');
      expect(health.configured).toBe(false);
      expect(health.issues).toContain('Authentication not properly configured');
    });

    test('should perform health check - warning for expired token', async () => {
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';

      const cache = salesforceAuth._getTokenCache();
      cache.token = 'expired-token';
      cache.expiresAt = Date.now() - 1000;

      const health = await salesforceAuth.healthCheck(mockContext);

      expect(health.status).toBe('warning');
      expect(health.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Test Authentication', () => {
    beforeEach(() => {
      process.env.SALESFORCE_AUTH_METHOD = 'api-key';
      process.env.SALESFORCE_API_KEY = 'test-key';
    });

    test('should test authentication successfully', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: { status: 'healthy' }
      });

      const result = await salesforceAuth.testAuthentication('https://test.salesforce.com', mockContext);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.method).toBe('api-key');
      expect(axios.get).toHaveBeenCalledWith(
        'https://test.salesforce.com/health',
        expect.objectContaining({
          headers: expect.objectContaining({ AccessToken: 'test-key' })
        })
      );
    });

    test('should handle authentication test failure', async () => {
      axios.get.mockRejectedValue({
        message: 'Unauthorized',
        response: {
          status: 401,
          data: { error: 'Invalid credentials' }
        }
      });

      const result = await salesforceAuth.testAuthentication('https://test.salesforce.com', mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
      expect(result.status).toBe(401);
      expect(mockContext.error).toHaveBeenCalled();
    });
  });

  describe('Unsupported Auth Method', () => {
    test('should throw error for unsupported auth method', async () => {
      process.env.SALESFORCE_AUTH_METHOD = 'unsupported-method';

      await expect(
        salesforceAuth.getSalesforceAuthHeader(mockContext)
      ).rejects.toThrow('Unsupported Salesforce auth method: unsupported-method');
    });
  });

  describe('Default Values', () => {
    test('should use oauth2 as default auth method', async () => {
      delete process.env.SALESFORCE_AUTH_METHOD;
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';

      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-token',
          expires_in: 300
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      expect(axios.post).toHaveBeenCalled();
    });

    test('should use default auth URL', async () => {
      delete process.env.SALESFORCE_AUTH_URL;
      process.env.SALESFORCE_AUTH_METHOD = 'oauth2';
      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.SALESFORCE_CLIENT_SECRET = 'test-client-secret';

      axios.post.mockResolvedValue({
        data: {
          access_token: 'test-token',
          expires_in: 300
        }
      });

      await salesforceAuth.getSalesforceAuthHeader(mockContext);

      expect(axios.post).toHaveBeenCalledWith(
        'https://login.salesforce.com/services/oauth2/token',
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});
