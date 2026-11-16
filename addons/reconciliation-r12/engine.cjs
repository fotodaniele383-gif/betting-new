'use strict';
/** R12 read-only independent reconciliation, never bet/settle/change probabilities. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const VERSION='BETTINGAPP_R12_RECONCILIATION_V1';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const num=x=>x===undefined||x===null||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
const trim=(x,n=500)=>x==null?'':String(x).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,n);
const pct=x=>Math.round(x*10000)/10000;
function safeMarket(m){return /^(1|X|2|O[123]\.[05]|U[123]\.[05]|GG|NG)$/i.test(String(m||'').replace(/\s/g,''));}
function listedDbRows(db,sp,limit=5000){
 const existing=new Set(db.prepare('PRAGMA table_info("ai_forward_test")').all().map(x=>x.name));
 const required=['id','sport_type','home_team','away_team','prediction','odd','estimated_prob','edge_pp','ev_pct','stake','match_date','status','data_sufficiency_score','pre_match_historical_sample','quality_final_code','tennis_operational_action','calcio_operational_stake','calcio_final_market_snapshot','calcio_prediction_reliability_score','calcio_data_quality_status','calcio_analysis_only'];
 if(!existing.has('id')||!existing.has('sport_type'))throw Error('R12_DB_SCHEMA_UNSUPPORTED');
 const selection=required.filter(k=>existing.has(k)).map(k=>'"'+k+'"').join(',');
 return db.prepare(`SELECT ${selection} FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))=? ORDER BY id DESC LIMIT ?`).all(sp,limit);
}
function edge(row){const original=num(row.estimated_prob),odds=num(row.odd);if(original===null||odds===null||original<0||odds<=1||original>100)return {status:'UNVERIFIABLE_INPUT'};if(original===1)return {status:'UNVERIFIABLE_INPUT',reason:'PROBABILITY_UNIT_AMBIGUOUS_1'};const p=original<=1?original*100:original;
 const dEV=p*odds-100,dEdge=p-100/odds,oldEV=num(row.ev_pct),oldEdge=num(row.edge_pp);
 const ambiguousScale=original>0&&original<=1;
 const isBinary=safeMarket(row.prediction)&&!(/^[OU]/i.test(String(row.prediction))&&String(row.sport_type).toUpperCase()==='TENNIS');
 if(!isBinary)return {status:'PAYOFF_CONTRACT_REQUIRED',pPct:p,odd:odds,storedEvPct:oldEV,storedEdgePp:oldEdge};
 const deltaEV=oldEV===null?null:pct(oldEV-dEV),deltaEdge=oldEdge===null?null:pct(oldEdge-dEdge);
 const mismatch=(deltaEV!==null&&Math.abs(deltaEV)>.15)||(deltaEdge!==null&&Math.abs(deltaEdge)>.15);
 return {status:mismatch?'REPLAY_MISMATCH':'NUMERIC_MATCH',pPct:p,odds,derivedEvPct:pct(dEV),derivedEdgePp:pct(dEdge),storedEvPct:oldEV,storedEdgePp:oldEdge,deltaEvPct:deltaEV,deltaEdgePp:deltaEdge,unitConversion:ambiguousScale?'FRACTION_TO_PERCENT':'PERCENT',snapshotProved:false};
}
function quoteCheck(row){const odd=num(row.odd),p=num(row.estimated_prob),m=String(row.prediction||'').trim().toUpperCase();const flags=[];
 if(odd===null||odd<=1)flags.push('ODD_INVALID');
 else if(odd>=30&&/^(1|2|X)$/.test(m))flags.push('EXTREME_1X2_ODD_NEEDS_ORIGINAL_BOOKMAKER_PROOF');
 if(odd!==null&&p!==null&&p>0&&p<=100){const pp=p<=1?p*100:p;const ev=(pp/100*odd-1)*100;if(ev>250&&/^(1|2|X)$/.test(m))flags.push('EXTREME_NOMINAL_EV_REQUIRES_SOURCE_RECONCILIATION');}
 return flags;
}
function snapshotCompare(row){if(!row.calcio_final_market_snapshot)return{status:'NO_IMMUTABLE_ORIGINAL_PRICE_PROOF'};
 let s;try{s=JSON.parse(row.calcio_final_market_snapshot);}catch(_){return{status:'SNAPSHOT_MALFORMED'}};
 if(!s||typeof s!=='object'||Array.isArray(s))return{status:'SNAPSHOT_MALFORMED'};
 const fields=[];for(const [field,p,actual] of [['odd','odd',row.odd],['probabilityPct','estimated_prob',row.estimated_prob],['edgePp','edge_pp',row.edge_pp],['evPct','ev_pct',row.ev_pct]]){
  if(s[field]==null||actual==null)continue;let a=num(s[field]),b=num(actual);if(a!==null&&b!==null&&Math.abs(a-b)>.011)fields.push(p);
 }
 if(s.prediction!=null&&row.prediction!=null&&String(s.prediction).trim().toUpperCase()!==String(row.prediction).trim().toUpperCase())fields.push('prediction');
 return {status:fields.length?'SAVED_FIELDS_DRIFT':'SAVED_FIELDS_CONSISTENT_NOT_EXTERNAL_PROOF',differingFields:fields,snapshotTime:s.timestamp||s.asOf||s.createdAt||null};
}
function firstPositiveToZero(t){if(!t)return null;const stages=['beforeStep96','afterStep96','afterStep101','qualityGate','patch35','patch39','patch46'];const stake=t.analysis?.stakes||t.stakes||{};let positive=false;for(const k of stages){const n=num(stake[k]);if(n===null)continue;if(n>0)positive=true;else if(positive&&n===0)return k;}return null;}
function loadT11(root){const f=path.join(root,'backend','audit_runtime','t11_decision_research.jsonl');if(!fs.existsSync(f))return new Map();const stat=fs.statSync(f);if(stat.size>16*1024*1024)throw Error('R12_T11_TOO_LARGE');const map=new Map();for(const line of fs.readFileSync(f,'utf8').split(/\r?\n/)){
  if(!line.trim())continue;let x;try{x=JSON.parse(line);}catch(_){continue;}
  const id=num(x.betId);if(id==null)continue;const date=String(x.finalizedAt||x.updatedAt||'');if(!map.has(id)||date>String(map.get(id).finalizedAt||map.get(id).updatedAt||''))map.set(id,x);
 }return map;}
function loadAuthorities(db){const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_stake_authority_audit_log'").get();if(!exists)return new Map();const c=new Set(db.prepare('PRAGMA table_info("calcio_stake_authority_audit_log")').all().map(x=>x.name));if(!c.has('bet_id'))return new Map();const cols=['bet_id','reason','robust_ev_pct','final_stake','status','id'].filter(k=>c.has(k));const rows=db.prepare(`SELECT ${cols.map(x=>'"'+x+'"').join(',')} FROM calcio_stake_authority_audit_log ORDER BY ${c.has('id')?'id':'rowid'} DESC LIMIT 5000`).all();const m=new Map();for(const x of rows)if(!m.has(x.bet_id))m.set(x.bet_id,x);return m;}
function classify(row,sp,t11,authority){const flags=quoteCheck(row),arithmetic=edge(row),snapshot=sp==='CALCIO'?snapshotCompare(row):null;let group='NEEDS_CONTEXT';
 if(sp==='TENNIS'){
  const d=num(row.data_sufficiency_score),sm=num(row.pre_match_historical_sample);
  if(d!==null&&d<65)flags.push('MATCH_LEVEL_SUFFICIENCY_LOW');if(sm!==null&&sm<10)flags.push('PREMATCH_SAMPLE_LOW');
  if(!t11)flags.push('T11_TRACE_UNAVAILABLE');else{
   const reset=firstPositiveToZero(t11);if(reset)flags.push('POSITIVE_TO_ZERO_'+reset.toUpperCase());
   const risk=t11.stages?.PATCH35_RISK_AUTHORITY||t11.analysis?.riskAuthority||t11.riskAuthority||{};const q=t11.stages?.QUALITY_GATE_V2||t11.analysis?.qualityGate||t11.qualityGate||{};
   if(/STALE|AGING/i.test(`${risk.status||''} ${risk.reason||''}`))flags.push('TECHNICAL_DATA_STALE');
   if(q.allowBet===false)flags.push('QUALITY_GATE_DENIED');
  }
  if(arithmetic.status==='PAYOFF_CONTRACT_REQUIRED')flags.push('SET_OR_GAMES_MARKET_RULES_REQUIRED');
  group=flags.includes('MATCH_LEVEL_SUFFICIENCY_LOW')?'REPAIR_INPUT_EVIDENCE':'VERIFY_MARKET_AND_GATE';
 }else{
  const raw=String(authority?.reason||'');let code=[...raw.matchAll(/\b(?:R\d+_[A-Z0-9_]+)\b/g)].map(x=>x[0]);for(const c of new Set(code))flags.push(c);
  if(arithmetic.status==='REPLAY_MISMATCH')flags.push('NOMINAL_EV_REPLAY_DIFFERENCE');
  if(snapshot?.status==='SAVED_FIELDS_DRIFT')flags.push('SAVED_MARKET_SNAPSHOT_DRIFT');
  if(raw.includes('R9_ROBUST_EV_REPLAY_MISMATCH'))group='ROBUST_REPLAY_NEEDS_IDENTICAL_BATCH';
  else if(raw.includes('R15_RISK_PROOF_MISSING_OR_INVALID'))group='RISK_PROOF_REQUIRED';
  else if(raw.includes('R9_ROBUST_NET_EV_NON_POSITIVE'))group='ROBUST_EV_NOT_POSITIVE';
  else if(raw.includes('R9_AUTHORITY_NOT_ELIGIBLE'))group='AUTHORITY_PREREQUISITE_NOT_OBSERVABLE';
  else group='NO_VERBATIM_AUTHORITY_PROOF';
  if(flags.some(x=>x.includes('EXTREME')))group='QUOTE_SOURCE_QUARANTINE';
 }
 return {id:row.id,match:trim(`${row.home_team||''} - ${row.away_team||''}`,130),date:trim(row.match_date,60),market:trim(row.prediction,90),odd:num(row.odd),probability:num(row.estimated_prob),savedStake:num(sp==='CALCIO'?row.calcio_operational_stake??row.stake:row.stake),arithmetic,snapshot,robustEvPct:num(authority?.robust_ev_pct),firstPositiveToZero:sp==='TENNIS'?firstPositiveToZero(t11):null,flags:[...new Set(flags)],group,confidence:'OBSERVED_INPUTS_NOT_PRODUCTION_AUTHORIZATION'};
}
function analyzeRows(tennis,calcio,traces=new Map(),authorities=new Map()){const reports={};for(const [sp,rows] of [['TENNIS',tennis],['CALCIO',calcio]]){
  const arr=rows.map(x=>classify(x,sp,traces.get(x.id),authorities.get(x.id)));
  const counts={};for(const x of arr)for(const c of x.flags)counts[c]=(counts[c]||0)+1;
  reports[sp]={examined:rows.length,zero:arr.filter(x=>x.savedStake===0).length,flags:counts,records:arr};
 }return reports;}
function healthStatus(health){const c=health?.components||health?.operationalReadiness?.componentHealthSemantics?.components||{};const targets=c.tennisTourDataReadiness?.targets||[];
 return {status:health?.status||'NO_LIVE_HEALTH',targets:targets.map(x=>({id:x.targetId,latestMatchAt:x.latestMatchAt,ageDays:num(x.dataAgeDays),freshness:x.status,provider:x.providerId})),degraded:health?.operationalReadiness?.degradedComponents||[],failedProviderNames:Object.entries(c.tennisWtaInformationRecovery?.providerState||{}).filter(([,v])=>Number(v.httpStatus)===404).map(([k,v])=>({id:k,http:404,lastAttempt:v.lastAttemptAt||null})),notes:['Do not assert freshness solely because HTTP returned 200','An alternative CSV requires valid source rights and full R11 staging/activation','Health state does not authorize stake or certify calibration']};}
async function queryHealth(){const http=require('node:http');return new Promise(resolve=>{const req=http.request({hostname:'127.0.0.1',port:3188,path:'/api/tennis/health',method:'GET',timeout:5000,headers:{Accept:'application/json'}},r=>{const b=[];let n=0;r.on('data',x=>{n+=x.length;if(n<400000)b.push(x);else req.destroy()});r.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(b).toString('utf8')))}catch(_){resolve(null)}})});req.on('error',()=>resolve(null));req.on('timeout',()=>req.destroy());req.end();});}
async function audit(root,{http=false,limit=5000}={}){const dbFile=path.join(root,'backend','database_betting.db');if(path.basename(root).toLowerCase()!=='bettingapp v2')throw Error('R12_ROOT_INVALID');if(!fs.existsSync(dbFile))throw Error('R12_SQLITE_MISSING');const before=sha(dbFile),stat=fs.statSync(dbFile);const db=new DatabaseSync(dbFile,{readOnly:true});let reports;try{db.exec('PRAGMA query_only=ON');const check=db.prepare('PRAGMA quick_check').all();if(check?.[0]?.quick_check!=='ok')throw Error('R12_SQLITE_QUICK_CHECK_FAIL');reports=analyzeRows(listedDbRows(db,'TENNIS',limit),listedDbRows(db,'CALCIO',limit),loadT11(root),loadAuthorities(db));}finally{db.close();}
 const after=sha(dbFile),post=fs.statSync(dbFile);if(before!==after||stat.mtimeMs!==post.mtimeMs||stat.size!==post.size)throw Error('R12_DB_MUTATED_DURING_AUDIT');const health=http?healthStatus(await queryHealth()):healthStatus(null);
 return {version:VERSION,generatedAt:new Date().toISOString(),scope:'UP_TO_'+limit+'_RECORDS_PER_SPORT_BY_ID_NOT_GLOBAL_COMPLETE_CERTIFICATION',readOnly:true,dbSha256Before:before,dbSha256After:after,dbUnchanged:true,reports,tennisHealth:health,knownUnresolved:[
  'LIVE_RECENT_CANONICAL_ATP_WTA_DATA_NOT_VALIDATED_OR_ACTIVATED',
  'MODEL_JOIN_MATCH_LEVEL_AND_CALIBRATION_NOT_REPAIRED_IN_PRODUCTION_CORE',
  'TENNIS_TOTALS_STEP50B_CANDIDATE_EMISSION_NOT_PROVED_WITHOUT_REAL_TRACE',
  'CALCIO_ROBUST_EV_REPLAY_NOT_RECOMPUTED_WITH_ORIGINAL_INPUT_SNAPSHOT',
  'CALCIO_AUTHORITY_NOT_ELIGIBLE_INNER_PREREQUISITE_MAY_BE_UNOBSERVED',
  'HISTORICAL_ARITHMETIC_MISMATCH_REQUIRES_AS_OF_ODDS_AND_PROBABILITY',
  'EXTREME_QUOTES_REQUIRE_INDEPENDENT_ORIGINAL_BOOKMAKER_SOURCE',
  'NO_REAL_BET_OR_ORDER_OR_SETTLEMENT_ACTION'
 ],warning:'Diagnostics and quarantine only; this release does not update prediction, production gate, selected market, stake, DB or scheduler.'};}
function formatText(r){const out=[`BETTINGAPP R12 READ ONLY RECONCILIATION`, `GENERATED=${r.generatedAt}`,`DB_UNCHANGED=${r.dbUnchanged}`];for(const sp of ['TENNIS','CALCIO']){const rr=r.reports[sp];out.push('',`${sp}: RECORDS=${rr.examined} ZERO=${rr.zero}`,`FLAGS=${JSON.stringify(rr.flags)}`);for(const x of rr.records.filter(y=>y.flags.length).slice(0,40))out.push(`ID=${x.id} ${x.match} ${x.market} QUOTA=${x.odd} STAKE=${x.savedStake} CLASS=${x.group} FLAGS=${x.flags.join(',')} REPLAY=${x.arithmetic.status}`)}out.push('',`HEALTH=${JSON.stringify(r.tennisHealth)}`,'',`UNRESOLVED=${r.knownUnresolved.join(' ; ')}`,'NO EXECUTABLE BET / NO DB WRITE.');return out.join('\n')+'\n';}
module.exports={VERSION,num,edge,quoteCheck,snapshotCompare,firstPositiveToZero,analyzeRows,healthStatus,audit,formatText};
