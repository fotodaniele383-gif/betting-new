'use strict';
const assert = require('assert');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const runtime = require(path.join(root, 'backend', 'deepScanRuntimeResilience'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    runtime.resetForTests();
    const errors = [];
    for (let i = 0; i < 2; i++) {
        try { await runtime.runProvider('TEST_PROVIDER', async () => { await sleep(50); }, { timeoutMs: 10, failureThreshold: 2, cooldownMs: 1000 }); }
        catch (error) { errors.push(error.code); }
    }
    try { await runtime.runProvider('TEST_PROVIDER', async () => true, { timeoutMs: 10, failureThreshold: 2, cooldownMs: 1000 }); }
    catch (error) { errors.push(error.code); }
    assert.deepStrictEqual(errors, ['PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT', 'PROVIDER_CIRCUIT_OPEN']);
    console.log(JSON.stringify({ success: true, errors, diagnostics: runtime.diagnostics() }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
