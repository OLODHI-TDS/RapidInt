#!/usr/bin/env node

/**
 * Mock TDS Server for Local Development
 *
 * Simulates TDS API behavior for local testing without hitting real TDS endpoints.
 * Provides realistic response times and various test scenarios.
 *
 * Usage:
 *   node mock-tds-server.js --port 3001
 */

const express = require('express');
const { program } = require('commander');
const { v4: uuidv4 } = require('uuid');

// Configure CLI
program
  .version('1.0.0')
  .description('Mock TDS Server for local development')
  .option('-p, --port <number>', 'Port to run mock server on', '3001')
  .option('--delay <ms>', 'Simulate response delay', '500')
  .option('--failure-rate <percent>', 'Simulate failure rate (0-100)', '0')
  .parse();

const options = program.opts();
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add CORS for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('  Body:', JSON.stringify(req.body, null, 2).substring(0, 500));
  }
  next();
});

// In-memory storage for mock data
const deposits = new Map();
const batchStatuses = new Map();

/**
 * Simulate processing delay
 */
function simulateDelay() {
  if (options.delay > 0) {
    return new Promise(resolve => setTimeout(resolve, parseInt(options.delay)));
  }
  return Promise.resolve();
}

/**
 * Simulate random failures
 */
function shouldSimulateFailure() {
  const failureRate = parseInt(options.failureRate);
  return Math.random() * 100 < failureRate;
}

/**
 * Generate mock DAN (Deposit Allocation Number)
 */
function generateDAN() {
  const prefix = 'DAN';
  const number = Math.floor(Math.random() * 900000000) + 100000000; // 9-digit number
  return `${prefix}${number}`;
}

// Health check endpoint
app.get('/health', async (req, res) => {
  await simulateDelay();

  res.json({
    status: 'healthy',
    service: 'Mock TDS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      createDeposit: '/CreateDeposit',
      createDepositStatus: '/CreateDepositStatus'
    }
  });
});

