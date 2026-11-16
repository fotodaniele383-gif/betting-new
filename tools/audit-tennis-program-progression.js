'use strict';
const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./patch15-db-adapter');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const currentPatch = String(require('../backend/tennisPatchRegistry').TENNIS_CURRENT_PATCH_VERSION);
const auditDir = path.join(root, `audit_patch${currentPatch}`);
fs.mkdirSync(auditDir, { recursive: true });
const { db, adapter, native } = openDatabase(dbPath, { projectRoot: root, fileMustExist: true, readonly: true });
try {
  const report = progression.buildProgramProgressionAudit(db, {
    projectRoot: root,
    historicalDatasetPath: path.join(root, 'data', 'tennisdb_historical_player_stats.json')
  });
  report.databaseAdapter = adapter;
  report.nativeDatabaseAdapter = native;
  fs.writeFileSync(path.join(auditDir, `patch${currentPatch}_program_progression_audit.json`), JSON.stringify(report, null, 2));
  const lines = [
    `# Patch ${currentPatch} — Program Progression Audit`, '',
    `Status: **${report.status}**`,
    `Patch: ${report.currentPatchVersion}`,
    `Rows: ${report.sourceRows} total / ${report.tennisRows} Tennis`,
    `DB adapter: ${adapter}${native ? ' (native)' : ''}`, '',
    '| Check | Esito | Severità |', '|---|---:|---|',
    ...report.checks.map(item => `| ${item.name} | ${item.ok ? 'PASS' : 'FAIL'} | ${item.severity} |`)
  ];
  fs.writeFileSync(path.join(auditDir, `patch${currentPatch}_program_progression_audit.md`), lines.join('\n') + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.healthy) process.exitCode = 2;
} finally { db.close(); }
