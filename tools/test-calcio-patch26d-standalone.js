'use strict';

const assert = require('assert/strict');
const Database = require('./sqlite-compat');
const observability = require('../backend/calcioObservability');
const allocator = require('../backend/calcioBatchPortfolioAllocator');
const selection = {
    applyPortfolioExposureCaps(candidates = [], bankroll = 0, existingRows = [], caps = {}) {
        const totalLimit = Number(bankroll || 0) * Number(caps.totalExposurePct || 5) / 100;
        let remaining = totalLimit;
        const allocated = [];
        for (const candidate of candidates) {
            const index = { ...(candidate.predictionIndex || candidate.prediction_index || {}) };
            const requested = Math.max(0, Number(index.prePortfolioCapStake ?? index.operationalStake ?? index.theoreticalStake ?? 0));
            const allowed = Math.max(0, Math.min(requested, remaining));
            remaining -= allowed;
            index.operationalStake = allowed;
            index.eligible = allowed >= 2 && index.eligible === true;
            index.allowBet = index.eligible;
            index.estimatedProfit = allowed * Math.max(0, Number(index.netExecutableOdd || candidate.odd || 0) - 1);
            allocated.push({ ...candidate, predictionIndex: index, prediction_index: index });
        }
        return {
            candidates: allocated,
            limits: { totalCap: totalLimit, longshotCap: totalLimit, kickoffCap: totalLimit },
            existing: { total: 0, longshot: 0, kickoff: {} },
            allocated: { total: allocated.reduce((sum, row) => sum + Number(row.predictionIndex.operationalStake || 0), 0), longshot: 0, kickoff: {} }
        };
    }
};

function createDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ai_forward_test (
            id INTEGER PRIMARY KEY, sport_type TEXT, status TEXT, bet_type TEXT,
            paper_result_active INTEGER, paper_result_conflict INTEGER,
            match_exposure_key TEXT, calcio_event_key TEXT, match_date TEXT,
            home_team TEXT, away_team TEXT, prediction TEXT, market_type TEXT,
            odd REAL, stake REAL, profit REAL, estimated_prob REAL, edge REAL, edge_pp REAL, ev_pct REAL,
            bankroll_snapshot REAL, strategy_tag TEXT,
            calcio_theoretical_stake REAL, calcio_operational_stake REAL,
            calcio_prediction_index_score REAL, calcio_prediction_index_label TEXT,
            calcio_prediction_index_reason TEXT, calcio_prediction_index_components TEXT,
            calcio_prediction_index_rank_value REAL, calcio_prediction_index_eligible INTEGER,
            calcio_net_executable_odd REAL, calcio_ai_finalization_status TEXT,
            calcio_market_ranking_certified INTEGER, calcio_output_coherence_status TEXT,
            calcio_finalization_transaction_status TEXT, calcio_finalization_transaction_id TEXT,
            calcio_analysis_only INTEGER, prediction_visibility TEXT, exposure_role TEXT,
            calcio_gate_status TEXT, calcio_gate_allow_bet INTEGER, calcio_gate_max_stake REAL,
            calcio_stake_lifecycle_status TEXT, calcio_stake_lifecycle_reason TEXT,
            calcio_operational_status TEXT, calcio_operational_action TEXT, calcio_operational_summary TEXT,
            calcio_gate_reasons TEXT, calcio_decision_certification_status TEXT,
            calcio_decision_certification_reason TEXT, calcio_analysis_stage_code TEXT,
            calcio_analysis_stage_label TEXT, calcio_analysis_stage_reason TEXT,
            calcio_quality_final_label TEXT, quality_final_label TEXT, quality_final_reason TEXT,
            quality_stake_mode TEXT, quality_stake_amount REAL, calcio_pt_certification_status TEXT,
            calcio_structural_certification_label TEXT, calcio_portfolio_cap_post_finalization INTEGER,
            calcio_runtime_consistency_status TEXT, calcio_profit_display_mode TEXT
        );
    `);
    observability.ensureSchema(db);
    allocator.ensureSchema(db);
    return db;
}

function rowFixture(id, key, score, preCapStake, failed = false) {
    return {
        id, sport_type: 'CALCIO', status: 'PENDING', bet_type: 'SINGLE_CR',
        paper_result_active: 1, paper_result_conflict: 0,
        match_exposure_key: key, calcio_event_key: key,
        match_date: `2026-08-2${id}T20:45:00Z`, home_team: `H${id}`, away_team: `A${id}`,
        prediction: id % 2 ? 'O2.5' : '1', market_type: id % 2 ? 'TOTALS' : '1X2',
        odd: 2, stake: 0, profit: 0, estimated_prob: 56, edge: 3, edge_pp: 3, ev_pct: 6,
        bankroll_snapshot: 1000, strategy_tag: `SERIE_A_${id}_ANALYSIS_ONLY`,
        calcio_theoretical_stake: failed ? 0 : preCapStake, calcio_operational_stake: 0,
        calcio_prediction_index_score: score, calcio_prediction_index_label: 'MICRO',
        calcio_prediction_index_reason: 'fixture',
        calcio_prediction_index_components: JSON.stringify({ paperTrading: { sample: 0 } }),
        calcio_prediction_index_rank_value: score * 1000, calcio_prediction_index_eligible: 0,
        calcio_net_executable_odd: 2, calcio_ai_finalization_status: 'BEST_MARKET_FULLY_CERTIFIED',
        calcio_market_ranking_certified: 1, calcio_output_coherence_status: 'OUTPUT_COHERENCE_CERTIFIED',
        calcio_finalization_transaction_status: 'COMMITTED_EVENT_ONLY',
        calcio_finalization_transaction_id: `TX_${key}`, calcio_analysis_only: 1,
        prediction_visibility: 'ANALYSIS_ONLY', exposure_role: 'ANALYSIS_ONLY',
        calcio_gate_status: 'CALCIO_WATCHLIST_MICRO', calcio_gate_allow_bet: 0, calcio_gate_max_stake: 0,
        calcio_stake_lifecycle_status: 'UNIFIED_INDEX_AWAITING_BATCH_ALLOCATION',
        calcio_stake_lifecycle_reason: 'attesa', calcio_operational_status: 'CALCIO_WATCHLIST_MICRO',
        calcio_operational_action: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION', calcio_operational_summary: 'attesa',
        calcio_gate_reasons: 'attesa', calcio_decision_certification_status: 'EVENT_STRUCTURALLY_FINALIZED_AWAITING_BATCH',
        calcio_decision_certification_reason: 'attesa', calcio_analysis_stage_code: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
        calcio_analysis_stage_label: 'IN ATTESA', calcio_analysis_stage_reason: 'attesa',
        calcio_quality_final_label: 'IN ATTESA', quality_final_label: 'IN ATTESA', quality_final_reason: 'attesa',
        quality_stake_mode: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION', quality_stake_amount: 0,
        calcio_pt_certification_status: 'PT_ABSENT_NEUTRAL', calcio_structural_certification_label: 'ANALISI',
        calcio_portfolio_cap_post_finalization: 0, calcio_runtime_consistency_status: 'EVENT_FINALIZED_PORTFOLIO_BATCH_PENDING',
        calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
        calcio_portfolio_pre_cap_eligible: failed ? 0 : 1,
        calcio_portfolio_pre_cap_stake: failed ? 0 : preCapStake,
        calcio_portfolio_post_cap_stake: 0, calcio_portfolio_batch_status: 'PENDING_BATCH',
        calcio_portfolio_batch_certified: 0, calcio_analysis_batch_id: null,
        calcio_event_finalization_id: null, calcio_portfolio_allocation_id: null,
        calcio_portfolio_cap_reason: null, calcio_batch_output_coherence_status: 'PENDING_BATCH_ALLOCATION'
    };
}

function insertRow(db, row) {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ai_forward_test (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map(name => row[name]));
}

function insertBatch(db, batchId, rows, statuses) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO calcio_ai_observation_batches
        (batch_id, version, route, request_digest, league, bankroll_snapshot, status, cache_hit,
         expected_event_count, persisted_event_count, created_at, completed_at, event_keys_json, diagnostics_json)
        VALUES (?, 'PATCH26A', '/api/analyze', 'fixture', 'serie_a', 1000, 'COMPLETED', 0, ?, ?, ?, ?, ?, '{}')`)
        .run(batchId, rows.length, rows.length, now, now, JSON.stringify(rows.map(r => r.match_exposure_key)));
    const insertEvent = db.prepare(`INSERT INTO calcio_ai_observation_batch_events
        (batch_id,event_key,bet_id,prediction,created_at) VALUES (?,?,?,?,?)`);
    const insertFinal = db.prepare(`INSERT INTO calcio_ai_observation_finalizations
        (finalization_id,version,batch_id,event_key,bet_id,prediction,status,candidate_pool_count,
         direct_finalized_count,degraded_finalized_count,failed_candidate_count,candidate_failure_codes_json,
         candidate_summary_json,before_snapshot_digest,after_snapshot_digest,mutated_row_ids_json,
         mutated_event_keys_json,cross_event_write_detected,transaction_id,finalization_status,
         output_coherence_status,started_at,completed_at,error_code,error_message,diagnostics_json)
        VALUES (?,?,?,?,?,?,?,3,?,0,?,'[]','[]','b','a',?,?,0,?,?,?,?,?,?,?,'{}')`);
    rows.forEach((row, index) => {
        const status = statuses[index];
        insertEvent.run(batchId, row.match_exposure_key, row.id, row.prediction, now);
        insertFinal.run(`FIN_${batchId}_${index}`, 'PATCH26A', batchId, row.match_exposure_key, row.id, row.prediction,
            status, status === 'COMPLETED' ? 3 : 0, status === 'FAILED' ? 1 : 0,
            JSON.stringify([row.id]), JSON.stringify([row.match_exposure_key]), `TX_${row.match_exposure_key}`,
            status === 'COMPLETED' ? 'MARKET_RANKING_FULLY_FINALIZED' : 'FAILED_FINALIZATION',
            status === 'COMPLETED' ? 'OUTPUT_COHERENCE_CERTIFIED' : null,
            now, now, status === 'FAILED' ? 'FIXTURE_FAILURE' : null, status === 'FAILED' ? 'fixture failure' : null);
    });
}

