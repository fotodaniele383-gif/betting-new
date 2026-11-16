'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('./sqlite-compat');
const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fc-r2-fixture-'));
const dbPath = path.join(tempDir, 'fixture.db');
const db = new Database(dbPath);
db.exec(`CREATE TABLE ai_forward_test (
 id INTEGER, prediction TEXT, estimated_prob REAL,
 calcio_final_market_snapshot TEXT,
 calcio_prediction_index_components TEXT,
 calcio_final_market_contract_version TEXT
)`);
const insert = db.prepare(`INSERT INTO ai_forward_test
 (id,prediction,estimated_prob,calcio_final_market_snapshot,calcio_prediction_index_components,calcio_final_market_contract_version)
 VALUES (?,?,?,?,?,?)`);
const missingFixture = [
  [2388, 'U2.5', 62.06, 62.46, 63.67, 58.025],
  [2385, 'U2.5', 59.49, 59.27, 61.31, 56.314],
  [2384, 'U2.5', 52.50, 53.12, 53.65, 48.958],
  [2363, 'O2.5', 54.72, 56.06, 55.74, 50]
];
for (const [id, prediction, finalProb, model, mc, market] of missingFixture) {
  insert.run(id, prediction, finalProb,
    JSON.stringify({ prediction, probabilityPct: finalProb, probability: { finalProbabilityPct: finalProb, modelProbabilityPct: null, monteCarloProbabilityPct: null, marketProbabilityPct: null } }),
    JSON.stringify({ probability: { model, monteCarlo: mc, marketProbability: market } }),
    'BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1');
}
for (let i = 0; i < 6; i += 1) {
  const id = 2300 + i;
  insert.run(id, '1', 50,
    JSON.stringify({ prediction: '1', probabilityPct: 50, probability: { finalProbabilityPct: 50, modelProbabilityPct: 51, monteCarloProbabilityPct: 50.5, marketProbabilityPct: 49 } }),
    JSON.stringify({ probability: { model: 51, monteCarlo: 50.5, marketProbability: 49 } }),
    'BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1');
}
db.close();
const run = spawnSync(process.execPath, [path.join(root, 'tools', 'audit-calcio-patch26fc-r2.js')], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, BETTING_DB_PATH: dbPath },
  maxBuffer: 32 * 1024 * 1024
});
if (run.status !== 0) {
  process.stderr.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  process.exit(run.status || 1);
}
const audit = JSON.parse(String(run.stdout || '').trim());
assert.strictEqual(audit.success, true);
assert.strictEqual(audit.snapshotRows, 10);
assert.strictEqual(audit.completeRows, 6);
assert.strictEqual(audit.recoverableRows, 4);
assert.strictEqual(audit.unrecoverableRows, 0);
assert.strictEqual(audit.databaseMutation, 'NONE');
fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_26F_C_R2_FINAL_PROBABILITY_SNAPSHOT_FALLBACK',
  checks: 6,
  snapshotRows: audit.snapshotRows,
  completeRows: audit.completeRows,
  recoverableRows: audit.recoverableRows,
  unrecoverableRows: audit.unrecoverableRows
}, null, 2));
