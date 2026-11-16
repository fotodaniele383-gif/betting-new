#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const cleanup = require('../backend/calcioSafeProjectCleanup');
const positional = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const root = path.resolve(positional || path.join(__dirname, '..'));
const apply = process.argv.includes('--apply');
try {
    const result = apply ? cleanup.applyCleanupPlan(root) : { report: cleanup.buildCleanupPlan(root), reportPath: null };
    const report = result.report;
    if (!apply) {
        const dir = path.join(root, 'audit_calcio_patch9'); fs.mkdirSync(dir, { recursive: true });
        result.reportPath = path.join(dir, 'calcio_patch9_cleanup_dry_run.json');
        fs.writeFileSync(result.reportPath, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nModalità: ${apply ? 'APPLY' : 'DRY_RUN'}`);
    if (result.reportPath) console.log(`Report: ${path.relative(root, result.reportPath)}`);
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
