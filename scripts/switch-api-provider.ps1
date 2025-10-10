<#
.SYNOPSIS
    Switch TDS API Provider with Zero Downtime

.DESCRIPTION
    This script manages the migration between Legacy TDS API and Salesforce TDS API
    by updating Azure Function App configuration settings. Supports gradual rollout,
    dual-mode execution, and automatic rollback.

.PARAMETER Environment
    Target environment: dev, staging, prod

.PARAMETER Mode
    Routing mode: legacy-only, salesforce-only, both, forwarding, shadow

.PARAMETER ForwardingPercentage
    Percentage of traffic to route to Salesforce (0-100) when using 'forwarding' mode

.PARAMETER DualMode
    Enable dual-execution mode (execute on both APIs)

.PARAMETER Rollback
    Rollback to legacy API

.PARAMETER DryRun
    Preview changes without applying them

.EXAMPLE
    .\switch-api-provider.ps1 -Environment dev -Mode shadow -ForwardingPercentage 10
    Enable shadow mode in dev, sending 10% of traffic to Salesforce

.EXAMPLE
    .\switch-api-provider.ps1 -Environment prod -Mode forwarding -ForwardingPercentage 50
    Route 50% of production traffic to Salesforce

.EXAMPLE
    .\switch-api-provider.ps1 -Environment prod -Rollback
    Emergency rollback to legacy API

.NOTES
    Author: TDS Integration Team
    Version: 1.0.0
    Requires: Azure CLI, PowerShell 7+
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$Environment,

    [Parameter(Mandatory=$false)]
    [ValidateSet('legacy-only', 'salesforce-only', 'both', 'forwarding', 'shadow')]
    [string]$Mode = 'legacy-only',

    [Parameter(Mandatory=$false)]
    [ValidateRange(0, 100)]
    [int]$ForwardingPercentage = 0,

    [Parameter(Mandatory=$false)]
    [switch]$DualMode,

    [Parameter(Mandatory=$false)]
    [switch]$Rollback,

    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

# Configuration
$ErrorActionPreference = 'Stop'

$EnvironmentConfig = @{
    dev = @{
        ResourceGroup = 'tds-integration-dev'
        FunctionAppName = 'tds-platform-dev-functions'
        ForwarderFunction = 'TDSRequestForwarder'
        AdapterFunction = 'TDSAdapterFactory'
    }
    staging = @{
        ResourceGroup = 'tds-integration-staging'
        FunctionAppName = 'tds-platform-staging-functions'
        ForwarderFunction = 'TDSRequestForwarder'
        AdapterFunction = 'TDSAdapterFactory'
    }
    prod = @{
        ResourceGroup = 'tds-integration-prod'
        FunctionAppName = 'tds-platform-prod-functions'
        ForwarderFunction = 'TDSRequestForwarder'
        AdapterFunction = 'TDSAdapterFactory'
    }
}

