'use strict';
/* PF Studio — independent, explicitly manual, no mutation of authoritative betting records.
   'Stake' here is an accounting entry for a paper experiment, never a cash order. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PF = require('./calcioProbabilityFirst');
const VERSION = 'CALCIO_PF_STUDIO_LEDGER_V2_20261106';
const FILE = path.resolve(__dirname,'..','calcio_pf_studio_ledger.jsonl');
const MAX_STUDY_STAKE = 2;
const MAX_PER_DAY = 5;
const MAX_PER_EVENT = 1;
const MAX_ENTRIES = 5000;
const MAX_QUOTE_AGE_HOURS = 24;
const MAX_START_AHEAD_DAYS = 22;
const MIN_EXPERIMENT_RELIABILITY = 30;
function n(v) {const x=Number(v);return Number.isFinite(x)?x:null;}
function safeObj(s){try{const x=JSON.parse(s);return x&&typeof x==='object'?x:{}}catch{return {}}}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
function canonical(s){return String(s??'').trim().toLowerCase().normalize('NFKC').replace(/\s+/g,' ')}
function eventKey(row){return [canonical(row.league),canonical(row.home_team),canonical(row.away_team),String(row.match_date||'')].join('|')}
function loadLedger(file=FILE){
 if(!fs.existsSync(file))return [];
 const raw=fs.readFileSync(file,'utf8');
 if(raw.length>4_000_000)throw Error('PF_STUDIO_LEDGER_TOO_LARGE');
 const lines=raw.split('\n').filter(Boolean);
 if(lines.length>MAX_ENTRIES)throw Error('PF_STUDIO_LEDGER_LIMIT');
 let previous='GENESIS';
 return lines.map((line,index)=>{
   const rec=safeObj(line);
   if(!rec.studioId || rec.previousHash!==previous || rec.hash!==sha(JSON.stringify({...rec,hash:undefined})))throw Error('PF_STUDIO_LEDGER_INTEGRITY_AT_'+index);
   previous=rec.hash;
   return rec;
 });
}
function rows(db,limit=80){
 return db.prepare(`SELECT id,home_team,away_team,match_date,league,prediction,odd,estimated_prob,
 calcio_prediction_reliability_score,calcio_data_quality_status,calcio_deepscan_final_state_action,calcio_operational_stake,
 calcio_market_selection_audit FROM ai_forward_test
 WHERE sport_type='CALCIO' AND calcio_market_selection_audit IS NOT NULL AND calcio_market_selection_audit <> ''
 ORDER BY id DESC LIMIT ?`).all(Math.min(150,Math.max(1,limit)));
}
function latestCandidates(row,config,nowMs=Date.now()){
 const audit=safeObj(row.calcio_market_selection_audit);
 const pool=Array.isArray(audit.finalizationCandidates)?audit.finalizationCandidates:[];
 const matchAt=Date.parse(row.match_date||'');
 const future=Number.isFinite(matchAt)&&matchAt>nowMs&&matchAt-nowMs<=MAX_START_AHEAD_DAYS*86400_000;
 const entries=[];
 for(const cand of pool){
   if(!cand || typeof cand!=='object')continue;
   const pf=PF.assess(cand,config);
   const odd=n(cand.odd),p=n(cand.estimatedProb ?? cand.estimated_prob),reliability=n(cand.prediction_reliability_score);
   const cert=cand.oddsCertification||{};
   const source=cert.selectedSource||{};
   const updated=Date.parse(source.lastUpdate||'');
   const quoteFresh=Number.isFinite(updated) && updated<=nowMs+60000 && nowMs-updated<=MAX_QUOTE_AGE_HOURS*3600_000;
   const supported=['1','X','2','O2.5','U2.5'].includes(String(cand.prediction||'').toUpperCase().replace(/\s+/g,''));
   // Experimental study explicitly tolerates a low-quality model *only in its separate paper ledger*.
   // These records cannot become real orders or operational stake and retain all original vetoes.
   const allowed=Boolean(config.mode==='PROBABILITY_FIRST' && future && supported && pf.withinOdds && pf.quoteCertified && quoteFresh
     && p!==null && p>=config.minProbabilityPct && reliability!==null && reliability>=MIN_EXPERIMENT_RELIABILITY
     && odd!==null && odd>1 && Number(config.paperSimulationStakeEuro)>0);
   const reasons=[];
   if(!future)reasons.push('EVENTO_NON_FUTURO_O_TROPPO_DISTANTE');
   if(!pf.withinOdds)reasons.push('QUOTA_FUORI_FASCIA');
   if(!supported)reasons.push('MERCATO_NON_SUPPORTATO');
   if(!pf.quoteCertified)reasons.push('QUOTE_NON_VERIFICATE');
   if(!quoteFresh)reasons.push('QUOTA_SCADUTA_O_TIMESTAMP_ASSENTE');
   if(p===null||p<config.minProbabilityPct)reasons.push('PROBABILITA_INSUFFICIENTE');
   if(reliability===null||reliability<MIN_EXPERIMENT_RELIABILITY)reasons.push('AFFIDABILITA_STUDIO_SOTTO_30');
   if(config.mode!=='PROBABILITY_FIRST')reasons.push('PF_NON_ATTIVO');
   const caution = (String(row.calcio_data_quality_status||'')==='DATA_QUALITY_BLOCKED'
     || String(row.calcio_deepscan_final_state_action||'').toUpperCase().includes('RISCHIO'));
   entries.push({id:row.id,home:row.home_team,away:row.away_team,matchDate:row.match_date,league:row.league,
      prediction:String(cand.prediction||''),odd,pWin:p,confidence:reliability,bookmaker:source.bookmakerTitle||null,
      priceUpdatedAt:source.lastUpdate||null,quality:row.calcio_data_quality_status||'UNKNOWN',deepScan:row.calcio_deepscan_final_state_action||'UNKNOWN',
      paperStudyEligible:allowed,originalOperationalStake:n(row.calcio_operational_stake)||0,
      caution: caution?'MODELLO_CON_VETO_OPERATIVO_NON_AUTORIZZATO':'DATI_STUDIO_NON_CERTIFICANO_P_WIN', reasons,
      eventKey:eventKey(row), sourceFingerprint:sha([source.bookmakerKey,source.lastUpdate,cand.prediction,cand.odd,source.providerEventId||''].join('|'))});
 }
 return entries;
}
function report(db,opts={}){
 const config=PF.readConfig(); const today=Date.now(); const ledger=loadLedger(opts.file||FILE);
 const seen = new Set(), recommendations=[];
 for(const row of rows(db,opts.limit||80)){
   const key=eventKey(row); if(seen.has(key))continue; seen.add(key);
   const candidates=latestCandidates(row,config,today).sort((a,b)=>Number(b.paperStudyEligible)-Number(a.paperStudyEligible) || b.pWin-a.pWin);
   for(const c of candidates)if(c.paperStudyEligible)recommendations.push(c);
 }
 const savedEvents=new Set(ledger.map(x=>x.eventKey));
 return {success:true,version:VERSION,mode:'PF_PAPER_STUDIO_ONLY',config:{...config},limits:{maxStudyStakeEuro:MAX_STUDY_STAKE,maxPerDay:MAX_PER_DAY,maxPerEvent:MAX_PER_EVENT,minStudyReliability:MIN_EXPERIMENT_RELIABILITY,quoteMaxAgeHours:MAX_QUOTE_AGE_HOURS},
  recentLedger:ledger.slice(-25).reverse(),count:ledger.length,eligible:recommendations.slice(0,30).map(c=>({...c,alreadyRecorded:savedEvents.has(c.eventKey)})),
  explanation:'Studio manuale con registro virtuale separato; lo stake operativo, gli esiti e il bankroll ufficiale non vengono modificati.'};
}
function record(db,{id,prediction,confirm},opts={}){
 if(confirm!==true)throw Error('PF_STUDIO_EXPLICIT_CONFIRM_REQUIRED');
 if(process.env.SAFE13_MANUAL_PAPER!=='1')throw Error('PF_STUDIO_MANUAL_ONLY');
 const betId=n(id);if(!Number.isSafeInteger(betId)||betId<1)throw Error('BET_ID_INVALID');
 const pred=String(prediction||'');
 const rec=db.prepare(`SELECT id,home_team,away_team,match_date,league,prediction,odd,estimated_prob,
 calcio_prediction_reliability_score,calcio_data_quality_status,calcio_deepscan_final_state_action,calcio_operational_stake,
 calcio_market_selection_audit FROM ai_forward_test WHERE id=? AND sport_type='CALCIO'`).get(betId);
 if(!rec)throw Error('PF_STUDIO_BET_NOT_FOUND');
 const config=PF.readConfig();
 const selected=latestCandidates(rec,config).find(c=>c.prediction===pred);
 if(!selected||!selected.paperStudyEligible)throw Error('PF_STUDIO_CANDIDATE_NOT_ELIGIBLE_'+(selected?.reasons||[]).join('_'));
 const file=opts.file||FILE; const current=loadLedger(file),todayIso=new Date().toISOString().slice(0,10);
 if(current.some(x=>x.eventKey===selected.eventKey))return {success:true,idempotent:true,entry:current.find(x=>x.eventKey===selected.eventKey)};
 if(current.filter(x=>x.recordedAt.slice(0,10)===todayIso).length>=MAX_PER_DAY)throw Error('PF_STUDIO_DAILY_CAP');
 if(current.length>=MAX_ENTRIES)throw Error('PF_STUDIO_LEDGER_CAP');
 const stake=Math.min(MAX_STUDY_STAKE,Number(config.paperSimulationStakeEuro));
 const previousHash=current.length?current.at(-1).hash:'GENESIS';
 const entry={version:VERSION,studioId:crypto.randomUUID(),previousHash,recordedAt:new Date().toISOString(),
  eventKey:selected.eventKey,betId,league:selected.league,match:selected.home+' - '+selected.away,matchDate:selected.matchDate,
  prediction:selected.prediction,bookmaker:selected.bookmaker,priceUpdatedAt:selected.priceUpdatedAt,odds:selected.odd,
  modelWinPct:selected.pWin,modelReliability:selected.confidence,originalDataQuality:selected.quality,
  originalDeepScan:selected.deepScan,originalOperationalStakeEuro:selected.originalOperationalStake,
  stakeEuro:Number(stake.toFixed(2)),ledgerType:'EXPERIMENTAL_PAPER_STUDIO',caution:selected.caution,
  selectionSourceHash:selected.sourceFingerprint,settlement:'NOT_SETTLED',realMoney:false,officialBankrollImpact:0};
 entry.hash=sha(JSON.stringify(entry));
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 return {success:true,idempotent:false,entry};
}
function setupAudit(db){
 let current={}; try{const row=db.prepare('SELECT config_json FROM system_settings WHERE id=1').get();current=safeObj(row?.config_json)}catch(_){}
 const config=PF.readConfig();
 return {success:true,readOnly:true,probabilityFirst:config,legacyValue:{baseEdge:current.baseEdge??null,baseProb:current.baseProb??null,maxOdd:current.maxOdd??null,onlyGlobal:Boolean(current.onlyGlobal),useCrossReference:Boolean(current.useCrossReference),useHistoricalOpt:Boolean(current.useHistoricalOpt),paperTradingParams:current.paperTradingParams||{}},
  important:'Le soglie legacy Edge/Prob governano la logica Value/Stake autorevole; la configurazione Probability First seleziona i mercati, ma non elimina i veto finali. Nessun parametro viene modificato da questa diagnostica.'};
}
module.exports={VERSION,FILE,loadLedger,latestCandidates,report,record,setupAudit};
