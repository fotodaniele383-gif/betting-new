'use strict';

const CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION = 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE_V1';
const DEFAULT_MAX_AGE_MINUTES = 12 * 60;
const DEFAULT_FUTURE_TOLERANCE_MINUTES = 15;
const DIRECT_MARKETS = Object.freeze(['1', 'X', '2', 'O2.5', 'U2.5', '1X', 'X2', '12']);
const OPERATIONAL_MIN_SOURCES = 2;

function safeOdd(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 1.001 && n < 1000 ? n : null;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function normalizeBookmakerKey(bookmaker = {}) {
  return text(bookmaker.key || bookmaker.title || 'unknown').toLowerCase() || 'unknown';
}
function parseTime(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}
function normalizeMarketKey(value = '') {
  const raw = upper(value).replace(/\s+/g, '').replace(/_/g, '');
  if (raw === '1' || raw === 'HOME' || raw === 'HOMEWIN') return '1';
  if (raw === 'X' || raw === 'DRAW') return 'X';
  if (raw === '2' || raw === 'AWAY' || raw === 'AWAYWIN') return '2';
  if (['O2.5', 'OVER2.5', 'OVER25', 'O25'].includes(raw)) return 'O2.5';
  if (['U2.5', 'UNDER2.5', 'UNDER25', 'U25'].includes(raw)) return 'U2.5';
  if (['1X', 'HOMEORDRAW', 'HOMEDRAW'].includes(raw)) return '1X';
  if (['X2', 'DRAWORAWAY', 'DRAWWAY', 'AWAYORDRAW'].includes(raw)) return 'X2';
  if (['12', 'HOMEORAWAY', 'NODRAW'].includes(raw)) return '12';
  return null;
}
function findMarkets(bookmaker = {}, aliases = []) {
  const keys = new Set(aliases.map(alias => text(alias).toLowerCase()));
  return (Array.isArray(bookmaker.markets) ? bookmaker.markets : [])
    .filter(market => keys.has(text(market?.key).toLowerCase()));
}
function addObservation(target, observation = {}) {
  if (!DIRECT_MARKETS.includes(observation.market)) return;
  const price = safeOdd(observation.price);
  if (!price) return;
  target.push({
    provider: text(observation.provider || 'THE_ODDS_API') || 'THE_ODDS_API',
    providerEventId: text(observation.providerEventId) || null,
    bookmakerKey: text(observation.bookmakerKey).toLowerCase() || 'unknown',
    bookmakerTitle: text(observation.bookmakerTitle || observation.bookmakerKey || 'Unknown'),
    bookmakerLastUpdate: text(observation.bookmakerLastUpdate) || null,
    marketKey: text(observation.marketKey) || null,
    market: observation.market,
    outcomeName: text(observation.outcomeName) || null,
    point: observation.point === null || observation.point === undefined ? null : Number(observation.point),
    price,
    direct: true,
    derived: false,
    sourceType: 'DIRECT_BOOKMAKER_QUOTE'
  });
}

function extractDirectObservations(event = {}, options = {}) {
  const home = text(event.home_team || event.home || event.homeTeam);
  const away = text(event.away_team || event.away || event.awayTeam);
  const provider = text(options.provider || event.provider || 'THE_ODDS_API') || 'THE_ODDS_API';
  const providerEventId = text(event.id || event.provider_event_id || event.providerEventId) || null;
  const observations = [];

  for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
    const bookmakerKey = normalizeBookmakerKey(bookmaker);
    const bookmakerTitle = text(bookmaker.title || bookmaker.key || 'Unknown');
    const bookmakerLastUpdate = text(bookmaker.last_update || bookmaker.lastUpdate) || null;
    const base = { provider, providerEventId, bookmakerKey, bookmakerTitle, bookmakerLastUpdate };

    for (const market of findMarkets(bookmaker, ['h2h'])) {
      for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
        const outcomeName = text(outcome?.name);
        let normalized = null;
        if (outcomeName === home) normalized = '1';
        else if (outcomeName === away) normalized = '2';
        else if (upper(outcomeName) === 'DRAW') normalized = 'X';
        if (normalized) addObservation(observations, { ...base, marketKey: market.key, market: normalized, outcomeName, price: outcome.price });
      }
    }

    for (const market of findMarkets(bookmaker, ['totals'])) {
      for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
        const point = Number(outcome?.point ?? market?.point);
        if (point !== 2.5) continue;
        const name = upper(outcome?.name);
        const normalized = name === 'OVER' ? 'O2.5' : name === 'UNDER' ? 'U2.5' : null;
        if (normalized) addObservation(observations, { ...base, marketKey: market.key, market: normalized, outcomeName: outcome.name, point, price: outcome.price });
      }
    }

    for (const market of findMarkets(bookmaker, ['double_chance', 'doublechance', 'doubleChance'])) {
      for (const outcome of Array.isArray(market.outcomes) ? market.outcomes : []) {
        const normalized = normalizeMarketKey(outcome?.name || outcome?.description || outcome?.key);
        if (['1X', 'X2', '12'].includes(normalized)) {
          addObservation(observations, { ...base, marketKey: market.key, market: normalized, outcomeName: outcome.name, price: outcome.price });
        }
      }
    }
  }
  return observations;
}

