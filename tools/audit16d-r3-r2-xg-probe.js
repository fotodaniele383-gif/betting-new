#!/usr/bin/env node
'use strict';
const path=require('path');
const i=process.argv.indexOf('--root'); const ROOT=i>=0?path.resolve(process.argv[i+1]):path.resolve(__dirname,'..');
const provider=require(path.join(ROOT,'backend','calcioSportmonksXgProviderAudit16dR3R2'));
const token=String(process.env.SPORTMONKS_API_TOKEN||'').trim();
const leagues=['Serie A','Serie B','Premier League','La Liga','Ligue 1','Bundesliga'];
(async()=>{
  if(!token){ console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R2',reason:'SPORTMONKS_API_TOKEN_NOT_CONFIGURED',tokenExposed:false,instruction:'Impostare SPORTMONKS_API_TOKEN nella sessione CMD e rilanciare il probe.'},null,2)); process.exit(2); }
  const results=[];
  for(const league of leagues){
    const r=await provider.getSportmonksLeagueXg(league,{token,writeCache:true});
    results.push({league,status:r.state?.status||'UNKNOWN',sourceClass:r.state?.sourceClass||'NONE',season:r.state?.seasonName||r.state?.seasonId||null,teamCount:Object.keys(r.teams||{}).length,fixtureCount:r.state?.fixtureCount||null,fixturesAccepted:r.state?.fixturesAccepted||null,error:r.state?.error||null,tokenExposed:false});
  }
  const live=results.filter(x=>x.status==='READY_LIVE').length;
  const usable=results.filter(x=>x.sourceClass==='LIVE_CERTIFIED'||x.sourceClass==='LKG_CERTIFIED').length;
  const success=usable>0;
  console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R2',provider:'SPORTMONKS',liveLeagues:live,usableLeagues:usable,results,tokenExposed:false,directStakeAuthority:false,directGateAuthority:false},null,2));
  process.exit(success?0:1);
})().catch(e=>{ console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R2',error:String(e?.code||e?.message||e),tokenExposed:false},null,2)); process.exit(1); });
