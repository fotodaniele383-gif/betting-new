#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.resolve(__dirname,'..');
for(const rel of ['backend/deepScanTennis.js','backend/tennisForwardCohorts.js','backend/server.tennis.js','backend/tennisPatchRegistry.js','backend/migrateTennisPatch27.js']){
 const r=cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'});assert.equal(r.status,0,`${rel}: ${r.stderr}`);
}
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
assert.ok(server.includes("router.get('/deepscan-performance-health'"));
assert.ok(server.includes('runPatch27CohortDerivedStateReconcile'));
console.log(JSON.stringify({success:true,checks:7},null,2));
