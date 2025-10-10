# TDS Dual-API Architecture Guide

## Overview

The TDS Integration Platform now supports **dual-API architecture** enabling seamless switching between the Legacy TDS API and the new Salesforce-based TDS API with **zero downtime**. This architecture provides request forwarding, automatic transformation, and gradual migration capabilities.

---

## Architecture Components

### 1. **TDS Request Forwarder** (New)
**Location:** `azure-functions/shared-services/TDSRequestForwarder/`

Smart routing layer that intercepts requests and forwards them to the appropriate API based on configuration.

**Key Features:**
- Multiple routing modes (legacy-only, salesforce-only, both, forwarding, shadow)
- Automatic request/response transformation
- Percentage-based traffic splitting (0-100%)
- Dual execution for validation
- Automatic fallback on errors
- Response comparison and logging

**Endpoints:**
- `POST /api/tds-forwarder/create` - Create deposit
- `POST /api/tds-forwarder/status` - Check deposit status
- `GET /api/tds-forwarder/health` - Health check
- `GET /api/tds-forwarder/config` - Get current configuration

### 2. **Enhanced TDS Adapter Factory** (Modified)
**Location:** `azure-functions/shared-services/TDSAdapterFactory/`

Extended to support dual-execution mode where requests are sent to both APIs simultaneously for comparison.

**New Capabilities:**
- Dual-mode execution (`TDS_DUAL_MODE=true`)
- Parallel API calls with comparison
- Response validation and mismatch detection

### 3. **Request Transformers** (New)
**Location:** `azure-functions/shared-services/TDSRequestForwarder/transformers/`

Bidirectional transformation between legacy and Salesforce API formats.

**Transformers:**
- `legacy-to-salesforce.js` - Converts legacy request format to Salesforce
- `salesforce-to-legacy.js` - Converts Salesforce response to legacy format

---

## Routing Modes

### 1. **legacy-only** (Default/Safe Mode)
All requests routed to Legacy TDS API.

**Use Case:** Production default, emergency rollback
```bash
TDS_ROUTING_MODE=legacy-only
TDS_FORWARDING_PERCENTAGE=0
```

### 2. **salesforce-only**
All requests routed to Salesforce TDS API.

**Use Case:** Post-migration state
```bash
TDS_ROUTING_MODE=salesforce-only
TDS_ACTIVE_PROVIDER=salesforce
```

### 3. **both** (Dual Execution)
Executes on both APIs simultaneously, compares results.

**Use Case:** Validation phase, testing consistency
```bash
TDS_ROUTING_MODE=both
TDS_DUAL_MODE=true
TDS_ENABLE_RESPONSE_COMPARISON=true
```

### 4. **forwarding** (Gradual Rollout)
Percentage-based routing for gradual migration.

**Use Case:** Progressive migration (10% → 25% → 50% → 100%)
```bash
TDS_ROUTING_MODE=forwarding
TDS_FORWARDING_PERCENTAGE=25  # 25% to Salesforce, 75% to Legacy
```

### 5. **shadow** (Testing Mode)
Sends requests to Salesforce in background, returns Legacy response.

**Use Case:** Pre-production testing without impacting users
```bash
TDS_ROUTING_MODE=shadow
TDS_FORWARDING_PERCENTAGE=10  # 10% shadow traffic to Salesforce
```

---

## Configuration

### Environment Variables

#### Required
```bash
# Routing configuration
TDS_ROUTING_MODE=legacy-only|salesforce-only|both|forwarding|shadow
TDS_FORWARDING_PERCENTAGE=0-100

# API endpoints
TDS_CURRENT_BASE_URL=https://api.custodial.tenancydepositscheme.com/v1.2
TDS_SALESFORCE_BASE_URL=https://tds.my.salesforce.com/services/apexrest/v2.0

# Active provider (for TDSAdapterFactory)
TDS_ACTIVE_PROVIDER=current|salesforce
```

#### Optional
```bash
# Dual execution mode
TDS_DUAL_MODE=true|false

# Fallback and comparison
TDS_ENABLE_FALLBACK=true|false
TDS_ENABLE_RESPONSE_COMPARISON=true|false

# Salesforce authentication
SALESFORCE_ACCESS_TOKEN=your-token-here
```

### Configuration Files

