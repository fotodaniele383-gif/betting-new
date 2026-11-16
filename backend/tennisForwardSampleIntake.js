'use strict';

const crypto = require('crypto');

const TENNIS_FORWARD_SAMPLE_INTAKE_VERSION = 'TENNIS_FORWARD_SAMPLE_INTAKE_V1_PATCH24';
const MODE = 'FORWARD_ONLY_CAPTURE_ASSURANCE_NO_HISTORICAL_BACKFILL_NO_PRODUCTION_AUTHORITY';
const STATUS = Object.freeze({
  READY_FOR_NEXT_PREDICTION: 'READY_FOR_NEXT_PREDICTION',
  CAPTURING_FORWARD_SAMPLE: 'CAPTURING_FORWARD_SAMPLE',
  DEGRADED_CAPTURE: 'DEGRADED_CAPTURE',
  BLOCKED_CAPTURE: 'BLOCKED_CAPTURE'
});
const MIN_FORWARD_ACTIONABLE_ROWS = 100;
const AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION = 'AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';

const TABLES = Object.freeze({
  source: 'ai_forward_test',
  snapshots: 'tennis_prediction_snapshots',
  ledger: 'tennis_calibration_eligibility',
  cohorts: 'tennis_forward_cohort_members',
  playerEvidence: 'tennis_player_evidence_snapshots',
  matchup: 'tennis_matchup_feature_snapshots',
  challenger: 'tennis_challenger_predictions',
  receipts: 'tennis_prediction_evidence_receipts'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)); }
  catch (_) { return false; }
}
function tableColumns(db, table) {
  if (!tableExists(db, table)) return new Set();
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
  catch (_) { return new Set(); }
}
function count(db, table, where = '', params = []) {
  if (!tableExists(db, table)) return 0;
  return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).n || 0);
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function tennisWhere(columns) {
  const parts = [];
  if (columns.has('sport_type')) parts.push("UPPER(COALESCE(sport_type,''))='TENNIS'");
  if (columns.has('bet_type')) parts.push("UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'");
  if (columns.has('strategy_tag')) parts.push("UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'");
  if (columns.has('league')) parts.push("UPPER(COALESCE(league,'')) LIKE '%ATP%'", "UPPER(COALESCE(league,'')) LIKE '%WTA%'");
  return parts.length ? `(${parts.join(' OR ')})` : '0=1';
}
function latestRow(db, table, orderColumn, where = '', params = []) {
  if (!tableExists(db, table) || !tableColumns(db, table).has(orderColumn)) return null;
  try { return db.prepare(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''} ORDER BY ${orderColumn} DESC LIMIT 1`).get(...params) || null; }
  catch (_) { return null; }
}

function inspectForwardSampleIntake(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('DB_ADAPTER_REQUIRED');
  const sourceColumns = tableColumns(db, TABLES.source);
  const requiredTables = Object.values(TABLES);
  const missingTables = requiredTables.filter(table => !tableExists(db, table));
  const sourceIdentityAlternatives = {
    matchStart: ['canonical_match_datetime', 'match_start_at', 'match_date'].filter(column => sourceColumns.has(column)),
    home: ['home_team', 'home'].filter(column => sourceColumns.has(column)),
    away: ['away_team', 'away'].filter(column => sourceColumns.has(column)),
    side: ['internal_side', 'predicted_side', 'prediction'].filter(column => sourceColumns.has(column)),
    odd: ['opening_odd', 'odd'].filter(column => sourceColumns.has(column)),
    probability: ['estimated_prob', 'estimatedProb', 'probability'].filter(column => sourceColumns.has(column))
  };
  const missingSourceCapabilities = Object.entries(sourceIdentityAlternatives).filter(([, values]) => values.length === 0).map(([key]) => key);
  const structuralReady = missingTables.length === 0 && missingSourceCapabilities.length === 0;

  const sourceWhere = tennisWhere(sourceColumns);
  const sourceRows = tableExists(db, TABLES.source) ? count(db, TABLES.source, sourceWhere) : 0;
  const snapshots = count(db, TABLES.snapshots);
  const anchors = count(db, TABLES.snapshots, 'is_calibration_anchor=1');
  const validAnchors = count(db, TABLES.snapshots, "is_calibration_anchor=1 AND UPPER(COALESCE(snapshot_status,''))='VALID_PREMATCH'");
  const ledgerRows = count(db, TABLES.ledger);
  const cohortMembers = count(db, TABLES.cohorts);
  const playerEvidenceRows = count(db, TABLES.playerEvidence);
  const matchupRows = count(db, TABLES.matchup);
  const challengerRows = count(db, TABLES.challenger);
  const receiptRows = count(db, TABLES.receipts, "UPPER(COALESCE(phase,''))='PREDICTION_CAPTURE'");
  const latestSnapshot = latestRow(db, TABLES.snapshots, 'id');
  const latestSource = tableExists(db, TABLES.source) && sourceColumns.has('id')
    ? latestRow(db, TABLES.source, 'id', sourceWhere)
    : null;

  // AUDIT16D_R3_T1: snapshot revisions are append-only and may legitimately create
  // multiple rows for the same bet. Coverage must therefore be evaluated per distinct
  // prediction/bet identity, never by comparing raw snapshot row totals to one-row-per-bet ledgers.
  const snapshotBetCount = tableExists(db, TABLES.snapshots)
    ? Number(db.prepare(`SELECT COUNT(DISTINCT bet_id) n FROM ${TABLES.snapshots} WHERE bet_id IS NOT NULL`).get()?.n || 0)
    : 0;
  const missingCoverage = {
    eligibilityLedger: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.ledger)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT s.bet_id FROM ${TABLES.snapshots} s LEFT JOIN ${TABLES.ledger} l ON l.bet_id=s.bet_id WHERE s.bet_id IS NOT NULL AND l.bet_id IS NULL)`).get()?.n || 0)
      : snapshotBetCount,
    cohortForValidAnchor: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.cohorts)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT s.bet_id FROM ${TABLES.snapshots} s LEFT JOIN ${TABLES.cohorts} c ON c.bet_id=s.bet_id WHERE s.bet_id IS NOT NULL AND s.is_calibration_anchor=1 AND UPPER(COALESCE(s.snapshot_status,''))='VALID_PREMATCH' AND c.bet_id IS NULL)`).get()?.n || 0)
      : validAnchors,
    playerEvidencePair: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.playerEvidence)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT s.bet_id FROM (SELECT DISTINCT bet_id FROM ${TABLES.snapshots} WHERE bet_id IS NOT NULL) s LEFT JOIN ${TABLES.playerEvidence} p ON p.bet_id=s.bet_id GROUP BY s.bet_id HAVING COUNT(p.bet_id)<2)`).get()?.n || 0)
      : snapshotBetCount,
    matchup: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.matchup)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT s.bet_id FROM ${TABLES.snapshots} s LEFT JOIN ${TABLES.matchup} m ON m.bet_id=s.bet_id WHERE s.bet_id IS NOT NULL AND m.bet_id IS NULL)`).get()?.n || 0)
      : snapshotBetCount,
    challenger: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.challenger)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT s.bet_id FROM ${TABLES.snapshots} s LEFT JOIN ${TABLES.challenger} c ON c.bet_id=s.bet_id WHERE s.bet_id IS NOT NULL AND c.bet_id IS NULL)`).get()?.n || 0)
      : snapshotBetCount,
    predictionReceipt: tableExists(db, TABLES.snapshots) && tableExists(db, TABLES.receipts)
      ? Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT s.bet_id FROM ${TABLES.snapshots} s LEFT JOIN ${TABLES.receipts} r ON r.bet_id=s.bet_id AND UPPER(COALESCE(r.phase,''))='PREDICTION_CAPTURE' WHERE s.bet_id IS NOT NULL AND r.bet_id IS NULL)`).get()?.n || 0)
      : snapshotBetCount
  };

  const structuralGaps = [];
  if (missingCoverage.eligibilityLedger > 0) structuralGaps.push('ELIGIBILITY_LEDGER_COVERAGE_GAP');
  if (missingCoverage.cohortForValidAnchor > 0) structuralGaps.push('COHORT_MEMBER_COVERAGE_GAP');
  if (missingCoverage.playerEvidencePair > 0) structuralGaps.push('PLAYER_EVIDENCE_PAIR_COVERAGE_GAP');
  if (missingCoverage.matchup > 0) structuralGaps.push('MATCHUP_SNAPSHOT_COVERAGE_GAP');
  if (missingCoverage.challenger > 0) structuralGaps.push('CHALLENGER_SNAPSHOT_COVERAGE_GAP');
  if (missingCoverage.predictionReceipt > 0) structuralGaps.push('PREDICTION_RECEIPT_COVERAGE_GAP');

  let structurallyCompleteRows = 0;
  let settledCertificationReadyRows = 0;
  if (structuralReady && validAnchors > 0) {
    const anchorRows = db.prepare(`SELECT bet_id FROM ${TABLES.snapshots}
      WHERE is_calibration_anchor=1 AND UPPER(COALESCE(snapshot_status,''))='VALID_PREMATCH'`).all();
    for (const row of anchorRows) {
      const artifacts = inspectBetArtifacts(db, Number(row.bet_id));
      if (!artifacts.structuralComplete) continue;
      structurallyCompleteRows += 1;
      const sourceStatus = upper(db.prepare(`SELECT status FROM ${TABLES.source} WHERE id=?`).get(Number(row.bet_id))?.status);
      if (sourceStatus === 'WON' || sourceStatus === 'LOST') settledCertificationReadyRows += 1;
    }
  }

  let status = STATUS.READY_FOR_NEXT_PREDICTION;
  if (!structuralReady) status = STATUS.BLOCKED_CAPTURE;
  else if (structuralGaps.length) status = STATUS.DEGRADED_CAPTURE;
  else if (validAnchors > 0) status = STATUS.CAPTURING_FORWARD_SAMPLE;

  const captureProgressPct = Math.min(100, Number(((structurallyCompleteRows / MIN_FORWARD_ACTIONABLE_ROWS) * 100).toFixed(2)));
  const settledProgressPct = Math.min(100, Number(((settledCertificationReadyRows / MIN_FORWARD_ACTIONABLE_ROWS) * 100).toFixed(2)));
  const result = {
    success: status !== STATUS.BLOCKED_CAPTURE,
    healthy: status === STATUS.CAPTURING_FORWARD_SAMPLE || status === STATUS.READY_FOR_NEXT_PREDICTION,
    status,
    version: TENNIS_FORWARD_SAMPLE_INTAKE_VERSION,
    mode: MODE,
    readOnly: true,
    historicalBackfill: false,
    structuralReady,
    missingTables,
    missingSourceCapabilities,
    structuralGaps,
    counts: { sourceRows, snapshots, snapshotBetCount, anchors, validAnchors, ledgerRows, cohortMembers, playerEvidenceRows, matchupRows, challengerRows, receiptRows },
    coverage: { missing: missingCoverage, exactPerBetIdentity: true },
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    forwardSample: {
      capturedValidAnchors: validAnchors,
      structurallyCompleteRows,
      actionableRows: settledCertificationReadyRows,
      minimumActionableRows: MIN_FORWARD_ACTIONABLE_ROWS,
      captureProgressPct,
      progressPct: settledProgressPct,
      remainingCapturedRows: Math.max(0, MIN_FORWARD_ACTIONABLE_ROWS - structurallyCompleteRows),
      remainingRows: Math.max(0, MIN_FORWARD_ACTIONABLE_ROWS - settledCertificationReadyRows),
      promotionAuthority: false,
      manualReviewRequired: true
    },
    latestSource: latestSource ? {
      betId: Number(latestSource.id || 0) || null,
      matchDate: latestSource.canonical_match_datetime || latestSource.match_start_at || latestSource.match_date || null,
      status: latestSource.status || null
    } : null,
    latestSnapshot: latestSnapshot ? {
      snapshotId: latestSnapshot.snapshot_id || null,
      betId: Number(latestSnapshot.bet_id || 0) || null,
      status: latestSnapshot.snapshot_status || null,
      capturedAt: latestSnapshot.captured_at || null,
      calibrationAnchor: Number(latestSnapshot.is_calibration_anchor || 0) === 1
    } : null,
    nextAction: status === STATUS.READY_FOR_NEXT_PREDICTION
      ? 'RUN_NEXT_REAL_PREMATCH_TENNIS_ANALYSIS'
      : status === STATUS.CAPTURING_FORWARD_SAMPLE
        ? 'ACCUMULATE_AND_SETTLE_FORWARD_ROWS'
        : 'REPAIR_CAPTURE_PIPELINE_BEFORE_NEW_SAMPLE',
    authority: {
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false,
      historicalBetMutation: false
    }
  };
  return { ...result, evidenceHash: hash(result) };
}

function inspectBetArtifacts(db, betId) {
  const id = Number(betId);
  if (!(id > 0)) throw new Error('PATCH24_BET_ID_INVALID');
  const source = tableExists(db, TABLES.source) ? db.prepare(`SELECT * FROM ${TABLES.source} WHERE id=?`).get(id) || null : null;
  const snapshot = tableExists(db, TABLES.snapshots) ? db.prepare(`SELECT * FROM ${TABLES.snapshots} WHERE bet_id=? ORDER BY snapshot_sequence LIMIT 1`).get(id) || null : null;
  const ledger = tableExists(db, TABLES.ledger) ? db.prepare(`SELECT * FROM ${TABLES.ledger} WHERE bet_id=?`).get(id) || null : null;
  const cohort = tableExists(db, TABLES.cohorts) ? db.prepare(`SELECT * FROM ${TABLES.cohorts} WHERE bet_id=?`).get(id) || null : null;
  const playerEvidence = count(db, TABLES.playerEvidence, 'bet_id=?', [id]);
  const matchup = count(db, TABLES.matchup, 'bet_id=?', [id]);
  const challenger = count(db, TABLES.challenger, 'bet_id=?', [id]);
  const receipts = count(db, TABLES.receipts, "bet_id=? AND UPPER(COALESCE(phase,''))='PREDICTION_CAPTURE'", [id]);
  const anchorEligible = Boolean(snapshot && Number(snapshot.is_calibration_anchor || 0) === 1 && upper(snapshot.snapshot_status) === 'VALID_PREMATCH');
  const missing = [];
  if (!source) missing.push('SOURCE_ROW_MISSING');
  if (!snapshot) missing.push('PREDICTION_SNAPSHOT_MISSING');
  if (!ledger) missing.push('ELIGIBILITY_LEDGER_MISSING');
  if (playerEvidence < 2) missing.push('PLAYER_EVIDENCE_PAIR_MISSING');
  if (matchup < 1) missing.push('MATCHUP_SNAPSHOT_MISSING');
  if (challenger < 1) missing.push('CHALLENGER_SNAPSHOT_MISSING');
  if (receipts < 1) missing.push('PREDICTION_RECEIPT_MISSING');
  if (anchorEligible && !cohort) missing.push('COHORT_MEMBER_MISSING_FOR_VALID_ANCHOR');
  const eligibilityReasons = [];
  if (snapshot && !anchorEligible) eligibilityReasons.push(`SNAPSHOT_${upper(snapshot.snapshot_status) || 'NOT_ELIGIBLE'}`);
  if (snapshot && Number(snapshot.is_calibration_anchor || 0) !== 1) eligibilityReasons.push('CALIBRATION_ANCHOR_NOT_ASSIGNED');
  return {
    betId: id,
    success: missing.length === 0,
    structuralComplete: missing.length === 0,
    certificationEligible: missing.length === 0 && anchorEligible && Boolean(cohort),
    missing,
    eligibilityReasons: [...new Set(eligibilityReasons)],
    artifacts: {
      source: Boolean(source),
      snapshot: Boolean(snapshot),
      snapshotId: snapshot?.snapshot_id || null,
      snapshotStatus: snapshot?.snapshot_status || null,
      calibrationAnchor: snapshot ? Number(snapshot.is_calibration_anchor || 0) === 1 : false,
      ledger: Boolean(ledger),
      cohort: Boolean(cohort),
      playerEvidence,
      matchup,
      challenger,
      receipts
    },
    noHistoricalBackfill: true,
    authority: { productionProbability: false, qualityGate: false, stake: false, settlement: false }
  };
}

function assertForwardCapturePostconditions(db, betId, options = {}) {
  const result = inspectBetArtifacts(db, betId);
  if (!result.structuralComplete && options.throwOnFailure === true) {
    const error = new Error(`PATCH24_FORWARD_CAPTURE_POSTCONDITION_FAILED:${result.missing.join(',')}`);
    error.code = 'PATCH24_FORWARD_CAPTURE_POSTCONDITION_FAILED';
    error.details = result;
    throw error;
  }
  return { ...result, version: TENNIS_FORWARD_SAMPLE_INTAKE_VERSION, mode: MODE, operationId: options.operationId || null };
}

module.exports = {
  TENNIS_FORWARD_SAMPLE_INTAKE_VERSION,
  MODE,
  STATUS,
  MIN_FORWARD_ACTIONABLE_ROWS,
  AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
  TABLES,
  tableExists,
  tableColumns,
  inspectForwardSampleIntake,
  inspectBetArtifacts,
  assertForwardCapturePostconditions
};
