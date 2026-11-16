'use strict';

const crypto = require('crypto');
const Markov = require('./markov');
const Simulation = require('./simulation');
const StageModel = require('./tennisTournamentStageModel');

const TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION = 'TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_V1_PATCH19';
const TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_SCHEMA_VERSION = 'TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_SCHEMA_V1_PATCH19';
const MODE = 'ANALYSIS_ADVISORY_BEST_AVAILABLE_NO_HARD_EXCLUSION_NO_PRODUCTION_AUTHORITY';
const TABLE_RUNS = 'tennis_statistical_engine_audit_runs';
const TABLE_CHECKS = 'tennis_statistical_engine_checks';

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
function round(value, decimals = 6) { return Number(Number(value || 0).toFixed(decimals)); }
function probability(value, fallback = null) {
  const n = finite(value, fallback);
  if (n === null) return null;
  return clamp(n > 1 ? n / 100 : n, 0.01, 0.99);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function eloProbability(a, b) {
  const p1 = finite(a, null); const p2 = finite(b, null);
  if (p1 === null || p2 === null) return null;
  return 1 / (1 + Math.pow(10, (p2 - p1) / 400));
}
function normalizedWeightedMean(signals) {
  const usable = signals.filter(item => Number.isFinite(item.probabilityP1) && item.weight > 0);
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  return {
    probabilityP1: total > 0 ? usable.reduce((sum, item) => sum + item.probabilityP1 * item.weight, 0) / total : 0.5,
    signals: usable.map(item => ({ ...item, normalizedWeight: round(item.weight / total, 4) })),
    totalWeight: total
  };
}
function confidenceLabel(score) {
  if (score >= 78) return 'HIGH';
  if (score >= 58) return 'MEDIUM';
  return 'LOW';
}
function agreementSpread(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return 0;
  return Math.max(...usable) - Math.min(...usable);
}

function buildBestAvailableForecast(input = {}) {
  const scoringRules = require('./tennisScoringRulesAudit02').modelRules(input);
  const productionP1 = probability(input.productionProbabilityP1, 0.5);
  const marketP1 = probability(input.marketProbabilityP1, productionP1);
  const evidenceP1 = probability(input.matchupEvidence?.featureProbabilityP1 ?? input.evidenceProbabilityP1, null);
  const p1Serve = probability(input.p1ServePoint ?? input.matchupEvidence?.p1ServeMatchup ?? input.player1Evidence?.servePointsWon, null);
  const p2Serve = probability(input.p2ServePoint ?? input.matchupEvidence?.p2ServeMatchup ?? input.player2Evidence?.servePointsWon, null);
  const p1Sample = Math.max(1, finite(input.p1Sample ?? input.player1Evidence?.sampleRecent ?? input.player1Evidence?.sampleTotal, 40));
  const p2Sample = Math.max(1, finite(input.p2Sample ?? input.player2Evidence?.sampleRecent ?? input.player2Evidence?.sampleTotal, 40));
  const bestOf = scoringRules.bestOf;
  const seed = Math.max(1, Math.round(finite(input.seed, 19019)));

  let markov = null;
  let monteCarlo = null;
  if (p1Serve !== null && p2Serve !== null) {
    markov = Markov.runProfessionalMarkovMatchModel({
      pA: p1Serve,
      pB: p2Serve,
      bpA: probability(input.p1BreakPointServe ?? input.player1Evidence?.breakPointsSaved, p1Serve),
      bpB: probability(input.p2BreakPointServe ?? input.player2Evidence?.breakPointsSaved, p2Serve),
      sampleA: p1Sample,
      sampleB: p2Sample,
      bestOf,
      scoringRules,
      finalSetTieBreakTarget: input.finalSetTieBreakTarget,
      iterations: Math.max(1200, Math.round(finite(input.markovIterations, 2400))),
      seed
    });
    monteCarlo = Simulation.runTennisMonteCarlo({ player1: productionP1 }, {
      p1ServePoint: p1Serve,
      p2ServePoint: p2Serve,
      p1BreakPointServe: probability(input.p1BreakPointServe ?? input.player1Evidence?.breakPointsSaved, p1Serve),
      p2BreakPointServe: probability(input.p2BreakPointServe ?? input.player2Evidence?.breakPointsSaved, p2Serve),
      p1Sample,
      p2Sample,
      bestOf,
      scoringRules,
      finalSetTieBreakTarget: input.finalSetTieBreakTarget,
      iterations: Math.max(1200, Math.round(finite(input.monteCarloIterations, 2600))),
      seed: seed + 17,
      sport: 'tennis'
    });
  } else {
    monteCarlo = Simulation.runTennisMonteCarlo({ player1: productionP1 }, {
      scoringRules,
      iterations: 1800,
      seed: seed + 17,
      sport: 'tennis',
      sampleSize: Math.min(p1Sample, p2Sample)
    });
  }

  const overallEloP1 = eloProbability(input.player1Evidence?.overallElo ?? input.p1OverallElo, input.player2Evidence?.overallElo ?? input.p2OverallElo);
  const surfaceEloP1 = eloProbability(input.player1Evidence?.surfaceElo ?? input.p1SurfaceElo, input.player2Evidence?.surfaceElo ?? input.p2SurfaceElo);
  const eloP1 = overallEloP1 !== null && surfaceEloP1 !== null ? overallEloP1 * 0.45 + surfaceEloP1 * 0.55 : (surfaceEloP1 ?? overallEloP1);

  const evidenceConfidence = clamp(finite(input.matchupEvidence?.confidenceScore ?? input.evidenceConfidence, 0), 0, 100);
  const coverage = clamp(finite(input.matchupEvidence?.coverageScore ?? input.coverageScore, 0), 0, 100);
  const simulationProfessional = monteCarlo?.modelMode === 'HIERARCHICAL_POINT_LEVEL_MARKOV_MONTE_CARLO';
  const signals = [
    { id: 'PRODUCTION_ANCHOR', probabilityP1: productionP1, weight: 0.34, professional: true },
    { id: 'MARKET_REFERENCE', probabilityP1: marketP1, weight: 0.16, professional: true },
    { id: 'MARKOV_POINT_GAME_SET_MATCH', probabilityP1: probability(markov?.probabilities?.player1, null), weight: markov ? 0.18 : 0, professional: Boolean(markov) },
    { id: 'MONTE_CARLO_HIERARCHICAL', probabilityP1: probability(monteCarlo?.probabilities?.player1, null), weight: simulationProfessional ? 0.16 : 0.05, professional: simulationProfessional },
    { id: 'ELO_OVERALL_SURFACE', probabilityP1: probability(eloP1, null), weight: eloP1 === null ? 0 : 0.09, professional: true },
    { id: 'PLAYER_EVIDENCE_MATCHUP', probabilityP1: evidenceP1, weight: evidenceP1 === null ? 0 : 0.07 * clamp(evidenceConfidence / 70, 0.35, 1.15), professional: true }
  ];
  const blend = normalizedWeightedMean(signals);
  const recentPerformance = input.recentPerformance || StageModel.evaluateRecentPerformance([]);
  const stage = StageModel.applyTournamentStageAdjustment({
    baseProbabilityP1: blend.probabilityP1,
    round: input.round || input.tournamentRound || input.stage,
    player1Evidence: input.player1Evidence || input.matchupEvidence?.p1 || {},
    player2Evidence: input.player2Evidence || input.matchupEvidence?.p2 || {},
    recentPerformance,
    tour: input.tour || 'ALL'
  });

  const finalP1 = stage.adjustedProbabilityP1;
  const spread = agreementSpread(blend.signals.map(item => item.probabilityP1));
  const sampleReliability = clamp(Math.sqrt(Math.min(p1Sample, p2Sample) / 35), 0, 1);
  const baseConfidence = 42 + coverage * 0.18 + evidenceConfidence * 0.14 + sampleReliability * 16 + (simulationProfessional ? 8 : -5) - spread * 70;
  const confidenceScore = clamp(baseConfidence - stage.confidencePenalty, 18, 92);
  const label = confidenceLabel(confidenceScore);
  const bestForecastSide = finalP1 >= 0.5 ? 1 : 2;
  const bestForecastProbability = bestForecastSide === 1 ? finalP1 : 1 - finalP1;
  const uncertaintyHalfWidth = clamp(0.18 - confidenceScore / 100 * 0.10 + spread * 0.18, 0.055, 0.22);
  const riskFlags = [];
  if (!simulationProfessional) riskFlags.push('MONTE_CARLO_DEGRADED_SERVICE_POINT_INPUTS_MISSING');
  if (stage.profile.isLateRound) riskFlags.push(`TOURNAMENT_STAGE_${stage.profile.stage}`);
  if (stage.profile.isLateRound && !stage.stageEvidenceAvailable) riskFlags.push('LATE_ROUND_PLAYER_SAMPLE_LIMITED');
  if (recentPerformance.degradationActive) riskFlags.push(`RETROSPECTIVE_DRIFT_DIAGNOSTIC_${recentPerformance.severity}`);
  if (stage.driftAuthority?.probabilityAdjustmentAuthority) riskFlags.push('FORWARD_CERTIFIED_DRIFT_PROBABILITY_SHRINK_ACTIVE');
  else if (recentPerformance.degradationActive) riskFlags.push('RETROSPECTIVE_DRIFT_NO_PROBABILITY_AUTHORITY');
  if (spread >= 0.16) riskFlags.push('STATISTICAL_ENGINE_DISAGREEMENT_HIGH');
  if (evidenceConfidence < 50) riskFlags.push('PLAYER_EVIDENCE_CONFIDENCE_LOW');

  const core = {
    version: TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION,
    mode: MODE,
    generatedAt: new Date().toISOString(),
    player1: String(input.player1 || ''),
    player2: String(input.player2 || ''),
    tour: String(input.tour || '').toUpperCase() || null,
    surface: input.surface || null,
    bestOf,
    round: stage.profile.canonicalRound,
    stage: stage.profile.stage,
    bestForecastSide,
    bestForecastPlayer: bestForecastSide === 1 ? String(input.player1 || '') : String(input.player2 || ''),
    bestForecastProbability: round(bestForecastProbability, 6),
    probabilityP1: round(finalP1, 6),
    probabilityP2: round(1 - finalP1, 6),
    confidenceScore: round(confidenceScore, 2),
    confidenceLabel: label,
    forecastStatus: `BEST_AVAILABLE_${label}_CONFIDENCE`,
    uncertaintyLow: round(clamp(bestForecastProbability - uncertaintyHalfWidth, 0.01, 0.99), 4),
    uncertaintyHigh: round(clamp(bestForecastProbability + uncertaintyHalfWidth, 0.01, 0.99), 4),
    signals: blend.signals,
    agreementSpread: round(spread, 6),
    engines: {
      scoringRules,
      markov: markov ? { version: markov.version, mode: markov.modelMode, probabilityP1: markov.probabilities.player1, confidenceInterval95: markov.confidenceInterval95, professional: true } : { professional: false, status: 'UNAVAILABLE' },
      monteCarlo: { version: monteCarlo?.engineVersion || null, mode: monteCarlo?.modelMode || null, probabilityP1: monteCarlo?.probabilities?.player1 ?? null, professional: simulationProfessional, degradedFallback: monteCarlo?.degradedFallback === true },
      elo: { overallProbabilityP1: overallEloP1 === null ? null : round(overallEloP1), surfaceProbabilityP1: surfaceEloP1 === null ? null : round(surfaceEloP1), combinedProbabilityP1: eloP1 === null ? null : round(eloP1), professional: eloP1 !== null }
    },
    stageAdjustment: stage,
    recentPerformanceGuard: recentPerformance,
    riskFlags,
    policy: {
      forecastAlwaysAvailable: true,
      hardExclusion: false,
      lateRoundHardVeto: false,
      unreliableSignalAction: stage.driftAuthority?.probabilityAdjustmentAuthority ? 'FORWARD_CERTIFIED_BOUNDED_SHRINK' : 'LOWER_CONFIDENCE_ONLY',
      retrospectiveDriftAuthority: 'DIAGNOSTIC_CONFIDENCE_ONLY',
      selectionRule: 'HIGHEST_FINAL_PROBABILITY_AFTER_ALL_AVAILABLE_ANALYSES'
    },
    authority: {
      aiAnalysisRecommendation: true,
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false
    }
  };
  return { ...core, forecastHash: sha256(core) };
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_statistical_engine_audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      checks_total INTEGER NOT NULL,
      checks_passed INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tennis_statistical_engine_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      check_code TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL,
      details_hash TEXT NOT NULL,
      UNIQUE(run_id, check_code)
    );
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_engine_runs_no_update BEFORE UPDATE ON tennis_statistical_engine_audit_runs BEGIN SELECT RAISE(ABORT, 'PATCH19_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_engine_runs_no_delete BEFORE DELETE ON tennis_statistical_engine_audit_runs BEGIN SELECT RAISE(ABORT, 'PATCH19_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_engine_checks_no_update BEFORE UPDATE ON tennis_statistical_engine_checks BEGIN SELECT RAISE(ABORT, 'PATCH19_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_engine_checks_no_delete BEFORE DELETE ON tennis_statistical_engine_checks BEGIN SELECT RAISE(ABORT, 'PATCH19_APPEND_ONLY'); END;
  `);
}

function runProfessionalEngineAudit(db = null, options = {}) {
  const markovA = Markov.runProfessionalMarkovMatchModel({ pA: 0.64, pB: 0.60, sampleA: 90, sampleB: 80, iterations: 1400, seed: 19019 });
  const markovB = Markov.runProfessionalMarkovMatchModel({ pA: 0.64, pB: 0.60, sampleA: 90, sampleB: 80, iterations: 1400, seed: 19019 });
  const mc = Simulation.runTennisMonteCarlo({ player1: 0.55 }, { p1ServePoint: 0.64, p2ServePoint: 0.60, p1Sample: 90, p2Sample: 80, iterations: 1400, seed: 19036, sport: 'tennis' });
  const stage = StageModel.applyTournamentStageAdjustment({
    baseProbabilityP1: 0.62, round: 'F',
    player1Evidence: { lateRoundSample: 10, lateRoundWinRate: 0.7, lateRoundPerformanceVsExpected: 0.08, semifinalPlusSample: 6, finalSample: 3 },
    player2Evidence: { lateRoundSample: 10, lateRoundWinRate: 0.5, lateRoundPerformanceVsExpected: -0.02, semifinalPlusSample: 5, finalSample: 2 },
    recentPerformance: { degradationActive: true, severity: 'MEDIUM' }
  });
  const forecast = buildBestAvailableForecast({
    player1: 'A', player2: 'B', productionProbabilityP1: 0.57, marketProbabilityP1: 0.55,
    p1ServePoint: 0.64, p2ServePoint: 0.60, p1Sample: 90, p2Sample: 80,
    p1OverallElo: 1700, p2OverallElo: 1650, p1SurfaceElo: 1720, p2SurfaceElo: 1640,
    round: 'SF', recentPerformance: { degradationActive: true, severity: 'LOW', recent: { rows: 60 }, previous: { rows: 120 } }
  });
  const checks = [
    { code: 'MARKOV_DETERMINISTIC', ok: JSON.stringify(markovA) === JSON.stringify(markovB), details: { version: markovA.version, mode: markovA.modelMode } },
    { code: 'MARKOV_POINT_LEVEL_TENNIS_CHAIN', ok: markovA.modelMode === 'HIERARCHICAL_BETA_POINT_GAME_SET_MATCH_MARKOV' && markovA.diagnostics?.uncertaintyAtPointLevel === true, details: markovA.diagnostics },
    { code: 'MONTE_CARLO_TENNIS_PROFESSIONAL', ok: mc.modelMode === 'HIERARCHICAL_POINT_LEVEL_MARKOV_MONTE_CARLO' && mc.degradedFallback === false, details: { mode: mc.modelMode } },
    { code: 'ELO_SYMMETRY', ok: Math.abs(eloProbability(1700, 1600) + eloProbability(1600, 1700) - 1) < 1e-12, details: {} },
    { code: 'LATE_ROUND_SOFT_CAP', ok: Math.abs(stage.stageAdjustmentPp) <= stage.profile.maxAdjustmentPp && stage.hardExclusion === false, details: { adjustmentPp: stage.stageAdjustmentPp, cap: stage.profile.maxAdjustmentPp } },
    { code: 'RECENT_DEGRADATION_NO_VETO', ok: stage.recentPerformance.degradationActive === true && stage.hardVeto === false, details: stage.recentPerformance },
    { code: 'BEST_FORECAST_ALWAYS_AVAILABLE', ok: [1, 2].includes(forecast.bestForecastSide) && forecast.policy.forecastAlwaysAvailable === true && forecast.policy.hardExclusion === false, details: { status: forecast.forecastStatus } },
    { code: 'NO_PRODUCTION_AUTHORITY', ok: forecast.authority.productionProbability === false && forecast.authority.stake === false && forecast.authority.qualityGate === false, details: forecast.authority }
  ];
  const generatedAt = new Date().toISOString();
  const report = {
    success: checks.every(check => check.ok),
    patch: '19',
    version: TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION,
    schemaVersion: TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_SCHEMA_VERSION,
    mode: MODE,
    generatedAt,
    checksTotal: checks.length,
    checksPassed: checks.filter(check => check.ok).length,
    checks: checks.map(check => ({ code: check.code, status: check.ok ? 'PASS' : 'FAIL', details: check.details })),
    authority: forecast.authority
  };
  report.reportHash = sha256(report);
  if (db && options.persist !== false) {
    ensureSchema(db);
    const runId = `P19_${generatedAt.replace(/[^0-9]/g, '').slice(0, 17)}_${report.reportHash.slice(0, 10)}`;
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO tennis_statistical_engine_audit_runs (run_id,version,status,generated_at,checks_total,checks_passed,payload_json,payload_hash) VALUES (?,?,?,?,?,?,?,?)`).run(runId, report.version, report.success ? 'PASS' : 'FAIL', generatedAt, report.checksTotal, report.checksPassed, JSON.stringify(report), report.reportHash);
      const insert = db.prepare(`INSERT INTO tennis_statistical_engine_checks (run_id,check_code,status,details_json,details_hash) VALUES (?,?,?,?,?)`);
      for (const check of report.checks) insert.run(runId, check.code, check.status, JSON.stringify(check.details), sha256(check.details));
    });
    tx();
    report.runId = runId;
  }
  return report;
}

