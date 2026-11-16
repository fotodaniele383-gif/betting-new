'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const results = [];
for (let patch = 1; patch <= 12; patch++) {
    const script = path.join(root, 'tools', `test-calcio-patch${patch}-standalone.js`);
    const run = spawnSync(process.execPath, [script, root], { cwd: root, encoding: 'utf8', timeout: 120000 });
    results.push({ patch, ok: run.status === 0, status: run.status, stdoutTail: (run.stdout || '').slice(-500), stderrTail: (run.stderr || '').slice(-500) });
    assert.equal(run.status, 0, `Regressione Patch ${patch} fallita`);
}
const runtime = spawnSync(process.execPath, [path.join(root, 'tools', 'test-calcio-patch13-r1-runtime.js'), root], { cwd: root, encoding: 'utf8', timeout: 120000 });
assert.equal(runtime.status, 0, 'Regressione Patch 13 runtime fallita');
const provider = spawnSync(process.execPath, [path.join(root, 'tools', 'test-calcio-patch13-r1-provider-timeout.js'), root], { cwd: root, encoding: 'utf8', timeout: 120000 });
assert.equal(provider.status, 0, 'Regressione Patch 13 provider timeout fallita');
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry')).getCalcioPatchStatus();
assert(registry.patches.some(row => row.version === '13' && row.id === 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE'), 'Patch 13 assente dal registry');
assert(registry.patches.some(row => row.version === '14' && row.id === 'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE'), 'Patch 14 assente dal registry');
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE', regression:'CALCIO_PATCH_1_13', results, patch13Runtime:runtime.status, patch13ProviderTimeout:provider.status }, null, 2));
