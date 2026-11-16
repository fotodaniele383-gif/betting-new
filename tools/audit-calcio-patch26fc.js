'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const registry = require('../backend/calcioPatchRegistry');
const run = spawnSync(process.execPath, [path.join(__dirname, 'audit-calcio-dual-score.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: process.env, maxBuffer: 128 * 1024 * 1024 });
if (run.status !== 0) {
  if (run.stdout) process.stderr.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  process.exit(1);
}
let audit = {};
try { audit = JSON.parse(String(run.stdout || '').trim()); } catch (error) { console.error(run.stdout); throw error; }
const success = audit.success === true && registry.CALCIO_CURRENT_PATCH_VERSION === '35' && registry.PATCHES.at(-1)?.id === 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW';
console.log(JSON.stringify({
  success,
  patch: 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW',
  certification: audit.certification,
  registry: { version: registry.CALCIO_CURRENT_PATCH_VERSION, id: registry.PATCHES.at(-1)?.id },
  mode: audit.mode,
  fixture: audit.fixture,
  persisted: audit.persisted,
  guards: audit.guards,
  nextStep: audit.persisted?.rows > 0
    ? 'COLLECT_SHADOW_CALIBRATION_THEN_PROCEED_TO_PATCH_26F_D_PAPER_TRADING_CALIBRATION_LEDGER'
    : 'RESTART_SERVER_CTRL_F5_RUN_ONE_FRESH_CALCIO_ANALYSIS_THEN_AUDIT_DUAL_SCORE'
}, null, 2));
process.exit(success ? 0 : 1);
