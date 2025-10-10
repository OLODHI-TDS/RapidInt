# Production Ready Integration Platform
## Scalable Property Management → TDS Deposit Integration Hub

This platform provides a modular, scalable integration solution for connecting multiple property management systems (Alto, Jupix, and future systems) to TDS (The Dispute Service) custodial deposit system.

## Architecture Overview

### Hub-and-Spoke Model
- **Integration Hub**: Core shared services for all integrations
- **Integration Adapters**: System-specific connection logic
- **TDS Abstraction**: Hot-swappable TDS API providers
- **Multi-Tenancy**: Support for multiple agencies/organizations

### Key Components

#### Core Platform Services
- **TDS Deposit Creator** - Unified deposit submission logic
- **Postcode Lookup** - UK postcode to county mapping (3,051 districts)
- **Data Transformer** - Standard format conversion engine
- **TDS Adapter Factory** - API abstraction layer for TDS providers

#### Integration Adapters
- **Alto Adapter** - Alto property management integration
- **Jupix Adapter** - Jupix property management integration
- **Adapter Template** - Template for future integrations

## Directory Structure

```
├── azure-infrastructure/    # Infrastructure as Code (ARM/Terraform)
├── logic-apps/             # Azure Logic Apps workflows
├── azure-functions/        # Shared serverless functions
├── api-management/         # API gateway configuration
├── service-bus/           # Message queuing configuration
├── data-models/           # Canonical data models
├── configuration/         # Environment configurations
├── monitoring/           # Dashboards and alerts
├── documentation/        # Architecture and guides
├── testing/             # Tests and mock services
└── scripts/            # Deployment and utility scripts
```

## Getting Started

### Prerequisites
- Azure Subscription
- Azure CLI
- PowerShell 7+
- Node.js 18+

### Quick Deploy
```bash
# Deploy core infrastructure
./scripts/deploy.ps1 -Environment dev

# Validate deployment
node scripts/validate-setup.js
```

## Supported Integrations

### Current
- ✅ Alto Property Management
- 🚧 Jupix Property Management

### Planned
- 📋 Reapit
- 📋 Arthur Online
- 📋 PropertyFile

## TDS API Support

### Current Provider
- TDS Custodial API v1.2
- Sandbox: `https://sandbox.api.custodial.tenancydepositscheme.com/v1.2`
- Production: `https://api.custodial.tenancydepositscheme.com/v1.2`

### Future Provider
- Salesforce-based TDS API (planned migration)
- Hot-swap capability with zero downtime

## Key Features

### Scalability
- Serverless architecture (Azure Logic Apps + Functions)
- Auto-scaling based on load
- Pay-per-execution pricing model

### Reliability
- Built-in retry mechanisms
- Dead letter queues for failed messages
- Comprehensive error handling
- 99.9% availability target

### Flexibility
- Plugin architecture for new integrations
- Configuration-driven TDS provider switching
- Multi-tenant organization support
- API versioning support

### Monitoring
- Application Insights integration
- Custom dashboards
- Proactive alerting
- Performance metrics

## Configuration

### Environment Variables
```bash
# Core Platform
AZURE_SUBSCRIPTION_ID=your-subscription-id
RESOURCE_GROUP_NAME=tds-integration-platform
KEY_VAULT_NAME=tds-platform-vault

# TDS Configuration
TDS_API_PROVIDER=current  # or 'salesforce'
TDS_BASE_URL=https://api.custodial.tenancydepositscheme.com/v1.2

# Service Bus
SERVICE_BUS_NAMESPACE=tds-integration-bus
```

### Feature Flags
```json
{
  "features": {
    "enableNewTDSProvider": false,
    "enableJupixIntegration": false,
    "enableAdvancedValidation": true
  }
}
```

## Integration Process Flow

1. **Webhook Receipt** → Integration adapter receives property system webhook
2. **Authentication** → System-specific OAuth/API key authentication
3. **Data Retrieval** → Fetch complete tenancy/property/contact data
4. **Transformation** → Convert to standard canonical format
5. **Validation** → Ensure required fields present
6. **TDS Submission** → Submit to active TDS provider
7. **Status Polling** → Monitor until DAN received
8. **Response** → Return DAN to source system

## Adding New Integrations

1. Copy `/logic-apps/integration-adapters/adapter-template/`
2. Implement system-specific authentication
3. Create data mapping rules
4. Test with sample data
5. Deploy and configure webhook endpoint

See [Integration Guide](documentation/integration-guides/adding-new-system.md) for details.

## Monitoring & Operations

### Health Checks
- `/health` - Platform health status
- `/health/integrations` - Individual adapter status
- `/health/tds` - TDS provider connectivity

### Metrics
- Deposits processed/hour
- Integration success rate
- Average processing time
- Error categorization

### Alerts
- Failed integration rate >1%
- TDS API errors
- Processing time >30 seconds
- Queue depth >100 messages

## Support

### Documentation
- [Architecture Guide](documentation/architecture/platform-overview.md)
- [API Reference](documentation/api-reference/)
- [Runbooks](documentation/runbooks/)

### Development
- **Framework**: Azure Logic Apps + Functions
- **Language**: Node.js 18, PowerShell
- **Database**: Azure Tables, Service Bus
- **Monitoring**: Application Insights

---

**Version**: 1.0.0
**Last Updated**: 2025-01-25
**Maintainer**: Omar Lodhi