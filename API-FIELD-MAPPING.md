# TDS API Field Mapping: Legacy vs Salesforce EWC

## Purpose
This document maps fields between the Legacy TDS Custodial API (v1.2) and the Salesforce EWC API to ensure consistent data transformation from Alto (and other integrations) to both APIs.

---

## Authentication & Metadata

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Notes |
|---------------------|------------------|----------------------|-------|
| `memberId` | `member_id` | In AccessToken header | Legacy: root level, SF: in auth header |
| `branchId` | `branch_id` | In AccessToken header | Legacy: root level, SF: in auth header |
| `apiKey` | `api_key` | In AccessToken header | Legacy: root level, SF: in auth header |
| `region` | `region` | In AccessToken header | Legacy: root level (EW/NI), SF: in auth ("England & Wales Custodial") |
| `schemeType` | `scheme_type` | In AccessToken header | Both: "Custodial" or "Insured" |

**AccessToken Format (Salesforce):**
```
England & Wales Custodial-Custodial-{memberId}-{branchId}-{apiKey}
```

---

## Tenancy/Deposit Root Object

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Data Type Transformation |
|---------------------|------------------|----------------------|--------------------------|
| `tenancyId` | `user_tenancy_reference` | `user_tenancy_reference` | String → String |
| N/A (optional) | N/A | `deposit_reference` | String → String (optional in SF) |

---

## Property Fields

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Data Type Transformation |
|---------------------|------------------|----------------------|--------------------------|
| `property.id` | `property_id` | `property_id` | Number → String |
| `property.address.nameNo` | `property_paon` | `property_paon` | String → String |
| `property.address.subDwelling` | `property_saon` | `property_saon` | String → String |
| `property.address.street` | `property_street` | `property_street` | String → String |
| `property.address.locality` | `property_locality` | N/A | **Not in Salesforce** |
| `property.address.town` | `property_town` | `property_town` | String → String |
| `property.county` or `property.address.administrativeArea` | `property_administrative_area` | `property_administrative_area` | String → String |
| `property.address.postcode` | `property_postcode` | `property_postcode` | String → String |
| `property.bedrooms` | `number_of_bedrooms` | `number_of_bedrooms` | Number → **String** (SF only) |
| `property.receptions` or `property.livingRooms` | `number_of_living_rooms` | `number_of_living_rooms` | Number → **String** (SF only) |
| `property.furnishedStatus` | `furnished_status` | `furnished_status` | String → **String boolean** (SF only) |

**Furnished Status Values:**
- Legacy: `"furnished"`, `"part furnished"`, `"unfurnished"` (string)
- Salesforce: `"true"` or `"false"` (string boolean) - **DIFFERENT!**

---

## Tenancy Dates

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Date Format Transformation |
|---------------------|------------------|----------------------|----------------------------|
| `tenancyStartDate` | `tenancy_start_date` | `tenancy_start_date` | ISO → **DD/MM/YYYY** (Legacy) or **DD-MM-YYYY** (SF) |
| `tenancyEndDate` | `tenancy_expected_end_date` | `tenancy_expected_end_date` | ISO → **DD/MM/YYYY** (Legacy) or **DD-MM-YYYY** (SF) |
| `depositReceivedDate` or `allocationDateTime` | `deposit_received_date` | `deposit_received_date` | ISO → **DD/MM/YYYY** (Legacy) or **DD-MM-YYYY** (SF) |

**Date Format Examples:**
- Alto/ISO: `2025-02-01`
- Legacy: `01/02/2025` (DD/MM/YYYY with slashes)
- Salesforce: `01-02-2025` (DD-MM-YYYY with dashes)

---

## Financial Fields

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Data Type Transformation |
|---------------------|------------------|----------------------|--------------------------|
| `rentAmount` | `rent_amount` | `rent_amount` | Number → Number (Legacy) or **String** (SF) |
| `depositAmount` | `deposit_amount` | `deposit_amount` | Number → Number (Legacy) or **String** (SF) |
| `amountToProtect` or `depositAmount` | `deposit_amount_to_protect` | `deposit_amount_to_protect` | Number → Number (Legacy) or **String** (SF) |

**Examples:**
- Alto: `1500` (number)
- Legacy: `1500` or `1500.00` (number)
- Salesforce: `"1500"` (string)

---

## People Counts

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Data Type Transformation |
|---------------------|------------------|----------------------|--------------------------|
| `tenants.length` | `number_of_tenants` | `number_of_tenants` | Number → Number (Legacy) or **String** (SF) |
| `landlords.length` (usually 1) | `number_of_landlords` | `number_of_landlords` | Number → Number (Legacy) or **String** (SF) |

---

## People Array

### Person Classifications

| Alto/Internal Type | Legacy API Value | Salesforce EWC Value | Notes |
|-------------------|------------------|----------------------|-------|
| First tenant | `"Lead Tenant"` | `"Tenant"` | **DIFFERENT!** Legacy distinguishes lead |
| Additional tenants | `"Joint Tenant"` | `"Tenant"` | **DIFFERENT!** SF uses same classification |
| Primary landlord | `"Primary Landlord"` | `"Primary Landlord"` | Same |
| Additional landlords | `"Joint Landlord"` | `"Joint Landlord"` | Same |

### Person Fields