#### Development (`configuration/app-settings/development.json`)
```json
{
  "tdsRequestForwarder": {
    "routingMode": "shadow",
    "forwardingPercentage": 10,
    "enableFallback": true,
    "enableResponseComparison": true
  },
  "tdsAdapterFactory": {
    "activeProvider": "current",
    "dualMode": true
  },
  "featureFlags": {
    "enableSalesforceTDS": true,
    "enableDualApiMode": true,
    "enableRequestForwarding": true
  }
}
```

#### Production (`configuration/app-settings/production.json`)
```json
{
  "tdsRequestForwarder": {
    "routingMode": "legacy-only",
    "forwardingPercentage": 0,
    "enableFallback": true,
    "enableResponseComparison": true
  },
  "tdsAdapterFactory": {
    "activeProvider": "current",
    "dualMode": false
  },
  "featureFlags": {
    "enableSalesforceTDS": false,
    "enableDualApiMode": false,
    "enableRequestForwarding": false
  }
}
```

---

## Migration Strategy

### Phase 1: Preparation (Week 1)
**Objective:** Deploy infrastructure, test in development

```bash
# 1. Deploy TDSRequestForwarder function
cd azure-functions/shared-services/TDSRequestForwarder
func azure functionapp publish tds-platform-dev-functions

# 2. Update configuration to enable forwarder
.\scripts\switch-api-provider.ps1 -Environment dev -Mode shadow -ForwardingPercentage 10

# 3. Validate deployment
node scripts\validate-dual-api.js --environment=dev --iterations=100
```

**Success Criteria:**
- ✅ All health checks pass
- ✅ Shadow mode successfully logs to both APIs
- ✅ No errors in Application Insights
- ✅ Transformation logic validated

### Phase 2: Shadow Testing (Week 2-3)
**Objective:** Test Salesforce API with real traffic, no user impact

```bash
# Gradually increase shadow percentage
.\scripts\switch-api-provider.ps1 -Environment dev -Mode shadow -ForwardingPercentage 25
.\scripts\switch-api-provider.ps1 -Environment dev -Mode shadow -ForwardingPercentage 50

# Monitor and compare responses
node scripts\validate-dual-api.js --environment=dev --mode=shadow --iterations=500
```

**Success Criteria:**
- ✅ Response match rate >99%
- ✅ Salesforce API response time acceptable
- ✅ No Salesforce API errors
- ✅ Transformation accuracy validated

### Phase 3: Gradual Rollout (Week 4-6)
**Objective:** Route real traffic to Salesforce progressively

```bash
# Start with 10% real traffic
.\scripts\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 10

# Monitor for 24 hours, then increase
.\scripts\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 25
# Monitor for 24 hours

.\scripts\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 50
# Monitor for 48 hours

.\scripts\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 75
# Monitor for 48 hours

.\scripts\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 100
# Monitor for 1 week
```

**Success Criteria:**
- ✅ Error rate <0.1%
- ✅ P95 response time <3s
- ✅ No customer complaints
- ✅ All deposits receive DANs

### Phase 4: Full Migration (Week 7)
**Objective:** Switch completely to Salesforce API

```bash
# Switch to Salesforce-only mode
.\scripts\switch-api-provider.ps1 -Environment prod -Mode salesforce-only

# Validate
node scripts\validate-dual-api.js --environment=prod --iterations=1000
```

**Success Criteria:**
- ✅ 100% traffic on Salesforce
- ✅ Legacy API no longer receiving requests
- ✅ System stability maintained

### Phase 5: Cleanup (Week 8+)
**Objective:** Deprecate legacy API integration

- Monitor for 2 weeks with Salesforce-only mode
- Disable legacy API credentials
- Remove legacy API from configuration
- Update documentation

---

## Emergency Rollback

If issues are detected at any phase:

```bash
# Immediate rollback to legacy API
.\scripts\switch-api-provider.ps1 -Environment prod -Rollback

# Or manually set environment variables
TDS_ROUTING_MODE=legacy-only
TDS_FORWARDING_PERCENTAGE=0
TDS_ACTIVE_PROVIDER=current
```

**Rollback Time:** < 1 minute (configuration change only)

---

## Monitoring & Validation

### Health Checks

```bash
# Check forwarder health
curl https://tds-platform-prod-functions.azurewebsites.net/api/tds-forwarder/health?code=<key>

# Check configuration
curl https://tds-platform-prod-functions.azurewebsites.net/api/tds-forwarder/config?code=<key>
```

### Application Insights Queries

**Response Comparison Mismatches:**
```kusto
traces
| where customDimensions.comparison_dataMatch == "false"
| project timestamp, customDimensions
| order by timestamp desc
```

