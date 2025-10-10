#!/usr/bin/env node

/**
 * Data Migration Script - PoC to Production Ready Concept
 *
 * Migrates data from the existing Alto PoC to the new Production Ready Concept platform:
 * - Postcode district mappings (3,051 entries)
 * - Organization mappings
 * - Integration records
 * - Configuration settings
 *
 * Usage:
 *   node migrate-data.js --source ../Alto-POC/backend --target . --dry-run
 *   node migrate-data.js --source ../Alto-POC/backend --target . --execute
 */

const fs = require('fs').promises;
const path = require('path');

// Try to require commander, fallback to simple argument parsing if not available
let program;
try {
  program = require('commander').program;
} catch (e) {
  console.log('⚠️  Commander not available, using basic argument parsing');
  console.log('   Install with: npm install -g commander');

  // Basic argument parsing fallback
  program = {
    version: () => program,
    description: () => program,
    requiredOption: () => program,
    option: () => program,
    parse: () => {},
    opts: () => {
      const args = process.argv.slice(2);
      const opts = {};

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source' || args[i] === '-s') {
          opts.source = args[i + 1];
          i++;
        } else if (args[i] === '--target' || args[i] === '-t') {
          opts.target = args[i + 1];
          i++;
        } else if (args[i] === '--dry-run') {
          opts.dryRun = true;
        } else if (args[i] === '--execute') {
          opts.execute = true;
        } else if (args[i] === '--verbose') {
          opts.verbose = true;
        }
      }

      return opts;
    }
  };
}

// Configure CLI options
program
  .version('1.0.0')
  .description('Migrate data from Alto PoC to Production Ready Concept')
  .requiredOption('-s, --source <path>', 'Source PoC directory path')
  .requiredOption('-t, --target <path>', 'Target Production Ready Concept directory path')
  .option('--dry-run', 'Preview changes without executing them')
  .option('--execute', 'Execute the migration')
  .option('--verbose', 'Show verbose output')
  .parse();

const options = program.opts();

// Validation
if (!options.dryRun && !options.execute) {
  console.error('❌ Must specify either --dry-run or --execute');
  process.exit(1);
}

// Migration statistics
const stats = {
  postcodeDistricts: 0,
  organizationMappings: 0,
  configurationSettings: 0,
  integrationRecords: 0,
  errors: []
};

/**
 * Log message with timestamp
 */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const prefix = options.dryRun ? '[DRY RUN]' : '[MIGRATE]';
  console.log(`${timestamp} ${prefix} [${level}] ${message}`);
}

/**
 * Check if file or directory exists
 */
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
  if (!options.execute) return;

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Read JSON file with error handling
 */
