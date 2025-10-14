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
  formatValidationError
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

});
