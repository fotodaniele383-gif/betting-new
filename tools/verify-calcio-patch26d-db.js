'use strict';
const path = require('path');
const assert = require('assert/strict');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
try {
    const table = name => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
    assert.ok(table('calcio_patch26d_recovery_runs'), 'Tabella audit recovery Patch 26D mancante');
    const counts = {
        total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),
        tennis: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n),
        resolvedCalcio: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n),
        recoveryRuns: Number(db.prepare('SELECT COUNT(*) n FROM calcio_patch26d_recovery_runs').get().n),
        remainingScopeFailures: Number(db.prepare("SELECT COUNT(*) n FROM calcio_ai_observation_finalizations WHERE status='FAILED' AND error_code='CALCIO_DEEPSCAN_ROUTE_ERROR' AND error_message='stakeReconciliationDecision is not defined'").get().n),
        invalidCommittedZeroCompletedBatches: Number(db.prepare("SELECT COUNT(*) n FROM calcio_ai_portfolio_batch_allocations WHERE status='COMMITTED_BATCH' AND completed_event_count=0").get().n),
        falseCertifiedFailedRows: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(calcio_portfolio_batch_certified,0)=1 AND UPPER(COALESCE(calcio_analysis_stage_code,''))='FAILED_FINALIZATION'").get().n),
        reanalysisRequired: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND calcio_analysis_stage_code='REANALYSIS_REQUIRED'").get().n)
    };
    assert.equal(counts.remainingScopeFailures, 0);
    assert.equal(counts.invalidCommittedZeroCompletedBatches, 0);
    assert.equal(counts.falseCertifiedFailedRows, 0);
    assert.ok(counts.recoveryRuns >= 1);
    console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY', schema: 'PASS', counts, freshLiveAnalysisRequired: counts.reanalysisRequired > 0 }, null, 2));
} finally { db.close(); }
