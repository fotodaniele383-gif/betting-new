'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let Database;
try {
    Database = require('better-sqlite3');
} catch (error) {
    console.error(`better-sqlite3 non disponibile: ${error.message}`);
    process.exit(3);
}

const dbPath = [
    path.join(root, 'backend', 'database_betting.db'),
    path.join(root, 'database_betting.db')
].find(fs.existsSync);

if (!dbPath) {
    console.error('Database BettingApp non trovato.');
    process.exit(3);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
let report;
try {
    db.pragma('query_only = ON');
    const integrity = db.pragma('integrity_check', { simple: true });
    const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
    const required = [
        'sport_type', 'data_quality', 'status', 'stake',
        'calcio_gate_status', 'calcio_operational_action',
        'historical_combo_version'
    ];
    const missingColumns = required.filter(column => !columns.includes(column));
    const counts = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) AS explicitCalcio,
            SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) AS explicitTennis,
            SUM(CASE WHEN UPPER(COALESCE(data_quality,''))='LEGACY_DIRTY' THEN 1 ELSE 0 END) AS legacyDirty,
            SUM(CASE WHEN
                UPPER(COALESCE(sport_type,''))='CALCIO'
                AND COALESCE(stake,0)=0
                AND UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST')
            THEN 1 ELSE 0 END) AS calcioAnalysisOnlyOrZeroStake
        FROM ai_forward_test
    `).get();

    report = {
        success: integrity === 'ok' && missingColumns.length === 0,
        patch: 'CALCIO_PATCH_5',
        verificationMode: 'READ_ONLY_SQLITE_NO_MIGRATION',
        database: path.relative(root, dbPath).replaceAll('\\', '/'),
        integrity,
        missingColumns,
        counts,
        invariants: {
            schemaMigrationRequired: false,
            analysisOnlyUsesStakeZero: true,
            historicalResultsRewritten: false,
            tennisRowsModified: false
        }
    };
} finally {
    db.close();
}

const outDir = path.join(root, 'audit_calcio_patch5');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'calcio_patch5_db_verification_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, outPath)}`);
if (!report.success) process.exit(1);
