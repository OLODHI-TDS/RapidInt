/**
 * Azure Function: Comparison Metrics
 *
 * Provides metrics and analytics endpoints for API versioning comparison data
 * Supports migration readiness assessment and quality tracking
 *
 * Endpoints:
 * - GET /api/comparison-metrics - Overall comparison statistics
 * - GET /api/comparison-metrics/organization/{agencyRef} - Org-specific metrics
 * - GET /api/comparison-metrics/recent - Last 100 dual-mode executions
 * - GET /api/comparison-metrics/differences - Common difference patterns
 * - GET /api/comparison-metrics/readiness/{agencyRef} - Migration readiness score
 *
 * Features:
 * - Real-time migration readiness scoring
 * - Trend analysis for comparison results
 * - Difference pattern detection
 * - Performance comparison metrics
 * - Organization-specific readiness assessment
 */

const { app } = require('@azure/functions');
const { getConnectionPool } = require('../shared/organization-credentials');
const telemetry = require('../shared/telemetry');
const { checkRateLimit } = require('../shared/rate-limiter');
const { validateQueryParams, validateAgencyRef, formatValidationError } = require('../shared/validation-schemas');

/**
 * Get overall comparison statistics
 * @param {Object} context - Azure Function context
 * @param {number} days - Number of days to look back (default 30)
 * @returns {Promise<Object>} - Overall statistics
 */
async function getOverallStatistics(context, days = 30) {
  try {
    context.log(`Retrieving overall comparison statistics for last ${days} days`);

    const pool = await getConnectionPool();
    const request = pool.request();

    const query = `
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
      WHERE timestamp >= DATEADD(DAY, -@days, GETUTCDATE());
    `;

    request.input('days', days);
    const result = await request.query(query);

    const stats = result.recordset[0];

    // Calculate success rates
    const totalComparisons = stats.total_comparisons || 0;
    const successRate = totalComparisons > 0
      ? Math.round((stats.both_succeeded_count / totalComparisons) * 100)
      : 0;
    const perfectMatchRate = totalComparisons > 0
      ? Math.round((stats.perfect_matches / totalComparisons) * 100)
      : 0;

    // Calculate performance metrics
    const avgLegacy = stats.avg_legacy_duration || 0;
    const avgSalesforce = stats.avg_salesforce_duration || 0;
    const performanceDelta = avgSalesforce - avgLegacy;
    const performanceDeltaPct = avgLegacy > 0
      ? Math.round((performanceDelta / avgLegacy) * 100)
      : 0;

    return {
      period: {
        days,
        start: stats.first_comparison,
        end: stats.last_comparison
      },
      summary: {
        totalComparisons,
        bothSucceededCount: stats.both_succeeded_count || 0,
        onlyLegacyCount: stats.only_legacy_count || 0,
        onlySalesforceCount: stats.only_salesforce_count || 0,
        bothFailedCount: stats.both_failed_count || 0,
        successRate
      },
      quality: {
        perfectMatches: stats.perfect_matches || 0,
        perfectMatchRate,
        avgMatchPercentage: Math.round(stats.avg_match_percentage || 0),
        criticalIssues: stats.critical_issues || 0,
        importantIssues: stats.important_issues || 0,
        cosmeticIssues: stats.cosmetic_issues || 0
      },
      performance: {
        avgLegacyDuration: Math.round(avgLegacy),
        avgSalesforceDuration: Math.round(avgSalesforce),
        performanceDelta: Math.round(performanceDelta),
        performanceDeltaPct
      }
    };

  } catch (error) {
    context.error('Error retrieving overall statistics:', error);
    throw error;
  }
}

/**
 * Get organization-specific comparison metrics
 * @param {string} agencyRef - Alto agency reference
 * @param {Object} context - Azure Function context
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} - Organization-specific metrics
 */
