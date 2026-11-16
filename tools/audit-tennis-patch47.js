#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const cp=require('child_process');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const checks=[];
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function add(name,ok,details=null,severity='error'){checks.push({name,ok:Boolean(ok),severity,details});}
try{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const registryPath=path.join(root,'backend','tennisPatchRegistry.js');delete require.cache[require.resolve(registryPath)];const registry=require(registryPath);
 const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend','tennis_patch_inventory.json'),'utf8'));
 const ledgerPath=path.join(root,'backend','tennisClvDegradedLedgerPatch47.js');delete require.cache[require.resolve(ledgerPath)];const ledger=require(ledgerPath);
 const tracker=fs.readFileSync(path.join(root,'backend','clvTracker.js'),'utf8');const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
 add('Package Patch47 o successivo',Number(String(pkg.version).split('.')[1])>=34,{actual:pkg.version});
 add('Registry Patch47 o successivo',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=47&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`,{current:registry.TENNIS_CURRENT_PATCH_VERSION,registryVersion:registry.TENNIS_PATCH_REGISTRY_VERSION});
 add('Voce Patch46 preservata',registry.PATCHES.some(x=>x.version==='46'&&/Stake authority semantic separation/i.test(x.title)));
 add('Voce Patch47 registrata',registry.PATCHES.some(x=>x.version==='47'&&/CLV degraded ledger/i.test(x.title)));
 add('Inventory Patch47 o successivo',Number(inventory.registry?.currentPatchVersion)>=47&&inventory.registry?.registryVersion===`TENNIS_PATCH_REGISTRY_V${inventory.registry?.currentPatchVersion}`,inventory.registry);
 add('Versione ledger canonica',ledger.TENNIS_CLV_DEGRADED_LEDGER_VERSION==='TENNIS_CLV_DEGRADED_LEDGER_V1_PATCH47');
 add('Otto stati contrattuali',Object.keys(ledger.STATES).length===8,ledger.STATES);
 add('Stati terminali definiti',ledger.TERMINAL_STATES.includes('IRRECOVERABLE_TEMPORAL')&&ledger.TERMINAL_STATES.includes('IRRECOVERABLE_MARKET')&&ledger.TERMINAL_STATES.includes('MAX_ATTEMPTS_EXHAUSTED'),ledger.TERMINAL_STATES);
 add('Tracker usa chiave idempotente',tracker.includes('patch47Semantic.unchanged')&&tracker.includes('evidenza closing invariata'));
 add('Idempotenza precede lifecycle',tracker.indexOf('patch47Semantic.unchanged')<tracker.indexOf('executeAtomicLifecycleTransition'));
 add('Ledger inserito nel lifecycle atomico',tracker.includes('appendLedger(db, { ...bet, ...fields }')&&tracker.includes('ledgerEntry'));
 add('Query esclude stati terminali',tracker.includes("'VERIFIED','IRRECOVERABLE_TEMPORAL','IRRECOVERABLE_MARKET'")&&tracker.includes("'MAX_ATTEMPTS_EXHAUSTED','MANUAL_REVIEW'"));
 add('Runtime espone metriche separate',tracker.includes('newLocks')&&tracker.includes('unchangedEvidence')&&tracker.includes('availableUnverified')&&tracker.includes('irrecoverable'));
 add('Server espone Patch47',server.includes('[CLV AUTO PATCH47]')&&server.includes('[CLV STATUS PATCH47]'));
 add('Script npm Patch47 presenti',['preview:tennis:patch47','migrate:tennis:patch47','test:tennis:patch47','verify:tennis:patch47','audit:tennis:patch47','rollback:tennis:patch47'].every(k=>Boolean(pkg.scripts?.[k])));
 add('Frontend mirror preservato',sha(path.join(root,'public','app.js'))===sha(path.join(root,'backend','public','app.js'))&&sha(path.join(root,'public','index.html'))===sha(path.join(root,'backend','public','index.html')));
 const syntaxFiles=['backend/tennisClvDegradedLedgerPatch47.js','backend/migrateTennisPatch47.js','backend/clvTracker.js','backend/server.js'];const syntaxErrors=[];
 for(const rel of syntaxFiles){const run=cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'});if(run.status!==0)syntaxErrors.push({file:rel,error:run.stderr});}
 add('Sintassi moduli Patch47',syntaxErrors.length===0,syntaxErrors);
 const dbPath=path.join(root,'backend','database_betting.db');const db=new DatabaseSync(dbPath,{readOnly:true,open:true});
 try{
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();
  add('Database integro',String(integrity).toLowerCase()==='ok'&&fk.length===0,{integrity,foreignKeyViolations:fk.length});
  const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));add('Schema semantic ledger completo',ledger.SEMANTIC_COLUMNS.every(c=>cols.has(c)),{missing:ledger.SEMANTIC_COLUMNS.filter(c=>!cols.has(c))});
  const table=Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_clv_degraded_ledger_patch47'").get());add('Tabella ledger presente',table);
  const triggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tennis_clv_degraded_ledger_patch47' ORDER BY name").all().map(r=>r.name);add('Ledger append-only',triggers.some(n=>n.includes('no_update'))&&triggers.some(n=>n.includes('no_delete')),{triggers});
  const where=`(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%') AND UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST') AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%'`;
  const operational=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where}`).get().n);
  const coverage=ledger.getOperationalCoverage(db);
  const covered=Number(coverage.fullyCovered||0);
  add('Copertura operativa completa',covered===operational,{operational,covered,semanticCovered:coverage.semanticCovered,missingLedgerLinks:coverage.missingLedgerLinks});
  const invalidStates=Number(coverage.invalidStates||0);add('Nessuno stato fuori contratto',invalidStates===0,{invalidStates});
  add('Ogni stato operativo ha evidenza ledger',Number(coverage.missingLedgerLinks||0)===0,{missingLedgerLinks:coverage.missingLedgerLinks});
  const duplicateKeys=Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT bet_id,evidence_key,degraded_state,COUNT(*) c FROM tennis_clv_degraded_ledger_patch47 GROUP BY bet_id,evidence_key,degraded_state HAVING c>1)`).get().n);add('Nessuna evidenza ledger duplicata',duplicateKeys===0,{duplicateKeys});
  const terminalRetry=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(clv_degraded_state,'')) IN (${ledger.TERMINAL_STATES.map(()=>'?').join(',')}) AND COALESCE(clv_retry_eligible,0)<>0`).get(...ledger.TERMINAL_STATES).n);add('Stati terminali senza retry',terminalRetry===0,{terminalRetry});
  const verifiedMismatch=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND clv_degraded_state='VERIFIED' AND COALESCE(clv_verified,0)<>1`).get().n);add('Verified ledger coerente con contratto',verifiedMismatch===0,{verifiedMismatch});
  const terminalCandidates=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${where} AND UPPER(COALESCE(clv_degraded_state,'')) IN (${ledger.TERMINAL_STATES.map(()=>'?').join(',')}) AND COALESCE(clv_retry_eligible,0)=1`).get(...ledger.TERMINAL_STATES).n);add('Terminali esclusi dalla pianificazione',terminalCandidates===0,{terminalCandidates});
  const summary=ledger.getLedgerSummary(db);add('Summary ledger leggibile',summary.ledgerRows>=operational&&summary.terminal>=0&&summary.retryEligible>=0,summary);
  const stakeTable=Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_stake_execution_contracts_patch46'").get());add('Contratto stake Patch46 preservato',stakeTable);
 }finally{db.close();}
 const failed=checks.filter(x=>!x.ok&&x.severity==='error');const warnings=checks.filter(x=>!x.ok&&x.severity==='warn');
 console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',revision:'R1_WINDOWS_NODE_CLV_LEDGER_IDEMPOTENT_TERMINAL_STATES',checks:checks.length,errors:failed.length,warnings:warnings.length,details:checks},null,2));if(failed.length)process.exit(1);
}catch(error){console.log(JSON.stringify({success:false,patch:'47',error:error.stack||error.message,details:checks},null,2));process.exit(1);}
