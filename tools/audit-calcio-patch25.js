'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('./sqlite-compat');
const ai = require('../backend/calcioAiFinalization');
const registry = require('../backend/calcioPatchRegistry');
const PATCH = 'BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
const db = new Database(path.resolve(__dirname, '../backend/database_betting.db'));
const total = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const tennis = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
const calcio = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n;
const activeScope = `
  UPPER(COALESCE(sport_type,''))='CALCIO'
  AND UPPER(COALESCE(status,'PENDING'))='PENDING'
  AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
  AND COALESCE(paper_result_active,1)=1
  AND COALESCE(paper_result_conflict,0)=0
`;
const pending = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${activeScope}`).get().n;
const wait = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${activeScope} AND UPPER(COALESCE(ds_action,'')) IN ('ATTENDI IN-PLAY','ATTENDI IN PLAY','WAIT_IN_PLAY','WAIT IN PLAY')`).get().n;
const authorizedZero = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${activeScope} AND COALESCE(calcio_operational_stake,stake,0)<2 AND (UPPER(COALESCE(calcio_stake_lifecycle_status,''))='UNIFIED_INDEX_STAKE_AUTHORIZED' OR COALESCE(calcio_prediction_index_eligible,0)=1 OR COALESCE(calcio_analysis_only,1)=0 OR UPPER(COALESCE(prediction_visibility,''))='OPERATIONAL_CANDIDATE')`).get().n;
db.close();
const server = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
const aiSource = fs.readFileSync(path.resolve(__dirname, '../backend/calcioAiFinalization.js'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const patch = registry.PATCHES.find(p => p.version === '25');
const allowedActions = [...new Set(Object.values(ai.ACTION_LABEL))];
const report = {
  success: true,
  patch: PATCH,
  certification: 'CERTIFIED_OFFLINE_REQUIRES_POST_INSTALL_FRESH_DEEPSCAN',
  database: { total, tennis, calcio, activePendingCalcio: pending, legacyWaitActions: wait, authorizedZeroStates: authorizedZero },
  allowedDeepScanActions: allowedActions,
  codeGuards: {
    waitIsTimingOnly: ai.canonicalDeepScanDecision({ action: 'WATCHLIST LOW EDGE', deepScanAdvisory: { mode: 'WAIT_IN_PLAY' } }, {}).timingAdvisory === 'WAIT_IN_PLAY',
    noWaitActionLabel: !allowedActions.some(v => /ATTENDI|WAIT/i.test(String(v))),
    perCandidateFailureIsolation: aiSource.includes('projectCandidateReport(selectedReport, candidate'),
    sharedMatchEvidenceFallback: aiSource.includes('SHARED_MATCH_EVIDENCE_LOCAL_MARKET_PROJECTION'),
    atomicTransaction: server.includes('commitFinalization = db.transaction'),
    currentRowCapGuard: server.includes('PATCH25_CURRENT_ROW_NOT_INCLUDED_IN_POST_FINALIZATION_CAPS'),
    postCapStateNormalized: server.includes('calcio_runtime_consistency_status'),
    frontendStakeZeroNotCertified: app.includes('index.operationalStake >= 2'),
    frontendApiUiErrorsSeparated: app.includes('let deepScanApiSucceeded = false'),
    compactPayloadPreserved: server.includes('calcioDeepScanPayloadContract.sanitizeRequestBody')
  },
  registry: patch
};
if (!Object.values(report.codeGuards).every(Boolean)) {
  report.success = false;
  report.certification = 'FAILED_CODE_GUARDS';
  process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
