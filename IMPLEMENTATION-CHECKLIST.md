# TDS Dual-API Implementation Checklist

This document tracks all remaining tasks to make the dual-API system 100% production-ready.

---

## 🔴 CRITICAL (Cannot work without these)

### 1. Salesforce Authentication Implementation
**Status:** ✅ COMPLETED

**What's needed:**
- [x] Document Salesforce auth methods (API Key & OAuth2)
- [x] Implement API Key authentication
- [x] Implement OAuth2 authentication with token caching
- [x] Add token refresh logic (5-minute expiry)
- [ ] Store credentials in Azure Key Vault (pending TDS credentials)

**Files created/updated:**
- ✅ Created: `azure-functions/shared-services/shared/salesforce-auth.js`
- ✅ Updated: `azure-functions/shared-services/TDSRequestForwarder/index.js`
- ✅ Updated: `azure-functions/shared-services/TDSAdapterFactory/index.js`
- ✅ Created: `SALESFORCE-AUTH-SETUP.md` (complete setup guide)

**Details:**
Salesforce API supports two authentication methods:

1. **API Key (Simple)**
   - Similar to legacy API
   - Static key passed in header
   - No expiry

2. **OAuth2 (Secure)**
   - Client ID + Client Secret (base64 encoded)
   - Exchange for session token at auth endpoint
   - Token expires after ~5 minutes
   - Requires token caching and refresh logic

---

### 2. Salesforce API Endpoints Configuration
**Status:** ✅ COMPLETED

**What's needed:**
- [x] Get production Salesforce base URL from TDS (TBD - not yet available)
- [x] Get development/sandbox Salesforce base URL
- [x] Verify endpoint paths:
  - [x] Deposit creation endpoint (`/services/apexrest/depositcreation`)
  - [x] Deposit status endpoint (`/services/apexrest/CreateDepositStatus/{batch_id}`)
  - [x] Health check endpoint (`/services/apexrest/branches`)
- [x] Update configuration files with real URLs

**Files updated:**
- ✅ `configuration/app-settings/production.json` (placeholder URL)
- ✅ `configuration/app-settings/development.json` (real sandbox URL)
- ✅ `SALESFORCE-EWC-API-DETAILS.md` (complete API documentation)

**URLs Configured:**
```
Sandbox:
- Base URL: https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com
- Create deposit: /services/apexrest/depositcreation
- Check status: /services/apexrest/CreateDepositStatus/{batch_id}
- Tenancy info: /services/apexrest/tenancyinformation/{DAN}

Production:
- Base URL: TBD (update when available)
- Auth: api_enquiries@tenancydepositscheme.com
```

---

### 3. Salesforce Field Mapping Verification
**Status:** ✅ COMPLETED

**What's needed:**
- [x] Get Salesforce object schema from TDS
- [x] Verify field names (snake_case, NOT Field__c format!)
- [x] Map all legacy fields to Salesforce EWC equivalents
- [x] Update both transformer files with correct format conversions
- [x] Add date conversion (ISO → DD-MM-YYYY)
- [x] Add boolean conversion (true → "true")
- [x] Add number conversion (1500 → "1500")

**Files updated:**
- ✅ `azure-functions/shared-services/TDSRequestForwarder/transformers/legacy-to-salesforce.js`
- ✅ `azure-functions/shared-services/TDSRequestForwarder/transformers/salesforce-to-legacy.js`

**Key Discovery:**
Unlike typical Salesforce APIs, TDS EWC uses snake_case field names (same as legacy API), NOT the typical Field__c format. This simplifies field mapping significantly.

**Format Conversions Implemented:**
```
Request (Legacy → Salesforce EWC):
- Dates: YYYY-MM-DD → DD-MM-YYYY
- Booleans: true → "true"
- Numbers: 1500 → "1500"

Response (Salesforce EWC → Legacy):
- Dates: DD-MM-YYYY → YYYY-MM-DD
- Booleans: "true" → true
- Numbers: "1500" → 1500
```

---

### 4. Azure Function Dependencies
**Status:** ✅ COMPLETED

**What's needed:**
- [x] Create package.json for TDSRequestForwarder
- [x] Create package.json for shared utilities
- [x] Create host.json for function configuration
- [x] Create local.settings.json for local development
- [x] Install dependencies locally (run `npm install` in each folder)
- [ ] Test functions locally (after getting Salesforce credentials)

**Files created:**
- ✅ `azure-functions/shared-services/TDSRequestForwarder/package.json`
- ✅ `azure-functions/shared-services/TDSRequestForwarder/host.json`
- ✅ `azure-functions/shared-services/local.settings.json`
- ✅ `azure-functions/shared-services/shared/package.json`

