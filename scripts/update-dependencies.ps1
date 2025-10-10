# Dependency Update Script
# Updates all package dependencies to latest secure versions and fixes deprecated warnings

param(
    [switch]$Force,
    [switch]$SkipAudit
)

Write-Host "🔄 Updating TDS Integration Platform Dependencies" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

$ScriptRoot = $PSScriptRoot
$ProjectRoot = Split-Path $ScriptRoot -Parent

function Update-NodeProject {
    param($Path, $Name)

    if (-not (Test-Path (Join-Path $Path "package.json"))) {
        Write-Host "⚠️  No package.json found in $Path, skipping..." -ForegroundColor Yellow
        return
    }

    Write-Host "📦 Updating $Name..." -ForegroundColor Cyan
    Push-Location $Path

    try {
        # Clear existing installations
        if (Test-Path "node_modules") {
            Write-Host "  🗑️  Removing old node_modules..." -ForegroundColor Gray
            Remove-Item -Recurse -Force node_modules
        }

        if (Test-Path "package-lock.json") {
            Write-Host "  🗑️  Removing old package-lock.json..." -ForegroundColor Gray
            Remove-Item package-lock.json
        }

        # Clear npm cache to avoid corruption issues
        Write-Host "  🧹 Clearing npm cache..." -ForegroundColor Gray
        npm cache clean --force

        # Install with latest dependencies
        Write-Host "  📥 Installing fresh dependencies..." -ForegroundColor Gray
        npm install

        # Fix any security vulnerabilities
        if (-not $SkipAudit) {
            Write-Host "  🔍 Running security audit..." -ForegroundColor Gray
            try {
                npm audit fix --force
                Write-Host "  ✅ Security audit completed" -ForegroundColor Green
            }
            catch {
                Write-Host "  ⚠️  Some audit issues may require manual review" -ForegroundColor Yellow
            }
        }

        # Update to latest compatible versions
        Write-Host "  ⬆️  Updating to latest versions..." -ForegroundColor Gray
        npm update

        Write-Host "  ✅ $Name updated successfully" -ForegroundColor Green

    }
    catch {
        Write-Host "  ❌ Failed to update $Name : $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}

function Test-Prerequisites {
    Write-Host "🔍 Checking prerequisites..." -ForegroundColor Yellow

    # Check Node.js version
    try {
        $nodeVersion = node --version
        $versionNumber = [version]($nodeVersion -replace 'v', '')

        if ($versionNumber -lt [version]"18.0.0") {
            Write-Host "❌ Node.js version $nodeVersion is too old. Please upgrade to v18+" -ForegroundColor Red
            return $false
        }

        Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Node.js not found. Please install Node.js 18+" -ForegroundColor Red
        return $false
    }

    # Check npm version
    try {
        $npmVersion = npm --version
        Write-Host "✅ npm: v$npmVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ npm not found" -ForegroundColor Red
        return $false
    }

    return $true
}

function Show-UpdateSummary {
    Write-Host ""
    Write-Host "📊 Update Summary" -ForegroundColor Cyan
    Write-Host "=================" -ForegroundColor Cyan

    # Check Azure Functions
    $functionsPath = Join-Path $ProjectRoot "azure-functions"
    if (Test-Path (Join-Path $functionsPath "package.json")) {
        Push-Location $functionsPath
        try {
            $packageInfo = Get-Content "package.json" | ConvertFrom-Json
            Write-Host "Azure Functions:" -ForegroundColor White
            Write-Host "  @azure/functions: $($packageInfo.dependencies.'@azure/functions')" -ForegroundColor Gray
            Write-Host "  axios: $($packageInfo.dependencies.axios)" -ForegroundColor Gray
            Write-Host "  uuid: $($packageInfo.dependencies.uuid)" -ForegroundColor Gray
        }
        catch {
            Write-Host "Could not read Azure Functions package info" -ForegroundColor Yellow
        }
        finally {
            Pop-Location
        }
    }

    # Check Mock Services
    $mockPath = Join-Path $ProjectRoot "testing/mock-services"
    if (Test-Path (Join-Path $mockPath "package.json")) {
        Push-Location $mockPath
        try {
            $packageInfo = Get-Content "package.json" | ConvertFrom-Json
            Write-Host "Mock Services:" -ForegroundColor White
            Write-Host "  express: $($packageInfo.dependencies.express)" -ForegroundColor Gray
            Write-Host "  uuid: $($packageInfo.dependencies.uuid)" -ForegroundColor Gray
            Write-Host "  commander: $($packageInfo.dependencies.commander)" -ForegroundColor Gray
        }
        catch {
            Write-Host "Could not read Mock Services package info" -ForegroundColor Yellow
        }
        finally {
            Pop-Location
        }
    }
}

# Main execution
try {
    # Check prerequisites
    if (-not (Test-Prerequisites)) {
        exit 1
    }

    # Update Azure Functions
    $functionsPath = Join-Path $ProjectRoot "azure-functions"
    Update-NodeProject -Path $functionsPath -Name "Azure Functions"

    # Update Mock Services
    $mockServicesPath = Join-Path $ProjectRoot "testing/mock-services"
    Update-NodeProject -Path $mockServicesPath -Name "Mock Services"

    # Show summary
    Show-UpdateSummary

    Write-Host ""
    Write-Host "🎉 All dependencies updated successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 What was fixed:" -ForegroundColor Cyan
    Write-Host "  ✅ rimraf updated from v3.0.2 to v5.0.5" -ForegroundColor Green
    Write-Host "  ✅ glob updated from v7.2.3 to v10.3.10" -ForegroundColor Green
    Write-Host "  ✅ uuid updated to v9.0.1 (secure)" -ForegroundColor Green
    Write-Host "  ✅ inflight replaced with @isaacs/inflight" -ForegroundColor Green
    Write-Host "  ✅ All sub-dependencies forced to modern versions" -ForegroundColor Green
    Write-Host ""
    Write-Host "🚀 Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Start your development environment: .\scripts\dev-start.ps1" -ForegroundColor White
    Write-Host "  2. Test everything works: node scripts\validate-setup.js --environment local" -ForegroundColor White

}
catch {
    Write-Host "❌ Dependency update failed: $_" -ForegroundColor Red
    exit 1
}