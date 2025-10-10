# Testing Guide - TDS Integration Platform

## Quick Start

### Install Dependencies

```bash
# Install Azure Functions dependencies
cd azure-functions
npm install

# Install testing dependencies
cd ../testing
npm install
```

### Run All Tests

```bash
# From azure-functions directory
cd azure-functions
npm test

# From testing directory
cd testing
npm test
```

---

## Test Categories

### 1. Unit Tests

Located in `__tests__` directories alongside source code.

**Run unit tests:**
```bash
cd azure-functions
npm run test:unit
```

**Watch mode:**
```bash
npm run test:watch
```

**With coverage:**
```bash
npm run test:coverage
```

**Test files:**
- `transformers/__tests__/legacy-to-salesforce.test.js`
- `transformers/__tests__/salesforce-to-legacy.test.js`
- `shared/__tests__/salesforce-auth.test.js`
- `shared/__tests__/organization-credentials.test.js`
- `shared/__tests__/config-manager.test.js`

---

### 2. Integration Tests

Located in `testing/integration/` directory.

**Run integration tests:**
```bash
cd testing
npm run test:integration
```

**Test files:**
- `integration/tds-request-forwarder.test.js`

---

## Mock Services

### Mock Salesforce API

Simulates the Salesforce EWC TDS API for testing.

**Start mock server:**
```bash
cd testing
npm run start:mock-salesforce
```

**Features:**
- Create deposit endpoint: `POST /api/tds/v1/deposits`
- Status endpoint: `GET /api/tds/v1/deposits/status/:batchId`
- Health endpoint: `GET /health`
- OAuth2 endpoint: `POST /services/oauth2/token`

**Configuration:**
```javascript
const mockAPI = createMockSalesforceAPI({
  port: 3001,
  baseDelay: 100,        // Response delay in ms
  errorRate: 0,          // 0-1 (0% to 100% errors)
  processingDelay: 2000, // Time for slow processing
  enableAuth: false,     // Enable/disable auth checking
  strictValidation: true // Enable/disable payload validation
});
```

**Special postcodes for testing:**
- `FAIL*` - Triggers deposit failure
- `SLOW*` - Triggers slow processing (2 second delay)
- Normal postcode - Immediate success

---

## Running Specific Tests

### Run single test file

```bash
npm test -- legacy-to-salesforce.test.js
```

### Run tests matching pattern

```bash
npm test -- --testNamePattern="should convert"
```

### Run tests for specific module

```bash
npm test -- salesforce-auth
```

### Debug tests

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Test Environment Setup

### Required Environment Variables

```bash
# For unit tests (mocked)
ENCRYPTION_SECRET=test-encryption-secret-key-12345
SALESFORCE_AUTH_METHOD=api-key
SALESFORCE_API_KEY=test-api-key

# For integration tests
TDS_SALESFORCE_BASE_URL=http://localhost:3001
TDS_ROUTING_MODE=salesforce-only
```

### Mock Configuration

Tests automatically mock:
- `axios` - HTTP requests
- `mssql` - Database connections
- `@azure/identity` - Azure credentials
- `@azure/keyvault-secrets` - Key Vault access

---

## Coverage Reports

### Generate coverage report

```bash
npm run test:coverage
```

### View coverage report

```bash
# HTML report (opens in browser)
open coverage/lcov-report/index.html

# Or on Windows
start coverage/lcov-report/index.html
```

### Coverage thresholds

Configured in `package.json`:
- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

---

## Test Writing Guide

### Unit Test Template

```javascript
describe('Module Name', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    jest.clearAllMocks();
  });

  describe('Feature Name', () => {
    test('should do something specific', () => {
      // Arrange
      const input = 'test-input';

      // Act
      const result = functionUnderTest(input, mockContext);

      // Assert
      expect(result).toBe('expected-output');
      expect(mockContext.log).toHaveBeenCalled();
    });

    test('should handle error case', () => {
      expect(() => {
        functionUnderTest(null, mockContext);
      }).toThrow('Expected error message');
    });
  });
});
```

### Integration Test Template

```javascript
describe('Integration Test Name', () => {
  let mockServer;

  beforeAll(async () => {
    mockServer = createMockSalesforceAPI({ port: 3001 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  beforeEach(() => {
    mockServer.clearBatches();
  });

  test('should complete end-to-end flow', async () => {
    // Arrange
    const payload = { /* test payload */ };

    // Act
    const response = await axios.post(
      `${mockServer.getUrl()}/api/tds/v1/deposits`,
      payload
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('batch_id');
  });
});
```

---

## Continuous Integration

### GitHub Actions

Tests run automatically on:
- Push to main branch
- Pull requests
- Manual workflow dispatch

### Local CI Simulation

```bash
# Run complete test suite like CI
npm run test:coverage && npm run lint
```

---

## Troubleshooting

### Tests are slow

```bash
# Run tests in parallel (default)
npm test

# Run tests serially (for debugging)
npm test -- --runInBand

# Run specific test file
npm test -- filename.test.js
```

### Mock not working

```bash
# Clear all mocks
jest.clearAllMocks()

# Reset all mocks
jest.resetAllMocks()

# Restore all mocks
jest.restoreMocks()
```

### Port already in use

```bash
# Kill process on port 3001
npx kill-port 3001

# Or change port in test
mockAPI = createMockSalesforceAPI({ port: 3002 });
```

### Test timeout

```bash
# Increase timeout for specific test
test('slow test', async () => {
  // test code
}, 30000); // 30 second timeout

# Or globally in jest.config
"testTimeout": 30000
```

---

## Best Practices

### ✓ Do's

- Write tests before or alongside code (TDD)
- Test both success and failure paths
- Use descriptive test names
- Keep tests isolated and independent
- Mock external dependencies
- Clean up resources in afterEach/afterAll
- Use beforeEach for common setup

### ✗ Don'ts

- Don't test implementation details
- Don't make tests dependent on each other
- Don't use real API keys or secrets
- Don't commit .only() or .skip()
- Don't write overly complex tests
- Don't test third-party libraries

---

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://testingjavascript.com/)
- [Test Coverage Summary](./TEST_COVERAGE_SUMMARY.md)

---

## Support

For questions or issues:
1. Check the troubleshooting section above
2. Review test logs for error details
3. Check mock server is running (for integration tests)
4. Verify environment variables are set correctly
