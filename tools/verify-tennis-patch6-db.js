'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const eligibility = require('../backend/tennisCalibrationEligibility');
const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
const table = eligibility.TENNIS_CALIBRATION_LEDGER_TABLE;
const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
const integrity = db.prepare('PRAGMA integrity_check').all();
const tableExists = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n === 1;
const columns = tableExists ? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)) : new Set();
const schemaReady = eligibility.LEDGER_SCHEMA.every(([name]) => columns.has(name));
const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
const ledgerRows = tableExists ? db.prepare(`SELECT * FROM ${table} ORDER BY bet_id`).all() : [];
const report = eligibility.buildCalibrationReadinessReport(rows, ledgerRows);
const invalidEligible = ledgerRows.filter(row => row.settlement_eligible === 1 && !['CLV_ELIGIBLE','PRODUCTION_ELIGIBLE','SETTLEMENT_ONLY'].includes(row.eligibility_status)).length;
const result = {
  success: integrity[0]?.integrity_check === 'ok' && tableExists && schemaReady && report.ledger.fresh && invalidEligible === 0,
  integrity,
  tableExists,
  schemaReady,
  schemaColumns: eligibility.LEDGER_SCHEMA.filter(([name]) => columns.has(name)).length,
  schemaExpected: eligibility.LEDGER_SCHEMA.length,
  sourceRows: rows.length,
  ledgerRows: ledgerRows.length,
  ledger: report.ledger,
  eligibilityCounts: report.eligibilityCounts,
  eligible: report.eligible,
  readiness: report.readiness,
  shadowMetrics: report.metrics,
  invalidEligible,
  autoApplyCalibration: report.autoApplyCalibration,
  operationalModelChanged: report.operationalModelChanged
};
fs.mkdirSync(path.join(ROOT, 'audit_patch6'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch6', 'patch6_db_verification_report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
db.close();
if (!result.success) process.exit(2);
