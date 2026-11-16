'use strict';
/** Independent cap provenance check. Never treats persisted last-cycle values as a fresh grant.
 * When a staged cap has been produced, reductions are authoritative. Raising a prior zero
 * requires separately certified current-gate proof (not produced by legacy Step96/101).
 */
const V='R25_TENNIS_CAP_PROVENANCE_V1';
function number(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function fromPendingSetParts(setParts=[],params=[],name='professional_gate_max_stake'){
 const index=setParts.findIndex(s=>String(s).trim().startsWith(name+' ='));
 return index<0?{present:false,value:null}:{present:true,value:number(params[index])};
}
function resolve({persistedCap,stagedCap,stagedPresent=false,certifiedCurrentCap=null,currentProof=null}={}){
 const old=number(persistedCap),staged=number(stagedCap),proof= currentProof && currentProof.evidenceValid===true &&
   typeof currentProof.evaluationId==='string' && currentProof.evaluationId.length>0 &&
   currentProof.evaluationId===currentProof.expectedEvaluationId && currentProof.riskEligible===true;
 const certified=number(certifiedCurrentCap);
 if(stagedPresent && staged===null)return {cap:0,status:'STAGED_CAP_INVALID',firstZero:'STAGED_CAP_INVALID',version:V};
 if(stagedPresent && staged===0)return {cap:0,status:'CURRENT_STAGE_VETO',firstZero:'CURRENT_STAGE_VETO',version:V};
 if(old===0){
   if(proof && certified!==null && certified>0 && stagedPresent && staged>0)
     return {cap:Math.min(staged,certified),status:'CURRENT_INDEPENDENT_PROOF',firstZero:null,version:V};
   return {cap:0,status:'PERSISTED_ZERO_NEEDS_CURRENT_INDEPENDENT_PROOF',firstZero:'PROFESSIONAL_CAP_PREVIOUS_ZERO',version:V};
 }
 if(old===null)return {cap:0,status:'PERSISTED_CAP_MISSING',firstZero:'PROFESSIONAL_CAP_MISSING',version:V};
 if(stagedPresent && staged>0)return {cap:Math.min(old,staged),status:'MIN_PREVIOUS_AND_CURRENT_STAGE',firstZero:null,version:V};
 return {cap:old,status:'PERSISTED_CAP_ONLY_NO_INCREMENT',firstZero:null,version:V};
}
module.exports={V,number,fromPendingSetParts,resolve};
