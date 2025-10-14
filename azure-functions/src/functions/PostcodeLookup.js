const { app } = require('@azure/functions');
const axios = require('axios');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');

// Cache for postcode lookups (5 minute TTL)
const postcodeCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Lookup postcode using postcodes.io API
 */
async function lookupPostcodeFromAPI(postcode) {
    // Normalize postcode (remove spaces, uppercase)
    const normalizedPostcode = postcode.replace(/\s+/g, '').toUpperCase();

    // Check cache first
    const cacheKey = normalizedPostcode;
    const cached = postcodeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return { ...cached.data, cached: true };
    }

    try {
        const response = await axios.get(
            `https://api.postcodes.io/postcodes/${normalizedPostcode}`,
            { timeout: 10000 }
        );

        if (response.data.status === 200 && response.data.result) {
            const result = response.data.result;

            // Extract region as the county
            // Use admin_district as fallback if region not available
            const county = result.region || result.admin_district || result.admin_county || 'Unknown';

            const data = {
                success: true,
                postcode: result.postcode, // Use the formatted postcode from API
                county: county,
                country: result.country,
                region: result.region,
                cached: false
            };

            // Cache the result
            postcodeCache.set(cacheKey, {
                data,
                timestamp: Date.now()
            });

            return data;
        } else {
            throw new Error('Invalid response from postcodes.io');
        }

    } catch (error) {
        // If postcode not found (404) or other error
        if (error.response?.status === 404) {
            return {
                success: false,
                postcode,
                error: 'Postcode not found',
                county: null
            };
        }

        throw error;
    }
}

/**
 * PostcodeLookup Azure Function
 * GET /api/postcode/{postcode} - Single lookup
 * POST /api/postcode - Batch lookup
 */
app.http('PostcodeLookup', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    route: 'postcode/{postcode?}',
    handler: async (request, context) => {
        try {
            const startTime = Date.now();

            // Handle GET request - single postcode lookup
            if (request.method === 'GET') {
                let postcode = request.params.postcode;

                if (!postcode) {
                    return {
                        status: 400,
                        jsonBody: {
                            error: 'Postcode parameter is required',
                            usage: 'GET /api/postcode/{postcode}'
                        }
                    };
                }

                // ✅ HIGH-006 FIX: Validate UK postcode format
                try {
                    const { error, value } = schemas.ukPostcode.validate(postcode);
                    if (error) {
                        context.warn('❌ Postcode validation failed:', error.message);

                        return {
                            status: 400,
                            jsonBody: {
                                success: false,
                                error: 'Invalid postcode format',
                                message: error.message,
                                postcode: postcode,
                                suggestion: 'Please use valid UK postcode format (e.g., SW1A 1AA, M1 1AE, GU16 7HF)'
                            }
                        };
                    }
                    postcode = value; // Use validated/trimmed postcode
                    context.log('✅ Postcode validation passed:', postcode);
                } catch (validationError) {
                    throw validationError;
                }

                const result = await lookupPostcodeFromAPI(postcode);
                const responseTime = Date.now() - startTime;

                context.log(`Postcode lookup: ${postcode} -> ${result.county || 'Not found'} (${responseTime}ms, cached: ${result.cached})`);

                if (result.success) {
                    return {
                        status: 200,
                        jsonBody: {
                            ...result,
                            responseTime: `${responseTime}ms`
                        }
                    };
                } else {
                    return {
                        status: 404,
                        jsonBody: {
                            success: false,
                            error: result.error || 'Postcode not found',
                            postcode: result.postcode,
                            suggestion: 'Please check the postcode format (e.g., NN1 5SL, TR13 8AJ)'
                        }
                    };
                }
            }

            // Handle POST request - batch lookup
            if (request.method === 'POST') {
                const body = await request.json();

                // ✅ HIGH-006 FIX: Validate batch postcode request
                let validatedBody;
                try {
                    validatedBody = validateRequestBody(body, schemas.batchPostcodeLookup);
                    context.log('✅ Batch postcode request validation passed');
                } catch (validationError) {
                    if (validationError.name === 'ValidationError') {
                        context.warn('❌ Batch postcode request validation failed:', validationError.validationErrors);

                        return {
                            status: 400,
                            jsonBody: formatValidationError(validationError)
                        };
                    }
                    // Re-throw unexpected errors
                    throw validationError;
                }

                const postcodes = validatedBody.postcodes;

                // Lookup all postcodes
                const results = await Promise.all(
                    postcodes.map(async (postcode) => {
                        try {
                            const result = await lookupPostcodeFromAPI(postcode);
                            return {
                                postcode: result.postcode || postcode,
                                county: result.county,
                                country: result.country,
                                region: result.region,
                                found: result.success,
                                cached: result.cached
                            };
                        } catch (error) {
                            return {
                                postcode,
                                county: null,
                                found: false,
                                error: error.message
                            };
                        }
                    })
                );

                const responseTime = Date.now() - startTime;
                const foundCount = results.filter(r => r.found).length;

                context.log(`Batch postcode lookup: ${postcodes.length} postcodes, ${foundCount} found (${responseTime}ms)`);

                return {
                    status: 200,
                    jsonBody: {
                        totalRequested: postcodes.length,
                        totalFound: foundCount,
                        responseTime: `${responseTime}ms`,
                        results
                    }
                };
            }

        } catch (error) {
            context.log.error('PostcodeLookup error:', error);
            return {
                status: 500,
                jsonBody: {
                    error: 'Internal server error',
                    message: error.message
                }
            };
        }
    }
});