'use strict';

const crypto = require('crypto');

const VERSION = 'TENNIS_PROBABILITY_CALIBRATION_GUARD_V1_PATCH39';
const RUN_VERSION = 'TENNIS_RECENT_CALIBRATION_RUN_V1_PATCH39';
const DECISION_VERSION = 'TENNIS_PROBABILITY_GUARD_DECISION_V1_PATCH39';
const WINDOWS = Object.freeze([30, 50, 100]);
const BANDS = Object.freeze([
  Object.freeze({ id: 'P00_55', min: 0, max: 55 }),
  Object.freeze({ id: 'P55_65', min: 55, max: 65 }),
  Object.freeze({ id: 'P65_75', min: 65, max: 75 }),
  Object.freeze({ id: 'P75_85', min: 75, max: 85 }),
  Object.freeze({ id: 'P85_100', min: 85, max: 100.000001 })
]);

function number(value, fallback = null) {
  // R14: absent observations are not zero: Number(null)==0 would fabricate evidence.
  if (value === null || value === undefined || typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 4) {
  const n = number(value, null);
  return n === null ? null : Number(n.toFixed(decimals));
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function tennisWhere() { return "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')"; }
function bandFor(probability) {
  const p = number(probability);
  return BANDS.find(band => p !== null && p >= band.min && p < band.max) || null;
}
function wilson(wins, sample, z = 1.959963984540054) {
  if (!sample) return { low: 0, high: 1 };
  const phat = wins / sample;
  const den = 1 + (z * z) / sample;
  const centre = phat + (z * z) / (2 * sample);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * sample)) / sample);
  return { low: (centre - margin) / den, high: (centre + margin) / den };
}
function brier(rows) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => {
    const p = clamp(number(row.estimated_prob, 50) / 100, 0, 1);
    const y = String(row.status || '').toUpperCase() === 'WON' ? 1 : 0;
    return sum + ((p - y) ** 2);
  }, 0) / rows.length;
}
function flatRoi(rows) {
  if (!rows.length) return null;
  const pnl = rows.reduce((sum, row) => {
    const odd = number(row.odd, 0);
    if (String(row.status || '').toUpperCase() === 'WON') return sum + Math.max(0, odd - 1);
    if (String(row.status || '').toUpperCase() === 'LOST') return sum - 1;
    return sum;
  }, 0);
  return pnl / rows.length;
}
function summarizeRows(rows = [], requestedWindow = rows.length) {
  const clean = rows.filter(row => ['WON', 'LOST'].includes(String(row.status || '').toUpperCase()) && number(row.estimated_prob) !== null);
  const wins = clean.filter(row => String(row.status || '').toUpperCase() === 'WON').length;
  const averageProbability = clean.length ? clean.reduce((sum, row) => sum + number(row.estimated_prob, 0), 0) / clean.length : null;
  const hitRate = clean.length ? wins / clean.length : null;
  return {
    requestedWindow,
    sample: clean.length,
    wins,
    losses: clean.length - wins,
    hitRatePct: hitRate === null ? null : round(hitRate * 100, 2),
    averageProbabilityPct: averageProbability === null ? null : round(averageProbability, 2),
    calibrationGapPp: hitRate === null || averageProbability === null ? null : round(averageProbability - hitRate * 100, 2),
    brierScore: round(brier(clean), 4),
    flatRoiPct: clean.length ? round(flatRoi(clean) * 100, 2) : null,
    bands: BANDS.map(band => {
      const segment = clean.filter(row => {
        const p = number(row.estimated_prob);
        return p !== null && p >= band.min && p < band.max;
      });
      const segmentWins = segment.filter(row => String(row.status || '').toUpperCase() === 'WON').length;
      const avg = segment.length ? segment.reduce((sum, row) => sum + number(row.estimated_prob, 0), 0) / segment.length : null;
      const hit = segment.length ? segmentWins / segment.length : null;
      const interval = wilson(segmentWins, segment.length);
      const posteriorMean = (segmentWins + 5) / (segment.length + 10);
      return {
        bandId: band.id,
        min: band.min,
        max: band.max >= 100 ? 100 : band.max,
        sample: segment.length,
        wins: segmentWins,
        losses: segment.length - segmentWins,
        hitRatePct: hit === null ? null : round(hit * 100, 2),
        averageProbabilityPct: avg === null ? null : round(avg, 2),
        calibrationGapPp: hit === null || avg === null ? null : round(avg - hit * 100, 2),
        wilsonLowPct: segment.length ? round(interval.low * 100, 2) : null,
        wilsonHighPct: segment.length ? round(interval.high * 100, 2) : null,
        posteriorMeanPct: segment.length ? round(posteriorMean * 100, 2) : null
      };
    })
  };
}
function loadResolvedRows(db, limit = 100) {
  return db.prepare(`SELECT id,status,estimated_prob,odd,tour_type,league,match_date FROM ai_forward_test WHERE ${tennisWhere()} AND UPPER(COALESCE(status,'')) IN ('WON','LOST') AND estimated_prob IS NOT NULL ORDER BY id DESC LIMIT ?`).all(Number(limit)).reverse();
}
function buildCalibrationReport(db, options = {}) {
  const windows = (options.windows || WINDOWS).map(Number).filter(n => Number.isInteger(n) && n > 0);
  const maxWindow = Math.max(...windows, 100);
  const rows = loadResolvedRows(db, maxWindow);
  const reports = windows.map(window => summarizeRows(rows.slice(-window), window));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const report = {
    version: RUN_VERSION,
    generatedAt,
    windows: reports,
    authority: 'FINAL_RISK_REDUCTION_ONLY',
    rawProbabilityPreserved: true,
    canIncreaseProbability: false,
    canIncreaseStake: false,
    minimumBandSampleForHardGuard: 20,
    policy: {
      hardGapPp: 8,
      microGapPp: 4,
      posteriorPrior: 'BETA_5_5',
      operationalCeilingMarginPp: 7.5
    }
  };
  report.reportHash = sha({ ...report, generatedAt: null });
  return report;
}
function selectEvidence(report, probability) {
  const band = bandFor(probability);
  if (!band) return null;
  const candidates = (report?.windows || [])
    .map(window => ({ window: window.requestedWindow, overall: window, band: window.bands.find(row => row.bandId === band.id) }))
    .filter(item => item.band && item.band.sample >= 20)
    .sort((a, b) => b.window - a.window);
  if (candidates.length) return candidates[0];
  const overall = (report?.windows || []).filter(window => window.sample >= 30).sort((a, b) => b.requestedWindow - a.requestedWindow)[0];
  return overall ? { window: overall.requestedWindow, overall, band: null } : null;
}
function decide(input = {}, report = null) {
  const rawProbabilityPct = clamp(number(input.estimated_prob ?? input.probability ?? input.rawProbabilityPct, 50), 0, 100);
  const proposedStake = Math.max(0, number(input.stake ?? input.proposedStake, 0));
  const evidence = selectEvidence(report, rawProbabilityPct);
  if (!evidence) {
    return {
      version: DECISION_VERSION,
      status: 'INSUFFICIENT_RECENT_CALIBRATION_SAMPLE',
      rawProbabilityPct: round(rawProbabilityPct, 2),
      operationalProbabilityPct: round(rawProbabilityPct, 2),
      probabilityReductionPp: 0,
      proposedStake: round(proposedStake, 2),
      finalStakeCap: round(proposedStake, 2),
      finalStake: round(proposedStake, 2),
      evidenceWindow: null,
      evidenceBand: bandFor(rawProbabilityPct)?.id || null,
      evidenceSample: 0,
      authority: 'NO_CHANGE',
      reason: 'Recent calibration evidence is not mature enough for an automatic reduction.'
    };
  }
  const source = evidence.band || evidence.overall;
  const posterior = number(source.posteriorMeanPct, number(source.hitRatePct, rawProbabilityPct));
  const ceiling = clamp(posterior + 7.5, 50, rawProbabilityPct);
  const operationalProbabilityPct = Math.min(rawProbabilityPct, ceiling);
  const reduction = Math.max(0, rawProbabilityPct - operationalProbabilityPct);
  let status = 'PASS';
  let finalStakeCap = proposedStake;
  if (source.sample >= 20 && reduction > 8) {
    status = 'SHADOW_OVERCONFIDENCE_MICRO_CAP';
    finalStakeCap = Math.min(proposedStake, 2);
  } else if (source.sample >= 20 && reduction >= 4) {
    status = 'OVERCONFIDENCE_MICRO_CAP';
    finalStakeCap = Math.min(proposedStake, 2);
  }
  return {
    version: DECISION_VERSION,
    status,
    rawProbabilityPct: round(rawProbabilityPct, 2),
    operationalProbabilityPct: round(operationalProbabilityPct, 2),
    probabilityReductionPp: round(reduction, 2),
    proposedStake: round(proposedStake, 2),
    finalStakeCap: round(finalStakeCap, 2),
    finalStake: round(Math.min(proposedStake, finalStakeCap), 2),
    evidenceWindow: evidence.window,
    evidenceBand: evidence.band?.bandId || 'OVERALL',
    evidenceSample: source.sample,
    evidenceHitRatePct: source.hitRatePct,
    evidenceAverageProbabilityPct: source.averageProbabilityPct,
    evidenceCalibrationGapPp: source.calibrationGapPp,
    evidenceBrierScore: evidence.overall.brierScore,
    authority: status === 'PASS' ? 'NO_CHANGE' : 'PATCH48_SHADOW_DIAGNOSTIC_MICRO_CAP',
    rawProbabilityPreserved: true,
    reason: status === 'SHADOW_OVERCONFIDENCE_MICRO_CAP'
      ? `Recent ${evidence.window}-match calibration for ${evidence.band?.bandId || 'overall'} implies a ${round(reduction, 2)}pp reduction; calibration is not production-authoritative, therefore only the upstream micro cap is retained.`
      : status === 'OVERCONFIDENCE_MICRO_CAP'
        ? `Recent calibration implies a ${round(reduction, 2)}pp reduction; only micro stake is allowed.`
        : 'Recent calibration does not require an additional operational restriction.'
  };
}
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_probability_calibration_guard_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS tennis_probability_guard_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id TEXT NOT NULL UNIQUE,
      bet_id INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_probability_pct REAL,
      operational_probability_pct REAL,
      probability_reduction_pp REAL,
      proposed_stake REAL,
      final_stake_cap REAL,
      final_stake REAL,
      evidence_window INTEGER,
      evidence_band TEXT,
      evidence_sample INTEGER,
      report_hash TEXT,
      payload_json TEXT NOT NULL,
      decision_hash TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_probability_guard_bet ON tennis_probability_guard_decisions(bet_id, generated_at);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_probability_guard_runs_no_update BEFORE UPDATE ON tennis_probability_calibration_guard_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PROBABILITY_GUARD_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_probability_guard_runs_no_delete BEFORE DELETE ON tennis_probability_calibration_guard_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PROBABILITY_GUARD_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_probability_guard_decisions_no_update BEFORE UPDATE ON tennis_probability_guard_decisions BEGIN SELECT RAISE(ABORT,'TENNIS_PROBABILITY_GUARD_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_probability_guard_decisions_no_delete BEFORE DELETE ON tennis_probability_guard_decisions BEGIN SELECT RAISE(ABORT,'TENNIS_PROBABILITY_GUARD_APPEND_ONLY'); END;
  `);
}
function persistRun(db, report) {
  createSchema(db);
  const runId = `TCG39_${report.reportHash.slice(0, 24)}`;
  const existing = db.prepare('SELECT * FROM tennis_probability_calibration_guard_runs WHERE run_id=?').get(runId);
  if (existing) return existing;
  db.prepare('INSERT INTO tennis_probability_calibration_guard_runs(run_id,generated_at,version,report_json,report_hash) VALUES(?,?,?,?,?)')
    .run(runId, report.generatedAt, report.version, JSON.stringify(report), report.reportHash);
  return db.prepare('SELECT * FROM tennis_probability_calibration_guard_runs WHERE run_id=?').get(runId);
}
function persistDecision(db, betId, decision, reportHash) {
  createSchema(db);
  const canonical = { betId: Number(betId), reportHash, ...decision };
  const decisionHash = sha(canonical);
  const decisionId = `TPGD39_${Number(betId)}_${decisionHash.slice(0, 16)}`;
  const existing = db.prepare('SELECT * FROM tennis_probability_guard_decisions WHERE decision_id=?').get(decisionId);
  if (existing) return existing;
  db.prepare(`INSERT INTO tennis_probability_guard_decisions(
    decision_id,bet_id,generated_at,version,status,raw_probability_pct,operational_probability_pct,
    probability_reduction_pp,proposed_stake,final_stake_cap,final_stake,evidence_window,evidence_band,
    evidence_sample,report_hash,payload_json,decision_hash
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    decisionId, Number(betId), new Date().toISOString(), decision.version, decision.status,
    decision.rawProbabilityPct, decision.operationalProbabilityPct, decision.probabilityReductionPp,
    decision.proposedStake, decision.finalStakeCap, decision.finalStake, decision.evidenceWindow,
    decision.evidenceBand, decision.evidenceSample, reportHash, JSON.stringify(canonical), decisionHash
  );
  return db.prepare('SELECT * FROM tennis_probability_guard_decisions WHERE decision_id=?').get(decisionId);
}
function health(db) {
  const report = buildCalibrationReport(db);
  return {
    version: VERSION,
    report,
    status: report.windows.some(window => Math.abs(number(window.calibrationGapPp, 0)) >= 8) ? 'OVERCONFIDENCE_DETECTED' : 'OK',
    authority: 'FINAL_RISK_REDUCTION_ONLY',
    rawProbabilityPreserved: true,
    standardStakePromotion: false
  };
}

module.exports = {
  VERSION, RUN_VERSION, DECISION_VERSION, WINDOWS, BANDS,
  tennisWhere, bandFor, wilson, summarizeRows, loadResolvedRows,
  buildCalibrationReport, selectEvidence, decide, createSchema,
  persistRun, persistDecision, health
};
