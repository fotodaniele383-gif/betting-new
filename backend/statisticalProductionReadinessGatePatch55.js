'use strict';

const crypto = require('crypto');
const path = require('path');
const clvCoverage = require('./clvCrossSportCoveragePatch53');
const wtaRecovery = require('./tennisWtaInformationRecoveryPatch52');
const tourDrift = require('./tennisTourDriftAuthorityPatch36');
const calcioWalkForward = require('./calcioWalkForwardCalibration');
const calcioReliability = require('./calcioReliabilityCalibration');
const certifiedMetricsEvidence = require('./certifiedMetricsEvidenceGateAudit08'); // AUDIT08_CERTIFIED_METRICS_GATE
const certifiedClvEvidence = require('./certifiedClvEvidenceGateAudit09'); // AUDIT09_CERTIFIED_CLV_GATE
const settlementScope = require('./settlementExceptionScopeGateAudit10'); // AUDIT10_SETTLEMENT_SCOPE_GATE

const VERSION = 'STATISTICAL_PRODUCTION_READINESS_GATE_V1_PATCH55';
const POLICY_VERSION = 'STATISTICAL_PRODUCTION_READINESS_POLICY_V1_PATCH55';
const READ_CONTEXT = Symbol('AUDIT07S_R4_READ_CONTEXT');
const MODE = 'READ_ONLY_FAIL_CLOSED_NO_AUTOMATIC_PRODUCTION_AUTHORITY';

