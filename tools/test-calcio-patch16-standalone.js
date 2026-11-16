'use strict';
const path = require('path');
const { run } = require('./calcioPatch16VerificationCore');
try { console.log(JSON.stringify(run(path.resolve(process.argv[2] || path.join(__dirname, '..'))), null, 2)); }
catch (error) { console.error(error.stack || error.message); process.exit(1); }
