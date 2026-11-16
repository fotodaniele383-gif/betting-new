#!/usr/bin/env node
'use strict';

const path = require('path');

const PATCH = 'TENNIS_PATCH_29_R3_PREMATCH_CAPTURE_GATE_COMPONENT_HEALTH_SEMANTIC';
const COLUMNS = Object.freeze([
  ['prematch_capture_gate_version', 'TEXT'],
  ['prematch_capture_gate_status', 'TEXT'],
  ['prematch_capture_gate_reason', 'TEXT'],
  ['prematch_capture_gate_checked_at', 'TEXT'],
  ['prematch_capture_gate_lead_ms', 'INTEGER'],
  ['prematch_capture_gate_timezone', 'TEXT']
]);

function openDatabase(dbPath) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return { db: new BetterSqlite3(dbPath), adapter: 'better-sqlite3' };
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.transaction = fn => (...args) => {
      if (db.inTransaction) return fn(...args);
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
    };
    return { db, adapter: 'node:sqlite' };
  }
}

function columnSet(db) { return new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name)); }
function counts(db) {
  const total = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennis = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'`).get().n || 0);
  return { total, tennis };
}

function migrate(db, options = {}) {
  const apply = options.apply === true;
  const before = counts(db);
  const existing = columnSet(db);
  const missing = COLUMNS.filter(([name]) => !existing.has(name));
  if (apply) {
    db.transaction(() => {
      for (const [name, type] of missing) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_ai_forward_test_prematch_capture_gate_status ON ai_forward_test(prematch_capture_gate_status)');
    })();
  }
  const after = counts(db);
  const finalColumns = columnSet(db);
  const historicalGateRows = finalColumns.has('prematch_capture_gate_version')
    ? Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE prematch_capture_gate_version IS NOT NULL`).get().n || 0)
    : 0;
  return {
    success: before.total === after.total && before.tennis === after.tennis && (!apply || COLUMNS.every(([name]) => finalColumns.has(name))),
    patch: PATCH,
    mode: apply ? 'APPLY_ADDITIVE_SCHEMA' : 'READ_ONLY_PREVIEW',
    addedColumns: apply ? missing.map(([name]) => name) : [],
    pendingColumns: COLUMNS.filter(([name]) => !finalColumns.has(name)).map(([name]) => name),
    counts: { before, after },
    historicalGateRows,
    noHistoricalBackfill: historicalGateRows === 0,
    safeguards: {
      rowCountsUnchanged: before.total === after.total && before.tennis === after.tennis,
      historicalRowsNotBackfilled: historicalGateRows === 0,
      probabilityAuthorityChanged: false,
      qualityGateAuthorityChanged: false,
      stakeAuthorityChanged: false,
      settlementAuthorityChanged: false,
      soccerChanged: false,
      oddsApiCallsAdded: 0
    }
  };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const dbArg = process.argv.slice(2).find(arg => /\.db$/i.test(arg));
  const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));
  const { db, adapter } = openDatabase(dbPath);
  try {
    const result = migrate(db, { apply });
    result.database = dbPath;
    result.adapter = adapter;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.success ? 0 : 1;
  } finally { db.close(); }
}

module.exports = { PATCH, COLUMNS, openDatabase, migrate };
