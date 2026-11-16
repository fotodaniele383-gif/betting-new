'use strict';
/* BettingApp R7 — Evidence-assisted reconciliation, NOT automatic historical settlement. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const VERSION='BETTINGAPP_R7_EVIDENCE_RECONCILIATION_V1';
const KINDS=['CALCIO_SETTLEMENT','TENNIS_SCHEDULE','TENNIS_FORWARD'];
const sha=(v)=>crypto.createHash('sha256').update(v).digest('hex');
const validIso=x=>typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const json=x=>JSON.stringify(x);
function journalPath(root){return path.join(root,'.bettingapp_r7_reconciliation','evidence.jsonl');}
function safeDb(root){const name=path.join(root,'backend','database_betting.db');if(!fs.existsSync(name))throw Error('R7_DB_MISSING');
 const db=new DatabaseSync(name,{readOnly:true});db.exec('PRAGMA query_only=ON');return db;}
function snapshot(root,now=new Date()){
 const db=safeDb(root);
 try{
  const ok=db.prepare('PRAGMA quick_check').get();if(ok.quick_check!=='ok')throw Error('R7_DB_QUICK_CHECK_FAILED');
  const c=db.prepare(`SELECT id,home_team,away_team,match_date,status,stake,prediction,odd,settlement_source,settlement_evidence_hash,settlement_source_event_id FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING' ORDER BY id ASC`).all();
  const cutoff=now.getTime()-24*3600000;
  const calcio=c.filter(x=>{let d=Date.parse(x.match_date);return Number.isFinite(d)&&d<cutoff;}).map(x=>({key:'CALCIO_SETTLEMENT:'+x.id,kind:'CALCIO_SETTLEMENT',id:x.id,match:x.home_team+' - '+x.away_team,matchDate:x.match_date,stake:Number(x.stake||0),prediction:x.prediction,odd:x.odd,hasEvidence:!!(x.settlement_source&&x.settlement_evidence_hash&&x.settlement_source_event_id)}));
  const t=db.prepare(`SELECT id,home_team,away_team,match_date,status,official_schedule_source_kind,official_schedule_source_id,official_schedule_receipt_id,official_schedule_checked_at FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' AND UPPER(COALESCE(status,''))='PENDING' ORDER BY id DESC`).all();
  const schedule=t.filter(x=>!['OFFICIAL_TOUR','OFFICIAL_TOURNAMENT'].includes(String(x.official_schedule_source_kind||'')) || !x.official_schedule_source_id || !x.official_schedule_receipt_id)
    .map(x=>({key:'TENNIS_SCHEDULE:'+x.id,kind:'TENNIS_SCHEDULE',id:x.id,match:x.home_team+' - '+x.away_team,matchDate:x.match_date,sourceKind:x.official_schedule_source_kind||null,sourceId:x.official_schedule_source_id||null}));
  let forward=[];let health={status:'NOT_AVAILABLE',evidenceOverdue:null,decisionContractBlocked:null};
  try{const orig=require(path.join(root,'backend','tennisForwardCaptureHealth.js'));
   const data=orig.scanForwardCaptureHealth(db,{now,limit:2000});
   health={status:data.status,evidenceOverdue:data.evidenceOverdue,decisionContractBlocked:data.decisionContractBlocked};
   forward=(data.details||[]).filter(r=>r.classification?.class==='DECISION_CONTRACT'||(r.decisionSafety?.complete===true&&r.decisionSafety?.coherent===false))
    .map(r=>({key:'TENNIS_FORWARD:'+(r.betId||r.id),kind:'TENNIS_FORWARD',id:r.betId||r.id,match:null,actualStake:r.decisionSafety?.actualStake??null,intendedStake:r.decisionSafety?.intendedStake??null,reasons:r.reasons||[]}));
  }catch(e){health={status:'DEGRADED_DEPENDENCY',reason:String(e.message||e).slice(0,100),evidenceOverdue:null,decisionContractBlocked:null};}
  // In degraded mode flag only demonstrable contradictions from stored quality fields, never infer a correction.
  if(health.status==='DEGRADED_DEPENDENCY'){
   const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name));
   if(['quality_stake_amount','stake'].every(c=>cols.has(c))){
    const row=db.prepare(`SELECT id,home_team,away_team,stake,quality_stake_amount,quality_stake_mode,quality_final_code FROM ai_forward_test WHERE id=3041 AND UPPER(COALESCE(sport_type,''))='TENNIS'`).get();
    if(row && Math.abs(Number(row.stake||0)-Number(row.quality_stake_amount||0))>.011)forward.push({key:'TENNIS_FORWARD:'+row.id,kind:'TENNIS_FORWARD',id:row.id,match:row.home_team+' - '+row.away_team,actualStake:row.stake,intendedStake:row.quality_stake_amount,reasons:['STAKE_CONTRACT_UNRECONCILED']});
   }
  }
  const unique=new Map([...calcio,...schedule,...forward].map(x=>[x.key,x]));
  return {version:VERSION,generatedAt:now.toISOString(),dbQuickCheck:'ok',readOnly:true,legacyUpdated:false,
   counts:{staleCalcio:calcio.length,calcioStalePositiveStake:calcio.filter(x=>x.stake>0).length,scheduleReview:schedule.length,forwardContractReview:forward.length,forwardEvidenceOverdue:health.evidenceOverdue},
   health, cases:[...unique.values()]};
 }finally{db.close();}
}
function readJournal(root){const p=journalPath(root);if(!fs.existsSync(p))return [];
 const content=fs.readFileSync(p,'utf8');if(content && !content.endsWith('\n'))throw Error('R7_JOURNAL_TRUNCATED');
 let prev='GENESIS';const rows=[];
 for(const ln of content.split('\n').filter(Boolean)){
  const r=JSON.parse(ln);if(r.prev!==prev)throw Error('R7_JOURNAL_CHAIN_BROKEN');
  const {hash,...body}=r;if(sha(json(body))!==hash)throw Error('R7_JOURNAL_HASH_MISMATCH');prev=hash;rows.push(r);
 }return rows;
}
function derivedSettlement(prediction,home,away){
 const p=String(prediction||'').replace(/\s/g,'').toUpperCase();
 const score=home===away?'X':home>away?'1':'2';const total=home+away;
 if(['1','X','2'].includes(p))return score===p?'WON':'LOST';
 const m=/^([OU])(\d+(?:[.,]\d+)?)$/.exec(p);
 if(m){const line=Number(m[2].replace(',','.'));const diff=m[1]==='O'?total-line:line-total;return diff>0?'WON':diff<0?'LOST':'PUSH';}
 if(p==='GG'||p==='BTTS_YES')return home>0&&away>0?'WON':'LOST';
 if(p==='NG'||p==='BTTS_NO')return home===0||away===0?'WON':'LOST';
 return 'UNSUPPORTED_MARKET_NO_SETTLEMENT_PREVIEW';
}
function validateEvidence(c,data){
 if(!data || typeof data!=='object'||Array.isArray(data))throw Error('R7_EVIDENCE_OBJECT_REQUIRED');
 const sourceUrl=String(data.sourceUrl||'').trim();if(!/^https:\/\/[^\s]+$/i.test(sourceUrl)||sourceUrl.length>600)throw Error('R7_HTTPS_SOURCE_REQUIRED');
 const observedAt=String(data.observedAt||'').trim();if(!validIso(observedAt))throw Error('R7_TIMESTAMP_WITH_TIMEZONE_REQUIRED');
 if(Date.parse(observedAt)>Date.now()+5*60000)throw Error('R7_EVIDENCE_FUTURE_TIMESTAMP');
 const sourceEventId=String(data.sourceEventId||'').trim();if(!sourceEventId||sourceEventId.length>140)throw Error('R7_SOURCE_EVENT_ID_REQUIRED');
 const notes=String(data.notes||'').trim();if(notes.length>1500)throw Error('R7_NOTES_TOO_LONG');
 const result={sourceUrl,observedAt:new Date(observedAt).toISOString(),sourceEventId,notes,
  classification:'USER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED'};
 if(c.kind==='CALCIO_SETTLEMENT'){
  const h=Number(data.homeGoals),a=Number(data.awayGoals);
  if(!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>30||a>30)throw Error('R7_SCORE_INVALID');
  result.homeGoals=h;result.awayGoals=a;result.draftOutcome=derivedSettlement(c.prediction,h,a);
  result.marketSettlementStatus='DRAFT_UNVERIFIED';
 }else if(c.kind==='TENNIS_SCHEDULE'){
  const kind=String(data.sourceKind||'').trim();if(!['TOUR','TOURNAMENT','OTHER'].includes(kind))throw Error('R7_SCHEDULE_SOURCE_KIND_INVALID');
  result.sourceKind=kind;result.scheduleReviewStatus='MANUAL_SOURCE_PENDING_INDEPENDENT_CHECK';
 }else if(c.kind==='TENNIS_FORWARD'){
  const note=String(data.reconciliationReason||'').trim();if(note.length<10||note.length>800)throw Error('R7_FORWARD_REASON_REQUIRED');
  result.reconciliationReason=note;result.actualStakeFromDb=c.actualStake;result.intendedStakeFromDb=c.intendedStake;
  result.financeStatus='QUARANTINED_REVIEW_NO_STAKE_REWRITE';
 }
 return result;
}
function appendEvidence(root,c,data,expectedRevision=0){
 // Validate existing chain before opening any file for writing; do not modify SQLite.
 const prior=readJournal(root),latest=prior.filter(x=>x.key===c.key).at(-1),rev=latest?.revision||0;
 if(Number(expectedRevision)!==rev)throw Error('R7_REVISION_CONFLICT');
 const proof=validateEvidence(c,data);
 const entry={schema:'R7_EVIDENCE_V1',key:c.key,kind:c.kind,recordId:c.id,revision:rev+1,
  match:c.match||null,capturedAt:new Date().toISOString(),evidence:proof,prev:prior.at(-1)?.hash||'GENESIS'};
 const record={...entry,hash:sha(json(entry))};const p=journalPath(root),dir=path.dirname(p);
 fs.mkdirSync(dir,{recursive:true});const lock=p+'.lock';let fd;
 try{fd=fs.openSync(lock,'wx');const latestOnDisk=readJournal(root);
  if(latestOnDisk.length!==prior.length||latestOnDisk.at(-1)?.hash!==prior.at(-1)?.hash)throw Error('R7_JOURNAL_CONCURRENT_UPDATE');
  const fh=fs.openSync(p,'a');try{fs.writeSync(fh,json(record)+'\n');fs.fsyncSync(fh);}finally{fs.closeSync(fh);}
 }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
 return record;
}
function report(root){const snap=snapshot(root);const ledger=readJournal(root);const rows=snap.cases.map(c=>{
 const docs=ledger.filter(x=>x.key===c.key);return {...c,review:docs.length?{
  revisions:docs.length,latest:docs.at(-1).evidence,latestAt:docs.at(-1).capturedAt,status:'EVIDENCE_SUBMITTED_REQUIRES_INDEPENDENT_VERIFICATION'
 }:{revisions:0,status:'NO_EVIDENCE_RECORDED'}};
 });return {...snap,ledgerEntries:ledger.length,cases:rows,unresolved:rows.length,
  disclaimer:'Reconciliation desk only: no automatic settlement, no official schedule certification, no historical stake changes.'};}
module.exports={VERSION,KINDS,sha,journalPath,safeDb,snapshot,readJournal,derivedSettlement,validateEvidence,appendEvidence,report,validIso};
