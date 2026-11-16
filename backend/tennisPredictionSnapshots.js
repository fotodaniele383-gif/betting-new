'use strict';

const crypto = require('crypto');

const TENNIS_PREDICTION_SNAPSHOT_VERSION = 'TENNIS_PREDICTION_SNAPSHOT_V1_PATCH7';
const TENNIS_PREDICTION_SNAPSHOT_TABLE = 'tennis_prediction_snapshots';

const SNAPSHOT_TYPES = Object.freeze({
  ORIGINAL: 'ORIGINAL',
  BASELINE_RECOVERY: 'BASELINE_RECOVERY',
  MARKET_UPDATE: 'MARKET_UPDATE',
  MODEL_REFRESH: 'MODEL_REFRESH',
  DECISION_REVISION: 'DECISION_REVISION',
  COMPOSITE_REVISION: 'COMPOSITE_REVISION',
  POST_START_INVALID: 'POST_START_INVALID'
});

const SNAPSHOT_STATUSES = Object.freeze({
  VALID_PREMATCH: 'VALID_PREMATCH',
  INCOMPLETE: 'INCOMPLETE',
  POST_START_INVALID: 'POST_START_INVALID',
  RECOVERY_NOT_ORIGINAL: 'RECOVERY_NOT_ORIGINAL'
});

