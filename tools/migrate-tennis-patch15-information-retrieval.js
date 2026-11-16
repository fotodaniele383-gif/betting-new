'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('./patch15-db-adapter');
const retrieval = require('../backend/tennisInformationRetrievalCertification');

const projectRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(projectRoot, 'backend', 'database_betting.db');
const auditDir = path.join(projectRoot, 'audit_patch15');
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function count(db, table) { try { return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n || 0); } catch (_) { return 0; } }

const { db, adapter } = openDatabase(dbPath, { projectRoot, fileMustExist: true });
try {
  const before = {
    sourceRows: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0),
    tennisRows: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0),
    runs: count(db, retrieval.TABLE_RUNS), checks: count(db, retrieval.TABLE_CHECKS), receipts: count(db, retrieval.TABLE_RECEIPTS), integrity: db.prepare('PRAGMA integrity_check').get().integrity_check
  };
  const dbHashBefore = sha256File(dbPath);
  const schema = retrieval.ensureInformationRetrievalSchema(db);
  const after = {
    sourceRows: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0),
    tennisRows: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0),
    runs: count(db, retrieval.TABLE_RUNS), checks: count(db, retrieval.TABLE_CHECKS), receipts: count(db, retrieval.TABLE_RECEIPTS), integrity: db.prepare('PRAGMA integrity_check').get().integrity_check
  };
  if (before.sourceRows !== after.sourceRows || before.tennisRows !== after.tennisRows) throw new Error('PATCH15_SOURCE_ROWS_CHANGED');
  if (after.runs !== before.runs || after.checks !== before.checks || after.receipts !== before.receipts) throw new Error('PATCH15_HISTORICAL_BACKFILL_FORBIDDEN');
  if (after.integrity !== 'ok') throw new Error(`PATCH15_INTEGRITY:${after.integrity}`);
  const report = { success: true, patch: '15', version: retrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION, schema, adapter, dbPath, before, after, historicalBackfill: false, sourceRowsModified: 0, dbHashBefore, dbHashAfter: null, timestamp: new Date().toISOString() };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'patch15_migration_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
