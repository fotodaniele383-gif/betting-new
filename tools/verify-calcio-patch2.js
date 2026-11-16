'use strict';

const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const checks = [];

function check(name, ok, details = null) {
    checks.push({ name, ok: Boolean(ok), details });
}
function absolute(relativePath) { return path.join(root, relativePath); }
function text(relativePath) { return fs.readFileSync(absolute(relativePath), 'utf8'); }
function sha256(relativePath) { return crypto.createHash('sha256').update(fs.readFileSync(absolute(relativePath))).digest('hex'); }
function syntax(relativePath) {
    const result = cp.spawnSync(process.execPath, ['--check', absolute(relativePath)], { cwd: root, encoding: 'utf8' });
    check(`Syntax ${relativePath}`, result.status === 0, result.stderr || null);
}
function runNode(relativePath) {
    const result = cp.spawnSync(process.execPath, [absolute(relativePath), root], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
}

const required = [
    'backend/calcioQuantEngine.js',
    'backend/server.js',
    'backend/calcioPatchRegistry.js',
    'backend/calcio_patch_inventory.json',
    'backend/calcioRequestIdentity.js',
    'backend/calcioMarketConsensus.js',
    'backend/tests/calcioPatch1MonteCarloContract.test.js',
    'backend/tests/calcioPatch2RequestCacheOddsConsensus.test.js',
    'tools/test-calcio-patch1-standalone.js',
    'tools/test-calcio-patch2-standalone.js',
    'tools/verify-calcio-patch1.js',
    'tools/verify-calcio-patch2.js',
    'tools/audit-calcio-project-state.js',
    'tools/audit-calcio-patch2.js',
    'package.json'
];

for (const file of required) check(`File ${file}`, fs.existsSync(absolute(file)));
for (const file of required.filter(file => file.endsWith('.js'))) syntax(file);

const server = text('backend/server.js');
const quant = text('backend/calcioQuantEngine.js');
const pkg = JSON.parse(text('package.json'));
const inventory = JSON.parse(text('backend/calcio_patch_inventory.json'));
const registry = require(absolute('backend/calcioPatchRegistry.js'));
const requestIdentity = require(absolute('backend/calcioRequestIdentity.js'));
const marketConsensus = require(absolute('backend/calcioMarketConsensus.js'));

check('Registry includes Patch 2 progression',
    Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 2 &&
    /^CALCIO_PATCH_REGISTRY_V\d+$/.test(registry.CALCIO_PATCH_REGISTRY_VERSION) &&
    registry.PATCHES.some(item => item.version === '1') &&
    registry.PATCHES.some(item => item.version === '2')
);
check('Patch 2 module identities',
    requestIdentity.CALCIO_REQUEST_IDENTITY_VERSION === 'CALCIO_PATCH_2_REQUEST_IDENTITY_V1' &&
    marketConsensus.CALCIO_MARKET_CONSENSUS_VERSION === 'CALCIO_PATCH_2_MARKET_CONSENSUS_V1'
);
check('Patch 1 Monte Carlo contract preserved',
    quant.includes('CALCIO_PATCH_1_MONTE_CARLO_EXPECTED_GOALS_CONTRACT') &&
    (server.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g) || []).length >= 2 &&
    (server.match(/expAwayGoals:\s*xgResult\.expAwayGoals/g) || []).length >= 2
);
check('Request identity wired before cache lookup',
    server.includes('buildCalcioAnalysisRequestIdentity') &&
    server.includes('getCalcioAnalysisCache') &&
    server.includes('setCalcioAnalysisCache') &&
    server.indexOf('const dynSettings =') < server.indexOf('getCalcioAnalysisCache')
);
check('League-only cache removed', !server.includes('const cacheKey = `calcio_${league}`'));
check('First-bookmaker dependency removed', !server.includes('const book1 = m.bookmakers[0]'));
const analyzeStart = server.indexOf("app.post('/api/analyze'");
const analyzeEnd = server.indexOf("app.get('/api/backtest'", analyzeStart);
const analyzeSource = server.slice(analyzeStart, analyzeEnd);
check('Market consensus and no-opening diagnostic wired',
    analyzeSource.includes('buildCalcioMarketConsensus') &&
    analyzeSource.includes('referenceFairOdds') &&
    analyzeSource.includes('UNAVAILABLE_NO_OPENING_SNAPSHOT') &&
    !analyzeSource.includes('closingOddForPred > openingOddForPred * 1.05')
);
check('Package scripts', [
    'test:calcio:patch1',
    'verify:calcio:patch1',
    'test:calcio:patch2',
    'test:calcio:patch2:standalone',
    'verify:calcio:patch2',
    'audit:calcio:patch2'
].every(name => Boolean(pkg.scripts[name])));
check('Inventory includes Patch 2 progression', Number(inventory.registry?.currentPatchVersion) >= 2);
check('Registry invariants', registry.PATCHES.every(item => item.databaseMutation === false && item.tennisAuthorityChanged === false));

for (const [relativePath, expectedHash] of Object.entries(inventory.protectedFiles || {})) {
    const exists = fs.existsSync(absolute(relativePath));
    const actual = exists ? sha256(relativePath) : null;
    check(`Inventory hash ${relativePath}`, exists && actual === expectedHash, { expected: expectedHash, actual });
}

const patch1 = runNode('tools/test-calcio-patch1-standalone.js');
check('Patch 1 standalone regression', patch1.status === 0);
const patch2 = runNode('tools/test-calcio-patch2-standalone.js');
check('Patch 2 standalone suite', patch2.status === 0);

const success = checks.every(item => item.ok);
const report = {
    success,
    patch: 'CALCIO_PATCH_2',
    generatedAt: new Date().toISOString(),
    requestIdentityVersion: requestIdentity.CALCIO_REQUEST_IDENTITY_VERSION,
    marketConsensusVersion: marketConsensus.CALCIO_MARKET_CONSENSUS_VERSION,
    checks
};
const outputDir = path.join(root, 'audit_calcio_patch2');
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'calcio_patch2_verification_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, reportPath)}`);
if (!success) process.exit(2);
