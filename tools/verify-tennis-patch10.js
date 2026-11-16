'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sourceOnly = process.argv.includes('--source-only');
let success = true;
const results = [];
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 160 * 1024 * 1024, env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' } });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
  return passed;
}

const syntaxFiles = [
  ['Quality Gate V2', 'backend/tennisQualityGateV2.js'],
  ['server Tennis', 'backend/server.tennis.js'],
  ['patch registry', 'backend/tennisPatchRegistry.js'],
  ['inventory builder R1', 'tools/build-tennis-patch-inventory.js'],
  ['Patch 10 Jest test', 'backend/tests/patch10TennisQualityGatePerformanceAlignment.test.js'],
  ['Patch 9 compatibility Jest test', 'backend/tests/patch9TennisForwardCohortsAndOperationsUi.test.js'],
  ['Patch 10 migration', 'tools/migrate-tennis-patch10-quality-gate.js'],
  ['Patch 10 DB verifier', 'tools/verify-tennis-patch10-db.js'],
  ['Patch 10 audit', 'tools/audit-tennis-quality-gate.js'],
  ['Patch 10 standalone', 'tools/test-tennis-patch10-standalone.js'],
  ['Patch 9 standalone compatibility', 'tools/test-tennis-patch9-standalone.js'],
  ['frontend public', 'public/app.js'],
  ['frontend backend/public', 'backend/public/app.js']
];
for (const [name, file] of syntaxFiles) run(`Node syntax - ${name}`, ['--check', file]);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 9 standalone compatibility', ['tools/test-tennis-patch9-standalone.js']);
run('Patch 10 standalone tests', ['tools/test-tennis-patch10-standalone.js']);
run('Patch 9 source verifier compatibility', ['tools/verify-tennis-patch9.js', '--source-only']);

