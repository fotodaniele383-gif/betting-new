'use strict';

const Module = require('module');
const assert = require('assert');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'axios') return async function() { const error = new Error('PATCH26_TEST_NETWORK_DISABLED'); error.code = 'PATCH26_TEST_NETWORK_DISABLED'; throw error; };
  if (request === 'cheerio') return { load() { const fn = function() { return { each() { return this; }, text() { return ''; }, find() { return this; }, attr() { return null; } }; }; fn.text = () => ''; return fn; } };
  return originalLoad.call(this, request, parent, isMain);
};

const deepScan = require('../backend/deepScanTennis');

(async () => {
  const results = [];
  function check(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  }
  const atp = await deepScan.scanMatchup('Ben Shelton','Martin Damm Jr.','1',1.38,83.33,10.87,1.38,3.2,{ league:'[ATP] ATP500', tournament:'Washington', surface:'Hard' });
  const wta = await deepScan.scanMatchup('Elisabetta Cocciaretto','Emma Navarro','2',1.50,78.75,12.08,2.6,1.50,{ league:'[WTA] WTA500', tournament:'Montreal', surface:'Hard' });
  check('ATP DeepScan runtime completo', () => assert.equal(atp.success, true));
  check('alias Martin Damm Jr risolto nel report', () => assert.equal(atp.canonicalPlayerEvidenceBridge.p2.canonicalPlayerName, 'Martin Damm'));
  check('ATP dominance ratio reale e non placeholder', () => assert.ok(atp.canonicalPlayerEvidenceBridge.p2.dominanceRatio > 1));
  check('WTA ranking ed Elo correnti recuperati', () => { assert.equal(wta.canonicalPlayerEvidenceBridge.p1.currentRank, 68); assert.equal(wta.canonicalPlayerEvidenceBridge.p2.currentRank, 26); assert.equal(wta.canonicalPlayerEvidenceBridge.p2.overallElo, 1877); });
  check('WTA tecnica stale esplicita e probabilità invariata', () => { assert.equal(wta.canonicalPlayerEvidenceBridge.status, 'READY_WITH_STALE_TECHNICAL'); assert.equal(wta.adjustedProbability, 78.75); });
  check('report senza Rank 500 o DR 1.00 fittizi', () => { const html = `${atp.reason || ''}${wta.reason || ''}`; assert.ok(!/>500</.test(html)); assert.ok(!html.includes('DR Est.: 1.00')); assert.ok(html.includes('Canonical Player Evidence')); });
  const failed = results.filter(item => !item.ok);
  console.log(JSON.stringify({ success: failed.length === 0, checks: results.length, results }, null, 2));
  if (failed.length) process.exit(1);
})().catch(error => { console.error(JSON.stringify({ success:false,error:error.message },null,2)); process.exit(1); });
