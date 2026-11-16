'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const quality = require('../backend/tennisQualityGateV2');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const AUDIT_DIR = path.join(ROOT, 'audit_patch10');
const REPORT_PATH = path.join(AUDIT_DIR, 'patch10_migration_report.json');
const COLUMNS = Object.freeze([
  ['quality_base_code', 'TEXT'],
  ['quality_base_label', 'TEXT'],
  ['quality_base_score', 'REAL'],
  ['quality_base_reason', 'TEXT'],
  ['quality_base_version', 'TEXT'],
  ['quality_final_code', 'TEXT'],
  ['quality_final_label', 'TEXT'],
  ['quality_final_score', 'REAL'],
  ['quality_final_reason', 'TEXT'],
  ['quality_final_version', 'TEXT'],
  ['quality_stake_mode', 'TEXT'],
  ['quality_stake_amount', 'REAL'],
  ['quality_budget_pct', 'REAL'],
  ['quality_decision_at', 'TEXT'],
  ['quality_deepscan_class', 'TEXT'],
  ['quality_deepscan_separate', 'INTEGER DEFAULT 1']
]);

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function tennisWhere() { return "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')"; }
function columns(db) { return new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name)); }
function main() {
  const operationId = runtimeDiagnostics.createOperationId('PATCH10_QUALITY_GATE_MIGRATION');
  const db = new Database(DB_PATH);
  try {
    const integrityBefore = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const rowsBefore = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
    const tennisBefore = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n);
    const dbHashBefore = sha256(DB_PATH);
    const existing = columns(db);
    const qualityColumnsAlreadyPresent = COLUMNS.every(([name]) => existing.has(name));
    const populatedBefore = qualityColumnsAlreadyPresent
      ? Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()} AND (quality_base_version IS NOT NULL OR quality_final_version IS NOT NULL)`).get().n)
      : 0;
    const added = [];
    const already = [];
    runtimeDiagnostics.writeDiagnostic({ level: 'INFO', component: 'TENNIS_QUALITY_GATE', operation: 'PATCH10_MIGRATION', operationId, phase: 'QUALITY_SCHEMA_START', event: 'QUALITY_SCHEMA_START', message: 'Avvio migrazione additiva Quality Gate V2.' });
    db.transaction(() => {
      for (const [name, type] of COLUMNS) {
        if (existing.has(name)) { already.push(name); continue; }
        db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
        added.push(name);
      }
    })();
    const rowsAfter = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
    const tennisAfter = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n);
    const populatedAfter = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()} AND (quality_base_version IS NOT NULL OR quality_final_version IS NOT NULL)`).get().n);
    const integrityAfter = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const report = {
      success: integrityBefore === 'ok' && integrityAfter === 'ok' && rowsBefore === rowsAfter && tennisBefore === tennisAfter && populatedAfter === populatedBefore,
      patch: '10', version: quality.TENNIS_QUALITY_GATE_VERSION, operationId, dbPath: DB_PATH,
      rowsBefore, rowsAfter, tennisBefore, tennisAfter, sourceRowsModified: 0,
      columnsAdded: added, columnsAlreadyPresent: already, expectedColumns: COLUMNS.map(([name]) => name),
      historicalBackfill: false, historicalQualityRowsBefore: populatedBefore, historicalQualityRowsAfter: populatedAfter, historicalQualityRowsAddedByMigration: populatedAfter - populatedBefore,
      integrityBefore, integrityAfter, dbHashBefore, dbHashAfter: sha256(DB_PATH), timestamp: new Date().toISOString()
    };
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    runtimeDiagnostics.writeDiagnostic({ level: report.success ? 'INFO' : 'ERROR', component: 'TENNIS_QUALITY_GATE', operation: 'PATCH10_MIGRATION', operationId, phase: 'QUALITY_SCHEMA_COMPLETE', event: 'QUALITY_SCHEMA_COMPLETE', message: report.success ? 'Migrazione Quality Gate V2 completata senza backfill.' : 'Migrazione Quality Gate V2 non valida.', context: report });
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 2;
  } finally { db.close(); }
}
main();
