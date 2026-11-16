'use strict';

const eventIdentity = require('./calcioEventIdentity');
const entityResolution = require('./calcioEntityResolution');

const CALCIO_DECISION_CERTIFICATION_VERSION = 'BETTING_PATCH_21_CALCIO_DECISION_CERTIFICATION_V3';
const DEFAULT_MIN_PROBABILITY = 35;
const DEFAULT_MAX_ODD = 3;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function nullableFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((finite(value, 0) + Number.EPSILON) * factor) / factor;
}
function upper(value = '') {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function token(value = '') {
  return eventIdentity.normalizeToken(value);
}
function canonical(value = '') {
  return eventIdentity.canonicalTeam(value);
}
function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return null; }
}

function resolveHistoricalKey(providerName = '', candidates = []) {
  const safeCandidates = (Array.isArray(candidates) ? candidates : []).map(value => String(value || '').trim()).filter(Boolean);
  const resolution = entityResolution.resolveTeamName(providerName, safeCandidates, { threshold: 0.82 });
  if (resolution.matched) {
    return {
      version: CALCIO_DECISION_CERTIFICATION_VERSION,
      entityResolutionVersion: entityResolution.CALCIO_ENTITY_RESOLUTION_VERSION,
      status: resolution.method === 'EXACT_OR_ALIAS' ? 'EXACT_OR_EXPLICIT_ALIAS' : 'CONSERVATIVE_ENTITY_RESOLUTION',
      matched: true,
      providerName: String(providerName || ''),
      historicalKey: resolution.resolved,
      candidateCount: 1,
      confidence: resolution.confidence,
      resolutionMethod: resolution.method,
      fuzzyUsed: resolution.method !== 'EXACT_OR_ALIAS'
    };
  }
  return {
    version: CALCIO_DECISION_CERTIFICATION_VERSION,
    entityResolutionVersion: entityResolution.CALCIO_ENTITY_RESOLUTION_VERSION,
    status: 'NO_CONSERVATIVE_ALIAS',
    matched: false,
    providerName: String(providerName || ''),
    historicalKey: null,
    candidateCount: 0,
    confidence: resolution.confidence || 0,
    closest: resolution.closest || null,
    resolutionMethod: resolution.method,
    fuzzyUsed: false
  };
}

function marketFamily(prediction = '') {
  const p = upper(prediction).replace(/\s+/g, '');
  if (['1', 'X', '2'].includes(p)) return 'H2H';
  if (['1X', 'X2', '12'].includes(p)) return 'DOUBLE_CHANCE';
  if (/^[OU]2[.,]5$/.test(p)) return 'TOTALS';
  if (p.includes('GG') || p.includes('NG') || p.includes('BTTS')) return 'BTTS';
  return 'UNKNOWN';
}

function expectedMarketKey(prediction = '') {
  const family = marketFamily(prediction);
  if (family === 'H2H') return 'h2h';
  if (family === 'DOUBLE_CHANCE') return 'double_chance';
  if (family === 'TOTALS') return 'totals';
  if (family === 'BTTS') return 'btts';
  return null;
}

function expectedOutcome(prediction = '', home = '', away = '') {
  const p = upper(prediction).replace(/\s+/g, '');
  if (p === '1') return canonical(home);
  if (p === '2') return canonical(away);
  if (p === 'X') return 'draw';
  if (['1X', 'X2', '12'].includes(p)) return p.toLowerCase();
  if (p === 'O2.5' || p === 'O2,5') return 'over';
  if (p === 'U2.5' || p === 'U2,5') return 'under';
  return null;
}

function outcomeMatches(prediction, selectedSource = {}, home = '', away = '') {
  const expected = expectedOutcome(prediction, home, away);
  if (!expected) return true;
  const rawOutcome = token(selectedSource.outcomeName || selectedSource.outcome || '');
  if (!rawOutcome) return true;
  if (expected === 'draw') return ['draw', 'x', 'pareggio'].includes(rawOutcome);
  if (expected === 'over') return rawOutcome.includes('over');
  if (expected === 'under') return rawOutcome.includes('under');
  if (['1x', 'x2', '12'].includes(expected)) return rawOutcome.replace(/\s+/g, '') === expected;
  return canonical(rawOutcome) === expected;
}

