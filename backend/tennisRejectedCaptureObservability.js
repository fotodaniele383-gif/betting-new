'use strict';

const crypto = require('crypto');
const prematchGate = require('./tennisPrematchCaptureGate');

const TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION = 'TENNIS_REJECTED_CAPTURE_OBSERVABILITY_V1_PATCH32';
const TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION = 'TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_V1_PATCH32';
const CLOCK_DRIFT_TOLERANCE_MS = 120000;
const CLOCK_REFERENCE_MAX_DISTANCE_MS = 10 * 60 * 1000;
const BOUNDARY_REVIEW_WINDOW_MS = 120000;

const REASON_FAMILIES = Object.freeze({
  REQUIRED_FIELDS: 'REQUIRED_FIELDS',
  MATCH_START_UNRESOLVED: 'MATCH_START_UNRESOLVED',
  CAPTURE_TIME_UNRESOLVED: 'CAPTURE_TIME_UNRESOLVED',
  CAPTURE_AT_OR_AFTER_START: 'CAPTURE_AT_OR_AFTER_START',
  EVENT_TIME_CONTRACT: 'EVENT_TIME_CONTRACT',
  SCHEDULE_LIFECYCLE: 'SCHEDULE_LIFECYCLE',
  OTHER_GATE_BLOCK: 'OTHER_GATE_BLOCK'
});

