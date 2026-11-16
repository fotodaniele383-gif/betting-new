'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.cwd());
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry.js'));
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
const legacyTest = fs.readFileSync(path.join(root, 'backend', 'tests', 'patch20TennisResilientPlayerDataRefresh.test.js'), 'utf8');

const checks = [
  ['REGISTRY_PATCH_21', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 21 && registry.PATCHES.some(x => x.version === '21' && String(x.status).startsWith('ACTIVE'))],
  ['UI_MULTI_PROVIDER_ENDPOINT', app.includes('/api/tennis/player-data-provider-probe')],
  ['SERVER_MULTI_PROVIDER_ENDPOINT', server.includes("router.post('/player-data-provider-probe'")],
  ['SERVER_LEGACY_ALIAS_PRESERVED', server.includes("router.post('/player-data-source-probe'")],
  ['LEGACY_TEST_DYNAMIC_REGISTRY', legacyTest.includes('expectedUiProbeEndpoint') && legacyTest.includes('TENNIS_CURRENT_PATCH_VERSION')],
  ['LEGACY_TEST_NO_FROZEN_UI_ROUTE_ASSERTION', !legacyTest.includes("expect(app).toContain('/api/tennis/player-data-source-probe')")],
  ['FRONTEND_APP_BYTE_IDENTICAL', Buffer.from(app).equals(Buffer.from(backendApp))],
  ['NO_SOCCER_PATCH21_MARKER', !server.includes('PATCH21_SOCCER')]
].map(([name, success]) => ({ name, success: Boolean(success) }));

const report = {
  success: checks.every(item => item.success),
  patch: '21-R1',
  version: 'TENNIS_PATCH21_R1_LEGACY_PROBE_COMPATIBILITY_V1',
  checksTotal: checks.length,
  checksPassed: checks.filter(item => item.success).length,
  checks,
  generatedAt: new Date().toISOString()
};
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exit(2);
