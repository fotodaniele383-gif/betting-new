'use strict';

// STEP90_PREMATCH_GATE_ALIGNMENT_BACKFILL
// Aggiorna SOLO colonne derivate/audit. Non modifica stake, profit, status, quote, CLV o gate originari.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');
const {
  STEP90_PREMATCH_GATE_ALIGNMENT_VERSION,
  buildStatsKey,
  calculateHistoricalStats,
  evaluatePreMatchGateDecision
} = require('./preMatchGateDecisionPolicy');

const ROOT_DIR = __dirname;
const DB_PATH = process.env.BETTING_DB_PATH || path.resolve(ROOT_DIR, 'database_betting.db');
const APPLY = process.argv.includes('--apply');

function nowIso() {
  return new Date().toISOString();
}

function backupDb(dbPath) {
  if (!APPLY || !fs.existsSync(dbPath)) return null;
  const backupDir = path.resolve(ROOT_DIR, 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `database_betting_BACKUP_step90_${stamp}.db`);
  fs.copyFileSync(dbPath, target);
  return target;
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function safeAddColumn(db, definition) {
  const column = String(definition).trim().split(/\s+/)[0];
  if (!columnExists(db, 'ai_forward_test', column)) {
    db.prepare(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`).run();
  }
}

function ensureColumns(db) {
  [
    'pre_match_gate_code TEXT',
    'pre_match_gate_label TEXT',
    'pre_match_gate_reason TEXT',
    'pre_match_gate_version TEXT',
    'pre_match_clv_used INTEGER',
    'pre_match_historical_sample INTEGER',
    'pre_match_historical_roi REAL',
    'pre_match_historical_brier REAL',
    'pre_match_historical_clv_sample INTEGER',
    'pre_match_updated_at TEXT'
  ].forEach(def => safeAddColumn(db, def));
}

function rowInput(row) {
  return {
    ...row,
    sport: String(row.sport_type || '').toUpperCase() || (String(row.bet_type || '').toUpperCase().includes('TENNIS') ? 'TENNIS' : 'CALCIO'),
    gateStatus: row.tennis_operational_status || row.calcio_operational_status || row.professional_gate_status || row.calcio_gate_status || row.deepscan_gate_status,
    operationalStatus: row.tennis_operational_status || row.calcio_operational_status,
    operationalAction: row.tennis_operational_action || row.calcio_operational_action,
    operationalSummary: row.tennis_operational_summary || row.calcio_operational_summary,
    gateReasons: row.professional_gate_reasons || row.calcio_gate_reasons || row.deepscan_gate_reason || row.stake_policy_note,
    gateAllowBet: row.professional_gate_allow_bet ?? row.calcio_gate_allow_bet,
    ds_action: row.ds_action,
    ds_suggestion: row.ds_suggestion,
    deep_scan_risk_level: row.deep_scan_risk_level,
    edge_pp: row.edge_pp,
    ev_pct: row.ev_pct,
    estimated_prob: row.estimated_prob
  };
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`DB non trovato: ${DB_PATH}`);
  }

  const backup = backupDb(DB_PATH);
  const db = sqlite3(DB_PATH);
  ensureColumns(db);

  const rows = db.prepare(`
    SELECT *
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST','PENDING')
      AND (
        UPPER(COALESCE(sport_type,'')) IN ('TENNIS','CALCIO')
        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
        OR UPPER(COALESCE(bet_type,'')) NOT LIKE '%MULTI%'
      )
  `).all();

  const cleanRows = rows.filter(r => {
    const q = String(r.data_quality || '').toUpperCase();
    return !q || q === 'CURRENT' || q === 'CURRENT_BOOTSTRAP';
  });

  const statsMap = calculateHistoricalStats(cleanRows.map(rowInput), buildStatsKey);
  const stamp = nowIso();
  let updated = 0;
  const decisions = new Map();

  const updateStmt = db.prepare(`
    UPDATE ai_forward_test
    SET pre_match_gate_code = ?,
        pre_match_gate_label = ?,
        pre_match_gate_reason = ?,
        pre_match_gate_version = ?,
        pre_match_clv_used = ?,
        pre_match_historical_sample = ?,
        pre_match_historical_roi = ?,
        pre_match_historical_brier = ?,
        pre_match_historical_clv_sample = ?,
        pre_match_updated_at = ?
    WHERE id = ?
  `);

  const tx = db.transaction((targetRows) => {
    for (const row of targetRows) {
      const input = rowInput(row);
      const key = buildStatsKey(input);
      const historicalStats = statsMap.get(key) || null;
      const decision = evaluatePreMatchGateDecision({ ...input, historicalStats });
      decisions.set(decision.label, (decisions.get(decision.label) || 0) + 1);
      if (APPLY) {
        updateStmt.run(
          decision.code,
          decision.label,
          decision.reason,
          STEP90_PREMATCH_GATE_ALIGNMENT_VERSION,
          decision.clvUsedForCurrentPick ? 1 : 0,
          decision.historicalSample,
          decision.historicalRoiPct,
          decision.historicalBrier,
          decision.historicalClvSample,
          stamp,
          row.id
        );
      }
      updated += 1;
    }
  });

  tx(cleanRows);
  db.close();

  const payload = {
    success: true,
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    version: STEP90_PREMATCH_GATE_ALIGNMENT_VERSION,
    dbPath: DB_PATH,
    backup,
    scanned: rows.length,
    cleanRows: cleanRows.length,
    updated: APPLY ? updated : 0,
    wouldUpdate: APPLY ? 0 : updated,
    decisions: Object.fromEntries([...decisions.entries()].sort((a, b) => b[1] - a[1])),
    safety: 'Non modificati stake, status, profit, quote, CLV, closing line o gate originari. Aggiornate solo colonne pre_match_*.'
  };
  console.log(JSON.stringify(payload, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`STEP90_BACKFILL_ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { rowInput };
