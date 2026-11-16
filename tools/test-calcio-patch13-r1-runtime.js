'use strict';
const assert = require('assert');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const runtime = require(path.join(root, 'backend', 'deepScanRuntimeResilience'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    runtime.resetForTests();
    let active = 0, maxActive = 0, executions = 0;
    const jobs = Array.from({ length: 8 }, (_, i) => runtime.runDeepScan({
        eventKey: `multi-${i}`,
        timeoutMs: 2000,
        task: async () => { active++; executions++; maxActive = Math.max(maxActive, active); await sleep(25); active--; return { success: true, i }; }
    }));
    await Promise.all(jobs);
    assert(maxActive <= 2, `maxActive=${maxActive}`);
    const a = runtime.runDeepScan({ eventKey: 'dedupe', timeoutMs: 1000, task: async () => { executions++; await sleep(30); return { success: true, value: 1 }; } });
    const b = runtime.runDeepScan({ eventKey: 'dedupe', timeoutMs: 1000, task: async () => { executions++; return { success: true, value: 2 }; } });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.value, 1); assert.equal(rb.value, 1);
    const partial = await runtime.runDeepScan({ eventKey: 'partial', timeoutMs: 10, task: async () => { await sleep(60); return { success: true }; } });
    assert.equal(partial.status, 'DEEPSCAN_PARZIALE');
    assert.equal(partial.persistence.reason, 'PARTIAL_RESPONSE_NO_DB_MUTATION');
    await sleep(70);
    console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_13_R1', maxActive, executions, partial, diagnostics: runtime.diagnostics() }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
