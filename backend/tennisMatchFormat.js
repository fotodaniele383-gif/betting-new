'use strict';

/**
 * PATCH 2 - Tennis Match Format Contract
 *
 * Resolves the maximum number of sets without inferring BO5 from a generic
 * "Grand Slam" title alone. The contract is deliberately conservative:
 * ambiguous, qualifying and doubles contexts default to BO3.
 */

const TENNIS_MATCH_FORMAT_CONTRACT_VERSION = 'TENNIS_MATCH_FORMAT_CONTRACT_V1_PATCH_2';

const GRAND_SLAM_PATTERNS = Object.freeze([
  /\bgrand\s*slam\b/i,
  /\baustralian\s+open\b/i,
  /\bfrench\s+open\b/i,
  /\broland\s+garros\b/i,
  /\bwimbledon\b/i,
  /\bu\.?s\.?\s+open\b/i,
  /\bunited\s+states\s+open\b/i
]);

const QUALIFYING_PATTERN = /\b(qualif(?:ying|ication|ier|iers|y)?|pre[-\s]?qualif|q[1-3])\b/i;
const DOUBLES_PATTERN = /\b(doubles?|mixed\s+doubles?|dobles|duplas)\b/i;

function compactText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBestOf(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number(value) === 3) return 3;
  if (Number(value) === 5) return 5;

  const text = compactText(value).toLowerCase();
  if (/\b(?:best\s*of|bo)\s*[-:]?\s*3\b/.test(text)) return 3;
  if (/\b(?:best\s*of|bo)\s*[-:]?\s*5\b/.test(text)) return 5;
  return null;
}

function inferTourType({ tourType, sportKey, sportTitle, tournament, series } = {}) {
  const explicit = compactText(tourType).toUpperCase();
  if (explicit === 'ATP' || explicit === 'MEN' || explicit === "MEN'S") return 'ATP';
  if (explicit === 'WTA' || explicit === 'WOMEN' || explicit === "WOMEN'S") return 'WTA';

  const key = compactText(sportKey).toLowerCase();
  if (/(^|\W)wta(\W|$)/.test(key)) return 'WTA';
  if (/(^|\W)atp(\W|$)/.test(key)) return 'ATP';

  const text = compactText([sportTitle, tournament, series].filter(Boolean).join(' ')).toUpperCase();
  if (/(^|\W)WTA(\W|$)/.test(text) || /\bWOMEN(?:'S)?\b/.test(text)) return 'WTA';
  if (/(^|\W)ATP(\W|$)/.test(text) || /\bMEN(?:'S)?\b/.test(text)) return 'ATP';
  return 'UNKNOWN';
}

function resolveCertifiedProviderBestOf(input = {}) {
  const match = input.match && typeof input.match === 'object' ? input.match : {};
  const directValue = input.providerBestOf;
  const candidateValue = directValue ??
    match.best_of ??
    match.bestOf ??
    match.best_of_sets ??
    match.bestOfSets ??
    null;

  const certified = input.providerCertified === true ||
    match.best_of_certified === true ||
    match.bestOfCertified === true ||
    match.best_of_sets_certified === true ||
    match.bestOfSetsCertified === true;

  if (!certified) return null;
  const bestOf = parseBestOf(candidateValue);
  if (bestOf !== 3 && bestOf !== 5) return null;

  return {
    bestOf,
    source: String(input.providerSource || match.best_of_source || match.bestOfSource || 'CERTIFIED_PROVIDER').trim(),
    rawValue: candidateValue
  };
}

function resolveTennisMatchFormat(input = {}) {
  const match = input.match && typeof input.match === 'object' ? input.match : {};
  const contextText = compactText([
    input.sportTitle,
    input.tournament,
    input.series,
    input.sportKey,
    input.round,
    match.name,
    match.title,
    match.description,
    match.round,
    match.stage,
    match.category
  ].filter(Boolean).join(' '));

  const tourType = inferTourType(input);
  const isGrandSlam = GRAND_SLAM_PATTERNS.some(pattern => pattern.test(contextText));
  const isQualifying = QUALIFYING_PATTERN.test(contextText);
  const isDoubles = DOUBLES_PATTERN.test(contextText);
  const certifiedProvider = resolveCertifiedProviderBestOf(input);

  if (certifiedProvider) {
    return Object.freeze({
      bestOf: certifiedProvider.bestOf,
      source: 'CERTIFIED_PROVIDER',
      reason: 'EXPLICIT_CERTIFIED_PROVIDER_FORMAT',
      providerSource: certifiedProvider.source,
      providerRawValue: certifiedProvider.rawValue,
      tourType,
      isGrandSlam,
      isQualifying,
      isDoubles,
      confidence: 'HIGH',
      contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
    });
  }

  if (isDoubles) {
    return Object.freeze({
      bestOf: 3,
      source: 'CONSERVATIVE_RULE',
      reason: 'DOUBLES_OR_MIXED_DOUBLES_BO3',
      providerSource: null,
      providerRawValue: null,
      tourType,
      isGrandSlam,
      isQualifying,
      isDoubles,
      confidence: 'HIGH',
      contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
    });
  }

  if (isQualifying) {
    return Object.freeze({
      bestOf: 3,
      source: 'CONSERVATIVE_RULE',
      reason: 'QUALIFYING_BO3',
      providerSource: null,
      providerRawValue: null,
      tourType,
      isGrandSlam,
      isQualifying,
      isDoubles,
      confidence: 'HIGH',
      contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
    });
  }

  if (isGrandSlam && tourType === 'ATP') {
    return Object.freeze({
      bestOf: 5,
      source: 'TOUR_TOURNAMENT_RULE',
      reason: 'ATP_GRAND_SLAM_MAIN_DRAW_SINGLES_BO5',
      providerSource: null,
      providerRawValue: null,
      tourType,
      isGrandSlam,
      isQualifying,
      isDoubles,
      confidence: 'HIGH',
      contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
    });
  }

  if (isGrandSlam && tourType === 'WTA') {
    return Object.freeze({
      bestOf: 3,
      source: 'TOUR_TOURNAMENT_RULE',
      reason: 'WTA_GRAND_SLAM_SINGLES_BO3',
      providerSource: null,
      providerRawValue: null,
      tourType,
      isGrandSlam,
      isQualifying,
      isDoubles,
      confidence: 'HIGH',
      contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
    });
  }

  return Object.freeze({
    bestOf: 3,
    source: tourType === 'UNKNOWN' ? 'CONSERVATIVE_FALLBACK' : 'TOUR_DEFAULT_RULE',
    reason: isGrandSlam
      ? 'AMBIGUOUS_GRAND_SLAM_SAFE_BO3'
      : 'STANDARD_TOUR_EVENT_BO3',
    providerSource: null,
    providerRawValue: null,
    tourType,
    isGrandSlam,
    isQualifying,
    isDoubles,
    confidence: tourType === 'UNKNOWN' ? 'MEDIUM' : 'HIGH',
    contractVersion: TENNIS_MATCH_FORMAT_CONTRACT_VERSION
  });
}

module.exports = {
  TENNIS_MATCH_FORMAT_CONTRACT_VERSION,
  GRAND_SLAM_PATTERNS,
  parseBestOf,
  inferTourType,
  resolveCertifiedProviderBestOf,
  resolveTennisMatchFormat
};
