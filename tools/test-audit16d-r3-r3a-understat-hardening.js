#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] || '.' : path.join(__dirname, '..'));
const m = require(path.join(ROOT, 'backend', 'calcioUnderstatProviderV2'));
const checks=[]; const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
function datesPayload(){
  const teams = Array.from({length:10},(_,i)=>({id:String(i+1),title:`Team ${i+1}`,short_title:`T${i+1}`}));
  const dates=[];
  for(let i=0;i<10;i++){
    const a=teams[i], b=teams[(i+1)%10];
    dates.push({id:String(100+i),isResult:true,h:a,a:b,xG:{h:String(0.9+i*0.07),a:String(0.7+i*0.05)}});
  }
  return {teams:{},dates,players:[]};
}
function htmlPayload(){
  const teams={};
  for(let i=1;i<=10;i++) teams[String(i)]={title:`Club ${i}`,history:[{xG:1+i/20,xGA:0.8+i/30}]};
  const json=JSON.stringify(teams).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return `<!doctype html><html><head><title>Understat 2026/2027</title></head><body>understat<script>var teamsData = JSON.parse('${json}');</script></body></html>` + ' '.repeat(800);
}
(async()=>{try{
  add('R3_R3A version exported',m.AUDIT16D_R3_R3A_UNDERSTAT_VERSION==='AUDIT16D_R3_R3A_UNDERSTAT_API_DATE_BROWSER_RESILIENCE_V1',m.AUDIT16D_R3_R3A_UNDERSTAT_VERSION);
  add('R3_R3A_R2 provenance lock exported',m.AUDIT16D_R3_R3A_R2_PROVENANCE_VERSION==='AUDIT16D_R3_R3A_R2_UNDERSTAT_PROVENANCE_LOCK_V1',m.AUDIT16D_R3_R3A_R2_PROVENANCE_VERSION);
  add('Five real-xG leagues only',JSON.stringify(Object.keys(m.understatLeagueMap).sort())===JSON.stringify(['Bundesliga','La Liga','Ligue 1','Premier','Serie A'].sort()),m.understatLeagueMap);
  add('Serie B is not falsely mapped to Understat',!Object.prototype.hasOwnProperty.call(m.understatLeagueMap,'Serie B'));
  const parsed=m.parseUnderstatLeagueJson(datesPayload(),{seasonStart:2026,source:'TEST'});
  add('Current getLeagueData dates schema can produce certified teams',Object.keys(parsed.teams).length>=8,{teams:Object.keys(parsed.teams).length,parser:parsed.metadata.parser});
  add('Dates parser is explicit',parsed.metadata.parser==='AJAX_GET_LEAGUE_DATA_JSON_DATES_AGGREGATE',parsed.metadata);
  add('Dates xG remains real Understat evidence',Object.values(parsed.teams).every(x=>x.source==='UNDERSTAT_DATES_XG_AGGREGATE'),Object.values(parsed.teams).slice(0,2));
  add('Dates provenance survives sanitizer boundary',Object.values(parsed.teams).every(x=>x.providerId==='UNDERSTAT'&&x.evidenceClass==='REAL_XG'),Object.values(parsed.teams).slice(0,2));
  add('Dates metadata certifies real xG provenance',parsed.metadata.evidenceSource==='UNDERSTAT_DATES_XG_AGGREGATE'&&parsed.metadata.evidenceClass==='REAL_XG'&&parsed.metadata.provenanceRevision==='AUDIT16D_R3_R3A_R2_UNDERSTAT_PROVENANCE_LOCK_V1',parsed.metadata);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r3-r3a-'));
  const priorBrowserEnv=process.env.CALCIO_UNDERSTAT_BROWSER_FALLBACK;
  try {
    // Contract test must not depend on a user's runtime toggle. This tests the
    // fallback implementation itself with a fully injected, network-free browser source.
    process.env.CALCIO_UNDERSTAT_BROWSER_FALLBACK='1';
    const err=Object.assign(new Error('forced json failure'),{code:'UNDERSTAT_AJAX_JSON_INVALID',structural:true});
    const teams=await m.getUnderstatxG('Serie A',{
      force:true, seasonCandidates:[2026], cacheDir:tmp,
      fetchJson:async()=>{throw err;}, disableSessionRecovery:true,
      fetchHtml:async()=>{throw Object.assign(new Error('forced html failure'),{code:'UNDERSTAT_PAGE_SCHEMA_NOT_RECOGNIZED',structural:true});},
      fetchBrowserHtml:async()=>({html:htmlPayload(),finalUrl:'https://understat.com/league/Serie_A/2026',statusCode:200})
    });
    const st=m.getUnderstatState('Serie A');
    add('Slow public browser fallback is reachable after API/HTML failure',Object.keys(teams).length>=8&&st.status==='READY_BROWSER_SCRAPE',st);
    add('Browser fallback source remains explicit',st.source==='BROWSER_PUBLIC_HTML_FALLBACK',st);
    add('No proxy masquerading as real Understat',!Object.values(teams).some(x=>String(x.source||'').includes('PROXY')));
    add('Browser teams keep explicit Understat real-xG provenance',Object.values(teams).every(x=>x.source==='UNDERSTAT_TEAMS_DATA'&&x.providerId==='UNDERSTAT'&&x.evidenceClass==='REAL_XG'),Object.values(teams).slice(0,2));
  } finally {
    if(priorBrowserEnv===undefined) delete process.env.CALCIO_UNDERSTAT_BROWSER_FALLBACK;
    else process.env.CALCIO_UNDERSTAT_BROWSER_FALLBACK=priorBrowserEnv;
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch(_){/* cleanup is non-contractual */}
  }
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
const failures=checks.filter(x=>!x.ok);
console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3_R3A',suite:'UNDERSTAT_API_DATE_BROWSER_HARDENING',checks:checks.length,failures,details:checks},null,2));
process.exit(failures.length?1:0);
})();