if (!sourceOnly) {
  run('Patch 10 + compatibility Jest tests', [
    'node_modules/jest/bin/jest.js',
    'backend/tests/patch10TennisQualityGatePerformanceAlignment.test.js',
    'backend/tests/patch9TennisForwardCohortsAndOperationsUi.test.js',
    'backend/tests/patch8TennisForwardLifecycleAtomicity.test.js',
    'backend/tests/patch7TennisPredictionSnapshotForward.test.js',
    'backend/tests/patch6TennisCalibrationEligibilityShadow.test.js',
    'backend/tests/patch5TennisSettlementEvidenceContract.test.js',
    'backend/tests/patch4TennisClvDataContract.test.js',
    'backend/tests/patch3TennisCanonicalEventIdentity.test.js',
    'backend/tests/patch2TennisMatchFormatContract.test.js',
    'backend/tests/patch1TennisPatchRegistryAndPipeline.test.js',
    'backend/tests/server.tennis.health.test.js',
    '--runInBand'
  ]);
  run('Patch 9 full verifier and regressions', ['tools/verify-tennis-patch9.js']);
  run('Tennis core regression suite', [
    'node_modules/jest/bin/jest.js',
    'backend/tests/server.tennis.professional.test.js',
    'backend/tests/server.tennis.health.test.js',
    'backend/tests/server.tennis.optimize.test.js',
    'backend/tests/tennisValueEvaluator.test.js',
    'backend/tests/paperTrading.tennis.test.js',
    '--runInBand'
  ]);
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sameApp = fs.readFileSync(path.join(ROOT,'public','app.js')).equals(fs.readFileSync(path.join(ROOT,'backend','public','app.js')));
const sameIndex = fs.readFileSync(path.join(ROOT,'public','index.html')).equals(fs.readFileSync(path.join(ROOT,'backend','public','index.html')));
const server = read('backend/server.tennis.js');
const moduleSource = read('backend/tennisQualityGateV2.js');
const app = read('public/app.js');
const index = read('public/index.html');
const registry = require(path.join(ROOT,'backend','tennisPatchRegistry.js'));
const inventoryBuilder = read('tools/build-tennis-patch-inventory.js');
const baseStart = moduleSource.indexOf('function evaluateBaseQualityGate');
const baseEnd = moduleSource.indexOf('function resolveQualityStake');
const baseBody = moduleSource.slice(baseStart, baseEnd);
const ids = [...index.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
const qualityEndpointSegment = server.slice(server.indexOf("router.get('/quality-gate-health'"), server.indexOf("router.get('/calibration-readiness'"));
const sourceChecks = [
  ['Frontend copies identical', sameApp && sameIndex, { sameApp, sameIndex }],
  ['Inventory builder excludes generated self-reference', inventoryBuilder.includes("TENNIS_INVENTORY_BUILDER_REVISION = 'PATCH10_R1_SELF_EXCLUSION'") && inventoryBuilder.includes('path.resolve(file) === normalizedOutputPath'), {}],
  ['Registry Patch 10 active', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 10 && registry.PATCHES.some(p => p.version === '9' && p.status === 'ACTIVE') && registry.PATCHES.some(p => p.version === '10' && p.status === 'ACTIVE'), {}],
  ['Base Quality precedes final fusion', server.includes('PATCH10_QUALITY_BASE_BEFORE_DEEPSCAN') && server.includes('PATCH10_QUALITY_FINAL_AFTER_DEEPSCAN') && server.indexOf('PATCH10_QUALITY_BASE_BEFORE_DEEPSCAN') < server.indexOf('PATCH10_QUALITY_FINAL_AFTER_DEEPSCAN'), {}],
  ['Base Quality computed and persisted on insert/update', (server.match(/const qualityBase = tennisQualityGateV2\.evaluateBaseQualityGate\(bet\);/g) || []).length >= 2 && (server.match(/\['quality_base_code', qualityBase\.code\]/g) || []).length >= 2, {}],
  ['Base Quality excludes result and CLV', !/input\.(?:status|profit|clv(?:_pct)?|closing_odd|settlement)/i.test(baseBody), {}],
  ['DeepScan remains separate', moduleSource.includes('deepScanKeptSeparate: true') && server.includes('deepScanOperationalGate') && server.includes('qualityFinal: patch10FinalQuality'), {}],
  ['Technical Edge no automatic approval', moduleSource.includes('EDGE TECNICO non è conferma') && moduleSource.includes('exceptionalIndependentBase'), {}],
  ['High Risk dominates positive wording', moduleSource.indexOf("['ALTO RISCHIO'") < moduleSource.indexOf("['VALUE CONFERMATO'"), {}],
  ['Stake modes explicit', moduleSource.includes('FIXED_MICRO_2_EUR') && moduleSource.includes('BANKROLL_PERCENT_CAP') && moduleSource.includes('const capPct'), {}],
  ['Quality endpoint read-only source', server.includes("router.get('/quality-gate-health'") && server.includes('buildQualityPerformanceAudit(rows)') && !qualityEndpointSegment.includes('UPDATE ai_forward_test'), {}],
  ['Dashboard final gate precedence', app.includes('normalizePatch10FinalQualityCategory') && app.includes('Resa Qualità / Gate finale') && app.indexOf('return normalizePatch10FinalQualityCategory(row)') < app.indexOf('if (step90Label) return step90Label;'), {}],
  ['Operations center Patch 1-10', (index.match(/data-tennis-patch=["']\d+["']/g) || []).length >= 10 && index.includes('tennisQualityGatePanel') && app.includes('/api/tennis/quality-gate-health'), {}],
  ['No duplicate HTML ids', duplicates.length === 0, { duplicates }],
  ['No Soccer/Calcio Patch 10 module', !server.includes("require('./calcioQualityGateV2')") && !moduleSource.toUpperCase().includes('CALCIO_'), {}]
];
for (const [name, passed, extra] of sourceChecks) {
  results.push({ name, passed, ...extra });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) success = false;
}

const report = { success, patch:'10', sourceOnly, timestamp:new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT,'audit_patch10'), { recursive:true });
fs.writeFileSync(path.join(ROOT,'audit_patch10','patch10_verification_report.json'), JSON.stringify(report,null,2));
console.log('\nReport: audit_patch10\\patch10_verification_report.json');
if (!success) process.exit(2);
