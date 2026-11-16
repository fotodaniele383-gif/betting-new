#!/usr/bin/env node
'use strict';
const { runPatch9Checks } = require('./calcioPatch9VerificationCore');
try { console.log(JSON.stringify(runPatch9Checks(), null, 2)); }
catch (error) { console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2)); process.exitCode = 1; }
