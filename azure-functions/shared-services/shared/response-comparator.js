/**
 * Response Comparator Service
 *
 * Deep comparison utilities for comparing legacy (current) and Salesforce API responses
 * Supports:
 * - Field-by-field deep comparison
 * - Recursive difference detection
 * - Difference significance ranking
 * - Detailed comparison reporting
 * - Performance comparison
 */

/**
 * Deep compare two API responses
 * @param {Object} legacyResponse - Response from current/legacy API
 * @param {Object} salesforceResponse - Response from Salesforce API
 * @returns {Object} - Comparison result with differences and match percentage
 */
function deepCompare(legacyResponse, salesforceResponse) {
  if (!legacyResponse || !salesforceResponse) {
    return {
      match: false,
      differences: [{
        path: 'root',
        type: 'missing',
        legacy: legacyResponse,
        salesforce: salesforceResponse,
        significance: 'critical'
      }],
      matchPercentage: 0
    };
  }

  // Detect all differences recursively
  const differences = detectDifferences(legacyResponse, salesforceResponse, '');

  // Calculate match percentage
  const totalFields = countFields(legacyResponse) + countFields(salesforceResponse);
  const diffFieldCount = differences.length;
  const matchPercentage = totalFields > 0
    ? Math.round(((totalFields - diffFieldCount) / totalFields) * 100)
    : 100;

  // Rank differences by significance
  const rankedDifferences = rankSignificance(differences);

  return {
    match: differences.length === 0,
    differences: rankedDifferences,
    matchPercentage,
    totalFields,
    differenceCount: diffFieldCount,
    criticalDifferences: rankedDifferences.filter(d => d.significance === 'critical').length,
    importantDifferences: rankedDifferences.filter(d => d.significance === 'important').length,
    cosmeticDifferences: rankedDifferences.filter(d => d.significance === 'cosmetic').length
  };
}

/**
 * Recursively detect differences between two objects
 * @param {*} obj1 - First object (legacy response)
 * @param {*} obj2 - Second object (Salesforce response)
 * @param {string} path - Current path in object tree
 * @returns {Array} - Array of difference objects
 */
function detectDifferences(obj1, obj2, path) {
  const differences = [];

  // Handle null/undefined cases
  if (obj1 === null && obj2 === null) return [];
  if (obj1 === undefined && obj2 === undefined) return [];

  if (obj1 === null || obj1 === undefined) {
    differences.push({
      path: path || 'root',
      type: 'missing_in_legacy',
      legacy: obj1,
      salesforce: obj2
    });
    return differences;
  }

  if (obj2 === null || obj2 === undefined) {
    differences.push({
      path: path || 'root',
      type: 'missing_in_salesforce',
      legacy: obj1,
      salesforce: obj2
    });
    return differences;
  }

  // Handle type differences
  const type1 = getType(obj1);
  const type2 = getType(obj2);

  if (type1 !== type2) {
    differences.push({
      path: path || 'root',
      type: 'type_mismatch',
      legacy: obj1,
      salesforce: obj2,
      legacyType: type1,
      salesforceType: type2
    });
    return differences;
  }

  // Handle primitive types
  if (type1 === 'string' || type1 === 'number' || type1 === 'boolean') {
    if (obj1 !== obj2) {
      // Special handling for numeric strings
      if (type1 === 'string' && !isNaN(obj1) && !isNaN(obj2)) {
        if (parseFloat(obj1) === parseFloat(obj2)) {
          // Same numeric value, just different string representation
          return differences;
        }
      }

      differences.push({
        path: path || 'root',
        type: 'value_mismatch',
        legacy: obj1,
        salesforce: obj2
      });
    }
    return differences;
  }

  // Handle arrays
  if (type1 === 'array') {
    if (obj1.length !== obj2.length) {
      differences.push({
        path: path || 'root',
        type: 'array_length_mismatch',
        legacy: obj1,
        salesforce: obj2,
        legacyLength: obj1.length,
        salesforceLength: obj2.length
      });
    }

    // Compare array elements
    const maxLength = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLength; i++) {
      const itemPath = `${path}[${i}]`;
      const item1 = i < obj1.length ? obj1[i] : undefined;
      const item2 = i < obj2.length ? obj2[i] : undefined;

      const itemDiffs = detectDifferences(item1, item2, itemPath);
      differences.push(...itemDiffs);
    }

    return differences;
  }

  // Handle objects
  if (type1 === 'object') {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    const allKeys = new Set([...keys1, ...keys2]);

    for (const key of allKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      const value1 = obj1[key];
      const value2 = obj2[key];

      if (!(key in obj1)) {
        differences.push({
          path: fieldPath,
          type: 'missing_in_legacy',
          legacy: undefined,
          salesforce: value2
        });
      } else if (!(key in obj2)) {
        differences.push({
          path: fieldPath,
          type: 'missing_in_salesforce',
          legacy: value1,
          salesforce: undefined
        });
      } else {
        // Recursively compare nested objects
        const nestedDiffs = detectDifferences(value1, value2, fieldPath);
        differences.push(...nestedDiffs);
      }
    }

    return differences;
  }

  return differences;
}

