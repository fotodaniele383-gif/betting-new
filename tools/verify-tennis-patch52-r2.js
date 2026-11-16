#!/usr/bin/env node
'use strict';
const cp = require('child_process');
const path = require('path');
const { resolveProjectRoot } = require('./patch52-cli');
const root = resolveProjectRoot();
const suites = [
  ['tools/test-tennis-patch52-r2-state-truth.js', 'functional'],
  ['tools/test-tennis-patch52-r2-server-contract.js', 'functional'],
  ['tools/audit-tennis-patch52-r2.js', 'functional'],
  ['tools/test-tennis-patch52-wta-recovery.js', 'functional'],
  ['tools/test-tennis-patch52-cli-and-server.js', 'functional'],
  ['tools/audit-tennis-patch52.js', 'functional'],
  ['tools/test-tennis-patch51-settlement-exception-queue.js', 'functional'],
  ['tools/test-tennis-patch51-runtime-idempotency.js', 'functional'],
  ['tools/test-tennis-patch51-frontend.js', 'functional'],
  ['tools/audit-tennis-patch51.js', 'functional'],
  ['tools/test-tennis-patch50-health-alignment.js', 'functional'],
  ['tools/test-tennis-patch50-prediction-index-collapse.js', 'functional'],
  ['tools/test-tennis-patch49-analysis-memory.js', 'functional'],
  ['tools/test-tennis-patch49-prediction-index-bands.js', 'functional'],
  ['tools/test-tennis-patch49-frontend.js', 'functional'],
  ['tools/test-tennis-patch49-canonical-onboarding.js', 'functional'],
  ['tools/test-tennis-patch48-r5-exact-ledger-gap.js', 'functional'],
  ['tools/test-tennis-patch47-runtime-idempotency.js', 'functional'],
  ['tools/test-tennis-patch46-frontend.js', 'functional'],
  ['tools/test-tennis-patch51-core-progression.js', 'compatibility']
];
function parse(raw) {
  raw = String(raw || '').trim();
  try { return JSON.parse(raw); } catch (_) {
    const pos = raw.lastIndexOf('\n{');
    if (pos >= 0) try { return JSON.parse(raw.slice(pos + 1)); } catch (_) {}
    return null;
  }
}
let functionalChecks = 0;
let compatibilityChecks = 0;
let failed = false;
const results = [];
for (const [file, kind] of suites) {
  const run = cp.spawnSync(process.execPath, [path.join(root, file), '--root', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      TENNIS_PATCH52_WTA_AUTO_REFRESH: '0',
      TENNIS_PATCH43_WTA_AUTO_REFRESH: '0',
      CLV_VERBOSE_AUDIT: '0',
      PATCH50_SKIP_NESTED_PROGRESSION: '1'
    }
  });
  const parsed = parse(run.stdout);
  let checks = Array.isArray(parsed?.details) ? parsed.details.length : Number(parsed?.checks || 0);
  if (!Number.isFinite(checks)) checks = 0;
  const ok = run.status === 0 && !run.error && parsed?.success !== false;
  if (kind === 'functional') functionalChecks += checks; else compatibilityChecks += checks;
  results.push({ file, ok, exitCode: run.status, signal: run.signal || null, checks, error: ok ? null : (parsed?.error || run.error?.message || String(run.stderr || run.stdout).slice(-4000)) });
  if (!ok) failed = true;
}
const output = {
  success: !failed,
  patch: 'TENNIS_PATCH_52_R2_WTA_RECOVERY_STATE_TRUTH_CANDIDATE_ACTIVE_SEPARATION',
  revision: 'R2_WINDOWS_NODE_WTA_STATE_TRUTH',
  verification: `${results.filter(row => row.ok).length}/${results.length} PASS`,
  functionalChecks,
  compatibilityChecks,
  suites: results
};
console.log(JSON.stringify(output, null, 2));
if (failed) process.exit(1);
