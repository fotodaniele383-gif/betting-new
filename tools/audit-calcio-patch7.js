#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const registry = require('../backend/calcioPatchRegistry');
const source = require('../backend/calcioSourceIntelligence');
const entity = require('../backend/calcioEntityResolution');
const understat = require('../backend/calcioUnderstatContract');
const snapshot = require('../backend/calcioTeamSnapshot');
const { runPatch7Checks } = require('./calcioPatch7VerificationCore');
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
    generatedAt: new Date().toISOString(), scope: 'CALCIO_PATCH_7', registry: registry.getCalcioPatchStatus(),
    contracts: {
        sourceIntelligenceVersion: source.CALCIO_SOURCE_INTELLIGENCE_VERSION,
        cacheSchemaVersion: source.SOURCE_CACHE_SCHEMA_VERSION,
        entityResolutionVersion: entity.CALCIO_ENTITY_RESOLUTION_VERSION,
        understatContractVersion: understat.CALCIO_UNDERSTAT_CONTRACT_VERSION,
        teamSnapshotVersion: snapshot.CALCIO_TEAM_SNAPSHOT_VERSION,
        menFirstTeamOnlyForNewsAuthority: true,
        crossProviderDeduplication: true,
        independentPublisherCounting: true,
        coverageAndMatchImpactConfidenceSeparated: true,
        understatRequiresBothTeams: true,
        footballDataAsOfSnapshot: true,
        sourceProbeConsumesOddsApiCredits: false
    },
    footballData: footballData.getFootballDataHealth({ projectRoot: root }),
    tests: runPatch7Checks(), database,
    regressions: { databaseMigration: false, tennisAuthorityChanged: false, probabilityWeightsChanged: false, stakePolicyChanged: false, settlementChanged: false, clvChanged: false },
    nextPriorities: [
        'Add opponent-adjusted strength and home/away priors using the clean Patch 7 team snapshots.',
        'Collect forward outcomes by coverage confidence, match-impact confidence and DS×Gate before calibration.',
        'Promote source information to probability/stake authority only after sufficient current-clean evidence.'
    ]
};
const dir = path.join(root, 'audit_calcio_patch7'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch7_audit.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
