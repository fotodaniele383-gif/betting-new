'use strict';

/**
 * PATCH 3 - Canonical Tennis Event Identity.
 *
 * Goals:
 * - distinguish rematches and different market selections;
 * - keep the same provider event stable when the scheduled time changes;
 * - tolerate player order inversion and provider changes only when the full
 *   fallback identity (date, tour, tournament and player pair) agrees;
 * - never overwrite a PENDING row when more than one exact identity exists;
 * - expose deterministic, testable fingerprints without using post-match data.
 */

const crypto = require('crypto');
const {
  buildPlayerIdentity,
  isSameMatchPair
} = require('./tennisPlayerIdentity');

const TENNIS_EVENT_IDENTITY_VERSION = 'TENNIS_EVENT_IDENTITY_V1_PATCH_3';
const TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS = Object.freeze([
  'tennis_event_fingerprint',
  'tennis_market_fingerprint',
  'tennis_event_identity_status',
  'tennis_event_identity_reason',
  'tennis_event_identity_confidence',
  'tennis_event_identity_version',
  'canonical_match_datetime',
  'canonical_tournament_key',
  'canonical_player_pair_key'
]);

const EMPTY_PROVIDER_VALUES = new Set([
  '', 'NULL', 'NONE', 'N/A', 'NA', 'UNDEFINED', 'UNKNOWN', '0', '-'
]);

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeToken(value = '') {
  let out = text(value);
  try {
    out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    // Keep original text when Unicode normalization is unavailable.
  }
  return out
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactToken(value = '') {
  return normalizeToken(value).replace(/\s+/g, '_');
}

function hashFingerprint(prefix, parts) {
  const payload = parts.map(value => text(value)).join('|');
  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeProviderEventId(value) {
  const normalized = text(value);
  const upper = normalized.toUpperCase();
  if (!normalized || EMPTY_PROVIDER_VALUES.has(upper)) return '';
  // Legacy code could incorrectly persist a canonical match key in provider_event_id.
  // Such synthetic keys must never receive provider-level authority.
  if (upper.includes('__VS__') || upper.startsWith('TEI3_')) return '';
  return normalized.toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function validDateParts(year, month, day, hour, minute, second) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  if (!Number.isInteger(second) || second < 0 || second > 59) return false;
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second;
}

function buildCanonicalDateResult({ year, month, day, hour = 0, minute = 0, second = 0, source, timezoneKnown = false, raw = '' }) {
  const values = [year, month, day, hour, minute, second].map(Number);
  if (!validDateParts(...values)) {
    return {
      valid: false,
      canonical: '',
      minuteKey: '',
      dayKey: '',
      timezoneKnown: false,
      source: source || 'INVALID',
      raw: text(raw)
    };
  }
  const [y, m, d, h, min, sec] = values;
  const canonical = `${y}-${pad2(m)}-${pad2(d)}T${pad2(h)}:${pad2(min)}:${pad2(sec)}${timezoneKnown ? 'Z' : ''}`;
  return {
    valid: true,
    canonical,
    minuteKey: canonical.slice(0, 16),
    dayKey: canonical.slice(0, 10),
    timezoneKnown,
    source,
    raw: text(raw)
  };
}

function canonicalizeMatchDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    return buildCanonicalDateResult({
      year: Number(iso.slice(0, 4)),
      month: Number(iso.slice(5, 7)),
      day: Number(iso.slice(8, 10)),
      hour: Number(iso.slice(11, 13)),
      minute: Number(iso.slice(14, 16)),
      second: Number(iso.slice(17, 19)),
      source: 'DATE_OBJECT_UTC',
      timezoneKnown: true,
      raw: iso
    });
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return canonicalizeMatchDate(new Date(value));
  }

  const raw = text(value);
  if (!raw) return buildCanonicalDateResult({ source: 'MISSING', raw });

  // Italian/local format used by the application: DD/MM/YYYY, HH:mm:ss
  let match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s*,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return buildCanonicalDateResult({
      year: Number(match[3]),
      month: Number(match[2]),
      day: Number(match[1]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0),
      second: Number(match[6] || 0),
      source: 'LOCAL_DMY',
      timezoneKnown: false,
      raw
    });
  }

  // ISO-like local format without offset.
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return buildCanonicalDateResult({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0),
      second: Number(match[6] || 0),
      source: 'LOCAL_YMD',
      timezoneKnown: false,
      raw
    });
  }

  // RFC3339/ISO with explicit Z or UTC offset. Date.parse is safe here because
  // the timezone is present and the canonical result is UTC.
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return canonicalizeMatchDate(parsed);
  }

  return buildCanonicalDateResult({ source: 'UNPARSEABLE', raw });
}

