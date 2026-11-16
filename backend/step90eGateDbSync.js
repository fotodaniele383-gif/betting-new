'use strict';

// STEP90E_GATE_DB_SYNC
// Sincronizza lo storico paper trading Tennis con la decisione Step90 già calcolata in pre_match_gate_label.
// Non modifica status, stake, profit, quota, CLV o settlement. Preserva le colonne gate operative originali.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');

const STEP90E_GATE_DB_SYNC_VERSION = 'STEP90E_GATE_DB_SYNC_V1';
const APPLY = process.argv.includes('--apply');
const ROOT_DIR = __dirname;
const DB_PATH = process.env.BETTING_DB_PATH || path.resolve(ROOT_DIR, 'database_betting.db');

function nowIso() {
  return new Date().toISOString();
}

function backupDb(dbPath) {
  if (!APPLY || !fs.existsSync(dbPath)) return null;
  const backupDir = path.resolve(ROOT_DIR, 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `database_betting_BACKUP_step90e_gate_sync_${stamp}.db`);
  fs.copyFileSync(dbPath, target);
  return target;
}

function tableExists(db, table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function safeAddColumn(db, table, definition) {
  const column = String(definition).trim().split(/\s+/)[0];
  if (!columnExists(db, table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  }
}

function ensureColumns(db) {
  [
    'step90e_original_professional_gate_status TEXT',
    'step90e_original_professional_gate_allow_bet INTEGER',
    'step90e_original_tennis_operational_status TEXT',
    'step90e_original_tennis_operational_action TEXT',
    'step90e_original_tennis_operational_summary TEXT',
    'step90e_original_stake_policy_note TEXT',
    'step90e_gate_db_sync_version TEXT',
    'step90e_gate_db_sync_at TEXT',
    'step90e_gate_db_sync_reason TEXT'
  ].forEach(def => safeAddColumn(db, 'ai_forward_test', def));
}

function normalizeLabel(value) {
  return String(value || '').toUpperCase().replace(/[🎾✅🟢]/g, '').replace(/\s+/g, ' ').trim();
}

function isTennisRow(row) {
  const text = [row.sport_type, row.bet_type, row.strategy_tag, row.league, row.tour_type]
    .map(v => String(v || '').toUpperCase())
    .join(' ');
  return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA') || text.includes('GRAND SLAM');
}

function mapStep90Label(label) {
  const normalized = normalizeLabel(label);
  if (normalized.includes('APPROVATA STAKE PIENO') || normalized.includes('APPROVED_FULL_STAKE')) {
    return {
      targetLabel: 'APPROVATA STAKE PIENO',
      professionalStatus: 'APPROVED_FULL_STAKE_STEP90E',
      allowBet: 1,
      action: 'BET_ALLOWED_FULL_STAKE_STEP90E',
      summary: 'Step90E: storico paper trading sincronizzato con decisione pre-match APPROVATA STAKE PIENO. CLV corrente escluso; storico aggregato usato solo come controllo.',
      reason: 'Sincronizzazione DB da pre_match_gate_label=APPROVATA STAKE PIENO.'
    };
  }
  if (normalized === 'APPROVATA' || normalized.includes('APPROVED_STEP90') || normalized.includes('PREMATCH_APPROVED')) {
    return {
      targetLabel: 'APPROVATA',
      professionalStatus: 'APPROVED_STEP90E',
      allowBet: 1,
      action: 'BET_ALLOWED_STEP90E_APPROVED',
      summary: 'Step90E: storico paper trading sincronizzato con decisione pre-match APPROVATA. Non è stake pieno automatico; resta dentro matrice Kelly/cap.',
      reason: 'Sincronizzazione DB da pre_match_gate_label=APPROVATA.'
    };
  }
  return null;
}

function runMigration({ dbPath = DB_PATH, apply = APPLY } = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB non trovato: ${dbPath}`);
  }

  const backup = apply ? backupDb(dbPath) : null;
  const db = sqlite3(dbPath);

  if (!tableExists(db, 'ai_forward_test')) {
    db.close();
    throw new Error('Tabella ai_forward_test non trovata.');
  }

  ensureColumns(db);

  const rows = db.prepare(`
    SELECT id,
           sport_type,
           bet_type,
           strategy_tag,
           league,
           tour_type,
           pre_match_gate_label,
           professional_gate_status,
           professional_gate_allow_bet,
           tennis_operational_status,
           tennis_operational_action,
           tennis_operational_summary,
           stake_policy_note,
           step90e_gate_db_sync_version
    FROM ai_forward_test
    WHERE UPPER(COALESCE(pre_match_gate_label,'')) IN ('APPROVATA','APPROVATA STAKE PIENO')
  `).all();

  const candidates = rows
    .filter(isTennisRow)
    .map(row => ({ row, mapped: mapStep90Label(row.pre_match_gate_label) }))
    .filter(item => item.mapped);

  const stamp = nowIso();
  let changed = 0;
  const byLabel = {};

  const update = db.prepare(`
    UPDATE ai_forward_test
    SET step90e_original_professional_gate_status = COALESCE(step90e_original_professional_gate_status, professional_gate_status),
        step90e_original_professional_gate_allow_bet = COALESCE(step90e_original_professional_gate_allow_bet, professional_gate_allow_bet),
        step90e_original_tennis_operational_status = COALESCE(step90e_original_tennis_operational_status, tennis_operational_status),
        step90e_original_tennis_operational_action = COALESCE(step90e_original_tennis_operational_action, tennis_operational_action),
        step90e_original_tennis_operational_summary = COALESCE(step90e_original_tennis_operational_summary, tennis_operational_summary),
        step90e_original_stake_policy_note = COALESCE(step90e_original_stake_policy_note, stake_policy_note),
        professional_gate_status = ?,
        professional_gate_allow_bet = ?,
        tennis_operational_status = ?,
        tennis_operational_action = ?,
        tennis_operational_summary = ?,
        stake_policy_note = CASE
          WHEN UPPER(COALESCE(stake_policy_note,'')) LIKE '%STEP90E_GATE_DB_SYNC%' THEN stake_policy_note
          ELSE COALESCE(stake_policy_note || ' | ', '') || 'STEP90E_GATE_DB_SYNC: gate storico allineato a ' || ? || '; campi originali preservati in step90e_original_*.'
        END,
        step90e_gate_db_sync_version = ?,
        step90e_gate_db_sync_at = ?,
        step90e_gate_db_sync_reason = ?
    WHERE id = ?
  `);

  const tx = db.transaction((items) => {
    for (const { row, mapped } of items) {
      const alreadyAligned = normalizeLabel(row.tennis_operational_status) === mapped.targetLabel &&
        normalizeLabel(row.step90e_gate_db_sync_version) === STEP90E_GATE_DB_SYNC_VERSION;
      byLabel[mapped.targetLabel] = (byLabel[mapped.targetLabel] || 0) + 1;
      if (alreadyAligned) continue;
      if (apply) {
        update.run(
          mapped.professionalStatus,
          mapped.allowBet,
          mapped.targetLabel,
          mapped.action,
          mapped.summary,
          mapped.targetLabel,
          STEP90E_GATE_DB_SYNC_VERSION,
          stamp,
          mapped.reason,
          row.id
        );
      }
      changed += 1;
    }
  });

  tx(candidates);

  const mismatches = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ai_forward_test
    WHERE UPPER(COALESCE(pre_match_gate_label,'')) IN ('APPROVATA','APPROVATA STAKE PIENO')
      AND (
        UPPER(COALESCE(sport_type,'')) = 'TENNIS'
        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
        OR UPPER(COALESCE(strategy_tag,'')) LIKE 'TENNIS_%'
        OR UPPER(COALESCE(league,'')) LIKE '%GRAND SLAM%'
        OR UPPER(COALESCE(tour_type,'')) IN ('ATP','WTA')
      )
      AND UPPER(COALESCE(tennis_operational_status,'')) NOT IN ('APPROVATA','APPROVATA STAKE PIENO')
  `).get().count;

  db.close();

  return {
    success: true,
    mode: apply ? 'APPLY' : 'DRY_RUN',
    version: STEP90E_GATE_DB_SYNC_VERSION,
    dbPath,
    backup,
    candidates: candidates.length,
    changed: apply ? changed : 0,
    wouldChange: apply ? 0 : changed,
    byLabel,
    mismatchesAfterRun: apply ? mismatches : null,
    safety: 'Non modificati status, stake, profit, quote, closing line, CLV o settlement. Originali preservati in step90e_original_*.'
  };
}

if (require.main === module) {
  try {
    const result = runMigration();
    console.log(JSON.stringify(result, null, 2));
    if (APPLY && result.mismatchesAfterRun !== 0) process.exitCode = 2;
  } catch (error) {
    console.error(`STEP90E_GATE_DB_SYNC_ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  STEP90E_GATE_DB_SYNC_VERSION,
  normalizeLabel,
  mapStep90Label,
  runMigration
};
