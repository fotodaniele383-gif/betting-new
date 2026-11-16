#!/usr/bin/env node
'use strict';

const path = require('path');
const Module = require('module');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const root = path.resolve(arg('--root') || '.');
const betId = Number(arg('--bet-id'));
const apply = process.argv.includes('--apply');
const allowUnverified = process.argv.includes('--allow-unverified');

function fail(code, details = {}) {
  console.log(JSON.stringify({ success: false, code, patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY', ...details }, null, 2));
  process.exit(1);
}
if (!(betId > 0)) fail('PATCH45_BET_ID_REQUIRED', { usage: 'npm run recover:tennis:clv:patch45 -- --bet-id 2443 [--apply] [--allow-unverified]' });

let db;
try {
  const localRequire = Module.createRequire(path.join(root, 'package.json'));
  const BetterSqlite3 = localRequire('better-sqlite3');
  db = new BetterSqlite3(path.join(root, 'backend', 'database_betting.db'));
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(root, 'backend', 'database_betting.db'), { open: true });
  db = {
    prepare: sql => raw.prepare(sql), exec: sql => raw.exec(sql), close: () => raw.close(),
    get inTransaction() { return raw.isTransaction; },
    transaction(fn) { return () => { raw.exec('BEGIN IMMEDIATE'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { try { raw.exec('ROLLBACK'); } catch (_) {} throw e; } }; }
  };
}

try {
  const tracker = require(path.join(root, 'backend', 'clvTracker.js'));
  const contract = require(path.join(root, 'backend', 'tennisClvContract.js'));
  const row = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(betId);
  if (!row) fail('PATCH45_BET_NOT_FOUND', { betId });
  if (String(row.sport_type || '').toUpperCase() !== 'TENNIS') fail('PATCH45_NOT_TENNIS', { betId, sportType: row.sport_type });

  const vaultHit = tracker.getOddsFromVaultRecord(db, row.home_team, row.away_team, true, row.match_date);
  if (!vaultHit?.record || !Array.isArray(vaultHit.bookmakers) || !vaultHit.bookmakers.length) {
    fail('PATCH45_VAULT_EVIDENCE_NOT_FOUND', { betId, home: row.home_team, away: row.away_team });
  }
  const closingOdd = tracker.getClosingOddForBet(vaultHit.bookmakers, row);
  if (!(closingOdd > 1)) fail('PATCH45_VAULT_CLOSING_ODD_NOT_FOUND', { betId, vaultRecordId: vaultHit.record.id });

  const phase = tracker.classifyClvWindow(row.match_date, new Date()).phase;
  const source = phase === 'POST_MATCH_VAULT_ONLY' ? 'POST_MATCH_VAULT' : 'INTERNAL_VAULT';
  const preview = contract.evaluateTennisClvContract({
    ...row,
    opening_odd: row.odd,
    closing_odd: closingOdd,
    clv_source: source,
    closing_odd_side: row.prediction,
    bookmakers: vaultHit.bookmakers,
    opening_ts: vaultHit.record.opening_ts ?? row.clv_opening_ts ?? row.created_at,
    closing_ts: vaultHit.record.closing_ts,
    source_event_id: row.provider_event_id || vaultHit.record.id,
    clv_point_line: row.point_line
  });

  if (apply && preview.verified !== 1 && !allowUnverified) {
    fail('PATCH45_UNVERIFIED_APPLY_REQUIRES_EXPLICIT_FLAG', {
      betId, preview, usage: `npm run recover:tennis:clv:patch45 -- --bet-id ${betId} --apply --allow-unverified`
    });
  }

  let updatedCount = 0;
  if (apply) updatedCount = tracker.updateBetsFromVault(db, [row], source);
  Promise.resolve(updatedCount).then(async value => {
    const resolved = await value;
    const after = db.prepare('SELECT id, opening_odd, closing_odd, clv_pct, clv_source, clv_verified, clv_contract_status, clv_contract_reason, clv_opening_ts, clv_closing_ts, clv_source_event_id, clv_last_attempt_result, clv_pending_reason FROM ai_forward_test WHERE id = ?').get(betId);
    console.log(JSON.stringify({
      success: true,
      patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
      mode: apply ? 'APPLY_EXISTING_VAULT_ONLY' : 'DRY_RUN_EXISTING_VAULT_ONLY',
      networkCalls: 0,
      betId,
      match: `${row.home_team} - ${row.away_team}`,
      vaultRecordId: vaultHit.record.id,
      vaultOpeningTs: vaultHit.record.opening_ts,
      vaultClosingTs: vaultHit.record.closing_ts,
      closingOdd,
      source,
      preview,
      updatedCount: Number(resolved || 0),
      after: apply ? after : null
    }, null, 2));
    db.close();
  }).catch(error => fail('PATCH45_RECOVERY_FAILED', { betId, error: error.stack || error.message }));
} catch (error) {
  try { db.close(); } catch (_) {}
  fail('PATCH45_RECOVERY_FAILED', { betId, error: error.stack || error.message });
}