function resolvePlayerOne(row = {}) {
  return row.home || row.home_team || row.player1 || row.playerA || row.provider_home_team || row.providerHomeTeam || '';
}

function resolvePlayerTwo(row = {}) {
  return row.away || row.away_team || row.player2 || row.playerB || row.provider_away_team || row.providerAwayTeam || '';
}

function buildCanonicalPlayerPair(row = {}) {
  const playerOne = resolvePlayerOne(row);
  const playerTwo = resolvePlayerTwo(row);
  const a = buildPlayerIdentity(playerOne);
  const b = buildPlayerIdentity(playerTwo);
  const keys = [a.key, b.key].filter(Boolean).sort();
  return {
    valid: keys.length === 2 && keys[0] !== keys[1],
    key: keys.join('__VS__'),
    playerOne,
    playerTwo,
    playerOneIdentity: a,
    playerTwoIdentity: b
  };
}

function inferTour(row = {}) {
  const source = normalizeToken([
    row.tour_type,
    row.tourType,
    row.tour,
    row.strategy_tag,
    row.strategyTag,
    row.league,
    row.tournament_category,
    row.tournamentCategory
  ].filter(Boolean).join(' '));
  if (/\bWTA\b|\bWOMEN\b|\bWOMENS\b/.test(source)) return 'WTA';
  if (/\bATP\b|\bMEN\b|\bMENS\b/.test(source)) return 'ATP';
  return 'UNKNOWN';
}

