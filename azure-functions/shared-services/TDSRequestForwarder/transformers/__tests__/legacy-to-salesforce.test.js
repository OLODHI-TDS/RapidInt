/**
 * Unit Tests for Legacy to Salesforce Transformer
 *
 * Tests all transformation logic including:
 * - Field transformations
 * - Date format conversions (YYYY-MM-DD → DD-MM-YYYY)
 * - Boolean/number string conversions
 * - Edge cases (null values, missing fields)
 */

const {
  transformLegacyToSalesforce,
  transformStandardModelToSalesforce,
  transformLegacyModelToSalesforce,
  transformStatusRequestToSalesforce
} = require('../legacy-to-salesforce');

describe('Legacy to Salesforce Transformer', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
  });

  describe('Date Format Conversion', () => {
    test('should convert ISO date (YYYY-MM-DD) to UK format (DD-MM-YYYY)', () => {
      const standardPayload = {
        metadata: {
          sourceSystem: 'alto',
          integrationId: 'test-123'
        },
        deposit: {
          reference: 'DEP-001',
          amount: 1500,
          tenancyStartDate: '2024-01-15',
          tenancyEndDate: '2025-01-15',
          receivedDate: '2024-01-10'
        },
        property: {
          id: 'PROP-001',
          address: {
            line1: '123',
            street: 'Main St',
            city: 'London',
            postcode: 'SW1A 1AA'
          }
        },
        landlord: {
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@example.com'
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.tenancy_start_date).toBe('15-01-2024');
      expect(result.tenancy.tenancy_expected_end_date).toBe('15-01-2025');
      expect(result.tenancy.deposit_received_date).toBe('10-01-2024');
    });

    test('should handle ISO date with timestamp (YYYY-MM-DDTHH:mm:ss)', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {
          tenancyStartDate: '2024-01-15T09:30:00',
          allocationDateTime: '2024-01-10T14:45:00'
        },
        property: { address: {} },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.tenancy_start_date).toBe('15-01-2024');
      expect(result.tenancy.deposit_received_date).toBe('10-01-2024');
    });

    test('should handle null dates', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {
          tenancyStartDate: null,
          tenancyEndDate: null
        },
        property: { address: {} },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.tenancy_start_date).toBeNull();
      expect(result.tenancy.tenancy_expected_end_date).toBeNull();
    });
  });

  describe('Boolean to String Conversion', () => {
    test('should convert true to "true"', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: {
          furnished: true,
          address: {}
        },
        landlord: {
          firstName: 'Business',
          lastName: 'Owner',
          isBusiness: true
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.furnished_status).toBe('true');
      expect(result.tenancy.people[0].is_business).toBe('true');
    });

    test('should convert false to "false"', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: {
          furnished: false,
          address: {}
        },
        landlord: {
          firstName: 'John',
          lastName: 'Smith',
          isBusiness: false
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.furnished_status).toBe('false');
      expect(result.tenancy.people[0].is_business).toBe('false');
    });

    test('should handle null boolean values', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: {
          furnished: null,
          address: {}
        },
        landlord: {
          firstName: 'John',
          lastName: 'Smith',
          isBusiness: null
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.furnished_status).toBeNull();
      expect(result.tenancy.people[0].is_business).toBeNull();
    });
  });

  describe('Number to String Conversion', () => {
    test('should convert numbers to strings', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {
          amount: 1500,
          rentAmount: 1200,
          amountToProtect: 1500
        },
        property: {
          bedrooms: 3,
          livingRooms: 2,
          address: {}
        },
        landlord: {},
        tenants: [
          { firstName: 'Tenant', lastName: 'One' },
          { firstName: 'Tenant', lastName: 'Two' }
        ]
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.deposit_amount).toBe('1500');
      expect(result.tenancy.rent_amount).toBe('1200');
      expect(result.tenancy.deposit_amount_to_protect).toBe('1500');
      expect(result.tenancy.number_of_bedrooms).toBe('3');
      expect(result.tenancy.number_of_living_rooms).toBe('2');
      expect(result.tenancy.number_of_tenants).toBe('2');
    });

    test('should handle zero values', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {
          amount: 0,
          rentAmount: 0
        },
        property: {
          bedrooms: 0,
          address: {}
        },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.deposit_amount).toBe('0');
      expect(result.tenancy.rent_amount).toBe('0');
      expect(result.tenancy.number_of_bedrooms).toBe('0');
    });

    test('should handle null number values', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {
          amount: null,
          rentAmount: null
        },
        property: {
          bedrooms: null,
          address: {}
        },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.deposit_amount).toBeNull();
      expect(result.tenancy.rent_amount).toBeNull();
      expect(result.tenancy.number_of_bedrooms).toBeNull();
    });
  });

  describe('Standard Model Transformation', () => {
    test('should transform complete standard model payload', () => {
      const standardPayload = {
        metadata: {
          sourceSystem: 'alto',
          integrationId: 'alto-123',
          timestamp: '2024-01-10T10:00:00Z'
        },
        deposit: {
          reference: 'DEP-001',
          amount: 1500,
          amountToProtect: 1500,
          rentAmount: 1200,
          tenancyStartDate: '2024-02-01',
          tenancyEndDate: '2025-02-01',
          receivedDate: '2024-01-15'
        },
        property: {
          id: 'PROP-001',
          address: {
            line1: '123',
            line2: 'Flat A',
            street: 'Main Street',
            city: 'London',
            county: 'Greater London',
            postcode: 'SW1A 1AA'
          },
          bedrooms: 2,
          livingRooms: 1,
          furnished: true
        },
        landlord: {
          id: 'LL-001',
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@example.com',
          phone: '020 1234 5678',
          mobile: '07700 900000',
          isBusiness: false,
          address: {
            line1: '456',
            street: 'Oak Road',
            city: 'London',
            postcode: 'NW1 1AA'
          }
        },
        tenants: [
          {
            id: 'TEN-001',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            phone: '020 9876 5432',
            address: {
              line1: '789',
              street: 'Elm Avenue',
              city: 'Manchester',
              postcode: 'M1 1AA'
            }
          }
        ]
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      // Test tenancy fields
      expect(result.tenancy.user_tenancy_reference).toBe('alto-123');
      expect(result.tenancy.deposit_reference).toBe('DEP-001');
      expect(result.tenancy.property_id).toBe('PROP-001');
      expect(result.tenancy.property_paon).toBe('123');
      expect(result.tenancy.property_saon).toBe('Flat A');
      expect(result.tenancy.property_street).toBe('Main Street');
      expect(result.tenancy.property_town).toBe('London');
      expect(result.tenancy.property_administrative_area).toBe('Greater London');
      expect(result.tenancy.property_postcode).toBe('SW1A 1AA');
      expect(result.tenancy.number_of_bedrooms).toBe('2');
      expect(result.tenancy.number_of_living_rooms).toBe('1');
      expect(result.tenancy.furnished_status).toBe('true');
      expect(result.tenancy.deposit_amount).toBe('1500');
      expect(result.tenancy.rent_amount).toBe('1200');
      expect(result.tenancy.number_of_tenants).toBe('1');
      expect(result.tenancy.number_of_landlords).toBe('1');

      // Test people array
      expect(result.tenancy.people).toHaveLength(2);

      // Test landlord
      const landlord = result.tenancy.people[0];
      expect(landlord.person_classification).toBe('Primary Landlord');
      expect(landlord.person_firstname).toBe('John');
      expect(landlord.person_surname).toBe('Smith');
      expect(landlord.person_email).toBe('john@example.com');
      expect(landlord.is_business).toBe('false');

      // Test tenant
      const tenant = result.tenancy.people[1];
      expect(tenant.person_classification).toBe('Tenant');
      expect(tenant.person_firstname).toBe('Jane');
      expect(tenant.person_surname).toBe('Doe');
      expect(tenant.person_email).toBe('jane@example.com');
    });

    test('should handle missing optional fields', () => {
      const minimalPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(minimalPayload, mockContext);

      expect(result.tenancy).toBeDefined();
      expect(result.tenancy.people).toHaveLength(0);
      expect(result.tenancy.number_of_tenants).toBe('0');
    });

    test('should handle multiple tenants', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: { firstName: 'John', lastName: 'Smith' },
        tenants: [
          { firstName: 'Tenant', lastName: 'One', email: 'tenant1@example.com' },
          { firstName: 'Tenant', lastName: 'Two', email: 'tenant2@example.com' },
          { firstName: 'Tenant', lastName: 'Three', email: 'tenant3@example.com' }
        ]
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.number_of_tenants).toBe('3');
      expect(result.tenancy.people).toHaveLength(4); // 1 landlord + 3 tenants
      expect(result.tenancy.people[1].person_classification).toBe('Tenant');
      expect(result.tenancy.people[2].person_classification).toBe('Tenant');
      expect(result.tenancy.people[3].person_classification).toBe('Tenant');
    });
  });

  describe('Legacy Model Transformation', () => {
    test('should transform legacy API format', () => {
      const legacyPayload = {
        deposits: [
          {
            tenancy_reference: 'TEN-001',
            deposit_amount: 1500,
            rent_amount: 1200,
            tenancy_start_date: '2024-02-01',
            tenancy_end_date: '2025-02-01',
            deposit_received_date: '2024-01-15',
            property: {
              property_id: 'PROP-001',
              address_line_1: '123',
              address_line_2: 'Flat A',
              street: 'Main Street',
              town: 'London',
              county: 'Greater London',
              postcode: 'SW1A 1AA',
              bedrooms: 2,
              living_rooms: 1,
              furnished: true
            },
            landlord: {
              first_name: 'John',
              last_name: 'Smith',
              email: 'john@example.com',
              is_business: false
            },
            tenants: [
              {
                first_name: 'Jane',
                last_name: 'Doe',
                email: 'jane@example.com'
              }
            ]
          }
        ]
      };

      const result = transformLegacyToSalesforce(legacyPayload, mockContext);

      expect(result.tenancy.user_tenancy_reference).toBe('TEN-001');
      expect(result.tenancy.deposit_amount).toBe('1500');
      expect(result.tenancy.property_paon).toBe('123');
      expect(result.tenancy.people).toHaveLength(2);
    });

    test('should handle legacy format with nested address objects', () => {
      const legacyPayload = {
        tenancy_reference: 'TEN-001',
        property: {
          address: {
            line1: '123',
            street: 'Main St',
            postcode: 'SW1A 1AA'
          }
        },
        landlord: {
          first_name: 'John',
          last_name: 'Smith',
          address: {
            line1: '456',
            postcode: 'NW1 1AA'
          }
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(legacyPayload, mockContext);

      expect(result.tenancy.property_paon).toBe('123');
      expect(result.tenancy.property_street).toBe('Main St');
      expect(result.tenancy.people[0].person_paon).toBe('456');
    });
  });

  describe('Business Entities', () => {
    test('should handle business landlord', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: {
          firstName: '',
          lastName: 'Property Management Ltd',
          isBusiness: true,
          businessName: 'Property Management Ltd',
          email: 'info@propmanagement.com'
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      const landlord = result.tenancy.people[0];
      expect(landlord.is_business).toBe('true');
      expect(landlord.business_name).toBe('Property Management Ltd');
    });

    test('should handle business tenant', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: { firstName: 'John', lastName: 'Smith' },
        tenants: [
          {
            firstName: '',
            lastName: 'Corporate Tenant Ltd',
            isBusiness: true,
            businessName: 'Corporate Tenant Ltd',
            email: 'contact@corporate.com'
          }
        ]
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      const tenant = result.tenancy.people[1];
      expect(tenant.is_business).toBe('true');
      expect(tenant.business_name).toBe('Corporate Tenant Ltd');
    });
  });

  describe('Status Request Transformation', () => {
    test('should transform status request', () => {
      const legacyStatusRequest = {
        batch_id: 'BATCH-123',
        organisation: {
          member_number: 'MEM-456'
        }
      };

      const result = transformStatusRequestToSalesforce(legacyStatusRequest, mockContext);

      expect(result.batchId).toBe('BATCH-123');
      expect(result.organizationId).toBe('MEM-456');
    });

    test('should handle status request with missing organization', () => {
      const legacyStatusRequest = {
        batch_id: 'BATCH-123'
      };

      const result = transformStatusRequestToSalesforce(legacyStatusRequest, mockContext);

      expect(result.batchId).toBe('BATCH-123');
      expect(result.organizationId).toBeUndefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty payload', () => {
      const emptyPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: {},
        tenants: []
      };

      expect(() => {
        transformLegacyToSalesforce(emptyPayload, mockContext);
      }).not.toThrow();
    });

    test('should handle payload with undefined nested objects', () => {
      const payloadWithUndefined = {
        metadata: { sourceSystem: 'alto' },
        deposit: { address: undefined },
        property: {},
        landlord: { address: undefined },
        tenants: []
      };

      expect(() => {
        transformLegacyToSalesforce(payloadWithUndefined, mockContext);
      }).not.toThrow();
    });

    test('should throw error on transformation failure', () => {
      const invalidPayload = null;

      expect(() => {
        transformLegacyToSalesforce(invalidPayload, mockContext);
      }).toThrow('Transformation failed');
    });

    test('should log transformation activity', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: {},
        tenants: []
      };

      transformLegacyToSalesforce(standardPayload, mockContext);

      expect(mockContext.log).toHaveBeenCalled();
    });
  });

  describe('Default Values', () => {
    test('should use default living rooms value', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: {
          livingRooms: undefined,
          address: {}
        },
        landlord: {},
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.number_of_living_rooms).toBe('1');
    });

    test('should use default country value', () => {
      const standardPayload = {
        metadata: { sourceSystem: 'alto' },
        deposit: {},
        property: { address: {} },
        landlord: {
          firstName: 'John',
          lastName: 'Smith',
          address: {
            line1: '123',
            postcode: 'SW1A 1AA'
          }
        },
        tenants: []
      };

      const result = transformLegacyToSalesforce(standardPayload, mockContext);

      expect(result.tenancy.people[0].person_country).toBe('United Kingdom');
    });
  });
});
