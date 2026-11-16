'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');const math=require('./math');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function eventId(r){return hash(JSON.stringify([r.sport_type,r.league,r.match_date,r.home_team,r.away_team])).slice(0,24);}
function readMatches(root,sport='CALCIO'){
 const name=path.join(root,'backend','database_betting.db');if(!fs.existsSync(name))throw Error('DATABASE_NON_TROVATO');
 const db=new DatabaseSync(name,{readOnly:true});try{
  db.exec('PRAGMA query_only=ON');const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name));
  const required=['id','sport_type','match_date','home_team','away_team','prediction','odd','estimated_prob','league'];
  if(required.some(x=>!cols.has(x)))throw Error('SCHEMA_DB_INCOMPATIBILE');
  const optional=['calcio_event_key','match_exposure_key','market_type','status','calcio_lambda_home','calcio_lambda_away','calcio_xg_home','calcio_xg_away','calcio_lineup_status','reference_market_source','reference_market_quality','calcio_data_quality_status'];
  const select=[...required,...optional.filter(x=>cols.has(x))].join(',');
  const list=db.prepare(`SELECT ${select} FROM ai_forward_test WHERE UPPER(sport_type)=? ORDER BY id DESC LIMIT 2000`).all(sport);
  const map=new Map();for(const r of list){if(!r.home_team||!r.away_team||!r.match_date)continue;const id=eventId(r);if(!map.has(id))map.set(id,{id,sport,home:r.home_team,away:r.away_team,league:r.league,kickoff:r.match_date,rows:[]});const x=map.get(id);if(x.rows.length<15)x.rows.push({id:r.id,prediction:r.prediction,odd:r.odd,prob:r.estimated_prob,market:r.market_type||null,status:r.status,lineupStatus:r.calcio_lineup_status||null,referenceMarketSource:r.reference_market_source||null,referenceMarketQuality:r.reference_market_quality||null,dataQualityStatus:r.calcio_data_quality_status||null});}
  return [...map.values()].slice(0,300);
 }finally{db.close();}}
function journalFile(root){return path.join(root,'.bettingapp_calcio_market_editor','journal.jsonl');}
function getJournal(root){const p=journalFile(root);if(!fs.existsSync(p))return [];
 let prev='GENESIS',records=[];const content=fs.readFileSync(p,'utf8');if(content&&!content.endsWith('\n'))throw Error('JOURNAL_TRUNCATED');
 for(const line of content.split('\n').filter(Boolean)){const entry=JSON.parse(line);if(entry.prev!==prev)throw Error('JOURNAL_CHAIN_BROKEN');const {sha256,...rest}=entry;if(hash(JSON.stringify(rest))!==sha256)throw Error('JOURNAL_HASH_MISMATCH');prev=sha256;records.push(entry);}
 return records;}
function latest(root,id){const rows=getJournal(root).filter(x=>x.eventId===id);return rows.length?rows[rows.length-1]:null;}
function validateEvidence(data,kickoff){if(!data||typeof data!=='object'||Array.isArray(data))throw Error('EVIDENZE_OGGETTO_RICHIESTO');
 const allowed=['homeXg','awayXg','lineups','medicalHome','medicalAway','formHome','formAway','notes','clubEloHome','clubEloAway','marketReference'];let out={};
 for(const [key,v] of Object.entries(data)){if(!allowed.includes(key))throw Error('EVIDENZA_NON_PREVISTA:'+key);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('EVIDENZA_INVALIDA:'+key);
 const value=String(v.value??'').trim(),url=String(v.url||'').trim(),capturedAt=String(v.capturedAt||'').trim(),status=String(v.status||'USER_SUPPLIED');
 if(value.length>2000||url.length>700)throw Error('CAMPO_TROPPO_LUNGO');
 if(url&&!/^https:\/\//i.test(url))throw Error('URL_EVIDENZA_INVALIDO');
 if(capturedAt&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)||!Number.isFinite(Date.parse(capturedAt))))throw Error('DATA_EVIDENZA_INVALIDA');
 if(capturedAt&&Number.isFinite(Date.parse(kickoff))&&Date.parse(capturedAt)>=Date.parse(kickoff))throw Error('EVIDENZA_POST_MATCH');
 if(['homeXg','awayXg'].includes(key) && value && !(Number(value)>=0.1&&Number(value)<=6))throw Error('XG_FUORI_RANGE');
 if(value)out[key]={value,url,capturedAt:capturedAt?new Date(capturedAt).toISOString():null,status:'MANUAL_UNVERIFIED'};
 }
 return out;}
