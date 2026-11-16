#!/usr/bin/env node
'use strict';
const { runPatch7Checks } = require('./calcioPatch7VerificationCore');
try { console.log(JSON.stringify(runPatch7Checks(), null, 2)); }
catch (error) { console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2)); process.exitCode = 1; }