function validateObservation(observation = {}, options = {}) {
  const nowMs = parseTime(options.now || options.nowIso) ?? Date.now();
  const maxAgeMinutes = Number.isFinite(Number(options.maxAgeMinutes)) ? Number(options.maxAgeMinutes) : DEFAULT_MAX_AGE_MINUTES;
  const futureToleranceMinutes = Number.isFinite(Number(options.futureToleranceMinutes)) ? Number(options.futureToleranceMinutes) : DEFAULT_FUTURE_TOLERANCE_MINUTES;
  const reasons = [];
  const updatedMs = parseTime(observation.bookmakerLastUpdate);
  const ageMinutes = updatedMs === null ? null : (nowMs - updatedMs) / 60000;
  if (!safeOdd(observation.price)) reasons.push('INVALID_PRICE');
  if (!text(observation.bookmakerKey) || text(observation.bookmakerKey) === 'unknown') reasons.push('MISSING_BOOKMAKER');
  if (!updatedMs) reasons.push('MISSING_TIMESTAMP');
  if (updatedMs && ageMinutes < -futureToleranceMinutes) reasons.push('FUTURE_TIMESTAMP');
  if (updatedMs && ageMinutes > maxAgeMinutes) reasons.push('STALE_TIMESTAMP');
  if (observation.direct !== true || observation.derived === true) reasons.push('NOT_DIRECT');
  return {
    valid: reasons.length === 0,
    reasons,
    ageMinutes: ageMinutes === null ? null : Math.round(ageMinutes * 10) / 10,
    freshness: updatedMs === null ? 'UNKNOWN' : ageMinutes > maxAgeMinutes ? 'STALE' : ageMinutes < -futureToleranceMinutes ? 'INVALID_FUTURE' : 'FRESH'
  };
}

