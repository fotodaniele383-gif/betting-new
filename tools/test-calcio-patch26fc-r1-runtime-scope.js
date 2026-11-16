'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const checks = [];
function check(name, fn) { fn(); checks.push({ name, ok: true }); }
check('undefined historicalCoverageAudit fallback removed from DeepScan dual-score block', () => {
  assert(!server.includes('historicalCoverage: finalMarketCandidate.extData?.historicalCoverageAudit || historicalCoverageAudit || {}'));
  assert(!server.includes('promotedTeamPrior: finalMarketCandidate.extData?.historicalCoverageAudit?.promotedTeamPrior || historicalCoverageAudit?.promotedTeamPrior'));
});
check('candidate and persisted coverage sources are explicitly resolved', () => {
  assert(server.includes('candidateHistoricalCoverageAuditRaw'));
  assert(server.includes('persistedHistoricalCoverageAudit'));
  assert(server.includes('dualScoreHistoricalCoverage'));
});
check('serialized candidate audit is parsed safely', () => {
  assert(server.includes("typeof candidateHistoricalCoverageAuditRaw === 'string'"));
  assert(server.includes('safeJsonParse(candidateHistoricalCoverageAuditRaw, {})'));
});
check('dual score consumes only scoped audit object', () => {
  assert(server.includes('historicalCoverage: dualScoreHistoricalCoverage'));
  assert(server.includes('promotedTeamPrior: Boolean(dualScoreHistoricalCoverage?.promotedTeamPrior)'));
});
check('production authorities remain untouched', () => {
  for (const token of ['calcioUnifiedStakeAuthority', 'calcioBatchPortfolioAllocator', 'calcioFinalMarketDiagnosticContract']) assert(server.includes(token));
});
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26F_C_R1_DEEPSCAN_RUNTIME_SCOPE_RECOVERY', checks: checks.length, results: checks }, null, 2));
