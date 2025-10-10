# Salesforce Authentication Setup Guide

## Overview

The TDS Integration Platform now includes a comprehensive Salesforce authentication module that supports **two authentication methods**:

1. **API Key** - Simple static key authentication (similar to legacy TDS API)
2. **OAuth2 Client Credentials** - Secure session-based authentication with automatic token refresh

---

## Authentication Methods

### Method 1: API Key Authentication

**When to use:**
- Simple integration requirements
- Static key management is acceptable
- No token expiry concerns

**Configuration:**
```bash
SALESFORCE_AUTH_METHOD=api-key
SALESFORCE_API_KEY=your-static-api-key-here
```

**How it works:**
- Static Bearer token passed in Authorization header
- No token refresh needed
- Simplest implementation

**Request example:**
```http
POST /api/deposits
Authorization: Bearer your-static-api-key-here
Content-Type: application/json
```

---

### Method 2: OAuth2 Client Credentials (Recommended)

**When to use:**
- Production environments
- Enhanced security required
- Token rotation/expiry needed

**Configuration:**
```bash
SALESFORCE_AUTH_METHOD=oauth2
SALESFORCE_CLIENT_ID=your-client-id
SALESFORCE_CLIENT_SECRET=your-client-secret
SALESFORCE_AUTH_URL=https://login.salesforce.com/services/oauth2/token
SALESFORCE_TOKEN_EXPIRY_SECONDS=300  # 5 minutes
```

**How it works:**
1. Client ID and Secret are Base64 encoded
2. Exchange credentials for session token at auth endpoint
3. Token cached for ~5 minutes
4. Automatic refresh 60 seconds before expiry
5. Thread-safe token management

**Authentication flow:**
```
1. First Request:
   ├─→ Check cache (empty)
   ├─→ Encode credentials: base64(clientId:clientSecret)
   ├─→ POST to auth endpoint with Basic Auth
   ├─→ Receive access_token
   ├─→ Cache token with expiry time
   └─→ Use token for API request

2. Subsequent Requests (within 4 minutes):
   ├─→ Check cache (valid token exists)
   └─→ Use cached token

3. Token Expiring Soon (after 4 minutes):
   ├─→ Check cache (token expiring in < 60 seconds)
   ├─→ Refresh token in background
   ├─→ Update cache
   └─→ Use new token
```

---

## Setup Instructions

### Step 1: Get Salesforce Credentials from TDS

Contact TDS team to obtain:

**For OAuth2:**
- Client ID
- Client Secret
- Authentication endpoint URL
- Token expiry duration (confirm 5 minutes)

**For API Key:**
- Static API key

### Step 2: Store Credentials in Azure Key Vault

**Development environment:**
```bash
# OAuth2 credentials
az keyvault secret set \
  --vault-name tds-platform-dev-kv \
  --name salesforce-client-id-dev \
  --value "your-client-id"

az keyvault secret set \
  --vault-name tds-platform-dev-kv \
  --name salesforce-client-secret-dev \
  --value "your-client-secret"

# Or API Key (if using)
az keyvault secret set \
  --vault-name tds-platform-dev-kv \
  --name salesforce-api-key-dev \
  --value "your-api-key"
```

**Production environment:**
```bash
# OAuth2 credentials
az keyvault secret set \
  --vault-name tds-platform-prod-kv \
  --name salesforce-client-id-prod \
  --value "your-client-id"

az keyvault secret set \
  --vault-name tds-platform-prod-kv \
  --name salesforce-client-secret-prod \
  --value "your-client-secret"
```

### Step 3: Configure Function App Settings

**Using Azure Portal:**
1. Navigate to Function App
2. Configuration → Application Settings
3. Add new settings:

```
SALESFORCE_AUTH_METHOD = oauth2
SALESFORCE_AUTH_URL = https://login.salesforce.com/services/oauth2/token
SALESFORCE_CLIENT_ID = @Microsoft.KeyVault(SecretUri=https://tds-platform-prod-kv.vault.azure.net/secrets/salesforce-client-id-prod/)
SALESFORCE_CLIENT_SECRET = @Microsoft.KeyVault(SecretUri=https://tds-platform-prod-kv.vault.azure.net/secrets/salesforce-client-secret-prod/)
SALESFORCE_TOKEN_EXPIRY_SECONDS = 300
```

