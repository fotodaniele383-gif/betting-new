'use strict';

const crypto = require('crypto');

const TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION = 'TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_V1_PATCH34';
const TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION = 'TENNIS_SCHEDULE_RECEIPT_SCHEMA_V1_PATCH34';
// Candidate only; preserves the public Patch34 identifiers and DB schema.
const AUDIT14_R2_1E_HARDENING_REVISION = 'AUDIT14_R2_1E_SCHEDULE_AUTHORITY_SHADOW_CANDIDATE_V1';

const SCHEDULE_STATES = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  DELAYED: 'DELAYED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  SUSPENDED: 'SUSPENDED',
  RESUMED: 'RESUMED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  UNKNOWN: 'UNKNOWN'
});

const CAPTURE_DISPOSITIONS = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_REVIEW: 'ALLOW_WITH_REVIEW',
  BLOCK: 'BLOCK'
});

const TRANSITION_TYPES = Object.freeze({
  INITIAL: 'INITIAL',
  UNCHANGED: 'UNCHANGED',
  RESCHEDULED_EARLIER: 'RESCHEDULED_EARLIER',
  RESCHEDULED_LATER: 'RESCHEDULED_LATER',
  DELAYED: 'DELAYED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  SUSPENDED: 'SUSPENDED',
  RESUMED: 'RESUMED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  STATUS_CONFLICT: 'STATUS_CONFLICT',
  UNKNOWN: 'UNKNOWN'
});

const SOURCE_AUTHORITY = Object.freeze({
  OFFICIAL_TOUR: 100,
  OFFICIAL_TOURNAMENT: 95,
  PRIMARY_EVENT_PROVIDER: 85,
  ODDS_PROVIDER: 70,
  APPLICATION_CANONICAL: 50,
  LEGACY_FALLBACK: 25
});

