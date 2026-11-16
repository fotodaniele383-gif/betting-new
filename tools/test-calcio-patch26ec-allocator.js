'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('./sqlite-compat');
const allocator = require('../backend/calcioBatchPortfolioAllocator');
const professionalSelection = require('../backend/calcioProfessionalSelection');

const sourceDb = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
function prepareFixture(target, mismatch = false) {
    fs.copyFileSync(sourceDb, target);
    const db = new Database(target);
    const batch = db.prepare("SELECT batch_id FROM calcio_ai_observation_batches WHERE status='REANALYSIS_REQUIRED_PATCH26EC' ORDER BY created_at DESC LIMIT 1").get();
    assert(batch?.batch_id, 'Batch forward-recovery non disponibile per fixture');
    const batchId = batch.batch_id;
    db.prepare("UPDATE calcio_ai_observation_batches SET status='FINALIZATIONS_COMPLETE', bankroll_snapshot=1000 WHERE batch_id=?").run(batchId);
    db.prepare('DELETE FROM calcio_ai_portfolio_batch_allocations WHERE batch_id=?').run(batchId);
    const rows = db.prepare('SELECT id,home_team,away_team FROM ai_forward_test WHERE calcio_analysis_batch_id=? ORDER BY id').all(batchId);
    assert.strictEqual(rows.length, 10);
    for (const row of rows) {
        const isGenoa = row.home_team === 'Genoa' && row.away_team === 'Napoli';
        const isTorino = row.home_team === 'Torino' && row.away_team === 'AC Milan';
        const isPrior = ['Venezia','Inter Milan','Atalanta BC','Frosinone'].includes(row.home_team);
        const stake = isGenoa ? 2 : 0;
        const robustEv = isGenoa ? 4.19 : isTorino ? -2.465 : 1;
        const effectiveAction = isTorino ? 'RISCHIO MODELLO' : isPrior ? 'ALTO RISCHIO' : 'WATCHLIST LOW EDGE';
        const qualityFinalLabel = isGenoa ? 'APPROVATA CON CAP' : isTorino ? 'BLOCCATA SOFT' : isPrior ? 'BLOCCATA HARD' : 'WATCHLIST MICRO';
        const quality = { version:'BETTING_PATCH_26E_C_DATA_QUALITY_AUTHORITY_V1', status:isPrior?'DATA_QUALITY_BLOCKED':'DATA_QUALITY_LIMITED', score:isPrior?35:75, blocking:isPrior, hardReasons:isPrior?['Classe dati PRIOR senza autorità stake.']:[] };
        const authority = {
            version:'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1',
            status:isGenoa?'STAKE_AUTHORITY_AUTHORIZED':'STAKE_AUTHORITY_NO_STAKE',
            eligible:isGenoa,
            allowBet:isGenoa,
            operationalAuthority:'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY',
            bankrollSnapshot:1000,
            modelStake:isGenoa?7.4:isTorino?4.2:0,
            reliabilityStake:stake,
            prePortfolioCapStake:stake,
            finalOperationalStake:stake,
            robustEvPct:robustEv,
            effectiveAction,
            qualityFinalLabel,
            reason:isGenoa?'Stake unico autorizzato fixture.':'Stake €0 fixture.'
        };
        db.prepare(`UPDATE ai_forward_test SET
            bankroll_snapshot=?, calcio_stake_bankroll_snapshot=?, calcio_bankroll_snapshot_consistent=1,
            calcio_stake_authority_version=?, calcio_stake_authority_status=?,
            calcio_stake_authority_model_stake=?, calcio_stake_authority_reliability_stake=?,
            calcio_stake_authority_pre_cap_stake=?, calcio_stake_authority_final_stake=0,
            calcio_stake_authority_reason=?, calcio_stake_authority_audit=?,
            calcio_data_quality_authority_version=?, calcio_data_quality_status=?, calcio_data_quality_score=?,
            calcio_data_quality_blocking=?, calcio_data_quality_audit=?,
            calcio_robust_ev_pct=?, calcio_portfolio_pre_cap_stake=?, calcio_portfolio_post_cap_stake=0,
            calcio_portfolio_pre_cap_eligible=?, calcio_prediction_index_eligible=?,
            calcio_finalization_transaction_status='COMMITTED_EVENT_ONLY',
            calcio_market_ranking_certified=1, calcio_output_coherence_status='OUTPUT_COHERENCE_CERTIFIED',
            calcio_portfolio_batch_certified=0, calcio_portfolio_batch_status='PENDING_BATCH',
            calcio_portfolio_allocation_id=NULL
            WHERE id=?`).run(
                mismatch && isTorino ? 2003.69 : 1000,
                mismatch && isTorino ? 2003.69 : 1000,
                authority.version, authority.status, authority.modelStake, authority.reliabilityStake,
                authority.prePortfolioCapStake, authority.reason, JSON.stringify(authority),
                quality.version, quality.status, quality.score, quality.blocking?1:0, JSON.stringify(quality),
                robustEv, stake, isGenoa?1:0, isGenoa?1:0, row.id
            );
    }
    return { db, batchId };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26ec-allocator-'));
try {
    const goodPath = path.join(tempDir, 'good.db');
    const { db, batchId } = prepareFixture(goodPath, false);
    const result = allocator.allocateBatch(db, { batchId, professionalSelection, caps:{ totalExposurePct:5, longshotExposurePct:1, kickoffExposurePct:2 } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.diagnostics.completedEventCount, 10);
    assert.strictEqual(result.diagnostics.failedEventCount, 0);
    assert.strictEqual(result.diagnostics.eligibleEventCount, 1);
    assert.strictEqual(Math.round(result.totals.preCapStake * 100), 200);
    assert.strictEqual(Math.round(result.totals.postCapStake * 100), 200);
    const finalRows = db.prepare('SELECT home_team,away_team,calcio_operational_stake,calcio_analysis_stage_code,calcio_quality_final_label,calcio_portfolio_batch_certified FROM ai_forward_test WHERE calcio_analysis_batch_id=?').all(batchId);
    const torino = finalRows.find(r => r.home_team === 'Torino');
    const genoa = finalRows.find(r => r.home_team === 'Genoa');
    const venezia = finalRows.find(r => r.home_team === 'Venezia');
    assert.strictEqual(Number(torino.calcio_operational_stake), 0);
    assert.strictEqual(torino.calcio_quality_final_label, 'BLOCCATA SOFT');
    assert.strictEqual(Number(genoa.calcio_operational_stake), 2);
    assert.strictEqual(genoa.calcio_analysis_stage_code, 'OPERATIONAL_CANDIDATE');
    assert.strictEqual(Number(venezia.calcio_operational_stake), 0);
    assert.strictEqual(venezia.calcio_analysis_stage_code, 'ANALYSIS_ONLY');
    assert.strictEqual(venezia.calcio_quality_final_label, 'BLOCCATA HARD');
    assert(finalRows.every(r => Number(r.calcio_portfolio_batch_certified) === 1));
    const auditCount = db.prepare('SELECT COUNT(*) n FROM calcio_stake_authority_audit_log WHERE batch_id=?').get(batchId).n;
    assert.strictEqual(auditCount, 10);
    db.close();

    const badPath = path.join(tempDir, 'bad.db');
    const bad = prepareFixture(badPath, true);
    let mismatchError = null;
    try { allocator.allocateBatch(bad.db, { batchId: bad.batchId, professionalSelection }); } catch (error) { mismatchError = error; }
    assert(mismatchError);
    assert.strictEqual(mismatchError.code, 'PATCH26EC_BANKROLL_SNAPSHOT_MISMATCH');
    assert.strictEqual(mismatchError.mismatches.length, 1);
    bad.db.close();
    console.log(JSON.stringify({ success:true, checks:18, batchId, totalStake:2, torinoStake:0, genoaStake:2, auditRows:10, mismatchGuard:true }, null, 2));
} finally {
    fs.rmSync(tempDir, { recursive:true, force:true });
}
