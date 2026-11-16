'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
    const required = [
        'calcio_event_key', 'calcio_provider_event_id', 'calcio_canonical_pair_key',
        'calcio_theoretical_stake', 'calcio_operational_stake',
        'calcio_stake_lifecycle_status', 'calcio_stake_lifecycle_reason'
    ];
    const missing = required.filter(name => !columns.has(name));
    const counts = {
        total: db.prepare('SELECT COUNT(*) AS n FROM ai_forward_test').get().n,
        explicitCalcio: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n,
        explicitTennis: db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n
    };
    db.close();
    if (String(integrity).toLowerCase() !== 'ok') throw new Error(`SQLITE_INTEGRITY_${integrity}`);
    if (missing.length) throw new Error(`PATCH10_DB_COLUMNS_MISSING:${missing.join(',')}`);
    console.log(JSON.stringify({ success: true, patch: 'CALCIO_PATCH_10', verificationMode: 'READ_ONLY_SQLITE_SCHEMA_AND_COUNTS', database: path.relative(ROOT, dbPath), integrity, counts, requiredColumns: required, historicalRowsRewritten: false }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
}
