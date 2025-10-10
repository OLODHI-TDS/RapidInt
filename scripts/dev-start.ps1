# Local Development Environment Startup Script
# Starts all required services for local development

param(
    [switch]$SkipStorage,
    [switch]$SkipFunctions,
    [int]$FunctionsPort = 7071
)

Write-Host "🚀 Starting TDS Integration Platform - Local Development Environment" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green

$ScriptRoot = $PSScriptRoot
$ProjectRoot = Split-Path $ScriptRoot -Parent

# Function to check if port is available
function Test-Port {
    param([int]$Port)
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

# Function to start process in new window
function Start-ProcessInNewWindow {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowTitle)

    Start-Process -FilePath "powershell" -ArgumentList @(
        "-NoExit",
        "-Command",
        "& { Set-Location '$WorkingDirectory'; $Host.UI.RawUI.WindowTitle = '$WindowTitle'; & '$FilePath' $ArgumentList }"
    )
}

try {
    # Check prerequisites
    Write-Host "🔍 Checking prerequisites..." -ForegroundColor Yellow

    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Node.js not found. Please install Node.js 18+" -ForegroundColor Red
        exit 1
    }

    # Check Azure Functions Core Tools
    try {
        $funcVersion = func --version
        Write-Host "✅ Azure Functions Core Tools: $funcVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Azure Functions Core Tools not found. Please install: npm install -g azure-functions-core-tools@4" -ForegroundColor Red
        exit 1
    }

    # Start Azurite (Storage Emulator)
    if (-not $SkipStorage) {
        Write-Host "📦 Starting Azurite (Storage Emulator)..." -ForegroundColor Yellow

        $azuriteDir = Join-Path $ProjectRoot "local-storage"
        if (-not (Test-Path $azuriteDir)) {
            New-Item -ItemType Directory -Path $azuriteDir -Force | Out-Null
        }

        try {
            # Check if Azurite is installed
            azurite --version | Out-Null

            # Start Azurite in background
            $azuriteArgs = @(
                "--silent",
                "--location", $azuriteDir,
                "--blobHost", "127.0.0.1",
                "--blobPort", "10000",
                "--queueHost", "127.0.0.1",
                "--queuePort", "10001",
                "--tableHost", "127.0.0.1",
                "--tablePort", "10002"
            )

            Start-ProcessInNewWindow -FilePath "azurite" -ArgumentList $azuriteArgs -WorkingDirectory $azuriteDir -WindowTitle "Azurite Storage Emulator"

            # Wait for Azurite to start
            Start-Sleep -Seconds 3
            Write-Host "✅ Azurite started on ports 10000 (blob), 10001 (queue), 10002 (table)" -ForegroundColor Green
        }
        catch {
            Write-Host "⚠️  Azurite not found. Install with: npm install -g azurite" -ForegroundColor Yellow
            Write-Host "   Continuing without local storage emulator..." -ForegroundColor Yellow
        }
    }

    # Start Azure Functions
    if (-not $SkipFunctions) {
        Write-Host "⚡ Starting Azure Functions..." -ForegroundColor Yellow

        # Check if port is available
        if (-not (Test-Port -Port $FunctionsPort)) {
            Write-Host "❌ Port $FunctionsPort is already in use" -ForegroundColor Red
            exit 1
        }

        $functionsDir = Join-Path $ProjectRoot "azure-functions"

        # Install dependencies if needed
        $packageJsonPath = Join-Path $functionsDir "package.json"
        $nodeModulesPath = Join-Path $functionsDir "node_modules"

        if ((Test-Path $packageJsonPath) -and -not (Test-Path $nodeModulesPath)) {
            Write-Host "📦 Installing Azure Functions dependencies..." -ForegroundColor Yellow
            Push-Location $functionsDir
            npm install
            Pop-Location
        }

        # Start Functions in new window
        $funcArgs = @("start", "--port", $FunctionsPort, "--cors", "*")
        Start-ProcessInNewWindow -FilePath "func" -ArgumentList $funcArgs -WorkingDirectory $functionsDir -WindowTitle "Azure Functions Local Runtime"

        # Wait for Functions to start
        Start-Sleep -Seconds 5

        # Test Functions endpoint
        try {
            $healthResponse = Invoke-RestMethod -Uri "http://localhost:$FunctionsPort/api/postcode/health" -TimeoutSec 10
            Write-Host "✅ Azure Functions started on http://localhost:$FunctionsPort" -ForegroundColor Green
        }
        catch {
            Write-Host "⚠️  Azure Functions may still be starting..." -ForegroundColor Yellow
        }
    }

    # Display local endpoints
    Write-Host ""
    Write-Host "🌐 Local Development Endpoints:" -ForegroundColor Cyan
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host "Azure Functions:    http://localhost:$FunctionsPort" -ForegroundColor White
    Write-Host "  - Postcode API:   http://localhost:$FunctionsPort/api/postcode" -ForegroundColor Gray
    Write-Host "  - TDS Adapter:    http://localhost:$FunctionsPort/api/tds" -ForegroundColor Gray
    Write-Host "  - Health Check:   http://localhost:$FunctionsPort/api/postcode/health" -ForegroundColor Gray

    if (-not $SkipStorage) {
        Write-Host "Azurite Storage:    http://127.0.0.1:10000 (blob), 10001 (queue), 10002 (table)" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "🧪 Test Commands:" -ForegroundColor Cyan
    Write-Host "=================" -ForegroundColor Cyan
    Write-Host "Test Postcode Lookup:" -ForegroundColor White
    Write-Host "  curl http://localhost:$FunctionsPort/api/postcode/MK18%207ET" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Test TDS Config:" -ForegroundColor White
    Write-Host "  curl http://localhost:$FunctionsPort/api/tds/config" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Run Validation:" -ForegroundColor White
    Write-Host "  node scripts/validate-setup.js --environment local" -ForegroundColor Gray

    Write-Host ""
    Write-Host "✅ Local development environment started successfully!" -ForegroundColor Green
    Write-Host "Press Ctrl+C in each window to stop services" -ForegroundColor Yellow

}
catch {
    Write-Host "❌ Failed to start local development environment: $_" -ForegroundColor Red
    exit 1
}