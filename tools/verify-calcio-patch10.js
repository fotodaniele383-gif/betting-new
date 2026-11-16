'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, runPatch10Checks } = require('./calcioPatch10VerificationCore');
try {
    const report = { ...runPatch10Checks(), verificationMode: 'SOURCE_AND_DETERMINISTIC_FIXTURES', verifiedAt: new Date().toISOString() };
    const dir = path.join(ROOT, 'audit_calcio_patch10');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'calcio_patch10_verification_report.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${target}`);
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
