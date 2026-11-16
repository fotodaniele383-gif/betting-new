'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('./patch15-db-adapter');
const historical = require('../backend/tennisHistoricalPlayerStats');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const datasetPath = process.env.TENNIS_HISTORICAL_DATASET_PATH || path.join(root, 'data', 'tennisdb_historical_player_stats.json');
const auditDir = path.join(root, 'audit_patch16');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (db, sql, params = []) => Number(db.prepare(sql).get(...params).n || 0);
const tennisWhere = "UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'";

fs.mkdirSync(auditDir, { recursive: true });
historical.loadDataset(datasetPath, { force: true });
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const { db, adapter, native } = openDatabase(dbPath, { projectRoot: root, fileMustExist: true });
let report;
try {
  const before = {
    sourceRows: count(db, 'SELECT COUNT(*) n FROM ai_forward_test'),
    tennisRows: count(db, `SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`),
    datasets: (() => { try { return count(db, `SELECT COUNT(*) n FROM ${historical.TABLE_IMPORTS}`); } catch (_) { return 0; } })(),
    records: (() => { try { return count(db, `SELECT COUNT(*) n FROM ${historical.TABLE_RECORDS}`); } catch (_) { return 0; } })(),
    integrity: db.prepare('PRAGMA integrity_check').get().integrity_check
  };
  const hashBefore = sha256(dbPath);
  let persisted;
  db.exec('BEGIN IMMEDIATE');
  try {
    const schema = historical.ensureHistoricalStatsSchema(db);
    persisted = historical.persistDatasetToDb(db, dataset);
    const duringSourceRows = count(db, 'SELECT COUNT(*) n FROM ai_forward_test');
    const duringTennisRows = count(db, `SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`);
    if (duringSourceRows !== before.sourceRows || duringTennisRows !== before.tennisRows) throw new Error('PATCH16_SOURCE_ROWS_CHANGED');
    db.exec('COMMIT');
    report = { schema };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  const health = historical.getDatabaseHealth(db);
  const after = {
    sourceRows: count(db, 'SELECT COUNT(*) n FROM ai_forward_test'),
    tennisRows: count(db, `SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`),
    datasets: count(db, `SELECT COUNT(*) n FROM ${historical.TABLE_IMPORTS}`),
    records: count(db, `SELECT COUNT(*) n FROM ${historical.TABLE_RECORDS}`),
    activeRecords: count(db, `SELECT COUNT(*) n FROM ${historical.TABLE_RECORDS} WHERE record_status='ACTIVE'`),
    integrity: db.prepare('PRAGMA integrity_check').get().integrity_check
  };
  if (before.sourceRows !== after.sourceRows || before.tennisRows !== after.tennisRows) throw new Error('PATCH16_SOURCE_ROWS_CHANGED_AFTER_COMMIT');
  if (after.integrity !== 'ok') throw new Error(`PATCH16_INTEGRITY:${after.integrity}`);
  report = {
    success: health.success === true,
    patch: '16',
    version: historical.TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
    adapter, native, dbPath, datasetPath, datasetId: dataset.datasetId,
    ...report, persisted, health, before, after,
    historicalBetBackfill: false,
    sourceRowsModified: 0,
    modelProbabilityAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    dbHashBefore: hashBefore,
    dbHashAfter: sha256(dbPath),
    timestamp: new Date().toISOString()
  };
} finally { db.close(); }
fs.writeFileSync(path.join(auditDir, 'patch16_migration_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 2;
