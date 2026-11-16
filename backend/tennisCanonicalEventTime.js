'use strict';

const crypto = require('crypto');

const TENNIS_CANONICAL_EVENT_TIME_VERSION = 'TENNIS_CANONICAL_EVENT_TIME_CONTRACT_V1_PATCH33';
const TENNIS_EVENT_TIME_LEDGER_SCHEMA_VERSION = 'TENNIS_EVENT_TIME_LEDGER_SCHEMA_V1_PATCH33';
const DEFAULT_TIME_ZONE = 'Europe/Rome';
const AGREEMENT_TOLERANCE_MS = 2 * 60 * 1000;
const MATERIAL_CONFLICT_MS = 15 * 60 * 1000;

const QUALITY_STATES = Object.freeze({
  CERTIFIED_HIGH: 'CERTIFIED_HIGH',
  CERTIFIED_MEDIUM: 'CERTIFIED_MEDIUM',
  REVIEW_MINOR_VARIANCE: 'REVIEW_MINOR_VARIANCE',
  REVIEW_PROVIDER_CONFLICT: 'REVIEW_PROVIDER_CONFLICT',
  BLOCK_UNRESOLVED: 'BLOCK_UNRESOLVED',
  BLOCK_DST_AMBIGUOUS: 'BLOCK_DST_AMBIGUOUS',
  BLOCK_DST_NONEXISTENT: 'BLOCK_DST_NONEXISTENT'
});

const REVISION_TYPES = Object.freeze({
  INITIAL: 'INITIAL',
  UNCHANGED: 'UNCHANGED',
  RESCHEDULED_EARLIER: 'RESCHEDULED_EARLIER',
  RESCHEDULED_LATER: 'RESCHEDULED_LATER',
  SOURCE_CONFLICT: 'SOURCE_CONFLICT',
  UNRESOLVED: 'UNRESOLVED'
});

const SOURCE_AUTHORITY = Object.freeze({
  OFFICIAL_SCHEDULE: 100,
  PRIMARY_EVENT_PROVIDER: 85,
  ODDS_PROVIDER: 75,
  APPLICATION_CANONICAL: 60,
  LOCAL_DISPLAY: 45,
  LEGACY_FALLBACK: 30
});

function text(value) { return String(value == null ? '' : value).trim(); }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function explicitOffset(raw) { return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text(raw)) || /^\d{10,13}$/.test(text(raw)); }
function iso(epochMs) { return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null; }

function parseWallClock(value) {
  const raw = text(value);
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (m) return { year:+m[1], month:+m[2], day:+m[3], hour:+m[4], minute:+m[5], second:+(m[6]||0), millisecond:+String(m[7]||'0').padEnd(3,'0') };
  m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:,)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return { year:+m[3], month:+m[2], day:+m[1], hour:+m[4], minute:+m[5], second:+(m[6]||0), millisecond:0 };
  return null;
}

function partsInZone(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  });
  const map = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { year:map.year, month:map.month, day:map.day, hour:map.hour, minute:map.minute, second:map.second };
}

function sameWall(parts, observed) {
  return observed.year===parts.year && observed.month===parts.month && observed.day===parts.day && observed.hour===parts.hour && observed.minute===parts.minute && observed.second===parts.second;
}

function resolveWallClockCandidates(parts, timeZone) {
  const desiredUtc = Date.UTC(parts.year, parts.month-1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond||0);
  const matches = [];
  // Covers all practical IANA offsets and detects both folds during DST fallback.
  for (let offsetMinutes=-14*60; offsetMinutes<=14*60; offsetMinutes+=15) {
    const candidate = desiredUtc - offsetMinutes*60000;
    let observed;
    try { observed = partsInZone(candidate, timeZone); } catch (_) { return { validTimeZone:false, epochs:[], offsets:[] }; }
    if (sameWall(parts, observed)) matches.push({ epochMs:candidate, offsetMinutes });
  }
  const unique = [...new Map(matches.map(item => [item.epochMs, item])).values()].sort((a,b)=>a.epochMs-b.epochMs);
  return { validTimeZone:true, epochs:unique.map(x=>x.epochMs), offsets:unique.map(x=>x.offsetMinutes) };
}

