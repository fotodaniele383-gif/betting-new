'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const historical = require('../backend/tennisHistoricalCombinationEvidence');
const registry = require('../backend/tennisPatchRegistry');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(__dirname, '..');

assert.ok(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 13);
assert.strictEqual(registry.TENNIS_PATCH_REGISTRY_VERSION, `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`);
assert.ok(registry.PATCHES.some(p => p.version === '12' && String(p.status).startsWith('ACTIVE')));
assert.ok(registry.PATCHES.some(p => p.version === '13' && String(p.status).startsWith('ACTIVE')));

const rows = [
  {id:1,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',data_quality:'CURRENT_BOOTSTRAP',status:'WON',ds_action:'RISCHIO MODELLO',quality_final_code:'WATCHLIST_MICRO',stake:2,profit:1.6,match_date:'2026-06-01T12:00:00Z'},
  {id:2,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',data_quality:'CURRENT_BOOTSTRAP',status:'LOST',ds_action:'RISCHIO MODELLO',quality_final_code:'WATCHLIST_MICRO',stake:2,profit:-2,match_date:'2026-06-02T12:00:00Z'},
  {id:3,sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',data_quality:'CURRENT_BOOTSTRAP',status:'WON',ds_action:'RISCHIO MODELLO',quality_final_code:'WATCHLIST_MICRO',stake:0,profit:0,match_date:'2026-06-03T12:00:00Z'}
];
const evidence = historical.buildCombinationEvidenceFromRows(rows, { deepScan:{action:'RISCHIO MODELLO'}, qualityDecision:{code:'WATCHLIST_MICRO'} }, { calculatedAt:'2026-07-01T00:00:00Z' });
assert.strictEqual(evidence.resolved,3);
assert.strictEqual(evidence.winRatePct,66.67);
assert.strictEqual(evidence.stakeAuthority,false);
assert.strictEqual(evidence.currentResultUsed,false);
assert.ok(evidence.evidenceHash.match(/^[a-f0-9]{64}$/));
assert.ok(evidence.ci95LowPct < evidence.winRatePct && evidence.ci95HighPct > evidence.winRatePct);

const server = fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const app = fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
assert.ok(server.includes("router.get('/historical-combination-evidence'"));
assert.ok(server.includes("router.get('/program-progression-health'"));
assert.ok(server.includes('HISTORICAL_COMBINATION_RATE_SNAPSHOT'));
assert.ok(app.includes('renderHistoricalCombinationEvidenceCell'));
assert.ok(app.includes('loadTennisProgramProgression'));
assert.ok(html.includes('WR storico DS×Gate') && html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`));
assert.deepStrictEqual(progression.duplicateHtmlIds(html),[]);
assert.strictEqual(fs.readFileSync(path.join(root,'public/app.js'),'utf8'),fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8'));
assert.strictEqual(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8'));
console.log('PATCH13 standalone PASS: empirical DS×Gate win rate, sample/CI/reliability, no stake authority, UI and progression linkage.');