// Create Deposit endpoint (v1.2 format)
app.post('/CreateDeposit', async (req, res) => {
  await simulateDelay();

  if (shouldSimulateFailure()) {
    return res.status(500).json({
      success: false,
      error: 'Simulated TDS API failure',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const payload = req.body;

    // Validate basic structure
    if (!payload.organisation || !payload.deposits || !Array.isArray(payload.deposits)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payload structure',
        errors: ['Missing organisation or deposits array']
      });
    }

    // Generate batch ID
    const batchId = `BATCH_${uuidv4().substring(0, 8).toUpperCase()}`;
    const processingTime = Math.random() * 30000 + 5000; // 5-35 seconds

    // Store deposit info
    const depositInfo = {
      batch_id: batchId,
      status: 'pending',
      organisation: payload.organisation,
      deposits: payload.deposits.map(deposit => ({
        ...deposit,
        dan: null, // Will be set when status becomes 'created'
        created_at: new Date().toISOString()
      })),
      created_at: new Date().toISOString(),
      processing_time: processingTime
    };

    deposits.set(batchId, depositInfo);

    // Set status progression
    setTimeout(() => {
      const deposit = deposits.get(batchId);
      if (deposit) {
        deposit.status = 'processing';
        batchStatuses.set(batchId, {
          status: 'processing',
          message: 'Deposit is being processed'
        });
      }
    }, 2000); // After 2 seconds

    setTimeout(() => {
      const deposit = deposits.get(batchId);
      if (deposit) {
        // Simulate occasional processing failures
        if (Math.random() < 0.1) { // 10% failure rate
          deposit.status = 'failed';
          batchStatuses.set(batchId, {
            status: 'failed',
            errors: ['Mock processing failure - insufficient funds verification failed']
          });
        } else {
          deposit.status = 'created';
          deposit.deposits.forEach(dep => {
            dep.dan = generateDAN();
          });

          batchStatuses.set(batchId, {
            status: 'created',
            dan: deposit.deposits[0].dan,
            branch_id: deposit.organisation.branch_id,
            warnings: deposit.deposits.length > 1 ? ['Multiple deposits in batch'] : undefined
          });
        }
      }
    }, processingTime); // After processing time

    // Return immediate response
    res.json({
      success: true,
      batch_id: batchId,
      status: 'submitted',
      message: 'Deposit submitted successfully',
      timestamp: new Date().toISOString(),
      estimated_processing_time: `${Math.round(processingTime / 1000)} seconds`
    });

  } catch (error) {
    console.error('Mock TDS CreateDeposit error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Create Deposit Status endpoint
app.post('/CreateDepositStatus', async (req, res) => {
  await simulateDelay();

  try {
    const { batch_id } = req.body;

    if (!batch_id) {
      return res.status(400).json({
        error: 'Missing batch_id parameter'
      });
    }

    const deposit = deposits.get(batch_id);
    const batchStatus = batchStatuses.get(batch_id);

    if (!deposit) {
      return res.status(404).json({
        error: 'Batch not found',
        batch_id: batch_id
      });
    }

    // Return current status
    const response = {
      batch_id: batch_id,
      status: deposit.status,
      timestamp: new Date().toISOString(),
      ...batchStatus
    };

    res.json(response);

  } catch (error) {
    console.error('Mock TDS Status check error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Debug endpoint to view all deposits
app.get('/debug/deposits', (req, res) => {
  const allDeposits = Array.from(deposits.entries()).map(([batchId, data]) => ({
    batch_id: batchId,
    ...data
  }));

  res.json({
    total: allDeposits.length,
    deposits: allDeposits
  });
});

// Debug endpoint to clear all deposits
app.delete('/debug/deposits', (req, res) => {
  deposits.clear();
  batchStatuses.clear();

  res.json({
    message: 'All mock deposits cleared',
    timestamp: new Date().toISOString()
  });
});

// Test data endpoint
app.get('/test/sample-deposit', (req, res) => {
  res.json({
    organisation: {
      member_number: "MOCK_TDS_12345",
      branch_id: "MOCK_BRANCH_001"
    },
    deposits: [{
      deposit_amount: 1500.00,
      tenancy_deposit_allocation_datetime: new Date().toISOString(),
      tenancy_start_date: "2025-02-01",
      tenancy_end_date: "2026-01-31",
      tenancy_term: 12,
      property: {
        address_line_1: "123 Mock Street",
        address_line_2: "Mock District",
        address_line_3: "",
        address_line_4: "",
        postcode: "MK18 7ET",
        county: "Buckinghamshire",
        property_type: "Flat",
        bedrooms: 2
      },
      landlord: {
        title: "Mr",
        first_name: "Mock",
        last_name: "Landlord",
        email: "mock.landlord@example.com",
        phone: "07700900001",
        address: {
          address_line_1: "456 Mock Road",
          postcode: "MK1 1AA"
        }
      },
      tenants: [{
        title: "Ms",
        first_name: "Mock",
        last_name: "Tenant",
        email: "mock.tenant@example.com",
        phone: "07700900002"
      }]
    }]
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Mock TDS Server Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    availableEndpoints: [
      'POST /CreateDeposit',
      'POST /CreateDepositStatus',
      'GET /health',
      'GET /debug/deposits',
      'DELETE /debug/deposits',
      'GET /test/sample-deposit'
    ]
  });
});

// Start server
const port = parseInt(options.port);
app.listen(port, () => {
  console.log(`🎭 Mock TDS Server started`);
  console.log(`📍 Running on: http://localhost:${port}`);
  console.log(`⏱️  Response delay: ${options.delay}ms`);
  console.log(`💥 Failure rate: ${options.failureRate}%`);
  console.log('');
  console.log('📋 Available endpoints:');
  console.log(`   POST http://localhost:${port}/CreateDeposit`);
  console.log(`   POST http://localhost:${port}/CreateDepositStatus`);
  console.log(`   GET  http://localhost:${port}/health`);
  console.log(`   GET  http://localhost:${port}/debug/deposits`);
  console.log(`   GET  http://localhost:${port}/test/sample-deposit`);
  console.log('');
  console.log('🧪 Test command:');
  console.log(`   curl -X GET http://localhost:${port}/health`);
});

module.exports = app;