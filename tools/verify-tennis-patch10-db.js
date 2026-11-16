'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const quality = require('../backend/tennisQualityGateV2');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const AUDIT_DIR = path.join(ROOT, 'audit_patch10');
const REPORT_PATH = path.join(AUDIT_DIR, 'patch10_db_verification_report.json');
const EXPECTED = [
  'quality_base_code','quality_base_label','quality_base_score','quality_base_reason','quality_base_version',
  'quality_final_code','quality_final_label','quality_final_score','quality_final_reason','quality_final_version',
  'quality_stake_mode','quality_stake_amount','quality_budget_pct','quality_decision_at','quality_deepscan_class','quality_deepscan_separate'
];
let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const cols = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
  const missing = EXPECTED.filter(name => !cols.includes(name));
  const where = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
  const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${where} ORDER BY id`).all();
  const audit = quality.buildQualityPerformanceAudit(rows);
  const invalidFinal = missing.length ? null : Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE quality_final_version=? AND (quality_final_code IS NULL OR quality_stake_mode IS NULL OR quality_stake_amount IS NULL OR quality_deepscan_separate<>1)`).get(quality.TENNIS_QUALITY_GATE_VERSION).n || 0);
  const invalidStake = missing.length ? null : Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE quality_final_version=? AND ((quality_final_code IN ('BLOCKED_HARD','BLOCKED_SOFT') AND COALESCE(quality_stake_amount,0)<>0) OR (quality_final_code='WATCHLIST_MICRO' AND ROUND(COALESCE(quality_stake_amount,0),2) NOT IN (0,2)))`).get(quality.TENNIS_QUALITY_GATE_VERSION).n || 0);
  const success = integrity === 'ok' && missing.length === 0 && invalidFinal === 0 && invalidStake === 0 && audit.success;
  const output = { success, patch:'10', version:quality.TENNIS_QUALITY_GATE_VERSION, integrity, expectedColumns:EXPECTED.length, missing, totalTennis:audit.rows, resolvedTennis:audit.resolved, invalidFinal, invalidStake, auditSummary:{ byFinalQuality:audit.byFinalQuality, zeroStakeHighRate:audit.zeroStakeHighRate }, timestamp:new Date().toISOString() };
  fs.mkdirSync(AUDIT_DIR, { recursive:true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
  if (!success) process.exitCode=2;
} catch (error) { console.error(error.stack||error.message); process.exitCode=2; }
finally { try { db?.close(); } catch (_) {} }