const BLOCKING_STATES = new Set([
  SCHEDULE_STATES.POSTPONED,
  SCHEDULE_STATES.CANCELLED,
  SCHEDULE_STATES.SUSPENDED,
  SCHEDULE_STATES.RESUMED, // A resumed event is no longer safely pre-match.
  SCHEDULE_STATES.STARTED,
  SCHEDULE_STATES.COMPLETED
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function first(...values) { return values.map(text).find(Boolean) || null; }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function iso(epochMs) { return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null; }
function tableExists(db, name) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function columns(db, table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }

function normalizeStatus(value) {
  const raw = upper(value).replace(/[\s-]+/g, '_');
  if (!raw) return SCHEDULE_STATES.UNKNOWN;
  if (['SCHEDULED','NOT_STARTED','NOTSTARTED','UPCOMING','PREMATCH','PRE_MATCH','NS','READY'].includes(raw)) return SCHEDULE_STATES.SCHEDULED;
  if (['DELAYED','RAIN_DELAY','WEATHER_DELAY','COURT_DELAY','LATE_START'].includes(raw)) return SCHEDULE_STATES.DELAYED;
  if (['POSTPONED','PPD','POSTPONE'].includes(raw)) return SCHEDULE_STATES.POSTPONED;
  if (['CANCELLED','CANCELED','ABANDONED','ABORTED'].includes(raw)) return SCHEDULE_STATES.CANCELLED;
  if (['SUSPENDED','INTERRUPTED','PAUSED','RAIN_SUSPENSION'].includes(raw)) return SCHEDULE_STATES.SUSPENDED;
  if (['RESUMED','RESTARTED','RESUME'].includes(raw)) return SCHEDULE_STATES.RESUMED;
  if (['STARTED','LIVE','IN_PLAY','INPLAY','ONGOING','PLAYING'].includes(raw)) return SCHEDULE_STATES.STARTED;
  if (['COMPLETED','FINISHED','FINAL','ENDED','CLOSED'].includes(raw)) return SCHEDULE_STATES.COMPLETED;
  return SCHEDULE_STATES.UNKNOWN;
}

function sourceKindFromField(field, explicitKind) {
  const declared = upper(explicitKind);
  if (Object.prototype.hasOwnProperty.call(SOURCE_AUTHORITY, declared)) return declared;
  const f = upper(field);
  if (f.startsWith('OFFICIAL_TOUR_') || f.includes('ATP_OFFICIAL') || f.includes('WTA_OFFICIAL') || f.includes('ITF_OFFICIAL')) return 'OFFICIAL_TOUR';
  if (f.startsWith('OFFICIAL_') || f.startsWith('TOURNAMENT_')) return 'OFFICIAL_TOURNAMENT';
  if (f.startsWith('PROVIDER_') || f.startsWith('PRIMARY_')) return 'PRIMARY_EVENT_PROVIDER';
  if (f.includes('ODDS_') || f === 'EVENT_STATUS') return 'ODDS_PROVIDER';
  if (f.startsWith('CANONICAL_') || f.startsWith('APPLICATION_')) return 'APPLICATION_CANONICAL';
  return 'LEGACY_FALLBACK';
}

function providerId(row = {}, rawBet = {}, sourceKind = null) {
  return first(
    rawBet.schedule_source_id, row.schedule_source_id,
    rawBet.official_schedule_provider, row.official_schedule_provider,
    rawBet.event_provider, row.event_provider,
    rawBet.provider_name, row.provider_name,
    rawBet.reference_market_source, row.reference_market_source,
    rawBet.bookmaker, row.bookmaker
    // Do not invent a provider identity from a source category label.
  );
}

// AUDIT-14 R2.2D: the server persists its normalized decision back into
// ai_forward_test.  On a later PENDING upsert that same application-produced
// value must not be counted as a fresh OFFICIAL_TOURNAMENT observation.
// Keep a prior BLOCKING value as a conservative application-local safety veto.
function statusDefinitions(row = {}, rawBet = {}) {
  const hasPersistedScheduleDecision = Boolean(first(
    row.official_schedule_contract_version,
    row.official_schedule_receipt_id,
    row.official_schedule_observation_hash
  ));
  const persistedStatus = normalizeStatus(row.official_schedule_status);
  const persistedTerminalSafetyVeto = hasPersistedScheduleDecision && BLOCKING_STATES.has(persistedStatus)
    ? row.official_schedule_status
    : null;
  return [
    ['official_tour_schedule_status', first(rawBet.official_tour_schedule_status, row.official_tour_schedule_status)],
    ['application_persisted_blocking_schedule_status', persistedTerminalSafetyVeto],
    ['official_schedule_status', first(rawBet.official_schedule_status, hasPersistedScheduleDecision ? null : row.official_schedule_status)],
    ['official_event_status', first(rawBet.official_event_status, row.official_event_status)],
    ['official_match_status', first(rawBet.official_match_status, row.official_match_status)],
    ['tournament_schedule_status', first(rawBet.tournament_schedule_status, row.tournament_schedule_status)],
    ['provider_schedule_status', first(rawBet.provider_schedule_status, row.provider_schedule_status)],
    ['primary_event_status', first(rawBet.primary_event_status, row.primary_event_status)],
    ['odds_event_status', first(rawBet.odds_event_status, row.odds_event_status)],
    ['event_status', first(rawBet.event_status, row.event_status)],
    ['match_status_external', first(rawBet.match_status_external, row.match_status_external)],
    ['schedule_status', first(rawBet.schedule_status, row.schedule_status)],
    ['canonical_schedule_status', first(rawBet.canonical_schedule_status, row.canonical_schedule_status)]
  ];
}

function collectScheduleCandidates(row = {}, rawBet = {}) {
  const explicitKind = first(rawBet.schedule_source_kind, row.schedule_source_kind);
  const candidates = [];
  const seen = new Set();
  for (const [field, rawStatus] of statusDefinitions(row, rawBet)) {
    if (!rawStatus) continue;
    const sourceKind = sourceKindFromField(field, explicitKind);
    const sourceId = providerId(row, rawBet, sourceKind);
    const key = `${field}|${rawStatus}|${sourceKind}|${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      sourceKind,
      sourceId,
      sourceField: field,
      // Legacy nominal rank remains for sorting/compatibility; it is NOT proof.
      authority: SOURCE_AUTHORITY[sourceKind] || 0,
      verifiedAuthority: 0,
      provenanceVerified: false,
      provenanceStatus: 'UNVERIFIED_DECLARATION',
      rawStatus: text(rawStatus),
      normalizedStatus: normalizeStatus(rawStatus)
    });
  }
  return candidates.sort((a, b) => b.authority - a.authority || a.sourceField.localeCompare(b.sourceField));
}

function latestReceipt(db, eventFingerprint) {
  if (!eventFingerprint || !tableExists(db, 'tennis_schedule_receipts')) return null;
  return db.prepare('SELECT * FROM tennis_schedule_receipts WHERE event_fingerprint=? ORDER BY id DESC LIMIT 1').get(eventFingerprint) || null;
}

function inferTransition(previous, decision) {
  const status = decision.normalizedStatus;
  if (!previous) return TRANSITION_TYPES.INITIAL;
  if (decision.statusConflict) return TRANSITION_TYPES.STATUS_CONFLICT;
  if (status === SCHEDULE_STATES.CANCELLED) return TRANSITION_TYPES.CANCELLED;
  if (status === SCHEDULE_STATES.POSTPONED) return TRANSITION_TYPES.POSTPONED;
  if (status === SCHEDULE_STATES.SUSPENDED) return TRANSITION_TYPES.SUSPENDED;
  if (status === SCHEDULE_STATES.RESUMED) return TRANSITION_TYPES.RESUMED;
  if (status === SCHEDULE_STATES.DELAYED) return TRANSITION_TYPES.DELAYED;
  if (status === SCHEDULE_STATES.STARTED) return TRANSITION_TYPES.STARTED;
  if (status === SCHEDULE_STATES.COMPLETED) return TRANSITION_TYPES.COMPLETED;
  const previousEpoch = numberOrNull(previous.effective_start_epoch_ms);
  const currentEpoch = numberOrNull(decision.effectiveStartEpochMs);
  if (previousEpoch !== null && currentEpoch !== null && previousEpoch !== currentEpoch) {
    return currentEpoch < previousEpoch ? TRANSITION_TYPES.RESCHEDULED_EARLIER : TRANSITION_TYPES.RESCHEDULED_LATER;
  }
  if (upper(previous.normalized_status) === status) return TRANSITION_TYPES.UNCHANGED;
  return status === SCHEDULE_STATES.UNKNOWN ? TRANSITION_TYPES.UNKNOWN : TRANSITION_TYPES.UNCHANGED;
}

function resolveScheduleLifecycle(row = {}, rawBet = {}, options = {}) {
  const observedAt = text(options.observedAt || new Date().toISOString());
  const eventTimeDecision = options.eventTimeDecision || null;
  const eventFingerprint = first(row.tennis_event_fingerprint, rawBet.tennis_event_fingerprint, row.event_fingerprint, rawBet.event_fingerprint);
  const providerEventId = first(row.provider_event_id, rawBet.provider_event_id, row.event_id, rawBet.event_id);
  const candidates = collectScheduleCandidates(row, rawBet);
  // Any reported terminal/in-play state vetoes a permissive UNKNOWN or SCHEDULED.
  // A lower nominal source rank must never erase a safety warning.
  const blockingCandidates = candidates.filter(candidate => BLOCKING_STATES.has(candidate.normalizedStatus));
  const allowingCandidates = candidates.filter(candidate => [SCHEDULE_STATES.SCHEDULED, SCHEDULE_STATES.DELAYED].includes(candidate.normalizedStatus));
  const selected = blockingCandidates[0] || candidates[0] || null;
  const statusConflict = blockingCandidates.length > 0 && allowingCandidates.length > 0;
  let normalizedStatus = selected?.normalizedStatus || SCHEDULE_STATES.UNKNOWN;
  let disposition = CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW;
  // Field names and caller-provided provider strings are not authenticated provenance.
  let confidence = 'LOW';
  const reasonCodes = [];

  if (statusConflict) {
    disposition = CAPTURE_DISPOSITIONS.BLOCK;
    reasonCodes.push('MATERIAL_SCHEDULE_STATUS_CONFLICT', 'SAFETY_BLOCK_ON_REPORTED_TERMINAL_STATE');
  } else if (BLOCKING_STATES.has(normalizedStatus)) {
    disposition = CAPTURE_DISPOSITIONS.BLOCK;
    reasonCodes.push(`SCHEDULE_STATE_${normalizedStatus}`, 'SAFETY_BLOCK_ON_REPORTED_TERMINAL_STATE');
  } else if (normalizedStatus === SCHEDULE_STATES.DELAYED) {
    const futureStart = Number.isFinite(Number(eventTimeDecision?.safetyStartEpochMs)) && Number(eventTimeDecision.safetyStartEpochMs) > Date.parse(observedAt);
    if (!futureStart) {
      disposition = CAPTURE_DISPOSITIONS.BLOCK;
      reasonCodes.push('DELAYED_WITHOUT_CERTIFIED_FUTURE_START');
    } else {
      disposition = CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW;
      reasonCodes.push('DELAYED_WITH_CERTIFIED_FUTURE_START');
    }
  } else if (normalizedStatus === SCHEDULE_STATES.SCHEDULED) {
    // There is no independently verified source adapter in this module.
    disposition = CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW;
    reasonCodes.push('DECLARED_SCHEDULE_SOURCE_NOT_VERIFIED');
  } else {
    disposition = CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW;
    reasonCodes.push('NO_AUTHORITATIVE_SCHEDULE_STATUS_EVIDENCE');
  }

  // Fail closed locally, even if the HTTP caller also checks the canonical gate.
  if (!eventTimeDecision || eventTimeDecision.allowCapture !== true) {
    disposition = CAPTURE_DISPOSITIONS.BLOCK;
    reasonCodes.push('EVENT_TIME_CONTRACT_NOT_CERTIFIED');
  }
  if (!eventFingerprint) reasonCodes.push('EVENT_FINGERPRINT_MISSING');

  const effectiveStartEpochMs = numberOrNull(eventTimeDecision?.safetyStartEpochMs ?? eventTimeDecision?.canonicalStartEpochMs);
  const payload = {
    version: TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
    schemaVersion: TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION,
    observedAt,
    eventFingerprint,
    providerEventId,
    candidates,
    selected,
    normalizedStatus,
    statusConflict,
    confidence,
    sourceProvenanceVerified: false,
    officialScheduleCertified: false,
    hardeningRevision: AUDIT14_R2_1E_HARDENING_REVISION,
    derivedStatusEchoGuardRevision: 'AUDIT14_R22D_DERIVED_STATUS_ECHO_GUARD_V1',
    disposition,
    allowCapture: disposition !== CAPTURE_DISPOSITIONS.BLOCK,
    reasonCodes: [...new Set(reasonCodes)],
    effectiveStartEpochMs,
    effectiveStartAtUtc: iso(effectiveStartEpochMs),
    eventTimeContractVersion: eventTimeDecision?.version || null,
    eventTimeQualityStatus: eventTimeDecision?.qualityStatus || null,
    authority: {
      captureLifecycle: true,
      captureCommit: true,
      probability: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticSettlement: false
    },
    policy: {
      terminalStatesBlock: [...BLOCKING_STATES],
      delayedRequiresCertifiedFutureStart: true,
      conflictRule: 'BLOCK_ON_ANY_REPORTED_TERMINAL_STATE',
      missingStatusRule: 'ALLOW_WITH_REVIEW_FOR_FORWARD_COMPATIBILITY',
      declaredSourceIsNotVerified: true,
      noAutomaticScheduleCertification: true,
    }
  };
  payload.observationHash = sha(stableJson({ ...payload, observationHash: undefined }));
  return payload;
}

function toGateBlockDecision(decision = {}, captureAt = new Date().toISOString()) {
  return {
    version: 'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3',
    status: 'BLOCK_MATCH_START_UNRESOLVED',
    allowCapture: false,
    certifiedPrematch: false,
    reasonCodes: [...(decision.reasonCodes || []), 'PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCK'],
    reason: [...(decision.reasonCodes || []), 'PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCK'].join('|'),
    checkedAt: captureAt,
    captureAt,
    matchStartAt: decision.effectiveStartAtUtc || null,
    leadTimeMs: null,
    minLeadTimeMs: 0,
    timeZone: 'UTC',
    snapshotValidationStatus: 'INCOMPLETE',
    payloadCompleteness: { complete: false, missing: ['OFFICIAL_SCHEDULE_LIFECYCLE_BLOCK'] },
    scheduleLifecycle: decision,
    authority: { productionProbability: false, qualityGate: false, stake: false, settlement: false, captureCommit: true }
  };
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_schedule_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL UNIQUE,
      event_fingerprint TEXT,
      provider_event_id TEXT,
      observed_at TEXT NOT NULL,
      capture_outcome TEXT NOT NULL,
      source_kind TEXT,
      source_id TEXT,
      source_field TEXT,
      source_authority INTEGER,
      raw_status TEXT,
      normalized_status TEXT NOT NULL,
      status_conflict INTEGER NOT NULL DEFAULT 0 CHECK(status_conflict IN (0,1)),
      confidence TEXT NOT NULL,
      capture_disposition TEXT NOT NULL,
      block_reason TEXT,
      effective_start_at_utc TEXT,
      effective_start_epoch_ms INTEGER,
      previous_effective_start_at_utc TEXT,
      transition_type TEXT NOT NULL,
      event_time_contract_version TEXT,
      event_time_revision_id TEXT,
      candidates_json TEXT NOT NULL,
      previous_receipt_hash TEXT,
      receipt_hash TEXT NOT NULL UNIQUE,
      observation_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_schedule_receipts_event ON tennis_schedule_receipts(event_fingerprint,id);
    CREATE INDEX IF NOT EXISTS idx_tennis_schedule_receipts_provider ON tennis_schedule_receipts(source_id,normalized_status);
    CREATE INDEX IF NOT EXISTS idx_tennis_schedule_receipts_observed ON tennis_schedule_receipts(observed_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_schedule_receipts_transition ON tennis_schedule_receipts(transition_type,capture_disposition);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_schedule_receipts_observation_outcome ON tennis_schedule_receipts(observation_hash,capture_outcome);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_schedule_receipts_no_update
      BEFORE UPDATE ON tennis_schedule_receipts
      BEGIN SELECT RAISE(ABORT,'TENNIS_SCHEDULE_RECEIPT_LEDGER_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_schedule_receipts_no_delete
      BEFORE DELETE ON tennis_schedule_receipts
      BEGIN SELECT RAISE(ABORT,'TENNIS_SCHEDULE_RECEIPT_LEDGER_APPEND_ONLY'); END;
  `);
  return schemaHealth(db);
}

function recordScheduleReceipt(db, decision = {}, options = {}) {
  ensureSchema(db);
  const captureOutcome = upper(options.captureOutcome || 'OBSERVED');
  const existing = db.prepare('SELECT * FROM tennis_schedule_receipts WHERE observation_hash=? AND capture_outcome=? LIMIT 1').get(decision.observationHash, captureOutcome);
  if (existing) return { inserted: false, duplicate: true, receipt: existing, captureToken: buildCaptureToken(existing) };
  const previous = latestReceipt(db, decision.eventFingerprint);
  const transitionType = inferTransition(previous, decision);
  const receiptId = `TSR34_${crypto.randomUUID()}`;
  const previousHash = previous?.receipt_hash || null;
  const selected = decision.selected || {};
  const material = {
    receiptId,
    eventFingerprint: decision.eventFingerprint,
    providerEventId: decision.providerEventId,
    observedAt: decision.observedAt,
    captureOutcome,
    sourceKind: selected.sourceKind || null,
    sourceId: selected.sourceId || null,
    sourceField: selected.sourceField || null,
    sourceAuthority: numberOrNull(selected.authority),
    rawStatus: selected.rawStatus || null,
    normalizedStatus: decision.normalizedStatus,
    statusConflict: Boolean(decision.statusConflict),
    confidence: decision.confidence,
    captureDisposition: decision.disposition,
    blockReason: (decision.reasonCodes || []).join('|') || null,
    effectiveStartAtUtc: decision.effectiveStartAtUtc,
    effectiveStartEpochMs: decision.effectiveStartEpochMs,
    previousEffectiveStartAtUtc: previous?.effective_start_at_utc || null,
    transitionType,
    eventTimeContractVersion: decision.eventTimeContractVersion,
    eventTimeRevisionId: options.eventTimeRevisionId || null,
    candidates: decision.candidates || [],
    observationHash: decision.observationHash,
    contractVersion: TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION
  };
  const receiptHash = sha(`${previousHash || 'GENESIS'}|${stableJson(material)}`);
  db.prepare(`INSERT INTO tennis_schedule_receipts (
    receipt_id,event_fingerprint,provider_event_id,observed_at,capture_outcome,source_kind,source_id,source_field,source_authority,
    raw_status,normalized_status,status_conflict,confidence,capture_disposition,block_reason,effective_start_at_utc,effective_start_epoch_ms,
    previous_effective_start_at_utc,transition_type,event_time_contract_version,event_time_revision_id,candidates_json,previous_receipt_hash,
    receipt_hash,observation_hash,contract_version,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    receiptId, decision.eventFingerprint, decision.providerEventId, decision.observedAt, captureOutcome,
    selected.sourceKind || null, selected.sourceId || null, selected.sourceField || null, numberOrNull(selected.authority),
    selected.rawStatus || null, decision.normalizedStatus, decision.statusConflict ? 1 : 0, decision.confidence, decision.disposition,
    (decision.reasonCodes || []).join('|') || null, decision.effectiveStartAtUtc, numberOrNull(decision.effectiveStartEpochMs),
    previous?.effective_start_at_utc || null, transitionType, decision.eventTimeContractVersion, options.eventTimeRevisionId || null,
    JSON.stringify(decision.candidates || []), previousHash, receiptHash, decision.observationHash,
    TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION, decision.observedAt
  );
  const receipt = db.prepare('SELECT * FROM tennis_schedule_receipts WHERE receipt_id=?').get(receiptId);
  return { inserted: true, duplicate: false, receipt, captureToken: buildCaptureToken(receipt) };
}

function buildCaptureToken(receipt = {}) {
  return {
    version: TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
    receiptId: receipt.receipt_id || null,
    receiptHash: receipt.receipt_hash || null,
    eventFingerprint: receipt.event_fingerprint || null,
    observationHash: receipt.observation_hash || null,
    captureOutcome: receipt.capture_outcome || null
  };
}

function assertCaptureTokenStable(db, token = {}) {
  if (!token.receiptId || !token.receiptHash) throw new Error('PATCH34_SCHEDULE_CAPTURE_TOKEN_MISSING');
  const latest = token.eventFingerprint
    ? db.prepare('SELECT receipt_id,receipt_hash,observation_hash,capture_outcome FROM tennis_schedule_receipts WHERE event_fingerprint=? ORDER BY id DESC LIMIT 1').get(token.eventFingerprint)
    : db.prepare('SELECT receipt_id,receipt_hash,observation_hash,capture_outcome FROM tennis_schedule_receipts ORDER BY id DESC LIMIT 1').get();
  const stable = latest && latest.receipt_id === token.receiptId && latest.receipt_hash === token.receiptHash && latest.observation_hash === token.observationHash;
  if (!stable) {
    const error = new Error('PATCH34_SCHEDULE_CAPTURE_RACE_DETECTED');
    error.code = 'PATCH34_SCHEDULE_CAPTURE_RACE_DETECTED';
    error.expected = token;
    error.actual = latest || null;
    throw error;
  }
  return { stable: true, receiptId: token.receiptId, receiptHash: token.receiptHash };
}

function verifyReceiptChain(db, eventFingerprint = null) {
  if (!tableExists(db, 'tennis_schedule_receipts')) return { healthy: false, checked: 0, reason: 'TABLE_MISSING' };
  const rows = eventFingerprint
    ? db.prepare('SELECT * FROM tennis_schedule_receipts WHERE event_fingerprint=? ORDER BY id').all(eventFingerprint)
    : db.prepare('SELECT * FROM tennis_schedule_receipts ORDER BY event_fingerprint,id').all();
  const previousByEvent = new Map();
  let checked = 0;
  for (const row of rows) {
    const key = row.event_fingerprint || '__NO_EVENT__';
    const previousHash = previousByEvent.get(key) || null;
    const material = {
      receiptId: row.receipt_id,
      eventFingerprint: row.event_fingerprint,
      providerEventId: row.provider_event_id,
      observedAt: row.observed_at,
      captureOutcome: row.capture_outcome,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceField: row.source_field,
      sourceAuthority: row.source_authority,
      rawStatus: row.raw_status,
      normalizedStatus: row.normalized_status,
      statusConflict: Number(row.status_conflict || 0) === 1,
      confidence: row.confidence,
      captureDisposition: row.capture_disposition,
      blockReason: row.block_reason,
      effectiveStartAtUtc: row.effective_start_at_utc,
      effectiveStartEpochMs: row.effective_start_epoch_ms,
      previousEffectiveStartAtUtc: row.previous_effective_start_at_utc,
      transitionType: row.transition_type,
      eventTimeContractVersion: row.event_time_contract_version,
      eventTimeRevisionId: row.event_time_revision_id,
      candidates: JSON.parse(row.candidates_json || '[]'),
      observationHash: row.observation_hash,
      contractVersion: row.contract_version
    };
    const expected = sha(`${previousHash || 'GENESIS'}|${stableJson(material)}`);
    if ((row.previous_receipt_hash || null) !== previousHash || row.receipt_hash !== expected) {
      return { healthy: false, checked, brokenAt: row.id, eventFingerprint: row.event_fingerprint, reason: 'HASH_CHAIN_MISMATCH' };
    }
    previousByEvent.set(key, row.receipt_hash);
    checked++;
  }
  return { healthy: true, checked, events: previousByEvent.size };
}

function schemaHealth(db) {
  const required = [
    'receipt_id','event_fingerprint','observed_at','capture_outcome','source_kind','source_id','source_field','source_authority',
    'raw_status','normalized_status','status_conflict','confidence','capture_disposition','effective_start_at_utc','transition_type',
    'previous_receipt_hash','receipt_hash','observation_hash','contract_version'
  ];
  if (!tableExists(db, 'tennis_schedule_receipts')) return { healthy: false, tableExists: false, appendOnly: false, missingColumns: required };
  const present = columns(db, 'tennis_schedule_receipts');
  const missingColumns = required.filter(name => !present.has(name));
  const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tennis_schedule_receipts'").all().map(row => row.name));
  const appendOnly = triggers.has('trg_tennis_schedule_receipts_no_update') && triggers.has('trg_tennis_schedule_receipts_no_delete');
  return { healthy: missingColumns.length === 0 && appendOnly, tableExists: true, appendOnly, missingColumns, triggers: [...triggers] };
}

function buildScheduleHealthReport(db, options = {}) {
  const schema = schemaHealth(db);
  const chain = schema.tableExists ? verifyReceiptChain(db) : { healthy: false, checked: 0, reason: 'TABLE_MISSING' };
  const total = schema.tableExists ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n || 0) : 0;
  const counts = schema.tableExists ? db.prepare(`SELECT
      SUM(CASE WHEN normalized_status='SCHEDULED' THEN 1 ELSE 0 END) scheduled,
      SUM(CASE WHEN normalized_status='DELAYED' THEN 1 ELSE 0 END) delayed,
      SUM(CASE WHEN normalized_status='POSTPONED' THEN 1 ELSE 0 END) postponed,
      SUM(CASE WHEN normalized_status='CANCELLED' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN normalized_status='SUSPENDED' THEN 1 ELSE 0 END) suspended,
      SUM(CASE WHEN normalized_status='RESUMED' THEN 1 ELSE 0 END) resumed,
      SUM(CASE WHEN status_conflict=1 THEN 1 ELSE 0 END) conflicts,
      SUM(CASE WHEN capture_disposition='BLOCK' THEN 1 ELSE 0 END) blocked,
      SUM(CASE WHEN transition_type='RESCHEDULED_EARLIER' THEN 1 ELSE 0 END) earlier,
      SUM(CASE WHEN transition_type='RESCHEDULED_LATER' THEN 1 ELSE 0 END) later
      FROM tennis_schedule_receipts`).get() : {};
  const providers = schema.tableExists ? db.prepare(`SELECT COALESCE(source_id,'UNKNOWN') provider,COALESCE(source_kind,'UNKNOWN') sourceKind,COUNT(*) total,
      SUM(CASE WHEN capture_disposition='BLOCK' THEN 1 ELSE 0 END) blocked,
      SUM(CASE WHEN status_conflict=1 THEN 1 ELSE 0 END) conflicts,
      SUM(CASE WHEN transition_type IN ('RESCHEDULED_EARLIER','RESCHEDULED_LATER') THEN 1 ELSE 0 END) reschedules
      FROM tennis_schedule_receipts GROUP BY COALESCE(source_id,'UNKNOWN'),COALESCE(source_kind,'UNKNOWN') ORDER BY total DESC,provider LIMIT 20`).all() : [];
  const recent = schema.tableExists ? db.prepare(`SELECT receipt_id,event_fingerprint,observed_at,capture_outcome,source_kind,source_id,raw_status,normalized_status,
      status_conflict,confidence,capture_disposition,block_reason,effective_start_at_utc,previous_effective_start_at_utc,transition_type,event_time_revision_id
      FROM tennis_schedule_receipts ORDER BY id DESC LIMIT ?`).all(Math.max(1, Math.min(200, Number(options.limit || 30)))) : [];
  const self = selfCheck();
  const healthy = schema.healthy && chain.healthy && self.ok;
  const warningCount = Number(counts.conflicts || 0) + Number(counts.blocked || 0);
  return {
    success: healthy,
    healthy,
    status: healthy ? (warningCount > 0 ? 'WARN' : 'OK') : 'ERROR',
    version: TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
    schemaVersion: TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION,
    total,
    counts: {
      scheduled: Number(counts.scheduled || 0), delayed: Number(counts.delayed || 0), postponed: Number(counts.postponed || 0),
      cancelled: Number(counts.cancelled || 0), suspended: Number(counts.suspended || 0), resumed: Number(counts.resumed || 0),
      conflicts: Number(counts.conflicts || 0), blocked: Number(counts.blocked || 0),
      rescheduledEarlier: Number(counts.earlier || 0), rescheduledLater: Number(counts.later || 0)
    },
    providers,
    recent,
    schema,
    chain,
    selfCheck: self,
    providerRegistry: SOURCE_AUTHORITY,
    captureRaceGuard: true,
    forwardOnly: true,
    noHistoricalBackfill: true,
    automaticSettlement: false,
    authority: { captureLifecycle: true, probability: false, qualityGate: false, stake: false, settlement: false },
    readOnly: true,
    generatedAt: new Date().toISOString()
  };
}

function selfCheck() {
  const futureTime = { version: 'T', allowCapture: true, safetyStartEpochMs: Date.parse('2026-08-03T19:00:00Z'), canonicalStartEpochMs: Date.parse('2026-08-03T19:00:00Z'), qualityStatus: 'CERTIFIED_HIGH' };
  const scheduled = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'scheduled', official_schedule_provider: 'ATP_OFFICIAL' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const cancelled = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'cancelled', official_schedule_provider: 'ATP_OFFICIAL' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const delayed = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { provider_schedule_status: 'delayed', provider_name: 'PRIMARY' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const conflict = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'scheduled', provider_schedule_status: 'suspended' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const unknown = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, {}, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const unknownAndStarted = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'UNKNOWN', provider_schedule_status: 'STARTED' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const unknownAndCancelled = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'UNKNOWN', odds_event_status: 'CANCELLED' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const resumed = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'RESUMED' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: futureTime });
  const timeDenied = resolveScheduleLifecycle({ tennis_event_fingerprint: 'evt' }, { official_schedule_status: 'SCHEDULED' }, { observedAt: '2026-08-03T10:00:00Z', eventTimeDecision: { ...futureTime, allowCapture: false } });
  const checks = {
    officialScheduledAllowed: scheduled.allowCapture === true && scheduled.selected.authority >= 95,
    cancelledBlocked: cancelled.allowCapture === false && cancelled.normalizedStatus === SCHEDULE_STATES.CANCELLED,
    delayedFutureReview: delayed.allowCapture === true && delayed.disposition === CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW,
    conflictSafetyBlock: conflict.allowCapture === false && conflict.statusConflict === true,
    missingStatusForwardCompatible: unknown.allowCapture === true && unknown.disposition === CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW,
    noSettlementAuthority: scheduled.authority.settlement === false && scheduled.authority.automaticSettlement === false,
    unverifiedSourceReviewOnly: scheduled.disposition === CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW && scheduled.confidence === 'LOW' && scheduled.officialScheduleCertified === false && scheduled.selected.provenanceVerified === false,
    unknownCannotMaskStarted: unknownAndStarted.allowCapture === false && unknownAndStarted.normalizedStatus === SCHEDULE_STATES.STARTED,
    unknownCannotMaskCancelled: unknownAndCancelled.allowCapture === false && unknownAndCancelled.normalizedStatus === SCHEDULE_STATES.CANCELLED,
    resumedIsBlocked: resumed.allowCapture === false,
    rejectedCanonicalTimeIsBlocked: timeDenied.allowCapture === false
  };
  return { ok: Object.values(checks).every(Boolean), version: TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION, schemaVersion: TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION, checks };
}

module.exports = {
  TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
  TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION,
  AUDIT14_R2_1E_HARDENING_REVISION,
  SCHEDULE_STATES,
  CAPTURE_DISPOSITIONS,
  TRANSITION_TYPES,
  SOURCE_AUTHORITY,
  normalizeStatus,
  collectScheduleCandidates,
  resolveScheduleLifecycle,
  toGateBlockDecision,
  ensureSchema,
  recordScheduleReceipt,
  buildCaptureToken,
  assertCaptureTokenStable,
  verifyReceiptChain,
  schemaHealth,
  buildScheduleHealthReport,
  selfCheck
};
