'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, runPatch11Checks } = require('./calcioPatch11VerificationCore');
runPatch11Checks().then(report => {
    const output = { ...report, verificationMode: 'SOURCE_AND_DETERMINISTIC_FIXTURES', verifiedAt: new Date().toISOString() };
    const dir = path.join(ROOT, 'audit_calcio_patch11');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'calcio_patch11_verification_report.json');
    fs.writeFileSync(target, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
    console.log(`Report: ${target}`);
}).catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
});
