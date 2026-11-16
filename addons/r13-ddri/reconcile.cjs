'use strict';
const {oddsCheck,noVig,scenarioEV}=require('./finance.cjs');
const {evidenceReview,calibrationReview,joinReview,strictTime}=require('./provenance.cjs');
const REASONS=['LIVE_RECENT_CANONICAL_ATP_WTA_DATA_NOT_VALIDATED_OR_ACTIVATED','MODEL_JOIN_MATCH_LEVEL_AND_CALIBRATION_NOT_REPAIRED_IN_PRODUCTION_CORE','TENNIS_TOTALS_STEP50B_CANDIDATE_EMISSION_NOT_PROVED_WITHOUT_REAL_TRACE','CALCIO_ROBUST_EV_REPLAY_NOT_RECOMPUTED_WITH_ORIGINAL_INPUT_SNAPSHOT','CALCIO_AUTHORITY_NOT_ELIGIBLE_INNER_PREREQUISITE_MAY_BE_UNOBSERVED','HISTORICAL_ARITHMETIC_MISMATCH_REQUIRES_AS_OF_ODDS_AND_PROBABILITY','EXTREME_QUOTES_REQUIRE_INDEPENDENT_ORIGINAL_BOOKMAKER_SOURCE','NO_REAL_BET_OR_ORDER_OR_SETTLEMENT_ACTION'];
function parseR12Text(s){
 const items=s.match(/^UNRESOLVED=(.+)$/m)?.[1].split(/\s*;\s*/).map(v=>v.trim()).filter(Boolean)||[];
 let health=null;try{const m=s.match(/^HEALTH=(\{.+\})$/m);if(m)health=JSON.parse(m[1]);}catch{}
 const groups={};for(const sport of ['TENNIS','CALCIO']){
  const m=s.match(new RegExp('^'+sport+': RECORDS=(\\d+) ZERO=(\\d+)','m'));
  const flags=s.match(new RegExp('^'+sport+': RECORDS=[^\\r\\n]+\\r?\\nFLAGS=(\\{[^\\r\\n]+\\})','m'))||s.match(new RegExp('^'+sport+': RECORDS=[^\\r\\n]+ FLAGS=(\\{[^\\r\\n]+\\})','m'));
  groups[sport]={records:m?Number(m[1]):null,zero:m?Number(m[2]):null,flags:flags?JSON.parse(flags[1]):{}};
 }
 return {generatedAt:s.match(/^GENERATED=(.+)$/m)?.[1]||null,dbUnchanged:/^DB_UNCHANGED=true$/m.test(s),groups,health,unresolved:items,missingCategories:REASONS.filter(x=>!items.includes(x)),unrecognizedCategories:items.filter(x=>!REASONS.includes(x))};
}
function asOfReplay(row,{tolerancePP=0.05}={}){
 const blocks=[];
 if(!row||typeof row!=='object')throw Error('REPLAY_INPUT_REQUIRED');
 if(!row.snapshot||typeof row.snapshot!=='object')return {status:'UNPROVABLE',reasons:['ORIGINAL_AS_OF_SNAPSHOT_MISSING']};
 const s=row.snapshot;
 let asof,when;try{asof=strictTime(row.eventStartAt);when=strictTime(s.capturedAt);}catch{blocks.push('TIMESTAMP_INVALID');}
 if(asof!==undefined&&when!==undefined&&when>asof)blocks.push('QUOTE_AFTER_EVENT_START');
 if(s.marketType!=='binary'&&s.marketType!=='one_x_two')blocks.push('MARKET_CONTRACT_REQUIRED_FOR_REPLAY');
 if(s.oddsUnit!=='decimal')blocks.push('ODDS_UNIT_UNVERIFIED');
 try{oddsCheck(s.odds);}catch(e){blocks.push(e.message);}
 if(typeof s.calibratedProbability!=='number'||s.probabilityUnit!=='fraction'||s.calibratedProbability<0||s.calibratedProbability>1)blocks.push('CALIBRATED_PROBABILITY_UNVERIFIED');
 if(!s.bookmakerEvidence||!evidenceReview(s.bookmakerEvidence,{decisionAsOf:s.capturedAt,maxAgeDays:1,requireBookmaker:true}).ok)blocks.push('ORIGINAL_BOOKMAKER_EVIDENCE_MISSING');
 if(s.odds>=100)blocks.push('EXTREME_ODDS_QUARANTINE');
 if(blocks.length)return {status:'UNPROVABLE',reasons:[...new Set(blocks)]};
 const ev=100*(s.odds*s.calibratedProbability-1),implicit=100/s.odds;
 const evDelta=typeof row.storedEvPct==='number'?Math.abs(ev-row.storedEvPct):null;
 return {status:'NUMERIC_REPLAY_ONLY',impliedPct:implicit,calculatedEvPct:ev,storedEvPct:row.storedEvPct??null,deltaPct:evDelta,arithmeticMatch:evDelta===null?null:evDelta<=tolerancePP,warning:'No proof of historical model calibration or trading eligibility. No DB write.'};
}
function reviewEvent(inp){
 if(!inp||!inp.match||!inp.decisionAsOf)throw Error('EVENT_INPUT_REQUIRED');
 const summary={version:'R13_DDRI_V1',mode:'REVIEW_ONLY',realStakeAllowed:false,dbWriteAllowed:false,match:inp.match,decisionAsOf:inp.decisionAsOf,markets:[],issues:[]};
 let asOf;
 try{asOf=strictTime(inp.decisionAsOf);}catch(e){summary.issues.push(e.message);}
 try{const kickoff=strictTime(inp.match.startAt);if(asOf>=kickoff)summary.issues.push('NOT_PREMATCH');}catch(e){summary.issues.push('MATCH_START_TIME_MISSING');}
 const calib=calibrationReview(inp.calibration,{decisionAsOf:inp.decisionAsOf});
 if(!calib.ok)summary.issues.push(...calib.reasons);
 if(!Array.isArray(inp.markets))summary.issues.push('MARKET_LIST_MISSING');
 for(const m of inp.markets||[]){
  const reasons=[...summary.issues],join=joinReview(inp.match,m.matchIdentity);if(!join.ok)reasons.push(...join.reasons);
  const ev=evidenceReview(m.quoteEvidence,{decisionAsOf:inp.decisionAsOf,maxAgeDays:2,requireBookmaker:true});if(!ev.ok)reasons.push(...ev.reasons);
  const normalized={id:m.id,type:m.bet?.type||null,odds:m.bet?.odds,nominalEvPct:null,robustEvPct:null,edgePp:null,noVig:null,reasons:[],status:'NO_BET_REVIEW_ONLY'};
  try{oddsCheck(m.bet?.odds);}catch(e){reasons.push(e.message);}
  if(m.bet?.odds>=100)reasons.push('EXTREME_ODDS_QUARANTINE');
  if(!m.bet?.settlementRuleId)reasons.push('SETTLEMENT_RULE_NOT_IDENTIFIED');
  else if(m.bet.type?.startsWith('football_')&&m.bet.settlementRuleId!=='FULL_TIME_90_MINUTES_REGULAR_TIME')reasons.push('FOOTBALL_SETTLEMENT_PERIOD_NOT_VERIFIED');
  else if(m.bet.type?.startsWith('tennis_')&&m.bet.settlementRuleId!=='PINNACLE_2026_05')reasons.push('TENNIS_BOOKMAKER_RULE_NOT_IMPLEMENTED');
  if(typeof m.quoteEvidence?.originalOdds!=='number'||Math.abs(m.bet.odds-m.quoteEvidence.originalOdds)>1e-6)reasons.push('QUOTE_PROOF_ODDS_MISMATCH_OR_MISSING');
  if(!m.lowerBoundProof||m.lowerBoundProof.method!=='WALK_FORWARD_OUT_OF_SAMPLE_BOUND'||!Number.isInteger(m.lowerBoundProof.sampleN)||m.lowerBoundProof.sampleN<100)reasons.push('PRUDENTIAL_PROBABILITY_BOUND_PROOF_MISSING');
  else try{if(strictTime(m.lowerBoundProof.generatedAt)>strictTime(inp.decisionAsOf))reasons.push('LOWER_BOUND_COMPUTED_AFTER_DECISION');}catch(e){reasons.push('LOWER_BOUND_TIMESTAMP_INVALID');}
  if(m.fullMarketOdds && ((m.bet?.type==='football_1x2'&&m.fullMarketOdds.length!==3)||(m.bet?.type==='tennis_match_winner'&&m.fullMarketOdds.length!==2)))reasons.push('FULL_MARKET_CARDINALITY_INVALID');

  if(typeof m.p==='number' && m.p>=0&&m.p<=1&&typeof m.pLow==='number'&&m.pLow>=0&&m.pLow<=m.p){
   if(m.bet?.type==='football_1x2'||m.bet?.type==='tennis_match_winner'){
    normalized.nominalEvPct=100*(m.bet.odds*m.p-1);normalized.robustEvPct=100*(m.bet.odds*m.pLow-1);normalized.edgePp=100*(m.p-1/m.bet.odds);
   }else reasons.push('BINARY_PROBABILITY_NOT_SUFFICIENT_FOR_ASIAN_MARKET');
  }else reasons.push('PROBABILITY_OR_LOWER_BOUND_NOT_VERIFIED');
  if(Array.isArray(m.distribution)){
   try{normalized.nominalEvPct=scenarioEV(m.bet,m.distribution);if(Array.isArray(m.conservativeDistribution))normalized.robustEvPct=scenarioEV(m.bet,m.conservativeDistribution);else reasons.push('ROBUST_DISTRIBUTION_MISSING');}catch(e){reasons.push('PAYOFF_DISTRIBUTION_ERROR:'+e.message);}
  }
  if(m.fullMarketOdds){
   if(!m.fullMarketProof||m.fullMarketProof.verified!==true||!m.fullMarketProof.bookmaker||m.fullMarketProof.bookmaker!==m.quoteEvidence?.bookmaker||m.fullMarketProof.marketId!==m.matchIdentity?.marketId||!m.fullMarketProof.sourceSha256||!/^[0-9a-f]{64}$/i.test(m.fullMarketProof.sourceSha256))reasons.push('FULL_MARKET_ORIGINAL_PROOF_MISSING');
   else try{if(strictTime(m.fullMarketProof.capturedAt)>strictTime(inp.decisionAsOf))reasons.push('FULL_MARKET_AFTER_DECISION');}catch(e){reasons.push('FULL_MARKET_TIMESTAMP_INVALID');}
   try{normalized.noVig=noVig(m.fullMarketOdds);}catch(e){reasons.push(e.message);}
  } else reasons.push('FULL_MARKET_NO_VIG_NOT_PROVED');
  if(normalized.robustEvPct!==null && normalized.robustEvPct<=0)reasons.push('ROBUST_EV_NOT_POSITIVE');
  if(normalized.robustEvPct===null)reasons.push('ROBUST_EV_NOT_COMPUTABLE');
  normalized.reasons=[...new Set(reasons)];normalized.status=normalized.reasons.length?'NO_BET_INSUFFICIENT_PROOF':'ANALYSIS_CANDIDATE_ONLY';
  summary.markets.push(normalized);
 }
 summary.markets.sort((a,b)=>(b.robustEvPct??-1e10)-(a.robustEvPct??-1e10));
 summary.selectedMarketId=summary.markets.find(m=>m.status==='ANALYSIS_CANDIDATE_ONLY')?.id||null;
 summary.candidateCount=summary.markets.filter(m=>m.status==='ANALYSIS_CANDIDATE_ONLY').length;
 summary.candidateSingleIds=summary.markets.filter(m=>m.status==='ANALYSIS_CANDIDATE_ONLY').slice(0,2).map(m=>m.id);
 summary.complementaryPairProven=false;
 summary.recommendation='NO_REAL_STAKE_OR_ORDER; authorization never inferred from analysis';
 return summary;
}
module.exports={REASONS,parseR12Text,asOfReplay,reviewEvent};
