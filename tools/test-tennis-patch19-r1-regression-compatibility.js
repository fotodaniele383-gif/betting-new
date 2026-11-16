
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
function fail(message) { throw new Error(message); }
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry'));
const publicHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const backendHtml = fs.readFileSync(path.join(root, 'backend', 'public', 'index.html'), 'utf8');
const legacyTest = fs.readFileSync(path.join(root, 'backend', 'tests', 'patch16TennisHistoricalPlayerStatsShadowEvidence.test.js'), 'utf8');
const displayed = publicHtml.match(/Patch 1–(\d+)/);
if (!displayed) fail('UI_PATCH_RANGE_MISSING');
if (Number(displayed[1]) !== Number(registry.TENNIS_CURRENT_PATCH_VERSION)) fail(`UI_REGISTRY_MISMATCH:${displayed[1]}!=${registry.TENNIS_CURRENT_PATCH_VERSION}`);
if (Number(displayed[1]) < 16) fail(`UI_PATCH_RANGE_BELOW_16:${displayed[1]}`);
if (!publicHtml.includes('data-tennis-patch="16"')) fail('PATCH16_UI_MARKER_MISSING');
if (publicHtml !== backendHtml) fail('FRONTEND_COPIES_DIFFER');
if (/Patch 1–\(\?:16\|17\|18\)/.test(legacyTest)) fail('FINITE_PATCH16_UI_ENUMERATION_STILL_PRESENT');
if (!legacyTest.includes("html.match(/Patch 1–(\\d+)/)")) fail('DYNAMIC_UI_VERSION_ASSERTION_MISSING');
if (!legacyTest.includes('registry.TENNIS_CURRENT_PATCH_VERSION')) fail('REGISTRY_ALIGNED_UI_ASSERTION_MISSING');
const report = {
  success: true,
  patch: '19-R1',
  displayedPatch: Number(displayed[1]),
  registryPatch: Number(registry.TENNIS_CURRENT_PATCH_VERSION),
  patch16MarkerPreserved: true,
  frontendCopiesIdentical: true,
  finiteEnumerationRemoved: true,
  policy: 'DYNAMIC_UI_RANGE_MUST_MATCH_CURRENT_REGISTRY',
  generatedAt: new Date().toISOString()
};
console.log(JSON.stringify(report, null, 2));
