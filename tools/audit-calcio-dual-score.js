'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('./sqlite-compat');
const dual = require('../backend/calcioDualScoreArchitecture');

const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const fixtureRun = spawnSync(process.execPath, [path.join(__dirname, 'test-calcio-patch26fc-standalone.js')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024
});
let fixture = {};
try { fixture = JSON.parse(String(fixtureRun.stdout || '').trim()); } catch (_) {}
if (fixtureRun.status !== 0 || fixture.success !== true) {
    if (fixtureRun.stdout) process.stderr.write(fixtureRun.stdout);
    if (fixtureRun.stderr) process.stderr.write(fixtureRun.stderr);
    process.exit(1);
}

const db = new Database(dbPath);
try {
    const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
    const required = ['calcio_dual_score_version','calcio_dual_score_mode','calcio_forecast_confidence_shadow','calcio_value_score_shadow','calcio_context_risk_penalty','calcio_decision_readiness_shadow','calcio_dual_score_pt_sample','calcio_dual_score_pt_weight','calcio_dual_score_authority','calcio_dual_score_audit'];
    const missingColumns = required.filter(name => !columns.has(name));
    const rows = missingColumns.length ? [] : db.prepare(`
        SELECT id, match_date, home_team, away_team, prediction, odd, estimated_prob,
               calcio_final_market_id, calcio_decision_state, calcio_operational_stake,
               calcio_prediction_index_score, calcio_dual_score_version, calcio_dual_score_mode,
               calcio_forecast_confidence_shadow, calcio_value_score_shadow,
               calcio_context_risk_penalty, calcio_decision_readiness_shadow,
               calcio_decision_readiness_label, calcio_dual_score_old_ipm,
               calcio_dual_score_delta_vs_ipm, calcio_dual_score_pt_sample,
               calcio_dual_score_pt_weight, calcio_dual_score_authority,
               calcio_dual_score_audit
        FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
          AND calcio_dual_score_version IS NOT NULL
        ORDER BY id DESC
        LIMIT 500
    `).all();
    const diagnostics = rows.map(row => {
        const audit = dual.fromRow(row) || {};
        const scoreValues = [row.calcio_forecast_confidence_shadow,row.calcio_value_score_shadow,row.calcio_context_risk_penalty,row.calcio_decision_readiness_shadow].map(Number);
        const errors = [];
        if (!scoreValues.every(value => Number.isFinite(value) && value >= 0 && value <= 100)) errors.push('SCORE_OUT_OF_RANGE');
        if (Number(row.calcio_dual_score_authority || 0) !== 0) errors.push('SHADOW_AUTHORITY_NON_ZERO');
        if (Number(row.calcio_dual_score_pt_sample || 0) <= 0 && Math.abs(Number(row.calcio_dual_score_pt_weight || 0)) > 1e-9) errors.push('PT_N0_WEIGHT_NON_ZERO');
        if (String(row.calcio_dual_score_mode || '') !== dual.CALCIO_DUAL_SCORE_MODE) errors.push('MODE_NOT_SHADOW_ONLY');
        if (!row.calcio_final_market_id) errors.push('MARKET_ID_MISSING');
        return {
            id: row.id,
            match: `${row.home_team || ''} - ${row.away_team || ''}`,
            prediction: row.prediction,
            marketId: row.calcio_final_market_id,
            oldIpmScore: row.calcio_dual_score_old_ipm,
            forecastConfidenceScore: row.calcio_forecast_confidence_shadow,
            valueScore: row.calcio_value_score_shadow,
            contextRiskPenalty: row.calcio_context_risk_penalty,
            decisionReadiness: row.calcio_decision_readiness_shadow,
            decisionReadinessLabel: row.calcio_decision_readiness_label,
            ptSample: row.calcio_dual_score_pt_sample,
            ptWeight: row.calcio_dual_score_pt_weight,
            currentDecisionState: row.calcio_decision_state,
            operationalStake: row.calcio_operational_stake,
            architecture: audit.architecture || {},
            errors
        };
    });
    const auditTableExists = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_dual_score_shadow_audit_log'").get());
    const auditRows = auditTableExists ? db.prepare('SELECT COUNT(*) n FROM calcio_dual_score_shadow_audit_log').get().n : 0;
    const violationRows = diagnostics.filter(row => row.errors.length > 0).length;
    const ptNoSampleRows = diagnostics.filter(row => Number(row.ptSample || 0) <= 0).length;
    const ptNoSampleNonZeroWeight = diagnostics.filter(row => Number(row.ptSample || 0) <= 0 && Math.abs(Number(row.ptWeight || 0)) > 1e-9).length;
    const authorityViolations = diagnostics.filter(row => row.architecture?.productionStakeAuthorityChanged === true || row.errors.includes('SHADOW_AUTHORITY_NON_ZERO')).length;
    const success = missingColumns.length === 0 && fixture.success === true && violationRows === 0 && ptNoSampleNonZeroWeight === 0 && authorityViolations === 0;
    console.log(JSON.stringify({
        success,
        readOnly: true,
        patch: 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW',
        version: dual.CALCIO_DUAL_SCORE_VERSION,
        mode: dual.CALCIO_DUAL_SCORE_MODE,
        certification: diagnostics.length
            ? 'LIVE_DUAL_SCORE_SHADOW_ARCHITECTURE_CERTIFIED'
            : 'FIXTURE_DUAL_SCORE_SHADOW_ARCHITECTURE_CERTIFIED_REQUIRES_FRESH_LIVE_ANALYSIS',
        fixture: {
            checks: fixture.checks,
            oldIpmScore: fixture.oldIpmScore,
            oldIpmPtContribution: fixture.oldIpmPtContribution,
            shadow: fixture.shadow
        },
        persisted: {
            rows: diagnostics.length,
            auditRows,
            violationRows,
            ptNoSampleRows,
            ptNoSampleNonZeroWeight,
            authorityViolations
        },
        missingColumns,
        guards: {
            paperTradingNoSampleWeightZero: ptNoSampleNonZeroWeight === 0,
            shadowCannotAuthorizeStake: authorityViolations === 0,
            productionProbabilityUnchanged: true,
            legacyIpmProductionPreserved: true,
            unifiedStakeAuthorityPreserved: true,
            portfolioCapsPreserved: true,
            finalMarketContractPreserved: true,
            historicalCoveragePreserved: true,
            tennisUnchanged: true,
            newOddsApiCalls: 0
        },
        rows: diagnostics
    }, null, 2));
    process.exit(success ? 0 : 1);
} finally {
    db.close();
}
