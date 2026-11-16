'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const results = [];
for (let patch = 1; patch <= 12; patch++) {
    const script = path.join(root, 'tools', `test-calcio-patch${patch}-standalone.js`);
    const run = spawnSync(process.execPath, [script, root], { cwd:root, encoding:'utf8', timeout:120000 });
    results.push({ patch, ok:run.status===0, status:run.status, stdoutTail:(run.stdout||'').slice(-700), stderrTail:(run.stderr||'').slice(-700) });
    assert.equal(run.status, 0, `Regressione Patch ${patch} fallita`);
}
const runtime = spawnSync(process.execPath, [path.join(root,'tools','test-calcio-patch13-r1-runtime.js'), root], { cwd:root, encoding:'utf8', timeout:120000 });
assert.equal(runtime.status, 0, 'Regressione Patch 13 runtime fallita');
const provider = spawnSync(process.execPath, [path.join(root,'tools','test-calcio-patch13-r1-provider-timeout.js'), root], { cwd:root, encoding:'utf8', timeout:120000 });
assert.equal(provider.status, 0, 'Regressione Patch 13 provider timeout fallita');
const patch15 = spawnSync(process.execPath, [path.join(root,'tools','test-calcio-patch15-standalone.js'), root], { cwd:root, encoding:'utf8', timeout:120000 });
assert.equal(patch15.status, 0, 'Verifica Patch 14 invariants + Patch 15 fallita');
const registry = require(path.join(root,'backend','calcioPatchRegistry')).getCalcioPatchStatus();
for (const version of ['13','14','15']) assert(registry.patches.some(row=>row.version===version), `Patch ${version} assente dal registry`);
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_15_STAKE_EXECUTION_DS_GATE_PORTFOLIO_AUDIT', regression:'CALCIO_PATCH_1_15_COMPATIBLE', results, patch13Runtime:runtime.status, patch13ProviderTimeout:provider.status, patch15Standalone:patch15.status }, null, 2));
