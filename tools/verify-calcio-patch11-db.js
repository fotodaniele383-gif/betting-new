'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const required = [
    'calcio_prediction_reliability_score', 'calcio_prediction_reliability_label',
    'calcio_analysis_stage_code', 'calcio_analysis_stage_label', 'calcio_analysis_stage_reason',
    'calcio_analysis_only', 'calcio_quality_final_label'
];
try {
    const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
    let columns = [];
    let integrity = null;
    let counts = {};
    try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        integrity = db.pragma('integrity_check', { simple: true });
        columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
        counts = {
            total: db.prepare('SELECT COUNT(*) AS n FROM ai_forward_test').get().n,
            explicitCalcio: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n,
            explicitTennis: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n
        };
        db.close();
    } catch (nativeError) {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(dbPath, { readOnly: true });
        integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
        columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
        counts = {
            total: db.prepare('SELECT COUNT(*) AS n FROM ai_forward_test').get().n,
            explicitCalcio: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n,
            explicitTennis: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n
        };
        db.close();
    }
    const missing = required.filter(name => !columns.includes(name));
    if (String(integrity).toLowerCase() !== 'ok') throw new Error(`SQLITE_INTEGRITY_${integrity}`);
    if (missing.length) throw new Error(`PATCH11_DB_COLUMNS_MISSING:${missing.join(',')}`);
    console.log(JSON.stringify({ success: true, patch: 'CALCIO_PATCH_11', verificationMode: 'READ_ONLY_SQLITE_SCHEMA_AND_COUNTS', database: path.relative(ROOT, dbPath), integrity, counts, requiredColumns: required, historicalRowsRewritten: false }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
