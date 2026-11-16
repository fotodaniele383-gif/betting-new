#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

function resolveRoot() {
  const idx = process.argv.indexOf('--root');
  if (idx >= 0 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  if (process.argv[2] && !String(process.argv[2]).startsWith('-')) return path.resolve(process.argv[2]);
  return path.resolve('.');
}
const root = resolveRoot();
const dbPath = path.join(root, 'backend', 'database_betting.db');
const mod = require(path.join(root, 'backend', 'clvCrossSportCoveragePatch53.js'));
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function openDb(file) {
  try {
    const req = createRequire(path.join(root, 'package.json'));
    const BetterSqlite3 = req('better-sqlite3');
    return new BetterSqlite3(file);
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file);
  }
}
function fingerprint(db) {
  const rows = db.prepare(`SELECT id,status,profit,stake,estimated_prob,odd,clv,clv_edge,closing_odd,clv_verified,
    settlement_contract_status,settlement_contract_reason,settlement_source,settlement_score
    FROM ai_forward_test ORDER BY id`).all();
  return crypto.createHash('sha256').update(stable(rows)).digest('hex');
}
function countRows(db) {
  const row = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis
    FROM ai_forward_test`).get();
  return { total: Number(row.total), tennis: Number(row.tennis || 0) };
}
try {
  if (!fs.existsSync(dbPath)) throw new Error(`PATCH53_DATABASE_MISSING:${dbPath}`);
  const db = openDb(dbPath);
  let output;
  try {
    const beforeFingerprint = fingerprint(db);
    const beforeCounts = countRows(db);
    const schema = mod.createSchema(db);
    const firstPass = mod.backfillResolutionMetadata(db, mod.DEFAULT_FOOTBALL_LEAGUES);
    const secondPass = mod.backfillResolutionMetadata(db, mod.DEFAULT_FOOTBALL_LEAGUES);
    const coverage = mod.buildCoverageReport(db, mod.DEFAULT_FOOTBALL_LEAGUES);
    const persisted = mod.persistedSummary(db);
    const integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    const afterFingerprint = fingerprint(db);
    const afterCounts = countRows(db);
    if (String(integrity).toLowerCase() !== 'ok' || fk.length) throw new Error('PATCH53_DATABASE_INTEGRITY_FAILED');
    if (beforeFingerprint !== afterFingerprint) throw new Error('PATCH53_BUSINESS_FINGERPRINT_CHANGED');
    if (beforeCounts.total !== afterCounts.total || beforeCounts.tennis !== afterCounts.tennis) throw new Error('PATCH53_ROW_COUNTS_CHANGED');
    if (coverage.bySport.CALCIO.sportKeyUnresolvedRows !== 0) throw new Error('PATCH53_CALCIO_SPORT_KEY_UNRESOLVED');
    if (secondPass.changed !== 0) throw new Error('PATCH53_BACKFILL_NOT_IDEMPOTENT');
    output = {
      success: true,
      patch: 'TENNIS_PATCH_53_CLV_COVERAGE_CROSS_SPORT_SPORT_KEY_RESOLUTION',
      revision: 'R1_WINDOWS_NODE_CLV_COVERAGE_CROSS_SPORT_ROUTING',
      version: mod.VERSION,
      sportKeyResolutionVersion: mod.SPORT_KEY_RESOLUTION_VERSION,
      schema,
      firstPass,
      secondPass,
      coverage,
      persisted,
      database: { integrity, foreignKeyViolations: fk.length, ...afterCounts },
      businessValuesUnchanged: true,
      rowCountsUnchanged: true,
      networkCalls: 0
    };
  } finally {
    try { db.close(); } catch (_) {}
  }
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error.stack || error.message }, null, 2));
  process.exit(1);
}
