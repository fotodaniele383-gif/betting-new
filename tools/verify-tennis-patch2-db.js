#!/usr/bin/env node
'use strict';

/**
 * PATCH 2 - Read-only database certification.
 * It validates the database and applies the new format resolver to current
 * PENDING Tennis contexts. It never updates or backfills any row.
 */

const fs = require('fs');
const path = require('path');
const { resolveTennisMatchFormat } = require('../backend/tennisMatchFormat');

const root = path.resolve(__dirname, '..');
const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'backend', 'database_betting.db');
const reportPath = path.join(root, 'audit_patch2', 'patch2_db_verification_report.json');

const report = {
  patch: '2',
  title: 'Tennis Match Format Contract read-only database certification',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  success: false,
  skipped: false,
  databaseModified: false,
  database: path.relative(root, dbPath),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  checks: []
};

function addCheck(name, success, details = {}) {
  const row = { name, success: Boolean(success), ...details };
  report.checks.push(row);
  console.log(`[${row.success ? 'PASS' : 'FAIL'}] ${name}${details.value !== undefined ? `: ${details.value}` : ''}`);
  return row.success;
}

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${path.relative(root, reportPath)}`);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (error) {
  report.skipped = true;
  report.skipReason = 'Binding better-sqlite3 non disponibile. Eseguire npm install o npm rebuild better-sqlite3 sul PC Windows.';
  report.error = error.message;
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.error(report.skipReason);
  process.exit(2);
}

if (!fs.existsSync(dbPath)) {
  report.error = `Database non trovato: ${dbPath}`;
  report.finishedAt = new Date().toISOString();
  writeReport();
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
      report.skipReason = 'Binding better-sqlite3 non disponibile. Eseguire npm install o npm rebuild better-sqlite3 sul PC Windows.';
      report.error = message;
      report.finishedAt = new Date().toISOString();
      writeReport();
      console.error(report.skipReason);
      process.exit(2);
    }
    throw error;
  }

  const integrityRows = db.pragma('integrity_check');
  const integrityOk = Array.isArray(integrityRows) && integrityRows.length === 1 &&
    String(integrityRows[0].integrity_check || '').toLowerCase() === 'ok';
  addCheck('SQLite integrity_check', integrityOk, { value: integrityRows });

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_forward_test'").get();
  addCheck('Tabella ai_forward_test presente', Boolean(table));
  if (!table) throw new Error('Tabella ai_forward_test assente');

  const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
  const required = ['id', 'status', 'league', 'tour_type', 'market_type'];
  const missing = required.filter(column => !columns.includes(column));
  addCheck('Colonne necessarie al controllo formato', missing.length === 0, {
    value: `${required.length - missing.length}/${required.length}`,
    missingColumns: missing
  });
  if (missing.length) throw new Error(`Colonne mancanti: ${missing.join(', ')}`);

  const has = name => columns.includes(name);
  const tennisWhere = [
    has('sport_type') ? "UPPER(COALESCE(sport_type,''))='TENNIS'" : null,
    has('bet_type') ? "UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'" : null,
    has('strategy_tag') ? "UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'" : null
  ].filter(Boolean).join(' OR ');
  const selected = ['id', 'league', 'tour_type', 'market_type'];
  if (has('home_team')) selected.push('home_team');
  if (has('away_team')) selected.push('away_team');

  const rows = db.prepare(`
    SELECT ${selected.join(', ')}
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING'
      AND (${tennisWhere || '1=0'})
  `).all();

  const evaluated = rows.map(row => {
    const resolution = resolveTennisMatchFormat({
      sportTitle: row.league,
      tournament: row.league,
      series: row.league,
      tourType: row.tour_type,
      match: {
        name: [row.home_team, row.away_team].filter(Boolean).join(' - ')
      }
    });
    return { id: row.id, league: row.league, tourType: row.tour_type, marketType: row.market_type, resolution };
  });

  const invalidWta = evaluated.filter(row =>
    String(row.resolution.tourType).toUpperCase() === 'WTA' && row.resolution.bestOf !== 3
  );
  const unsafeAmbiguousBo5 = evaluated.filter(row =>
    row.resolution.tourType === 'UNKNOWN' && row.resolution.bestOf === 5
  );

  addCheck('Dataset PENDING Tennis valutato dal nuovo contratto', true, { value: evaluated.length });
  addCheck('Nessun PENDING WTA risolto BO5', invalidWta.length === 0, {
    value: invalidWta.length,
    samples: invalidWta.slice(0, 10)
  });
  addCheck('Nessun contesto ambiguo promosso BO5', unsafeAmbiguousBo5.length === 0, {
    value: unsafeAmbiguousBo5.length,
    samples: unsafeAmbiguousBo5.slice(0, 10)
  });

  report.pendingFormatSample = evaluated.slice(0, 20);
  report.success = report.checks.every(check => check.success);
} catch (error) {
  report.error = error && error.stack ? error.stack : String(error);
  report.success = false;
  console.error(report.error);
} finally {
  if (db) db.close();
  report.finishedAt = new Date().toISOString();
  writeReport();
}

process.exit(report.success ? 0 : 1);
