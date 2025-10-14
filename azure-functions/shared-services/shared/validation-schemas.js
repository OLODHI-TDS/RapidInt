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
