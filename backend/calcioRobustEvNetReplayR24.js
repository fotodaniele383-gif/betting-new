"use strict";
// R24: canonical gross-to-net EV arithmetic before V15 and R9 risk proof.
// No DB writes, no real-money execution and no authority bypass.
const VERSION='BETTINGAPP_R24_GROSS_NET_EV_REPLAY_V1';
function f(v){if(v===null||v===undefined||v===''||typeof v==='boolean')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=3){return Number(v.toFixed(d))}
function reconcile(input={}){
  const p=f(input.robustProbabilityPct),gross=f(input.grossOdd),net=f(input.netOdd),reported=f(input.reportedGrossEvPct);
  const proof=input.executableOddProof&&typeof input.executableOddProof==='object'?input.executableOddProof:{};
  const result={version:VERSION,ok:false,status:'FAIL_CLOSED',grossOdd:gross,netOdd:net,robustProbabilityPct:p,
    reportedGrossEvPct:reported,grossReplayEvPct:null,netReplayEvPct:null,commissionPct:null,
    exchangeSource:proof.exchangeSource===true,reasons:[],monetaryAuthority:false};
  const reasons=result.reasons;
  if(!(p>0&&p<100))reasons.push('ROBUST_PROBABILITY_INVALID');
  if(!(gross>1.01&&gross<=25))reasons.push('GROSS_ODD_INVALID');
  if(!(net>1.01&&net<=25))reasons.push('NET_ODD_INVALID');
  if(reported===null)reasons.push('REPORTED_GROSS_EV_MISSING');
  if(reasons.length)return result;
  const grossReplay=(p/100*gross-1)*100;
  result.grossReplayEvPct=round(grossReplay);
  if(Math.abs(grossReplay-reported)>0.25+1e-9)reasons.push('GROSS_EV_REPLAY_MISMATCH');
  if(net>gross+0.005)reasons.push('NET_ODD_EXCEEDS_GROSS');
  const proofGross=f(proof.grossOdd),proofNet=f(proof.netOdd),fee=f(proof.commissionPct);
  if(proofGross===null||Math.abs(proofGross-gross)>0.005)reasons.push('PROVENANCE_GROSS_ODD_MISMATCH');
  if(proofNet===null||Math.abs(proofNet-net)>0.005)reasons.push('PROVENANCE_NET_ODD_MISMATCH');
  if(fee===null||fee<0||fee>20)reasons.push('COMMISSION_INVALID');
  else{
    const recomputedNet=1+(gross-1)*(1-fee/100);
    if(Math.abs(recomputedNet-net)>0.015)reasons.push('COMMISSION_ARITHMETIC_MISMATCH');
    result.commissionPct=fee;
    if(fee>0&&proof.exchangeSource!==true)reasons.push('COMMISSION_NOT_EXCHANGE_PROVEN');
    if(fee===0&&Math.abs(gross-net)>0.005)reasons.push('NET_ODD_DISCOUNT_UNPROVEN');
  }
  if(reasons.length)return result;
  const netReplay=(p/100*net-1)*100;
  result.ok=true;result.status='NET_PRICE_BASIS_VERIFIED';
  result.netReplayEvPct=round(netReplay);return result;
}
module.exports=Object.freeze({VERSION,reconcile});
