'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const TENNIS_PATCH26_SCHEMA_VERSION = 'TENNIS_CANONICAL_PLAYER_EVIDENCE_SCHEMA_V1_PATCH26';
const COLUMNS = Object.freeze([
  ['tennis_canonical_player_evidence_version', 'TEXT'],
  ['tennis_canonical_player_evidence_status', 'TEXT'],
  ['tennis_canonical_player_evidence_score', 'REAL'],
  ['tennis_canonical_player_evidence_source', 'TEXT'],
  ['tennis_canonical_player_evidence_json', 'TEXT'],
  ['tennis_canonical_player_evidence_updated_at', 'TEXT']
]);

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function migrate(dbPath) {
  const resolved = path.resolve(dbPath || path.join(__dirname, 'database_betting.db'));
  const db = new DatabaseSync(resolved);
  try {
    const existing = tableColumns(db, 'ai_forward_test');
    const added = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [name, type] of COLUMNS) {
        if (!existing.has(name)) {
          db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
          added.push(name);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    const finalColumns = tableColumns(db, 'ai_forward_test');
    const missing = COLUMNS.map(([name]) => name).filter(name => !finalColumns.has(name));
    if (missing.length) throw new Error(`PATCH26_COLUMNS_MISSING:${missing.join(',')}`);
    return {
      success: true,
      version: TENNIS_PATCH26_SCHEMA_VERSION,
      database: resolved,
      added,
      idempotent: added.length === 0,
      historicalRowsRewritten: 0,
      probabilityAuthorityChanged: false,
      qualityGateAuthorityChanged: false,
      stakeAuthorityChanged: false
    };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try { console.log(JSON.stringify(migrate(process.argv[2]), null, 2)); }
  catch (error) { console.error(JSON.stringify({ success: false, error: error.message }, null, 2)); process.exit(1); }
}

module.exports = { TENNIS_PATCH26_SCHEMA_VERSION, COLUMNS, migrate, tableColumns };
