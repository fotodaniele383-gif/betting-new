#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const external = require('./tennisExternalMatchIntelligencePatch37');

const PATCH = 'TENNIS_PATCH_37_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING';
const REVISION = 'R1_WINDOWS_NODE_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING';
const MIGRATION = 'ADDITIVE_EXTERNAL_INTELLIGENCE_RECEIPTS_SHADOW_CHALLENGER';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(value => /\.db$/i.test(value));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');

function openDb(file) { try { const Better = require('better-sqlite3'); return { db: new Better(file), adapter: 'better-sqlite3' }; } catch (_) { const { DatabaseSync } = require('node:sqlite'); return { db: new DatabaseSync(file), adapter: 'node:sqlite' }; } }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function table(db, name) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function columns(db, name) { return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name)); }
function add(db, definition) { const name = definition.split(/\s+/)[0]; if (!columns(db, 'ai_forward_test').has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`); }
function tennisWhere() { return `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`; }
function counts(db) { return { total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n), tennis: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n), pending: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n), positiveStake: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()} AND COALESCE(stake,0)>0`).get().n), stakeTotal: Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n) }; }
function ensureSchema(db) {
  [
    'tennis_external_intelligence_version TEXT',
    'tennis_external_intelligence_receipt_id TEXT',
    'tennis_external_h2h_status TEXT',
    'tennis_external_h2h_sample INTEGER',
    'tennis_external_h2h_adjustment_pp REAL',
    'tennis_external_ranking_status TEXT',
    'tennis_external_weather_status TEXT',
    'tennis_external_weather_risk_score REAL',
    'tennis_external_challenger_score REAL',
    'tennis_external_intelligence_updated_at TEXT'
  ].forEach(definition => add(db, definition));
  external.createSchema(db);
}
function createBaselineRun(db, at) {
  const report = {
    version: external.CHALLENGER_VERSION,
    generatedAt: at,
    mode: 'SHADOW_CONTEXT_NO_AUTOMATIC_PROMOTION',
    rowsEvaluated: 0,
    sourceRegistry: external.sourceHealth(),
    liveNetworkProbeExecutedByMigration: false,
    promotionAuthority: false,
    stakeAuthority: false,
    probabilityAuthority: false,
    note: 'The migration registers sources and schema only. Live evidence is collected on future DeepScan or explicit diagnostic probes.'
  };
  const canonical = { ...report, generatedAt: null };
  const reportHash = sha(canonical);
  const runId = `TECR37_${reportHash.slice(0,24)}`;
  if (!db.prepare('SELECT 1 ok FROM tennis_external_challenger_runs WHERE run_id=?').get(runId)) {
    db.prepare('INSERT INTO tennis_external_challenger_runs(run_id,generated_at,mode,rows_evaluated,promoted,report_json,report_hash) VALUES(?,?,?,?,?,?,?)').run(runId, at, report.mode, 0, 0, JSON.stringify(report), reportHash);
  }
  return { runId, reportHash, report };
}

const opened = openDb(dbPath); const db = opened.db; let output;
try {
  const integrityBefore = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  const fkBefore = db.prepare('PRAGMA foreign_key_check').all();
  if (String(integrityBefore).toLowerCase() !== 'ok' || fkBefore.length) throw new Error('PATCH37_DATABASE_PRECHECK_FAILED');
  const before = counts(db); const now = new Date().toISOString();
  if (apply) db.exec('BEGIN IMMEDIATE');
  try {
    let baselineRun = null;
    if (apply) { ensureSchema(db); baselineRun = createBaselineRun(db, now); db.exec('COMMIT'); }
    const after = counts(db);
    output = {
      success: true, patch: PATCH, revision: REVISION, mode: preview ? 'PREVIEW' : 'APPLY', migration: MIGRATION,
      adapter: opened.adapter, dbPath, before, after,
      businessRowsUnchanged: JSON.stringify(before) === JSON.stringify(after),
      noHistoricalBackfill: true,
      receiptRows: table(db, 'tennis_external_intelligence_receipts') ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_intelligence_receipts').get().n) : 0,
      challengerRows: table(db, 'tennis_external_challenger_runs') ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_challenger_runs').get().n) : 0,
      baselineRun,
      sourceHealth: external.sourceHealth(),
      integrity: Object.values(db.prepare('PRAGMA integrity_check').get())[0],
      foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length
    };
  } catch (error) { if (apply) try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
} finally { db.close(); }
console.log(JSON.stringify(output, null, 2));
