#!/usr/bin/env node
'use strict';
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const m=require(path.join(ROOT,'backend','calcioUnderstatProviderV2'));
const leagues=['Serie A','Premier','La Liga','Ligue 1','Bundesliga'];
(async()=>{
 const results=[];
 for(const league of leagues){
   const started=Date.now(); let teams={}; let thrown=null;
   try{teams=await m.getUnderstatxG(league,{force:true,timeoutMs:15000,browserTimeoutMs:35000});}
   catch(e){thrown=e.code||e.message;}
   const state=m.getUnderstatState(league)||{};
   results.push({league,status:state.status||'UNKNOWN',source:state.source||null,parser:state.parser||null,season:state.season||null,teams:Object.keys(teams||{}).length,error:thrown||state.error||null,circuitOpenUntil:state.circuitOpenUntil||null,durationMs:Date.now()-started});
 }
 const certified=results.filter(x=>x.teams>=8 && /^READY/.test(x.status));
 console.log(JSON.stringify({success:true,patch:'AUDIT16D_R3_R3A',provider:'UNDERSTAT',certifiedLeagues:certified.length,totalLeagues:results.length,fullyCertified:certified.length===results.length,results},null,2));
})().catch(e=>{console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3A',error:e.code||e.message},null,2));process.exit(1);});
