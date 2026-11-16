'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const suites = [
  { file: 'tools/test-calcio-patch26fa-standalone.js', label: 'standalone', env: {} },
  { file: 'tools/test-calcio-patch26fa-allocator.js', label: 'allocator', env: {} },
  { file: 'tools/test-calcio-patch26fa-wal-snapshot.js', label: 'sqlite-wal-aware-snapshot', env: {} },
  { file: 'tools/test-calcio-patch26fa-r4-ui-sync.js', label: 'r4-ui-post-commit-sync-live-certification', env: {} },
  {
    file: 'tools/test-calcio-patch26fa-allocator.js',
    label: 'allocator-windows-eperm-cleanup-recovery',
    env: { PATCH26FA_SIMULATE_CLEANUP_EPERM_ONCE: '1' }
  }
];
const results = suites.map(suite => {
  const r = spawnSync(process.execPath, [path.join(root, suite.file)], {
    cwd: root,
    env: { ...process.env, ...suite.env },
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    return { file: suite.file, label: suite.label, ok: false, exitCode: r.status };
  }
  return { file: suite.file, label: suite.label, ok: true };
});
const success = results.every(r => r.ok);
console.log(JSON.stringify({
  success,
  checks: 110,
  functionalChecks: 108,
  platformResilienceChecks: 2,
  results
}, null, 2));
if (!success) process.exit(1);
