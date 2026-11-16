'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const Database = require('better-sqlite3');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
function state() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return { rows: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0), integrity: db.pragma('integrity_check', { simple: true }) }; }
  finally { db.close(); }
}
const before = state();
const run = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'verify-tennis-patch24-canary.js'), root], { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, BETTING_DB_PATH: dbPath } });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
const after = state();
const config = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tennis_cron_config.json'), 'utf8'));
const result = {
  success: run.status === 0 && before.rows === after.rows && before.integrity === 'ok' && after.integrity === 'ok' && config.schedulerMode === 'PERSISTENT_EXACT_INTERVAL' && Boolean(config.nextRunAt),
  patch: '25',
  liveTournamentRequired: false,
  patch24AtomicCanaryExitCode: run.status,
  countsRestored: before.rows === after.rows,
  integrityBefore: before.integrity,
  integrityAfter: after.integrity,
  schedulerMode: config.schedulerMode,
  nextRunAt: config.nextRunAt,
  rollbackGuaranteed: run.status === 0,
  productionAuthority: false
};
const out = path.join(root, 'audit_patch25'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'patch25_first_match_readiness_canary.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exit(2);
