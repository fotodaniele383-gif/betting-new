'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH_ID = 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY';
const RECOVERY_ERROR = 'stakeReconciliationDecision is not defined';
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');

function text(value) { return String(value ?? '').trim(); }
function json(value) { return JSON.stringify(value ?? null); }
function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function nowIso() { return new Date().toISOString(); }
function makeId() { return `PATCH26D_RECOVERY_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`; }
function digestRows(rows) {
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function columns(db, table) {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}
function tableExists(db, table) {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function count(db, sql, ...params) { return Number(db.prepare(sql).get(...params)?.n || 0); }
function protectedDigest(db, predicateSql) {
    const rows = db.prepare(`
        SELECT id, bet_type, match_date, home_team, away_team, prediction, odd, stake, status,
               profit, sport_type, total_goals, home_goals, away_goals, settlement_source,
               settlement_note, settled_at
        FROM ai_forward_test
        WHERE ${predicateSql}
        ORDER BY id
    `).all();
    return digestRows(rows);
}
function mergeDiagnostics(raw, extra) { return json({ ...parseJson(raw, {}), ...extra }); }
function runTransaction(db, fn) {
    if (typeof db.transaction === 'function') return db.transaction(fn)();
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }
}

const db = new Database(dbPath);
try {
    const requiredTables = ['ai_forward_test', 'calcio_ai_observation_finalizations', 'calcio_ai_portfolio_batch_allocations'];
    for (const table of requiredTables) {
        if (!tableExists(db, table)) throw new Error(`Tabella richiesta mancante: ${table}`);
    }
    const aiColumns = columns(db, 'ai_forward_test');
    const requiredColumns = [
        'calcio_analysis_batch_id', 'calcio_event_finalization_id', 'calcio_portfolio_allocation_id',
        'calcio_portfolio_batch_status', 'calcio_portfolio_batch_certified',
        'calcio_portfolio_pre_cap_eligible', 'calcio_portfolio_pre_cap_stake',
        'calcio_portfolio_post_cap_stake', 'calcio_batch_output_coherence_status',
        'calcio_analysis_stage_code', 'calcio_output_coherence_status'
    ];
    for (const name of requiredColumns) {
        if (!aiColumns.has(name)) throw new Error(`Colonna Patch 26C mancante: ${name}`);
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS calcio_patch26d_recovery_runs (
            recovery_id TEXT PRIMARY KEY,
            patch_id TEXT NOT NULL,
            status TEXT NOT NULL,
            affected_finalizations INTEGER NOT NULL DEFAULT 0,
            affected_batches INTEGER NOT NULL DEFAULT 0,
            affected_pending_rows INTEGER NOT NULL DEFAULT 0,
            tennis_digest_before TEXT,
            tennis_digest_after TEXT,
            resolved_calcio_digest_before TEXT,
            resolved_calcio_digest_after TEXT,
            created_at TEXT NOT NULL,
            details_json TEXT
        );
    `);

    const before = {
        totalRows: count(db, 'SELECT COUNT(*) n FROM ai_forward_test'),
        tennisRows: count(db, "SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcioRows: count(db, "SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')"),
        tennisDigest: protectedDigest(db, "UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcioDigest: protectedDigest(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };

    const affected = db.prepare(`
        SELECT finalization_id, batch_id, event_key, bet_id, status, error_code, error_message,
               finalization_status, output_coherence_status, diagnostics_json
        FROM calcio_ai_observation_finalizations
        WHERE status = 'FAILED'
          AND error_code = 'CALCIO_DEEPSCAN_ROUTE_ERROR'
          AND error_message = ?
          AND COALESCE(finalization_status, '') <> ''
    `).all(RECOVERY_ERROR);
    const batchIds = [...new Set(affected.map(row => text(row.batch_id)).filter(Boolean))];
    const betIds = [...new Set(affected.map(row => Number(row.bet_id)).filter(Number.isFinite))];
    const eventKeys = [...new Set(affected.map(row => text(row.event_key)).filter(Boolean))];
    const recoveryId = makeId();
    const recoveryReason = 'Rianalisi richiesta: corretto errore post-commit di scope Patch 26C.';

    const transactionResult = runTransaction(db, () => {
        for (const row of affected) {
            db.prepare(`
                UPDATE calcio_ai_observation_finalizations
                SET status = 'INVALIDATED_PATCH26D',
                    error_code = 'PATCH26D_SCOPE_REFERENCE_RECOVERED',
                    error_message = ?,
                    output_coherence_status = 'OUTPUT_COHERENCE_INVALIDATED_PATCH26D',
                    diagnostics_json = ?
                WHERE finalization_id = ?
            `).run(
                `Invalidata per rianalisi. Errore originale: ${RECOVERY_ERROR}`,
                mergeDiagnostics(row.diagnostics_json, {
                    patch26dRecoveryId: recoveryId,
                    invalidatedAt: nowIso(),
                    originalStatus: row.status,
                    originalErrorCode: row.error_code,
                    originalErrorMessage: row.error_message,
                    originalFinalizationStatus: row.finalization_status,
                    originalOutputCoherenceStatus: row.output_coherence_status
                }),
                row.finalization_id
            );
        }

        for (const batchId of batchIds) {
            if (tableExists(db, 'calcio_ai_portfolio_batch_allocations')) {
                const rows = db.prepare('SELECT allocation_id, diagnostics_json FROM calcio_ai_portfolio_batch_allocations WHERE batch_id = ?').all(batchId);
                for (const row of rows) {
                    db.prepare(`
                        UPDATE calcio_ai_portfolio_batch_allocations
                        SET status = 'INVALIDATED_PATCH26D', total_post_cap_stake = 0,
                            diagnostics_json = ? WHERE allocation_id = ?
                    `).run(mergeDiagnostics(row.diagnostics_json, {
                        patch26dRecoveryId: recoveryId,
                        invalidatedAt: nowIso(),
                        portfolioBatchCertified: false,
                        reason: recoveryReason
                    }), row.allocation_id);
                }
            }
            if (tableExists(db, 'calcio_ai_observation_allocations')) {
                db.prepare(`
                    UPDATE calcio_ai_observation_allocations
                    SET status = 'INVALIDATED_PATCH26D', total_post_cap_stake = 0
                    WHERE batch_id = ? AND status = 'COMMITTED_BATCH'
                `).run(batchId);
            }
            if (tableExists(db, 'calcio_ai_observation_batches')) {
                const batch = db.prepare('SELECT diagnostics_json FROM calcio_ai_observation_batches WHERE batch_id = ?').get(batchId);
                if (batch) {
                    db.prepare(`
                        UPDATE calcio_ai_observation_batches
                        SET status = 'INVALIDATED_PATCH26D_REANALYZE', error_code = 'PATCH26D_SCOPE_REFERENCE_RECOVERED',
                            error_message = ?, diagnostics_json = ? WHERE batch_id = ?
                    `).run(recoveryReason, mergeDiagnostics(batch.diagnostics_json, {
                        patch26dRecoveryId: recoveryId,
                        invalidatedAt: nowIso(),
                        portfolioBatchCertified: false,
                        reason: recoveryReason
                    }), batchId);
                }
            }
        }

        const resetFields = {
            stake: 0,
            profit: 0,
            calcio_theoretical_stake: 0,
            calcio_operational_stake: 0,
            calcio_gate_max_stake: 0,
            calcio_gate_allow_bet: 0,
            calcio_prediction_index_score: null,
            calcio_prediction_index_label: 'N/D',
            calcio_prediction_index_reason: recoveryReason,
            calcio_prediction_index_components: null,
            calcio_prediction_index_rank_value: null,
            calcio_prediction_index_eligible: 0,
            calcio_stake_lifecycle_status: 'UNIFIED_INDEX_NO_STAKE',
            calcio_stake_lifecycle_reason: recoveryReason,
            calcio_operational_status: 'CALCIO_WATCHLIST_MICRO',
            calcio_operational_action: 'ANALYSIS_ONLY_UNIFIED_INDEX',
            calcio_operational_summary: recoveryReason,
            calcio_gate_status: 'CALCIO_WATCHLIST_MICRO',
            calcio_gate_reasons: recoveryReason,
            calcio_decision_certification_status: 'DECISION_NOT_CERTIFIED_REANALYSIS_REQUIRED',
            calcio_decision_certification_reason: recoveryReason,
            calcio_analysis_stage_code: 'REANALYSIS_REQUIRED',
            calcio_analysis_stage_label: 'RIANALISI RICHIESTA',
            calcio_analysis_stage_reason: recoveryReason,
            calcio_quality_final_label: 'RIANALISI RICHIESTA',
            quality_final_label: 'RIANALISI RICHIESTA',
            quality_final_reason: recoveryReason,
            quality_stake_mode: 'UNIFIED_INDEX_NO_STAKE',
            quality_stake_amount: 0,
            calcio_analysis_only: 1,
            prediction_visibility: 'ANALYSIS_ONLY',
            exposure_role: 'ANALYSIS_ONLY',
            calcio_structural_certification_label: 'RIANALISI RICHIESTA · NESSUNA AUTORITÀ STAKE',
            calcio_portfolio_cap_post_finalization: 0,
            calcio_ai_finalization_status: 'PATCH26D_REANALYSIS_REQUIRED',
            calcio_output_coherence_status: 'OUTPUT_COHERENCE_NOT_CERTIFIED',
            calcio_finalization_transaction_status: 'INVALIDATED_PATCH26D',
            calcio_finalization_transaction_id: null,
            calcio_market_ranking_certified: 0,
            calcio_runtime_consistency_status: 'PATCH26D_REANALYSIS_REQUIRED',
            calcio_analysis_batch_id: null,
            calcio_event_finalization_id: null,
            calcio_portfolio_allocation_id: null,
            calcio_portfolio_batch_status: 'INVALIDATED_PATCH26D_REANALYZE',
            calcio_portfolio_batch_certified: 0,
            calcio_portfolio_pre_cap_eligible: 0,
            calcio_portfolio_pre_cap_stake: 0,
            calcio_portfolio_post_cap_stake: 0,
            calcio_portfolio_cap_reason: recoveryReason,
            calcio_batch_output_coherence_status: 'BATCH_OUTPUT_COHERENCE_NOT_CERTIFIED'
        };
        const activeResetFields = Object.entries(resetFields).filter(([name]) => aiColumns.has(name));
        let affectedPendingRows = 0;
        for (const betId of betIds) {
            const result = db.prepare(`
                UPDATE ai_forward_test
                SET ${activeResetFields.map(([name]) => `${name} = ?`).join(', ')}
                WHERE id = ?
                  AND UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                  AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
            `).run(...activeResetFields.map(([, value]) => value), betId);
            affectedPendingRows += Number(result.changes || 0);
        }

        db.prepare(`
            INSERT INTO calcio_patch26d_recovery_runs
            (recovery_id, patch_id, status, affected_finalizations, affected_batches,
             affected_pending_rows, tennis_digest_before, resolved_calcio_digest_before,
             created_at, details_json)
            VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
        `).run(
            recoveryId,
            PATCH_ID,
            affected.length,
            batchIds.length,
            affectedPendingRows,
            before.tennisDigest,
            before.resolvedCalcioDigest,
            nowIso(),
            json({ eventKeys, betIds, batchIds, recoveryReason, freshAnalysisRequired: affectedPendingRows > 0 })
        );
        return { affectedPendingRows };
    });

    const result = transactionResult;
    const after = {
        totalRows: count(db, 'SELECT COUNT(*) n FROM ai_forward_test'),
        tennisRows: count(db, "SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcioRows: count(db, "SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')"),
        tennisDigest: protectedDigest(db, "UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcioDigest: protectedDigest(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    if (before.totalRows !== after.totalRows) throw new Error('Numero righe ai_forward_test modificato.');
    if (before.tennisRows !== after.tennisRows || before.tennisDigest !== after.tennisDigest) throw new Error('Righe Tennis modificate.');
    if (before.resolvedCalcioRows !== after.resolvedCalcioRows || before.resolvedCalcioDigest !== after.resolvedCalcioDigest) throw new Error('Righe Calcio risolte modificate.');
    db.prepare(`
        UPDATE calcio_patch26d_recovery_runs
        SET tennis_digest_after = ?, resolved_calcio_digest_after = ?
        WHERE recovery_id = ?
    `).run(after.tennisDigest, after.resolvedCalcioDigest, recoveryId);

    const remainingBugFinalizations = count(db, `
        SELECT COUNT(*) n FROM calcio_ai_observation_finalizations
        WHERE status = 'FAILED' AND error_code = 'CALCIO_DEEPSCAN_ROUTE_ERROR' AND error_message = ?
    `, RECOVERY_ERROR);
    const invalidCommittedBatches = count(db, `
        SELECT COUNT(*) n FROM calcio_ai_portfolio_batch_allocations
        WHERE status = 'COMMITTED_BATCH' AND completed_event_count = 0
    `);
    const falseCertifiedFailedRows = count(db, `
        SELECT COUNT(*) n FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
          AND UPPER(COALESCE(status,'PENDING'))='PENDING'
          AND COALESCE(calcio_portfolio_batch_certified,0)=1
          AND UPPER(COALESCE(calcio_analysis_stage_code,''))='FAILED_FINALIZATION'
    `);
    if (remainingBugFinalizations || invalidCommittedBatches || falseCertifiedFailedRows) {
        throw new Error(`Recupero incompleto: finalizzazioni=${remainingBugFinalizations}, batch=${invalidCommittedBatches}, righe=${falseCertifiedFailedRows}`);
    }

    console.log(JSON.stringify({
        success: true,
        patch: PATCH_ID,
        dbPath,
        migration: 'TARGETED_ACTIVE_PENDING_RECOVERY_AND_DIAGNOSTIC_INVALIDATION',
        recoveryId,
        affectedFinalizations: affected.length,
        affectedBatches: batchIds.length,
        affectedPendingRows: result.affectedPendingRows,
        freshAnalysisRequired: result.affectedPendingRows > 0,
        invariants: {
            totalRowsUnchanged: before.totalRows === after.totalRows,
            tennisUnchanged: before.tennisDigest === after.tennisDigest,
            resolvedCalcioUnchanged: before.resolvedCalcioDigest === after.resolvedCalcioDigest,
            remainingScopeReferenceFailures: remainingBugFinalizations,
            invalidCommittedZeroCompletedBatches: invalidCommittedBatches,
            falseCertifiedFailedRows
        }
    }, null, 2));
} finally {
    db.close();
}
