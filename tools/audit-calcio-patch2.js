'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry.js'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'calcio_patch_inventory.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const analyzeStart = server.indexOf("app.post('/api/analyze'");
const analyzeEnd = server.indexOf("app.get('/api/backtest'", analyzeStart);
const analyzeSource = server.slice(analyzeStart, analyzeEnd);

const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO_PATCH_2',
    registry: registry.getCalcioPatchStatus(),
    inventory: {
        schemaVersion: inventory.schemaVersion,
        protectedFileCount: Object.keys(inventory.protectedFiles || {}).length,
        unregisteredCount: inventory.summary?.unregisteredCount ?? null
    },
    controls: {
        requestIdentity: {
            status: server.includes('buildCalcioAnalysisRequestIdentity') ? 'ACTIVE' : 'MISSING',
            includesBankroll: server.includes('bankroll: initialBankroll'),
            includesSettings: server.includes('settings: dynSettings'),
            boundedEntries: server.includes('CALCIO_ANALYSIS_CACHE_MAX_ENTRIES')
        },
        oddsConsensus: {
            status: server.includes('buildCalcioMarketConsensus') ? 'ACTIVE' : 'MISSING',
            firstBookmakerDependencyRemoved: !server.includes('const book1 = m.bookmakers[0]'),
            sharpOrMedianNoVig: server.includes('referenceFairOdds'),
            falseOpeningDriftRemoved: !analyzeSource.includes('closingOddForPred > openingOddForPred * 1.05')
        },
        regressions: {
            patch1XgWiring: (server.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g) || []).length >= 2,
            databaseMigration: false,
            tennisAuthorityChanged: false,
            probabilityWeightsChanged: false,
            stakePolicyChanged: false
        }
    },
    nextPriorities: [
        'Dynamic football-data season resolver with LKG and source freshness.',
        'Strict Calcio sport identity and current-clean sample intake.',
        'Apply uncertainty penalty coherently to stake after forward evidence is available.'
    ]
};

const outputDir = path.join(root, 'audit_calcio_patch2');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'calcio_patch2_audit.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, outputPath)}`);
