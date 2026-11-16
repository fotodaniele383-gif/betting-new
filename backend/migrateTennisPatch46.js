#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const contractModule = require('./tennisStakeExecutionContractPatch46');

const PATCH = 'TENNIS_PATCH_46_STAKE_AUTHORITY_SEMANTIC_SEPARATION_FINAL_EXECUTABLE_CONTRACT';
const REVISION = 'R1_WINDOWS_NODE_FINAL_EXECUTABLE_STAKE_CONTRACT_APPEND_ONLY_SNAPSHOT';
const MIGRATION = 'ADDITIVE_STAKE_SEMANTIC_COLUMNS_APPEND_ONLY_SNAPSHOTS_NO_BUSINESS_VALUE_CHANGE';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(value => /\.db$/i.test(value));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');

function openDb(file) {
  try {
    const Better = require('better-sqlite3');
    return { db: new Better(file), adapter: 'better-sqlite3' };
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(file), adapter: 'node:sqlite' };
  }
}
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function tennisWhere() { return `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`; }
function counts(db) {
  return {
    total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),
    tennis: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n),
    pendingTennis: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${tennisWhere()}`).get().n),
    positivePendingStake: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${tennisWhere()} AND COALESCE(stake,0)>0`).get().n),
    pendingStakeTotal: Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${tennisWhere()}`).get().n)
  };
}
function businessFingerprint(db) {
  const rows = db.prepare(`SELECT id,status,stake,estimated_prob,edge_pp,ev_pct,ds_action,quality_final_code,quality_final_score,professional_gate_allow_bet,professional_gate_max_stake FROM ai_forward_test WHERE ${tennisWhere()} ORDER BY id`).all();
  return sha(rows);
}
function semanticRows(db) {
  return db.prepare(`SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${tennisWhere()} ORDER BY id`).all();
}
function updateCurrentContract(db, row, contract) {
  const fields = contractModule.toPersistenceFields(contract);
  const names = Object.keys(fields);
  db.prepare(`UPDATE ai_forward_test SET ${names.map(name => `${name}=?`).join(',')} WHERE id=?`).run(...names.map(name => fields[name]), row.id);
}

const opened = openDb(dbPath);
const db = opened.db;
let output;
try {
  const integrityBefore = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  const fkBefore = db.prepare('PRAGMA foreign_key_check').all();
  if (String(integrityBefore).toLowerCase() !== 'ok' || fkBefore.length) throw new Error('PATCH46_DATABASE_PRECHECK_FAILED');
  const before = counts(db);
  const beforeFingerprint = businessFingerprint(db);
  const rows = semanticRows(db);
  const planned = rows.map(row => contractModule.buildFromRow(row, { decidedAt: row.tennis_probability_guard_decided_at || row.tennis_stake_authority_decided_at || new Date().toISOString() }));

  let insertedSnapshots = 0;
  let reusedSnapshots = 0;
  if (apply) db.exec('BEGIN IMMEDIATE');
  try {
    if (apply) {
      contractModule.ensureSchema(db);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const contract = planned[index];
        updateCurrentContract(db, row, contract);
        const persisted = contractModule.persistSnapshot(db, contract);
        if (persisted.inserted) insertedSnapshots += 1; else reusedSnapshots += 1;
      }
      db.exec('COMMIT');
    }
  } catch (error) {
    if (apply) try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }

  const after = counts(db);
  const afterFingerprint = businessFingerprint(db);
  const snapshotRows = apply ? Number(db.prepare(`SELECT COUNT(*) n FROM ${contractModule.SNAPSHOT_TABLE}`).get().n) : null;
  const semanticColumns = apply ? db.prepare('PRAGMA table_info(ai_forward_test)').all().filter(row => row.name.startsWith('tennis_stake_')).map(row => row.name) : [];
  const integrityAfter = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  const fkAfter = db.prepare('PRAGMA foreign_key_check').all();
  output = {
    success: true,
    patch: PATCH,
    revision: REVISION,
    mode: preview ? 'PREVIEW' : 'APPLY',
    migration: MIGRATION,
    adapter: opened.adapter,
    dbPath,
    before,
    after,
    businessFingerprintBefore: beforeFingerprint,
    businessFingerprintAfter: afterFingerprint,
    businessValuesUnchanged: beforeFingerprint === afterFingerprint,
    rowCountsUnchanged: before.total === after.total && before.tennis === after.tennis,
    plannedContracts: planned.length,
    insertedSnapshots,
    reusedSnapshots,
    snapshotRows,
    semanticColumns,
    authority: {
      tpi: contractModule.TPI_AUTHORITY,
      finalExecutable: contractModule.FINAL_AUTHORITY,
      singleFinalAuthority: true,
      noStakeIncrease: true
    },
    integrity: integrityAfter,
    foreignKeyViolations: fkAfter.length,
    probabilityChanged: false,
    qualityLogicChanged: false,
    riskLogicChanged: false,
    calibrationLogicChanged: false
  };
  if (!output.businessValuesUnchanged || !output.rowCountsUnchanged || String(integrityAfter).toLowerCase() !== 'ok' || fkAfter.length) throw new Error('PATCH46_POSTCONDITION_FAILED');
} finally {
  db.close();
}
console.log(JSON.stringify(output, null, 2));
