'use strict';
const path = require('path');
const { run } = require('./calcioPatch13R1VerificationCore');
(async () => {
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    const report = await run(root);
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
