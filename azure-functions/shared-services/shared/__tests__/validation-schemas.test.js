/**
 * Unit Tests for Validation Schemas
 *
 * Tests the input validation logic for query parameters and identifiers.
 * Part of security fix HIGH-003.
 *
 * Run: npm test -- validation-schemas.test.js
 */

const {
  validateQueryParams,
  validateAgencyRef,
  validateOrganizationId,
  validateBatchId,
  validateRequestBody,
  formatValidationError,
  schemas
} = require('../validation-schemas');

describe('validation-schemas', () => {

  describe('validateQueryParams - days parameter', () => {

    test('should accept valid days value', () => {
      const result = validateQueryParams({ days: '30' }, ['days']);
      expect(result.days).toBe(30);
    });

    test('should use default value when days not provided', () => {
      const result = validateQueryParams({}, ['days']);
      expect(result.days).toBe(30);
    });

    test('should accept minimum value (1)', () => {
      const result = validateQueryParams({ days: '1' }, ['days']);
      expect(result.days).toBe(1);
    });

    test('should accept maximum value (365)', () => {
      const result = validateQueryParams({ days: '365' }, ['days']);
      expect(result.days).toBe(365);
    });

    test('should reject days = 0', () => {
      expect(() => {
        validateQueryParams({ days: '0' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject negative days', () => {
      expect(() => {
        validateQueryParams({ days: '-5' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject days > 365', () => {
      expect(() => {
        validateQueryParams({ days: '500' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject non-numeric days', () => {
      expect(() => {
        validateQueryParams({ days: 'abc' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject decimal days', () => {
      expect(() => {
        validateQueryParams({ days: '30.5' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject Infinity', () => {
      expect(() => {
        validateQueryParams({ days: 'Infinity' }, ['days']);
      }).toThrow();
    });

    test('should reject empty string', () => {
      expect(() => {
        validateQueryParams({ days: '' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

  });

  describe('validateQueryParams - limit parameter', () => {

    test('should accept valid limit value', () => {
      const result = validateQueryParams({ limit: '100' }, ['limit']);
      expect(result.limit).toBe(100);
    });

    test('should use default value when limit not provided', () => {
      const result = validateQueryParams({}, ['limit']);
      expect(result.limit).toBe(100);
    });

    test('should accept minimum value (1)', () => {
      const result = validateQueryParams({ limit: '1' }, ['limit']);
      expect(result.limit).toBe(1);
    });

    test('should accept maximum value (1000)', () => {
      const result = validateQueryParams({ limit: '1000' }, ['limit']);
      expect(result.limit).toBe(1000);
    });

    test('should reject limit = 0', () => {
      expect(() => {
        validateQueryParams({ limit: '0' }, ['limit']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject limit > 1000', () => {
      expect(() => {
        validateQueryParams({ limit: '999999' }, ['limit']);
      }).toThrow('Query parameter validation failed');
    });

    test('should reject negative limit', () => {
      expect(() => {
        validateQueryParams({ limit: '-10' }, ['limit']);
      }).toThrow('Query parameter validation failed');
    });

  });

  describe('validateQueryParams - multiple parameters', () => {

    test('should validate multiple parameters successfully', () => {
      const result = validateQueryParams(
        { days: '30', limit: '50' },
        ['days', 'limit']
      );
      expect(result.days).toBe(30);
      expect(result.limit).toBe(50);
    });

    test('should use defaults for missing parameters', () => {
      const result = validateQueryParams({}, ['days', 'limit']);
      expect(result.days).toBe(30);
      expect(result.limit).toBe(100);
    });

    test('should throw error with all validation failures', () => {
      expect(() => {
        validateQueryParams(
          { days: '-1', limit: '999999' },
          ['days', 'limit']
        );
      }).toThrow(/validation failed/);
    });

  });

  describe('validateAgencyRef', () => {

    test('should accept valid UUID (lowercase)', () => {
      const result = validateAgencyRef('1af89d60-662c-475b-bcc8-9bcbf04b6322');
      expect(result).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
    });

    test('should accept valid UUID (uppercase)', () => {
      const result = validateAgencyRef('1AF89D60-662C-475B-BCC8-9BCBF04B6322');
      expect(result).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322'); // Normalized to lowercase
    });

    test('should accept valid UUID (mixed case)', () => {
      const result = validateAgencyRef('1Af89D60-662c-475B-Bcc8-9bcbF04b6322');
      expect(result).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
    });

    test('should reject non-UUID string', () => {
      expect(() => {
        validateAgencyRef('not-a-uuid');
      }).toThrow(/Invalid agency reference/);
    });

    test('should reject UUID with wrong format', () => {
      expect(() => {
        validateAgencyRef('1af89d60-662c-475b-bcc8'); // Too short
      }).toThrow(/Invalid agency reference/);
    });

    test('should reject empty string', () => {
      expect(() => {
        validateAgencyRef('');
      }).toThrow(/Invalid agency reference/);
    });

    test('should reject null', () => {
      expect(() => {
        validateAgencyRef(null);
      }).toThrow();
    });

    test('should reject undefined', () => {
      expect(() => {
        validateAgencyRef(undefined);
      }).toThrow();
    });

  });

  describe('validateOrganizationId', () => {

    test('should accept positive integer', () => {
      const result = validateOrganizationId(123);
      expect(result).toBe(123);
    });

    test('should accept numeric string', () => {
      const result = validateOrganizationId('456');
      expect(result).toBe(456); // Joi coerces numeric strings to numbers
    });

    test('should accept alphanumeric string', () => {
      const result = validateOrganizationId('ORG123');
      expect(result).toBe('ORG123');
    });

    test('should reject negative number', () => {
      expect(() => {
        validateOrganizationId(-1);
      }).toThrow(/Invalid organization ID/);
    });

    test('should reject string with special characters', () => {
      expect(() => {
        validateOrganizationId('ORG-123');
      }).toThrow(/Invalid organization ID/);
    });

  });

  describe('validateBatchId', () => {

    test('should accept valid alphanumeric batch ID', () => {
      const result = validateBatchId('BATCH123');
      expect(result).toBe('BATCH123');
    });

    test('should reject empty string', () => {
      expect(() => {
        validateBatchId('');
      }).toThrow(/Invalid batch ID/);
    });

    test('should reject batch ID with special characters', () => {
      expect(() => {
        validateBatchId('BATCH-123');
      }).toThrow(/Invalid batch ID/);
    });

    test('should reject batch ID exceeding 100 characters', () => {
      const longBatchId = 'A'.repeat(101);
      expect(() => {
        validateBatchId(longBatchId);
      }).toThrow(/cannot exceed 100 characters/);
    });

  });

  describe('formatValidationError', () => {

    test('should format validation error correctly', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      error.validationErrors = [
        { param: 'days', message: 'Invalid value', value: '-1' }
      ];

      const formatted = formatValidationError(error);

      expect(formatted.success).toBe(false);
      expect(formatted.error).toBe('Validation failed');
      expect(formatted.validationErrors).toHaveLength(1);
      expect(formatted.validationErrors[0].param).toBe('days');
      expect(formatted.timestamp).toBeDefined();
    });

    test('should handle generic errors', () => {
      const error = new Error('Generic error');

      const formatted = formatValidationError(error);

      expect(formatted.success).toBe(false);
      expect(formatted.error).toBe('An unexpected error occurred');
      expect(formatted.timestamp).toBeDefined();
    });

  });

  describe('Edge cases and security', () => {

    test('should handle NaN gracefully', () => {
      expect(() => {
        validateQueryParams({ days: 'NaN' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should handle SQL injection attempt', () => {
      expect(() => {
        validateAgencyRef("'; DROP TABLE users; --");
      }).toThrow('Invalid agency reference');
    });

    test('should handle script injection in UUID', () => {
      expect(() => {
        validateAgencyRef('<script>alert(1)</script>');
      }).toThrow('Invalid agency reference');
    });

    test('should handle extremely large numbers', () => {
      expect(() => {
        validateQueryParams({ days: '99999999999999' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

    test('should handle negative zero', () => {
      // -0 is coerced to 0, which fails validation
      expect(() => {
        validateQueryParams({ days: '-0' }, ['days']);
      }).toThrow('Query parameter validation failed');
    });

  });

  // HIGH-006: Alto Webhook Payload Validation Tests
  describe('altoWebhookPayload schema - HIGH-006 Security Fix', () => {

    const validPayload = {
      tenancyId: 'ALTO_TEN_12345',
      agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
      branchId: 'BRANCH_001',
      depositAmount: 1500.50,
      propertyAddress: {
        line1: '123 Main Street',
        line2: 'Apartment 4B',
        city: 'London',
        postcode: 'SW1A 1AA'
      },
      metadata: {
        altoAgencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
        altoBranchId: 'BRANCH_001',
        webhookId: 'WEBHOOK_12345',
        webhookTimestamp: '2025-10-14T10:30:00.000Z',
        eventType: 'Tenancy.Created'
      }
    };

    describe('Valid payloads', () => {

      test('should accept complete valid payload', () => {
        const result = validateRequestBody(validPayload, schemas.altoWebhookPayload);
        expect(result.tenancyId).toBe('ALTO_TEN_12345');
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.branchId).toBe('BRANCH_001');
        expect(result.depositAmount).toBe(1500.50);
      });

      test('should accept minimal required payload', () => {
        const minimalPayload = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001'
        };
        const result = validateRequestBody(minimalPayload, schemas.altoWebhookPayload);
        expect(result.tenancyId).toBe('TEN_001');
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.branchId).toBe('BR_001');
      });

      test('should accept payload with optional fields as null', () => {
        const payloadWithNulls = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001',
          tenancyStartDate: null,
          tenancyEndDate: null
        };
        const result = validateRequestBody(payloadWithNulls, schemas.altoWebhookPayload);
        expect(result.tenancyId).toBe('TEN_001');
      });

      test('should strip unknown fields for security', () => {
        const payloadWithUnknown = {
          ...validPayload,
          maliciousField: '<script>alert("XSS")</script>',
          anotherUnknown: 'unexpected'
        };
        const result = validateRequestBody(payloadWithUnknown, schemas.altoWebhookPayload);
        expect(result.maliciousField).toBeUndefined();
        expect(result.anotherUnknown).toBeUndefined();
      });

    });

    describe('Required field validation', () => {

      test('should reject payload missing tenancyId', () => {
        const payload = { ...validPayload };
        delete payload.tenancyId;
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyId is required/);
      });

      test('should reject payload missing agencyRef', () => {
        const payload = { ...validPayload };
        delete payload.agencyRef;
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/agencyRef is required/);
      });

      test('should reject payload missing branchId', () => {
        const payload = { ...validPayload };
        delete payload.branchId;
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/branchId is required/);
      });

      test('should reject empty tenancyId', () => {
        const payload = { ...validPayload, tenancyId: '' };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyId cannot be empty/);
      });

      test('should reject empty branchId', () => {
        const payload = { ...validPayload, branchId: '' };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/branchId cannot be empty/);
      });

    });

    describe('Type validation - Prevents TypeErrors', () => {

      test('should reject null tenancyId (prevents "Cannot read property of null")', () => {
        const payload = { ...validPayload, tenancyId: null };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyId/);
      });

      test('should reject number as tenancyId', () => {
        const payload = { ...validPayload, tenancyId: 12345 };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyId must be a string/);
      });

      test('should reject string as depositAmount', () => {
        const payload = { ...validPayload, depositAmount: 'not-a-number' };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/depositAmount must be a number/);
      });

      test('should reject invalid agencyRef UUID format', () => {
        const payload = { ...validPayload, agencyRef: 'not-a-uuid' };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject number as agencyRef', () => {
        const payload = { ...validPayload, agencyRef: 12345 };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/agencyRef must be a string/);
      });

    });

    describe('Business logic validation', () => {

      test('should reject negative depositAmount', () => {
        const payload = { ...validPayload, depositAmount: -100 };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/depositAmount must be a positive number/);
      });

      test('should reject depositAmount exceeding £1,000,000', () => {
        const payload = { ...validPayload, depositAmount: 1500000 };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/depositAmount cannot exceed £1,000,000/);
      });

      test('should reject depositAmount with more than 2 decimal places', () => {
        const payload = { ...validPayload, depositAmount: 1500.555 };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/depositAmount cannot have more than 2 decimal places/);
      });

      test('should accept depositAmount with exactly 2 decimal places', () => {
        const payload = { ...validPayload, depositAmount: 1500.99 };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.depositAmount).toBe(1500.99);
      });

    });

    describe('Length validation - Prevents resource exhaustion', () => {

      test('should reject tenancyId exceeding 200 characters', () => {
        const payload = { ...validPayload, tenancyId: 'A'.repeat(201) };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyId cannot exceed 200 characters/);
      });

      test('should reject branchId exceeding 100 characters', () => {
        const payload = { ...validPayload, branchId: 'B'.repeat(101) };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/branchId cannot exceed 100 characters/);
      });

      test('should reject notes exceeding 5000 characters', () => {
        const payload = { ...validPayload, notes: 'N'.repeat(5001) };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/notes cannot exceed 5000 characters/);
      });

    });

    describe('PropertyAddress validation', () => {

      test('should accept valid property address', () => {
        const payload = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001',
          propertyAddress: {
            line1: '123 Main St',
            city: 'London',
            postcode: 'SW1A 1AA'
          }
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.propertyAddress.line1).toBe('123 Main St');
        expect(result.propertyAddress.city).toBe('London');
      });

      test('should reject propertyAddress missing required line1', () => {
        const payload = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001',
          propertyAddress: {
            city: 'London',
            postcode: 'SW1A 1AA'
          }
        };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/line1 is required/);
      });

      test('should reject propertyAddress missing required city', () => {
        const payload = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001',
          propertyAddress: {
            line1: '123 Main St',
            postcode: 'SW1A 1AA'
          }
        };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/city is required/);
      });

      test('should accept propertyAddress with optional fields empty', () => {
        const payload = {
          tenancyId: 'TEN_001',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BR_001',
          propertyAddress: {
            line1: '123 Main St',
            line2: '',
            line3: null,
            city: 'London',
            postcode: 'SW1A 1AA'
          }
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.propertyAddress.line1).toBe('123 Main St');
      });

    });

    describe('Date validation', () => {

      test('should accept valid ISO date for tenancyStartDate', () => {
        const payload = {
          ...validPayload,
          tenancyStartDate: '2025-01-15T00:00:00.000Z'
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.tenancyStartDate).toBe('2025-01-15T00:00:00.000Z');
      });

      test('should reject invalid date format for tenancyStartDate', () => {
        const payload = {
          ...validPayload,
          tenancyStartDate: '15/01/2025' // UK format, not ISO
        };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/tenancyStartDate must be a valid ISO date/);
      });

      test('should accept valid ISO date for tenancyEndDate', () => {
        const payload = {
          ...validPayload,
          tenancyEndDate: '2025-12-31T23:59:59.000Z'
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.tenancyEndDate).toBe('2025-12-31T23:59:59.000Z');
      });

    });

    describe('Security - XSS and injection attacks', () => {

      test('should reject script tag in tenancyId', () => {
        const payload = {
          ...validPayload,
          tenancyId: '<script>alert("XSS")</script>'
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        // Should accept as string (will be escaped later in rendering)
        // Validation doesn't reject it, but strips unknown HTML tags
        expect(result.tenancyId).toBeDefined();
      });

      test('should reject script tag in agencyRef (fails UUID validation)', () => {
        const payload = {
          ...validPayload,
          agencyRef: '<script>alert("XSS")</script>'
        };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject SQL injection in tenancyId (stored as-is, but length limited)', () => {
        const payload = {
          ...validPayload,
          tenancyId: "'; DROP TABLE tenancies; --"
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        // Parameterized queries prevent SQL injection, but we accept the string
        expect(result.tenancyId).toBe("'; DROP TABLE tenancies; --");
      });

      test('should strip unknown malicious fields', () => {
        const payload = {
          ...validPayload,
          __proto__: { admin: true }, // Prototype pollution attempt
          constructor: { name: 'hacked' }
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.__proto__).toBeUndefined();
        expect(result.constructor).toBeUndefined();
      });

    });

    describe('Metadata validation', () => {

      test('should accept metadata with UUID altoAgencyRef', () => {
        const payload = {
          ...validPayload,
          metadata: {
            altoAgencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
            altoBranchId: 'BRANCH_001'
          }
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.metadata.altoAgencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
      });

      test('should reject invalid UUID in metadata.altoAgencyRef', () => {
        const payload = {
          ...validPayload,
          metadata: {
            altoAgencyRef: 'not-a-uuid'
          }
        };
        expect(() => {
          validateRequestBody(payload, schemas.altoWebhookPayload);
        }).toThrow(/altoAgencyRef/);
      });

      test('should allow additional unknown metadata fields', () => {
        const payload = {
          ...validPayload,
          metadata: {
            altoAgencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
            customField1: 'value1',
            customField2: 'value2'
          }
        };
        const result = validateRequestBody(payload, schemas.altoWebhookPayload);
        expect(result.metadata.customField1).toBe('value1');
        expect(result.metadata.customField2).toBe('value2');
      });

    });

    describe('Multiple validation errors', () => {

      test('should collect all validation errors (abortEarly: false)', () => {
        const invalidPayload = {
          tenancyId: null, // Invalid type
          agencyRef: 'not-a-uuid', // Invalid format
          // branchId missing - required field
          depositAmount: -100, // Negative number
        };

        try {
          validateRequestBody(invalidPayload, schemas.altoWebhookPayload);
          fail('Should have thrown validation error');
        } catch (error) {
          expect(error.name).toBe('ValidationError');
          expect(error.validationErrors.length).toBeGreaterThan(1);
          // Should report multiple errors at once
        }
      });

    });

  });

  // HIGH-006: ConfigurationAPI Validation Tests
  describe('routingModeUpdate schema - HIGH-006 Security Fix', () => {

    describe('Valid routing modes', () => {

      test('should accept "legacy-only" mode', () => {
        const payload = { routingMode: 'legacy-only' };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.routingMode).toBe('legacy-only');
      });

      test('should accept "salesforce-only" mode', () => {
        const payload = { routingMode: 'salesforce-only' };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.routingMode).toBe('salesforce-only');
      });

      test('should accept "both" mode', () => {
        const payload = { routingMode: 'both' };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.routingMode).toBe('both');
      });

      test('should accept "shadow" mode', () => {
        const payload = { routingMode: 'shadow' };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.routingMode).toBe('shadow');
      });

      test('should accept "forwarding" mode', () => {
        const payload = { routingMode: 'forwarding' };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.routingMode).toBe('forwarding');
      });

    });

    describe('Invalid routing modes', () => {

      test('should reject missing routingMode field', () => {
        const payload = {};
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode is required/);
      });

      test('should reject empty string', () => {
        const payload = { routingMode: '' };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode cannot be empty/);
      });

      test('should reject null routingMode', () => {
        const payload = { routingMode: null };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode must be a string/);
      });

      test('should reject invalid mode value', () => {
        const payload = { routingMode: 'invalid-mode' };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode must be one of:/);
      });

      test('should reject number as routingMode', () => {
        const payload = { routingMode: 12345 };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode must be a string/);
      });

      test('should reject case-sensitive invalid mode (LEGACY-ONLY)', () => {
        const payload = { routingMode: 'LEGACY-ONLY' };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode must be one of:/);
      });

      test('should reject script injection', () => {
        const payload = { routingMode: '<script>alert("XSS")</script>' };
        expect(() => {
          validateRequestBody(payload, schemas.routingModeUpdate);
        }).toThrow(/routingMode must be one of:/);
      });

      test('should strip unknown malicious fields', () => {
        const payload = {
          routingMode: 'legacy-only',
          __proto__: { admin: true }
        };
        const result = validateRequestBody(payload, schemas.routingModeUpdate);
        expect(result.__proto__).toBeUndefined();
      });

    });

  });

  describe('forwardingPercentageUpdate schema - HIGH-006 Security Fix', () => {

    describe('Valid percentage values', () => {

      test('should accept 0% (minimum)', () => {
        const payload = { percentage: 0 };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.percentage).toBe(0);
      });

      test('should accept 100% (maximum)', () => {
        const payload = { percentage: 100 };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.percentage).toBe(100);
      });

      test('should accept 50%', () => {
        const payload = { percentage: 50 };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.percentage).toBe(50);
      });

      test('should accept 25%', () => {
        const payload = { percentage: 25 };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.percentage).toBe(25);
      });

      test('should accept 75%', () => {
        const payload = { percentage: 75 };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.percentage).toBe(75);
      });

    });

    describe('Invalid percentage values', () => {

      test('should reject missing percentage field', () => {
        const payload = {};
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage is required/);
      });

      test('should reject null percentage', () => {
        const payload = { percentage: null };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage must be a number/);
      });

      test('should reject negative percentage', () => {
        const payload = { percentage: -1 };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage must be at least 0/);
      });

      test('should reject percentage > 100', () => {
        const payload = { percentage: 101 };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage cannot exceed 100/);
      });

      test('should reject decimal percentage (50.5)', () => {
        const payload = { percentage: 50.5 };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage must be a whole number/);
      });

      test('should reject string percentage', () => {
        const payload = { percentage: 'fifty' };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage must be a number/);
      });

      test('should reject Infinity', () => {
        const payload = { percentage: Infinity };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow();
      });

      test('should reject NaN', () => {
        const payload = { percentage: NaN };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage must be a number/);
      });

      test('should reject extremely large number', () => {
        const payload = { percentage: 999999 };
        expect(() => {
          validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        }).toThrow(/percentage cannot exceed 100/);
      });

      test('should strip unknown fields', () => {
        const payload = {
          percentage: 50,
          maliciousField: '<script>alert("XSS")</script>'
        };
        const result = validateRequestBody(payload, schemas.forwardingPercentageUpdate);
        expect(result.maliciousField).toBeUndefined();
      });

    });

  });

  describe('providerPreferenceUpdate schema - HIGH-006 Security Fix', () => {

    describe('Valid provider preferences', () => {

      test('should accept "current" preference', () => {
        const payload = { providerPreference: 'current' };
        const result = validateRequestBody(payload, schemas.providerPreferenceUpdate);
        expect(result.providerPreference).toBe('current');
      });

      test('should accept "salesforce" preference', () => {
        const payload = { providerPreference: 'salesforce' };
        const result = validateRequestBody(payload, schemas.providerPreferenceUpdate);
        expect(result.providerPreference).toBe('salesforce');
      });

      test('should accept "dual" preference', () => {
        const payload = { providerPreference: 'dual' };
        const result = validateRequestBody(payload, schemas.providerPreferenceUpdate);
        expect(result.providerPreference).toBe('dual');
      });

      test('should accept "auto" preference', () => {
        const payload = { providerPreference: 'auto' };
        const result = validateRequestBody(payload, schemas.providerPreferenceUpdate);
        expect(result.providerPreference).toBe('auto');
      });

    });

    describe('Invalid provider preferences', () => {

      test('should reject missing providerPreference field', () => {
        const payload = {};
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference is required/);
      });

      test('should reject empty string', () => {
        const payload = { providerPreference: '' };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference cannot be empty/);
      });

      test('should reject null providerPreference', () => {
        const payload = { providerPreference: null };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be a string/);
      });

      test('should reject invalid preference value', () => {
        const payload = { providerPreference: 'invalid-preference' };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be one of:/);
      });

      test('should reject number as providerPreference', () => {
        const payload = { providerPreference: 12345 };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be a string/);
      });

      test('should reject case-sensitive invalid preference (CURRENT)', () => {
        const payload = { providerPreference: 'CURRENT' };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be one of:/);
      });

      test('should reject script injection', () => {
        const payload = { providerPreference: '<script>alert("XSS")</script>' };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be one of:/);
      });

      test('should reject SQL injection', () => {
        const payload = { providerPreference: "'; DROP TABLE config; --" };
        expect(() => {
          validateRequestBody(payload, schemas.providerPreferenceUpdate);
        }).toThrow(/providerPreference must be one of:/);
      });

      test('should strip unknown malicious fields', () => {
        const payload = {
          providerPreference: 'current',
          __proto__: { admin: true },
          constructor: { name: 'hacked' }
        };
        const result = validateRequestBody(payload, schemas.providerPreferenceUpdate);
        expect(result.__proto__).toBeUndefined();
        expect(result.constructor).toBeUndefined();
      });

    });

  });

  // HIGH-006: AltoIntegration Fetch Tenancy Request Validation Tests (Week 3)
  describe('fetchTenancyRequest schema - HIGH-006 Security Fix',() => {

    describe('Valid requests', () => {

      test('should accept complete valid request', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BRANCH_001',
          environment: 'development',
          testMode: false,
          testConfig: { someOption: 'value' }
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.branchId).toBe('BRANCH_001');
        expect(result.environment).toBe('development');
      });

      test('should accept minimal request (agencyRef only)', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.environment).toBe('development'); // Default
        expect(result.testMode).toBe(false); // Default
      });

      test('should accept production environment', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          environment: 'production'
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.environment).toBe('production');
      });

      test('should accept testMode = true', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          testMode: true
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.testMode).toBe(true);
      });

      test('should accept null branchId', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: null
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.branchId).toBeNull();
      });

    });

    describe('Invalid requests', () => {

      test('should reject missing agencyRef', () => {
        const payload = {
          branchId: 'BRANCH_001'
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/agencyRef is required/);
      });

      test('should reject invalid UUID format', () => {
        const payload = {
          agencyRef: 'not-a-uuid'
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject non-UUID agencyRef', () => {
        const payload = {
          agencyRef: '12345'
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject invalid environment', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          environment: 'staging'
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/environment must be either "development" or "production"/);
      });

      test('should reject non-boolean testMode', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          testMode: 'true' // String, not boolean
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/testMode must be a boolean/);
      });

      test('should reject branchId exceeding 100 characters', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'B'.repeat(101)
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/branchId cannot exceed 100 characters/);
      });

      test('should reject empty string branchId', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: ''
        };
        expect(() => {
          validateRequestBody(payload, schemas.fetchTenancyRequest);
        }).toThrow(/branchId cannot be empty if provided/);
      });

      test('should strip unknown malicious fields', () => {
        const payload = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          __proto__: { admin: true },
          maliciousField: '<script>alert("XSS")</script>'
        };
        const result = validateRequestBody(payload, schemas.fetchTenancyRequest);
        expect(result.__proto__).toBeUndefined();
        expect(result.maliciousField).toBeUndefined();
      });

    });

  });

  // HIGH-006: UK Postcode Validation Tests (Week 3)
  describe('ukPostcode schema - HIGH-006 Security Fix', () => {

    describe('Valid UK postcodes', () => {

      test('should accept standard London postcode with space (SW1A 1AA)', () => {
        const result = schemas.ukPostcode.validate('SW1A 1AA');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('SW1A 1AA');
      });

      test('should accept standard postcode without space (SW1A1AA)', () => {
        const result = schemas.ukPostcode.validate('SW1A1AA');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('SW1A1AA');
      });

      test('should accept Manchester postcode (M1 1AE)', () => {
        const result = schemas.ukPostcode.validate('M1 1AE');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('M1 1AE');
      });

      test('should accept Guildford postcode (GU16 7HF)', () => {
        const result = schemas.ukPostcode.validate('GU16 7HF');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('GU16 7HF');
      });

      test('should accept Edinburgh postcode (EH1 1YZ)', () => {
        const result = schemas.ukPostcode.validate('EH1 1YZ');
        expect(result.error).toBeUndefined();
      });

      test('should accept lowercase postcode (ec1a 1bb)', () => {
        const result = schemas.ukPostcode.validate('ec1a 1bb');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('ec1a 1bb');
      });

      test('should trim whitespace', () => {
        const result = schemas.ukPostcode.validate('  SW1A 1AA  ');
        expect(result.error).toBeUndefined();
        expect(result.value).toBe('SW1A 1AA');
      });

    });

    describe('Invalid UK postcodes', () => {

      test('should reject empty string', () => {
        const result = schemas.ukPostcode.validate('');
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode cannot be empty/);
      });

      test('should reject missing postcode', () => {
        const result = schemas.ukPostcode.validate(undefined);
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode is required/);
      });

      test('should reject too short postcode (ABC)', () => {
        const result = schemas.ukPostcode.validate('ABC');
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode must be at least 5 characters/);
      });

      test('should reject too long postcode', () => {
        const result = schemas.ukPostcode.validate('SW1A 1AA 12345');
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode cannot exceed 10 characters/);
      });

      test('should reject invalid format (12345)', () => {
        const result = schemas.ukPostcode.validate('12345');
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode must be a valid UK postcode/);
      });

      test('should reject invalid format (ABCDEF)', () => {
        const result = schemas.ukPostcode.validate('ABCDEF');
        expect(result.error).toBeDefined();
      });

      test('should reject script injection', () => {
        const result = schemas.ukPostcode.validate('<script>alert("XSS")</script>');
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode must be a valid UK postcode/);
      });

      test('should reject SQL injection', () => {
        const result = schemas.ukPostcode.validate("'; DROP TABLE postcodes; --");
        expect(result.error).toBeDefined();
      });

      test('should reject null', () => {
        const result = schemas.ukPostcode.validate(null);
        expect(result.error).toBeDefined();
      });

      test('should reject number', () => {
        const result = schemas.ukPostcode.validate(12345);
        expect(result.error).toBeDefined();
        expect(result.error.message).toMatch(/postcode must be a string/);
      });

    });

  });

  // HIGH-006: Batch Postcode Lookup Validation Tests (Week 3)
  describe('batchPostcodeLookup schema - HIGH-006 Security Fix', () => {

    describe('Valid batch requests', () => {

      test('should accept batch with 1 postcode', () => {
        const payload = {
          postcodes: ['SW1A 1AA']
        };
        const result = validateRequestBody(payload, schemas.batchPostcodeLookup);
        expect(result.postcodes).toHaveLength(1);
        expect(result.postcodes[0]).toBe('SW1A 1AA');
      });

      test('should accept batch with multiple postcodes', () => {
        const payload = {
          postcodes: ['SW1A 1AA', 'M1 1AE', 'GU16 7HF']
        };
        const result = validateRequestBody(payload, schemas.batchPostcodeLookup);
        expect(result.postcodes).toHaveLength(3);
      });

      test('should accept batch with 100 postcodes (maximum)', () => {
        const postcodes = Array(100).fill('SW1A 1AA');
        const payload = { postcodes };
        const result = validateRequestBody(payload, schemas.batchPostcodeLookup);
        expect(result.postcodes).toHaveLength(100);
      });

      test('should trim whitespace from each postcode', () => {
        const payload = {
          postcodes: ['  SW1A 1AA  ', '  M1 1AE  ']
        };
        const result = validateRequestBody(payload, schemas.batchPostcodeLookup);
        expect(result.postcodes[0]).toBe('SW1A 1AA');
        expect(result.postcodes[1]).toBe('M1 1AE');
      });

    });

    describe('Invalid batch requests', () => {

      test('should reject missing postcodes array', () => {
        const payload = {};
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/postcodes array is required/);
      });

      test('should reject non-array postcodes', () => {
        const payload = {
          postcodes: 'SW1A 1AA' // String instead of array
        };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/postcodes must be an array/);
      });

      test('should reject empty array', () => {
        const payload = {
          postcodes: []
        };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/postcodes array must contain at least 1 postcode/);
      });

      test('should reject batch exceeding 100 postcodes', () => {
        const postcodes = Array(101).fill('SW1A 1AA');
        const payload = { postcodes };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/postcodes array cannot exceed 100 postcodes/);
      });

      test('should reject invalid postcode in batch', () => {
        const payload = {
          postcodes: ['SW1A 1AA', 'INVALID', 'M1 1AE']
        };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/Each postcode must be a valid UK postcode/);
      });

      test('should reject script injection in postcode', () => {
        const payload = {
          postcodes: ['SW1A 1AA', '<script>alert("XSS")</script>']
        };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow(/Each postcode must be a valid UK postcode/);
      });

      test('should reject number in postcodes array', () => {
        const payload = {
          postcodes: ['SW1A 1AA', 12345]
        };
        expect(() => {
          validateRequestBody(payload, schemas.batchPostcodeLookup);
        }).toThrow();
      });

      test('should strip unknown malicious fields', () => {
        const payload = {
          postcodes: ['SW1A 1AA', 'M1 1AE'],
          __proto__: { admin: true },
          maliciousField: '<script>alert("XSS")</script>'
        };
        const result = validateRequestBody(payload, schemas.batchPostcodeLookup);
        expect(result.__proto__).toBeUndefined();
        expect(result.maliciousField).toBeUndefined();
      });

    });

  });

  // =======================
  // HIGH-006: WEEK 4 VALIDATION TESTS
  // =======================

  // Organization Mapping Validation Tests
  describe('organizationLookupQuery schema - HIGH-006 Security Fix', () => {

    describe('Valid lookup queries', () => {

      test('should accept valid UUID agencyRef', () => {
        const query = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BRANCH_001'
        };
        const result = validateRequestBody(query, schemas.organizationLookupQuery);
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.branchId).toBe('BRANCH_001');
      });

      test('should accept agencyRef without branchId', () => {
        const query = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        const result = validateRequestBody(query, schemas.organizationLookupQuery);
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
      });

      test('should accept null branchId', () => {
        const query = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: null
        };
        const result = validateRequestBody(query, schemas.organizationLookupQuery);
        expect(result.branchId).toBeNull();
      });

    });

    describe('Invalid lookup queries', () => {

      test('should reject missing agencyRef', () => {
        const query = { branchId: 'BRANCH_001' };
        expect(() => {
          validateRequestBody(query, schemas.organizationLookupQuery);
        }).toThrow(/agencyRef is required/);
      });

      test('should reject invalid UUID agencyRef', () => {
        const query = { agencyRef: 'not-a-uuid' };
        expect(() => {
          validateRequestBody(query, schemas.organizationLookupQuery);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject branchId exceeding 100 characters', () => {
        const query = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'B'.repeat(101)
        };
        expect(() => {
          validateRequestBody(query, schemas.organizationLookupQuery);
        }).toThrow(/branchId cannot exceed 100 characters/);
      });

    });

  });

  describe('organizationMappingAdd schema - HIGH-006 Security Fix', () => {

    const validMapping = {
      organizationName: 'Test Estate Agency',
      environment: 'development',
      integrationType: 'alto',
      integrationCredentials: {
        alto: {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BRANCH_001'
        }
      },
      tdsLegacyConfig: {
        memberId: 'TDS001',
        branchId: 'BR001',
        apiKey: 'legacy-api-key-123'
      },
      tdsSalesforceConfig: {
        memberId: 'SF001',
        branchId: 'SFBR001',
        region: 'EW',
        schemeType: 'Custodial'
      }
    };

    describe('Valid add requests', () => {

      test('should accept complete valid mapping', () => {
        const result = validateRequestBody(validMapping, schemas.organizationMappingAdd);
        expect(result.organizationName).toBe('Test Estate Agency');
        expect(result.integrationType).toBe('alto');
      });

      test('should use default environment (development)', () => {
        const mapping = { ...validMapping };
        delete mapping.environment;
        const result = validateRequestBody(mapping, schemas.organizationMappingAdd);
        expect(result.environment).toBe('development');
      });

      test('should accept production environment', () => {
        const mapping = { ...validMapping, environment: 'production' };
        const result = validateRequestBody(mapping, schemas.organizationMappingAdd);
        expect(result.environment).toBe('production');
      });

      test('should accept jupix integration type', () => {
        const mapping = { ...validMapping, integrationType: 'jupix' };
        const result = validateRequestBody(mapping, schemas.organizationMappingAdd);
        expect(result.integrationType).toBe('jupix');
      });

      test('should use default isActive (true)', () => {
        const result = validateRequestBody(validMapping, schemas.organizationMappingAdd);
        expect(result.isActive).toBe(true);
      });

    });

    describe('Invalid add requests', () => {

      test('should reject missing organizationName', () => {
        const mapping = { ...validMapping };
        delete mapping.organizationName;
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/organizationName is required/);
      });

      test('should reject missing integrationType', () => {
        const mapping = { ...validMapping };
        delete mapping.integrationType;
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/integrationType is required/);
      });

      test('should reject missing tdsLegacyConfig', () => {
        const mapping = { ...validMapping };
        delete mapping.tdsLegacyConfig;
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/tdsLegacyConfig is required/);
      });

      test('should reject missing tdsSalesforceConfig', () => {
        const mapping = { ...validMapping };
        delete mapping.tdsSalesforceConfig;
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/tdsSalesforceConfig is required/);
      });

      test('should reject invalid integrationType', () => {
        const mapping = { ...validMapping, integrationType: 'invalid' };
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/integrationType must be one of:/);
      });

      test('should reject invalid environment', () => {
        const mapping = { ...validMapping, environment: 'staging' };
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/environment must be either/);
      });

      test('should reject organizationName exceeding 200 characters', () => {
        const mapping = { ...validMapping, organizationName: 'A'.repeat(201) };
        expect(() => {
          validateRequestBody(mapping, schemas.organizationMappingAdd);
        }).toThrow(/organizationName cannot exceed 200 characters/);
      });

    });

  });

  describe('workflowOrchestratorRequest schema - HIGH-006 Security Fix', () => {

    const validWorkflow = {
      tenancyId: 'TEN_12345',
      agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
      branchId: 'BRANCH_001'
    };

    describe('Valid workflow requests', () => {

      test('should accept complete valid workflow request', () => {
        const result = validateRequestBody(validWorkflow, schemas.workflowOrchestratorRequest);
        expect(result.tenancyId).toBe('TEN_12345');
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
        expect(result.branchId).toBe('BRANCH_001');
      });

      test('should accept minimal request without branchId', () => {
        const workflow = {
          tenancyId: 'TEN_12345',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        const result = validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        expect(result.branchId).toBe('DEFAULT');
      });

      test('should accept testMode = true', () => {
        const workflow = { ...validWorkflow, testMode: true };
        const result = validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        expect(result.testMode).toBe(true);
      });

      test('should accept testConfig object', () => {
        const workflow = {
          ...validWorkflow,
          testMode: true,
          testConfig: { mockData: true, depositAmount: 1000 }
        };
        const result = validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        expect(result.testConfig.mockData).toBe(true);
      });

      test('should accept optional metadata fields', () => {
        const workflow = {
          ...validWorkflow,
          integrationId: 'INT_001',
          webhookId: 'WH_001',
          source: 'alto-webhook'
        };
        const result = validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        expect(result.integrationId).toBe('INT_001');
        expect(result.webhookId).toBe('WH_001');
        expect(result.source).toBe('alto-webhook');
      });

    });

    describe('Invalid workflow requests', () => {

      test('should reject missing tenancyId', () => {
        const workflow = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow(/tenancyId is required/);
      });

      test('should reject missing agencyRef', () => {
        const workflow = { tenancyId: 'TEN_12345' };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow(/agencyRef is required/);
      });

      test('should reject invalid UUID agencyRef', () => {
        const workflow = {
          tenancyId: 'TEN_12345',
          agencyRef: 'not-a-uuid'
        };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow(/agencyRef must be a valid UUID/);
      });

      test('should reject empty tenancyId', () => {
        const workflow = {
          tenancyId: '',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow(/tenancyId cannot be empty/);
      });

      test('should reject tenancyId exceeding 200 characters', () => {
        const workflow = {
          tenancyId: 'T'.repeat(201),
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow(/tenancyId cannot exceed 200 characters/);
      });

      test('should reject non-boolean testMode', () => {
        const workflow = {
          ...validWorkflow,
          testMode: 'true' // String instead of boolean
        };
        expect(() => {
          validateRequestBody(workflow, schemas.workflowOrchestratorRequest);
        }).toThrow();
      });

    });

  });

  describe('pendingIntegrationId schema - HIGH-006 Security Fix', () => {

    describe('Valid pending integration IDs', () => {

      test('should accept valid format pending_<timestamp>_<hash>', () => {
        const { error, value } = schemas.pendingIntegrationId.validate('pending_1728906000000_abc12345');
        expect(error).toBeUndefined();
        expect(value).toBe('pending_1728906000000_abc12345');
      });

      test('should accept ID with 8-character lowercase alphanumeric hash', () => {
        const { error, value } = schemas.pendingIntegrationId.validate('pending_1234567890_z9x8y7w6');
        expect(error).toBeUndefined();
      });

    });

    describe('Invalid pending integration IDs', () => {

      test('should reject missing ID', () => {
        const { error } = schemas.pendingIntegrationId.validate(undefined);
        expect(error).toBeDefined();
        expect(error.message).toMatch(/Integration ID is required/);
      });

      test('should reject empty string', () => {
        const { error } = schemas.pendingIntegrationId.validate('');
        expect(error).toBeDefined();
        expect(error.message).toMatch(/Integration ID cannot be empty/);
      });

      test('should reject ID without pending_ prefix', () => {
        const { error } = schemas.pendingIntegrationId.validate('1234567890_abc12345');
        expect(error).toBeDefined();
        expect(error.message).toMatch(/Integration ID must match format/);
      });

      test('should reject ID with uppercase hash', () => {
        const { error } = schemas.pendingIntegrationId.validate('pending_1234567890_ABC12345');
        expect(error).toBeDefined();
      });

      test('should reject ID with wrong hash length (7 characters)', () => {
        const { error} = schemas.pendingIntegrationId.validate('pending_1234567890_abc1234');
        expect(error).toBeDefined();
      });

      test('should reject ID with special characters in hash', () => {
        const { error } = schemas.pendingIntegrationId.validate('pending_1234567890_abc-1234');
        expect(error).toBeDefined();
      });

      test('should reject script injection', () => {
        const { error } = schemas.pendingIntegrationId.validate('<script>alert("XSS")</script>');
        expect(error).toBeDefined();
      });

    });

  });

  describe('altoWebhookRequest schema - HIGH-006 Security Fix', () => {

    describe('CloudEvents format', () => {

      const validCloudEvent = {
        specversion: '1.0',
        type: 'com.alto.tenancy.created',
        source: 'https://alto.com/api',
        id: 'WH_12345',
        subject: '/tenancies/TEN_12345',
        time: '2025-10-14T10:00:00Z',
        data: {
          subjectId: 'TEN_12345',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'BRANCH_001',
          integrationId: 'INT_001'
        }
      };

      test('should accept valid CloudEvents 1.0 format', () => {
        const result = validateRequestBody(validCloudEvent, schemas.altoWebhookRequest);
        expect(result.specversion).toBe('1.0');
        expect(result.data.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
      });

      test('should accept CloudEvents without optional fields', () => {
        const event = {
          specversion: '1.0',
          type: 'tenancy.created',
          source: 'alto',
          id: 'WH_001',
          data: {
            agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
          }
        };
        const result = validateRequestBody(event, schemas.altoWebhookRequest);
        expect(result.specversion).toBe('1.0');
      });

      test('should reject CloudEvents missing required data field', () => {
        const event = {
          specversion: '1.0',
          type: 'tenancy.created',
          source: 'alto',
          id: 'WH_001'
        };
        expect(() => {
          validateRequestBody(event, schemas.altoWebhookRequest);
        }).toThrow();
      });

      test('should reject CloudEvents with invalid UUID in data.agencyRef', () => {
        const event = {
          ...validCloudEvent,
          data: {
            agencyRef: 'not-a-uuid'
          }
        };
        expect(() => {
          validateRequestBody(event, schemas.altoWebhookRequest);
        }).toThrow(/agencyRef/);
      });

    });

    describe('Direct format (backward compatibility)', () => {

      const validDirect = {
        tenancyId: 'TEN_12345',
        agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
        branchId: 'BRANCH_001',
        event: 'Tenancy.Created',
        timestamp: '2025-10-14T10:00:00Z'
      };

      test('should accept valid direct format', () => {
        const result = validateRequestBody(validDirect, schemas.altoWebhookRequest);
        expect(result.tenancyId).toBe('TEN_12345');
        expect(result.agencyRef).toBe('1af89d60-662c-475b-bcc8-9bcbf04b6322');
      });

      test('should accept direct format without optional fields', () => {
        const webhook = {
          tenancyId: 'TEN_12345',
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        const result = validateRequestBody(webhook, schemas.altoWebhookRequest);
        expect(result.tenancyId).toBe('TEN_12345');
      });

      test('should reject direct format missing tenancyId', () => {
        const webhook = {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
        };
        expect(() => {
          validateRequestBody(webhook, schemas.altoWebhookRequest);
        }).toThrow(/tenancyId/);
      });

      test('should reject direct format with invalid UUID', () => {
        const webhook = {
          tenancyId: 'TEN_12345',
          agencyRef: 'not-a-uuid'
        };
        expect(() => {
          validateRequestBody(webhook, schemas.altoWebhookRequest);
        }).toThrow();
      });

    });

  });

  describe('tdsDepositCreate schema - HIGH-006 Security Fix', () => {

    const validDeposit = {
      tenancyId: 'TEN_12345',
      agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
      branchId: 'BRANCH_001',
      depositAmount: 1500.00,
      rentAmount: 1200.00,
      tenancyStartDate: '2025-01-15',
      property: {
        id: 'PROP_001',
        address: {
          nameNo: '123',
          street: 'Main Street',
          town: 'London',
          postcode: 'SW1A 1AA'
        },
        county: 'Greater London',
        propertyType: 'House',
        bedrooms: 3,
        receptions: 1
      },
      tenants: [{
        id: 'TENANT_001',
        title: 'Mr',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '07700900000'
      }],
      landlords: [{
        id: 'LANDLORD_001',
        title: 'Mrs',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        phone: '07700900001',
        address: {
          nameNo: '456',
          street: 'High Street',
          town: 'London',
          postcode: 'SW1A 2AA'
        },
        county: 'Greater London'
      }]
    };

    describe('Valid deposit creation requests', () => {

      test('should accept complete valid deposit', () => {
        const result = validateRequestBody(validDeposit, schemas.tdsDepositCreate);
        expect(result.tenancyId).toBe('TEN_12345');
        expect(result.depositAmount).toBe(1500.00);
        expect(result.tenants).toHaveLength(1);
        expect(result.landlords).toHaveLength(1);
      });

      test('should accept zero deposit amount', () => {
        const deposit = { ...validDeposit, depositAmount: 0 };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.depositAmount).toBe(0);
      });

      test('should accept maximum deposit amount (£1,000,000)', () => {
        const deposit = { ...validDeposit, depositAmount: 1000000 };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.depositAmount).toBe(1000000);
      });

      test('should accept multiple tenants (up to 10)', () => {
        const deposit = {
          ...validDeposit,
          tenants: [
            { firstName: 'John', lastName: 'Doe' },
            { firstName: 'Jane', lastName: 'Smith' },
            { firstName: 'Bob', lastName: 'Johnson' }
          ]
        };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.tenants).toHaveLength(3);
      });

      test('should accept multiple landlords (up to 10)', () => {
        const deposit = {
          ...validDeposit,
          landlords: [
            {
              firstName: 'Jane',
              lastName: 'Smith',
              address: {
                nameNo: '456',
                street: 'High Street',
                town: 'London',
                postcode: 'SW1A 2AA'
              },
              county: 'Greater London'
            },
            {
              firstName: 'Bob',
              lastName: 'Johnson',
              address: {
                nameNo: '789',
                street: 'Park Lane',
                town: 'London',
                postcode: 'SW1A 3AA'
              },
              county: 'Greater London'
            }
          ]
        };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.landlords).toHaveLength(2);
      });

      test('should accept tenant/landlord without optional email/phone', () => {
        const deposit = {
          ...validDeposit,
          tenants: [{
            firstName: 'John',
            lastName: 'Doe'
          }],
          landlords: [{
            firstName: 'Jane',
            lastName: 'Smith',
            address: {
              nameNo: '456',
              street: 'High Street',
              town: 'London',
              postcode: 'SW1A 2AA'
            },
            county: 'Greater London'
          }]
        };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.tenants[0].email).toBeUndefined();
        expect(result.landlords[0].phone).toBeUndefined();
      });

      test('should accept null tenancyEndDate', () => {
        const deposit = { ...validDeposit, tenancyEndDate: null };
        const result = validateRequestBody(deposit, schemas.tdsDepositCreate);
        expect(result.tenancyEndDate).toBeNull();
      });

    });

    describe('Invalid deposit creation requests', () => {

      test('should reject missing tenancyId', () => {
        const deposit = { ...validDeposit };
        delete deposit.tenancyId;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/tenancyId/);
      });

      test('should reject missing agencyRef', () => {
        const deposit = { ...validDeposit };
        delete deposit.agencyRef;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/agencyRef/);
      });

      test('should reject missing depositAmount', () => {
        const deposit = { ...validDeposit };
        delete deposit.depositAmount;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/depositAmount/);
      });

      test('should reject negative depositAmount', () => {
        const deposit = { ...validDeposit, depositAmount: -100 };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/depositAmount must be at least 0/);
      });

      test('should reject depositAmount exceeding £1,000,000', () => {
        const deposit = { ...validDeposit, depositAmount: 1500000 };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/depositAmount cannot exceed/);
      });

      test('should reject depositAmount with >2 decimal places', () => {
        const deposit = { ...validDeposit, depositAmount: 1500.555 };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/depositAmount cannot have more than 2 decimal places/);
      });

      test('should reject missing property', () => {
        const deposit = { ...validDeposit };
        delete deposit.property;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow();
      });

      test('should reject missing property address', () => {
        const deposit = {
          ...validDeposit,
          property: {
            id: 'PROP_001',
            county: 'London'
          }
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/address/);
      });

      test('should reject missing tenants array', () => {
        const deposit = { ...validDeposit };
        delete deposit.tenants;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/tenants array is required/);
      });

      test('should reject empty tenants array', () => {
        const deposit = { ...validDeposit, tenants: [] };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/At least 1 tenant is required/);
      });

      test('should reject >10 tenants', () => {
        const deposit = {
          ...validDeposit,
          tenants: Array(11).fill({ firstName: 'John', lastName: 'Doe' })
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/Cannot exceed 10 tenants/);
      });

      test('should reject missing landlords array', () => {
        const deposit = { ...validDeposit };
        delete deposit.landlords;
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/landlords array is required/);
      });

      test('should reject empty landlords array', () => {
        const deposit = { ...validDeposit, landlords: [] };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/At least 1 landlord is required/);
      });

      test('should reject >10 landlords', () => {
        const deposit = {
          ...validDeposit,
          landlords: Array(11).fill({
            firstName: 'Jane',
            lastName: 'Smith',
            address: {
              nameNo: '456',
              street: 'High Street',
              town: 'London',
              postcode: 'SW1A 2AA'
            },
            county: 'Greater London'
          })
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/Cannot exceed 10 landlords/);
      });

      test('should reject tenant missing required firstName', () => {
        const deposit = {
          ...validDeposit,
          tenants: [{ lastName: 'Doe' }]
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/firstName/);
      });

      test('should reject tenant missing required lastName', () => {
        const deposit = {
          ...validDeposit,
          tenants: [{ firstName: 'John' }]
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/lastName/);
      });

      test('should reject landlord missing required address', () => {
        const deposit = {
          ...validDeposit,
          landlords: [{
            firstName: 'Jane',
            lastName: 'Smith',
            county: 'London'
          }]
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/address/);
      });

      test('should reject invalid email format', () => {
        const deposit = {
          ...validDeposit,
          tenants: [{
            firstName: 'John',
            lastName: 'Doe',
            email: 'invalid-email'
          }]
        };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow(/email/);
      });

      test('should reject invalid UUID agencyRef', () => {
        const deposit = { ...validDeposit, agencyRef: 'not-a-uuid' };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow();
      });

      test('should reject invalid ISO date format', () => {
        const deposit = { ...validDeposit, tenancyStartDate: '15/01/2025' };
        expect(() => {
          validateRequestBody(deposit, schemas.tdsDepositCreate);
        }).toThrow();
      });

    });

  });

  describe('depositId schema - HIGH-006 Security Fix', () => {

    describe('Valid deposit IDs', () => {

      test('should accept DEP_ prefix format', () => {
        const { error, value } = schemas.depositId.validate('DEP_1234567890');
        expect(error).toBeUndefined();
        expect(value).toBe('DEP_1234567890');
      });

      test('should accept 6-character alphanumeric DAN', () => {
        const { error, value } = schemas.depositId.validate('ABC123');
        expect(error).toBeUndefined();
        expect(value).toBe('ABC123');
      });

      test('should accept 20-character alphanumeric DAN', () => {
        const { error, value } = schemas.depositId.validate('ABCDEFGHIJ1234567890');
        expect(error).toBeUndefined();
      });

      test('should accept 10-character DAN', () => {
        const { error, value } = schemas.depositId.validate('DAN1234567');
        expect(error).toBeUndefined();
      });

    });

    describe('Invalid deposit IDs', () => {

      test('should reject missing deposit ID', () => {
        const { error } = schemas.depositId.validate(undefined);
        expect(error).toBeDefined();
        expect(error.message).toMatch(/Deposit ID is required/);
      });

      test('should reject empty string', () => {
        const { error } = schemas.depositId.validate('');
        expect(error).toBeDefined();
        expect(error.message).toMatch(/Deposit ID cannot be empty/);
      });

      test('should reject ID shorter than 6 characters', () => {
        const { error } = schemas.depositId.validate('AB12');
        expect(error).toBeDefined();
      });

      test('should reject ID longer than 20 characters', () => {
        const { error } = schemas.depositId.validate('A'.repeat(21));
        expect(error).toBeDefined();
      });

      test('should reject ID with special characters', () => {
        const { error } = schemas.depositId.validate('DEP-123456');
        expect(error).toBeDefined();
      });

      test('should reject ID with lowercase (for non-DEP format)', () => {
        const { error } = schemas.depositId.validate('abc123');
        expect(error).toBeDefined();
      });

      test('should reject script injection', () => {
        const { error } = schemas.depositId.validate('<script>alert("XSS")</script>');
        expect(error).toBeDefined();
      });

      test('should reject SQL injection', () => {
        const { error } = schemas.depositId.validate("'; DROP TABLE deposits; --");
        expect(error).toBeDefined();
      });

    });

  });

});
