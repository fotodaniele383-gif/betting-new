'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_26E_C_CALCIO_UNIFIED_STAKE_AUTHORITY_DATA_QUALITY_COHERENCE_RECOVERY';
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name); }
function tableExists(table) { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function count(where) { return db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${where}`).get().n; }
function digestRows(where, selectedColumns = null) {
    const select = Array.isArray(selectedColumns) && selectedColumns.length ? selectedColumns.map(name => `"${name}"`).join(',') : '*';
    const rows = db.prepare(`SELECT ${select} FROM ai_forward_test WHERE ${where} ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function safeJson(value, fallback = {}) { try { return JSON.parse(String(value || '')); } catch (_) { return fallback; } }
function json(value) { return JSON.stringify(value ?? null); }

const additions = {
    calcio_stake_authority_version: 'TEXT',
    calcio_stake_authority_status: 'TEXT',
    calcio_stake_authority_model_stake: 'REAL',
    calcio_stake_authority_reliability_stake: 'REAL',
    calcio_stake_authority_pre_cap_stake: 'REAL',
    calcio_stake_authority_final_stake: 'REAL',
    calcio_stake_probability_pct: 'REAL',
    calcio_stake_full_kelly_pct: 'REAL',
    calcio_stake_fractional_kelly: 'REAL',
    calcio_stake_event_cap_pct: 'REAL',
    calcio_stake_minimum_eur: 'REAL',
    calcio_stake_bankroll_snapshot: 'REAL',
    calcio_stake_bankroll_source: 'TEXT',
    calcio_stake_authority_reason: 'TEXT',
    calcio_stake_authority_audit: 'TEXT',
    calcio_data_quality_authority_version: 'TEXT',
    calcio_data_quality_score: 'REAL',
    calcio_data_quality_status: 'TEXT',
    calcio_data_quality_label: 'TEXT',
    calcio_data_quality_blocking: 'INTEGER',
    calcio_data_quality_reasons: 'TEXT',
    calcio_data_quality_audit: 'TEXT',
    calcio_bankroll_snapshot_consistent: 'INTEGER',
    calcio_final_narrative_version: 'TEXT',
    calcio_final_narrative: 'TEXT'
};

try {
    const beforeColumns = columns('ai_forward_test');
    const stableColumns = beforeColumns.filter(name => !Object.prototype.hasOwnProperty.call(additions, name));
    const before = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')"),
        activePendingCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING'")
    };
    const tennisDigestBefore = digestRows("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns);
    const resolvedDigestBefore = digestRows("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns);
    const added = [];
    let invalidatedRows = 0;
    let invalidatedBatches = 0;
    const affectedBatchIds = [];

    db.exec('BEGIN IMMEDIATE');
    try {
        const current = new Set(columns('ai_forward_test'));
        for (const [name, definition] of Object.entries(additions)) {
            if (!current.has(name)) {
                db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${definition}`);
                added.push(name);
            }
        }
        db.exec(`
            CREATE TABLE IF NOT EXISTS calcio_stake_authority_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                authority_version TEXT NOT NULL,
                batch_id TEXT,
                event_key TEXT,
                bet_id INTEGER,
                bankroll_snapshot REAL,
                model_stake REAL,
                reliability_stake REAL,
                final_stake REAL,
                robust_ev_pct REAL,
                data_quality_status TEXT,
                status TEXT NOT NULL,
                reason TEXT,
                audit_json TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_calcio_stake_authority_batch ON calcio_stake_authority_audit_log(batch_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_calcio_stake_authority_event ON calcio_stake_authority_audit_log(event_key, created_at);
        `);

        const candidates = db.prepare(`
            SELECT DISTINCT calcio_analysis_batch_id AS batch_id
            FROM ai_forward_test
            WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
              AND UPPER(COALESCE(status,''))='PENDING'
              AND calcio_analysis_batch_id IS NOT NULL
              AND COALESCE(calcio_portfolio_batch_certified,0)=1
              AND (
                    COALESCE(calcio_cross_market_reliability_version,'') LIKE 'BETTING_PATCH_26E_B%'
                 OR COALESCE(calcio_cross_market_reliability_version,'') LIKE 'BETTING_PATCH_26E_C%'
              )
        `).all().map(row => row.batch_id).filter(Boolean);
        for (const batchId of candidates) affectedBatchIds.push(batchId);

        if (affectedBatchIds.length) {
            const placeholders = affectedBatchIds.map(() => '?').join(',');
            const reason = 'Patch 26E-C: batch invalidato per riallineamento bankroll, autorità stake unica, qualità dati e narrativa finale. Eseguire una nuova Analisi Calcio.';
            const result = db.prepare(`
                UPDATE ai_forward_test
                SET stake=0,
                    calcio_operational_stake=0,
                    calcio_portfolio_post_cap_stake=0,
                    calcio_stake_authority_final_stake=0,
                    calcio_gate_allow_bet=0,
                    calcio_prediction_index_eligible=0,
                    calcio_portfolio_batch_certified=0,
                    calcio_portfolio_batch_status='REANALYSIS_REQUIRED_PATCH26EC',
                    calcio_stake_lifecycle_status='REANALYSIS_REQUIRED_PATCH26EC',
                    calcio_stake_lifecycle_reason=?,
                    calcio_operational_status='CALCIO_WATCHLIST_MICRO',
                    calcio_operational_action='ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY',
                    calcio_operational_summary=?,
                    calcio_gate_status='CALCIO_WATCHLIST_MICRO',
                    calcio_gate_reasons=?,
                    calcio_prediction_index_reason=?,
                    calcio_analysis_stage_code='REANALYSIS_REQUIRED',
                    calcio_analysis_stage_label='RIANALISI RICHIESTA',
                    calcio_analysis_stage_reason=?,
                    calcio_quality_final_label='WATCHLIST MICRO',
                    quality_final_label='WATCHLIST MICRO',
                    quality_final_reason=?,
                    quality_stake_mode='UNIFIED_STAKE_AUTHORITY_REANALYSIS_REQUIRED',
                    quality_stake_amount=0,
                    calcio_analysis_only=1,
                    prediction_visibility='ANALYSIS_ONLY',
                    exposure_role='ANALYSIS_ONLY',
                    calcio_output_coherence_status='OUTPUT_COHERENCE_REANALYSIS_REQUIRED',
                    calcio_batch_output_coherence_status='BATCH_OUTPUT_COHERENCE_REANALYSIS_REQUIRED',
                    calcio_runtime_consistency_status='PATCH26EC_REANALYSIS_REQUIRED',
                    calcio_final_narrative_version='BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1',
                    calcio_final_narrative=?
                WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
                  AND UPPER(COALESCE(status,''))='PENDING'
                  AND calcio_analysis_batch_id IN (${placeholders})
            `).run(reason, reason, reason, reason, reason, reason, reason, ...affectedBatchIds);
            invalidatedRows = result.changes || 0;

            if (tableExists('calcio_ai_portfolio_batch_allocations')) {
                const allocations = db.prepare(`
                    UPDATE calcio_ai_portfolio_batch_allocations
                    SET status='INVALIDATED_PATCH26EC_REANALYSIS_REQUIRED',
                        total_post_cap_stake=0,
                        diagnostics_json=?
                    WHERE batch_id IN (${placeholders})
                `).run(json({ patch: PATCH, reanalysisRequired: true, reason }), ...affectedBatchIds);
                invalidatedBatches = allocations.changes || 0;
            }
            if (tableExists('calcio_ai_observation_batches')) {
                for (const batchId of affectedBatchIds) {
                    const row = db.prepare('SELECT diagnostics_json FROM calcio_ai_observation_batches WHERE batch_id=?').get(batchId);
                    db.prepare(`UPDATE calcio_ai_observation_batches SET status='REANALYSIS_REQUIRED_PATCH26EC', diagnostics_json=? WHERE batch_id=?`)
                        .run(json({ ...safeJson(row?.diagnostics_json, {}), patch26ecRecovery: true, reason }), batchId);
                }
            }
        }
        db.exec('COMMIT');
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }

    const after = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')"),
        activePendingCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING'")
    };
    const tennisDigestAfter = digestRows("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns);
    const resolvedDigestAfter = digestRows("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns);
    if (tennisDigestBefore !== tennisDigestAfter) throw new Error('PATCH26EC_TENNIS_MUTATED');
    if (resolvedDigestBefore !== resolvedDigestAfter) throw new Error('PATCH26EC_RESOLVED_CALCIO_MUTATED');
    if (before.total !== after.total || before.tennis !== after.tennis || before.resolvedCalcio !== after.resolvedCalcio) throw new Error('PATCH26EC_SCOPE_COUNTS_CHANGED');

    console.log(JSON.stringify({
        success: true,
        patch: PATCH,
        migration: 'ADDITIVE_STAKE_DATA_QUALITY_SCHEMA_AND_TARGETED_PENDING_REANALYSIS_RECOVERY',
        addedColumns: added,
        invalidatedRows,
        invalidatedBatches,
        affectedBatchIds,
        tennisUnchanged: true,
        resolvedCalcioUnchanged: true,
        before,
        after
    }, null, 2));
} finally {
    db.close();
}
