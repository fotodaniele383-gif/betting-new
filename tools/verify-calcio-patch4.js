'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

function run(relative) {
    const result = cp.spawnSync(process.execPath, [path.join(root, relative), root], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${relative} failed with ${result.status}`);
}

run('tools/test-calcio-patch1-standalone.js');
run('tools/test-calcio-patch2-standalone.js');
run('tools/test-calcio-patch3-standalone.js');
run('tools/test-calcio-patch4-standalone.js');

const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const backendIndex = fs.readFileSync(path.join(root, 'backend', 'public', 'index.html'), 'utf8');
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
const evidence = require(path.join(root, 'backend', 'calcioHistoricalCombinationEvidence'));

const patch = registry.PATCHES.find(item => item.version === '4');
const checks = {
    evidenceModuleImported: server.includes("require('./calcioHistoricalCombinationEvidence')"),
    readOnlyEndpoint: server.includes("app.get('/api/calcio/historical-combination-evidence'"),
    strictPendingIdentity: (server.match(/UPPER\(COALESCE\(sport_type, ''\)\) = 'CALCIO'/g) || []).length >= 2,
    permissiveDeepScanIdentityRemoved: !server.includes("UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'\n                        OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'"),
    evidenceAfterFinalGate: server.includes('resolveHistoricalCombinationEvidence(db') && server.includes('calcio_gate_status: calcioGateReport.status'),
    persistenceWired: server.includes('toPersistenceFields(historicalCombinationEvidence)'),
    responseWired: server.includes('realProbabilityPaperTrading: historicalCombinationEvidence'),
    uiCalcioWired: app.includes('sport === SPORT.TENNIS || sport === SPORT.CALCIO') && app.includes('realProbabilityPaperTrading'),
    uiHeader: index.includes('Prob. reale PT DS×Gate'),
    frontendDuplicates: app === backendApp && index === backendIndex,
    registryV4: /^CALCIO_PATCH_REGISTRY_V\d+$/.test(registry.CALCIO_PATCH_REGISTRY_VERSION) && Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 4 && Boolean(patch),
    noModelAuthority: patch?.footballProbabilityContractChanged === false && patch?.stakeAuthorityChanged === false,
    evidenceVersion: evidence.CALCIO_HISTORICAL_COMBINATION_VERSION === 'CALCIO_HISTORICAL_COMBINATION_EVIDENCE_V1_PATCH4'
};

const success = Object.values(checks).every(Boolean);
const report = {
    success,
    patch: 'CALCIO_PATCH_4',
    version: evidence.CALCIO_HISTORICAL_COMBINATION_VERSION,
    checks,
    invariants: {
        databaseMigration: false,
        tennisAuthorityChanged: false,
        footballProbabilityWeightsChanged: false,
        stakePolicyChanged: false,
        historicalEvidenceShadowOnly: true
    }
};

const dir = path.join(root, 'audit_calcio_patch4');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'calcio_patch4_verification_report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, out)}`);
if (!success) process.exit(2);
