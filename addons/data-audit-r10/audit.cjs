'use strict';
/* BETTINGAPP R10 data-first diagnostic. Uses SQLite read-only; never imports server or scanners.
 * No automatic bets, stake changes, settlement, scheduled tasks, or remote network access.
 * A reported root cause must reference an actual stored field or an actual GET diagnostic.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {DatabaseSync}=require('node:sqlite');
const V='BETTINGAPP_R10_DATA_FIRST_DIAG_20261112';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const str=(v,max=380)=>v===null||v===undefined?'':String(v).replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,max);
const nowIso=()=>new Date().toISOString();
const isPlainMarket=(sport,market)=>{
 const p=String(market||'').trim().toUpperCase().replace(/\s/g,'');
 return ['1','2','X','O2.5','U2.5','O1.5','U1.5','O3.5','U3.5','GG','NG'].includes(p)&& !(sport==='TENNIS'&&p.startsWith('O'));
};
function tableExists(db,t){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));}
function columns(db,t){return new Set(db.prepare('PRAGMA table_info("'+t+'")').all().map(x=>x.name));}
function materialColumns(all){
 const selected=['id','sport_type','home_team','away_team','match_date','league','status','prediction','odd','estimated_prob','edge_pp','ev_pct','stake','data_quality','quality_final_code','data_sufficiency_score','pre_match_historical_sample','market_type','model_version','tennis_operational_action','tennis_stake_policy_reason','tennis_data_quality_status','tennis_probability_guard_grade','tennis_probability_guard_status','tennis_probability_guard_reason','tennis_player_data_freshness_status','calcio_gate_status','calcio_gate_reasons','calcio_gate_allow_bet','calcio_stake_lifecycle_reason','calcio_stake_lifecycle_status','calcio_operational_stake','calcio_stake_authority_final_stake','calcio_data_quality_status','calcio_diagnostic_coherence_status','calcio_decision_state','calcio_decision_state_reason','calcio_analysis_stage_code','calcio_analysis_stage_reason','calcio_final_market_snapshot','calcio_final_market_id','calcio_market_selection_audit','calcio_prediction_reliability_score','calcio_forecast_confidence_score','calcio_quality_final_label','calcio_analysis_only','stake_policy_note','tennis_technical_data_status','tennis_match_level_age_days'];
 return selected.filter(c=>all.has(c));
}
const round=(v,n=3)=>Math.round(v*10**n)/10**n;
function prop(row,field){const v=row[field];return v===undefined||v===null?'':v}
function detect(row,sport){
 const reasons=[];const add=(category,code,field,value,explanation)=>{
  if(reasons.some(x=>x.code===code))return;
  reasons.push({category,code,field,observed:str(value,220),description:explanation});
 };
 const ds=num(row.data_sufficiency_score);
 if(sport==='TENNIS'){
  if(ds!==null&&ds<65)add('DATA','TENNIS_MATCH_LEVEL_SUFFICIENCY_BELOW_65','data_sufficiency_score',ds,'Campione/qualita match-level sotto soglia osservata nei report; identificare quale sorgente lo alimenta.');
  const sample=num(row.pre_match_historical_sample);
  if(sample!==null&&sample<10)add('DATA','TENNIS_PREMATCH_HISTORICAL_SAMPLE_LT_10','pre_match_historical_sample',sample,'Campione prematch insufficiente; non e equivalente al numero di record bootstrap/DS×Gate.');
  for(const key of ['quality_final_code','tennis_operational_action','tennis_probability_guard_grade','tennis_probability_guard_status','tennis_probability_guard_reason','tennis_data_quality_status','tennis_player_data_freshness_status','tennis_technical_data_status']){
   const v=prop(row,key);if(/(BLOCK|STALE|AGING|MISSING|UNKNOWN|NO_BET|NO_EXEC|PAPER_ONLY|RISK|INVALID|INSUFFICIENT|ZERO)/i.test(String(v)))add('RISK_OR_DATA','TENNIS_'+key.toUpperCase(),key,v,'Codice persistito: identificare il gate corrispondente nella trace runtime per confermare la causa primaria.');
  }
 }else{
  for(const key of ['calcio_diagnostic_coherence_status','calcio_decision_state_reason','calcio_gate_reasons','calcio_stake_lifecycle_reason','calcio_data_quality_status','calcio_analysis_stage_reason','calcio_quality_final_label','stake_policy_note']){
   const v=prop(row,key);if(/(MISMATCH|BLOCK|VETO|NO_STAKE|INATTEND|INSUFFICIENT|HISTORY_PROXY|HISTORY_THIN|EARLY|PENDING|NO_BET|UNIFIED_INDEX|INVALID|NO_AUTHORITY)/i.test(String(v)))add('RISK_OR_DATA','CALCIO_'+key.toUpperCase(),key,v,'Motivazione/codice registrato; non inferire che SAFE13 sia la causa primaria.');
  }
  if(num(row.calcio_analysis_only)===1)add('DECISION','CALCIO_ANALYSIS_ONLY','calcio_analysis_only',1,'Match indicato come sola analisi, non autorizzato a stake.');
  const score=num(row.calcio_prediction_reliability_score);
  if(score!==null&&score<55)add('DATA','CALCIO_RELIABILITY_LOW','calcio_prediction_reliability_score',score,'Bassa affidabilita della previsione nella fotografia DB.');
 }
 if(/PROXY|THIN|STALE/i.test(String(row.data_quality||'')))add('DATA','DATA_QUALITY_'+str(row.data_quality,35).toUpperCase(),'data_quality',row.data_quality,'Dato non real/current: il valore EV resta nominale.');
 // Financial decision is an observed outcome, not necessarily the initiating cause.
 const actualStake=num(row.stake),opStake=num(sport==='CALCIO'?row.calcio_operational_stake:row.stake);
 if(opStake!==null&&opStake<=0)add('AUTHORITY','FINAL_STAKE_ZERO',sport==='CALCIO'?'calcio_operational_stake':'stake',opStake,'Conferma esito finale, non spiega di per se il veto a monte.');
 if(actualStake!==null&&actualStake>0)add('AUTHORITY','STAKE_POSITIVE_OBSERVED','stake',actualStake,'Esiste una registrazione positiva: non assumere che una puntata reale sia stata eseguita.');
 return reasons;
}
function arithmetic(row,sport){
 const p0=num(row.estimated_prob),odd=num(row.odd);if(p0===null||odd===null||odd<=1||p0<0||p0>100)return {status:'NOT_TESTABLE',reason:'MISSING_OR_INVALID_PROB_ODDS'};
 const pPct=p0<=1?p0*100:p0;
 if(pPct>100)return {status:'NOT_TESTABLE',reason:'P_NOT_A_PROBABILITY'};
 const predictedEdge=pPct-100/odd;const predictedEv=pPct*odd-100;
 const out={status:'NUMERIC_ONLY',pPct:round(pPct,4),odd,breakEvenPct:round(100/odd,4),derivedEdgePp:round(predictedEdge,4),derivedEvPct:round(predictedEv,4)};
 if(!isPlainMarket(sport,row.prediction)){
  out.status='MARKET_PAYOFF_CONTRACT_REQUIRED';out.reason='AH_SET_OR_PARTIAL_PAYOFF_MUST_NOT_APPLY_BINARY_EV';return out;
 }
 const storedEdge=num(row.edge_pp),storedEv=num(row.ev_pct);
 if(storedEdge!==null){out.storedEdgePp=storedEdge;out.edgeDiffPp=round(storedEdge-predictedEdge,5);}
 if(storedEv!==null){out.storedEvPct=storedEv;out.evDiffPp=round(storedEv-predictedEv,5);}
 if((storedEdge!==null&&Math.abs(storedEdge-predictedEdge)>0.15)||(storedEv!==null&&Math.abs(storedEv-predictedEv)>0.15)){
  out.status='ARITHMETIC_REPLAY_MISMATCH';out.reason='CHECK_PROBABILITY_MARKET_TIME_UNIT_AND_SNAPSHOT';
 }else out.status=(storedEdge===null||storedEv===null)?'RECOMPUTED_NO_SAVED_COMPARISON':'ARITHMETIC_MATCH';
 return out;
}
function contractSnapshot(row){
 if(!row.calcio_final_market_snapshot)return {status:'NOT_PRESENT',mismatches:[]};
 let snap;try{snap=JSON.parse(String(row.calcio_final_market_snapshot));}catch(_){return {status:'UNPARSABLE',mismatches:['JSON_INVALID']};}
 if(!snap||typeof snap!=='object'||Array.isArray(snap))return {status:'INVALID_OBJECT',mismatches:['STRUCTURE']};
 const mismatches=[];
 function txtComp(name,a,b){if(a===undefined||a===null||b===undefined||b===null)return;
   if(String(a).trim().toUpperCase()!==String(b).trim().toUpperCase())mismatches.push(name);
 }
 function numericComp(name,a,b){if(a===undefined||a===null||b===undefined||b===null)return;
  const x=num(a),y=num(b);if(x!==null&&y!==null&&Math.abs(x-y)>0.011)mismatches.push(name);
 }
 txtComp('PREDICTION',row.prediction,snap.prediction);
 txtComp('MARKET_TYPE',row.market_type,snap.marketType);
 txtComp('MARKET_ID',row.calcio_final_market_id,snap.marketId);
 numericComp('ODD',row.odd,snap.odd);
 numericComp('PROBABILITY',row.estimated_prob,snap.probabilityPct);
 numericComp('EDGE_PP',row.edge_pp,snap.edgePp);
 numericComp('EV_PCT',row.ev_pct,snap.evPct);
 numericComp('STAKE',row.calcio_operational_stake,snap.stake?.finalOperationalStake);
 return {status:mismatches.length?'MARKET_CONTRACT_MISMATCH':'REPLAY_FIELDS_CONSISTENT',mismatches,source:'SAVED_FINAL_MARKET_SNAPSHOT_ONLY',
  note:'Matching is a field consistency check, not independent calibration or certification.'};
}
function priority(sport,row){
 const txt=[row.home_team,row.away_team].join(' ').toLowerCase();
 if(sport==='TENNIS'&&/(sabalenka|svitolina|muchova|andreeva|gauff|kostyuk)/.test(txt))return 30;
 if(sport==='CALCIO'&&/(venezia|bologna|lazio|lecce|cagliari|milan)/.test(txt))return 30;
 if(String(row.status||'').toUpperCase()==='PENDING')return 10;
 return 0;
}
function readTennisTrace(root){
 const file=path.join(root,'backend','audit_runtime','t11_decision_research.jsonl');
 if(!fs.existsSync(file))return {status:'NOT_PRESENT',rows:0,byBetId:new Map(),diagnoses:{}};
 const stat=fs.statSync(file);if(stat.size>8*1024*1024)return {status:'TOO_LARGE_REQUIRES_MANUAL_RANGE',rows:0,byBetId:new Map(),diagnoses:{}};
 const byId=new Map(),hist={};let rows=0,invalid=0;
 for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
  if(!line.trim())continue;
  try{const entry=JSON.parse(line);rows++;const id=num(entry.betId);if(id===null)continue;
    const prev=byId.get(id),t=String(entry.finalizedAt||entry.updatedAt||'');
    if(!prev||t>String(prev.finalizedAt||prev.updatedAt||''))byId.set(id,entry);
  }catch(_){invalid++;}
 }
 for(const e of byId.values()){const k=str(e.analysis?.diagnosis||'NOT_COMPUTED',90);hist[k]=(hist[k]||0)+1;}
 return {status:invalid?'PARTIAL_PARSE_ERRORS':'OK',rows,invalid,byBetId:byId,diagnoses:hist};
}
function summaryTrace(e){
 if(!e)return null;
 const s=e.analysis?.stakes||{},g=e.stages||{},quality=g.QUALITY_GATE_V2||{},risk=g.PATCH35_RISK_AUTHORITY||{},cal=g.PATCH39_CALIBRATION_GUARD||{},final=g.PATCH46_FINAL_CONTRACT||{};
 function slim(o){return Object.fromEntries(Object.entries(o||{}).filter(([k,v])=>/^(status|reason|reasons|baseCode|baseScore|dataSufficiency|deepScanClass|outputStake|finalStake|finalStakeCap|finalExecutableStake|stake|referenceQuality|riskClass|allowBet|grade)$/i.test(k)).map(([k,v])=>[k,typeof v==='string'?str(v,220):v]));}
 return {traceId:str(e.traceId,110),diagnosis:str(e.analysis?.diagnosis,100),firstZeroStage:str(e.analysis?.firstZeroStage,70),stakes:s,qualityGate:slim(quality),riskAuthority:slim(risk),calibrationGuard:slim(cal),patch46:slim(final),source:'DURABLE_T11_JSONL_READONLY',version:str(e.version,100)};
}
function auditSnapshot(db,opts={}){
 const traces=opts.traces||{status:'NOT_REQUESTED',rows:0,byBetId:new Map(),diagnoses:{}};
 if(!tableExists(db,'ai_forward_test'))throw Error('R10_AI_FORWARD_TEST_MISSING');
 const all=columns(db,'ai_forward_test'),must=['id','sport_type'];for(const x of must)if(!all.has(x))throw Error('R10_REQUIRED_COLUMN_MISSING:'+x);
 const selected=materialColumns(all);const result={schema:V,sqliteQuickCheck:db.prepare('PRAGMA quick_check').get().quick_check,selection:'MOST_RECENT_250_BY_ID_PER_SPORT_PLUS_USER_NAMED_REPRESENTATIVES_WHEN_IN_RANGE',fieldCoverage:{columnsAvailable:all.size,selected,missing:['data_sufficiency_score','pre_match_historical_sample','calcio_diagnostic_coherence_status','calcio_operational_stake'].filter(x=>!all.has(x))},sports:{},possibleGaps:[]};
 if(result.sqliteQuickCheck!=='ok')throw Error('R10_SQLITE_QUICK_CHECK_FAILED');
 const projection=selected.map(x=>'"'+x+'"').join(',');
 const names=selected;
 for(const sport of ['TENNIS','CALCIO']){
  const rows=db.prepare(`SELECT ${projection} FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))=? ORDER BY id DESC LIMIT ?`).all(sport,opts.limit||250);
  const matches=rows.map(row=>{
   const r={id:row.id,match:`${str(row.home_team,100)} - ${str(row.away_team,100)}`,matchDate:str(row.match_date,80),status:str(row.status,30),market:str(row.prediction,40),stake:num(row.stake),odd:num(row.odd),probability:num(row.estimated_prob),dataQuality:str(row.data_quality,80),reasonTrace:detect(row,sport),arithmetic:arithmetic(row,sport),source:'ACTUAL_DB_ROW_READONLY'};
   if(sport==='TENNIS')r.t11=summaryTrace(traces.byBetId.get(Number(row.id)));
   else r.finalMarketContract=contractSnapshot(row);
   r.primaryObservedCause=r.t11?.firstZeroStage&&r.t11.firstZeroStage!=='NO_ZERO'?('T11_FIRST_ZERO_'+r.t11.firstZeroStage):(r.reasonTrace.find(x=>x.category!=='AUTHORITY')?.code||'NOT_OBSERVABLE_FROM_STORED_COLUMNS');
   return {r,row};
  });
  const histogram={},arthist={};for(const {r} of matches){for(const x of r.reasonTrace)histogram[x.code]=(histogram[x.code]||0)+1;arthist[r.arithmetic.status]=(arthist[r.arithmetic.status]||0)+1;}
  matches.sort((a,b)=>priority(sport,b.row)-priority(sport,a.row)||Number(b.r.id)-Number(a.r.id));
  result.sports[sport]={scannedRows:rows.length,pendingRows:rows.filter(x=>String(x.status||'').toUpperCase()==='PENDING').length,stakePositiveRows:rows.filter(x=>num(x.stake)>0).length,reasonHistogram:histogram,arithmeticHistogram:arthist,finalMarketContractHistogram:sport==='CALCIO'?Object.fromEntries(['MARKET_CONTRACT_MISMATCH','REPLAY_FIELDS_CONSISTENT','NOT_PRESENT','UNPARSABLE','INVALID_OBJECT'].map(k=>[k,matches.filter(x=>x.r.finalMarketContract?.status===k).length])):undefined,sample:matches.slice(0,Math.min(opts.samples||16,40)).map(x=>x.r),limitations:rows.length===(opts.limit||250)?'SAMPLE_LIMIT_REACHED_NOT_ALL_HISTORY':'NONE'};
 }
 result.tennisT11={status:traces.status,traceRows:traces.rows,invalidRows:traces.invalid||0,uniqueBets:traces.byBetId.size,diagnoses:traces.diagnoses};
 if(tableExists(db,'calcio_stake_authority_audit_log')){
  const c=columns(db,'calcio_stake_authority_audit_log'),cols=['id','bet_id','batch_id','reason','reasons','final_stake','robust_ev_pct','decision','status','veto_reasons','quality_reasons','market_id'].filter(x=>c.has(x));
  const last=cols.length?db.prepare(`SELECT ${cols.map(x=>'"'+x+'"').join(',')} FROM calcio_stake_authority_audit_log ORDER BY id DESC LIMIT 120`).all():[];
  // Attribute final authority veto to the concrete match, without claiming it is the only blocker.
  const byId=new Map();for(const a of last){const id=num(a.bet_id);if(id!==null&&!byId.has(id))byId.set(id,a);}
  for(const match of result.sports.CALCIO.sample){const x=byId.get(num(match.id));if(!x)continue;
   match.authority={status:str(x.status,90),robustEvPct:num(x.robust_ev_pct),finalStake:num(x.final_stake),verbatimVeto:str(x.reason,650),source:'calcio_stake_authority_audit_log'};
   if(x.reason&&/R9_[A-Z_]+/.test(String(x.reason))){match.primaryObservedCause='AUTHORITY_LOG_'+(String(x.reason).match(/R9_[A-Z_]+/)||['UNKNOWN'])[0];}
  }
  result.calcioAuthorityAudit={rowsExamined:last.length,fields:cols,finalStakeZero:last.filter(x=>num(x.final_stake)===0).length,robustEvNonPositive:last.filter(x=>num(x.robust_ev_pct)!==null&&num(x.robust_ev_pct)<=0).length,sample:last.slice(0,8).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='string'?str(v,300):v])))};
 }else result.calcioAuthorityAudit={status:'AUDIT_TABLE_MISSING'};
 return result;
}
const SAFE_ENDPOINTS=[
 '/api/health', '/api/tennis/health', '/api/tennis/stake-decision-trace-t11?limit=25',
 '/api/tennis/tour-data-readiness','/api/tennis/canonical-player-evidence-health',
 '/api/tennis/historical-player-stats-health','/api/tennis/statistical-engine-health',
 '/api/tennis/forward-sample-intake-readiness','/api/calcio/health',
 '/api/calcio/diagnostics/stake-chain?limit=25','/api/calcio/diagnostics/final-market-contract?limit=25',
 '/api/calcio/stakes/authority-audit?limit=25'
];
function requestReadOnly(pathname){return new Promise(resolve=>{
  const q=http.request({hostname:'127.0.0.1',port:3188,path:pathname,method:'GET',timeout:3500,headers:{Accept:'application/json'}},res=>{
   const parts=[];let n=0;res.on('data',c=>{n+=c.length;if(n<=800000)parts.push(c);else res.destroy(Error('MAX_RESPONSE_SIZE'));});
   res.on('end',()=>{let body=null;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch(_){return resolve({endpoint:pathname,httpStatus:res.statusCode,parse:'INVALID_OR_TRUNCATED_JSON'});}
    const result={endpoint:pathname,httpStatus:res.statusCode,success:body.success===true,version:str(body.version,100),status:str(body.status||body.state||body.code,160),readOnlyReported:body.readOnly===true};
    // Do not persist arbitrary HTTP payloads; restrict to diagnostics known to be nonsecret.
    const keys=['count','traceCount','health','structuralReady','structuralGaps','dataSufficiency','sampleSize','samples','reason','total','byScope','summary','gate','errors','warningCount','blocked','readiness'];
    for(const k of keys)if(Object.hasOwn(body,k)){
     const v=body[k];result[k]=typeof v==='object'?str(JSON.stringify(v),440):str(v,220);
    }
    resolve(result);
   });
  });q.on('timeout',()=>q.destroy(Error('HTTP_TIMEOUT')));q.on('error',e=>resolve({endpoint:pathname,status:'NO_HTTP_EVIDENCE',reason:str(e.message,100)}));q.end();
 });}
async function run(root,options={}){
 const full=path.resolve(root),dbFile=path.join(full,'backend','database_betting.db');
 if(path.basename(full).toLowerCase()!=='bettingapp v2')throw Error('R10_WRONG_TARGET_ROOT');
 if(!fs.existsSync(dbFile))throw Error('R10_DATABASE_NOT_FOUND');
 const sha0=hash(dbFile),stat0=fs.statSync(dbFile);
 const traces=readTennisTrace(full);
 const db=new DatabaseSync(dbFile,{readOnly:true});let report;
 try{db.exec('PRAGMA query_only=ON');report=auditSnapshot(db,{...options,traces});}finally{db.close()}
 const stat1=fs.statSync(dbFile),sha1=hash(dbFile);
 if(sha0!==sha1||stat0.size!==stat1.size||stat0.mtimeMs!==stat1.mtimeMs)throw Error('R10_DB_CHANGED_DURING_READONLY_AUDIT');
 report.version=V;report.generatedAt=nowIso();report.target=full;report.readOnly=true;report.dbSha256Before=sha0;report.dbSha256After=sha1;report.dbUnchanged=true;
 if(options.http){report.http={mode:'LOOPBACK_GET_ONLY_NOT_TRANSACTIONAL',note:'GET endpoints may write diagnostic telemetry; not used as authorization',probes:[]};
  for(const p of SAFE_ENDPOINTS)report.http.probes.push(await requestReadOnly(p));}
 report.nextActions=[
  'TENNIS: compare recorded insufficiency scores and trace T11, match-level freshness and calibration; if unavailable label NOT_OBSERVABLE rather than pass',
  'TENNIS TOTALS: 4 events/56 bookmakers/9 lines shown in user UI but 0 evaluated; inspect STEP50A to STEP50B blocking reasons from the next live analysis, do not remove Markov requirements blindly',
  'CALCIO: compare stored final-market contract to authority log; replay on the identical batch before declaring R9_ROBUST_EV_REPLAY_MISMATCH fixed',
  'DO NOT alter existing decisions/settlements; R10 output is diagnostics only'
 ];
 return report;
}
function textReport(r){const lines=[`BETTINGAPP R10 DATA-FIRST AUDIT`, `Generated=${r.generatedAt}`, `Target=${r.target}`,`DB_SHA_UNCHANGED=${r.dbUnchanged}`,`SQLITE_QUICK_CHECK=${r.sqliteQuickCheck}`,`WRITEBACK=NONE`,``];
 for(const sp of ['TENNIS','CALCIO']){const s=r.sports[sp];lines.push(`=== ${sp} ===`,`INSPECTED=${s.scannedRows} PENDING=${s.pendingRows} STAKE_POSITIVE=${s.stakePositiveRows}`,`CAUSE_COUNTS=${JSON.stringify(s.reasonHistogram)}`,`ARITHMETIC=${JSON.stringify(s.arithmeticHistogram)}`);
  for(const row of s.sample){lines.push(`MATCH #${row.id}: ${row.match} / ${row.market} @ ${row.odd}; PROB=${row.probability} STAKE=${row.stake}`);
   lines.push(`  PRIMARY=${row.primaryObservedCause}; REPLAY=${row.arithmetic.status}`);
   if(row.t11)lines.push(`  T11_TRACE firstZero=${row.t11.firstZeroStage} diagnosis=${row.t11.diagnosis}`);
   if(row.authority)lines.push(`  CALCIO_AUTHORITY robustEv=${row.authority.robustEvPct} reason=${row.authority.verbatimVeto}`);
   if(row.finalMarketContract)lines.push(`  FINAL_MARKET_CONTRACT=${row.finalMarketContract.status} delta=${(row.finalMarketContract.mismatches||[]).join(',')}`);
   for(const x of row.reasonTrace.slice(0,9))lines.push(`  ${x.category}/${x.code}: ${x.field}=${x.observed}`);
  }lines.push('');}
 lines.push('TENNIS_TOTALS='+'FEED_PRESENT_BUT_CAUSE_NOT_CERTIFIED_WITHOUT_STEP50B_LIVE_TRACE');
 if(r.http){lines.push('=== GET DIAGNOSTICS (LOOPBACK ONLY) ===');for(const p of r.http.probes)lines.push(`${p.endpoint} status=${p.httpStatus||p.status} ${p.reason||''}`)}
 lines.push('NO STAKE/PORTFOLIO/SAFE13/SETTLEMENT MODIFICATION.');return lines.join('\n')+'\n';}
module.exports={V,auditSnapshot,detect,arithmetic,run,textReport,requestReadOnly,readTennisTrace,summaryTrace,contractSnapshot};
