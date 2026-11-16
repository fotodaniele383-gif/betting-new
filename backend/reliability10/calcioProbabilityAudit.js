'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];
 const raw=c.first(input,['probability','estimated_prob','estimatedProb']);
 const p=c.pct(raw),q=c.odd(c.first(input,['odd','quota','price']));
 if(raw!==null&&p===null)hardReasons.push('PROBABILITY_OUT_OF_RANGE');
 const rawOdd=c.first(input,['odd','quota','price']);if(rawOdd!==null&&q===null)hardReasons.push('INVALID_DECIMAL_ODD');
 const implied=q?100/q:null;const ev=(p!==null&&q!==null)?(p/100*q-1)*100:null;
 const reference=c.pct(c.first(input,['marketProbabilityPct','market_probability_pct']));
 if(reference!==null&&p!==null&&Math.abs(reference-p)>20)warnings.push('MODEL_MARKET_DISAGREEMENT_GT_20PP');
 const supplied=c.number(c.first(input,['raw_ev_pct','rawEvPct']));
 if(supplied!==null&&ev!==null&&Math.abs(supplied-ev)>0.1)warnings.push('RAW_EV_REQUIRES_RECONCILIATION');
 return {id:'C3_PROBABILITY_CONTRACT',hardReasons,warnings,verified:p!==null&&q!==null,probabilityPct:p,odd:q,impliedPct:implied,unadjustedEvPct:ev};
}
module.exports={assess};
