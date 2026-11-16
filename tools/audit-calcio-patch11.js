'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, runPatch11Checks } = require('./calcioPatch11VerificationCore');
runPatch11Checks().then(verification => {
    const report = {
        success: true,
        patch: 'CALCIO_PATCH_11',
        generatedAt: new Date().toISOString(),
        verification,
        boundaries: {
            databaseMigration: 'SCHEMA_ONLY_NULLABLE_COLUMNS', historicalRowsRewritten: false,
            tennisAuthorityChanged: false, newOddsApiCalls: 0,
            understatTransport: 'AJAX_JSON_THEN_HTML_LKG_PROXY',
            reliabilityAuthority: 'DISPLAY_AND_AUDIT_ONLY',
            stakeAuthorityChanged: false,
            tradingRoiPolicy: 'WON_LOST_OPERATIONAL_ONLY_NO_FAKE_ROI',
            backtestMode: 'CHRONOLOGICAL_AS_OF_SAFE_WITH_HISTORICAL_ODDS'
        }
    };
    const dir = path.join(ROOT, 'audit_calcio_patch11');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'calcio_patch11_audit.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${target}`);
}).catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
});
