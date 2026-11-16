#!/usr/bin/env node
'use strict';
const path = require('path');
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(__dirname, '..');
const failover = require(path.join(ROOT, 'backend', 'calcioXgProviderFailoverAudit16dR3R2'));
const details = [];
function check(name, ok, value=null){ details.push({name,ok:Boolean(ok),details:value}); }
function teams(prefix='T'){ const o={}; for(let i=1;i<=10;i++) o[`${prefix}${i}`]={xG_for:1+i/100,xG_against:0.9+i/100}; return o; }
(async()=>{
  try {
    let secondaryCalls = 0;
    const liveSecondary = { getSportmonksLeagueXg: async()=>{ secondaryCalls++; return {teams:teams('S'),state:{status:'READY_LIVE',sourceClass:'LIVE_CERTIFIED',seasonStart:2026,seasonId:99,seasonName:'2026/2027'}}; } };
    let selected = await failover.resolveLeague('serie_a',{name:'Serie A'},{teams:teams('U'),state:{status:'READY',source:'LIVE',season:2026}},liveSecondary);
    check('Understat live remains primary', selected.state.providerId === 'UNDERSTAT' && secondaryCalls === 0, selected.state);

    selected = await failover.resolveLeague('serie_a',{name:'Serie A'},{teams:{},state:{status:'UNAVAILABLE_FALLBACK_PROXY',source:'NONE'}},liveSecondary);
    check('Sportmonks live selected when primary unavailable', selected.state.providerId === 'SPORTMONKS' && selected.state.sourceClass === 'LIVE_CERTIFIED', selected.state);

    const secondaryLkg = { getSportmonksLeagueXg: async()=>({teams:teams('L'),state:{status:'CIRCUIT_OPEN_LKG',sourceClass:'LKG_CERTIFIED',seasonStart:2026,seasonId:99,seasonName:'2026/2027'}}) };
    selected = await failover.resolveLeague('serie_a',{name:'Serie A'},{teams:teams('O'),state:{status:'READY_LKG',source:'LKG',season:2025}},secondaryLkg);
    check('Freshest LKG selected after live paths fail', selected.state.providerId === 'SPORTMONKS' && selected.state.sourceClass === 'LKG_CERTIFIED', selected.state);

    const noSecondary = { getSportmonksLeagueXg: async()=>({teams:{},state:{status:'DISABLED_NO_TOKEN',sourceClass:'NONE'}}) };
    selected = await failover.resolveLeague('serie_a',{name:'Serie A'},{teams:{},state:{status:'UNAVAILABLE_FALLBACK_PROXY',source:'NONE'}},noSecondary);
    check('No certified provider falls back to declared proxy', selected.state.providerId === 'GOAL_SHOT_PROXY' && selected.state.sourceClass === 'PROXY', selected.state);
    check('Proxy never gains direct stake/gate authority', selected.state.directStakeAuthority === false && selected.state.directGateAuthority === false, selected.state);

    const currentEvidence = failover.buildSeasonEvidence({providerId:'SPORTMONKS',sourceClass:'LIVE_CERTIFIED',seasonStart:2026,selectionReason:'SECONDARY'},new Date('2026-09-28'),(start)=>({status:start===2026?'CURRENT_SEASON_XG':'STALE',authorityWeight:0.55,sourceStart:start,expectedStart:2026}));
    check('Live secondary can carry current-season xG evidence', currentEvidence.status === 'CURRENT_SEASON_XG' && currentEvidence.providerId === 'SPORTMONKS', currentEvidence);
    const lkgEvidence = failover.buildSeasonEvidence({providerId:'SPORTMONKS',sourceClass:'LKG_CERTIFIED',seasonStart:2026},new Date('2026-09-28'),()=>({status:'CURRENT_SEASON_XG',authorityWeight:0.55,sourceStart:2026,expectedStart:2026}));
    check('LKG authority weight remains capped', lkgEvidence.authorityWeight <= 0.25 && /LKG/.test(lkgEvidence.status), lkgEvidence);

    const success=details.every(x=>x.ok);
    console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R2',suite:'XG_PROVIDER_FAILOVER',checks:details.length,failures:details.filter(x=>!x.ok),details},null,2));
    process.exit(success?0:1);
  }catch(e){ console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R2',suite:'XG_PROVIDER_FAILOVER',error:e.stack||e.message},null,2)); process.exit(1); }
})();
