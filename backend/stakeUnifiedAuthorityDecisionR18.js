'use strict';
// R15: single, pure, non-monetary decision contract consumed by both sports.
// Positive paper stake is never an instruction to place a real order.
const VERSION='BETTINGAPP_R18_UNIFIED_AUTHORITY_DECISION_V2';
const finite=v=>v===null||v===undefined||typeof v==='boolean'||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
const uniq=items=>[...new Set(items.filter(Boolean).map(String))];
function decide({sport,approved=false,proposedStake=0,minimumStake=0,expectedValuePct=null,hasVerifiedValue=false,hardReasons=[],gateReasons=[],stage=''}={}){
  if(!['CALCIO','TENNIS'].includes(sport))throw Error('R18_SPORT_REQUIRED');
  const amount=finite(proposedStake),min=finite(minimumStake),ev=finite(expectedValuePct);
  const reasons=uniq([...hardReasons,...gateReasons]);
  if(amount===null||amount<0)reasons.push('STAKE_INVALID');
  if(min===null||min<0)reasons.push('MINIMUM_STAKE_INVALID');
  if(approved===true && (amount===null || !(amount>0)))reasons.push('APPROVED_WITHOUT_POSITIVE_STAKE');
  if(approved===true && min!==null && amount!==null && amount+1e-9<min)reasons.push('APPROVED_BELOW_MINIMUM');
  if(hasVerifiedValue===true && (ev===null||ev<=0))reasons.push('VALUE_PROOF_CONTRADICTS_EV');
  const allowed=approved===true && reasons.length===0 && amount!==null && amount>0 && min!==null && amount+1e-9>=min;
  const state=allowed ? (hasVerifiedValue ? 'VALIDATED_EDGE_PAPER_STAKE' : 'PAPER_STAKE_AUTHORIZED_EDGE_UNPROVEN')
    : (ev!==null && ev<=0 ? 'NO_BET_NON_POSITIVE_EV'
       : reasons.length ? 'NO_BET_AUTHORITY_VETO' : 'WATCHLIST_NO_CERTIFIED_STAKE');
  return Object.freeze({version:VERSION,sport,stage,code:state,eligible:allowed,
    finalPaperStake:allowed?Math.round(amount*100)/100:0,
    minimumStake:min, expectedValuePct:ev, edgeVerified:allowed&&hasVerifiedValue,
    rejectionCodes:uniq(reasons),manualExecutionOnly:true,realMoneyAuthorized:false,automaticExecution:false});
}
module.exports={VERSION,decide};
