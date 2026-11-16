#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const official = require('./tennisOfficialSettlementResolver');
const settlementContract = require('./tennisSettlementContract');
let paper = null;
const lifecycle = require('./tennisForwardLifecycle');
const cohorts = require('./tennisForwardCohorts');
const historicalPerformance = require('./tennisHistoricalValidationPerformance');

const PATCH = 'TENNIS_PATCH_29_OFFICIAL_SETTLEMENT_RESOLVER_FORWARD_SAMPLE_MATURATION';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const originalConsoleLog = console.log.bind(console);
if (apply) {
  // Keep stdout machine-readable JSON; lifecycle diagnostics remain visible on stderr.
  console.log = (...values) => console.error(...values);
  paper = require('./paperTrading.tennis');
}
const dbArg = process.argv.find(arg => /database_betting\.db$/i.test(arg));
const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function rowsHash(db, sql) { return hash(db.prepare(sql).all()); }
function isTennis(row) { return /TENNIS|ATP|WTA/i.test([row.sport_type, row.league, row.bet_type, row.strategy_tag].filter(Boolean).join(' ')); }
function parseStart(row) {
  const raw = row.canonical_match_datetime || row.match_date;
  const it = String(raw || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})/);
  if (it) return new Date(`${it[3]}-${it[2].padStart(2,'0')}-${it[1].padStart(2,'0')}T${it[4].padStart(2,'0')}:${it[5]}:00`).getTime();
  return new Date(raw).getTime();
}

const db = new DatabaseSync(dbPath);
db.transaction = fn => (...fnArgs) => {
  if (db.inTransaction) return fn(...fnArgs);
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(...fnArgs); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
};

