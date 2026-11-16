'use strict';

const assert = require('assert/strict');
const Database = require('./sqlite-compat');
const observability = require('../backend/calcioObservability');
const allocator = require('../backend/calcioBatchPortfolioAllocator');
const selection = require('../backend/calcioProfessionalSelection');

function createDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ai_forward_test (
            id INTEGER PRIMARY KEY,
            sport_type TEXT,
            status TEXT,
            bet_type TEXT,
            paper_result_active INTEGER,
            paper_result_conflict INTEGER,
            match_exposure_key TEXT,
            calcio_event_key TEXT,
            match_date TEXT,
            home_team TEXT,
            away_team TEXT,
            prediction TEXT,
            market_type TEXT,
            odd REAL,
            stake REAL,
            estimated_prob REAL,
            edge REAL,
            edge_pp REAL,
            ev_pct REAL,
            bankroll_snapshot REAL,
            strategy_tag TEXT,
            calcio_theoretical_stake REAL,
            calcio_operational_stake REAL,
            calcio_prediction_index_score REAL,
            calcio_prediction_index_label TEXT,
            calcio_prediction_index_reason TEXT,
            calcio_prediction_index_components TEXT,
            calcio_prediction_index_rank_value REAL,
            calcio_prediction_index_eligible INTEGER,
            calcio_net_executable_odd REAL,
            calcio_ai_finalization_status TEXT,
            calcio_market_ranking_certified INTEGER,
            calcio_output_coherence_status TEXT,
            calcio_finalization_transaction_status TEXT,
            calcio_finalization_transaction_id TEXT,
            calcio_analysis_only INTEGER,
            prediction_visibility TEXT,
            exposure_role TEXT,
            calcio_gate_status TEXT,
            calcio_gate_allow_bet INTEGER,
            calcio_gate_max_stake REAL,
            calcio_stake_lifecycle_status TEXT,
            calcio_stake_lifecycle_reason TEXT,
            calcio_operational_status TEXT,
            calcio_operational_action TEXT,
            calcio_operational_summary TEXT,
            calcio_gate_reasons TEXT,
            calcio_decision_certification_status TEXT,
            calcio_decision_certification_reason TEXT,
            calcio_analysis_stage_code TEXT,
            calcio_analysis_stage_label TEXT,
            calcio_analysis_stage_reason TEXT,
            calcio_quality_final_label TEXT,
            quality_final_label TEXT,
            quality_final_reason TEXT,
            quality_stake_mode TEXT,
            quality_stake_amount REAL,
            calcio_pt_certification_status TEXT,
            calcio_structural_certification_label TEXT,
            calcio_portfolio_cap_post_finalization INTEGER,
            calcio_runtime_consistency_status TEXT,
            calcio_profit_display_mode TEXT
        );
    `);
    observability.ensureSchema(db);
    allocator.ensureSchema(db);
    return db;
}

function rowFixture(id, key, score, preCapStake, odd, kickoff, options = {}) {
    const components = { paperTrading: { sample: options.ptSample || 0 } };
    return {
        id,
        sport_type: 'CALCIO',
        status: 'PENDING',
        bet_type: 'SINGLE_CR',
        paper_result_active: 1,
        paper_result_conflict: 0,
        match_exposure_key: key,
        calcio_event_key: key,
        match_date: kickoff,
        home_team: `Home${id}`,
        away_team: `Away${id}`,
        prediction: options.prediction || 'O2.5',
        market_type: options.marketType || 'TOTALS',
        odd,
        stake: 0,
        estimated_prob: 56,
        edge: 3,
        edge_pp: 3,
        ev_pct: 5,
        bankroll_snapshot: 1000,
        strategy_tag: `SERIE_A_${id}_ANALYSIS_ONLY`,
        calcio_theoretical_stake: preCapStake,
        calcio_operational_stake: 0,
        calcio_prediction_index_score: score,
        calcio_prediction_index_label: score >= 70 ? 'VALUE' : 'MICRO',
        calcio_prediction_index_reason: 'Fixture pre-cap',
        calcio_prediction_index_components: JSON.stringify(components),
        calcio_prediction_index_rank_value: score * 1000,
        calcio_prediction_index_eligible: 0,
        calcio_net_executable_odd: odd,
        calcio_ai_finalization_status: 'BEST_MARKET_FULLY_CERTIFIED',
        calcio_market_ranking_certified: 1,
        calcio_output_coherence_status: 'OUTPUT_COHERENCE_CERTIFIED',
        calcio_finalization_transaction_status: 'COMMITTED_EVENT_ONLY',
        calcio_finalization_transaction_id: `EV_TX_${key}`,
        calcio_analysis_only: 1,
        prediction_visibility: 'ANALYSIS_ONLY',
        exposure_role: 'ANALYSIS_ONLY',
        calcio_gate_status: 'CALCIO_WATCHLIST_MICRO',
        calcio_gate_allow_bet: 0,
        calcio_gate_max_stake: 0,
        calcio_stake_lifecycle_status: 'UNIFIED_INDEX_AWAITING_BATCH_ALLOCATION',
        calcio_stake_lifecycle_reason: 'Attesa batch',
        calcio_operational_status: 'CALCIO_WATCHLIST_MICRO',
        calcio_operational_action: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
        calcio_operational_summary: 'Attesa batch',
        calcio_gate_reasons: 'Attesa batch',
        calcio_decision_certification_status: 'EVENT_STRUCTURALLY_FINALIZED_AWAITING_BATCH',
        calcio_decision_certification_reason: 'Attesa batch',
        calcio_analysis_stage_code: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
        calcio_analysis_stage_label: 'IN ATTESA ALLOCAZIONE BATCH',
        calcio_analysis_stage_reason: 'Attesa batch',
        calcio_quality_final_label: 'IN ATTESA ALLOCAZIONE BATCH',
        quality_final_label: 'IN ATTESA ALLOCAZIONE BATCH',
        quality_final_reason: 'Attesa batch',
        quality_stake_mode: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
        quality_stake_amount: 0,
        calcio_pt_certification_status: 'PT_ABSENT_NEUTRAL',
        calcio_structural_certification_label: 'ANALISI · NESSUNA AUTORITÀ STAKE',
        calcio_portfolio_cap_post_finalization: 0,
        calcio_runtime_consistency_status: 'EVENT_FINALIZED_PORTFOLIO_BATCH_PENDING',
        calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
        calcio_portfolio_pre_cap_eligible: options.failed ? 0 : 1,
        calcio_portfolio_pre_cap_stake: options.failed ? 0 : preCapStake,
        calcio_portfolio_post_cap_stake: 0,
        calcio_portfolio_batch_status: 'PENDING_BATCH',
        calcio_portfolio_batch_certified: 0,
        calcio_analysis_batch_id: null,
        calcio_event_finalization_id: null,
        calcio_portfolio_allocation_id: null,
        calcio_portfolio_cap_reason: null,
        calcio_batch_output_coherence_status: 'PENDING_BATCH_ALLOCATION'
    };
}

function insertRow(db, row) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO ai_forward_test (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(key => row[key]));
}

function insertBatch(db, batchId, order, rowsByKey, failedKey = null) {
    db.prepare(`
        INSERT INTO calcio_ai_observation_batches
        (batch_id, version, route, request_digest, league, bankroll_snapshot, status, cache_hit,
         expected_event_count, persisted_event_count, created_at, completed_at, event_keys_json, diagnostics_json)
        VALUES (?, 'PATCH26A', '/api/analyze', 'fixture', 'serie_a', 1000, 'COMPLETED', 0, ?, ?, ?, ?, ?, '{}')
    `).run(batchId, order.length, order.length, new Date().toISOString(), new Date().toISOString(), JSON.stringify(order));
    const eventInsert = db.prepare(`
        INSERT INTO calcio_ai_observation_batch_events
        (batch_id, event_key, bet_id, prediction, created_at) VALUES (?, ?, ?, ?, ?)
    `);
    const finalInsert = db.prepare(`
        INSERT INTO calcio_ai_observation_finalizations
        (finalization_id, version, batch_id, event_key, bet_id, prediction, status,
         candidate_pool_count, direct_finalized_count, degraded_finalized_count, failed_candidate_count,
         candidate_failure_codes_json, candidate_summary_json, before_snapshot_digest, after_snapshot_digest,
         mutated_row_ids_json, mutated_event_keys_json, cross_event_write_detected, transaction_id,
         finalization_status, output_coherence_status, started_at, completed_at, error_code, error_message, diagnostics_json)
        VALUES (?, 'PATCH26A', ?, ?, ?, ?, ?, 3, ?, 0, ?, '[]', '[]', 'before', 'after', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, '{}')
    `);
    order.forEach((key, index) => {
        const row = rowsByKey[key];
        const failed = key === failedKey;
        eventInsert.run(batchId, key, row.id, row.prediction, new Date(Date.now() + index).toISOString());
        finalInsert.run(
            `FIN_${batchId}_${key}`,
            batchId,
            key,
            row.id,
            row.prediction,
            failed ? 'FAILED' : 'COMPLETED',
            failed ? 0 : 3,
            failed ? 1 : 0,
            JSON.stringify([row.id]),
            JSON.stringify([key]),
            `EV_TX_${key}`,
            failed ? 'FAILED_FINALIZATION' : 'BEST_MARKET_FULLY_CERTIFIED',
            failed ? null : 'OUTPUT_COHERENCE_CERTIFIED',
            new Date(Date.now() + index).toISOString(),
            new Date(Date.now() + index + 20).toISOString(),
            failed ? 'FIXTURE_TIMEOUT' : null,
            failed ? 'fixture timeout' : null
        );
    });
}

function runFixture(order) {
    const db = createDb();
    const rows = {
        A: rowFixture(1, 'A', 80, 15, 2.0, '2026-08-22T18:15:00Z'),
        B: rowFixture(2, 'B', 70, 15, 2.0, '2026-08-22T18:45:00Z'),
        C: rowFixture(3, 'C', 75, 12, 4.0, '2026-08-22T20:45:00Z', { prediction: '2', marketType: '1X2' }),
        D: rowFixture(4, 'D', 65, 30, 1.8, '2026-08-23T20:45:00Z'),
        F: rowFixture(5, 'F', 90, 20, 1.9, '2026-08-24T20:45:00Z', { failed: true })
    };
    Object.values(rows).forEach(row => insertRow(db, row));
    insertBatch(db, 'BATCH_1', order, rows, 'F');
    const result = allocator.allocateBatch(db, {
        batchId: 'BATCH_1',
        professionalSelection: selection,
        caps: { totalExposurePct: 5, longshotExposurePct: 1, kickoffExposurePct: 2 }
    });
    const map = Object.fromEntries(result.rows.map(item => [item.eventKey, item.row.calcio_portfolio_post_cap_stake]));
    const eventTx = Object.fromEntries(result.rows.map(item => [item.eventKey, db.prepare('SELECT calcio_finalization_transaction_id FROM ai_forward_test WHERE id=?').get(item.betId).calcio_finalization_transaction_id]));
    const second = allocator.allocateBatch(db, {
        batchId: 'BATCH_1',
        professionalSelection: selection,
        caps: { totalExposurePct: 5, longshotExposurePct: 1, kickoffExposurePct: 2 }
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.allocationId, result.allocationId);
    const foreign = rowFixture(99, 'OUTSIDE', 85, 9, 1.8, '2026-08-25T20:45:00Z');
    insertRow(db, foreign);
    const outsideAfter = db.prepare('SELECT stake, calcio_operational_stake FROM ai_forward_test WHERE id=99').get();
    assert.equal(outsideAfter.stake, 0);
    assert.equal(outsideAfter.calcio_operational_stake, 0);
    db.close();
    return { map, eventTx, result };
}

const first = runFixture(['A', 'B', 'C', 'D', 'F']);
const second = runFixture(['F', 'D', 'C', 'B', 'A']);
assert.deepEqual(first.map, second.map, 'L’ordine della coda non deve modificare l’allocazione');
assert.deepEqual(first.eventTx, second.eventTx, 'Gli event transaction id devono essere preservati');
assert.equal(first.map.A, 15);
assert.equal(first.map.B, 5, 'Cap fascia oraria 2% su bankroll 1000');
assert.equal(first.map.C, 10, 'Cap longshot 1% su bankroll 1000');
assert.equal(first.map.D, 20, 'Cap totale residuo fino a 5%');
assert.equal(first.map.F, 0, 'Evento fallito non può ricevere stake');
assert.equal(Object.values(first.map).reduce((a, b) => a + b, 0), 50, 'Cap totale 5%');
assert.equal(first.result.status, 'COMMITTED_BATCH');
assert.equal(first.result.diagnostics.orderIndependent, true);
assert.equal(first.result.rows.filter(item => item.result.predictionIndex.eligible).length, 4);

console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI',
    checks: [
        'one allocation per analysis batch',
        'order permutation invariant',
        'total exposure cap 5%',
        'longshot cap 1%',
        'kickoff cap 2%',
        'failed finalization zero stake',
        'idempotent allocation',
        'event transaction ids preserved'
    ],
    allocation: first.map
}, null, 2));
