'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');
const historical = require('../backend/tennisHistoricalCombinationEvidence');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch13');
fs.mkdirSync(auditDir, { recursive: true });
const operationId = runtimeDiagnostics.createOperationId('PATCH13_HISTORICAL_COMBINATION_MIGRATION');
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const COLUMNS = Object.freeze({
  historical_combo_key: 'TEXT',
  historical_combo_deepscan: 'TEXT',
  historical_combo_quality: 'TEXT',
  historical_combo_resolved: 'INTEGER',
  historical_combo_wins: 'INTEGER',
  historical_combo_losses: 'INTEGER',
  historical_combo_win_rate_pct: 'REAL',
  historical_combo_adjusted_rate_pct: 'REAL',
  historical_combo_ci_low_pct: 'REAL',
  historical_combo_ci_high_pct: 'REAL',
  historical_combo_operational_resolved: 'INTEGER',
  historical_combo_operational_roi_pct: 'REAL',
  historical_combo_reliability: 'TEXT',
  historical_combo_source_max_id: 'INTEGER',
  historical_combo_evidence_hash: 'TEXT',
  historical_combo_version: 'TEXT',
  historical_combo_calculated_at: 'TEXT'
});

const dbHashBefore = sha256File(dbPath);
const db = new Database(dbPath, { fileMustExist: true });
try {
  const integrityBefore = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const rowsBefore = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0);
  const oldColumns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const populatedBefore = oldColumns.has('historical_combo_version')
    ? Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE historical_combo_version IS NOT NULL").get().n || 0) : 0;
  const added = [];
  const alreadyPresent = [];
  runtimeDiagnostics.writeDiagnostic({ level: 'INFO', component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'PATCH13_SCHEMA_MIGRATION', operationId, phase: 'HISTORICAL_COMBINATION_SCHEMA_START', event: 'HISTORICAL_COMBINATION_SCHEMA_START', message: 'Avvio migrazione additiva Patch 13 senza backfill storico.' });
  const migrate = db.transaction(() => {
    for (const [column, type] of Object.entries(COLUMNS)) {
      if (oldColumns.has(column)) { alreadyPresent.push(column); continue; }
      db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${column} ${type}`);
      added.push(column);
    }
  });
  migrate();
  const rowsAfter = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0);
  const populatedAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE historical_combo_version IS NOT NULL").get().n || 0);
  const integrityAfter = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const present = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const result = {
    success: integrityBefore === 'ok' && integrityAfter === 'ok' && rowsBefore === rowsAfter && tennisBefore === tennisAfter && populatedBefore === populatedAfter && Object.keys(COLUMNS).every(column => present.has(column)),
    patch: '13', version: historical.TENNIS_HISTORICAL_COMBINATION_VERSION, operationId, dbPath,
    rowsBefore, rowsAfter, tennisBefore, tennisAfter, sourceRowsModified: rowsAfter - rowsBefore,
    columnsAdded: added, columnsAlreadyPresent: alreadyPresent, expectedColumns: Object.keys(COLUMNS),
    historicalBackfill: false, historicalRowsBefore: populatedBefore, historicalRowsAfter: populatedAfter,
    historicalRowsAddedByMigration: populatedAfter - populatedBefore,
    integrityBefore, integrityAfter, dbHashBefore, dbHashAfter: null, timestamp: new Date().toISOString()
  };
  runtimeDiagnostics.writeDiagnostic({ level: result.success ? 'INFO' : 'ERROR', component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'PATCH13_SCHEMA_MIGRATION', operationId, phase: 'HISTORICAL_COMBINATION_SCHEMA_COMPLETE', event: 'HISTORICAL_COMBINATION_SCHEMA_COMPLETE', message: result.success ? 'Migrazione Patch 13 completata senza backfill.' : 'Migrazione Patch 13 non coerente.', context: result });
  const reportPath = path.join(auditDir, 'patch13_migration_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
} finally {
  db.close();
}
const reportPath = path.join(auditDir, 'patch13_migration_report.json');
if (fs.existsSync(reportPath)) {
  const result = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  result.dbHashAfter = sha256File(dbPath);
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
}
