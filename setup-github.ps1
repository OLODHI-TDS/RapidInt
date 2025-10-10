# Setup GitHub Repository Script
# This script initializes git, commits files, and pushes to GitHub

param(
    [string]$GitHubRepo = "https://github.com/OLODHI-TDS/RapidInt.git"
)

Write-Host "🚀 Setting up TDS RapidInt for GitHub..." -ForegroundColor Cyan

# Check if git is installed
Write-Host "`n1️⃣ Checking Git installation..." -ForegroundColor Yellow
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git is not installed. Please install Git first." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Git found" -ForegroundColor Green

# Initialize git repository
Write-Host "`n2️⃣ Initializing Git repository..." -ForegroundColor Yellow
git init
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to initialize git repository" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Git initialized" -ForegroundColor Green

# Check for .gitignore
Write-Host "`n3️⃣ Checking .gitignore..." -ForegroundColor Yellow
if (Test-Path ".gitignore") {
    Write-Host "✅ .gitignore found" -ForegroundColor Green
} else {
    Write-Host "⚠️ .gitignore not found - creating one..." -ForegroundColor Yellow
    @"
node_modules/
local.settings.json
.env
*.log
__blobstorage__/
__queuestorage__/
node-v*.*/
"@ | Out-File -FilePath ".gitignore" -Encoding UTF8
    Write-Host "✅ .gitignore created" -ForegroundColor Green
}

# Add all files
Write-Host "`n4️⃣ Staging files..." -ForegroundColor Yellow
git add .
Write-Host "✅ Files staged" -ForegroundColor Green

# Show what will be committed
Write-Host "`n📋 Files to be committed:" -ForegroundColor Cyan
git status --short

# Commit
Write-Host "`n5️⃣ Creating initial commit..." -ForegroundColor Yellow
git commit -m "Initial commit: TDS RapidInt MVP

- Alto webhook integration
- TDS adapter with dual-mode (Legacy + Salesforce)
- Organization mapping management
- Audit logging
- Postcode lookup service
- Security audit documentation"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create commit" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Commit created" -ForegroundColor Green

# Set main branch
Write-Host "`n6️⃣ Setting main branch..." -ForegroundColor Yellow
git branch -M main
Write-Host "✅ Main branch set" -ForegroundColor Green

# Add remote
Write-Host "`n7️⃣ Adding GitHub remote..." -ForegroundColor Yellow
git remote add origin $GitHubRepo
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Remote might already exist, trying to set URL..." -ForegroundColor Yellow
    git remote set-url origin $GitHubRepo
}
Write-Host "✅ Remote added: $GitHubRepo" -ForegroundColor Green

# Push to GitHub
Write-Host "`n8️⃣ Pushing to GitHub..." -ForegroundColor Yellow
Write-Host "   This may prompt for GitHub authentication..." -ForegroundColor Gray
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to push to GitHub" -ForegroundColor Red
    Write-Host "`n⚠️ Common issues:" -ForegroundColor Yellow
    Write-Host "   - Not authenticated to GitHub (use gh auth login or git credential manager)" -ForegroundColor Gray
    Write-Host "   - Repository doesn't exist or is not accessible" -ForegroundColor Gray
    Write-Host "   - Branch protection rules preventing push" -ForegroundColor Gray
    exit 1
}

Write-Host "`n✅ Successfully pushed to GitHub!" -ForegroundColor Green

# Summary
Write-Host "`n📊 Setup Complete!" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Repository: $GitHubRepo" -ForegroundColor White
Write-Host "Branch: main" -ForegroundColor White
Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
Write-Host "   1. View your repository: https://github.com/OLODHI-TDS/RapidInt" -ForegroundColor Gray
Write-Host "   2. Set up Azure Function App (see DEPLOYMENT.md)" -ForegroundColor Gray
Write-Host "   3. Add GitHub Secret: AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -ForegroundColor Gray
Write-Host "   4. Configure Function App settings in Azure" -ForegroundColor Gray
Write-Host "   5. Push changes to trigger automatic deployment" -ForegroundColor Gray
Write-Host "`n💡 Quick Commands:" -ForegroundColor Yellow
Write-Host "   git status              - Check current status" -ForegroundColor Gray
Write-Host "   git add .               - Stage changes" -ForegroundColor Gray
Write-Host "   git commit -m 'msg'     - Commit changes" -ForegroundColor Gray
Write-Host "   git push                - Deploy to Azure via CI/CD" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
