#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const reports = [];
for (let version = 1; version <= 9; version++) {
    const script = `test-calcio-patch${version}-standalone.js`;
    const result = spawnSync(process.execPath, [path.join(root, 'tools', script)], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status || 1);
    reports.push(script);
}
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const moduleSource = fs.readFileSync(path.join(root, 'backend', 'calcioWalkForwardCalibration.js'), 'utf8');
const cleanupSource = fs.readFileSync(path.join(root, 'backend', 'calcioSafeProjectCleanup.js'), 'utf8');
const checks = {
    calibrationModulePresent: moduleSource.includes('CALCIO_PATCH_9_WALK_FORWARD_CALIBRATION_V1'),
    safeCleanupPresent: cleanupSource.includes('CALCIO_PATCH_9_SAFE_PROJECT_CLEANUP_V1'),
    backtestScript: packageJson.scripts?.['backtest:calcio:walk-forward'] === 'node tools/backtest-calcio-walk-forward.js',
    calibrationScript: packageJson.scripts?.['calibrate:calcio:opponent-form'] === 'node tools/calibrate-calcio-opponent-form.js',
    verifyScript: packageJson.scripts?.['verify:calcio:patch9'] === 'node tools/verify-calcio-patch9.js',
    auditScript: packageJson.scripts?.['audit:calcio:patch9'] === 'node tools/audit-calcio-patch9.js',
    cleanupDryRunScript: packageJson.scripts?.['cleanup:calcio:patch9:report'] === 'node tools/cleanup-calcio-project-safe.js',
    registryV9: registry.CALCIO_CURRENT_PATCH_VERSION === '9',
    patch1To9Regression: reports.length === 9
};
if (Object.values(checks).some(value => !value)) throw new Error(`Patch 9 verification failed: ${JSON.stringify(checks)}`);
const report = { success: true, patch: 'CALCIO_PATCH_9', checks };
const dir = path.join(root, 'audit_calcio_patch9'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch9_verification_report.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
