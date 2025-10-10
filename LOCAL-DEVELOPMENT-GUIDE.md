# Local Development Guide

This guide explains how to develop and test the TDS Integration Platform locally before deploying to Azure.

## 🚀 Quick Start

### Prerequisites
```bash
# Install Node.js 18+
node --version  # Should be v18+

# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Install Azurite (Storage Emulator)
npm install -g azurite

# Optional: Install Commander for scripts
npm install -g commander
```

### 1-Command Startup
```bash
# Start everything (Functions + Storage + Mock Services)
.\scripts\dev-start.ps1
```

## 🔧 Manual Setup (Step by Step)

### Step 1: Start Storage Emulator
```bash
# Terminal 1: Start Azurite
azurite --silent --location ./local-storage

# Or use Azure Storage Emulator (Windows only)
"C:\Program Files (x86)\Microsoft SDKs\Azure\Storage Emulator\AzureStorageEmulator.exe" start
```

### Step 2: Start Azure Functions
```bash
# Terminal 2: Navigate to functions directory
cd "azure-functions"

# Install dependencies
npm install

# Start Functions runtime
func start --port 7071 --cors "*"
```

### Step 3: Start Mock Services (Optional)
```bash
# Terminal 3: Start Mock TDS Server
cd "testing/mock-services"
npm install
node mock-tds-server.js --port 3001

# Terminal 4: Start Mock Alto Server (if needed)
node mock-alto-server.js --port 3002
```

## 🌐 Local Endpoints

### Azure Functions (Port 7071)
- **Postcode Lookup**: `http://localhost:7071/api/postcode/{postcode}`
- **Postcode Health**: `http://localhost:7071/api/postcode/health`
- **Postcode Stats**: `http://localhost:7071/api/postcode/stats`
- **TDS Adapter**: `http://localhost:7071/api/tds/{action}`
- **TDS Config**: `http://localhost:7071/api/tds/config`

### Mock Services
- **Mock TDS**: `http://localhost:3001`
- **Mock Alto**: `http://localhost:3002` (if implemented)

### Storage Services
- **Blob Storage**: `http://127.0.0.1:10000`
- **Queue Storage**: `http://127.0.0.1:10001`
- **Table Storage**: `http://127.0.0.1:10002`

## 🧪 Testing Your Local Environment

### Basic Health Checks
```bash
# Test Functions are running
curl http://localhost:7071/api/postcode/health

# Test postcode lookup
curl "http://localhost:7071/api/postcode/MK18%207ET"

# Test TDS adapter config
curl http://localhost:7071/api/tds/config
```

### Comprehensive Testing
```bash
# Run validation script
node scripts/validate-setup.js --environment local --verbose

# Test specific postcodes
curl "http://localhost:7071/api/postcode/HP3%208EY"
curl "http://localhost:7071/api/postcode/DL3%207ST"

# Test batch lookup
curl -X POST http://localhost:7071/api/postcode/batch \
  -H "Content-Type: application/json" \
  -d '{"postcodes": ["MK18 7ET", "HP3 8EY", "DL3 7ST"]}'
```

### Mock TDS Testing
```bash
# Test Mock TDS health
curl http://localhost:3001/health

# Get sample deposit payload
curl http://localhost:3001/test/sample-deposit

# Create a test deposit
curl -X POST http://localhost:3001/CreateDeposit \
  -H "Content-Type: application/json" \
  -d @testing/sample-data/test-deposit.json
```

## 📁 Local File Structure

```
Production Ready Concept/
├── azure-functions/
│   ├── local.settings.json          # Local config
│   ├── host.json                    # Functions runtime config
│   └── shared-services/             # Your functions
├── configuration/
│   └── app-settings/local.json      # Local environment config
├── testing/
│   ├── mock-services/               # Mock servers
│   └── sample-data/                 # Test data files
├── local-storage/                   # Azurite storage location
└── scripts/
    └── dev-start.ps1               # Development startup script
```

## ⚙️ Configuration

### Environment Variables (local.settings.json)
```json
{
  "Values": {
    "TDS_ACTIVE_PROVIDER": "mock",
    "TDS_CURRENT_BASE_URL": "http://localhost:3001",
    "ALTO_CLIENT_ID": "your-client-id",
    "ALTO_CLIENT_SECRET": "your-client-secret"
  }
}
```

### Mock vs Real Services
To switch between mock and real services, update your configuration:

