const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const deepTest = read('backend/tests/deepScanTennis.balancedTaxonomy.test.js');
assert(deepTest.includes('Number.parseFloat(versionToken)'));
assert(!deepTest.includes("DEEP_SCAN_TENNIS_VERSION = '14.6'"));
assert(!deepTest.includes('🟢 VIA LIBERA / LOW-MEDIUM EDGE'));
console.log('PASS Step18 DeepScan test reso compatibile con versioni moderne');

const repairTest = read('backend/tests/repairTennisDeepScanAdvisory.test.js');
assert(repairTest.includes('repairExists ? fs.readFileSync'));
assert(repairTest.includes('applyStep101RiskModelSoftMicroToBet'));
console.log('PASS repair DeepScan advisory test non fallisce se il repair legacy è stato rimosso');

const serverTest = read('backend/tests/server.calcio.source.test.js');
assert(serverTest.includes('trackClosingLines[\\s\\S]*buildClvSmartFetchPlan'));
assert(!serverTest.includes("const { trackClosingLines, buildClvSmartFetchPlan } = require('./clvTracker')"));
console.log('PASS server Calcio source test accetta import CLV esteso Step103');

const evaluatorSource = read('backend/value_evaluator.js');
assert(evaluatorSource.includes('STEP112_CLV_STRUCTURAL_EVIDENCE_COMPAT'));
assert(evaluatorSource.includes('hasClosingOddEvidence'));
assert(evaluatorSource.includes('hasDirectPctEvidence'));

const evaluator = require(path.join(root, 'backend/value_evaluator'));
let report = evaluator.calculateCLVAnalytics([{ odd: 1.56, clv_edge: 15.5556, status: 'PENDING' }]);
assert.strictEqual(report.sampleSize, 1);
assert(Math.abs(report.avgCLV - 15.56) < 0.05);

report = evaluator.calculateCLVAnalytics([{ odd: 1.56, clv: 1.35, status: 'PENDING' }]);
assert.strictEqual(report.sampleSize, 1);
assert(Math.abs(report.avgCLV - 15.56) < 0.05);

report = evaluator.calculateCLVAnalytics([
  { sport_type: 'CALCIO', sport: 'football', odd: 2.00, open_odd: 2.00, closing_odd: 1.90, status: 'WON' },
  { sport_type: 'CALCIO', sport: 'football', odd: 1.80, open_odd: 1.80, closing_odd: 1.90, status: 'WON' },
  { sport_type: 'CALCIO', sport: 'football', odd: 2.20, open_odd: 2.20, closing_odd: 2.00, status: 'WON' }
]);
assert.strictEqual(report.sampleSize, 3);
assert(Math.abs(report.positiveRate - 66.67) < 0.1);

report = evaluator.calculateCLVAnalytics([{ odd: 1.56, clv: 0 }]);
assert.strictEqual(report.sampleSize, 0);
assert.strictEqual(report.verified, false);
console.log('PASS value_evaluator CLV analytics ripristina sample verificabile senza sbloccare clv=0');

console.log('STEP112 standalone audit complete: stale tests + CLV analytics compatibility OK.');
