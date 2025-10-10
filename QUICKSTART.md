# Quick Start Guide

## Get Your Project on GitHub in 5 Minutes

### Step 1: Initialize Git and Push to GitHub

Run the setup script:

```powershell
cd "C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept"
.\setup-github.ps1
```

This will:
- Initialize git repository
- Create initial commit
- Push to https://github.com/OLODHI-TDS/RapidInt

### Step 2: Create Azure Function App

**Quick Option - Azure Portal:**
1. Go to https://portal.azure.com
2. Create Resource → Function App
3. Settings:
   - Name: `tds-rapidint` (or your choice)
   - Runtime: Node.js 20
   - Region: UK South
4. Click **Create**

### Step 3: Get Deployment Credentials

```bash
# Download publish profile from Azure Portal
# Function App → Overview → "Get publish profile"
```

### Step 4: Add GitHub Secret

1. Go to https://github.com/OLODHI-TDS/RapidInt/settings/secrets/actions
2. Click **New repository secret**
3. Name: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
4. Value: Paste contents of publish profile
5. Click **Add secret**

### Step 5: Update Workflow File

Edit `.github/workflows/azure-deploy.yml`:
```yaml
env:
  AZURE_FUNCTIONAPP_NAME: 'tds-rapidint'  # ← Change to YOUR function app name
```

### Step 6: Configure Azure Function App Settings

In Azure Portal → Function App → Configuration, add:

**Required Settings:**
```
TDS_ACTIVE_PROVIDER = auto
TDS_API_KEY = [your-legacy-key]
TDS_MEMBER_ID = [your-member-id]
TDS_BRANCH_ID = [your-branch-id]
SALESFORCE_CLIENT_ID = [your-oauth-id]
SALESFORCE_CLIENT_SECRET = [your-oauth-secret]
ALTO_CLIENT_ID = [your-alto-id]
ALTO_CLIENT_SECRET = [your-alto-secret]
NODE_ENV = production
```

Click **Save** after adding settings.

### Step 7: Deploy!

```bash
# Make any change to trigger deployment
git add .
git commit -m "chore: Configure for deployment"
git push
```

Watch deployment at: https://github.com/OLODHI-TDS/RapidInt/actions

### Step 8: Verify Deployment

```bash
# Test your deployed function
curl https://YOUR-FUNCTION-APP.azurewebsites.net/api/health
```

Expected response:
```json
{"status": "healthy", "timestamp": "2025-10-09T..."}
```

## Daily Development Workflow

```bash
# 1. Make changes locally
code .

# 2. Test locally
cd azure-functions
npm start

# 3. Commit and push
git add .
git commit -m "feat: Your change description"
git push

# 4. Deployment happens automatically via GitHub Actions!
```

## Troubleshooting

**Push failed?**
```bash
# Authenticate with GitHub
gh auth login
# Or use GitHub Desktop
```

**Deployment failed?**
- Check GitHub Actions: https://github.com/OLODHI-TDS/RapidInt/actions
- Verify Azure secrets are set correctly
- Check Function App name matches in workflow

**Functions not working?**
- Verify environment variables in Azure Function App Configuration
- Check Application Insights logs
- Test with Postman/curl

## Need Help?

- 📖 Full guide: See [DEPLOYMENT.md](DEPLOYMENT.md)
- 🐛 Issues: Open at https://github.com/OLODHI-TDS/RapidInt/issues
- 📧 Contact: omar.lodhi@thedisputeservice.co.uk

---

**You're ready to go! 🚀**
