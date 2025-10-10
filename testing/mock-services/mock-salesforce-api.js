/**
 * Mock Salesforce API Service
 *
 * Simulates the Salesforce EWC TDS API for testing purposes.
 * Provides configurable delays, errors, and realistic response scenarios.
 *
 * Features:
 * - Create deposit endpoint simulation
 * - Status endpoint simulation
 * - Configurable delays and errors
 * - Support for all response scenarios (success, failed, processing)
 * - Realistic Salesforce response format
 */

const express = require('express');
const bodyParser = require('body-parser');

class MockSalesforceAPI {
  constructor(options = {}) {
    this.app = express();
    this.server = null;
    this.port = options.port || 3001;

    // Configuration
    this.config = {
      baseDelay: options.baseDelay || 100, // ms
      errorRate: options.errorRate || 0, // 0-1
      processingDelay: options.processingDelay || 2000, // ms
      enableAuth: options.enableAuth !== false,
      strictValidation: options.strictValidation !== false
    };

    // Storage for batch tracking
    this.batches = new Map();
    this.batchCounter = 1000;

    this._setupMiddleware();
    this._setupRoutes();
  }

  _setupMiddleware() {
    this.app.use(bodyParser.json());

    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, AccessToken');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[Mock Salesforce API] ${req.method} ${req.path}`);
      next();
    });

    // Authentication middleware
    if (this.config.enableAuth) {
      this.app.use((req, res, next) => {
        const accessToken = req.headers['accesstoken'];
        const authHeader = req.headers['authorization'];

        if (!accessToken && !authHeader) {
          return res.status(401).json({
            error: true,
            error_code: 'UNAUTHORIZED',
            message: 'Missing authentication credentials'
          });
        }

        // Basic validation of AccessToken format
        if (accessToken && !accessToken.includes('-')) {
          return res.status(401).json({
            error: true,
            error_code: 'INVALID_ACCESS_TOKEN',
            message: 'Invalid AccessToken format'
          });
        }

        next();
      });
    }

    // Delay simulation
    this.app.use((req, res, next) => {
      setTimeout(next, this.config.baseDelay);
    });

    // Error injection
    this.app.use((req, res, next) => {
      if (Math.random() < this.config.errorRate) {
        return res.status(500).json({
          error: true,
          error_code: 'INTERNAL_SERVER_ERROR',
          message: 'Simulated server error'
        });
      }
      next();
    });
  }

  _setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'Mock Salesforce TDS EWC API',
        version: '1.0.0'
      });
    });

    // Create deposit endpoint
    this.app.post('/api/tds/v1/deposits', (req, res) => {
      this._handleCreateDeposit(req, res);
    });

    // Get batch status endpoint
    this.app.get('/api/tds/v1/deposits/status/:batchId', (req, res) => {
      this._handleGetBatchStatus(req, res);
    });

    // OAuth2 token endpoint (for testing OAuth2 flow)
    this.app.post('/services/oauth2/token', (req, res) => {
      res.json({
        access_token: 'mock-access-token-' + Date.now(),
        token_type: 'Bearer',
        expires_in: 300
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: true,
        error_code: 'NOT_FOUND',
        message: `Endpoint not found: ${req.path}`
      });
    });
  }

  _handleCreateDeposit(req, res) {
    const payload = req.body;

    // Validate request
    if (this.config.strictValidation) {
      const validation = this._validateDepositRequest(payload);
      if (!validation.valid) {
        return res.status(400).json({
          success: 'false',
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          errors: validation.errors
        });
      }
    }

    // Generate batch ID
    const batchId = `BATCH-${this.batchCounter++}`;

    // Determine if deposit should succeed or fail
    const shouldSucceed = !payload.tenancy?.property_postcode?.includes('FAIL');
    const shouldProcessSlowly = payload.tenancy?.property_postcode?.includes('SLOW');

    // Store batch information
    const batchInfo = {
      batchId,
      status: shouldProcessSlowly ? 'Processing' : (shouldSucceed ? 'Submitted' : 'Failed'),
      createdAt: new Date().toISOString(),
      payload,
      dan: shouldSucceed ? this._generateDAN() : null,
      processingStartTime: Date.now()
    };

    this.batches.set(batchId, batchInfo);

    // Schedule status update for slow processing
    if (shouldProcessSlowly) {
      setTimeout(() => {
        const batch = this.batches.get(batchId);
        if (batch) {
          batch.status = 'Completed';
          batch.dan = this._generateDAN();
          batch.completedAt = new Date().toISOString();
        }
      }, this.config.processingDelay);
    }

    // Return response
    res.status(200).json({
      success: shouldSucceed ? 'true' : 'false',
      batch_id: batchId,
      status: batchInfo.status,
      message: shouldSucceed
        ? 'Deposit submitted successfully'
        : 'Deposit submission failed',
      errors: shouldSucceed ? [] : ['Invalid property details'],
      timestamp: new Date().toISOString()
    });
  }

  _handleGetBatchStatus(req, res) {
    const { batchId } = req.params;

    const batchInfo = this.batches.get(batchId);

    if (!batchInfo) {
      return res.status(404).json({
        error: true,
        error_code: 'BATCH_NOT_FOUND',
        message: `Batch ${batchId} not found`
      });
    }

    // Build status response
    const statusResponse = {
      batch_id: batchId,
      status: batchInfo.status,
      message: this._getStatusMessage(batchInfo.status),
      processing_date: this._formatDateUK(batchInfo.createdAt),
      completion_date: batchInfo.completedAt ? this._formatDateUK(batchInfo.completedAt) : null
    };

    // Add DAN if deposit is completed
    if (batchInfo.status === 'Completed' && batchInfo.dan) {
      statusResponse.dan = batchInfo.dan;
      statusResponse.dan_number = batchInfo.dan;
    }

    // Add deposit details
    if (batchInfo.payload?.tenancy) {
      const tenancy = batchInfo.payload.tenancy;
      statusResponse.deposit_amount = tenancy.deposit_amount || '0';
      statusResponse.tenancy_start_date = tenancy.tenancy_start_date || null;
      statusResponse.tenancy_end_date = tenancy.tenancy_expected_end_date || null;
    }

    // Add errors if failed
    if (batchInfo.status === 'Failed') {
      statusResponse.errors = ['Validation failed', 'Invalid property postcode'];
    } else {
      statusResponse.errors = [];
    }

    statusResponse.warnings = [];
    statusResponse.last_updated = new Date().toISOString();

    res.json(statusResponse);
  }

  _validateDepositRequest(payload) {
    const errors = [];

    if (!payload) {
      errors.push('Request body is required');
      return { valid: false, errors };
    }

    if (!payload.tenancy) {
      errors.push('tenancy object is required');
      return { valid: false, errors };
    }

    const tenancy = payload.tenancy;

    // Required fields
    const requiredFields = [
      'property_postcode',
      'tenancy_start_date',
      'deposit_amount',
      'people'
    ];

    for (const field of requiredFields) {
      if (!tenancy[field]) {
        errors.push(`${field} is required`);
      }
    }

    // Validate people array
    if (tenancy.people && !Array.isArray(tenancy.people)) {
      errors.push('people must be an array');
    } else if (!tenancy.people || tenancy.people.length === 0) {
      errors.push('At least one person (landlord or tenant) is required');
    }

    // Validate date format (DD-MM-YYYY)
    const datePattern = /^\d{2}-\d{2}-\d{4}$/;
    if (tenancy.tenancy_start_date && !datePattern.test(tenancy.tenancy_start_date)) {
      errors.push('tenancy_start_date must be in DD-MM-YYYY format');
    }

    // Validate postcode format
    if (tenancy.property_postcode && tenancy.property_postcode.length < 5) {
      errors.push('Invalid postcode format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  _generateDAN() {
    const prefix = 'DAN';
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}${random}`;
  }

  _formatDateUK(isoDate) {
    if (!isoDate) return null;

    const date = new Date(isoDate);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
  }

  _getStatusMessage(status) {
    const messages = {
      'Submitted': 'Deposit has been submitted and is awaiting processing',
      'Processing': 'Deposit is currently being processed',
      'Completed': 'Deposit has been successfully created',
      'Failed': 'Deposit creation failed'
    };

    return messages[status] || 'Unknown status';
  }

  // Public methods for test control

  /**
   * Start the mock API server
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.log(`[Mock Salesforce API] Server started on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`[Mock Salesforce API] Port ${this.port} is already in use`);
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the mock API server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Mock Salesforce API] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Clear all stored batches
   */
  clearBatches() {
    this.batches.clear();
    console.log('[Mock Salesforce API] All batches cleared');
  }

  /**
   * Get stored batch information
   */
  getBatch(batchId) {
    return this.batches.get(batchId);
  }

  /**
   * Manually set batch status (for testing)
   */
  setBatchStatus(batchId, status, dan = null) {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.status = status;
      if (dan) {
        batch.dan = dan;
      }
      if (status === 'Completed') {
        batch.completedAt = new Date().toISOString();
      }
      console.log(`[Mock Salesforce API] Batch ${batchId} status set to ${status}`);
    }
  }

  /**
   * Configure error rate dynamically
   */
  setErrorRate(rate) {
    if (rate >= 0 && rate <= 1) {
      this.config.errorRate = rate;
      console.log(`[Mock Salesforce API] Error rate set to ${rate * 100}%`);
    }
  }

  /**
   * Configure delay dynamically
   */
  setDelay(delayMs) {
    if (delayMs >= 0) {
      this.config.baseDelay = delayMs;
      console.log(`[Mock Salesforce API] Base delay set to ${delayMs}ms`);
    }
  }

  /**
   * Get server URL
   */
  getUrl() {
    return `http://localhost:${this.port}`;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalBatches: this.batches.size,
      config: this.config,
      port: this.port,
      isRunning: this.server !== null
    };
  }
}

// Factory function for easy instantiation
function createMockSalesforceAPI(options) {
  return new MockSalesforceAPI(options);
}

module.exports = {
  MockSalesforceAPI,
  createMockSalesforceAPI
};
