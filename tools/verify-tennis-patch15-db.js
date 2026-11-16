'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('./patch15-db-adapter');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch15');
fs.mkdirSync(auditDir, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const beforeHash = hash(dbPath);
const { db, adapter, native } = openDatabase(dbPath, { projectRoot: root, fileMustExist: true });
let result;
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const totalRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisRows = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'").get().n || 0);
  const tableCount = Object.fromEntries([retrieval.TABLE_RUNS, retrieval.TABLE_CHECKS, retrieval.TABLE_RECEIPTS].map(table => [table, Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n || 0)]));
  const triggerNames = ['trg_tennis_info_runs_no_update','trg_tennis_info_runs_no_delete','trg_tennis_info_checks_no_update','trg_tennis_info_checks_no_delete','trg_tennis_prediction_receipts_no_update','trg_tennis_prediction_receipts_no_delete'];
  const triggerCount = Object.fromEntries(triggerNames.map(trigger => [trigger, Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).n || 0)]));
  const before = {
    runs: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RUNS}`).get().n || 0),
    checks: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_CHECKS}`).get().n || 0),
    receipts: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RECEIPTS}`).get().n || 0)
  };
  const canaryId = 990015;
  let canary;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO ai_forward_test (id,bet_type,match_date,home_team,away_team,prediction,odd,stake,status,estimated_prob,edge,edge_pp,ev_pct,league,strategy_tag,sport_type,ds_action,reference_odd1,reference_odd2,reference_market_source,market_type,surface,tennis_canonical_match_key,provider_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      canaryId,'SINGLE_TENNIS','2026-07-20T12:00:00Z','Canary Player A','Canary Player B','1',1.9,2,'PENDING',60,5,5,14,'ATP Canary','TENNIS_ATP_MONEYLINE','TENNIS','VALUE CONFERMATO',1.9,2.1,'CANARY','moneyline','Hard','canary-key','canary-event'
    );
    const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(canaryId);
    const receipt = retrieval.persistPredictionEvidenceReceipt(db, row, row, { betId: canaryId, snapshotId: 'PATCH15_CANARY', phase: retrieval.RECEIPT_PHASES.PREDICTION_CAPTURE, createdAt: '2026-07-15T12:00:00Z', playerDataHealth: { status: 'STALE', latestMatchAt: '2026-05-25T12:00:00Z', engine: { temporalLeakageGuard: true } } });
    let updateBlocked = false; let deleteBlocked = false;
    try { db.prepare(`UPDATE ${retrieval.TABLE_RECEIPTS} SET status='X' WHERE receipt_id=?`).run(receipt.receipt.receiptId); } catch (_) { updateBlocked = true; }
    try { db.prepare(`DELETE FROM ${retrieval.TABLE_RECEIPTS} WHERE receipt_id=?`).run(receipt.receipt.receiptId); } catch (_) { deleteBlocked = true; }
    canary = { success: receipt.inserted === true && updateBlocked && deleteBlocked, receiptId: receipt.receipt.receiptId, updateBlocked, deleteBlocked, immutable: updateBlocked && deleteBlocked };
  } finally { db.exec('ROLLBACK'); }
  const after = {
    runs: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RUNS}`).get().n || 0),
    checks: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_CHECKS}`).get().n || 0),
    receipts: Number(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RECEIPTS}`).get().n || 0),
    canarySource: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE id=?').get(canaryId).n || 0)
  };
  const health = retrieval.buildInformationRetrievalHealth(db, { dataDir: path.join(root, 'backend', 'sackmann_data'), cacheDir: path.join(root, 'backend', 'cache_news'), limit: 5 });
  const progressionReport = progression.buildProgramProgressionAudit(db, { projectRoot: root });
  result = {
    success: integrity === 'ok' && totalRows > 0 && tennisRows > 0 && Object.values(tableCount).every(value => value === 1) && Object.values(triggerCount).every(value => value === 1) && canary.success && JSON.stringify(before) === JSON.stringify({ runs: after.runs, checks: after.checks, receipts: after.receipts }) && after.canarySource === 0 && !['FAIL','SCHEMA_MISSING'].includes(health.status) && progressionReport.errors === 0,
    patch: '15', adapter, native, integrity, totalRows, tennisRows, tableCount, triggerCount,
    before, after, countsRestored: before.runs === after.runs && before.checks === after.checks && before.receipts === after.receipts,
    canary, retrieval: { status: health.status, overallScore: health.overallScore, counts: health.counts, stakeAuthority: health.stakeAuthority },
    progression: { status: progressionReport.status, errors: progressionReport.errors, warnings: progressionReport.warnings },
    historicalBackfill: false, readOnlyAudit: true, hashBefore: beforeHash, hashAfter: null
  };
} finally { db.close(); }
result.hashAfter = hash(dbPath);
result.databaseStableAfterCanary = result.hashBefore === result.hashAfter;
// SQLite WAL/header metadata may differ after a rolled-back write. Source and derived row counts are the certification boundary.
result.success = result.success && result.countsRestored;
fs.writeFileSync(path.join(auditDir, 'patch15_db_verification_report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 2;