const CHECKLIST = Object.freeze([
  {code:'XG_REAL',label:'xG casa e trasferta',fields:['homeXg','awayXg'],note:'Valori xG e fonti, non proxy inventati'},
  {code:'MARKET_REFERENCE',label:'Riferimento mercato/no-vig',fields:['marketReference'],note:'Fonte del mercato e orario coerenti con le quote'},
  {code:'NEWS_HOME',label:'News e indisponibili casa',fields:['medicalHome'],note:'Solo indisponibili documentati'},
  {code:'NEWS_AWAY',label:'News e indisponibili ospite',fields:['medicalAway'],note:'Solo indisponibili documentati'},
  {code:'LINEUPS',label:'Formazioni e stato conferma',fields:['lineups'],note:'Indica se probabili o ufficiali'},
  {code:'CLUB_ELO',label:'Rating Elo due squadre',fields:['clubEloHome','clubEloAway'],note:'Specifica data e provenienza'},
  {code:'DS_GATE_FORWARD',label:'Esito DeepScan forward certificato',fields:[],note:'NON inseribile manualmente: prodotto dal motore dopo il controllo'}
]);
function missingEvidence(match,revision){
 const e=revision?.evidence||{};const rows=Array.isArray(match?.rows)?match.rows:[];
 return CHECKLIST.map(item=>{
  const complete=item.fields.length>0&&item.fields.every(f=>String(e[f]?.value||'').trim());
  const observedAutomatic=(item.code==='LINEUPS'&&rows.some(r=>r.lineupStatus&&/^(CONFIRMED|OFFICIAL|LINEUP_CONFIRMED)$/i.test(String(r.lineupStatus).trim())))
   ||(item.code==='MARKET_REFERENCE'&&rows.some(r=>r.referenceMarketSource));
  const status=complete?'MANUALE_DA_VERIFICARE':item.fields.length===0?'CALCOLO_AUTOMATICO':observedAutomatic?'AUTOMATICO_DA_VALIDARE':'MANCANTE';
  return {...item,status};
 });
}
function findMatchByRowId(root,rowId,sport='CALCIO'){
 const n=Number(rowId);if(!Number.isSafeInteger(n)||n<=0)throw Error('ROW_ID_INVALIDO');
 return readMatches(root,sport).find(m=>m.rows.some(r=>Number(r.id)===n))||null;
}
function saveRevision(root,match,body){
 const existing=getJournal(root);const requested=String(body.eventId||'');if(requested!==match.id)throw Error('MATCH_ID_MISMATCH');
 const verifiedKickoff=String(body.kickoffOverride||match.kickoff||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(verifiedKickoff)||!Number.isFinite(Date.parse(verifiedKickoff)))throw Error('KICKOFF_SENZA_FUSO_VERIFICABILE');
 const quotes=Array.isArray(body.quotes)?body.quotes:[];if(quotes.length>100)throw Error('TROPPE_QUOTE');
 const clean=quotes.map(math.validateQuote);
 for(const q of clean){if(Date.parse(q.capturedAt)>=Date.parse(verifiedKickoff))throw Error('QUOTA_POST_KICKOFF');}
 const evidence=validateEvidence(body.evidence||{},verifiedKickoff);if(!clean.length&&!Object.keys(evidence).length)throw Error('NESSUNA_QUOTA_O_EVIDENZA');
 const previous=existing.filter(x=>x.eventId===match.id).at(-1)||null;
 if(body.baseRevision!==null&&body.baseRevision!==undefined&&Number(body.baseRevision)!==(previous?.revision||0))throw Error('REVISION_CONFLICT');
 const record={schema:'CALCIO_EDITOR_V1',eventId:match.id,match:{home:match.home,away:match.away,league:match.league,kickoff:verifiedKickoff,rawKickoff:match.kickoff,manualKickoffUnverified:verifiedKickoff!==match.kickoff},revision:(previous?.revision||0)+1,recordedAt:new Date().toISOString(),quotes:clean,evidence,prev:existing.at(-1)?.sha256||'GENESIS'};
 const row={...record,sha256:hash(JSON.stringify(record))};const file=journalFile(root);fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(row)+'\n',{encoding:'utf8',flag:'a'});return row;}