function parseTime(value, options={}) {
  const raw = text(value);
  const timeZone = text(options.timeZone || DEFAULT_TIME_ZONE) || DEFAULT_TIME_ZONE;
  if (!raw) return { raw:null, parseable:false, epochMs:null, timeZone, explicitTimezone:false, mode:'EMPTY', dstStatus:'NOT_APPLICABLE', candidates:[] };
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw); const epochMs = raw.length<=10 ? n*1000 : n;
    return { raw, parseable:Number.isFinite(epochMs), epochMs, timeZone:'UTC', explicitTimezone:true, mode:'EPOCH', dstStatus:'NOT_APPLICABLE', candidates:Number.isFinite(epochMs)?[epochMs]:[] };
  }
  if (explicitOffset(raw)) {
    const epochMs = Date.parse(raw);
    return { raw, parseable:Number.isFinite(epochMs), epochMs:Number.isFinite(epochMs)?epochMs:null, timeZone:'EXPLICIT', explicitTimezone:true, mode:'EXPLICIT_OFFSET', dstStatus:'NOT_APPLICABLE', candidates:Number.isFinite(epochMs)?[epochMs]:[] };
  }
  const parts = parseWallClock(raw);
  if (!parts) return { raw, parseable:false, epochMs:null, timeZone, explicitTimezone:false, mode:'UNSUPPORTED_LOCAL_FORMAT', dstStatus:'UNRESOLVED', candidates:[] };
  const resolved = resolveWallClockCandidates(parts, timeZone);
  if (!resolved.validTimeZone) return { raw, parseable:false, epochMs:null, timeZone, explicitTimezone:false, mode:'INVALID_TIMEZONE', dstStatus:'UNRESOLVED', candidates:[] };
  if (resolved.epochs.length===0) return { raw, parseable:false, epochMs:null, timeZone, explicitTimezone:false, mode:'LOCAL_WALL_CLOCK', dstStatus:'NONEXISTENT', candidates:[] };
  if (resolved.epochs.length>1) return { raw, parseable:false, epochMs:null, timeZone, explicitTimezone:false, mode:'LOCAL_WALL_CLOCK', dstStatus:'AMBIGUOUS', candidates:resolved.epochs, offsets:resolved.offsets };
  return { raw, parseable:true, epochMs:resolved.epochs[0], timeZone, explicitTimezone:false, mode:'LOCAL_WALL_CLOCK', dstStatus:'UNAMBIGUOUS', candidates:resolved.epochs, offsets:resolved.offsets };
}

function first(...values) { return values.map(text).find(Boolean) || null; }
function sourceId(row={}, rawBet={}) {
  return first(rawBet.event_time_source_id, row.event_time_source_id, rawBet.provider_name, row.provider_name, rawBet.bookmaker, row.bookmaker, rawBet.reference_market_source, row.reference_market_source, rawBet.provider_event_id, row.provider_event_id, 'UNKNOWN');
}
function sourceTimezone(row={}, rawBet={}, fallback=DEFAULT_TIME_ZONE) {
  return first(rawBet.event_time_timezone, row.event_time_timezone, rawBet.provider_timezone, row.provider_timezone, rawBet.tournament_timezone, row.tournament_timezone, process.env.TENNIS_LOCAL_TIME_ZONE, fallback) || fallback;
}

