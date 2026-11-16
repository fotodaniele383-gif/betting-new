'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PATCH = 'TENNIS_PATCH_26_CANONICAL_PLAYER_EVIDENCE_BRIDGE_WTA_CURRENT_PROFILE_RECOVERY';
const arg = process.argv.indexOf('--root');
const root = path.resolve(arg >= 0 && process.argv[arg + 1] ? process.argv[arg + 1] : '.');
const statePath = path.join(root, '.tennis_patch26_state.json');
const dbPath = path.join(root, 'backend', 'database_betting.db');

function sha(file) { return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null; }
function copy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function removeSafe(file) {
  for (let i = 0; i < 8; i += 1) {
    try { if (fs.existsSync(file)) fs.rmSync(file, { force: true, recursive: false }); return; }
    catch (error) {
      if (!['EPERM','EBUSY','EACCES'].includes(error.code) || i === 7) throw error;
      const until = Date.now() + 60 * (i + 1); while (Date.now() < until) {}
    }
  }
}
function tennisRegistry() {
  const file = path.join(root, 'backend', 'tennisPatchRegistry.js');
  delete require.cache[require.resolve(file)];
  return String(require(file).TENNIS_CURRENT_PATCH_VERSION || '');
}

try {
  if (!fs.existsSync(statePath)) throw new Error('PATCH26_ROLLBACK_STATE_NOT_FOUND');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.patch !== PATCH) throw new Error(`PATCH26_ROLLBACK_STATE_INVALID:${state.patch}`);
  for (const rel of [...state.targets].reverse()) {
    const dst = path.join(root, rel);
    const src = path.join(state.backup, 'files', rel);
    if (state.existed[rel]) {
      if (!fs.existsSync(src)) throw new Error(`PATCH26_ROLLBACK_BACKUP_MISSING:${rel}`);
      copy(src, dst);
    } else removeSafe(dst);
  }
  removeSafe(dbPath);
  removeSafe(`${dbPath}-wal`);
  removeSafe(`${dbPath}-shm`);
  copy(path.join(state.backup, 'database_betting.db'), dbPath);
  for (const suffix of ['-wal','-shm']) {
    const src = path.join(state.backup, `database_betting.db${suffix}`);
    if (state.dbSidecars?.[suffix] && fs.existsSync(src)) copy(src, `${dbPath}${suffix}`);
  }
  removeSafe(statePath);
  const dbAfter = sha(dbPath);
  const registryAfter = tennisRegistry();
  const success = dbAfter === state.dbBefore && registryAfter === String(state.registryBefore);
  console.log(JSON.stringify({ success, patch: PATCH, rollback: 'PATCH26_TO_PATCH25', registryAfter, expectedRegistry: String(state.registryBefore), databaseRestored: dbAfter === state.dbBefore, databaseHash: dbAfter, backupDir: path.relative(root, state.backup) }, null, 2));
  if (!success) process.exit(1);
} catch (error) {
  console.error(JSON.stringify({ success: false, patch: PATCH, error: error.message }, null, 2));
  process.exit(1);
}
