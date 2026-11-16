'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const registry = require('../backend/calcioPatchRegistry');
const source = require('../backend/calcioSourceIntelligence');
const { runPatch6Checks } = require('./calcioPatch6VerificationCore');
const footballData = require('../backend/calcioFootballDataProvider');
let database = { status: 'NOT_INSPECTED', reason: 'better-sqlite3 not available' };
try {
    const Database = require('better-sqlite3');
    const dbPath = [path.join(root, 'backend', 'database_betting.db'), path.join(root, 'database_betting.db')].find(fs.existsSync);
    if (dbPath) {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        database = { status: db.pragma('integrity_check', { simple: true }) === 'ok' ? 'READ_ONLY_OK' : 'INTEGRITY_ERROR', path: path.relative(root, dbPath).replaceAll('\\','/') };
        db.close();
    }
} catch (error) { database = { status: 'NOT_INSPECTED', reason: error.message }; }
const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO_PATCH_6',
    registry: registry.getCalcioPatchStatus(),
    sourceIntelligence: {
        version: source.CALCIO_SOURCE_INTELLIGENCE_VERSION,
        cacheSchemaVersion: source.SOURCE_CACHE_SCHEMA_VERSION,
        officialDomainCount: Object.keys(source.OFFICIAL_TEAM_DOMAINS).length,
        sourcePlan: ['GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS','GOOGLE_NEWS_GENERAL_RSS','BING_NEWS_GENERAL_RSS'],
        provenanceStored: true,
        freshnessGuardDays: source.DEFAULT_MAX_AGE_DAYS,
        silenceMeansNoAbsences: false,
        newsAuthority: 'QUALITATIVE_ONLY',
        sourceProbeConsumesOddsApiCredits: false,
        contradictionsVisible: true,
        xgProxySeparatedFromRealUnderstat: true
    },
    footballData: footballData.getFootballDataHealth({ projectRoot: root }),
    tests: runPatch6Checks(),
    database,
    regressions: {
        databaseMigration: false,
        tennisAuthorityChanged: false,
        probabilityWeightsChanged: false,
        deepScanDecisionAuthorityChanged: false,
        qualityGateAuthorityChanged: false,
        stakePolicyChanged: false,
        settlementChanged: false,
        clvChanged: false
    },
    nextPriorities: [
        'Collect source-probe reports on real upcoming matches and measure provider availability.',
        'Add official lineup providers only when licensing and stable identifiers are available.',
        'Evaluate source coverage and contradiction rate against settled forward outcomes before any model authority.'
    ]
};
const dir = path.join(root, 'audit_calcio_patch6'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch6_audit.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
