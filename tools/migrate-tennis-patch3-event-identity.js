#!/usr/bin/env node
'use strict';

/**
 * PATCH 3 additive schema migration.
 * - adds identity columns only;
 * - does not update/backfill historical rows;
 * - creates a byte-for-byte database backup unless --no-backup is passed;
 * - is idempotent.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS, TENNIS_EVENT_IDENTITY_VERSION } = require('../backend/tennisEventIdentity');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter(value => value.startsWith('--')));
const dbArg = args.find(value => !value.startsWith('--'));
const dbPath = dbArg ? path.resolve(dbArg) : path.join(root, 'backend', 'database_betting.db');
const reportPath = path.join(root, 'audit_patch3', 'patch3_schema_migration_report.json');
const noBackup = flags.has('--no-backup');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${path.relative(root, reportPath)}`);
}

const report = {
  patch: '3',
  title: 'Canonical Tennis Event Identity additive schema migration',
  version: TENNIS_EVENT_IDENTITY_VERSION,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  success: false,
  database: path.relative(root, dbPath),
  databaseModified: false,
  backupPath: null,
  hashBefore: null,
  hashAfter: null,
  columnsRequired: TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS,
  columnsAdded: [],
  columnsAlreadyPresent: []
};

let Database;
try {
  Database = require('better-sqlite3');
} catch (error) {
  report.error = error.message;
  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.error('Binding better-sqlite3 non disponibile. Eseguire npm rebuild better-sqlite3 e ripetere la migrazione.');
  process.exit(2);
}

if (!fs.existsSync(dbPath)) {
  report.error = `Database non trovato: ${dbPath}`;
  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.error(report.error);
  process.exit(1);
}

let db;
try {
  report.hashBefore = sha256(dbPath);
  if (!noBackup) {
    const backupDir = path.join(root, 'backup', `TENNIS_PATCH_3_DB_${stamp()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, path.basename(dbPath));
    fs.copyFileSync(dbPath, backupPath);
    if (sha256(backupPath) !== report.hashBefore) throw new Error('Hash backup database non coincide con il file origine.');
    report.backupPath = path.relative(root, backupPath);
  }

  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/bindings file|better_sqlite3\.node|node-gyp|native binding/i.test(message)) {
      report.error = message;
      report.finishedAt = new Date().toISOString();
      writeReport(report);
      console.error('Binding better-sqlite3 non disponibile. Eseguire npm rebuild better-sqlite3 e ripetere la migrazione.');
      process.exit(2);
    }
    throw error;
  }
  const integrityBefore = db.pragma('integrity_check');
  if (!Array.isArray(integrityBefore) || String(integrityBefore[0]?.integrity_check || '').toLowerCase() !== 'ok') {
    throw new Error(`integrity_check pre-migrazione fallito: ${JSON.stringify(integrityBefore)}`);
  }
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_forward_test'").get();
  if (!table) throw new Error('Tabella ai_forward_test assente.');

  const existing = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const add = TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS.filter(column => !existing.has(column));
  report.columnsAlreadyPresent = TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS.filter(column => existing.has(column));

  const migrate = db.transaction(() => {
    for (const column of add) {
      if (!/^[a-z0-9_]+$/i.test(column)) throw new Error(`Nome colonna non valido: ${column}`);
      db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${column} TEXT`);
      report.columnsAdded.push(column);
    }
  });
  migrate();
  report.databaseModified = report.columnsAdded.length > 0;

  const afterColumns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const missingAfter = TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS.filter(column => !afterColumns.has(column));
  if (missingAfter.length) throw new Error(`Colonne mancanti dopo migrazione: ${missingAfter.join(', ')}`);
  const integrityAfter = db.pragma('integrity_check');
  if (!Array.isArray(integrityAfter) || String(integrityAfter[0]?.integrity_check || '').toLowerCase() !== 'ok') {
    throw new Error(`integrity_check post-migrazione fallito: ${JSON.stringify(integrityAfter)}`);
  }

  db.close();
  db = null;
  report.hashAfter = sha256(dbPath);
  report.success = true;
  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.log(`[PASS] Migrazione Patch 3: ${report.columnsAdded.length} colonne aggiunte, ${report.columnsAlreadyPresent.length} già presenti.`);
  console.log('Righe storiche modificate: 0. Backfill automatico: NO.');
  process.exit(0);
} catch (error) {
  if (db) {
    try { db.close(); } catch (_) {}
  }
  report.error = error && error.stack ? error.stack : String(error);
  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.error(report.error);
  process.exit(1);
}
