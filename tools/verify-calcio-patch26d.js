'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const suites = [
    'tools/test-calcio-patch26d-standalone.js',
    'tools/verify-calcio-patch26d-server.js',
    'tools/verify-calcio-patch26d-frontend.js',
    'tools/verify-calcio-patch26d-db.js',
    'tools/verify-calcio-patch26d-regression.js'
];
const results = suites.map(file => {
    const result = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    return { file, ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
});
if (!results.every(row => row.ok)) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY', failed: results.filter(row => !row.ok) }, null, 2));
    process.exit(1);
}
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY', verification: '5/5 PASS', suites: results.map(row => ({ file: path.basename(row.file), ok: true })) }, null, 2));
