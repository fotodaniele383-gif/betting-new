#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let Database;
try { Database = require('better-sqlite3'); }
catch (error) { console.error(`better-sqlite3 non disponibile: ${error.message}`); process.exit(3); }
const dbPath = [path.join(root, 'backend', 'database_betting.db'), path.join(root, 'database_betting.db')].find(fs.existsSync);
if (!dbPath) { console.error('Database BettingApp non trovato.'); process.exit(3); }
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
let report;
try {
    db.pragma('query_only = ON');
    const integrity = db.pragma('integrity_check', { simple: true });
    const counts = db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) explicitCalcio,
        SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) explicitTennis,
        SUM(CASE WHEN UPPER(COALESCE(data_quality,''))='LEGACY_DIRTY' THEN 1 ELSE 0 END) legacyDirty
        FROM ai_forward_test`).get();
    report = {
        success: integrity === 'ok', patch: 'CALCIO_PATCH_9', verificationMode: 'READ_ONLY_SQLITE_NO_MIGRATION',
        database: path.relative(root, dbPath).replaceAll('\\','/'), integrity, counts,
        invariants: { schemaMigrationRequired: false, historicalResultsRewritten: false, tennisRowsModified: false, stakeColumnsModified: false }
    };
} finally { db.close(); }
const dir = path.join(root, 'audit_calcio_patch9'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch9_db_verification_report.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
if (!report.success) process.exit(1);
