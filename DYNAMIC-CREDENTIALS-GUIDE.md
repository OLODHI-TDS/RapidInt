# Dynamic Credentials Guide

## Overview

The TDS Request Forwarder now supports **dynamic, per-organization credentials** for Salesforce EWC API authentication. This means each customer/organization can have their own TDS Member ID, Branch ID, and API Key, retrieved automatically from the organization mapping table.

---

## How It Works

### 1. Credentials Storage

Organization-specific TDS credentials are stored in the `organization_mappings` table:

```sql
CREATE TABLE organization_mappings (
  id UUID PRIMARY KEY,
  alto_agency_ref VARCHAR(255),
  alto_branch_id VARCHAR(100),
  tds_member_id VARCHAR(50),       -- TDS Member ID
  tds_branch_id VARCHAR(50),       -- TDS Branch ID (usually "0")
  tds_api_key_encrypted TEXT,      -- Encrypted API key
  region VARCHAR(20),              -- EW, Scotland, NI
  scheme_type VARCHAR(20),         -- Custodial, Insured
  organization_name VARCHAR(255),
  is_active BOOLEAN
);
```

### 2. API Key Encryption

- API keys are **encrypted at rest** using AES-256-CBC
- Encryption key is stored in `ENCRYPTION_SECRET` environment variable
- Keys are decrypted only when needed for API calls
- Never logged or exposed in responses

### 3. Credential Retrieval

The forwarder retrieves credentials in this order:

#### Option 1: From Request Body Metadata (Recommended)
```json
{
  "metadata": {
    "altoAgencyRef": "1af89d60-662c-475b-bcc8-9bcbf04b6322",
    "altoBranchId": "branch-001"
  },
  "deposit": {
    "amount": 1500,
    ...
  }
}
```

#### Option 2: From HTTP Headers (Alternative)
```http
POST /api/tds-forwarder/create
X-Alto-Agency-Ref: 1af89d60-662c-475b-bcc8-9bcbf04b6322
X-Alto-Branch-Id: branch-001
Content-Type: application/json

{ "deposit": { ... } }
```

#### Option 3: Test Credentials (Development Only)
Set `USE_TEST_CREDENTIALS=true` in environment variables

---

## AccessToken Format

The Salesforce EWC API requires an `AccessToken` header with this format:

```
{Scheme}-{SchemeType}-{MemberID}-{BranchID}-{ApiKey}
```

### Examples

**England & Wales Custodial:**
```
England & Wales Custodial-Custodial-A00351EW-0-1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4
```

**Scotland Custodial:**
```
Scotland Custodial-Custodial-S12345SC-0-1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4
```

### Region Mapping

| Database Value | Scheme Name |
|----------------|-------------|
| `EW` | England & Wales Custodial |
| `Scotland` | Scotland Custodial |
| `NI` | Northern Ireland Custodial |

---

## Implementation Details

### File: `shared/organization-credentials.js`

**Purpose:** Retrieve and decrypt organization credentials from database

**Key Functions:**
- `getOrganizationCredentials(altoAgencyRef, altoBranchId, context)` - Query database for credentials
- `decryptApiKey(encryptedApiKey)` - Decrypt API key using AES-256
- `getTestCredentials(context)` - Return test credentials for development

**Returns:**
```javascript
{
  memberId: "A00351EW",
  branchId: "0",
  apiKey: "1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4",
  region: "EW",
  schemeType: "Custodial",
  organizationName: "Example Letting Agency"
}
```

### File: `shared/salesforce-auth.js`

**Updated Function:** `getSalesforceAuthHeader(context, orgCredentials)`

**New Parameter:** `orgCredentials` (optional)
- If provided: Builds AccessToken from org-specific credentials
- If null: Falls back to environment variable `SALESFORCE_API_KEY`

**Logic:**
```javascript
if (orgCredentials) {
  // Build dynamic AccessToken
  const { memberId, branchId, apiKey, region, schemeType } = orgCredentials;
  const scheme = schemeMap[region] || 'England & Wales Custodial';
  accessToken = `${scheme}-${schemeType}-${memberId}-${branchId}-${apiKey}`;
} else {
  // Use static environment variable
  accessToken = process.env.SALESFORCE_API_KEY;
}

return { 'AccessToken': accessToken };
```

---

## Configuration

### Environment Variables

#### Required for Production
```bash
# Database connection
SQL_CONNECTION_STRING="Server=...;Database=...;User=...;Password=..."

# Encryption key for API keys (MUST be kept secret!)
ENCRYPTION_SECRET="your-256-bit-encryption-key-here"

# Authentication method
SALESFORCE_AUTH_METHOD="api-key"
```

#### Optional for Testing
```bash
# Use test credentials (development only)
USE_TEST_CREDENTIALS="true"

# Test organization credentials
TEST_TDS_MEMBER_ID="TEST123"
TEST_TDS_BRANCH_ID="0"
TEST_TDS_API_KEY="test-api-key"
TEST_TDS_REGION="EW"
TEST_TDS_SCHEME_TYPE="Custodial"
```

#### Fallback (Single Organization)
```bash
# Static API key (if no org credentials provided)
SALESFORCE_API_KEY="England & Wales Custodial-Custodial-A00351EW-0-1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4"
```

---

## Request Flow

