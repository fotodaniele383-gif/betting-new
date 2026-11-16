'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];const receipt=input.oddsEvidence||input.sourceReceipt||{};
 const book=c.first(receipt,['bookmaker','provider']);const ts=c.first(receipt,['observedAt','capturedAt','timestamp']);const t=c.instant(ts);
 const analysis=c.instant(c.first(input,['analysisCapturedAt','captureAt','analysisAt']));if(t.status==='VALID'&&analysis.status==='VALID'&&t.ms>analysis.ms)hardReasons.push('TENNIS_SOURCE_FROM_FUTURE');
 if(!book||t.status!=='VALID')warnings.push('TENNIS_ODDS_PROVENANCE_INCOMPLETE');
 const freshness=String(c.first(input,['playerEvidenceFreshness','freshness'])||'').toUpperCase();if(['STALE','AGING','UNKNOWN'].includes(freshness))warnings.push('TENNIS_EVIDENCE_NOT_CURRENT');
 return {id:'T2_SOURCE_LINEAGE',hardReasons,warnings,verified:!!book&&t.status==='VALID',freshness:freshness||'NOT_PROVIDED'};
}
module.exports={assess};
