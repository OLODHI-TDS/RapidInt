# Edit Organization Modal Update Summary

## Overview
Updated the `editOrganizationMapping()` function and `saveOrganizationMapping()` function in migration-dashboard.html to match the new organization mapping structure used in the add organization modal.

## Changes Made

### 1. Updated `editOrganizationMapping()` Function Signature
**Before:**
```javascript
function editOrganizationMapping(agencyRef, branchId, tdsMemberId, tdsBranchId, memberName, isActive, provider)
```

**After:**
```javascript
function editOrganizationMapping(org)
```

The function now accepts the full organization object instead of individual parameters, providing access to all nested configuration fields.

### 2. Updated Modal Structure

The edit modal now matches the add modal structure with organized sections:

#### Section 1: Organization Details (📋)
- Organization Name (editable)
- Integration Type (dropdown: Alto, Jupix)

#### Section 2: Integration Credentials (🔌)
- **For Alto:**
  - Agency Reference
  - Branch ID
- **For Jupix:** Coming soon message

#### Section 3: Legacy TDS Configuration (🏛️)
- Legacy Member ID
- Legacy Branch ID
- Legacy API Key (password field, optional on update)

#### Section 4: Salesforce TDS Configuration (☁️)
- Authentication Method (dropdown: API Key, OAuth2)
- **For API Key authentication:**
  - Salesforce API Key (password field, conditional display)
- **For OAuth2 authentication:**
  - Client ID (conditional display)
  - Client Secret (password field, conditional display)
- Salesforce Member ID
- Salesforce Branch ID
- Region (dropdown: England & Wales, Scotland, Northern Ireland)
- Scheme Type (dropdown: Custodial, Insured)

#### Section 5: System Configuration (⚙️)
- Provider Preference (dropdown: Legacy Only, Salesforce Only, Auto/Dual Mode)
- Status (dropdown: Active, Inactive)

### 3. Updated `saveOrganizationMapping()` Function

**Before:**
```javascript
async function saveOrganizationMapping(organizationName, environment, integrationType)
```

**After:**
```javascript
async function saveOrganizationMapping()
```

The function now:
1. Reads original organization identifiers from hidden fields
2. Builds the proper data structure matching the add organization format:
   - `integrationCredentials` object with nested configuration
   - `tdsLegacyConfig` object with memberId, branchId, apiKey
   - `tdsSalesforceConfig` object with memberId, branchId, region, schemeType, authMethod, and auth credentials
3. Only includes API keys/secrets if they were changed (allows keeping existing credentials)
4. Sends the complete structure to the `/organization/update` endpoint

### 4. Updated `getActionButtons()` Function

**Before:**
```javascript
onclick="editOrganizationMapping('${org.agencyRef}', '${org.branchId || 'DEFAULT'}', '${org.tdsMemberId || ''}', '${org.tdsBranchId || ''}', '${escapedName}', ${isActive}, '${org.provider || 'current'}')"
```

**After:**
```javascript
onclick='editOrganizationMapping(${JSON.stringify(org)})'
```

Now passes the entire organization object to the edit function.

### 5. Data Compatibility

The modal handles both old and new data structures by checking multiple possible locations for values:
- `org.tdsLegacyConfig?.memberId || org.legacyMemberId`
- `org.tdsSalesforceConfig?.authMethod || org.sfAuthMethod`
- `org.integrationCredentials?.alto?.agencyRef`

This ensures backward compatibility with existing records.

### 6. Enhanced UX Features

1. **Conditional Field Display:** Salesforce auth fields (API Key vs OAuth2) toggle based on selected authentication method
2. **Integration Type Toggle:** Integration credential fields update when integration type changes
3. **Password Fields:** Sensitive fields use password type with placeholder "Leave blank to keep existing key/secret"
4. **Hidden Fields:** Original organization name and environment stored as hidden fields for API identification
5. **Visual Sections:** Clear section headers with icons for better organization
6. **Wider Modal:** Modal width increased to 800px to accommodate all fields comfortably

## API Payload Structure

### Update Request Format
```json
{
  "originalOrgName": "Demo Estate Agency",
  "originalEnvironment": "dev",
  "organizationName": "Demo Estate Agency",
  "environment": "dev",
  "integrationType": "alto",
  "integrationCredentials": {
    "alto": {
      "agencyRef": "1af89d60-662c-475b-bcc8-9bcbf04b6322",
      "branchId": "DEFAULT"
    }
  },
  "tdsLegacyConfig": {
    "memberId": "1960473",
    "branchId": "1960473",
    "apiKey": "xxx" // Optional, only if changed
  },
  "tdsSalesforceConfig": {
    "memberId": "1960473",
    "branchId": "1960473",
    "region": "EW",
    "schemeType": "Custodial",
    "authMethod": "api_key",
    "apiKey": "xxx" // Or clientId+clientSecret if oauth2
  },
  "provider": "auto",
  "isActive": true
}
```

## Validation Rules

1. Organization name is required
2. For Alto integration: Agency Reference is required
3. Legacy TDS: Member ID and Branch ID are required
4. Salesforce TDS: Member ID and Branch ID are required
5. If Salesforce auth method is API Key: API Key required (or can keep existing)
6. If Salesforce auth method is OAuth2: Client ID and Secret required (or can keep existing)

## Files Modified

1. **C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept\tools\migration-dashboard.html**
   - Line ~1395-1410: `getActionButtons()` function
   - Line ~2337-2455: `editOrganizationMapping()` function
   - Line ~2457-2528: `saveOrganizationMapping()` function

## Reference File Created

**C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept\tools\edit-org-functions-updated.js**

This file contains the complete updated functions ready to be integrated into migration-dashboard.html.

## Testing Recommendations

1. Test editing an organization with API Key authentication
2. Test editing an organization with OAuth2 authentication
3. Test switching between authentication methods
4. Test updating credentials (entering new values)
5. Test keeping existing credentials (leaving fields blank)
6. Test validation for required fields
7. Test with both new and old data structure formats
8. Verify the update API receives the correct payload structure
9. Test Active/Inactive status toggle
10. Test provider preference changes

## Notes

- The file migration-dashboard.html appears to have an auto-formatter or linter that runs automatically, causing conflicts during editing. The reference file (edit-org-functions-updated.js) contains the complete updated code that can be manually integrated.
- Backward compatibility is maintained by checking both new nested structures and old flat structures
- Password fields allow keeping existing values by leaving them blank
- The modal uses the same helper functions as the add modal: `toggleIntegrationFields()` and `toggleSalesforceAuthFields()`