function normalizeTournament(row = {}) {
  const raw = row.tournament_canonical_name || row.tournamentCanonicalName ||
    row.tournament_name || row.tournamentName || row.tournament || row.league || '';
  const normalized = normalizeToken(raw)
    .replace(/^\s*(ATP|WTA)\s+/, '')
    .replace(/\b(MEN|MENS|WOMEN|WOMENS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'UNKNOWN_TOURNAMENT';
}

function normalizeMarketType(row = {}) {
  const raw = normalizeToken(row.market_type || row.marketType || row.bet_market || row.market || '');
  const prediction = normalizeToken(row.prediction || row.pick || '');
  if (raw.includes('TOTAL') || prediction.includes('OVER') || prediction.includes('UNDER')) return 'TOTALS';
  if (raw.includes('HANDICAP') || raw.includes('SPREAD') || prediction.includes('HANDICAP')) return 'HANDICAP';
  if (raw.includes('MONEY') || raw.includes('H2H') || raw.includes('WINNER') || ['1', '2', 'HOME', 'AWAY', 'P1', 'P2', 'PLAYER1', 'PLAYER2'].includes(prediction)) return 'MONEYLINE';
  return raw || 'UNKNOWN_MARKET';
}

function normalizePredictionSide(value = '') {
  const prediction = normalizeToken(value);
  if (['1', 'HOME', 'P1', 'PLAYER1'].includes(prediction)) return '1';
  if (['2', 'AWAY', 'P2', 'PLAYER2'].includes(prediction)) return '2';
  if (prediction.includes('OVER')) return 'OVER';
  if (prediction.includes('UNDER')) return 'UNDER';
  return prediction || 'UNKNOWN_SELECTION';
}

function normalizePointLine(value) {
  if (value === undefined || value === null || value === '') return 'NA';
  const n = Number(value);
  if (!Number.isFinite(n)) return compactToken(value) || 'NA';
  return Number(n.toFixed(3)).toString();
}

function resolvePredictedPlayer(row = {}, pair = buildCanonicalPlayerPair(row)) {
  const direct = row.predicted_player_name || row.predictedPlayerName || row.pick_player_name || row.pickPlayerName;
  if (direct) return direct;
  const side = normalizePredictionSide(row.prediction);
  if (side === '1') return pair.playerOne;
  if (side === '2') return pair.playerTwo;
  return '';
}

function buildSelectionKey(row = {}, marketType = normalizeMarketType(row), pair = buildCanonicalPlayerPair(row)) {
  const side = normalizePredictionSide(row.prediction);
  if (marketType === 'MONEYLINE') {
    const predicted = resolvePredictedPlayer(row, pair);
    const playerKey = buildPlayerIdentity(predicted).key;
    return playerKey ? `PLAYER:${playerKey}` : `SIDE:${side}`;
  }
  if (marketType === 'TOTALS') return side === 'OVER' || side === 'UNDER' ? side : `TOTALS:${side}`;
  return side;
}

function buildTennisEventIdentity(row = {}) {
  const providerEventId = normalizeProviderEventId(
    row.provider_event_id || row.providerEventId || row.event_id || row.eventId || row.id_event
  );
  const date = canonicalizeMatchDate(row.date || row.match_date || row.matchDate || row.commence_time || row.commenceTime);
  const pair = buildCanonicalPlayerPair(row);
  const tour = inferTour(row);
  const tournamentKey = normalizeTournament(row);

  const fallbackResolvable = date.valid && pair.valid && tour !== 'UNKNOWN' && tournamentKey !== 'UNKNOWN_TOURNAMENT';
  const providerResolvable = Boolean(providerEventId) && pair.valid;
  const fallbackFingerprint = fallbackResolvable
    ? hashFingerprint('TEI3_FALLBACK', [date.minuteKey, tour, tournamentKey, pair.key])
    : '';
  const eventFingerprint = providerResolvable
    ? hashFingerprint('TEI3_EVENT', ['PROVIDER', providerEventId])
    : fallbackFingerprint;

  let status = 'AMBIGUOUS';
  let confidence = 'LOW';
  let reason = 'Identità evento insufficiente.';
  if (providerResolvable) {
    status = 'PROVIDER_KEYED';
    confidence = fallbackResolvable ? 'HIGH' : 'MEDIUM';
    reason = fallbackResolvable
      ? 'Provider event id presente e fallback canonico completo.'
      : 'Provider event id presente; fallback incompleto ma coppia giocatori valida.';
  } else if (fallbackResolvable) {
    status = 'CANONICAL_FALLBACK';
    confidence = 'MEDIUM';
    reason = 'Identità costruita da data/ora, tour, torneo e coppia giocatori.';
  } else if (!pair.valid) {
    status = 'AMBIGUOUS_PLAYERS';
    reason = 'Coppia giocatori mancante o non distinguibile.';
  } else if (!date.valid) {
    status = 'AMBIGUOUS_DATE';
    reason = 'Data/ora mancante o non interpretabile e provider event id assente.';
  } else if (tour === 'UNKNOWN') {
    status = 'AMBIGUOUS_TOUR';
    reason = 'Tour ATP/WTA non determinabile e provider event id assente.';
  } else if (tournamentKey === 'UNKNOWN_TOURNAMENT') {
    status = 'AMBIGUOUS_TOURNAMENT';
    reason = 'Torneo non determinabile e provider event id assente.';
  }

  const marketType = normalizeMarketType(row);
  const selectionKey = buildSelectionKey(row, marketType, pair);
  const pointLine = normalizePointLine(row.point ?? row.point_line ?? row.line);
  const marketResolvable = Boolean(eventFingerprint) && marketType !== 'UNKNOWN_MARKET' && selectionKey !== 'UNKNOWN_SELECTION';
  const marketFingerprint = marketResolvable
    ? hashFingerprint('TEI3_MARKET', [eventFingerprint, marketType, selectionKey, pointLine])
    : '';

  return {
    version: TENNIS_EVENT_IDENTITY_VERSION,
    providerEventId,
    date,
    pair,
    tour,
    tournamentKey,
    fallbackResolvable,
    providerResolvable,
    eventResolvable: Boolean(eventFingerprint),
    marketResolvable,
    fallbackFingerprint,
    eventFingerprint,
    marketFingerprint,
    marketType,
    selectionKey,
    pointLine,
    status,
    confidence,
    reason
  };
}

function annotateTennisEventIdentity(row = {}) {
  const identity = buildTennisEventIdentity(row);
  return {
    ...row,
    canonicalMatchKey: identity.eventFingerprint || row.canonicalMatchKey || null,
    tennis_canonical_match_key: identity.eventFingerprint || row.tennis_canonical_match_key || null,
    tennis_event_fingerprint: identity.eventFingerprint || null,
    tennis_market_fingerprint: identity.marketFingerprint || null,
    tennis_event_identity_status: identity.status,
    tennis_event_identity_reason: identity.reason,
    tennis_event_identity_confidence: identity.confidence,
    tennis_event_identity_version: TENNIS_EVENT_IDENTITY_VERSION,
    canonical_match_datetime: identity.date.canonical || null,
    canonical_tournament_key: identity.tournamentKey || null,
    canonical_player_pair_key: identity.pair.key || null,
    eventIdentity: identity
  };
}

function compareTennisEventIdentity(incomingRow = {}, existingRow = {}) {
  const incoming = incomingRow.eventIdentity || buildTennisEventIdentity(incomingRow);
  const existing = existingRow.eventIdentity || buildTennisEventIdentity(existingRow);

  const providerSame = Boolean(incoming.providerEventId && existing.providerEventId && incoming.providerEventId === existing.providerEventId);
  const pairSame = incoming.pair.valid && existing.pair.valid && isSameMatchPair(
    incoming.pair.playerOne,
    incoming.pair.playerTwo,
    existing.pair.playerOne,
    existing.pair.playerTwo
  );
  const fallbackSame = Boolean(incoming.fallbackFingerprint && existing.fallbackFingerprint && incoming.fallbackFingerprint === existing.fallbackFingerprint);

  if (providerSame && !pairSame) {
    return {
      sameEvent: false,
      conflict: true,
      code: 'PROVIDER_ID_PLAYER_PAIR_CONFLICT',
      incoming,
      existing
    };
  }
  if (providerSame && pairSame) {
    return {
      sameEvent: true,
      conflict: false,
      code: 'MATCH_PROVIDER_EVENT_ID',
      incoming,
      existing
    };
  }
  if (fallbackSame && pairSame) {
    const providersDiffer = Boolean(incoming.providerEventId && existing.providerEventId && incoming.providerEventId !== existing.providerEventId);
    return {
      sameEvent: true,
      conflict: false,
      code: providersDiffer ? 'MATCH_CANONICAL_FALLBACK_PROVIDER_DIFFERENT' : 'MATCH_CANONICAL_FALLBACK',
      providersDiffer,
      incoming,
      existing
    };
  }
  return {
    sameEvent: false,
    conflict: false,
    code: 'NO_EVENT_MATCH',
    incoming,
    existing
  };
}

function compareTennisMarketIdentity(incomingRow = {}, existingRow = {}) {
  const event = compareTennisEventIdentity(incomingRow, existingRow);
  if (!event.sameEvent) return { ...event, sameMarketSelection: false };
  const incoming = event.incoming;
  const existing = event.existing;
  const sameMarketSelection = incoming.marketType === existing.marketType &&
    incoming.selectionKey === existing.selectionKey &&
    incoming.pointLine === existing.pointLine;
  return {
    ...event,
    sameMarketSelection,
    code: sameMarketSelection ? `${event.code}_MARKET_EXACT` : `${event.code}_MARKET_DISTINCT`
  };
}

function selectPendingTennisIdentityMatch(incomingRow = {}, pendingRows = []) {
  const incomingAnnotated = incomingRow.eventIdentity ? incomingRow : annotateTennisEventIdentity(incomingRow);
  const incoming = incomingAnnotated.eventIdentity;
  const comparisons = (pendingRows || []).map(row => ({
    row,
    comparison: compareTennisMarketIdentity(incomingAnnotated, row)
  }));
  const conflicts = comparisons.filter(item => item.comparison.conflict);
  if (conflicts.length) {
    return {
      action: 'BLOCK_IDENTITY_COLLISION',
      status: 'AMBIGUOUS_PROVIDER_COLLISION',
      incoming: incomingAnnotated,
      match: null,
      exactMatches: [],
      conflicts,
      eventMatches: [],
      reason: 'Lo stesso provider_event_id risulta associato a coppie giocatori incompatibili.'
    };
  }

  const exactMatches = comparisons.filter(item => item.comparison.sameMarketSelection);
  const eventMatches = comparisons.filter(item => item.comparison.sameEvent);
  if (exactMatches.length === 1) {
    return {
      action: 'UPDATE_EXISTING',
      status: 'EXACT_IDENTITY_MATCH',
      incoming: incomingAnnotated,
      match: exactMatches[0].row,
      exactMatches,
      conflicts: [],
      eventMatches,
      reason: exactMatches[0].comparison.code
    };
  }
  if (exactMatches.length > 1) {
    return {
      action: 'BLOCK_IDENTITY_COLLISION',
      status: 'AMBIGUOUS_DUPLICATE_PENDING',
      incoming: incomingAnnotated,
      match: null,
      exactMatches,
      conflicts: [],
      eventMatches,
      reason: `Trovate ${exactMatches.length} righe PENDING con la stessa identità evento/mercato.`
    };
  }
  if (!incoming.eventResolvable || !incoming.marketResolvable) {
    return {
      action: 'INSERT_AUDIT_ONLY',
      status: incoming.status,
      incoming: incomingAnnotated,
      match: null,
      exactMatches: [],
      conflicts: [],
      eventMatches,
      reason: incoming.reason
    };
  }
  return {
    action: 'INSERT_DISTINCT',
    status: eventMatches.length ? 'DISTINCT_MARKET_SAME_EVENT' : 'NEW_EVENT',
    incoming: incomingAnnotated,
    match: null,
    exactMatches: [],
    conflicts: [],
    eventMatches,
    reason: eventMatches.length
      ? 'Evento già noto, ma mercato/selezione/linea distinti.'
      : 'Nessuna identità evento equivalente tra i PENDING.'
  };
}

function isOppositeSelection(incomingRow = {}, existingRow = {}) {
  const incoming = incomingRow.eventIdentity || buildTennisEventIdentity(incomingRow);
  const existing = existingRow.eventIdentity || buildTennisEventIdentity(existingRow);
  if (incoming.marketType !== existing.marketType || incoming.pointLine !== existing.pointLine) return false;
  const a = normalizePredictionSide(incomingRow.prediction);
  const b = normalizePredictionSide(existingRow.prediction);
  if (incoming.marketType === 'MONEYLINE') {
    const bothPlayerKeyed = incoming.selectionKey.startsWith('PLAYER:') && existing.selectionKey.startsWith('PLAYER:');
    if (bothPlayerKeyed) return incoming.selectionKey !== existing.selectionKey;
    return (a === '1' && b === '2') || (a === '2' && b === '1');
  }
  if (incoming.marketType === 'TOTALS') return (a === 'OVER' && b === 'UNDER') || (a === 'UNDER' && b === 'OVER');
  return false;
}

module.exports = {
  TENNIS_EVENT_IDENTITY_VERSION,
  TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS,
  normalizeToken,
  normalizeProviderEventId,
  canonicalizeMatchDate,
  buildCanonicalPlayerPair,
  inferTour,
  normalizeTournament,
  normalizeMarketType,
  normalizePredictionSide,
  normalizePointLine,
  buildSelectionKey,
  buildTennisEventIdentity,
  annotateTennisEventIdentity,
  compareTennisEventIdentity,
  compareTennisMarketIdentity,
  selectPendingTennisIdentityMatch,
  isOppositeSelection
};
