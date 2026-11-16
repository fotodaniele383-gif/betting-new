'use strict';
const { runPatch10Checks } = require('./calcioPatch10VerificationCore');
try {
    console.log(JSON.stringify(runPatch10Checks(), null, 2));
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
