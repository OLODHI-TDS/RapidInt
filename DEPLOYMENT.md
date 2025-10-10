# Deployment Guide - TDS RapidInt Platform

## Overview

This guide covers deploying the TDS RapidInt platform from GitHub to Azure using CI/CD.

## Architecture

**Local Development** → **GitHub** → **GitHub Actions (CI/CD)** → **Azure Functions**

## Prerequisites

1. **Azure Account**
   - Active Azure subscription
   - Resource group created: `tds-rapidint-rg`
   - Azure Functions app created (Node.js 20 runtime)

2. **GitHub Repository**
   - Repository: https://github.com/OLODHI-TDS/RapidInt
   - Appropriate access permissions

3. **Local Development Tools**
   - Node.js 20.x
   - Git
   - Azure Functions Core Tools
   - VS Code (recommended)

---

## Initial Setup

### Step 1: Clone Repository Locally

```bash
cd "C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept"
git init
git add .
git commit -m "Initial commit: TDS RapidInt MVP"
git branch -M main
git remote add origin https://github.com/OLODHI-TDS/RapidInt.git
git push -u origin main
```

### Step 2: Create Azure Function App

**Option A: Azure Portal**
1. Go to Azure Portal
2. Create new Function App
   - **Name**: `tds-rapidint` (or your preferred name)
   - **Runtime stack**: Node.js
   - **Version**: 20 LTS
   - **Region**: UK South (or your preferred region)
   - **Plan type**: Consumption (pay-per-use) or Premium
3. Note the Function App name for CI/CD configuration

**Option B: Azure CLI**
```bash
# Login to Azure
az login

# Set variables
$resourceGroup = "tds-rapidint-rg"
$location = "uksouth"
$functionAppName = "tds-rapidint"
$storageAccount = "tdsrapidintstore"

# Create resource group
az group create --name $resourceGroup --location $location

# Create storage account
az storage account create --name $storageAccount --resource-group $resourceGroup --location $location --sku Standard_LRS

# Create Function App
az functionapp create `
  --resource-group $resourceGroup `
  --consumption-plan-location $location `
  --runtime node `
  --runtime-version 20 `
  --functions-version 4 `
  --name $functionAppName `
  --storage-account $storageAccount
```

### Step 3: Get Azure Publish Profile

```bash
# Get publish profile (contains deployment credentials)
az functionapp deployment list-publishing-profiles `
  --name tds-rapidint `
  --resource-group tds-rapidint-rg `
  --xml > publish-profile.xml
```

Or from Azure Portal:
1. Go to your Function App
2. Click **Get publish profile** in the Overview tab
3. Save the downloaded `.PublishSettings` file

### Step 4: Configure GitHub Secrets

1. Go to your GitHub repository: https://github.com/OLODHI-TDS/RapidInt
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add secret:
   - **Name**: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
   - **Value**: Paste the entire contents of the publish profile XML file
5. Click **Add secret**

### Step 5: Configure Function App Settings

Add application settings (environment variables) to your Azure Function App:

```bash
# Using Azure CLI
az functionapp config appsettings set --name tds-rapidint --resource-group tds-rapidint-rg --settings `
  "TDS_ACTIVE_PROVIDER=auto" `
  "TDS_API_KEY=your-legacy-api-key" `
  "TDS_MEMBER_ID=your-member-id" `
  "TDS_BRANCH_ID=your-branch-id" `
  "SALESFORCE_INSTANCE_URL=your-salesforce-url" `
  "SALESFORCE_CLIENT_ID=your-oauth-client-id" `
  "SALESFORCE_CLIENT_SECRET=your-oauth-client-secret" `
  "SALESFORCE_AUTH_METHOD=oauth2" `
  "ALTO_CLIENT_ID=your-alto-client-id" `
  "ALTO_CLIENT_SECRET=your-alto-client-secret" `
  "ALTO_WEBHOOK_SECRET=your-alto-webhook-secret" `
  "NODE_ENV=production"
```

Or via Azure Portal:
1. Go to Function App → **Configuration**
2. Add each application setting
3. Click **Save**

---

## CI/CD Workflow

### How It Works

1. **Developer makes changes locally**
2. **Commit and push to GitHub**
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin main
   ```
3. **GitHub Actions automatically triggers**
   - Checks out code
   - Installs dependencies
   - Deploys to Azure Functions
4. **Azure Function App updated automatically**

### Workflow Configuration

The workflow is defined in `.github/workflows/azure-deploy.yml`:

```yaml
# Triggers on:
- Push to main branch (production)
- Push to develop branch (development)
- Manual workflow dispatch
```

### Branch Strategy

- **`main`** → Production deployment
- **`develop`** → Development/staging deployment
- **Feature branches** → No automatic deployment (manual testing only)

---

## Local Development Workflow

### 1. Setup Local Environment

```bash
# Navigate to project
cd "C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept\azure-functions"

# Install dependencies
npm install

# Copy local settings template
cp local.settings.example.json local.settings.json

# Edit local.settings.json with your credentials
```

### 2. Run Locally

```bash
# Start Azure Functions locally
func start

# Or use npm script
npm start
```

Your functions will be available at:
- `http://localhost:7071/api/webhooks/alto`
- `http://localhost:7071/api/organization/add`
- `http://localhost:7071/api/tds/create`
- etc.

### 3. Test Changes

```bash
# Test webhook endpoint
curl -X POST http://localhost:7071/api/webhooks/alto `
  -H "Content-Type: application/json" `
  -H "x-alto-webhook-signature: test" `
  -H "x-alto-webhook-timestamp: $(date +%s)000" `
  -d '{"data": {"tenancyId": "123"}}'
```