// Guard 1: una finalizzazione COMPLETED non viene retrocessa da un errore tardivo.
{
    const db = createDb();
    const row = rowFixture(1, 'EVENT_A', 70, 8);
    insertRow(db, row);
    const observation = observability.startEventFinalization(db, { eventKey: 'EVENT_A', betId: 1, prediction: 'O2.5' });
    observability.completeEventFinalization(db, observation, {
        ranking: [{ finalizationMode: 'DIRECT_MARKET_DEEPSCAN', finalized: true }, { finalizationMode: 'DIRECT_MARKET_DEEPSCAN', finalized: true }],
        transactionId: 'TX_EVENT_A', finalizationStatus: 'MARKET_RANKING_FULLY_FINALIZED',
        outputCoherenceStatus: 'OUTPUT_COHERENCE_CERTIFIED'
    });
    const late = observability.failEventFinalization(db, observation, new Error('late serialization error'));
    const stored = db.prepare('SELECT status,error_code,error_message FROM calcio_ai_observation_finalizations WHERE finalization_id=?').get(observation.finalizationId);
    assert.equal(stored.status, 'COMPLETED');
    assert.equal(stored.error_code, null);
    assert.equal(late.ignoredLateFailure, true);
    db.close();
}

// Guard 2: un batch con zero eventi COMPLETED non può essere committato.
{
    const db = createDb();
    const rows = [rowFixture(1, 'F1', 65, 0, true), rowFixture(2, 'F2', 66, 0, true)];
    rows.forEach(r => insertRow(db, r));
    insertBatch(db, 'BATCH_ALL_FAILED', rows, ['FAILED', 'FAILED']);
    assert.throws(() => allocator.allocateBatch(db, { batchId: 'BATCH_ALL_FAILED', professionalSelection: selection }),
        error => error.code === 'CALCIO_26D_BATCH_NO_COMPLETED_EVENTS');
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM calcio_ai_portfolio_batch_allocations').get().n), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE calcio_portfolio_batch_certified=1').get().n), 0);
    db.close();
}

// Guard 3: un batch parziale certifica solo gli eventi completati; il fallito resta escluso.
{
    const db = createDb();
    const ok = rowFixture(1, 'OK', 75, 8, false);
    const failed = rowFixture(2, 'FAILED', 70, 0, true);
    insertRow(db, ok); insertRow(db, failed);
    insertBatch(db, 'BATCH_PARTIAL', [ok, failed], ['COMPLETED', 'FAILED']);
    const result = allocator.allocateBatch(db, {
        batchId: 'BATCH_PARTIAL', professionalSelection: selection,
        caps: { totalExposurePct: 5, longshotExposurePct: 1, kickoffExposurePct: 2 }
    });
    assert.equal(result.status, 'COMMITTED_BATCH');
    const okStored = db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
    const failedStored = db.prepare('SELECT * FROM ai_forward_test WHERE id=2').get();
    assert.equal(okStored.calcio_portfolio_batch_certified, 1);
    assert.ok(okStored.calcio_operational_stake >= 2);
    assert.equal(failedStored.calcio_portfolio_batch_certified, 0);
    assert.equal(failedStored.calcio_operational_stake, 0);
    assert.equal(failedStored.calcio_portfolio_batch_status, 'EXCLUDED_FAILED_FINALIZATION');
    assert.equal(failedStored.calcio_output_coherence_status, 'OUTPUT_COHERENCE_NOT_CERTIFIED');
    assert.equal(failedStored.calcio_batch_output_coherence_status, 'BATCH_OUTPUT_COHERENCE_NOT_CERTIFIED');
    db.close();
}

console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY',
    guards: {
        completedCannotDowngrade: true,
        zeroCompletedBatchRejected: true,
        failedEventNotCertified: true,
        partialBatchStillAllocatesCompletedEvents: true
    }
}, null, 2));