**Using Azure CLI:**
```bash
az functionapp config appsettings set \
  --name tds-platform-prod-functions \
  --resource-group tds-integration-prod \
  --settings \
    SALESFORCE_AUTH_METHOD=oauth2 \
    SALESFORCE_AUTH_URL=https://login.salesforce.com/services/oauth2/token \
    SALESFORCE_CLIENT_ID=@Microsoft.KeyVault(SecretUri=https://tds-platform-prod-kv.vault.azure.net/secrets/salesforce-client-id-prod/) \
    SALESFORCE_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=https://tds-platform-prod-kv.vault.azure.net/secrets/salesforce-client-secret-prod/) \
    SALESFORCE_TOKEN_EXPIRY_SECONDS=300
```

### Step 4: Grant Function App Access to Key Vault

```bash
# Get Function App system-assigned identity
PRINCIPAL_ID=$(az functionapp identity show \
  --name tds-platform-prod-functions \
  --resource-group tds-integration-prod \
  --query principalId \
  --output tsv)

# Grant secrets access
az keyvault set-policy \
  --name tds-platform-prod-kv \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

---

## Testing Authentication

### Method 1: Health Check Endpoint

```bash
# Check authentication status
curl "https://tds-platform-dev-functions.azurewebsites.net/api/tds-forwarder/health?code=<function-key>"
```

**Expected response:**
```json
{
  "status": "healthy",
  "mode": "legacy-only",
  "authentication": {
    "status": "healthy",
    "method": "oauth2",
    "configured": true,
    "tokenCached": true,
    "tokenValid": true,
    "issues": []
  }
}
```

### Method 2: Using Node.js Test Script

Create `test-auth.js`:
```javascript
const { getSalesforceAuthHeader, testAuthentication } = require('./shared/salesforce-auth');

async function test() {
  console.log('Testing Salesforce authentication...');

  const mockContext = {
    log: console.log,
    error: console.error
  };

  try {
    // Test getting auth header
    const headers = await getSalesforceAuthHeader(mockContext);
    console.log('✓ Successfully obtained auth headers');
    console.log('  Authorization:', headers.Authorization.substring(0, 20) + '...');

    // Test actual API call
    const baseUrl = process.env.TDS_SALESFORCE_BASE_URL;
    const result = await testAuthentication(baseUrl, mockContext);

    if (result.success) {
      console.log('✓ Authentication test passed');
      console.log('  Method:', result.method);
      console.log('  Status:', result.status);
    } else {
      console.error('✗ Authentication test failed:', result.error);
    }
  } catch (error) {
    console.error('✗ Test failed:', error.message);
  }
}

test();
```

Run:
```bash
node test-auth.js
```

---

## Monitoring & Troubleshooting

### Check Authentication Logs in Application Insights

**Query: Recent authentication attempts**
```kusto
traces
| where message contains "Salesforce" and message contains "auth"
| project timestamp, message, customDimensions
| order by timestamp desc
| take 50
```

**Query: OAuth2 token refreshes**
```kusto
traces
| where message contains "OAuth2 token refreshed"
| project timestamp,
         duration=customDimensions.duration,
         expiresIn=customDimensions.expirySeconds
| order by timestamp desc
```

**Query: Authentication failures**
```kusto
traces
| where severityLevel > 2  // Warning or Error
  and message contains "Salesforce"
  and message contains "auth"
| project timestamp, message, customDimensions
| order by timestamp desc
```

### Common Issues & Solutions

#### Issue 1: "SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set"

**Solution:**
```bash
# Verify environment variables are set
az functionapp config appsettings list \
  --name tds-platform-prod-functions \
  --resource-group tds-integration-prod \
  --query "[?name=='SALESFORCE_CLIENT_ID' || name=='SALESFORCE_CLIENT_SECRET']"

# Ensure Key Vault references are correct
# They should look like: @Microsoft.KeyVault(SecretUri=https://...)
```

#### Issue 2: "Salesforce OAuth2 authentication failed: Request failed with status code 401"

**Possible causes:**
- Invalid Client ID or Client Secret
- Credentials not Base64 encoded correctly
- Wrong auth endpoint URL
- Salesforce credentials expired

**Solution:**
```bash
# Verify credentials directly
echo -n "client_id:client_secret" | base64

