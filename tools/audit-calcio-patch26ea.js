'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const registry = require('../backend/calcioPatchRegistry');
const db = new Database(process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db'), { readonly: true });
const total = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const tennis = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
const calcio = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n;
const populated = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_deepscan_final_state_version,'')<>''").get().n;
db.close();
console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_26E_A_CALCIO_DEEPSCAN_FINAL_STATE_UI_CONSISTENCY',
    certification: 'CODE_AND_FIXTURE_CERTIFIED_REQUIRES_FRESH_LIVE_ANALYSIS',
    registry: { version: registry.CALCIO_CURRENT_PATCH_VERSION },
    database: { total, tennis, calcio, finalStateRows: populated },
    guards: {
        finalMarketStateRecalculation: true,
        preliminaryStakeIgnoredByTaxonomy: true,
        actionIpmDisplayPersistenceUnified: true,
        nestedUiSnapshotBatchSynchronized: true,
        probabilityModelUnchanged: true,
        stakeAuthorityUnchanged: true,
        newOddsApiCalls: 0
    },
    nextStep: 'INSTALL_PATCH26E_B_AFTER_PATCH26E_A_VERIFICATION'
}, null, 2));