function certifyMarket(market, observations = [], options = {}) {
  const all = observations.filter(row => row.market === market).map(row => ({ ...row, validation: validateObservation(row, options) }));
  const valid = all.filter(row => row.validation.valid);
  const unique = [];
  const seen = new Set();
  for (const row of valid.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    return (parseTime(b.bookmakerLastUpdate) || 0) - (parseTime(a.bookmakerLastUpdate) || 0);
  })) {
    const key = `${row.provider}|${row.bookmakerKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  const selected = unique[0] || null;
  const sourceCount = unique.length;
  const realDirect = sourceCount >= 1;
  const crossVerified = sourceCount >= OPERATIONAL_MIN_SOURCES;
  let status = 'UNCERTIFIED_NO_DIRECT_QUOTE';
  let reason = 'Nessuna quota diretta bookmaker valida per il mercato.';
  if (realDirect && crossVerified) {
    status = 'CERTIFIED_MULTI_SOURCE';
    reason = `Quota diretta verificata su ${sourceCount} bookmaker; fonte esecutiva ${selected.bookmakerTitle}.`;
  } else if (realDirect) {
    status = 'CERTIFIED_SINGLE_SOURCE_ANALYSIS_ONLY';
    reason = `Quota diretta disponibile solo su ${selected.bookmakerTitle}; manca la verifica multi-fonte richiesta per lo stake.`;
  } else if (all.some(row => row.validation.reasons.includes('STALE_TIMESTAMP'))) {
    status = 'UNCERTIFIED_STALE';
    reason = 'Quote dirette trovate ma timestamp oltre la soglia di freschezza.';
  } else if (all.some(row => row.validation.reasons.includes('MISSING_TIMESTAMP'))) {
    status = 'UNCERTIFIED_MISSING_TIMESTAMP';
    reason = 'Quote dirette trovate ma senza timestamp bookmaker verificabile.';
  } else if (all.some(row => row.validation.reasons.includes('MISSING_BOOKMAKER'))) {
    status = 'UNCERTIFIED_MISSING_BOOKMAKER';
    reason = 'Quota trovata ma senza bookmaker/sito identificabile.';
  }
  return {
    version: CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    market,
    status,
    reason,
    realDirect,
    certified: realDirect,
    crossVerified,
    operationalEligible: crossVerified,
    sourceCount,
    selectedPrice: selected?.price ?? null,
    selectedSource: selected ? {
      provider: selected.provider,
      providerEventId: selected.providerEventId,
      bookmakerKey: selected.bookmakerKey,
      bookmakerTitle: selected.bookmakerTitle,
      lastUpdate: selected.bookmakerLastUpdate,
      marketKey: selected.marketKey,
      outcomeName: selected.outcomeName,
      point: selected.point,
      price: selected.price,
      direct: true,
      derived: false,
      freshness: selected.validation.freshness,
      ageMinutes: selected.validation.ageMinutes
    } : null,
    sources: unique.map(row => ({
      provider: row.provider,
      bookmakerKey: row.bookmakerKey,
      bookmakerTitle: row.bookmakerTitle,
      lastUpdate: row.bookmakerLastUpdate,
      marketKey: row.marketKey,
      outcomeName: row.outcomeName,
      point: row.point,
      price: row.price,
      freshness: row.validation.freshness,
      ageMinutes: row.validation.ageMinutes
    })),
    rejectedObservations: all.filter(row => !row.validation.valid).map(row => ({
      bookmakerKey: row.bookmakerKey,
      bookmakerTitle: row.bookmakerTitle,
      lastUpdate: row.bookmakerLastUpdate,
      price: row.price,
      reasons: row.validation.reasons
    })),
    safeguards: {
      directQuoteOnly: true,
      derivedOddsAccepted: false,
      estimatedOddsAccepted: false,
      reconstructedOddsAccepted: false,
      operationalMinimumSources: OPERATIONAL_MIN_SOURCES
    }
  };
}

function buildCertifiedOddsProvenance(event = {}, options = {}) {
  const observations = extractDirectObservations(event, options);
  const markets = {};
  const analysisOdds = {};
  const operationalOdds = {};
  const sources = {};
  for (const market of DIRECT_MARKETS) {
    const certification = certifyMarket(market, observations, options);
    markets[market] = certification;
    if (certification.realDirect && safeOdd(certification.selectedPrice)) {
      analysisOdds[market] = certification.selectedPrice;
      sources[market] = certification.selectedSource;
      if (certification.operationalEligible) operationalOdds[market] = certification.selectedPrice;
    }
  }
  const availableMarkets = Object.keys(analysisOdds);
  const operationalMarkets = Object.keys(operationalOdds);
  return {
    version: CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    eventId: text(event.id || event.provider_event_id || event.providerEventId) || null,
    markets,
    observations,
    analysisOdds,
    operationalOdds,
    sources,
    availableMarkets,
    operationalMarkets,
    alternatives: availableMarkets.map(market => ({ market, odd: analysisOdds[market], certification: markets[market].status, operationalEligible: markets[market].operationalEligible })),
    summary: {
      observationCount: observations.length,
      directMarkets: availableMarkets.length,
      multiSourceMarkets: operationalMarkets.length,
      singleSourceMarkets: availableMarkets.filter(market => !markets[market].operationalEligible).length,
      derivedExecutionMarkets: 0,
      operationalMinimumSources: OPERATIONAL_MIN_SOURCES
    },
    safeguards: {
      noDerivedExecutionOdds: true,
      noEstimatedExecutionOdds: true,
      noReconstructedExecutionOdds: true,
      missingMarketFallsBackToOtherDirectMarkets: true,
      noNewOddsApiCalls: true
    }
  };
}

function certificationFromInput(input = {}) {
  let nested = input.oddsCertification || input.odds_certification || input.extData?.oddsCertification || input.extData?.odds_certification || null;
  if (typeof nested === 'string') {
    try { nested = JSON.parse(nested); } catch (_) { nested = null; }
  }
  if (nested && typeof nested === 'object') return nested;
  const direct = input.calcio_odds_direct === 1 || input.calcio_odds_direct === true;
  const derived = input.calcio_odds_derived === 1 || input.calcio_odds_derived === true;
  const sourceCount = Number(input.calcio_odds_source_count || 0);
  const operationalEligible = input.calcio_odds_operational_eligible === 1 || input.calcio_odds_operational_eligible === true;
  return {
    version: input.calcio_odds_provenance_version || CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    market: input.prediction || input.market || null,
    status: input.calcio_odds_certification_status || 'UNCERTIFIED_LEGACY_ROW',
    reason: input.calcio_odds_certification_reason || 'Riga priva di provenienza quota Patch 18.',
    realDirect: direct && !derived,
    certified: input.calcio_odds_certified === 1 || input.calcio_odds_certified === true,
    crossVerified: sourceCount >= OPERATIONAL_MIN_SOURCES,
    operationalEligible,
    sourceCount,
    selectedPrice: safeOdd(input.odd),
    selectedSource: {
      bookmakerKey: input.calcio_odds_bookmaker_key || null,
      bookmakerTitle: input.calcio_odds_bookmaker_title || null,
      lastUpdate: input.calcio_odds_last_update || null,
      marketKey: input.calcio_odds_market_key || null,
      price: safeOdd(input.odd),
      direct,
      derived
    },
    safeguards: { directQuoteOnly: true, derivedOddsAccepted: false, operationalMinimumSources: OPERATIONAL_MIN_SOURCES }
  };
}

function persistenceFields(certification = {}) {
  const selected = certification.selectedSource || {};
  return {
    calcio_odds_provenance_version: certification.version || CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    calcio_odds_certification_status: certification.status || 'UNCERTIFIED',
    calcio_odds_certification_reason: certification.reason || '',
    calcio_odds_certified: certification.certified ? 1 : 0,
    calcio_odds_operational_eligible: certification.operationalEligible ? 1 : 0,
    calcio_odds_direct: certification.realDirect && selected.derived !== true ? 1 : 0,
    calcio_odds_derived: selected.derived === true ? 1 : 0,
    calcio_odds_bookmaker_key: selected.bookmakerKey || null,
    calcio_odds_bookmaker_title: selected.bookmakerTitle || null,
    calcio_odds_market_key: selected.marketKey || null,
    calcio_odds_last_update: selected.lastUpdate || null,
    calcio_odds_source_count: Number(certification.sourceCount || 0),
    calcio_odds_source_list: JSON.stringify((certification.sources || []).map(source => ({
      bookmakerKey: source.bookmakerKey,
      bookmakerTitle: source.bookmakerTitle,
      lastUpdate: source.lastUpdate,
      price: source.price,
      marketKey: source.marketKey
    }))),
    calcio_odds_provenance_json: JSON.stringify(certification || {})
  };
}

module.exports = {
  CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
  DEFAULT_MAX_AGE_MINUTES,
  DEFAULT_FUTURE_TOLERANCE_MINUTES,
  DIRECT_MARKETS,
  OPERATIONAL_MIN_SOURCES,
  safeOdd,
  normalizeMarketKey,
  extractDirectObservations,
  validateObservation,
  certifyMarket,
  buildCertifiedOddsProvenance,
  certificationFromInput,
  persistenceFields
};
