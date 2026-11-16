'use strict';
const path=require('path'); const {spawnSync}=require('child_process'); const assert=require('assert');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')); const results=[];
function run(script,args=[]){const r=spawnSync(process.execPath,[path.join(root,script),root,...args],{cwd:root,encoding:'utf8',timeout:180000}); const item={script,ok:r.status===0,status:r.status,stdoutTail:(r.stdout||'').slice(-900),stderrTail:(r.stderr||'').slice(-900)}; results.push(item); assert.equal(r.status,0,`Regression failed: ${script}`);}
for(const patch of [1,2,3,4,5,6,7,8,9,11,12]) run(`tools/test-calcio-patch${patch}-standalone.js`);
run('tools/test-calcio-patch13-r1-runtime.js');
run('tools/test-calcio-patch13-r1-provider-timeout.js');
// Patch 14/15 stake tests contained the superseded rule “SOFT/EARLY always €0”.
// Their surviving invariants (Kelly threshold, minimum €2, hard veto, DS×Gate table,
// frontend mirror and no new Odds calls) are re-certified by Patch 16 standalone.
run('tools/test-calcio-patch16-standalone.js');
run('tools/test-calcio-patch16-migration.js');
const registry=require(path.join(root,'backend','calcioPatchRegistry')).getCalcioPatchStatus();
for(const version of Array.from({length:16},(_,i)=>String(i+1))) assert(registry.patches.some(row=>row.version===version),`Patch ${version} missing from registry`);
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_RECONCILIATION',regression:'CALCIO_PATCH_1_16_COMPATIBLE',results,intentionalSupersession:['PATCH10_EARLY_ALWAYS_ZERO_RULE','PATCH14/15_SOFT_EARLY_ZERO_RULE'],registryVersions:registry.patches.map(row=>row.version)},null,2));
