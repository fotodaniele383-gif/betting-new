'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const multi=require('../backend/tennisMultiProviderData');

function assert(ok,name,details=null){if(!ok){const e=new Error(`FIXTURE_FAIL:${name}`);e.details=details;throw e;}return {name,success:true};}
function csv(rows=600,start='20260701',prefix='P'){
  const headers=multi.CANONICAL_HEADERS;
  const body=[];
  for(let i=0;i<rows;i++){
    const row=Object.fromEntries(headers.map(h=>[h,'']));
    row.tourney_id=`${prefix}${Math.floor(i/16)}`;row.tourney_name=`Tournament ${prefix}`;row.surface='Hard';row.draw_size='32';row.tourney_level='A';
    const day=String(1+(i%15)).padStart(2,'0');row.tourney_date=`${start.slice(0,6)}${day}`;row.match_num=String(i+1);
    row.winner_id=String(10000+i);row.loser_id=String(20000+i);row.winner_name=`Winner ${prefix} ${i}`;row.loser_name=`Loser ${prefix} ${i}`;
    row.score='6-4 6-4';row.best_of='3';row.round='R32';row.winner_rank=String(1+(i%200));row.loser_rank=String(201+(i%200));
    body.push(headers.map(h=>String(row[h]??'')).join(','));
  }
  return `${headers.join(',')}\n${body.join('\n')}\n`;
}
function seed(dir){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'atp_matches_2026.csv'),csv(550,'20260501','OLDATP'));fs.writeFileSync(path.join(dir,'atp_matches_challenger_2026.csv'),csv(950,'20260301','OLDCH'));fs.writeFileSync(path.join(dir,'wta_matches_2026.csv'),csv(550,'20260501','OLDWTA'));}
function fakeEvidence(){let dir=null;return{init(dataDir){dir=dataDir;const files=['atp_matches_2026.csv','atp_matches_challenger_2026.csv','wta_matches_2026.csv'];const inspections=files.map(f=>{const target=multi.targetRegistry(2026).find(t=>t.localFile===f);return require('../backend/tennisPlayerDataRefresh').inspectCsvText(fs.readFileSync(path.join(dataDir,f),'utf8'),{id:target.id,localFile:f,minRows:target.minRows},{now:new Date('2026-07-17T00:00:00Z')});});return{initialized:true,fileCount:3,matchCount:inspections.reduce((n,x)=>n+x.validRows,0),playerCount:5000,rejectedRows:0,duplicateRows:0,earliestMatchAt:inspections.map(x=>x.earliestMatchAt).sort()[0],latestMatchAt:inspections.map(x=>x.latestMatchAt).sort().slice(-1)[0]};},getStatus(){return{initialized:true,matchCount:2050,playerCount:5000,latestMatchAt:'2026-07-15T12:00:00.000Z'};}};}
async function main(){const results=[];
  const providers=multi.providerRegistry({apiEnabled:false,apiKey:''});
  results.push(assert(providers[0].id==='LOCAL_CANONICAL_IMPORT'&&providers.at(-1).id==='LAST_KNOWN_GOOD','REGISTRY_PRIORITY'));
  results.push(assert(providers.find(p=>p.id==='API_TENNIS_OPTIONAL').enabled===false,'API_DISABLED_DEFAULT'));
  results.push(assert(multi.providerPlan({apiEnabled:false,apiKey:''}).retiredProviders.some(p=>p.id==='JEFF_SACKMANN_GITHUB'&&p.enabled===false&&p.retry===false),'LEGACY_UPSTREAM_DISABLED_NO_RETRY'));
  results.push(assert(!multi.sanitizeUrl('https://api.api-tennis.com/tennis/?APIkey=SECRET&method=get_fixtures').includes('SECRET'),'API_KEY_REDACTED'));
  results.push(assert(multi.tmlResources('ATP_QUAL_CHALL',2026).length===2,'TML_CHALLENGER_AND_QUALIFYING'));
  results.push(assert(multi.parseCsv(multi.normalizeCanonicalCsv(csv(5),'TENNISMYLIFE_BULK')).rows.length===5,'CANONICAL_NORMALIZATION'));
  const td='Tournament,Date,Series,Surface,Round,Best of,Winner,Loser,WRank,LRank,W1,L1,W2,L2\nRome,17/07/2026,ATP250,Clay,Quarterfinals,3,A Player,B Player,10,20,6,4,6,3\n';
  const tdRows=multi.parseCsv(multi.normalizeTennisDataCsv(td,{targetId:'ATP_MAIN'})).rows;
  results.push(assert(tdRows.length===1&&tdRows[0].round==='QF'&&tdRows[0].score==='6-4 6-3','TENNIS_DATA_ADAPTER'));
  const api={success:1,result:[{event_key:'1',event_date:'2026-07-17',event_first_player:'A',first_player_key:'11',event_second_player:'B',second_player_key:'22',event_winner:'First Player',event_status:'Finished',event_type_type:'Wta Singles',tournament_name:'Rome WTA',tournament_key:'9',tournament_round:'Quarter-finals',event_final_result:'2 - 0',scores:[{score_first:'6',score_second:'4'},{score_first:'6',score_second:'3'}]}]};
  const apiRows=multi.parseCsv(multi.normalizeApiTennisPayload(api,'WTA_MAIN')).rows;
  results.push(assert(apiRows.length===1&&apiRows[0].winner_name==='A'&&apiRows[0].round==='QF','API_TENNIS_ADAPTER'));
  const merged=multi.parseCsv(multi.mergeCanonicalCsv([csv(10,'20260701','DUP'),csv(10,'20260701','DUP')])).rows;
  results.push(assert(merged.length===10,'MERGE_DEDUP'));
  const budgetDir=fs.mkdtempSync(path.join(os.tmpdir(),'p21-budget-'));try{multi.reserveApiCall(budgetDir,{dailyBudget:1,now:new Date('2026-07-17')});let blocked=false;try{multi.reserveApiCall(budgetDir,{dailyBudget:1,now:new Date('2026-07-17')});}catch(e){blocked=/BUDGET_EXHAUSTED/.test(e.message);}results.push(assert(blocked,'API_DAILY_BUDGET'));}finally{fs.rmSync(budgetDir,{recursive:true,force:true});}
  const apiCacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'p21-api-cache-'));try{let calls=0;const requester=async()=>{calls+=1;return{statusCode:200,text:JSON.stringify(api),headers:{},url:'https://api.api-tennis.com/tennis/?APIkey=***'};};const first=await multi.fetchApiTennisOnce({dataDir:apiCacheDir,apiEnabled:true,apiKey:'SECRET',dailyBudget:2,now:new Date('2026-07-17'),requester});const second=await multi.fetchApiTennisOnce({dataDir:apiCacheDir,apiEnabled:true,apiKey:'SECRET',dailyBudget:2,now:new Date('2026-07-17'),requester});results.push(assert(first.networkCalls===1&&second.networkCalls===0&&second.fromCache===true&&calls===1,'API_CACHE_BEFORE_BUDGETED_NETWORK'));}finally{fs.rmSync(apiCacheDir,{recursive:true,force:true});}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p21-resolve-'));try{
    seed(dir);
    const requester=async(url)=>{if(url.includes('2026_challenger'))return{statusCode:200,text:csv(650,'20260701','NEWCH'),headers:{},url};if(url.includes('2026_atp_quali'))return{statusCode:200,text:csv(400,'20260701','NEWQ'),headers:{},url};if(url.includes('/2026.csv'))return{statusCode:200,text:csv(650,'20260701','NEWATP'),headers:{},url};throw new Error('UNEXPECTED_URL');};
    const bundle=await multi.resolveBundle({dataDir:dir,projectRoot:dir,year:2026,now:new Date('2026-07-17'),requester,retryDelaysMs:[0],sleepFn:async()=>{},force:true});
    const selected=Object.fromEntries(bundle.selected.map(x=>[x.targetId,x.providerId]));
    results.push(assert(selected.ATP_MAIN==='TENNISMYLIFE_BULK'&&selected.ATP_QUAL_CHALL==='TENNISMYLIFE_BULK'&&selected.WTA_MAIN==='LAST_KNOWN_GOOD','ZERO_KEY_FIRST_MIXED_BUNDLE',selected));
    const beforeWta=fs.readFileSync(path.join(dir,'wta_matches_2026.csv'));
    const refreshed=await multi.refreshMultiProvider({dataDir:dir,projectRoot:dir,year:2026,now:new Date('2026-07-17'),requester,retryDelaysMs:[0],sleepFn:async()=>{},force:true,playerEvidence:fakeEvidence(),operationId:'P21_FIXTURE'});
    results.push(assert(refreshed.success&&refreshed.apiCalls===0,'ATOMIC_REFRESH_ZERO_API'));
    results.push(assert(fs.readFileSync(path.join(dir,'wta_matches_2026.csv')).equals(beforeWta),'WTA_LKG_PRESERVED'));
    const health=multi.getHealth({dataDir:dir,projectRoot:dir,now:new Date('2026-07-17')});
    results.push(assert(health.apiUsage.keyPersisted===false&&health.apiUsage.keyExposed===false&&health.costPolicy.zeroKeyFirst===true,'HEALTH_KEY_SAFETY'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  console.log(JSON.stringify({success:true,patch:'21',tests:results.length,passed:results.length,results},null,2));
}
main().catch(error=>{console.error(JSON.stringify({success:false,error:error.message,details:error.details||null,stack:error.stack},null,2));process.exit(2);});
