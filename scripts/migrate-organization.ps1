<#
.SYNOPSIS
    Organization Migration Orchestrator for TDS API Provider

.DESCRIPTION
    This script orchestrates the migration of an organization from Legacy TDS API to
    Salesforce TDS API. It enables dual-mode execution, monitors performance and accuracy,
    generates migration readiness reports, and automates the final migration decision.

.PARAMETER AgencyRef
    Alto agency reference (required) - identifies the organization to migrate

.PARAMETER MonitoringDays
    Number of days to monitor in dual-mode before evaluating migration (default: 7)

.PARAMETER SuccessThreshold
    Minimum success rate percentage required for auto-migration (default: 99.0)

.PARAMETER MaxDifferenceThreshold
    Maximum acceptable percentage of requests with differences (default: 1.0)

.PARAMETER PerformanceThreshold
    Maximum acceptable average response time in milliseconds (default: 3000)

.PARAMETER AutoMigrate
    If set, automatically migrate if thresholds are met without confirmation

.PARAMETER SkipMonitoring
    Skip enabling dual-mode and go straight to evaluation (assumes already in dual-mode)

.PARAMETER Rollback
    Rollback organization to Legacy API only

.PARAMETER DatabaseServer
    SQL Server connection string or server name

.PARAMETER DatabaseName
    Database name (default: TDSIntegration)

.PARAMETER GenerateReportOnly
    Generate migration readiness report without making any changes

.EXAMPLE
    .\migrate-organization.ps1 -AgencyRef "1af89d60-662c-475b-bcc8-9bcbf04b6322"
    Enable dual-mode for the organization and monitor for 7 days

.EXAMPLE
    .\migrate-organization.ps1 -AgencyRef "1af89d60-662c-475b-bcc8-9bcbf04b6322" -MonitoringDays 14 -AutoMigrate
    Enable dual-mode, monitor for 14 days, and auto-migrate if thresholds are met

.EXAMPLE
    .\migrate-organization.ps1 -AgencyRef "1af89d60-662c-475b-bcc8-9bcbf04b6322" -GenerateReportOnly
    Generate migration readiness report without making changes

.EXAMPLE
    .\migrate-organization.ps1 -AgencyRef "1af89d60-662c-475b-bcc8-9bcbf04b6322" -Rollback
    Emergency rollback to Legacy API

.NOTES
    Author: TDS Integration Team
    Version: 1.0.0
    Requires: PowerShell 7+, SQL Server module
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$AgencyRef,

    [Parameter(Mandatory=$false)]
    [ValidateRange(1, 90)]
    [int]$MonitoringDays = 7,

    [Parameter(Mandatory=$false)]
    [ValidateRange(0, 100)]
    [double]$SuccessThreshold = 99.0,

    [Parameter(Mandatory=$false)]
    [ValidateRange(0, 100)]
    [double]$MaxDifferenceThreshold = 1.0,

    [Parameter(Mandatory=$false)]
    [ValidateRange(100, 30000)]
    [int]$PerformanceThreshold = 3000,

    [Parameter(Mandatory=$false)]
    [switch]$AutoMigrate,

    [Parameter(Mandatory=$false)]
    [switch]$SkipMonitoring,

    [Parameter(Mandatory=$false)]
    [switch]$Rollback,

    [Parameter(Mandatory=$false)]
    [string]$DatabaseServer = "localhost",

    [Parameter(Mandatory=$false)]
    [string]$DatabaseName = "TDSIntegration",

    [Parameter(Mandatory=$false)]
    [switch]$GenerateReportOnly
)

# Configuration
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Import SQL Server module
try {
    Import-Module SqlServer -ErrorAction Stop
} catch {
    Write-Warning "SqlServer module not found. Attempting to install..."
    Install-Module -Name SqlServer -Scope CurrentUser -Force -AllowClobber
    Import-Module SqlServer
}

# =============================================
# Helper Functions
# =============================================

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

function Write-StatusInfo {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Cyan
}

