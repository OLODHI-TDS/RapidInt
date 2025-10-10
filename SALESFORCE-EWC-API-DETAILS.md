# Salesforce EWC API Details

## Official TDS Salesforce EWC API Information

Based on the official documentation: "EWC Deposit Management API Technical Documentation V1.0"

---

## 🌐 API Endpoints

### Sandbox Environment
**Base URL:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com`

### Production Environment
**Base URL:** Not yet available (TBD)

---

## 🔐 Authentication Method

**Type:** API Key (Header-based)

**Header Name:** `AccessToken`

**Format:** `Scheme-SchemeType-MemberID-BranchID-ApiKey`

**Components:**
- **Scheme:** `England & Wales Custodial`
- **SchemeType:** `Custodial`
- **MemberID:** Member ID (e.g., `A00351EW`)
- **BranchID:** Branch ID (e.g., `0`)
- **ApiKey:** Timestamp + Hash (e.g., `1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4`)

**Example Token:**
```
England & Wales Custodial-Custodial-A00351EW-0-1689607724671-64e24fc6fd4414d603524c056c608b528595b8e4
```

**HTTP Header Example:**
```json
{
  "headers": {
    "AccessToken": "England & Wales Custodial-Custodial-LL98766432-0-1667558778368-e99d215d9e51f24a6be421190b59f6be0e1d9871",
    "Content-Type": "application/json"
  }
}
```

**How to Obtain:**
Contact: api_enquiries@tenancydepositscheme.com

---

## 📋 API Endpoints

### 1. Deposit Creation
**Endpoint:** `/services/apexrest/depositcreation`
**Method:** POST
**Full URL:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com/services/apexrest/depositcreation`

### 2. Deposit Update
**Endpoint:** `/services/apexrest/depositupdate`
**Method:** POST
**Full URL:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com/services/apexrest/depositupdate`

### 3. Creation Status Check
**Endpoint:** `/services/apexrest/CreateDepositStatus/{batch_id}`
**Method:** GET
**Full URL:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com/services/apexrest/CreateDepositStatus/ERR-16893`

