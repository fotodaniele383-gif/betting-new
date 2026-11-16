#!/usr/bin/env node
'use strict';

/** PATCH 3 read-only database certification. */

const fs = require('fs');
const path = require('path');
const identity = require('../backend/tennisEventIdentity');

const root = path.resolve(__dirname, '..');
const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'backend', 'database_betting.db');
const reportPath = path.join(root, 'audit_patch3', 'patch3_db_verification_report.json');
const report = {
  patch: '3',
  title: 'Canonical Tennis Event Identity read-only database certification',
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
  console.log(`[${row.success ? 'PASS' : 'FAIL'}] ${name}${details.value !== undefined ? `: ${typeof details.value === 'string' ? details.value : JSON.stringify(details.value)}` : ''}`);
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
  report.skipReason = 'Binding better-sqlite3 non disponibile. Eseguire npm rebuild better-sqlite3 sul PC Windows.';
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
      report.skipReason = 'Binding better-sqlite3 non disponibile. Eseguire npm rebuild better-sqlite3 sul PC Windows.';
      report.error = message;
      report.finishedAt = new Date().toISOString();
      writeReport();
      console.error(report.skipReason);
      process.exit(2);
    }
    throw error;
  }
  const integrityRows = db.pragma('integrity_check');
  addCheck('SQLite integrity_check', Array.isArray(integrityRows) && String(integrityRows[0]?.integrity_check || '').toLowerCase() === 'ok', { value: integrityRows });

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_forward_test'").get();
  addCheck('Tabella ai_forward_test presente', Boolean(table));
  if (!table) throw new Error('Tabella ai_forward_test assente');

  const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
  const required = [...identity.TENNIS_EVENT_IDENTITY_SCHEMA_COLUMNS];
  const missing = required.filter(column => !columns.includes(column));
  addCheck('Schema Patch 3 completo', missing.length === 0, {
    value: `${required.length - missing.length}/${required.length}`,
    missingColumns: missing
  });
  if (missing.length) throw new Error(`Eseguire npm run migrate:tennis:patch3. Colonne mancanti: ${missing.join(', ')}`);

  const has = name => columns.includes(name);
  const selected = [
    'id', 'status', 'match_date', 'league', 'home_team', 'away_team', 'prediction',
    'market_type', 'point_line', 'provider_event_id', 'stake', 'bet_type', 'sport_type',
    'tour_type', 'tournament_name', 'tournament_canonical_name', 'predicted_player_name',
    'tennis_event_fingerprint', 'tennis_market_fingerprint', 'tennis_event_identity_status',
    'tennis_event_identity_version', 'canonical_match_datetime', 'canonical_tournament_key',
    'canonical_player_pair_key'
  ].filter(has);
  const tennisWhere = [
    has('sport_type') ? "UPPER(COALESCE(sport_type,''))='TENNIS'" : null,
    has('bet_type') ? "UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'" : null,
    has('strategy_tag') ? "UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'" : null
  ].filter(Boolean).join(' OR ');
  const rows = db.prepare(`SELECT ${selected.join(', ')} FROM ai_forward_test WHERE (${tennisWhere || '1=0'})`).all();
  const pending = rows.filter(row => String(row.status || '').toUpperCase() === 'PENDING');
  addCheck('Dataset Tennis leggibile', true, { value: rows.length });
  addCheck('Dataset PENDING Tennis leggibile', true, { value: pending.length });

  const pendingEvaluated = pending.map(row => ({ row, identity: identity.buildTennisEventIdentity(row) }));
  const providerPairMap = new Map();
  for (const item of pendingEvaluated) {
    if (!item.identity.providerEventId) continue;
    if (!providerPairMap.has(item.identity.providerEventId)) providerPairMap.set(item.identity.providerEventId, new Map());
    const pairMap = providerPairMap.get(item.identity.providerEventId);
    pairMap.set(item.identity.pair.key, [...(pairMap.get(item.identity.pair.key) || []), item.row.id]);
  }
  const providerPairConflicts = [];
  for (const [providerEventId, pairMap] of providerPairMap.entries()) {
    if (pairMap.size > 1) providerPairConflicts.push({ providerEventId, pairs: [...pairMap.entries()] });
  }
  addCheck('Nessun provider_event_id PENDING associato a coppie incompatibili', providerPairConflicts.length === 0, {
    value: providerPairConflicts.length,
    samples: providerPairConflicts.slice(0, 10)
  });

  const marketGroups = new Map();
  for (const item of pendingEvaluated) {
    if (!item.identity.marketFingerprint) continue;
    const list = marketGroups.get(item.identity.marketFingerprint) || [];
    list.push(item.row.id);
    marketGroups.set(item.identity.marketFingerprint, list);
  }
  const duplicateMarkets = [...marketGroups.entries()].filter(([, ids]) => ids.length > 1).map(([fingerprint, ids]) => ({ fingerprint, ids }));
  addCheck('Nessun doppio PENDING con identità evento/mercato esatta', duplicateMarkets.length === 0, {
    value: duplicateMarkets.length,
    samples: duplicateMarkets.slice(0, 10)
  });

  const ambiguousPositiveStake = pendingEvaluated.filter(item => !item.identity.eventResolvable && Number(item.row.stake || 0) > 0);
  addCheck('Nessun PENDING ambiguo conserva stake positivo', ambiguousPositiveStake.length === 0, {
    value: ambiguousPositiveStake.length,
    samples: ambiguousPositiveStake.slice(0, 10).map(item => ({ id: item.row.id, status: item.identity.status, stake: item.row.stake }))
  });

  const persistedPatch3Rows = pending.filter(row => row.tennis_event_identity_version === identity.TENNIS_EVENT_IDENTITY_VERSION);
  const invalidPersisted = persistedPatch3Rows.filter(row => !row.tennis_event_fingerprint || !row.tennis_market_fingerprint || !row.canonical_player_pair_key);
  addCheck('Righe PENDING generate da Patch 3 hanno fingerprint completi', invalidPersisted.length === 0, {
    value: `${persistedPatch3Rows.length - invalidPersisted.length}/${persistedPatch3Rows.length}`,
    samples: invalidPersisted.slice(0, 10).map(row => row.id)
  });

  // Historical diagnostic only: rows settled before Patch 3 are not mutated.
  const oldLookupGroups = new Map();
  for (const row of rows) {
    const key = [row.home_team, row.away_team, row.prediction, row.league, row.market_type, identity.normalizePointLine(row.point_line), row.status].join('|');
    const list = oldLookupGroups.get(key) || [];
    list.push(row);
    oldLookupGroups.set(key, list);
  }
  const historicalNameOnlyCollisions = [...oldLookupGroups.values()]
    .filter(group => group.length > 1 && new Set(group.map(row => row.match_date || '')).size > 1)
    .map(group => ({ ids: group.map(row => row.id), dates: group.map(row => row.match_date) }));
  report.historicalDiagnostic = {
    nameOnlyCollisionGroups: historicalNameOnlyCollisions.length,
    samples: historicalNameOnlyCollisions.slice(0, 10),
    note: 'Diagnostica storica read-only; Patch 3 non riscrive righe WON/LOST/VOID.'
  };

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
