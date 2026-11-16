'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { SETTLEMENT_SCHEMA_COLUMNS, TENNIS_SETTLEMENT_CONTRACT_VERSION } = require('../backend/tennisSettlementContract');
const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
const have = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
const where = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";
const q = sql => db.prepare(sql).get().n;
const statusRows = have.has('settlement_contract_status') ? db.prepare(`SELECT COALESCE(settlement_contract_status,'UNCLASSIFIED') status, COUNT(*) n FROM ai_forward_test WHERE ${where} GROUP BY COALESCE(settlement_contract_status,'UNCLASSIFIED')`).all() : [];
const report = {
  integrity: db.prepare('PRAGMA integrity_check').all(),
  schema: SETTLEMENT_SCHEMA_COLUMNS.filter(([name]) => have.has(name)).length,
  schemaExpected: SETTLEMENT_SCHEMA_COLUMNS.length,
  totalTennis: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where}`),
  settledTennis: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')`),
  historicalPendingSourceOnSettled: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND (UPPER(COALESCE(settlement_source,'')) LIKE 'PENDING%' OR UPPER(COALESCE(settlement_source,'')) IN ('SCORE_NOT_AVAILABLE','TIMEOUT_120H'))`),
  historicalMissingSourceOnSettled: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND COALESCE(TRIM(settlement_source),'')=''`),
  historicalManualSettled: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND UPPER(COALESCE(settlement_source,''))='MANUAL_FORCE'`),
  historicalWeakWebSettled: q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND (UPPER(COALESCE(settlement_source,'')) LIKE '%WEB_FALLBACK%' OR UPPER(COALESCE(settlement_source,'')) LIKE '%DUCKDUCKGO%' OR UPPER(COALESCE(settlement_source,'')) LIKE '%AI_SEARCH%')`),
  patch5InvalidAutoSettled: have.has('settlement_contract_status') ? q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND settlement_contract_version='${TENNIS_SETTLEMENT_CONTRACT_VERSION}' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND UPPER(COALESCE(settlement_contract_status,'')) NOT IN ('VERIFIED','VOID','MANUAL_REVIEW')`) : -1,
  patch5VerifiedMissingEvidence: have.has('settlement_contract_status') ? q(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND settlement_contract_version='${TENNIS_SETTLEMENT_CONTRACT_VERSION}' AND settlement_contract_status='VERIFIED' AND (COALESCE(settlement_evidence_hash,'')='' OR COALESCE(settlement_source_event_id,'')='' OR COALESCE(settlement_event_fingerprint,'')='' OR COALESCE(settlement_market_fingerprint,'')='')`) : -1,
  byContractStatus: Object.fromEntries(statusRows.map(row => [row.status, row.n])),
  historicalBackfill: false
};
report.success = report.integrity[0]?.integrity_check === 'ok' && report.schema === report.schemaExpected && report.patch5InvalidAutoSettled === 0 && report.patch5VerifiedMissingEvidence === 0;
fs.mkdirSync(path.join(ROOT, 'audit_patch5'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch5', 'patch5_db_verification_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
if (!report.success) process.exit(2);
