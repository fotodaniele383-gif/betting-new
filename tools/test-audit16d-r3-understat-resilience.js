#!/usr/bin/env node
'use strict';
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const m=require(path.join(ROOT,'backend','calcioUnderstatProviderV2'));
const checks=[];const add=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
function payload(){const teams={};for(let i=1;i<=8;i++)teams[String(i)]={title:`Team ${i}`,history:[{xG:1+i/20,xGA:0.8+i/30}]};return{teams,dates:[],players:[]};}
(async()=>{try{
  add('Recovery version',m.AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION==='AUDIT16D_R3_UNDERSTAT_SESSION_JSON_RESILIENCE_V1');
  const base=payload();
  add('Plain JSON parsed',m.parseUnderstatAjaxText(JSON.stringify(base)).teams['1'].title==='Team 1');
  add('BOM/prefix JSON parsed',m.parseUnderstatAjaxText('\uFEFF)]}\',\n'+JSON.stringify(base)).teams['2'].title==='Team 2');
  add('Double encoded JSON parsed',m.parseUnderstatAjaxText(JSON.stringify(JSON.stringify(base))).teams['3'].title==='Team 3');
  add('Cookie header normalized',m.cookieHeaderFromHeaders({'set-cookie':['sid=abc; Path=/; Secure','foo=bar; HttpOnly']})==='sid=abc; foo=bar');
  const recovered=await m.recoverUnderstatSeasonWithSession('Serie A','Serie_A',2026,{
    fetchSessionHtml:async()=>({html:'<html>understat teamsData</html>',finalUrl:'https://understat.com/league/Serie_A/2026',headers:{'set-cookie':['sid=abc; Path=/']}}),
    fetchJsonWithCookie:async(_url,ctx)=>{if(ctx.cookie!=='sid=abc')throw new Error('COOKIE_MISSING');return payload();}
  });
  add('Session-cookie AJAX recovery yields teams',Object.keys(recovered.teams).length===8&&recovered.metadata.source==='SESSION_AJAX_JSON',recovered.metadata);
  add('Recovery remains declared source, not proxy',recovered.metadata.source!=='GOAL_SHOT_PROXY');
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'UNDERSTAT_RESILIENCE',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);})();