function Get-DatabaseConnection {
    return "Server=$DatabaseServer;Database=$DatabaseName;Integrated Security=True;TrustServerCertificate=True"
}

function Get-OrganizationInfo {
    param([string]$AgencyRef)

    $query = @"
SELECT TOP 1
    id,
    alto_agency_ref,
    alto_branch_id,
    organization_name,
    tds_provider_preference,
    is_active,
    created_at,
    updated_at
FROM organization_mappings
WHERE alto_agency_ref = @AgencyRef
"@

    $params = @{ AgencyRef = $AgencyRef }
    $result = Invoke-Sqlcmd -ConnectionString (Get-DatabaseConnection) -Query $query -Variable $params

    if (-not $result) {
        throw "Organization with agency ref '$AgencyRef' not found in database"
    }

    return $result
}

function Enable-DualMode {
    param([string]$AgencyRef)

    Write-StatusInfo "Enabling dual-mode for organization: $AgencyRef"

    $query = @"
UPDATE organization_mappings
SET
    tds_provider_preference = 'auto',
    updated_at = GETUTCDATE(),
    updated_by = 'MigrationOrchestrator'
WHERE alto_agency_ref = @AgencyRef
"@

    $params = @{ AgencyRef = $AgencyRef }
    Invoke-Sqlcmd -ConnectionString (Get-DatabaseConnection) -Query $query -Variable $params

    Write-StatusOk "Dual-mode enabled successfully"
}

function Set-OrganizationProvider {
    param(
        [string]$AgencyRef,
        [ValidateSet('current', 'salesforce', 'auto')]
        [string]$Provider
    )

    $query = @"
UPDATE organization_mappings
SET
    tds_provider_preference = @Provider,
    updated_at = GETUTCDATE(),
    updated_by = 'MigrationOrchestrator'
WHERE alto_agency_ref = @AgencyRef
"@

    $params = @{
        AgencyRef = $AgencyRef
        Provider = $Provider
    }

    Invoke-Sqlcmd -ConnectionString (Get-DatabaseConnection) -Query $query -Variable $params
}

function Get-ComparisonMetrics {
    param(
        [string]$AgencyRef,
        [int]$Days
    )

    Write-StatusInfo "Querying comparison metrics for the last $Days days..."

    # Note: This assumes a comparison_log table exists
    # If it doesn't exist yet, this will need to be adjusted based on actual schema
    $query = @"
WITH org_batches AS (
    SELECT
        bt.id,
        bt.batch_id,
        bt.execution_mode,
        bt.current_status,
        bt.request_duration_ms,
        bt.provider_response_time_ms,
        bt.dual_mode_results,
        bt.created_at,
        bt.error_details
    FROM batch_tracking bt
    INNER JOIN organization_mappings om ON bt.organization_id = om.id
    WHERE om.alto_agency_ref = @AgencyRef
        AND bt.created_at >= DATEADD(DAY, -@Days, GETUTCDATE())
        AND bt.execution_mode IN ('dual', 'shadow')
)
SELECT
    COUNT(*) AS total_requests,
    COUNT(CASE WHEN current_status = 'created' THEN 1 END) AS successful_requests,
    COUNT(CASE WHEN current_status = 'failed' THEN 1 END) AS failed_requests,
    COUNT(CASE WHEN dual_mode_results IS NOT NULL AND dual_mode_results LIKE '%"hasDifferences":true%' THEN 1 END) AS requests_with_differences,
    AVG(CAST(request_duration_ms AS FLOAT)) AS avg_request_duration_ms,
    AVG(CAST(provider_response_time_ms AS FLOAT)) AS avg_provider_response_time_ms,
    MAX(request_duration_ms) AS max_request_duration_ms,
    MIN(created_at) AS first_request_time,
    MAX(created_at) AS last_request_time
FROM org_batches
"@

    $params = @{
        AgencyRef = $AgencyRef
        Days = $Days
    }

    try {
        $result = Invoke-Sqlcmd -ConnectionString (Get-DatabaseConnection) -Query $query -Variable $params
        return $result
    } catch {
        Write-StatusWarning "Could not query comparison metrics: $_"
        # Return empty metrics if table doesn't exist
        return @{
            total_requests = 0
            successful_requests = 0
            failed_requests = 0
            requests_with_differences = 0
            avg_request_duration_ms = 0
            avg_provider_response_time_ms = 0
            max_request_duration_ms = 0
        }
    }
}

