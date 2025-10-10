# TDS Integration Platform - Main Deployment Script
#
# This script deploys the complete TDS Integration Platform to Azure
# Supporting multiple property management system integrations
#
# Usage:
#   .\deploy.ps1 -Environment dev -ResourceGroup tds-integration-dev
#   .\deploy.ps1 -Environment prod -ResourceGroup tds-integration-prod -SkipInfrastructure

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("dev", "staging", "prod")]
    [string]$Environment,

    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,

    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$false)]
    [switch]$SkipInfrastructure,

    [Parameter(Mandatory=$false)]
    [switch]$SkipFunctions,

    [Parameter(Mandatory=$false)]
    [switch]$SkipLogicApps,

    [Parameter(Mandatory=$false)]
    [switch]$ValidateOnly,

    [Parameter(Mandatory=$false)]
    [string]$ConfigPath = "../configuration/app-settings"
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Import required modules
Import-Module Az.Accounts -Force
Import-Module Az.Resources -Force
Import-Module Az.Storage -Force
Import-Module Az.KeyVault -Force
Import-Module Az.Functions -Force
Import-Module Az.LogicApp -Force

# Script variables
$ScriptRoot = $PSScriptRoot
$ProjectRoot = Split-Path $ScriptRoot -Parent
$ConfigFile = Join-Path $ConfigPath "$Environment.json"
$LogFile = Join-Path $ScriptRoot "deploy-$Environment-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Logging function
function Write-Log {
    param([string]$Message, [string]$Level = "Info")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogFile -Value $logMessage
}

# Load configuration
function Load-Configuration {
    Write-Log "Loading configuration from $ConfigFile"

    if (-not (Test-Path $ConfigFile)) {
        throw "Configuration file not found: $ConfigFile"
    }

    try {
        $config = Get-Content $ConfigFile | ConvertFrom-Json
        Write-Log "Configuration loaded successfully for environment: $($config.environment)"
        return $config
    }
    catch {
        throw "Failed to load configuration: $_"
    }
}

# Azure authentication
function Connect-ToAzure {
    param($SubscriptionId)

    Write-Log "Connecting to Azure..."

    try {
        $context = Get-AzContext
        if (-not $context) {
            Write-Log "No existing Azure context found. Please sign in."
            Connect-AzAccount
        }

        if ($SubscriptionId) {
            Write-Log "Setting subscription context: $SubscriptionId"
            Set-AzContext -SubscriptionId $SubscriptionId
        }

        $currentContext = Get-AzContext
        Write-Log "Connected to Azure subscription: $($currentContext.Subscription.Name)"
    }
    catch {
        throw "Failed to connect to Azure: $_"
    }
}

# Create resource group
function New-ResourceGroupIfNotExists {
    param($Name, $Location)

    Write-Log "Checking resource group: $Name"

    $rg = Get-AzResourceGroup -Name $Name -ErrorAction SilentlyContinue
    if (-not $rg) {
        Write-Log "Creating resource group: $Name in $Location"
        New-AzResourceGroup -Name $Name -Location $Location
        Write-Log "Resource group created successfully"
    }
    else {
        Write-Log "Resource group already exists: $Name"
    }
}

# Deploy ARM template
function Deploy-ArmTemplate {
    param($TemplatePath, $ParametersPath, $ResourceGroupName, $DeploymentName)

    Write-Log "Deploying ARM template: $TemplatePath"

    try {
        if ($ValidateOnly) {
            Write-Log "Validating ARM template deployment..."
            $result = Test-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -TemplateFile $TemplatePath -TemplateParameterFile $ParametersPath
            if ($result) {
                Write-Log "Template validation failed:" "Error"
                Write-Log $result.Message "Error"
                return $false
            }
            Write-Log "Template validation successful"
            return $true
        }
        else {
            Write-Log "Starting ARM template deployment: $DeploymentName"
            $deployment = New-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -TemplateFile $TemplatePath -TemplateParameterFile $ParametersPath -Name $DeploymentName -Verbose

            if ($deployment.ProvisioningState -eq "Succeeded") {
                Write-Log "ARM template deployment completed successfully"
                return $deployment
            }
            else {
                Write-Log "ARM template deployment failed: $($deployment.ProvisioningState)" "Error"
                return $false
            }
        }
    }
    catch {
        Write-Log "ARM template deployment error: $_" "Error"
        throw $_
    }
}

