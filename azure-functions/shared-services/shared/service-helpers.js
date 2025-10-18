/**
 * Service Helpers - Shared utilities for internal function-to-function calls
 *
 * These helpers allow functions to call each other's core logic directly
 * without HTTP overhead or authentication requirements.
 */

const { TableClient } = require('@azure/data-tables');
const axios = require('axios');

/**
 * Load TDS Settings from table storage
 * @param {Object} context - Azure Function context for logging
 * @returns {Promise<Object>} TDS settings { development: {...}, production: {...} }
 */
async function loadTDSSettings(context = null) {
    try {
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        const tableClient = TableClient.fromConnectionString(connectionString, 'TDSSettings');

        // Create table if it doesn't exist
        await tableClient.createTable().catch(() => {});

        const entity = await tableClient.getEntity('Settings', 'TDSConfig');

        context?.log('✅ TDS settings loaded successfully');

        return {
            development: JSON.parse(entity.developmentSettings || '{}'),
            production: JSON.parse(entity.productionSettings || '{}')
        };
    } catch (error) {
        if (error.statusCode === 404) {
            // Return defaults if settings not found
            context?.log('⚠️ TDS settings not found, returning defaults');

            return {
                development: {
                    legacyTdsApi: '',
                    salesforceTdsApi: 'https://thedisputeservice--fullcopy.sandbox.my.salesforce.com'
                },
                production: {
                    legacyTdsApi: '',
                    salesforceTdsApi: 'https://thedisputeservice.my.salesforce.com'
                }
            };
        }
        throw error;
    }
}

/**
 * Lookup postcode region using ONS Postcode Directory
 * @param {string} postcode - UK postcode to lookup
 * @param {Object} context - Azure Function context for logging
 * @returns {Promise<Object>} { region: string, cached: boolean }
 */
async function lookupPostcode(postcode, context = null) {
    try {
        // Normalize postcode (uppercase, trim)
        const normalizedPostcode = postcode.toUpperCase().trim();

        // Check cache first
        const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
        const cacheTableClient = TableClient.fromConnectionString(connectionString, 'PostcodeCache');

        try {
            await cacheTableClient.createTable().catch(() => {});
            const cacheEntity = await cacheTableClient.getEntity('Postcode', normalizedPostcode);

            if (cacheEntity && cacheEntity.region) {
                context?.log(`✅ Postcode ${normalizedPostcode} found in cache: ${cacheEntity.region}`);
                return { region: cacheEntity.region, cached: true };
            }
        } catch (error) {
            // Cache miss or error - proceed to API lookup
        }

        // Lookup from ONS API
        const response = await axios.get(
            `https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`,
            { timeout: 5000 }
        );

        if (response.data && response.data.result) {
            const region = response.data.result.region || response.data.result.european_electoral_region;

            // Cache the result
            try {
                await cacheTableClient.upsertEntity({
                    partitionKey: 'Postcode',
                    rowKey: normalizedPostcode,
                    region: region,
                    lookedUpAt: new Date().toISOString()
                });
            } catch (cacheError) {
                context?.warn('Failed to cache postcode lookup:', cacheError.message);
            }

            context?.log(`✅ Postcode ${normalizedPostcode} looked up: ${region}`);
            return { region, cached: false };
        }

        throw new Error('Invalid postcode response from API');

    } catch (error) {
        context?.error(`❌ Postcode lookup failed for ${postcode}:`, error.message);
        throw new Error(`Postcode lookup failed: ${error.message}`);
    }
}

module.exports = {
    loadTDSSettings,
    lookupPostcode
};
