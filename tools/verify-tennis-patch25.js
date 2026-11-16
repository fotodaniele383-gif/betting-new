'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const checks = [];
function check(name, ok, details = null) { const row = { name, ok: Boolean(ok), details }; checks.push(row); console.log(`[${row.ok ? 'PASS' : 'FAIL'}] ${name}`); return row; }
function text(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function syntax(rel) { const r = cp.spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' }); check(`Node syntax - ${rel}`, r.status === 0, r.stderr || null); }
const files = [
  'backend/tennisRuntimeHealthContract.js','backend/tennisAutoScheduler.js','backend/tennisPatchRegistry.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js',
  'backend/tests/patch25TennisRuntimeHealthSchedulerCoherency.test.js','backend/tests/patch24TennisForwardSampleIntakeAssurance.test.js',
  'public/app.js','backend/public/app.js','tools/test-tennis-patch25-standalone.js','tools/migrate-tennis-scheduler-patch25.js','tools/audit-tennis-runtime-health-patch25.js','tools/verify-tennis-patch25-db.js','tools/verify-tennis-patch25-first-match-canary.js','tools/verify-tennis-patch25.js'
];
files.forEach(syntax);
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry.js'));
const inventory = JSON.parse(text('backend/tennis_patch_inventory.json'));
const pkg = JSON.parse(text('package.json'));
const app = text('public/app.js'); const backApp = text('backend/public/app.js');
const index = text('public/index.html'); const backIndex = text('backend/public/index.html');
const scheduler = text('backend/tennisAutoScheduler.js'); const server = text('backend/server.tennis.js'); const progression = text('backend/tennisProgramProgressionAudit.js');
check('Registry Patch 25 active', registry.TENNIS_CURRENT_PATCH_VERSION === '25' && registry.TENNIS_PATCH_REGISTRY_VERSION === 'TENNIS_PATCH_REGISTRY_V25' && registry.PATCHES.some(x => x.version === '24') && registry.PATCHES.some(x => x.version === '25'));
check('Runtime Health Contract linked', server.includes("require('./tennisRuntimeHealthContract')") && server.includes('runtimeVersions') && server.includes('operationalReadiness'));
check('Scheduler exact persistent linked', scheduler.includes("3.1_PATCH25_PERSISTENT_EXACT_INTERVAL") && scheduler.includes("PERSISTENT_EXACT_INTERVAL") && scheduler.includes('calculateNextRunAt') && scheduler.includes('singleFlightLockActive') && !scheduler.includes('return `${merged.minute} */${merged.intervalHours}'));
check('Frontend truth linked', app.includes('PATCH25_TENNIS_RUNTIME_HEALTH_TRUTH_UI') && app.includes('Pronto al primo match') && app.includes('Server Core') && app.includes('Tennis Engine'));
check('Badge Patch 25 fallback and map', index.includes('Patch 1–25') && index.includes('data-tennis-patch="25"') && index.includes('tennisOpsPatchChip') && index.includes('Patch 25</span>'));
check('No misleading anomalies counter', !app.includes("alertChip.textContent = `${alerts} ${alerts === 1 ? 'anomalia' : 'anomalie'}`") && index.includes('0 avvisi · 0 errori'));
check('Patch 20 cache-buster removed', index.includes('app.js?v=patch25-runtime-health-scheduler-coherency') && !index.includes('app.js?v=patch20-resilient-player-data-refresh'));
check('Progression Patch 25 linked', progression.includes('TENNIS_PROGRAM_PROGRESSION_AUDIT_V13_PATCH25') && progression.includes('Scheduler intervallo persistente esatto Patch 25') && progression.includes('operationalSummary'));
check('Health usa Progression Audit Patch 25 corrente', server.includes("TENNIS_PROGRAM_PROGRESSION_AUDIT_V13_PATCH25") && !server.includes("TENNIS_PROGRAM_PROGRESSION_AUDIT_V12_PATCH24"));
check('Patch 24 regression forward-compatible', text('backend/tests/patch24TennisForwardSampleIntakeAssurance.test.js').includes('toBeGreaterThanOrEqual(24)'));
check('Frontend app byte-identici', app === backApp);
check('Frontend index byte-identici', index === backIndex);
const ids = [...index.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]); const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
check('No duplicate HTML ids', dup.length === 0, dup);
const scripts = ['test:tennis:patch25','verify:tennis:patch25','verify:tennis:patch25:db','audit:tennis:runtime-health-patch25','migrate:tennis:scheduler-patch25','test:tennis:patch25:standalone','test:tennis:patch25:first-match-canary'];
check('Scripts Patch 25', scripts.every(name => Boolean(pkg.scripts[name])), scripts.filter(name => !pkg.scripts[name]));
check('Inventory Patch 25', inventory.registry?.currentPatchVersion === '25' && inventory.registry?.registryVersion === 'TENNIS_PATCH_REGISTRY_V25' && inventory.summary?.uniqueLegacySteps === 56 && inventory.summary?.unregisteredCount === 0, { registry: inventory.registry, summary: inventory.summary });
check('No operational authority', server.includes('probabilityWeightsChanged: false') && server.includes('deepScanDecisionChanged: false') && server.includes('qualityGateAuthority: false') && server.includes('stakeAuthority: false'));
check('No Soccer Patch 25 payload marker', !server.includes('PATCH25_SOCCER') && !app.includes('PATCH25_SOCCER'));
const standalone = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'test-tennis-patch25-standalone.js'), root], { cwd: root, encoding: 'utf8' });
if (standalone.stdout) process.stdout.write(standalone.stdout); if (standalone.stderr) process.stderr.write(standalone.stderr);
check('Patch 25 standalone', standalone.status === 0);
const success = checks.every(x => x.ok);
const out = path.join(root, 'audit_patch25'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'patch25_verification_report.json'), JSON.stringify({ success, patch: '25', checks, generatedAt: new Date().toISOString() }, null, 2));
console.log(`\nReport: audit_patch25/patch25_verification_report.json`);
if (!success) process.exit(2);
