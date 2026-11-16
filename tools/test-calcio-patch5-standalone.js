'use strict';
const fs = require('fs');
const path = require('path');
const { runCalcioPatch5Verification } = require('./calcioPatch5VerificationCore');

try {
    const root = path.resolve(__dirname, '..');
    const report = runCalcioPatch5Verification(root);
    const reportDir = path.join(root, 'audit_calcio_patch5');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
        path.join(reportDir, 'calcio_patch5_verification_report.json'),
        JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report, null, 2));
    console.log('\nReport: audit_calcio_patch5\\calcio_patch5_verification_report.json');
} catch (error) {
    console.error(JSON.stringify({
        success: false,
        patch: 'CALCIO_PATCH_5',
        error: error.message,
        details: error.details || null,
        stack: error.stack
    }, null, 2));
    process.exit(1);
}
