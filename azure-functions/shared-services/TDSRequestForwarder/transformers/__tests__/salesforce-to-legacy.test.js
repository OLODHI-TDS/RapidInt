/**
 * Unit Tests for Salesforce to Legacy Transformer
 *
 * Tests all reverse transformation logic including:
 * - Date format conversions (DD-MM-YYYY → YYYY-MM-DD)
 * - String to boolean/number conversions
 * - Status mapping
 * - Error response transformation
 */

const {
  transformSalesforceToLegacy,
  transformCreateDepositResponse,
  transformStatusResponse,
  transformGenericResponse,
  transformErrorResponse,
  mapSalesforceStatusToLegacy
} = require('../salesforce-to-legacy');

describe('Salesforce to Legacy Transformer', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
  });

  describe('Date Format Conversion', () => {
    test('should convert UK date (DD-MM-YYYY) to ISO format (YYYY-MM-DD)', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        processing_date: '15-01-2024',
        completion_date: '16-01-2024',
        tenancy_start_date: '01-02-2024',
        tenancy_end_date: '01-02-2025'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.processing_date).toBe('2024-01-15');
      expect(result.completion_date).toBe('2024-01-16');
      expect(result.tenancy_start_date).toBe('2024-02-01');
      expect(result.tenancy_end_date).toBe('2025-02-01');
    });

    test('should handle null dates', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Processing',
        processing_date: null,
        completion_date: null
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.processing_date).toBeNull();
      expect(result.completion_date).toBeNull();
    });

    test('should handle missing dates', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Processing'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.processing_date).toBeNull();
      expect(result.completion_date).toBeNull();
    });
  });

  describe('String to Boolean Conversion', () => {
    test('should convert "true" to boolean true', () => {
      const salesforceResponse = {
        success: 'true',
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(true);
      expect(typeof result.success).toBe('boolean');
    });

    test('should convert "false" to boolean false', () => {
      const salesforceResponse = {
        success: 'false',
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(false);
      expect(typeof result.success).toBe('boolean');
    });

    test('should handle already boolean values', () => {
      const salesforceResponse = {
        success: true,
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(true);
    });

    test('should handle null boolean values', () => {
      const salesforceResponse = {
        success: null,
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBeNull();
    });
  });

  describe('String to Number Conversion', () => {
    test('should convert string numbers to actual numbers', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposit_amount: '1500',
        deposits: [
          {
            deposit_amount: '1500',
            number_of_tenants: '2'
          }
        ]
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBe(1500);
      expect(typeof result.deposit_amount).toBe('number');
      expect(result.deposits[0].deposit_amount).toBe(1500);
      expect(result.deposits[0].tenant_count).toBe(2);
    });

    test('should handle already number values', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposit_amount: 1500
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBe(1500);
    });

    test('should handle zero values', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposit_amount: '0'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBe(0);
    });

    test('should handle null number values', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposit_amount: null
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBeNull();
    });

    test('should handle invalid number strings', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposit_amount: 'invalid'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBeNull();
    });
  });

  describe('Success/Error Response Transformation', () => {
    test('should transform success response', () => {
      const salesforceResponse = {
        success: 'true',
        batch_id: 'BATCH-123',
        message: 'Deposit created successfully',
        error: null
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(true);
      expect(result.batch_id).toBe('BATCH-123');
      expect(result.message).toBe('Deposit created successfully');
      expect(result.error).toBeNull();
      expect(result.timestamp).toBeDefined();
    });

    test('should transform error response', () => {
      const salesforceResponse = {
        success: 'false',
        batch_id: null,
        message: 'Validation failed',
        error: 'Invalid postcode format'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid postcode format');
      expect(result.message).toBe('Validation failed');
    });
  });

  describe('Create Deposit Response Transformation', () => {
    test('should transform successful create deposit response', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Submitted',
        message: 'Deposit submitted successfully',
        success: 'true'
      };

      const result = transformCreateDepositResponse(salesforceResponse, mockContext);

      expect(result.batch_id).toBe('BATCH-123');
      expect(result.status).toBe('Submitted');
      expect(result.success).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    test('should handle response with errors array', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Failed',
        success: 'false',
        errors: ['Invalid field: postcode', 'Missing field: tenant_email']
      };

      const result = transformCreateDepositResponse(salesforceResponse, mockContext);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toBe('Invalid field: postcode');
    });

    test('should convert single error to array', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Failed',
        success: 'false',
        errors: 'Single error message'
      };

      const result = transformCreateDepositResponse(salesforceResponse, mockContext);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('Single error message');
    });

    test('should handle warnings', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Submitted',
        success: 'true',
        warnings: ['Deprecated field used: address_line_3']
      };

      const result = transformCreateDepositResponse(salesforceResponse, mockContext);

      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('Status Response Transformation', () => {
    test('should transform complete status response', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        dan: 'DAN-789456',
        deposit_amount: '1500',
        processing_date: '15-01-2024',
        completion_date: '16-01-2024',
        tenancy_start_date: '01-02-2024',
        tenancy_end_date: '01-02-2025',
        message: 'Deposit processed successfully'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.batch_id).toBe('BATCH-123');
      expect(result.status).toBe('Completed');
      expect(result.dan).toBe('DAN-789456');
      expect(result.deposit_amount).toBe(1500);
      expect(result.processing_date).toBe('2024-01-15');
      expect(result.completion_date).toBe('2024-01-16');
      expect(result.last_updated).toBeDefined();
    });

    test('should handle dan_number field', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        dan_number: 'DAN-789456'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.dan).toBe('DAN-789456');
    });

    test('should handle status_message field', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Processing',
        status_message: 'Being processed'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.message).toBe('Being processed');
    });

    test('should transform deposits array', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        deposits: [
          {
            deposit_id: 'DEP-001',
            deposit_amount: '1500',
            dan: 'DAN-001',
            status: 'Created',
            property_postcode: 'SW1A 1AA',
            number_of_tenants: '2'
          },
          {
            id: 'DEP-002',
            deposit_amount: '2000',
            dan_number: 'DAN-002',
            status: 'Created',
            property_postcode: 'NW1 1AA',
            number_of_tenants: '3'
          }
        ]
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.deposits).toHaveLength(2);
      expect(result.deposits[0].deposit_id).toBe('DEP-001');
      expect(result.deposits[0].deposit_amount).toBe(1500);
      expect(result.deposits[0].tenant_count).toBe(2);
      expect(result.deposits[1].deposit_id).toBe('DEP-002');
      expect(result.deposits[1].dan).toBe('DAN-002');
    });
  });

  describe('Generic Response Transformation', () => {
    test('should transform dates in generic response', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        created_date: '15-01-2024',
        updated_date: '16-01-2024',
        some_other_field: 'value'
      };

      const result = transformGenericResponse(salesforceResponse, mockContext);

      expect(result.created_date).toBe('2024-01-15');
      expect(result.updated_date).toBe('2024-01-16');
      expect(result.some_other_field).toBe('value');
    });

    test('should transform amounts in generic response', () => {
      const salesforceResponse = {
        deposit_amount: '1500',
        rent_amount: '1200',
        some_other_field: 'value'
      };

      const result = transformGenericResponse(salesforceResponse, mockContext);

      expect(result.deposit_amount).toBe(1500);
      expect(result.rent_amount).toBe(1200);
      expect(result.some_other_field).toBe('value');
    });

    test('should transform number fields in generic response', () => {
      const salesforceResponse = {
        number_of_tenants: '2',
        number_of_bedrooms: '3',
        some_other_field: 'value'
      };

      const result = transformGenericResponse(salesforceResponse, mockContext);

      expect(result.number_of_tenants).toBe(2);
      expect(result.number_of_bedrooms).toBe(3);
    });

    test('should transform boolean fields in generic response', () => {
      const salesforceResponse = {
        furnished: 'true',
        is_business: 'false',
        some_other_field: 'value'
      };

      const result = transformGenericResponse(salesforceResponse, mockContext);

      expect(result.furnished).toBe(true);
      expect(result.is_business).toBe(false);
    });
  });

  describe('Status Mapping', () => {
    test('should map Salesforce status to legacy status', () => {
      expect(mapSalesforceStatusToLegacy('New')).toBe('submitted');
      expect(mapSalesforceStatusToLegacy('Submitted')).toBe('submitted');
      expect(mapSalesforceStatusToLegacy('Processing')).toBe('processing');
      expect(mapSalesforceStatusToLegacy('Processed')).toBe('processing');
      expect(mapSalesforceStatusToLegacy('Completed')).toBe('created');
      expect(mapSalesforceStatusToLegacy('Created')).toBe('created');
      expect(mapSalesforceStatusToLegacy('Failed')).toBe('failed');
      expect(mapSalesforceStatusToLegacy('Error')).toBe('failed');
      expect(mapSalesforceStatusToLegacy('Rejected')).toBe('failed');
      expect(mapSalesforceStatusToLegacy('Pending')).toBe('processing');
      expect(mapSalesforceStatusToLegacy('In Progress')).toBe('processing');
    });

    test('should handle unknown status values', () => {
      expect(mapSalesforceStatusToLegacy('UnknownStatus')).toBe('UnknownStatus');
    });

    test('should handle null/undefined status', () => {
      expect(mapSalesforceStatusToLegacy(null)).toBe('unknown');
      expect(mapSalesforceStatusToLegacy(undefined)).toBe('unknown');
    });
  });

  describe('Error Response Transformation', () => {
    test('should transform Salesforce error response', () => {
      const salesforceError = {
        errorCode: 'VALIDATION_ERROR',
        message: 'Invalid field values',
        fields: ['postcode', 'tenant_email']
      };

      const result = transformErrorResponse(salesforceError, mockContext);

      expect(result.error).toBe(true);
      expect(result.error_code).toBe('VALIDATION_ERROR');
      expect(result.message).toBe('Invalid field values');
      expect(result.fields).toHaveLength(2);
      expect(result.timestamp).toBeDefined();
    });

    test('should handle error without fields', () => {
      const salesforceError = {
        errorCode: 'SERVER_ERROR',
        message: 'Internal server error'
      };

      const result = transformErrorResponse(salesforceError, mockContext);

      expect(result.error_code).toBe('SERVER_ERROR');
      expect(result.fields).toEqual([]);
    });

    test('should use default values for missing fields', () => {
      const salesforceError = {};

      const result = transformErrorResponse(salesforceError, mockContext);

      expect(result.error).toBe(true);
      expect(result.error_code).toBe('SALESFORCE_ERROR');
      expect(result.message).toBe('An error occurred');
    });
  });

  describe('Router Logic', () => {
    test('should route to success/error transformation when success field present', () => {
      const salesforceResponse = {
        success: 'true',
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.success).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    test('should route to status transformation when batch_id or status present', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.last_updated).toBeDefined();
    });

    test('should use generic transformation as fallback', () => {
      const salesforceResponse = {
        custom_field: 'value',
        created_date: '15-01-2024'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.custom_field).toBe('value');
      expect(result.created_date).toBe('2024-01-15');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty response', () => {
      const salesforceResponse = {};

      expect(() => {
        transformSalesforceToLegacy(salesforceResponse, mockContext);
      }).not.toThrow();
    });

    test('should throw error on transformation failure', () => {
      const invalidResponse = null;

      expect(() => {
        transformSalesforceToLegacy(invalidResponse, mockContext);
      }).toThrow('Transformation failed');
    });

    test('should log transformation activity', () => {
      const salesforceResponse = {
        success: 'true',
        batch_id: 'BATCH-123'
      };

      transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(mockContext.log).toHaveBeenCalled();
    });

    test('should handle complex nested objects', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed',
        nested: {
          deposit_amount: '1500',
          created_date: '15-01-2024'
        }
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.batch_id).toBe('BATCH-123');
    });
  });

  describe('ISO Timestamp Generation', () => {
    test('should generate ISO timestamp for responses', () => {
      const salesforceResponse = {
        success: 'true',
        batch_id: 'BATCH-123'
      };

      const result = transformSalesforceToLegacy(salesforceResponse, mockContext);

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should generate last_updated for status responses', () => {
      const salesforceResponse = {
        batch_id: 'BATCH-123',
        status: 'Completed'
      };

      const result = transformStatusResponse(salesforceResponse, mockContext);

      expect(result.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
