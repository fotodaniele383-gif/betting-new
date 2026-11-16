 'use strict';
const path=require('node:path'),crypto=require('node:crypto'),fs=require('node:fs');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function check(root){
 const dbPath=path.join(root,'backend/database_betting.db'),dbBefore=sha(dbPath),editor=require(path.join(root,'addons/calcio-editor/core.js'));
 const records=editor.getJournal(root),matches=editor.readMatches(root),map=new Map(matches.map(x=>[x.id,x])),groups=new Map();
 for(const row of records){if(!groups.has(row.eventId))groups.set(row.eventId,[]);groups.get(row.eventId).push(row);}
 let failures=[],checked=0,quoteRows=0,changedMarketPairs=0,unknownMatch=0,lowQuality=0,workerEvidenceWithoutCertification=0;
 const samples=[];
 for(const [id,rows] of groups){const match=map.get(id);if(!match){unknownMatch++;continue;}
  let prev=null;for(const rev of rows){checked++;
   const estimate=editor.estimate(match,rev),comparison=editor.compare(match,prev,rev);
   if(estimate.matchId!==id||estimate.revision!==rev.revision)failures.push('MATCH_REVISION_MISMATCH:'+id);
   if(estimate.verdict!=='NO BET'||estimate.calibrated!==false)failures.push('UNCERTIFIED_MODEL_PROMOTED:'+id);
   if(comparison.newBRS!==estimate.brs.total)failures.push('BRS_COMPARISON_MISMATCH:'+id);
   if(prev && comparison.oldBRS!==editor.estimate(match,prev).brs.total)failures.push('BRS_DELTA_MISMATCH:'+id);
   for(const q of estimate.quotes){quoteRows++;if(!q.calibrated && q.evPct!==null && !Number.isFinite(q.evPct))failures.push('EV_NAN:'+id);}
   for(const q of comparison.markets)if(q.oldEvPct!==null && q.newEvPct!==null && Math.abs((q.newEvPct-q.oldEvPct)-q.deltaEvPct)>1e-8)failures.push('EV_DELTA_MISMATCH:'+id);
   if(comparison.markets.some(q=>q.deltaEvPct!==null&&Math.abs(q.deltaEvPct)>.00001))changedMarketPairs++;
   if(estimate.brs.total<60)lowQuality++;
   if(Object.keys(rev.evidence||{}).length)workerEvidenceWithoutCertification++;
   prev=rev;
  }
  samples.push({match:match.home+' - '+match.away,eventId:id,revisions:rows.length,lastBRS:editor.estimate(match,rows.at(-1)).brs.total,lastVerdict:'NO BET',modelCertification:'NO_OOS_CALIBRATION'});
 }
 const dbAfter=sha(dbPath);if(dbBefore!==dbAfter)failures.push('DB_CHANGED');
 return {version:'BETTINGAPP_R9_EDITOR_AUDIT_V1',dbSha256Unchanged:dbBefore===dbAfter,readOnly:true,matchesAvailable:matches.length,revisionRows:records.length,
  matchesWithRevisions:groups.size,verifiedRevisions:checked,quoteRowsEvaluated:quoteRows,changedEvMarkets:changedMarketPairs,
  omittedOlderMatches:unknownMatch,lowBRSRevisions:lowQuality,manualEvidenceRevisions:workerEvidenceWithoutCertification,
  scoreModel:'INDEPENDENT_POISSON_DIAGNOSTIC_NOT_PRODUCTION_CALIBRATION',
  deepScan:'LEGACY_WORKER_SEPARATE_NOT_PROVEN_BY_THIS_READ_ONLY_RECHECK',
  liveEndToEndStatus:records.length===0?'NOT_TESTED_NO_USER_REVISIONS':'REAL_REVISIONS_RECALCULATED_READONLY',
  failures,samples:samples.slice(-12),status:failures.length?'FAIL':'PASS_READONLY_NON_MONETARY'};
}
if(require.main===module){try{const out=check(path.resolve(process.argv[2]||process.cwd()));console.log(JSON.stringify(out,null,2));if(out.failures.length)process.exitCode=1;}
 catch(e){console.error('R9_EDITOR_AUDIT_FAIL='+String(e.message||e));process.exitCode=1;}}
module.exports={check};
