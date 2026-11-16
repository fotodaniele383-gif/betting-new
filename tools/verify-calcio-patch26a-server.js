'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname,'..');
const server = fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const registry = require('../backend/calcioPatchRegistry');
const obs = require('../backend/calcioObservability');
const markers = [
  "require('./calcioObservability')",
  'calcioObservability.ensureSchema(db)',
  'startAnalysisBatch(db',
  'completeAnalysisBatch(db',
  'startEventFinalization(db',
  'updateEventPlan(db',
  'completeEventFinalization(db',
  'failEventFinalization(db',
  "/api/calcio/diagnostics/finalization-audit"
];
for (const marker of markers) assert.ok(server.includes(marker), `Marker server mancante: ${marker}`);
assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION,'26');
const patch=registry.PATCHES.find(p=>p.version==='26');
assert.ok(patch);
assert.equal(patch.id,'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE');
assert.equal(patch.stakeAuthorityChanged,false);
assert.equal(patch.marketSelectionAuthorityChanged,false);
assert.equal(patch.footballProbabilityContractChanged,false);
assert.equal(patch.footballUiChanged,false);
assert.equal(patch.newOddsApiCalls,0);
assert.equal(obs.CALCIO_OBSERVABILITY_VERSION,'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_V1');
console.log(JSON.stringify({success:true,patch:patch.id,markers,registry:{version:registry.CALCIO_CURRENT_PATCH_VERSION,id:patch.id},authority:{stake:false,market:false,probability:false,ui:false}},null,2));