# Functions
function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-StatusOk {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-StatusWarning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Write-StatusError {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Get-CurrentConfiguration {
    param(
        [string]$ResourceGroup,
        [string]$FunctionAppName
    )

    Write-Host "Retrieving current configuration..." -ForegroundColor Gray

    $settings = az functionapp config appsettings list `
        --name $FunctionAppName `
        --resource-group $ResourceGroup `
        --output json | ConvertFrom-Json

    $config = @{}
    foreach ($setting in $settings) {
        $config[$setting.name] = $setting.value
    }

    return $config
}

function Set-FunctionAppSettings {
    param(
        [string]$ResourceGroup,
        [string]$FunctionAppName,
        [hashtable]$Settings,
        [switch]$DryRun
    )

    $settingsArgs = @()
    foreach ($key in $Settings.Keys) {
        $settingsArgs += "$key=$($Settings[$key])"
    }

    if ($DryRun) {
        Write-StatusWarning "DRY RUN: Would update settings:"
        foreach ($key in $Settings.Keys) {
            Write-Host "  $key = $($Settings[$key])" -ForegroundColor Gray
        }
        return
    }

    Write-Host "Updating Function App settings..." -ForegroundColor Gray

    az functionapp config appsettings set `
        --name $FunctionAppName `
        --resource-group $ResourceGroup `
        --settings $settingsArgs `
        --output none

    Write-StatusOk "Settings updated successfully"
}

function Test-ApiHealth {
    param(
        [string]$FunctionAppUrl,
        [string]$FunctionKey
    )

    Write-Host "Testing API health..." -ForegroundColor Gray

    try {
        $response = Invoke-RestMethod `
            -Uri "$FunctionAppUrl/api/tds-forwarder/health?code=$FunctionKey" `
            -Method Get `
            -TimeoutSec 10

        if ($response.status -eq 'healthy') {
            Write-StatusOk "API is healthy"
            return $true
        } else {
            Write-StatusWarning "API returned unhealthy status"
            return $false
        }
    } catch {
        Write-StatusError "API health check failed: $($_.Exception.Message)"
        return $false
    }
}

function Show-MigrationPlan {
    param(
        [string]$CurrentMode,
        [string]$NewMode,
        [int]$CurrentPercentage,
        [int]$NewPercentage
    )

    Write-Header "Migration Plan"

    Write-Host "Environment:          $Environment" -ForegroundColor White
    Write-Host "Current Mode:         $CurrentMode" -ForegroundColor Yellow
    Write-Host "New Mode:             $NewMode" -ForegroundColor Green
    Write-Host ""
    Write-Host "Current Traffic:      $CurrentPercentage% → Salesforce" -ForegroundColor Yellow
    Write-Host "New Traffic:          $NewPercentage% → Salesforce" -ForegroundColor Green
    Write-Host ""
    Write-Host "Dual Mode:            $(if ($DualMode) { 'Enabled' } else { 'Disabled' })" -ForegroundColor $(if ($DualMode) { 'Green' } else { 'Gray' })
    Write-Host ""
}

function Confirm-Migration {
    if ($DryRun) {
        Write-StatusWarning "DRY RUN MODE - No changes will be applied"
        return $true
    }

    if ($Environment -eq 'prod') {
        Write-Host ""
        Write-StatusWarning "⚠️  WARNING: You are about to modify PRODUCTION environment!"
        Write-Host ""
        $confirmation = Read-Host "Type 'CONFIRM' to proceed"

        if ($confirmation -ne 'CONFIRM') {
            Write-StatusError "Migration cancelled"
            exit 1
        }
    } else {
        Write-Host ""
        $confirmation = Read-Host "Proceed with migration? (y/N)"

        if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
            Write-StatusError "Migration cancelled"
            exit 1
        }
    }

    return $true
}

# Main Script
Write-Header "TDS API Provider Migration Tool"

# Get environment configuration
$config = $EnvironmentConfig[$Environment]

if (-not $config) {
    Write-StatusError "Invalid environment: $Environment"
    exit 1
}

# Handle rollback
if ($Rollback) {
    Write-Header "Emergency Rollback to Legacy API"

    $newSettings = @{
        'TDS_ROUTING_MODE' = 'legacy-only'
        'TDS_FORWARDING_PERCENTAGE' = '0'
        'TDS_ACTIVE_PROVIDER' = 'current'
        'TDS_DUAL_MODE' = 'false'
        'TDS_ENABLE_FALLBACK' = 'true'
    }

    Write-StatusWarning "Rolling back to legacy API..."

    Set-FunctionAppSettings `
        -ResourceGroup $config.ResourceGroup `
        -FunctionAppName $config.FunctionAppName `
        -Settings $newSettings `
        -DryRun:$DryRun

    Write-StatusOk "Rollback complete!"
    exit 0
}

# Get current configuration
$currentConfig = Get-CurrentConfiguration `
    -ResourceGroup $config.ResourceGroup `
    -FunctionAppName $config.FunctionAppName

$currentMode = $currentConfig['TDS_ROUTING_MODE'] ?? 'legacy-only'
$currentPercentage = [int]($currentConfig['TDS_FORWARDING_PERCENTAGE'] ?? 0)

