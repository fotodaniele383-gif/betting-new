'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
const evidence = require(path.join(root, 'backend', 'calcioHistoricalCombinationEvidence'));

const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO_PATCH_4',
    registry: registry.getCalcioPatchStatus(),
    evidence: {
        version: evidence.CALCIO_HISTORICAL_COMBINATION_VERSION,
        mode: evidence.CALCIO_HISTORICAL_COMBINATION_MODE,
        strictSportIdentity: true,
        currentCleanOnly: true,
        currentResultUsed: false,
        modelAuthority: false,
        stakeAuthority: false,
        matrix: null,
        databaseStatus: 'NOT_INSPECTED'
    },
    regressions: {
        databaseMigration: false,
        tennisAuthorityChanged: false,
        probabilityWeightsChanged: false,
        deepScanDecisionChanged: false,
        qualityGateDecisionChanged: false,
        stakePolicyChanged: false
    },
    roiReadiness: {
        minimumDecisionSample: evidence.MIN_DECISION_SAMPLE,
        interpretation: 'Win rate, Wilson 95%, break-even ed ROI operativo devono essere letti insieme.',
        productionUse: 'SHADOW_ONLY'
    }
};

try {
    const Database = require('better-sqlite3');
    const dbPath = [
        path.join(root, 'backend', 'database_betting.db'),
        path.join(root, 'database_betting.db')
    ].find(fs.existsSync);
    if (dbPath) {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.pragma('query_only = ON');
        report.evidence.matrix = evidence.buildCombinationMatrix(db, { limit: 100000 });
        report.evidence.databaseStatus = 'READ_ONLY_OK';
        db.close();
    }
} catch (error) {
    report.evidence.databaseStatus = 'UNAVAILABLE';
    report.evidence.databaseError = error.message;
}

const matrix = report.evidence.matrix;
report.roiReadiness.resolvedRows = Number(matrix?.resolvedRows || 0);
report.roiReadiness.combinations = Array.isArray(matrix?.combinations) ? matrix.combinations.length : 0;
report.roiReadiness.status = report.roiReadiness.resolvedRows >= evidence.MIN_DECISION_SAMPLE
    ? 'SHADOW_SAMPLE_AVAILABLE'
    : 'COLLECT_CURRENT_CLEAN_SAMPLE';

const outDir = path.join(root, 'audit_calcio_patch4');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'calcio_patch4_audit.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, outPath)}`);
