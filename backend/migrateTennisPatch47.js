#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const ledger = require('./tennisClvDegradedLedgerPatch47');

const PATCH = 'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES';
const REVISION = 'R1_WINDOWS_NODE_CLV_LEDGER_IDEMPOTENT_TERMINAL_STATES';

function parseArgs(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const preview = argv.includes('--preview') || !apply;
  const dbArg = argv.find(v => /\.db$/i.test(v));
  const nowIndex = argv.indexOf('--now');
  return { apply, preview, dbPath: path.resolve(dbArg || path.join(__dirname, 'database_betting.db')), now: nowIndex >= 0 && argv[nowIndex + 1] ? new Date(argv[nowIndex + 1]) : new Date() };
}
function openDb(dbPath, readOnly = false) {
  try {
    const req = createRequire(path.join(path.dirname(__dirname), 'package.json'));
    const Better = req('better-sqlite3');
    return new Better(dbPath, readOnly ? { readonly: true, fileMustExist: true } : {});
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly, open: true });
  }
}
function stableHash(rows) { return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
function businessRows(db) {
  return db.prepare(`
    SELECT id,status,stake,odd,estimated_prob,edge_pp,ev_pct,ds_action,quality_final_code,
           professional_gate_allow_bet,professional_gate_max_stake,clv,clv_edge,closing_odd,
           opening_odd,clv_verified,clv_contract_status,clv_contract_reason
    FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type,''))='TENNIS'
       OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
       OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
    ORDER BY id
  `).all();
}
function operationalRows(db) {
  return db.prepare(`
    SELECT * FROM ai_forward_test
    WHERE (UPPER(COALESCE(sport_type,''))='TENNIS'
       OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
       OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')
      AND UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST')
      AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%'
    ORDER BY id
  `).all();
}
function safeUpdateSemantic(db, id, fields) {
  const entries = Object.entries(fields);
  const sql = `UPDATE ai_forward_test SET ${entries.map(([k]) => `${k}=?`).join(',')} WHERE id=?`;
  return db.prepare(sql).run(...entries.map(([, v]) => v), id);
}
function runTransaction(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
}
function countStates(rows) {
  const out = {};
  for (const row of rows) out[row.state] = (out[row.state] || 0) + 1;
  return out;
}
function migrate(options = {}) {
  const dbPath = path.resolve(options.dbPath);
  const apply = options.apply === true;
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now : new Date();
  const db = openDb(dbPath, false);
  try {
    const integrityBefore = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    const fkBefore = db.prepare('PRAGMA foreign_key_check').all();
    if (String(integrityBefore).toLowerCase() !== 'ok' || fkBefore.length) throw new Error(`PATCH47_DATABASE_INTEGRITY_FAILED:${integrityBefore}:${fkBefore.length}`);
    const businessBefore = businessRows(db);
    const fingerprintBefore = stableHash(businessBefore);
    const rows = operationalRows(db);
    const plans = rows.map(row => ({ row, semantic: ledger.buildSemanticFields(row, {}, now) }));
    let updatedRows = 0, insertedLedger = 0, reusedLedger = 0;
    if (apply) {
      runTransaction(db, () => {
        ledger.createSchema(db);
        for (const plan of plans) {
          if (!plan.semantic.unchanged) {
            const info = safeUpdateSemantic(db, plan.row.id, plan.semantic.fields);
            updatedRows += Number(info.changes || 0);
          }
          const fresh = { ...plan.row, ...plan.semantic.fields };
          const entry = ledger.appendLedger(db, fresh, {}, plan.semantic, now);
          if (entry.inserted) insertedLedger++; else reusedLedger++;
        }
      });
    }
    const businessAfter = businessRows(db);
    const fingerprintAfter = stableHash(businessAfter);
    const integrityAfter = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    const fkAfter = db.prepare('PRAGMA foreign_key_check').all();
    const summary = apply ? ledger.getLedgerSummary(db) : {
      version: ledger.TENNIS_CLV_DEGRADED_LEDGER_VERSION,
      plannedRows: plans.length,
      byState: countStates(plans.map(p => ({ state: p.semantic.classification.state })))
    };
    return {
      success: true,
      patch: PATCH,
      revision: REVISION,
      mode: apply ? 'APPLY' : 'PREVIEW',
      migration: 'ADDITIVE_CLV_LEDGER_SEMANTIC_FIELDS_APPEND_ONLY_EVIDENCE_NO_BUSINESS_VALUE_CHANGE',
      dbPath,
      generatedAt: now.toISOString(),
      operationalRows: rows.length,
      plannedStates: countStates(plans.map(p => ({ state: p.semantic.classification.state }))),
      updatedSemanticRows: updatedRows,
      insertedLedgerRows: insertedLedger,
      reusedLedgerRows: reusedLedger,
      summary,
      businessFingerprintBefore: fingerprintBefore,
      businessFingerprintAfter: fingerprintAfter,
      businessValuesUnchanged: fingerprintBefore === fingerprintAfter,
      integrity: integrityAfter,
      foreignKeyViolations: fkAfter.length,
      schema: apply ? ledger.createSchema(db) : { semanticColumns: [...ledger.SEMANTIC_COLUMNS], table: 'tennis_clv_degraded_ledger_patch47' },
      noProbabilityChange: true,
      noStakeChange: true,
      noSettlementChange: true,
      noClvValueRewrite: true
    };
  } finally { db.close(); }
}

if (require.main === module) {
  try {
    const args = parseArgs();
    const result = migrate(args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.businessValuesUnchanged || String(result.integrity).toLowerCase() !== 'ok' || result.foreignKeyViolations) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ success: false, patch: PATCH, revision: REVISION, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { PATCH, REVISION, migrate, parseArgs, openDb };
