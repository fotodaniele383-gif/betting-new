'use strict';
// ============================================================================
// AI BETTING QUANT PRO - IMMUTABLE AUDIT TRAIL
// Step 67D: storico pronostici/esiti/decisioni append-only con hash chain.
// ============================================================================

const crypto = require('crypto');

const AUDIT_TRAIL_VERSION = 'STEP67D_IMMUTABLE_AUDIT_TRAIL_V1';

function safeJson(value) {
    try {
        return JSON.stringify(value ?? null, Object.keys(value || {}).sort());
    } catch (error) {
        return JSON.stringify({ serialization_error: String(error.message || error) });
    }
}

function stableSnapshot(value) {
    if (Array.isArray(value)) return value.map(stableSnapshot);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            const val = value[key];
            if (typeof val !== 'function' && val !== undefined) acc[key] = stableSnapshot(val);
            return acc;
        }, {});
    }
    return value;
}

function hashPayload(payload) {
    return crypto.createHash('sha256').update(safeJson(stableSnapshot(payload))).digest('hex');
}

function ensureAuditTrailTable(db) {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS prediction_audit_trail (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sport_type TEXT NOT NULL,
            bet_id INTEGER,
            event_type TEXT NOT NULL,
            event_ts TEXT NOT NULL,
            event_hash TEXT NOT NULL UNIQUE,
            previous_hash TEXT,
            snapshot_json TEXT NOT NULL,
            immutable_version TEXT NOT NULL
        )
    `).run();

    db.prepare(`
        CREATE TRIGGER IF NOT EXISTS prediction_audit_trail_no_update
        BEFORE UPDATE ON prediction_audit_trail
        BEGIN
            SELECT RAISE(ABORT, 'prediction_audit_trail is immutable');
        END;
    `).run();

    db.prepare(`
        CREATE TRIGGER IF NOT EXISTS prediction_audit_trail_no_delete
        BEFORE DELETE ON prediction_audit_trail
        BEGIN
            SELECT RAISE(ABORT, 'prediction_audit_trail is immutable');
        END;
    `).run();
}

function getPreviousHash(db, sportType, betId = null) {
    try {
        const row = db.prepare(`
            SELECT event_hash
            FROM prediction_audit_trail
            WHERE sport_type = ?
              AND COALESCE(bet_id, -1) = COALESCE(?, -1)
            ORDER BY id DESC
            LIMIT 1
        `).get(sportType, betId);
        return row ? row.event_hash : null;
    } catch (error) {
        return null;
    }
}

function inferSportType(snapshot = {}, fallback = 'UNKNOWN') {
    const text = [snapshot.sport_type, snapshot.sport, snapshot.bet_type, snapshot.strategy_tag, snapshot.league]
        .map(v => String(v || '').toUpperCase())
        .join(' ');
    if (text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA')) return 'TENNIS';
    if (text.includes('CALCIO') || text.includes('FOOTBALL') || text.includes('SOCCER') || text.includes('SERIE') || text.includes('PREMIER')) return 'CALCIO';
    return String(fallback || 'UNKNOWN').toUpperCase();
}

function writeAuditEvent(db, { sportType = null, betId = null, eventType = 'SNAPSHOT', snapshot = {}, eventTs = null } = {}) {
    ensureAuditTrailTable(db);

    const effectiveSport = String(sportType || inferSportType(snapshot)).toUpperCase();
    const effectiveTs = eventTs || new Date().toISOString();
    const previousHash = getPreviousHash(db, effectiveSport, betId);
    const immutableSnapshot = stableSnapshot({
        ...snapshot,
        auditMeta: {
            sportType: effectiveSport,
            betId,
            eventType,
            eventTs: effectiveTs,
            previousHash,
            version: AUDIT_TRAIL_VERSION
        }
    });
    const eventHash = hashPayload(immutableSnapshot);
    const snapshotJson = JSON.stringify(immutableSnapshot);

    try {
        db.prepare(`
            INSERT INTO prediction_audit_trail (
                sport_type,
                bet_id,
                event_type,
                event_ts,
                event_hash,
                previous_hash,
                snapshot_json,
                immutable_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(effectiveSport, betId, eventType, effectiveTs, eventHash, previousHash, snapshotJson, AUDIT_TRAIL_VERSION);
    } catch (error) {
        if (!String(error.message || '').includes('UNIQUE')) throw error;
    }

    return {
        sportType: effectiveSport,
        betId,
        eventType,
        eventTs: effectiveTs,
        eventHash,
        previousHash,
        version: AUDIT_TRAIL_VERSION
    };
}

function buildBetSnapshot(row = {}, extra = {}) {
    return stableSnapshot({
        id: row.id ?? null,
        sport_type: row.sport_type ?? null,
        status: row.status ?? null,
        match_date: row.match_date ?? null,
        league: row.league ?? null,
        home_team: row.home_team ?? null,
        away_team: row.away_team ?? null,
        prediction: row.prediction ?? null,
        odd: row.odd ?? null,
        stake: row.stake ?? null,
        profit: row.profit ?? null,
        probability: row.probability ?? row.estimated_prob ?? row.estimatedProb ?? null,
        edge_pp: row.edge_pp ?? row.edge ?? null,
        ev_pct: row.ev_pct ?? null,
        clv: row.clv ?? null,
        clv_edge: row.clv_edge ?? null,
        clv_source: row.clv_source ?? null,
        clv_verified: row.clv_verified ?? null,
        data_quality: row.data_quality ?? null,
        model_version: row.model_version ?? null,
        metric_version: row.metric_version ?? null,
        engine_version: row.engine_version ?? null,
        settlement_source: row.settlement_source ?? null,
        settled_at: row.settled_at ?? null,
        trading_scope: row.trading_scope ?? null,
        paper_trading_scope: row.paper_trading_scope ?? null,
        portfolio_scope: row.portfolio_scope ?? null,
        deepscan_gate_status: row.deepscan_gate_status ?? null,
        deepscan_gate_reason: row.deepscan_gate_reason ?? null,
        ...extra
    });
}

function writeBetAuditEvent(db, row = {}, eventType = 'BET_SNAPSHOT', extra = {}) {
    return writeAuditEvent(db, {
        sportType: inferSportType(row),
        betId: row.id ?? null,
        eventType,
        snapshot: buildBetSnapshot(row, extra)
    });
}

function getAuditTrailSummary(db, { sport = 'ALL', limit = 50 } = {}) {
    ensureAuditTrailTable(db);
    const s = String(sport || 'ALL').toUpperCase();
    const params = [];
    let where = '';
    if (s !== 'ALL') {
        where = 'WHERE sport_type = ?';
        params.push(s);
    }
    const rows = db.prepare(`
        SELECT id, sport_type, bet_id, event_type, event_ts, event_hash, previous_hash, immutable_version
        FROM prediction_audit_trail
        ${where}
        ORDER BY id DESC
        LIMIT ?
    `).all(...params, Math.max(1, Number(limit || 50)));

    const counts = db.prepare(`
        SELECT sport_type, event_type, COUNT(*) AS count
        FROM prediction_audit_trail
        ${where}
        GROUP BY sport_type, event_type
        ORDER BY sport_type, event_type
    `).all(...params);

    return {
        success: true,
        version: AUDIT_TRAIL_VERSION,
        sport: s,
        immutable: true,
        rows,
        counts
    };
}

module.exports = {
    AUDIT_TRAIL_VERSION,
    ensureAuditTrailTable,
    writeAuditEvent,
    writeBetAuditEvent,
    buildBetSnapshot,
    getAuditTrailSummary,
    hashPayload,
    inferSportType
};
