// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
// Repository Telegram: sola lettura dal DB del programma. Nessuna modifica a settlement/CLV/API.
const path = require('path');

const STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER = 'STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER';
const DB_PATH = path.join(__dirname, 'database_betting.db');
const SETTLED_STATUSES = ['WON', 'LOST', 'PUSH', 'VOID'];

function safeUpper(value) { return String(value || '').toUpperCase(); }
function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function loadBetterSqlite3() {
    // Lazy require: i test statici non devono aprire il DB.
    // Nel progetto Windows è già usato da server.js/paperTrading.
    return require('better-sqlite3');
}

function openDbReadonly(dbPath = DB_PATH) {
    const Database = loadBetterSqlite3();
    return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function getColumns(db, table = 'ai_forward_test') {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
    } catch (error) {
        return new Set();
    }
}

function selectColumn(columns, name, fallbackSql = 'NULL') {
    return columns.has(name) ? name : `${fallbackSql} AS ${name}`;
}

function parseItalianDateTime(value) {
    if (!value) return null;
    const raw = String(value).trim();
    try {
        if (raw.includes(',')) {
            const [datePart, timePart = '00:00:00'] = raw.split(',').map(s => s.trim());
            const [d, m, y] = datePart.split('/').map(Number);
            const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
            if (d && m && y) return new Date(y, m - 1, d, hh, mm, ss);
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
        return null;
    }
}

function dateKey(value) {
    const d = parseItalianDateTime(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function todayKey() { return dateKey(new Date().toISOString()); }

function isCurrentRow(row = {}) {
    const q = safeUpper(row.data_quality);
    return q === 'CURRENT_BOOTSTRAP' || q === 'CURRENT';
}

function isTennisRow(row = {}) {
    return safeUpper(row.sport_type) === 'TENNIS' || safeUpper(row.bet_type).includes('TENNIS') || safeUpper(row.strategy_tag).includes('TENNIS');
}

function isCalcioRow(row = {}) {
    const s = safeUpper(row.sport_type);
    const b = safeUpper(row.bet_type);
    const l = safeUpper(row.league);
    if (isTennisRow(row)) return false;
    return s === 'CALCIO' || s === 'FOOTBALL' || s === 'SOCCER' || b.includes('CALCIO') || b.includes('FOOTBALL') || l.includes('SERIE') || l.includes('PREMIER') || l.includes('LIGA');
}

function rowArea(row = {}) {
    const deep = [row.deep_scan_risk_level, row.ds_action, row.deepscan_gate_status, row.deep_scan_risk_score]
        .some(v => String(v || '').trim());
    const gate = [row.gate_status_code, row.gate_status_label, row.pre_match_gate_label, row.tennis_operational_status, row.calcio_operational_status, row.professional_gate_status, row.calcio_gate_status]
        .some(v => String(v || '').trim());
    if (deep && gate) return 'both';
    if (deep) return 'deep_scan';
    if (gate) return 'gate';
    return 'none';
}

function matchesArea(row, area = 'both') {
    const a = rowArea(row);
    if (area === 'both' || area === 'all') return a === 'both' || a === 'deep_scan' || a === 'gate';
    if (area === 'deep_scan') return a === 'deep_scan' || a === 'both';
    if (area === 'gate') return a === 'gate' || a === 'both';
    return true;
}

function applyRuntimeFilters(rows = [], options = {}, state = {}) {
    const mode = options.mode || 'results_since_last';
    const area = options.area || 'both';
    const sport = options.sport || 'tennis';
    const stakeScope = options.stakeScope || 'operational';
    const onlyCurrentDataQuality = options.onlyCurrentDataQuality !== false;
    const dedupe = options.dedupe !== false;
    const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
    const tKey = options.dateKey || todayKey();
    const resultSent = new Set((state.sentResultIds || []).map(Number));
    const predSent = new Set((state.sentPredictionIds || []).map(Number));

    let filtered = rows.filter(row => {
        if (onlyCurrentDataQuality && !isCurrentRow(row)) return false;
        if (sport === 'tennis' && !isTennisRow(row)) return false;
        if (sport === 'calcio' && !isCalcioRow(row)) return false;
        if (stakeScope === 'operational' && toNumber(row.stake, 0) <= 0) return false;
        if (stakeScope === 'audit_only' && toNumber(row.stake, 0) > 0) return false;
        if (!matchesArea(row, area)) return false;

        const status = safeUpper(row.status);
        const isSettled = SETTLED_STATUSES.includes(status);
        const isPending = status === 'PENDING';
        const rowDateKey = dateKey(row.match_date || row.date);
        const settledKey = dateKey(row.settled_at) || rowDateKey;

        if (mode === 'results_today') return isSettled && (settledKey === tKey || rowDateKey === tKey);
        if (mode === 'results_since_last') return isSettled && (!dedupe || !resultSent.has(Number(row.id)));
        if (mode === 'deep_scan_results') return isSettled && matchesArea(row, 'deep_scan') && (!dedupe || !resultSent.has(Number(row.id)));
        if (mode === 'gate_results') return isSettled && matchesArea(row, 'gate') && (!dedupe || !resultSent.has(Number(row.id)));
        if (mode === 'predictions_today') return isPending && rowDateKey === tKey && (!dedupe || !predSent.has(Number(row.id)));
        if (mode === 'predictions_tomorrow') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            const tomorrow = dateKey(d.toISOString());
            return isPending && rowDateKey === tomorrow && (!dedupe || !predSent.has(Number(row.id)));
        }
        if (mode === 'summary_real') return isSettled;
        return false;
    });

    filtered.sort((a, b) => {
        const ad = parseItalianDateTime(a.settled_at || a.match_date) || new Date(0);
        const bd = parseItalianDateTime(b.settled_at || b.match_date) || new Date(0);
        return bd - ad;
    });

    return filtered.slice(0, limit);
}

function fetchCandidateRows(dbPath = DB_PATH) {
    const db = openDbReadonly(dbPath);
    try {
        const columns = getColumns(db);
        const wanted = [
            'id', 'bet_type', 'match_date', 'home_team', 'away_team', 'prediction', 'odd', 'stake', 'status', 'profit',
            'league', 'sport_type', 'data_quality', 'ds_action', 'deep_scan_risk_level', 'deep_scan_risk_score',
            'deepscan_gate_status', 'tennis_operational_status', 'tennis_operational_action', 'calcio_operational_status',
            'gate_status_code', 'gate_status_label', 'pre_match_gate_label', 'professional_gate_status', 'calcio_gate_status',
            'settlement_source', 'settlement_note', 'settled_at', 'winner_player_name', 'predicted_player_name',
            'side_mapping_verified', 'portfolio_scope', 'paper_trading_scope', 'ev_pct', 'edge_pp', 'estimated_prob'
        ];
        const select = wanted.map(name => selectColumn(columns, name)).join(', ');
        return db.prepare(`
            SELECT ${select}
            FROM ai_forward_test
            WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID','PENDING')
              AND (
                    UPPER(COALESCE(sport_type,'')) IN ('TENNIS','CALCIO','FOOTBALL','SOCCER')
                    OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(bet_type,'')) LIKE '%CALCIO%'
                  )
            ORDER BY id DESC
            LIMIT 1000
        `).all();
    } finally {
        db.close();
    }
}

function getTelegramRows(options = {}, state = {}, dbPath = DB_PATH) {
    const rows = fetchCandidateRows(dbPath);
    return applyRuntimeFilters(rows, options, state);
}

function summarizeRows(rows = []) {
    const settled = rows.filter(r => SETTLED_STATUSES.includes(safeUpper(r.status)));
    const stake = settled.reduce((s, r) => s + toNumber(r.stake, 0), 0);
    const profit = settled.reduce((s, r) => s + toNumber(r.profit, 0), 0);
    const won = settled.filter(r => safeUpper(r.status) === 'WON').length;
    const lost = settled.filter(r => safeUpper(r.status) === 'LOST').length;
    const push = settled.filter(r => safeUpper(r.status) === 'PUSH').length;
    const voidCount = settled.filter(r => safeUpper(r.status) === 'VOID').length;
    return {
        total: rows.length,
        settled: settled.length,
        won,
        lost,
        push,
        void: voidCount,
        stake: Number(stake.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        roiPct: stake > 0 ? Number(((profit / stake) * 100).toFixed(2)) : 0
    };
}

module.exports = {
    STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
    DB_PATH,
    SETTLED_STATUSES,
    parseItalianDateTime,
    dateKey,
    todayKey,
    isTennisRow,
    isCalcioRow,
    rowArea,
    matchesArea,
    applyRuntimeFilters,
    fetchCandidateRows,
    getTelegramRows,
    summarizeRows
};
