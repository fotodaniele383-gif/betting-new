'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const suites = [
    'tools/test-calcio-patch1-standalone.js',
    'tools/test-calcio-patch2-standalone.js',
    'tools/test-calcio-patch3-standalone.js',
    'tools/test-calcio-patch4-standalone.js',
    'tools/test-calcio-patch5-standalone.js',
    'tools/test-calcio-patch6-standalone.js',
    'tools/test-calcio-patch7-standalone.js',
    'tools/test-calcio-patch8-standalone.js',
    'tools/test-calcio-patch9-standalone.js',
    'tools/test-calcio-patch12-standalone.js',
    'tools/test-calcio-patch26a-standalone.js',
    'tools/test-calcio-patch26b-standalone.js',
    'tools/test-calcio-patch26c-standalone.js'
].filter(file => fs.existsSync(path.join(root, file)));
const results = suites.map(file => {
    const result = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    return { file, ok: result.status === 0, status: result.status, stderr: (result.stderr || '').slice(-2000), stdout: (result.stdout || '').slice(-2000) };
});
assert.ok(results.every(row => row.ok), JSON.stringify(results.filter(row => !row.ok), null, 2));
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY', compatibleSuites: results.length, results: results.map(row => ({ file: row.file, ok: row.ok })) }, null, 2));
