#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveProjectRoot } = require('./patch52-cli');
const root = resolveProjectRoot();
const stateFile = path.join(root, '.tennis_patch52_r2_state.json');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mkdir = dir => fs.mkdirSync(dir, { recursive: true });
const rm = target => { if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); };
function copy(source, target) {
  mkdir(path.dirname(target));
  const temp = `${target}.patch52-r2-rollback-${process.pid}.tmp`;
  fs.copyFileSync(source, temp);
  rm(target);
  fs.renameSync(temp, target);
}
try {
  if (!fs.existsSync(stateFile)) throw new Error('PATCH52_R2_STATE_FILE_MISSING');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const rel of [...state.targets].reverse()) {
    const destination = path.join(root, rel);
    const backup = path.join(state.backup, 'files', rel);
    if (state.existed[rel]) copy(backup, destination); else rm(destination);
  }
  const db = path.join(root, 'backend', 'database_betting.db');
  rm(`${db}-wal`); rm(`${db}-shm`);
  if (state.databaseBackup) copy(state.databaseBackup, db);
  rm(`${db}-wal`); rm(`${db}-shm`);
  const dbSha = sha(db);
  if (state.databaseBeforeSha256 && dbSha !== state.databaseBeforeSha256) throw new Error(`PATCH52_R2_ROLLBACK_DB_HASH_MISMATCH:${dbSha}:${state.databaseBeforeSha256}`);

  const runtimeState = state.runtimeStatePath;
  if (runtimeState) {
    if (state.runtimeStateExisted) copy(state.runtimeStateBackup, runtimeState); else rm(runtimeState);
    const actualRuntimeSha = fs.existsSync(runtimeState) ? sha(runtimeState) : null;
    if ((state.runtimeStateBeforeSha256 || null) !== actualRuntimeSha) throw new Error(`PATCH52_R2_ROLLBACK_RUNTIME_STATE_HASH_MISMATCH:${actualRuntimeSha}:${state.runtimeStateBeforeSha256}`);
  }
  const wtaPath = state.wtaPath;
  const wtaSha = wtaPath && fs.existsSync(wtaPath) ? sha(wtaPath) : null;
  if ((state.wtaBeforeSha256 || null) !== wtaSha) throw new Error(`PATCH52_R2_ROLLBACK_WTA_HASH_MISMATCH:${wtaSha}:${state.wtaBeforeSha256}`);
  rm(stateFile);
  console.log(JSON.stringify({
    success: true,
    patch: state.patch,
    revision: state.revision,
    packageVersion: '21.39.0',
    tennisRegistry: '52',
    databaseSha256: dbSha,
    runtimeStateSha256: state.runtimeStateBeforeSha256 || null,
    wtaSha256: wtaSha,
    stateRemoved: true
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error.stack || error.message }, null, 2));
  process.exit(1);
}