function candidateDefinitions(row={}, rawBet={}) {
  return [
    ['OFFICIAL_SCHEDULE','official_match_start_at', first(rawBet.official_match_start_at,row.official_match_start_at)],
    ['OFFICIAL_SCHEDULE','official_event_start_at', first(rawBet.official_event_start_at,row.official_event_start_at)],
    ['OFFICIAL_SCHEDULE','official_commence_time', first(rawBet.official_commence_time,row.official_commence_time)],
    ['PRIMARY_EVENT_PROVIDER','provider_match_start_at', first(rawBet.provider_match_start_at,row.provider_match_start_at)],
    ['PRIMARY_EVENT_PROVIDER','provider_start_time', first(rawBet.provider_start_time,row.provider_start_time)],
    ['ODDS_PROVIDER','commence_time', first(rawBet.commence_time,row.commence_time)],
    ['ODDS_PROVIDER','start_time', first(rawBet.start_time,rawBet.startTime,row.start_time,row.startTime)],
    ['APPLICATION_CANONICAL','canonical_match_datetime', first(rawBet.canonical_match_datetime,row.canonical_match_datetime)],
    ['LOCAL_DISPLAY','match_date', first(rawBet.match_date,row.match_date)],
    ['LOCAL_DISPLAY','date', first(rawBet.date,row.date)]
  ];
}

function collectTimeCandidates(row={}, rawBet={}, options={}) {
  const timezone = sourceTimezone(row,rawBet,options.defaultTimeZone||DEFAULT_TIME_ZONE);
  const sid = sourceId(row,rawBet);
  const seen = new Set(); const candidates=[];
  for (const [kind, field, raw] of candidateDefinitions(row,rawBet)) {
    if (!raw) continue;
    const key = `${kind}|${field}|${raw}`; if (seen.has(key)) continue; seen.add(key);
    const parsed = parseTime(raw,{timeZone:timezone});
    candidates.push({
      sourceKind:kind, sourceId:sid, sourceField:field, rawTime:raw, sourceTimezone:parsed.timeZone,
      authority:SOURCE_AUTHORITY[kind]||0, parsed, epochMs:parsed.epochMs, utc:iso(parsed.epochMs),
      parseable:parsed.parseable, explicitTimezone:parsed.explicitTimezone, dstStatus:parsed.dstStatus
    });
  }
  return candidates;
}

function chooseCandidate(candidates=[]) {
  const parseable = candidates.filter(c=>c.parseable).sort((a,b)=>b.authority-a.authority || Number(b.explicitTimezone)-Number(a.explicitTimezone) || a.sourceField.localeCompare(b.sourceField));
  return parseable[0] || null;
}