async function getOrganizationMetrics(agencyRef, context, days = 30) {
  try {
    context.log(`Retrieving comparison metrics for organization: ${agencyRef}`);

    const pool = await getConnectionPool();
    const request = pool.request();

    const query = `
      SELECT
        om.id AS organization_id,
        om.organization_name,
        om.alto_agency_ref,
        om.tds_provider_preference,
        COUNT(cl.id) AS total_comparisons,
        COUNT(CASE WHEN cl.both_succeeded = 1 THEN 1 END) AS both_succeeded_count,
        COUNT(CASE WHEN cl.match_percentage = 100 THEN 1 END) AS perfect_matches,
        COUNT(CASE WHEN cl.critical_differences > 0 THEN 1 END) AS critical_difference_count,
        COUNT(CASE WHEN cl.important_differences > 0 THEN 1 END) AS important_difference_count,
        COUNT(CASE WHEN cl.cosmetic_differences > 0 THEN 1 END) AS cosmetic_difference_count,
        AVG(cl.match_percentage) AS avg_match_percentage,
        AVG(cl.legacy_duration_ms) AS avg_legacy_duration,
        AVG(cl.salesforce_duration_ms) AS avg_salesforce_duration,
        MIN(cl.timestamp) AS first_comparison,
        MAX(cl.timestamp) AS last_comparison
      FROM organization_mappings om
      LEFT JOIN comparison_log cl ON om.id = cl.organization_id
        AND cl.timestamp >= DATEADD(DAY, -@days, GETUTCDATE())
      WHERE om.alto_agency_ref = @agencyRef
        AND om.is_active = 1
      GROUP BY om.id, om.organization_name, om.alto_agency_ref, om.tds_provider_preference;
    `;

    request.input('agencyRef', agencyRef);
    request.input('days', days);
    const result = await request.query(query);

    if (!result.recordset || result.recordset.length === 0) {
      return {
        found: false,
        message: `Organization not found: ${agencyRef}`
      };
    }

    const org = result.recordset[0];

    // Calculate metrics
    const totalComparisons = org.total_comparisons || 0;
    const successRate = totalComparisons > 0
      ? Math.round((org.both_succeeded_count / totalComparisons) * 100)
      : 0;
    const perfectMatchRate = totalComparisons > 0
      ? Math.round((org.perfect_matches / totalComparisons) * 100)
      : 0;

    return {
      found: true,
      organization: {
        id: org.organization_id,
        name: org.organization_name,
        agencyRef: org.alto_agency_ref,
        providerPreference: org.tds_provider_preference
      },
      period: {
        days,
        start: org.first_comparison,
        end: org.last_comparison
      },
      summary: {
        totalComparisons,
        bothSucceededCount: org.both_succeeded_count || 0,
        successRate
      },
      quality: {
        perfectMatches: org.perfect_matches || 0,
        perfectMatchRate,
        avgMatchPercentage: Math.round(org.avg_match_percentage || 0),
        criticalDifferenceCount: org.critical_difference_count || 0,
        importantDifferenceCount: org.important_difference_count || 0,
        cosmeticDifferenceCount: org.cosmetic_difference_count || 0
      },
      performance: {
        avgLegacyDuration: Math.round(org.avg_legacy_duration || 0),
        avgSalesforceDuration: Math.round(org.avg_salesforce_duration || 0)
      }
    };

  } catch (error) {
    context.error('Error retrieving organization metrics:', error);
    throw error;
  }
}

/**
 * Get recent comparison executions
 * @param {Object} context - Azure Function context
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} - Recent comparison records
 */
async function getRecentComparisons(context, limit = 100) {
  try {
    context.log(`Retrieving ${limit} recent comparisons`);

    const pool = await getConnectionPool();
    const request = pool.request();

    const query = `
      SELECT TOP (@limit)
        cl.id,
        cl.timestamp,
        om.organization_name,
        om.alto_agency_ref,
        cl.batch_id,
        cl.execution_mode,
        cl.both_succeeded,
        cl.legacy_success,
        cl.salesforce_success,
        cl.match_percentage,
        cl.significance_level,
        cl.critical_differences,
        cl.important_differences,
        cl.cosmetic_differences,
        cl.legacy_duration_ms,
        cl.salesforce_duration_ms,
        cl.performance_difference_ms,
        cl.performance_difference_pct,
        cl.recommendation,
        DATEDIFF(MINUTE, cl.timestamp, GETUTCDATE()) AS age_minutes
      FROM comparison_log cl
      LEFT JOIN organization_mappings om ON cl.organization_id = om.id
      ORDER BY cl.timestamp DESC;
    `;

    request.input('limit', limit);
    const result = await request.query(query);

    return result.recordset.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      ageMinutes: row.age_minutes,
      organization: {
        name: row.organization_name,
        agencyRef: row.alto_agency_ref
      },
      batchId: row.batch_id,
      executionMode: row.execution_mode,
      success: {
        both: row.both_succeeded,
        legacy: row.legacy_success,
        salesforce: row.salesforce_success
      },
      quality: {
        matchPercentage: row.match_percentage,
        significanceLevel: row.significance_level,
        criticalDifferences: row.critical_differences,
        importantDifferences: row.important_differences,
        cosmeticDifferences: row.cosmetic_differences
      },
      performance: {
        legacyDuration: row.legacy_duration_ms,
        salesforceDuration: row.salesforce_duration_ms,
        difference: row.performance_difference_ms,
        differencePct: row.performance_difference_pct
      },
      recommendation: row.recommendation
    }));

  } catch (error) {
    context.error('Error retrieving recent comparisons:', error);
    throw error;
  }
}