const SNAPSHOT_SCHEMA = Object.freeze([
  ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
  ['snapshot_id', 'TEXT NOT NULL UNIQUE'],
  ['bet_id', 'INTEGER NOT NULL'],
  ['snapshot_sequence', 'INTEGER NOT NULL'],
  ['snapshot_type', 'TEXT NOT NULL'],
  ['snapshot_status', 'TEXT NOT NULL'],
  ['is_calibration_anchor', 'INTEGER NOT NULL DEFAULT 0'],
  ['captured_at', 'TEXT NOT NULL'],
  ['match_start_at', 'TEXT'],
  ['event_fingerprint', 'TEXT'],
  ['market_fingerprint', 'TEXT'],
  ['predicted_side', 'TEXT'],
  ['point_line', 'REAL'],
  ['model_probability_pct', 'REAL'],
  ['raw_probability_pct', 'REAL'],
  ['market_probability_pct', 'REAL'],
  ['opening_odd', 'REAL'],
  ['edge_pp', 'REAL'],
  ['ev_pct', 'REAL'],
  ['model_version', 'TEXT'],
  ['metric_version', 'TEXT'],
  ['engine_version', 'TEXT'],
  ['registry_version', 'TEXT'],
  ['decision_status', 'TEXT'],
  ['gate_status', 'TEXT'],
  ['deep_scan_status', 'TEXT'],
  ['stake_proposed', 'REAL'],
  ['stake_final', 'REAL'],
  ['decision_reasons', 'TEXT'],
  ['input_hash', 'TEXT NOT NULL'],
  ['snapshot_hash', 'TEXT NOT NULL UNIQUE'],
  ['previous_snapshot_hash', 'TEXT'],
  ['operation_id', 'TEXT'],
  ['invalid_reason', 'TEXT'],
  ['payload_json', 'TEXT NOT NULL'],
  ['snapshot_version', 'TEXT NOT NULL']
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function round(value, digits = 4) { const n = number(value); return n == null ? null : Number(n.toFixed(digits)); }
function normalizeProbabilityPct(value) {
  const n = number(value);
  if (n == null) return null;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return pct > 0 && pct < 100 ? round(pct, 4) : null;
}
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  }
  return value;
}
function sha256(value) {
  return crypto.createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(stableObject(value)))
    .digest('hex');
}
function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function parseTimestampMeta(value) {
  const raw = text(value);
  if (!raw) return { raw: null, epochMs: null, parseable: false, explicitTimezone: false };
  const explicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) || /^\d{10,13}$/.test(raw);
  let epochMs = null;
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    epochMs = raw.length <= 10 ? numeric * 1000 : numeric;
  } else {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) epochMs = parsed;
  }
  return { raw, epochMs, parseable: epochMs != null, explicitTimezone };
}
function normalizeSide(row = {}) {
  const raw = upper(row.internal_side || row.predicted_side || row.prediction);
  if (raw === '1' || raw === 'P1' || raw === 'HOME') return '1';
  if (raw === '2' || raw === 'P2' || raw === 'AWAY') return '2';
  if (raw.includes('OVER')) return 'OVER';
  if (raw.includes('UNDER')) return 'UNDER';
  return raw || null;
}
function inferMarket(row = {}) {
  const raw = upper([row.market_type, row.bet_type, row.prediction].filter(Boolean).join(' '));
  if (/TOTAL|OVER|UNDER|GAMES/.test(raw)) return 'TOTALS';
  if (/HANDICAP|SPREAD/.test(raw)) return 'HANDICAP';
  if (/MONEY|H2H|WINNER/.test(raw) || ['1', '2'].includes(normalizeSide(row))) return 'MONEYLINE';
  return 'UNKNOWN';
}
function buildDecisionReasons(row = {}) {
  const values = [
    row.professional_gate_reasons,
    row.tennis_operational_summary,
    row.deepscan_gate_reason,
    row.stake_policy_note,
    row.audit_scope_reason,
    row.exposure_reason
  ].map(text).filter(Boolean);
  return [...new Set(values)].join(' | ').slice(0, 6000) || null;
}
function buildSnapshotPayload(row = {}, options = {}) {
  const openingOddCandidate = number(row.opening_odd) > 1 ? number(row.opening_odd) : number(row.odd);
  const modelProbabilityPct = normalizeProbabilityPct(row.estimated_prob ?? row.estimatedProb ?? row.probability);
  const marketProbabilityPct = normalizeProbabilityPct(row.market_implied_prob) ??
    (openingOddCandidate > 1 ? round(100 / openingOddCandidate, 4) : null);
  const capturedAt = options.capturedAt || new Date().toISOString();
  return stableObject({
    bet_id: Number(row.id),
    match_start_at: text(row.canonical_event_time_safety_utc || row.canonical_match_datetime || row.match_date) || null,
    canonical_event_time_contract_version: text(row.canonical_event_time_contract_version) || null,
    canonical_event_time_revision_id: text(row.canonical_event_time_revision_id) || null,
    canonical_event_time_canonical_utc: text(row.canonical_event_time_canonical_utc) || null,
    canonical_event_time_safety_utc: text(row.canonical_event_time_safety_utc) || null,
    canonical_event_time_source_kind: text(row.canonical_event_time_source_kind) || null,
    canonical_event_time_source_id: text(row.canonical_event_time_source_id) || null,
    canonical_event_time_source_timezone: text(row.canonical_event_time_source_timezone) || null,
    canonical_event_time_confidence: text(row.canonical_event_time_confidence) || null,
    canonical_event_time_quality_status: text(row.canonical_event_time_quality_status) || null,
    home_team: text(row.home_team || row.home) || null,
    away_team: text(row.away_team || row.away) || null,
    league: text(row.league) || null,
    tour_type: text(row.tour_type) || null,
    surface: text(row.surface) || null,
    market_type: inferMarket(row),
    event_fingerprint: text(row.tennis_event_fingerprint) || null,
    market_fingerprint: text(row.tennis_market_fingerprint) || null,
    event_identity_status: text(row.tennis_event_identity_status) || null,
    event_identity_version: text(row.tennis_event_identity_version) || null,
    predicted_side: normalizeSide(row),
    predicted_player_name: text(row.predicted_player_name) || null,
    point_line: number(row.point_line),
    model_probability_pct: modelProbabilityPct,
    raw_probability_pct: normalizeProbabilityPct(row.raw_probability_pct ?? row.raw_probability),
    market_probability_pct: marketProbabilityPct,
    opening_odd: openingOddCandidate > 1 ? round(openingOddCandidate, 4) : null,
    edge_pp: round(row.edge_pp ?? row.edge, 4),
    ev_pct: round(row.ev_pct, 4),
    model_version: text(row.model_version) || null,
    metric_version: text(row.metric_version) || null,
    engine_version: text(row.engine_version) || null,
    registry_version: text(options.registryVersion || row.registry_version) || null,
    decision_status: text(row.tennis_operational_status || row.trading_scope) || null,
    gate_status: text(row.professional_gate_status || row.deepscan_gate_status) || null,
    deep_scan_status: text(row.ds_action || row.deep_scan_risk_level || row.deepscan_gate_status) || null,
    stake_proposed: round(row.stake_base_before_deepscan ?? row.requested_stake, 4),
    stake_final: round(row.stake, 4),
    decision_reasons: buildDecisionReasons(row),
    data_quality: text(row.data_quality) || null,
    captured_at: capturedAt
  });
}
function contentForInputHash(payload = {}) {
  const { captured_at, ...content } = payload;
  return content;
}
function validateSnapshotPayload(payload = {}, options = {}) {
  const missing = [];
  if (!(Number(payload.bet_id) > 0)) missing.push('BET_ID_MISSING');
  if (!text(payload.match_start_at)) missing.push('MATCH_START_MISSING');
  if (!text(payload.event_fingerprint)) missing.push('EVENT_FINGERPRINT_MISSING');
  if (!text(payload.market_fingerprint)) missing.push('MARKET_FINGERPRINT_MISSING');
  if (!text(payload.predicted_side)) missing.push('PREDICTED_SIDE_MISSING');
  if (!(number(payload.opening_odd) > 1)) missing.push('OPENING_ODD_INVALID');
  if (normalizeProbabilityPct(payload.model_probability_pct) == null) missing.push('MODEL_PROBABILITY_INVALID');
  if (!text(payload.model_version)) missing.push('MODEL_VERSION_MISSING');
  if (payload.market_type === 'TOTALS' && number(payload.point_line) == null) missing.push('TOTALS_POINT_LINE_MISSING');

  const capturedMeta = parseTimestampMeta(payload.captured_at);
  const startMeta = parseTimestampMeta(payload.match_start_at);
  const postStart = capturedMeta.parseable && startMeta.parseable && capturedMeta.epochMs > startMeta.epochMs;
  const definitelyPostStart = postStart && (startMeta.explicitTimezone || options.allowLocalTimeComparison === true);
  if (definitelyPostStart) {
    return {
      status: SNAPSHOT_STATUSES.POST_START_INVALID,
      validForCalibration: false,
      invalidReason: 'SNAPSHOT_CAPTURED_AFTER_MATCH_START',
      missing,
      capturedMeta,
      startMeta
    };
  }
  if (missing.length) {
    return {
      status: SNAPSHOT_STATUSES.INCOMPLETE,
      validForCalibration: false,
      invalidReason: missing.join('|'),
      missing,
      capturedMeta,
      startMeta
    };
  }
  return {
    status: SNAPSHOT_STATUSES.VALID_PREMATCH,
    validForCalibration: true,
    invalidReason: null,
    missing,
    capturedMeta,
    startMeta
  };
}
function changedGroups(previousPayload = {}, nextPayload = {}) {
  const groups = {
    MARKET: ['opening_odd', 'market_probability_pct', 'market_type', 'point_line'],
    MODEL: ['model_probability_pct', 'raw_probability_pct', 'edge_pp', 'ev_pct', 'model_version', 'metric_version', 'engine_version'],
    DECISION: ['decision_status', 'gate_status', 'deep_scan_status', 'stake_proposed', 'stake_final', 'decision_reasons']
  };
  const changed = [];
  for (const [group, keys] of Object.entries(groups)) {
    if (keys.some(key => JSON.stringify(previousPayload[key] ?? null) !== JSON.stringify(nextPayload[key] ?? null))) changed.push(group);
  }
  return changed;
}
function inferSnapshotType(previousRow, payload, validation, options = {}) {
  if (!previousRow) {
    if (options.allowOriginal === false) return SNAPSHOT_TYPES.BASELINE_RECOVERY;
    return validation.status === SNAPSHOT_STATUSES.POST_START_INVALID ? SNAPSHOT_TYPES.POST_START_INVALID : SNAPSHOT_TYPES.ORIGINAL;
  }
  if (validation.status === SNAPSHOT_STATUSES.POST_START_INVALID) return SNAPSHOT_TYPES.POST_START_INVALID;
  const previousPayload = safeJsonParse(previousRow.payload_json, {});
  const changes = changedGroups(previousPayload, payload);
  if (changes.length > 1) return SNAPSHOT_TYPES.COMPOSITE_REVISION;
  if (changes[0] === 'MARKET') return SNAPSHOT_TYPES.MARKET_UPDATE;
  if (changes[0] === 'MODEL') return SNAPSHOT_TYPES.MODEL_REFRESH;
  if (changes[0] === 'DECISION') return SNAPSHOT_TYPES.DECISION_REVISION;
  return SNAPSHOT_TYPES.COMPOSITE_REVISION;
}
function getTableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}
function ensurePredictionSnapshotTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TENNIS_PREDICTION_SNAPSHOT_TABLE} (${SNAPSHOT_SCHEMA.map(([name, type]) => `${name} ${type}`).join(', ')})`);
  const columns = getTableColumns(db, TENNIS_PREDICTION_SNAPSHOT_TABLE);
  for (const [name, type] of SNAPSHOT_SCHEMA) {
    if (columns.has(name) || name === 'id') continue;
    const additiveType = type
      .replace(/\s+PRIMARY KEY.*/i, '')
      .replace(/\s+UNIQUE/ig, '')
      .replace(/\s+NOT NULL/ig, '')
      .replace(/\s+DEFAULT\s+[^\s]+/ig, '');
    db.exec(`ALTER TABLE ${TENNIS_PREDICTION_SNAPSHOT_TABLE} ADD COLUMN ${name} ${additiveType}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${TENNIS_PREDICTION_SNAPSHOT_TABLE}_bet_seq ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE}(bet_id, snapshot_sequence)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${TENNIS_PREDICTION_SNAPSHOT_TABLE}_bet_input ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE}(bet_id, input_hash)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${TENNIS_PREDICTION_SNAPSHOT_TABLE}_anchor ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE}(bet_id) WHERE is_calibration_anchor = 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${TENNIS_PREDICTION_SNAPSHOT_TABLE}_bet ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE}(bet_id, snapshot_sequence)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${TENNIS_PREDICTION_SNAPSHOT_TABLE}_status ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE}(snapshot_status)`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS ${TENNIS_PREDICTION_SNAPSHOT_TABLE}_no_update BEFORE UPDATE ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE} BEGIN SELECT RAISE(ABORT, '${TENNIS_PREDICTION_SNAPSHOT_TABLE} is immutable'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS ${TENNIS_PREDICTION_SNAPSHOT_TABLE}_no_delete BEFORE DELETE ON ${TENNIS_PREDICTION_SNAPSHOT_TABLE} BEGIN SELECT RAISE(ABORT, '${TENNIS_PREDICTION_SNAPSHOT_TABLE} is immutable'); END;`);
  return true;
}
function latestSnapshot(db, betId) {
  ensurePredictionSnapshotTable(db);
  return db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? ORDER BY snapshot_sequence DESC LIMIT 1`).get(betId) || null;
}
function getCalibrationAnchor(db, betId) {
  ensurePredictionSnapshotTable(db);
  return db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? AND is_calibration_anchor = 1 ORDER BY snapshot_sequence LIMIT 1`).get(betId) || null;
}
function buildSnapshotHashMaterial(row = {}) {
  return stableObject({
    version: row.snapshot_version || TENNIS_PREDICTION_SNAPSHOT_VERSION,
    snapshot_id: row.snapshot_id,
    bet_id: Number(row.bet_id),
    snapshot_sequence: Number(row.snapshot_sequence),
    snapshot_type: row.snapshot_type,
    snapshot_status: row.snapshot_status,
    is_calibration_anchor: Number(row.is_calibration_anchor || 0),
    captured_at: row.captured_at,
    input_hash: row.input_hash,
    previous_snapshot_hash: row.previous_snapshot_hash || null,
    payload: typeof row.payload_json === 'string' ? safeJsonParse(row.payload_json, null) : row.payload_json
  });
}
function capturePredictionSnapshot(db, sourceRow = {}, options = {}) {
  ensurePredictionSnapshotTable(db);
  const betId = Number(sourceRow.id);
  if (!(betId > 0)) throw new Error('PATCH7_SNAPSHOT_BET_ID_INVALID');
  const capturedAt = options.capturedAt || new Date().toISOString();
  const payload = buildSnapshotPayload(sourceRow, { ...options, capturedAt });
  const inputHash = sha256(contentForInputHash(payload));
  const duplicate = db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? AND input_hash = ? LIMIT 1`).get(betId, inputHash);
  if (duplicate) {
    return { inserted: false, duplicate: true, snapshot: duplicate, validation: validateSnapshotPayload(payload, options) };
  }

  const previous = latestSnapshot(db, betId);
  const sequence = previous ? Number(previous.snapshot_sequence) + 1 : 1;
  const validation = validateSnapshotPayload(payload, options);
  const snapshotType = options.snapshotType || inferSnapshotType(previous, payload, validation, options);
  const anchorAllowed = !previous && options.allowOriginal !== false && snapshotType === SNAPSHOT_TYPES.ORIGINAL && validation.validForCalibration;
  const snapshotStatus = snapshotType === SNAPSHOT_TYPES.BASELINE_RECOVERY
    ? SNAPSHOT_STATUSES.RECOVERY_NOT_ORIGINAL
    : validation.status;
  const snapshotId = `TPS7_${betId}_${String(sequence).padStart(4, '0')}_${crypto.randomBytes(5).toString('hex')}`;
  const record = {
    snapshot_id: snapshotId,
    bet_id: betId,
    snapshot_sequence: sequence,
    snapshot_type: snapshotType,
    snapshot_status: snapshotStatus,
    is_calibration_anchor: anchorAllowed ? 1 : 0,
    captured_at: capturedAt,
    match_start_at: payload.match_start_at,
    event_fingerprint: payload.event_fingerprint,
    market_fingerprint: payload.market_fingerprint,
    predicted_side: payload.predicted_side,
    point_line: payload.point_line,
    model_probability_pct: payload.model_probability_pct,
    raw_probability_pct: payload.raw_probability_pct,
    market_probability_pct: payload.market_probability_pct,
    opening_odd: payload.opening_odd,
    edge_pp: payload.edge_pp,
    ev_pct: payload.ev_pct,
    model_version: payload.model_version,
    metric_version: payload.metric_version,
    engine_version: payload.engine_version,
    registry_version: payload.registry_version,
    decision_status: payload.decision_status,
    gate_status: payload.gate_status,
    deep_scan_status: payload.deep_scan_status,
    stake_proposed: payload.stake_proposed,
    stake_final: payload.stake_final,
    decision_reasons: payload.decision_reasons,
    input_hash: inputHash,
    previous_snapshot_hash: previous?.snapshot_hash || null,
    operation_id: options.operationId || null,
    invalid_reason: snapshotType === SNAPSHOT_TYPES.BASELINE_RECOVERY
      ? 'FIRST_CAPTURE_WAS_UPDATE_OF_EXISTING_ROW'
      : validation.invalidReason,
    payload_json: JSON.stringify(payload),
    snapshot_version: TENNIS_PREDICTION_SNAPSHOT_VERSION
  };
  record.snapshot_hash = sha256(buildSnapshotHashMaterial(record));
  const names = SNAPSHOT_SCHEMA.map(([name]) => name).filter(name => name !== 'id');
  db.prepare(`INSERT INTO ${TENNIS_PREDICTION_SNAPSHOT_TABLE} (${names.join(', ')}) VALUES (${names.map(name => `@${name}`).join(', ')})`).run(record);
  return { inserted: true, duplicate: false, snapshot: { ...record }, validation };
}
function verifyPredictionSnapshotRows(rows = []) {
  const previousByBet = new Map();
  const sequenceByBet = new Map();
  const failures = [];
  for (const row of rows) {
    const numericBetId = Number(row.bet_id);
    const expectedPrevious = previousByBet.get(numericBetId) || null;
    const expectedSequence = (sequenceByBet.get(numericBetId) || 0) + 1;
    const expectedHash = sha256(buildSnapshotHashMaterial(row));
    if ((row.previous_snapshot_hash || null) !== expectedPrevious) failures.push({ betId: row.bet_id, sequence: row.snapshot_sequence, code: 'PREVIOUS_HASH_MISMATCH' });
    if (Number(row.snapshot_sequence) !== expectedSequence) failures.push({ betId: row.bet_id, sequence: row.snapshot_sequence, code: 'SEQUENCE_GAP' });
    if (row.snapshot_hash !== expectedHash) failures.push({ betId: row.bet_id, sequence: row.snapshot_sequence, code: 'SNAPSHOT_HASH_MISMATCH' });
    previousByBet.set(numericBetId, row.snapshot_hash);
    sequenceByBet.set(numericBetId, Number(row.snapshot_sequence));
  }
  return { valid: failures.length === 0, rows: rows.length, bets: previousByBet.size, failures };
}
function verifyPredictionSnapshotChain(db, options = {}) {
  ensurePredictionSnapshotTable(db);
  const betId = Number(options.betId);
  const rows = betId > 0
    ? db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? ORDER BY bet_id, snapshot_sequence`).all(betId)
    : db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} ORDER BY bet_id, snapshot_sequence`).all();
  return verifyPredictionSnapshotRows(rows);
}
function ensureCalibrationLedgerSchema(db, eligibility) {
  const table = eligibility.TENNIS_CALIBRATION_LEDGER_TABLE;
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${eligibility.LEDGER_SCHEMA.map(([name, type]) => `${name} ${type}`).join(', ')})`);
  const columns = getTableColumns(db, table);
  for (const [name, type] of eligibility.LEDGER_SCHEMA) {
    if (columns.has(name) || name === 'bet_id') continue;
    const additiveType = type
      .replace(/\s+PRIMARY KEY.*/i, '')
      .replace(/\s+NOT NULL/ig, '')
      .replace(/\s+DEFAULT\s+[^\s]+/ig, '');
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${additiveType}`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_status ON ${table}(eligibility_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_segment ON ${table}(segment_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_dataset ON ${table}(dataset_version)`);
}
function refreshCalibrationEligibilityForBet(db, betId, options = {}) {
  const eligibility = require('./tennisCalibrationEligibility');
  ensureCalibrationLedgerSchema(db, eligibility);
  const sourceRow = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(betId);
  if (!sourceRow) return { updated: false, reason: 'SOURCE_BET_NOT_FOUND', betId };
  const anchor = getCalibrationAnchor(db, betId);
  const effectiveRow = eligibility.applyPredictionSnapshotToRow(sourceRow, anchor);
  const record = eligibility.buildEligibilityRecord(effectiveRow, {
    evaluatedAt: options.evaluatedAt || new Date().toISOString(),
    operationId: options.operationId || null,
    requirePredictionSnapshot: true
  });
  if (!record) return { updated: false, reason: 'NOT_TENNIS', betId };
  const names = eligibility.LEDGER_SCHEMA.map(([name]) => name);
  const update = names.filter(name => name !== 'bet_id').map(name => `${name}=excluded.${name}`).join(', ');
  const clean = Object.fromEntries(names.map(name => [name, record[name] ?? null]));
  db.prepare(`INSERT INTO ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE} (${names.join(', ')}) VALUES (${names.map(name => `@${name}`).join(', ')}) ON CONFLICT(bet_id) DO UPDATE SET ${update}`).run(clean);
  return { updated: true, betId, record, anchorSnapshotId: anchor?.snapshot_id || null };
}
function getPredictionSnapshotAudit(db, options = {}) {
  ensurePredictionSnapshotTable(db);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const betId = Number(options.betId);
  const rows = betId > 0
    ? db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? ORDER BY snapshot_sequence DESC LIMIT ?`).all(betId, limit)
    : db.prepare(`SELECT * FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} ORDER BY id DESC LIMIT ?`).all(limit);
  const counts = db.prepare(`SELECT snapshot_status, snapshot_type, COUNT(*) count FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE} GROUP BY snapshot_status, snapshot_type ORDER BY count DESC`).all();
  const totals = db.prepare(`SELECT COUNT(*) snapshots, COUNT(DISTINCT bet_id) bets, SUM(CASE WHEN is_calibration_anchor=1 THEN 1 ELSE 0 END) anchors, SUM(CASE WHEN snapshot_status='POST_START_INVALID' THEN 1 ELSE 0 END) postStartInvalid, SUM(CASE WHEN snapshot_status='INCOMPLETE' THEN 1 ELSE 0 END) incomplete FROM ${TENNIS_PREDICTION_SNAPSHOT_TABLE}`).get();
  const chain = verifyPredictionSnapshotChain(db, betId > 0 ? { betId } : {});
  return {
    success: chain.valid,
    version: TENNIS_PREDICTION_SNAPSHOT_VERSION,
    table: TENNIS_PREDICTION_SNAPSHOT_TABLE,
    immutable: true,
    forwardOnly: true,
    totals: {
      snapshots: Number(totals.snapshots || 0),
      bets: Number(totals.bets || 0),
      anchors: Number(totals.anchors || 0),
      postStartInvalid: Number(totals.postStartInvalid || 0),
      incomplete: Number(totals.incomplete || 0)
    },
    counts,
    chain,
    rows: rows.map(row => {
      const { payload_json, ...safeRow } = row;
      return safeRow;
    })
  };
}

module.exports = {
  TENNIS_PREDICTION_SNAPSHOT_VERSION,
  TENNIS_PREDICTION_SNAPSHOT_TABLE,
  SNAPSHOT_TYPES,
  SNAPSHOT_STATUSES,
  SNAPSHOT_SCHEMA,
  stableObject,
  sha256,
  parseTimestampMeta,
  buildSnapshotPayload,
  validateSnapshotPayload,
  ensurePredictionSnapshotTable,
  capturePredictionSnapshot,
  getCalibrationAnchor,
  verifyPredictionSnapshotRows,
  verifyPredictionSnapshotChain,
  refreshCalibrationEligibilityForBet,
  getPredictionSnapshotAudit,
  buildSnapshotHashMaterial
};
