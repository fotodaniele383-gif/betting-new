'use strict';
const VERSION='TENNIS_FORWARD_HEALTH_SEMANTICS_V1_PATCH38';
function upper(v){return String(v==null?'':v).trim().toUpperCase();}
function parseReasons(v){if(Array.isArray(v))return v.map(upper);try{return JSON.parse(v||'[]').map(upper);}catch(_){return [];}}
function classifyCohortInspection(inspection={}){
  const member=inspection.member||{};const reasons=parseReasons(member.exclusion_reasons);
  const expected=inspection.success===true&&inspection.sealValid===true&&inspection.stateHashValid===true&&inspection.expectedMatches===true&&upper(member.maturity_status)==='TEMPORAL_LEAKAGE_BLOCKED'&&upper(member.leakage_status)==='BLOCKED'&&reasons.length>0&&reasons.every(r=>r==='SNAPSHOT_NOT_BEFORE_MATCH_START');
  return {version:VERSION,expectedTemporalExclusion:expected,activeStructuralFault:!expected&&inspection.success===false,classification:expected?'EXPECTED_TEMPORAL_EXCLUSION':inspection.success===false?'ACTIVE_STRUCTURAL_FAULT':'CLEAR',reasons};
}
function classifyPrematchRejection(error={}){const code=upper(error.code);const expected=['PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED','PATCH33_CANONICAL_EVENT_TIME_BLOCKED','PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED','PATCH34_SCHEDULE_CAPTURE_RACE_DETECTED'].includes(code);return {version:VERSION,expectedPolicyRejection:expected,severity:expected?'WARN':'ERROR',event:expected?'PREMATCH_CAPTURE_REJECTED':'SNAPSHOT_FAILED'};}
module.exports={VERSION,parseReasons,classifyCohortInspection,classifyPrematchRejection};