/**
 * Get common difference patterns
 * @param {Object} context - Azure Function context
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Array>} - Difference patterns
 */
async function getDifferencePatterns(context, days = 30) {
  try {
    context.log(`Analyzing difference patterns for last ${days} days`);

    const pool = await getConnectionPool();
    const request = pool.request();

    const query = `
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
      WHERE timestamp >= DATEADD(DAY, -@days, GETUTCDATE())
        AND significance_level IS NOT NULL
      GROUP BY significance_level, execution_mode
      ORDER BY occurrence_count DESC;
    `;

    request.input('days', days);
    const result = await request.query(query);

    return result.recordset.map(row => ({
      significanceLevel: row.significance_level,
      executionMode: row.execution_mode,
      occurrenceCount: row.occurrence_count,
      avgMatchPercentage: Math.round(row.avg_match_percentage || 0),
      avgDifferences: {
        critical: Math.round(row.avg_critical_diff || 0),
        important: Math.round(row.avg_important_diff || 0),
        cosmetic: Math.round(row.avg_cosmetic_diff || 0)
      },
      firstSeen: row.first_seen,
      lastSeen: row.last_seen
    }));

  } catch (error) {
    context.error('Error analyzing difference patterns:', error);
    throw error;
  }
}

/**
 * Get migration readiness score for an organization
 * @param {string} agencyRef - Alto agency reference
 * @param {Object} context - Azure Function context
 * @returns {Promise<Object>} - Readiness assessment
 */
async function getMigrationReadiness(agencyRef, context) {
  try {
    context.log(`Calculating migration readiness for: ${agencyRef}`);

    const pool = await getConnectionPool();
    const request = pool.request();

    const query = `
      SELECT
        om.id AS organization_id,
        om.organization_name,
        om.alto_agency_ref,
        om.tds_provider_preference,
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
      WHERE om.alto_agency_ref = @agencyRef
        AND om.is_active = 1
      GROUP BY om.id, om.organization_name, om.alto_agency_ref, om.tds_provider_preference;
    `;

    request.input('agencyRef', agencyRef);
    const result = await request.query(query);

    if (!result.recordset || result.recordset.length === 0) {
      return {
        found: false,
        message: `Organization not found: ${agencyRef}`
      };
    }

    const org = result.recordset[0];

    // Determine blockers
    const blockers = [];
    if (org.total_comparisons === 0) {
      blockers.push('No comparison data available');
    }
    if (org.total_comparisons < 10) {
      blockers.push('Insufficient comparison samples (minimum 10 required)');
    }
    if (org.critical_difference_count > 0) {
      blockers.push(`${org.critical_difference_count} critical differences detected`);
    }
    if (org.avg_match_percentage < 90) {
      blockers.push(`Low match percentage: ${Math.round(org.avg_match_percentage)}% (minimum 90% required)`);
    }

    // Generate recommendations
    const recommendations = [];
    if (org.total_comparisons < 10) {
      recommendations.push('Run more dual-mode executions to gather sufficient data');
    }
    if (org.critical_difference_count > 0) {
      recommendations.push('Resolve all critical differences before migration');
    }
    if (org.important_difference_count > 0) {
      recommendations.push(`Review and address ${org.important_difference_count} important differences`);
    }
    if (org.avg_match_percentage >= 95 && org.total_comparisons >= 10) {
      recommendations.push('Organization is ready for migration to Salesforce API');
    } else if (org.avg_match_percentage >= 90 && org.total_comparisons >= 10) {
      recommendations.push('Almost ready - perform a few more validation runs');
    }

    return {
      found: true,
      organization: {
        id: org.organization_id,
        name: org.organization_name,
        agencyRef: org.alto_agency_ref,
        currentPreference: org.tds_provider_preference
      },
      readiness: {
        score: org.readiness_score,
        status: org.readiness_status,
        lastAssessment: new Date().toISOString()
      },
      data: {
        totalComparisons: org.total_comparisons,
        bothSucceededCount: org.both_succeeded_count,
        perfectMatches: org.perfect_matches,
        avgMatchPercentage: Math.round(org.avg_match_percentage || 0),
        criticalDifferenceCount: org.critical_difference_count,
        importantDifferenceCount: org.important_difference_count,
        lastComparison: org.last_comparison
      },
      blockers,
      recommendations
    };

  } catch (error) {
    context.error('Error calculating migration readiness:', error);
    throw error;
  }
}

