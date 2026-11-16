#!/usr/bin/env node
'use strict';

/**
 * PATCH 1 - Read-only database certification.
 *
 * This verifier never changes the database. It validates that the native
 * SQLite binding is available, the database is readable, the core table is
 * structurally usable and the final Tennis hard guards are reflected in the
 * current PENDING dataset.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'backend', 'database_betting.db');
const reportPath = path.join(root, 'audit_patch1', 'patch1_db_verification_report.json');

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${path.relative(root, reportPath)}`);
}

const report = {
  patch: '1',
  title: 'Tennis Patch 1 read-only database certification',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  success: false,
  skipped: false,
  database: path.relative(root, dbPath),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  checks: []
};

function addCheck(name, success, details = {}) {
  const row = { name, success: Boolean(success), ...details };
  report.checks.push(row);
  console.log(`[${row.success ? 'PASS' : 'FAIL'}] ${name}${details.value !== undefined ? `: ${details.value}` : ''}`);
  return row.success;
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (error) {
  report.skipped = true;
  report.skipReason = 'Il binding nativo better-sqlite3 non è disponibile in questo ambiente. Eseguire npm install sul PC Windows e rilanciare il comando.';
  report.error = error && error.message ? error.message : String(error);
  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.error(report.skipReason);
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
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/bindings file|better_sqlite3\.node|node-gyp|native binding/i.test(message)) {
      report.skipped = true;
      report.skipReason = 'Il binding nativo better-sqlite3 non è disponibile in questo ambiente. Eseguire npm install sul PC Windows e rilanciare il comando.';
      report.error = message;
      report.finishedAt = new Date().toISOString();
      writeReport(report);
      console.error(report.skipReason);
      process.exit(2);
    }
    throw error;
  }

  const integrityRows = db.pragma('integrity_check');
  const integrityOk = Array.isArray(integrityRows)
    && integrityRows.length === 1
    && String(integrityRows[0].integrity_check || '').toLowerCase() === 'ok';
  addCheck('SQLite integrity_check', integrityOk, { value: integrityRows });

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_forward_test'").get();
  addCheck('Tabella ai_forward_test presente', Boolean(table));
  if (!table) throw new Error('Tabella ai_forward_test assente');

  const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
  const requiredColumns = [
    'id', 'status', 'sport_type', 'bet_type', 'market_type', 'odd', 'estimated_prob',
    'edge_pp', 'ev_pct', 'stake', 'professional_gate_status', 'tennis_operational_status',
    'portfolio_scope', 'paper_trading_scope'
  ];
  const missingColumns = requiredColumns.filter(column => !columns.includes(column));
  addCheck('Colonne Tennis minime disponibili', missingColumns.length === 0, {
    value: `${requiredColumns.length - missingColumns.length}/${requiredColumns.length}`,
    missingColumns,
    totalColumns: columns.length
  });
  if (missingColumns.length) throw new Error(`Colonne mancanti: ${missingColumns.join(', ')}`);

  const pendingCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING'
      AND (
        UPPER(COALESCE(sport_type,''))='TENNIS'
        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
        OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
      )
  `).get().c;
  addCheck('Dataset PENDING Tennis leggibile', true, { value: pendingCount });

  const sideMismatchNotBlocked = db.prepare(`
    SELECT COUNT(*) AS c
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING'
      AND (
        UPPER(COALESCE(sport_type,''))='TENNIS'
        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
        OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
      )
      AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')
      AND UPPER(COALESCE(market_type,'moneyline')) NOT LIKE '%TOTAL%'
      AND CAST(COALESCE(odd,0) AS REAL) >= 2.75
      AND CAST(COALESCE(estimated_prob,0) AS REAL) >= 70
      AND CAST(COALESCE(market_implied_prob, CASE WHEN CAST(COALESCE(odd,0) AS REAL) > 1 THEN 100.0 / CAST(odd AS REAL) ELSE 100 END) AS REAL) <= 45
      AND (
        CAST(COALESCE(edge_pp, edge, 0) AS REAL) >= 25
        OR CAST(COALESCE(ev_pct,0) AS REAL) >= 60
      )
      AND UPPER(COALESCE(professional_gate_status,'')) NOT LIKE '%SIDE_PROBABILITY_MISMATCH%'
  `).get().c;
  addCheck('Nessun mismatch lato/probabilità resta operativo', sideMismatchNotBlocked === 0, { value: sideMismatchNotBlocked });

  const hardBlockedWithStake = db.prepare(`
    SELECT COUNT(*) AS c
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING'
      AND (
        UPPER(COALESCE(sport_type,''))='TENNIS'
        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
        OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
      )
      AND CAST(COALESCE(stake,0) AS REAL) > 0
      AND (
        UPPER(COALESCE(professional_gate_status,'')) LIKE '%BLOCKED_HARD%'
        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%BLOCCATA HARD%'
        OR UPPER(COALESCE(tennis_operational_status,'')) LIKE '%BLOCKED_HARD%'
        OR UPPER(COALESCE(tennis_operational_status,'')) LIKE '%BLOCCATA HARD%'
        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%SIDE_PROBABILITY_MISMATCH%'
      )
  `).get().c;
  addCheck('Nessun hard veto PENDING conserva stake positivo', hardBlockedWithStake === 0, { value: hardBlockedWithStake });

  const softEligibleAtZero = db.prepare(`
    SELECT COUNT(*) AS c
    FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type,'')) = 'TENNIS'
      AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')
      AND UPPER(COALESCE(status,'')) = 'PENDING'
      AND CAST(COALESCE(edge_pp,0) AS REAL) >= 5
      AND CAST(COALESCE(ev_pct,0) AS REAL) >= 5
      AND (
        UPPER(COALESCE(ds_action,'')) LIKE '%RISCHIO MODELLO%'
        OR UPPER(COALESCE(deep_scan_risk_level,'')) LIKE '%RISCHIO_MODELLO%'
        OR UPPER(COALESCE(deep_scan_risk_level,'')) LIKE '%MODEL_RISK%'
      )
      AND (
        UPPER(COALESCE(tennis_operational_status,'')) LIKE '%BLOCCATA SOFT%'
        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%BLOCKED_SOFT%'
        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%MODEL_RISK_STEP64%'
      )
      AND UPPER(COALESCE(professional_gate_status,'')) NOT LIKE '%HARD%'
      AND UPPER(COALESCE(tennis_operational_status,'')) NOT LIKE '%HARD%'
      AND UPPER(COALESCE(ds_action,'')) NOT LIKE '%ALTO RISCHIO%'
      AND CAST(COALESCE(stake,0) AS REAL) <= 0
  `).get().c;
  addCheck('Micro-test soft eleggibili non restano a stake zero', softEligibleAtZero === 0, { value: softEligibleAtZero });

  report.success = report.checks.every(check => check.success);
} catch (error) {
  report.error = error && error.stack ? error.stack : String(error);
  report.success = false;
  console.error(report.error);
} finally {
  if (db) db.close();
  report.finishedAt = new Date().toISOString();
  writeReport(report);
}

process.exit(report.success ? 0 : 1);
