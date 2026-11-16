'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

function argValue(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const root = path.resolve(argValue('--root') || process.argv.find(v => !v.startsWith('--') && v !== process.argv[0] && v !== process.argv[1]) || path.join(__dirname, '..'));
const dbFile = path.resolve(argValue('--db') || path.join(root, 'backend', 'database_betting.db'));
const dryRun = process.argv.includes('--dry-run');
if (!fs.existsSync(dbFile)) { console.error(`Database non trovato: ${dbFile}`); process.exit(1); }
const db = new DatabaseSync(dbFile, dryRun ? { readOnly: true } : {});
try {
    const report = reconciler.reconcilePendingRows(db, { dryRun, softMicroCapEur: 3 });
    const compact = {
        success: true,
        patch: 'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_RECONCILIATION',
        dryRun,
        dbFile,
        version: report.version,
        scanned: report.scanned,
        selectedLatestEvents: report.selectedLatestEvents,
        updated: report.updated,
        unchanged: report.unchanged,
        operationalPositive: report.operationalPositive,
        positiveRows: report.decisions.filter(row => row.operationalStake > 0).map(row => ({ id: row.id, event: row.event, prediction: row.prediction, theoreticalStake: row.theoreticalStake, operationalStake: row.operationalStake, status: row.status, dataClass: row.dataClass, score: row.score, deepScanClass: row.deepScanClass })),
        zeroByReason: report.decisions.filter(row => row.operationalStake <= 0).reduce((acc, row) => { acc[row.qualityOrigin] = (acc[row.qualityOrigin] || 0) + 1; return acc; }, {})
    };
    if (!dryRun && dbFile === path.join(root, 'backend', 'database_betting.db')) {
        const auditDir = path.join(root, 'audit_calcio_patch16');
        fs.mkdirSync(auditDir, { recursive: true });
        fs.writeFileSync(path.join(auditDir, 'calcio_patch16_stake_reconciliation_report.json'), JSON.stringify(compact, null, 2));
    }
    console.log(JSON.stringify(compact, null, 2));
} finally { db.close(); }
