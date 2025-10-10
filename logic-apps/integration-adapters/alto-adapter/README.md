# Alto Integration Adapter - Logic App

This Logic App provides the Alto property management system integration adapter for the TDS Integration Platform.

## Overview

The Alto adapter receives webhooks from Alto when tenancies are created, retrieves complete tenancy data via Alto APIs, transforms it to the standard format, and submits it to TDS via the adapter factory.

## Workflow Steps

### 1. Webhook Reception
- **Trigger**: HTTP Request trigger for Alto webhooks
- **Input**: CloudEvents format webhook from Alto
- **Validation**: Extract tenancyId and agencyRef from webhook payload

### 2. Alto Data Retrieval
- **Authentication**: OAuth2 client credentials flow
- **API Calls**:
  - `/tenancies/{id}` - Tenancy details
  - `/properties/{id}` - Property information
  - `/contacts/{id}` - Landlord details
  - `/contacts?tenancyId={id}&contactType=tenant` - Tenant information

### 3. Data Enhancement
- **Postcode Lookup**: Call postcode service to get county from postcode
- **Organization Mapping**: Resolve Alto agencyRef to TDS member details
- **Data Transformation**: Convert Alto format to standard model

### 4. TDS Integration
- **Deposit Creation**: Submit to TDS via adapter factory
- **Status Polling**: Monitor until DAN received (up to 30 minutes)
- **Result Storage**: Store integration record in Azure Table Storage

## Configuration

### Logic App Parameters

```json
{
  "altoClientId": "d9kj85ukjpr6634i4sae0g00s",
  "altoClientSecret": "{{keyvault-reference}}",
  "postcodeServiceUrl": "https://your-functions.azurewebsites.net/api/postcode",
  "tdsAdapterUrl": "https://your-functions.azurewebsites.net/api/tds"
}
```

### Required Connections

#### 1. Postcode Lookup Function
```json
{
  "connectionName": "postcodeLookup",
  "connectionProperties": {
    "functionKey": "{{function-key}}"
  }
}
```

#### 2. TDS Adapter Factory
```json
{
  "connectionName": "tdsAdapter",
  "connectionProperties": {
    "functionKey": "{{function-key}}"
  }
}
```

#### 3. Organization Mappings
```json
{
  "connectionName": "organizationMappings",
  "connectionProperties": {
    "organizations": {
      "1af89d60-662c-475b-bcc8-9bcbf04b6322": {
        "name": "Example Property Agency"
      }
    },
    "tdsMembers": {
      "1af89d60-662c-475b-bcc8-9bcbf04b6322": {
        "memberNumber": "TDS_12345",
        "branchId": "BRANCH_001"
      }
    }
  }
}
```

#### 4. Azure Table Storage
```json
{
  "connectionName": "azureTableStorage",
  "connectionProperties": {
    "storageKey": "{{storage-connection-string}}"
  }
}
```

## Input Schema

### Alto Webhook (CloudEvents Format)
```json
{
  "specversion": "1.0",
  "type": "com.alto.tenancy.created",
  "source": "alto-system",
  "subject": "/tenancies/TEN_12345",
  "id": "webhook-event-id",
  "time": "2025-01-25T10:30:00Z",
  "data": {
    "subjectId": "TEN_12345",
    "agencyRef": "1af89d60-662c-475b-bcc8-9bcbf04b6322",
    "branchId": "BRANCH_001",
    "integrationId": "c37c658a-4bcf-4781-8583-7c5fd1e77faf"
  }
}
```

## Output Schema

### Success Response
```json
{
  "status": "processed",
  "workflowId": "workflow-guid",
  "tenancyId": "TEN_12345",
  "batchId": "batch-id-from-tds",
  "danNumber": "DAN123456789",
  "timestamp": "2025-01-25T11:00:00Z"
}
```

### Error Response
```json
{
  "status": "failed",
  "workflowId": "workflow-guid",
  "error": {
    "error": "Invalid webhook data",
    "message": "Missing required fields: tenancyId or agencyRef"
  },
  "timestamp": "2025-01-25T11:00:00Z"
}
```