/**
 * Rank differences by significance
 * @param {Array} differences - Array of difference objects
 * @returns {Array} - Differences with significance levels added
 */
function rankSignificance(differences) {
  return differences.map(diff => {
    let significance = 'cosmetic';

    // Critical fields that affect business logic
    const criticalFields = [
      'batchId',
      'dan',
      'status',
      'error',
      'errors',
      'success',
      'depositId',
      'tenancyId',
      'amount',
      'depositAmount'
    ];

    // Important fields that should match but may have format differences
    const importantFields = [
      'propertyAddress',
      'tenantName',
      'landlordName',
      'startDate',
      'endDate',
      'branchId',
      'memberId'
    ];

    // Check if the path contains critical fields
    const pathLower = diff.path.toLowerCase();
    const isCritical = criticalFields.some(field =>
      pathLower.includes(field.toLowerCase())
    );
    const isImportant = importantFields.some(field =>
      pathLower.includes(field.toLowerCase())
    );

    if (isCritical) {
      significance = 'critical';
    } else if (isImportant) {
      significance = 'important';
    } else if (diff.type === 'type_mismatch') {
      // Type mismatches are always at least important
      significance = 'important';
    } else if (diff.type === 'missing_in_legacy' || diff.type === 'missing_in_salesforce') {
      // Missing fields are important unless they're null/undefined in both
      if (diff.legacy === null || diff.legacy === undefined ||
          diff.salesforce === null || diff.salesforce === undefined) {
        significance = 'cosmetic';
      } else {
        significance = 'important';
      }
    }

    return {
      ...diff,
      significance
    };
  });
}

/**
 * Generate detailed comparison report
 * @param {Object} legacyResult - Complete result from legacy API call
 * @param {Object} salesforceResult - Complete result from Salesforce API call
 * @returns {Object} - Detailed comparison report
 */