function Get-MigrationReadinessScore {
    param($Metrics)

    if ($Metrics.total_requests -eq 0) {
        return @{
            Score = 0
            Grade = "N/A"
            Ready = $false
            Reason = "No dual-mode data available"
        }
    }

    $successRate = ($Metrics.successful_requests / $Metrics.total_requests) * 100
    $differenceRate = ($Metrics.requests_with_differences / $Metrics.total_requests) * 100
    $avgResponseTime = $Metrics.avg_provider_response_time_ms

    # Calculate weighted score (0-100)
    $successScore = [Math]::Min($successRate, 100) * 0.5
    $differenceScore = [Math]::Max(0, 100 - ($differenceRate * 10)) * 0.3
    $performanceScore = [Math]::Max(0, 100 - (($avgResponseTime / 50))) * 0.2

    $totalScore = [Math]::Round($successScore + $differenceScore + $performanceScore, 2)

    # Determine grade
    $grade = switch ($totalScore) {
        {$_ -ge 95} { "A+" }
        {$_ -ge 90} { "A" }
        {$_ -ge 85} { "B+" }
        {$_ -ge 80} { "B" }
        {$_ -ge 75} { "C+" }
        {$_ -ge 70} { "C" }
        default { "D" }
    }

    # Check if ready for migration
    $ready = (
        $successRate -ge $SuccessThreshold -and
        $differenceRate -le $MaxDifferenceThreshold -and
        $avgResponseTime -le $PerformanceThreshold
    )

    $reason = if (-not $ready) {
        $reasons = @()
        if ($successRate -lt $SuccessThreshold) {
            $reasons += "Success rate ($([Math]::Round($successRate, 2))%) below threshold ($SuccessThreshold%)"
        }
        if ($differenceRate -gt $MaxDifferenceThreshold) {
            $reasons += "Difference rate ($([Math]::Round($differenceRate, 2))%) above threshold ($MaxDifferenceThreshold%)"
        }
        if ($avgResponseTime -gt $PerformanceThreshold) {
            $reasons += "Avg response time ($([Math]::Round($avgResponseTime, 0))ms) above threshold ($($PerformanceThreshold)ms)"
        }
        $reasons -join "; "
    } else {
        "All thresholds met"
    }

    return @{
        Score = $totalScore
        Grade = $grade
        Ready = $ready
        Reason = $reason
        SuccessRate = [Math]::Round($successRate, 2)
        DifferenceRate = [Math]::Round($differenceRate, 2)
        AvgResponseTime = [Math]::Round($avgResponseTime, 0)
    }
}