| Alto/Internal Field | Legacy API Field | Salesforce EWC Field | Data Type Transformation |
|---------------------|------------------|----------------------|--------------------------|
| N/A | `person_id` | `person_id` | String → String (optional) |
| N/A | `person_reference` | `person_reference` | String → String (optional, landlords only) |
| `person.title` | `person_title` | `person_title` | String → String |
| `person.firstName` | `person_firstname` | `person_firstname` | String → String |
| `person.lastName` | `person_surname` | `person_surname` | String → String |
| `person.isBusiness` | `is_business` | `is_business` | Boolean → **"Y"/"N"** (Legacy) or **"true"/"false"** (SF) |
| `person.businessName` | `business_name` | `business_name` | String → String |
| `person.address.nameNo` | `person_paon` | `person_paon` | String → String |
| `person.address.subDwelling` | `person_saon` | `person_saon` | String → String |
| `person.address.street` | `person_street` | `person_street` | String → String |
| `person.address.locality` | `person_locality` | `person_locality` | String → String |
| `person.address.town` | `person_town` | `person_town` | String → String |
| `person.address.county` | `person_administrative_area` | N/A | **Not in Salesforce people** |
| `person.address.postcode` | `person_postcode` | `person_postcode` | String → String |
| `person.address.country` | `person_country` | `person_country` | String → String |
| `person.phone` | `person_phone` | `person_phone` | String → String |
| `person.email` | `person_email` | `person_email` | String → String |
| `person.mobile` | `person_mobile` | `person_mobile` | String → String |

---

## Request Structure Differences

### Legacy API Structure
```json
{
  "member_id": "1960473",
  "branch_id": "1960473",
  "api_key": "SJKFW-4782P-3D7DJ-ADDSD-3S78F",
  "region": "EW",
  "scheme_type": "Custodial",
  "tenancy": [{  // ARRAY of tenancies
    "user_tenancy_reference": "...",
    "property_paon": "...",
    // ... tenancy fields
    "people": [
      {
        "person_classification": "Lead Tenant",
        // ... person fields
      }
    ]
  }]
}
```

### Salesforce EWC Structure
```json
{
  "tenancy": {  // SINGLE tenancy object (not array)
    "user_tenancy_reference": "...",
    "property_paon": "...",
    // ... tenancy fields (values as strings)
    "people": [
      {
        "person_classification": "Tenant",
        // ... person fields
      }
    ]
  }
}
```

**Key Differences:**
1. Legacy has `tenancy` as an **array**, Salesforce has it as an **object**
2. Legacy has auth fields at root level, Salesforce has them in header
3. Salesforce requires all numbers/booleans as strings

---

## Response Differences

### Deposit Creation Response

#### Legacy API Response
```json
{
  "success": true,
  "batch_id": "167237"
}
```

#### Salesforce EWC Response
```json
{
  "Success": "true",  // String boolean, capital S
  "batch_id": "ERR-04238"
}
```

**Key Differences:**
- Legacy: `success` (boolean), Salesforce: `Success` (string boolean, capitalized)
- Batch ID formats may differ (legacy: numbers, SF: prefixed with letters)

---

### Status Check Response

#### Legacy API Endpoint
```
GET /CreateDepositStatus/<member_id>/<branch_id>/<api_key>/<batch_id>
```

#### Salesforce EWC Endpoint
```
GET /services/apexrest/CreateDepositStatus/<batch_id>
```

**Key Differences:**
- Legacy: Auth credentials in URL path
- Salesforce: Auth in AccessToken header, only batch_id in path

#### Legacy API Response
```json
{
  "success": true,
  "status": "pending",  // or "created", "failed"
  "dan": "EWC00005391",
  "error": null
}
```

#### Salesforce EWC Response
```json
{
  "success": "true",  // String boolean
  "status": "Registered (not paid)",  // More descriptive
  "dan": "EWC00005391"
}
```

---

## Data Type Conversion Summary

| Field Type | Legacy API | Salesforce EWC | Conversion Function |
|------------|-----------|----------------|---------------------|
| Dates | `DD/MM/YYYY` | `DD-MM-YYYY` | Replace `/` with `-` |
| Numbers (financial) | Number: `1500` | String: `"1500"` | `String(value)` |
| Numbers (counts) | Number: `2` | String: `"2"` | `String(value)` |
| Booleans (is_business) | `"Y"` or `"N"` | `"true"` or `"false"` | Map Y→"true", N→"false" |
| Booleans (furnished_status) | String: `"furnished"` | String boolean: `"true"` | Different semantics! |
| Person classification | `"Lead Tenant"` / `"Joint Tenant"` | `"Tenant"` | Map both to "Tenant" |

---

## Implementation Notes

1. **Generic Internal Model**: Create a normalized internal model that Alto (and other integrations) map to
2. **Two Transformers**:
   - Internal → Legacy (existing: `buildTDSPayload()`)
   - Internal → Salesforce (existing: `transformLegacyToSalesforce()` but needs updating)
3. **Reverse Transformers**:
   - Legacy response → Internal
   - Salesforce response → Internal (existing: `transformSalesforceToLegacy()`)
4. **Key Challenge**: `furnished_status` has completely different semantics between APIs
5. **Testing Strategy**: Create test fixtures for Alto data and verify both transformations produce valid payloads

---

## Fields NOT in Salesforce API

The following Legacy API fields are **not present** in Salesforce EWC:
- `property_locality` - Use `property_town` instead
- `person_administrative_area` (in person object) - Not needed
- `invoice` (boolean flag) - Not supported
- `product_type` - Not supported
- `members_own_reference` - Not supported

---

## Next Steps

1. ✅ Document mapping
2. ⏭️ Create canonical internal model
3. ⏭️ Update/fix transformers to match this mapping
4. ⏭️ Create test fixtures
5. ⏭️ Validate transformations produce valid API payloads
