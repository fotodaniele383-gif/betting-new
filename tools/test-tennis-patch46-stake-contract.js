#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mod = require('../backend/tennisStakeExecutionContractPatch46');
let checks = 0;
function check(name, fn) { fn(); checks += 1; }
function openDb(file) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file); }

const micro = mod.buildContract({
  betId: 46,
  modelSuggestedStake: 3,
  qualityGate: { code:'APPROVED_WITH_CAP', allowBet:true, stake:{amount:3}, reason:'Gate propone stake.' },
  riskAuthority: { version:'PATCH36', status:'AUTHORIZED_MICRO_SAMPLE_CAP', finalStake:2, reason:'Cap micro.', circuitBreaker:false },
  calibrationGuard: { version:'PATCH39', status:'PASS', finalStake:2, reason:'Calibrazione pass.' },
  finalExecutableStake: 2,
  decidedAt:'2026-08-04T15:00:00.000Z'
});
check('versione Patch46', () => assert.equal(micro.version, mod.VERSION));
check('TPI senza autorità stake', () => assert.equal(micro.tpi.stakeAuthority, false));
check('stadi distinti', () => assert.deepStrictEqual([micro.modelSuggestion.role,micro.qualityGate.role,micro.riskAuthority.role,micro.calibrationGuard.role], ['NON_EXECUTABLE_PROPOSAL','PROPOSAL_AND_CAP_AUTHORITY','RISK_CAP_AUTHORITY','FINAL_REDUCTION_GUARD']));
check('finale micro eseguibile', () => assert.equal(micro.finalExecution.status, 'EXECUTABLE_MICRO_STAKE'));
check('unica autorità finale Patch46', () => assert.equal(micro.finalExecution.authority, mod.FINAL_AUTHORITY));
check('nessun aumento', () => assert(Object.values(micro.invariants).every(Boolean)));

const blockedCalibration = mod.buildContract({
  betId: 47, modelSuggestedStake:2,
  qualityGate:{code:'WATCHLIST_MICRO',allowBet:true,stake:{amount:2}},
  riskAuthority:{status:'AUTHORIZED_MICRO_SAMPLE_CAP',finalStake:2},
  calibrationGuard:{status:'BLOCKED_OVERCONFIDENCE',finalStake:0,reason:'Banda non calibrata.'},
  finalExecutableStake:0
});
check('guard calibrazione blocca finale', () => assert.equal(blockedCalibration.finalExecution.status, 'BLOCKED_BY_CALIBRATION_GUARD'));

const wta = mod.buildContract({
  betId: 48, modelSuggestedStake:2,
  qualityGate:{code:'APPROVED_WITH_CAP',allowBet:true,stake:{amount:2}},
  riskAuthority:{status:'PAPER_ONLY_WTA_TECHNICAL_DATA_STALE',finalStake:0,circuitBreaker:true,reason:'WTA stale.'},
  calibrationGuard:{status:'PASS',finalStake:0}, finalExecutableStake:0
});
check('WTA stale paper only', () => assert.equal(wta.finalExecution.status, 'PAPER_ONLY_RISK_GUARD'));

check('aumento illecito rifiutato', () => assert.throws(() => mod.buildContract({
  betId:49,modelSuggestedStake:1,qualityGate:{allowBet:true,stake:{amount:1}},riskAuthority:{status:'PASS',finalStake:1},calibrationGuard:{status:'PASS',finalStake:1},finalExecutableStake:2
}), /TENNIS_PATCH46_STAKE_CONTRACT_INVARIANT_FAILED/));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'tp46-contract-'));
const dbPath = path.join(tmp,'test.db');
const db = openDb(dbPath);
db.exec('CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY, sport_type TEXT, status TEXT, stake REAL)');
mod.ensureSchema(db);
const first = mod.persistSnapshot(db, micro);
const second = mod.persistSnapshot(db, micro);
check('snapshot inserito', () => assert.equal(first.inserted,true));
check('snapshot idempotente', () => assert.equal(second.inserted,false));
check('una sola riga snapshot', () => assert.equal(Number(db.prepare(`SELECT COUNT(*) n FROM ${mod.SNAPSHOT_TABLE}`).get().n),1));
check('snapshot immutabile update', () => assert.throws(() => db.prepare(`UPDATE ${mod.SNAPSHOT_TABLE} SET final_executable_stake=0 WHERE snapshot_id=?`).run(micro.snapshotId), /TENNIS_PATCH46_STAKE_CONTRACT_APPEND_ONLY/));
check('snapshot immutabile delete', () => assert.throws(() => db.prepare(`DELETE FROM ${mod.SNAPSHOT_TABLE} WHERE snapshot_id=?`).run(micro.snapshotId), /TENNIS_PATCH46_STAKE_CONTRACT_APPEND_ONLY/));
db.close(); fs.rmSync(tmp,{recursive:true,force:true});
console.log(JSON.stringify({success:true,patch:'46',checks},null,2));
