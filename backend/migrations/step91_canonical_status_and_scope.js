'use strict';

// STEP91_CANONICAL_STATUS_AND_SCOPE_MIGRATION
// Safe migration: backup DB, dry-run/apply, transazione, preserva status originali.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');
const { canonicalizeGateStatus } = require('../gateStatusCanonicalizer');
const { buildPlayerIdentity, buildCanonicalTennisMatchKey } = require('../tennisPlayerIdentity');

const STEP91_MIGRATION_VERSION = 'STEP91_CANONICAL_STATUS_AND_SCOPE_V1';
const APPLY = process.argv.includes('--apply');
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_PATH = process.env.BETTING_DB_PATH || path.resolve(ROOT_DIR, 'database_betting.db');

function nowIso() { return new Date().toISOString(); }

function backupDb(dbPath) {
  if (!APPLY || !fs.existsSync(dbPath)) return null;
  const dir = path.resolve(ROOT_DIR, 'backup');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `database_betting_BACKUP_step91_canonical_${nowIso().replace(/[:.]/g, '-')}.db`);
  fs.copyFileSync(dbPath, target);
  return target;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function safeAddColumn(db, table, definition) {
  const column = String(definition).trim().split(/\s+/)[0];
  if (!columnExists(db, table, column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}

function ensureColumns(db) {
  [
    'gate_status_code TEXT',
    'gate_status_label TEXT',
    'gate_allow_bet INTEGER',
    'gate_audit_only INTEGER',
    'gate_legacy_original_status TEXT',
    'gate_canonical_scope TEXT',
    'gate_canonical_migration_version TEXT',
    'gate_canonical_migration_at TEXT',
    'tennis_player1_identity TEXT',
    'tennis_player2_identity TEXT',
    'tennis_canonical_match_key TEXT'
  ].forEach(def => safeAddColumn(db, 'ai_forward_test', def));
}

function isTennis(row = {}) {
  const text = [row.sport_type, row.bet_type, row.strategy_tag, row.league].map(v => String(v || '').toUpperCase()).join(' ');
  return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA') || text.includes('GRAND SLAM');
}

function buildCanonicalInput(row = {}) {
  return {
    pre_match_gate_label: row.pre_match_gate_label,
    professional_gate_status: row.professional_gate_status,
    tennis_operational_status: row.tennis_operational_status,
    calcio_gate_status: row.calcio_gate_status,
    calcio_operational_status: row.calcio_operational_status,
    allowBet: row.professional_gate_allow_bet === 1 || row.calcio_gate_allow_bet === 1
  };
}

function runMigration({ dbPath = DB_PATH, apply = APPLY } = {}) {
  if (!fs.existsSync(dbPath)) throw new Error(`DB non trovato: ${dbPath}`);
  const backup = apply ? backupDb(dbPath) : null;
  const db = sqlite3(dbPath);
  try {
    if (!tableExists(db, 'ai_forward_test')) throw new Error('Tabella ai_forward_test non trovata.');
    ensureColumns(db);

    const rows = db.prepare(`
      SELECT id, sport_type, bet_type, strategy_tag, league, match_date, home_team, away_team,
             pre_match_gate_label, professional_gate_status, professional_gate_allow_bet,
             tennis_operational_status, calcio_gate_status, calcio_gate_allow_bet, calcio_operational_status,
             gate_canonical_migration_version
      FROM ai_forward_test
    `).all();

    const stats = {
      version: STEP91_MIGRATION_VERSION,
      apply,
      backup,
      total: rows.length,
      candidates: 0,
      changed: 0,
      byCode: {},
      tennisKeys: 0
    };

    const stamp = nowIso();
    const update = db.prepare(`
      UPDATE ai_forward_test
      SET gate_status_code = ?,
          gate_status_label = ?,
          gate_allow_bet = ?,
          gate_audit_only = ?,
          gate_legacy_original_status = COALESCE(gate_legacy_original_status, ?),
          gate_canonical_scope = ?,
          gate_canonical_migration_version = ?,
          gate_canonical_migration_at = ?,
          tennis_player1_identity = COALESCE(tennis_player1_identity, ?),
          tennis_player2_identity = COALESCE(tennis_player2_identity, ?),
          tennis_canonical_match_key = COALESCE(tennis_canonical_match_key, ?)
      WHERE id = ?
    `);

    const tx = db.transaction((items) => {
      for (const row of items) {
        const canonical = canonicalizeGateStatus(buildCanonicalInput(row));
        const tennis = isTennis(row);
        const p1 = tennis ? buildPlayerIdentity(row.home_team || '').key : null;
        const p2 = tennis ? buildPlayerIdentity(row.away_team || '').key : null;
        const matchKey = tennis ? buildCanonicalTennisMatchKey(row.home_team, row.away_team, row.match_date, row.league) : null;
        const original = [row.pre_match_gate_label, row.professional_gate_status, row.tennis_operational_status, row.calcio_gate_status, row.calcio_operational_status]
          .filter(Boolean).join(' | ') || null;
        stats.candidates += 1;
        stats.byCode[canonical.code] = (stats.byCode[canonical.code] || 0) + 1;
        if (tennis && matchKey) stats.tennisKeys += 1;
        update.run(
          canonical.code,
          canonical.label,
          canonical.allowBet ? 1 : 0,
          canonical.auditOnly ? 1 : 0,
          original,
          tennis ? 'TENNIS' : 'CALCIO_OR_UNKNOWN',
          STEP91_MIGRATION_VERSION,
          stamp,
          p1,
          p2,
          matchKey,
          row.id
        );
        stats.changed += 1;
      }
    });

    if (apply) tx(rows);
    else {
      for (const row of rows) {
        const canonical = canonicalizeGateStatus(buildCanonicalInput(row));
        stats.candidates += 1;
        stats.byCode[canonical.code] = (stats.byCode[canonical.code] || 0) + 1;
        if (isTennis(row)) stats.tennisKeys += 1;
      }
    }

    return stats;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const result = runMigration();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = { STEP91_MIGRATION_VERSION, runMigration };
