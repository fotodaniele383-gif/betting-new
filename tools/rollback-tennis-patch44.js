#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PATCH = 'TENNIS_PATCH_44_TRADING_DOM_ATOMIC_WRAP_FORWARD_COMPLETION_GUARD';
const index = process.argv.indexOf('--root');
const root = path.resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : '.');
const statePath = path.join(root, '.tennis_patch44_state.json');

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function remove(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function fail(code, details = {}) {
  console.log(JSON.stringify({ success: false, code, ...details }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(statePath)) {
  fail('PATCH44_STATE_NOT_FOUND', { stateFile: statePath });
}

let state;
try {
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (error) {
  fail('PATCH44_STATE_UNREADABLE', { error: error.message });
}

if (state.patch !== PATCH || !Array.isArray(state.targets) || !state.backup) {
  fail('PATCH44_STATE_INVALID');
}

try {
  for (const relativePath of [...state.targets].reverse()) {
    const destination = path.join(root, relativePath);
    const backupFile = path.join(state.backup, 'files', relativePath);
    if (state.existed?.[relativePath]) {
      if (!fs.existsSync(backupFile)) {
        throw new Error(`Backup mancante per ${relativePath}`);
      }
      copyFile(backupFile, destination);
    } else {
      remove(destination);
    }
  }

  for (const relativePath of state.generatedPaths || []) {
    remove(path.join(root, relativePath));
  }

  remove(statePath);

  console.log(JSON.stringify({
    success: true,
    patch: state.patch,
    restoredPackageVersion: state.packageBefore,
    restoredTennisRegistry: state.tennisRegistryBefore,
    databaseRestored: false,
    databasePolicy: 'PATCH44_NEVER_WRITES_OR_RESTORES_DATABASE',
    dependenciesRestoredFromBackup: true,
    backup: state.backup
  }, null, 2));
} catch (error) {
  fail('PATCH44_ROLLBACK_FAILED', { error: error.message, backup: state.backup });
}
