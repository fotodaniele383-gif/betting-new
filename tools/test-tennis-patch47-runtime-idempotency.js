#!/usr/bin/env node
'use strict';
const path=require('path');const Module=require('module');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const checks=[];function check(name,ok,details=null){checks.push({name,ok:Boolean(ok),details});}
const originalLoad=Module._load;let axiosCalls=0;Module._load=function(request){if(request==='axios')return{get:async()=>{axiosCalls++;throw new Error('PATCH47_NETWORK_FORBIDDEN')}};return originalLoad.apply(this,arguments);};
const lifecycle=require(path.join(root,'backend','tennisForwardLifecycle.js'));const diagnostics=require(path.join(root,'backend','runtimeDiagnostics.js'));
const originalTransition=lifecycle.executeAtomicLifecycleTransition,originalCapture=diagnostics.captureError,originalLog=console.log,originalWarn=console.warn;
let lifecycleCalls=0;console.log=()=>{};console.warn=()=>{};diagnostics.captureError=()=>({captured:true});
try{
 const trackerPath=path.join(root,'backend','clvTracker.js');delete require.cache[require.resolve(trackerPath)];const tracker=require(trackerPath);
 const db=new DatabaseSync(':memory:');
 db.transaction=(fn)=>()=>fn();
 db.exec(`CREATE TABLE ai_forward_test (id INTEGER PRIMARY KEY,odd REAL,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,model_version TEXT,metric_version TEXT,data_quality TEXT,prediction TEXT,home_team TEXT,away_team TEXT,tennis_event_fingerprint TEXT,tennis_market_fingerprint TEXT,provider_event_id TEXT,canonical_match_datetime TEXT,match_date TEXT,created_at TEXT,point_line REAL,status TEXT,stake REAL);`);
 tracker.ensureClvColumns(db);
 lifecycle.executeAtomicLifecycleTransition=(database,config,mutator)=>{lifecycleCalls++;database.exec('BEGIN IMMEDIATE');try{const mutationResult=mutator();database.exec('COMMIT');return{success:true,mutationResult,config};}catch(error){database.exec('ROLLBACK');throw error;}};
 const now=new Date('2026-08-05T07:15:00Z');
 const bet={id:47011,odd:2,sport_type:'TENNIS',bet_type:'TENNIS_ATP_MONEYLINE',strategy_tag:'TENNIS_ATP_MONEYLINE',data_quality:'CURRENT_BOOTSTRAP',prediction:'1',home_team:'Player A',away_team:'Player B',tennis_event_fingerprint:'EV47A',tennis_market_fingerprint:'MK47A',provider_event_id:'PROV47A',canonical_match_datetime:'2026-08-05T12:00:00Z',match_date:'05/08/2026, 12:00:00',created_at:'2026-08-05T06:00:00Z',point_line:null,status:'PENDING',stake:2};
 db.prepare(`INSERT INTO ai_forward_test(id,odd,sport_type,bet_type,strategy_tag,data_quality,prediction,home_team,away_team,tennis_event_fingerprint,tennis_market_fingerprint,provider_event_id,canonical_match_datetime,match_date,created_at,point_line,status,stake) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...[bet.id,bet.odd,bet.sport_type,bet.bet_type,bet.strategy_tag,bet.data_quality,bet.prediction,bet.home_team,bet.away_team,bet.tennis_event_fingerprint,bet.tennis_market_fingerprint,bet.provider_event_id,bet.canonical_match_datetime,bet.match_date,bet.created_at,bet.point_line,bet.status,bet.stake]);
 const metrics=tracker.createPatch47ClvMetrics();
 const opts={openingTimestamp:'2026-08-05T06:00:00Z',closingTimestamp:'2026-08-05T07:00:00Z',sourceEventId:'PROV47A',now,metrics};
 const first=tracker.updateClvLock(db,bet,1.8,[{title:'Pinnacle'},{title:'Betfair'}],'LIVE_API',opts);
 const fresh=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(bet.id);
 const second=tracker.updateClvLock(db,fresh,1.8,[{title:'Betfair'},{title:'Pinnacle'}],'LIVE_API',opts);
 const ledgerCount=Number(db.prepare('SELECT COUNT(*) n FROM tennis_clv_degraded_ledger_patch47').get().n);
 check('Prima evidenza crea lock',first===true);
 check('Seconda evidenza identica non aggiorna',second===false);
 check('Un solo lifecycle CLV_LOCK',lifecycleCalls===1,{lifecycleCalls});
 check('Una sola riga ledger',ledgerCount===1,{ledgerCount});
 check('Metriche separano new e unchanged',metrics.newLocks===1&&metrics.unchangedEvidence===1,metrics);
 check('Riga VERIFIED terminale',fresh.clv_degraded_state==='VERIFIED'&&fresh.clv_retry_eligible===0,fresh);
 const terminalCandidates=tracker.getBetsNeedingClv(db).filter(r=>Number(r.id)===bet.id);
 check('Verified esclusa dai candidati',terminalCandidates.length===0,terminalCandidates);
 // Evidenza post-match non verificabile: primo evento, poi idempotenza.
 const bad={...bet,id:47012,provider_event_id:'PROV47B',tennis_event_fingerprint:'EV47B',tennis_market_fingerprint:'MK47B',canonical_match_datetime:'2026-08-04T12:00:00Z',match_date:'04/08/2026, 12:00:00'};
 db.prepare(`INSERT INTO ai_forward_test(id,odd,sport_type,bet_type,strategy_tag,data_quality,prediction,home_team,away_team,tennis_event_fingerprint,tennis_market_fingerprint,provider_event_id,canonical_match_datetime,match_date,created_at,point_line,status,stake) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...[bad.id,bad.odd,bad.sport_type,bad.bet_type,bad.strategy_tag,bad.data_quality,bad.prediction,bad.home_team,bad.away_team,bad.tennis_event_fingerprint,bad.tennis_market_fingerprint,bad.provider_event_id,bad.canonical_match_datetime,bad.match_date,bad.created_at,bad.point_line,bad.status,bad.stake]);
 const badOpts={openingTimestamp:'2026-08-04T09:00:00Z',closingTimestamp:'2026-08-04T13:00:00Z',sourceEventId:'PROV47B',now,metrics};
 const badFirst=tracker.updateClvLock(db,bad,6.8,[{title:'Pinnacle'}],'POST_MATCH_VAULT',badOpts);
 const badFresh=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(bad.id);
 const badSecond=tracker.updateClvLock(db,badFresh,6.8,[{title:'Pinnacle'}],'POST_MATCH_VAULT',badOpts);
 check('Post-match evidence persistita una volta',badFirst===true&&badSecond===false,{badFirst,badSecond});
 check('Post-match classificata irrecoverable temporal',badFresh.clv_degraded_state==='IRRECOVERABLE_TEMPORAL'&&badFresh.clv_verified===0,badFresh);
 check('Nessuna chiamata API',axiosCalls===0,{axiosCalls});
 db.close();
}catch(error){checks.push({name:'Eccezione suite',ok:false,details:error.stack||error.message});}
finally{lifecycle.executeAtomicLifecycleTransition=originalTransition;diagnostics.captureError=originalCapture;Module._load=originalLoad;console.log=originalLog;console.warn=originalWarn;}
const failed=checks.filter(x=>!x.ok);originalLog(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',suite:'PATCH47_RUNTIME_IDEMPOTENCY',checks:checks.length,details:checks,failures:failed},null,2));if(failed.length)process.exit(1);