```bash
# Use Mock TDS (for local dev)
TDS_ACTIVE_PROVIDER=mock
TDS_MOCK_BASE_URL=http://localhost:3001

# Use Real TDS Sandbox
TDS_ACTIVE_PROVIDER=current
TDS_CURRENT_BASE_URL=https://sandbox.api.custodial.tenancydepositscheme.com/v1.2
```

## 🔍 Debugging

### Azure Functions Debugging
```bash
# Enable debug logging
export AzureWebJobsScriptRoot=/path/to/functions
export AzureFunctionsJobHost__Logging__Console__IsEnabled=true

# Start with debugging
func start --verbose
```

### View Logs
- **Functions Logs**: Show in terminal when running `func start`
- **Mock Service Logs**: Show in terminal when running mock servers
- **Storage Logs**: Check Azurite debug logs in `./azurite/debug.log`

### Common Issues

#### Port Already in Use
```bash
# Find process using port 7071
netstat -ano | findstr :7071
# Kill process by PID
taskkill /PID <PID> /F
```

#### Functions Not Starting
```bash
# Clear Functions cache
func clean

# Reinstall dependencies
cd azure-functions
rm -rf node_modules package-lock.json
npm install
```

#### Storage Connection Issues
```bash
# Restart Azurite
pkill -f azurite
azurite --silent --location ./local-storage
```

## 🚦 Development Workflow

### 1. Code Changes
1. Make changes to Azure Functions or Logic Apps
2. Functions auto-reload with `func start`
3. Test endpoints manually or with validation script

### 2. Testing
```bash
# Unit tests (if implemented)
npm test

# Integration tests
node scripts/validate-setup.js --environment local

# Manual API testing
curl http://localhost:7071/api/postcode/health
```

### 3. Debugging Logic Apps Locally
For Logic Apps, you can:
- Test individual actions using mock HTTP endpoints
- Use VS Code Logic Apps extension for local development
- Export Logic Apps as functions for local testing

### 4. Performance Testing
```bash
# Load test postcode lookup
ab -n 1000 -c 10 "http://localhost:7071/api/postcode/MK18%207ET"

# Test batch operations
# Create script to send multiple batch requests
```

## 🔄 Sync with Azure

### Deploy from Local
```bash
# Deploy functions to Azure
func azure functionapp publish your-function-app-name

# Or use deployment script
.\scripts\deploy.ps1 -Environment dev -SkipInfrastructure
```

### Pull from Azure
```bash
# Download app settings from Azure
func azure functionapp fetch-app-settings your-function-app-name

# Download function code
func azure functionapp download your-function-app-name
```

## 📊 Monitoring Local Development

### Health Checks
Create a simple health check dashboard:
```bash
# Check all services
echo "Functions: " && curl -s http://localhost:7071/api/postcode/health | jq .status
echo "Mock TDS: " && curl -s http://localhost:3001/health | jq .status
echo "Storage: " && curl -s http://127.0.0.1:10000/ >/dev/null && echo "OK" || echo "FAIL"
```

### Performance Monitoring
- Use browser developer tools for request timing
- Add custom timing headers in your functions
- Monitor Azure Functions runtime metrics

## 🎯 Best Practices

### 1. Environment Isolation
- Use different ports for different projects
- Keep local config separate from production
- Use environment-specific feature flags

### 2. Data Management
- Reset mock data between test runs
- Use realistic test data that matches production schema
- Keep test data in version control

### 3. Security
- Never commit real secrets to local.settings.json
- Use placeholder values for local development
- Test with mock credentials when possible

### 4. Performance
- Use short cache TTLs for local development
- Enable detailed logging for debugging
- Test with realistic data volumes

## 🆘 Troubleshooting

### Common Commands
```bash
# Reset everything
.\scripts\dev-start.ps1 -Reset

# Check what's running
netstat -ano | findstr "7071\|3001\|10000"

# View all processes
Get-Process | Where-Object {$_.ProcessName -like "*node*"}

# Clear Azure Functions cache
func clean
```

### Getting Help
1. Check this guide first
2. Look at sample requests in `testing/sample-data/`
3. Check Azure Functions documentation
4. Review mock service logs for API format

---

**Happy Local Development! 🚀**

This local setup gives you a complete development environment that mirrors your Azure deployment, allowing you to develop and test everything locally before deploying to the cloud.