### 4. Tenancy Information
**Endpoint:** `/services/apexrest/tenancyinformation/{DAN}`
**Method:** GET
**Full URL:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com/services/apexrest/tenancyinformation/EWC00004420`

### 5. Landlords Search
**Endpoint:** `/services/apexrest/nonmemberlandlord`
**Method:** GET

### 6. Properties Search
**Endpoint:** `/services/apexrest/property`
**Method:** GET

### 7. Deposit Protection Certificate
**Endpoint:** `/services/apexrest/dpc/{DAN}`
**Method:** GET
**Returns:** PDF certificate link
**Example:** `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com/DPCCertificatePage?depoId=a0L3G0000009vonUAA`

### 8. Repayment Request (Create)
**Endpoint:** `/services/apexrest/raiserepaymentrequest/`
**Method:** POST

### 9. Repayment Request (Respond)
**Endpoint:** `/services/apexrest/raiserepaymentrequest/`
**Method:** POST

### 10. Branches List
**Endpoint:** `/services/apexrest/branches/`
**Method:** GET
**With filter:** `/services/apexrest/branches/?name=branch_name`

### 11. Dispute Status
**Endpoint:** `/services/apexrest/dispute/status/{DAN}`
**Method:** GET

### 12. Transfer Deposit
**Endpoint:** `/services/apexrest/transfer`
**Method:** POST

### 13. All Tenancies Registered
**Endpoint:** `/services/apexrest/alltenanciesregistered`
**Method:** GET

### 14. Depository Managed Update
**Endpoint:** `/services/apexrest/depositorymanagedupdatestatus`
**Method:** POST

---

## 📊 Request/Response Format

### Deposit Creation Request Example

```json
{
  "tenancy": {
    "user_tenancy_reference": "UTR2",
    "deposit_reference": "DR2",
    "property_id": "PID2",
    "property_paon": "Paon2",
    "property_saon": "Saon2",
    "property_street": "Street2",
    "property_town": "Town2",
    "property_administrative_area": "Admin Area 2",
    "property_postcode": "HP1 1AU",
    "tenancy_start_date": "23-02-2025",
    "tenancy_expected_end_date": "23-02-2026",
    "number_of_living_rooms": "1",
    "number_of_bedrooms": "2",
    "furnished_status": "true",
    "rent_amount": "1500",
    "deposit_amount": "2000",
    "deposit_amount_to_protect": "1800",
    "deposit_received_date": "22-02-2025",
    "number_of_tenants": "2",
    "number_of_landlords": "2",
    "people": [
      {
        "person_classification": "Tenant",
        "person_id": "tenantPID2",
        "person_reference": "tenantref2",
        "person_title": "Ms",
        "person_firstname": "TenantFN2",
        "person_surname": "TenantSN2",
        "is_business": "TRUE",
        "business_name": "Tenant SN2 Ltd",
        "person_paon": "TTSN2 Paon",
        "person_saon": "TTSN2 saon",
        "person_street": "TTSN2 street",
        "person_locality": "TTSN2 local",
        "person_town": "TTSN2 town",
        "person_postcode": "ML2 2ML",
        "person_country": "United Kingdom",
        "person_phone": "07309448857",
        "person_email": "TTSN2@yopmail.com",
        "person_mobile": "07409887785"
      },
      {
        "person_classification": "Primary Landlord",
        "person_id": "PLPID3",
        "person_reference": "PL3ref",
        "person_title": "Ms",
        "person_firstname": "PrimLL3FN",
        "person_surname": "PrimLL3SN",
        "is_business": "false",
        "person_paon": "PrimLL3paon",
        "person_saon": "PrimLL3saon",
        "person_street": "PrimLL3street",
        "person_locality": "PrimLL3locality",
        "person_town": "PrimLL3town",
        "person_postcode": "LV1 3RF",
        "person_country": "United Kingdom",
        "person_phone": "07309887746",
        "person_email": "PrimLL3persem@yopmail.com",
        "person_mobile": "07239887736"
      }
    ]
  }
}
```

### Key Field Names (Salesforce EWC API)

**Tenancy Fields:**
- `user_tenancy_reference` - External tenancy reference
- `deposit_reference` - Deposit reference
- `property_*` - Property address fields (paon, saon, street, town, postcode, etc.)
- `tenancy_start_date` - Format: "DD-MM-YYYY"
- `tenancy_expected_end_date` - Format: "DD-MM-YYYY"
- `deposit_received_date` - Format: "DD-MM-YYYY"
- `number_of_bedrooms` - String number
- `number_of_living_rooms` - String number
- `furnished_status` - "true" or "false" (string)
- `rent_amount` - String number
- `deposit_amount` - Total deposit amount (string number)
- `deposit_amount_to_protect` - Amount being protected (string number)
- `number_of_tenants` - String number
- `number_of_landlords` - String number

**Person Fields:**
- `person_classification` - "Tenant", "Primary Landlord", "Joint Landlord"
- `person_id` - External person ID
- `person_reference` - Person reference
- `person_title` - Title (Mr, Ms, Mrs, etc.)
- `person_firstname` - First name
- `person_surname` - Surname
- `is_business` - "true" or "false" (string)
- `business_name` - Business name (if is_business = true)
- `person_paon` - Primary Addressable Object Name
- `person_saon` - Secondary Addressable Object Name
- `person_street` - Street
- `person_locality` - Locality
- `person_town` - Town
- `person_postcode` - Postcode
- `person_country` - Country
- `person_phone` - Phone number
- `person_email` - Email address
- `person_mobile` - Mobile number

---

## ⚠️ Key Differences from Legacy API

### Authentication
- **Legacy:** Basic Auth or OAuth2
- **Salesforce EWC:** Custom AccessToken header with specific format

### Field Naming
- **Legacy:** snake_case (e.g., `deposit_amount`)
- **Salesforce EWC:** snake_case (SAME as legacy!)
- **Note:** This is DIFFERENT from typical Salesforce APIs which use `Field__c` format

### Date Format
- **Legacy:** ISO 8601 format (YYYY-MM-DD)
- **Salesforce EWC:** UK format (DD-MM-YYYY)

### Boolean Values
- **Legacy:** `true` / `false` (boolean)
- **Salesforce EWC:** `"true"` / `"false"` (string)

### Numeric Values
- **Legacy:** Numbers (e.g., `1500`)
- **Salesforce EWC:** Strings (e.g., `"1500"`)

---

## 🔄 Response Format

### Success Response
```json
{
  "success": true,
  "batch_id": "ERR-16893",
  "message": "Deposit created successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

---

## 🎯 Integration Mapping

### For TDS RapidInt Platform

**What needs updating:**

1. **Base URL:**
   - Sandbox: `https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com`
   - Production: TBD

2. **Authentication:**
   - Use `AccessToken` header instead of `Authorization`
   - Format: `Scheme-SchemeType-MemberID-BranchID-ApiKey`

3. **Endpoints:**
   - Create: `/services/apexrest/depositcreation`
   - Status: `/services/apexrest/CreateDepositStatus/{batch_id}`
   - Info: `/services/apexrest/tenancyinformation/{DAN}`

4. **Field Transformations:**
   - Dates: Convert ISO format → DD-MM-YYYY
   - Booleans: Convert boolean → string "true"/"false"
   - Numbers: Convert number → string

---

## 📝 Important Notes

1. **No OAuth2:** This API uses a simple API key in the header
2. **Same Field Names:** Unlike typical Salesforce, this uses snake_case not `Field__c`
3. **String Everything:** Most values should be strings, even numbers and booleans
4. **Date Format:** UK format (DD-MM-YYYY), not ISO format
5. **People Array:** Tenants and landlords in same array, differentiated by `person_classification`

---

## 🔗 Contact & Support

**API Keys:** api_enquiries@tenancydepositscheme.com

---

**Last Updated:** 2025-10-01
**Source:** EWC Deposit Management API Technical Documentation V1.0
**Sandbox URL:** https://thedisputeservice--fullcopy.sandbox.my.salesforce-sites.com