## Data Transformation

### Alto to Standard Model Mapping

| Alto Field | Standard Model Field |
|------------|---------------------|
| `tenancy.id` | `metadata.sourceId` |
| `tenancy.deposit.amount` | `deposit.amount` |
| `tenancy.startDate` | `deposit.tenancyStartDate` |
| `tenancy.endDate` | `deposit.tenancyEndDate` |
| `property.address.line1` | `property.address.line1` |
| `property.address.postcode` | `property.address.postcode` |
| `landlord.firstName` | `landlord.firstName` |
| `tenants[].firstName` | `tenants[].firstName` |

### Address Enhancement
- Postcode lookup adds county automatically
- UK country code defaulted
- Address lines normalized

### Organization Resolution
- `agencyRef` mapped to TDS member number
- Branch ID resolved from configuration
- Organization name populated

## Error Handling

### Validation Errors
- Missing tenancyId or agencyRef
- Invalid webhook format
- Required field validation

### API Errors
- Alto OAuth2 authentication failures
- Alto API rate limiting
- Network connectivity issues
- TDS API errors

### Retry Logic
- Alto API: 3 retries with exponential backoff
- TDS polling: 30 attempts (30 minutes maximum)
- Automatic retry for transient failures

## Monitoring

### Application Insights
- Custom events for each workflow step
- Performance metrics
- Error tracking and alerting

### Key Metrics
- Webhook processing time
- Alto API response times
- TDS deposit creation success rate
- DAN retrieval time

### Alerts
- Failed webhook processing
- Alto API authentication errors
- TDS deposit failures
- Polling timeout (30 minutes)

## Deployment

### ARM Template
```bash
az deployment group create \
  --resource-group tds-integration \
  --template-file alto-adapter-template.json \
  --parameters @alto-adapter-parameters.json
```

### PowerShell Deployment
```powershell
.\Deploy-AltoAdapter.ps1 -Environment Production -ResourceGroup tds-integration
```

## Testing

### Test Webhook Payload
```json
{
  "specversion": "1.0",
  "type": "com.alto.tenancy.created",
  "source": "alto-system-test",
  "subject": "/tenancies/TEST_12345",
  "id": "test-webhook-id",
  "time": "2025-01-25T10:30:00Z",
  "data": {
    "subjectId": "TEST_12345",
    "agencyRef": "test-agency-ref",
    "branchId": "TEST_BRANCH",
    "integrationId": "test-integration-id"
  }
}
```

### Manual Testing
```bash
# Test webhook endpoint
curl -X POST "https://your-logic-app.azurewebsites.net/workflows/alto-adapter/triggers/manual/paths/invoke" \
  -H "Content-Type: application/json" \
  -d @test-webhook.json
```

### Integration Testing
- Mock Alto API responses
- Test all error scenarios
- Validate standard model transformation
- Verify TDS submission

## Security

### Authentication
- Function keys for service-to-service calls
- Key Vault integration for secrets
- Azure AD Managed Identity where possible

### Network Security
- Private endpoints for internal communication
- IP restrictions on Logic App triggers
- HTTPS enforcement

### Data Protection
- Sensitive data stored in Key Vault
- Audit logging for all operations
- Data retention policies

## Troubleshooting

### Common Issues

#### 1. Authentication Failures
```
Error: "OAuth2 token request failed"
Solution: Check Alto client credentials in Key Vault
```

#### 2. Missing County
```
Error: "Postcode lookup returned null"
Solution: Verify postcode format and lookup service availability
```

#### 3. TDS Timeout
```
Error: "Polling timeout after 30 minutes"
Solution: Check TDS service status and batch processing
```

### Debug Information
- Workflow run history
- Action input/output details
- Application Insights trace logs
- Azure Table Storage records

## Version History

- **v1.0**: Initial Alto integration
  - CloudEvents webhook support
  - OAuth2 authentication
  - Standard model transformation
  - TDS integration via adapter factory

## Next Steps

1. Add support for tenancy updates/cancellations
2. Implement webhook signature verification
3. Add batch processing capabilities
4. Enhance error recovery mechanisms