function Show-MigrationReport {
    param(
        $OrgInfo,
        $Metrics,
        $Readiness
    )

    Write-Header "Migration Readiness Report"

    Write-Host "Organization Information:" -ForegroundColor White
    Write-Host "  Name:                   $($OrgInfo.organization_name)" -ForegroundColor Gray
    Write-Host "  Agency Ref:             $($OrgInfo.alto_agency_ref)" -ForegroundColor Gray
    Write-Host "  Current Provider:       $($OrgInfo.tds_provider_preference)" -ForegroundColor Gray
    Write-Host "  Status:                 $(if ($OrgInfo.is_active) { 'Active' } else { 'Inactive' })" -ForegroundColor $(if ($OrgInfo.is_active) { 'Green' } else { 'Red' })
    Write-Host ""

    Write-Host "Monitoring Period:" -ForegroundColor White
    Write-Host "  Duration:               $MonitoringDays days" -ForegroundColor Gray
    if ($Metrics.first_request_time) {
        Write-Host "  First Request:          $($Metrics.first_request_time)" -ForegroundColor Gray
        Write-Host "  Last Request:           $($Metrics.last_request_time)" -ForegroundColor Gray
    }
    Write-Host ""

    Write-Host "Performance Metrics:" -ForegroundColor White
    Write-Host "  Total Requests:         $($Metrics.total_requests)" -ForegroundColor Gray
    Write-Host "  Successful:             $($Metrics.successful_requests) ($($Readiness.SuccessRate)%)" -ForegroundColor $(if ($Readiness.SuccessRate -ge $SuccessThreshold) { 'Green' } else { 'Red' })
    Write-Host "  Failed:                 $($Metrics.failed_requests)" -ForegroundColor $(if ($Metrics.failed_requests -eq 0) { 'Green' } else { 'Red' })
    Write-Host "  With Differences:       $($Metrics.requests_with_differences) ($($Readiness.DifferenceRate)%)" -ForegroundColor $(if ($Readiness.DifferenceRate -le $MaxDifferenceThreshold) { 'Green' } else { 'Yellow' })
    Write-Host ""

    Write-Host "Response Times:" -ForegroundColor White
    Write-Host "  Average:                $($Readiness.AvgResponseTime)ms" -ForegroundColor $(if ($Readiness.AvgResponseTime -le $PerformanceThreshold) { 'Green' } else { 'Yellow' })
    Write-Host "  Maximum:                $($Metrics.max_request_duration_ms)ms" -ForegroundColor Gray
    Write-Host ""

    Write-Host "Migration Readiness:" -ForegroundColor White
    Write-Host "  Overall Score:          $($Readiness.Score)/100 (Grade: $($Readiness.Grade))" -ForegroundColor $(switch ($Readiness.Grade) { {$_ -like "A*"} { 'Green' }; {$_ -like "B*"} { 'Yellow' }; default { 'Red' } })
    Write-Host "  Ready to Migrate:       $(if ($Readiness.Ready) { 'YES' } else { 'NO' })" -ForegroundColor $(if ($Readiness.Ready) { 'Green' } else { 'Red' })
    Write-Host "  Assessment:             $($Readiness.Reason)" -ForegroundColor Gray
    Write-Host ""

    Write-Host "Thresholds:" -ForegroundColor White
    Write-Host "  Min Success Rate:       $SuccessThreshold% $(if ($Readiness.SuccessRate -ge $SuccessThreshold) { '✓' } else { '✗' })" -ForegroundColor $(if ($Readiness.SuccessRate -ge $SuccessThreshold) { 'Green' } else { 'Red' })
    Write-Host "  Max Difference Rate:    $MaxDifferenceThreshold% $(if ($Readiness.DifferenceRate -le $MaxDifferenceThreshold) { '✓' } else { '✗' })" -ForegroundColor $(if ($Readiness.DifferenceRate -le $MaxDifferenceThreshold) { 'Green' } else { 'Red' })
    Write-Host "  Max Avg Response Time:  $($PerformanceThreshold)ms $(if ($Readiness.AvgResponseTime -le $PerformanceThreshold) { '✓' } else { '✗' })" -ForegroundColor $(if ($Readiness.AvgResponseTime -le $PerformanceThreshold) { 'Green' } else { 'Red' })
    Write-Host ""
}