function getProfessionalEngineHealth(db = null) {
  let latest = null; let runs = 0; let checks = 0; let tablesPresent = false; let immutableTriggers = false;
  if (db && typeof db.prepare === 'function') {
    try {
      const tableRows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tennis_statistical_engine_audit_runs','tennis_statistical_engine_checks')`).all();
      tablesPresent = tableRows.length === 2;
      if (tablesPresent) {
        runs = db.prepare('SELECT COUNT(*) AS count FROM tennis_statistical_engine_audit_runs').get().count;
        checks = db.prepare('SELECT COUNT(*) AS count FROM tennis_statistical_engine_checks').get().count;
        latest = db.prepare('SELECT run_id,status,generated_at,checks_total,checks_passed,payload_json,payload_hash FROM tennis_statistical_engine_audit_runs ORDER BY id DESC LIMIT 1').get() || null;
      }
      const triggerCount = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_tennis_stat_engine_%'`).get().count;
      immutableTriggers = triggerCount === 4;
    } catch (error) { latest = { error: error.message }; }
  }
  return {
    success: true,
    status: latest?.status === 'PASS' ? 'PROFESSIONAL_ENGINES_VERIFIED_BEST_FORECAST_ACTIVE' : (latest ? 'ENGINE_AUDIT_FAILED' : 'ENGINE_AUDIT_NOT_RUN'),
    version: TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION,
    schemaVersion: TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_SCHEMA_VERSION,
    mode: MODE,
    tablesPresent,
    immutableTriggers,
    runs,
    checks,
    latest: latest && latest.payload_json ? JSON.parse(latest.payload_json) : latest,
    policy: { forecastAlwaysAvailable: true, hardExclusion: false, lateRoundSoftAdjustmentOnly: true },
    authority: { aiAnalysisRecommendation: true, productionProbability: false, qualityGate: false, stake: false, settlement: false }
  };
}

module.exports = {
  TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION,
  TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_SCHEMA_VERSION,
  MODE,
  TABLE_RUNS,
  TABLE_CHECKS,
  probability,
  eloProbability,
  buildBestAvailableForecast,
  ensureSchema,
  runProfessionalEngineAudit,
  getProfessionalEngineHealth
};
