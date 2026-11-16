'use strict';
const path = require('path');
const { run } = require('./calcioPatch15VerificationCore');
(async () => {
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    const report = await run(root);
    console.log(JSON.stringify({ success: report.success, patch: report.patch, checks: report.checks.length, boundaries: report.boundaries }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
