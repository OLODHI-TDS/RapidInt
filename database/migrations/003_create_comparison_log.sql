-- =============================================
-- Comparison Log Table
-- =============================================
-- Purpose: Track dual-mode execution comparison results
-- Stores side-by-side comparison of legacy vs Salesforce API responses
-- Enables migration readiness analysis and quality metrics
-- =============================================

CREATE TABLE comparison_log (
    -- Primary key
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- Timestamp
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Organization reference
    organization_id INT NULL,
    alto_agency_ref NVARCHAR(100) NULL,

    -- Batch tracking
    batch_id NVARCHAR(100) NULL, -- The batch ID returned to the client
    legacy_batch_id NVARCHAR(100) NULL,
    salesforce_batch_id NVARCHAR(100) NULL,

    -- Execution mode
    execution_mode NVARCHAR(20) NOT NULL, -- 'dual', 'shadow', 'forwarding'

    -- Success tracking
    both_succeeded BIT NOT NULL DEFAULT 0,
    legacy_success BIT NOT NULL DEFAULT 0,
    salesforce_success BIT NOT NULL DEFAULT 0,

    -- Response data (stored as JSON)
    legacy_response NVARCHAR(MAX) NULL,
    salesforce_response NVARCHAR(MAX) NULL,

    -- Comparison results
    differences NVARCHAR(MAX) NULL, -- JSON array of differences
    match_percentage DECIMAL(5,2) NULL, -- 0.00 to 100.00
    significance_level NVARCHAR(20) NULL, -- 'critical', 'important', 'cosmetic', 'none'

    -- Difference counts
    total_fields INT NULL,
    difference_count INT NULL,
    critical_differences INT NULL,
    important_differences INT NULL,
    cosmetic_differences INT NULL,

    -- Performance metrics
    legacy_duration_ms INT NULL,
    salesforce_duration_ms INT NULL,
    performance_difference_ms INT NULL,
    performance_difference_pct DECIMAL(5,2) NULL,

    -- Error tracking
    legacy_error NVARCHAR(MAX) NULL,
    salesforce_error NVARCHAR(MAX) NULL,

    -- Recommendation
    recommendation NVARCHAR(500) NULL,

    -- Audit
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Foreign key constraint
    CONSTRAINT FK_comparison_log_organization
        FOREIGN KEY (organization_id)
        REFERENCES organization_mappings(id)
        ON DELETE SET NULL,

    -- Check constraints
    CONSTRAINT CK_comparison_log_mode CHECK (execution_mode IN ('dual', 'shadow', 'forwarding')),
    CONSTRAINT CK_comparison_log_significance CHECK (
        significance_level IS NULL OR
        significance_level IN ('critical', 'important', 'cosmetic', 'none')
    ),
    CONSTRAINT CK_comparison_log_match_percentage CHECK (
        match_percentage IS NULL OR
        (match_percentage >= 0 AND match_percentage <= 100)
    )
);
GO

-- =============================================
-- Indexes for Performance
-- =============================================

-- Index on timestamp for time-based queries
CREATE INDEX IX_comparison_log_timestamp
    ON comparison_log(timestamp DESC);
GO

-- Index on organization for org-specific analysis
CREATE INDEX IX_comparison_log_organization
    ON comparison_log(organization_id, timestamp DESC)
    WHERE organization_id IS NOT NULL;
GO

-- Index on batch IDs for lookup
CREATE INDEX IX_comparison_log_batch_id
    ON comparison_log(batch_id)
    WHERE batch_id IS NOT NULL;
GO

CREATE INDEX IX_comparison_log_legacy_batch
    ON comparison_log(legacy_batch_id)
    WHERE legacy_batch_id IS NOT NULL;
GO

CREATE INDEX IX_comparison_log_salesforce_batch
    ON comparison_log(salesforce_batch_id)
    WHERE salesforce_batch_id IS NOT NULL;
GO

-- Index on success flags for filtering
CREATE INDEX IX_comparison_log_success
    ON comparison_log(both_succeeded, timestamp DESC);
GO

-- Index on significance level for critical issues
CREATE INDEX IX_comparison_log_significance
    ON comparison_log(significance_level, timestamp DESC)
    WHERE significance_level IS NOT NULL;
GO

-- Composite index for migration readiness queries
CREATE INDEX IX_comparison_log_readiness
    ON comparison_log(organization_id, both_succeeded, significance_level, timestamp DESC)
    WHERE organization_id IS NOT NULL;
GO

-- =============================================
-- Views for Analysis
-- =============================================

