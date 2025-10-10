-- =============================================
-- Batch Tracking Table
-- =============================================
-- Purpose: Track which TDS provider was used to create each deposit batch
-- Enables provider-aware status checking
-- Supports dual-mode execution tracking
-- =============================================

CREATE TABLE batch_tracking (
    -- Primary key
    id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- Batch identification
    batch_id NVARCHAR(100) NOT NULL UNIQUE,

    -- Provider information
    provider NVARCHAR(20) NOT NULL, -- 'current', 'salesforce'
    execution_mode NVARCHAR(20) NOT NULL DEFAULT 'single', -- 'single', 'dual', 'shadow'

    -- Organization reference
    organization_id INT NULL,
    alto_agency_ref NVARCHAR(100) NULL,
    alto_branch_id NVARCHAR(100) NULL,

    -- Alto source identifiers
    alto_tenancy_id NVARCHAR(100) NULL,
    alto_workflow_id NVARCHAR(100) NULL,

    -- Status tracking
    current_status NVARCHAR(50) NULL, -- 'submitted', 'processing', 'created', 'failed'
    dan_number NVARCHAR(50) NULL,
    status_last_checked DATETIME2 NULL,
    status_check_count INT NOT NULL DEFAULT 0,

    -- Request/Response tracking
    request_payload NVARCHAR(MAX) NULL, -- JSON
    response_payload NVARCHAR(MAX) NULL, -- JSON
    error_details NVARCHAR(MAX) NULL, -- JSON

    -- Dual-mode tracking
    dual_mode_legacy_batch_id NVARCHAR(100) NULL,
    dual_mode_salesforce_batch_id NVARCHAR(100) NULL,
    dual_mode_results NVARCHAR(MAX) NULL, -- JSON comparison results

    -- Performance metrics
    request_duration_ms INT NULL,
    provider_response_time_ms INT NULL,

    -- Audit trail
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    completed_at DATETIME2 NULL,

    -- Constraints
    CONSTRAINT CK_batch_tracking_provider CHECK (provider IN ('current', 'salesforce')),
    CONSTRAINT CK_batch_tracking_mode CHECK (execution_mode IN ('single', 'dual', 'shadow', 'forwarding')),
    CONSTRAINT FK_batch_tracking_organization
        FOREIGN KEY (organization_id)
        REFERENCES organization_mappings(id)
        ON DELETE SET NULL
);
GO

-- Create indexes for performance
CREATE INDEX IX_batch_tracking_batch_id
    ON batch_tracking(batch_id);
GO

CREATE INDEX IX_batch_tracking_provider
    ON batch_tracking(provider, created_at DESC);
GO

CREATE INDEX IX_batch_tracking_organization
    ON batch_tracking(organization_id, created_at DESC);
GO

CREATE INDEX IX_batch_tracking_status
    ON batch_tracking(current_status, status_last_checked);
GO

CREATE INDEX IX_batch_tracking_alto_tenancy
    ON batch_tracking(alto_tenancy_id)
    WHERE alto_tenancy_id IS NOT NULL;
GO

CREATE INDEX IX_batch_tracking_dan
    ON batch_tracking(dan_number)
    WHERE dan_number IS NOT NULL;
GO

-- Composite index for status polling queries
CREATE INDEX IX_batch_tracking_status_polling
    ON batch_tracking(batch_id, provider, current_status)
    INCLUDE (dan_number, status_last_checked);
GO

-- Index for dual-mode queries
CREATE INDEX IX_batch_tracking_dual_mode
    ON batch_tracking(execution_mode, created_at DESC)
    WHERE execution_mode IN ('dual', 'shadow');
GO

-- Create trigger to auto-update updated_at timestamp
CREATE TRIGGER TR_batch_tracking_updated_at
ON batch_tracking
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE batch_tracking
    SET updated_at = GETUTCDATE()
    FROM batch_tracking bt
    INNER JOIN inserted i ON bt.id = i.id;
END;
GO

-- =============================================
-- Helper Views
-- =============================================

-- View: Recent batches by provider
CREATE VIEW vw_batch_tracking_recent AS
SELECT
    bt.id,
    bt.batch_id,
    bt.provider,
    bt.execution_mode,
    bt.current_status,
    bt.dan_number,
    om.organization_name,
    bt.alto_tenancy_id,
    bt.request_duration_ms,
    bt.created_at,
    bt.updated_at,
    DATEDIFF(MINUTE, bt.created_at, GETUTCDATE()) AS age_minutes
