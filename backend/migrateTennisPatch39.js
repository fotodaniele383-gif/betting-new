'use strict';

const path = require('path');
const crypto = require('crypto');
const calibration = require('./tennisProbabilityCalibrationGuardPatch39');
const clvCoverage = require('./tennisClvSnapshotCoveragePatch39');
const receiptLink = require('./tennisExternalReceiptLinkPatch39');
const evidenceAgent = require('./tennisEvidenceVerificationAgentPatch39');
const venueRegistry = require('./tennisVenueRegistryPatch39');
const wtaRecovery = require('./tennisWtaFreshnessRecoveryPatch39');

const VERSION = 'TENNIS_PATCH39_PRIORITY_MIGRATION_V1';
const MIGRATION = 'ADDITIVE_PRIORITY_GOVERNANCE_WITH_TARGETED_STAKE_REDUCTION_NO_HISTORICAL_BACKFILL';
const TENNIS_WHERE = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";

function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function columnExists(db, table, column) { return db.prepare(`PRAGMA table_info(${table})`).all().some(row => String(row.name ?? row[1]) === column); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function addColumn(db, table, column, type) { if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
function counts(db) {
  const total = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
  const tennis = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${TENNIS_WHERE}`).get().n);
  const pending = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${TENNIS_WHERE} AND UPPER(COALESCE(status,''))='PENDING'`).get().n);
  const positive = db.prepare(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(stake),0),2) stake FROM ai_forward_test WHERE ${TENNIS_WHERE} AND UPPER(COALESCE(status,''))='PENDING' AND COALESCE(stake,0)>0`).get();
  return { total, tennis, pending, positiveStake: Number(positive.n || 0), stakeTotal: Number(positive.stake || 0) };
}
function protectedFingerprint(db) {
  const rows = db.prepare(`SELECT id,status,prediction,estimated_prob,odd,closing_odd,clv,home_team,away_team,match_date,profit FROM ai_forward_test ORDER BY id`).all();
  return sha(rows);
}
function createColumns(db) {
  const columns = {
    tennis_probability_guard_version: 'TEXT', tennis_probability_guard_status: 'TEXT',
    tennis_probability_raw_pct: 'REAL', tennis_probability_operational_pct: 'REAL', tennis_probability_reduction_pp: 'REAL',
    tennis_probability_guard_window: 'INTEGER', tennis_probability_guard_band: 'TEXT', tennis_probability_guard_sample: 'INTEGER',
    tennis_probability_guard_stake_cap: 'REAL', tennis_probability_guard_proposed_stake: 'REAL', tennis_probability_guard_reason: 'TEXT', tennis_probability_guard_decided_at: 'TEXT',
    tennis_evidence_agent_version: 'TEXT', tennis_evidence_agent_status: 'TEXT', tennis_evidence_agent_report_hash: 'TEXT',
    tennis_evidence_agent_verified_claims: 'INTEGER', tennis_evidence_agent_abstentions: 'INTEGER', tennis_evidence_agent_updated_at: 'TEXT',
    tennis_clv_snapshot_coverage_version: 'TEXT'
  };
  for (const [name, type] of Object.entries(columns)) addColumn(db, 'ai_forward_test', name, type);
}
function createAuditSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_patch39_priority_audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL,
      migration TEXT NOT NULL,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL UNIQUE
    );
    CREATE TRIGGER IF NOT EXISTS trg_tennis_patch39_audit_no_update BEFORE UPDATE ON tennis_patch39_priority_audit_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PATCH39_AUDIT_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_patch39_audit_no_delete BEFORE DELETE ON tennis_patch39_priority_audit_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PATCH39_AUDIT_APPEND_ONLY'); END;
  `);
}
function persistAudit(db, report) {
  createAuditSchema(db);
  const prior = db.prepare('SELECT * FROM tennis_patch39_priority_audit_runs ORDER BY id LIMIT 1').get();
  if (prior) return prior;
  const canonical = { ...report, generatedAt: null };
  const reportHash = sha(canonical);
  const runId = `TP39_${reportHash.slice(0,24)}`;
  db.prepare('INSERT INTO tennis_patch39_priority_audit_runs(run_id,generated_at,version,migration,report_json,report_hash) VALUES(?,?,?,?,?,?)')
    .run(runId, report.generatedAt, VERSION, MIGRATION, JSON.stringify(report), reportHash);
  return db.prepare('SELECT * FROM tennis_patch39_priority_audit_runs WHERE run_id=?').get(runId);
}
function latestReceipts(db) {
  if (!tableExists(db, 'tennis_external_intelligence_receipts')) return [];
  return db.prepare(`SELECT r.* FROM tennis_external_intelligence_receipts r
    JOIN (SELECT bet_id, MAX(id) max_id FROM tennis_external_intelligence_receipts WHERE bet_id IS NOT NULL GROUP BY bet_id) x ON x.max_id=r.id
    ORDER BY r.bet_id`).all();
}
function apply(db, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const before = counts(db);
  const protectedBefore = protectedFingerprint(db);
  const statusBefore = db.prepare(`SELECT id,stake,professional_gate_allow_bet,professional_gate_max_stake FROM ai_forward_test WHERE ${TENNIS_WHERE} AND UPPER(COALESCE(status,''))='PENDING' ORDER BY id`).all();

  createColumns(db);
  calibration.createSchema(db);
  clvCoverage.createSchema(db);
  receiptLink.createSchema(db);
  evidenceAgent.createSchema(db);
  createAuditSchema(db);

  const calibrationReport = calibration.buildCalibrationReport(db, { generatedAt });
  const calibrationRun = calibration.persistRun(db, calibrationReport);
  const pendingRows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${TENNIS_WHERE} AND UPPER(COALESCE(status,''))='PENDING' ORDER BY id`).all();
  const stakeChanges = [];
  for (const row of pendingRows) {
    const originalProposedStake = row.tennis_probability_guard_proposed_stake == null ? Number(row.stake || 0) : Number(row.tennis_probability_guard_proposed_stake || 0);
    const decision = calibration.decide({ estimated_prob: row.estimated_prob, proposedStake: originalProposedStake }, calibrationReport);
    calibration.persistDecision(db, row.id, decision, calibrationReport.reportHash);
    const finalStake = Math.min(Number(row.stake || 0), Number(decision.finalStake || 0));
    const changed = finalStake < Number(row.stake || 0) - 1e-9;
    db.prepare(`UPDATE ai_forward_test SET
      tennis_probability_guard_version=?, tennis_probability_guard_status=?, tennis_probability_raw_pct=?,
      tennis_probability_operational_pct=?, tennis_probability_reduction_pp=?, tennis_probability_guard_window=?,
      tennis_probability_guard_band=?, tennis_probability_guard_sample=?, tennis_probability_guard_stake_cap=?, tennis_probability_guard_proposed_stake=?,
      tennis_probability_guard_reason=?, tennis_probability_guard_decided_at=?, tennis_clv_snapshot_coverage_version=?,
      stake=?, professional_gate_allow_bet=CASE WHEN ?<=0 THEN 0 ELSE professional_gate_allow_bet END,
      professional_gate_max_stake=CASE WHEN professional_gate_max_stake IS NULL THEN ? ELSE MIN(professional_gate_max_stake,?) END,
      tennis_operational_status=CASE WHEN ?<=0 AND COALESCE(stake,0)>0 THEN 'PROBABILITY_GUARD_HARD_OVERCONFIDENCE_PAPER_ONLY' ELSE tennis_operational_status END,
      tennis_operational_action=CASE WHEN ?<=0 AND COALESCE(stake,0)>0 THEN 'PAPER_ONLY_OVERCONFIDENCE_GUARD' ELSE tennis_operational_action END,
      tennis_operational_summary=CASE WHEN ?<=0 AND COALESCE(stake,0)>0 THEN ? ELSE tennis_operational_summary END,
      stake_policy_note=CASE WHEN ?<=0 AND COALESCE(stake,0)>0 THEN ? ELSE stake_policy_note END
      WHERE id=?`).run(
        decision.version, decision.status, decision.rawProbabilityPct, decision.operationalProbabilityPct,
        decision.probabilityReductionPp, decision.evidenceWindow, decision.evidenceBand, decision.evidenceSample,
        decision.finalStakeCap, originalProposedStake, decision.reason, generatedAt, clvCoverage.VERSION,
        finalStake, finalStake, finalStake, finalStake,
        finalStake, finalStake, finalStake, decision.reason, finalStake, `Patch39 ${decision.status}: ${decision.reason}`, row.id
      );
    if (changed) stakeChanges.push({ id: row.id, match: `${row.home_team} - ${row.away_team}`, probability: row.estimated_prob, before: Number(row.stake || 0), after: finalStake, status: decision.status, band: decision.evidenceBand, sample: decision.evidenceSample, reductionPp: decision.probabilityReductionPp });
  }

  const openingSnapshotsInserted = clvCoverage.ensureFirstSeenSnapshots(db, pendingRows, { now: new Date(generatedAt) });
  const receiptRepair = receiptLink.repairMissingLinks(db);
  let agentRowsEvaluated = 0;
  let agentClaims = 0;
  for (const receipt of latestReceipts(db)) {
    const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(receipt.bet_id);
    if (!row) continue;
    let intelligence;
    try { intelligence = JSON.parse(receipt.payload_json); } catch (_) { continue; }
    const report = evidenceAgent.verify(row, intelligence, receipt);
    const persisted = evidenceAgent.persist(db, row, report);
    db.prepare(`UPDATE ai_forward_test SET tennis_evidence_agent_version=?,tennis_evidence_agent_status=?,tennis_evidence_agent_report_hash=?,tennis_evidence_agent_verified_claims=?,tennis_evidence_agent_abstentions=?,tennis_evidence_agent_updated_at=? WHERE id=?`)
      .run(report.version, report.status, report.reportHash, report.metrics.verifiedClaims, report.metrics.abstentions, report.generatedAt, row.id);
    agentRowsEvaluated += 1;
    agentClaims += persisted.claims.length;
  }

  const after = counts(db);
  const protectedAfter = protectedFingerprint(db);
  const report = {
    success: true, version: VERSION, migration: MIGRATION, generatedAt,
    before, after,
    protectedBusinessFingerprintBefore: protectedBefore,
    protectedBusinessFingerprintAfter: protectedAfter,
    protectedBusinessFieldsUnchanged: protectedBefore === protectedAfter,
    rowCountsUnchanged: before.total === after.total && before.tennis === after.tennis && before.pending === after.pending,
    stakeChanges,
    stakeReductionsOnly: stakeChanges.every(row => row.after <= row.before),
    calibration: { reportHash: calibrationReport.reportHash, runId: calibrationRun.run_id, windows: calibrationReport.windows, decisionRows: Number(db.prepare('SELECT COUNT(*) n FROM tennis_probability_guard_decisions').get().n) },
    clv: { openingSnapshotsInserted, ...clvCoverage.coverageHealth(db), historicalClosingReconstruction: false },
    externalReceipts: { repair: receiptRepair, ...receiptLink.health(db) },
    evidenceAgent: { rowsEvaluated: agentRowsEvaluated, claimsPersistedOrReused: agentClaims, ...evidenceAgent.health(db) },
    venueRegistry: venueRegistry.health(),
    wtaRecovery: { ...wtaRecovery.health({ dataDir: options.dataDir || path.join(__dirname, 'sackmann_data') }), liveRefreshExecutedByMigration: false },
    authority: { canIncreaseProbability: false, canIncreaseStake: false, settlement: false, automaticPrediction: false, unsupportedClaimsAllowed: 0 }
  };
  const audit = persistAudit(db, report);
  report.auditRunId = audit.run_id;
  report.auditRows = Number(db.prepare('SELECT COUNT(*) n FROM tennis_patch39_priority_audit_runs').get().n);
  report.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check || 'ok';
  report.foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
  return report;
}

function openDatabase(file) {
  try { const Better = require('better-sqlite3'); return new Better(file); }
  catch (_) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file); }
}

if (require.main === module) {
  const rootIndex = process.argv.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : path.join(__dirname, '..'));
  const preview = process.argv.includes('--preview');
  const dbPath = path.join(root, 'backend', 'database_betting.db');
  const db = openDatabase(dbPath);
  try {
    if (preview) {
      const report = calibration.buildCalibrationReport(db);
      const rows = db.prepare(`SELECT id,home_team,away_team,estimated_prob,stake FROM ai_forward_test WHERE ${TENNIS_WHERE} AND UPPER(COALESCE(status,''))='PENDING' AND COALESCE(stake,0)>0 ORDER BY id`).all();
      console.log(JSON.stringify({ success:true, preview:true, version:VERSION, counts:counts(db), calibration:report, proposed:rows.map(row => ({...row,decision:calibration.decide({estimated_prob:row.estimated_prob,proposedStake:row.stake},report)})) }, null, 2));
    } else console.log(JSON.stringify(apply(db, { dataDir:path.join(root,'backend','sackmann_data') }), null, 2));
  } finally { try { db.close(); } catch (_) {} }
}

module.exports = { VERSION, MIGRATION, TENNIS_WHERE, columnExists, tableExists, counts, protectedFingerprint, createColumns, createAuditSchema, apply, openDatabase };