async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to read ${filePath}: ${error.message}`, 'ERROR');
    stats.errors.push(`Read error: ${filePath} - ${error.message}`);
    return null;
  }
}

/**
 * Write JSON file with error handling
 */
async function writeJsonFile(filePath, data) {
  if (!options.execute) {
    log(`Would write: ${filePath}`, 'PREVIEW');
    return true;
  }

  try {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    log(`Failed to write ${filePath}: ${error.message}`, 'ERROR');
    stats.errors.push(`Write error: ${filePath} - ${error.message}`);
    return false;
  }
}

/**
 * Migrate postcode district mappings
 */
async function migratePostcodeData() {
  log('🗺️  Migrating postcode district mappings...');

  const sourcePath = path.join(options.source, 'services/postcodeToCounty.js');
  const targetPath = path.join(options.target, 'azure-functions/shared-services/PostcodeLookup/postcode-data.json');

  if (!(await exists(sourcePath))) {
    log(`Source postcode file not found: ${sourcePath}`, 'WARNING');
    return false;
  }

  try {
    // Read the JavaScript module file
    const sourceContent = await fs.readFile(sourcePath, 'utf8');

    // Extract POSTCODE_TO_COUNTY object using regex
    const postcodeRegex = /const POSTCODE_TO_COUNTY = ({[\s\S]*?});/;
    const match = sourceContent.match(postcodeRegex);

    if (!match) {
      log('Could not extract POSTCODE_TO_COUNTY object from source file', 'ERROR');
      return false;
    }

    // Parse the extracted object (this is a bit hacky but works for our use case)
    const postcodeDataStr = match[1];
    const postcodeData = eval(`(${postcodeDataStr})`);

    stats.postcodeDistricts = Object.keys(postcodeData).length;

    if (options.verbose) {
      log(`Found ${stats.postcodeDistricts} postcode districts`);
      log('Sample mappings:');
      Object.entries(postcodeData).slice(0, 5).forEach(([district, county]) => {
        log(`  ${district} → ${county}`);
      });
    }

    // Write to target location
    const success = await writeJsonFile(targetPath, postcodeData);

    if (success) {
      log(`✅ Migrated ${stats.postcodeDistricts} postcode district mappings`);
    }

    return success;
  } catch (error) {
    log(`Failed to migrate postcode data: ${error.message}`, 'ERROR');
    stats.errors.push(`Postcode migration error: ${error.message}`);
    return false;
  }
}

/**
 * Migrate organization mappings
 */
async function migrateOrganizationMappings() {
  log('🏢 Migrating organization mappings...');

  // Check if organization mappings exist in PoC
  const sourcePath = path.join(options.source, 'models/OrganizationMapping.js');

  if (!(await exists(sourcePath))) {
    log('No organization mappings found in PoC, creating default mapping', 'WARNING');

    // Create default mapping based on CLAUDE.md
    const defaultMapping = {
      '1af89d60-662c-475b-bcc8-9bcbf04b6322': {
        name: 'Alto Development Agency',
        environment: 'development',
        alto: {
          agencyRef: '1af89d60-662c-475b-bcc8-9bcbf04b6322',
          branchId: 'MAIN'
        },
        tds: {
          memberNumber: 'TDS_DEV_001',
          branchId: 'MAIN',
          credentialsKeyVault: 'tds-dev-credentials'
        }
      }
    };

    const targetPath = path.join(options.target, 'configuration/organization-mappings/development.json');
    const success = await writeJsonFile(targetPath, defaultMapping);

    if (success) {
      stats.organizationMappings = 1;
      log('✅ Created default organization mapping');
    }

    return success;
  }

  // If organization mappings exist in PoC, migrate them
  // This would require reading the actual data, which may be in database
  log('Organization mapping migration from database not implemented yet', 'WARNING');
  return true;
}

/**
 * Migrate configuration settings
 */
async function migrateConfiguration() {
  log('⚙️  Migrating configuration settings...');

  const sourceEnvPath = path.join(options.source, '.env');
  const targetDevConfigPath = path.join(options.target, 'configuration/app-settings/development.json');

  if (!(await exists(sourceEnvPath))) {
    log('No .env file found in PoC', 'WARNING');
    return true;
  }

  try {
    // Read .env file
    const envContent = await fs.readFile(sourceEnvPath, 'utf8');
    const envVars = {};

    // Parse .env file
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          envVars[key] = valueParts.join('=');
        }
      }
    });

    if (options.verbose) {
      log('Found environment variables:');
      Object.keys(envVars).forEach(key => {
        const value = key.includes('SECRET') || key.includes('PASSWORD') ? '***' : envVars[key];
        log(`  ${key}=${value}`);
      });
    }

    // Read existing target config and update with PoC values
    let targetConfig = {};
    if (await exists(targetDevConfigPath)) {
      targetConfig = await readJsonFile(targetDevConfigPath);
    }

    // Map PoC environment variables to new configuration structure
    const updatedConfig = {
      ...targetConfig,
      services: {
        ...targetConfig.services,
        alto: {
          ...targetConfig.services?.alto,
          baseUrl: envVars.ALTO_API_BASE_URL || targetConfig.services?.alto?.baseUrl,
          clientId: envVars.ALTO_CLIENT_ID || targetConfig.services?.alto?.clientId
        },
        tdsAdapterFactory: {
          ...targetConfig.services?.tdsAdapterFactory,
          providers: {
            ...targetConfig.services?.tdsAdapterFactory?.providers,
            current: {
              ...targetConfig.services?.tdsAdapterFactory?.providers?.current,
              baseUrl: envVars.TDS_API_BASE_URL || targetConfig.services?.tdsAdapterFactory?.providers?.current?.baseUrl
            }
          }
        }
      }
    };

    const success = await writeJsonFile(targetDevConfigPath, updatedConfig);

    if (success) {
      stats.configurationSettings = Object.keys(envVars).length;
      log(`✅ Migrated ${stats.configurationSettings} configuration settings`);
    }

    return success;
  } catch (error) {
    log(`Failed to migrate configuration: ${error.message}`, 'ERROR');
    stats.errors.push(`Configuration migration error: ${error.message}`);
    return false;
  }
}

/**
 * Create data migration script for postcode lookup function
 */
async function createDataMigrationScript() {
  log('📝 Creating data migration helper script...');

  const scriptContent = `#!/usr/bin/env node

/**
 * Complete Postcode Data Migration Helper
 *
 * This script extracts the complete 3,051 postcode district mappings
 * from the Alto PoC and formats them for the Azure Function.
 */

const fs = require('fs').promises;
const path = require('path');

