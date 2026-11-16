#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const provider=require(path.join(ROOT,'backend','calcioUnderstatProviderV2'));
const leagues=['Serie A','Premier','La Liga','Ligue 1','Bundesliga'];
const requestTimeoutMs=Math.max(1500,Math.min(10000,Number(process.env.AUDIT16D_R3_UNDERSTAT_PROBE_REQUEST_TIMEOUT_MS||3500)));
const tempCache=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r3-understat-probe-'));
async function one(league){const started=Date.now();try{
  const teams=await provider.getUnderstatxG(league,{force:true,cacheDir:tempCache,timeoutMs:requestTimeoutMs});
  const state=provider.getUnderstatState(league);
  return {league,success:teams&&typeof teams==='object'&&Object.keys(teams).length>=8,status:state.status||'UNKNOWN',source:state.source||null,teams:teams&&typeof teams==='object'?Object.keys(teams).length:0,durationMs:Date.now()-started,recoveryVersion:provider.AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION};
}catch(e){return{league,success:false,status:e.code||'ERROR',error:e.message,durationMs:Date.now()-started,recoveryVersion:provider.AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION};}}
(async()=>{try{const results=[];for(let i=0;i<leagues.length;i+=3){results.push(...await Promise.all(leagues.slice(i,i+3).map(one)));}const resolved=results.filter(x=>x.success).length;console.log(JSON.stringify({success:true,readOnlyProject:true,patch:'AUDIT16D_R3',probe:'UNDERSTAT_LIVE_RESILIENCE',requestTimeoutMs,resolved,total:results.length,results,note:'Usa cache temporanea e non modifica il DB/progetto. Un fallback senza xG reale resta fail-closed.'},null,2));process.exitCode=0;}finally{try{fs.rmSync(tempCache,{recursive:true,force:true})}catch(_){}}})();
