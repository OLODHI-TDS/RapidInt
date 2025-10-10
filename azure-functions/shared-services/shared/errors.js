/**
 * Custom Error Classes for API Error Handling
 *
 * Provides structured error types for better error handling, retry logic,
 * and circuit breaker integration across the TDS API integration.
 */

/**
 * Base class for all custom errors
 */
class BaseAPIError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options.cause;
    this.isRetryable = options.isRetryable ?? false;
    this.severity = options.severity || 'medium';
    this.timestamp = new Date().toISOString();
    this.context = options.context || {};

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      isRetryable: this.isRetryable,
      severity: this.severity,
      timestamp: this.timestamp,
      context: this.context,
      cause: this.cause ? {
        message: this.cause.message,
        name: this.cause.name,
        stack: this.cause.stack
      } : undefined,
      stack: this.stack
    };
  }
}

/**
 * TransientError - Retryable network issues, timeouts, temporary unavailability
 *
 * Use for errors that are likely to succeed if retried:
 * - Network timeouts
 * - Connection failures
 * - 429 Rate limiting
 * - 503 Service unavailable
 * - Temporary database connection issues
 */
class TransientError extends BaseAPIError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isRetryable: true,
      severity: options.severity || 'medium'
    });

    this.statusCode = options.statusCode;
    this.retryAfter = options.retryAfter; // Seconds to wait before retry (from Retry-After header)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
      retryAfter: this.retryAfter
    };
  }
}

/**
 * PermanentError - Non-retryable errors like validation failures, auth errors
 *
 * Use for errors that will not succeed even if retried:
 * - 400 Bad Request (validation errors)
 * - 401 Unauthorized
 * - 403 Forbidden
 * - 404 Not Found
 * - 409 Conflict
 * - Invalid input data
 */
class PermanentError extends BaseAPIError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isRetryable: false,
      severity: options.severity || 'high'
    });

    this.statusCode = options.statusCode;
    this.validationErrors = options.validationErrors || [];
  }

  toJSON() {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
      validationErrors: this.validationErrors
    };
  }
}

/**
 * ProviderError - API-specific errors with provider context
 *
 * Use for errors specific to a provider (Legacy, Salesforce):
 * - Provider-specific error codes
 * - Provider-specific error messages
 * - Provider API failures
 */
class ProviderError extends BaseAPIError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isRetryable: options.isRetryable ?? true,
      severity: options.severity || 'high'
    });

    this.provider = options.provider; // 'legacy' or 'salesforce'
    this.providerCode = options.providerCode; // Provider-specific error code
    this.statusCode = options.statusCode;
    this.originalResponse = options.originalResponse;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      provider: this.provider,
      providerCode: this.providerCode,
      statusCode: this.statusCode,
      originalResponse: this.originalResponse
    };
  }
}

/**
 * TransformationError - Data mapping/transformation failures
 *
 * Use for errors during data transformation:
 * - Legacy to Salesforce transformation failures
 * - Salesforce to Legacy transformation failures
 * - Missing required fields
 * - Invalid data formats
 */
class TransformationError extends BaseAPIError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isRetryable: false,
      severity: options.severity || 'critical'
    });

    this.transformationType = options.transformationType; // 'legacy-to-salesforce' or 'salesforce-to-legacy'
    this.missingFields = options.missingFields || [];
    this.invalidFields = options.invalidFields || [];
    this.sourceData = options.sourceData;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      transformationType: this.transformationType,
      missingFields: this.missingFields,
      invalidFields: this.invalidFields,
      sourceData: this.sourceData
    };
  }
}

/**
 * ConfigurationError - Invalid configuration
 *
 * Use for configuration-related errors:
 * - Missing environment variables
 * - Invalid configuration values
 * - Missing credentials
 * - Invalid routing mode
 */
class ConfigurationError extends BaseAPIError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isRetryable: false,
      severity: 'critical'
    });

    this.configKey = options.configKey; // The configuration key that's invalid
    this.expectedValue = options.expectedValue;
    this.actualValue = options.actualValue;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      configKey: this.configKey,
      expectedValue: this.expectedValue,
      actualValue: this.actualValue
    };
  }
}

/**
 * Classify HTTP error into appropriate error type
 *
 * @param {Error} error - The original error
 * @param {string} provider - The provider name ('legacy' or 'salesforce')
 * @param {object} context - Additional context
 * @returns {BaseAPIError} - Classified error
 */
function classifyError(error, provider = null, context = {}) {
  const statusCode = error.response?.status || error.statusCode;
  const responseData = error.response?.data;
  const message = error.message || 'Unknown error occurred';

  // Network/timeout errors
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET') {
    return new TransientError(`Network error: ${message}`, {
      cause: error,
      statusCode,
      context: { ...context, errorCode: error.code }
    });
  }

  // Handle by status code
  if (statusCode) {
    // Rate limiting - retryable
    if (statusCode === 429) {
      const retryAfter = error.response?.headers['retry-after'];
      return new TransientError('Rate limit exceeded', {
        cause: error,
        statusCode,
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
        context
      });
    }

    // Server errors - retryable
    if (statusCode >= 500 && statusCode < 600) {
      return new TransientError(`Server error: ${message}`, {
        cause: error,
        statusCode,
        context
      });
    }

    // Authentication errors - permanent
    if (statusCode === 401 || statusCode === 403) {
      return new PermanentError(`Authentication failed: ${message}`, {
        cause: error,
        statusCode,
        severity: 'critical',
        context
      });
    }

    // Validation errors - permanent
    if (statusCode === 400 || statusCode === 422) {
      return new PermanentError(`Validation failed: ${message}`, {
        cause: error,
        statusCode,
        validationErrors: responseData?.errors || [],
        context
      });
    }

    // Not found - permanent
    if (statusCode === 404) {
      return new PermanentError(`Resource not found: ${message}`, {
        cause: error,
        statusCode,
        context
      });
    }
  }

  // Provider-specific error
  if (provider) {
    return new ProviderError(message, {
      cause: error,
      provider,
      statusCode,
      originalResponse: responseData,
      context
    });
  }

  // Default to transient for unknown errors
  return new TransientError(message, {
    cause: error,
    statusCode,
    context
  });
}

module.exports = {
  BaseAPIError,
  TransientError,
  PermanentError,
  ProviderError,
  TransformationError,
  ConfigurationError,
  classifyError
};