function generateComparisonReport(legacyResult, salesforceResult) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      bothSucceeded: false,
      bothFailed: false,
      onlyLegacySucceeded: false,
      onlySalesforceSucceeded: false,
      responseMatch: false
    },
    legacy: {
      success: legacyResult?.success || false,
      status: legacyResult?.status || 'unknown',
      batchId: legacyResult?.batchId || null,
      error: legacyResult?.error || null,
      duration: legacyResult?.duration || null
    },
    salesforce: {
      success: salesforceResult?.success || false,
      status: salesforceResult?.status || 'unknown',
      batchId: salesforceResult?.batchId || null,
      error: salesforceResult?.error || null,
      duration: salesforceResult?.duration || null
    },
    comparison: null,
    recommendation: ''
  };

  // Determine success states
  const legacySuccess = report.legacy.success;
  const salesforceSuccess = report.salesforce.success;

  report.summary.bothSucceeded = legacySuccess && salesforceSuccess;
  report.summary.bothFailed = !legacySuccess && !salesforceSuccess;
  report.summary.onlyLegacySucceeded = legacySuccess && !salesforceSuccess;
  report.summary.onlySalesforceSucceeded = !legacySuccess && salesforceSuccess;

  // Compare responses if both succeeded
  if (report.summary.bothSucceeded) {
    report.comparison = deepCompare(
      legacyResult.response || legacyResult.data,
      salesforceResult.response || salesforceResult.data
    );
    report.summary.responseMatch = report.comparison.match;
  }

  // Performance comparison
  report.performance = comparePerformance(
    report.legacy.duration,
    report.salesforce.duration
  );

  // Generate recommendation
  report.recommendation = generateRecommendation(report);

  return report;
}

/**
 * Compare performance metrics
 * @param {number} legacyDuration - Legacy API call duration in ms
 * @param {number} salesforceDuration - Salesforce API call duration in ms
 * @returns {Object} - Performance comparison
 */
function comparePerformance(legacyDuration, salesforceDuration) {
  if (!legacyDuration || !salesforceDuration) {
    return {
      comparison: 'incomplete',
      legacyDuration,
      salesforceDuration,
      difference: null,
      percentageDifference: null
    };
  }

  const difference = salesforceDuration - legacyDuration;
  const percentageDifference = Math.round((difference / legacyDuration) * 100);

  let verdict = 'similar';
  if (percentageDifference < -10) {
    verdict = 'salesforce_faster';
  } else if (percentageDifference > 10) {
    verdict = 'legacy_faster';
  }

  return {
    comparison: verdict,
    legacyDuration,
    salesforceDuration,
    difference,
    percentageDifference,
    verdict
  };
}

/**
 * Generate migration recommendation based on comparison report
 * @param {Object} report - Comparison report
 * @returns {string} - Recommendation text
 */
function generateRecommendation(report) {
  if (report.summary.bothFailed) {
    return 'Both APIs failed - investigate root cause before proceeding';
  }

  if (report.summary.onlyLegacySucceeded) {
    return 'Only legacy API succeeded - Salesforce API needs investigation';
  }

  if (report.summary.onlySalesforceSucceeded) {
    return 'Only Salesforce API succeeded - this is unexpected, investigate legacy API';
  }

  if (!report.summary.bothSucceeded) {
    return 'Unable to compare - both APIs must succeed';
  }

  // Both succeeded - analyze differences
  const { comparison } = report;

  if (comparison.match) {
    return 'Perfect match - safe to migrate';
  }

  if (comparison.criticalDifferences > 0) {
    return `Critical differences found (${comparison.criticalDifferences}) - do not migrate yet`;
  }

  if (comparison.importantDifferences > 0) {
    return `Important differences found (${comparison.importantDifferences}) - review carefully before migration`;
  }

  if (comparison.cosmeticDifferences > 0) {
    return `Only cosmetic differences (${comparison.cosmeticDifferences}) - likely safe to migrate`;
  }

  return 'Unable to generate recommendation';
}

/**
 * Get the type of a value
 * @param {*} value - Value to check
 * @returns {string} - Type name
 */
function getType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Count total fields in an object (recursive)
 * @param {*} obj - Object to count fields in
 * @returns {number} - Total field count
 */
function countFields(obj) {
  if (obj === null || obj === undefined) return 0;

  const type = getType(obj);

  if (type === 'object') {
    let count = 0;
    for (const key in obj) {
      count += 1 + countFields(obj[key]);
    }
    return count;
  }

  if (type === 'array') {
    return obj.reduce((sum, item) => sum + countFields(item), 0);
  }

  return 1; // Primitive type counts as 1 field
}

module.exports = {
  deepCompare,
  detectDifferences,
  rankSignificance,
  generateComparisonReport,
  comparePerformance
};