function resolveCanonicalEventTime(row={}, rawBet={}, options={}) {
  const observedAt = text(options.observedAt || new Date().toISOString());
  const eventFingerprint = first(row.tennis_event_fingerprint,rawBet.tennis_event_fingerprint,row.event_fingerprint,rawBet.event_fingerprint);
  const providerEventId = first(row.provider_event_id,rawBet.provider_event_id,rawBet.event_id,row.event_id);
  const candidates = collectTimeCandidates(row,rawBet,options);
  const chosen = chooseCandidate(candidates);
  const ambiguous = candidates.filter(c=>c.dstStatus==='AMBIGUOUS');
  const nonexistent = candidates.filter(c=>c.dstStatus==='NONEXISTENT');
  const parseable = candidates.filter(c=>c.parseable);
  let qualityStatus = QUALITY_STATES.BLOCK_UNRESOLVED;
  let allowCapture = false;
  let confidence = 'BLOCKED';
  let conflictMs = null;
  let safetyEpochMs = null;
  const reasonCodes=[];

  if (!chosen) {
    if (ambiguous.length) { qualityStatus=QUALITY_STATES.BLOCK_DST_AMBIGUOUS; reasonCodes.push('DST_AMBIGUOUS_LOCAL_TIME'); }
    else if (nonexistent.length) { qualityStatus=QUALITY_STATES.BLOCK_DST_NONEXISTENT; reasonCodes.push('DST_NONEXISTENT_LOCAL_TIME'); }
    else reasonCodes.push('EVENT_TIME_NOT_PARSEABLE');
  } else {
    allowCapture = true;
    confidence = chosen.authority>=85 || chosen.explicitTimezone ? 'HIGH' : 'MEDIUM';
    qualityStatus = confidence==='HIGH' ? QUALITY_STATES.CERTIFIED_HIGH : QUALITY_STATES.CERTIFIED_MEDIUM;
    const diffs = parseable.map(c=>Math.abs(c.epochMs-chosen.epochMs));
    conflictMs = diffs.length ? Math.max(...diffs) : 0;
    safetyEpochMs = chosen.epochMs;
    if (conflictMs > MATERIAL_CONFLICT_MS) {
      qualityStatus = QUALITY_STATES.REVIEW_PROVIDER_CONFLICT;
      confidence = 'MEDIUM';
      safetyEpochMs = Math.min(...parseable.map(c=>c.epochMs));
      reasonCodes.push('MATERIAL_PROVIDER_TIME_CONFLICT','CONSERVATIVE_EARLIEST_TIME_USED_FOR_CAPTURE');
    } else if (conflictMs > AGREEMENT_TOLERANCE_MS) {
      qualityStatus = QUALITY_STATES.REVIEW_MINOR_VARIANCE;
      confidence = 'MEDIUM';
      safetyEpochMs = Math.min(...parseable.map(c=>c.epochMs));
      reasonCodes.push('MINOR_PROVIDER_TIME_VARIANCE');
    }
    if (!chosen.explicitTimezone && chosen.parsed.mode==='LOCAL_WALL_CLOCK') reasonCodes.push('LOCAL_TIMEZONE_PROVENANCE_APPLIED');
  }

  const canonicalEpochMs = chosen?.epochMs ?? null;
  const payload = {
    version:TENNIS_CANONICAL_EVENT_TIME_VERSION, observedAt, eventFingerprint, providerEventId,
    allowCapture, qualityStatus, confidence, reasonCodes:[...new Set(reasonCodes)],
    selected: chosen ? {
      sourceKind:chosen.sourceKind, sourceId:chosen.sourceId, sourceField:chosen.sourceField,
      rawTime:chosen.rawTime, sourceTimezone:chosen.sourceTimezone, authority:chosen.authority,
      parseMode:chosen.parsed.mode, explicitTimezone:chosen.explicitTimezone, dstStatus:chosen.dstStatus
    } : null,
    canonicalStartEpochMs:canonicalEpochMs, canonicalStartAtUtc:iso(canonicalEpochMs),
    safetyStartEpochMs:safetyEpochMs, safetyStartAtUtc:iso(safetyEpochMs), conflictMs,
    candidates:candidates.map(c=>({sourceKind:c.sourceKind,sourceId:c.sourceId,sourceField:c.sourceField,rawTime:c.rawTime,sourceTimezone:c.sourceTimezone,authority:c.authority,parseable:c.parseable,epochMs:c.epochMs,utc:c.utc,parseMode:c.parsed.mode,explicitTimezone:c.explicitTimezone,dstStatus:c.dstStatus,candidateEpochs:c.parsed.candidates||[]})),
    authority:{captureTime:true,productionProbability:false,qualityGate:false,stake:false,settlement:false,automaticRescheduleOverride:false},
    policy:{agreementToleranceMs:AGREEMENT_TOLERANCE_MS,materialConflictMs:MATERIAL_CONFLICT_MS,conflictSafetyRule:'EARLIEST_CREDIBLE_TIME'}
  };
  payload.observationHash = sha(stableJson({...payload,observationHash:undefined}));
  return payload;
}

function toPrematchGateInput(row={}, decision={}) {
  return { ...row, canonical_match_datetime: decision.safetyStartAtUtc || decision.canonicalStartAtUtc || row.canonical_match_datetime || row.match_date };
}

function toGateBlockDecision(decision={}, captureAt=new Date().toISOString()) {
  return {
    version:'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3',
    status:'BLOCK_MATCH_START_UNRESOLVED', allowCapture:false, certifiedPrematch:false,
    reasonCodes:[...(decision.reasonCodes||[]),'PATCH33_CANONICAL_EVENT_TIME_CONTRACT_BLOCK'],
    reason:[...(decision.reasonCodes||[]),'PATCH33_CANONICAL_EVENT_TIME_CONTRACT_BLOCK'].join('|'),
    checkedAt:captureAt, captureAt, matchStartAt:decision.canonicalStartAtUtc||null, leadTimeMs:null, minLeadTimeMs:0,
    timeZone:decision.selected?.sourceTimezone||DEFAULT_TIME_ZONE,
    captureTime:parseTime(captureAt,{timeZone:'UTC'}), matchStart:parseTime(decision.canonicalStartAtUtc,{timeZone:'UTC'}),
    snapshotValidationStatus:'INCOMPLETE', payloadCompleteness:{complete:false,missing:['CANONICAL_EVENT_TIME_CONTRACT_BLOCK']},
    eventTimeContract:decision,
    authority:{productionProbability:false,qualityGate:false,stake:false,settlement:false,captureCommit:true}
  };
}

