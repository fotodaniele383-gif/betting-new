'use strict';
const assert=require('assert');
const {DatabaseSync}=require('node:sqlite');
const clv=require('../backend/tennisClvSnapshotCoveragePatch39');
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,odd REAL,opening_odd REAL,stake REAL,match_date TEXT,canonical_match_datetime TEXT,tennis_event_fingerprint TEXT,provider_event_id TEXT);');
const now=new Date('2026-08-04T10:00:00Z');
const rows=[
{id:1,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS_CR',odd:1.8,stake:2,canonical_match_datetime:'2026-08-04T12:00:00Z',tennis_event_fingerprint:'E1'},
{id:2,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS_CR',odd:1.6,stake:0,canonical_match_datetime:'2026-08-04T10:20:00Z',tennis_event_fingerprint:'E2'},
{id:3,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS_CR',odd:1.7,stake:0,canonical_match_datetime:'2026-08-03T10:00:00Z',tennis_event_fingerprint:'E3'}];
assert.equal(clv.ensureFirstSeenSnapshots(db,rows,{now}),2);
assert.equal(clv.ensureFirstSeenSnapshots(db,rows,{now}),0);
const due=clv.selectAuditCandidates(db,rows,{now});
assert.ok(due.execution.some(x=>x.row.id===1));
assert.ok(due.execution.some(x=>x.row.id===2));
assert.equal(clv.checkpointFor(rows[2],now).status,'NOT_DUE');
assert.equal(clv.shouldFinalizeClosing(clv.CHECKPOINTS.T2H),false);
assert.equal(clv.shouldFinalizeClosing(clv.CHECKPOINTS.T20M),true);
assert.equal(clv.coverageHealth(db).retroactiveReconstruction,false);
console.log(JSON.stringify({success:true,checks:8,snapshots:clv.coverageHealth(db).totalSnapshots,due:due.execution.length}));
