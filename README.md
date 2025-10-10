# TDS RapidInt

**Intelligent Integration Platform for Property Management Systems**

TDS RapidInt is a serverless integration platform that automates deposit registration between property management systems (Alto, Jupix, and others) and The Dispute Service (TDS) custodial deposit system. Built on Azure Functions, it provides webhook-driven automation, intelligent API routing, and zero-downtime migration capabilities between TDS API versions.

## What It Does

When a property manager creates a new tenancy in their property management system (e.g., Alto), RapidInt automatically:

1. **Receives** the webhook notification from the property management system
2. **Retrieves** complete tenancy, property, and contact information via API
3. **Transforms** the data into TDS-compatible format with validation
4. **Routes** the request intelligently based on configuration and API health
5. **Submits** the deposit to TDS and monitors until completion
6. **Returns** the DAN (Deposit Allocation Number) back to the source system

This eliminates manual data entry, reduces errors, and ensures deposits are registered in TDS within seconds of tenancy creation.

## Key Features

### Dual-API Support
- **Seamless Migration**: Supports both legacy TDS API and new Salesforce-based TDS API simultaneously
- **Flexible Routing Modes**:
  - `legacy-only` - Route all traffic to current TDS API
  - `salesforce-only` - Route all traffic to Salesforce TDS API
  - `both` - Send to both APIs and compare responses (testing mode)
  - `shadow` - Primary on one API, shadow test on the other
  - `forwarding` - Gradual traffic shifting (0-100%) for controlled migration
- **Organization-Level Control**: Each agency can specify their preferred API provider
- **Automatic Failover**: Circuit breaker pattern with health monitoring

### Multi-Tenancy
- **Organization Mappings**: Store encrypted credentials per agency/branch
- **Custom Routing**: Organizations can override global routing preferences
- **Credential Security**: API keys encrypted using Azure Key Vault
- **15-Minute Cache**: Optimized credential retrieval with automatic expiration

### Integration Adapters
- **Alto Integration**: Full webhook support for tenancy creation events
- **Jupix Integration**: Framework ready, implementation in progress
- **Extensible Architecture**: Template-based adapter system for adding new property management systems

### Monitoring & Insights
- **Comparison Metrics**: Track API response differences during dual-mode testing
- **Batch Tracking**: Monitor deposit submission batches with detailed logging
- **Audit Trail**: Complete history of all deposit submissions and API calls
- **Web Dashboards**:
  - Multi-integration dashboard for managing all connected systems
  - Migration dashboard for monitoring API transition progress
  - Alto integration dashboard with real-time webhook testing
  - Configuration management interface

### Developer Experience
- **Postcode Lookup Service**: Built-in UK postcode to county mapping (3,051 districts)
- **Local Development**: Azurite support for offline development and testing
- **API Documentation**: RESTful configuration API for runtime updates
- **Webhook Tester**: Built-in tool for testing webhook payloads

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Property Management Systems              │
│                    (Alto, Jupix, Others)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ Webhook Events
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Integration Adapters                      │
│              (System-specific webhook handlers)              │
└──────────────────────┬──────────────────────────────────────┘
                       │ Standardized Data
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    TDS Adapter Factory                       │
│            (Intelligent routing & dual-API logic)            │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌──────────────┐              ┌──────────────┐
│ Current TDS  │              │ Salesforce   │
│     API      │              │   TDS API    │
└──────────────┘              └──────────────┘
```

## Directory Structure

```
├── azure-functions/
│   ├── shared-services/          # Core Azure Functions
│   │   ├── PostcodeLookup/       # UK postcode → county mapping
│   │   ├── TDSAdapterFactory/    # Dual-API routing logic
│   │   ├── TDSRequestForwarder/  # Request forwarding to TDS
│   │   ├── ConfigurationAPI/     # Runtime configuration management
│   │   ├── ComparisonMetrics/    # API response comparison tracking
│   │   └── shared/               # Shared modules
│   │       ├── salesforce-auth.js        # Salesforce OAuth2 + API key auth
│   │       ├── organization-credentials.js # Encrypted credential retrieval
│   │       ├── config-manager.js         # Routing configuration
│   │       ├── batch-tracking.js         # Batch submission tracking
│   │       ├── telemetry.js              # Logging and monitoring
│   │       └── circuit-breaker.js        # API health monitoring
│   └── integration-specific/     # System-specific adapters
├── database/
│   └── migrations/               # SQL migrations for Azure SQL
│       ├── 001_create_organization_mappings.sql
│       ├── 002_create_batch_tracking.sql
│       └── 003_create_comparison_log.sql
├── tools/                        # Web-based management dashboards
│   ├── multi-integration-dashboard.html  # Main control panel
│   ├── migration-dashboard.html          # API migration monitoring
│   ├── alto-integration.html             # Alto-specific dashboard
│   └── webhook-tester.html               # Webhook testing tool
├── scripts/                      # Deployment and utility scripts
└── testing/                      # Test fixtures and mock services
```

## Getting Started

### Prerequisites
- **Azure Account** with subscription access
- **Node.js 18+** (Azure Functions runtime)
- **Azurite** (for local development)
- **PowerShell 7+** (for deployment scripts)

### Local Development

1. **Install Azurite** for local Azure storage emulation:
   ```bash
   npm install -g azurite
   ```

2. **Start Azurite**:
   ```bash
   azurite --silent --location ./azurite --debug ./azurite/debug.log
   ```

3. **Configure local settings** in `azure-functions/local.settings.json`:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "AzureWebJobsStorage": "UseDevelopmentStorage=true",
       "FUNCTIONS_WORKER_RUNTIME": "node",
       "TDS_ROUTING_MODE": "legacy-only",
       "TDS_FORWARDING_PERCENTAGE": "0"
     }
   }
   ```