function tableExists(db,name) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function columns(db,table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name)); }
function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tennis_event_time_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id TEXT NOT NULL UNIQUE,
    event_fingerprint TEXT,
    provider_event_id TEXT,
    observed_at TEXT NOT NULL,
    capture_outcome TEXT NOT NULL,
    source_kind TEXT,
    source_id TEXT,
    source_field TEXT,
    source_timezone TEXT,
    raw_time TEXT,
    canonical_start_at_utc TEXT,
    canonical_start_epoch_ms INTEGER,
    safety_start_at_utc TEXT,
    safety_start_epoch_ms INTEGER,
    confidence TEXT NOT NULL,
    quality_status TEXT NOT NULL,
    revision_type TEXT NOT NULL,
    conflict_ms INTEGER,
    dst_status TEXT,
    candidates_json TEXT NOT NULL,
    previous_revision_hash TEXT,
    revision_hash TEXT NOT NULL UNIQUE,
    observation_hash TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tennis_event_time_event ON tennis_event_time_revisions(event_fingerprint,id);
  CREATE INDEX IF NOT EXISTS idx_tennis_event_time_provider ON tennis_event_time_revisions(source_id,quality_status);
  CREATE INDEX IF NOT EXISTS idx_tennis_event_time_observed ON tennis_event_time_revisions(observed_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_event_time_observation_outcome ON tennis_event_time_revisions(observation_hash,capture_outcome);
  CREATE TRIGGER IF NOT EXISTS trg_tennis_event_time_no_update BEFORE UPDATE ON tennis_event_time_revisions BEGIN SELECT RAISE(ABORT,'TENNIS_EVENT_TIME_LEDGER_APPEND_ONLY'); END;
  CREATE TRIGGER IF NOT EXISTS trg_tennis_event_time_no_delete BEFORE DELETE ON tennis_event_time_revisions BEGIN SELECT RAISE(ABORT,'TENNIS_EVENT_TIME_LEDGER_APPEND_ONLY'); END;`);
  return { table:'tennis_event_time_revisions', columns:[...columns(db,'tennis_event_time_revisions')] };
}

function latestRevision(db,eventFingerprint) {
  if (!eventFingerprint || !tableExists(db,'tennis_event_time_revisions')) return null;
  return db.prepare('SELECT * FROM tennis_event_time_revisions WHERE event_fingerprint=? ORDER BY id DESC LIMIT 1').get(eventFingerprint)||null;
}
function inferRevisionType(previous,decision) {
  if (!decision.allowCapture) return REVISION_TYPES.UNRESOLVED;
  if (decision.qualityStatus===QUALITY_STATES.REVIEW_PROVIDER_CONFLICT) return REVISION_TYPES.SOURCE_CONFLICT;
  if (!previous || !Number.isFinite(Number(previous.canonical_start_epoch_ms))) return REVISION_TYPES.INITIAL;
  const current=Number(decision.canonicalStartEpochMs), old=Number(previous.canonical_start_epoch_ms);
  if (current===old) return REVISION_TYPES.UNCHANGED;
  return current<old ? REVISION_TYPES.RESCHEDULED_EARLIER : REVISION_TYPES.RESCHEDULED_LATER;
}

function recordEventTimeRevision(db, decision={}, options={}) {
  ensureSchema(db);
  const outcome = text(options.captureOutcome || 'OBSERVED').toUpperCase();
  const existing = db.prepare('SELECT * FROM tennis_event_time_revisions WHERE observation_hash=? AND capture_outcome=? LIMIT 1').get(decision.observationHash,outcome);
  if (existing) return { inserted:false, duplicate:true, revision:existing };
  const previous = latestRevision(db,decision.eventFingerprint);
  const revisionType = inferRevisionType(previous,decision);
  const revisionId = `TET33_${crypto.randomUUID()}`;
  const previousHash = previous?.revision_hash || null;
  const selected=decision.selected||{};
  const selectedMaterial={
    sourceKind:selected.sourceKind||null,sourceId:selected.sourceId||null,sourceField:selected.sourceField||null,
    sourceTimezone:selected.sourceTimezone||null,rawTime:selected.rawTime||null
  };
  const material = {
    revisionId,eventFingerprint:decision.eventFingerprint,providerEventId:decision.providerEventId,observedAt:decision.observedAt,captureOutcome:outcome,
    selected:selectedMaterial,canonicalStartAtUtc:decision.canonicalStartAtUtc,canonicalStartEpochMs:decision.canonicalStartEpochMs,
    safetyStartAtUtc:decision.safetyStartAtUtc,safetyStartEpochMs:decision.safetyStartEpochMs,confidence:decision.confidence,qualityStatus:decision.qualityStatus,
    revisionType,conflictMs:decision.conflictMs,candidates:decision.candidates,observationHash:decision.observationHash,contractVersion:TENNIS_CANONICAL_EVENT_TIME_VERSION
  };
  const revisionHash=sha(`${previousHash||'GENESIS'}|${stableJson(material)}`);
  db.prepare(`INSERT INTO tennis_event_time_revisions (
    revision_id,event_fingerprint,provider_event_id,observed_at,capture_outcome,source_kind,source_id,source_field,source_timezone,raw_time,
    canonical_start_at_utc,canonical_start_epoch_ms,safety_start_at_utc,safety_start_epoch_ms,confidence,quality_status,revision_type,conflict_ms,dst_status,
    candidates_json,previous_revision_hash,revision_hash,observation_hash,contract_version,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    revisionId,decision.eventFingerprint,decision.providerEventId,decision.observedAt,outcome,selected.sourceKind||null,selected.sourceId||null,selected.sourceField||null,selected.sourceTimezone||null,selected.rawTime||null,
    decision.canonicalStartAtUtc,numberOrNull(decision.canonicalStartEpochMs),decision.safetyStartAtUtc,numberOrNull(decision.safetyStartEpochMs),decision.confidence,decision.qualityStatus,revisionType,numberOrNull(decision.conflictMs),selected.dstStatus||null,
    JSON.stringify(decision.candidates||[]),previousHash,revisionHash,decision.observationHash,TENNIS_CANONICAL_EVENT_TIME_VERSION,decision.observedAt
  );
  return { inserted:true, duplicate:false, revision:{ revision_id:revisionId, revision_hash:revisionHash, revision_type:revisionType, capture_outcome:outcome } };
}

