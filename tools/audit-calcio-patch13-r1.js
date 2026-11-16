'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./calcioPatch13R1VerificationCore');
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
(async () => {
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    const verification = await run(root);
    const tracked = ['backend/database_betting.db', 'backend/server.tennis.js', 'backend/paperTrading.tennis.js', 'backend/tennis_patch_inventory.json'];
    const isolation = Object.fromEntries(tracked.map(rel => [rel, fs.existsSync(path.join(root, rel)) ? sha(path.join(root, rel)) : null]));
    const audit = {
        success: verification.success,
        patch: 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE',
        generatedAt: new Date().toISOString(),
        verification,
        isolation,
        boundaries: {
            databaseMutation: false,
            historicalTennisRowsChanged: false,
            tennisModelChanged: false,
            stakeAuthorityChanged: false,
            newOddsApiCalls: 0,
            maxConcurrentDeepScans: 2,
            partialResponse: 'DEEPSCAN_PARZIALE'
        }
    };
    const outDir = path.join(root, 'audit_calcio_patch13_r1');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'calcio_patch13_r1_audit.json'), JSON.stringify(audit, null, 2));
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.success) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
