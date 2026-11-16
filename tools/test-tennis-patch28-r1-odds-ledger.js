#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ledgerModule = require('../backend/oddsApiUsageLedger');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch28-r1-ledger-'));
const file = path.join(dir, 'ledger.json');
const results = [];
function check(name, ok, details) { results.push({ name, ok: Boolean(ok), ...(details ? {details} : {}) }); }
try {
  const normal = ledgerModule.createLedger({ file, nowFn: () => new Date('2026-07-29T10:00:00Z') });
  const attempt = normal.recordAttempt({ key:'secret', source:'test', operation:'odds', route:'fixture', urlTemplate:'https://example/odds/?apiKey=API_KEY_PLACEHOLDER' });
  normal.recordResponse({ attemptId:attempt.attemptId, key:'secret', source:'test', operation:'odds', route:'fixture', urlTemplate:'https://example/odds/?apiKey=API_KEY_PLACEHOLDER', headers:{'x-requests-used':'1','x-requests-remaining':'99','x-requests-last':'1'}, statusCode:200, data:[{id:1}] });
  check('scrittura ledger normale', fs.existsSync(file));
  check('ledger normale contabilizza risposta', normal.state().successes === 1);

  let writes = 0;
  const degraded = ledgerModule.createLedger({ file:path.join(dir,'degraded.json'), nowFn:()=>new Date('2026-07-29T10:00:00Z'), writeFn:()=>{ writes++; const e=new Error('simulated Windows EPERM'); e.code='EPERM'; throw e; } });
  let threw = false; let degradedAttempt = null;
  try { degradedAttempt = degraded.recordAttempt({key:'secret',source:'test',operation:'odds',urlTemplate:'https://example/odds/?apiKey=API_KEY_PLACEHOLDER'}); } catch (_) { threw = true; }
  try { degraded.recordResponse({attemptId:degradedAttempt?.attemptId,key:'secret',source:'test',operation:'odds',urlTemplate:'https://example/odds/?apiKey=API_KEY_PLACEHOLDER',headers:{},statusCode:200,data:[1]}); } catch (_) { threw = true; }
  check('EPERM diagnostico non interrompe il provider', !threw);
  check('stato resta disponibile in memoria', degraded.state().attempts === 1 && degraded.state().successes === 1);
  check('persistenza degradata esplicita', degraded.persistenceHealth().ok === false && degraded.persistenceHealth().mode === 'MEMORY_ONLY_EXCEPTION');
  check('writer invocato senza loop incontrollato', writes === 2);
  const atomic = ledgerModule.writeJsonAtomicResilient(path.join(dir,'atomic.json'), {ok:true}, {retryDelaysMs:[1]});
  check('writer atomico resiliente operativo', atomic.ok === true && fs.existsSync(path.join(dir,'atomic.json')));
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
const failed=results.filter(x=>!x.ok);
const out={success:failed.length===0,patch:'TENNIS_PATCH_28_R1',checks:results.length,results};
console.log(JSON.stringify(out,null,2));
process.exitCode=out.success?0:1;
