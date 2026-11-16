'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { SETTLEMENT_SCHEMA_COLUMNS, TENNIS_SETTLEMENT_CONTRACT_VERSION } = require('../backend/tennisSettlementContract');
const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath);
const existing = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
const before = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const added = [];
const tx = db.transaction(() => {
  for (const [name, type] of SETTLEMENT_SCHEMA_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
      added.push(name);
    }
  }
});
tx();
const after = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const report = {
  success: before === after,
  patch: '5',
  contractVersion: TENNIS_SETTLEMENT_CONTRACT_VERSION,
  dbPath,
  added,
  alreadyPresent: SETTLEMENT_SCHEMA_COLUMNS.map(([name]) => name).filter(name => existing.has(name)),
  rowsBefore: before,
  rowsAfter: after,
  historicalBackfill: false,
  timestamp: new Date().toISOString()
};
fs.mkdirSync(path.join(ROOT, 'audit_patch5'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch5', 'patch5_schema_migration_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
if (!report.success) process.exit(2);
