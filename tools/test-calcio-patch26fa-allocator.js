'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('./sqlite-compat');
const allocator = require('../backend/calcioBatchPortfolioAllocator');
const professionalSelection = require('../backend/calcioProfessionalSelection');
const contract = require('../backend/calcioFinalMarketDiagnosticContract');
const { createConsistentSqliteSnapshot } = require('./patch26fa-sqlite-snapshot');

const sourceDb = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');


const RETRYABLE_CLEANUP_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

function sleepSync(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function scheduleDeferredWindowsCleanup(target) {
    if (process.platform !== 'win32') return false;
    try {
        const cleanupScript = [
            "'use strict';",
            "const fs=require('fs');",
            `const target=${JSON.stringify(target)};`,
            'let attempt=0;',
            'function remove(){',
            "try{fs.rmSync(target,{recursive:true,force:true,maxRetries:4,retryDelay:125});process.exit(0);}",
            "catch(_){attempt+=1;if(attempt>=24)process.exit(0);setTimeout(remove,250);}",
            '}',
            'setTimeout(remove,250);'
        ].join('');
        const child = spawn(process.execPath, ['-e', cleanupScript], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        return true;
    } catch (_) {
        return false;
    }
}

function removeTempDirBestEffort(target) {
    let lastError = null;
    let simulatedFailurePending = process.env.PATCH26FA_SIMULATE_CLEANUP_EPERM_ONCE === '1';
    const attempts = 4;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            if (simulatedFailurePending) {
                simulatedFailurePending = false;
                const error = new Error('Simulated Windows EPERM for cleanup regression test');
                error.code = 'EPERM';
                throw error;
            }
            fs.rmSync(target, {
                recursive: true,
                force: true,
                maxRetries: 8,
                retryDelay: 125
            });
            return {
                status: attempt === 1 ? 'REMOVED' : 'REMOVED_AFTER_RETRY',
                attempts: attempt,
                deferred: false
            };
        } catch (error) {
            lastError = error;
            if (!RETRYABLE_CLEANUP_CODES.has(error?.code)) break;
            sleepSync(150 * attempt);
        }
    }

    const deferred = scheduleDeferredWindowsCleanup(target);
    const result = {
        status: deferred ? 'DEFERRED_UNTIL_PROCESS_RELEASE' : 'BEST_EFFORT_NOT_REMOVED',
        attempts,
        deferred,
        code: lastError?.code || 'UNKNOWN'
    };
    console.error(JSON.stringify({
        warning: 'PATCH26FA_TEMP_CLEANUP_NON_BLOCKING',
        target,
        ...result
    }));
    return result;
}

function closeDatabaseBestEffort(db) {
    if (!db) return { status: 'NOT_OPENED' };
    try {
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
        db.close();
        return { status: 'CLOSED' };
    } catch (error) {
        const result = { status: 'CLOSE_WARNING', code: error?.code || 'UNKNOWN' };
        console.error(JSON.stringify({ warning: 'PATCH26FA_TEMP_DB_CLOSE_NON_BLOCKING', ...result }));
        return result;
    }
}

