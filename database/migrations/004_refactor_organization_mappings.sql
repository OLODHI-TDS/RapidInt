-- =============================================
-- Organization Mappings Schema Refactor
-- =============================================
-- Purpose: Refactor organization mappings to support:
--   - Multiple CRM integrations (Alto, Jupix, etc.)
--   - Separate Legacy and Salesforce TDS configurations
--   - OAuth2 and API Key authentication for Salesforce
--   - Environment-specific configurations (Dev/Prod)
-- =============================================

-- Drop existing table and recreate with new structure
-- WARNING: This will delete all existing organization mappings
-- Backup data before running this migration

IF OBJECT_ID('organization_mappings', 'U') IS NOT NULL
    DROP TABLE organization_mappings;
GO

-- Create new organization_mappings table
CREATE TABLE organization_mappings (
    -- Primary key
    id INT IDENTITY(1,1) PRIMARY KEY,

    -- Organization details
    organization_name NVARCHAR(200) NOT NULL,
    environment NVARCHAR(20) NOT NULL DEFAULT 'development', -- 'development' or 'production'

    -- Integration type and credentials
    integration_type NVARCHAR(50) NOT NULL, -- 'alto', 'jupix', etc.
    integration_credentials NVARCHAR(MAX) NOT NULL, -- JSON: { "alto": { "agencyRef": "...", "branchId": "..." } }

    -- Legacy TDS Configuration
    legacy_member_id NVARCHAR(50) NOT NULL,
    legacy_branch_id NVARCHAR(50) NOT NULL,
    legacy_api_key_encrypted NVARCHAR(500) NOT NULL, -- Encrypted: iv:encrypted_value

    -- Salesforce TDS Configuration
    sf_member_id NVARCHAR(50) NOT NULL,
    sf_branch_id NVARCHAR(50) NOT NULL,
    sf_region NVARCHAR(20) NOT NULL, -- 'EW', 'Scotland', 'NI'
    sf_scheme_type NVARCHAR(20) NOT NULL DEFAULT 'Custodial', -- 'Custodial' or 'Insured'
    sf_auth_method NVARCHAR(20) NOT NULL DEFAULT 'api_key', -- 'api_key' or 'oauth2'
    sf_api_key_encrypted NVARCHAR(500) NULL, -- For API Key auth (Encrypted: iv:encrypted_value)
    sf_client_id NVARCHAR(200) NULL, -- For OAuth2 auth
    sf_client_secret_encrypted NVARCHAR(500) NULL, -- For OAuth2 auth (Encrypted: iv:encrypted_value)

    -- Provider preference (which TDS API to use)
    tds_provider_preference NVARCHAR(20) NOT NULL DEFAULT 'auto', -- 'current', 'salesforce', 'auto'

    -- Status and audit
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NULL,
    updated_by NVARCHAR(100) NULL,

    -- Notes
    notes NVARCHAR(MAX) NULL,

    -- Constraints
    CONSTRAINT CK_organization_mappings_environment CHECK (environment IN ('development', 'production')),
    CONSTRAINT CK_organization_mappings_integration_type CHECK (integration_type IN ('alto', 'jupix')),
    CONSTRAINT CK_organization_mappings_sf_region CHECK (sf_region IN ('EW', 'Scotland', 'NI')),
    CONSTRAINT CK_organization_mappings_sf_scheme_type CHECK (sf_scheme_type IN ('Custodial', 'Insured')),
    CONSTRAINT CK_organization_mappings_sf_auth_method CHECK (sf_auth_method IN ('api_key', 'oauth2')),
    CONSTRAINT CK_organization_mappings_provider CHECK (tds_provider_preference IN ('current', 'salesforce', 'auto')),

    -- Ensure either API key or OAuth2 credentials are provided for Salesforce
    CONSTRAINT CK_organization_mappings_sf_auth CHECK (
        (sf_auth_method = 'api_key' AND sf_api_key_encrypted IS NOT NULL) OR
        (sf_auth_method = 'oauth2' AND sf_client_id IS NOT NULL AND sf_client_secret_encrypted IS NOT NULL)
    )
);
GO

-- Create indexes for performance
CREATE INDEX IX_organization_mappings_environment
    ON organization_mappings(environment, is_active);
GO

CREATE INDEX IX_organization_mappings_integration_type
    ON organization_mappings(integration_type)
    WHERE is_active = 1;
GO

CREATE INDEX IX_organization_mappings_provider
    ON organization_mappings(tds_provider_preference)
    WHERE is_active = 1;
GO

-- Create index on integration credentials for JSON queries
CREATE INDEX IX_organization_mappings_integration_credentials
    ON organization_mappings(integration_credentials);
GO

-- Create trigger to auto-update updated_at timestamp
CREATE TRIGGER TR_organization_mappings_updated_at
ON organization_mappings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE organization_mappings
    SET updated_at = GETUTCDATE()
    FROM organization_mappings om
    INNER JOIN inserted i ON om.id = i.id;
END;
GO

-- =============================================
-- Helper Views
-- =============================================

-- View for Alto integrations
CREATE VIEW vw_alto_organizations AS
SELECT
    id,
    organization_name,
    environment,
    JSON_VALUE(integration_credentials, '$.alto.agencyRef') AS alto_agency_ref,
    JSON_VALUE(integration_credentials, '$.alto.branchId') AS alto_branch_id,
    legacy_member_id,
    legacy_branch_id,
    sf_member_id,
    sf_branch_id,
    sf_region,
    sf_scheme_type,
    sf_auth_method,
    tds_provider_preference,
    is_active,
    created_at,
    updated_at
FROM organization_mappings
WHERE integration_type = 'alto' AND is_active = 1;
GO

-- =============================================
-- Verification Query
-- =============================================

SELECT
    id,
    organization_name,
    environment,
    integration_type,
    integration_credentials,
    legacy_member_id,
    sf_member_id,
    sf_auth_method,
    tds_provider_preference,
    is_active,
    created_at
FROM organization_mappings
ORDER BY created_at DESC;
GO

-- =============================================
-- Rollback Script (if needed)
-- =============================================
-- WARNING: This will delete all organization mappings
--
-- DROP VIEW IF EXISTS vw_alto_organizations;
-- GO
-- DROP TABLE IF EXISTS organization_mappings;
-- GO
--
-- Then re-run migration 001_create_organization_mappings.sql
-- =============================================
