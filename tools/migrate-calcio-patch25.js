'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
const args = process.argv.slice(2);
const dbArgIndex = args.indexOf('--db');
const dbPath = dbArgIndex >= 0 && args[dbArgIndex + 1]
    ? path.resolve(args[dbArgIndex + 1])
    : path.resolve(__dirname, '../backend/database_betting.db');

if (!fs.existsSync(dbPath)) throw new Error(`Database mancante: ${dbPath}`);

const columns = [
    ['calcio_deepscan_timing_advisory', 'TEXT'],
    ['calcio_market_projected_count', 'INTEGER DEFAULT 0'],
    ['calcio_market_finalization_mode', 'TEXT'],
    ['calcio_runtime_consistency_status', 'TEXT']
];

const db = new Database(dbPath);
const beforeCols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
let addedCount = 0;
for (const [name, type] of columns) {
    if (!beforeCols.has(name)) {
        db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
        addedCount += 1;
    }
}

const pendingScope = `
    UPPER(COALESCE(sport_type,'')) = 'CALCIO'
    AND UPPER(COALESCE(status,'PENDING')) = 'PENDING'
    AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
    AND COALESCE(paper_result_active,1) = 1
    AND COALESCE(paper_result_conflict,0) = 0
`;

const waitRowsBefore = db.prepare(`
    SELECT COUNT(*) AS n FROM ai_forward_test
    WHERE ${pendingScope}
      AND UPPER(COALESCE(ds_action,'')) IN ('ATTENDI IN-PLAY','ATTENDI IN PLAY','WAIT_IN_PLAY','WAIT IN PLAY')
`).get().n;

const authorizedZeroBefore = db.prepare(`
    SELECT COUNT(*) AS n FROM ai_forward_test
    WHERE ${pendingScope}
      AND COALESCE(calcio_operational_stake, stake, 0) < 2
      AND (
        UPPER(COALESCE(calcio_stake_lifecycle_status,'')) = 'UNIFIED_INDEX_STAKE_AUTHORIZED'
        OR COALESCE(calcio_prediction_index_eligible,0) = 1
        OR COALESCE(calcio_analysis_only,1) = 0
        OR UPPER(COALESCE(prediction_visibility,'')) = 'OPERATIONAL_CANDIDATE'
        OR UPPER(COALESCE(exposure_role,'')) = 'PRIMARY_OPERATIONAL'
      )
`).get().n;

let result;
try {
    db.exec('BEGIN IMMEDIATE');
    const waitResult = db.prepare(`
        UPDATE ai_forward_test SET
            ds_action = 'WATCHLIST LOW EDGE',
            calcio_deepscan_unified_action = 'WATCHLIST LOW EDGE',
            calcio_deepscan_timing_advisory = 'WAIT_IN_PLAY',
            calcio_deepscan_action_certified = 0,
            calcio_market_ranking_certified = 0,
            calcio_ai_finalization_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN',
            calcio_output_coherence_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN',
            calcio_runtime_consistency_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN'
        WHERE ${pendingScope}
          AND UPPER(COALESCE(ds_action,'')) IN ('ATTENDI IN-PLAY','ATTENDI IN PLAY','WAIT_IN_PLAY','WAIT IN PLAY')
    `).run();

    const stateResult = db.prepare(`
        UPDATE ai_forward_test SET
            stake = 0,
            calcio_operational_stake = 0,
            calcio_gate_max_stake = 0,
            calcio_gate_allow_bet = 0,
            calcio_prediction_index_eligible = 0,
            calcio_stake_lifecycle_status = 'UNIFIED_INDEX_NO_STAKE',
            calcio_stake_lifecycle_reason = 'Patch 25: stato operativo incoerente della Patch 24 normalizzato; eseguire un nuovo DeepScan.',
            calcio_operational_status = 'CALCIO_WATCHLIST_MICRO',
            calcio_operational_action = 'ANALYSIS_ONLY_UNIFIED_INDEX',
            calcio_operational_summary = 'Patch 25: nuova finalizzazione DeepScan richiesta.',
            calcio_analysis_only = 1,
            prediction_visibility = 'ANALYSIS_ONLY',
            exposure_role = 'ANALYSIS_ONLY',
            strategy_tag = CASE
                WHEN UPPER(COALESCE(strategy_tag,'')) LIKE '%_OPERATIONAL' THEN SUBSTR(strategy_tag,1,LENGTH(strategy_tag)-12) || '_ANALYSIS_ONLY'
                WHEN UPPER(COALESCE(strategy_tag,'')) LIKE '%_ANALYSIS_ONLY' THEN strategy_tag
                ELSE COALESCE(NULLIF(strategy_tag,''),'CALCIO') || '_ANALYSIS_ONLY'
            END,
            calcio_decision_certification_status = 'DECISION_ANALYSIS_ONLY',
            calcio_structural_certification_label = 'ANALISI · NESSUNA AUTORITÀ STAKE',
            calcio_pt_certification_status = CASE WHEN COALESCE(historical_combo_resolved,0) > 0 THEN 'PT_VALIDATED' ELSE 'PT_ABSENT_NEUTRAL' END,
            calcio_ai_finalization_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN',
            calcio_market_ranking_certified = 0,
            calcio_output_coherence_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN',
            calcio_runtime_consistency_status = 'PATCH25_REQUIRES_FRESH_DEEPSCAN'
        WHERE ${pendingScope}
          AND COALESCE(calcio_operational_stake, stake, 0) < 2
          AND (
            UPPER(COALESCE(calcio_stake_lifecycle_status,'')) = 'UNIFIED_INDEX_STAKE_AUTHORIZED'
            OR COALESCE(calcio_prediction_index_eligible,0) = 1
            OR COALESCE(calcio_analysis_only,1) = 0
            OR UPPER(COALESCE(prediction_visibility,'')) = 'OPERATIONAL_CANDIDATE'
            OR UPPER(COALESCE(exposure_role,'')) = 'PRIMARY_OPERATIONAL'
          )
    `).run();

    result = {
        waitActionsNormalized: Number(waitResult.changes || 0),
        authorizedZeroNormalized: Number(stateResult.changes || 0)
    };
    db.exec('COMMIT');
} catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
}

const after = {
    waitActionsRemaining: db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${pendingScope} AND UPPER(COALESCE(ds_action,'')) IN ('ATTENDI IN-PLAY','ATTENDI IN PLAY','WAIT_IN_PLAY','WAIT IN PLAY')`).get().n,
    authorizedZeroRemaining: db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${pendingScope} AND COALESCE(calcio_operational_stake,stake,0) < 2 AND (UPPER(COALESCE(calcio_stake_lifecycle_status,''))='UNIFIED_INDEX_STAKE_AUTHORIZED' OR COALESCE(calcio_prediction_index_eligible,0)=1 OR COALESCE(calcio_analysis_only,1)=0 OR UPPER(COALESCE(prediction_visibility,''))='OPERATIONAL_CANDIDATE' OR UPPER(COALESCE(exposure_role,''))='PRIMARY_OPERATIONAL')`).get().n,
    columns: db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name)
};
db.close();

console.log(JSON.stringify({
    success: true,
    patch: PATCH,
    dbPath,
    addedCount,
    before: { waitRows: waitRowsBefore, authorizedZero: authorizedZeroBefore },
    updated: result,
    after: {
        waitActionsRemaining: after.waitActionsRemaining,
        authorizedZeroRemaining: after.authorizedZeroRemaining,
        requiredColumnsPresent: columns.every(([name]) => after.columns.includes(name))
    }
}, null, 2));
