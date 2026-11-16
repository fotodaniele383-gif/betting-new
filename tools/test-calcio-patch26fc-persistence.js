'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('./sqlite-compat');
const dual = require('../backend/calcioDualScoreArchitecture');

function cleanup(target) {
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); return 'REMOVED'; }
  catch (error) {
    if (!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code)) throw error;
    return `NON_BLOCKING_${error.code}`;
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fc-persistence-'));
const dbPath = path.join(tempDir, 'fixture.db');
let db = new Database(dbPath);
try {
  db.exec(`
    CREATE TABLE ai_forward_test (
      id INTEGER PRIMARY KEY,
      sport_type TEXT,
      status TEXT,
      calcio_event_key TEXT,
      calcio_final_market_id TEXT
    );
    INSERT INTO ai_forward_test (id,sport_type,status,calcio_event_key,calcio_final_market_id)
    VALUES (1,'CALCIO','PENDING','EVT-1','MKT-1');
  `);
} finally { db.close(); db = null; }

const migration = spawnSync(process.execPath, [path.join(__dirname, 'migrate-calcio-patch26fc.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, BETTING_DB_PATH: dbPath },
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
});
if (migration.status !== 0) {
  if (migration.stdout) process.stderr.write(migration.stdout);
  if (migration.stderr) process.stderr.write(migration.stderr);
  process.exit(1);
}

const result = dual.evaluateShadow({
  marketId: 'MKT-1', prediction: 'U2.5', odd: 1.8,
  productionProbabilityPct: 60, robustProbabilityPct: 58, robustEvPct: 4.4,
  modelMarketGapPp: 3, monteCarloStdErrorPp: 0.4,
  sourceConfidencePct: 80, oddsCertification: { certified: true, operationalEligible: true, sourceCount: 8 },
  dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 78, blocking: false },
  daysToKickoff: 5, epistemicUncertaintyScore: 30, crossMarketGapPp: 2,
  lineupStatus: 'LINEUP_NOT_CONFIRMED', xgEvidenceMode: 'GOAL_SHOT_PROXY',
  historicalCoverage: { status: 'HISTORY_PRIMARY_STRONG', confidence: 88 },
  historicalSample: 0, oldIpmScore: 62, oldIpmComponents: { paperTrading: { contribution: 5 } },
  currentDecisionState: 'VALUE_CANDIDATE', marketCertified: true
});
const fields = dual.persistenceFields(result);

db = new Database(dbPath);
let output;
try {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE ai_forward_test SET ${keys.map(key => `"${key}"=@${key}`).join(',')} WHERE id=1`).run(fields);
  const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
  const log = db.prepare('SELECT * FROM calcio_dual_score_shadow_audit_log WHERE bet_id=1').get();
  assert(row);
  assert(log);
  assert.strictEqual(row.calcio_dual_score_authority, 0);
  assert.strictEqual(row.calcio_dual_score_pt_sample, 0);
  assert.strictEqual(row.calcio_dual_score_pt_weight, 0);
  assert.strictEqual(log.authority, 0);
  assert.strictEqual(log.pt_weight, 0);
  assert.strictEqual(log.market_id, 'MKT-1');
  output = {
    success: true,
    checks: 7,
    trigger: 'APPEND_ONLY_AUDIT_LOG_CREATED',
    readiness: row.calcio_decision_readiness_shadow,
    label: row.calcio_decision_readiness_label,
    ptWeight: row.calcio_dual_score_pt_weight,
    authority: row.calcio_dual_score_authority
  };
} finally { db.close(); }
output.cleanup = cleanup(tempDir);
console.log(JSON.stringify(output, null, 2));