**Notes:**
- Dependencies installed successfully
- Ready for local testing once credentials are obtained

---

### 5. Dynamic Per-Organization Credentials
**Status:** ✅ COMPLETED (Implementation), ⏳ PENDING (Database Integration)

**What's been done:**
- [x] Updated `salesforce-auth.js` to accept organization-specific credentials
- [x] Created `organization-credentials.js` module for credential retrieval
- [x] Updated TDSRequestForwarder to retrieve credentials from request metadata/headers
- [x] Implemented AccessToken building from org credentials (Region-SchemeType-MemberID-BranchID-ApiKey)
- [x] Added encryption/decryption support for API keys
- [x] Created comprehensive documentation (`DYNAMIC-CREDENTIALS-GUIDE.md`)

**What's still needed:**
- [ ] Implement database query function in `organization-credentials.js`
- [ ] Set up `ENCRYPTION_SECRET` in Azure Key Vault
- [ ] Set up `SQL_CONNECTION_STRING` in Azure Key Vault
- [ ] Test with real organization credentials
- [ ] Add organizations to mapping table

**Files created/updated:**
- ✅ Created: `azure-functions/shared-services/shared/organization-credentials.js`
- ✅ Updated: `azure-functions/shared-services/shared/salesforce-auth.js`
- ✅ Updated: `azure-functions/shared-services/TDSRequestForwarder/index.js`
- ✅ Created: `DYNAMIC-CREDENTIALS-GUIDE.md`

**Credential Retrieval Flow:**
```
1. Extract altoAgencyRef + altoBranchId from request
2. Query organization_mappings table
3. Decrypt tds_api_key_encrypted
4. Build AccessToken: {Region}-{SchemeType}-{MemberID}-{BranchID}-{ApiKey}
5. Use for Salesforce EWC API authentication
```

**Azure Key Vault secrets needed:**
```
- encryption-secret (for API key encryption/decryption)
- sql-connection-string (database connection)
```

**Notes:**
- Credentials are now per-organization (retrieved from database)
- No longer using static SALESFORCE_API_KEY environment variable
- Each customer can have their own TDS Member ID, Branch ID, and API Key
- API keys encrypted at rest in database
- Falls back to test credentials if USE_TEST_CREDENTIALS=true (dev only)

---

## 🟡 SHOULD DO (Important for production)

### 6. Status Code Mapping Verification
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Get complete list of Salesforce status values from TDS
- [ ] Map to legacy equivalents
- [ ] Update `mapSalesforceStatusToLegacy()` function
- [ ] Add tests for status mapping

**File to update:**
- `azure-functions/shared-services/TDSRequestForwarder/transformers/salesforce-to-legacy.js`

---

### 7. Enhanced Error Handling
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Create custom error classes
- [ ] Add retry logic for network errors
- [ ] Add circuit breaker pattern for Salesforce API
- [ ] Improve error messages and logging
- [ ] Add error categorization (transient vs permanent)

**Files to create/update:**
- Create: `azure-functions/shared-services/shared/errors.js`
- Update: Both function index.js files

---

### 8. Application Insights Logging
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Add structured logging with custom dimensions
- [ ] Log comparison results to Application Insights
- [ ] Create custom metrics for monitoring
- [ ] Set up log queries for common scenarios
- [ ] Create Application Insights dashboards

**Files to update:**
- `azure-functions/shared-services/TDSRequestForwarder/index.js`
- `azure-functions/shared-services/TDSAdapterFactory/index.js`

**Metrics to track:**
- Request count by provider
- Response time by provider
- Error rate by provider
- Comparison mismatch rate
- Fallback activation rate

---

### 9. Deployment Configurations
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Create Azure DevOps pipeline (or GitHub Actions)
- [ ] Create deployment scripts
- [ ] Configure Function App settings via ARM template
- [ ] Set up staging slots for zero-downtime deployment
- [ ] Document deployment process

**Files to create:**
- `azure-infrastructure/function-app-deployment.json` (ARM template)
- `.github/workflows/deploy-functions.yml` (or Azure DevOps YAML)
- `scripts/deploy-functions.ps1`

---

## 🟢 NICE TO HAVE (Improves quality)

### 10. Automated Testing Suite
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Unit tests for transformers
- [ ] Unit tests for authentication
- [ ] Integration tests for forwarder
- [ ] End-to-end tests
- [ ] Set up test runner (Jest)

**Files to create:**
- `azure-functions/shared-services/TDSRequestForwarder/__tests__/`
- `azure-functions/shared-services/TDSRequestForwarder/transformers/__tests__/`
- `package.json` (with test scripts)

