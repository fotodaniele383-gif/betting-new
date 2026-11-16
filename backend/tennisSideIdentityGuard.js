// ============================================================================
// STEP91H_TENNIS_SIDE_IDENTITY_GUARD
// ============================================================================
// Non usare prediction=1/2 come informazione sufficiente per settlement/UI.
// Ogni riga Tennis deve portare nome reale del pick, lato interno e ordine evento.
// ============================================================================

const STEP91H_TENNIS_SIDE_IDENTITY_GUARD = 'STEP91H_TENNIS_SIDE_IDENTITY_GUARD';

function normalizePlayerName(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizePlayerName(value = '') {
  return normalizePlayerName(value).split(' ').filter(Boolean);
}

function getLastName(value = '') {
  const parts = tokenizePlayerName(value);
  return parts.length ? parts[parts.length - 1] : '';
}

function getFirstInitial(value = '') {
  const parts = tokenizePlayerName(value);
  return parts.length ? parts[0][0] : '';
}

function isSamePlayerStrict(a = '', b = '') {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const la = getLastName(na);
  const lb = getLastName(nb);
  if (!la || !lb || la !== lb) return false;

  const ia = getFirstInitial(na);
  const ib = getFirstInitial(nb);
  return !ia || !ib || ia === ib;
}

function splitMatchName(match = '') {
  const raw = String(match || '');
  const parts = raw.split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
  return { p1: parts[0] || '', p2: parts[1] || '' };
}

function resolvePlayerOne(row = {}) {
  return row.home || row.home_team || row.player1 || row.playerA || splitMatchName(row.match).p1 || '';
}

function resolvePlayerTwo(row = {}) {
  return row.away || row.away_team || row.player2 || row.playerB || splitMatchName(row.match).p2 || '';
}

function normalizeInternalSide(prediction = '') {
  const p = String(prediction || '').trim().toUpperCase();
  if (p === '1' || p === 'P1' || p === 'PLAYER1' || p === 'HOME') return '1';
  if (p === '2' || p === 'P2' || p === 'PLAYER2' || p === 'AWAY') return '2';
  if (p.includes('OVER')) return 'OVER';
  if (p.includes('UNDER')) return 'UNDER';
  return p;
}

function resolvePredictedPlayerName(row = {}) {
  if (row.predicted_player_name || row.predictedPlayerName || row.pick_player_name) {
    return row.predicted_player_name || row.predictedPlayerName || row.pick_player_name;
  }
  const side = normalizeInternalSide(row.prediction);
  if (side === '1') return resolvePlayerOne(row);
  if (side === '2') return resolvePlayerTwo(row);
  return '';
}

function resolveOpponentPlayerName(row = {}) {
  if (row.opponent_player_name || row.opponentPlayerName) {
    return row.opponent_player_name || row.opponentPlayerName;
  }
  const side = normalizeInternalSide(row.prediction);
  if (side === '1') return resolvePlayerTwo(row);
  if (side === '2') return resolvePlayerOne(row);
  return '';
}

function buildOfficialEventOrder(row = {}) {
  const existing = row.official_event_order || row.officialEventOrder;
  if (existing) return existing;

  const providerHome = row.provider_home_team || row.providerHomeTeam || row.official_home_team || row.home_team_provider || row.event_home_team || row.raw_home_team;
  const providerAway = row.provider_away_team || row.providerAwayTeam || row.official_away_team || row.away_team_provider || row.event_away_team || row.raw_away_team;
  if (providerHome && providerAway) return providerHome + ' - ' + providerAway;

  const p1 = resolvePlayerOne(row);
  const p2 = resolvePlayerTwo(row);
  return p1 && p2 ? p1 + ' - ' + p2 : '';
}

function detectSideMappingWarning(row = {}) {
  const p1 = resolvePlayerOne(row);
  const p2 = resolvePlayerTwo(row);
  const providerHome = row.provider_home_team || row.providerHomeTeam || row.official_home_team || row.home_team_provider || row.event_home_team || row.raw_home_team;
  const providerAway = row.provider_away_team || row.providerAwayTeam || row.official_away_team || row.away_team_provider || row.event_away_team || row.raw_away_team;

  if (!providerHome || !providerAway || !p1 || !p2) return 'SIDE_MAPPING_VERIFIED_BY_PLAYER_NAME';
  const direct = isSamePlayerStrict(p1, providerHome) && isSamePlayerStrict(p2, providerAway);
  const inverted = isSamePlayerStrict(p1, providerAway) && isSamePlayerStrict(p2, providerHome);
  if (inverted) return 'PLAYER_ORDER_INVERTED_VS_PROVIDER';
  if (!direct) return 'PLAYER_ORDER_MISMATCH_VS_PROVIDER';
  return 'SIDE_MAPPING_VERIFIED_BY_PLAYER_NAME';
}

function annotateBetSideIdentity(row = {}) {
  const internalSide = normalizeInternalSide(row.prediction);
  const predicted = resolvePredictedPlayerName(row);
  const opponent = resolveOpponentPlayerName(row);
  const officialEventOrder = buildOfficialEventOrder(row);
  const warning = row.side_mapping_warning || row.sideMappingWarning || detectSideMappingWarning(row);
  const verified = warning !== 'PLAYER_ORDER_MISMATCH_VS_PROVIDER';
  return {
    ...row,
    predicted_player_name: predicted || null,
    predictedPlayerName: predicted || null,
    opponent_player_name: opponent || null,
    opponentPlayerName: opponent || null,
    internal_side: internalSide || null,
    internalSide,
    official_event_order: officialEventOrder || null,
    officialEventOrder,
    provider_event_id: row.provider_event_id || row.providerEventId || row.id_event || null,
    providerEventId: row.providerEventId || row.provider_event_id || row.id_event || null,
    provider_home_team: row.provider_home_team || row.providerHomeTeam || row.official_home_team || null,
    providerHomeTeam: row.providerHomeTeam || row.provider_home_team || row.official_home_team || null,
    provider_away_team: row.provider_away_team || row.providerAwayTeam || row.official_away_team || null,
    providerAwayTeam: row.providerAwayTeam || row.provider_away_team || row.official_away_team || null,
    side_mapping_warning: warning,
    sideMappingWarning: warning,
    side_mapping_verified: verified ? 1 : 0,
    sideMappingVerified: verified,
    side_identity_version: STEP91H_TENNIS_SIDE_IDENTITY_GUARD,
    sideIdentityVersion: STEP91H_TENNIS_SIDE_IDENTITY_GUARD,
    sideIdentityDisplay: predicted
      ? 'Pick: ' + predicted + ' · Side interno: ' + (internalSide || '-') + (officialEventOrder ? ' · Evento ufficiale: ' + officialEventOrder : '')
      : ''
  };
}

function winnerNameFromResolution(match = {}, resolution = {}) {
  const direct = resolution.winner_player_name || resolution.winnerPlayerName || resolution.winnerName || resolution.winner_name;
  if (direct) return direct;
  if (resolution.winner === 1) return resolvePlayerOne(match);
  if (resolution.winner === 2) return resolvePlayerTwo(match);
  return '';
}

function evaluateTennisBetWithSideIdentity(match = {}, resolution = {}, legacyEvaluator) {
  if (!resolution) return null;
  const totalGames = resolution.totalGames;
  if (totalGames === 'VOID' || resolution.winner === 'VOID' || resolution.isVoid === true) return 'VOID';

  const prediction = match.prediction;
  const side = normalizeInternalSide(prediction);
  if (side === 'OVER' || side === 'UNDER') {
    return typeof legacyEvaluator === 'function' ? legacyEvaluator(prediction, resolution.winner, totalGames) : null;
  }

  const annotated = annotateBetSideIdentity(match);
  const predicted = annotated.predicted_player_name;
  const winnerName = winnerNameFromResolution(match, resolution);

  // STEP107_SIDE_IDENTITY_WEAK_WINNER_SIDE_GUARD
  // Per moneyline Tennis, se una fonte web/cache è marcata weak winner side e non
  // fornisce nome vincente affidabile, non valutare con 1/2 numerico: resta pending.
  const step107DirectWinnerName = resolution.winner_player_name || resolution.winnerPlayerName || resolution.winnerName || resolution.winner_name;
  if ((side === '1' || side === '2') && resolution.step107WeakWinnerSide === true && !step107DirectWinnerName) {
    return null;
  }

  if (predicted && winnerName) {
    return isSamePlayerStrict(predicted, winnerName);
  }

  return typeof legacyEvaluator === 'function' ? legacyEvaluator(prediction, resolution.winner, totalGames) : null;
}

module.exports = {
  STEP91H_TENNIS_SIDE_IDENTITY_GUARD,
  normalizePlayerName,
  isSamePlayerStrict,
  normalizeInternalSide,
  resolvePredictedPlayerName,
  resolveOpponentPlayerName,
  buildOfficialEventOrder,
  detectSideMappingWarning,
  annotateBetSideIdentity,
  winnerNameFromResolution,
  evaluateTennisBetWithSideIdentity
};

// ============================================================================
// STEP91K_SIDE_IDENTITY_BOOLEAN_NORMALIZATION
// Stabilizzazione runtime: il modulo deve restituire side_mapping_verified come
// boolean JavaScript (true/false), non come INTEGER SQLite (1/0). La conversione
// a 1/0 resta responsabilità della persistenza DB.
// ============================================================================
function step91kCoerceBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const text = String(value).trim().toUpperCase();
  return text === 'TRUE' || text === '1' || text === 'YES' || text === 'VERIFIED';
}

if (
  module.exports &&
  typeof module.exports.annotateBetSideIdentity === 'function' &&
  module.exports.__STEP91K_SIDE_IDENTITY_BOOLEAN_NORMALIZATION_APPLIED !== true
) {
  const __step91kOriginalAnnotateBetSideIdentity = module.exports.annotateBetSideIdentity;
  module.exports.annotateBetSideIdentity = function step91kAnnotateBetSideIdentityBooleanSafe(...args) {
    const annotated = __step91kOriginalAnnotateBetSideIdentity.apply(this, args);
    if (annotated && Object.prototype.hasOwnProperty.call(annotated, 'side_mapping_verified')) {
      annotated.side_mapping_verified = step91kCoerceBoolean(annotated.side_mapping_verified);
    }
    return annotated;
  };
  module.exports.__STEP91K_SIDE_IDENTITY_BOOLEAN_NORMALIZATION_APPLIED = true;
  module.exports.step91kCoerceBoolean = step91kCoerceBoolean;
}
// /STEP91K_SIDE_IDENTITY_BOOLEAN_NORMALIZATION