const THRESHOLDS = Object.freeze({
  tennis: Object.freeze({
    productionEligibleRowsMin: 100,
    forwardCertifiedActionableRowsMin: 100,
    forwardCoveragePctMin: 60,
    forwardSignalAccuracyPctMin: 55,
    forwardBrierImprovementMin: 0.005,
    challengerOosRowsMin: 100,
    challengerBootstrapLower95MinExclusive: 0,
    clvVerifiedCoveragePctMin: 60,
    economicPositiveStakeRowsMin: 50,
    economicRoiPctMin: 0,
    forwardDriftOverallRowsMin: 60,
    forwardDriftTourRowsMin: 30,
    allTourDataMustBeCurrent: true,
    allChallengerToursMustBeStable: true
  }),
  calcio: Object.freeze({
    historicalHoldoutRowsMin: 500,
    historicalHoldoutRowsPerLeagueMin: 50,
    logLossImprovementPctMin: 0.5,
    brierImprovementPctMin: 0,
    calibrationImprovementPctMin: 0,
    positiveLeagueRatioMin: 2 / 3,
    operationalResolvedRowsMin: 100,
    reliabilityResolvedRowsMin: 100,
    clvVerifiedCoveragePctMin: 60,
    sportKeyCoveragePctMin: 95,
    economicPositiveStakeRowsMin: 50,
    economicRoiPctMin: 0
  })
});

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function finite(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function round(v, d = 2) { const n = finite(v, null); return n == null ? null : Number(n.toFixed(d)); }
function tableExists(db, name) { try { return Boolean(db.prepare("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); } catch (_) { return false; } }
function parseJson(v, fallback = null) { try { return JSON.parse(v); } catch (_) { return fallback; } }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function pct(a, b) { return b ? round(a / b * 100, 2) : 0; }
function isResolved(row) { return ['WON', 'LOST'].includes(upper(row.status)); }
function isCurrentOperational(row) {
  const q = upper(row.data_quality || 'CURRENT_BOOTSTRAP');
  const bet = upper(row.bet_type);
  return Number(row.paper_result_active == null ? 1 : row.paper_result_active) === 1
    && Number(row.paper_result_conflict || 0) === 0
    && !['LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS'].includes(q)
    && !bet.startsWith('MULTI');
}
function economicMetrics(rows) {
  const eligible = rows.filter(r => isResolved(r) && finite(r.stake, 0) > 0);
  const stake = eligible.reduce((s, r) => s + finite(r.stake, 0), 0);
  const profit = eligible.reduce((s, r) => s + finite(r.profit, 0), 0);
  return { rows: eligible.length, stake: round(stake, 2), profit: round(profit, 2), roiPct: stake > 0 ? round(profit / stake * 100, 2) : null };
}
function check(id, category, actual, threshold, pass, reason, options = {}) {
  return { id, category, actual, threshold, pass: Boolean(pass), blocking: options.blocking !== false, reason };
}
function latestRun(db, table, where = '') {
  if (!tableExists(db, table)) return null;
  try { return db.prepare(`SELECT * FROM ${table} ${where} ORDER BY completed_at DESC LIMIT 1`).get() || null; } catch (_) { return null; }
}
function loadAllRows(db) { try { return db.prepare('SELECT '+require('./audit07sR4ReadColumns').columns(db)+' FROM ai_forward_test').all(); } catch (_) { return []; } }

function buildTennisSection(db, options = {}) {
  const rows = options[READ_CONTEXT]?.rows || loadAllRows(db);
  const operational = rows.filter(r => isCurrentOperational(r) && clvCoverage.detectSport(r) === 'TENNIS');
  let eligibility = { total: 0, productionEligible: 0, settlementEligible: 0, clvEligible: 0 };
  if (tableExists(db, 'tennis_calibration_eligibility')) {
    const row = db.prepare(`SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN production_eligible=1 THEN 1 ELSE 0 END),0) productionEligible,
      COALESCE(SUM(CASE WHEN settlement_eligible=1 THEN 1 ELSE 0 END),0) settlementEligible,
      COALESCE(SUM(CASE WHEN clv_eligible=1 THEN 1 ELSE 0 END),0) clvEligible
      FROM tennis_calibration_eligibility`).get();
    eligibility = Object.fromEntries(Object.entries(row || {}).map(([k,v]) => [k, Number(v || 0)]));
  }
  let productionRows = [];
  if (tableExists(db, 'tennis_calibration_eligibility')) {
    try { productionRows = db.prepare(`SELECT a.id,a.status,a.stake,a.profit,a.clv_verified,
      a.settlement_contract_status,a.settlement_contract_version,a.settlement_evidence_hash,
      a.settlement_source_event_id,a.settlement_event_fingerprint,a.settlement_market_fingerprint,
      a.tennis_event_fingerprint,a.tennis_market_fingerprint,
      e.settlement_eligible,e.production_eligible
      FROM ai_forward_test a JOIN tennis_calibration_eligibility e ON e.bet_id=a.id
      WHERE e.production_eligible=1`).all(); } catch (_) {}
  }
  const settlementEvidence = certifiedMetricsEvidence.summarizeTennisProductionRows(productionRows); // AUDIT08_CERTIFIED_METRICS_GATE
  const settlementExceptionQueue = settlementScope.summarizeTennisQueue(db); // AUDIT10_SETTLEMENT_SCOPE_GATE
  const economics = economicMetrics(settlementEvidence.rows);

  const forwardRun = latestRun(db, 'tennis_historical_validation_audit_runs', "WHERE run_mode='FORWARD_CERTIFIED'");
  const forwardReport = parseJson(forwardRun?.report_json, null);
  const challengerRun = latestRun(db, 'tennis_statistical_challenger_runs');
  const challengerReport = parseJson(challengerRun?.report_json, null);
  const drift = tourDrift.loadFromDb(db);
  const coverage = options[READ_CONTEXT]?.coverage || clvCoverage.buildCoverageReport(db, clvCoverage.DEFAULT_FOOTBALL_LEAGUES);
  const tennisCoverage = coverage.bySport?.TENNIS || {};
  const certifiedClv = certifiedClvEvidence.summarizeRows(rows); // AUDIT09_CERTIFIED_CLV_GATE
  const tennisCertifiedClv = certifiedClv.bySport?.TENNIS || {};
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  let wta = null;
  try { wta = wtaRecovery.health({ dataDir: path.join(projectRoot, 'backend', 'sackmann_data'), projectRoot }); }
  catch (error) { wta = { success: false, status: 'ERROR', error: error.message }; }

  const challengerTours = challengerReport?.byTour || {};
  const challengerTourEntries = Object.entries(challengerTours).filter(([,v]) => finite(v?.metrics?.rows, 0) >= 50);
  const allChallengerToursStable = challengerTourEntries.length >= 2 && challengerTourEntries.every(([,v]) => v?.bootstrap?.stablePositive === true);
  const driftByTour = drift?.forward?.byTour || {};
  const driftTourRows = Object.fromEntries(Object.entries(driftByTour).map(([tour,v]) => [tour, finite(v?.recent?.rows, 0)]));
  const allForwardToursMature = ['ATP','WTA'].every(tour => finite(driftTourRows[tour], 0) >= THRESHOLDS.tennis.forwardDriftTourRowsMin);
  const wtaCurrent = upper(wta?.activeDataset?.freshness?.status || wta?.active?.freshness?.status) === 'CURRENT';
  const forwardActionable = finite(forwardReport?.metrics?.actionableRows, finite(forwardRun?.actionable_rows, 0));
  const forwardCoverage = finite(forwardReport?.coveragePct, finite(forwardRun?.coverage_pct, 0));
  const forwardAccuracy = finite(forwardReport?.metrics?.signalAccuracyPct, finite(forwardRun?.signal_accuracy_pct, 0));
  const brierImprovement = finite(forwardReport?.performanceGate?.brierImprovement,
    forwardRun && finite(forwardRun.production_brier, null) != null && finite(forwardRun.validation_brier, null) != null
      ? finite(forwardRun.production_brier, 0) - finite(forwardRun.validation_brier, 0) : null);
  const challengerRows = finite(challengerReport?.metrics?.rows, finite(challengerRun?.oos_rows, 0));
  const challengerLower = finite(challengerReport?.bootstrap?.lower95, finite(challengerRun?.bootstrap_lower95, null));
  const forwardDriftRows = finite(drift?.forward?.rows, 0);

  const checks = [
    check('TENNIS_PRODUCTION_ELIGIBLE_SAMPLE', 'FORWARD_SAMPLE', eligibility.productionEligible, THRESHOLDS.tennis.productionEligibleRowsMin, eligibility.productionEligible >= THRESHOLDS.tennis.productionEligibleRowsMin, 'Righe forward strutturalmente production-eligible.'),
    check('TENNIS_FORWARD_CERTIFIED_ACTIONABLE', 'FORWARD_SETTLED_VALIDATION', forwardActionable, THRESHOLDS.tennis.forwardCertifiedActionableRowsMin, forwardActionable >= THRESHOLDS.tennis.forwardCertifiedActionableRowsMin, 'Righe actionable con evidenza forward certificata e settlement disponibile.'),
    check('TENNIS_FORWARD_COVERAGE', 'FORWARD_SETTLED_VALIDATION', forwardCoverage, THRESHOLDS.tennis.forwardCoveragePctMin, forwardCoverage >= THRESHOLDS.tennis.forwardCoveragePctMin, 'Copertura della validazione forward.'),
    check('TENNIS_FORWARD_SIGNAL_ACCURACY', 'FORWARD_SETTLED_VALIDATION', forwardAccuracy, THRESHOLDS.tennis.forwardSignalAccuracyPctMin, forwardAccuracy >= THRESHOLDS.tennis.forwardSignalAccuracyPctMin, 'Accuratezza dei segnali forward actionable.'),
    check('TENNIS_FORWARD_BRIER_IMPROVEMENT', 'CALIBRATION', round(brierImprovement, 6), THRESHOLDS.tennis.forwardBrierImprovementMin, brierImprovement != null && brierImprovement >= THRESHOLDS.tennis.forwardBrierImprovementMin, 'Miglioramento Brier forward rispetto alla probabilità production.'),
    check('TENNIS_CHALLENGER_OOS_SAMPLE', 'CHALLENGER', challengerRows, THRESHOLDS.tennis.challengerOosRowsMin, challengerRows >= THRESHOLDS.tennis.challengerOosRowsMin, 'Campione OOS del challenger temporale.'),
    check('TENNIS_CHALLENGER_BOOTSTRAP_OVERALL', 'CHALLENGER', challengerLower, `>${THRESHOLDS.tennis.challengerBootstrapLower95MinExclusive}`, challengerLower != null && challengerLower > THRESHOLDS.tennis.challengerBootstrapLower95MinExclusive, 'Limite inferiore bootstrap 95% del miglioramento Brier complessivo.'),
    check('TENNIS_CHALLENGER_ALL_TOURS_STABLE', 'CHALLENGER', Object.fromEntries(challengerTourEntries.map(([k,v]) => [k, v?.bootstrap?.lower95])), 'ALL_TOURS_LOWER95>0', allChallengerToursStable, 'ATP e WTA con almeno 50 righe devono essere statisticamente stabili.'),
    check('TENNIS_WTA_DATA_CURRENT', 'DATA_FRESHNESS', { status: wta?.activeDataset?.freshness?.status || wta?.active?.freshness?.status || wta?.status, ageDays: wta?.activeDataset?.freshness?.dataAgeDays ?? wta?.active?.freshness?.dataAgeDays }, 'CURRENT', wtaCurrent, 'Il circuito WTA deve disporre di dati correnti certificati.'),
    check('TENNIS_FORWARD_DRIFT_MATURE_OVERALL', 'DRIFT', forwardDriftRows, THRESHOLDS.tennis.forwardDriftOverallRowsMin, forwardDriftRows >= THRESHOLDS.tennis.forwardDriftOverallRowsMin, 'Campione forward sufficiente per valutare drift reale.'),
    check('TENNIS_FORWARD_DRIFT_MATURE_BY_TOUR', 'DRIFT', driftTourRows, `>=${THRESHOLDS.tennis.forwardDriftTourRowsMin} per tour`, allForwardToursMature, 'Campione drift sufficiente separatamente per ATP e WTA.'),
    check('TENNIS_CLV_VERIFIED_COVERAGE', 'MARKET_VALIDATION', finite(tennisCertifiedClv.certifiedCoveragePct, 0), THRESHOLDS.tennis.clvVerifiedCoveragePctMin, finite(tennisCertifiedClv.certifiedCoveragePct, 0) >= THRESHOLDS.tennis.clvVerifiedCoveragePctMin, 'Copertura CLV certificata con opening/closing quote, timestamp pre-evento, bookmaker, source-event e fingerprint evento/mercato.'),
    check('TENNIS_CLV_RAW_VERIFIED_RECONCILIATION', 'MARKET_VALIDATION_DIAGNOSTIC', tennisCertifiedClv.rawOnlyRows || 0, 0, (tennisCertifiedClv.rawOnlyRows || 0) === 0, 'Diagnostica non bloccante: righe clv_verified=1 che non soddisfano il contratto di provenance AUDIT09.', { blocking:false }),
    check('TENNIS_SETTLEMENT_EXCEPTION_SCOPE_CLEAR', 'SETTLEMENT_EVIDENCE', settlementExceptionQueue.criticalOpenRows, 0, settlementExceptionQueue.available === true && settlementExceptionQueue.criticalOpenRows === 0, 'Le eccezioni settlement aperte bloccano la readiness solo se production/settlement-eligible o se la classificazione di quarantena non e dimostrabile.'),
    check('TENNIS_SETTLEMENT_EXCEPTION_QUARANTINE_DIAGNOSTIC', 'SETTLEMENT_EVIDENCE_DIAGNOSTIC', settlementExceptionQueue.quarantinedOpenRows, 0, settlementExceptionQueue.quarantinedOpenRows === 0, 'Diagnostica non bloccante: eccezioni aperte gia esplicitamente escluse da production_eligible e settlement_eligible.', { blocking:false }),
    check('TENNIS_CERTIFIED_SETTLEMENT_INVARIANT', 'SETTLEMENT_EVIDENCE', settlementEvidence.excludedRows, 0, settlementEvidence.excludedRows === 0, 'Ogni riga production-eligible usata nei KPI economici deve avere ledger settlement-eligible, contratto VERIFIED, evidence hash e fingerprint coerenti.'),
    check('TENNIS_ECONOMIC_SAMPLE', 'ECONOMIC', economics.rows, THRESHOLDS.tennis.economicPositiveStakeRowsMin, economics.rows >= THRESHOLDS.tennis.economicPositiveStakeRowsMin, 'Righe forward production-eligible con settlement certificato e stake positivo.'),
    check('TENNIS_ECONOMIC_ROI', 'ECONOMIC', economics.roiPct, `>=${THRESHOLDS.tennis.economicRoiPctMin}% dopo maturità campione`, economics.rows >= THRESHOLDS.tennis.economicPositiveStakeRowsMin && economics.roiPct != null && economics.roiPct >= THRESHOLDS.tennis.economicRoiPctMin, 'ROI del campione economico forward; non valutabile positivamente prima della maturità minima.')
  ];
  const failures = checks.filter(c => c.blocking && !c.pass);
  return {
    sport: 'TENNIS',
    gateStatus: failures.length ? 'BLOCKED_STATISTICAL_READINESS' : 'MANUAL_CANARY_REVIEW_ELIGIBLE',
    statisticalGatePass: failures.length === 0,
    metrics: {
      operationalRows: operational.length,
      eligibility,
      forwardCertified: { coveredRows: finite(forwardReport?.coveredRows, finite(forwardRun?.covered_rows, 0)), actionableRows: forwardActionable, coveragePct: forwardCoverage, signalAccuracyPct: forwardAccuracy, brierImprovement: round(brierImprovement, 6), status: forwardReport?.performanceGate?.status || forwardRun?.performance_gate_status || 'NO_SAMPLE' },
      challenger: { oosRows: challengerRows, brierImprovement: finite(challengerReport?.metrics?.brierImprovementVsProduction, null), bootstrapLower95: challengerLower, bootstrapUpper95: finite(challengerReport?.bootstrap?.upper95, null), byTour: Object.fromEntries(challengerTourEntries.map(([k,v]) => [k,{ rows:v.metrics?.rows, lower95:v.bootstrap?.lower95, stablePositive:v.bootstrap?.stablePositive }])) },
      freshness: { wtaStatus: wta?.activeDataset?.freshness?.status || wta?.active?.freshness?.status || wta?.status, wtaAgeDays: wta?.activeDataset?.freshness?.dataAgeDays ?? wta?.active?.freshness?.dataAgeDays, provider: wta?.activeDataset?.providerId || wta?.active?.providerId },
      drift: { forwardRows: forwardDriftRows, byTourRows: driftTourRows, forwardOverallMature: drift?.forwardOverallMature === true, forwardTourMature: drift?.forwardTourMature || {} },
      clv: { eligibleRows: tennisCoverage.eligibleRows || 0, rawVerifiedRows: tennisCertifiedClv.rawVerifiedRows || 0, rawVerifiedCoveragePct: tennisCertifiedClv.rawVerifiedCoveragePct || 0, verifiedRows: tennisCertifiedClv.certifiedRows || 0, verifiedCoveragePct: tennisCertifiedClv.certifiedCoveragePct || 0, certifiedRows: tennisCertifiedClv.certifiedRows || 0, certifiedCoveragePct: tennisCertifiedClv.certifiedCoveragePct || 0, rawOnlyRows: tennisCertifiedClv.rawOnlyRows || 0, exclusionReasons: tennisCertifiedClv.exclusionReasons || {}, evidenceAvailabilityPct: tennisCoverage.evidenceAvailabilityPct || 0, provenanceVersion: certifiedClv.version },
      settlementEvidence: { version: settlementEvidence.version, totalRows: settlementEvidence.totalRows, certifiedRows: settlementEvidence.certifiedRows, excludedRows: settlementEvidence.excludedRows, exclusionReasons: settlementEvidence.exclusionReasons },
      settlementExceptionQueue: { version: settlementExceptionQueue.version, available: settlementExceptionQueue.available, ready: settlementExceptionQueue.ready, openRows: settlementExceptionQueue.openRows, criticalOpenRows: settlementExceptionQueue.criticalOpenRows, quarantinedOpenRows: settlementExceptionQueue.quarantinedOpenRows, manualActionOpenRows: settlementExceptionQueue.manualActionOpenRows, targetedRecoveryOpenRows: settlementExceptionQueue.targetedRecoveryOpenRows, productionEligibleOpenRows: settlementExceptionQueue.productionEligibleOpenRows, settlementEligibleOpenRows: settlementExceptionQueue.settlementEligibleOpenRows, unknownEligibilityOpenRows: settlementExceptionQueue.unknownEligibilityOpenRows, oldestOpenAt: settlementExceptionQueue.oldestOpenAt, byExceptionType: settlementExceptionQueue.byExceptionType, byRecoveryMode: settlementExceptionQueue.byRecoveryMode },
      economics
    },
    checks,
    blockingFailures: failures.map(c => c.id),
    authority: { productionProbability:false, deepScanDecision:false, qualityGate:false, stake:false, settlement:false, automaticPromotion:false }
  };
}

function buildCalcioSection(db, options = {}) {
  const rows = options[READ_CONTEXT]?.rows || loadAllRows(db);
  const operational = rows.filter(r => isCurrentOperational(r) && clvCoverage.detectSport(r) === 'CALCIO');
  const resolved = operational.filter(isResolved);
  const settlementEvidence = certifiedMetricsEvidence.summarizeCalcioOperationalRows(operational); // AUDIT08_CERTIFIED_METRICS_GATE
  const certifiedResolved = settlementEvidence.rows;
  const economics = economicMetrics(certifiedResolved);
  const coverage = options[READ_CONTEXT]?.coverage || clvCoverage.buildCoverageReport(db, clvCoverage.DEFAULT_FOOTBALL_LEAGUES);
  const calcioCoverage = coverage.bySport?.CALCIO || {};
  const certifiedClv = certifiedClvEvidence.summarizeRows(rows); // AUDIT09_CERTIFIED_CLV_GATE
  const calcioCertifiedClv = certifiedClv.bySport?.CALCIO || {};
  const reliability = calcioReliability.buildReliabilityCalibration(operational);
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  let walkForward = null, walkForwardError = null;
  try { walkForward = calcioWalkForward.runWalkForward(projectRoot); } catch (error) { walkForwardError = error.message; }
  const holdout = walkForward?.holdout?.aggregate || null;
  const recommendation = walkForward?.recommendation || null;
  const leagueRows = (walkForward?.holdout?.leagues || []).map(x => ({ code:x.code, league:x.league, rows:finite(x?.champion?.matches,0), logLossImprovementPct:finite(x?.comparison?.logLossImprovementPct,null) }));
  const minLeagueRows = leagueRows.length ? Math.min(...leagueRows.map(x => x.rows)) : 0;
  const positiveRatio = recommendation?.totalLeagues ? finite(recommendation.positiveLeagues, 0) / finite(recommendation.totalLeagues, 1) : 0;
  const checks = [
    check('CALCIO_HISTORICAL_HOLDOUT_SAMPLE', 'HISTORICAL_OOS', finite(holdout?.champion?.matches,0), THRESHOLDS.calcio.historicalHoldoutRowsMin, finite(holdout?.champion?.matches,0) >= THRESHOLDS.calcio.historicalHoldoutRowsMin, 'Holdout storico complessivo walk-forward.'),
    check('CALCIO_HISTORICAL_HOLDOUT_PER_LEAGUE', 'HISTORICAL_OOS', { minimum: minLeagueRows, leagues: leagueRows }, THRESHOLDS.calcio.historicalHoldoutRowsPerLeagueMin, leagueRows.length > 0 && minLeagueRows >= THRESHOLDS.calcio.historicalHoldoutRowsPerLeagueMin, 'Ogni lega inclusa deve avere un holdout minimo; una lega quasi vuota non può essere mascherata dall’aggregato.'),
    check('CALCIO_HOLDOUT_LOGLOSS_IMPROVEMENT', 'HISTORICAL_OOS', finite(holdout?.comparison?.logLossImprovementPct,null), THRESHOLDS.calcio.logLossImprovementPctMin, finite(holdout?.comparison?.logLossImprovementPct,-999) >= THRESHOLDS.calcio.logLossImprovementPctMin, 'Miglioramento log-loss holdout.'),
    check('CALCIO_HOLDOUT_BRIER_IMPROVEMENT', 'HISTORICAL_OOS', finite(holdout?.comparison?.brierImprovementPct,null), THRESHOLDS.calcio.brierImprovementPctMin, finite(holdout?.comparison?.brierImprovementPct,-999) >= THRESHOLDS.calcio.brierImprovementPctMin, 'Miglioramento Brier holdout.'),
    check('CALCIO_HOLDOUT_CALIBRATION', 'HISTORICAL_OOS', finite(holdout?.comparison?.calibrationImprovementPct,null), THRESHOLDS.calcio.calibrationImprovementPctMin, finite(holdout?.comparison?.calibrationImprovementPct,-999) >= THRESHOLDS.calcio.calibrationImprovementPctMin, 'La calibrazione holdout non deve peggiorare.'),
    check('CALCIO_POSITIVE_LEAGUE_RATIO', 'HISTORICAL_OOS', round(positiveRatio,4), round(THRESHOLDS.calcio.positiveLeagueRatioMin,4), positiveRatio >= THRESHOLDS.calcio.positiveLeagueRatioMin, 'Quota di leghe con miglioramento log-loss positivo.'),
    check('CALCIO_CERTIFIED_SETTLEMENT_INVARIANT', 'SETTLEMENT_EVIDENCE', settlementEvidence.excludedRows, 0, settlementEvidence.excludedRows === 0 && certifiedResolved.length === resolved.length, 'Ogni riga Calcio risolta usata per readiness deve essere certificata dal gate settlement AUDIT08; nessuna coda Tennis puo influenzare questo sport.'),
    check('CALCIO_OPERATIONAL_RESOLVED_SAMPLE', 'EMPIRICAL_FORWARD', certifiedResolved.length, THRESHOLDS.calcio.operationalResolvedRowsMin, certifiedResolved.length >= THRESHOLDS.calcio.operationalResolvedRowsMin, 'Esiti operativi WON/LOST con timestamp settlement, fonte non pending/manuale e score strutturato documentato.'),
    check('CALCIO_RELIABILITY_RESOLVED_SAMPLE', 'EMPIRICAL_FORWARD', finite(reliability?.resolvedScoredRows,0), THRESHOLDS.calcio.reliabilityResolvedRowsMin, finite(reliability?.resolvedScoredRows,0) >= THRESHOLDS.calcio.reliabilityResolvedRowsMin, 'Affidabilità empiricamente validata su esiti risolti.'),
    check('CALCIO_CLV_VERIFIED_COVERAGE', 'MARKET_VALIDATION', finite(calcioCertifiedClv.certifiedCoveragePct,0), THRESHOLDS.calcio.clvVerifiedCoveragePctMin, finite(calcioCertifiedClv.certifiedCoveragePct,0) >= THRESHOLDS.calcio.clvVerifiedCoveragePctMin, 'Copertura CLV Calcio certificata con provenance temporale e benchmark bookmaker verificabile.'),
    check('CALCIO_CLV_RAW_VERIFIED_RECONCILIATION', 'MARKET_VALIDATION_DIAGNOSTIC', calcioCertifiedClv.rawOnlyRows || 0, 0, (calcioCertifiedClv.rawOnlyRows || 0) === 0, 'Diagnostica non bloccante: righe clv_verified=1 non certificabili secondo AUDIT09.', { blocking:false }),
    check('CALCIO_SPORT_KEY_COVERAGE', 'ROUTING', finite(calcioCoverage.sportKeyCoveragePct,0), THRESHOLDS.calcio.sportKeyCoveragePctMin, finite(calcioCoverage.sportKeyCoveragePct,0) >= THRESHOLDS.calcio.sportKeyCoveragePctMin, 'Routing provider Calcio deve essere sostanzialmente completo.'),
    check('CALCIO_ECONOMIC_SAMPLE', 'ECONOMIC', economics.rows, THRESHOLDS.calcio.economicPositiveStakeRowsMin, economics.rows >= THRESHOLDS.calcio.economicPositiveStakeRowsMin, 'Righe operative con settlement documentato/certificabile e stake positivo.'),
    check('CALCIO_ECONOMIC_ROI', 'ECONOMIC', economics.roiPct, `>=${THRESHOLDS.calcio.economicRoiPctMin}% dopo maturità campione`, economics.rows >= THRESHOLDS.calcio.economicPositiveStakeRowsMin && economics.roiPct != null && economics.roiPct >= THRESHOLDS.calcio.economicRoiPctMin, 'ROI empirico calcolato esclusivamente sul campione con settlement documentato; non promuovibile senza campione minimo.')
  ];
  const failures = checks.filter(c => c.blocking && !c.pass);
  return {
    sport: 'CALCIO',
    gateStatus: failures.length ? 'BLOCKED_STATISTICAL_READINESS' : 'MANUAL_CANARY_REVIEW_ELIGIBLE',
    statisticalGatePass: failures.length === 0,
    metrics: {
      operationalRows: operational.length,
      resolvedRows: resolved.length,
      certifiedResolvedRows: certifiedResolved.length,
      uncertifiedResolvedRows: Math.max(0, resolved.length - certifiedResolved.length),
      pendingRows: operational.filter(r => upper(r.status)==='PENDING').length,
      reliability: { scoredRows: reliability?.scoredRows || 0, resolvedScoredRows: reliability?.resolvedScoredRows || 0, validationCoveragePct: reliability?.validationCoveragePct || 0, empiricalStatus: reliability?.empiricalStatus || 'UNAVAILABLE' },
      historicalWalkForward: walkForwardError ? { error: walkForwardError } : { holdoutRows: holdout?.champion?.matches || 0, comparison: holdout?.comparison || null, recommendation, leagueRows },
      clv: { eligibleRows: calcioCoverage.eligibleRows || 0, rawVerifiedRows: calcioCertifiedClv.rawVerifiedRows || 0, rawVerifiedCoveragePct: calcioCertifiedClv.rawVerifiedCoveragePct || 0, verifiedRows: calcioCertifiedClv.certifiedRows || 0, verifiedCoveragePct: calcioCertifiedClv.certifiedCoveragePct || 0, certifiedRows: calcioCertifiedClv.certifiedRows || 0, certifiedCoveragePct: calcioCertifiedClv.certifiedCoveragePct || 0, rawOnlyRows: calcioCertifiedClv.rawOnlyRows || 0, exclusionReasons: calcioCertifiedClv.exclusionReasons || {}, sportKeyCoveragePct: calcioCoverage.sportKeyCoveragePct || 0, provenanceVersion: certifiedClv.version },
      settlementEvidence: { version: settlementEvidence.version, totalRows: settlementEvidence.totalRows, certifiedRows: settlementEvidence.certifiedRows, excludedRows: settlementEvidence.excludedRows, exclusionReasons: settlementEvidence.exclusionReasons },
      economics
    },
    checks,
    blockingFailures: failures.map(c => c.id),
    authority: { productionProbability:false, deepScanDecision:false, qualityGate:false, stake:false, settlement:false, automaticPromotion:false }
  };
}

function buildStatisticalProductionReadinessReport(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('PATCH55_DB_ADAPTER_REQUIRED');
  options = { ...options, [READ_CONTEXT]: { rows: loadAllRows(db), coverage: clvCoverage.buildCoverageReport(db, clvCoverage.DEFAULT_FOOTBALL_LEAGUES) } };
  const tennis = buildTennisSection(db, options);
  const calcio = buildCalcioSection(db, options);
  const statisticalGatePass = tennis.statisticalGatePass && calcio.statisticalGatePass;
  const reportCore = {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    thresholds: THRESHOLDS,
    statisticalGatePass,
    gateStatus: statisticalGatePass ? 'MANUAL_CANARY_REVIEW_ELIGIBLE' : 'BLOCKED_STATISTICAL_READINESS',
    tennis,
    calcio,
    downstreamRequiredPatches: ['56_UNIFIED_PORTFOLIO_RISK_AUTHORITY','57_PRODUCTION_SECURITY_SAFE_RELEASE','58_SCHEDULER_RELIABILITY_STATE_MACHINE','59_CONTROLLED_CANARY_ACTIVATION'],
    authority: {
      statisticalClassificationOnly: true,
      productionActivation: false,
      probabilityMutation: false,
      deepScanDecisionMutation: false,
      qualityGateMutation: false,
      stakeMutation: false,
      settlementMutation: false,
      schedulerMutation: false,
      automaticPromotion: false
    }
  };
  return { success: true, readOnly: true, generatedAt: new Date().toISOString(), evidenceHash: sha256(reportCore), ...reportCore };
}

function health(db, options = {}) {
  const report = buildStatisticalProductionReadinessReport(db, options);
  return {
    success: true,
    healthy: true,
    status: report.gateStatus,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    readOnly: true,
    statisticalGatePass: report.statisticalGatePass,
    tennis: { gateStatus: report.tennis.gateStatus, blockingFailures: report.tennis.blockingFailures, metrics: report.tennis.metrics },
    calcio: { gateStatus: report.calcio.gateStatus, blockingFailures: report.calcio.blockingFailures, metrics: report.calcio.metrics },
    evidenceHash: report.evidenceHash,
    authority: report.authority
  };
}

module.exports = { VERSION, POLICY_VERSION, MODE, THRESHOLDS, buildTennisSection, buildCalcioSection, buildStatisticalProductionReadinessReport, health };