function pointMatches(prediction, selectedSource = {}) {
  if (marketFamily(prediction) !== 'TOTALS') return true;
  const point = nullableFinite(selectedSource.point);
  return point === null || Math.abs(point - 2.5) < 1e-9;
}

function certifyMarket(input = {}) {
  const prediction = String(input.prediction || input.market || '').trim();
  const oddsCertification = input.oddsCertification || input.odds_certification || parseJson(input.calcio_odds_provenance_json) || {};
  const selectedSource = oddsCertification.selectedSource || {};
  const certifiedMarket = String(oddsCertification.market || input.calcio_odds_market || '').trim();
  const expectedKey = expectedMarketKey(prediction);
  const actualKey = String(selectedSource.marketKey || input.calcio_odds_market_key || '').toLowerCase();
  const predictionEqualsCertification = !certifiedMarket || upper(certifiedMarket) === upper(prediction);
  const keyMatches = !expectedKey || !actualKey || actualKey === expectedKey;
  const outcomeOk = outcomeMatches(prediction, selectedSource, input.providerHome || input.home || input.home_team, input.providerAway || input.away || input.away_team);
  const pointOk = pointMatches(prediction, selectedSource);
  const validFamily = marketFamily(prediction) !== 'UNKNOWN';
  const certified = validFamily && predictionEqualsCertification && keyMatches && outcomeOk && pointOk;
  const reasons = [];
  if (!validFamily) reasons.push(`mercato non riconosciuto: ${prediction || 'vuoto'}`);
  if (!predictionEqualsCertification) reasons.push(`pronostico ${prediction} diverso dalla quota certificata ${certifiedMarket}`);
  if (!keyMatches) reasons.push(`famiglia ${marketFamily(prediction)} incompatibile con marketKey ${actualKey}`);
  if (!outcomeOk) reasons.push(`outcome bookmaker incompatibile con ${prediction}`);
  if (!pointOk) reasons.push('linea totals diversa da 2.5');
  return {
    version: CALCIO_DECISION_CERTIFICATION_VERSION,
    certified,
    status: certified ? 'MARKET_IDENTITY_CERTIFIED' : 'MARKET_IDENTITY_CONFLICT',
    prediction,
    family: marketFamily(prediction),
    expectedMarketKey: expectedKey,
    actualMarketKey: actualKey || null,
    certifiedMarket: certifiedMarket || null,
    selectedOutcome: selectedSource.outcomeName || selectedSource.outcome || null,
    reasons
  };
}

function certifyIdentity(input = {}) {
  const providerHome = String(input.providerHome || input.provider_home_team || input.calcio_provider_home_team || input.home || input.home_team || '').trim();
  const providerAway = String(input.providerAway || input.provider_away_team || input.calcio_provider_away_team || input.away || input.away_team || '').trim();
  const displayHome = String(input.home || input.home_team || '').trim();
  const displayAway = String(input.away || input.away_team || '').trim();
  const rawIdentityPresent = Boolean(providerHome && providerAway);
  const displayMatchesProvider = rawIdentityPresent && canonical(displayHome) === canonical(providerHome) && canonical(displayAway) === canonical(providerAway);
  const providerEventId = String(input.provider_event_id || input.calcio_provider_event_id || input.oddsCertification?.selectedSource?.providerEventId || input.odds_certification?.selectedSource?.providerEventId || '').trim();
  const eventKey = String(input.event_key || input.eventKey || input.calcio_event_key || input.match_exposure_key || '').trim();
  const eventKeyMatches = !providerEventId || !eventKey || eventKey.includes(providerEventId);
  const certified = rawIdentityPresent && displayMatchesProvider && eventKeyMatches;
  const reasons = [];
  if (!rawIdentityPresent) reasons.push('identità provider casa/trasferta assente');
  if (rawIdentityPresent && !displayMatchesProvider) reasons.push(`identità visualizzata ${displayHome}-${displayAway} diversa dal provider ${providerHome}-${providerAway}`);
  if (!eventKeyMatches) reasons.push('provider event id non coerente con event key');
  return {
    version: CALCIO_DECISION_CERTIFICATION_VERSION,
    certified,
    status: certified ? 'PROVIDER_IDENTITY_CERTIFIED' : 'PROVIDER_IDENTITY_UNCERTIFIED',
    providerHome,
    providerAway,
    displayHome,
    displayAway,
    providerEventId: providerEventId || null,
    eventKey: eventKey || null,
    reasons
  };
}

