'use strict';

const crypto = require('crypto');

const CALCIO_OBSERVABILITY_VERSION = 'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_V1';

function nowIso() { return new Date().toISOString(); }
function text(value) { return String(value ?? '').trim(); }
function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function safeJson(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function json(value) {
    try { return JSON.stringify(stable(value ?? null)); } catch (_) { return 'null'; }
}
function digest(value) {
    return crypto.createHash('sha256').update(json(value)).digest('hex');
}
function id(prefix) {
    const token = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : crypto.randomBytes(16).toString('hex');
    return `${prefix}_${Date.now()}_${token.slice(0, 16)}`;
}
function eventKeyOf(row = {}) {
    return text(row.match_exposure_key || row.calcio_event_key || row.event_key || `${row.home_team || row.home || ''}|${row.away_team || row.away || ''}|${row.match_date || row.date || ''}`);
}


function runTransaction(db, fn) {
    if (typeof db.transaction === 'function') return db.transaction(fn)();
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }
}

function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS calcio_ai_observation_batches (
            batch_id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            route TEXT NOT NULL,
            request_digest TEXT,
            league TEXT,
            bankroll_snapshot REAL,
            status TEXT NOT NULL,
            cache_hit INTEGER DEFAULT 0,
            expected_event_count INTEGER,
            persisted_event_count INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            event_keys_json TEXT,
            diagnostics_json TEXT,
            error_code TEXT,
            error_message TEXT
        );
        CREATE TABLE IF NOT EXISTS calcio_ai_observation_batch_events (
            batch_id TEXT NOT NULL,
            event_key TEXT NOT NULL,
            bet_id INTEGER,
            prediction TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (batch_id, event_key, prediction)
        );
        CREATE INDEX IF NOT EXISTS idx_calcio_obs_batch_events_event
            ON calcio_ai_observation_batch_events(event_key, created_at DESC);
        CREATE TABLE IF NOT EXISTS calcio_ai_observation_finalizations (
            finalization_id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            batch_id TEXT,
            event_key TEXT NOT NULL,
            bet_id INTEGER,
            prediction TEXT,
            status TEXT NOT NULL,
            candidate_pool_count INTEGER,
            direct_finalized_count INTEGER,
            degraded_finalized_count INTEGER,
            failed_candidate_count INTEGER,
            candidate_failure_codes_json TEXT,
            candidate_summary_json TEXT,
            before_snapshot_digest TEXT,
            after_snapshot_digest TEXT,
            mutated_row_ids_json TEXT,
            mutated_event_keys_json TEXT,
            cross_event_write_detected INTEGER DEFAULT 0,
            transaction_id TEXT,
            finalization_status TEXT,
            output_coherence_status TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            error_code TEXT,
            error_message TEXT,
            diagnostics_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_calcio_obs_finalizations_event
            ON calcio_ai_observation_finalizations(event_key, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_calcio_obs_finalizations_batch
            ON calcio_ai_observation_finalizations(batch_id, started_at DESC);
        CREATE TABLE IF NOT EXISTS calcio_ai_observation_allocations (
            allocation_id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            batch_id TEXT,
            triggering_event_key TEXT,
            status TEXT NOT NULL,
            active_event_count INTEGER,
            total_pre_cap_stake REAL,
            total_post_cap_stake REAL,
            mutated_event_keys_json TEXT,
            caps_json TEXT,
            created_at TEXT NOT NULL,
            diagnostics_json TEXT
        );
    `);
    return { success: true, version: CALCIO_OBSERVABILITY_VERSION };
}

const SNAPSHOT_COLUMNS = [
    'id', 'home_team', 'away_team', 'match_date', 'prediction', 'status', 'stake',
    'calcio_operational_stake', 'calcio_theoretical_stake', 'calcio_prediction_index_score',
    'calcio_prediction_index_label', 'calcio_prediction_index_eligible', 'ds_action',
    'calcio_ai_finalization_status', 'calcio_market_finalized_count',
    'calcio_market_finalization_candidate_count', 'calcio_output_coherence_status',
    'calcio_runtime_consistency_status', 'calcio_finalization_transaction_id',
    'calcio_finalization_transaction_status', 'calcio_stake_lifecycle_status',
    'calcio_analysis_only', 'prediction_visibility', 'exposure_role', 'strategy_tag',
    'match_exposure_key', 'calcio_event_key'
];

function availableSnapshotColumns(db) {
    const existing = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(c => c.name));
    return SNAPSHOT_COLUMNS.filter(c => existing.has(c));
}

function snapshotActivePending(db) {
    const columns = availableSnapshotColumns(db);
    const rows = db.prepare(`
        SELECT ${columns.join(', ')}
        FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
          AND COALESCE(paper_result_active, 1) = 1
          AND COALESCE(paper_result_conflict, 0) = 0
        ORDER BY id
    `).all();
    const normalized = rows.map(row => ({
        ...row,
        event_key: eventKeyOf(row)
    }));
    return { rows: normalized, digest: digest(normalized), capturedAt: nowIso() };
}

function diffSnapshots(before, after) {
    const beforeById = new Map((before?.rows || []).map(row => [Number(row.id), row]));
    const afterById = new Map((after?.rows || []).map(row => [Number(row.id), row]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort((a, b) => a - b);
    const mutatedRows = [];
    for (const rowId of ids) {
        const left = beforeById.get(rowId) || null;
        const right = afterById.get(rowId) || null;
        if (digest(left) !== digest(right)) {
            mutatedRows.push({
                id: rowId,
                eventKey: eventKeyOf(right || left || {}),
                beforeDigest: digest(left),
                afterDigest: digest(right)
            });
        }
    }
    return {
        mutatedRows,
        mutatedRowIds: mutatedRows.map(r => r.id),
        mutatedEventKeys: [...new Set(mutatedRows.map(r => r.eventKey).filter(Boolean))]
    };
}

function startAnalysisBatch(db, input = {}) {
    ensureSchema(db);
    const batchId = id('CALCIO_BATCH');
    db.prepare(`
        INSERT INTO calcio_ai_observation_batches
        (batch_id, version, route, request_digest, league, bankroll_snapshot, status, cache_hit, created_at, diagnostics_json)
        VALUES (?, ?, ?, ?, ?, ?, 'STARTED', ?, ?, ?)
    `).run(
        batchId,
        CALCIO_OBSERVABILITY_VERSION,
        input.route || '/api/analyze',
        input.requestDigest || null,
        input.league || null,
        num(input.bankrollSnapshot, null),
        input.cacheHit ? 1 : 0,
        nowIso(),
        json(input.diagnostics || {})
    );
    return { batchId, version: CALCIO_OBSERVABILITY_VERSION };
}

function completeAnalysisBatch(db, batch, input = {}) {
    if (!batch?.batchId) return null;
    const events = Array.isArray(input.events) ? input.events : [];
    const insertEvent = db.prepare(`
        INSERT OR REPLACE INTO calcio_ai_observation_batch_events
        (batch_id, event_key, bet_id, prediction, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    runTransaction(db, () => {
        for (const event of events) {
            const key = eventKeyOf(event);
            if (!key) continue;
            const row = db.prepare(`
                SELECT id FROM ai_forward_test
                WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                  AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
                  AND (match_exposure_key = ? OR calcio_event_key = ?)
                ORDER BY id DESC LIMIT 1
            `).get(key, key);
            insertEvent.run(batch.batchId, key, row?.id || null, event.prediction || null, nowIso());
        }
    });
    const eventKeys = [...new Set(events.map(eventKeyOf).filter(Boolean))];
    db.prepare(`
        UPDATE calcio_ai_observation_batches
        SET status = 'COMPLETED', expected_event_count = ?, persisted_event_count = ?,
            completed_at = ?, event_keys_json = ?, diagnostics_json = ?
        WHERE batch_id = ?
    `).run(
        num(input.expectedEventCount, events.length),
        num(input.persistedEventCount, events.length),
        nowIso(),
        json(eventKeys),
        json(input.diagnostics || {}),
        batch.batchId
    );
    return { batchId: batch.batchId, eventKeys };
}

function failAnalysisBatch(db, batch, error) {
    if (!batch?.batchId) return null;
    db.prepare(`
        UPDATE calcio_ai_observation_batches
        SET status = 'FAILED', completed_at = ?, error_code = ?, error_message = ?
        WHERE batch_id = ?
    `).run(nowIso(), error?.code || 'CALCIO_ANALYSIS_ERROR', text(error?.message || error), batch.batchId);
    return { batchId: batch.batchId, status: 'FAILED' };
}

function resolveBatchIdForEvent(db, eventKey) {
    if (!eventKey) return null;
    return db.prepare(`
        SELECT batch_id FROM calcio_ai_observation_batch_events
        WHERE event_key = ? ORDER BY created_at DESC LIMIT 1
    `).get(eventKey)?.batch_id || null;
}

function startEventFinalization(db, input = {}) {
    ensureSchema(db);
    const finalizationId = id('CALCIO_EVENT_FINALIZATION');
    const before = snapshotActivePending(db);
    const batchId = input.batchId || resolveBatchIdForEvent(db, input.eventKey) || null;
    db.prepare(`
        INSERT INTO calcio_ai_observation_finalizations
        (finalization_id, version, batch_id, event_key, bet_id, prediction, status,
         candidate_pool_count, before_snapshot_digest, started_at, diagnostics_json)
        VALUES (?, ?, ?, ?, ?, ?, 'STARTED', ?, ?, ?, ?)
    `).run(
        finalizationId,
        CALCIO_OBSERVABILITY_VERSION,
        batchId,
        input.eventKey,
        input.betId || null,
        input.prediction || null,
        input.candidatePoolCount ?? null,
        before.digest,
        nowIso(),
        json(input.diagnostics || {})
    );
    return { finalizationId, batchId, eventKey: input.eventKey, before };
}

function updateEventPlan(db, observation, input = {}) {
    if (!observation?.finalizationId) return null;
    db.prepare(`
        UPDATE calcio_ai_observation_finalizations
        SET candidate_pool_count = ?, candidate_summary_json = ?, diagnostics_json = ?
        WHERE finalization_id = ?
    `).run(
        input.candidatePoolCount ?? null,
        json(input.candidateSummary || []),
        json(input.diagnostics || {}),
        observation.finalizationId
    );
    return observation;
}

function completeEventFinalization(db, observation, input = {}) {
    if (!observation?.finalizationId) return null;
    const after = snapshotActivePending(db);
    const changes = diffSnapshots(observation.before, after);
    const crossEvent = changes.mutatedEventKeys.some(key => key && key !== observation.eventKey);
    const ranking = Array.isArray(input.ranking) ? input.ranking : [];
    const direct = input.directFinalizedCount ?? ranking.filter(item => item?.finalizationMode === 'DIRECT_MARKET_DEEPSCAN').length;
    const degraded = input.degradedFinalizedCount ?? ranking.filter(item => item?.finalizationMode && item.finalizationMode !== 'DIRECT_MARKET_DEEPSCAN').length;
    const failed = input.failedCandidateCount ?? ranking.filter(item => item?.finalized === false).length;
    const failureCodes = input.failureCodes || ranking.map(item => item?.error || item?.scanError).filter(Boolean);
    db.prepare(`
        UPDATE calcio_ai_observation_finalizations
        SET status = 'COMPLETED', direct_finalized_count = ?, degraded_finalized_count = ?,
            failed_candidate_count = ?, candidate_failure_codes_json = ?, candidate_summary_json = ?,
            after_snapshot_digest = ?, mutated_row_ids_json = ?, mutated_event_keys_json = ?,
            cross_event_write_detected = ?, transaction_id = ?, finalization_status = ?,
            output_coherence_status = ?, completed_at = ?, diagnostics_json = ?
        WHERE finalization_id = ?
    `).run(
        direct,
        degraded,
        failed,
        json(failureCodes),
        json(ranking),
        after.digest,
        json(changes.mutatedRowIds),
        json(changes.mutatedEventKeys),
        crossEvent ? 1 : 0,
        input.transactionId || null,
        input.finalizationStatus || null,
        input.outputCoherenceStatus || null,
        nowIso(),
        json(input.diagnostics || {}),
        observation.finalizationId
    );

    const rows = after.rows || [];
    const totalPre = rows.reduce((sum, row) => sum + num(row.calcio_theoretical_stake, 0), 0);
    const totalPost = rows.reduce((sum, row) => sum + num(row.calcio_operational_stake ?? row.stake, 0), 0);
    db.prepare(`
        INSERT INTO calcio_ai_observation_allocations
        (allocation_id, version, batch_id, triggering_event_key, status, active_event_count,
         total_pre_cap_stake, total_post_cap_stake, mutated_event_keys_json, caps_json, created_at, diagnostics_json)
        VALUES (?, ?, ?, ?, 'OBSERVED', ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id('CALCIO_PORTFOLIO_ALLOCATION'),
        CALCIO_OBSERVABILITY_VERSION,
        observation.batchId,
        observation.eventKey,
        rows.length,
        totalPre,
        totalPost,
        json(changes.mutatedEventKeys),
        json(input.caps || {}),
        nowIso(),
        json({ crossEventWriteDetected: crossEvent, transactionId: input.transactionId || null })
    );
    return { finalizationId: observation.finalizationId, crossEventWriteDetected: crossEvent, ...changes };
}

function failEventFinalization(db, observation, error, input = {}) {
    if (!observation?.finalizationId) return null;
    const current = db.prepare(`
        SELECT status, finalization_status, output_coherence_status
        FROM calcio_ai_observation_finalizations WHERE finalization_id = ?
    `).get(observation.finalizationId);
    const currentStatus = text(current?.status).toUpperCase();
    // PATCH 26D: un errore HTTP/JSON successivo al commit non può retrocedere
    // una finalizzazione già COMPLETED. Il bug Patch 26C produceva esattamente
    // COMPLETED -> FAILED dopo il ReferenceError di scope nel return della route.
    if (currentStatus && currentStatus !== 'STARTED') {
        return {
            finalizationId: observation.finalizationId,
            status: currentStatus,
            ignoredLateFailure: true,
            terminalWriteProtected: true,
            finalizationStatus: current?.finalization_status || null,
            outputCoherenceStatus: current?.output_coherence_status || null
        };
    }
    const after = snapshotActivePending(db);
    const changes = diffSnapshots(observation.before, after);
    const crossEvent = changes.mutatedEventKeys.some(key => key && key !== observation.eventKey);
    const result = db.prepare(`
        UPDATE calcio_ai_observation_finalizations
        SET status = 'FAILED', after_snapshot_digest = ?, mutated_row_ids_json = ?,
            mutated_event_keys_json = ?, cross_event_write_detected = ?, completed_at = ?,
            error_code = ?, error_message = ?, diagnostics_json = ?
        WHERE finalization_id = ? AND status = 'STARTED'
    `).run(
        after.digest,
        json(changes.mutatedRowIds),
        json(changes.mutatedEventKeys),
        crossEvent ? 1 : 0,
        nowIso(),
        error?.code || 'CALCIO_DEEPSCAN_ROUTE_ERROR',
        text(error?.message || error),
        json(input.diagnostics || {}),
        observation.finalizationId
    );
    return {
        finalizationId: observation.finalizationId,
        status: result.changes > 0 ? 'FAILED' : currentStatus || 'UNKNOWN',
        crossEventWriteDetected: crossEvent,
        terminalWriteProtected: true
    };
}

function latestRowsByEvent(db) {
    const rows = db.prepare(`
        SELECT * FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
          AND COALESCE(paper_result_active, 1) = 1
          AND COALESCE(paper_result_conflict, 0) = 0
        ORDER BY id DESC
    `).all();
    const seen = new Set();
    return rows.filter(row => {
        const key = eventKeyOf(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildDiagnosticsReport(db, options = {}) {
    ensureSchema(db);
    const latest = latestRowsByEvent(db);
    const authorizedZero = latest.filter(row =>
        /AUTHORIZED/i.test(text(row.calcio_stake_lifecycle_status)) && num(row.calcio_operational_stake ?? row.stake, 0) < 2
    );
    const certifiedWithoutFinalization = latest.filter(row =>
        /CERTIFIED/i.test(text(row.calcio_runtime_consistency_status)) && num(row.calcio_market_finalized_count, 0) < 1
    );
    const awaiting = latest.filter(row => /AWAITING/i.test(text(row.calcio_ai_finalization_status)));
    const transactionGroups = new Map();
    for (const row of latest) {
        const tx = text(row.calcio_finalization_transaction_id);
        if (!tx) continue;
        if (!transactionGroups.has(tx)) transactionGroups.set(tx, []);
        transactionGroups.get(tx).push(eventKeyOf(row));
    }
    const sharedTransactions = [...transactionGroups.entries()]
        .filter(([, keys]) => new Set(keys).size > 1)
        .map(([transactionId, keys]) => ({ transactionId, eventCount: new Set(keys).size, eventKeys: [...new Set(keys)] }));
    const recentFinalizations = db.prepare(`
        SELECT * FROM calcio_ai_observation_finalizations
        ORDER BY started_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(500, num(options.limit, 100)))).map(row => ({
        ...row,
        candidate_failure_codes: safeJson(row.candidate_failure_codes_json, []),
        mutated_row_ids: safeJson(row.mutated_row_ids_json, []),
        mutated_event_keys: safeJson(row.mutated_event_keys_json, []),
        candidate_summary: safeJson(row.candidate_summary_json, [])
    }));
    const crossEventObservations = recentFinalizations.filter(row => row.cross_event_write_detected === 1);
    return {
        success: true,
        version: CALCIO_OBSERVABILITY_VERSION,
        readOnly: true,
        decisionAuthorityChanged: false,
        stakeAuthorityChanged: false,
        activePendingEventCount: latest.length,
        invariants: {
            authorizedZeroCount: authorizedZero.length,
            certifiedWithoutFinalizationCount: certifiedWithoutFinalization.length,
            awaitingFinalizationCount: awaiting.length,
            sharedTransactionGroupCount: sharedTransactions.length,
            observedCrossEventWriteCount: crossEventObservations.length
        },
        anomalies: {
            authorizedZero: authorizedZero.map(row => ({ id: row.id, eventKey: eventKeyOf(row), status: row.calcio_stake_lifecycle_status, operationalStake: num(row.calcio_operational_stake ?? row.stake, 0) })),
            certifiedWithoutFinalization: certifiedWithoutFinalization.map(row => ({ id: row.id, eventKey: eventKeyOf(row), runtimeStatus: row.calcio_runtime_consistency_status, finalizedCount: num(row.calcio_market_finalized_count, 0) })),
            awaitingFinalization: awaiting.map(row => ({ id: row.id, eventKey: eventKeyOf(row), status: row.calcio_ai_finalization_status, ipm: num(row.calcio_prediction_index_score, 0) })),
            sharedTransactions,
            observedCrossEventWrites: crossEventObservations.map(row => ({ finalizationId: row.finalization_id, eventKey: row.event_key, mutatedEventKeys: row.mutated_event_keys }))
        },
        recentFinalizations,
        generatedAt: nowIso()
    };
}

module.exports = {
    CALCIO_OBSERVABILITY_VERSION,
    ensureSchema,
    snapshotActivePending,
    diffSnapshots,
    startAnalysisBatch,
    completeAnalysisBatch,
    failAnalysisBatch,
    startEventFinalization,
    updateEventPlan,
    completeEventFinalization,
    failEventFinalization,
    buildDiagnosticsReport,
    eventKeyOf
};