function Save-MigrationReport {
    param(
        $OrgInfo,
        $Metrics,
        $Readiness,
        [string]$FilePath
    )

    $report = @{
        GeneratedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        Organization = @{
            Name = $OrgInfo.organization_name
            AgencyRef = $OrgInfo.alto_agency_ref
            BranchId = $OrgInfo.alto_branch_id
            CurrentProvider = $OrgInfo.tds_provider_preference
            IsActive = $OrgInfo.is_active
        }
        MonitoringPeriod = @{
            DurationDays = $MonitoringDays
            FirstRequest = $Metrics.first_request_time
            LastRequest = $Metrics.last_request_time
        }
        Metrics = @{
            TotalRequests = $Metrics.total_requests
            SuccessfulRequests = $Metrics.successful_requests
            FailedRequests = $Metrics.failed_requests
            RequestsWithDifferences = $Metrics.requests_with_differences
            AvgRequestDurationMs = $Metrics.avg_request_duration_ms
            AvgProviderResponseTimeMs = $Metrics.avg_provider_response_time_ms
            MaxRequestDurationMs = $Metrics.max_request_duration_ms
        }
        Readiness = $Readiness
        Thresholds = @{
            SuccessThreshold = $SuccessThreshold
            MaxDifferenceThreshold = $MaxDifferenceThreshold
            PerformanceThreshold = $PerformanceThreshold
        }
    }

    $report | ConvertTo-Json -Depth 10 | Out-File -FilePath $FilePath -Encoding UTF8
    Write-StatusOk "Report saved to: $FilePath"
}

function Log-MigrationEvent {
    param(
        [string]$AgencyRef,
        [string]$EventType,
        [string]$Details
    )

    $query = @"
INSERT INTO migration_log (
    agency_ref,
    event_type,
    event_details,
    created_at
) VALUES (
    @AgencyRef,
    @EventType,
    @Details,
    GETUTCDATE()
)
"@

    $params = @{
        AgencyRef = $AgencyRef
        EventType = $EventType
        Details = $Details
    }

    try {
        Invoke-Sqlcmd -ConnectionString (Get-DatabaseConnection) -Query $query -Variable $params
    } catch {
        # If migration_log table doesn't exist, just log to console
        Write-Verbose "Migration event: $EventType - $Details"
    }
}

# =============================================
# Main Script Logic
# =============================================

Write-Header "TDS API Migration Orchestrator"

# Get organization info
Write-StatusInfo "Looking up organization: $AgencyRef"
$orgInfo = Get-OrganizationInfo -AgencyRef $AgencyRef
Write-StatusOk "Found organization: $($orgInfo.organization_name)"

# Handle rollback
if ($Rollback) {
    Write-Header "Emergency Rollback"
    Write-StatusWarning "Rolling back organization to Legacy API..."

    Set-OrganizationProvider -AgencyRef $AgencyRef -Provider 'current'
    Log-MigrationEvent -AgencyRef $AgencyRef -EventType 'Rollback' -Details 'Manual rollback to Legacy API'

    Write-StatusOk "Rollback complete! Organization is now using Legacy API only."
    exit 0
}

# Enable dual-mode if requested
if (-not $SkipMonitoring -and -not $GenerateReportOnly) {
    if ($orgInfo.tds_provider_preference -eq 'salesforce') {
        Write-StatusWarning "Organization is already using Salesforce-only mode"
        $continue = Read-Host "Switch to dual-mode for re-validation? (y/N)"
        if ($continue -eq 'y' -or $continue -eq 'Y') {
            Enable-DualMode -AgencyRef $AgencyRef
            Log-MigrationEvent -AgencyRef $AgencyRef -EventType 'DualModeEnabled' -Details "Switched from Salesforce-only to dual-mode for re-validation"
        }
    } elseif ($orgInfo.tds_provider_preference -ne 'auto') {
        Enable-DualMode -AgencyRef $AgencyRef
        Log-MigrationEvent -AgencyRef $AgencyRef -EventType 'DualModeEnabled' -Details "Enabled dual-mode monitoring"

        Write-Host ""
        Write-StatusOk "Dual-mode enabled successfully!"
        Write-StatusInfo "The system will now execute requests on both Legacy and Salesforce APIs"
        Write-Host ""
        Write-Host "Next Steps:" -ForegroundColor Yellow
        Write-Host "  1. Wait for $MonitoringDays days to collect metrics" -ForegroundColor Gray
        Write-Host "  2. Run this script again with -SkipMonitoring to evaluate readiness" -ForegroundColor Gray
        Write-Host "  3. Or schedule this script to run automatically" -ForegroundColor Gray
        Write-Host ""
        exit 0
    }
}

