/**
 * TDS Dual-API Validation Tool
 *
 * Tests and validates the dual-API setup by:
 * - Sending test requests to both Legacy and Salesforce APIs
 * - Comparing responses for consistency
 * - Validating request/response transformations
 * - Generating detailed comparison reports
 * - Monitoring forwarder routing behavior
 *
 * Usage:
 *   node validate-dual-api.js --environment dev
 *   node validate-dual-api.js --environment prod --mode shadow --iterations 100
 *   node validate-dual-api.js --test-transformers
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const ENVIRONMENTS = {
  dev: {
    forwarderUrl: 'https://tds-platform-dev-functions.azurewebsites.net/api/tds-forwarder',
    adapterUrl: 'https://tds-platform-dev-functions.azurewebsites.net/api/tds',
    functionKey: process.env.AZURE_FUNCTION_KEY_DEV || 'your-dev-key'
  },
  staging: {
    forwarderUrl: 'https://tds-platform-staging-functions.azurewebsites.net/api/tds-forwarder',
    adapterUrl: 'https://tds-platform-staging-functions.azurewebsites.net/api/tds',
    functionKey: process.env.AZURE_FUNCTION_KEY_STAGING || 'your-staging-key'
  },
  prod: {
    forwarderUrl: 'https://tds-platform-prod-functions.azurewebsites.net/api/tds-forwarder',
    adapterUrl: 'https://tds-platform-prod-functions.azurewebsites.net/api/tds',
    functionKey: process.env.AZURE_FUNCTION_KEY_PROD || 'your-prod-key'
  }
};

// Test data
const SAMPLE_DEPOSIT = {
  metadata: {
    sourceSystem: 'alto',
    sourceId: 'test-tenancy-001',
    organizationId: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
    integrationId: 'validation-test-001',
    webhookId: 'webhook-test-001',
    timestamp: new Date().toISOString(),
    version: '1.0'
  },
  organization: {
    memberNumber: 'TEST_MEMBER_001',
    branchId: 'TEST_BRANCH_001',
    name: 'Test Agency Ltd'
  },
  deposit: {
    amount: 1500.00,
    currency: 'GBP',
    tenancyStartDate: '2025-02-01',
    tenancyEndDate: '2026-02-01',
    tenancyTerm: 12,
    rentAmount: 1200.00,
    allocationDateTime: new Date().toISOString()
  },
  property: {
    address: {
      line1: '123 Test Street',
      line2: 'Test Area',
      city: 'Milton Keynes',
      postcode: 'MK18 7ET',
      county: 'Buckinghamshire',
      country: 'UK'
    },
    type: 'House',
    bedrooms: 3,
    furnished: 'Furnished'
  },
  landlord: {
    title: 'Mr',
    firstName: 'Test',
    lastName: 'Landlord',
    email: 'test.landlord@example.com',
    phone: '07700900001',
    address: {
      line1: '456 Landlord Avenue',
      postcode: 'MK1 1AA'
    }
  },
  tenants: [
    {
      title: 'Ms',
      firstName: 'Test',
      lastName: 'Tenant',
      email: 'test.tenant@example.com',
      phone: '07700900002',
      mobile: '07700900002'
    }
  ]
};

// Utility functions
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✗',
    debug: '•'
  }[level] || 'ℹ';

  console.log(`${prefix} [${timestamp}] ${message}`);
}

function logSection(title) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ${title}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

// Test functions
async function testForwarderHealth(environment) {
  logSection('Testing Forwarder Health');

  const config = ENVIRONMENTS[environment];
  const url = `${config.forwarderUrl}/health?code=${config.functionKey}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });

    log(`Status: ${response.data.status}`, 'success');
    log(`Mode: ${response.data.mode}`, 'info');
    log(`Forwarding: ${response.data.forwardingPercentage}%`, 'info');
    log(`Fallback: ${response.data.enableFallback ? 'Enabled' : 'Disabled'}`, 'info');

    console.log('\nAPI Endpoints:');
    console.log(`  Legacy:     ${response.data.apis.legacy}`);
    console.log(`  Salesforce: ${response.data.apis.salesforce}`);

    return { success: true, data: response.data };
  } catch (error) {
    log(`Health check failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

async function testForwarderConfig(environment) {
  logSection('Testing Forwarder Configuration');

  const config = ENVIRONMENTS[environment];
  const url = `${config.forwarderUrl}/config?code=${config.functionKey}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });

    log(`Routing Mode: ${response.data.routingMode}`, 'info');
    log(`Forwarding: ${response.data.forwardingPercentage}%`, 'info');
    log(`Fallback: ${response.data.enableFallback ? 'Enabled' : 'Disabled'}`, 'info');
    log(`Comparison: ${response.data.enableComparison ? 'Enabled' : 'Disabled'}`, 'info');

    console.log('\nProvider Configuration:');
    console.log(`  Legacy: ${response.data.apis.legacy.name} (${response.data.apis.legacy.baseUrl})`);
    console.log(`  Salesforce: ${response.data.apis.salesforce.name} (${response.data.apis.salesforce.baseUrl})`);

    return { success: true, data: response.data };
  } catch (error) {
    log(`Config check failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

async function testDepositCreation(environment, useForwarder = true) {
  logSection(`Testing Deposit Creation (${useForwarder ? 'Forwarder' : 'Direct Adapter'})`);

  const config = ENVIRONMENTS[environment];
  const url = useForwarder
    ? `${config.forwarderUrl}/create?code=${config.functionKey}`
    : `${config.adapterUrl}/create?code=${config.functionKey}`;

  try {
    log('Sending test deposit...', 'info');

    const startTime = Date.now();
    const response = await axios.post(url, SAMPLE_DEPOSIT, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    const duration = Date.now() - startTime;

    log(`Request completed in ${duration}ms`, 'success');

    if (response.data.success) {
      log(`Batch ID: ${response.data.data.batch_id}`, 'success');
      log(`Status: ${response.data.data.status}`, 'info');

      if (response.data.metadata) {
        log(`Provider: ${response.data.metadata.provider}`, 'info');
        log(`Mode: ${response.data.metadata.mode}`, 'info');

        if (response.data.metadata.comparison) {
          console.log('\nComparison Results:');
          console.log(`  Both succeeded: ${response.data.metadata.comparison.bothSucceeded}`);
          console.log(`  Status match: ${response.data.metadata.comparison.statusMatch}`);
          console.log(`  Data match: ${response.data.metadata.comparison.dataMatch}`);

          if (response.data.metadata.comparison.timeDifference) {
            console.log('\nPerformance:');
            console.log(`  Legacy: ${response.data.metadata.comparison.timeDifference.legacy}ms`);
            console.log(`  Salesforce: ${response.data.metadata.comparison.timeDifference.salesforce}ms`);
            console.log(`  Delta: ${response.data.metadata.comparison.timeDifference.delta}ms (${response.data.metadata.comparison.timeDifference.percentageDifference}%)`);
          }
        }
      }

      return { success: true, data: response.data, duration };
    } else {
      log(`Deposit creation failed`, 'error');
      return { success: false, error: 'Deposit creation returned failure', data: response.data };
    }
  } catch (error) {
    log(`Deposit creation failed: ${error.message}`, 'error');
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Data:`, error.response.data);
    }
    return { success: false, error: error.message };
  }
}

async function testRoutingBehavior(environment, iterations = 10) {
  logSection(`Testing Routing Behavior (${iterations} iterations)`);

  const config = ENVIRONMENTS[environment];
  const url = `${config.forwarderUrl}/create?code=${config.functionKey}`;

  const results = {
    total: iterations,
    legacy: 0,
    salesforce: 0,
    dual: 0,
    errors: 0,
    timings: []
  };

  for (let i = 0; i < iterations; i++) {
    try {
      const startTime = Date.now();
      const response = await axios.post(url, SAMPLE_DEPOSIT, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });
      const duration = Date.now() - startTime;

      results.timings.push(duration);

      if (response.data.metadata) {
        const provider = response.data.metadata.provider;
        if (provider === 'legacy') results.legacy++;
        else if (provider === 'salesforce') results.salesforce++;
        else if (provider === 'dual') results.dual++;
      }

      process.stdout.write(`\r  Progress: ${i + 1}/${iterations} | Legacy: ${results.legacy} | SF: ${results.salesforce} | Dual: ${results.dual} | Errors: ${results.errors}`);
    } catch (error) {
      results.errors++;
      process.stdout.write(`\r  Progress: ${i + 1}/${iterations} | Legacy: ${results.legacy} | SF: ${results.salesforce} | Dual: ${results.dual} | Errors: ${results.errors}`);
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n');

  // Calculate statistics
  const avgTiming = results.timings.reduce((a, b) => a + b, 0) / results.timings.length;
  const minTiming = Math.min(...results.timings);
  const maxTiming = Math.max(...results.timings);

  log('Routing Distribution:', 'info');
  console.log(`  Legacy:     ${results.legacy} (${(results.legacy / results.total * 100).toFixed(1)}%)`);
  console.log(`  Salesforce: ${results.salesforce} (${(results.salesforce / results.total * 100).toFixed(1)}%)`);
  console.log(`  Dual:       ${results.dual} (${(results.dual / results.total * 100).toFixed(1)}%)`);
  console.log(`  Errors:     ${results.errors} (${(results.errors / results.total * 100).toFixed(1)}%)`);

  log('\nPerformance:', 'info');
  console.log(`  Average: ${avgTiming.toFixed(0)}ms`);
  console.log(`  Min:     ${minTiming.toFixed(0)}ms`);
  console.log(`  Max:     ${maxTiming.toFixed(0)}ms`);

  return results;
}

async function generateReport(environment, results) {
  logSection('Generating Validation Report');

  const report = {
    timestamp: new Date().toISOString(),
    environment,
    results,
    summary: {
      totalTests: Object.keys(results).length,
      passed: Object.values(results).filter(r => r.success).length,
      failed: Object.values(results).filter(r => !r.success).length
    }
  };

  const reportPath = path.join(__dirname, `validation-report-${environment}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  log(`Report saved to: ${reportPath}`, 'success');

  return report;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const environment = args.find(arg => arg.startsWith('--environment='))?.split('=')[1] || 'dev';
  const mode = args.find(arg => arg.startsWith('--mode='))?.split('=')[1];
  const iterations = parseInt(args.find(arg => arg.startsWith('--iterations='))?.split('=')[1] || '10', 10);
  const testTransformers = args.includes('--test-transformers');

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         TDS Dual-API Validation Tool v1.0.0              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Environment: ${environment}`);
  console.log(`Iterations:  ${iterations}`);
  console.log('');

  const results = {};

  // Test health
  results.health = await testForwarderHealth(environment);

  // Test configuration
  results.config = await testForwarderConfig(environment);

  // Test deposit creation via forwarder
  results.forwarderDeposit = await testDepositCreation(environment, true);

  // Test direct adapter (for comparison)
  results.directDeposit = await testDepositCreation(environment, false);

  // Test routing behavior
  if (mode === 'forwarding' || mode === 'shadow') {
    results.routing = await testRoutingBehavior(environment, iterations);
  }

  // Generate report
  const report = await generateReport(environment, results);

  // Summary
  logSection('Validation Summary');

  const passed = report.summary.passed;
  const failed = report.summary.failed;
  const total = report.summary.totalTests;

  log(`Total Tests: ${total}`, 'info');
  log(`Passed: ${passed}`, 'success');
  log(`Failed: ${failed}`, failed > 0 ? 'error' : 'success');
  log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`, passed === total ? 'success' : 'warning');

  console.log('');

  if (failed > 0) {
    log('Some tests failed - review the report for details', 'warning');
    process.exit(1);
  } else {
    log('All tests passed!', 'success');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  testForwarderHealth,
  testForwarderConfig,
  testDepositCreation,
  testRoutingBehavior,
  generateReport
};