function operationalGuard(input = {}) {
  const probability = finite(input.probability ?? input.estimated_prob ?? input.estimatedProb, 0);
  const odd = finite(input.odd, 0);
  const thresholds = input.analysis_thresholds || input.analysisThresholds || {};
  const minProbability = finite(thresholds.requiredProbability ?? thresholds.minProbability ?? input.minimumProbability ?? input.baseProb, DEFAULT_MIN_PROBABILITY);
  const maxOdd = finite(thresholds.maxOdd ?? input.maximumOdd ?? input.maxOdd, DEFAULT_MAX_ODD);
  const minimumEdge = finite(thresholds.requiredEdge ?? thresholds.minEdge ?? input.minimumEdge ?? input.baseEdge, 0);
  const edge = finite(input.edge_pp ?? input.edgePp ?? input.edge, 0);
  const identity = input.decisionIdentity || input.identityCertification || certifyIdentity(input);
  const market = input.marketCertification || certifyMarket(input);
  const professional = upper(`${input.calcio_professional_status || ''} ${input.professionalAudit?.status || ''}`);
  const qualityGate = upper(`${input.calcio_gate_status || ''} ${input.calcio_quality_final_label || ''}`);
  const timing = upper(`${input.calcio_timing_status || ''} ${input.timingStatus || ''} ${input.professionalAudit?.timing?.status || ''}`);
  const dataReliability = upper(`${input.calcio_data_reliability || ''} ${input.dataClass || ''} ${input.professionalAudit?.dataReliability?.status || ''}`);
  const historicalSample = Math.max(0, finite(input.historicalSample ?? input.historical_combo_resolved ?? input.historicalEvidence?.resolved, 0));
  const health = upper(input.calcioHealthStatus || input.healthStatus || '');
  const hardReasons = [];
  const advisoryReasons = [];
  const thresholdDiagnostics = [];

  // Patch 21: identità evento e mercato restano guardrail assoluti.
  if (input.requireIdentityCertification === true && identity.certified !== true) hardReasons.push(...identity.reasons);
  if (market.certified !== true) hardReasons.push(...market.reasons);

  // Le soglie legacy sono diagnostiche: entrano nell'IPM attraverso probabilità/edge/EV,
  // ma non possono più azzerare autonomamente uno stake con IPM >= 60 e Kelly positivo.
  if (probability < minProbability) thresholdDiagnostics.push(`probabilità ${round(probability, 2)}% sotto soglia legacy ${round(minProbability, 2)}%`);
  if (odd > maxOdd) thresholdDiagnostics.push(`quota ${round(odd, 2)} sopra quota massima legacy ${round(maxOdd, 2)}`);
  if (edge < minimumEdge) thresholdDiagnostics.push(`edge ${round(edge, 2)}% sotto soglia legacy ${round(minimumEdge, 2)}%`);

  // Solo anomalie strutturali, non etichette di rischio/qualità, restano veto.
  if (professional.includes('DATA_CORRUPT') || professional.includes('IDENTITY_CONFLICT') || professional.includes('TEAM_MATCH_FAILED')) {
    hardReasons.push('anomalia strutturale Professional Guard');
  }
  if (health.includes('ERROR') || health.includes('UNHEALTHY')) hardReasons.push('health Calcio non operativo');

  if (professional.includes('BLOCK') || professional.includes('WATCHLIST')) advisoryReasons.push(`Professional Guard ${professional}`);
  const qualityGeneratedByUnifiedIndex = upper(input.quality_stake_mode || input.stake_policy_mode || '').includes('UNIFIED_INDEX');
  if (!qualityGeneratedByUnifiedIndex && (qualityGate.includes('BLOCK') || qualityGate.includes('WATCHLIST') || qualityGate.includes('BLOCCATA'))) advisoryReasons.push(`Qualità/Gate ${qualityGate}`);
  if (timing.includes('EARLY') || timing.includes('WATCHLIST')) advisoryReasons.push(`Timing ${timing}`);
  if (historicalSample <= 0) advisoryReasons.push('nessun campione PT esatto: contributo neutrale 50/100');
  if (dataReliability.includes('PROXY') || dataReliability.includes('PRIOR_ONLY')) advisoryReasons.push('dati proxy/prior già pesati nell’IPM');
  advisoryReasons.push(...thresholdDiagnostics);

  const uniqueHardReasons = [...new Set(hardReasons.filter(Boolean))];
  const uniqueAdvisoryReasons = [...new Set(advisoryReasons.filter(Boolean))];
  const legacyThresholdsPassed = thresholdDiagnostics.length === 0;
  const certified = uniqueHardReasons.length === 0;
  return {
    version: CALCIO_DECISION_CERTIFICATION_VERSION,
    certified,
    capped: false,
    // Il campo resta true per compatibilità UI: indica che il contratto soglie è stato valutato,
    // non che le vecchie soglie abbiano autorità di veto.
    thresholdsCertified: true,
    thresholdsDiagnosticOnly: true,
    legacyThresholdsPassed,
    status: certified ? 'DECISION_STRUCTURALLY_CERTIFIED' : 'DECISION_ANALYSIS_ONLY',
    probability,
    odd,
    edge,
    minProbability,
    maxOdd,
    minimumEdge,
    historicalSample,
    identity,
    market,
    reasons: uniqueHardReasons,
    hardReasons: uniqueHardReasons,
    cautionReasons: uniqueAdvisoryReasons,
    advisoryReasons: uniqueAdvisoryReasons,
    thresholdDiagnostics,
    allReasons: [...uniqueHardReasons, ...uniqueAdvisoryReasons]
  };
}