function verifyEventChain(db,eventFingerprint=null) {
  if (!tableExists(db,'tennis_event_time_revisions')) return { healthy:false,checked:0,reason:'TABLE_MISSING' };
  const rows = eventFingerprint
    ? db.prepare('SELECT * FROM tennis_event_time_revisions WHERE event_fingerprint=? ORDER BY id').all(eventFingerprint)
    : db.prepare('SELECT * FROM tennis_event_time_revisions ORDER BY event_fingerprint,id').all();
  const previousByEvent=new Map(); let checked=0;
  for (const row of rows) {
    const key=row.event_fingerprint||'__NO_EVENT__'; const previousHash=previousByEvent.get(key)||null;
    const selected={sourceKind:row.source_kind,sourceId:row.source_id,sourceField:row.source_field,sourceTimezone:row.source_timezone,rawTime:row.raw_time};
    const material={revisionId:row.revision_id,eventFingerprint:row.event_fingerprint,providerEventId:row.provider_event_id,observedAt:row.observed_at,captureOutcome:row.capture_outcome,selected,canonicalStartAtUtc:row.canonical_start_at_utc,canonicalStartEpochMs:row.canonical_start_epoch_ms,safetyStartAtUtc:row.safety_start_at_utc,safetyStartEpochMs:row.safety_start_epoch_ms,confidence:row.confidence,qualityStatus:row.quality_status,revisionType:row.revision_type,conflictMs:row.conflict_ms,candidates:JSON.parse(row.candidates_json||'[]'),observationHash:row.observation_hash,contractVersion:row.contract_version};
    const expected=sha(`${previousHash||'GENESIS'}|${stableJson(material)}`);
    if ((row.previous_revision_hash||null)!==previousHash || row.revision_hash!==expected) return {healthy:false,checked,brokenAt:row.id,eventFingerprint:row.event_fingerprint,reason:'HASH_CHAIN_MISMATCH'};
    previousByEvent.set(key,row.revision_hash); checked++;
  }
  return {healthy:true,checked,events:previousByEvent.size};
}

