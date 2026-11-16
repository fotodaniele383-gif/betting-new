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

function text(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sha256(relativePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');
}

function syntax(relativePath) {
    const result = cp.spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
        cwd: root,
        encoding: 'utf8'
    });
    check(`Syntax ${relativePath}`, result.status === 0, result.stderr || null);
}

const required = [
    'backend/calcioQuantEngine.js',
    'backend/server.js',
    'backend/calcioPatchRegistry.js',
    'backend/calcio_patch_inventory.json',
    'backend/tests/calcioPatch1MonteCarloContract.test.js',
    'tools/test-calcio-patch1-standalone.js',
    'tools/verify-calcio-patch1.js',
    'tools/audit-calcio-project-state.js',
    'package.json'
];

for (const file of required) check(`File ${file}`, fs.existsSync(path.join(root, file)));
for (const file of required.filter(file => file.endsWith('.js'))) syntax(file);

const quantSource = text('backend/calcioQuantEngine.js');
const serverSource = text('backend/server.js');
const pkg = JSON.parse(text('package.json'));
const inventory = JSON.parse(text('backend/calcio_patch_inventory.json'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry.js'));

check('Quant patch marker', quantSource.includes('CALCIO_PATCH_1_MONTE_CARLO_EXPECTED_GOALS_CONTRACT'));
check('Null-safe expected-goals resolver', quantSource.includes('function resolveExpectedGoalsInput'));
check('Server analysis/backtest xG wiring',
    (serverSource.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g) || []).length >= 2 &&
    (serverSource.match(/expAwayGoals:\s*xgResult\.expAwayGoals/g) || []).length >= 2
);
check('Patch registry contains Patch 1 and supports forward progression',
    Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 1 &&
    /^CALCIO_PATCH_REGISTRY_V\d+$/.test(registry.CALCIO_PATCH_REGISTRY_VERSION) &&
    registry.PATCHES.some(item => item.version === '1' && item.id === 'CALCIO_PATCH_1_MONTE_CARLO_EXPECTED_GOALS_CONTRACT')
);
check('Package scripts', [
    'test:calcio:patch1',
    'test:calcio:patch1:standalone',
    'verify:calcio:patch1',
    'audit:calcio:project-state'
].every(name => Boolean(pkg.scripts[name])));
check('Inventory includes Patch 1 progression', Number(inventory.registry?.currentPatchVersion) >= 1);

for (const [relativePath, expectedHash] of Object.entries(inventory.protectedFiles || {})) {
    const absolute = path.join(root, relativePath);
    check(`Inventory hash ${relativePath}`, fs.existsSync(absolute) && sha256(relativePath) === expectedHash, {
        expected: expectedHash,
        actual: fs.existsSync(absolute) ? sha256(relativePath) : null
    });
}

const standalone = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'test-calcio-patch1-standalone.js'), root], {
    cwd: root,
    encoding: 'utf8'
});
if (standalone.stdout) process.stdout.write(standalone.stdout);
if (standalone.stderr) process.stderr.write(standalone.stderr);
check('Standalone regression suite', standalone.status === 0);

const success = checks.every(item => item.ok);
const report = {
    success,
    patch: 'CALCIO_PATCH_1',
    generatedAt: new Date().toISOString(),
    checks
};
const outputDir = path.join(root, 'audit_calcio_patch1');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'calcio_patch1_verification_report.json'), JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, path.join(outputDir, 'calcio_patch1_verification_report.json'))}`);
if (!success) process.exit(2);
