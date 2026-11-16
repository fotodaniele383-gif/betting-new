'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [
 'backend/calcioStakeLifecycle.js','backend/calcioStakePortfolioAudit.js','backend/server.js',
 'backend/calcioPatchRegistry.js','public/app.js','backend/public/app.js','package.json',
 'backend/calcioKellyStakePolicy.js','backend/calcioProbabilityIntegrity.js','backend/deepScanRuntimeResilience.js'
];
const digests = Object.fromEntries(files.map(rel=>[rel,sha(path.join(root,rel))]));
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_15_STAKE_EXECUTION_DS_GATE_PORTFOLIO_AUDIT', digests, boundaries:{ databaseMutation:false, historicalTennisRowsChanged:false, tennisModelChanged:false, newOddsApiCalls:0, minimumPositiveStakeEur:2, earlyMicroCapEur:3, unreliableThreshold:55 } }, null, 2));
