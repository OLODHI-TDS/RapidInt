#!/usr/bin/env node

/**
 * Environment Validation Script
 *
 * Validates that the TDS Integration Platform is properly deployed and configured.
 * Performs comprehensive health checks across all components.
 *
 * Usage:
 *   node validate-setup.js --environment dev
 *   node validate-setup.js --environment prod --verbose
 */

const axios = require('axios');
const { program } = require('commander');
const fs = require('fs').promises;
const path = require('path');

// Configure CLI
program
  .version('1.0.0')
  .description('Validate TDS Integration Platform deployment')
  .requiredOption('-e, --environment <env>', 'Environment to validate (dev, staging, prod)')
  .option('--verbose', 'Show detailed output')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '30000')
  .option('--config-path <path>', 'Configuration files path', '../configuration/app-settings')
  .parse();

const options = program.opts();

// Validation results
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: [],
  startTime: new Date(),
  environment: options.environment
};

/**
 * Log with timestamp and formatting
 */
function log(message, level = 'INFO', indent = 0) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const spacing = '  '.repeat(indent);
  const levelIcon = {
    'INFO': 'ℹ️ ',
    'SUCCESS': '✅',
    'WARNING': '⚠️ ',
    'ERROR': '❌',
    'TEST': '🧪'
  };

  console.log(`[${timestamp}] ${levelIcon[level] || ''} ${spacing}${message}`);
}

/**
 * Record test result
 */
function recordTest(name, passed, message = '', details = {}) {
  const test = {
    name,
    passed,
    message,
    details,
    timestamp: new Date()
  };

  results.tests.push(test);

  if (passed) {
    results.passed++;
    log(`${name}: PASSED ${message}`, 'SUCCESS', 1);
  } else {
    results.failed++;
    log(`${name}: FAILED ${message}`, 'ERROR', 1);
  }

  if (options.verbose && Object.keys(details).length > 0) {
    Object.entries(details).forEach(([key, value]) => {
      log(`${key}: ${JSON.stringify(value)}`, 'INFO', 2);
    });
  }
}

/**
 * Load environment configuration
 */