function schemaHealth(db) {
  if (!tableExists(db,'tennis_event_time_revisions')) return {healthy:false,tableExists:false,appendOnly:false,missingColumns:['ALL']};
  const required=['revision_id','event_fingerprint','observed_at','capture_outcome','source_kind','source_timezone','canonical_start_at_utc','safety_start_at_utc','confidence','quality_status','revision_type','previous_revision_hash','revision_hash','observation_hash','contract_version'];
  const present=columns(db,'tennis_event_time_revisions'); const missingColumns=required.filter(x=>!present.has(x));
  const triggers=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tennis_event_time_revisions'").all().map(r=>r.name));
  const appendOnly=triggers.has('trg_tennis_event_time_no_update')&&triggers.has('trg_tennis_event_time_no_delete');
  return {healthy:missingColumns.length===0&&appendOnly,tableExists:true,appendOnly,missingColumns};
}

function buildProviderTimeQualityReport(db,options={}) {
  const schema=schemaHealth(db); const chain=schema.tableExists?verifyEventChain(db):{healthy:false,checked:0,reason:'TABLE_MISSING'};
  const total=schema.tableExists?Number(db.prepare('SELECT COUNT(*) n FROM tennis_event_time_revisions').get().n||0):0;
  const counts=schema.tableExists?db.prepare(`SELECT
    SUM(CASE WHEN quality_status='CERTIFIED_HIGH' THEN 1 ELSE 0 END) certifiedHigh,
    SUM(CASE WHEN quality_status='CERTIFIED_MEDIUM' THEN 1 ELSE 0 END) certifiedMedium,
    SUM(CASE WHEN quality_status='REVIEW_PROVIDER_CONFLICT' THEN 1 ELSE 0 END) conflicts,
    SUM(CASE WHEN quality_status LIKE 'BLOCK_%' THEN 1 ELSE 0 END) blocked,
    SUM(CASE WHEN revision_type='RESCHEDULED_EARLIER' THEN 1 ELSE 0 END) rescheduledEarlier,
    SUM(CASE WHEN revision_type='RESCHEDULED_LATER' THEN 1 ELSE 0 END) rescheduledLater
    FROM tennis_event_time_revisions`).get():{};
  const providers=schema.tableExists?db.prepare(`SELECT COALESCE(source_id,'UNKNOWN') provider,COUNT(*) total,
    SUM(CASE WHEN quality_status='REVIEW_PROVIDER_CONFLICT' THEN 1 ELSE 0 END) conflicts,
    SUM(CASE WHEN quality_status LIKE 'BLOCK_%' THEN 1 ELSE 0 END) blocked,
    ROUND(AVG(CASE WHEN conflict_ms IS NOT NULL THEN conflict_ms END),0) avgConflictMs
    FROM tennis_event_time_revisions GROUP BY COALESCE(source_id,'UNKNOWN') ORDER BY total DESC,provider LIMIT 20`).all():[];
  const recent=schema.tableExists?db.prepare('SELECT revision_id,event_fingerprint,observed_at,capture_outcome,source_kind,source_id,source_field,source_timezone,canonical_start_at_utc,safety_start_at_utc,confidence,quality_status,revision_type,conflict_ms FROM tennis_event_time_revisions ORDER BY id DESC LIMIT ?').all(Math.max(1,Math.min(200,Number(options.limit||30)))):[];
  const self=selfCheck(); const healthy=schema.healthy&&chain.healthy&&self.ok;
  return {success:healthy,healthy,status:healthy?(Number(counts.conflicts||0)>0||Number(counts.blocked||0)>0?'WARN':'OK'):'ERROR',version:TENNIS_CANONICAL_EVENT_TIME_VERSION,schemaVersion:TENNIS_EVENT_TIME_LEDGER_SCHEMA_VERSION,total,counts:{certifiedHigh:Number(counts.certifiedHigh||0),certifiedMedium:Number(counts.certifiedMedium||0),conflicts:Number(counts.conflicts||0),blocked:Number(counts.blocked||0),rescheduledEarlier:Number(counts.rescheduledEarlier||0),rescheduledLater:Number(counts.rescheduledLater||0)},providers,recent,schema,chain,selfCheck:self,forwardOnly:true,noHistoricalBackfill:true,automaticGateOverride:false,conflictSafetyRule:'EARLIEST_CREDIBLE_TIME',authority:{captureTime:true,modelProbability:false,qualityGate:false,stake:false,settlement:false}};
}

