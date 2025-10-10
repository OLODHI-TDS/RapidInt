      // Handle status check endpoint with caching and provider-aware routing
      if (action === 'status') {
        const batchId = requestBody.batch_id;

        if (!batchId) {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'batch_id is required for status check',
              timestamp: new Date().toISOString()
            })
          };
        }

        try {
          // First, check cache for recent status
          const cachedStatus = await getBatchStatusCached(batchId, context);

          // If cached and not too old (5 minutes), return it immediately
          if (cachedStatus.isCached && cachedStatus.cacheAge < 300) {
            context.log(`Returning cached status for batch ${batchId} (age: ${cachedStatus.cacheAge}s)`);

            return {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'HIT',
                'X-Cache-Age': `${cachedStatus.cacheAge}s`
              },
              body: JSON.stringify({
                success: true,
                data: {
                  batch_id: cachedStatus.batchId,
                  status: cachedStatus.status,
                  dan: cachedStatus.dan
                },
                metadata: {
                  provider: cachedStatus.provider,
                  cached: true,
                  cacheAge: cachedStatus.cacheAge,
                  timestamp: new Date().toISOString()
                }
              })
            };
          }

          // Get provider that created this batch
          const provider = await getBatchProvider(batchId, context);
          context.log(`Batch ${batchId} was created by provider: ${provider}`);

          // Map provider to proper credentials
          const endpoint = mapActionToEndpoint('status');
          const statusPayload = {
            batch_id: batchId,
            credentials: requestBody.credentials || {}
          };

          // Execute status check against correct provider
          let statusResult;
          if (provider === 'current' || provider === 'legacy') {
            statusResult = await executeLegacyRequest(endpoint, statusPayload, context);
          } else {
            statusResult = await executeSalesforceRequest(endpoint, statusPayload, context, orgCredentials);
          }

          // Update batch tracking with latest status
          if (statusResult.success && statusResult.data) {
            await updateBatchStatus(
              batchId,
              statusResult.data.status || 'processing',
              statusResult.data.dan || null,
              statusResult.data,
              null,
              context
            );
          } else if (!statusResult.success) {
            await updateBatchStatus(
              batchId,
              'failed',
              null,
              null,
              { error: statusResult.error, data: statusResult.data },
              context
            );
          }

          const totalDuration = Date.now() - startTime;

          return {
            status: statusResult.success ? 200 : 500,
            headers: {
              'Content-Type': 'application/json',
              'X-TDS-Provider': provider,
              'X-Cache': 'MISS'
            },
            body: JSON.stringify({
              success: statusResult.success,
              data: statusResult.data,
              metadata: {
                provider,
                duration: totalDuration,
                timestamp: new Date().toISOString()
              }
            })
          };

        } catch (error) {
          context.error('Error checking batch status:', error);

          return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Failed to check batch status',
              message: error.message,
              timestamp: new Date().toISOString()
            })
          };
        }
      }

      // Store batch tracking after deposit creation
      if (action === 'create' && forwardResult.response && forwardResult.response.batch_id) {
        try {
          const batchId = forwardResult.response.batch_id;
          const provider = forwardResult.provider === 'legacy' ? 'current' : forwardResult.provider;

          // Extract metadata from request
          const altoTenancyId = requestBody.metadata?.sourceId || requestBody.additionalInfo?.source?.tenancyId;
          const altoAgencyRef = requestBody.metadata?.altoAgencyRef;
          const altoBranchId = requestBody.metadata?.altoBranchId;
          const altoWorkflowId = requestBody.metadata?.integrationId;

          // Determine organization ID (if available)
          let organizationId = null;
          if (orgCredentials && orgCredentials.organizationId) {
            organizationId = orgCredentials.organizationId;
          }

          const trackingOptions = {
            executionMode: forwardResult.mode,
            altoAgencyRef,
            altoBranchId,
            altoWorkflowId,
            requestDurationMs: totalDuration,
            providerResponseTimeMs: forwardResult.result?.duration
          };

          // For dual mode, store both batch IDs
          if (forwardResult.mode === 'dual') {
            trackingOptions.legacyBatchId = forwardResult.legacy?.data?.batch_id;
            trackingOptions.salesforceBatchId = forwardResult.salesforce?.data?.batch_id;
            trackingOptions.dualModeResults = forwardResult.comparison;
          }

          await storeBatchTracking(
            batchId,
            provider,
            organizationId,
            altoTenancyId,
            requestBody,
            forwardResult.response,
            trackingOptions,
            context
          );

          context.log(`Batch tracking stored for batch ${batchId}`);
        } catch (trackingError) {
          // Don't fail the request if batch tracking fails
          context.error('Failed to store batch tracking:', trackingError);
        }
      }