# Test auth endpoint manually
curl -X POST https://login.salesforce.com/services/oauth2/token \
  -H "Authorization: Basic $(echo -n 'client_id:client_secret' | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

#### Issue 3: "No OAuth2 token cached (will be fetched on first request)"

**This is normal!**
- Token is fetched lazily on first API request
- Reduces unnecessary auth calls during startup
- Can force refresh if needed

**To warm up cache:**
```bash
# Call health endpoint to trigger initial auth
curl "https://tds-platform-prod-functions.azurewebsites.net/api/tds-forwarder/health?code=<key>"
```

#### Issue 4: Token refresh errors during high load

**Solution:**
- The auth module includes thread-safe token refresh
- Multiple concurrent requests will wait for single refresh
- If issues persist, increase `SALESFORCE_TOKEN_EXPIRY_SECONDS`

---

## Security Best Practices

### 1. Never Commit Credentials
```bash
# Add to .gitignore
local.settings.json
*.env
.env.*
secrets/
```

### 2. Use Key Vault for All Environments
- ✅ Development: Store in Key Vault
- ✅ Staging: Store in Key Vault
- ✅ Production: Store in Key Vault
- ❌ Never use plaintext in app settings

### 3. Rotate Credentials Regularly
```bash
# Update secret in Key Vault
az keyvault secret set \
  --vault-name tds-platform-prod-kv \
  --name salesforce-client-secret-prod \
  --value "new-secret"

# Function App automatically picks up new value within minutes
# No restart needed!
```

### 4. Monitor Failed Authentication Attempts
```bash
# Create alert for auth failures
az monitor metrics alert create \
  --name "Salesforce Auth Failures" \
  --resource-group tds-integration-prod \
  --scopes /subscriptions/.../resourceGroups/tds-integration-prod/providers/Microsoft.Web/sites/tds-platform-prod-functions \
  --condition "customDimensions.authStatus == 'failed'" \
  --window-size 5m \
  --evaluation-frequency 1m
```

---

## Configuration Reference

### All Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SALESFORCE_AUTH_METHOD` | No | `oauth2` | Authentication method: `api-key` or `oauth2` |
| `SALESFORCE_API_KEY` | If using api-key | - | Static API key for Bearer authentication |
| `SALESFORCE_CLIENT_ID` | If using oauth2 | - | OAuth2 client ID |
| `SALESFORCE_CLIENT_SECRET` | If using oauth2 | - | OAuth2 client secret |
| `SALESFORCE_AUTH_URL` | If using oauth2 | `https://login.salesforce.com/...` | OAuth2 token endpoint |
| `SALESFORCE_TOKEN_EXPIRY_SECONDS` | No | `300` | Token expiry time in seconds (5 min) |

### Token Cache Behavior

- **Cache Duration:** `tokenExpirySeconds - 60` seconds (4 minutes for 5-minute tokens)
- **Refresh Buffer:** 60 seconds before actual expiry
- **Thread Safety:** Single refresh for concurrent requests
- **Persistence:** In-memory only (resets on function restart)

---

## Migration from Mock Implementation

If you currently have mock tokens, here's how to migrate:

### Before (Mock):
```javascript
async function getSalesforceAccessToken() {
  return process.env.SALESFORCE_ACCESS_TOKEN || 'mock-token';
}
```

### After (Real OAuth2):
```javascript
const { getSalesforceAuthHeader } = require('../shared/salesforce-auth');

// In your function:
const authHeaders = await getSalesforceAuthHeader(context);

// Use in axios request:
axios.post(url, payload, {
  headers: {
    'Content-Type': 'application/json',
    ...authHeaders  // Spreads { Authorization: 'Bearer <token>' }
  }
});
```

**No other code changes needed!** The auth module handles:
- ✅ Token retrieval
- ✅ Token caching
- ✅ Automatic refresh
- ✅ Error handling
- ✅ Thread safety

---

## Next Steps

1. ✅ Get credentials from TDS team
2. ✅ Store in Azure Key Vault
3. ✅ Configure Function App settings
4. ✅ Test with health endpoint
5. ✅ Monitor first production requests
6. ✅ Set up alerting for auth failures

---

**Last Updated:** 2025-10-01
**Module Version:** 1.0.0
**Author:** Omar Lodhi