function selfCheck() {
  const summer=parseTime('2026-08-03T21:00:00',{timeZone:'Europe/Rome'});
  const fall=parseTime('2026-10-25T02:30:00',{timeZone:'Europe/Rome'});
  const spring=parseTime('2026-03-29T02:30:00',{timeZone:'Europe/Rome'});
  const explicit=parseTime('2026-08-03T19:00:00Z',{timeZone:'Europe/Rome'});
  const conflict=resolveCanonicalEventTime({canonical_match_datetime:'2026-08-03T21:00:00',provider_event_id:'evt'}, {commence_time:'2026-08-03T18:30:00Z',event_time_source_id:'ODDS'}, {observedAt:'2026-08-03T10:00:00Z'});
  const normal=resolveCanonicalEventTime({canonical_match_datetime:'2026-08-03T21:00:00',provider_event_id:'evt'}, {}, {observedAt:'2026-08-03T10:00:00Z'});
  const checks={
    romeSummerResolved:summer.parseable&&summer.epochMs===Date.parse('2026-08-03T19:00:00Z'),
    dstFallbackAmbiguous:!fall.parseable&&fall.dstStatus==='AMBIGUOUS'&&fall.candidates.length===2,
    dstSpringNonexistent:!spring.parseable&&spring.dstStatus==='NONEXISTENT',
    explicitUtcPreserved:explicit.parseable&&explicit.epochMs===Date.parse('2026-08-03T19:00:00Z'),
    localCanonicalAllowed:normal.allowCapture===true&&normal.canonicalStartAtUtc==='2026-08-03T19:00:00.000Z',
    conflictUsesEarliest:conflict.qualityStatus===QUALITY_STATES.REVIEW_PROVIDER_CONFLICT&&conflict.safetyStartEpochMs===Math.min(...conflict.candidates.filter(x=>x.parseable).map(x=>x.epochMs)),
    noModelAuthority:normal.authority.productionProbability===false&&normal.authority.stake===false
  };
  return {ok:Object.values(checks).every(Boolean),version:TENNIS_CANONICAL_EVENT_TIME_VERSION,checks};
}

module.exports={
  TENNIS_CANONICAL_EVENT_TIME_VERSION,TENNIS_EVENT_TIME_LEDGER_SCHEMA_VERSION,DEFAULT_TIME_ZONE,
  AGREEMENT_TOLERANCE_MS,MATERIAL_CONFLICT_MS,QUALITY_STATES,REVISION_TYPES,SOURCE_AUTHORITY,
  parseTime,collectTimeCandidates,resolveCanonicalEventTime,toPrematchGateInput,toGateBlockDecision,
  ensureSchema,recordEventTimeRevision,verifyEventChain,schemaHealth,buildProviderTimeQualityReport,selfCheck
};