```
1. Request arrives at TDSRequestForwarder
   ↓
2. Extract altoAgencyRef + altoBranchId from:
   - Request body metadata (preferred)
   - HTTP headers (alternative)
   ↓
3. Query organization_mappings table
   ↓
4. Decrypt tds_api_key_encrypted
   ↓
5. Build AccessToken header:
   {Region}-{SchemeType}-{MemberID}-{BranchID}-{ApiKey}
   ↓
6. Make API call to Salesforce EWC
   ↓
7. Return response
```

---

## Security Considerations

### ✅ Good Practices

1. **Never log API keys**
   - Masked in logs: `***e4` (last 4 chars)
   - Full key never appears in logs or responses

2. **Encrypt at rest**
   - API keys encrypted in database
   - Encryption key stored in Azure Key Vault (recommended)

3. **Per-organization isolation**
   - Each org has unique credentials
   - No shared API keys

4. **Secure transmission**
   - HTTPS only
   - Keys never in URLs or query params

### ⚠️ Important Notes

1. **ENCRYPTION_SECRET must be rotated periodically**
   - Store in Azure Key Vault
   - Use different keys for dev/staging/prod

2. **Database access control**
   - Limit access to organization_mappings table
   - Use service accounts with minimal permissions

3. **Test credentials**
   - `USE_TEST_CREDENTIALS` must be `false` in production
   - Test keys should be inactive/invalid in TDS

---

## Database Implementation

### TODO: Implement Query Function

The `organization-credentials.js` file contains a placeholder for database queries:

```javascript
async function executeQuery(connectionString, query, parameters) {
  // TODO: Replace with actual database client implementation
  throw new Error('Database query execution not implemented');
}
```

### Options for Implementation

#### Option 1: Sequelize ORM (Recommended if already using)
```javascript
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize(connectionString);

async function executeQuery(connectionString, query, parameters) {
  const [results] = await sequelize.query(query, {
    replacements: parameters,
    type: Sequelize.QueryTypes.SELECT
  });
  return results;
}
```

#### Option 2: Direct SQL with mssql (Azure SQL)
```javascript
const sql = require('mssql');

async function executeQuery(connectionString, query, parameters) {
  const pool = await sql.connect(connectionString);
  const result = await pool.request()
    .input('altoAgencyRef', sql.VarChar, parameters.altoAgencyRef)
    .input('altoBranchId', sql.VarChar, parameters.altoBranchId)
    .query(query);
  return result.recordset;
}
```

#### Option 3: PostgreSQL with pg
```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString });

async function executeQuery(connectionString, query, parameters) {
  const result = await pool.query(query, [
    parameters.altoAgencyRef,
    parameters.altoBranchId
  ]);
  return result.rows;
}
```

---

## Testing

### Test Request with Metadata

```bash
curl -X POST https://your-function-app.azurewebsites.net/api/tds-forwarder/create \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "altoAgencyRef": "1af89d60-662c-475b-bcc8-9bcbf04b6322",
      "altoBranchId": "branch-001"
    },
    "deposit": {
      "amount": 1500,
      "tenancyStartDate": "2025-01-15",
      ...
    }
  }'
```

### Test Request with Headers

```bash
curl -X POST https://your-function-app.azurewebsites.net/api/tds-forwarder/create \
  -H "Content-Type: application/json" \
  -H "X-Alto-Agency-Ref: 1af89d60-662c-475b-bcc8-9bcbf04b6322" \
  -H "X-Alto-Branch-Id: branch-001" \
  -d '{ "deposit": { ... } }'
```

### Expected Response

```json
{
  "success": true,
  "data": {
    "batch_id": "ERR-16893",
    "status": "submitted",
    "message": "Deposit created successfully"
  },
  "metadata": {
    "mode": "single",
    "provider": "salesforce",
    "duration": 1234,
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

---

## Migration Strategy

### Phase 1: Development Testing
- Use `USE_TEST_CREDENTIALS=true`
- Test with sample data
- Verify AccessToken generation

### Phase 2: Single Organization Pilot
- Add one organization to mapping table
- Test with real TDS credentials
- Monitor logs for errors

### Phase 3: Multi-Organization Rollout
- Add remaining organizations
- Enable dynamic credentials for all
- Remove static environment variable fallback

### Phase 4: Production
- Disable test credentials
- All credentials from database
- Monitor authentication success rate

---

## Troubleshooting

### Error: "No organization mapping found"

**Cause:** No matching record in `organization_mappings` table

**Solution:**
1. Check `altoAgencyRef` and `altoBranchId` values
2. Verify `is_active = true` in database
3. Add missing organization mapping

### Error: "Failed to decrypt TDS API key"

**Cause:** Wrong `ENCRYPTION_SECRET` or corrupted encrypted data

**Solution:**
1. Verify `ENCRYPTION_SECRET` matches encryption key
2. Re-encrypt API key in database
3. Check for data corruption

### Error: "Salesforce API authentication failed"

**Cause:** Invalid credentials or AccessToken format

**Solution:**
1. Verify Member ID, Branch ID, API Key in database
2. Check region and scheme type mapping
3. Test credentials directly with TDS
4. Contact api_enquiries@tenancydepositscheme.com

---

## Next Steps

1. **Implement database query function** in `organization-credentials.js`
2. **Add organizations** to mapping table
3. **Test with real credentials**
4. **Deploy to development environment**
5. **Monitor and iterate**

---

**Last Updated:** 2025-01-15
**Status:** Implementation Complete, Database Integration Pending
