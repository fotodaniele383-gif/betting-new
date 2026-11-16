#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const riskAuthority = require('./tennisRiskAuthorityPatch36');
const driftAuthority = require('./tennisTourDriftAuthorityPatch36');
const tourReadiness = require('./tennisTourDataReadiness');

const PATCH = 'TENNIS_PATCH_36_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_GUARD';
const REVISION = 'R1_WINDOWS_NODE_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_GUARD';
const MIGRATION = 'ADDITIVE_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_AND_FRESHNESS_CIRCUIT_BREAKER';
const RISK_TABLE = 'tennis_risk_authority_decisions';
const DRIFT_TABLE = 'tennis_tour_drift_authority_runs';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(value => /\.db$/i.test(value));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');
const dataDir = path.resolve(process.cwd(), 'backend', 'sackmann_data');

function openDb(file) { try { const Better = require('better-sqlite3'); return { db: new Better(file), adapter: 'better-sqlite3' }; } catch (_) { const { DatabaseSync } = require('node:sqlite'); return { db: new DatabaseSync(file), adapter: 'node:sqlite' }; } }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function table(db, name) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function columns(db, name) { return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name)); }
function add(db, definition) { const name = definition.split(/\s+/)[0]; if (!columns(db, 'ai_forward_test').has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`); }
function tennisWhere() { return `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`; }
function counts(db) { return { total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n), tennis: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n), pending: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n), positiveStake: Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()} AND COALESCE(stake,0)>0`).get().n), stakeTotal: Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n) }; }
function ensureSchema(db) {
  [
    'tennis_risk_authority_version TEXT', 'tennis_risk_authority_status TEXT', 'tennis_risk_authority_reason TEXT',
    'tennis_risk_authority_tour TEXT', 'tennis_risk_authority_freshness_status TEXT', 'tennis_risk_authority_freshness_days REAL',
    'tennis_risk_authority_circuit_breaker INTEGER', 'tennis_risk_authority_decided_at TEXT'
  ].forEach(definition => add(db, definition));
  db.exec(`CREATE TABLE IF NOT EXISTS ${RISK_TABLE}(
    decision_id TEXT PRIMARY KEY, bet_id INTEGER NOT NULL, decided_at TEXT NOT NULL, authority_version TEXT NOT NULL,
    status TEXT NOT NULL, tour TEXT NOT NULL, sample INTEGER NOT NULL, proposed_stake REAL NOT NULL, final_stake REAL NOT NULL,
    freshness_status TEXT, freshness_days REAL, provider_id TEXT, circuit_breaker INTEGER NOT NULL, reason TEXT NOT NULL,
    before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
    UNIQUE(bet_id, authority_version)
  );
  CREATE INDEX IF NOT EXISTS idx_${RISK_TABLE}_bet ON ${RISK_TABLE}(bet_id, decided_at);
  CREATE TRIGGER IF NOT EXISTS trg_${RISK_TABLE}_no_update BEFORE UPDATE ON ${RISK_TABLE} BEGIN SELECT RAISE(ABORT,'${RISK_TABLE} append-only'); END;
  CREATE TRIGGER IF NOT EXISTS trg_${RISK_TABLE}_no_delete BEFORE DELETE ON ${RISK_TABLE} BEGIN SELECT RAISE(ABORT,'${RISK_TABLE} append-only'); END;
  CREATE TABLE IF NOT EXISTS ${DRIFT_TABLE}(
    run_id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, version TEXT NOT NULL, policy_version TEXT NOT NULL,
    retrospective_rows INTEGER NOT NULL, forward_rows INTEGER NOT NULL, retrospective_degradation INTEGER NOT NULL,
    forward_mature INTEGER NOT NULL, probability_adjustment_authority INTEGER NOT NULL, report_hash TEXT NOT NULL, report_json TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_${DRIFT_TABLE}_no_update BEFORE UPDATE ON ${DRIFT_TABLE} BEGIN SELECT RAISE(ABORT,'${DRIFT_TABLE} append-only'); END;
  CREATE TRIGGER IF NOT EXISTS trg_${DRIFT_TABLE}_no_delete BEFORE DELETE ON ${DRIFT_TABLE} BEGIN SELECT RAISE(ABORT,'${DRIFT_TABLE} append-only'); END;`);
}
function readinessMap() {
  const report = tourReadiness.buildTargetReadiness({ dataDir });
  return { report, map: new Map((report.targets || []).map(item => [item.targetId, item])) };
}
function targetForRow(row) { const text = `${row.tour_type || ''} ${row.league || ''} ${row.bet_type || ''} ${row.strategy_tag || ''}`.toUpperCase(); return text.includes('WTA') ? 'WTA_MAIN' : /CHALLENGER|QUALIF|ITF/.test(text) ? 'ATP_QUAL_CHALL' : 'ATP_MAIN'; }
function proposedStake(db, row) {
  if (table(db, 'tennis_stake_authority_decisions')) {
    const audit = db.prepare("SELECT proposed_stake FROM tennis_stake_authority_decisions WHERE bet_id=? AND authority_version='TENNIS_FINAL_STAKE_AUTHORITY_V1_PATCH35'").get(row.id);
    if (audit && Number.isFinite(Number(audit.proposed_stake))) return Number(audit.proposed_stake);
  }
  if (Number.isFinite(Number(row.tennis_stake_authority_proposed_stake))) return Number(row.tennis_stake_authority_proposed_stake);
  return Number(row.stake || 0);
}
function rowState(row) { return { id: row.id, stake: Number(row.stake || 0), authorityVersion: row.tennis_stake_authority_version || null, authorityStatus: row.tennis_stake_authority_status || null, operationalStatus: row.tennis_operational_status || null, operationalAction: row.tennis_operational_action || null, tradingScope: row.trading_scope || null }; }
function decideRow(db, row, ready, now, doApply) {
  const target = targetForRow(row); const source = ready.map.get(target) || { targetId: target, status: 'UNAVAILABLE', dataAgeDays: null, providerId: null, latestMatchAt: null };
  const proposed = proposedStake(db, row);
  const decision = riskAuthority.decide({
    proposedStake: proposed, qualityCode: row.quality_final_code, qualityLabel: row.quality_final_label,
    professionalGateStatus: row.professional_gate_status, operationalStatus: row.tennis_operational_status, operationalAction: row.tennis_operational_action,
    historicalEvidence: { resolved: row.historical_combo_resolved, reliability: row.historical_combo_reliability }, pre_match_historical_sample: row.pre_match_historical_sample,
    tour: row.tour_type, league: row.league, betType: row.bet_type,
    dataReadiness: { sourceFreshnessStatus: source.status, sourceFreshnessDays: source.dataAgeDays, sourceProviderId: source.providerId, sourceLatestMatchAt: source.latestMatchAt }
  });
  const before = rowState(row);
  const after = { ...before, stake: decision.finalStake, authorityVersion: decision.version, authorityStatus: decision.status, operationalStatus: `RISK_AUTHORITY_${decision.status}`, operationalAction: decision.finalStake > 0 ? 'FINAL_STAKE_AUTHORIZED' : 'PAPER_ONLY_NO_OPERATIONAL_STAKE', tradingScope: decision.finalStake > 0 ? 'PAPER_OPERATIONAL' : 'AUDIT_ONLY' };
  const decisionId = `TRA36_${row.id}_${sha([riskAuthority.VERSION, decision.status, proposed, decision.finalStake, source.status, source.dataAgeDays]).slice(0, 18)}`;
  if (doApply) {
    const fields = riskAuthority.toPersistenceFields(decision, now);
    db.prepare(`UPDATE ai_forward_test SET stake=?, professional_gate_allow_bet=?, professional_gate_max_stake=?, tennis_operational_status=?, tennis_operational_action=?, tennis_operational_summary=?, stake_policy_note=?, trading_scope=?, paper_trading_scope=?, portfolio_scope=?, audit_scope_reason=?, tennis_stake_authority_version=?, tennis_stake_authority_status=?, tennis_stake_authority_proposed_stake=?, tennis_stake_authority_final_stake=?, tennis_stake_authority_sample=?, tennis_stake_authority_reliability=?, tennis_stake_authority_reason=?, tennis_stake_authority_decided_at=?, tennis_risk_authority_version=?, tennis_risk_authority_status=?, tennis_risk_authority_reason=?, tennis_risk_authority_tour=?, tennis_risk_authority_freshness_status=?, tennis_risk_authority_freshness_days=?, tennis_risk_authority_circuit_breaker=?, tennis_risk_authority_decided_at=? WHERE id=?`).run(
      decision.finalStake, decision.finalStake > 0 ? 1 : 0, decision.finalStake, after.operationalStatus, after.operationalAction, decision.reason, `Patch36 ${decision.status}: ${decision.reason}`, after.tradingScope, after.tradingScope, 'EXCLUDED_FROM_REAL_PORTFOLIO', decision.reason,
      fields.tennis_stake_authority_version, fields.tennis_stake_authority_status, fields.tennis_stake_authority_proposed_stake, fields.tennis_stake_authority_final_stake, fields.tennis_stake_authority_sample, fields.tennis_stake_authority_reliability, fields.tennis_stake_authority_reason, fields.tennis_stake_authority_decided_at,
      fields.tennis_risk_authority_version, fields.tennis_risk_authority_status, fields.tennis_risk_authority_reason, fields.tennis_risk_authority_tour, fields.tennis_risk_authority_freshness_status, fields.tennis_risk_authority_freshness_days, fields.tennis_risk_authority_circuit_breaker, fields.tennis_risk_authority_decided_at, row.id
    );
    if (!db.prepare(`SELECT 1 ok FROM ${RISK_TABLE} WHERE bet_id=? AND authority_version=?`).get(row.id, riskAuthority.VERSION)) {
      db.prepare(`INSERT INTO ${RISK_TABLE}(decision_id,bet_id,decided_at,authority_version,status,tour,sample,proposed_stake,final_stake,freshness_status,freshness_days,provider_id,circuit_breaker,reason,before_hash,after_hash,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(decisionId,row.id,now,riskAuthority.VERSION,decision.status,decision.tour,decision.sample,decision.proposedStake,decision.finalStake,decision.dataFreshnessStatus,decision.dataFreshnessDays,decision.dataProviderId,decision.circuitBreaker?1:0,decision.reason,sha(before),sha(after),JSON.stringify(before),JSON.stringify(after));
    }
  }
  return { betId: row.id, match: `${row.home_team} - ${row.away_team}`, targetId: target, tour: decision.tour, beforeStake: before.stake, proposedStake: proposed, afterStake: decision.finalStake, status: decision.status, freshnessStatus: decision.dataFreshnessStatus, freshnessDays: decision.dataFreshnessDays, circuitBreaker: decision.circuitBreaker, changed: before.stake !== decision.finalStake };
}

const opened = openDb(dbPath); const db = opened.db; let output;
try {
  const integrityBefore = Object.values(db.prepare('PRAGMA integrity_check').get())[0]; const fkBefore = db.prepare('PRAGMA foreign_key_check').all();
  if (String(integrityBefore).toLowerCase() !== 'ok' || fkBefore.length) throw new Error('PATCH36_DATABASE_PRECHECK_FAILED');
  const before = counts(db); const ready = readinessMap(); const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()} ORDER BY id`).all(); const now = new Date().toISOString();
  if (apply) db.exec('BEGIN IMMEDIATE');
  let decisions; let drift;
  try {
    if (apply) ensureSchema(db);
    decisions = rows.map(row => decideRow(db, row, ready, now, apply));
    drift = driftAuthority.loadFromDb(db, { generatedAt: now });
    if (apply) {
      const reportJson = JSON.stringify(drift); const canonicalReportJson = JSON.stringify({ ...drift, generatedAt: null }); const reportHash = sha(canonicalReportJson); const runId = `TDA36_${reportHash.slice(0, 24)}`;
      if (!db.prepare(`SELECT 1 ok FROM ${DRIFT_TABLE} WHERE run_id=?`).get(runId)) db.prepare(`INSERT INTO ${DRIFT_TABLE}(run_id,generated_at,version,policy_version,retrospective_rows,forward_rows,retrospective_degradation,forward_mature,probability_adjustment_authority,report_hash,report_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(runId,now,drift.version,drift.policyVersion,drift.retrospective.rows,drift.forward.rows,drift.retrospective.overall.degradationActive?1:0,drift.forwardOverallMature?1:0,drift.probabilityAdjustmentAuthority?1:0,reportHash,reportJson);
      db.exec('COMMIT');
    }
  } catch (error) { if (apply) try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
  const after = counts(db); const changed = decisions.filter(item => item.changed); const breakers = decisions.filter(item => item.circuitBreaker);
  output = { success: true, patch: PATCH, revision: REVISION, mode: preview ? 'PREVIEW' : 'APPLY', migration: MIGRATION, adapter: opened.adapter, dbPath, before, after, businessRowCountUnchanged: before.total === after.total, decisions: decisions.length, changedStakeRows: changed.length, circuitBreakerRows: breakers.length, changed, readiness: ready.report, drift: { retrospectiveRows: drift.retrospective.rows, forwardRows: drift.forward.rows, retrospectiveDegradation: drift.retrospective.overall.degradationActive, severity: drift.retrospective.overall.severity, forwardOverallMature: drift.forwardOverallMature, probabilityAdjustmentAuthority: drift.probabilityAdjustmentAuthority, policy: drift.policy }, riskAuditRows: table(db,RISK_TABLE) ? Number(db.prepare(`SELECT COUNT(*) n FROM ${RISK_TABLE}`).get().n) : 0, driftAuditRows: table(db,DRIFT_TABLE) ? Number(db.prepare(`SELECT COUNT(*) n FROM ${DRIFT_TABLE}`).get().n) : 0, integrity: Object.values(db.prepare('PRAGMA integrity_check').get())[0], foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length };
} finally { db.close(); }
console.log(JSON.stringify(output, null, 2));
