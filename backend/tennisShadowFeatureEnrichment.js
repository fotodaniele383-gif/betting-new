'use strict';

const crypto = require('crypto');

const AUDIT16D_R3_T3_REVISION = 'AUDIT16D_R3_T3_TENNIS_SHADOW_FEATURE_ENRICHMENT_FORWARD_INTELLIGENCE_V1';
const TENNIS_SHADOW_FEATURE_SNAPSHOT_VERSION = 'TENNIS_SHADOW_FEATURE_SNAPSHOT_V1_AUDIT16D_R3_T3';
const TENNIS_FORWARD_SEGMENT_INTELLIGENCE_VERSION = 'TENNIS_FORWARD_SEGMENT_INTELLIGENCE_V1_AUDIT16D_R3_T3';
const MODE = 'SHADOW_CAPTURE_ONLY_NO_PRODUCTION_GATE_STAKE_AUTHORITY';
const DEFAULT_THRESHOLDS = Object.freeze({
  minimumSegmentSettled: 30,
  minimumOverallSettled: 60,
  windowSize: 30,
  minimumFeatureCoveragePct: 60
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 4) {
  const n = finite(value, null);
  return n === null ? null : Number(n.toFixed(decimals));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function safeJson(value, fallback = null) { try { return JSON.parse(value); } catch (_) { return fallback; } }

function normalizeTour(value) {
  const v = upper(value);
  if (v.includes('WTA')) return 'WTA';
  if (v.includes('ATP')) return 'ATP';
  return 'UNKNOWN';
}
function normalizeSurface(value) {
  const v = upper(value);
  if (v.includes('CLAY') || v.includes('TERRA')) return 'CLAY';
  if (v.includes('GRASS') || v.includes('ERBA')) return 'GRASS';
  if (v.includes('CARPET')) return 'CARPET';
  if (v.includes('HARD') || v.includes('CEMENT') || v.includes('ACRYLIC')) return 'HARD';
  return v || 'UNKNOWN';
}
function normalizeCompetitionSegment(input = {}) {
  const blob = upper([input.targetId, input.tourType, input.league, input.tournamentLevel, input.tournamentCategory, input.tournamentName].filter(Boolean).join(' '));
  if (blob.includes('CHALL') || blob.includes('ATP_QUAL_CHALL')) return 'CHALLENGER';
  if (blob.includes('QUAL')) return 'QUALIFYING';
  if (blob.includes('ITF')) return 'ITF';
  if (blob.includes('WTA') || blob.includes('ATP') || blob.includes('MAIN')) return 'MAIN';
  return 'UNKNOWN';
}
function normalizeRound(value) {
  const v = upper(value).replace(/\s+/g, ' ');
  if (!v) return 'UNKNOWN';
  if (v === 'F' || v.includes('FINAL')) return v.includes('SEMI') ? 'SF' : 'F';
  if (v === 'SF' || v.includes('SEMI')) return 'SF';
  if (v === 'QF' || v.includes('QUARTER')) return 'QF';
  if (/R(?:OUND)?\s*16|1\/8|EIGHTH/.test(v)) return 'R16';
  if (/R(?:OUND)?\s*32/.test(v)) return 'R32';
  if (/R(?:OUND)?\s*64/.test(v)) return 'R64';
  if (/R(?:OUND)?\s*128/.test(v)) return 'R128';
  if (v.includes('QUAL')) return 'Q';
  return v.slice(0, 24);
}
function roundBucket(value) {
  const r = normalizeRound(value);
  if (['F', 'SF', 'QF'].includes(r)) return 'LATE';
  if (['R16', 'R32'].includes(r)) return 'MID';
  if (r === 'Q') return 'QUALIFYING';
  if (['R64', 'R128'].includes(r)) return 'EARLY';
  return 'UNKNOWN';
}
function normalizeTournamentLevel(value) {
  const v = upper(value);
  if (!v) return 'UNKNOWN';
  if (v.includes('GRAND SLAM') || v === 'G' || v.includes('SLAM')) return 'GRAND_SLAM';
  if (v.includes('MASTERS') || v.includes('1000')) return 'MASTERS_1000';
  if (v.includes('500')) return '500';
  if (v.includes('250')) return '250';
  if (v.includes('CHALL')) return 'CHALLENGER';
  if (v.includes('ITF')) return 'ITF';
  return v.slice(0, 32);
}
function oddsBucket(value) {
  const odd = finite(value, null);
  if (!(odd > 1)) return 'ODDS_UNKNOWN';
  if (odd <= 1.50) return 'ODDS_1.01_1.50';
  if (odd <= 1.80) return 'ODDS_1.51_1.80';
  if (odd <= 2.20) return 'ODDS_1.81_2.20';
  if (odd <= 3.00) return 'ODDS_2.21_3.00';
  return 'ODDS_GT_3.00';
}
function probabilityBucket(value) {
  const p = finite(value, null);
  if (p === null) return 'PROB_UNKNOWN';
  if (p < 50) return 'PROB_LT_50';
  if (p < 60) return 'PROB_50_59';
  if (p < 70) return 'PROB_60_69';
  if (p < 80) return 'PROB_70_79';
  return 'PROB_80_PLUS';
}
function diff(a, b) {
  const x = finite(a, null); const y = finite(b, null);
  return x === null || y === null ? null : round(x - y, 6);
}
function ratioLogRank(p1, p2) {
  const a = finite(p1, null); const b = finite(p2, null);
  if (!(a > 0) || !(b > 0)) return null;
  return round(Math.log((b + 1) / (a + 1)), 6);
}
function marketIsForwardEvaluable(marketType, selectedSide) {
  if (!['P1', 'P2'].includes(upper(selectedSide))) return false;
  const m = upper(marketType);
  if (!m) return true;
  if (m.includes('TOTAL') || m.includes('OVER') || m.includes('UNDER') || m.includes('GAME') || m.includes('SET')) return false;
  return m.includes('H2H') || m.includes('MONEY') || m.includes('WINNER') || m.includes('MATCH') || m.includes('SINGLE') || m === '1X2';
}
function featureCoverage(vector) {
  const keys = Object.keys(vector);
  const available = keys.filter(k => finite(vector[k], null) !== null).length;
  return { expected: keys.length, available, pct: keys.length ? round(available / keys.length * 100, 2) : 0 };
}

function buildShadowFeatureSnapshot(input = {}) {
  const row = input.row || {};
  const bet = input.bet || {};
  const options = input.options || {};
  const matchup = input.matchup || {};
  const challenger = input.challenger || {};
  const p1 = matchup.p1 || {};
  const p2 = matchup.p2 || {};
  const tour = normalizeTour(options.tour || bet.tourType || bet.tour_type || row.tour_type || bet.league || row.league);
  const targetId = matchup.sourceTargetId || p1.sourceTargetId || p2.sourceTargetId || null;
  const surface = normalizeSurface(bet.surface || row.surface || matchup.surface);
  const tournamentLevel = normalizeTournamentLevel(bet.tournamentLevel || bet.tournament_level || bet.tournamentCategory || bet.tournament_category || row.tournament_level || row.tournament_category || row.level);
  const tournamentRound = normalizeRound(bet.round || bet.tournamentRound || bet.tournament_round || bet.stage || row.round || row.tournament_round || row.stage || matchup.tournamentRound);
  const competitionSegment = normalizeCompetitionSegment({
    targetId,
    tourType: options.tour || bet.tourType || bet.tour_type || row.tour_type,
    league: bet.league || row.league,
    tournamentLevel,
    tournamentCategory: bet.tournamentCategory || bet.tournament_category || row.tournament_category,
    tournamentName: bet.tournamentName || bet.tournament_name || row.tournament_name
  });
  const selectedSide = upper(challenger.selectedSide || (text(bet.prediction || row.prediction) === '2' ? 'P2' : text(bet.prediction || row.prediction) === '1' ? 'P1' : '')) || null;
  const openingOdd = finite(bet.openingOdd ?? bet.opening_odd ?? bet.odd ?? row.opening_odd ?? row.odd, null);
  const marketType = text(challenger.marketType || bet.marketType || bet.market_type || row.market_type || 'h2h');
  const featureVector = {
    rankDifferenceP1MinusP2: diff(p1.currentRank, p2.currentRank),
    rankingAdvantageLogP1: ratioLogRank(p1.currentRank, p2.currentRank),
    overallEloDeltaP1: diff(p1.overallElo, p2.overallElo),
    surfaceEloDeltaP1: diff(p1.surfaceElo, p2.surfaceElo),
    recentWinRateDeltaP1: diff(p1.recentWinRate, p2.recentWinRate),
    recentQualityDeltaP1: diff(p1.recentQualityScore, p2.recentQualityScore),
    surfaceWinRateDeltaP1: diff(p1.surfaceWinRate, p2.surfaceWinRate),
    servePointsWonDeltaP1: diff(p1.servePointsWon, p2.servePointsWon),
    returnPointsWonDeltaP1: diff(p1.returnPointsWon, p2.returnPointsWon),
    firstServeWonDeltaP1: diff(p1.firstServeWon, p2.firstServeWon),
    secondServeWonDeltaP1: diff(p1.secondServeWon, p2.secondServeWon),
    aceRateDeltaP1: diff(p1.aceRate, p2.aceRate),
    doubleFaultRateDeltaP1: diff(p1.doubleFaultRate, p2.doubleFaultRate),
    holdProxyDeltaP1: diff(p1.holdProxy, p2.holdProxy),
    breakProxyDeltaP1: diff(p1.breakProxy, p2.breakProxy),
    breakPointsSavedDeltaP1: diff(p1.breakPointsSaved, p2.breakPointsSaved),
    decidingSetWinRateDeltaP1: diff(p1.decidingSetWinRate, p2.decidingSetWinRate),
    tiebreakWinRateDeltaP1: diff(p1.tiebreakWinRate, p2.tiebreakWinRate),
    fatigueScoreDeltaP1: diff(p1.fatigueScore, p2.fatigueScore),
    restDaysDeltaP1: diff(p1.restDays, p2.restDays),
    matches14dDeltaP1: diff(p1.matches14d, p2.matches14d),
    h2hNetP1: finite(matchup.h2h?.p1Wins, 0) - finite(matchup.h2h?.p2Wins, 0),
    matchupFeatureProbabilityP1: finite(matchup.featureProbabilityP1, null),
    challengerProbabilityP1Pct: finite(challenger.challengerProbabilityP1, null),
    productionProbabilityP1Pct: finite(challenger.productionProbabilityP1, null)
  };
  const coverage = featureCoverage(featureVector);
  const sourceFreshnessStatus = upper(matchup.sourceFreshnessStatus || p1.sourceFreshnessStatus || p2.sourceFreshnessStatus || 'UNKNOWN');
  const sourceFreshnessDays = Math.max(finite(p1.sourceFreshnessDays, 0), finite(p2.sourceFreshnessDays, 0), finite(matchup.sourceFreshnessDays, 0));
  const temporalStatus = upper(options.snapshotStatus || 'VALID_PREMATCH');
  const temporalSafe = temporalStatus !== 'POST_START_INVALID' && temporalStatus !== 'TEMPORAL_LEAKAGE_BLOCKED';
  const currentData = sourceFreshnessStatus === 'CURRENT';
  const minimumCoverage = coverage.pct >= DEFAULT_THRESHOLDS.minimumFeatureCoveragePct;
  const forwardEligible = temporalSafe && marketIsForwardEvaluable(marketType, selectedSide) && finite(challenger.selectedChallengerProbability, null) !== null;
  const primarySegmentKey = [tour, competitionSegment, surface, oddsBucket(openingOdd)].join('|');
  const reviewSegmentKey = [primarySegmentKey, tournamentLevel, roundBucket(tournamentRound), probabilityBucket(challenger.selectedChallengerProbability)].join('|');
  const core = {
    version: TENNIS_SHADOW_FEATURE_SNAPSHOT_VERSION,
    audit16dRevision: AUDIT16D_R3_T3_REVISION,
    mode: MODE,
    predictionSnapshotId: text(options.snapshotId) || null,
    betId: finite(row.id ?? options.betId, null),
    asOfAt: matchup.asOfAt || bet.canonical_match_datetime || row.canonical_match_datetime || bet.date || row.match_date || null,
    temporalStatus,
    temporalLeakageGuard: true,
    temporalSafe,
    dimensions: {
      tour,
      competitionSegment,
      targetId,
      surface,
      tournamentLevel,
      tournamentRound,
      roundBucket: roundBucket(tournamentRound),
      marketType: marketType || 'UNKNOWN',
      selectedSide,
      openingOdd: round(openingOdd, 4),
      oddsBucket: oddsBucket(openingOdd),
      selectedChallengerProbabilityPct: round(challenger.selectedChallengerProbability, 4),
      selectedProductionProbabilityPct: round(challenger.selectedProductionProbability, 4),
      probabilityBucket: probabilityBucket(challenger.selectedChallengerProbability),
      cohortId: options.cohort?.cohort_id || null,
      cohortRole: options.cohort?.cohort_role || null
    },
    primarySegmentKey,
    reviewSegmentKey,
    featureVector,
    featureCoverage: coverage,
    evidenceQuality: {
      matchupStatus: matchup.status || null,
      matchupLabel: matchup.matchupLabel || null,
      coverageScore: round(matchup.coverageScore, 2),
      confidenceScore: round(matchup.confidenceScore, 2),
      sourceProviderId: matchup.sourceProviderId || p1.sourceProviderId || p2.sourceProviderId || null,
      sourceFreshnessStatus,
      sourceFreshnessDays: round(sourceFreshnessDays, 2),
      currentData,
      minimumFeatureCoverageMet: minimumCoverage,
      activityRiskStatus: matchup.activityRiskStatus || null
    },
    forwardCapture: {
      eligible: forwardEligible,
      reason: !temporalSafe ? 'TEMPORAL_GUARD_BLOCKED' : !marketIsForwardEvaluable(marketType, selectedSide) ? 'MARKET_NOT_FORWARD_EVALUABLE' : finite(challenger.selectedChallengerProbability, null) === null ? 'SELECTED_PROBABILITY_MISSING' : 'ELIGIBLE_FUTURE_SETTLEMENT',
      historicalBackfill: false,
      futureOnly: true,
      minimumSegmentSettled: DEFAULT_THRESHOLDS.minimumSegmentSettled,
      minimumOverallSettled: DEFAULT_THRESHOLDS.minimumOverallSettled,
      twoWindowSize: DEFAULT_THRESHOLDS.windowSize
    },
    authority: {
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false,
      automaticDemotion: false,
      historicalBetMutation: false
    }
  };
  return { ...core, featureSnapshotHash: sha256(core) };
}

function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)); }
  catch (_) { return false; }
}
function tableColumns(db, table) {
  if (!tableExists(db, table)) return new Set();
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
  catch (_) { return new Set(); }
}
function mean(values) {
  const xs = values.filter(v => finite(v, null) !== null).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function evaluateRows(rows, thresholds = DEFAULT_THRESHOLDS) {
  const settled = rows.filter(r => ['WON', 'LOST'].includes(upper(r.status)) && r.snapshot?.forwardCapture?.eligible === true);
  const metricsFor = sample => {
    let wins = 0; const challengerBrier = []; const productionBrier = []; let stakeSum = 0; let profitSum = 0; let profitRows = 0; const clv = [];
    for (const row of sample) {
      const y = upper(row.status) === 'WON' ? 1 : 0; if (y) wins += 1;
      const cp = finite(row.challengerProbability, null); const pp = finite(row.productionProbability, null);
      if (cp !== null) challengerBrier.push((clamp(cp / 100, 0, 1) - y) ** 2);
      if (pp !== null) productionBrier.push((clamp(pp / 100, 0, 1) - y) ** 2);
      const stake = finite(row.stake, null); const profit = finite(row.profit, null);
      if (stake !== null && stake > 0 && profit !== null) { stakeSum += stake; profitSum += profit; profitRows += 1; }
      const clvValue = finite(row.clv, null); if (clvValue !== null) clv.push(clvValue);
    }
    const cb = mean(challengerBrier); const pb = mean(productionBrier);
    return {
      rows: sample.length,
      wins,
      losses: sample.length - wins,
      hitRatePct: sample.length ? round(wins / sample.length * 100, 2) : null,
      challengerBrier: round(cb, 6),
      productionBrier: round(pb, 6),
      brierImprovementVsProduction: cb === null || pb === null ? null : round(pb - cb, 6),
      roiPct: profitRows && stakeSum > 0 ? round(profitSum / stakeSum * 100, 2) : null,
      profitRows,
      meanClv: round(mean(clv), 4),
      clvRows: clv.length
    };
  };
  const all = metricsFor(settled);
  const sorted = [...settled].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const w = thresholds.windowSize;
  const recentRows = sorted.length >= w ? sorted.slice(-w) : [];
  const previousRows = sorted.length >= w * 2 ? sorted.slice(-w * 2, -w) : [];
  const recent = metricsFor(recentRows); const previous = metricsFor(previousRows);
  const enoughSegment = settled.length >= thresholds.minimumSegmentSettled;
  const twoWindows = recent.rows >= w && previous.rows >= w;
  const recentPositive = recent.brierImprovementVsProduction !== null && recent.brierImprovementVsProduction > 0;
  const previousPositive = previous.brierImprovementVsProduction !== null && previous.brierImprovementVsProduction > 0;
  const recentNegative = recent.brierImprovementVsProduction !== null && recent.brierImprovementVsProduction <= 0;
  const previousNegative = previous.brierImprovementVsProduction !== null && previous.brierImprovementVsProduction <= 0;
  let reviewStatus = 'INSUFFICIENT_FORWARD_EVIDENCE';
  if (enoughSegment && !twoWindows) reviewStatus = 'SINGLE_WINDOW_REVIEW_ONLY';
  if (twoWindows && recentPositive && previousPositive) reviewStatus = 'POSITIVE_TWO_WINDOW_REVIEW_CANDIDATE';
  else if (twoWindows && recentNegative && previousNegative) reviewStatus = 'DEGRADATION_REVIEW_CANDIDATE';
  else if (twoWindows) reviewStatus = 'MIXED_EVIDENCE_REVIEW_REQUIRED';
  return {
    ...all,
    windows: { windowSize: w, previous, recent, twoWindowsAvailable: twoWindows },
    reviewStatus,
    promotionAuthority: false,
    demotionAuthority: false,
    manualReviewRequired: true
  };
}

function summarizeForwardShadowEvidence(db, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const required = ['tennis_challenger_predictions', 'ai_forward_test'];
  const missingTables = required.filter(t => !tableExists(db, t));
  if (missingTables.length) {
    return {
      success: false,
      version: TENNIS_FORWARD_SEGMENT_INTELLIGENCE_VERSION,
      audit16dRevision: AUDIT16D_R3_T3_REVISION,
      status: 'SCHEMA_MISSING',
      missingTables,
      readOnly: true,
      historicalBackfill: false,
      authority: { automaticPromotion: false, automaticDemotion: false, productionProbability: false, qualityGate: false, stake: false }
    };
  }
  const sourceCols = tableColumns(db, 'ai_forward_test');
  const clvExpr = sourceCols.has('clv_pct') ? 'a.clv_pct' : sourceCols.has('clv') ? 'a.clv' : 'NULL';
  const stakeExpr = sourceCols.has('stake') ? 'a.stake' : 'NULL';
  const profitExpr = sourceCols.has('profit') ? 'a.profit' : 'NULL';
  const rows = db.prepare(`SELECT c.bet_id,c.created_at,c.selected_challenger_probability,c.selected_production_probability,c.payload_json,
      a.status,${stakeExpr} stake,${profitExpr} profit,${clvExpr} clv
      FROM tennis_challenger_predictions c LEFT JOIN ai_forward_test a ON a.id=c.bet_id
      ORDER BY c.created_at,c.bet_id`).all();
  const t3 = [];
  for (const row of rows) {
    const payload = safeJson(row.payload_json, null);
    const snapshot = payload?.shadowFeatureSnapshot || payload?.t3ShadowFeatureSnapshot || null;
    if (!snapshot || snapshot.version !== TENNIS_SHADOW_FEATURE_SNAPSHOT_VERSION) continue;
    t3.push({
      betId: Number(row.bet_id), createdAt: row.created_at, status: row.status,
      stake: row.stake, profit: row.profit, clv: row.clv,
      challengerProbability: finite(row.selected_challenger_probability ?? payload?.selectedChallengerProbability, null),
      productionProbability: finite(row.selected_production_probability ?? payload?.selectedProductionProbability, null),
      snapshot
    });
  }
  const settled = t3.filter(r => ['WON', 'LOST'].includes(upper(r.status)) && r.snapshot?.forwardCapture?.eligible === true);
  const byKey = new Map();
  for (const row of settled) {
    const key = row.snapshot.primarySegmentKey || 'UNKNOWN';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const segments = [...byKey.entries()].map(([segmentKey, segmentRows]) => ({
    segmentKey,
    dimensions: segmentRows[0]?.snapshot?.dimensions || null,
    ...evaluateRows(segmentRows, thresholds)
  })).sort((a, b) => b.rows - a.rows || a.segmentKey.localeCompare(b.segmentKey));
  const overall = evaluateRows(settled, { ...thresholds, minimumSegmentSettled: thresholds.minimumOverallSettled });
  return {
    success: true,
    version: TENNIS_FORWARD_SEGMENT_INTELLIGENCE_VERSION,
    audit16dRevision: AUDIT16D_R3_T3_REVISION,
    mode: MODE,
    status: !t3.length ? 'WAITING_FOR_FIRST_T3_FORWARD_SNAPSHOT' : !settled.length ? 'CAPTURING_UNSETTLED_T3_SNAPSHOTS' : overall.rows < thresholds.minimumOverallSettled ? 'ACCUMULATING_FORWARD_EVIDENCE' : 'FORWARD_REVIEW_AVAILABLE',
    readOnly: true,
    historicalBackfill: false,
    t3Snapshots: t3.length,
    settledForwardRows: settled.length,
    thresholds,
    overall,
    segments,
    authority: {
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false,
      automaticDemotion: false,
      historicalBetMutation: false
    },
    note: 'T3 misura solo nuovi snapshot forward con feature congelate al momento della previsione. Nessun backfill storico e nessuna promozione/retrocessione automatica.'
  };
}

module.exports = {
  AUDIT16D_R3_T3_REVISION,
  TENNIS_SHADOW_FEATURE_SNAPSHOT_VERSION,
  TENNIS_FORWARD_SEGMENT_INTELLIGENCE_VERSION,
  MODE,
  DEFAULT_THRESHOLDS,
  normalizeTour,
  normalizeSurface,
  oddsBucket,
  probabilityBucket,
  buildShadowFeatureSnapshot,
  summarizeForwardShadowEvidence
};