4. **Install dependencies**:
   ```bash
   cd azure-functions
   npm install
   ```

5. **Start Azure Functions locally**:
   ```bash
   func start
   ```

6. **Access dashboards**:
   - Open `tools/multi-integration-dashboard.html` in your browser
   - Configure organization mappings
   - Test webhook payloads

### Production Deployment

Deployment instructions and CI/CD pipeline setup will be added when Azure infrastructure is configured.

## Configuration

### Routing Modes

Control how requests are routed to TDS APIs via the Configuration API:

```bash
# Set routing mode
curl -X PUT http://localhost:7071/api/config/routing-mode \
  -H "Content-Type: application/json" \
  -d '{"routingMode": "forwarding"}'

# Set forwarding percentage (0-100)
curl -X PUT http://localhost:7071/api/config/forwarding-percentage \
  -H "Content-Type: application/json" \
  -d '{"percentage": 25}'
```

### Organization Mappings

Each organization mapping includes:
- **Alto/Jupix Credentials**: Agency ref, branch ID, API keys
- **TDS Credentials**: Member ID, branch ID, API key (encrypted)
- **Provider Preference**: Which TDS API to use (`current`, `salesforce`, `auto`)
- **Region & Scheme**: UK region (EW/Scotland/NI), scheme type (Custodial/Insurance)

Manage mappings through the web dashboard or Configuration API.

## API Endpoints

### Configuration API

- `GET /api/config` - Get current global configuration
- `PUT /api/config/routing-mode` - Update routing mode
- `PUT /api/config/forwarding-percentage` - Update traffic split
- `GET /api/config/organizations/{agencyRef}` - Get org config
- `PUT /api/config/organizations/{agencyRef}?subAction=provider` - Update org provider
- `GET /api/config/cache/stats` - Cache statistics
- `POST /api/config/cache/clear` - Clear configuration cache

### Postcode Lookup

- `GET /api/postcode/{postcode}` - Get county for UK postcode

## Technology Stack

- **Runtime**: Azure Functions (Node.js 20)
- **Storage**: Azure Table Storage (organization mappings, audit logs)
- **Database**: Azure SQL (batch tracking, comparison metrics)
- **Security**: Azure Key Vault (encryption key management)
- **Monitoring**: Application Insights integration
- **Development**: Azurite (local storage emulation)

## Testing

Run unit tests:
```bash
cd azure-functions
npm test
```

Run integration tests:
```bash
npm run test:integration
```

Coverage report:
```bash
npm run test:coverage
```

## Security

- **Encrypted Credentials**: All TDS API keys encrypted using AES-256-CBC
- **Key Vault Integration**: Encryption keys stored in Azure Key Vault
- **Credential Caching**: 15-minute TTL with automatic expiration
- **OAuth2 Support**: Salesforce API supports OAuth2 token-based auth
- **HTTPS Only**: All production endpoints use TLS

**Note**: See security audit documentation for known issues and remediation timeline.

## Monitoring

### Metrics Tracked
- Deposit submission success/failure rates
- API response times (legacy vs Salesforce)
- Response comparison results (when in dual mode)
- Batch processing statistics
- Circuit breaker state changes

### Dashboards
- **Migration Dashboard**: Real-time view of API traffic distribution and comparison metrics
- **Integration Dashboard**: Monitor all connected property management systems
- **Batch Tracking**: Historical view of deposit submission batches

## Roadmap

- [ ] Complete Jupix integration adapter
- [ ] Add support for additional property management systems (Reapit, Arthur Online)
- [ ] Enhanced error recovery with automatic retry logic
- [ ] Rate limiting and throttling controls
- [ ] Advanced reporting and analytics
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Production security hardening (see security audit)

## Contributing

This is a private repository maintained by The Dispute Service. For internal contributors:

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `npm run lint` and fix any issues
4. Submit pull request with detailed description
5. Ensure all tests pass before merging

## License

Proprietary - The Dispute Service

---

**Version**: MVP 1.0
**Last Updated**: 2024-10-10
**Maintainer**: Omar Lodhi (The Dispute Service)