-- View: Comparison Summary Statistics
CREATE VIEW vw_comparison_summary AS
SELECT
    COUNT(*) AS total_comparisons,
    COUNT(CASE WHEN both_succeeded = 1 THEN 1 END) AS both_succeeded_count,
    COUNT(CASE WHEN legacy_success = 1 AND salesforce_success = 0 THEN 1 END) AS only_legacy_count,
    COUNT(CASE WHEN legacy_success = 0 AND salesforce_success = 1 THEN 1 END) AS only_salesforce_count,
    COUNT(CASE WHEN legacy_success = 0 AND salesforce_success = 0 THEN 1 END) AS both_failed_count,
    COUNT(CASE WHEN match_percentage = 100 THEN 1 END) AS perfect_matches,
    COUNT(CASE WHEN significance_level = 'critical' THEN 1 END) AS critical_issues,
    COUNT(CASE WHEN significance_level = 'important' THEN 1 END) AS important_issues,
    COUNT(CASE WHEN significance_level = 'cosmetic' THEN 1 END) AS cosmetic_issues,
    AVG(match_percentage) AS avg_match_percentage,
    AVG(CASE WHEN both_succeeded = 1 THEN legacy_duration_ms END) AS avg_legacy_duration,
    AVG(CASE WHEN both_succeeded = 1 THEN salesforce_duration_ms END) AS avg_salesforce_duration,
    MIN(timestamp) AS first_comparison,
    MAX(timestamp) AS last_comparison
FROM comparison_log
WHERE timestamp >= DATEADD(DAY, -30, GETUTCDATE());
GO

-- View: Organization Migration Readiness
CREATE VIEW vw_organization_readiness AS
SELECT
    om.id AS organization_id,
    om.organization_name,
    om.alto_agency_ref,
    COUNT(cl.id) AS total_comparisons,
    COUNT(CASE WHEN cl.both_succeeded = 1 THEN 1 END) AS both_succeeded_count,
    COUNT(CASE WHEN cl.match_percentage = 100 THEN 1 END) AS perfect_matches,
    COUNT(CASE WHEN cl.critical_differences > 0 THEN 1 END) AS critical_difference_count,
    COUNT(CASE WHEN cl.important_differences > 0 THEN 1 END) AS important_difference_count,
    AVG(cl.match_percentage) AS avg_match_percentage,
    MAX(cl.timestamp) AS last_comparison,
    -- Readiness score calculation (0-100)
    CASE
        WHEN COUNT(cl.id) = 0 THEN 0
        WHEN COUNT(CASE WHEN cl.critical_differences > 0 THEN 1 END) > 0 THEN 0
        WHEN AVG(cl.match_percentage) >= 95 AND COUNT(cl.id) >= 10 THEN 100
        WHEN AVG(cl.match_percentage) >= 90 AND COUNT(cl.id) >= 10 THEN 75
        WHEN AVG(cl.match_percentage) >= 80 AND COUNT(cl.id) >= 5 THEN 50
        ELSE 25
    END AS readiness_score,
    -- Readiness status
    CASE
        WHEN COUNT(cl.id) = 0 THEN 'Not Tested'
        WHEN COUNT(CASE WHEN cl.critical_differences > 0 THEN 1 END) > 0 THEN 'Not Ready - Critical Issues'
        WHEN AVG(cl.match_percentage) >= 95 AND COUNT(cl.id) >= 10 THEN 'Ready'
        WHEN AVG(cl.match_percentage) >= 90 AND COUNT(cl.id) >= 10 THEN 'Almost Ready'
        WHEN COUNT(cl.id) < 10 THEN 'Insufficient Data'
        ELSE 'Not Ready'
    END AS readiness_status
FROM organization_mappings om
LEFT JOIN comparison_log cl ON om.id = cl.organization_id
    AND cl.timestamp >= DATEADD(DAY, -30, GETUTCDATE())
WHERE om.is_active = 1
GROUP BY om.id, om.organization_name, om.alto_agency_ref;
GO

-- View: Recent Comparison Details
CREATE VIEW vw_comparison_recent AS
SELECT
    cl.id,
    cl.timestamp,
    om.organization_name,
    cl.batch_id,
    cl.execution_mode,
    cl.both_succeeded,
    cl.match_percentage,
    cl.significance_level,
    cl.critical_differences,
    cl.important_differences,
    cl.cosmetic_differences,
    cl.legacy_duration_ms,
    cl.salesforce_duration_ms,
    cl.performance_difference_ms,
    cl.recommendation,
    DATEDIFF(MINUTE, cl.timestamp, GETUTCDATE()) AS age_minutes
FROM comparison_log cl
LEFT JOIN organization_mappings om ON cl.organization_id = om.id
WHERE cl.timestamp >= DATEADD(DAY, -7, GETUTCDATE());
GO

-- View: Difference Pattern Analysis
CREATE VIEW vw_difference_patterns AS
SELECT
    significance_level,
    execution_mode,
    COUNT(*) AS occurrence_count,
    AVG(match_percentage) AS avg_match_percentage,
    AVG(critical_differences) AS avg_critical_diff,
    AVG(important_differences) AS avg_important_diff,
    AVG(cosmetic_differences) AS avg_cosmetic_diff,
    MIN(timestamp) AS first_seen,
    MAX(timestamp) AS last_seen
FROM comparison_log
WHERE timestamp >= DATEADD(DAY, -30, GETUTCDATE())
    AND significance_level IS NOT NULL
