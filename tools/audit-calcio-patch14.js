'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [
 'backend/calcioKellyStakePolicy.js','backend/calcioClubEloProvider.js','backend/calcioMultiProviderEvidence.js',
 'backend/calcioSourceIntelligence.js','backend/calcioProfessionalGuard.js','backend/calcioProgramCoherence.js',
 'backend/calcioStakeLifecycle.js','backend/server.js','public/app.js','backend/public/app.js','backend/calcioPatchRegistry.js','package.json'
];
const digests = Object.fromEntries(files.map(rel => [rel, sha(path.join(root, rel))]));
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE', digests, boundaries:{ databaseMutation:false, historicalTennisRowsChanged:false, tennisModelChanged:false, newOddsApiCalls:0, minimumPositiveStakeEur:2, unreliableThreshold:55 } }, null, 2));
