'use strict';

const VERSION = 'TENNIS_DECISION_TRUTH_V1_PATCH38';
const FINAL_ACTION = Object.freeze({
  NO_BET: 'NO_BET',
  NO_BET_REVIEW: 'NO_BET_REVIEW',
  PAPER_ONLY: 'PAPER_ONLY',
  MICRO_STAKE: 'MICRO_STAKE',
  STANDARD_STAKE: 'STANDARD_STAKE'
});
function text(v){return String(v==null?'':v).trim();}
function upper(v){return text(v).toUpperCase();}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function hasDeepScan(row={}){
  const action=text(row.ds_action||row.dsAction||row.deep_scan_action||row.deepScanAction);
  return Boolean(action && !upper(action).includes('ATTESA'));
}
function resolveDecisionTruth(row={}){
  const stake=Math.max(0,finite(row.stake));
  const qualityCode=upper(row.quality_final_code||row.qualityFinalCode||row.quality_final_label||row.qualityFinalLabel);
  const qualityLabel=text(row.quality_final_label||row.qualityFinalLabel||row.quality_final_code||row.qualityFinalCode||'N/D');
  const deepScanProposal=text(row.ds_action||row.dsAction||row.deep_scan_action||row.deepScanAction||'N/D');
  const stakeStatus=upper(row.tennis_risk_authority_status||row.tennis_stake_authority_status||row.stake_authority_status);
  const hardBlock=qualityCode.includes('BLOCKED_HARD')||qualityCode.includes('BLOCCATA HARD')||upper(row.gate_allow_bet)==='0';
  const paperOnly=stakeStatus.includes('PAPER_ONLY')||stakeStatus.includes('CIRCUIT_BREAKER')||stakeStatus.includes('INSUFFICIENT_SAMPLE');
  let finalAction,dominantLabel,reason;
  if(stake>0){
    finalAction=stake<=2?FINAL_ACTION.MICRO_STAKE:FINAL_ACTION.STANDARD_STAKE;
    dominantLabel=stake<=2?`MICRO STAKE €${stake.toFixed(2)}`:`STAKE OPERATIVO €${stake.toFixed(2)}`;
    reason=`Stake finale autorizzato dall'autorità downstream: €${stake.toFixed(2)}.`;
  }else if(hardBlock){
    finalAction=FINAL_ACTION.NO_BET;dominantLabel='NO BET';reason=`Quality Gate finale ${qualityLabel}: veto operativo.`;
  }else if(paperOnly){
    finalAction=FINAL_ACTION.PAPER_ONLY;dominantLabel='PAPER ONLY';reason=`Autorità stake ${stakeStatus||'PAPER_ONLY'}: nessuna esposizione reale.`;
  }else if(qualityCode.includes('BLOCKED_SOFT')||qualityCode.includes('BLOCCATA SOFT')||qualityCode.includes('WATCHLIST')){
    finalAction=FINAL_ACTION.NO_BET_REVIEW;dominantLabel='NO BET · REVIEW';reason=`Quality Gate finale ${qualityLabel}; stake finale zero.`;
  }else{
    finalAction=FINAL_ACTION.NO_BET;dominantLabel='NO BET';reason='Nessuna autorità downstream ha autorizzato stake.';
  }
  return {version:VERSION,finalAction,dominantLabel,reason,operationalStake:stake,deepScanPresent:hasDeepScan(row),deepScanProposal,qualityCode,qualityLabel,stakeAuthorityStatus:stakeStatus||null,deepScanAuthority:false,qualityGateAuthority:true,stakeAuthority:true};
}
function summarizeRows(rows=[]){
  const decisions=(Array.isArray(rows)?rows:[]).map(resolveDecisionTruth);
  const byAction={};for(const d of decisions)byAction[d.finalAction]=(byAction[d.finalAction]||0)+1;
  return {version:VERSION,rows:decisions.length,byAction,contradictions:decisions.filter(d=>d.operationalStake<=0&&/VALUE CONFERMATO|VIA LIBERA|MICRO/i.test(d.deepScanProposal)).length};
}
module.exports={VERSION,FINAL_ACTION,hasDeepScan,resolveDecisionTruth,summarizeRows};
