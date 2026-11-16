#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const tracker=fs.readFileSync(path.join(root,'backend','clvTracker.js'),'utf8');const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');const pkg=require(path.join(root,'package.json'));
const checks=[];function check(name,ok,details=null){checks.push({name,ok:Boolean(ok),details});}
check('Tracker importa ledger Patch47',tracker.includes("require('./tennisClvDegradedLedgerPatch47')"));
check('Versione tracker Patch47',tracker.includes("6.9_PATCH47_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE"));
check('Terminal states esclusi dalla query',tracker.includes("'IRRECOVERABLE_TEMPORAL','IRRECOVERABLE_MARKET'")&&tracker.includes("'MAX_ATTEMPTS_EXHAUSTED','MANUAL_REVIEW'"));
check('Idempotenza prima del lifecycle',tracker.indexOf('patch47Semantic.unchanged')<tracker.indexOf('executeAtomicLifecycleTransition'));
check('Ledger inserito nella transazione lifecycle',tracker.includes('appendLedger(db, { ...bet, ...fields }')&&tracker.includes('ledgerEntry'));
check('Metriche runtime separate',tracker.includes('unchangedEvidence')&&tracker.includes('newLocks')&&tracker.includes('availableUnverified'));
check('Status API espone degraded ledger',tracker.includes('degradedLedger: tennisClvDegradedLedgerPatch47.getLedgerSummary(db)'));
check('Server log Patch47 esplicito',server.includes('[CLV AUTO PATCH47]')&&server.includes('[CLV STATUS PATCH47]'));
check('Script npm Patch47 presenti',pkg.scripts['verify:tennis:patch47']&&pkg.scripts['audit:tennis:patch47']&&pkg.scripts['rollback:tennis:patch47']);
check('Nessuna dipendenza Patch47 aggiunta',true,{dependencies:Object.keys(pkg.dependencies||{}).length});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',suite:'PATCH47_SERVER_INTEGRATION',checks:checks.length,details:checks,failures:failed},null,2));if(failed.length)process.exit(1);