function persistenceFields(certification = {}) {
  const guard = certification.guard || certification;
  const identity = guard.identity || certification.identity || {};
  const market = guard.market || certification.market || {};
  return {
    calcio_decision_certification_version: certification.version || guard.version || CALCIO_DECISION_CERTIFICATION_VERSION,
    calcio_decision_certification_status: certification.status || guard.status || 'DECISION_UNCERTIFIED',
    calcio_decision_certification_reason: (certification.reason || (guard.allReasons || guard.reasons || []).join(' · ')) || '',
    calcio_identity_certified: identity.certified ? 1 : 0,
    calcio_market_identity_certified: market.certified ? 1 : 0,
    calcio_thresholds_certified: guard.thresholdsCertified === true ? 1 : 0,
    calcio_provider_home_team: identity.providerHome || null,
    calcio_provider_away_team: identity.providerAway || null,
    calcio_historical_home_key: certification.historicalHomeKey || null,
    calcio_historical_away_key: certification.historicalAwayKey || null,
    calcio_prediction_confidence_score: nullableFinite(certification.confidenceScore),
    calcio_prediction_value_score: nullableFinite(certification.valueScore)
  };
}

module.exports = {
  CALCIO_DECISION_CERTIFICATION_VERSION,
  DEFAULT_MIN_PROBABILITY,
  DEFAULT_MAX_ODD,
  resolveHistoricalKey,
  marketFamily,
  expectedMarketKey,
  expectedOutcome,
  certifyMarket,
  certifyIdentity,
  operationalGuard,
  persistenceFields
};
