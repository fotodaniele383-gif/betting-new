'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const suites = [
    'tools/test-calcio-patch26c-standalone.js',
    'tools/verify-calcio-patch26c-server.js',
    'tools/verify-calcio-patch26c-frontend.js',
    'tools/verify-calcio-patch26c-db.js',
    'tools/verify-calcio-patch26c-regression.js'
];
const results = suites.map(file => {
    const r = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    return { file, ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
});
if (!results.every(row => row.ok)) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI', failed: results.filter(row => !row.ok).map(row => ({ file: row.file, stderr: row.stderr, stdout: row.stdout })) }, null, 2));
    process.exit(1);
}
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI', verification: '5/5 PASS', suites: results.map(row => ({ file: path.basename(row.file), ok: true })) }, null, 2));
