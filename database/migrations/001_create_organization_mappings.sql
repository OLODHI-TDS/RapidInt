-- =============================================
-- Organization Mappings Table
-- =============================================
-- Purpose: Maps Alto agencies to TDS organization credentials
-- Supports per-organization TDS API provider preferences
-- API keys are encrypted at rest using AES-256-CBC
-- =============================================

-- Create table
CREATE TABLE organization_mappings (
    -- Primary key
    id INT IDENTITY(1,1) PRIMARY KEY,

    -- Alto identifiers (composite unique key)
    alto_agency_ref NVARCHAR(100) NOT NULL,
    alto_branch_id NVARCHAR(100) NOT NULL,

    -- TDS credentials
    tds_member_id NVARCHAR(50) NOT NULL,
    tds_branch_id NVARCHAR(50) NOT NULL,
    tds_api_key_encrypted NVARCHAR(500) NOT NULL, -- Encrypted: iv:encrypted_value

    -- TDS configuration
    region NVARCHAR(20) NOT NULL, -- 'EW', 'Scotland', 'NI'
    scheme_type NVARCHAR(20) NOT NULL DEFAULT 'Custodial', -- 'Custodial' or 'Insured'

    -- Provider preference
    tds_provider_preference NVARCHAR(20) NOT NULL DEFAULT 'auto', -- 'current', 'salesforce', 'auto'

    -- Organization details
    organization_name NVARCHAR(200) NOT NULL,
    organization_contact_email NVARCHAR(200) NULL,
    organization_contact_phone NVARCHAR(50) NULL,

    -- Status and audit
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(100) NULL,
    updated_by NVARCHAR(100) NULL,

    -- Notes
    notes NVARCHAR(MAX) NULL,

    -- Constraints
    CONSTRAINT UK_organization_mappings_alto UNIQUE (alto_agency_ref, alto_branch_id),
    CONSTRAINT CK_organization_mappings_region CHECK (region IN ('EW', 'Scotland', 'NI')),
    CONSTRAINT CK_organization_mappings_scheme_type CHECK (scheme_type IN ('Custodial', 'Insured')),
    CONSTRAINT CK_organization_mappings_provider CHECK (tds_provider_preference IN ('current', 'salesforce', 'auto'))
);
GO

-- Create indexes for performance
CREATE INDEX IX_organization_mappings_alto_ref
    ON organization_mappings(alto_agency_ref, alto_branch_id)
    WHERE is_active = 1;
GO

CREATE INDEX IX_organization_mappings_active
    ON organization_mappings(is_active, tds_provider_preference);
GO

CREATE INDEX IX_organization_mappings_provider
    ON organization_mappings(tds_provider_preference)
    WHERE is_active = 1;
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
-- Seed Data (Test Organization)
-- =============================================
-- Example Organization Mapping (COMMENTED OUT)
-- =============================================
-- Uncomment and modify this template to add your first organization.
--
-- IMPORTANT: Encrypt the API key BEFORE inserting:
--   1. Run: node
--   2. const { encryptApiKey } = require('./azure-functions/shared-services/shared/organization-credentials');
--   3. process.env.ENCRYPTION_SECRET = 'your-32-char-key';
--   4. encryptApiKey('YOUR_TDS_API_KEY').then(console.log);
--   5. Copy the encrypted output and paste it below
--
-- INSERT INTO organization_mappings (
--     alto_agency_ref,
--     alto_branch_id,
--     tds_member_id,
--     tds_branch_id,
--     tds_api_key_encrypted,
--     region,
--     scheme_type,
--     tds_provider_preference,
--     organization_name,
--     organization_contact_email,
--     is_active,
--     created_by,
--     notes
-- ) VALUES (
--     '1af89d60-662c-475b-bcc8-9bcbf04b6322', -- Your Alto agency ref
--     'main', -- Branch ID
--     '1960473', -- Your TDS Member ID
--     '1960473', -- Your TDS Branch ID
--     'ENCRYPTED_KEY_HERE', -- Output from encryptApiKey()
--     'EW', -- Region: 'EW', 'Scotland', or 'NI'
--     'Custodial', -- Scheme type
--     'current', -- Provider: 'current', 'salesforce', or 'dual'
--     'Your Organization Name',
--     'contact@yourcompany.com',
--     1, -- Active: 1 = Yes, 0 = No
--     'ADMIN',
--     'Organization setup'
-- );
-- GO

-- =============================================
-- Verification Query
-- =============================================
-- Run this to verify the table was created successfully
-- =============================================

SELECT
    id,
    alto_agency_ref,
    alto_branch_id,
    tds_member_id,
    organization_name,
    region,
    scheme_type,
    tds_provider_preference,
    is_active,
    created_at
FROM organization_mappings
ORDER BY created_at DESC;
GO

-- =============================================
-- Rollback Script (if needed)
-- =============================================
-- DROP TABLE IF EXISTS organization_mappings;
-- =============================================
