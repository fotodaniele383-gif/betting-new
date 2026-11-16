'use strict';const c=require('./common');const e=require('./calcioEventAudit'),s=require('./calcioSourceAudit'),p=require('./calcioProbabilityAudit');
function evaluate(input={}){
 const parts=[e.assess(input),s.assess(input),p.assess(input)];const r=c.result(parts);
 const checks={event:parts[0].verified,source:parts[1].verified,probability:parts[2].verified};
 return {...r,sport:'CALCIO',mode:'OBSERVATION_AND_EXPLICIT_CONFLICT_VETO',checks,coverage:c.grade(checks),brs:'NOT_CERTIFIED',action:r.hardReasons.length?'NO_BET_EXPLICIT_CONFLICT':'DEFER_TO_EXISTING_AUTHORITY',stakeAuthority:false};
}
module.exports={evaluate};