GROUP BY significance_level, execution_mode;
GO

-- =============================================
-- Stored Procedures
-- =============================================

-- Procedure: Insert comparison log entry
CREATE PROCEDURE usp_comparison_log_insert
    @organization_id INT = NULL,
    @alto_agency_ref NVARCHAR(100) = NULL,
    @batch_id NVARCHAR(100) = NULL,
    @legacy_batch_id NVARCHAR(100) = NULL,
    @salesforce_batch_id NVARCHAR(100) = NULL,
    @execution_mode NVARCHAR(20),
    @both_succeeded BIT,
    @legacy_success BIT,
    @salesforce_success BIT,
    @legacy_response NVARCHAR(MAX) = NULL,
    @salesforce_response NVARCHAR(MAX) = NULL,
    @differences NVARCHAR(MAX) = NULL,
    @match_percentage DECIMAL(5,2) = NULL,
    @significance_level NVARCHAR(20) = NULL,
    @total_fields INT = NULL,
    @difference_count INT = NULL,
    @critical_differences INT = NULL,
    @important_differences INT = NULL,
    @cosmetic_differences INT = NULL,
    @legacy_duration_ms INT = NULL,
    @salesforce_duration_ms INT = NULL,
    @performance_difference_ms INT = NULL,
    @performance_difference_pct DECIMAL(5,2) = NULL,
    @legacy_error NVARCHAR(MAX) = NULL,
    @salesforce_error NVARCHAR(MAX) = NULL,
    @recommendation NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO comparison_log (
        organization_id,
        alto_agency_ref,
        batch_id,
        legacy_batch_id,
        salesforce_batch_id,
        execution_mode,
        both_succeeded,
        legacy_success,
        salesforce_success,
        legacy_response,
        salesforce_response,
        differences,
        match_percentage,
        significance_level,
        total_fields,
        difference_count,
        critical_differences,
        important_differences,
        cosmetic_differences,
        legacy_duration_ms,
        salesforce_duration_ms,
        performance_difference_ms,
        performance_difference_pct,
        legacy_error,
        salesforce_error,
        recommendation
    ) VALUES (
        @organization_id,
        @alto_agency_ref,
        @batch_id,
        @legacy_batch_id,
        @salesforce_batch_id,
        @execution_mode,
        @both_succeeded,
        @legacy_success,
        @salesforce_success,
        @legacy_response,
        @salesforce_response,
        @differences,
        @match_percentage,
        @significance_level,
        @total_fields,
        @difference_count,
        @critical_differences,
        @important_differences,
        @cosmetic_differences,
        @legacy_duration_ms,
        @salesforce_duration_ms,
        @performance_difference_ms,
        @performance_difference_pct,
        @legacy_error,
        @salesforce_error,
        @recommendation
    );

    -- Return the inserted record
    SELECT * FROM comparison_log WHERE id = SCOPE_IDENTITY();
END;
GO

-- Procedure: Get organization readiness score
CREATE PROCEDURE usp_get_organization_readiness
    @alto_agency_ref NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT *
    FROM vw_organization_readiness
    WHERE alto_agency_ref = @alto_agency_ref;
END;
GO

-- Procedure: Get comparison statistics
CREATE PROCEDURE usp_get_comparison_stats
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @startDate DATETIME2 = DATEADD(DAY, -@days, GETUTCDATE());

    SELECT
        COUNT(*) AS total_comparisons,
        COUNT(CASE WHEN both_succeeded = 1 THEN 1 END) AS both_succeeded_count,
        COUNT(CASE WHEN match_percentage = 100 THEN 1 END) AS perfect_matches,
        COUNT(CASE WHEN critical_differences > 0 THEN 1 END) AS critical_issues,
        AVG(match_percentage) AS avg_match_percentage,
        AVG(legacy_duration_ms) AS avg_legacy_duration,
        AVG(salesforce_duration_ms) AS avg_salesforce_duration,
        MIN(timestamp) AS first_comparison,
        MAX(timestamp) AS last_comparison
    FROM comparison_log
    WHERE timestamp >= @startDate;
END;
GO

-- =============================================
-- Verification Query
-- =============================================

SELECT
    'Table created successfully' AS status,
    COUNT(*) AS initial_row_count
FROM comparison_log;
GO

SELECT * FROM vw_comparison_summary;
GO

-- =============================================
-- Rollback Script (if needed)
-- =============================================
-- DROP PROCEDURE IF EXISTS usp_get_comparison_stats;
-- DROP PROCEDURE IF EXISTS usp_get_organization_readiness;
-- DROP PROCEDURE IF EXISTS usp_comparison_log_insert;
-- DROP VIEW IF EXISTS vw_difference_patterns;
-- DROP VIEW IF EXISTS vw_comparison_recent;
-- DROP VIEW IF EXISTS vw_organization_readiness;
-- DROP VIEW IF EXISTS vw_comparison_summary;
-- DROP TABLE IF EXISTS comparison_log;
-- =============================================