/**
 * Azure Function HTTP Handler
 */
app.http('ComparisonMetrics', {
  methods: ['GET'],
  route: 'comparison-metrics/{action?}/{param?}',
  authLevel: 'function',
  handler: async (request, context) => {
    const startTime = Date.now();

    try {
      const action = request.params.action || 'overall';
      const param = request.params.param;

      // ✅ RATE LIMITING: Check for shared service
      const organizationId = request.headers.get('X-Organization-Id') || param || 'metrics-api';
      const rateLimitCheck = await checkRateLimit('shared', organizationId, context);

      if (!rateLimitCheck.allowed) {
        return {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': rateLimitCheck.limit.toString(),
            'Retry-After': rateLimitCheck.retryAfter.toString()
          },
          body: JSON.stringify({ error: 'Rate limit exceeded', message: rateLimitCheck.message })
        };
      }

      // ✅ SECURE: Parse and validate query parameters
      const queryParams = {};
      request.query.forEach((value, key) => {
        queryParams[key] = value;
      });

      // Validate query parameters using Joi schemas
      const validated = validateQueryParams(queryParams, ['days', 'limit']);
      const days = validated.days;
      const limit = validated.limit;

      context.log(`Comparison Metrics - Action: ${action}, Param: ${param}, Days: ${days}, Limit: ${limit}`);

      let data;

      switch (action) {
        case 'overall':
        case 'summary':
          // GET /api/comparison-metrics - Overall statistics
          data = await getOverallStatistics(context, days);
          break;

        case 'organization':
          // GET /api/comparison-metrics/organization/{agencyRef}
          if (!param) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                success: false,
                error: 'Organization agency reference is required'
              })
            };
          }
          // ✅ SECURE: Validate agency reference format
          const validatedOrgRef = validateAgencyRef(param);
          data = await getOrganizationMetrics(validatedOrgRef, context, days);
          break;

        case 'recent':
          // GET /api/comparison-metrics/recent
          data = await getRecentComparisons(context, limit);
          break;

        case 'differences':
        case 'patterns':
          // GET /api/comparison-metrics/differences
          data = await getDifferencePatterns(context, days);
          break;

        case 'readiness':
          // GET /api/comparison-metrics/readiness/{agencyRef}
          if (!param) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                success: false,
                error: 'Organization agency reference is required'
              })
            };
          }
          // ✅ SECURE: Validate agency reference format
          const validatedReadinessRef = validateAgencyRef(param);
          data = await getMigrationReadiness(validatedReadinessRef, context);
          break;

        default:
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: `Unknown action: ${action}`,
              availableActions: ['overall', 'organization', 'recent', 'differences', 'readiness']
            })
          };
      }

      const duration = Date.now() - startTime;

      // Track successful request
      telemetry.trackRequest(
        `metrics_${action}`,
        duration,
        true,
        'comparison',
        'analytics',
        {
          action,
          param: param || 'none',
          days: days.toString(),
          hasData: !!data
        }
      );

      // Track metrics query event
      telemetry.trackEvent('Metrics_Query', {
        action,
        param: param || 'none',
        duration: duration.toString()
      });

      // Track migration readiness if applicable
      if (action === 'readiness' && data.found && data.readiness) {
        telemetry.trackMigrationProgress(
          param,
          data.readiness.status.toLowerCase().replace(/[^a-z]/g, '_'),
          data.readiness.score
        );
      }

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Response-Time': `${duration}ms`
        },
        body: JSON.stringify({
          success: true,
          action,
          data,
          metadata: {
            timestamp: new Date().toISOString(),
            duration
          }
        })
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const action = request.params.action || 'unknown';
      const param = request.params.param || 'none';

      context.error('Comparison Metrics error:', error);

      // Track exception
      telemetry.trackException(error, {
        handler: 'ComparisonMetrics',
        action,
        param
      });

      // Track failed request
      telemetry.trackRequest(
        `metrics_${action}`,
        duration,
        false,
        'comparison',
        'error',
        {
          errorType: error.name,
          errorMessage: error.message
        }
      );

      // ✅ SECURE: Handle validation errors with clear messages
      if (error.name === 'ValidationError') {
        return {
          status: error.statusCode || 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formatValidationError(error),
            duration,
            metadata: {
              action,
              param
            }
          })
        };
      }

      // Generic error handling
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Failed to retrieve comparison metrics',
          message: error.message,
          duration,
          timestamp: new Date().toISOString()
        })
      };
    }
  }
});
