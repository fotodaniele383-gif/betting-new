'use strict';
const { runPatch11Checks } = require('./calcioPatch11VerificationCore');
runPatch11Checks().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
});
