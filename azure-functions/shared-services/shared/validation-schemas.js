/**
 * Reusable Validation Schemas
 *
 * Provides Joi validation schemas for common API parameters across all endpoints.
 * This module is part of the security hardening initiative (HIGH-003, HIGH-006).
 *
 * Usage:
 *   const { validateQueryParams, validateAgencyRef } = require('./validation-schemas');
 *   const validated = validateQueryParams(request.query);
 *
 * @module validation-schemas
 */

const Joi = require('joi');

/**
 * Joi Schemas for Common Parameters
 */
const schemas = {
  /**
   * Days parameter - typically used for date range queries
   * Valid range: 1-365 days (max 1 year)
   */
  days: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(30)
    .messages({
      'number.base': 'Parameter "days" must be a number',
      'number.integer': 'Parameter "days" must be a whole number',
      'number.min': 'Parameter "days" must be at least 1',
      'number.max': 'Parameter "days" cannot exceed 365 (max 1 year)'
    }),

  /**
   * Limit parameter - typically used for pagination
   * Valid range: 1-1000 records
   */
  limit: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100)
    .messages({
      'number.base': 'Parameter "limit" must be a number',
      'number.integer': 'Parameter "limit" must be a whole number',
      'number.min': 'Parameter "limit" must be at least 1',
      'number.max': 'Parameter "limit" cannot exceed 1000 records'
    }),

  /**
   * Offset parameter - typically used for pagination
   * Valid range: 0-1000000
   */
  offset: Joi.number()
    .integer()
    .min(0)
    .max(1000000)
    .default(0)
    .messages({
      'number.base': 'Parameter "offset" must be a number',
      'number.integer': 'Parameter "offset" must be a whole number',
      'number.min': 'Parameter "offset" cannot be negative',
      'number.max': 'Parameter "offset" cannot exceed 1,000,000'
    }),

  /**
   * Agency Reference - Alto agency reference (UUID format)
   * Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   */
  agencyRef: Joi.string()
    .pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
    .required()
    .messages({
      'string.base': 'Agency reference must be a string',
      'string.pattern.base': 'Invalid agency reference format (must be a valid UUID)',
      'any.required': 'Agency reference is required'
    }),

  /**
   * Organization ID - numeric or string identifier
   */
  organizationId: Joi.alternatives()
    .try(
      Joi.number().integer().positive(),
      Joi.string().alphanum().min(1).max(100)
    )
    .required()
    .messages({
      'alternatives.match': 'Organization ID must be a positive number or alphanumeric string',
      'any.required': 'Organization ID is required'
    }),

  /**
   * Batch ID - alphanumeric string identifier
   */
  batchId: Joi.string()
    .alphanum()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.base': 'Batch ID must be a string',
      'string.alphanum': 'Batch ID must contain only letters and numbers',
      'string.min': 'Batch ID cannot be empty',
      'string.max': 'Batch ID cannot exceed 100 characters',
      'any.required': 'Batch ID is required'
    }),

  /**
   * Status parameter - predefined status values
   */
  status: Joi.string()
    .valid('pending', 'processing', 'completed', 'failed', 'all')
    .default('all')
    .messages({
      'string.base': 'Status must be a string',
      'any.only': 'Status must be one of: pending, processing, completed, failed, all'
    }),

  /**
   * Sort order parameter
   */
  sortOrder: Joi.string()
    .valid('asc', 'desc', 'ASC', 'DESC')
    .default('desc')
    .uppercase()
    .messages({
      'string.base': 'Sort order must be a string',
      'any.only': 'Sort order must be either "asc" or "desc"'
    }),

  /**
   * Alto Webhook Payload - HIGH-006 Security Fix
   * Validates incoming webhook payloads from Alto property management system
   *
   * @security Prevents application crashes from malformed Alto webhooks
   * @security Protects against null/undefined values causing TypeErrors
   * @security Validates UUID formats to prevent XSS in agency references
   */
  altoWebhookPayload: Joi.object({
    // Core identifiers
    tenancyId: Joi.alternatives()
      .try(
        Joi.string().min(1).max(200),
        Joi.number().integer().positive()
      )
      .required()
      .custom((value, helpers) => {
        // Convert to string for consistent handling
        return String(value);
      })
      .messages({
        'alternatives.match': 'tenancyId must be a string or number',
        'any.required': 'tenancyId is required'
      }),

    agencyRef: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.base': 'agencyRef must be a string',
        'string.guid': 'agencyRef must be a valid UUID (e.g., 1af89d60-662c-475b-bcc8-9bcbf04b6322)',
        'any.required': 'agencyRef is required'
      }),

    branchId: Joi.string()
      .required()
      .min(1)
      .max(100)
      .messages({
        'string.base': 'branchId must be a string',
        'string.empty': 'branchId cannot be empty',
        'string.max': 'branchId cannot exceed 100 characters',
        'any.required': 'branchId is required'
      }),

    // Financial data
    depositAmount: Joi.number()
      .positive()
      .precision(2)
      .max(1000000)
      .optional()
      .messages({
        'number.base': 'depositAmount must be a number',
        'number.positive': 'depositAmount must be a positive number',
        'number.precision': 'depositAmount cannot have more than 2 decimal places',
        'number.max': 'depositAmount cannot exceed £1,000,000'
      }),

    // Property address
    propertyAddress: Joi.object({
      line1: Joi.string().required().max(200).messages({
        'string.base': 'propertyAddress.line1 must be a string',
        'string.max': 'propertyAddress.line1 cannot exceed 200 characters',
        'any.required': 'propertyAddress.line1 is required'
      }),
      line2: Joi.string().optional().allow('', null).max(200).messages({
        'string.max': 'propertyAddress.line2 cannot exceed 200 characters'
      }),
      line3: Joi.string().optional().allow('', null).max(200).messages({
        'string.max': 'propertyAddress.line3 cannot exceed 200 characters'
      }),
      city: Joi.string().required().max(100).messages({
        'string.base': 'propertyAddress.city must be a string',
        'string.max': 'propertyAddress.city cannot exceed 100 characters',
        'any.required': 'propertyAddress.city is required'
      }),
      postcode: Joi.string().required().max(20).messages({
        'string.base': 'propertyAddress.postcode must be a string',
        'string.max': 'propertyAddress.postcode cannot exceed 20 characters',
        'any.required': 'propertyAddress.postcode is required'
      }),
      county: Joi.string().optional().allow('', null).max(100).messages({
        'string.max': 'propertyAddress.county cannot exceed 100 characters'
      }),
      country: Joi.string().optional().allow('', null).max(100).messages({
        'string.max': 'propertyAddress.country cannot exceed 100 characters'
      })
    }).optional().messages({
      'object.base': 'propertyAddress must be an object'
    }),

    // Tenant details (optional - may not always be provided in webhook)
    tenantDetails: Joi.object({
      title: Joi.string().optional().allow('', null).max(20),
      firstName: Joi.string().optional().allow('', null).max(100),
      lastName: Joi.string().optional().allow('', null).max(100),
      email: Joi.string().email().optional().allow('', null).max(200),
      phone: Joi.string().optional().allow('', null).max(50),
      dateOfBirth: Joi.string().optional().allow('', null).isoDate()
    }).optional(),

    // Metadata (optional - additional context from Alto)
    metadata: Joi.object({
      altoAgencyRef: Joi.string().uuid().optional(),
      altoBranchId: Joi.string().optional().max(100),
      altoTenancyRef: Joi.string().optional().max(200),
      webhookId: Joi.string().optional().max(200),
      webhookTimestamp: Joi.string().optional().isoDate(),
      eventType: Joi.string().optional().max(100)
    }).optional().unknown(true), // Allow additional metadata fields

    // Dates
    tenancyStartDate: Joi.string().optional().allow('', null).isoDate().messages({
      'string.isoDate': 'tenancyStartDate must be a valid ISO date (e.g., 2025-01-15)'
    }),
    tenancyEndDate: Joi.string().optional().allow('', null).isoDate().messages({
      'string.isoDate': 'tenancyEndDate must be a valid ISO date (e.g., 2025-12-31)'
    }),

    // Additional optional fields
    landlordReference: Joi.string().optional().allow('', null).max(200),
    agentReference: Joi.string().optional().allow('', null).max(200),
    notes: Joi.string().optional().allow('', null).max(5000)

  }).options({
    stripUnknown: true, // Remove unknown fields for security
    abortEarly: false   // Collect all validation errors
  }).messages({
    'object.base': 'Request body must be a valid JSON object'
  }),

  /**
   * Routing Mode Update - HIGH-006 Security Fix
   * Validates ConfigurationAPI routing mode update requests
   *
   * @security Prevents invalid routing mode values that could break traffic routing
   * @security Protects against null/undefined values causing TypeErrors
   */
  routingModeUpdate: Joi.object({
    routingMode: Joi.string()
      .valid('legacy-only', 'salesforce-only', 'both', 'shadow', 'forwarding')
      .required()
      .messages({
        'string.base': 'routingMode must be a string',
        'string.empty': 'routingMode cannot be empty',
        'any.only': 'routingMode must be one of: legacy-only, salesforce-only, both, shadow, forwarding',
        'any.required': 'routingMode is required'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Forwarding Percentage Update - HIGH-006 Security Fix
   * Validates ConfigurationAPI forwarding percentage update requests
   *
   * @security Prevents invalid percentage values that could break traffic split
   * @security Protects against negative or >100 values causing incorrect routing
   */
  forwardingPercentageUpdate: Joi.object({
    percentage: Joi.number()
      .integer()
      .min(0)
      .max(100)
      .required()
      .messages({
        'number.base': 'percentage must be a number',
        'number.integer': 'percentage must be a whole number (no decimals)',
        'number.min': 'percentage must be at least 0',
        'number.max': 'percentage cannot exceed 100',
        'any.required': 'percentage is required'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Provider Preference Update - HIGH-006 Security Fix
   * Validates ConfigurationAPI provider preference update requests
   *
   * @security Prevents invalid provider preference values
   * @security Protects against null/undefined values causing TypeErrors
   */
  providerPreferenceUpdate: Joi.object({
    providerPreference: Joi.string()
      .valid('current', 'salesforce', 'dual', 'auto')
      .required()
      .messages({
        'string.base': 'providerPreference must be a string',
        'string.empty': 'providerPreference cannot be empty',
        'any.only': 'providerPreference must be one of: current, salesforce, dual, auto',
        'any.required': 'providerPreference is required'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Fetch Tenancy Request - HIGH-006 Security Fix
   * Validates AltoIntegration fetch-tenancy request body
   *
   * @security Prevents invalid agencyRef/branchId causing Alto API failures
   * @security Protects against null/undefined values causing TypeErrors
   */
  fetchTenancyRequest: Joi.object({
    agencyRef: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.base': 'agencyRef must be a string',
        'string.guid': 'agencyRef must be a valid UUID (e.g., 1af89d60-662c-475b-bcc8-9bcbf04b6322)',
        'any.required': 'agencyRef is required'
      }),
    branchId: Joi.string()
      .optional()
      .allow('', null)
      .min(1)
      .max(100)
      .messages({
        'string.base': 'branchId must be a string',
        'string.min': 'branchId cannot be empty if provided',
        'string.max': 'branchId cannot exceed 100 characters'
      }),
    environment: Joi.string()
      .valid('development', 'production')
      .optional()
      .default('development')
      .messages({
        'string.base': 'environment must be a string',
        'any.only': 'environment must be either "development" or "production"'
      }),
    testMode: Joi.boolean()
      .optional()
      .default(false)
      .messages({
        'boolean.base': 'testMode must be a boolean'
      }),
    testConfig: Joi.object()
      .optional()
      .unknown(true)
      .messages({
        'object.base': 'testConfig must be an object'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * UK Postcode - HIGH-006 Security Fix
   * Validates UK postcode format (supports outward and inward codes)
   *
   * @security Prevents malformed postcodes causing external API errors
   * @security Protects against XSS in postcode parameters
   * @example Valid: "SW1A 1AA", "M1 1AE", "GU16 7HF", "SW1A1AA" (with or without space)
   */
  ukPostcode: Joi.string()
    .required()
    .trim()
    .min(5)
    .max(10)
    .pattern(/^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i)
    .messages({
      'string.base': 'postcode must be a string',
      'string.empty': 'postcode cannot be empty',
      'string.min': 'postcode must be at least 5 characters (e.g., M1 1AE)',
      'string.max': 'postcode cannot exceed 10 characters',
      'string.pattern.base': 'postcode must be a valid UK postcode (e.g., SW1A 1AA, M1 1AE, GU16 7HF)',
      'any.required': 'postcode is required'
    }),

  /**
   * Batch Postcode Lookup - HIGH-006 Security Fix
   * Validates batch postcode lookup request body
   *
   * @security Prevents resource exhaustion from oversized batch requests
   * @security Validates each postcode format before external API call
   */
  batchPostcodeLookup: Joi.object({
    postcodes: Joi.array()
      .items(
        Joi.string()
          .trim()
          .min(5)
          .max(10)
          .pattern(/^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i)
          .messages({
            'string.pattern.base': 'Each postcode must be a valid UK postcode (e.g., SW1A 1AA)'
          })
      )
      .min(1)
      .max(100)
      .required()
      .messages({
        'array.base': 'postcodes must be an array',
        'array.min': 'postcodes array must contain at least 1 postcode',
        'array.max': 'postcodes array cannot exceed 100 postcodes (batch limit)',
        'any.required': 'postcodes array is required'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Organization Lookup Query - HIGH-006 Security Fix
   * Validates OrganizationMapping lookup query parameters
   *
   * @security Prevents invalid UUID causing database errors
   * @security Validates branchId to prevent XSS/SQL injection
   */
  organizationLookupQuery: Joi.object({
    agencyRef: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.base': 'agencyRef must be a string',
        'string.guid': 'agencyRef must be a valid UUID (e.g., 1af89d60-662c-475b-bcc8-9bcbf04b6322)',
        'any.required': 'agencyRef is required'
      }),
    branchId: Joi.string()
      .optional()
      .allow('', null)
      .min(1)
      .max(100)
      .messages({
        'string.base': 'branchId must be a string',
        'string.min': 'branchId cannot be empty if provided',
        'string.max': 'branchId cannot exceed 100 characters'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Organization Mapping Add - HIGH-006 Security Fix
   * Validates OrganizationMapping add request body
   *
   * @security Prevents invalid organization mappings that could break integrations
   * @security Validates all required TDS configuration fields
   */
  organizationMappingAdd: Joi.object({
    organizationName: Joi.string()
      .required()
      .min(1)
      .max(200)
      .messages({
        'string.base': 'organizationName must be a string',
        'string.empty': 'organizationName cannot be empty',
        'string.max': 'organizationName cannot exceed 200 characters',
        'any.required': 'organizationName is required'
      }),
    environment: Joi.string()
      .valid('development', 'production')
      .optional()
      .default('development')
      .messages({
        'string.base': 'environment must be a string',
        'any.only': 'environment must be either "development" or "production"'
      }),
    integrationType: Joi.string()
      .required()
      .valid('alto', 'jupix', 'manual')
      .messages({
        'string.base': 'integrationType must be a string',
        'any.only': 'integrationType must be one of: alto, jupix, manual',
        'any.required': 'integrationType is required'
      }),
    integrationCredentials: Joi.object({
      alto: Joi.object({
        agencyRef: Joi.string().uuid().required(),
        branchId: Joi.string().optional().allow('', null).max(100)
      }).optional()
    }).optional(),
    tdsLegacyConfig: Joi.object({
      memberId: Joi.string().required().min(1).max(100),
      branchId: Joi.string().required().min(1).max(100),
      apiKey: Joi.string().required().min(1).max(500)
    }).required().messages({
      'any.required': 'tdsLegacyConfig is required'
    }),
    tdsSalesforceConfig: Joi.object({
      memberId: Joi.string().required().min(1).max(100),
      branchId: Joi.string().required().min(1).max(100),
      region: Joi.string().optional().valid('EW', 'NI', 'S'),
      schemeType: Joi.string().optional().valid('Custodial', 'Insured'),
      authMethod: Joi.string().optional().valid('api-key', 'oauth2'),
      apiKey: Joi.string().optional().min(1).max(500),
      clientId: Joi.string().optional().min(1).max(500),
      clientSecret: Joi.string().optional().min(1).max(500)
    }).required().messages({
      'any.required': 'tdsSalesforceConfig is required'
    }),
    isActive: Joi.boolean()
      .optional()
      .default(true)
      .messages({
        'boolean.base': 'isActive must be a boolean'
      })
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Organization Mapping Update - HIGH-006 Security Fix
   * Validates OrganizationMapping update request body
   *
   * @security Prevents malformed updates that could corrupt organization data
   */
  organizationMappingUpdate: Joi.object({
    organizationName: Joi.string().required().min(1).max(200),
    environment: Joi.string().required().valid('development', 'production'),
    integrationType: Joi.string().required().valid('alto', 'jupix', 'manual'),
    updatedOrganizationName: Joi.string().optional().min(1).max(200),
    legacyMemberId: Joi.string().optional().min(1).max(100),
    legacyBranchId: Joi.string().optional().min(1).max(100),
    legacyApiKey: Joi.string().optional().min(1).max(500),
    sfMemberId: Joi.string().optional().min(1).max(100),
    sfBranchId: Joi.string().optional().min(1).max(100),
    sfRegion: Joi.string().optional().valid('EW', 'NI', 'S'),
    sfSchemeType: Joi.string().optional().valid('Custodial', 'Insured'),
    sfAuthMethod: Joi.string().optional().valid('api-key', 'oauth2'),
    sfApiKey: Joi.string().optional().min(1).max(500),
    sfClientId: Joi.string().optional().min(1).max(500),
    sfClientSecret: Joi.string().optional().min(1).max(500),
    tdsProviderPreference: Joi.string().optional().valid('auto', 'current', 'salesforce'),
    isActive: Joi.boolean().optional()
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Organization Mapping Delete - HIGH-006 Security Fix
   * Validates OrganizationMapping delete request body
   *
   * @security Validates required identifiers before deletion
   */
  organizationMappingDelete: Joi.object({
    agencyRef: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.guid': 'agencyRef must be a valid UUID',
        'any.required': 'agencyRef is required'
      }),
    branchId: Joi.string()
      .optional()
      .default('DEFAULT')
      .min(1)
      .max(100)
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Workflow Orchestrator Request - HIGH-006 Security Fix
   * Validates WorkflowOrchestrator request body
   *
   * @security Prevents invalid workflow data causing integration failures
   * @security Validates UUIDs to prevent malformed requests to Alto API
   */
  workflowOrchestratorRequest: Joi.object({
    tenancyId: Joi.alternatives()
      .try(
        Joi.string().min(1).max(200),
        Joi.number().integer().positive()
      )
      .required()
      .custom((value, helpers) => {
        // Convert to string for consistent handling
        return String(value);
      })
      .messages({
        'alternatives.match': 'tenancyId must be a string or number',
        'any.required': 'tenancyId is required'
      }),
    agencyRef: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.guid': 'agencyRef must be a valid UUID',
        'any.required': 'agencyRef is required'
      }),
    branchId: Joi.string()
      .optional()
      .default('DEFAULT')
      .min(1)
      .max(100)
      .messages({
        'string.min': 'branchId cannot be empty if provided',
        'string.max': 'branchId cannot exceed 100 characters'
      }),
    integrationId: Joi.string().optional().max(200),
    webhookId: Joi.string().optional().max(200),
    source: Joi.string().optional().max(100),
    testMode: Joi.boolean().optional().default(false),
    testConfig: Joi.object().optional().unknown(true)
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Pending Integration ID - HIGH-006 Security Fix
   * Validates pending integration ID from URL parameters
   *
   * @security Prevents malformed IDs causing database errors
   */
  pendingIntegrationId: Joi.string()
    .required()
    .pattern(/^pending_\d+_[a-z0-9]{8}$/)
    .messages({
      'string.base': 'Integration ID must be a string',
      'string.empty': 'Integration ID cannot be empty',
      'string.pattern.base': 'Integration ID must match format: pending_<timestamp>_<hash>',
      'any.required': 'Integration ID is required'
    }),

  /**
   * Alto Webhook Request - HIGH-006 Security Fix
   * Enhanced webhook payload validation (CloudEvents format)
   *
   * @security Validates CloudEvents structure and required fields
   * @security Prevents malformed webhooks causing workflow failures
   */
  altoWebhookRequest: Joi.alternatives().try(
    // CloudEvents format
    Joi.object({
      specversion: Joi.string().valid('1.0').required(),
      type: Joi.string().required().max(200),
      source: Joi.string().required().max(500),
      subject: Joi.string().optional().max(500),
      id: Joi.string().required().max(200),
      time: Joi.string().isoDate().optional(),
      datacontenttype: Joi.string().optional(),
      data: Joi.object({
        subjectId: Joi.alternatives()
          .try(
            Joi.string().min(1).max(200),
            Joi.number().integer().positive()
          )
          .optional()
          .custom((value, helpers) => {
            // Convert to string for consistent handling
            return String(value);
          }),
        agencyRef: Joi.string().uuid().required(),
        branchId: Joi.string().optional().max(100),
        integrationId: Joi.string().optional().max(200),
        relatedSubjects: Joi.array().optional()
      }).required()
    }),
    // Direct format (backward compatibility)
    Joi.object({
      tenancyId: Joi.alternatives()
        .try(
          Joi.string().min(1).max(200),
          Joi.number().integer().positive()
        )
        .required()
        .custom((value, helpers) => {
          // Convert to string for consistent handling
          return String(value);
        })
        .messages({
          'alternatives.match': 'tenancyId must be a string or number',
          'any.required': 'tenancyId is required'
        }),
      agencyRef: Joi.string().uuid().required(),
      branchId: Joi.string().optional().max(100),
      integrationId: Joi.string().optional().max(200),
      event: Joi.string().optional().max(100),
      timestamp: Joi.string().isoDate().optional()
    })
  ).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * TDS Deposit Create - HIGH-006 Security Fix
   * Validates TDSAdapter deposit creation request body
   *
   * @security Prevents invalid deposit data causing TDS API failures
   * @security Validates financial amounts to prevent corruption
   * @security Validates required contact information
   */
  tdsDepositCreate: Joi.object({
    tenancyId: Joi.alternatives()
      .try(
        Joi.string().min(1).max(200),
        Joi.number().integer().positive()
      )
      .required()
      .custom((value, helpers) => {
        // Convert to string for consistent handling
        return String(value);
      })
      .messages({
        'alternatives.match': 'tenancyId must be a string or number',
        'any.required': 'tenancyId is required'
      }),
    agencyRef: Joi.string().uuid().required(),
    branchId: Joi.string().required().min(1).max(100),
    depositAmount: Joi.number()
      .required()
      .min(0)
      .max(1000000)
      .precision(2)
      .messages({
        'number.base': 'depositAmount must be a number',
        'number.min': 'depositAmount must be at least 0',
        'number.max': 'depositAmount cannot exceed £1,000,000',
        'number.precision': 'depositAmount cannot have more than 2 decimal places',
        'any.required': 'depositAmount is required'
      }),
    rentAmount: Joi.number().required().min(0).max(1000000).precision(2),
    tenancyStartDate: Joi.string().isoDate().required(),
    tenancyEndDate: Joi.string().isoDate().optional().allow(null),
    property: Joi.object({
      id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      address: Joi.object({
        nameNo: Joi.string().required().max(200),
        subDwelling: Joi.string().optional().allow('', null).max(200),
        street: Joi.string().required().max(200),
        town: Joi.string().required().max(100),
        locality: Joi.string().optional().allow('', null).max(100),
        postcode: Joi.string().required().max(20)
      }).required(),
      county: Joi.string().required().max(100),
      propertyType: Joi.string().optional().max(50),
      bedrooms: Joi.number().integer().min(0).max(50).optional(),
      receptions: Joi.number().integer().min(0).max(50).optional()
    }).required(),
    tenants: Joi.array()
      .items(
        Joi.object({
          id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
          title: Joi.string().optional().allow('', null).max(20),
          firstName: Joi.string().required().min(1).max(100),
          lastName: Joi.string().required().min(1).max(100),
          email: Joi.string().email().optional().allow('', null).max(200),
          phone: Joi.string().optional().allow('', null).max(50)
        })
      )
      .min(1)
      .max(10)
      .required()
      .messages({
        'array.min': 'At least 1 tenant is required',
        'array.max': 'Cannot exceed 10 tenants',
        'any.required': 'tenants array is required'
      }),
    landlords: Joi.array()
      .items(
        Joi.object({
          id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
          title: Joi.string().optional().allow('', null).max(20),
          firstName: Joi.string().required().min(1).max(100),
          lastName: Joi.string().required().min(1).max(100),
          email: Joi.string().email().optional().allow('', null).max(200),
          phone: Joi.string().optional().allow('', null).max(50),
          address: Joi.object({
            nameNo: Joi.string().required().max(200),
            subDwelling: Joi.string().optional().allow('', null).max(200),
            street: Joi.string().required().max(200),
            town: Joi.string().required().max(100),
            locality: Joi.string().optional().allow('', null).max(100),
            postcode: Joi.string().required().max(20)
          }).required(),
          county: Joi.string().required().max(100)
        })
      )
      .min(1)
      .max(10)
      .required()
      .messages({
        'array.min': 'At least 1 landlord is required',
        'array.max': 'Cannot exceed 10 landlords',
        'any.required': 'landlords array is required'
      }),
    createdAt: Joi.string().isoDate().optional()
  }).options({
    stripUnknown: true,
    abortEarly: false
  }),

  /**
   * Deposit ID - HIGH-006 Security Fix
   * Validates deposit ID from URL parameters
   *
   * @security Prevents malformed IDs causing TDS API errors
   */
  depositId: Joi.string()
    .required()
    .pattern(/^(DEP_\d+|[A-Z0-9]{6,20})$/)
    .messages({
      'string.base': 'Deposit ID must be a string',
      'string.empty': 'Deposit ID cannot be empty',
      'string.pattern.base': 'Deposit ID must be either DEP_<number> or a 6-20 character alphanumeric DAN',
      'any.required': 'Deposit ID is required'
    })
};

/**
 * Validate query parameters from request
 *
 * @param {Object} queryParams - Raw query parameters from request
 * @param {Array<string>} allowedParams - List of allowed parameter names (optional)
 * @returns {Object} - Validated parameters with defaults applied
 * @throws {ValidationError} - If validation fails
 *
 * @example
 * const validated = validateQueryParams(request.query, ['days', 'limit']);
 * // Returns: { days: 30, limit: 100 }
 */
function validateQueryParams(queryParams = {}, allowedParams = null) {
  const validated = {};
  const errors = [];

  // Convert URLSearchParams to plain object if needed
  const params = {};
  if (queryParams instanceof URLSearchParams || queryParams.forEach) {
    queryParams.forEach((value, key) => {
      params[key] = value;
    });
  } else {
    Object.assign(params, queryParams);
  }

  // Define which parameters to validate
  const paramsToValidate = allowedParams || Object.keys(params);

  // Validate each parameter
  for (const paramName of paramsToValidate) {
    if (schemas[paramName]) {
      const value = params[paramName];

      // Skip if parameter not provided and has default
      if (value === undefined) {
        const defaultValue = schemas[paramName]._flags?.default;
        if (defaultValue !== undefined) {
          validated[paramName] = defaultValue;
        }
        continue;
      }

      // Validate parameter
      const { error, value: validatedValue } = schemas[paramName].validate(value);

      if (error) {
        errors.push({
          param: paramName,
          message: error.message,
          value: value
        });
      } else {
        validated[paramName] = validatedValue;
      }
    }
  }

  // Throw validation error if any validation failed
  if (errors.length > 0) {
    const err = new Error('Query parameter validation failed');
    err.name = 'ValidationError';
    err.statusCode = 400;
    err.validationErrors = errors;
    throw err;
  }

  return validated;
}

/**
 * Validate agency reference parameter
 *
 * @param {string} agencyRef - Agency reference to validate
 * @returns {string} - Validated agency reference (normalized)
 * @throws {ValidationError} - If validation fails
 *
 * @example
 * const validated = validateAgencyRef('1af89d60-662c-475b-bcc8-9bcbf04b6322');
 * // Returns: '1af89d60-662c-475b-bcc8-9bcbf04b6322'
 */
function validateAgencyRef(agencyRef) {
  const { error, value } = schemas.agencyRef.validate(agencyRef);

  if (error) {
    const err = new Error(`Invalid agency reference: ${error.message}`);
    err.name = 'ValidationError';
    err.statusCode = 400;
    err.validationErrors = [{
      param: 'agencyRef',
      message: error.message,
      value: agencyRef
    }];
    throw err;
  }

  return value.toLowerCase(); // Normalize to lowercase
}

/**
 * Validate organization ID parameter
 *
 * @param {string|number} organizationId - Organization ID to validate
 * @returns {string|number} - Validated organization ID
 * @throws {ValidationError} - If validation fails
 */
function validateOrganizationId(organizationId) {
  const { error, value } = schemas.organizationId.validate(organizationId);

  if (error) {
    const err = new Error(`Invalid organization ID: ${error.message}`);
    err.name = 'ValidationError';
    err.statusCode = 400;
    err.validationErrors = [{
      param: 'organizationId',
      message: error.message,
      value: organizationId
    }];
    throw err;
  }

  return value;
}

/**
 * Validate batch ID parameter
 *
 * @param {string} batchId - Batch ID to validate
 * @returns {string} - Validated batch ID
 * @throws {ValidationError} - If validation fails
 */
function validateBatchId(batchId) {
  const { error, value } = schemas.batchId.validate(batchId);

  if (error) {
    const err = new Error(`Invalid batch ID: ${error.message}`);
    err.name = 'ValidationError';
    err.statusCode = 400;
    err.validationErrors = [{
      param: 'batchId',
      message: error.message,
      value: batchId
    }];
    throw err;
  }

  return value;
}

/**
 * Create a custom Joi schema for specific use cases
 *
 * @param {Object} schemaDefinition - Joi schema definition
 * @returns {Object} - Joi schema
 *
 * @example
 * const customSchema = createCustomSchema({
 *   email: Joi.string().email(),
 *   age: Joi.number().min(18)
 * });
 */
function createCustomSchema(schemaDefinition) {
  return Joi.object(schemaDefinition);
}

/**
 * Validate request body against a schema
 *
 * @param {Object} body - Request body to validate
 * @param {Object} schema - Joi schema to validate against
 * @returns {Object} - Validated body
 * @throws {ValidationError} - If validation fails
 */
function validateRequestBody(body, schema) {
  const { error, value } = schema.validate(body, {
    abortEarly: false, // Collect all errors
    stripUnknown: true // Remove unknown fields
  });

  if (error) {
    const errors = error.details.map(detail => ({
      param: detail.path.join('.'),
      message: detail.message,
      value: detail.context.value
    }));

    const err = new Error('Request body validation failed');
    err.name = 'ValidationError';
    err.statusCode = 400;
    err.validationErrors = errors;
    throw err;
  }

  return value;
}

/**
 * Format validation error for HTTP response
 *
 * @param {Error} error - Validation error
 * @returns {Object} - Formatted error response
 */
function formatValidationError(error) {
  if (error.name === 'ValidationError') {
    return {
      success: false,
      error: error.message,
      validationErrors: error.validationErrors,
      timestamp: new Date().toISOString()
    };
  }

  // Generic error
  return {
    success: false,
    error: 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  // Schemas
  schemas,

  // Validation functions
  validateQueryParams,
  validateAgencyRef,
  validateOrganizationId,
  validateBatchId,
  validateRequestBody,

  // Utilities
  createCustomSchema,
  formatValidationError
};