# Query metrics
$metrics = Get-ComparisonMetrics -AgencyRef $AgencyRef -Days $MonitoringDays

if ($metrics.total_requests -eq 0) {
    Write-StatusWarning "No dual-mode data found for the last $MonitoringDays days"

    if ($orgInfo.tds_provider_preference -ne 'auto') {
        Write-Host ""
        Write-Host "Recommendation: Enable dual-mode first" -ForegroundColor Yellow
        Write-Host "Run: .\migrate-organization.ps1 -AgencyRef '$AgencyRef'" -ForegroundColor Gray
    } else {
        Write-Host ""
        Write-Host "Dual-mode is enabled, but no requests have been processed yet." -ForegroundColor Yellow
        Write-Host "Wait for traffic or trigger some test requests." -ForegroundColor Gray
    }

    exit 1
}

# Calculate readiness
$readiness = Get-MigrationReadinessScore -Metrics $metrics

# Show report
Show-MigrationReport -OrgInfo $orgInfo -Metrics $metrics -Readiness $readiness

# Save report to file
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = "migration-report-$AgencyRef-$timestamp.json"
Save-MigrationReport -OrgInfo $orgInfo -Metrics $metrics -Readiness $readiness -FilePath $reportPath

# Exit if only generating report
if ($GenerateReportOnly) {
    Write-StatusOk "Report generation complete"
    exit 0
}

# Decision logic
if ($readiness.Ready) {
    Write-Header "Migration Decision"
    Write-StatusOk "Organization meets all migration criteria!"

    if ($AutoMigrate) {
        Write-StatusInfo "Auto-migration enabled - proceeding with migration..."
    } else {
        Write-Host ""
        Write-Host "Ready to migrate to Salesforce API?" -ForegroundColor Yellow
        Write-Host "This will:" -ForegroundColor Gray
        Write-Host "  - Switch organization to Salesforce-only mode" -ForegroundColor Gray
        Write-Host "  - Stop executing on Legacy API" -ForegroundColor Gray
        Write-Host "  - Log the migration event" -ForegroundColor Gray
        Write-Host ""
        $confirmation = Read-Host "Proceed with migration? (y/N)"

        if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
            Write-StatusWarning "Migration cancelled by user"
            exit 0
        }
    }

    # Perform migration
    Write-StatusInfo "Migrating organization to Salesforce API..."
    Set-OrganizationProvider -AgencyRef $AgencyRef -Provider 'salesforce'

    Log-MigrationEvent -AgencyRef $AgencyRef -EventType 'Migrated' -Details @"
Migrated to Salesforce API
Score: $($readiness.Score)/100 (Grade: $($readiness.Grade))
Success Rate: $($readiness.SuccessRate)%
Difference Rate: $($readiness.DifferenceRate)%
Avg Response Time: $($readiness.AvgResponseTime)ms
"@

    Write-Host ""
    Write-StatusOk "Migration completed successfully!"
    Write-StatusOk "Organization is now using Salesforce API exclusively"
    Write-Host ""

} else {
    Write-Header "Migration Not Recommended"
    Write-StatusWarning "Organization does not meet migration criteria yet"
    Write-Host ""
    Write-Host "Issues:" -ForegroundColor Yellow
    Write-Host "  $($readiness.Reason)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Recommendation: Keep monitoring in dual-mode" -ForegroundColor Yellow
    Write-Host "  - Continue running both APIs in parallel" -ForegroundColor Gray
    Write-Host "  - Investigate any differences or errors" -ForegroundColor Gray
    Write-Host "  - Re-run this script after improvements" -ForegroundColor Gray
    Write-Host ""

    Log-MigrationEvent -AgencyRef $AgencyRef -EventType 'MigrationDelayed' -Details $readiness.Reason
}

Write-Host ""
Write-StatusOk "Done!"
