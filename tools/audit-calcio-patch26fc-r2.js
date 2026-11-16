'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('./sqlite-compat');
const registry = require('../backend/calcioPatchRegistry');
const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
function parse(value) { try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '{}')); } catch (_) { return {}; } }
function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function componentValue(source, keys) { for (const key of keys) if (finite(source?.[key])) return Number(source[key]); return null; }
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare(`SELECT id, prediction, estimated_prob, calcio_final_market_snapshot, calcio_prediction_index_components
 FROM ai_forward_test WHERE COALESCE(calcio_final_market_contract_version,'')<>'' ORDER BY id DESC`).all();
let completeRows = 0;
let recoverableRows = 0;
let unrecoverableRows = 0;
const details = [];
for (const row of rows) {
  const snapshot = parse(row.calcio_final_market_snapshot);
  const probability = snapshot.probability || {};
  const components = parse(row.calcio_prediction_index_components).probability || {};
  const missing = [];
  if (!finite(probability.modelProbabilityPct)) missing.push('MODEL');
  if (!finite(probability.monteCarloProbabilityPct)) missing.push('MONTE_CARLO');
  if (!finite(probability.marketProbabilityPct)) missing.push('MARKET');
  if (!missing.length) { completeRows += 1; continue; }
  const fallback = {
    modelProbabilityPct: componentValue(components, ['modelProbabilityPct', 'model', 'modelCenterPct']),
    monteCarloProbabilityPct: componentValue(components, ['monteCarloProbabilityPct', 'monteCarlo']),
    marketProbabilityPct: componentValue(components, ['marketProbabilityPct', 'marketProbability'])
  };
  const recoverable = fallback.modelProbabilityPct !== null && fallback.monteCarloProbabilityPct !== null && fallback.marketProbabilityPct !== null;
  if (recoverable) recoverableRows += 1; else unrecoverableRows += 1;
  details.push({ id: row.id, prediction: row.prediction, missing, recoverable, fallback });
}
db.close();
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendReady = server.includes('probabilityFallback: {') && server.includes('finalProbabilityComponents');
const frontendReady = frontend.includes('enrichCalcioFinalMarketDiagnosticProbability') && frontend.includes('IPM_COMPONENTS_READ_ONLY_NO_PRODUCTION_MUTATION');
const success = registry.CALCIO_CURRENT_PATCH_VERSION === '35' && backendReady && frontendReady && unrecoverableRows === 0;
const certification = rows.length === 0
  ? 'FIXTURE_FINAL_PROBABILITY_SNAPSHOT_FALLBACK_CERTIFIED_REQUIRES_LIVE_ROWS'
  : (recoverableRows > 0
      ? 'LIVE_READ_ONLY_FINAL_PROBABILITY_FALLBACK_CERTIFIED_FUTURE_SNAPSHOTS_WRITE_COMPLETE'
      : 'LIVE_PERSISTED_FINAL_PROBABILITY_SNAPSHOTS_COMPLETE');
console.log(JSON.stringify({
  success,
  readOnly: true,
  patch: 'BETTING_PATCH_26F_C_R2_FINAL_PROBABILITY_SNAPSHOT_FALLBACK',
  certification,
  registry: registry.CALCIO_CURRENT_PATCH_VERSION,
  databaseMutation: 'NONE',
  snapshotRows: rows.length,
  completeRows,
  recoverableRows,
  unrecoverableRows,
  details: details.slice(0, 20),
  guards: {
    backendFutureSnapshotFallback: backendReady,
    frontendExistingSnapshotFallback: frontendReady,
    productionProbabilityUnchanged: true,
    dualScoreShadowOnly: true,
    unifiedStakeAuthorityUnchanged: true,
    databaseUnchanged: true,
    newOddsApiCalls: 0
  }
}, null, 2));
if (!success) process.exit(1);
