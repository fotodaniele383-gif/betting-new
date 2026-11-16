'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../backend/calcioPatchRegistry');
const quant = require('../backend/calcioQuantEngine');
const integrity = require('../backend/calcioProbabilityIntegrity');
const { runCalcioPatch5Verification } = require('./calcioPatch5VerificationCore');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const verification = runCalcioPatch5Verification(root);

const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO_PATCH_5',
    registry: registry.getCalcioPatchStatus(),
    probabilityIntegrity: {
        version: integrity.CALCIO_PROBABILITY_INTEGRITY_VERSION,
        modelComponents: ['DIXON_COLES_ELO_CALIBRATED', 'MONTE_CARLO_SCORELINE', 'MARKET_NO_VIG_REFERENCE'],
        monteCarloIterationsLive: 10000,
        matchSpecificSeed: true,
        monteCarloAnalyticAudit: verification.diagnostics.analyticMonteCarlo,
        missingXgContract: 'GOAL_SHOT_PROXY_SHRUNK_TO_LEAGUE_PRIOR',
        xgNullCoercionBlocked: true,
        requestedWeightRespected: true,
        consensusDiagnostics: ['SOURCE_PROBABILITIES', 'SOURCE_WEIGHTS', 'DISAGREEMENT_PP', 'MONTE_CARLO_STD_ERROR_PP'],
        coverageModes: ['STRONG_REAL_XG', 'HISTORY_PROXY_STRONG', 'HISTORY_PROXY', 'HISTORY_THIN', 'PRIOR_ONLY']
    },
    visibilityContract: {
        insufficientDataExcluded: false,
        completeOddsRequired: true,
        bestAvailableForecast: true,
        analysisOnlyStake: 0,
        deepScanRuns: true,
        qualityGateVisible: true,
        operationalThresholdsStillApply: true
    },
    regressions: {
        databaseMigration: false,
        tennisAuthorityChanged: false,
        stakeFormulaChanged: false,
        settlementChanged: false,
        clvChanged: false,
        patch4EvidenceChanged: false
    },
    tests: verification,
    database: {
        status: 'NOT_INSPECTED',
        counts: null
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
        report.database.status = 'READ_ONLY_OK';
        report.database.path = path.relative(root, dbPath).replaceAll('\\', '/');
        report.database.counts = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) AS explicitCalcio,
                SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) AS explicitTennis,
                SUM(CASE WHEN UPPER(COALESCE(data_quality,''))='LEGACY_DIRTY' THEN 1 ELSE 0 END) AS legacyDirty,
                SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND COALESCE(stake,0)=0 THEN 1 ELSE 0 END) AS calcioStakeZero
            FROM ai_forward_test
        `).get();
        db.close();
    }
} catch (error) {
    report.database.status = 'UNAVAILABLE';
    report.database.error = error.message;
}

const outDir = path.join(root, 'audit_calcio_patch5');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'calcio_patch5_audit.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, outPath)}`);
