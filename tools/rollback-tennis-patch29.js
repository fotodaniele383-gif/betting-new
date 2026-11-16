#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : '.');

const candidates = [
  { revision: 'R3', state: '.tennis_patch29_r3_state.json', script: 'tools/rollback-tennis-patch29-r3.js' },
  { revision: 'R2', state: '.tennis_patch29_r2_state.json', script: 'tools/rollback-tennis-patch29-r2.js' },
  { revision: 'R1', state: '.tennis_patch29_r1_state.json', script: 'tools/rollback-tennis-patch29-r1.js' }
];

if (fs.existsSync(path.join(root, '.tennis_patch30_state.json'))) {
  console.log(JSON.stringify({
    success: false,
    code: 'PATCH30_DEPENDENCY_ACTIVE',
    message: 'Rollback Patch 29 bloccato: eseguire prima npm run rollback:tennis:patch30.',
    root
  }, null, 2));
  process.exit(1);
}

const selected = candidates.find(candidate => fs.existsSync(path.join(root, candidate.state)));
if (!selected) {
  console.log(JSON.stringify({
    success: false,
    code: 'PATCH29_STATE_NOT_FOUND',
    message: 'Nessuno stato Patch 29 R1/R2/R3 disponibile per il rollback.',
    checkedStates: candidates.map(candidate => candidate.state),
    root
  }, null, 2));
  process.exit(1);
}

const scriptPath = path.join(root, selected.script);
if (!fs.existsSync(scriptPath)) {
  console.log(JSON.stringify({
    success: false,
    code: 'PATCH29_ROLLBACK_TARGET_MISSING',
    revision: selected.revision,
    script: selected.script,
    root
  }, null, 2));
  process.exit(1);
}

const result = childProcess.spawnSync(process.execPath, [scriptPath, '--root', root], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(Number.isInteger(result.status) ? result.status : 1);
