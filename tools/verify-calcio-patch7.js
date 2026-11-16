#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const reports = [];
for (const script of [
    'test-calcio-patch1-standalone.js',
    'test-calcio-patch2-standalone.js',
    'test-calcio-patch3-standalone.js',
    'test-calcio-patch4-standalone.js',
    'test-calcio-patch5-standalone.js',
    'test-calcio-patch6-standalone.js',
    'test-calcio-patch7-standalone.js'
]) {
    const result = spawnSync(process.execPath, [path.join(root, 'tools', script)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status || 1);
    reports.push(script);
}
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const deepScan = fs.readFileSync(path.join(root, 'backend', 'deepScanCalcio.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'backend', 'calcioSourceIntelligence.js'), 'utf8');
const checks = {
    entityResolutionImported: source.includes("require('./calcioEntityResolution')"),
    understatContractImported: server.includes("require('./calcioUnderstatContract')"),
    teamSnapshotImported: server.includes("require('./calcioTeamSnapshot')"),
    understatDualTeamEnforced: server.includes('understatCoverage.bothTeams'),
    teamSnapshotWired: server.includes('buildMatchSnapshots(teamSnapshotIndex'),
    dualConfidenceUi: deepScan.includes('Copertura fonti') && deepScan.includes('Impatto match'),
    cacheSchemaV2: source.includes('CALCIO_PATCH_7_NLP_CACHE_V2'),
    patch1To7Regression: reports.length === 7
};
if (Object.values(checks).some(value => !value)) throw new Error(`Patch 7 verification failed: ${JSON.stringify(checks)}`);
const report = { success: true, patch: 'CALCIO_PATCH_7', checks };
const dir = path.join(root, 'audit_calcio_patch7'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch7_verification_report.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, out)}`);
