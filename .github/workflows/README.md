# GitHub Actions Workflows

This directory contains automated CI/CD workflows for the TDS RapidInt Platform.

## Available Workflows

### 🚀 deploy-dev.yml
**Purpose:** Automatically deploy to Development environment
**Triggers:** Push to `dev` branch, Manual trigger
**Environment:** Development
**Function App:** rapidintdev-d0ccheegc3anfedn

## Quick Start

1. **First Time Setup**
   - Read the [Deployment Setup Guide](../DEPLOYMENT_SETUP.md)
   - Configure GitHub secrets
   - Create `dev` branch

2. **Deploy to Dev**
   ```bash
   git checkout dev
   git merge main
   git push origin dev
   ```

3. **Monitor Deployment**
   - Go to **Actions** tab in GitHub
   - Click on the running workflow
   - View deployment logs

## Workflow Status

| Workflow | Status | Last Deploy |
|----------|--------|-------------|
| Deploy to Dev | ![Status](https://img.shields.io/badge/status-ready-brightgreen) | - |

## Adding New Workflows

To add a new workflow (e.g., Production deployment):

1. Copy `deploy-dev.yml` to a new file
2. Update the environment name and Function App name
3. Add the new publish profile secret to GitHub
4. Update this README

## Need Help?

- 📖 Read the [Deployment Setup Guide](../DEPLOYMENT_SETUP.md)
- 🔍 Check the [GitHub Actions Documentation](https://docs.github.com/en/actions)
- 💬 Contact: omar.lodhi@tdsgroup.uk
