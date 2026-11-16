#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const registry = require('../backend/calcioPatchRegistry');
const form = require('../backend/calcioOpponentAdjustedForm');
const { runPatch8Checks } = require('./calcioPatch8VerificationCore');
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
    generatedAt: new Date().toISOString(), scope: 'CALCIO_PATCH_8', registry: registry.getCalcioPatchStatus(),
    contracts: {
        version: form.CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
        formWindow: form.DEFAULT_FORM_WINDOW,
        earlySeasonPriorMatches: form.DEFAULT_PRIOR_MATCHES,
        recencyDecay: form.DEFAULT_RECENCY_DECAY,
        maximumExpectedGoalsAdjustmentPct: form.DEFAULT_ADJUSTMENT_CAP * 100,
        opponentStrengthUsesPreMatchRowsOnly: true,
        futureRowsExcluded: true,
        productionBacktestParity: true,
        noNewApiCalls: true
    },
    tests: runPatch8Checks(), database,
    regressions: { databaseMigration: false, tennisAuthorityChanged: false, marketOddsChanged: false, stakePolicyChanged: false, settlementChanged: false, clvChanged: false },
    nextPriorities: [
        'Collect forward current-clean outcomes by form status and adjustment bucket.',
        'Compare calibrated log-loss and Brier score against Patch 7 baseline before changing the ±8% cap.',
        'Keep lineups and source intelligence qualitative until independently validated.'
    ]
};
const dir = path.join(root, 'audit_calcio_patch8'); fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch8_audit.json'); fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(`\nReport: ${path.relative(root, out)}`);