**Routing Distribution:**
```kusto
requests
| where name == "TDSRequestForwarder"
| summarize count() by tostring(customDimensions.provider)
| render piechart
```

**Performance Comparison:**
```kusto
requests
| where name == "TDSRequestForwarder"
| summarize
    avg(duration),
    percentile(duration, 95),
    percentile(duration, 99)
    by tostring(customDimensions.provider)
```

### Validation Script

```bash
# Run comprehensive validation
node scripts\validate-dual-api.js --environment=prod --iterations=1000

# Test specific mode
node scripts\validate-dual-api.js --environment=dev --mode=shadow --iterations=100

# Generate report
node scripts\validate-dual-api.js --environment=prod
# Report saved to: validation-report-prod-<timestamp>.json
```

---

## API Integration Updates

### Alto Logic App

The Alto adapter now supports optional request forwarding:

```json
{
  "parameters": {
    "useRequestForwarder": true,
    "tdsForwarderUrl": "https://tds-platform-prod-functions.azurewebsites.net/api/tds-forwarder"
  }
}
```

Set `useRequestForwarder=true` to use the forwarder, `false` to use direct adapter.

### External API Customers

No changes required! The request forwarder maintains 100% backward compatibility with the legacy API format.

---

## Request/Response Transformation

### Legacy to Salesforce

**Legacy Format:**
```json
{
  "organisation": {
    "member_number": "TDS_12345",
    "branch_id": "BRANCH_001"
  },
  "deposits": [{
    "deposit_amount": 1500.00,
    "property": {
      "address_line_1": "123 Test St",
      "postcode": "MK18 7ET"
    }
  }]
}
```

**Salesforce Format:**
```json
{
  "Organization__c": {
    "Member_Number__c": "TDS_12345",
    "Branch_Id__c": "BRANCH_001"
  },
  "Deposits__r": [{
    "Amount__c": 1500.00,
    "Property__c": {
      "Address_Line_1__c": "123 Test St",
      "Postcode__c": "MK18 7ET"
    }
  }]
}
```

Transformation is automatic and bidirectional.

---

## Troubleshooting

### Issue: Response mismatches between APIs

**Solution:**
1. Check Application Insights for specific differences
2. Review transformation logic in `transformers/`
3. Enable dual-mode to compare responses
4. Update transformers if needed

### Issue: Salesforce API errors

**Solution:**
1. Check Salesforce authentication (OAuth token)
2. Verify Salesforce endpoint URL
3. Enable fallback to legacy API
4. Reduce forwarding percentage

### Issue: High latency on Salesforce API

**Solution:**
1. Check Salesforce API performance in their dashboard
2. Increase timeout settings
3. Reduce forwarding percentage
4. Enable caching if applicable

### Issue: Requests not being forwarded

**Solution:**
1. Verify `TDS_ROUTING_MODE` is set correctly
2. Check `TDS_FORWARDING_PERCENTAGE` value
3. Ensure forwarder function is deployed
4. Check Alto Logic App `useRequestForwarder` parameter

---

## Files Reference

### New Files Created
```
azure-functions/shared-services/TDSRequestForwarder/
├── index.js                                    # Main forwarder function
├── function.json                               # Azure Function binding
└── transformers/
    ├── legacy-to-salesforce.js                 # Request transformation
    └── salesforce-to-legacy.js                 # Response transformation

scripts/
├── switch-api-provider.ps1                     # Migration automation script
└── validate-dual-api.js                        # Validation and testing tool
```

### Modified Files
```
azure-functions/shared-services/TDSAdapterFactory/index.js  # Added dual-mode
logic-apps/integration-adapters/alto-adapter/workflow.json  # Added forwarder option
configuration/app-settings/production.json                  # Added forwarder config
configuration/app-settings/development.json                 # Added forwarder config
```

---

## Best Practices

1. **Always test in development first** before deploying to production
2. **Monitor Application Insights** continuously during migration
3. **Increase forwarding percentage gradually** (10% → 25% → 50% → 75% → 100%)
4. **Wait 24-48 hours** between percentage increases
5. **Keep rollback script ready** for emergency use
6. **Document all changes** and configuration updates
7. **Communicate with stakeholders** before each phase
8. **Set up alerts** for error rate thresholds

---

## Support & Contact

For questions or issues:
- Review Application Insights logs
- Check health endpoints
- Run validation script
- Contact: TDS Integration Team

---

**Version:** 1.0.0
**Last Updated:** 2025-10-01
**Status:** Production Ready