function estimate(match,snapshot){const e=snapshot?.evidence||{};const h=Number(e.homeXg?.value),a=Number(e.awayXg?.value);const valid=Number.isFinite(h)&&Number.isFinite(a)&&h>=0.1&&a>=0.1;
 const score=valid?math.scoreDistribution(h,a):null;
 const quoteRows=(snapshot?.quotes||[]).map(q=>({...q,...(score?math.evaluate(score,q):{evPct:null,probabilities:null,model:'NO_DISTRIBUTION',calibrated:false})}));
 quoteRows.sort((x,y)=>(y.evPct??-1e8)-(x.evPct??-1e8));
 const b=math.brs({quotes:snapshot?.quotes||[],context:match,evidence:e,validDistribution:valid});
 const verdict='NO BET', previous='NO BET';
 return {matchId:match.id,revision:snapshot?.revision||0,quotes:quoteRows,brs:b,model:valid?'INDEPENDENT_POISSON_FROM_USER_XG':'NON_CALCOLABILE_DATI_MANCANTI',calibrated:false,verdict,previousVerdict:previous,verdictChangeProbability:'NON_STIMABILE',robustness:valid?'BASSA':'NON_STIMABILE',missing:valid?['Calibrazione empirica fuori campione','Quote eseguibili da validare']:['xG casa e trasferta con provenienza','Calibrazione empirica fuori campione'],warning:'Ricalcolo diagnostico, NON una certificazione del motore production. DeepScan originale valutato separatamente.'};}
function compare(match,before,after){const oldA=before?estimate(match,before):null,newA=estimate(match,after);const oldRank=oldA?oldA.quotes.map(q=>[q.market,q.side,q.line,q.bookmaker].join('|')):[];const newRank=newA.quotes.map(q=>[q.market,q.side,q.line,q.bookmaker].join('|'));
 const oldMap=new Map((oldA?.quotes||[]).map(q=>[[q.market,q.side,q.line,q.bookmaker].join('|'),q]));
 const markets=newA.quotes.map((q,i)=>{const key=[q.market,q.side,q.line,q.bookmaker].join('|'),prior=oldMap.get(key),oldPosition=oldRank.indexOf(key);
 return {market:key,oldRank:oldPosition<0?null:oldPosition+1,newRank:i+1,oldEvPct:prior?.evPct??null,newEvPct:q.evPct,deltaEvPct:prior?.evPct!==null&&prior?.evPct!==undefined&&q.evPct!==null?q.evPct-prior.evPct:null};});
 return {oldVerdict:oldA?.verdict||'NESSUNA_REVISIONE',newVerdict:newA.verdict,oldBRS:oldA?.brs.total??null,newBRS:newA.brs.total,deltaBRS:oldA?newA.brs.total-oldA.brs.total:null,markets};}
module.exports={readMatches,getJournal,latest,saveRevision,estimate,compare,journalFile,validateEvidence,eventId,missingEvidence,findMatchByRowId,CHECKLIST};
