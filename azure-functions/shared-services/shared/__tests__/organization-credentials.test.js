/**
 * Unit Tests for Organization Credentials Module
 *
 * Tests:
 * - Database query and caching
 * - Encryption/decryption
 * - Azure Key Vault integration mocking
 * - Connection pooling
 */

const orgCredentials = require('../organization-credentials');

// Mock dependencies
jest.mock('mssql');
jest.mock('@azure/identity');
jest.mock('@azure/keyvault-secrets');

const mssql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

describe('Organization Credentials Module', () => {
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

    // Clear caches
    orgCredentials.clearCredentialCache();
    orgCredentials.clearEncryptionKeyCache();

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('Encryption/Decryption', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_SECRET = 'test-encryption-secret-key-12345';
      process.env.USE_KEY_VAULT = 'false';
    });

    test('should encrypt and decrypt API key', async () => {
      const plainApiKey = 'my-secret-api-key-123';

      const encrypted = await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      expect(encrypted).toContain(':');
      const [iv, encryptedValue] = encrypted.split(':');
      expect(iv).toHaveLength(32); // 16 bytes in hex
      expect(encryptedValue).toBeTruthy();

      const decrypted = await orgCredentials.decryptApiKey(encrypted, mockContext);

      expect(decrypted).toBe(plainApiKey);
    });

    test('should handle different API key values', async () => {
      const testKeys = [
        'simple-key',
        'key-with-special-chars-!@#$%',
        'very-long-api-key-with-many-characters-0123456789',
        '12345'
      ];

      for (const key of testKeys) {
        const encrypted = await orgCredentials.encryptApiKey(key, mockContext);
        const decrypted = await orgCredentials.decryptApiKey(encrypted, mockContext);
        expect(decrypted).toBe(key);
      }
    });

    test('should generate different IVs for same input', async () => {
      const plainApiKey = 'same-key';

      const encrypted1 = await orgCredentials.encryptApiKey(plainApiKey, mockContext);
      const encrypted2 = await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      expect(encrypted1).not.toBe(encrypted2); // Different IVs

      const decrypted1 = await orgCredentials.decryptApiKey(encrypted1, mockContext);
      const decrypted2 = await orgCredentials.decryptApiKey(encrypted2, mockContext);

      expect(decrypted1).toBe(plainApiKey);
      expect(decrypted2).toBe(plainApiKey);
    });

    test('should throw error when encryption secret not set', async () => {
      delete process.env.ENCRYPTION_SECRET;

      await expect(
        orgCredentials.encryptApiKey('test-key', mockContext)
      ).rejects.toThrow('ENCRYPTION_SECRET environment variable is not set');
    });

    test('should throw error when decryption fails', async () => {
      await expect(
        orgCredentials.decryptApiKey('invalid:format', mockContext)
      ).rejects.toThrow('Failed to decrypt TDS API key');
    });

    test('should cache encryption key', async () => {
      const plainApiKey = 'test-key';

      // First encryption
      await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      // Second encryption (should use cached key)
      await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      // Should log about using cached key on second call
      const cachedLogs = mockContext.log.mock.calls.filter(
        call => call[0] && call[0].includes('cached encryption key')
      );
      expect(cachedLogs.length).toBeGreaterThan(0);
    });

    test('should clear encryption key cache', async () => {
      const plainApiKey = 'test-key';

      await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      orgCredentials.clearEncryptionKeyCache();

      await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      // After clearing cache, should retrieve key again
      expect(mockContext.log).toHaveBeenCalled();
    });
  });

  describe('Azure Key Vault Integration', () => {
    beforeEach(() => {
      process.env.USE_KEY_VAULT = 'true';
      process.env.KEY_VAULT_NAME = 'test-keyvault';
      process.env.ENCRYPTION_SECRET_NAME = 'encryption-secret';
    });

    test('should retrieve encryption key from Key Vault', async () => {
      const mockSecretClient = {
        getSecret: jest.fn().mockResolvedValue({
          value: 'key-vault-secret-123'
        })
      };

      SecretClient.mockImplementation(() => mockSecretClient);
      DefaultAzureCredential.mockImplementation(() => ({}));

      const plainApiKey = 'test-key';
      const encrypted = await orgCredentials.encryptApiKey(plainApiKey, mockContext);

      expect(DefaultAzureCredential).toHaveBeenCalled();
      expect(SecretClient).toHaveBeenCalledWith(
        'https://test-keyvault.vault.azure.net',
        expect.any(Object)
      );
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('encryption-secret');
      expect(encrypted).toBeTruthy();
    });

    test('should use default secret name when not specified', async () => {
      delete process.env.ENCRYPTION_SECRET_NAME;

      const mockSecretClient = {
        getSecret: jest.fn().mockResolvedValue({
          value: 'key-vault-secret-123'
        })
      };

      SecretClient.mockImplementation(() => mockSecretClient);
      DefaultAzureCredential.mockImplementation(() => ({}));

      await orgCredentials.encryptApiKey('test-key', mockContext);

      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('encryption-secret');
    });

    test('should throw error when Key Vault retrieval fails', async () => {
      const mockSecretClient = {
        getSecret: jest.fn().mockRejectedValue(new Error('Key Vault unavailable'))
      };

      SecretClient.mockImplementation(() => mockSecretClient);
      DefaultAzureCredential.mockImplementation(() => ({}));

      await expect(
        orgCredentials.encryptApiKey('test-key', mockContext)
      ).rejects.toThrow('Failed to retrieve encryption key');

      expect(mockContext.error).toHaveBeenCalled();
    });
  });

  describe('Database Query', () => {
    beforeEach(() => {
      process.env.SQL_CONNECTION_STRING = 'Server=test;Database=testdb;';
      process.env.ENCRYPTION_SECRET = 'test-encryption-secret-key-12345';
      process.env.USE_KEY_VAULT = 'false';

      // Mock encrypted API key (pre-generated)
      const mockEncryptedKey = '1234567890abcdef1234567890abcdef:abcdef1234567890';

      // Mock mssql connection pool
      const mockRequest = {
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockResolvedValue({
          recordset: [
            {
              tds_member_id: 'MEM123',
              tds_branch_id: 'BR456',
              tds_api_key_encrypted: mockEncryptedKey,
              region: 'EW',
              scheme_type: 'Custodial',
              organization_name: 'Test Organization',
              tds_provider_preference: 'auto',
              is_active: true
            }
          ]
        })
      };

      const mockPool = {
        connected: true,
        request: jest.fn().mockReturnValue(mockRequest)
      };

      mssql.connect.mockResolvedValue(mockPool);
    });

    test('should retrieve organization credentials from database', async () => {
      // Mock decryption
      jest.spyOn(orgCredentials, 'decryptApiKey').mockResolvedValue('decrypted-api-key');

      const credentials = await orgCredentials.getOrganizationCredentials(
        'alto-agency-123',
        'alto-branch-456',
        mockContext
      );

      expect(credentials).toEqual({
        memberId: 'MEM123',
        branchId: 'BR456',
        apiKey: 'decrypted-api-key',
        region: 'EW',
        schemeType: 'Custodial',
        organizationName: 'Test Organization',
        providerPreference: 'auto'
      });

      expect(mssql.connect).toHaveBeenCalled();
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully retrieved credentials')
      );
    });

    test('should cache organization credentials', async () => {
      jest.spyOn(orgCredentials, 'decryptApiKey').mockResolvedValue('decrypted-api-key');

      // First request
      await orgCredentials.getOrganizationCredentials('alto-agency-123', 'alto-branch-456', mockContext);

      // Second request (should use cache)
      await orgCredentials.getOrganizationCredentials('alto-agency-123', 'alto-branch-456', mockContext);

      // Should only connect once
      expect(mssql.connect).toHaveBeenCalledTimes(1);
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Using cached credentials')
      );
    });

    test('should throw error when no organization mapping found', async () => {
      const mockRequest = {
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockResolvedValue({
          recordset: [] // No results
        })
      };

      const mockPool = {
        connected: true,
        request: jest.fn().mockReturnValue(mockRequest)
      };

      mssql.connect.mockResolvedValue(mockPool);

      await expect(
        orgCredentials.getOrganizationCredentials('unknown-agency', 'unknown-branch', mockContext)
      ).rejects.toThrow('No active organization mapping found');
    });

    test('should throw error when SQL connection string not set', async () => {
      delete process.env.SQL_CONNECTION_STRING;

      await expect(
        orgCredentials.getOrganizationCredentials('agency', 'branch', mockContext)
      ).rejects.toThrow('SQL_CONNECTION_STRING environment variable is not set');
    });

    test('should handle database connection errors with retry', async () => {
      let attempts = 0;

      const mockRequest = {
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockImplementation(() => {
          attempts++;
          if (attempts < 3) {
            const error = new Error('Connection failed');
            error.code = 'ECONNRESET';
            throw error;
          }
          return Promise.resolve({
            recordset: [
              {
                tds_member_id: 'MEM123',
                tds_branch_id: 'BR456',
                tds_api_key_encrypted: '12345:abcdef',
                region: 'EW',
                scheme_type: 'Custodial',
                organization_name: 'Test Organization',
                tds_provider_preference: 'auto',
                is_active: true
              }
            ]
          });
        })
      };

      const mockPool = {
        connected: true,
        request: jest.fn().mockReturnValue(mockRequest)
      };

      mssql.connect.mockResolvedValue(mockPool);
      jest.spyOn(orgCredentials, 'decryptApiKey').mockResolvedValue('decrypted-api-key');

      const credentials = await orgCredentials.getOrganizationCredentials('agency', 'branch', mockContext);

      expect(credentials).toBeDefined();
      expect(attempts).toBe(3);
    });

    test('should throw error after max retries', async () => {
      const mockRequest = {
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockRejectedValue(new Error('Persistent connection error'))
      };

      const mockPool = {
        connected: true,
        request: jest.fn().mockReturnValue(mockRequest)
      };

      mssql.connect.mockResolvedValue(mockPool);

      await expect(
        orgCredentials.getOrganizationCredentials('agency', 'branch', mockContext)
      ).rejects.toThrow('Database query failed after 3 attempts');
    });
  });

  describe('Connection Pool Management', () => {
    beforeEach(() => {
      process.env.SQL_CONNECTION_STRING = 'Server=test;Database=testdb;';
    });

    test('should create connection pool with correct configuration', async () => {
      const mockPool = {
        connected: true,
        request: jest.fn()
      };

      mssql.connect.mockResolvedValue(mockPool);

      const pool = await orgCredentials.getConnectionPool();

      expect(mssql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'Server=test;Database=testdb;',
          options: expect.objectContaining({
            encrypt: true,
            trustServerCertificate: false
          }),
          pool: expect.objectContaining({
            max: 10,
            min: 2
          })
        })
      );

      expect(pool).toBe(mockPool);
    });

    test('should reuse existing connection pool', async () => {
      const mockPool = {
        connected: true,
        request: jest.fn()
      };

      mssql.connect.mockResolvedValue(mockPool);

      // First call
      await orgCredentials.getConnectionPool();

      // Second call
      await orgCredentials.getConnectionPool();

      // Should only connect once
      expect(mssql.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Management', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_SECRET = 'test-encryption-secret-key-12345';
      process.env.USE_KEY_VAULT = 'false';
    });

    test('should get cache statistics', () => {
      const stats = orgCredentials.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('ttlMs');
      expect(stats.size).toBe(0); // Initially empty
      expect(stats.ttlMs).toBe(15 * 60 * 1000); // 15 minutes
    });

    test('should clear credential cache', () => {
      orgCredentials.clearCredentialCache();

      const stats = orgCredentials.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('Test Credentials', () => {
    test('should return test credentials from environment', () => {
      process.env.TEST_TDS_MEMBER_ID = 'TEST-MEM-123';
      process.env.TEST_TDS_BRANCH_ID = 'TEST-BR-456';
      process.env.TEST_TDS_API_KEY = 'test-api-key-789';
      process.env.TEST_TDS_REGION = 'Scotland';
      process.env.TEST_TDS_SCHEME_TYPE = 'Insured';

      const credentials = orgCredentials.getTestCredentials(mockContext);

      expect(credentials).toEqual({
        memberId: 'TEST-MEM-123',
        branchId: 'TEST-BR-456',
        apiKey: 'test-api-key-789',
        region: 'Scotland',
        schemeType: 'Insured',
        organizationName: 'Test Organization'
      });

      expect(mockContext.warn).toHaveBeenCalledWith(
        expect.stringContaining('test credentials')
      );
    });

    test('should return default test credentials when env vars not set', () => {
      const credentials = orgCredentials.getTestCredentials(mockContext);

      expect(credentials).toEqual({
        memberId: 'TEST123',
        branchId: '0',
        apiKey: 'test-api-key',
        region: 'EW',
        schemeType: 'Custodial',
        organizationName: 'Test Organization'
      });
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      process.env.SQL_CONNECTION_STRING = 'Server=test;Database=testdb;';
      process.env.ENCRYPTION_SECRET = 'test-encryption-secret-key-12345';
      process.env.USE_KEY_VAULT = 'false';
    });

    test('should handle provider preference variations', async () => {
      const testPreferences = ['auto', 'current', 'salesforce', 'dual', null];

      for (const pref of testPreferences) {
        const mockRequest = {
          input: jest.fn().mockReturnThis(),
          query: jest.fn().mockResolvedValue({
            recordset: [
              {
                tds_member_id: 'MEM123',
                tds_branch_id: 'BR456',
                tds_api_key_encrypted: '12345:abcdef',
                region: 'EW',
                scheme_type: 'Custodial',
                organization_name: 'Test Organization',
                tds_provider_preference: pref,
                is_active: true
              }
            ]
          })
        };

        const mockPool = {
          connected: true,
          request: jest.fn().mockReturnValue(mockRequest)
        };

        mssql.connect.mockResolvedValue(mockPool);
        jest.spyOn(orgCredentials, 'decryptApiKey').mockResolvedValue('decrypted-api-key');

        orgCredentials.clearCredentialCache();

        const credentials = await orgCredentials.getOrganizationCredentials(
          `agency-${pref}`,
          'branch',
          mockContext
        );

        expect(credentials.providerPreference).toBe(pref || 'auto');
      }
    });

    test('should handle missing optional fields', async () => {
      const mockRequest = {
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockResolvedValue({
          recordset: [
            {
              tds_member_id: 'MEM123',
              tds_branch_id: 'BR456',
              tds_api_key_encrypted: '12345:abcdef',
              region: 'EW',
              scheme_type: 'Custodial',
              organization_name: 'Test Organization',
              // tds_provider_preference is missing
              is_active: true
            }
          ]
        })
      };

      const mockPool = {
        connected: true,
        request: jest.fn().mockReturnValue(mockRequest)
      };

      mssql.connect.mockResolvedValue(mockPool);
      jest.spyOn(orgCredentials, 'decryptApiKey').mockResolvedValue('decrypted-api-key');

      const credentials = await orgCredentials.getOrganizationCredentials('agency', 'branch', mockContext);

      expect(credentials.providerPreference).toBe('auto');
    });
  });
});
