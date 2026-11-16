'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW';
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

const additions = {
    calcio_dual_score_version: 'TEXT',
    calcio_dual_score_mode: 'TEXT',
    calcio_forecast_confidence_shadow: 'REAL',
    calcio_value_score_shadow: 'REAL',
    calcio_context_risk_penalty: 'REAL',
    calcio_decision_readiness_shadow: 'REAL',
    calcio_decision_readiness_label: 'TEXT',
    calcio_dual_score_old_ipm: 'REAL',
    calcio_dual_score_delta_vs_ipm: 'REAL',
    calcio_dual_score_pt_sample: 'INTEGER',
    calcio_dual_score_pt_weight: 'REAL',
    calcio_dual_score_authority: 'INTEGER DEFAULT 0',
    calcio_dual_score_audit: 'TEXT'
};

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name); }
function count(where) { return db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${where}`).get().n; }
function digest(where, selected) {
    const rows = db.prepare(`SELECT ${selected.map(name => `"${name}"`).join(',')} FROM ai_forward_test WHERE ${where} ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

try {
    const beforeColumns = columns('ai_forward_test');
    const stableColumns = beforeColumns.filter(name => !Object.prototype.hasOwnProperty.call(additions, name));
    const before = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    const allDigestBefore = digest('1=1', stableColumns);
    const tennisDigestBefore = digest("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns);
    const resolvedDigestBefore = digest("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns);
    const addedColumns = [];

    db.exec('BEGIN IMMEDIATE');
    try {
        const current = new Set(columns('ai_forward_test'));
        for (const [name, definition] of Object.entries(additions)) {
            if (!current.has(name)) {
                db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${definition}`);
                addedColumns.push(name);
            }
        }
        db.exec(`
            CREATE TABLE IF NOT EXISTS calcio_dual_score_shadow_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bet_id INTEGER NOT NULL,
                event_key TEXT,
                market_id TEXT,
                old_ipm_score REAL,
                forecast_confidence_score REAL,
                value_score REAL,
                context_risk_penalty REAL,
                decision_readiness_score REAL,
                decision_readiness_label TEXT,
                pt_sample INTEGER,
                pt_weight REAL,
                authority INTEGER NOT NULL DEFAULT 0,
                snapshot TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_calcio_dual_score_shadow_bet
                ON calcio_dual_score_shadow_audit_log(bet_id, id);
            CREATE TRIGGER IF NOT EXISTS trg_calcio_dual_score_shadow_update
            AFTER UPDATE OF calcio_dual_score_audit ON ai_forward_test
            WHEN NEW.calcio_dual_score_audit IS NOT NULL
             AND COALESCE(OLD.calcio_dual_score_audit,'') <> COALESCE(NEW.calcio_dual_score_audit,'')
            BEGIN
                INSERT INTO calcio_dual_score_shadow_audit_log (
                    bet_id, event_key, market_id, old_ipm_score,
                    forecast_confidence_score, value_score, context_risk_penalty,
                    decision_readiness_score, decision_readiness_label,
                    pt_sample, pt_weight, authority, snapshot
                ) VALUES (
                    NEW.id, NEW.calcio_event_key, NEW.calcio_final_market_id,
                    NEW.calcio_dual_score_old_ipm,
                    NEW.calcio_forecast_confidence_shadow,
                    NEW.calcio_value_score_shadow,
                    NEW.calcio_context_risk_penalty,
                    NEW.calcio_decision_readiness_shadow,
                    NEW.calcio_decision_readiness_label,
                    NEW.calcio_dual_score_pt_sample,
                    NEW.calcio_dual_score_pt_weight,
                    COALESCE(NEW.calcio_dual_score_authority,0),
                    NEW.calcio_dual_score_audit
                );
            END;
        `);
        db.exec('COMMIT');
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }

    const after = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PATCH26FC_ROW_COUNTS_CHANGED');
    if (allDigestBefore !== digest('1=1', stableColumns)) throw new Error('PATCH26FC_EXISTING_ROWS_MUTATED');
    if (tennisDigestBefore !== digest("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns)) throw new Error('PATCH26FC_TENNIS_MUTATED');
    if (resolvedDigestBefore !== digest("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns)) throw new Error('PATCH26FC_RESOLVED_CALCIO_MUTATED');

    const auditTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_dual_score_shadow_audit_log'").get();
    const auditTrigger = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_calcio_dual_score_shadow_update'").get();
    console.log(JSON.stringify({
        success: true,
        patch: PATCH,
        migration: 'ADDITIVE_DUAL_SCORE_SHADOW_AUDIT_SCHEMA_ONLY',
        addedColumns,
        auditTable: Boolean(auditTable),
        auditTrigger: Boolean(auditTrigger),
        existingRowsUpdated: 0,
        rowsDeleted: 0,
        before,
        after,
        safeguards: {
            tennisUnchanged: true,
            resolvedCalcioUnchanged: true,
            historicalRowsUnchanged: true,
            productionProbabilityUnchanged: true,
            stakeAuthorityUnchanged: true,
            portfolioCapsUnchanged: true
        }
    }, null, 2));
} finally {
    db.close();
}
