#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const walkForward = require('../backend/calcioWalkForwardCalibration');
const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : path.join(__dirname, '..'));
try {
    const report = walkForward.runCalibration(root);
    const dir = path.join(root, 'audit_calcio_patch9'); fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'calcio_patch9_calibration_report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nReport: ${path.relative(root, out)}`);
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
