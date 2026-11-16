#!/usr/bin/env node
'use strict';
const { runPatch8Checks } = require('./calcioPatch8VerificationCore');
try { console.log(JSON.stringify(runPatch8Checks(), null, 2)); }
catch (error) { console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2)); process.exitCode = 1; }
