'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['tools/test-calcio-patch26fc-standalone.js','tools/test-calcio-patch26fc-persistence.js'];
const results = files.map(file => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', file)], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  return { file, ok: run.status === 0, exitCode: run.status };
});
const success = results.every(row => row.ok);
console.log(JSON.stringify({ success, results }, null, 2));
process.exit(success ? 0 : 1);
