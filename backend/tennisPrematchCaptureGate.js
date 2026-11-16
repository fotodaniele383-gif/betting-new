'use strict';

const snapshots = require('./tennisPredictionSnapshots');

const TENNIS_PREMATCH_CAPTURE_GATE_VERSION = 'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3';
const DEFAULT_TIME_ZONE = 'Europe/Rome';

const GATE_STATUSES = Object.freeze({
  ALLOW_CERTIFIED_PREMATCH: 'ALLOW_CERTIFIED_PREMATCH',
  BLOCK_REQUIRED_FIELDS: 'BLOCK_REQUIRED_FIELDS',
  BLOCK_MATCH_START_UNRESOLVED: 'BLOCK_MATCH_START_UNRESOLVED',
  BLOCK_CAPTURE_TIME_UNRESOLVED: 'BLOCK_CAPTURE_TIME_UNRESOLVED',
  BLOCK_CAPTURE_AT_OR_AFTER_START: 'BLOCK_CAPTURE_AT_OR_AFTER_START'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function pad(value, size = 2) { return String(value).padStart(size, '0'); }
function explicitTimezone(value) { return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text(value)) || /^\d{10,13}$/.test(text(value)); }

function datePartsInZone(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(epochMs))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  return {
    year: values.year, month: values.month, day: values.day,
    hour: values.hour, minute: values.minute, second: values.second
  };
}

function parseWallClock(value) {
  const raw = text(value);
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (match) {
    return {
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
      hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0),
      millisecond: Number(String(match[7] || '0').padEnd(3, '0'))
    };
  }
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,)?\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return {
      year: Number(match[3]), month: Number(match[2]), day: Number(match[1]),
      hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0), millisecond: 0
    };
  }
  return null;
}

function wallClockToEpoch(parts, timeZone) {
  const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond || 0);
  let candidate = desiredUtc;
  for (let i = 0; i < 4; i += 1) {
    const observed = datePartsInZone(candidate, timeZone);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second, parts.millisecond || 0);
    const delta = desiredUtc - observedUtc;
    candidate += delta;
    if (delta === 0) break;
  }
  const verified = datePartsInZone(candidate, timeZone);
  const valid = verified.year === parts.year && verified.month === parts.month && verified.day === parts.day
    && verified.hour === parts.hour && verified.minute === parts.minute && verified.second === parts.second;
  return valid ? candidate : null;
}

function parseTimestamp(value, options = {}) {
  const raw = text(value);
  const timeZone = text(options.timeZone || process.env.TENNIS_LOCAL_TIME_ZONE || DEFAULT_TIME_ZONE) || DEFAULT_TIME_ZONE;
  if (!raw) return { raw: null, epochMs: null, parseable: false, explicitTimezone: false, timeZone, mode: 'EMPTY' };
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return { raw, epochMs: raw.length <= 10 ? numeric * 1000 : numeric, parseable: true, explicitTimezone: true, timeZone: 'UTC', mode: 'EPOCH' };
  }
  if (explicitTimezone(raw)) {
    const epochMs = Date.parse(raw);
    return { raw, epochMs: Number.isFinite(epochMs) ? epochMs : null, parseable: Number.isFinite(epochMs), explicitTimezone: true, timeZone: 'EXPLICIT', mode: 'EXPLICIT_OFFSET' };
  }
  const wall = parseWallClock(raw);
  if (!wall) return { raw, epochMs: null, parseable: false, explicitTimezone: false, timeZone, mode: 'UNSUPPORTED_LOCAL_FORMAT' };
  let epochMs = null;
  try { epochMs = wallClockToEpoch(wall, timeZone); } catch (_) { epochMs = null; }
  return { raw, epochMs, parseable: epochMs != null, explicitTimezone: false, timeZone, mode: 'LOCAL_WALL_CLOCK' };
}

