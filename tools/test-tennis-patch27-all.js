#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const results = [];
function check(name, fn) { try { fn(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: error.message }); } }
function text(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const registry = require('../backend/tennisPatchRegistry');
const deep = require('../backend/deepScanTennis');
const cohorts = require('../backend/tennisForwardCohorts');
check('registry Tennis 27 attivo', () => assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION, '27'));
check('registry globale 37 preservato', () => assert.equal(String(require('../backend/calcioPatchRegistry').CALCIO_CURRENT_PATCH_VERSION), '37'));
check('DeepScan Patch 27 attivo', () => assert.ok(deep.DEEP_SCAN_TENNIS_VERSION.includes('PATCH27')));
check('cache RAM limitata disponibile', () => { const h = deep.getPatch27PerformanceHealth(); assert.equal(h.cacheLimits.maxEntriesPerCache, 256); assert.equal(h.stakeAuthority, false); });
check('deduplicazione in-flight disponibile', () => assert.ok(text('backend/deepScanTennis.js').includes('patch27NewsInFlight')));
check('H2H usa POST configurato correttamente', () => { const s=text('backend/deepScanTennis.js'); assert.ok(s.includes("method: 'POST'")); assert.ok(s.includes('data: `q=${encodeURIComponent(query)}&kl=&df=`')); });
check('nessuna pausa iniziale artificiale sui fetch', () => assert.ok(text('backend/deepScanTennis.js').includes("if (i > 0) await new Promise")));
check('queue Tennis usa pacing 150 ms', () => assert.ok(text('public/app.js').includes('sport === SPORT.TENNIS ? 150 : 4000')));
check('Calcio conserva pacing legacy', () => assert.ok(text('public/app.js').includes('? 150 : 4000')));
check('badge usa nomi giocatori leggibili', () => { const s=text('public/app.js'); assert.ok(s.includes('Dati giocatori: vantaggio')); assert.ok(s.includes('più prudente del modello principale')); });
check('badge non stampa più raw SHADOW', () => { const s=text('public/app.js'); const a=s.indexOf('function renderPatch12MatchupBadge'); const b=s.indexOf('function renderPatch12MatchupDetail',a); const block=s.slice(a,b); assert.ok(!block.includes('· SHADOW')); assert.ok(!block.includes('info.matchupLabel || info.matchupStatus')); });
check('dettaglio distingue modello e stima giocatori', () => { const s=text('public/app.js'); assert.ok(s.includes('Modello principale')); assert.ok(s.includes('Stima dati giocatori')); assert.ok(s.includes('Differenza spiegata')); });
check('frontend copie sincronizzate', () => assert.deepEqual(fs.readFileSync(path.join(root,'public/app.js')), fs.readFileSync(path.join(root,'backend/public/app.js'))));
check('reconcile coorti esportato', () => assert.equal(typeof cohorts.reconcileForwardCohortMaturity, 'function'));
check('reconcile aggiorna solo stato derivato', () => { const s=text('backend/tennisForwardCohorts.js'); const a=s.indexOf('function reconcileForwardCohortMaturity'); const b=s.indexOf('function scanForwardCohorts',a); const block=s.slice(a,b); assert.ok(block.includes('refreshForwardCohortMaturity')); assert.ok(!block.includes('seal_hash=')); assert.ok(!block.includes('snapshot_hash=')); });
check('runtime reconcile periodico non blocca Node', () => { const s=text('backend/server.tennis.js'); assert.ok(s.includes("runPatch27CohortDerivedStateReconcile('startup')")); assert.ok(s.includes('15 * 60 * 1000')); assert.ok(s.includes('unref?.()')); });
check('endpoint performance read-only presente', () => assert.ok(text('backend/server.tennis.js').includes("router.get('/deepscan-performance-health'")));
check('diagnostica coorti spiegata', () => { const s=text('public/app.js'); assert.ok(s.includes('Stato eventi forward da riallineare')); assert.ok(s.includes('sigilli restano integri')); });
check('nessuna autorità operativa cache', () => { const h=deep.getPatch27PerformanceHealth(); assert.equal(h.probabilityAuthority,false); assert.equal(h.stakeAuthority,false); assert.equal(h.newOddsApiCalls,0); });
check('inventario Tennis allineato a 27', () => { const i=JSON.parse(text('backend/tennis_patch_inventory.json')); assert.equal(String(i.registry.currentPatchVersion),'27'); assert.equal(Number(i.summary.unregisteredCount),0); });
check('package scripts Patch 27 presenti', () => { const p=require('../package.json'); assert.ok(p.scripts['verify:tennis:patch27']); assert.ok(p.scripts['audit:tennis:patch27']); });
const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({ success: failed.length===0, patch:'TENNIS_PATCH_27_DEEPSCAN_RAM_CACHE_EXPLAINABLE_MATCHUP_COHORT_RECONCILIATION', checks:results.length, passed:results.length-failed.length, failed:failed.length, results },null,2));
process.exit(failed.length?1:0);
