#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const reports = [];
for (const script of [
    'test-calcio-patch1-standalone.js',
    'test-calcio-patch2-standalone.js',
    'test-calcio-patch3-standalone.js',
    'test-calcio-patch4-standalone.js',
    'test-calcio-patch5-standalone.js',
    'test-calcio-patch6-standalone.js'
]) {
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: root, encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status || 1);
    reports.push(script);
}
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'backend', 'calcioSourceIntelligence.js'), 'utf8');
const checks = {
    sourceModuleImported: server.includes("require('./calcioSourceIntelligence')"),
    sourceCatalogEndpoint: server.includes("/api/calcio/source-intelligence/catalog"),
    sourceProbeEndpoint: server.includes("/api/calcio/source-intelligence/probe"),
    sourceProbeLocalOnly: server.includes('CALCIO_SOURCE_PROBE_LOCAL_ONLY'),
    noOddsApiInProbe: server.includes("status: 'NOT_CALLED'"),
    officialFirstPlan: source.includes('GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS'),
    cacheSchema: /CALCIO_PATCH_[67]_NLP_CACHE_V[12]/.test(source),
    patch1To5Regression: reports.length === 6
};
if (Object.values(checks).some(v => !v)) throw new Error(`Patch 6 source verification failed: ${JSON.stringify(checks)}`);
const report = { success: true, patch: 'CALCIO_PATCH_6', checks };
const dir = path.join(root, 'audit_calcio_patch6'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'calcio_patch6_verification_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, path.join(dir, 'calcio_patch6_verification_report.json'))}`);
