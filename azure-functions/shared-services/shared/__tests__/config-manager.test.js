/**
 * Unit Tests for Configuration Manager
 *
 * Tests:
 * - Routing mode determination
 * - Organization overrides
 * - Configuration validation
 * - Cache management
 */

const configManager = require('../config-manager');

describe('Configuration Manager', () => {
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

    // Clear cache
    configManager.clearConfigCache();

    // Reset to defaults
    process.env.TDS_ROUTING_MODE = 'legacy-only';
    process.env.TDS_FORWARDING_PERCENTAGE = '0';
    process.env.TDS_ACTIVE_PROVIDER = 'current';
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    configManager.clearConfigCache();
  });

  describe('Global Configuration', () => {
    test('should load global configuration from environment', () => {
      process.env.TDS_ROUTING_MODE = 'both';
      process.env.TDS_FORWARDING_PERCENTAGE = '25';
      process.env.TDS_ACTIVE_PROVIDER = 'salesforce';
      process.env.TDS_DUAL_MODE = 'true';
      process.env.TDS_ENABLE_FALLBACK = 'true';
      process.env.TDS_ENABLE_RESPONSE_COMPARISON = 'true';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.routingMode).toBe('both');
      expect(config.forwardingPercentage).toBe(25);
      expect(config.activeProvider).toBe('salesforce');
      expect(config.enableDualMode).toBe(true);
      expect(config.enableFallback).toBe(true);
      expect(config.enableComparison).toBe(true);
    });

    test('should use default values when env vars not set', () => {
      // Clear all env vars
      delete process.env.TDS_ROUTING_MODE;
      delete process.env.TDS_FORWARDING_PERCENTAGE;
      delete process.env.TDS_ACTIVE_PROVIDER;

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.routingMode).toBe('legacy-only');
      expect(config.forwardingPercentage).toBe(0);
      expect(config.activeProvider).toBe('current');
      expect(config.enableDualMode).toBe(false);
      expect(config.allowOrganizationOverrides).toBe(true);
    });

    test('should load retry and timeout configuration', () => {
      process.env.TDS_MAX_RETRIES = '5';
      process.env.TDS_RETRY_DELAY_MS = '2000';
      process.env.TDS_REQUEST_TIMEOUT_MS = '60000';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
      expect(config.requestTimeoutMs).toBe(60000);
    });

    test('should load circuit breaker configuration', () => {
      process.env.TDS_CIRCUIT_BREAKER_THRESHOLD = '10';
      process.env.TDS_CIRCUIT_BREAKER_TIMEOUT_MS = '120000';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.circuitBreakerThreshold).toBe(10);
      expect(config.circuitBreakerTimeoutMs).toBe(120000);
    });

    test('should load API URLs', () => {
      process.env.TDS_CURRENT_BASE_URL = 'https://custom-legacy.api.com';
      process.env.TDS_SALESFORCE_BASE_URL = 'https://custom-salesforce.api.com';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.legacyApiUrl).toBe('https://custom-legacy.api.com');
      expect(config.salesforceApiUrl).toBe('https://custom-salesforce.api.com');
    });

    test('should cache global configuration', () => {
      // First call
      configManager.getGlobalConfig(mockContext);

      // Second call
      configManager.getGlobalConfig(mockContext);

      // Should log about using cached config on second call
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('cached global configuration')
      );
    });
  });

  describe('Configuration Validation', () => {
    test('should validate valid routing modes', () => {
      const validModes = ['legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding'];

      for (const mode of validModes) {
        process.env.TDS_ROUTING_MODE = mode;
        configManager.clearConfigCache();

        expect(() => {
          configManager.getGlobalConfig(mockContext);
        }).not.toThrow();
      }
    });

    test('should throw error for invalid routing mode', () => {
      process.env.TDS_ROUTING_MODE = 'invalid-mode';

      expect(() => {
        configManager.getGlobalConfig(mockContext);
      }).toThrow('Invalid routing mode: invalid-mode');
    });

    test('should throw error for invalid forwarding percentage (negative)', () => {
      process.env.TDS_FORWARDING_PERCENTAGE = '-10';

      expect(() => {
        configManager.getGlobalConfig(mockContext);
      }).toThrow('Invalid forwarding percentage: -10');
    });

    test('should throw error for invalid forwarding percentage (over 100)', () => {
      process.env.TDS_FORWARDING_PERCENTAGE = '150';

      expect(() => {
        configManager.getGlobalConfig(mockContext);
      }).toThrow('Invalid forwarding percentage: 150');
    });

    test('should validate active provider values', () => {
      const validProviders = ['current', 'salesforce'];

      for (const provider of validProviders) {
        process.env.TDS_ACTIVE_PROVIDER = provider;
        configManager.clearConfigCache();

        expect(() => {
          configManager.getGlobalConfig(mockContext);
        }).not.toThrow();
      }
    });

    test('should throw error for invalid active provider', () => {
      process.env.TDS_ACTIVE_PROVIDER = 'invalid-provider';

      expect(() => {
        configManager.getGlobalConfig(mockContext);
      }).toThrow('Invalid active provider: invalid-provider');
    });
  });

  describe('Organization Configuration', () => {
    test('should use global config when no organization overrides', () => {
      process.env.TDS_ROUTING_MODE = 'both';

      const orgCredentials = {
        providerPreference: 'auto'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig.routingMode).toBe('both');
    });

    test('should override to legacy-only for current preference', () => {
      process.env.TDS_ROUTING_MODE = 'salesforce-only';

      const orgCredentials = {
        providerPreference: 'current'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig.routingMode).toBe('legacy-only');
      expect(orgConfig.activeProvider).toBe('current');
      expect(orgConfig.enableDualMode).toBe(false);
    });

    test('should override to salesforce-only for salesforce preference', () => {
      process.env.TDS_ROUTING_MODE = 'legacy-only';

      const orgCredentials = {
        providerPreference: 'salesforce'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig.routingMode).toBe('salesforce-only');
      expect(orgConfig.activeProvider).toBe('salesforce');
      expect(orgConfig.enableDualMode).toBe(false);
    });

    test('should enable dual mode for dual preference', () => {
      process.env.TDS_ROUTING_MODE = 'legacy-only';

      const orgCredentials = {
        providerPreference: 'dual'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig.routingMode).toBe('both');
      expect(orgConfig.enableDualMode).toBe(true);
      expect(orgConfig.enableComparison).toBe(true);
    });

    test('should use global config for auto preference', () => {
      process.env.TDS_ROUTING_MODE = 'forwarding';

      const orgCredentials = {
        providerPreference: 'auto'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig.routingMode).toBe('forwarding');
    });

    test('should disable organization overrides when configured', () => {
      process.env.TDS_ALLOW_ORG_OVERRIDES = 'false';
      process.env.TDS_ROUTING_MODE = 'both';

      const orgCredentials = {
        providerPreference: 'current'
      };

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      // Should use global config even though org prefers current
      expect(orgConfig.routingMode).toBe('both');
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Organization overrides disabled')
      );
    });

    test('should cache organization configuration', () => {
      const orgCredentials = {
        providerPreference: 'auto'
      };

      // First call
      configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      // Second call
      configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      // Should log about using cached config
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Using cached organization configuration')
      );
    });

    test('should handle different organizations separately', () => {
      const orgCredentials1 = {
        providerPreference: 'current'
      };

      const orgCredentials2 = {
        providerPreference: 'salesforce'
      };

      const orgConfig1 = configManager.getOrganizationConfig('agency-1', 'branch-001', orgCredentials1, mockContext);
      const orgConfig2 = configManager.getOrganizationConfig('agency-2', 'branch-001', orgCredentials2, mockContext);

      expect(orgConfig1.routingMode).toBe('legacy-only');
      expect(orgConfig2.routingMode).toBe('salesforce-only');
    });

    // HIGH-007: Test branch-specific cache isolation
    test('should isolate cache per branch for same agency (HIGH-007 fix)', () => {
      const agencyRef = 'agency-abc';

      // Branch 1 with legacy preference
      const branch1Credentials = {
        providerPreference: 'current'
      };

      // Branch 2 with salesforce preference
      const branch2Credentials = {
        providerPreference: 'salesforce'
      };

      // Get config for branch 1
      const branch1Config = configManager.getOrganizationConfig(agencyRef, 'branch-001', branch1Credentials, mockContext);

      // Get config for branch 2 (different branch, same agency)
      const branch2Config = configManager.getOrganizationConfig(agencyRef, 'branch-002', branch2Credentials, mockContext);

      // Verify each branch got its own configuration
      expect(branch1Config.routingMode).toBe('legacy-only');
      expect(branch1Config.activeProvider).toBe('current');

      expect(branch2Config.routingMode).toBe('salesforce-only');
      expect(branch2Config.activeProvider).toBe('salesforce');

      // Verify cache isolation - get branch 1 config again, should still be legacy
      const branch1ConfigAgain = configManager.getOrganizationConfig(agencyRef, 'branch-001', branch1Credentials, mockContext);
      expect(branch1ConfigAgain.routingMode).toBe('legacy-only');
      expect(branch1ConfigAgain.activeProvider).toBe('current');

      // Verify we used cached config (should log about cache)
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Using cached organization configuration')
      );
    });
  });

  describe('Provider Determination', () => {
    test('should route to current for legacy-only mode', () => {
      const orgConfig = {
        routingMode: 'legacy-only'
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('current');
      expect(routing.execute).toEqual(['current']);
    });

    test('should route to salesforce for salesforce-only mode', () => {
      const orgConfig = {
        routingMode: 'salesforce-only'
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('salesforce');
      expect(routing.execute).toEqual(['salesforce']);
    });

    test('should execute both for both mode', () => {
      const orgConfig = {
        routingMode: 'both'
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('both');
      expect(routing.execute).toEqual(['current', 'salesforce']);
    });

    test('should execute both but return from current in shadow mode', () => {
      const orgConfig = {
        routingMode: 'shadow'
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('current');
      expect(routing.execute).toEqual(['current', 'salesforce']);
      expect(routing.returnFrom).toBe('current');
    });

    test('should route based on percentage in forwarding mode', () => {
      const orgConfig = {
        routingMode: 'forwarding',
        forwardingPercentage: 50
      };

      const results = { current: 0, salesforce: 0 };

      // Run 100 times to test distribution
      for (let i = 0; i < 100; i++) {
        const routing = configManager.determineProvider(orgConfig, mockContext);
        results[routing.target]++;
      }

      // Should be roughly 50/50 (allow for randomness)
      expect(results.current).toBeGreaterThan(20);
      expect(results.current).toBeLessThan(80);
      expect(results.salesforce).toBeGreaterThan(20);
      expect(results.salesforce).toBeLessThan(80);
    });

    test('should route to current for 0% forwarding', () => {
      const orgConfig = {
        routingMode: 'forwarding',
        forwardingPercentage: 0
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('current');
      expect(routing.execute).toEqual(['current']);
    });

    test('should route to salesforce for 100% forwarding', () => {
      const orgConfig = {
        routingMode: 'forwarding',
        forwardingPercentage: 100
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('salesforce');
      expect(routing.execute).toEqual(['salesforce']);
    });

    test('should default to current for unknown mode', () => {
      const orgConfig = {
        routingMode: 'unknown-mode'
      };

      const routing = configManager.determineProvider(orgConfig, mockContext);

      expect(routing.target).toBe('current');
      expect(routing.execute).toEqual(['current']);
      expect(mockContext.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown routing mode')
      );
    });
  });

  describe('Cache Management', () => {
    test('should clear configuration cache', () => {
      // Load config
      configManager.getGlobalConfig(mockContext);

      // Clear cache
      configManager.clearConfigCache();

      // Load again
      configManager.getGlobalConfig(mockContext);

      // Should load from environment, not cache
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Loading global configuration from environment')
      );
    });

    test('should get cache statistics', () => {
      // Load global config
      configManager.getGlobalConfig(mockContext);

      // Load org configs
      const orgCredentials = { providerPreference: 'auto' };
      configManager.getOrganizationConfig('agency-1', 'branch-001', orgCredentials, mockContext);
      configManager.getOrganizationConfig('agency-2', 'branch-001', orgCredentials, mockContext);

      const stats = configManager.getConfigCacheStats();

      expect(stats.globalCached).toBe(true);
      expect(stats.organizationCount).toBe(2);
      expect(stats.cacheAge).toBeGreaterThanOrEqual(0);
      expect(stats.ttl).toBe(5 * 60 * 1000); // 5 minutes
    });

    test('should report empty cache initially', () => {
      const stats = configManager.getConfigCacheStats();

      expect(stats.globalCached).toBe(false);
      expect(stats.organizationCount).toBe(0);
      expect(stats.cacheAge).toBeNull();
    });
  });

  describe('Dynamic Configuration Updates', () => {
    test('should update routing mode dynamically', () => {
      process.env.TDS_ROUTING_MODE = 'legacy-only';

      configManager.updateRoutingMode('salesforce-only', mockContext);

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.routingMode).toBe('salesforce-only');
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Updating routing mode to: salesforce-only')
      );
    });

    test('should throw error for invalid routing mode update', () => {
      expect(() => {
        configManager.updateRoutingMode('invalid-mode', mockContext);
      }).toThrow('Invalid routing mode: invalid-mode');
    });

    test('should update forwarding percentage dynamically', () => {
      configManager.updateForwardingPercentage(75, mockContext);

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.forwardingPercentage).toBe(75);
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Updating forwarding percentage to: 75%')
      );
    });

    test('should throw error for invalid forwarding percentage update', () => {
      expect(() => {
        configManager.updateForwardingPercentage(-10, mockContext);
      }).toThrow('Invalid forwarding percentage: -10');

      expect(() => {
        configManager.updateForwardingPercentage(150, mockContext);
      }).toThrow('Invalid forwarding percentage: 150');
    });

    test('should enable dual mode dynamically', () => {
      process.env.TDS_DUAL_MODE = 'false';

      configManager.updateDualMode(true, mockContext);

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.enableDualMode).toBe(true);
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Enabling dual-mode globally')
      );
    });

    test('should disable dual mode dynamically', () => {
      process.env.TDS_DUAL_MODE = 'true';

      configManager.updateDualMode(false, mockContext);

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.enableDualMode).toBe(false);
      expect(mockContext.log).toHaveBeenCalledWith(
        expect.stringContaining('Disabling dual-mode globally')
      );
    });

    test('should clear cache after dynamic updates', () => {
      // Load config
      configManager.getGlobalConfig(mockContext);

      // Update routing mode
      configManager.updateRoutingMode('both', mockContext);

      // Next call should reload from environment
      const config = configManager.getGlobalConfig(mockContext);

      expect(config.routingMode).toBe('both');
    });
  });

  describe('Feature Flags', () => {
    test('should handle detailed logging flag', () => {
      process.env.TDS_ENABLE_DETAILED_LOGGING = 'true';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.enableDetailedLogging).toBe(true);
    });

    test('should handle comparison logging flag', () => {
      process.env.TDS_LOG_COMPARISON_RESULTS = 'true';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.logComparisonResults).toBe(true);
    });

    test('should default feature flags to false', () => {
      const config = configManager.getGlobalConfig(mockContext);

      expect(config.enableDualMode).toBe(false);
      expect(config.enableFallback).toBe(false);
      expect(config.enableComparison).toBe(false);
      expect(config.enableDetailedLogging).toBe(false);
      expect(config.logComparisonResults).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle missing org credentials gracefully', () => {
      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', null, mockContext);

      expect(orgConfig).toBeDefined();
      expect(orgConfig.routingMode).toBe('legacy-only');
    });

    test('should handle org credentials without providerPreference', () => {
      const orgCredentials = {};

      const orgConfig = configManager.getOrganizationConfig('agency-123', 'branch-001', orgCredentials, mockContext);

      expect(orgConfig).toBeDefined();
      expect(orgConfig.routingMode).toBe('legacy-only');
    });

    test('should parse integer configuration correctly', () => {
      process.env.TDS_MAX_RETRIES = 'not-a-number';

      const config = configManager.getGlobalConfig(mockContext);

      expect(config.maxRetries).toBeNaN();
    });
  });
});
