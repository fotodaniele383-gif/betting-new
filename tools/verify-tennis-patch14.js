'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const auditDir = path.join(root, 'audit_patch14'); fs.mkdirSync(auditDir, { recursive: true });
const checks = [];
function pass(name, details = '') { checks.push({ name, ok: true, details }); console.log(`[PASS] ${name}${details ? `\n${details}` : ''}`); }
function fail(name, error) { checks.push({ name, ok: false, error: String(error?.message || error) }); console.error(`[FAIL] ${name}: ${error?.message || error}`); }
function run(name, args) { try { const out = cp.execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); pass(name, out.trim()); return out; } catch (error) { fail(name, (error.stderr || error.stdout || error).toString()); return null; } }
function source(name, ok, details = '') { ok ? pass(name, details) : fail(name, new Error(details || 'SOURCE_GUARD_FAILED')); }
const syntaxFiles = [
  'backend/tennisPlayerDataRefresh.js','backend/tennisPlayerEvidence.js','backend/sackmann.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js','backend/tennisPatchRegistry.js',
  'backend/tests/patch14TennisPlayerDataRefreshFreshnessGuard.test.js','backend/tests/patch13TennisHistoricalCombinationEvidenceAndProgression.test.js',
  'tools/test-tennis-patch14-refresh-fixtures.js','tools/refresh-tennis-player-data.js','tools/audit-tennis-player-data.js','tools/verify-tennis-patch14-db.js','tools/test-tennis-patch14-standalone.js','tools/verify-tennis-patch14.js',
  'tools/verify-tennis-patch13.js','tools/test-tennis-patch13-standalone.js','tools/verify-tennis-patch12.js','tools/create-tennis-safe-support-bundle.js','public/app.js','backend/public/app.js'
];
for (const file of syntaxFiles) run(`Node syntax - ${file}`, ['--check', file]);
run('Patch 14 deterministic refresh fixtures', ['tools/test-tennis-patch14-refresh-fixtures.js']);
run('Patch 14 standalone', ['tools/test-tennis-patch14-standalone.js']);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 13 standalone compatibility', ['tools/test-tennis-patch13-standalone.js']);
const registry = require('../backend/tennisPatchRegistry');
const refresh = require('../backend/tennisPlayerDataRefresh');
const server = fs.readFileSync(path.join(root, 'backend/server.tennis.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const bapp = fs.readFileSync(path.join(root, 'backend/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const bhtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
source('Registry Patch 14 active', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 14 && registry.TENNIS_PATCH_REGISTRY_VERSION === `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}` && registry.PATCHES.some(item => item.version === '14' && String(item.status).startsWith('ACTIVE')));
source('Refresh exact allowlist', refresh.ALLOWED_HOSTS.size === 1 && refresh.ALLOWED_HOSTS.has('raw.githubusercontent.com') && refresh.ALLOWED_REPOSITORIES.size === 2);
source('Staging, LKG and atomic restore present', server.includes('tennisPlayerDataRefresh') && fs.readFileSync(path.join(root, 'backend/tennisPlayerDataRefresh.js'), 'utf8').includes('.patch14_lkg') && fs.readFileSync(path.join(root, 'backend/tennisPlayerDataRefresh.js'), 'utf8').includes('restoredLastKnownGood'));
source('Refresh endpoints local/read-only split', server.includes("router.get('/player-data-freshness'") && server.includes("router.post('/player-data-refresh'") && server.includes('PATCH14_LOCAL_REQUEST_REQUIRED'));
source('Auto refresh best-effort', server.includes('scheduleAutoRefresh') && server.includes('PLAYER_DATA_REFRESH_FAILED'));
source('No model/stake authority', fs.readFileSync(path.join(root, 'backend/tennisPlayerDataRefresh.js'), 'utf8').includes('probabilityWeightsChanged: false') && fs.readFileSync(path.join(root, 'backend/tennisPlayerDataRefresh.js'), 'utf8').includes('stakeAuthority: false'));
source('UI Patch 1-14 connected', html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`) && html.includes('tennisPlayerDataPanel') && app.includes('executeTennisPlayerDataRefresh'));
source('Frontend copies identical', app === bapp && html === bhtml);
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]); const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
source('No duplicate HTML ids', duplicates.length === 0, JSON.stringify(duplicates));
source('No Soccer/Calcio Patch 14 module', !syntaxFiles.some(file => /calcio|soccer/i.test(file)));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend/tennis_patch_inventory.json'), 'utf8'));
source('Inventory 56 legacy steps and current 14', Number(inventory.summary?.uniqueLegacySteps) === 56 && Number(inventory.summary?.unregisteredCount) === 0 && Number(inventory.registry?.currentPatchVersion) >= 14);
const result = { success: checks.every(item => item.ok), patch: '14', checks, frontendHashes: { app: crypto.createHash('sha256').update(app).digest('hex'), index: crypto.createHash('sha256').update(html).digest('hex') }, generatedAt: new Date().toISOString() };
fs.writeFileSync(path.join(auditDir, 'patch14_verification_report.json'), JSON.stringify(result, null, 2));
console.log('\nReport: audit_patch14\\patch14_verification_report.json');
if (!result.success) process.exitCode = 2;
