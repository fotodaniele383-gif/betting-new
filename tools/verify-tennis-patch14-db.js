'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const refresh = require('../backend/tennisPlayerDataRefresh');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch14'); fs.mkdirSync(auditDir, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = hash(dbPath);
const db = new DatabaseSync(dbPath, { readOnly: true });
let result;
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const totalRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisRows = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n || 0);
  const dataHealth = refresh.getPlayerDataHealth({ dataDir: path.join(root, 'backend', 'sackmann_data'), initialize: true });
  const progressionReport = progression.buildProgramProgressionAudit(db, { projectRoot: root });
  result = { success: integrity === 'ok' && totalRows > 0 && tennisRows > 0 && dataHealth.status !== 'ERROR' && progressionReport.healthy, patch: '14', integrity, totalRows, tennisRows, dataHealth: { status: dataHealth.status, latestMatchAt: dataHealth.latestMatchAt, dataAgeDays: dataHealth.dataAgeDays, lastRefreshAt: dataHealth.lastRefreshAt, errors: dataHealth.errors }, progression: { status: progressionReport.status, errors: progressionReport.errors, warnings: progressionReport.warnings }, readOnly: true, hashBefore: before, hashAfter: null };
} finally { db.close(); }
result.hashAfter = hash(dbPath); result.databaseUnchanged = result.hashBefore === result.hashAfter; result.success = result.success && result.databaseUnchanged;
fs.writeFileSync(path.join(auditDir, 'patch14_db_verification_report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 2;