const CLOCK_DRIFT_STATES = Object.freeze({
  WITHIN_TOLERANCE: 'WITHIN_TOLERANCE',
  PROVIDER_REFERENCE_DRIFT_SUSPECT: 'PROVIDER_REFERENCE_DRIFT_SUSPECT',
  CAPTURE_CLOCK_FUTURE_SUSPECT: 'CAPTURE_CLOCK_FUTURE_SUSPECT',
  CAPTURE_TIMESTAMP_STALE: 'CAPTURE_TIMESTAMP_STALE',
  REFERENCE_STALE_OR_NOT_COMPARABLE: 'REFERENCE_STALE_OR_NOT_COMPARABLE',
  NOT_MEASURABLE: 'NOT_MEASURABLE'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function first(...values) { for (const value of values) { const result = text(value); if (result) return result; } return null; }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function sha(value) { return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function tableExists(db, table) { return Boolean(db.prepare(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?`).get(table)); }

function runTransaction(db, fn) {
  if (db.inTransaction) return fn();
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_rejected_capture_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      rejected_at TEXT NOT NULL,
      operation_id TEXT,
      gate_version TEXT NOT NULL,
      gate_status TEXT NOT NULL,
      reason_family TEXT NOT NULL,
      reason_codes_json TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'UNKNOWN',
      tour_type TEXT,
      tournament TEXT,
      home_player TEXT,
      away_player TEXT,
      event_fingerprint TEXT,
      market_fingerprint TEXT,
      prediction TEXT,
      match_start_raw TEXT,
      match_start_epoch_ms INTEGER,
      capture_at TEXT,
      capture_epoch_ms INTEGER,
      lead_time_ms INTEGER,
      timezone TEXT,
      match_start_parse_mode TEXT,
      capture_parse_mode TEXT,
      reference_clock_field TEXT,
      reference_clock_at TEXT,
      reference_clock_epoch_ms INTEGER,
      observed_clock_drift_ms INTEGER,
      corrected_lead_time_ms INTEGER,
      clock_drift_status TEXT NOT NULL,
      boundary_review_required INTEGER NOT NULL DEFAULT 0 CHECK(boundary_review_required IN (0,1)),
      suspected_false_rejection INTEGER NOT NULL DEFAULT 0 CHECK(suspected_false_rejection IN (0,1)),
      false_rejection_reason TEXT,
      missing_fields_json TEXT NOT NULL,
      attempt_fingerprint TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      ledger_version TEXT NOT NULL,
      event_time_contract_version TEXT,
      event_time_quality_status TEXT,
      event_time_confidence TEXT,
      event_time_revision_id TEXT,
      event_time_safety_start_at_utc TEXT,
      schedule_contract_version TEXT,
      schedule_receipt_id TEXT,
      schedule_status TEXT,
      schedule_transition_type TEXT,
      schedule_capture_disposition TEXT,
      schedule_block_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_rejected_capture_rejected_at ON tennis_rejected_capture_ledger(rejected_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_rejected_capture_reason ON tennis_rejected_capture_ledger(reason_family, gate_status);
    CREATE INDEX IF NOT EXISTS idx_tennis_rejected_capture_provider ON tennis_rejected_capture_ledger(provider_id, rejected_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_rejected_capture_drift ON tennis_rejected_capture_ledger(clock_drift_status, suspected_false_rejection);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_rejected_capture_no_update
      BEFORE UPDATE ON tennis_rejected_capture_ledger
      BEGIN SELECT RAISE(ABORT, 'TENNIS_REJECTED_CAPTURE_LEDGER_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_rejected_capture_no_delete
      BEFORE DELETE ON tennis_rejected_capture_ledger
      BEGIN SELECT RAISE(ABORT, 'TENNIS_REJECTED_CAPTURE_LEDGER_APPEND_ONLY'); END;
  `);
  const present = new Set(db.prepare('PRAGMA table_info(tennis_rejected_capture_ledger)').all().map(row => row.name));
  const additive = [
    ['event_time_contract_version','TEXT'],['event_time_quality_status','TEXT'],['event_time_confidence','TEXT'],
    ['event_time_revision_id','TEXT'],['event_time_safety_start_at_utc','TEXT'],
    ['schedule_contract_version','TEXT'],['schedule_receipt_id','TEXT'],['schedule_status','TEXT'],
    ['schedule_transition_type','TEXT'],['schedule_capture_disposition','TEXT'],['schedule_block_reason','TEXT']
  ];
  for (const [name,type] of additive) if (!present.has(name)) db.exec(`ALTER TABLE tennis_rejected_capture_ledger ADD COLUMN ${name} ${type}`);
  return schemaHealth(db);
}

function schemaHealth(db) {
  const requiredColumns = [
    'event_id','rejected_at','operation_id','gate_version','gate_status','reason_family','reason_codes_json',
    'provider_id','tour_type','event_fingerprint','market_fingerprint','match_start_raw','match_start_epoch_ms',
    'capture_at','capture_epoch_ms','lead_time_ms','timezone','reference_clock_field','reference_clock_epoch_ms',
    'observed_clock_drift_ms','corrected_lead_time_ms','clock_drift_status','boundary_review_required',
    'suspected_false_rejection','attempt_fingerprint','previous_event_hash','event_hash','payload_json','ledger_version',
    'event_time_contract_version','event_time_quality_status','event_time_confidence','event_time_revision_id','event_time_safety_start_at_utc',
    'schedule_contract_version','schedule_receipt_id','schedule_status','schedule_transition_type','schedule_capture_disposition','schedule_block_reason'
  ];
  if (!tableExists(db, 'tennis_rejected_capture_ledger')) return { healthy: false, tablePresent: false, missingColumns: requiredColumns, appendOnlyTriggers: [] };
  const columns = new Set(db.prepare('PRAGMA table_info(tennis_rejected_capture_ledger)').all().map(row => row.name));
  const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tennis_rejected_capture_ledger' ORDER BY name`).all().map(row => row.name);
  const appendOnlyTriggers = ['trg_tennis_rejected_capture_no_update','trg_tennis_rejected_capture_no_delete'];
  const missingColumns = requiredColumns.filter(column => !columns.has(column));
  return { healthy: missingColumns.length === 0 && appendOnlyTriggers.every(name => triggers.includes(name)), tablePresent: true, missingColumns, triggers, appendOnlyTriggers };
}

function reasonFamily(status, decision = {}) {
  const value = text(status).toUpperCase();
  const reasons = text(decision.reason || (decision.reasonCodes || []).join('|')).toUpperCase();
  if (reasons.includes('PATCH34_OFFICIAL_SCHEDULE') || decision.scheduleLifecycle) return REASON_FAMILIES.SCHEDULE_LIFECYCLE;
  if (reasons.includes('PATCH33_CANONICAL_EVENT_TIME') || decision.eventTimeContract) return REASON_FAMILIES.EVENT_TIME_CONTRACT;
  if (value === 'BLOCK_REQUIRED_FIELDS') return REASON_FAMILIES.REQUIRED_FIELDS;
  if (value === 'BLOCK_MATCH_START_UNRESOLVED' && /PATCH33_CANONICAL_EVENT_TIME/.test(text(status))) return REASON_FAMILIES.EVENT_TIME_CONTRACT;
  if (value === 'BLOCK_MATCH_START_UNRESOLVED') return REASON_FAMILIES.MATCH_START_UNRESOLVED;
  if (value === 'BLOCK_CAPTURE_TIME_UNRESOLVED') return REASON_FAMILIES.CAPTURE_TIME_UNRESOLVED;
  if (value === 'BLOCK_CAPTURE_AT_OR_AFTER_START') return REASON_FAMILIES.CAPTURE_AT_OR_AFTER_START;
  return REASON_FAMILIES.OTHER_GATE_BLOCK;
}

function normalizeProvider(value) {
  const raw = text(value).toUpperCase().replace(/[^A-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return raw || 'UNKNOWN';
}

function buildAttemptContext(row = {}, rawBet = {}, options = {}) {
  return {
    operationId: first(options.operationId, row.operation_id),
    providerId: normalizeProvider(first(row.reference_market_source, rawBet.reference_market_source, row.provider_id, rawBet.provider_id, row.odds_provider, rawBet.odds_provider, row.source_provider, rawBet.source_provider, row.bookmaker, rawBet.bookmaker)),
    tourType: first(row.tour_type, rawBet.tourType, rawBet.tour_type, row.league, rawBet.league),
    tournament: first(row.tournament, rawBet.tournament, row.league, rawBet.league),
    homePlayer: first(row.home_team, rawBet.home, rawBet.home_team),
    awayPlayer: first(row.away_team, rawBet.away, rawBet.away_team),
    eventFingerprint: first(row.tennis_event_fingerprint, rawBet.tennis_event_fingerprint),
    marketFingerprint: first(row.tennis_market_fingerprint, rawBet.tennis_market_fingerprint),
    prediction: first(row.prediction, rawBet.prediction),
    matchStartRaw: first(row.canonical_match_datetime, row.match_start_at, row.canonical_event_time, row.match_date, rawBet.canonical_match_datetime, rawBet.match_start_at, rawBet.date),
    eventTimeContract: options.eventTimeContract || row.eventTimeContract || rawBet.eventTimeContract || null,
    eventTimeRevisionId: options.eventTimeRevisionId || null,
    scheduleLifecycle: options.scheduleLifecycle || row.scheduleLifecycle || rawBet.scheduleLifecycle || null,
    scheduleReceiptId: options.scheduleReceiptId || null,
    referenceClocks: {
      provider_timestamp: first(row.provider_timestamp, rawBet.provider_timestamp),
      source_timestamp: first(row.source_timestamp, rawBet.source_timestamp),
      odds_fetched_at: first(row.odds_fetched_at, rawBet.odds_fetched_at),
      request_received_at: first(row.request_received_at, rawBet.request_received_at),
      fetched_at: first(row.fetched_at, rawBet.fetched_at)
    }
  };
}

function selectReferenceClock(context, captureEpochMs, timeZone) {
  if (!Number.isFinite(captureEpochMs)) return null;
  const candidates = [];
  for (const [field, value] of Object.entries(context.referenceClocks || {})) {
    if (!value) continue;
    const parsed = prematchGate.parseTimestamp(value, { timeZone });
    if (!parsed.parseable) continue;
    const distanceMs = parsed.epochMs - captureEpochMs;
    candidates.push({ field, raw: value, epochMs: parsed.epochMs, distanceMs, absDistanceMs: Math.abs(distanceMs), mode: parsed.mode });
  }
  candidates.sort((a, b) => a.absDistanceMs - b.absDistanceMs || a.field.localeCompare(b.field));
  return candidates[0] || null;
}

function analyzeClock(decision = {}, context = {}, observedAt = new Date().toISOString()) {
  const timeZone = text(decision.timeZone || prematchGate.DEFAULT_TIME_ZONE) || prematchGate.DEFAULT_TIME_ZONE;
  const capture = decision.captureTime?.parseable ? decision.captureTime : prematchGate.parseTimestamp(decision.captureAt, { timeZone: 'UTC' });
  const matchStart = decision.matchStart?.parseable ? decision.matchStart : prematchGate.parseTimestamp(decision.matchStartAt || context.matchStartRaw, { timeZone });
  const observed = prematchGate.parseTimestamp(observedAt, { timeZone: 'UTC' });
  const reference = selectReferenceClock(context, capture.epochMs, timeZone);
  let clockDriftStatus = CLOCK_DRIFT_STATES.NOT_MEASURABLE;
  let observedClockDriftMs = null;
  let correctedLeadTimeMs = numberOrNull(decision.leadTimeMs);

  if (capture.parseable && observed.parseable && capture.epochMs > observed.epochMs + 5000) {
    clockDriftStatus = CLOCK_DRIFT_STATES.CAPTURE_CLOCK_FUTURE_SUSPECT;
    observedClockDriftMs = capture.epochMs - observed.epochMs;
  } else if (capture.parseable && observed.parseable && observed.epochMs - capture.epochMs > 5 * 60 * 1000) {
    clockDriftStatus = CLOCK_DRIFT_STATES.CAPTURE_TIMESTAMP_STALE;
    observedClockDriftMs = capture.epochMs - observed.epochMs;
  } else if (reference) {
    observedClockDriftMs = reference.distanceMs;
    if (reference.absDistanceMs > CLOCK_REFERENCE_MAX_DISTANCE_MS) clockDriftStatus = CLOCK_DRIFT_STATES.REFERENCE_STALE_OR_NOT_COMPARABLE;
    else if (reference.absDistanceMs > CLOCK_DRIFT_TOLERANCE_MS) clockDriftStatus = CLOCK_DRIFT_STATES.PROVIDER_REFERENCE_DRIFT_SUSPECT;
    else clockDriftStatus = CLOCK_DRIFT_STATES.WITHIN_TOLERANCE;
    if (Number.isFinite(numberOrNull(decision.leadTimeMs))) correctedLeadTimeMs = Number(decision.leadTimeMs) - reference.distanceMs;
  } else if (capture.parseable && observed.parseable) {
    observedClockDriftMs = capture.epochMs - observed.epochMs;
    clockDriftStatus = Math.abs(observedClockDriftMs) <= 5000 ? CLOCK_DRIFT_STATES.WITHIN_TOLERANCE : CLOCK_DRIFT_STATES.NOT_MEASURABLE;
  }

  const leadTimeMs = numberOrNull(decision.leadTimeMs);
  const boundaryReviewRequired = Number.isFinite(leadTimeMs) && Math.abs(leadTimeMs) <= BOUNDARY_REVIEW_WINDOW_MS;
  const suspectedFalseRejection = decision.status === prematchGate.GATE_STATUSES.BLOCK_CAPTURE_AT_OR_AFTER_START
    && clockDriftStatus === CLOCK_DRIFT_STATES.PROVIDER_REFERENCE_DRIFT_SUSPECT
    && Number.isFinite(correctedLeadTimeMs) && correctedLeadTimeMs > 30000;
  const falseRejectionReason = suspectedFalseRejection
    ? 'PROVIDER_REFERENCE_CLOCK_PLACES_CAPTURE_CERTIFIABLY_BEFORE_START'
    : (boundaryReviewRequired ? 'BOUNDARY_WINDOW_REVIEW_ONLY_NO_AUTOMATIC_OVERRIDE' : null);

  return {
    timeZone,
    capture,
    matchStart,
    observed,
    reference,
    observedClockDriftMs,
    correctedLeadTimeMs,
    clockDriftStatus,
    boundaryReviewRequired,
    suspectedFalseRejection,
    falseRejectionReason
  };
}

function buildRejectedCaptureEvent(context = {}, decision = {}, options = {}) {
  const rejectedAt = text(options.observedAt || new Date().toISOString());
  const clock = analyzeClock(decision, context, rejectedAt);
  const reasonCodes = Array.isArray(decision.reasonCodes) ? [...new Set(decision.reasonCodes.map(text).filter(Boolean))] : text(decision.reason).split('|').map(text).filter(Boolean);
  const missingFields = Array.isArray(decision.payloadCompleteness?.missing) ? decision.payloadCompleteness.missing.map(text).filter(Boolean) : [];
  const eventId = `rc_${crypto.randomUUID()}`;
  const attemptFingerprint = sha(stableJson({
    eventFingerprint: context.eventFingerprint,
    marketFingerprint: context.marketFingerprint,
    providerId: context.providerId,
    gateStatus: decision.status,
    reasonCodes,
    captureAt: decision.captureAt,
    matchStartAt: decision.matchStartAt,
    prediction: context.prediction
  }));
  const payload = {
    eventId,
    rejectedAt,
    operationId: context.operationId || null,
    gateVersion: decision.version || prematchGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
    gateStatus: decision.status || 'UNKNOWN',
    reasonFamily: reasonFamily(decision.status, decision),
    reasonCodes,
    providerId: context.providerId || 'UNKNOWN',
    tourType: context.tourType || null,
    tournament: context.tournament || null,
    homePlayer: context.homePlayer || null,
    awayPlayer: context.awayPlayer || null,
    eventFingerprint: context.eventFingerprint || null,
    marketFingerprint: context.marketFingerprint || null,
    prediction: context.prediction || null,
    matchStartRaw: decision.matchStartAt || context.matchStartRaw || null,
    matchStartEpochMs: numberOrNull(clock.matchStart?.epochMs),
    captureAt: decision.captureAt || null,
    captureEpochMs: numberOrNull(clock.capture?.epochMs),
    leadTimeMs: numberOrNull(decision.leadTimeMs),
    timezone: clock.timeZone,
    matchStartParseMode: clock.matchStart?.mode || null,
    captureParseMode: clock.capture?.mode || null,
    referenceClockField: clock.reference?.field || null,
    referenceClockAt: clock.reference?.raw || null,
    referenceClockEpochMs: numberOrNull(clock.reference?.epochMs),
    observedClockDriftMs: numberOrNull(clock.observedClockDriftMs),
    correctedLeadTimeMs: numberOrNull(clock.correctedLeadTimeMs),
    clockDriftStatus: clock.clockDriftStatus,
    boundaryReviewRequired: clock.boundaryReviewRequired,
    suspectedFalseRejection: clock.suspectedFalseRejection,
    falseRejectionReason: clock.falseRejectionReason,
    missingFields,
    attemptFingerprint,
    ledgerVersion: TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
    eventTimeContract: context.eventTimeContract || decision.eventTimeContract || null,
    eventTimeRevisionId: context.eventTimeRevisionId || null,
    scheduleLifecycle: context.scheduleLifecycle || decision.scheduleLifecycle || null,
    scheduleReceiptId: context.scheduleReceiptId || null,
    authority: { predictionPersistence: false, snapshot: false, probability: false, qualityGate: false, stake: false, settlement: false, automaticOverride: false }
  };
  return payload;
}

function recordRejectedCapture(db, context = {}, decision = {}, options = {}) {
  ensureSchema(db);
  const payload = buildRejectedCaptureEvent(context, decision, options);
  return runTransaction(db, () => {
    const previous = db.prepare('SELECT event_hash FROM tennis_rejected_capture_ledger ORDER BY id DESC LIMIT 1').get();
    const previousEventHash = previous?.event_hash || null;
    const payloadJson = stableJson(payload);
    const eventHash = sha(`${previousEventHash || 'GENESIS'}|${payloadJson}`);
    const result = db.prepare(`INSERT INTO tennis_rejected_capture_ledger (
      event_id,rejected_at,operation_id,gate_version,gate_status,reason_family,reason_codes_json,provider_id,tour_type,tournament,
      home_player,away_player,event_fingerprint,market_fingerprint,prediction,match_start_raw,match_start_epoch_ms,capture_at,capture_epoch_ms,
      lead_time_ms,timezone,match_start_parse_mode,capture_parse_mode,reference_clock_field,reference_clock_at,reference_clock_epoch_ms,
      observed_clock_drift_ms,corrected_lead_time_ms,clock_drift_status,boundary_review_required,suspected_false_rejection,false_rejection_reason,
      missing_fields_json,attempt_fingerprint,previous_event_hash,event_hash,payload_json,ledger_version,
      event_time_contract_version,event_time_quality_status,event_time_confidence,event_time_revision_id,event_time_safety_start_at_utc,
      schedule_contract_version,schedule_receipt_id,schedule_status,schedule_transition_type,schedule_capture_disposition,schedule_block_reason,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      payload.eventId,payload.rejectedAt,payload.operationId,payload.gateVersion,payload.gateStatus,payload.reasonFamily,JSON.stringify(payload.reasonCodes),payload.providerId,payload.tourType,payload.tournament,
      payload.homePlayer,payload.awayPlayer,payload.eventFingerprint,payload.marketFingerprint,payload.prediction,payload.matchStartRaw,payload.matchStartEpochMs,payload.captureAt,payload.captureEpochMs,
      payload.leadTimeMs,payload.timezone,payload.matchStartParseMode,payload.captureParseMode,payload.referenceClockField,payload.referenceClockAt,payload.referenceClockEpochMs,
      payload.observedClockDriftMs,payload.correctedLeadTimeMs,payload.clockDriftStatus,payload.boundaryReviewRequired?1:0,payload.suspectedFalseRejection?1:0,payload.falseRejectionReason,
      JSON.stringify(payload.missingFields),payload.attemptFingerprint,previousEventHash,eventHash,payloadJson,TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
      payload.eventTimeContract?.version || null,payload.eventTimeContract?.qualityStatus || null,payload.eventTimeContract?.confidence || null,
      payload.eventTimeRevisionId || null,payload.eventTimeContract?.safetyStartAtUtc || null,
      payload.scheduleLifecycle?.version || null,payload.scheduleReceiptId || null,payload.scheduleLifecycle?.normalizedStatus || null,
      payload.scheduleLifecycle?.transitionType || null,payload.scheduleLifecycle?.disposition || null,
      (payload.scheduleLifecycle?.reasonCodes || []).join('|') || null,payload.rejectedAt
    );
    return { recorded: true, id: Number(result.lastInsertRowid), eventId: payload.eventId, eventHash, payload };
  });
}

function verifyLedgerChain(db, options = {}) {
  if (!tableExists(db, 'tennis_rejected_capture_ledger')) return { healthy: false, checked: 0, brokenAt: null, reason: 'TABLE_MISSING' };
  const limit = Math.max(1, Math.min(100000, Number(options.limit || 100000)));
  const rows = db.prepare('SELECT id,event_id,previous_event_hash,event_hash,payload_json FROM tennis_rejected_capture_ledger ORDER BY id ASC LIMIT ?').all(limit);
  let previous = null;
  for (const row of rows) {
    const expected = sha(`${previous || 'GENESIS'}|${row.payload_json}`);
    if ((row.previous_event_hash || null) !== previous || row.event_hash !== expected) return { healthy: false, checked: rows.indexOf(row), brokenAt: row.id, eventId: row.event_id, reason: 'HASH_CHAIN_MISMATCH' };
    previous = row.event_hash;
  }
  return { healthy: true, checked: rows.length, brokenAt: null, lastEventHash: previous };
}

function buildObservabilityReport(db, options = {}) {
  const schema = schemaHealth(db);
  if (!schema.healthy) return { success: false, healthy: false, status: 'ERROR', version: TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION, schema, readOnly: true };
  const limit = Math.max(1, Math.min(200, Number(options.limit || 30)));
  const total = Number(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger').get().n || 0);
  const since24h = Number(db.prepare("SELECT COUNT(*) n FROM tennis_rejected_capture_ledger WHERE rejected_at >= datetime('now','-24 hours')").get().n || 0);
  const driftSuspects = Number(db.prepare("SELECT COUNT(*) n FROM tennis_rejected_capture_ledger WHERE clock_drift_status IN ('PROVIDER_REFERENCE_DRIFT_SUSPECT','CAPTURE_CLOCK_FUTURE_SUSPECT','CAPTURE_TIMESTAMP_STALE')").get().n || 0);
  const falseRejectionSuspects = Number(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger WHERE suspected_false_rejection=1').get().n || 0);
  const boundaryReviews = Number(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger WHERE boundary_review_required=1').get().n || 0);
  const reasons = db.prepare('SELECT reason_family reason, COUNT(*) count FROM tennis_rejected_capture_ledger GROUP BY reason_family ORDER BY count DESC, reason ASC').all().map(row => ({ reason: row.reason, count: Number(row.count || 0) }));
  const providers = db.prepare(`SELECT provider_id provider, COUNT(*) total,
      SUM(CASE WHEN clock_drift_status IN ('PROVIDER_REFERENCE_DRIFT_SUSPECT','CAPTURE_CLOCK_FUTURE_SUSPECT','CAPTURE_TIMESTAMP_STALE') THEN 1 ELSE 0 END) driftSuspects,
      SUM(suspected_false_rejection) falseRejectionSuspects,
      SUM(CASE WHEN reason_family='MATCH_START_UNRESOLVED' THEN 1 ELSE 0 END) unresolvedMatchStart,
      SUM(CASE WHEN reason_family='CAPTURE_AT_OR_AFTER_START' THEN 1 ELSE 0 END) atOrAfterStart
      FROM tennis_rejected_capture_ledger GROUP BY provider_id ORDER BY total DESC, provider_id ASC`).all().map(row => ({ provider: row.provider, total: Number(row.total||0), driftSuspects: Number(row.driftSuspects||0), falseRejectionSuspects: Number(row.falseRejectionSuspects||0), unresolvedMatchStart: Number(row.unresolvedMatchStart||0), atOrAfterStart: Number(row.atOrAfterStart||0) }));
  const recent = db.prepare(`SELECT event_id,rejected_at,operation_id,gate_status,reason_family,reason_codes_json,provider_id,tour_type,tournament,home_player,away_player,
      match_start_raw,capture_at,lead_time_ms,clock_drift_status,observed_clock_drift_ms,corrected_lead_time_ms,boundary_review_required,suspected_false_rejection,false_rejection_reason,attempt_fingerprint,
      schedule_contract_version,schedule_receipt_id,schedule_status,schedule_transition_type,schedule_capture_disposition,schedule_block_reason
      FROM tennis_rejected_capture_ledger ORDER BY id DESC LIMIT ?`).all(limit).map(row => ({ ...row, reason_codes: JSON.parse(row.reason_codes_json || '[]'), boundary_review_required: Number(row.boundary_review_required||0)===1, suspected_false_rejection: Number(row.suspected_false_rejection||0)===1 }));
  const chain = verifyLedgerChain(db);
  const healthy = schema.healthy && chain.healthy;
  return {
    success: healthy,
    healthy,
    status: healthy ? (falseRejectionSuspects > 0 || driftSuspects > 0 ? 'WARN' : 'OK') : 'ERROR',
    version: TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION,
    schemaVersion: TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
    appendOnly: true,
    transactionalPredictionRollbackPreserved: true,
    automaticOverride: false,
    counts: { total, last24Hours: since24h, driftSuspects, boundaryReviews, suspectedFalseRejections: falseRejectionSuspects },
    reasons,
    providers,
    recent,
    chain,
    schema,
    thresholds: { clockDriftToleranceMs: CLOCK_DRIFT_TOLERANCE_MS, clockReferenceMaxDistanceMs: CLOCK_REFERENCE_MAX_DISTANCE_MS, boundaryReviewWindowMs: BOUNDARY_REVIEW_WINDOW_MS },
    authority: { predictionPersistence: false, probability: false, qualityGate: false, stake: false, settlement: false, automaticReactivation: false },
    readOnly: true,
    generatedAt: new Date().toISOString()
  };
}

function selfCheck() {
  const baseContext = buildAttemptContext({
    reference_market_source: 'TEST_PROVIDER', home_team: 'A', away_team: 'B', tour_type: 'ATP',
    tennis_event_fingerprint: 'event-test', tennis_market_fingerprint: 'market-test', prediction: '1',
    provider_timestamp: '2026-08-02T18:27:00.000Z'
  }, {}, { operationId: 'op-test' });
  const decision = prematchGate.buildGateDecision({
    id: 1, canonical_match_datetime: '2026-08-02T20:30:00', home_team: 'A', away_team: 'B', league: 'ATP',
    tennis_event_fingerprint: 'event-test', tennis_market_fingerprint: 'market-test', prediction: '1', odd: 1.9,
    estimated_prob: 55, model_version: 'M', metric_version: 'K', engine_version: 'E'
  }, { captureAt: '2026-08-02T18:31:00.000Z', checkedAt: '2026-08-02T18:31:00.000Z' });
  const event = buildRejectedCaptureEvent(baseContext, decision, { observedAt: '2026-08-02T18:31:01.000Z' });
  const checks = {
    rejectedClassified: event.reasonFamily === REASON_FAMILIES.CAPTURE_AT_OR_AFTER_START,
    providerNormalized: event.providerId === 'TEST_PROVIDER',
    driftDetected: event.clockDriftStatus === CLOCK_DRIFT_STATES.PROVIDER_REFERENCE_DRIFT_SUSPECT,
    suspectedFalseRejection: event.suspectedFalseRejection === true && event.correctedLeadTimeMs === 180000,
    noAutomaticOverride: event.authority.automaticOverride === false
  };
  return { ok: Object.values(checks).every(Boolean), version: TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION, schemaVersion: TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION, checks };
}

module.exports = {
  TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION,
  TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
  CLOCK_DRIFT_TOLERANCE_MS,
  CLOCK_REFERENCE_MAX_DISTANCE_MS,
  BOUNDARY_REVIEW_WINDOW_MS,
  REASON_FAMILIES,
  CLOCK_DRIFT_STATES,
  ensureSchema,
  schemaHealth,
  reasonFamily,
  buildAttemptContext,
  analyzeClock,
  buildRejectedCaptureEvent,
  recordRejectedCapture,
  verifyLedgerChain,
  buildObservabilityReport,
  selfCheck
};
