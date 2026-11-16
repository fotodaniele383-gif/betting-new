'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];const raw=c.first(input,['modelProbability','probability','estimatedProbability','winProbability']);
 const p=c.pct(raw),q=c.odd(c.first(input,['odd','quota','price']));
 if(raw!==null&&p===null)hardReasons.push('TENNIS_PROBABILITY_OUT_OF_RANGE');
 const rawQ=c.first(input,['odd','quota','price']);if(rawQ!==null&&q===null)hardReasons.push('TENNIS_INVALID_ODD');
 const calibration=String(c.first(input,['calibrationStatus','calibration_status'])||'').toUpperCase();if(['FAILED','UNVALIDATED'].includes(calibration))warnings.push('TENNIS_MODEL_NOT_CALIBRATED');
 return {id:'T3_PROBABILITY_CALIBRATION',hardReasons,warnings,verified:p!==null&&q!==null&&calibration==='VALIDATED',modelProbabilityPct:p,marketImpliedPct:q?100/q:null,rawEvPct:q&&p!==null?100*(p/100*q-1):null};
}
module.exports={assess};
