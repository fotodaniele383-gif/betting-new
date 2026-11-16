#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const reports = [];
for (let version = 1; version <= 8; version++) {
    const script = `test-calcio-patch${version}-standalone.js`;
    const result = spawnSync(process.execPath, [path.join(root, 'tools', script)], { cwd: root, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status || 1);
    reports.push(script);
}
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const deepScan = fs.readFileSync(path.join(root, 'backend', 'deepScanCalcio.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'backend', 'calcioOpponentAdjustedForm.js'), 'utf8');
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
const checks = {
    modulePresent: moduleSource.includes('CALCIO_PATCH_8_OPPONENT_ADJUSTED_FORM_V1'),
    serverImported: server.includes("require('./calcioOpponentAdjustedForm')"),
    productionWired: server.includes('buildMatchAdjustment(') && server.includes('applyToExpectedGoals('),
    backtestParity: server.includes('backtestSnapshotIndex'),
    diagnosticsWired: server.includes('opponentAdjustedForm: { evaluated: 0'),
    deepScanVisible: deepScan.includes('Forma corretta per forza avversari'),
    registryIncludesV8: Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 8 && registry.PATCHES.some(item => item.version === '8'),
    patch1To8Regression: reports.length === 8
};
if (Object.values(checks).some(value => !value)) throw new Error(`Patch 8 verification failed: ${JSON.stringify(checks)}`);
const report = { success: true, patch: 'CALCIO_PATCH_8', checks };
const dir = path.join(root, 'audit_calcio_patch8'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch8_verification_report.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, out)}`);