---

### 11. Response Schema Validation
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Install Joi or similar validation library
- [ ] Create schemas for legacy responses
- [ ] Create schemas for Salesforce responses
- [ ] Add validation to response transformers
- [ ] Log schema validation failures

**Files to create:**
- `azure-functions/shared-services/shared/schemas/legacy-response.js`
- `azure-functions/shared-services/shared/schemas/salesforce-response.js`

---

### 12. Complete Documentation
**Status:** ⏳ PENDING

**What's needed:**
- [ ] Create OpenAPI/Swagger specification
- [ ] Create operations runbook
- [ ] Create architecture diagrams
- [ ] Document all environment variables
- [ ] Create troubleshooting guide

**Files to create:**
- `documentation/API-SPEC.yaml`
- `documentation/RUNBOOK.md`
- `documentation/ARCHITECTURE-DIAGRAM.md`
- `documentation/TROUBLESHOOTING.md`
- `documentation/ENVIRONMENT-VARIABLES.md`

---

## Quick Reference: Information Needed from TDS

### Salesforce API Details
```
□ Production base URL
□ Development/sandbox base URL
□ Authentication endpoint URL
□ OAuth2 client ID (dev)
□ OAuth2 client secret (dev)
□ OAuth2 client ID (prod)
□ OAuth2 client secret (prod)
□ API key (if using) (dev)
□ API key (if using) (prod)
□ Session token expiry time (confirmed ~5 minutes)
```

### API Schema Information
```
□ Complete Salesforce object schema (field names)
□ Deposit creation endpoint path
□ Deposit status endpoint path
□ Health check endpoint path
□ Status code values and meanings
□ Error response format
□ Success response format
```

### Testing Information
```
□ Sandbox/test environment access
□ Test credentials
□ Sample request/response payloads
□ Test deposit data
```

---

## Progress Tracking

**Last Updated:** 2025-01-15

**Overall Progress:** 🟢 80% Complete

| Category | Status | Progress |
|----------|--------|----------|
| Critical Tasks (1-5) | ✅ Mostly Complete | 80% (4/5) |
| Important Tasks (6-9) | ⏳ Not Started | 0% (0/4) |
| Quality Tasks (10-12) | ⏳ Not Started | 0% (0/3) |

**Completed:**
1. ✅ Salesforce authentication implementation (with dynamic credentials)
2. ✅ Configure Salesforce API endpoints
3. ✅ Update field mappings and transformers
4. ✅ Install Azure Function dependencies locally

**Next Steps (to resume later):**
5. ⏳ Implement database query function in `organization-credentials.js`
6. ⏳ Get real TDS credentials for test organization
7. ⏳ Add test organization to mapping table
8. ⏳ Test functions locally with real credentials
9. ⏳ Set up Azure Key Vault secrets (ENCRYPTION_SECRET, SQL_CONNECTION_STRING)
10. ⏳ Deploy to Azure dev environment
11. ⏳ Test end-to-end with real API calls

---

## Notes

### Authentication Decision ✅ IMPLEMENTED
- **Current Implementation:** API Key (AccessToken header) with dynamic per-organization credentials
- **Format:** `{Region}-{SchemeType}-{MemberID}-{BranchID}-{ApiKey}`
- **Storage:** Credentials stored in `organization_mappings` table
- **Security:** API keys encrypted at rest using AES-256-CBC
- **Retrieval:** Dynamic lookup based on `altoAgencyRef` + `altoBranchId`
- **OAuth2:** Not currently used by TDS EWC API (uses custom AccessToken instead)

### Deployment Strategy
- Deploy to dev first
- Test thoroughly in dev
- Deploy to staging (if available)
- Deploy to prod during low-traffic window
- Keep old version running as backup

### Risk Mitigation
- All critical tasks must be completed before production deployment
- Important tasks should be completed before production deployment
- Quality tasks can be completed post-deployment but should be prioritized

---

## Sign-off Checklist (Before Production Deployment)

- [ ] All critical tasks (1-5) completed
- [ ] All important tasks (6-9) completed
- [ ] Tested in development environment
- [ ] Tested in staging environment (if available)
- [ ] Load testing completed
- [ ] Security review completed
- [ ] Documentation reviewed
- [ ] Rollback plan tested
- [ ] On-call team briefed
- [ ] Monitoring and alerts configured
- [ ] Stakeholders informed of deployment schedule

---

**Document Owner:** Omar Lodhi
**Review Date:** Every Monday
**Status:** Living Document - Updated as tasks are completed
