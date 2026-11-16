/**
 * BettingApp Quant V2 (2026-11-04).
 * Decisione EV prudente, nessuno score astratto per autorizzare stake.
 * Fornisce solo una decisione paper-operational; non esegue scommesse reali.
 * Vietato usare quote di chiusura/result/CLV futuro come feature prematch.
 */
'use strict';
const VERSION='BETTINGAPP_QUANT_V2_20261104_R1';
const SETTINGS=Object.freeze({minPrudentEvPct:2, minReliability:55,
  uncertaintyFloorPp:2, maxUncertaintyPp:8, kellyFraction:.15,
  maxBankrollPct:1, minPositiveStakeEur:2,
  dataFreshnessMinutes:180});
const number=(v)=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const round=(v,n=2)=>Math.round((v+Number.EPSILON)*10**n)/10**n;
const has=(s,a)=>a.some(x=>String(s||'').toUpperCase().includes(x));
const HARD_VETO=['HIGH_RISK','MODEL_RISK','ALTO RISCHIO','RISCHIO MODELLO','VALUE TRAP','SCARTA','BLOCKED_HARD','DATA_CORRUPT','IDENTITY_CONFLICT','SUSPEND','CIRCUIT_BREAKER'];
const FUTURE_INPUT=['closingOdds','closingLine','closingLineValue','clvPct','result','profit','settlement','closing_odd','clv_verified'];
function reject(reasons,snapshot={}){
 return {version:VERSION,bet:false,action:'NO_BET',reasons:[...new Set(reasons)],stake:0,
   modelProbabilityPct:null,adjustedProbabilityPct:null,prudentProbabilityPct:null,
   fairOdd:null,evPct:null,prudentEvPct:null,edgePp:null,...snapshot};
}
function evaluate(input={}){
 const reasons=[];
 if(input.mode==='PREMATCH' && FUTURE_INPUT.some(k=>Object.prototype.hasOwnProperty.call(input,k)))reasons.push('LEAKAGE_PREMATCH');
 const pPct=number(input.calibratedProbabilityPct??input.probabilityPct);
 const quote=number(input.netOdd??input.odd);
 const bank=number(input.bankroll);
 const confidence=number(input.reliabilityPct);
 if(!(pPct>0&&pPct<100))reasons.push('MODEL_PROBABILITY_MISSING');
 if(!(quote>1&&quote<=1000))reasons.push('INVALID_EXECUTABLE_ODD');
 if(!(bank>0))reasons.push('INVALID_BANKROLL');
 if(confidence===null||confidence<SETTINGS.minReliability)reasons.push('LOW_RELIABILITY');
 if(input.oddCertified!==true)reasons.push('UNCERTIFIED_ODD');
 if(input.identityCertified===false)reasons.push('IDENTITY_CONFLICT');
 if(input.marketCertified===false)reasons.push('MARKET_CONFLICT');
 if(input.hardBlock===true)reasons.push('HARD_BLOCK');
 if(input.deepscanVeto===true||has(input.deepscanAction,HARD_VETO))reasons.push('DEEPSCAN_VETO');
 if(input.eventAlreadyStarted===true)reasons.push('EVENT_STARTED');
 if(input.dataStale===true)reasons.push('STALE_DATA');
 if(Array.isArray(input.existingHardReasons)&&input.existingHardReasons.length)reasons.push(...input.existingHardReasons.map(x=>'LEGACY_GUARD:'+String(x)));
 // Correzioni del DeepScan consentite solo con delta verificato, pre-match e provenienza.
 const delta=number(input.verifiedAdjustmentPp);
 let adjusted=pPct;
 if(delta!==null&&delta!==0){
   if(input.adjustmentVerified!==true||!input.adjustmentSource||!input.adjustmentTimestamp)reasons.push('UNVERIFIED_ADJUSTMENT');
   else if(Math.abs(delta)>5)reasons.push('ADJUSTMENT_REQUIRES_RECALIBRATION');
   else if(pPct!==null)adjusted=clamp(pPct+delta,0.01,99.99);
 }
 let gap=number(input.uncertaintyPp);
 if(gap===null){
   // Non simuliamo intervalli di confidenza certificati: floor prudenziale ESPlicito.
   // Non è un intervallo statistico certificato.
   gap=SETTINGS.uncertaintyFloorPp;
 }
 if(gap<0||gap>SETTINGS.maxUncertaintyPp)reasons.push('INVALID_UNCERTAINTY');
 const lower=adjusted!==null?clamp(adjusted-Math.max(0,gap),0.01,99.99):null;
 const ev=(adjusted!==null&&quote!==null)?(adjusted/100*quote-1)*100:null;
 const evLow=(lower!==null&&quote!==null)?(lower/100*quote-1)*100:null;
 const fair=adjusted!==null?100/adjusted:null;
 const marketImp=quote?100/quote:null;
 const base={modelProbabilityPct:pPct===null?null:round(pPct,4),adjustedProbabilityPct:adjusted===null?null:round(adjusted,4),
  prudentProbabilityPct:lower===null?null:round(lower,4),fairOdd:fair===null?null:round(fair,4),
  evPct:ev===null?null:round(ev,3),prudentEvPct:evLow===null?null:round(evLow,3),
  edgePp:(marketImp===null||adjusted===null)?null:round(adjusted-marketImp,3),
  uncertaintyMethod:input.uncertaintyPp==null?'UNVALIDATED_PRUDENTIAL_FLOOR':'SUPPLIED_UPSTREAM',
  uncertaintyPp:round(gap,3),minPrudentEvPct:SETTINGS.minPrudentEvPct,
  confidenceType:'RELIABILITY_SCORE_NOT_WIN_PROBABILITY',mode:input.mode||'PREMATCH'};
 if(reasons.length)return reject(reasons,base);
 if(evLow<SETTINGS.minPrudentEvPct)return reject(['PRUDENT_EV_BELOW_THRESHOLD'],base);
 const fullKelly=(lower/100*quote-1)/(quote-1);
 const cap=bank*SETTINGS.maxBankrollPct/100;
 const raw=Math.max(0,fullKelly*SETTINGS.kellyFraction*bank);
 let stake=Math.min(raw,cap);
 if(stake>0&&stake<SETTINGS.minPositiveStakeEur&&cap>=SETTINGS.minPositiveStakeEur)stake=SETTINGS.minPositiveStakeEur;
 stake=round(stake);
 if(stake<SETTINGS.minPositiveStakeEur)return reject(['STAKE_BELOW_MINIMUM'],base);
 if(input.downstreamAuthorized===false)return reject(['DOWNSTREAM_AUTHORITY_REJECTED'],base);
 return {version:VERSION,bet:true,action:'BET',stake,reasons:[],theoreticalStake:round(raw),
   capStake:round(cap),...base};
}
module.exports={VERSION,SETTINGS,evaluate,reject};