### 4. Commit and Push

```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat: Add validation for tenant email addresses"

# Push to trigger deployment
git push origin main
```

---

## Deployment Verification

### Check Deployment Status

**GitHub Actions**
1. Go to https://github.com/OLODHI-TDS/RapidInt/actions
2. View latest workflow run
3. Check for ✅ success or ❌ failure

**Azure Portal**
1. Go to Function App → **Deployment Center**
2. View deployment history
3. Check logs for any errors

### Test Deployed Functions

```bash
# Get Function App URL
$functionAppUrl = "https://tds-rapidint.azurewebsites.net"

# Test health endpoint
curl "$functionAppUrl/api/health"

# Expected response:
# {"status": "healthy", "timestamp": "2025-10-09T..."}
```

### View Logs

**Real-time streaming**
```bash
# Stream logs from Azure
az webapp log tail --name tds-rapidint --resource-group tds-rapidint-rg
```

**Application Insights** (recommended)
1. Go to Function App → **Application Insights**
2. View **Live Metrics** for real-time monitoring
3. Check **Logs** for historical data

---

## Environment Management

### Multiple Environments

Create separate Function Apps for each environment:

```
- tds-rapidint-dev     (develop branch)
- tds-rapidint-staging (staging branch)
- tds-rapidint-prod    (main branch)
```

Update `.github/workflows/azure-deploy.yml` to deploy to different apps based on branch.

### Environment-Specific Configuration

Store environment-specific settings in Azure Function App configuration (not in code):

**Development**
- Use TDS sandbox API
- Use test organization mappings
- Enable verbose logging

**Production**
- Use TDS production API
- Use real organization credentials
- Minimal logging (errors only)

---

## Rollback Procedures

### Rollback to Previous Version

**Option 1: Redeploy Previous Commit**
```bash
# Find previous working commit
git log --oneline

# Create rollback branch from that commit
git checkout -b rollback/previous-version <commit-hash>
git push origin rollback/previous-version

# Manually trigger deployment to that branch
```

**Option 2: Azure Portal Deployment Slots**
1. Use deployment slots for blue-green deployments
2. Deploy to staging slot first
3. Swap to production after testing
4. Rollback = swap back to previous slot

**Option 3: Revert Git Commit**
```bash
# Revert last commit
git revert HEAD
git push origin main

# CI/CD will automatically deploy the reverted version
```

---

## Troubleshooting

### Deployment Fails

**Check GitHub Actions logs**
1. Go to Actions tab
2. Click on failed workflow
3. Expand failed step
4. Review error messages

**Common issues:**
- Missing Azure secrets → Add `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
- Invalid publish profile → Re-download from Azure
- Node version mismatch → Ensure using Node.js 20

### Functions Not Working After Deployment

**Check Application Settings**
```bash
# List all settings
az functionapp config appsettings list --name tds-rapidint --resource-group tds-rapidint-rg
```

Ensure all required environment variables are set.

**Check Function App Logs**
```bash
# View recent logs
az webapp log show --name tds-rapidint --resource-group tds-rapidint-rg
```

### High Azure Costs

**Monitor consumption**
1. Go to **Cost Management + Billing**
2. View **Cost analysis**
3. Filter by Function App resource

**Optimize:**
- Review execution time (optimize slow functions)
- Check for infinite loops or retry storms
- Consider Premium plan for high-volume scenarios

---

## Security Best Practices

### Secrets Management

✅ **DO**
- Store secrets in Azure Key Vault
- Use Function App configuration for sensitive data
- Rotate API keys regularly
- Use managed identities where possible

❌ **DON'T**
- Commit secrets to Git
- Store secrets in code
- Share publish profiles publicly
- Use same credentials across environments

### Access Control

- Enable Azure AD authentication for Function App
- Use function-level authorization keys
- Implement IP restrictions if needed
- Enable Azure Front Door for DDoS protection

---

## Monitoring and Alerts

### Key Metrics to Monitor

1. **Function Execution Count** - Track usage
2. **Function Execution Time** - Identify slow functions
3. **Error Rate** - Detect issues early
4. **HTTP 5xx Errors** - Server errors
5. **Queue Depth** - Processing backlog

### Set Up Alerts

```bash
# Create alert for error rate > 5%
az monitor metrics alert create `
  --name "High Error Rate" `
  --resource-group tds-rapidint-rg `
  --scopes "/subscriptions/<sub-id>/resourceGroups/tds-rapidint-rg/providers/Microsoft.Web/sites/tds-rapidint" `
  --condition "avg Percentage of 5xx errors > 5" `
  --description "Alert when error rate exceeds 5%"
```

---

## Useful Commands

### Git Operations
```bash
# Check status
git status

# View commit history
git log --oneline --graph

# Create feature branch
git checkout -b feature/new-feature

# Merge feature branch
git checkout main
git merge feature/new-feature

# Push changes
git push origin main
```

### Azure CLI
```bash
# Function App status
az functionapp show --name tds-rapidint --resource-group tds-rapidint-rg

# Restart Function App
az functionapp restart --name tds-rapidint --resource-group tds-rapidint-rg

# View configuration
az functionapp config appsettings list --name tds-rapidint --resource-group tds-rapidint-rg
```

---

## Support

For issues or questions:
- **GitHub Issues**: https://github.com/OLODHI-TDS/RapidInt/issues
- **Internal Wiki**: [Link to internal documentation]
- **On-call Support**: [Contact details]

---

**Last Updated**: October 2025
**Version**: 1.0.0
