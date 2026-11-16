'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');
const intelligence = require('../backend/tennisMatchupIntelligence');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch12');
fs.mkdirSync(auditDir, { recursive: true });
const operationId = runtimeDiagnostics.createOperationId('PATCH12_MATCHUP_INTELLIGENCE_MIGRATION');
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const tableExists = (db, table) => Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n) === 1;

const dbHashBefore = sha256File(dbPath);
const db = new Database(dbPath, { fileMustExist: true });
try {
  const integrityBefore = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const sourceRowsBefore = count(db, 'ai_forward_test');
  const tennisRowsBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n);
  const before = {
    evidence: tableExists(db, 'tennis_player_evidence_snapshots') ? count(db, 'tennis_player_evidence_snapshots') : 0,
    matchup: tableExists(db, 'tennis_matchup_feature_snapshots') ? count(db, 'tennis_matchup_feature_snapshots') : 0,
    challenger: tableExists(db, 'tennis_challenger_predictions') ? count(db, 'tennis_challenger_predictions') : 0
  };
  runtimeDiagnostics.writeDiagnostic({ level: 'INFO', component: 'TENNIS_MATCHUP_INTELLIGENCE', operation: 'PATCH12_SCHEMA_MIGRATION', operationId, phase: 'PLAYER_EVIDENCE_SCHEMA_START', event: 'PLAYER_EVIDENCE_SCHEMA_START', message: 'Avvio migrazione additiva Patch 12 senza backfill storico.' });
  const tx = db.transaction(() => intelligence.ensureMatchupIntelligenceSchema(db));
  const schema = tx();
  const sourceRowsAfter = count(db, 'ai_forward_test');
  const tennisRowsAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n);
  const after = {
    evidence: count(db, 'tennis_player_evidence_snapshots'),
    matchup: count(db, 'tennis_matchup_feature_snapshots'),
    challenger: count(db, 'tennis_challenger_predictions')
  };
  const integrityAfter = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const result = {
    success: integrityBefore === 'ok' && integrityAfter === 'ok' && sourceRowsBefore === sourceRowsAfter && tennisRowsBefore === tennisRowsAfter && after.evidence === before.evidence && after.matchup === before.matchup && after.challenger === before.challenger,
    patch: '12', version: intelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION, operationId, dbPath,
    sourceRowsBefore, sourceRowsAfter, tennisRowsBefore, tennisRowsAfter,
    rowsBefore: before, rowsAfter: after, historicalBackfill: false,
    sourceRowsModified: sourceRowsAfter - sourceRowsBefore,
    schema, integrityBefore, integrityAfter,
    dbHashBefore, dbHashAfter: null,
    timestamp: new Date().toISOString()
  };
  runtimeDiagnostics.writeDiagnostic({ level: result.success ? 'INFO' : 'ERROR', component: 'TENNIS_MATCHUP_INTELLIGENCE', operation: 'PATCH12_SCHEMA_MIGRATION', operationId, phase: 'PLAYER_EVIDENCE_SCHEMA_COMPLETE', event: 'PLAYER_EVIDENCE_SCHEMA_COMPLETE', message: result.success ? 'Migrazione Patch 12 completata senza backfill.' : 'Migrazione Patch 12 non coerente.', context: result });
  fs.writeFileSync(path.join(auditDir, 'patch12_migration_report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
} finally {
  db.close();
}
const reportPath = path.join(auditDir, 'patch12_migration_report.json');
if (fs.existsSync(reportPath)) {
  const result = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  result.dbHashAfter = sha256File(dbPath);
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
}
