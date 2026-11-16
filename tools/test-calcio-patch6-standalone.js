#!/usr/bin/env node
'use strict';
const { runPatch6Checks } = require('./calcioPatch6VerificationCore');
try { console.log(JSON.stringify(runPatch6Checks(), null, 2)); }
catch (error) { console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2)); process.exitCode = 1; }