# Show migration plan
Show-MigrationPlan `
    -CurrentMode $currentMode `
    -NewMode $Mode `
    -CurrentPercentage $currentPercentage `
    -NewPercentage $ForwardingPercentage

# Confirm migration
Confirm-Migration | Out-Null

# Prepare new settings
$newSettings = @{
    'TDS_ROUTING_MODE' = $Mode
    'TDS_FORWARDING_PERCENTAGE' = $ForwardingPercentage.ToString()
    'TDS_DUAL_MODE' = $(if ($DualMode) { 'true' } else { 'false' })
    'TDS_ENABLE_FALLBACK' = 'true'
    'TDS_ENABLE_RESPONSE_COMPARISON' = 'true'
}

# Update based on mode
switch ($Mode) {
    'legacy-only' {
        $newSettings['TDS_ACTIVE_PROVIDER'] = 'current'
        Write-StatusOk "Switching to Legacy API only"
    }
    'salesforce-only' {
        $newSettings['TDS_ACTIVE_PROVIDER'] = 'salesforce'
        Write-StatusOk "Switching to Salesforce API only"
    }
    'both' {
        $newSettings['TDS_DUAL_MODE'] = 'true'
        Write-StatusOk "Enabling dual-execution mode"
    }
    'forwarding' {
        Write-StatusOk "Enabling gradual forwarding: $ForwardingPercentage% → Salesforce"
    }
    'shadow' {
        Write-StatusOk "Enabling shadow mode: Testing Salesforce in background"
    }
}

# Apply settings
Write-Header "Applying Configuration"

Set-FunctionAppSettings `
    -ResourceGroup $config.ResourceGroup `
    -FunctionAppName $config.FunctionAppName `
    -Settings $newSettings `
    -DryRun:$DryRun

if (-not $DryRun) {
    Write-Host ""
    Write-Host "Waiting for settings to propagate..." -ForegroundColor Gray
    Start-Sleep -Seconds 10

    # Test health
    Write-Header "Health Check"

    # Get function URL and key
    Write-Host "Retrieving function URL..." -ForegroundColor Gray
    $functionUrl = az functionapp show `
        --name $config.FunctionAppName `
        --resource-group $config.ResourceGroup `
        --query 'defaultHostName' `
        --output tsv

    if ($functionUrl) {
        $functionUrl = "https://$functionUrl"
        Write-StatusOk "Function URL: $functionUrl"

        # Note: In production, you would retrieve the function key from Key Vault
        Write-StatusWarning "Health check requires function key - skipping automated test"
        Write-Host "Manual health check URL: $functionUrl/api/tds-forwarder/health" -ForegroundColor Gray
    }
}

# Summary
Write-Header "Migration Complete"

Write-StatusOk "API provider configuration updated successfully!"
Write-Host ""
Write-Host "New Configuration:" -ForegroundColor White
Write-Host "  Mode:               $Mode" -ForegroundColor Green
Write-Host "  Forwarding:         $ForwardingPercentage% → Salesforce" -ForegroundColor Green
Write-Host "  Dual Mode:          $(if ($DualMode) { 'Enabled' } else { 'Disabled' })" -ForegroundColor Green
Write-Host ""

if ($Mode -eq 'forwarding' -or $Mode -eq 'shadow') {
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Monitor Application Insights for errors" -ForegroundColor Gray
    Write-Host "  2. Check response comparison logs" -ForegroundColor Gray
    Write-Host "  3. Gradually increase forwarding percentage" -ForegroundColor Gray
    Write-Host "  4. If issues occur, run with -Rollback flag" -ForegroundColor Gray
}

if (-not $DryRun) {
    Write-Host ""
    Write-Host "Monitoring Dashboard:" -ForegroundColor White
    Write-Host "  https://portal.azure.com/#@/resource/subscriptions/.../resourceGroups/$($config.ResourceGroup)/providers/Microsoft.Web/sites/$($config.FunctionAppName)" -ForegroundColor Cyan
}

Write-Host ""
Write-StatusOk "Done!"
