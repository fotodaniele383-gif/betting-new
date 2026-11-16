#!/usr/bin/env node
'use strict';

/**
 * STEP49C_REPAIR_SOFT_BLOCKS
 * Restores only legacy Tennis moneyline soft blocks already supported by a
 * confirmative DeepScan signal. Preview is default; use --apply for writes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPAIR_VERSION = 'TENNIS_STEP49C_SOFT_BLOCK_REPAIR_V2_PATCH30';
const STEP49C_REPAIR_MICRO_STAKE = 3.00;
const DEFAULT_MIN_BET = 2.00;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : path.join(__dirname, '..'));
const dbIndex = args.indexOf('--db');
const dbPath = path.resolve(dbIndex >= 0 && args[dbIndex + 1] ? args[dbIndex + 1] : path.join(root, 'backend', 'database_betting.db'));

function openDb() {
  try {
    const BetterSqlite = require(path.join(root, 'node_modules', 'better-sqlite3'));
    return { db: new BetterSqlite(dbPath), adapter: 'better-sqlite3' };
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(dbPath), adapter: 'node:sqlite' };
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function isConfirmative(row) {
  const text = normalizeText([
    row.ds_action, row.ds_suggestion, row.deep_scan_risk_level,
    row.stake_policy_note, row.tennis_operational_summary
  ].join(' '));
  if (!text) return false;
  if (text.includes('ALTO_RISCHIO') || text.includes('HIGH_RISK')) return false;
  if (text.includes('WAIT_IN_PLAY') || text.includes('ATTENDI') || text.includes('IN_PLAY')) return false;
  if (text.includes('RISCHIO_MODELLO') || text.includes('MODEL_RISK')) return false;
  return text.includes('DEEPSCAN_ADVISORY_NESSUNA_RIDUZIONE')
    || text.includes('CONFIRM_PRONOSTICO')
    || text.includes('CONFERMA_IL_PRONOSTICO')
    || text.includes('DEEPSCAN_CONFERMA')
    || text.includes('VALUE_CONFERMATO')
    || text.includes('NESSUNA_RIDUZIONE_SUGGERITA');
}

function isEligible(row) {
  const stake = Number(row.stake || 0);
  const prediction = normalizeText(row.prediction);
  const marketType = String(row.market_type || '').toLowerCase();
  const gateStatus = normalizeText(row.professional_gate_status);
  const opStatus = normalizeText(row.tennis_operational_status);
  const opAction = normalizeText(row.tennis_operational_action);
  const gateReasons = normalizeText(row.professional_gate_reasons);
  const text = normalizeText([row.ds_action, row.ds_suggestion, row.deep_scan_risk_level, row.stake_policy_note, row.tennis_operational_summary].join(' '));
  const edge = numberOrNull(row.edge_pp);
  const ev = numberOrNull(row.ev_pct);
  const odd = numberOrNull(row.odd);
  const estimated = numberOrNull(row.estimated_prob);
  const implied = numberOrNull(row.market_implied_prob) ?? (odd && odd > 1 ? 100 / odd : null);

  if (stake >= DEFAULT_MIN_BET) return false;
  if (marketType === 'totals' || prediction.includes('OVER') || prediction.includes('UNDER')) return false;
  if (gateStatus.includes('HARD') || gateStatus.includes('OPPOSITE_SIDE_CONFLICT')) return false;
  if (opStatus.includes('HARD') || opAction.includes('NO_BET_HARD')) return false;
  if (gateReasons.includes('ALTO_RISCHIO') || gateReasons.includes('HIGH_RISK')) return false;
  if (text.includes('ALTO_RISCHIO') || text.includes('HIGH_RISK')) return false;
  if (text.includes('WAIT_IN_PLAY') || text.includes('ATTENDI') || text.includes('IN_PLAY')) return false;
  if (!isConfirmative(row)) return false;
  if (!(edge >= 4) || !(ev >= 5)) return false;
  if (estimated !== null && implied !== null && estimated <= implied) return false;

  return gateStatus.includes('SOFT')
    || opStatus.includes('BLOCCATA_SOFT')
    || opStatus.includes('BLOCKED_SOFT')
    || opAction.includes('NO_BET')
    || opAction.includes('REVIEW')
    || Number(row.professional_gate_allow_bet || 0) === 0;
}

function buildPlan(rows) {
  return rows.filter(isEligible).map(row => {
    const cap = numberOrNull(row.professional_gate_max_stake);
    const newStake = cap !== null && cap >= DEFAULT_MIN_BET
      ? Math.min(STEP49C_REPAIR_MICRO_STAKE, cap)
      : STEP49C_REPAIR_MICRO_STAKE;
    return {
      id: Number(row.id),
      match: `${row.home_team || ''} - ${row.away_team || ''}`,
      prediction: row.prediction,
      oldStake: Number(row.stake || 0),
      newStake: STEP49C_REPAIR_MICRO_STAKE,
      effectiveStake: Number(newStake.toFixed(2)),
      changes: {
        stake: Number(newStake.toFixed(2)),
        professional_gate_status: 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED_REPAIR',
        professional_gate_allow_bet: 1,
        professional_gate_reasons: 'Step49C Repair: soft block con DeepScan confermativo; sblocco solo micro-stake, stake standard non consentito.',
        professional_gate_max_stake: Number(newStake.toFixed(2)),
        tennis_operational_status: 'WATCHLIST_MICRO_STAKE',
        tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
        tennis_operational_summary: 'Step49C Repair: DeepScan conferma: micro-stake attivo, stake standard non consentito.',
        stake_policy_note: 'Step49C Repair: DeepScan conferma: micro-stake attivo, stake standard non consentito.'
      }
    };
  });
}

function applyPlan(db, columns, plan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of plan) {
      const entries = Object.entries(item.changes).filter(([column]) => columns.has(column));
      db.prepare(`UPDATE ai_forward_test SET ${entries.map(([column]) => `${column}=?`).join(', ')} WHERE id=? AND status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS'`).run(...entries.map(([, value]) => value), item.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

if (!fs.existsSync(dbPath)) {
  console.log(JSON.stringify({ success: false, code: 'DATABASE_NOT_FOUND', dbPath }, null, 2));
  process.exit(1);
}

const beforeHash = sha256File(dbPath);
const { db, adapter } = openDb();
try {
  const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id`).all();
  const plan = buildPlan(rows);
  const calcioBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n || 0);
  if (apply && plan.length) applyPlan(db, columns, plan);
  const calcioAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n || 0);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const output = {
    success: integrity === 'ok' && calcioBefore === calcioAfter,
    version: REPAIR_VERSION,
    marker: 'STEP49C_REPAIR_SOFT_BLOCKS',
    mode: apply ? 'APPLY' : 'PREVIEW',
    adapter,
    database: dbPath,
    pendingTennisRowsScanned: rows.length,
    eligibleRows: plan.length,
    appliedRows: apply ? plan.length : 0,
    calcioRowsUnchanged: calcioBefore === calcioAfter,
    integrity,
    beforeDatabaseSha256: beforeHash,
    afterDatabaseSha256: apply ? sha256File(dbPath) : beforeHash,
    plan
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.success ? 0 : 1);
} finally {
  db.close();
}