FROM batch_tracking bt
LEFT JOIN organization_mappings om ON bt.organization_id = om.id
WHERE bt.created_at >= DATEADD(DAY, -7, GETUTCDATE());
GO

-- View: Provider performance metrics
CREATE VIEW vw_batch_tracking_metrics AS
SELECT
    provider,
    execution_mode,
    current_status,
    COUNT(*) AS batch_count,
    AVG(request_duration_ms) AS avg_duration_ms,
    AVG(provider_response_time_ms) AS avg_response_time_ms,
    AVG(status_check_count) AS avg_status_checks,
    MIN(created_at) AS first_created,
    MAX(created_at) AS last_created
FROM batch_tracking
WHERE created_at >= DATEADD(DAY, -30, GETUTCDATE())
GROUP BY provider, execution_mode, current_status;
GO

-- =============================================
-- Stored Procedures
-- =============================================

-- Procedure: Get or create batch tracking record
CREATE PROCEDURE usp_batch_tracking_upsert
    @batch_id NVARCHAR(100),
    @provider NVARCHAR(20),
    @execution_mode NVARCHAR(20),
    @organization_id INT = NULL,
    @alto_agency_ref NVARCHAR(100) = NULL,
    @alto_branch_id NVARCHAR(100) = NULL,
    @alto_tenancy_id NVARCHAR(100) = NULL,
    @alto_workflow_id NVARCHAR(100) = NULL,
    @request_payload NVARCHAR(MAX) = NULL,
    @response_payload NVARCHAR(MAX) = NULL,
    @request_duration_ms INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Try to update existing record
    UPDATE batch_tracking
    SET
        provider = @provider,
        execution_mode = @execution_mode,
        response_payload = COALESCE(@response_payload, response_payload),
        request_duration_ms = COALESCE(@request_duration_ms, request_duration_ms),
        updated_at = GETUTCDATE()
    WHERE batch_id = @batch_id;

    -- If no rows updated, insert new record
    IF @@ROWCOUNT = 0
    BEGIN
        INSERT INTO batch_tracking (
            batch_id,
            provider,
            execution_mode,
            organization_id,
            alto_agency_ref,
            alto_branch_id,
            alto_tenancy_id,
            alto_workflow_id,
            request_payload,
            response_payload,
            request_duration_ms
        ) VALUES (
            @batch_id,
            @provider,
            @execution_mode,
            @organization_id,
            @alto_agency_ref,
            @alto_branch_id,
            @alto_tenancy_id,
            @alto_workflow_id,
            @request_payload,
            @response_payload,
            @request_duration_ms
        );
    END

    -- Return the record
    SELECT * FROM batch_tracking WHERE batch_id = @batch_id;
END;
GO

-- Procedure: Update batch status
CREATE PROCEDURE usp_batch_tracking_update_status
    @batch_id NVARCHAR(100),
    @current_status NVARCHAR(50),
    @dan_number NVARCHAR(50) = NULL,
    @response_payload NVARCHAR(MAX) = NULL,
    @error_details NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE batch_tracking
    SET
        current_status = @current_status,
        dan_number = COALESCE(@dan_number, dan_number),
        response_payload = COALESCE(@response_payload, response_payload),
        error_details = COALESCE(@error_details, error_details),
        status_last_checked = GETUTCDATE(),
        status_check_count = status_check_count + 1,
        completed_at = CASE WHEN @current_status IN ('created', 'failed') THEN GETUTCDATE() ELSE completed_at END,
        updated_at = GETUTCDATE()
    WHERE batch_id = @batch_id;

    -- Return updated record
    SELECT * FROM batch_tracking WHERE batch_id = @batch_id;
END;
GO

-- =============================================
-- Verification Query
-- =============================================

SELECT
    provider,
    execution_mode,
    COUNT(*) AS total_batches,
    COUNT(CASE WHEN current_status = 'created' THEN 1 END) AS successful,
    COUNT(CASE WHEN current_status = 'failed' THEN 1 END) AS failed,
    AVG(request_duration_ms) AS avg_duration_ms
FROM batch_tracking
GROUP BY provider, execution_mode
ORDER BY provider, execution_mode;
GO

-- =============================================
-- Rollback Script (if needed)
-- =============================================
-- DROP PROCEDURE IF EXISTS usp_batch_tracking_update_status;
-- DROP PROCEDURE IF EXISTS usp_batch_tracking_upsert;
-- DROP VIEW IF EXISTS vw_batch_tracking_metrics;
-- DROP VIEW IF EXISTS vw_batch_tracking_recent;
-- DROP TABLE IF EXISTS batch_tracking;
-- =============================================
