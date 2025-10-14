const { app } = require('@azure/functions');
const crypto = require('crypto');
const { validateRequestBody, schemas, formatValidationError } = require('../../shared-services/shared/validation-schemas');

/**
 * Alto Webhook Receiver Azure Function
 * Receives CloudEvents webhooks from Alto and triggers the integration workflow
 */
app.http('AltoWebhook', {
    methods: ['POST', 'GET'],
    authLevel: 'function', // Secure with function key
    route: 'webhooks/alto',
    handler: async (request, context) => {

        // Handle GET request for webhook validation
        if (request.method === 'GET') {
            return {
                status: 200,
                jsonBody: {
                    status: 'active',
                    message: 'Alto webhook endpoint is operational',
                    timestamp: new Date().toISOString(),
                    supportedEvents: ['Tenancy.Created', 'Tenancy.Updated'],
                    format: 'CloudEvents v1.0'
                }
            };
        }

        try {
            context.log('🔔 Alto webhook received');

            // Get raw body for signature verification
            const rawBody = await request.text();
            const headers = request.headers;

            // Verify webhook signature if secret is configured
            const signature = headers.get('x-alto-webhook-signature');
            const timestamp = headers.get('x-alto-webhook-timestamp');

            if (process.env.ALTO_WEBHOOK_SECRET && signature && timestamp) {
                const isValid = verifyAltoWebhookSignature(rawBody, signature, timestamp);

                if (!isValid) {
                    context.log('❌ Alto webhook signature verification failed');
                    return {
                        status: 401,
                        jsonBody: {
                            error: 'Webhook signature verification failed',
                            timestamp: new Date().toISOString()
                        }
                    };
                }
                context.log('✅ Alto webhook signature verified');
            } else {
                context.log('⚠️ Alto webhook signature verification skipped');
            }

            // Parse webhook payload
            let webhookData = JSON.parse(rawBody);
            context.log('📦 Alto webhook payload:', JSON.stringify(webhookData, null, 2));

            // ✅ HIGH-006 FIX: Validate Alto webhook request using Joi schema
            try {
                webhookData = validateRequestBody(webhookData, schemas.altoWebhookRequest);
                context.log('✅ Alto webhook Joi schema validation passed');
            } catch (validationError) {
                if (validationError.name === 'ValidationError') {
                    context.warn('❌ Alto webhook Joi schema validation failed:', validationError.validationErrors);

                    return {
                        status: 400,
                        jsonBody: formatValidationError(validationError)
                    };
                }
                // Re-throw unexpected errors
                throw validationError;
            }

            // Extract integration data from CloudEvents format
            const integrationData = extractIntegrationData(webhookData);

            // Validate required fields (legacy validation - now supplemental to Joi)
            const validation = validateWebhookData(integrationData);
            if (!validation.isValid) {
                context.log('❌ Webhook validation failed:', validation.errors);
                return {
                    status: 400,
                    jsonBody: {
                        error: 'Invalid webhook data',
                        errors: validation.errors,
                        timestamp: new Date().toISOString()
                    }
                };
            }

            context.log('✅ Webhook data validated successfully');

            // Trigger the integration workflow asynchronously (fire and forget)
            const webhookId = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

            context.log('🚀 Queuing Alto integration workflow:', webhookId);

            // Call the WorkflowOrchestrator via HTTP (don't await - fire and forget)
            const workflowUrl = process.env.WORKFLOW_ORCHESTRATOR_URL || 'http://localhost:7071/api/workflows/alto-tds';

            // Trigger workflow asynchronously
            fetch(workflowUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenancyId: integrationData.tenancyId,
                    agencyRef: integrationData.agencyRef,
                    branchId: integrationData.branchId,
                    integrationId: integrationData.integrationId,
                    webhookId: webhookId,
                    source: 'alto-webhook'
                })
            }).catch(err => {
                context.log('⚠️ Background workflow trigger error (non-blocking):', err.message);
            });

            // Return immediately - webhook acknowledged
            return {
                status: 202, // 202 Accepted - processing asynchronously
                jsonBody: {
                    status: 'accepted',
                    message: 'Webhook received and queued for processing',
                    webhookId: webhookId,
                    tenancyId: integrationData.tenancyId,
                    agencyRef: integrationData.agencyRef,
                    timestamp: new Date().toISOString(),
                    note: 'Integration will be processed asynchronously. Check audit log for results.'
                }
            };

        } catch (error) {
            context.log('❌ Alto webhook processing failed:', error);
            return {
                status: 500,
                jsonBody: {
                    error: 'Alto webhook processing failed',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

/**
 * Extract integration data from CloudEvents webhook payload
 */
function extractIntegrationData(webhookData) {
    let integrationData;

    if (webhookData.specversion && webhookData.data) {
        // CloudEvents format (Alto's actual format)
        let tenancyId = webhookData.data.subjectId;

        // Extract from subject path if not in data
        if (!tenancyId && webhookData.subject) {
            const subjectMatch = webhookData.subject.match(/\/tenancies\/(.+)$/);
            if (subjectMatch) {
                tenancyId = subjectMatch[1];
            }
        }

        integrationData = {
            tenancyId: tenancyId,
            agencyRef: webhookData.data.agencyRef,
            branchId: webhookData.data.branchId,
            integrationId: webhookData.data.integrationId,
            relatedSubjects: webhookData.data.relatedSubjects,
            eventType: webhookData.type || 'Tenancy.Created',
            timestamp: webhookData.time || new Date().toISOString(),
            source: webhookData.source,
            dataContentType: webhookData.datacontenttype,
            cloudEvents: true
        };
    } else {
        // Direct format (backward compatibility)
        integrationData = {
            ...webhookData,
            eventType: webhookData.event || 'Tenancy.Created',
            timestamp: webhookData.timestamp || new Date().toISOString(),
            cloudEvents: false
        };
    }

    return integrationData;
}

/**
 * Validate webhook data
 */
function validateWebhookData(data) {
    const errors = [];

    if (!data.tenancyId) errors.push('Missing tenancyId');
    if (!data.agencyRef) errors.push('Missing agencyRef');
    if (!data.eventType) errors.push('Missing eventType');

    // Validate event type
    const supportedEvents = ['Tenancy.Created', 'Tenancy.Updated', 'Tenancy.Cancelled'];
    if (data.eventType && !supportedEvents.includes(data.eventType)) {
        errors.push(`Unsupported event type: ${data.eventType}`);
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Verify Alto webhook signature
 */
function verifyAltoWebhookSignature(payload, signature, timestamp) {
    try {
        const secret = process.env.ALTO_WEBHOOK_SECRET;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${payload}`)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch (error) {
        return false;
    }
}

