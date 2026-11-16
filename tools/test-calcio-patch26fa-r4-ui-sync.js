'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const Database = require('./sqlite-compat');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `Funzione ${name} assente`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let signatureQuote = null;
  let signatureEscaped = false;
  let brace = -1;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (char === '\\') signatureEscaped = true;
      else if (char === signatureQuote) signatureQuote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { signatureQuote = char; continue; }
    if (char === '(') parenDepth += 1;
    if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { brace = source.indexOf('{', index); break; }
    }
  }
  assert(brace >= 0, `Corpo funzione ${name} assente`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Chiusura funzione ${name} non trovata`);
}

const functionNames = [
  'parseCalcioFinalMarketDiagnosticCandidate',
  'calcioFinalMarketDiagnosticCandidateScore',
  'synchronizeCalcioFinalMarketDiagnosticAliases',
  'getCalcioFinalMarketDiagnostic'
];
const context = {
  safeString: value => String(value ?? '').trim(),
  safeNumber: (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  Date,
  JSON,
  Number,
  Math
};
vm.createContext(context);
vm.runInContext(`${functionNames.map(name => extractFunction(appSource, name)).join('\n')}\nthis.resolveDiagnostic = getCalcioFinalMarketDiagnostic;`, context);

const finalSnapshot = {
  generatedAt: '2026-07-27T16:53:30.000Z',
  marketId: 'CALCIO_MARKET_GENOA_U25',
  prediction: 'U2.5',
  probabilityPct: 62.06,
  probability: { modelProbabilityPct: 62.46, monteCarloProbabilityPct: 63.67, marketProbabilityPct: 58.03 },
  dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 79.8 },
  stake: { modelStake: 4.13, reliabilityStake: 0, finalOperationalStake: 0 },
  decisionState: { code: 'EARLY_RECHECK', label: 'EARLY RECHECK' },
  coherence: { certified: true, status: 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED' }
};
const staleSnapshot = {
  generatedAt: '2026-07-27T16:52:58.000Z',
  marketId: 'CALCIO_MARKET_GENOA_U25',
  prediction: 'U2.5',
  probabilityPct: 62.06,
  dataQuality: { status: 'N/D' },
  stake: { modelStake: 0, reliabilityStake: 0, finalOperationalStake: 0 },
  decisionState: { code: 'EARLY_RECHECK', label: 'EARLY RECHECK' },
  coherence: { certified: true, status: 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED' }
};
const bet = {
  calcio_final_market_snapshot: JSON.stringify(finalSnapshot),
  calcio_final_market_id: finalSnapshot.marketId,
  calcio_decision_state: 'EARLY_RECHECK',
  calcio_data_quality_status: 'DATA_QUALITY_LIMITED',
  calcio_stake_authority_model_stake: 4.13,
  calcio_stake_authority_reliability_stake: 0,
  calcio_stake_authority_final_stake: 0,
  calcio_operational_stake: 0,
  estimated_prob: 62.06,
  finalMarketDiagnostic: staleSnapshot,
  calcioFinalMarketDiagnostic: staleSnapshot,
  calcioDeepScanResult: { finalMarketDiagnostic: staleSnapshot }
};
const resolved = context.resolveDiagnostic(bet);
assert.strictEqual(resolved.stake.modelStake, 4.13, 'Lo snapshot post-commit deve sostituire lo stake pre-batch');
assert.strictEqual(resolved.dataQuality.status, 'DATA_QUALITY_LIMITED');
assert.strictEqual(resolved.decisionState.code, 'EARLY_RECHECK');
assert.strictEqual(resolved.probability.modelProbabilityPct, 62.46);
assert.strictEqual(bet.finalMarketDiagnostic, resolved);
assert.strictEqual(bet.calcioFinalMarketDiagnostic, resolved);
assert.strictEqual(bet.calcioDeepScanResult.finalMarketDiagnostic, resolved);

const wrongPersisted = { ...finalSnapshot, marketId: 'CALCIO_MARKET_WRONG', generatedAt: '2026-07-27T17:00:00.000Z' };
const matchingObject = { ...finalSnapshot, generatedAt: '2026-07-27T16:59:00.000Z' };
const mismatchBet = {
  calcio_final_market_snapshot: JSON.stringify(wrongPersisted),
  calcio_final_market_id: finalSnapshot.marketId,
  calcio_decision_state: 'EARLY_RECHECK',
  calcio_data_quality_status: 'DATA_QUALITY_LIMITED',
  calcio_stake_authority_model_stake: 4.13,
  calcio_stake_authority_reliability_stake: 0,
  calcio_stake_authority_final_stake: 0,
  estimated_prob: 62.06,
  finalMarketDiagnostic: matchingObject
};
assert.strictEqual(context.resolveDiagnostic(mismatchBet).marketId, finalSnapshot.marketId, 'Un persistito con market_id incompatibile non deve prevalere');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fa-r4-live-audit-'));
const dbPath = path.join(tempDir, 'database_betting.db');
const db = new Database(dbPath);
db.exec(`CREATE TABLE ai_forward_test (
 id INTEGER PRIMARY KEY, sport_type TEXT, status TEXT, estimated_prob REAL,
 calcio_final_market_contract_version TEXT, calcio_final_market_id TEXT,
 calcio_final_market_snapshot TEXT, calcio_diagnostic_coherence_status TEXT,
 calcio_decision_state TEXT, calcio_data_quality_status TEXT,
 calcio_stake_authority_model_stake REAL, calcio_stake_authority_reliability_stake REAL,
 calcio_stake_authority_final_stake REAL, calcio_operational_stake REAL,
 calcio_portfolio_batch_status TEXT
);
CREATE TABLE calcio_final_market_contract_audit_log (id INTEGER PRIMARY KEY);`);
const insert = db.prepare(`INSERT INTO ai_forward_test
(id,sport_type,status,estimated_prob,calcio_final_market_contract_version,calcio_final_market_id,
 calcio_final_market_snapshot,calcio_diagnostic_coherence_status,calcio_decision_state,
 calcio_data_quality_status,calcio_stake_authority_model_stake,calcio_stake_authority_reliability_stake,
 calcio_stake_authority_final_stake,calcio_operational_stake,calcio_portfolio_batch_status)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (let id = 1; id <= 10; id += 1) {
  const snapshot = { ...finalSnapshot, marketId: `CALCIO_MARKET_${id}` };
  insert.run(id, 'CALCIO', 'PENDING', 62.06, 'BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1', snapshot.marketId,
    JSON.stringify(snapshot), 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED', 'EARLY_RECHECK',
    'DATA_QUALITY_LIMITED', 4.13, 0, 0, 0, 'COMMITTED_BATCH');
  db.prepare('INSERT INTO calcio_final_market_contract_audit_log (id) VALUES (?)').run(id);
}
db.close();
const audit = spawnSync(process.execPath, [path.join(root, 'tools', 'audit-calcio-patch26fa.js')], {
  cwd: root,
  env: { ...process.env, BETTING_DB_PATH: dbPath },
  encoding: 'utf8',
  timeout: 60000
});
assert.strictEqual(audit.status, 0, `${audit.stdout}\n${audit.stderr}`);
const auditJson = JSON.parse(audit.stdout);
assert.strictEqual(auditJson.liveCertified, true);
assert.strictEqual(auditJson.certification, 'LIVE_FINAL_MARKET_CONTRACT_AND_UI_POST_COMMIT_SYNC_CERTIFIED');
assert.strictEqual(auditJson.violations.snapshotUiMismatches, 0);
assert.strictEqual(auditJson.nextStep, 'PATCH_26F_A_COMPLETE_PROCEED_TO_PATCH_26F_B_HISTORICAL_COVERAGE_ENTITY_RESOLUTION');
fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });

console.log(JSON.stringify({
  success: true,
  checks: 14,
  resolver: 'POST_COMMIT_CANONICAL_SNAPSHOT_SELECTED',
  liveCertification: 'DYNAMIC_CERTIFICATION_PASS',
  modelStake: resolved.stake.modelStake,
  dataQuality: resolved.dataQuality.status,
  decisionState: resolved.decisionState.code,
  marketId: resolved.marketId
}, null, 2));