function buildGateDecision(row = {}, options = {}) {
  const checkedAt = text(options.checkedAt || new Date().toISOString());
  const captureAt = text(options.captureAt || checkedAt);
  const timeZone = text(options.timeZone || process.env.TENNIS_LOCAL_TIME_ZONE || DEFAULT_TIME_ZONE) || DEFAULT_TIME_ZONE;
  const minLeadTimeMs = Math.max(0, Number(options.minLeadTimeMs || 0));
  const payload = snapshots.buildSnapshotPayload(row, {
    capturedAt: captureAt,
    registryVersion: options.registryVersion || row.registry_version
  });
  const baseValidation = snapshots.validateSnapshotPayload(payload, { allowLocalTimeComparison: false });
  const captureTime = parseTimestamp(captureAt, { timeZone: 'UTC' });
  const matchStart = parseTimestamp(payload.match_start_at, { timeZone });
  const reasons = [];

  let status = GATE_STATUSES.ALLOW_CERTIFIED_PREMATCH;
  if (Array.isArray(baseValidation.missing) && baseValidation.missing.length) {
    status = GATE_STATUSES.BLOCK_REQUIRED_FIELDS;
    reasons.push(...baseValidation.missing);
  } else if (!matchStart.parseable) {
    status = GATE_STATUSES.BLOCK_MATCH_START_UNRESOLVED;
    reasons.push('MATCH_START_NOT_PARSEABLE');
  } else if (!captureTime.parseable) {
    status = GATE_STATUSES.BLOCK_CAPTURE_TIME_UNRESOLVED;
    reasons.push('CAPTURE_TIME_NOT_PARSEABLE');
  }

  const leadTimeMs = captureTime.parseable && matchStart.parseable ? matchStart.epochMs - captureTime.epochMs : null;
  if (status === GATE_STATUSES.ALLOW_CERTIFIED_PREMATCH && !(leadTimeMs > minLeadTimeMs)) {
    status = GATE_STATUSES.BLOCK_CAPTURE_AT_OR_AFTER_START;
    reasons.push(leadTimeMs === 0 ? 'CAPTURE_AT_MATCH_START' : 'CAPTURE_AFTER_MATCH_START');
  }

  const allowCapture = status === GATE_STATUSES.ALLOW_CERTIFIED_PREMATCH;
  return {
    version: TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
    status,
    allowCapture,
    certifiedPrematch: allowCapture,
    reasonCodes: [...new Set(reasons)],
    reason: [...new Set(reasons)].join('|') || null,
    checkedAt,
    captureAt,
    matchStartAt: payload.match_start_at,
    leadTimeMs,
    minLeadTimeMs,
    timeZone,
    captureTime,
    matchStart,
    snapshotValidationStatus: baseValidation.status,
    payloadCompleteness: {
      complete: !(baseValidation.missing || []).length,
      missing: baseValidation.missing || []
    },
    authority: {
      productionProbability: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      captureCommit: true
    }
  };
}

function assertPrematchCaptureAllowed(row = {}, options = {}) {
  const decision = buildGateDecision(row, options);
  if (!decision.allowCapture) {
    const error = new Error(`PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED:${decision.status}:${decision.reason || 'UNKNOWN'}`);
    error.code = 'PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED';
    error.decision = decision;
    throw error;
  }
  return decision;
}

function selfCheck() {
  const base = {
    id: 999001,
    canonical_match_datetime: '2026-08-02T20:30:00',
    home_team: 'Player A', away_team: 'Player B', league: 'ATP',
    tennis_event_fingerprint: 'event-r3-test', tennis_market_fingerprint: 'market-r3-test',
    prediction: '1', odd: 1.91, estimated_prob: 58.2,
    model_version: 'R3_TEST_MODEL', metric_version: 'R3_TEST_METRIC', engine_version: 'R3_TEST_ENGINE'
  };
  const valid = buildGateDecision(base, { captureAt: '2026-08-02T18:20:00.000Z', checkedAt: '2026-08-02T18:20:00.000Z' });
  const after = buildGateDecision(base, { captureAt: '2026-08-02T18:31:00.000Z', checkedAt: '2026-08-02T18:31:00.000Z' });
  const incomplete = buildGateDecision({ ...base, tennis_market_fingerprint: null }, { captureAt: '2026-08-02T18:20:00.000Z' });
  const winter = parseTimestamp('2026-01-15T20:30:00', { timeZone: 'Europe/Rome' });
  const summer = parseTimestamp('2026-08-02T20:30:00', { timeZone: 'Europe/Rome' });
  const checks = {
    validPrematchAllowed: valid.allowCapture === true && valid.leadTimeMs === 10 * 60 * 1000,
    postStartBlocked: after.status === GATE_STATUSES.BLOCK_CAPTURE_AT_OR_AFTER_START,
    incompleteBlocked: incomplete.status === GATE_STATUSES.BLOCK_REQUIRED_FIELDS,
    romeWinterUtcOffset: winter.epochMs === Date.parse('2026-01-15T19:30:00.000Z'),
    romeSummerUtcOffset: summer.epochMs === Date.parse('2026-08-02T18:30:00.000Z')
  };
  return {
    ok: Object.values(checks).every(Boolean),
    version: TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
    timeZone: DEFAULT_TIME_ZONE,
    checks,
    productionAuthorityChanged: false,
    transactionalCaptureAuthority: true
  };
}

module.exports = {
  TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
  DEFAULT_TIME_ZONE,
  GATE_STATUSES,
  parseTimestamp,
  buildGateDecision,
  assertPrematchCaptureAllowed,
  selfCheck
};
