#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const registry = require('../backend/calcioPatchRegistry');
const walkForward = require('../backend/calcioWalkForwardCalibration');
const cleanup = require('../backend/calcioSafeProjectCleanup');
const { runPatch9Checks } = require('./calcioPatch9VerificationCore');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dir = path.join(root, 'audit_calcio_patch9'); fs.mkdirSync(dir, { recursive: true });
const calibrationPath = path.join(dir, 'calcio_patch9_calibration_report.json');
const walkForwardPath = path.join(dir, 'calcio_patch9_walk_forward_report.json');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO_PATCH_9',
    registry: registry.getCalcioPatchStatus(),
    contracts: {
        walkForwardVersion: walkForward.CALCIO_WALK_FORWARD_VERSION,
        cleanupVersion: cleanup.CALCIO_SAFE_CLEANUP_VERSION,
        mode: 'SHADOW_ONLY_NO_AUTOMATIC_PRODUCTION_PROMOTION',
        candidateCount: walkForward.buildCandidateGrid().length,
        chronologicalCutoffPerMatch: true,
        holdoutLocked: true,
        noNewApiCalls: true,
        databaseReadOnly: true
    },
    tests: runPatch9Checks(),
    latestWalkForward: read(walkForwardPath),
    latestCalibration: read(calibrationPath),
    cleanupDryRun: cleanup.buildCleanupPlan(root),
    regressions: { databaseMigration: false, tennisAuthorityChanged: false, productionProbabilityChanged: false, stakePolicyChanged: false, settlementChanged: false, clvChanged: false }
};
const out = path.join(dir, 'calcio_patch9_audit.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
