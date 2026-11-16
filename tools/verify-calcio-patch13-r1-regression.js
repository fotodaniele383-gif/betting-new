'use strict';
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const results = [];
for (let patch = 1; patch <= 12; patch++) {
    const rel = `tools/test-calcio-patch${patch}-standalone.js`;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        results.push({ patch, ok: false, error: `${rel} mancante` });
        continue;
    }
    const run = cp.spawnSync(process.execPath, [file, root], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, CI: '1', BETTING_PATCH13_R1_REGRESSION: '1' }
    });
    results.push({ patch, ok: run.status === 0, status: run.status, stdoutTail: String(run.stdout || '').slice(-1200), stderrTail: String(run.stderr || '').slice(-1200) });
    if (run.status !== 0) break;
}
const success = results.length === 12 && results.every(row => row.ok);
console.log(JSON.stringify({ success, patch: 'BETTING_PATCH_13_R1', regression: 'CALCIO_PATCH_1_12', results }, null, 2));
if (!success) process.exit(1);
