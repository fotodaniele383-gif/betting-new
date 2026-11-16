'use strict';

const crypto = require('crypto');
const historical = require('./tennisHistoricalPlayerStats');

const TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION = 'TENNIS_CANONICAL_PLAYER_EVIDENCE_V1_PATCH26';
const TENNIS_CANONICAL_PLAYER_EVIDENCE_MODE = 'DEEPSCAN_CONTEXT_ONLY_NO_MODEL_GATE_STAKE_AUTHORITY';

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 4) {
  const n = finite(value, null);
  return n === null ? null : Number(n.toFixed(decimals));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalizeTour(value) {
  const text = String(value || '').toUpperCase();
  if (text.includes('WTA') || text.includes('WOMEN')) return 'WTA';
  if (text.includes('ATP') || text.includes('MEN')) return 'ATP';
  return null;
}

function historicalTechnical(snapshot) {
  const m = snapshot?.metrics || {};
  if (snapshot?.tour !== 'ATP') return {
    servicePointsWon: null,
    returnPointsWon: null,
    firstServeIn: null,
    firstServePointsWon: null,
    secondServePointsWon: null,
    acesPerMatch: null,
    doubleFaultsPerMatch: null,
    breakPointsSaved: null,
    breakPointsConverted: null
  };
  return {
    servicePointsWon: finite(m.servicePointsWonPct, null),
    returnPointsWon: finite(m.returnPointsWonPct, null),
    firstServeIn: finite(m.firstServeInPct, null),
    firstServePointsWon: finite(m.firstServePointsWonPct, null),
    secondServePointsWon: finite(m.secondServePointsWonPct, null),
    acesPerMatch: finite(m.acesPerMatch, null),
    doubleFaultsPerMatch: finite(m.doubleFaultsPerMatch, null),
    breakPointsSaved: finite(m.breakPointsSavedPct, null),
    breakPointsConverted: finite(m.breakPointsConvertedPct, null)
  };
}

function deriveDominanceRatio(servicePointsWon, returnPointsWon) {
  const spw = finite(servicePointsWon, null);
  const rpw = finite(returnPointsWon, null);
  if (spw === null || rpw === null || spw <= 0 || spw >= 1) return null;
  return round(rpw / (1 - spw), 3);
}

function buildPlayerBridge(playerName, tour, asOf, matchEvidence = {}, options = {}) {
  const resolvedTour = normalizeTour(tour) || normalizeTour(matchEvidence?.tour) || null;
  let profile;
  try {
    profile = historical.getPlayerSnapshot(playerName, resolvedTour, asOf, {
      datasetPath: options.historicalDatasetPath,
      optional: true
    });
  } catch (error) {
    profile = { status: 'UNAVAILABLE', reason: `HISTORICAL_PROFILE_ERROR:${error.message}`, playerName };
  }

  const matchUsable = ['VERIFIED_CURRENT', 'VERIFIED_STALE', 'PARTIAL'].includes(String(matchEvidence?.status || ''));
  const profileUsable = profile?.status === 'AVAILABLE_AUXILIARY';
  const technical = historicalTechnical(profile);

  const servicePointsWon = finite(matchEvidence?.servePointsWon, technical.servicePointsWon);
  const returnPointsWon = finite(matchEvidence?.returnPointsWon, technical.returnPointsWon);
  const profileRank = finite(profile?.metrics?.rank, null);
  const profileElo = finite(profile?.metrics?.elo, null);
  const matchRank = finite(matchEvidence?.currentRank, null);
  const matchElo = finite(matchEvidence?.overallElo, null);
  const matchSourceCurrent = matchEvidence?.sourceFreshnessStatus === 'CURRENT';
  const currentRank = matchSourceCurrent ? finite(matchRank, profileRank) : finite(profileRank, matchRank);
  const overallElo = matchSourceCurrent ? finite(matchElo, profileElo) : finite(profileElo, matchElo);
  const sampleMatchLevel = finite(matchEvidence?.sampleTotal, 0);
  const sampleProfile = finite(profile?.sample, 0);
  const sample = Math.max(sampleMatchLevel, sampleProfile);
  const sourceFreshness = matchEvidence?.sourceFreshnessStatus || profile?.sourceFreshness?.status || 'UNAVAILABLE';
  const matchTechnicalCurrent = matchUsable && matchEvidence?.sourceFreshnessStatus === 'CURRENT';
  const profileCurrent = profileUsable && ['CURRENT', 'AGING'].includes(profile?.sourceFreshness?.status);
  const hasTechnical = servicePointsWon !== null && returnPointsWon !== null;
  const hasIdentityData = profileUsable || matchUsable;

  let status = 'UNAVAILABLE';
  if (matchTechnicalCurrent && profileCurrent) status = 'CURRENT_COMPOSITE';
  else if (matchTechnicalCurrent) status = 'CURRENT_MATCH_LEVEL';
  else if (profileCurrent && resolvedTour === 'WTA' && !matchTechnicalCurrent) status = 'CURRENT_PROFILE_STALE_TECHNICAL';
  else if (profileCurrent && hasTechnical) status = 'CURRENT_AUXILIARY_TECHNICAL';
  else if (profileCurrent) status = 'CURRENT_AUXILIARY';
  else if (hasIdentityData) status = 'STALE_COMPOSITE';

  const sources = [];
  if (matchUsable) sources.push({
    id: 'MATCH_LEVEL_LOCAL',
    status: matchEvidence.status,
    freshness: matchEvidence.sourceFreshnessStatus || null,
    providerId: matchEvidence.sourceProviderId || null,
    sample: sampleMatchLevel || 0
  });
  if (profileUsable) sources.push({
    id: 'TENNISDB_CANONICAL_XLSX',
    status: profile.status,
    freshness: profile.sourceFreshness?.status || null,
    datasetId: historical.getStatus({ initialize: true }).datasetId || null,
    season: profile.season || null,
    sample: sampleProfile || 0,
    identityResolution: profile.identityResolution || null
  });

  const technicalCoverage = [servicePointsWon, returnPointsWon, finite(matchEvidence?.firstServeIn, technical.firstServeIn), finite(matchEvidence?.firstServePointsWon, technical.firstServePointsWon), finite(matchEvidence?.secondServePointsWon, technical.secondServePointsWon)]
    .filter(v => v !== null).length / 5;
  const identityCoverage = [currentRank, overallElo, profile?.country || matchEvidence?.country || null].filter(v => v !== null && v !== undefined).length / 3;
  const coverageScore = hasIdentityData ? clamp(25 + technicalCoverage * 45 + identityCoverage * 20 + Math.min(10, sample / 4), 0, 100) : 0;
  const confidenceScore = clamp(Math.min(
    finite(matchEvidence?.confidenceScore, matchUsable ? 40 : 100),
    profileUsable ? finite(profile.confidenceScore, 40) : 100,
    coverageScore
  ), 0, 100);

  const core = {
    version: TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION,
    mode: TENNIS_CANONICAL_PLAYER_EVIDENCE_MODE,
    status,
    playerName: String(playerName || ''),
    canonicalPlayerName: profileUsable ? profile.playerName : (matchEvidence?.playerName || playerName),
    normalizedName: profile?.normalizedName || matchEvidence?.normalizedName || null,
    identityResolution: profile?.identityResolution || matchEvidence?.identityStatus || 'UNAVAILABLE',
    tour: resolvedTour,
    season: profile?.season || null,
    asOfAt: asOf ? new Date(asOf).toISOString() : null,
    sourceFreshness,
    currentRank,
    overallElo,
    wins: finite(profile?.metrics?.wins, null),
    losses: finite(profile?.metrics?.losses, null),
    winPct: finite(profile?.metrics?.winPct, null),
    setWinPct: finite(profile?.metrics?.setWinPct, null),
    strengthOfSchedulePct: finite(profile?.metrics?.strengthOfSchedulePct, null),
    winsVsExpected: finite(profile?.metrics?.winsVsExpected, null),
    sample,
    // R20: distinguish match-level technical sample from auxiliary season summary.
    matchLevelSample: sampleMatchLevel,
    auxiliaryProfileSample: sampleProfile,
    qualityGateSampleEligible: matchTechnicalCurrent && sampleMatchLevel >= 10,
    servicePointsWon,
    returnPointsWon,
    dominanceRatio: deriveDominanceRatio(servicePointsWon, returnPointsWon),
    firstServeIn: finite(matchEvidence?.firstServeIn, technical.firstServeIn),
    firstServePointsWon: finite(matchEvidence?.firstServePointsWon, technical.firstServePointsWon),
    secondServePointsWon: finite(matchEvidence?.secondServePointsWon, technical.secondServePointsWon),
    acesPerMatch: finite(matchEvidence?.acesPerMatch, technical.acesPerMatch),
    doubleFaultsPerMatch: finite(matchEvidence?.doubleFaultsPerMatch, technical.doubleFaultsPerMatch),
    breakPointsSaved: finite(matchEvidence?.breakPointsSaved, technical.breakPointsSaved),
    breakPointsConverted: finite(profile?.metrics?.breakPointsConvertedPct, null),
    coverageScore: round(coverageScore, 2),
    confidenceScore: round(confidenceScore, 2),
    sources,
    warnings: [
      ...(profile?.reason ? [profile.reason] : []),
      ...(status === 'CURRENT_PROFILE_STALE_TECHNICAL' ? ['WTA_PROFILE_CURRENT_MATCH_LEVEL_TECHNICAL_STALE'] : []),
      ...(!hasTechnical ? ['TECHNICAL_SERVICE_RETURN_UNAVAILABLE'] : [])
    ],
    authority: {
      identity: true,
      display: true,
      deepScanContext: true,
      modelProbability: false,
      qualityGate: false,
      stake: false,
      settlement: false
    }
  };
  return { ...core, evidenceHash: sha256(core) };
}

function buildMatchupBridge(player1, player2, tour, asOf, matchEvidence = {}, options = {}) {
  const p1 = buildPlayerBridge(player1, tour, asOf, matchEvidence?.p1 || {}, options);
  const p2 = buildPlayerBridge(player2, tour, asOf, matchEvidence?.p2 || {}, options);
  const available = [p1, p2].filter(p => p.status !== 'UNAVAILABLE').length;
  const status = available === 2
    ? ([p1.status, p2.status].some(s => s.includes('STALE')) ? 'READY_WITH_STALE_TECHNICAL' : 'READY')
    : available === 1 ? 'PARTIAL' : 'UNAVAILABLE';
  const score = available ? round(Math.min(p1.coverageScore || 0, p2.coverageScore || 0), 2) : 0;
  const core = {
    version: TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION,
    mode: TENNIS_CANONICAL_PLAYER_EVIDENCE_MODE,
    status,
    score,
    player1: String(player1 || ''),
    player2: String(player2 || ''),
    tour: normalizeTour(tour),
    asOfAt: asOf ? new Date(asOf).toISOString() : null,
    p1,
    p2,
    authority: {
      identity: true,
      display: true,
      deepScanContext: true,
      modelProbability: false,
      qualityGate: false,
      stake: false,
      settlement: false
    }
  };
  return { ...core, evidenceHash: sha256(core) };
}

function getHealth(options = {}) {
  const historicalStatus = historical.getStatus({ datasetPath: options.historicalDatasetPath, initialize: true });
  return {
    success: historicalStatus.loaded === true,
    status: historicalStatus.loaded ? 'READY' : 'UNAVAILABLE',
    version: TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION,
    mode: TENNIS_CANONICAL_PLAYER_EVIDENCE_MODE,
    historicalStatus,
    authority: {
      deepScanContext: true,
      modelProbability: false,
      qualityGate: false,
      stake: false,
      settlement: false
    }
  };
}

module.exports = {
  TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION,
  TENNIS_CANONICAL_PLAYER_EVIDENCE_MODE,
  buildPlayerBridge,
  buildMatchupBridge,
  deriveDominanceRatio,
  getHealth,
  normalizeTour
};
