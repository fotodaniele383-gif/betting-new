'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, runPatch10Checks } = require('./calcioPatch10VerificationCore');
try {
    const verification = runPatch10Checks();
    const report = {
        success: true,
        patch: 'CALCIO_PATCH_10',
        generatedAt: new Date().toISOString(),
        verification,
        boundaries: {
            databaseMigration: 'SCHEMA_ONLY_NULLABLE_COLUMNS',
            historicalRowsRewritten: false,
            tennisAuthorityChanged: false,
            newOddsApiCalls: 0,
            eventSelectionUsesEdge: false,
            understatFallback: 'LAST_KNOWN_GOOD_OR_GOAL_SHOT_PROXY',
            stakeContract: 'THEORETICAL_SEPARATE_FROM_OPERATIONAL'
        }
    };
    const dir = path.join(ROOT, 'audit_calcio_patch10');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'calcio_patch10_audit.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${target}`);
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
