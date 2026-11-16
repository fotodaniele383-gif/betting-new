'use strict';

const crypto = require('crypto');

const VERSION = 'TENNIS_CLV_SNAPSHOT_COVERAGE_V1_PATCH39';
const CHECKPOINTS = Object.freeze({
  FIRST_SEEN: 'FIRST_SEEN_OPENING',
  T24H: 'T24H_OPENING',
  T2H: 'T2H_MARKET',
  T20M: 'T20M_CLOSING'
});
const MAX_AUDIT_CALLS_PER_RUN = 1;

function number(value, fallback = null) { if (value === null || value === undefined || value === '') return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, decimals = 4) { const n = number(value, 0); return Number(n.toFixed(decimals)); }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function isTennis(row = {}) { return upper(row.sport_type) === 'TENNIS' || upper(row.bet_type).includes('TENNIS') || upper(row.strategy_tag).includes('TENNIS'); }
function parseMatchEpoch(row = {}, parseFn = null) {
  const candidates = [row.canonical_event_time_safety_utc, row.canonical_event_time_canonical_utc, row.canonical_match_datetime, row.match_date];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof parseFn === 'function') {
      try { const parsed = parseFn(value); const epoch = parsed instanceof Date ? parsed.getTime() : Number(parsed); if (Number.isFinite(epoch)) return epoch; } catch (_) {}
    }
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.getTime();
    const m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}+02:00`;
      const epoch = new Date(iso).getTime();
      if (Number.isFinite(epoch)) return epoch;
    }
  }
  return null;
}
function leadHours(row = {}, now = new Date(), parseFn = null) {
  const epoch = parseMatchEpoch(row, parseFn);
  const nowEpoch = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return epoch === null || !Number.isFinite(nowEpoch) ? null : (epoch - nowEpoch) / 3600000;
}
function checkpointFor(row = {}, now = new Date(), parseFn = null) {
  const lead = leadHours(row, now, parseFn);
  if (lead === null) return { checkpoint: null, leadHours: null, status: 'MATCH_TIME_UNRESOLVED' };
  if (lead >= 18 && lead <= 30) return { checkpoint: CHECKPOINTS.T24H, leadHours: round(lead, 3), status: 'DUE' };
  if (lead > 0.5 && lead <= 3) return { checkpoint: CHECKPOINTS.T2H, leadHours: round(lead, 3), status: 'DUE' };
  if (lead >= -0.1 && lead <= 0.5) return { checkpoint: CHECKPOINTS.T20M, leadHours: round(lead, 3), status: 'DUE' };
  return { checkpoint: null, leadHours: round(lead, 3), status: 'NOT_DUE' };
}
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_clv_snapshot_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id TEXT NOT NULL UNIQUE,
      bet_id INTEGER NOT NULL,
      checkpoint TEXT NOT NULL,
      target_match_at TEXT,
      captured_at TEXT NOT NULL,
      lead_hours REAL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_odd REAL,
      sport_key TEXT,
      source_event_id TEXT,
      event_fingerprint TEXT,
      market_fingerprint TEXT,
      bookmaker_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      previous_hash TEXT,
      snapshot_hash TEXT NOT NULL UNIQUE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_clv_checkpoint_unique ON tennis_clv_snapshot_checkpoints(bet_id, checkpoint);
    CREATE INDEX IF NOT EXISTS idx_tennis_clv_checkpoint_bet ON tennis_clv_snapshot_checkpoints(bet_id, captured_at);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_clv_checkpoints_no_update BEFORE UPDATE ON tennis_clv_snapshot_checkpoints BEGIN SELECT RAISE(ABORT,'TENNIS_CLV_CHECKPOINT_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_clv_checkpoints_no_delete BEFORE DELETE ON tennis_clv_snapshot_checkpoints BEGIN SELECT RAISE(ABORT,'TENNIS_CLV_CHECKPOINT_APPEND_ONLY'); END;
  `);
}
function hasCheckpoint(db, betId, checkpoint) {
  createSchema(db);
  return Boolean(db.prepare('SELECT 1 ok FROM tennis_clv_snapshot_checkpoints WHERE bet_id=? AND checkpoint=?').get(Number(betId), checkpoint));
}
function latestHash(db, betId) {
  const row = db.prepare('SELECT snapshot_hash FROM tennis_clv_snapshot_checkpoints WHERE bet_id=? ORDER BY id DESC LIMIT 1').get(Number(betId));
  return row?.snapshot_hash || null;
}
function recordSnapshot(db, row = {}, input = {}) {
  if (!db || !row?.id || !input.checkpoint) return null;
  createSchema(db);
  const existing = db.prepare('SELECT * FROM tennis_clv_snapshot_checkpoints WHERE bet_id=? AND checkpoint=?').get(Number(row.id), input.checkpoint);
  if (existing) return existing;
  const capturedAt = input.capturedAt || new Date().toISOString();
  const previousHash = latestHash(db, row.id);
  const payload = {
    version: VERSION,
    betId: Number(row.id),
    checkpoint: input.checkpoint,
    targetMatchAt: row.canonical_event_time_safety_utc || row.canonical_match_datetime || row.match_date || null,
    capturedAt,
    leadHours: number(input.leadHours),
    source: input.source || 'UNKNOWN',
    status: input.status || 'CAPTURED',
    selectedOdd: number(input.selectedOdd),
    sportKey: input.sportKey || null,
    sourceEventId: input.sourceEventId || row.provider_event_id || null,
    eventFingerprint: row.tennis_event_fingerprint || row.clv_event_fingerprint || null,
    marketFingerprint: row.tennis_market_fingerprint || row.clv_market_fingerprint || null,
    bookmakerCount: Array.isArray(input.bookmakers) ? input.bookmakers.length : number(input.bookmakerCount, 0),
    previousHash
  };
  const snapshotHash = sha(payload);
  const snapshotId = `TCLV39_${Number(row.id)}_${input.checkpoint}_${snapshotHash.slice(0, 12)}`;
  db.prepare(`INSERT INTO tennis_clv_snapshot_checkpoints(
    snapshot_id,bet_id,checkpoint,target_match_at,captured_at,lead_hours,source,status,selected_odd,
    sport_key,source_event_id,event_fingerprint,market_fingerprint,bookmaker_count,payload_json,previous_hash,snapshot_hash
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    snapshotId, Number(row.id), input.checkpoint, payload.targetMatchAt, capturedAt, payload.leadHours,
    payload.source, payload.status, payload.selectedOdd, payload.sportKey, payload.sourceEventId,
    payload.eventFingerprint, payload.marketFingerprint, payload.bookmakerCount, JSON.stringify(payload), previousHash, snapshotHash
  );
  return db.prepare('SELECT * FROM tennis_clv_snapshot_checkpoints WHERE snapshot_id=?').get(snapshotId);
}
function ensureFirstSeenSnapshots(db, rows = [], options = {}) {
  createSchema(db);
  const now = options.now || new Date();
  const parseFn = options.parseFn || null;
  let inserted = 0;
  for (const row of rows) {
    if (!isTennis(row) || !row.id) continue;
    const odd = number(row.opening_odd, number(row.odd));
    if (!(odd > 1)) continue;
    const lead = leadHours(row, now, parseFn);
    if (lead === null || lead <= 0) continue;
    const checkpoint = lead >= 18 && lead <= 30 ? CHECKPOINTS.T24H : CHECKPOINTS.FIRST_SEEN;
    if (hasCheckpoint(db, row.id, checkpoint)) continue;
    const receipt = recordSnapshot(db, row, {
      checkpoint,
      capturedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      leadHours: lead,
      source: row.opening_odd > 1 ? 'ROW_OPENING_ODD' : 'ROW_PLAYED_ODD',
      status: 'LOCAL_OPENING_CAPTURED',
      selectedOdd: odd,
      sourceEventId: row.provider_event_id || null
    });
    if (receipt) inserted += 1;
  }
  return inserted;
}
function dueCandidates(db, rows = [], options = {}) {
  createSchema(db);
  const now = options.now || new Date();
  const parseFn = options.parseFn || null;
  return rows.map(row => ({ row, due: checkpointFor(row, now, parseFn) }))
    .filter(item => item.row?.id && isTennis(item.row) && item.due.checkpoint && !hasCheckpoint(db, item.row.id, item.due.checkpoint));
}
function selectAuditCandidates(db, rows = [], options = {}) {
  const due = dueCandidates(db, rows, options);
  const positive = due.filter(item => number(item.row.stake, 0) > 0);
  const paperClosing = due.filter(item => item.due.checkpoint === CHECKPOINTS.T20M && number(item.row.stake, 0) <= 0);
  return {
    due,
    positive,
    paperClosing,
    execution: [...positive, ...paperClosing],
    maxAuditCallsPerRun: MAX_AUDIT_CALLS_PER_RUN
  };
}
function augmentPlanWithCalibrationAudit(plan = {}, context = {}) {
  const db = context.db;
  const catalog = context.catalog || {};
  const rows = context.rows || [];
  const discovery = context.discovery;
  const inferKey = context.inferKey;
  const getMarkets = context.getMarkets;
  const now = context.now || new Date();
  const parseFn = context.parseFn || null;
  if (!db || !discovery || typeof discovery.resolveBetSportKeys !== 'function') return { plan, auditCandidates: [], addedCalls: [] };
  const selection = selectAuditCandidates(db, rows, { now, parseFn });
  const existingIds = new Set((plan.calls || []).flatMap(call => call.betIds || []).map(Number));
  const candidates = selection.execution.filter(item => !existingIds.has(Number(item.row.id)));
  const groups = new Map();
  const decisions = [];
  for (const item of candidates) {
    const row = item.row;
    const requested = typeof inferKey === 'function' ? inferKey(row) : '';
    const resolution = discovery.resolveBetSportKeys(row, catalog.sports || [], requested);
    decisions.push({ betId: Number(row.id), checkpoint: item.due.checkpoint, leadHours: item.due.leadHours, ...resolution });
    const key = resolution.resolvedKeys?.[0];
    if (!key) continue;
    const markets = typeof getMarkets === 'function' ? getMarkets(row) : 'h2h';
    const groupKey = `${key}|${markets}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { sportKey: key, markets, betIds: [], candidateCount: 0, highestPriority: 15, source: 'PATCH39_CALIBRATION_AUDIT_CHECKPOINT' });
    const group = groups.get(groupKey);
    group.betIds.push(Number(row.id));
    group.candidateCount = group.betIds.length;
  }
  const maxCalls = Math.max(0, number(plan.maxApiCallsPerRun, 0));
  const residual = Math.max(0, maxCalls - (plan.calls || []).length);
  const auditLimit = Math.min(residual, MAX_AUDIT_CALLS_PER_RUN);
  const addedCalls = [...groups.values()].sort((a, b) => b.candidateCount - a.candidateCount).slice(0, auditLimit);
  return {
    plan: {
      ...plan,
      calls: [...(plan.calls || []), ...addedCalls],
      plannedApiCalls: (plan.calls || []).length + addedCalls.length,
      patch39SnapshotCoverage: {
        version: VERSION,
        dueCount: selection.due.length,
        positiveDue: selection.positive.length,
        paperClosingDue: selection.paperClosing.length,
        auditCandidates: candidates.length,
        addedCalls: addedCalls.length,
        decisions
      }
    },
    auditCandidates: candidates.map(item => item.row),
    addedCalls,
    decisions
  };
}
function shouldFinalizeClosing(checkpoint) { return checkpoint === CHECKPOINTS.T20M; }
function coverageHealth(db) {
  createSchema(db);
  const rows = db.prepare('SELECT checkpoint,status,COUNT(*) n FROM tennis_clv_snapshot_checkpoints GROUP BY checkpoint,status ORDER BY checkpoint,status').all();
  const total = Number(db.prepare('SELECT COUNT(*) n FROM tennis_clv_snapshot_checkpoints').get().n);
  const distinctBets = Number(db.prepare('SELECT COUNT(DISTINCT bet_id) n FROM tennis_clv_snapshot_checkpoints').get().n);
  return {
    version: VERSION,
    totalSnapshots: total,
    distinctBets,
    distribution: rows,
    finalCheckpoint: CHECKPOINTS.T20M,
    retroactiveReconstruction: false,
    apiPolicy: 'ONE_GROUPED_PAPER_AUDIT_CALL_PER_RUN_MAX',
    modelAuthority: false,
    stakeAuthority: false
  };
}

module.exports = {
  VERSION, CHECKPOINTS, MAX_AUDIT_CALLS_PER_RUN,
  parseMatchEpoch, leadHours, checkpointFor, createSchema, hasCheckpoint,
  recordSnapshot, ensureFirstSeenSnapshots, dueCandidates, selectAuditCandidates,
  augmentPlanWithCalibrationAudit, shouldFinalizeClosing, coverageHealth
};
