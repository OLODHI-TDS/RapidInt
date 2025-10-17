/**
 * Dashboard Configuration Template
 *
 * Copy this file to dashboard-config.js and fill in your environment-specific values.
 * dashboard-config.js is gitignored and will NOT be committed to GitHub.
 *
 * Each environment (dev, staging, production) will have its own dashboard-config.js
 * with environment-specific values.
 */

const DASHBOARD_CONFIG = {
    // Azure Function App URL (auto-detected if deployed to same domain)
    // Leave empty to auto-detect, or specify for local development
    apiBaseUrl: '', // e.g., 'https://your-function-app.azurewebsites.net/api'

    // Authentication method: 'function-key' or 'entra-id'
    authMethod: 'function-key',

    // Function Key Authentication (legacy, will be deprecated)
    functionKey: '', // Your Azure Function default key

    // Entra ID Authentication (recommended)
    entraId: {
        clientId: '', // Dashboard app registration client ID
        tenantId: '', // Your Entra ID tenant ID
        authority: '', // e.g., 'https://login.microsoftonline.com/YOUR_TENANT_ID'
        apiScope: 'api://tds-rapidint-api/API.Access' // Backend API scope
    }
};

// Auto-detect API base URL if not specified
if (!DASHBOARD_CONFIG.apiBaseUrl) {
    // If dashboard is hosted on Azure Static Website and Functions are on azurewebsites.net
    // Try to construct the URL automatically
    const hostname = window.location.hostname;

    if (hostname.includes('.web.core.windows.net')) {
        // Deployed to Azure Static Website
        // Assume Function App follows naming convention
        // e.g., storage account: tdsrapidintdevstorage.z33.web.core.windows.net
        //       function app:    rapidintdev-xxx.azurewebsites.net

        console.log('⚠️ Auto-detection of API URL not configured. Please set apiBaseUrl in dashboard-config.js');
        DASHBOARD_CONFIG.apiBaseUrl = prompt('Enter Azure Function App URL (e.g., https://your-app.azurewebsites.net/api)');
    } else {
        // Local development - use localhost
        DASHBOARD_CONFIG.apiBaseUrl = 'http://localhost:7071/api';
    }
}
