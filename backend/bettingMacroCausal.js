
'use strict';
const VERSION='BETTING_PATCH_16_STAKE_CAUSAL_GATE_V3';
const DS=Object.freeze({MODEL_RISK:'RISCHIO MODELLO',TECH_EDGE:'EDGE TECNICO',VALUE:'VALUE CONFERMATO / MICRO',HIGH_RISK:'ALTO RISCHIO',WATCHLIST:'WATCHLIST LOW EDGE'});
const Q=Object.freeze({WATCHLIST:'WATCHLIST MICRO',SOFT:'BLOCCATA SOFT',HARD:'BLOCCATA HARD',CAP:'APPROVATA CON CAP',APPROVED:'APPROVATA'});
function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f;}
function up(...v){return v.flat().map(x=>String(x??'')).join(' ').toUpperCase();}
function deepScanMacro(input={}){
 const text=up(input.action,input.ds_action,input.summary,input.riskLevel,input.professionalStatus);
 const edge=n(input.edge_pp??input.edge,0), score=n(input.reliabilityScore,0), theoretical=n(input.theoreticalStake,0);
 const risk=n(input.professionalRisk,0), disagreement=n(input.disagreementPp,0);
 if(text.includes('ALTO RISCHIO')||text.includes('VALUE TRAP')||text.includes('BLOCKED_HARD')||risk>=65) return DS.HIGH_RISK;
 if(text.includes('RISCHIO MODELLO')||text.includes('MODEL_RISK')||disagreement>=18||risk>=52) return DS.MODEL_RISK;
 if(theoretical>0 && edge>=3 && score>=62) return DS.VALUE;
 if(edge>=3 && score>=48) return DS.TECH_EDGE;
 if(edge>0) return DS.WATCHLIST;
 return DS.MODEL_RISK;
}
function qualityMacro(input={}){
 const text=up(input.gateStatus,input.qualityCode,input.qualityLabel,input.professionalStatus);
 const theoretical=n(input.theoreticalStake,0), operational=n(input.operationalStake,0), maxStake=n(input.maxStake,0);
 if(text.includes('HARD')||text.includes('NO_BET_HARD')) return Q.HARD;
 if(operational>0 && (text.includes('WATCHLIST') || text.includes('EARLY') || text.includes('MICRO'))) return Q.WATCHLIST;
 if(operational>0){
   if(text.includes('FULL_STAKE')||text.includes('APPROVATA STAKE PIENO')) return Q.APPROVED;
   if(maxStake>0 && operational+1e-9<theoretical) return Q.CAP;
   return Q.APPROVED;
 }
 if(theoretical>0) return Q.WATCHLIST;
 if(text.includes('WATCHLIST') || text.includes('EARLY') || text.includes('MICRO')) return Q.WATCHLIST;
 return text.includes('HARD')?Q.HARD:Q.SOFT;
}
module.exports={VERSION,DS,Q,deepScanMacro,qualityMacro};