function prepareFixture(target) {
    const snapshot = createConsistentSqliteSnapshot(sourceDb, target);
    const db = new Database(target);
    allocator.ensureSchema(db);
    const batch = db.prepare(`
        SELECT b.batch_id, b.status, b.created_at, COUNT(a.id) AS row_count,
               SUM(CASE WHEN a.home_team='Torino' AND a.away_team='AC Milan' THEN 1 ELSE 0 END) AS torino_milan,
               SUM(CASE WHEN a.home_team='Genoa' AND a.away_team='Napoli' THEN 1 ELSE 0 END) AS genoa_napoli,
               SUM(CASE WHEN a.home_team='AS Roma' THEN 1 ELSE 0 END) AS roma,
               SUM(CASE WHEN a.home_team='Venezia' THEN 1 ELSE 0 END) AS venezia
        FROM calcio_ai_observation_batches b
        JOIN ai_forward_test a ON a.calcio_analysis_batch_id=b.batch_id
        GROUP BY b.batch_id, b.status, b.created_at
        HAVING COUNT(a.id)=10
           AND SUM(CASE WHEN a.home_team='Torino' AND a.away_team='AC Milan' THEN 1 ELSE 0 END)=1
           AND SUM(CASE WHEN a.home_team='Genoa' AND a.away_team='Napoli' THEN 1 ELSE 0 END)=1
           AND SUM(CASE WHEN a.home_team='AS Roma' THEN 1 ELSE 0 END)=1
           AND SUM(CASE WHEN a.home_team='Venezia' THEN 1 ELSE 0 END)=1
        ORDER BY CASE WHEN b.status='REANALYSIS_REQUIRED_PATCH26EC' THEN 0 ELSE 1 END, b.created_at DESC
        LIMIT 1
    `).get();
    if (!batch?.batch_id) {
        const inventory = db.prepare(`
            SELECT b.batch_id, b.status, b.created_at, COUNT(a.id) AS row_count
            FROM calcio_ai_observation_batches b
            LEFT JOIN ai_forward_test a ON a.calcio_analysis_batch_id=b.batch_id
            GROUP BY b.batch_id, b.status, b.created_at
            ORDER BY b.created_at DESC
            LIMIT 12
        `).all();
        const error = new Error(`Batch fixture a 10 eventi non disponibile dopo snapshot WAL-aware: ${JSON.stringify(inventory)}`);
        error.code = 'PATCH26FA_ALLOCATOR_FIXTURE_BATCH_MISSING';
        throw error;
    }
    const batchId = batch.batch_id;
    db.prepare("UPDATE calcio_ai_observation_batches SET status='FINALIZATIONS_COMPLETE', bankroll_snapshot=1000 WHERE batch_id=?").run(batchId);
    db.prepare('DELETE FROM calcio_ai_portfolio_batch_allocations WHERE batch_id=?').run(batchId);
    db.prepare('DELETE FROM calcio_final_market_contract_audit_log WHERE batch_id=?').run(batchId);
    const rows = db.prepare('SELECT * FROM ai_forward_test WHERE calcio_analysis_batch_id=? ORDER BY id').all(batchId);
    assert.strictEqual(rows.length, 10);
    for (const row of rows) {
        const isGenoa = row.home_team === 'Genoa' && row.away_team === 'Napoli';
        const isTorino = row.home_team === 'Torino' && row.away_team === 'AC Milan';
        const isRoma = row.home_team === 'AS Roma';
        const isPrior = ['Venezia','Inter Milan','Atalanta BC','Frosinone'].includes(row.home_team);
        const stake = isGenoa ? 2 : 0;
        const robustEv = isGenoa ? 4.19 : isTorino ? -2.465 : isRoma ? 3.1 : 1;
        const effectiveAction = isTorino ? 'RISCHIO MODELLO' : isPrior ? 'ALTO RISCHIO' : 'WATCHLIST LOW EDGE';
        const qualityFinalLabel = isGenoa ? 'APPROVATA CON CAP' : isTorino ? 'BLOCCATA SOFT' : isPrior ? 'BLOCCATA HARD' : 'WATCHLIST MICRO';
        const quality = {
            version:'BETTING_PATCH_26E_C_DATA_QUALITY_AUTHORITY_V1',
            status:isPrior?'DATA_QUALITY_BLOCKED':'DATA_QUALITY_LIMITED',
            label:isPrior?'BLOCCANTE':'LIMITATA',
            score:isPrior?35:75,
            blocking:isPrior,
            hardReasons:isPrior?['Classe dati PRIOR senza autorità stake.']:[]
        };
        const authority = {
            version:'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1',
            status:isGenoa?'STAKE_AUTHORITY_AUTHORIZED':'STAKE_AUTHORITY_NO_STAKE',
            eligible:isGenoa,
            allowBet:isGenoa,
            operationalAuthority:'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY',
            bankrollSnapshot:1000,
            modelStake:isGenoa?7.4:isTorino?4.2:isRoma?2.6:0,
            reliabilityStake:stake,
            prePortfolioCapStake:stake,
            finalOperationalStake:0,
            robustProbabilityPct: isTorino ? 49.5 : 60,
            robustEvPct:robustEv,
            epistemicUncertaintyScore: isTorino ? 72 : 60,
            timingPolicy:{ code:isGenoa?'T48H':'EARLY_GT_21D' },
            effectiveAction,
            qualityFinalLabel,
            reason:isGenoa?'Stake unico autorizzato fixture.':isTorino?'EV robusto non positivo.':isRoma?'Valore anticipato da riesaminare.':'Stake €0 fixture.'
        };
        const prediction = row.prediction || (isTorino ? 'O2.5' : isGenoa ? 'U2.5' : '1');
        const marketType = row.market_type || contract.inferMarketType(prediction);
        const estimatedProb = Number(row.estimated_prob || (isTorino ? 54.72 : isGenoa ? 62.06 : 50));
        const components = {
            probability: {
                model: estimatedProb + 0.8,
                monteCarlo: estimatedProb + 0.5,
                marketProbability: estimatedProb - 3,
                marketGapPp: 3.8,
                monteCarloStdErrorPp: 0.5
            },
            paperTrading: { sample: 0 }
        };
        const snapshot = contract.buildFinalMarketSnapshot({
            candidate:{ ...row, prediction, market_type:marketType, estimatedProb, edge_pp:Number(row.edge_pp||2), ev_pct:Number(row.ev_pct||4), event_key:row.match_exposure_key || row.calcio_event_key },
            predictionReliability:{ score:isPrior?25:68, label:isPrior?'VERY_LOW':'MEDIUM' },
            dataQuality:quality,
            stakeAuthority:authority,
            decision:{ dataClass:isPrior?'INATTENDIBILE':'ATTENDIBILE', finalizationStatus:'FULLY_FINALIZED' },
            probabilityFallback:{
                modelProbabilityPct:components.probability.model,
                monteCarloProbabilityPct:components.probability.monteCarlo,
                marketProbabilityPct:components.probability.marketProbability,
                disagreementPp:components.probability.marketGapPp,
                monteCarloSamplingErrorPp:components.probability.monteCarloStdErrorPp
            },
            finalOperationalStake:0,
            eligible:false,
            finalizationCertified:true,
            reason:authority.reason
        });
        const fields = contract.persistenceFields(snapshot);
        db.prepare(`UPDATE ai_forward_test SET
            bankroll_snapshot=1000, calcio_stake_bankroll_snapshot=1000, calcio_bankroll_snapshot_consistent=1,
            calcio_stake_authority_version=?, calcio_stake_authority_status=?,
            calcio_stake_authority_model_stake=?, calcio_stake_authority_reliability_stake=?,
            calcio_stake_authority_pre_cap_stake=?, calcio_stake_authority_final_stake=0,
            calcio_stake_authority_reason=?, calcio_stake_authority_audit=?,
            calcio_data_quality_authority_version=?, calcio_data_quality_status=?, calcio_data_quality_label=?, calcio_data_quality_score=?,
            calcio_data_quality_blocking=?, calcio_data_quality_audit=?,
            calcio_robust_ev_pct=?, calcio_portfolio_pre_cap_stake=?, calcio_portfolio_post_cap_stake=0,
            calcio_portfolio_pre_cap_eligible=?, calcio_prediction_index_eligible=?,
            calcio_prediction_reliability_score=?, calcio_prediction_reliability_label=?,
            calcio_prediction_index_components=?,
            calcio_finalization_transaction_status='COMMITTED_EVENT_ONLY',
            calcio_market_ranking_certified=1, calcio_output_coherence_status='OUTPUT_COHERENCE_CERTIFIED',
            calcio_portfolio_batch_certified=0, calcio_portfolio_batch_status='PENDING_BATCH',
            calcio_portfolio_allocation_id=NULL,
            calcio_final_market_contract_version=?, calcio_final_market_id=?, calcio_final_market_snapshot=?,
            calcio_forecast_confidence_score=?, calcio_forecast_confidence_label=?,
            calcio_decision_state_version=?, calcio_decision_state=?, calcio_decision_state_reason=?,
            calcio_diagnostic_coherence_status=?, calcio_diagnostic_coherence_audit=?
            WHERE id=?`).run(
                authority.version, authority.status, authority.modelStake, authority.reliabilityStake,
                authority.prePortfolioCapStake, authority.reason, JSON.stringify(authority),
                quality.version, quality.status, quality.label, quality.score, quality.blocking?1:0, JSON.stringify(quality),
                robustEv, stake, isGenoa?1:0, isGenoa?1:0,
                isPrior?25:68, isPrior?'VERY_LOW':'MEDIUM', JSON.stringify(components),
                fields.calcio_final_market_contract_version, fields.calcio_final_market_id, fields.calcio_final_market_snapshot,
                fields.calcio_forecast_confidence_score, fields.calcio_forecast_confidence_label,
                fields.calcio_decision_state_version, fields.calcio_decision_state, fields.calcio_decision_state_reason,
                fields.calcio_diagnostic_coherence_status, fields.calcio_diagnostic_coherence_audit,
                row.id
            );
    }
    return { db, batchId, snapshot };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fa-allocator-'));
let db = null;
let output = null;
let dbClose = { status: 'NOT_OPENED' };
let cleanup = { status: 'NOT_RUN' };
try {
    const dbPath = path.join(tempDir, 'fixture.db');
    const prepared = prepareFixture(dbPath);
    db = prepared.db;
    const batchId = prepared.batchId;
    const snapshot = prepared.snapshot;
    const result = allocator.allocateBatch(db, {
        batchId,
        professionalSelection,
        caps:{ totalExposurePct:5, longshotExposurePct:1, kickoffExposurePct:2 }
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.diagnostics.completedEventCount, 10);
    assert.strictEqual(result.diagnostics.failedEventCount, 0);
    assert.strictEqual(result.diagnostics.eligibleEventCount, 1);
    assert.strictEqual(Math.round(result.totals.postCapStake * 100), 200);

    const finalRows = db.prepare(`SELECT home_team,away_team,prediction,market_type,
        calcio_operational_stake,calcio_analysis_stage_code,calcio_quality_final_label,
        calcio_decision_state,calcio_final_market_id,calcio_final_market_snapshot,
        calcio_diagnostic_coherence_status,calcio_portfolio_batch_certified
        FROM ai_forward_test WHERE calcio_analysis_batch_id=?`).all(batchId);
    const torino = finalRows.find(r => r.home_team === 'Torino');
    const genoa = finalRows.find(r => r.home_team === 'Genoa');
    const roma = finalRows.find(r => r.home_team === 'AS Roma');
    const venezia = finalRows.find(r => r.home_team === 'Venezia');
    assert.strictEqual(Number(torino.calcio_operational_stake), 0);
    assert.strictEqual(torino.calcio_decision_state, 'NO_BET_VALUE');
    assert.strictEqual(torino.calcio_analysis_stage_code, 'NO_BET_VALUE');
    assert.strictEqual(Number(genoa.calcio_operational_stake), 2);
    assert.strictEqual(genoa.calcio_decision_state, 'BET_READY');
    assert.strictEqual(genoa.calcio_analysis_stage_code, 'BET_READY');
    assert.strictEqual(roma.calcio_decision_state, 'EARLY_RECHECK');
    assert.strictEqual(venezia.calcio_decision_state, 'NO_BET_DATA');
    assert(finalRows.every(r => r.calcio_diagnostic_coherence_status === contract.COHERENCE_CERTIFIED));
    assert(finalRows.every(r => Number(r.calcio_portfolio_batch_certified) === 1));
    for (const row of finalRows) {
        const snapshot = JSON.parse(row.calcio_final_market_snapshot);
        assert.strictEqual(snapshot.prediction, row.prediction);
        assert.strictEqual(snapshot.marketType, row.market_type);
        assert.strictEqual(snapshot.marketId, row.calcio_final_market_id);
    }
    const auditCount = db.prepare('SELECT COUNT(*) n FROM calcio_final_market_contract_audit_log WHERE batch_id=?').get(batchId).n;
    assert.strictEqual(auditCount, 10);
    output = {
        success:true,
        checks:31,
        batchId,
        totalStake:2,
        states:{ Torino:'NO_BET_VALUE', Genoa:'BET_READY', Roma:'EARLY_RECHECK', Venezia:'NO_BET_DATA' },
        diagnosticAuditRows:auditCount,
        fixtureSnapshot:{ mode:snapshot.mode, attempts:snapshot.attempts, sizeBytes:snapshot.sizeBytes }
    };
} finally {
    dbClose = closeDatabaseBestEffort(db);
    cleanup = removeTempDirBestEffort(tempDir);
}

console.log(JSON.stringify({
    ...output,
    dbClose,
    cleanup,
    cleanupRegressionSimulated: process.env.PATCH26FA_SIMULATE_CLEANUP_EPERM_ONCE === '1'
}, null, 2));
