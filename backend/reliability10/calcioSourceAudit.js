'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];
 const receipt=input.oddsCertification?.selectedSource||input.odds_certification?.selectedSource||input.sourceReceipt||{};
 const bookmaker=c.first(receipt,['bookmaker','sourceName','provider','operator']);
 const timestamp=c.first(receipt,['observedAt','capturedAt','timestamp']);
 const analysisAt=c.first(input,['analysisCapturedAt','captureAt','analysisAt']);
 const t=c.instant(timestamp),a=c.instant(analysisAt);
 if(t.status==='VALID'&&a.status==='VALID'&&t.ms>a.ms)hardReasons.push('SOURCE_FROM_FUTURE');
 if(t.status==='TZ_UNKNOWN')warnings.push('SOURCE_TIMESTAMP_TZ_UNKNOWN');
 if(!bookmaker)warnings.push('BOOKMAKER_NOT_DOCUMENTED');
 if(!timestamp)warnings.push('ODDS_TIMESTAMP_NOT_DOCUMENTED');
 const className=String(c.first(input,['xgSourceClass','xg_source_class','dataSourceClass'])||'').toUpperCase();
 if(/PROXY|SIMULATED|ESTIMATED/.test(className))warnings.push('XG_PROXY_NOT_OBSERVED');
 const groups=[String(bookmaker||'').toLowerCase(),String(c.first(receipt,['origin','upstreamProvider'])||'').toLowerCase()].filter(Boolean);
 return {id:'C2_SOURCE_LINEAGE',hardReasons,warnings,independence:'NOT_CERTIFIED',verified:!!bookmaker&&t.status==='VALID',groups};
}
module.exports={assess};
