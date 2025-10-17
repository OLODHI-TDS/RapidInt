# GitHub Actions Deployment Setup Guide

This guide explains how to set up automated deployments from GitHub to Azure Functions using GitHub Actions.

## Overview

The `deploy-dev.yml` workflow automatically deploys the Azure Functions to your Dev environment whenever you push to the `dev` branch.

## Prerequisites

- Azure Function App created in Azure Portal
- GitHub repository with admin access
- Azure CLI (optional, for getting publish profile)

## Setup Steps

### 1. Get Azure Function App Publish Profile

#### Option A: Using Azure Portal (Recommended)
1. Go to the Azure Portal: https://portal.azure.com
2. Navigate to your Function App: **rapidintdev-d0ccheegc3anfedn**
3. Click **"Get publish profile"** in the Overview section
4. Download the `.PublishSettings` file
5. Open the file in a text editor and copy all the contents

#### Option B: Using Azure CLI
```bash
az functionapp deployment list-publishing-profiles \
  --name rapidintdev-d0ccheegc3anfedn \
  --resource-group <your-resource-group> \
  --xml
```

### 2. Add GitHub Secret

1. Go to your GitHub repository: https://github.com/OLODHI-TDS/RapidInt
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE_DEV`
5. Value: Paste the entire contents of the publish profile XML
6. Click **"Add secret"**

### 3. Create GitHub Environment (Optional but Recommended)

GitHub Environments provide additional protection and visibility:

1. Go to **Settings** → **Environments**
2. Click **"New environment"**
3. Name: `Development`
4. Configure protection rules (optional):
   - ✅ Required reviewers (if you want approval before deployment)
   - ✅ Wait timer (delay before deployment)
   - ✅ Deployment branches (restrict to `dev` branch only)
5. Click **"Save protection rules"**

### 4. Update Workflow Configuration (if needed)

Edit `.github/workflows/deploy-dev.yml` if your Azure Function App name is different:

```yaml
env:
  AZURE_FUNCTIONAPP_NAME: 'your-function-app-name' # Update this
```

### 5. Create and Push to Dev Branch

```bash
# Create dev branch from main
git checkout -b dev

# Push to GitHub
git push -u origin dev
```

## How It Works

### Workflow Triggers

The workflow runs automatically when:
- ✅ Code is pushed to the `dev` branch
- ✅ You manually trigger it from GitHub Actions tab

### Deployment Process

1. **Checkout Code** - Downloads the repository code
2. **Setup Node.js** - Installs Node.js 18.x
3. **Install Dependencies** - Runs `npm ci --production` in azure-functions folder
4. **Deploy to Azure** - Uses Azure Functions Action to deploy
5. **Summary** - Shows deployment details in GitHub UI

### Deployment Time

Typical deployment takes **2-5 minutes**:
- Checkout & Setup: ~30 seconds
- Install Dependencies: ~1-2 minutes
- Deploy to Azure: ~1-2 minutes

## Monitoring Deployments

### View Workflow Runs

1. Go to **Actions** tab in GitHub
2. Click on the workflow run to see details
3. View logs for each step

### Verify Deployment

After deployment completes:

1. **Check Azure Portal**
   - Functions → Your Function App → Functions
   - Verify functions are updated

2. **Test API Endpoints**
   ```bash
   # Health check
   curl https://rapidintdev-d0ccheegc3anfedn.uksouth-01.azurewebsites.net/api/health
   ```

3. **Check Application Insights**
   - Monitor → Application Insights
   - View logs and metrics

## Deployment Environments

| Environment | Branch | Function App Name | URL |
|-------------|--------|-------------------|-----|
| Development | `dev` | rapidintdev-d0ccheegc3anfedn | https://rapidintdev-d0ccheegc3anfedn.uksouth-01.azurewebsites.net |
| Production | `main` | *(To be configured)* | *(To be configured)* |

## Troubleshooting

### Deployment Failed

**Error: "No such host is known"**
- Check that `AZURE_FUNCTIONAPP_NAME` matches your Function App name
- Verify the Function App exists in Azure Portal

**Error: "Invalid publish profile"**
- Regenerate the publish profile from Azure Portal
- Update the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE_DEV` secret

**Error: "npm ci failed"**
- Check package.json for correct dependencies
- Ensure package-lock.json is committed to repository

### Deployment Stuck

If deployment hangs:
1. Cancel the workflow run
2. Check Azure Portal → Function App → Deployment Center
3. Try manual trigger from GitHub Actions tab

## Security Best Practices

### Secrets Management

- ✅ **Never commit** publish profiles or secrets to repository
- ✅ **Use GitHub Secrets** for all sensitive data
- ✅ **Rotate secrets** periodically (every 90 days recommended)
- ✅ **Limit access** to repository secrets (Settings → Secrets → Configure)

### Environment Protection

For production deployments:
- ✅ Require approval before deployment
- ✅ Limit deployment to specific branches only
- ✅ Enable deployment protection rules

## Advanced Configuration

### Add Staging Environment

Create `.github/workflows/deploy-staging.yml`:

```yaml
name: Deploy to Azure (Staging)

on:
  push:
    branches:
      - staging

env:
  AZURE_FUNCTIONAPP_NAME: 'your-staging-app-name'
  # ... rest of config
```

### Add Production Deployment

Create `.github/workflows/deploy-prod.yml` with:
- Trigger on `main` branch
- Require manual approval
- Additional testing steps

### Add Pre-Deployment Tests

Add this step before deployment:

```yaml
- name: 'Run Tests'
  shell: bash
  run: |
    pushd './${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}'
    npm ci
    npm test
    popd
```

## Support

For issues or questions:
- Check GitHub Actions logs
- Review Azure Function App logs in Azure Portal
- Contact: omar.lodhi@tdsgroup.uk

## References

- [Azure Functions Action](https://github.com/Azure/functions-action)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Azure Functions Deployment](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-github-actions)
