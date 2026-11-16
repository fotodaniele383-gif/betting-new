'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const report = {
    success: false,
    patch: 'CALCIO_PATCH_4',
    verificationMode: 'READ_ONLY_SQLITE',
    database: null,
    counts: null,
    contaminationChecks: null
};

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
try {
    db.pragma('query_only = ON');
    const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
    const requiredColumns = [
        'sport_type',
        'data_quality',
        'ds_action',
        'calcio_gate_status',
        'historical_combo_key',
        'historical_combo_win_rate_pct',
        'historical_combo_version'
    ];
    const missingColumns = requiredColumns.filter(column => !columns.includes(column));

    const counts = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) AS explicitCalcio,
            SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) AS explicitTennis,
            SUM(CASE WHEN UPPER(COALESCE(data_quality,''))='LEGACY_DIRTY' THEN 1 ELSE 0 END) AS legacyDirty,
            SUM(CASE WHEN
                UPPER(COALESCE(status,'')) IN ('WON','LOST')
                AND UPPER(COALESCE(sport_type,''))='CALCIO'
                AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')
                AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
                AND TRIM(COALESCE(ds_action,'')) <> ''
                AND TRIM(COALESCE(calcio_gate_status, calcio_operational_status, '')) <> ''
            THEN 1 ELSE 0 END) AS strictResolvedDsGateSample
        FROM ai_forward_test
    `).get();

    const contamination = db.prepare(`
        SELECT
            SUM(CASE WHEN
                UPPER(COALESCE(status,'')) IN ('WON','LOST')
                AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')
                AND UPPER(COALESCE(sport_type,'')) <> 'CALCIO'
                AND TRIM(COALESCE(historical_combo_version,'')) LIKE 'CALCIO_HISTORICAL_COMBINATION%'
            THEN 1 ELSE 0 END) AS nonCalcioWithCalcioEvidence,
            SUM(CASE WHEN
                UPPER(COALESCE(data_quality,''))='LEGACY_DIRTY'
                AND TRIM(COALESCE(historical_combo_version,'')) LIKE 'CALCIO_HISTORICAL_COMBINATION%'
            THEN 1 ELSE 0 END) AS legacyWithCalcioEvidence
        FROM ai_forward_test
    `).get();

    report.success = missingColumns.length === 0 &&
        Number(contamination.nonCalcioWithCalcioEvidence || 0) === 0 &&
        Number(contamination.legacyWithCalcioEvidence || 0) === 0;
    report.database = path.relative(root, dbPath).replaceAll('\\', '/');
    report.missingColumns = missingColumns;
    report.counts = counts;
    report.contaminationChecks = contamination;
    report.note = Number(counts.strictResolvedDsGateSample || 0) === 0
        ? 'Campione Calcio current-clean DS×Gate ancora assente: la UI deve mostrare N/D, senza ricorrere alle righe legacy.'
        : 'Campione Calcio current-clean DS×Gate disponibile per la probabilità reale PT.';
} finally {
    db.close();
}

const dir = path.join(root, 'audit_calcio_patch4');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch4_db_verification_report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, out)}`);
if (!report.success) process.exit(2);