async function loadConfiguration() {
  log('Loading configuration...');

  const configFile = path.join(options.configPath, `${options.environment}.json`);

  try {
    const configContent = await fs.readFile(configFile, 'utf8');
    const config = JSON.parse(configContent);

    log(`Configuration loaded for environment: ${config.environment}`, 'SUCCESS');
    return config;
  } catch (error) {
    log(`Failed to load configuration: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Test HTTP endpoint with health check
 */
async function testEndpoint(name, url, expectedStatus = 200, expectedContent = null, headers = {}) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      timeout: parseInt(options.timeout),
      headers: {
        'Accept': 'application/json',
        ...headers
      },
      validateStatus: () => true // Don't throw on HTTP error codes
    });

    const details = {
      status: response.status,
      responseTime: response.headers['x-response-time'],
      contentType: response.headers['content-type']
    };

    // Check status code
    if (response.status !== expectedStatus) {
      recordTest(name, false, `Expected status ${expectedStatus}, got ${response.status}`, details);
      return false;
    }

    // Check expected content if specified
    if (expectedContent) {
      const hasExpectedContent = JSON.stringify(response.data).includes(expectedContent);
      if (!hasExpectedContent) {
        recordTest(name, false, `Expected content not found: ${expectedContent}`, {
          ...details,
          responseBody: response.data
        });
        return false;
      }
    }

    recordTest(name, true, `Responded in ${details.responseTime || 'N/A'}`, details);
    return true;

  } catch (error) {
    recordTest(name, false, error.message, { error: error.code });
    return false;
  }
}

/**
 * Test postcode lookup service
 */
async function testPostcodeLookup(config) {
  log('Testing Postcode Lookup Service...', 'TEST');

  const baseUrl = config.services.postcodeLookup.endpoint;

  // Test health endpoint
  await testEndpoint(
    'Postcode Service Health',
    `${baseUrl}/health`,
    200,
    'healthy'
  );

  // Test stats endpoint
  await testEndpoint(
    'Postcode Service Stats',
    `${baseUrl}/stats`,
    200,
    'totalDistricts'
  );

  // Test specific postcode lookups
  const testPostcodes = [
    { postcode: 'MK18+7ET', expected: 'Buckinghamshire' },
    { postcode: 'DL3+7ST', expected: 'County Durham' },
    { postcode: 'HP3+8EY', expected: 'Hertfordshire' }
  ];

  for (const test of testPostcodes) {
    try {
      const response = await axios.get(`${baseUrl}/${test.postcode}`, {
        timeout: parseInt(options.timeout)
      });

      const passed = response.data.county === test.expected;
      recordTest(
        `Postcode Lookup ${test.postcode.replace('+', ' ')}`,
        passed,
        passed ? `→ ${response.data.county}` : `Expected ${test.expected}, got ${response.data.county}`,
        { response: response.data }
      );
    } catch (error) {
      recordTest(`Postcode Lookup ${test.postcode}`, false, error.message);
    }
  }

  // Test batch lookup
  try {
    const batchResponse = await axios.post(`${baseUrl}/batch`, {
      postcodes: ['MK18 7ET', 'DL3 7ST', 'HP3 8EY']
    }, {
      timeout: parseInt(options.timeout),
      headers: { 'Content-Type': 'application/json' }
    });

    const summary = batchResponse.data.summary;
    const passed = summary.total === 3 && summary.successful === 3;

    recordTest(
      'Postcode Batch Lookup',
      passed,
      `${summary.successful}/${summary.total} successful`,
      { summary }
    );
  } catch (error) {
    recordTest('Postcode Batch Lookup', false, error.message);
  }
}

/**
 * Test TDS Adapter Factory
 */
async function testTDSAdapter(config) {
  log('Testing TDS Adapter Factory...', 'TEST');

  const baseUrl = config.services.tdsAdapterFactory.endpoint;

  // Test configuration endpoint
  await testEndpoint(
    'TDS Adapter Configuration',
    `${baseUrl}/config`,
    200,
    'activeProvider'
  );

  // Test health check for active provider
  await testEndpoint(
    'TDS Active Provider Health',
    `${baseUrl}/health`,
    200
  );

  // Test health check for specific providers
  for (const provider of Object.keys(config.services.tdsAdapterFactory.providers)) {
    await testEndpoint(
      `TDS Provider Health (${provider})`,
      `${baseUrl}/health/${provider}`,
      200
    );
  }
}

/**
 * Test Logic Apps (if accessible)
 */
async function testLogicApps(config) {
  log('Testing Logic Apps...', 'TEST');

  // Test Alto adapter if enabled
  if (config.integrations.alto.enabled) {
    const altoWebhookUrl = `https://${config.integrations.alto.logicAppName}.azurewebsites.net`;

    // This would typically require authentication, so we'll just check if the endpoint exists
    try {
      const response = await axios.head(altoWebhookUrl, { timeout: 10000 });
      recordTest('Alto Logic App Accessibility', true, 'Endpoint accessible');
    } catch (error) {
      if (error.response && error.response.status === 401) {
        recordTest('Alto Logic App Accessibility', true, 'Endpoint requires authentication (expected)');
      } else {
        recordTest('Alto Logic App Accessibility', false, error.message);
      }
    }
  }

  // Test Jupix adapter if enabled
  if (config.integrations.jupix && config.integrations.jupix.enabled) {
    log('Jupix integration validation not implemented yet', 'WARNING');
    results.warnings++;
  }
}

/**
 * Test data integrity
 */
async function testDataIntegrity(config) {
  log('Testing Data Integrity...', 'TEST');

  // Test postcode data completeness
  try {
    const statsResponse = await axios.get(`${config.services.postcodeLookup.endpoint}/stats`, {
      timeout: parseInt(options.timeout)
    });

    const stats = statsResponse.data;
    const expectedMinDistricts = 3000; // We expect around 3,051

    recordTest(
      'Postcode Data Completeness',
      stats.totalDistricts >= expectedMinDistricts,
      `${stats.totalDistricts} districts (expected ≥${expectedMinDistricts})`,
      { stats }
    );

    // Check coverage across countries
    const coverage = stats.coverage;
    const minimumCoverage = {
      england: 2500,
      scotland: 300,
      wales: 100,
      northernIreland: 50
    };

    Object.entries(minimumCoverage).forEach(([country, minCount]) => {
      const actualCount = coverage[country] || 0;
      recordTest(
        `${country.charAt(0).toUpperCase() + country.slice(1)} Coverage`,
        actualCount >= minCount,
        `${actualCount} districts (expected ≥${minCount})`
      );
    });

  } catch (error) {
    recordTest('Postcode Data Completeness', false, error.message);
  }
}

/**
 * Test performance benchmarks
 */
async function testPerformance(config) {
  log('Testing Performance...', 'TEST');

  const performanceTests = [
    {
      name: 'Postcode Lookup Response Time',
      url: `${config.services.postcodeLookup.endpoint}/MK18+7ET`,
      maxResponseTime: 1000 // 1 second
    },
    {
      name: 'TDS Config Response Time',
      url: `${config.services.tdsAdapterFactory.endpoint}/config`,
      maxResponseTime: 2000 // 2 seconds
    }
  ];

  for (const test of performanceTests) {
    try {
      const startTime = Date.now();
      const response = await axios.get(test.url, { timeout: parseInt(options.timeout) });
      const responseTime = Date.now() - startTime;

      const passed = responseTime <= test.maxResponseTime;
      recordTest(
        test.name,
        passed,
        `${responseTime}ms (max: ${test.maxResponseTime}ms)`,
        { responseTime, maxAllowed: test.maxResponseTime }
      );
    } catch (error) {
      recordTest(test.name, false, error.message);
    }
  }
}

/**
 * Generate validation report
 */
async function generateReport() {
  const endTime = new Date();
  const duration = endTime - results.startTime;

  console.log('\n' + '='.repeat(60));
  console.log('🧪 TDS INTEGRATION PLATFORM - VALIDATION REPORT');
  console.log('='.repeat(60));
  console.log(`Environment: ${results.environment}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Timestamp: ${endTime.toISOString()}`);
  console.log('');

  // Summary
  const total = results.passed + results.failed;
  const successRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;

  console.log('📊 SUMMARY');
  console.log('-'.repeat(20));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠️  Warnings: ${results.warnings}`);
  console.log(`📈 Success Rate: ${successRate}%`);
  console.log('');

  // Failed tests details
  if (results.failed > 0) {
    console.log('❌ FAILED TESTS');
    console.log('-'.repeat(20));
    results.tests
      .filter(test => !test.passed)
      .forEach(test => {
        console.log(`• ${test.name}: ${test.message}`);
        if (options.verbose && test.details.error) {
          console.log(`  Error: ${test.details.error}`);
        }
      });
    console.log('');
  }

  // Recommendations
  console.log('💡 RECOMMENDATIONS');
  console.log('-'.repeat(20));

  if (results.failed === 0) {
    console.log('✅ All tests passed! The platform is ready for use.');
    console.log('✅ Consider running load tests for production readiness.');
  } else {
    console.log('🔧 Fix the failed tests before proceeding to production.');
    console.log('🔍 Check application logs for detailed error information.');
  }

  if (results.warnings > 0) {
    console.log('⚠️  Review warnings for potential improvements.');
  }

  console.log('📊 Monitor Application Insights for ongoing health checks.');
  console.log('');

  // Save report to file
  const reportPath = `validation-report-${results.environment}-${endTime.toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;

  try {
    await fs.writeFile(reportPath, JSON.stringify({
      ...results,
      endTime,
      duration,
      successRate: parseFloat(successRate)
    }, null, 2));

    console.log(`📄 Detailed report saved: ${reportPath}`);
  } catch (error) {
    console.log(`⚠️  Could not save report: ${error.message}`);
  }

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

/**
 * Main validation function
 */
async function runValidation() {
  try {
    log('🚀 Starting TDS Integration Platform Validation', 'INFO');
    log(`Environment: ${options.environment}`, 'INFO');
    log(`Timeout: ${options.timeout}ms`, 'INFO');
    console.log('');

    // Load configuration
    const config = await loadConfiguration();

    // Run validation tests
    await testPostcodeLookup(config);
    await testTDSAdapter(config);
    await testLogicApps(config);
    await testDataIntegrity(config);
    await testPerformance(config);

    // Generate final report
    await generateReport();

  } catch (error) {
    log(`Validation failed: ${error.message}`, 'ERROR');
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run validation
if (require.main === module) {
  runValidation();
}

module.exports = {
  runValidation,
  testEndpoint,
  testPostcodeLookup,
  testTDSAdapter
};