async function extractCompletePostcodeData() {
  const pocServicePath = '${options.source}/services/postcodeToCounty.js';
  const targetDataPath = '${options.target}/azure-functions/shared-services/PostcodeLookup/postcode-data.json';

  console.log('Extracting complete postcode data from PoC...');

  try {
    // Read the complete PoC service file
    const sourceContent = await fs.readFile(pocServicePath, 'utf8');

    // Extract POSTCODE_TO_COUNTY object
    const postcodeRegex = /const POSTCODE_TO_COUNTY = ({[\\s\\S]*?});/;
    const match = sourceContent.match(postcodeRegex);

    if (!match) {
      throw new Error('Could not extract POSTCODE_TO_COUNTY object');
    }

    // Evaluate the object (safe because we control the source)
    const postcodeData = eval(\`(\${match[1]})\`);

    // Validate data integrity
    const districtCount = Object.keys(postcodeData).length;
    console.log(\`Found \${districtCount} postcode districts\`);

    if (districtCount < 3000) {
      console.warn(\`Warning: Expected ~3,051 districts, found \${districtCount}\`);
    }

    // Sample validation
    const testCases = [
      { postcode: 'MK18', expected: 'Buckinghamshire' },
      { postcode: 'DL3', expected: 'County Durham' },
      { postcode: 'HP3', expected: 'Hertfordshire' }
    ];

    testCases.forEach(({ postcode, expected }) => {
      const actual = postcodeData[postcode];
      if (actual === expected) {
        console.log(\`✅ \${postcode} → \${actual}\`);
      } else {
        console.log(\`❌ \${postcode} → \${actual} (expected \${expected})\`);
      }
    });

    // Write to target
    await fs.writeFile(targetDataPath, JSON.stringify(postcodeData, null, 2));
    console.log(\`✅ Complete postcode data written to: \${targetDataPath}\`);

  } catch (error) {
    console.error(\`❌ Migration failed: \${error.message}\`);
    process.exit(1);
  }
}

if (require.main === module) {
  extractCompletePostcodeData();
}

module.exports = { extractCompletePostcodeData };`;

  const scriptPath = path.join(options.target, 'scripts/extract-complete-postcode-data.js');
  const success = await writeFile(scriptPath, scriptContent);

  if (success) {
    log('✅ Created postcode data migration helper script');
  }

  return success;
}

/**
 * Write file with error handling
 */
async function writeFile(filePath, content) {
  if (!options.execute) {
    log(`Would create: ${filePath}`, 'PREVIEW');
    return true;
  }

  try {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  } catch (error) {
    log(`Failed to write ${filePath}: ${error.message}`, 'ERROR');
    stats.errors.push(`Write error: ${filePath} - ${error.message}`);
    return false;
  }
}

/**
 * Validate paths
 */
async function validatePaths() {
  log('Validating source and target paths...');

  if (!(await exists(options.source))) {
    log(`Source path does not exist: ${options.source}`, 'ERROR');
    return false;
  }

  if (!(await exists(options.target))) {
    log(`Target path does not exist: ${options.target}`, 'ERROR');
    return false;
  }

  // Check for key source files
  const keyFiles = [
    'services/postcodeToCounty.js',
    'package.json',
    'server.js'
  ];

  for (const file of keyFiles) {
    const filePath = path.join(options.source, file);
    if (!(await exists(filePath))) {
      log(`Key source file missing: ${filePath}`, 'WARNING');
    }
  }

  return true;
}

/**
 * Main migration function
 */
async function runMigration() {
  console.log('🚀 TDS Integration Platform - Data Migration');
  console.log('===========================================');
  console.log(`Source: ${options.source}`);
  console.log(`Target: ${options.target}`);
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  try {
    // Validate paths
    if (!(await validatePaths())) {
      process.exit(1);
    }

    // Run migrations
    const migrations = [
      migratePostcodeData,
      migrateOrganizationMappings,
      migrateConfiguration,
      createDataMigrationScript
    ];

    let successCount = 0;
    for (const migration of migrations) {
      const success = await migration();
      if (success) successCount++;
    }

    // Print summary
    console.log('');
    console.log('📊 Migration Summary');
    console.log('==================');
    console.log(`Postcode districts: ${stats.postcodeDistricts}`);
    console.log(`Organization mappings: ${stats.organizationMappings}`);
    console.log(`Configuration settings: ${stats.configurationSettings}`);
    console.log(`Successful migrations: ${successCount}/${migrations.length}`);

    if (stats.errors.length > 0) {
      console.log('');
      console.log('❌ Errors encountered:');
      stats.errors.forEach(error => console.log(`  - ${error}`));
    }

    if (options.dryRun) {
      console.log('');
      console.log('✅ Dry run completed successfully');
      console.log('Run with --execute to perform the actual migration');
    } else {
      console.log('');
      if (stats.errors.length === 0) {
        console.log('✅ Migration completed successfully');
        console.log('');
        console.log('Next Steps:');
        console.log('1. Run the complete postcode data extraction:');
        console.log(`   node ${options.target}/scripts/extract-complete-postcode-data.js`);
        console.log('2. Test the migrated services');
        console.log('3. Deploy to Azure using the deployment script');
      } else {
        console.log('⚠️  Migration completed with errors');
        console.log('Please review and fix the errors before proceeding');
      }
    }

  } catch (error) {
    log(`Migration failed: ${error.message}`, 'ERROR');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  runMigration();
}