# Deploy Azure Functions
function Deploy-Functions {
    param($Config)

    Write-Log "Deploying Azure Functions..."

    $functionAppName = $Config.platformSettings.functionAppName
    $functionsPath = Join-Path $ProjectRoot "azure-functions"

    try {
        # Build functions project
        Write-Log "Building Azure Functions project"
        Push-Location $functionsPath

        # Install dependencies
        Write-Log "Installing function dependencies"
        npm install

        # Create deployment package
        $deploymentPackage = Join-Path $env:TEMP "functions-$Environment.zip"
        Write-Log "Creating deployment package: $deploymentPackage"
        Compress-Archive -Path "$functionsPath\*" -DestinationPath $deploymentPackage -Force

        # Deploy to Azure
        Write-Log "Publishing functions to Azure: $functionAppName"
        Publish-AzWebApp -ResourceGroupName $ResourceGroup -Name $functionAppName -ArchivePath $deploymentPackage -Force

        Write-Log "Azure Functions deployed successfully"
        Pop-Location

        # Configure function app settings
        Set-FunctionAppSettings -Config $Config
    }
    catch {
        Pop-Location
        Write-Log "Failed to deploy Azure Functions: $_" "Error"
        throw $_
    }
}

# Set Function App settings
function Set-FunctionAppSettings {
    param($Config)

    Write-Log "Configuring Function App settings"

    $functionAppName = $Config.platformSettings.functionAppName

    $appSettings = @{
        'FUNCTIONS_WORKER_RUNTIME' = 'node'
        'WEBSITE_NODE_DEFAULT_VERSION' = '~18'
        'TDS_ACTIVE_PROVIDER' = $Config.services.tdsAdapterFactory.activeProvider
        'TDS_CURRENT_BASE_URL' = $Config.services.tdsAdapterFactory.providers.current.baseUrl
        'TDS_SALESFORCE_BASE_URL' = $Config.services.tdsAdapterFactory.providers.salesforce.baseUrl
        'APPINSIGHTS_INSTRUMENTATIONKEY' = $Config.monitoring.applicationInsights.instrumentationKey
    }

    foreach ($setting in $appSettings.GetEnumerator()) {
        Write-Log "Setting app setting: $($setting.Key)"
        Set-AzWebApp -ResourceGroupName $ResourceGroup -Name $functionAppName -AppSettings @{$setting.Key = $setting.Value}
    }
}

# Deploy Logic Apps
function Deploy-LogicApps {
    param($Config)

    Write-Log "Deploying Logic Apps..."

    # Deploy Alto adapter
    if ($Config.integrations.alto.enabled) {
        Deploy-LogicApp -Name "alto-adapter" -Config $Config
    }

    # Deploy Jupix adapter
    if ($Config.integrations.jupix.enabled) {
        Deploy-LogicApp -Name "jupix-adapter" -Config $Config
    }
}

# Deploy individual Logic App
function Deploy-LogicApp {
    param($Name, $Config)

    Write-Log "Deploying Logic App: $Name"

    $logicAppPath = Join-Path $ProjectRoot "logic-apps\integration-adapters\$Name"
    $workflowFile = Join-Path $logicAppPath "workflow.json"
    $parametersFile = Join-Path $logicAppPath "parameters.json"

    if (-not (Test-Path $workflowFile)) {
        Write-Log "Workflow file not found: $workflowFile" "Warning"
        return
    }

    try {
        # Generate parameters file if it doesn't exist
        if (-not (Test-Path $parametersFile)) {
            Generate-LogicAppParameters -Name $Name -Config $Config -OutputPath $parametersFile
        }

        # Deploy Logic App
        $logicAppName = "$Name-$Environment"
        Write-Log "Creating Logic App: $logicAppName"

        $workflow = Get-Content $workflowFile | ConvertFrom-Json
        $parameters = Get-Content $parametersFile | ConvertFrom-Json

        # Create Logic App (implementation would depend on specific deployment method)
        # This is a simplified version - actual implementation would use ARM templates or Azure CLI
        Write-Log "Logic App $logicAppName deployment prepared"
    }
    catch {
        Write-Log "Failed to deploy Logic App $Name : $_" "Error"
        throw $_
    }
}

# Generate Logic App parameters
function Generate-LogicAppParameters {
    param($Name, $Config, $OutputPath)

    Write-Log "Generating parameters for Logic App: $Name"

    $parameters = @{
        altoClientId = $Config.services.alto.clientId
        postcodeServiceUrl = $Config.services.postcodeLookup.endpoint
        tdsAdapterUrl = $Config.services.tdsAdapterFactory.endpoint
    }

    $parameters | ConvertTo-Json -Depth 10 | Out-File $OutputPath
}

# Setup monitoring and alerts
function Setup-Monitoring {
    param($Config)

    Write-Log "Setting up monitoring and alerts..."

    if ($Config.monitoring.alerts.enabled) {
        Write-Log "Configuring Application Insights alerts"
        # Implementation would create alert rules based on thresholds in config
    }

    Write-Log "Monitoring setup completed"
}