try {
  const operationId = `TENNIS_PATCH29_SETTLEMENT_${Date.now()}`;
  const pending = db.prepare(`SELECT * FROM ai_forward_test
    WHERE status='PENDING' AND COALESCE(paper_result_active,1)=1
    ORDER BY id`).all().filter(isTennis);
  const immutableSql = `SELECT id, match_date, home_team, away_team, prediction, odd, estimated_prob, stake,
    professional_gate_status, tennis_operational_status, gate_status_code, provider_event_id,
    tennis_event_fingerprint, tennis_market_fingerprint, clv_contract_status, clv
    FROM ai_forward_test ORDER BY id`;
  const pendingIdsSql = pending.length ? pending.map(row => Number(row.id)).join(',') : '0';
  const existingResolvedSql = `SELECT * FROM ai_forward_test WHERE id NOT IN (${pendingIdsSql}) ORDER BY id`;
  const immutableBefore = rowsHash(db, immutableSql);
  const existingResolvedBefore = rowsHash(db, existingResolvedSql);
  const clvBefore = rowsHash(db, `SELECT id, clv, clv_contract_status, clv_source_event_id, clv_event_fingerprint FROM ai_forward_test ORDER BY id`);
  const preview = official.buildPreview(pending, { now: Date.now() });
  const candidates = [];
  const blocked = [];
  for (const row of pending) {
    const start = parseStart(row);
    if (Number.isFinite(start) && start > Date.now()) {
      blocked.push({ betId: row.id, reason: 'FUTURE_MATCH' });
      continue;
    }
    const resolution = official.resolveFromSeed(row);
    if (!resolution) {
      blocked.push({ betId: row.id, reason: 'NO_SIGNED_OFFICIAL_EVIDENCE' });
      continue;
    }
    const contract = settlementContract.evaluateTennisSettlementContract(row, resolution, { operationId });
    if (contract.status !== settlementContract.SETTLEMENT_STATES.VERIFIED || contract.autoSettleAllowed !== true) {
      blocked.push({ betId: row.id, reason: `CONTRACT_${contract.status}`, details: contract.reasons });
      continue;
    }
    const evaluation = apply ? paper.evaluateTennisBet(row.prediction, resolution.winner, resolution.totalGames) : 'PREVIEW_EVALUABLE';
    if (evaluation == null) {
      blocked.push({ betId: row.id, reason: 'MARKET_NOT_EVALUABLE' });
      continue;
    }
    candidates.push({ row, resolution, contract, evaluation });
  }

  const applied = [];
  if (apply) {
    for (const item of candidates) {
      const outcome = paper.updateBetSettlement(db, item.row, item.resolution, item.evaluation, { operationId });
      if (!outcome || outcome.updated !== true || outcome.contract?.status !== 'VERIFIED') {
        throw new Error(`PATCH29_SETTLEMENT_APPLY_FAILED:${item.row.id}:${outcome?.contract?.status || 'UNKNOWN'}`);
      }
      const after = db.prepare(`SELECT id,status,profit,settlement_contract_status,settlement_source,
        settlement_winner_name,settlement_score,settlement_source_event_id,settlement_evidence_hash,
        clv_contract_status,clv FROM ai_forward_test WHERE id=?`).get(item.row.id);
      applied.push({ betId: item.row.id, match: `${item.row.home_team} - ${item.row.away_team}`, prediction: item.row.prediction,
        result: after.status, profit: after.profit, source: after.settlement_source, winner: after.settlement_winner_name,
        score: after.settlement_score, clvStatus: after.clv_contract_status, clvValue: after.clv });
    }
  }

  const lifecycleResult = apply ? lifecycle.reconcileForwardLifecycle(db, { apply: true, operationId }) : null;
  const cohortResult = apply ? cohorts.reconcileForwardCohortMaturity(db, { operationId, limit: 100000 }) : null;
  const forwardPerformance = apply ? historicalPerformance.refreshForwardPerformance(db, {
    persist: true, includeEvaluations: true, generatedAt: new Date().toISOString()
  }) : null;
  const immutableAfter = rowsHash(db, immutableSql);
  const existingResolvedAfter = rowsHash(db, existingResolvedSql);
  const clvAfter = rowsHash(db, `SELECT id, clv, clv_contract_status, clv_source_event_id, clv_event_fingerprint FROM ai_forward_test ORDER BY id`);
  const statusCounts = db.prepare(`SELECT status,COUNT(*) count FROM ai_forward_test WHERE sport_type='TENNIS' GROUP BY status ORDER BY status`).all();
  const pendingContractCounts = db.prepare(`SELECT COALESCE(settlement_contract_status,'NULL') status,COUNT(*) count
    FROM ai_forward_test WHERE sport_type='TENNIS' AND status='PENDING' AND COALESCE(paper_result_active,1)=1 GROUP BY settlement_contract_status ORDER BY status`).all();
  const output = {
    success: immutableBefore === immutableAfter && existingResolvedBefore === existingResolvedAfter && clvBefore === clvAfter,
    patch: PATCH,
    mode: apply ? 'APPLY_SIGNED_OFFICIAL_EVIDENCE' : 'READ_ONLY_PREVIEW',
    operationId,
    resolver: official.health(),
    preview,
    candidates: candidates.map(item => ({ betId: item.row.id, match: `${item.row.home_team} - ${item.row.away_team}`,
      prediction: item.row.prediction, winner: item.resolution.winnerName, winnerSide: item.resolution.winner,
      score: item.resolution.score, contractStatus: item.contract.status, sourceEventId: item.contract.sourceEventId })),
    blocked,
    applied,
    counts: { pendingScanned: pending.length, verifiedCandidates: candidates.length, applied: applied.length, blocked: blocked.length,
      statusCounts, pendingContractCounts },
    lifecycle: lifecycleResult ? { success: lifecycleResult.success, repaired: lifecycleResult.repaired, failed: lifecycleResult.failed } : null,
    cohorts: cohortResult ? { scanned: cohortResult.scanned, updated: cohortResult.updated, unchanged: cohortResult.unchanged, blocked: cohortResult.blocked, errors: cohortResult.errors } : null,
    forwardPerformance: forwardPerformance ? {
      mode: forwardPerformance.mode, eligibleRows: forwardPerformance.eligibleRows, coveredRows: forwardPerformance.coveredRows,
      coveragePct: forwardPerformance.coveragePct, metrics: forwardPerformance.metrics, performanceGate: forwardPerformance.performanceGate,
      persistence: forwardPerformance.persistence, authority: forwardPerformance.authority
    } : null,
    safeguards: {
      immutablePredictionFieldsUnchanged: immutableBefore === immutableAfter,
      preExistingResolvedRowsUnchanged: existingResolvedBefore === existingResolvedAfter,
      clvFieldsUnchanged: clvBefore === clvAfter,
      probabilityAuthorityChanged: false,
      qualityGateAuthorityChanged: false,
      stakeAuthorityChanged: false,
      oddsApiCallsAdded: 0
    }
  };
  originalConsoleLog(JSON.stringify(output, null, 2));
  process.exitCode = output.success ? 0 : 1;
} finally {
  db.close();
}
