#!/usr/bin/env node
'use strict';

/**
 * Step 15 - Tennis Pending Consistency Repair
 * Step 16 - Tennis Paper Trading Consistency Repair v2
 * DeepScan Operational-Gate compatibility repair.
 *
 * Safety contract:
 * - Tennis-only: UPPER(COALESCE(sport_type, '')) = 'TENNIS'
 * - Preview is the default. Use --apply for writes.
 * - The repair never increases stake; current < target remains unchanged.
 * - Settled rows are never re-settled or repriced.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPAIR_VERSION = 'TENNIS_PENDING_CONSISTENCY_REPAIR_V4_PATCH30';
const DEFAULT_MIN_BET = 2.00;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : path.join(__dirname, '..'));
const dbPathIndex = args.indexOf('--db');
const dbPath = path.resolve(dbPathIndex >= 0 && args[dbPathIndex + 1] ? args[dbPathIndex + 1] : path.join(root, 'backend', 'database_betting.db'));

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

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

function canonicalMarket(row) {
  const prediction = normalizeText(row.prediction);
  if (String(row.market_type || '').toLowerCase() === 'totals' || prediction.includes('OVER') || prediction.includes('UNDER')) return 'TOTALS';
  return String(row.market_type || 'moneyline').toUpperCase();
}

function combinedText(row) {
  return normalizeText([
    row.ds_action, row.deep_scan_risk_level, row.ds_suggestion,
    row.professional_gate_status, row.professional_gate_reasons,
    row.tennis_operational_status, row.tennis_operational_action,
    row.tennis_operational_summary, row.stake_policy_note
  ].join(' '));
}

function classify(row) {
  const text = combinedText(row);
  const status = String(row.status || '').toUpperCase();
  const current = Number(row.stake || 0);
  const hard = text.includes('BLOCKED_HARD') || text.includes('BLOCCATA_HARD') || text.includes('NO_BET_HARD') || text.includes('OPERATIONAL_GATE_BLOCCANTE');
  const highRisk = text.includes('ALTO_RISCHIO') || text.includes('HIGH_RISK') || text.includes('HIGH_RISK');
  const noBet = text.includes('NO_BET') || hard || highRisk;
  const modelRisk = text.includes('RISCHIO_MODELLO') || text.includes('MODEL_RISK');
  const lowEdge = text.includes('LOW_EDGE') || text.includes('EDGE_BASSO') || text.includes('WATCHLIST_LOW_EDGE');

  if (status === 'PENDING' && (highRisk || hard)) {
    return {
      reason: highRisk ? 'BLOCKED_DEEPSCAN_HIGH_RISK' : 'Operational/Gate bloccante',
      changes: {
        stake: 0,
        professional_gate_allow_bet: 0,
        professional_gate_max_stake: 0,
        professional_gate_status: highRisk ? 'BLOCKED_DEEPSCAN_HIGH_RISK' : 'BLOCKED_OPERATIONAL_GATE',
        tennis_operational_status: 'BLOCKED_HARD',
        tennis_operational_action: 'NO_BET',
        stake_policy_note: highRisk ? 'BLOCKED_DEEPSCAN_HIGH_RISK: alto rischio, stake operativo 0.' : 'Operational/Gate bloccante: NO_BET, stake operativo 0.'
      }
    };
  }

  if (status === 'PENDING' && modelRisk) {
    const target = DEFAULT_MIN_BET;
    // La repair non aumenta stake già ridotti: current < target resta invariato.
    const safeStake = current < target ? current : target;
    return {
      reason: 'WATCHLIST_DEEPSCAN_MODEL_RISK',
      changes: {
        stake: safeStake,
        professional_gate_allow_bet: safeStake >= DEFAULT_MIN_BET ? 1 : 0,
        professional_gate_max_stake: safeStake,
        professional_gate_status: 'WATCHLIST_DEEPSCAN_MODEL_RISK',
        tennis_operational_status: 'WATCHLIST_MICRO',
        tennis_operational_action: safeStake >= DEFAULT_MIN_BET ? 'PAPER_OR_MICRO_STAKE' : 'NO_BET',
        stake_policy_note: 'WATCHLIST_DEEPSCAN_MODEL_RISK: nessun aumento automatico dello stake.'
      }
    };
  }

  if (status === 'PENDING' && lowEdge) {
    const target = DEFAULT_MIN_BET;
    const safeStake = current < target ? current : target;
    return {
      reason: 'WATCHLIST_DEEPSCAN_LOW_EDGE',
      changes: {
        stake: safeStake,
        professional_gate_allow_bet: safeStake >= DEFAULT_MIN_BET ? 1 : 0,
        professional_gate_max_stake: safeStake,
        professional_gate_status: 'WATCHLIST_DEEPSCAN_LOW_EDGE',
        tennis_operational_status: 'WATCHLIST_LOW_EDGE',
        tennis_operational_action: safeStake >= DEFAULT_MIN_BET ? 'PAPER_OR_MICRO_STAKE' : 'NO_BET',
        stake_policy_note: 'WATCHLIST_DEEPSCAN_LOW_EDGE: nessun aumento automatico dello stake.'
      }
    };
  }

  if (['WON', 'LOST'].includes(status) && (highRisk || hard) && Number(row.stake || 0) > 0) {
    return {
      reason: 'SETTLED_NON_CONFORMING_EXCLUDED',
      settledExcluded: true,
      changes: {
        data_quality: 'LEGACY_DIRTY'
      }
    };
  }

  return null;
}

function detectOppositeSideConflicts(rows) {
  const groups = new Map();
  for (const row of rows.filter(item => String(item.status || '').toUpperCase() === 'PENDING')) {
    const players = [normalizeText(row.home_team), normalizeText(row.away_team)].sort().join('|');
    const key = [players, String(row.league || '').toUpperCase(), canonicalMarket(row), Number(row.point_line ?? -9999)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const conflicts = new Map();
  for (const group of groups.values()) {
    const sides = new Set(group.map(row => normalizeText(row.prediction)));
    if (sides.size <= 1) continue;
    for (const row of group) conflicts.set(Number(row.id), {
      reason: 'Opposite-side conflict',
      changes: {
        stake: 0,
        professional_gate_allow_bet: 0,
        professional_gate_max_stake: 0,
        professional_gate_status: 'BLOCKED_OPPOSITE_SIDE_CONFLICT',
        tennis_operational_status: 'BLOCKED_HARD',
        tennis_operational_action: 'NO_BET',
        stake_policy_note: 'Opposite-side conflict: BLOCKED_OPPOSITE_SIDE_CONFLICT, stake operativo 0.'
      }
    });
  }
  return conflicts;
}

function columnSet(db) {
  return new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
}

function selectRows(db) {
  return db.prepare(`
    SELECT * FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type, '')) = 'TENNIS'
      AND UPPER(COALESCE(data_quality, 'CURRENT_BOOTSTRAP')) IN ('CURRENT', 'CURRENT_BOOTSTRAP', 'LEGACY_DIRTY')
      AND UPPER(COALESCE(status, '')) IN ('PENDING', 'WON', 'LOST')
    ORDER BY id
  `).all();
}

function makePlan(rows) {
  const opposite = detectOppositeSideConflicts(rows);
  const plan = [];
  for (const row of rows) {
    const decision = opposite.get(Number(row.id)) || classify(row);
    if (!decision) continue;
    const changes = Object.fromEntries(Object.entries(decision.changes || {}).filter(([key, value]) => row[key] !== value));
    if (!Object.keys(changes).length) continue;
    plan.push({ id: Number(row.id), status: row.status, match: `${row.home_team || ''} - ${row.away_team || ''}`, prediction: row.prediction, currentStake: Number(row.stake || 0), reason: decision.reason, settledExcluded: decision.settledExcluded === true, changes });
  }
  return plan;
}

function applyPlan(db, columns, plan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of plan) {
      const entries = Object.entries(item.changes).filter(([column]) => columns.has(column));
      if (!entries.length) continue;
      db.prepare(`UPDATE ai_forward_test SET ${entries.map(([column]) => `${column}=?`).join(', ')} WHERE id=? AND UPPER(COALESCE(sport_type,''))='TENNIS'`).run(...entries.map(([, value]) => value), item.id);
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
  const columns = columnSet(db);
  const rows = selectRows(db);
  const plan = makePlan(rows);
  const calcioBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n || 0);
  const settledExcluded = plan.filter(item => item.settledExcluded).length;
  if (apply && plan.length) applyPlan(db, columns, plan);
  const calcioAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n || 0);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const output = {
    success: integrity === 'ok' && calcioBefore === calcioAfter,
    version: REPAIR_VERSION,
    mode: apply ? 'APPLY' : 'PREVIEW',
    adapter,
    database: dbPath,
    tennisRowsScanned: rows.length,
    plannedChanges: plan.length,
    appliedChanges: apply ? plan.length : 0,
    settledExcluded,
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