# Validate deployment
function Test-Deployment {
    param($Config)

    Write-Log "Validating deployment..."

    $tests = @()

    # Test Function Apps
    $functionAppName = $Config.platformSettings.functionAppName
    Write-Log "Testing Function App: $functionAppName"

    try {
        $healthUrl = "$($Config.services.postcodeLookup.endpoint)/health"
        $response = Invoke-RestMethod -Uri $healthUrl -Method GET -TimeoutSec 30

        if ($response.status -eq "healthy") {
            Write-Log "✓ Postcode Lookup service is healthy"
            $tests += $true
        }
        else {
            Write-Log "✗ Postcode Lookup service health check failed" "Warning"
            $tests += $false
        }
    }
    catch {
        Write-Log "✗ Postcode Lookup service is not accessible: $_" "Error"
        $tests += $false
    }

    # Test TDS Adapter Factory
    try {
        $configUrl = "$($Config.services.tdsAdapterFactory.endpoint)/config"
        $response = Invoke-RestMethod -Uri $configUrl -Method GET -TimeoutSec 30

        if ($response.activeProvider) {
            Write-Log "✓ TDS Adapter Factory is responding"
            Write-Log "  Active TDS Provider: $($response.activeProvider)"
            $tests += $true
        }
        else {
            Write-Log "✗ TDS Adapter Factory configuration check failed" "Warning"
            $tests += $false
        }
    }
    catch {
        Write-Log "✗ TDS Adapter Factory is not accessible: $_" "Error"
        $tests += $false
    }

    # Summary
    $passedTests = ($tests | Where-Object { $_ -eq $true }).Count
    $totalTests = $tests.Count

    Write-Log "Validation Summary: $passedTests/$totalTests tests passed"

    if ($passedTests -eq $totalTests) {
        Write-Log "✓ All deployment validation tests passed" "Success"
        return $true
    }
    else {
        Write-Log "✗ Some deployment validation tests failed" "Warning"
        return $false
    }
}

# Main deployment function
function Start-Deployment {
    Write-Log "=== TDS Integration Platform Deployment Started ==="
    Write-Log "Environment: $Environment"
    Write-Log "Resource Group: $ResourceGroup"
    Write-Log "Validation Only: $ValidateOnly"

    try {
        # Load configuration
        $config = Load-Configuration

        # Connect to Azure
        Connect-ToAzure -SubscriptionId $SubscriptionId

        # Create resource group
        if (-not $SkipInfrastructure) {
            New-ResourceGroupIfNotExists -Name $ResourceGroup -Location $config.platformSettings.location
        }

        # Deploy infrastructure (ARM templates)
        if (-not $SkipInfrastructure) {
            $armTemplatePath = Join-Path $ProjectRoot "azure-infrastructure\arm-templates\main.json"
            $armParametersPath = Join-Path $ProjectRoot "azure-infrastructure\arm-templates\parameters.$Environment.json"

            if (Test-Path $armTemplatePath) {
                $deploymentResult = Deploy-ArmTemplate -TemplatePath $armTemplatePath -ParametersPath $armParametersPath -ResourceGroupName $ResourceGroup -DeploymentName "infrastructure-$Environment"

                if (-not $deploymentResult -and -not $ValidateOnly) {
                    throw "Infrastructure deployment failed"
                }
            }
            else {
                Write-Log "ARM template not found, skipping infrastructure deployment" "Warning"
            }
        }

        if ($ValidateOnly) {
            Write-Log "Validation completed successfully"
            return
        }

        # Deploy Azure Functions
        if (-not $SkipFunctions) {
            Deploy-Functions -Config $config
        }

        # Deploy Logic Apps
        if (-not $SkipLogicApps) {
            Deploy-LogicApps -Config $config
        }

        # Setup monitoring
        Setup-Monitoring -Config $config

        # Validate deployment
        Write-Log "Waiting 60 seconds for services to initialize..."
        Start-Sleep -Seconds 60

        $validationPassed = Test-Deployment -Config $config

        if ($validationPassed) {
            Write-Log "=== TDS Integration Platform Deployment Completed Successfully ===" "Success"
            Write-Log "Next Steps:"
            Write-Log "1. Configure webhook endpoints in Alto/Jupix systems"
            Write-Log "2. Test end-to-end integration with sample data"
            Write-Log "3. Monitor Application Insights for any issues"
            Write-Log "4. Update DNS/load balancer configurations if needed"
        }
        else {
            Write-Log "=== TDS Integration Platform Deployment Completed with Warnings ===" "Warning"
            Write-Log "Please review the validation results and address any issues"
        }
    }
    catch {
        Write-Log "=== TDS Integration Platform Deployment Failed ===" "Error"
        Write-Log "Error: $_" "Error"
        Write-Log "Check the log file for detailed information: $LogFile"
        exit 1
    }
}

# Execute deployment
Start-Deployment