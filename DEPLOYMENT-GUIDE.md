# Alto Jupix Integration - Deployment Guide

## Table of Contents
1. [Overview](#overview)
2. [Current State Assessment](#current-state-assessment)
3. [Deployment Prerequisites](#deployment-prerequisites)
4. [Manual Deployment to Azure](#manual-deployment-to-azure)
5. [GitHub Actions CI/CD Setup](#github-actions-cicd-setup)
6. [Configuration Management Strategies](#configuration-management-strategies)
7. [Post-Deployment Checklist](#post-deployment-checklist)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This guide covers deploying the Alto Jupix Integration system from local development to Azure production environment. The system is built on Azure Functions (Node.js 20) and uses Azure Table Storage for data persistence.

### Architecture Summary
- **Runtime**: Azure Functions v4, Node.js 20
- **Storage**: Azure Table Storage
- **External APIs**: Alto API, TDS Custodial API, postcodes.io
- **Monitoring**: Application Insights

---

## Current State Assessment

### ✅ What's Azure-Ready

| Component | Status | Notes |
|-----------|--------|-------|
| **Code Structure** | ✅ Production Ready | Standard Azure Functions v4 structure |
| **Dependencies** | ✅ All NPM packages | No local-only dependencies |
| **Configuration** | ✅ Environment variables | All config via `process.env.*` |
| **Storage** | ✅ Azure Native | Using `@azure/data-tables` |
| **APIs** | ✅ External HTTPS | No VPN/firewall dependencies |
| **File System** | ✅ No local writes | All data in Azure Storage |
| **Secrets** | ✅ App Settings ready | Can upgrade to Key Vault |
| **Monitoring** | ✅ App Insights ready | Already integrated |
| **Scaling** | ✅ Serverless | Auto-scales with Azure Functions |

### Key Features
- **11 Azure Functions** across workflow orchestration, webhooks, and management
- **Azure Table Storage** for pending integrations, audit logs, settings
- **Postcode validation** via live postcodes.io API (no static files)
- **Dual TDS API support** (Legacy v1.2 and Salesforce)
- **Multi-tenant/multi-landlord** support
- **Pending integration polling** for incomplete data

---

## Deployment Prerequisites

### Azure Resources Required

1. **Azure Subscription**
   - Access to create resources
   - Resource Group (e.g., `rg-alto-integration-prod`)

2. **Azure Storage Account**
   - Standard_LRS or Standard_GRS
   - Used for: Table Storage + Function App runtime
   - Tables auto-created on first run:
     - `IntegrationAudit`
     - `PendingIntegrations`
     - `IntegrationArchive`
     - `OrgMappingproduction` / `OrgMappingdevelopment`
     - `SettingsStorage`
     - `PollingSettings`

3. **Azure Function App**
   - Runtime: Node.js 20
   - OS: Windows or Linux
   - Plan: Consumption (for auto-scale) or Premium (for unlimited timeout)
   - Version: Azure Functions v4

4. **Application Insights**
   - For monitoring, logging, and telemetry

### Local Development Requirements

- **Node.js**: v20.x
- **NPM**: v9.x or higher
- **Azure Functions Core Tools**: v4
- **Azurite**: For local storage emulation
- **Git**: For version control

---

## Manual Deployment to Azure

### Step 1: Create Azure Resources

#### Option A: Azure Portal (GUI)

1. **Create Resource Group**
   - Portal → Resource Groups → Create
   - Name: `rg-alto-integration-prod`
   - Region: UK South (or your preferred region)

2. **Create Storage Account**
   - Portal → Storage Accounts → Create
   - Name: `staltointprod` (must be globally unique)
   - Performance: Standard
   - Replication: LRS or GRS
   - Resource Group: `rg-alto-integration-prod`

3. **Create Application Insights**
   - Portal → Application Insights → Create
   - Name: `ai-alto-integration-prod`
   - Resource Group: `rg-alto-integration-prod`
   - Copy the **Instrumentation Key**

4. **Create Function App**
   - Portal → Function App → Create
   - Name: `func-alto-integration-prod`
   - Runtime: Node.js
   - Version: 20 LTS
   - Region: UK South
   - Storage: Select `staltointprod`
   - Plan: Consumption (Y1) or Premium (EP1)
   - Application Insights: Enable, select `ai-alto-integration-prod`

#### Option B: Azure CLI (Command Line)

```bash
# Login
az login

# Set variables
RESOURCE_GROUP="rg-alto-integration-prod"
LOCATION="uksouth"
STORAGE_ACCOUNT="staltointprod"
FUNCTION_APP="func-alto-integration-prod"
APP_INSIGHTS="ai-alto-integration-prod"

# Create Resource Group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

# Create Storage Account
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# Create Application Insights
az monitor app-insights component create \
  --app $APP_INSIGHTS \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION

# Get instrumentation key
APPINSIGHTS_KEY=$(az monitor app-insights component show \
  --app $APP_INSIGHTS \
  --resource-group $RESOURCE_GROUP \
  --query instrumentationKey -o tsv)

# Create Function App (Consumption Plan)
az functionapp create \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --storage-account $STORAGE_ACCOUNT \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --os-type Windows \
  --app-insights $APP_INSIGHTS \
  --app-insights-key $APPINSIGHTS_KEY
```

### Step 2: Configure Application Settings

Copy settings from `azure-functions/local.settings.json` to Azure App Settings.

#### Via Azure Portal

1. Go to Function App → Configuration → Application Settings
2. Add each setting from the table below
3. Click Save

#### Via Azure CLI

```bash
az functionapp config appsettings set \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --settings \
    "NODE_ENV=production" \
    "FUNCTIONS_WORKER_RUNTIME=node" \
    "WEBSITE_NODE_DEFAULT_VERSION=~20" \
    "TDS_ACTIVE_PROVIDER=current" \
    "TDS_CURRENT_BASE_URL=https://api.custodial.tenancydepositscheme.com/v1.2" \
    "TDS_MEMBER_ID=YOUR_PROD_MEMBER_ID" \
    "TDS_BRANCH_ID=YOUR_PROD_BRANCH_ID" \
    "TDS_API_KEY=YOUR_PROD_API_KEY" \
    "ALTO_CLIENT_ID=YOUR_PROD_CLIENT_ID" \
    "ALTO_CLIENT_SECRET=YOUR_PROD_CLIENT_SECRET" \
    "ALTO_API_BASE_URL=https://api.alto.zoopla.co.uk" \
    "POSTCODE_CACHE_TTL_MINUTES=60" \
    "POSTCODE_MAX_BATCH_SIZE=100" \
    "LOG_LEVEL=info"
```

#### Application Settings Reference

| Setting | Development Value | Production Value | Notes |
|---------|------------------|------------------|-------|
| `NODE_ENV` | `development` | `production` | Environment identifier |
| `FUNCTIONS_WORKER_RUNTIME` | `node` | `node` | Required by Azure Functions |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~20` | `~20` | Node.js version |
| `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | Auto-populated | Storage connection string |
| `APPINSIGHTS_INSTRUMENTATIONKEY` | `local-dev-key` | Auto-populated | App Insights key |
| `TDS_ACTIVE_PROVIDER` | `current` | `current` or `salesforce` | TDS API provider |
| `TDS_CURRENT_BASE_URL` | `https://sandbox.api...` | `https://api.custodial...` | Production TDS URL |
| `TDS_MEMBER_ID` | `1960473` (sandbox) | `YOUR_PROD_MEMBER` | Production member ID |
| `TDS_BRANCH_ID` | `1960695` (sandbox) | `YOUR_PROD_BRANCH` | Production branch ID |
| `TDS_API_KEY` | `SJKFW-4782P-...` | `YOUR_PROD_KEY` | Production API key |
| `TDS_SALESFORCE_BASE_URL` | Salesforce dev URL | Salesforce prod URL | If using Salesforce provider |
| `ALTO_CLIENT_ID` | `d9kj85ukjp...` (dev) | `YOUR_PROD_CLIENT` | Production Alto client ID |
| `ALTO_CLIENT_SECRET` | Dev secret | Production secret | Production Alto secret |
| `ALTO_API_BASE_URL` | `https://api.alto.zoopladev.co.uk` | `https://api.alto.zoopla.co.uk` | Production Alto URL |
| `POSTCODE_CACHE_TTL_MINUTES` | `60` | `60` | Postcode cache duration |
| `POSTCODE_MAX_BATCH_SIZE` | `100` | `100` | Max postcodes per batch |
| `LOG_LEVEL` | `debug` | `info` | Logging verbosity |

### Step 3: Deploy Code

#### Option A: VS Code Azure Functions Extension

1. Install **Azure Functions** extension in VS Code
2. Sign in to Azure
3. Open `azure-functions` folder
4. Press `F1` → "Azure Functions: Deploy to Function App"
5. Select your Function App (`func-alto-integration-prod`)
6. Confirm deployment

#### Option B: Azure Functions Core Tools CLI

```bash
cd "C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept\azure-functions"

# Ensure dependencies are installed
npm ci

# Deploy to Azure
func azure functionapp publish func-alto-integration-prod
```

#### Option C: ZIP Deployment

```bash
# Package the function app
cd azure-functions
zip -r ../function-app.zip . -x "node_modules/*" -x ".git/*"

# Upload to Azure
az functionapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $FUNCTION_APP \
  --src ../function-app.zip
```

### Step 4: Verify Deployment

1. **Check Function App Status**
   ```bash
   az functionapp show \
     --name $FUNCTION_APP \
     --resource-group $RESOURCE_GROUP \
     --query state -o tsv
   # Should output: Running
   ```

2. **List Deployed Functions**
   ```bash
   az functionapp function list \
     --name $FUNCTION_APP \
     --resource-group $RESOURCE_GROUP \
     --query "[].name" -o tsv
   ```

   Expected functions:
   - AltoWebhook
   - AltoIntegration
   - WorkflowOrchestrator
   - TDSAdapter
   - PendingIntegrationsManager
   - PendingPollingService
   - OrganizationMapping
   - AltoSettings
   - TDSSettings
   - PollingSettings
   - IntegrationAuditLogger
   - PostcodeLookup

3. **Test Health Endpoint**
   ```bash
   curl https://func-alto-integration-prod.azurewebsites.net/api/health
   ```

4. **Check Application Insights**
   - Portal → Application Insights → Live Metrics
   - Should see live telemetry data

5. **Verify Table Storage**
   - Portal → Storage Account → Tables
   - Tables will be auto-created on first function execution

### Step 5: Configure CORS (for HTML Tools)

If using the HTML management tools:

```bash
az functionapp cors add \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --allowed-origins "https://yourdomain.com" "*"
```

Or via Portal:
1. Function App → CORS
2. Add allowed origins
3. Save

### Estimated Deployment Time

- **Azure Resource Creation**: 10-15 minutes
- **Configuration**: 10 minutes
- **Code Deployment**: 5 minutes
- **Testing & Verification**: 10 minutes

**Total**: ~40 minutes

---

## GitHub Actions CI/CD Setup

### Overview

Set up automated deployment pipeline:
- **Push to `main`** → Auto-deploy to Dev environment
- **Manual approval** → Deploy to Production environment

### Architecture

```
Local Development
   ↓ git push
GitHub Repository
   ↓ GitHub Actions (automatic)
   ├─→ Dev Environment (auto-deploy)
   │   └─ func-alto-integration-dev.azurewebsites.net
   └─→ Production Environment (manual approval)
       └─ func-alto-integration-prod.azurewebsites.net
```

### Step 1: Initialize Git Repository

```bash
cd "C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept"

# Initialize git
git init

# Create .gitignore
cat > .gitignore << 'EOF'
# Azure Functions
local.settings.json
*.user
*.suo
bin/
obj/

# Local development
__azurite_*.json
__blobstorage__/
__queuestorage__/
azurite/
node_modules/
.env
*.log

# OS
.DS_Store
Thumbs.db
nul

# IDE
.vscode/
.idea/
*.swp

# Node
npm-debug.log*
package-lock.json

# Sensitive data
config/local.json
config/local-*.json
EOF

# Initial commit
git add .
git commit -m "Initial commit - Alto Jupix Integration"
```

### Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `alto-jupix-integration`
3. Visibility: Private (recommended)
4. Do NOT initialize with README (you already have files)
5. Create repository

```bash
# Add GitHub remote
git remote add origin https://github.com/your-org/alto-jupix-integration.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Step 3: Create Azure Service Principal

GitHub Actions needs credentials to deploy to Azure.

```bash
# Login to Azure
az login

# Get your subscription ID
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# Get your resource group ID
RESOURCE_GROUP_ID=$(az group show \
  --name $RESOURCE_GROUP \
  --query id -o tsv)

# Create service principal with contributor role
az ad sp create-for-rbac \
  --name "github-alto-integration-deploy" \
  --role contributor \
  --scopes $RESOURCE_GROUP_ID \
  --sdk-auth

# 👆 IMPORTANT: Copy the entire JSON output
```

Output will look like:
```json
{
  "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "subscriptionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "activeDirectoryEndpointUrl": "https://login.microsoftonline.com",
  "resourceManagerEndpointUrl": "https://management.azure.com/",
  "activeDirectoryGraphResourceId": "https://graph.windows.net/",
  "sqlManagementEndpointUrl": "https://management.core.windows.net:8443/",
  "galleryEndpointUrl": "https://gallery.azure.com/",
  "managementEndpointUrl": "https://management.core.windows.net/"
}
```

**⚠️ Save this JSON - you'll need it in the next step!**

### Step 4: Configure GitHub Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these secrets:

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `AZURE_CREDENTIALS` | Entire JSON from Step 3 | Service principal credentials |
| `AZURE_FUNCTIONAPP_NAME_DEV` | `func-alto-integration-dev` | Dev Function App name |
| `AZURE_FUNCTIONAPP_NAME_PROD` | `func-alto-integration-prod` | Prod Function App name |
| `AZURE_RG_NAME` | `rg-alto-integration-prod` | Resource group name |
| `ALTO_CLIENT_ID_DEV` | `d9kj85ukjpr6634i4sae0g00s` | Dev Alto client ID |
| `ALTO_CLIENT_SECRET_DEV` | Dev secret | Dev Alto secret |
| `TDS_API_KEY_DEV` | `SJKFW-4782P-3D7DJ-ADDSD-3S78F` | Dev TDS API key |
| `ALTO_CLIENT_ID_PROD` | Production client ID | Prod Alto client ID |
| `ALTO_CLIENT_SECRET_PROD` | Production secret | Prod Alto secret |
| `TDS_API_KEY_PROD` | Production API key | Prod TDS API key |
| `TDS_MEMBER_ID_PROD` | Production member ID | Prod TDS member |
| `TDS_BRANCH_ID_PROD` | Production branch ID | Prod TDS branch |

### Step 5: Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Alto Integration to Azure

on:
  push:
    branches:
      - main          # Auto-deploy dev on every push to main
  pull_request:
    branches:
      - main
  workflow_dispatch:   # Allow manual deployment

env:
  AZURE_FUNCTIONAPP_PACKAGE_PATH: './azure-functions'
  NODE_VERSION: '20.x'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: 'Checkout code'
        uses: actions/checkout@v4

      - name: 'Setup Node.js ${{ env.NODE_VERSION }}'
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: 'Install dependencies'
        run: |
          cd ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          npm ci
          npm run build --if-present

      - name: 'Run tests'
        run: |
          cd ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          npm run test --if-present
        continue-on-error: true

      - name: 'Upload artifact for deployment'
        uses: actions/upload-artifact@v4
        with:
          name: function-app
          path: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}

  deploy-dev:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: 'Development'
      url: 'https://${{ secrets.AZURE_FUNCTIONAPP_NAME_DEV }}.azurewebsites.net'
    steps:
      - name: 'Download artifact'
        uses: actions/download-artifact@v4
        with:
          name: function-app
          path: ./function-app

      - name: 'Login to Azure'
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: 'Deploy to Azure Functions (Dev)'
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ secrets.AZURE_FUNCTIONAPP_NAME_DEV }}
          package: ./function-app

      - name: 'Update App Settings (Dev)'
        uses: azure/appservice-settings@v1
        with:
          app-name: ${{ secrets.AZURE_FUNCTIONAPP_NAME_DEV }}
          app-settings-json: |
            [
              {
                "name": "NODE_ENV",
                "value": "development"
              },
              {
                "name": "TDS_ACTIVE_PROVIDER",
                "value": "current"
              },
              {
                "name": "TDS_CURRENT_BASE_URL",
                "value": "https://sandbox.api.custodial.tenancydepositscheme.com/v1.2"
              },
              {
                "name": "TDS_MEMBER_ID",
                "value": "1960473"
              },
              {
                "name": "TDS_BRANCH_ID",
                "value": "1960695"
              },
              {
                "name": "TDS_API_KEY",
                "value": "${{ secrets.TDS_API_KEY_DEV }}"
              },
              {
                "name": "ALTO_CLIENT_ID",
                "value": "${{ secrets.ALTO_CLIENT_ID_DEV }}"
              },
              {
                "name": "ALTO_CLIENT_SECRET",
                "value": "${{ secrets.ALTO_CLIENT_SECRET_DEV }}"
              },
              {
                "name": "ALTO_API_BASE_URL",
                "value": "https://api.alto.zoopladev.co.uk"
              },
              {
                "name": "LOG_LEVEL",
                "value": "debug"
              }
            ]

      - name: 'Logout from Azure'
        run: az logout

  deploy-prod:
    runs-on: ubuntu-latest
    needs: deploy-dev
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment:
      name: 'Production'
      url: 'https://${{ secrets.AZURE_FUNCTIONAPP_NAME_PROD }}.azurewebsites.net'
    steps:
      - name: 'Download artifact'
        uses: actions/download-artifact@v4
        with:
          name: function-app
          path: ./function-app

      - name: 'Login to Azure'
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: 'Deploy to Azure Functions (Prod)'
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ secrets.AZURE_FUNCTIONAPP_NAME_PROD }}
          package: ./function-app

      - name: 'Update App Settings (Prod)'
        uses: azure/appservice-settings@v1
        with:
          app-name: ${{ secrets.AZURE_FUNCTIONAPP_NAME_PROD }}
          app-settings-json: |
            [
              {
                "name": "NODE_ENV",
                "value": "production"
              },
              {
                "name": "TDS_ACTIVE_PROVIDER",
                "value": "current"
              },
              {
                "name": "TDS_CURRENT_BASE_URL",
                "value": "https://api.custodial.tenancydepositscheme.com/v1.2"
              },
              {
                "name": "TDS_MEMBER_ID",
                "value": "${{ secrets.TDS_MEMBER_ID_PROD }}"
              },
              {
                "name": "TDS_BRANCH_ID",
                "value": "${{ secrets.TDS_BRANCH_ID_PROD }}"
              },
              {
                "name": "TDS_API_KEY",
                "value": "${{ secrets.TDS_API_KEY_PROD }}"
              },
              {
                "name": "ALTO_CLIENT_ID",
                "value": "${{ secrets.ALTO_CLIENT_ID_PROD }}"
              },
              {
                "name": "ALTO_CLIENT_SECRET",
                "value": "${{ secrets.ALTO_CLIENT_SECRET_PROD }}"
              },
              {
                "name": "ALTO_API_BASE_URL",
                "value": "https://api.alto.zoopla.co.uk"
              },
              {
                "name": "LOG_LEVEL",
                "value": "info"
              }
            ]

      - name: 'Logout from Azure'
        run: az logout
```

Commit and push:

```bash
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions deployment workflow"
git push origin main
```

### Step 6: Enable Production Approval Gate

1. Go to GitHub repository → **Settings** → **Environments**
2. Click on **Production** (create if doesn't exist)
3. Check **Required reviewers**
4. Add your GitHub username or team members
5. Save protection rules

Now production deployments will wait for manual approval!

### Step 7: Test the Pipeline

```bash
# Make a small change
echo "# Test deployment" >> README.md

# Commit and push
git add README.md
git commit -m "Test automated deployment"
git push origin main
```

View progress:
1. Go to GitHub repository → **Actions** tab
2. Click on the running workflow
3. See real-time logs for each job
4. When prompted, approve production deployment

### Your New Workflow

```
┌─────────────────┐
│ Local Dev       │
│ 1. Make changes │
│ 2. Test locally │
│ 3. git commit   │
│ 4. git push     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GitHub Actions  │
│ 1. Run tests    │
│ 2. Build code   │
│ 3. Deploy to Dev│ ← Automatic
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Approval Gate   │
│ Wait for human  │ ← Manual
│ approval        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Deploy to Prod  │
└─────────────────┘
```

### Rollback Strategy

**Option 1: Revert Commit**
```bash
git revert HEAD
git push origin main
# Triggers automatic redeployment of previous version
```

**Option 2: Redeploy Previous Version**
1. Go to GitHub → Actions
2. Find successful previous workflow run
3. Click "Re-run all jobs"

**Option 3: Manual Rollback via Azure Portal**
1. Function App → Deployment Center → Deployment History
2. Select previous deployment
3. Click "Redeploy"

---

## Configuration Management Strategies

### Strategy 1: Azure App Configuration + Key Vault (Recommended for Production)

**Best for**: Multi-developer teams, frequent config changes, audit requirements

#### Benefits
- ✅ Central configuration management
- ✅ No redeployment needed for config changes
- ✅ Secrets stored securely in Key Vault
- ✅ Environment-specific configs with labels
- ✅ Audit trail of all changes
- ✅ Feature flags capability

#### Setup

1. **Create Azure App Configuration**
   ```bash
   az appconfig create \
     --name appconfig-alto-integration \
     --resource-group $RESOURCE_GROUP \
     --location $LOCATION \
     --sku Standard
   ```

2. **Create Key Vault**
   ```bash
   az keyvault create \
     --name kv-alto-integration \
     --resource-group $RESOURCE_GROUP \
     --location $LOCATION
   ```

3. **Store Secrets in Key Vault**
   ```bash
   az keyvault secret set \
     --vault-name kv-alto-integration \
     --name "Alto-ClientSecret-Dev" \
     --value "your-dev-secret"

   az keyvault secret set \
     --vault-name kv-alto-integration \
     --name "Alto-ClientSecret-Prod" \
     --value "your-prod-secret"
   ```

4. **Add Settings to App Configuration**
   ```bash
   # Get connection string
   APP_CONFIG_CONN=$(az appconfig credential list \
     --name appconfig-alto-integration \
     --resource-group $RESOURCE_GROUP \
     --query "[0].connectionString" -o tsv)

   # Add dev settings
   az appconfig kv set \
     --connection-string "$APP_CONFIG_CONN" \
     --key "TDS:API:BaseUrl" \
     --value "https://sandbox.api.custodial.tenancydepositscheme.com/v1.2" \
     --label "development"

   # Add prod settings
   az appconfig kv set \
     --connection-string "$APP_CONFIG_CONN" \
     --key "TDS:API:BaseUrl" \
     --value "https://api.custodial.tenancydepositscheme.com/v1.2" \
     --label "production"
   ```

5. **Install Package**
   ```bash
   cd azure-functions
   npm install @azure/app-configuration
   ```

6. **Create Config Loader** (`azure-functions/src/shared/config.js`):
   ```javascript
   const { AppConfigurationClient } = require("@azure/app-configuration");
   const { DefaultAzureCredential } = require("@azure/identity");
   const { SecretClient } = require("@azure/keyvault-secrets");

   class ConfigurationManager {
       constructor() {
           this.cache = new Map();
           this.environment = process.env.NODE_ENV || 'development';

           if (process.env.APP_CONFIG_CONNECTION_STRING) {
               this.appConfigClient = new AppConfigurationClient(
                   process.env.APP_CONFIG_CONNECTION_STRING
               );
           }

           if (process.env.KEY_VAULT_URL) {
               this.secretClient = new SecretClient(
                   process.env.KEY_VAULT_URL,
                   new DefaultAzureCredential()
               );
           }
       }

       async get(key) {
           if (this.cache.has(key)) {
               return this.cache.get(key);
           }

           let value;

           if (this.appConfigClient) {
               try {
                   const setting = await this.appConfigClient.getConfigurationSetting({
                       key,
                       label: this.environment
                   });
                   value = setting.value;

                   if (value?.startsWith('@Microsoft.KeyVault')) {
                       const secretName = this.extractSecretName(value);
                       const secret = await this.secretClient.getSecret(secretName);
                       value = secret.value;
                   }
               } catch (error) {
                   console.warn(`Failed to load ${key}, falling back to env var`);
               }
           }

           if (!value) {
               value = process.env[key.replace(/:/g, '_').toUpperCase()];
           }

           this.cache.set(key, value);
           return value;
       }

       extractSecretName(keyVaultRef) {
           const match = keyVaultRef.match(/\/secrets\/([^/]+)/);
           return match ? match[1] : null;
       }
   }

   const config = new ConfigurationManager();
   module.exports = { config };
   ```

7. **Update Function App Settings**
   ```bash
   az functionapp config appsettings set \
     --name $FUNCTION_APP \
     --resource-group $RESOURCE_GROUP \
     --settings \
       "APP_CONFIG_CONNECTION_STRING=$APP_CONFIG_CONN" \
       "KEY_VAULT_URL=https://kv-alto-integration.vault.azure.net/"
   ```

8. **Usage in Functions**
   ```javascript
   // Before
   const clientId = process.env.ALTO_CLIENT_ID;

   // After
   const { config } = require('../shared/config');
   const clientId = await config.get('Alto:ClientId');
   ```

### Strategy 2: Environment-Specific Config Files (Medium Complexity)

**Best for**: Small teams, infrequent config changes

Create configuration files checked into git:

**`azure-functions/config/default.json`**:
```json
{
  "functions": {
    "timeout": "00:10:00"
  },
  "postcode": {
    "cacheTTL": 60,
    "maxBatchSize": 100
  }
}
```

**`azure-functions/config/development.json`**:
```json
{
  "alto": {
    "baseUrl": "https://api.alto.zoopladev.co.uk"
  },
  "tds": {
    "baseUrl": "https://sandbox.api.custodial.tenancydepositscheme.com/v1.2",
    "memberId": "1960473",
    "branchId": "1960695"
  }
}
```

**`azure-functions/config/production.json`**:
```json
{
  "alto": {
    "baseUrl": "https://api.alto.zoopla.co.uk"
  },
  "tds": {
    "baseUrl": "https://api.custodial.tenancydepositscheme.com/v1.2",
    "memberId": "PROD_MEMBER_ID",
    "branchId": "PROD_BRANCH_ID"
  }
}
```

Install package:
```bash
npm install config
```

Usage:
```javascript
const config = require('config');
const altoUrl = config.get('alto.baseUrl');
```

Secrets still use environment variables.

### Strategy 3: Simple - Shared Dev Environment (Simplest)

**Best for**: Single developer, getting started quickly

1. Create two Function Apps: `func-alto-integration-dev` and `func-alto-integration-prod`
2. Configure App Settings separately in Azure Portal
3. Local development uses `local.settings.json`
4. Deploy to appropriate environment based on branch

**Sync settings between environments**:
```bash
# Export dev settings
az functionapp config appsettings list \
  --name func-alto-integration-dev \
  --resource-group $RESOURCE_GROUP \
  --output json > dev-settings.json

# Review and edit for production
# Then import to prod
az functionapp config appsettings set \
  --name func-alto-integration-prod \
  --resource-group $RESOURCE_GROUP \
  --settings @prod-settings.json
```

### Recommendation

- **Start with**: Strategy 3 (Simple) - get to production quickly
- **Upgrade to**: Strategy 1 (App Configuration) when you have:
  - Multiple developers
  - Need to change settings without redeployment
  - Compliance/audit requirements
  - Feature flag needs

---

## Post-Deployment Checklist

### Immediate Post-Deployment

- [ ] **Verify Function App is running**
  ```bash
  az functionapp show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --query state
  ```

- [ ] **Test health endpoint**
  ```bash
  curl https://$FUNCTION_APP.azurewebsites.net/api/health
  ```

- [ ] **Verify all functions deployed**
  ```bash
  az functionapp function list --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
  ```

- [ ] **Check Application Insights**
  - Portal → App Insights → Live Metrics
  - Verify telemetry is flowing

- [ ] **Verify Table Storage**
  - Portal → Storage Account → Tables
  - Confirm tables are created (after first function run)

### Configuration Verification

- [ ] **Test Alto connection**
  ```bash
  curl https://$FUNCTION_APP.azurewebsites.net/api/alto/test
  ```

- [ ] **Test TDS connection**
  ```bash
  curl https://$FUNCTION_APP.azurewebsites.net/api/tds/health
  ```

- [ ] **Test postcode lookup**
  ```bash
  curl https://$FUNCTION_APP.azurewebsites.net/api/postcode/SW1A1AA
  ```

- [ ] **Verify organization mappings**
  ```bash
  curl https://$FUNCTION_APP.azurewebsites.net/api/organization/list
  ```

### Security Checks

- [ ] **Verify CORS settings**
  - Only allow necessary origins

- [ ] **Check authentication level**
  - Functions should be `function` level (not `anonymous`)

- [ ] **Verify Managed Identity** (if using Key Vault)
  ```bash
  az functionapp identity show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
  ```

- [ ] **Review App Settings for exposed secrets**
  - Ensure no secrets are logged or exposed

### Monitoring Setup

- [ ] **Configure alerts**
  - Function failures
  - High response times
  - Storage throttling

- [ ] **Set up availability tests**
  - Portal → App Insights → Availability
  - Add web test for health endpoint

- [ ] **Review logs**
  - Portal → App Insights → Logs
  - Check for errors or warnings

### Functional Testing

- [ ] **Test end-to-end workflow**
  1. Create test tenancy in Alto
  2. Verify webhook received
  3. Check deposit created in TDS
  4. Verify DAN returned
  5. Check audit log entry

- [ ] **Test pending integration flow**
  1. Create tenancy with missing data
  2. Verify appears in pending integrations
  3. Add missing data in Alto
  4. Trigger manual poll
  5. Verify completes successfully

- [ ] **Test multi-landlord/tenant scenario**
  - Create tenancy with 2+ landlords
  - Create tenancy with 2+ tenants
  - Verify all appear in TDS portal

### Performance Baseline

- [ ] **Record baseline metrics**
  - Average response time
  - P95/P99 latency
  - Function execution count
  - Error rate

- [ ] **Load test (optional)**
  ```bash
  # Simple load test with curl
  for i in {1..100}; do
    curl https://$FUNCTION_APP.azurewebsites.net/api/health &
  done
  wait
  ```

### Documentation

- [ ] **Update webhook URLs**
  - Provide production webhook URL to Alto team
  - Format: `https://$FUNCTION_APP.azurewebsites.net/api/webhook/alto`

- [ ] **Document production credentials**
  - Where they're stored (Key Vault, App Settings)
  - Who has access
  - Rotation schedule

- [ ] **Create runbook**
  - Common issues and resolutions
  - Escalation procedures
  - Contact information

### Backup & Recovery

- [ ] **Configure storage redundancy**
  - Verify GRS or RA-GRS for production

- [ ] **Document recovery procedures**
  - How to rollback deployment
  - How to restore from backup
  - RTO/RPO objectives

- [ ] **Test disaster recovery**
  - Delete and recreate tables (using backups)
  - Redeploy function app
  - Verify functionality

---

## Troubleshooting

### Common Issues

#### Issue: Function App won't start

**Symptoms**: Functions show as "stopped" or return 503 errors

**Causes**:
- Missing App Settings
- Invalid `AzureWebJobsStorage` connection string
- Node.js version mismatch

**Resolution**:
```bash
# Check function app status
az functionapp show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --query state

# Check app settings
az functionapp config appsettings list --name $FUNCTION_APP --resource-group $RESOURCE_GROUP

# Restart function app
az functionapp restart --name $FUNCTION_APP --resource-group $RESOURCE_GROUP

# Check logs
az functionapp log tail --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
```

#### Issue: Functions deploy but don't appear

**Symptoms**: Deployment succeeds but functions list is empty

**Causes**:
- `host.json` missing or invalid
- `package.json` missing dependencies
- Wrong `FUNCTIONS_WORKER_RUNTIME`

**Resolution**:
```bash
# Verify host.json exists
ls azure-functions/host.json

# Verify package.json
cat azure-functions/package.json | grep "@azure/functions"

# Check function runtime setting
az functionapp config appsettings list \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query "[?name=='FUNCTIONS_WORKER_RUNTIME'].value" -o tsv
# Should output: node
```

#### Issue: "Cannot find module" errors

**Symptoms**: Functions fail with module not found errors

**Causes**:
- `node_modules` not deployed
- Missing dependency in `package.json`

**Resolution**:
```bash
# Ensure dependencies installed before deploy
cd azure-functions
npm ci

# Redeploy
func azure functionapp publish $FUNCTION_APP

# Or use --build remote flag
func azure functionapp publish $FUNCTION_APP --build remote
```

#### Issue: Postcode lookup fails

**Symptoms**: 404 or timeout errors from postcodes.io

**Causes**:
- Invalid postcode format
- postcodes.io API down
- Network connectivity issue

**Resolution**:
```bash
# Test postcodes.io directly
curl https://api.postcodes.io/postcodes/SW1A1AA

# Check function logs
# Portal → Function App → Functions → PostcodeLookup → Monitor

# Verify no firewall blocking outbound HTTPS
```

#### Issue: Table Storage connection fails

**Symptoms**: "Table not found" or connection timeout errors

**Causes**:
- Invalid storage connection string
- Storage account firewall rules
- Missing Managed Identity permissions

**Resolution**:
```bash
# Verify connection string
az storage account show-connection-string \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP

# Check firewall rules
az storage account show \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --query networkRuleSet

# If using Managed Identity, grant permissions
az role assignment create \
  --role "Storage Table Data Contributor" \
  --assignee-object-id $(az functionapp identity show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --query principalId -o tsv) \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT
```

#### Issue: GitHub Actions deployment fails

**Symptoms**: Workflow fails at deployment step

**Common Causes & Resolutions**:

1. **Invalid Azure credentials**
   ```bash
   # Recreate service principal
   az ad sp create-for-rbac --name github-alto-deploy --role contributor --scopes <resource-group-id> --sdk-auth
   # Update AZURE_CREDENTIALS secret in GitHub
   ```

2. **Function App doesn't exist**
   ```bash
   # Verify function app exists
   az functionapp show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
   ```

3. **Missing GitHub secrets**
   - Go to repo Settings → Secrets
   - Verify all required secrets exist

4. **Artifact upload/download failure**
   - Check workflow logs for specific error
   - May need to increase artifact retention

### Debugging Tools

**Azure Portal**:
- Function App → Functions → [Function Name] → Monitor
- Application Insights → Live Metrics
- Application Insights → Failures
- Storage Account → Tables → Browse data

**Azure CLI**:
```bash
# Stream logs in real-time
az functionapp log tail --name $FUNCTION_APP --resource-group $RESOURCE_GROUP

# Get recent invocations
az functionapp function show --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --function-name AltoWebhook

# Check app service logs
az webapp log download --name $FUNCTION_APP --resource-group $RESOURCE_GROUP --log-file app-logs.zip
```

**Kudu (Advanced)**:
```
https://$FUNCTION_APP.scm.azurewebsites.net
```
- Debug console
- File system browser
- Process explorer

### Performance Optimization

**If experiencing slow performance**:

1. **Upgrade to Premium Plan**
   - Eliminates cold starts
   - Dedicated compute
   - Unlimited execution time

2. **Enable Application Insights Profiler**
   - Identify slow code paths
   - Portal → App Insights → Performance → Profiler

3. **Optimize Table Storage queries**
   - Add indexes where needed
   - Use PartitionKey and RowKey efficiently
   - Batch operations when possible

4. **Cache postcode lookups**
   - Already implemented with 5-min TTL
   - Consider increasing if high volume

5. **Review timeout settings**
   - `host.json` → `functionTimeout`
   - Default: 00:10:00 (Consumption plan limit)
   - Premium plan: unlimited

### Getting Help

**Azure Support**:
- Portal → Help + Support → New support request
- Include: Function App name, timestamp, error message

**Community Resources**:
- Azure Functions GitHub: https://github.com/Azure/azure-functions
- Stack Overflow: Tag `azure-functions`
- Microsoft Q&A: https://docs.microsoft.com/answers/topics/azure-functions.html

**Internal Escalation**:
- Check with team lead
- Review runbook documentation
- Contact Azure support if needed

---

## Appendix

### A. Complete Environment Variables List

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AzureWebJobsStorage` | Yes | N/A | Storage account connection string |
| `FUNCTIONS_WORKER_RUNTIME` | Yes | `node` | Runtime identifier |
| `WEBSITE_NODE_DEFAULT_VERSION` | Yes | `~20` | Node.js version |
| `NODE_ENV` | Yes | `development` | Environment (development/production) |
| `APPINSIGHTS_INSTRUMENTATIONKEY` | No | N/A | Application Insights key |
| `TDS_ACTIVE_PROVIDER` | Yes | `current` | TDS provider (current/salesforce) |
| `TDS_CURRENT_BASE_URL` | Yes | N/A | Legacy TDS API base URL |
| `TDS_MEMBER_ID` | Yes | N/A | TDS member ID |
| `TDS_BRANCH_ID` | Yes | N/A | TDS branch ID |
| `TDS_API_KEY` | Yes | N/A | TDS API key |
| `TDS_SALESFORCE_BASE_URL` | No | N/A | Salesforce TDS API base URL |
| `ALTO_CLIENT_ID` | Yes | N/A | Alto OAuth client ID |
| `ALTO_CLIENT_SECRET` | Yes | N/A | Alto OAuth client secret |
| `ALTO_API_BASE_URL` | Yes | N/A | Alto API base URL |
| `POSTCODE_CACHE_TTL_MINUTES` | No | `60` | Postcode cache duration |
| `POSTCODE_MAX_BATCH_SIZE` | No | `100` | Max postcodes per batch request |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |
| `FUNCTIONS_BASE_URL` | No | Auto | Function app base URL (for internal calls) |

### B. Azure Resources Pricing Estimate

**Monthly cost estimate (UK South region)**:

| Resource | SKU | Estimated Cost |
|----------|-----|----------------|
| Function App (Consumption) | Pay-per-execution | £10-50/month |
| Storage Account (Standard LRS) | Standard | £5-15/month |
| Application Insights | Basic | £10-30/month |
| **Total** | | **£25-95/month** |

**Notes**:
- Based on ~10,000 function executions/month
- 10GB storage usage
- Basic Application Insights tier
- Actual costs depend on usage volume

**Premium Plan** (if needed):
- EP1: ~£150/month
- Eliminates cold starts
- Unlimited timeout
- VNet integration

### C. Service Endpoints

**Production URLs** (replace `func-alto-integration-prod` with your Function App name):

| Endpoint | URL | Method | Description |
|----------|-----|--------|-------------|
| Health Check | `/api/health` | GET | System health status |
| Alto Webhook | `/api/webhook/alto` | POST | Webhook receiver |
| Alto Test | `/api/alto/test` | GET | Test Alto connection |
| Alto Fetch Tenancy | `/api/alto/fetch-tenancy/{id}` | POST | Fetch tenancy data |
| TDS Health | `/api/tds/health` | GET | TDS connection status |
| TDS Create | `/api/tds/create` | POST | Create deposit |
| Postcode Lookup | `/api/postcode/{postcode}` | GET | UK postcode validation |
| Org Mapping List | `/api/organization/list` | GET | List organization mappings |
| Org Mapping Lookup | `/api/organization/lookup` | GET | Lookup specific mapping |
| Pending List | `/api/pending/list` | GET | List pending integrations |
| Pending Retry | `/api/pending/retry/{id}` | POST | Retry pending integration |
| Settings Alto | `/api/settings/alto` | GET/POST | Alto settings management |
| Settings TDS | `/api/settings/tds` | GET/POST | TDS settings management |
| Polling Settings | `/api/settings/polling` | GET/POST | Polling configuration |

### D. Useful Azure CLI Commands

```bash
# List all functions in Function App
az functionapp function list \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query "[].{Name:name, Trigger:config.bindings[0].type}" -o table

# Get function app URL
az functionapp show \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query defaultHostName -o tsv

# Scale Function App (Premium plan only)
az functionapp plan update \
  --name <plan-name> \
  --resource-group $RESOURCE_GROUP \
  --number-of-workers 2

# View deployment history
az functionapp deployment list-publishing-profiles \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP

# Download application settings to file
az functionapp config appsettings list \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP > app-settings.json

# Upload application settings from file
az functionapp config appsettings set \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --settings @app-settings.json

# Enable/Disable function
az functionapp function update \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --function-name AltoWebhook \
  --set config.disabled=false
```

### E. Deployment Checklist Template

```markdown
## Pre-Deployment Checklist
- [ ] All tests passing locally
- [ ] Code reviewed and approved
- [ ] Environment variables documented
- [ ] Secrets stored securely
- [ ] Database migrations prepared (if any)
- [ ] Rollback plan documented
- [ ] Stakeholders notified

## Deployment Steps
- [ ] Create Azure resources
- [ ] Configure App Settings
- [ ] Deploy code
- [ ] Verify deployment
- [ ] Run smoke tests
- [ ] Monitor for errors

## Post-Deployment Validation
- [ ] All functions responding
- [ ] Health checks passing
- [ ] Integration tests successful
- [ ] Performance within baselines
- [ ] No errors in App Insights
- [ ] Stakeholders notified of completion

## Rollback (if needed)
- [ ] Trigger rollback procedure
- [ ] Verify previous version restored
- [ ] Notify stakeholders
- [ ] Document issues encountered
```

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-08 | Omar Lodhi | Initial deployment guide created |

---

**Document maintained by**: Omar Lodhi
**Last updated**: 2025-10-08
**Next review date**: When deploying to production
