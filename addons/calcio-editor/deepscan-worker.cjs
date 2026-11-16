'use strict';
// Invokes the installed qualitative DeepScan, without importing server.js or touching SQLite.
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{raw+=x;if(raw.length>500000)process.exit(42)});
process.stdin.on('end',async()=>{try{
 const {root,match,revision}=JSON.parse(raw);
 if(!match||!revision||!Array.isArray(match.rows)||!revision.evidence)throw Error('INPUT_DEEPSCAN_INCOMPLETO');
 const f=require('node:path').join(root,'backend','deepScanCalcio.js');
 const {scanMatchup}=require(f);const rec=match.rows.find(r=>Number.isFinite(Number(r.prob))&&Number.isFinite(Number(r.odd))&&Number(r.odd)>1);
 if(!rec)throw Error('NESSUNA_PROBABILITA_PREESISTENTE_PER_DEEPSCAN');
 const prob0=Number(rec.prob),p=prob0>0&&prob0<=1?prob0*100:prob0;
 if(!(p>=0&&p<=100))throw Error('PROBABILITA_ORIGINALE_INVALIDA');
 const e=revision.evidence;
 const extData={league:match.league,matchDate:match.kickoff,kickoff:match.kickoff,providerTimeoutMs:1500,
  manualEvidence:e,manualRevision:revision.revision,manualDataUnverified:true,
  xgTotal:e.homeXg?.value&&e.awayXg?.value?Number(e.homeXg.value)+Number(e.awayXg.value):undefined,
  xgHome:e.homeXg?.value?Number(e.homeXg.value):undefined,xgAway:e.awayXg?.value?Number(e.awayXg.value):undefined,
  homeXg:e.homeXg?.value?Number(e.homeXg.value):undefined,awayXg:e.awayXg?.value?Number(e.awayXg.value):undefined,
  xgEvidenceMode:'PROXY_MANUAL_UNVERIFIED',lineupsConfirmed:false,
  lineupsManual:e.lineups?.value||null, medicalManual:{home:e.medicalHome?.value||null,away:e.medicalAway?.value||null}};
 const result=await scanMatchup(match.home,match.away,rec.prediction,Number(rec.odd),p,NaN,null,null,null,extData);
 const response={source:'LEGACY_DEEPSCAN_CONTEXT',evaluatedPrediction:rec.prediction,manualRevision:revision.revision,
  notAsianMarketCertification:true,success:result.success===true,action:result.action||'UNKNOWN',riskScore:result.riskScore??null,
  riskLevel:result.riskLevel||null,missingDataPrompt:typeof result.missingDataPrompt==='string'?result.missingDataPrompt.slice(0,6000):null,
  observedScoreCoveragePct:result.observedScoreCoveragePct??null,
  pillars:Array.isArray(result.pillars)?result.pillars.map(x=>({name:x.name||x.label,status:x.status,score:x.score})).slice(0,12):[],
  warning:'DeepScan qualitativo legacy sul pronostico originale: non certifica probabilita o EV delle quote asiatiche.'};
 process.stdout.write(JSON.stringify(response));
}catch(err){process.stdout.write(JSON.stringify({success:false,error:String(err.message||err).slice(0,300),source:'LEGACY_DEEPSCAN_UNAVAILABLE'}));process.exitCode=1;}});
