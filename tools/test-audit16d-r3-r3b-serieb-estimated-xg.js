'use strict';
const path = require('path');
const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : path.join(__dirname, '..'));
const model = require(path.join(ROOT, 'backend', 'calcioSerieBEstimatedXgAudit16dR3R3b'));
const failover = require(path.join(ROOT, 'backend', 'calcioXgProviderFailoverAudit16dR3R2'));
const details = [];
function check(name, ok, data=null){ details.push({name,ok:Boolean(ok),details:data}); }
function csvFixture(){
  const teams = ['Cesena','Bari','Palermo','Modena','Sampdoria','Spezia','Catanzaro','Reggiana','Mantova','Juve Stabia'];
  const rows = ['Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST'];
  for(let i=0;i<20;i++){
    const h=teams[i%teams.length], a=teams[(i+3)%teams.length];
    const hs=9+(i%6), as=7+((i+2)%5), hst=3+(i%4), ast=2+((i+1)%4);
    rows.push(`I2,${String(1+i).padStart(2,'0')}/09/26,${h},${a},1,1,${hs},${as},${hst},${ast}`);
  }
  return rows.join('\n');
}
try {
  check('Version exported', model.AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION === 'AUDIT16D_R3_R3B_SERIE_B_MODEL_ESTIMATED_XG_V1', model.AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION);
  const one = model.estimateMatchXg({shots:10,shotsOnTarget:4});
  check('Transparent shot/SOT formula deterministic', one === 1.38, one);
  const built = model.buildFromFootballDataCsv(csvFixture(), {leagueName:'Serie B',season:'2026/2027',now:new Date('2026-09-28T12:00:00Z')});
  check('Serie B model becomes MODEL_READY', built.state.status === 'MODEL_READY', built.state);
  check('At least 8 valid teams', Object.keys(built.teams).length >= 8, Object.keys(built.teams));
  check('Model is explicitly estimated, never real xG', built.state.sourceClass === 'MODEL_ESTIMATED' && built.state.evidenceClass === 'MODEL_ESTIMATED_XG' && built.state.realXg === false, built.state);
  check('Every team keeps estimated provenance', Object.values(built.teams).every(x=>x.source==='FOOTBALL_DATA_CSV_SHOTS_SOT'&&x.providerId==='SERIE_B_ESTIMATED_XG'&&x.evidenceClass==='MODEL_ESTIMATED_XG'&&x.modelEstimated===true), Object.values(built.teams).slice(0,2));
  check('Shrinkage produces finite bounded estimates', Object.values(built.teams).every(x=>Number.isFinite(x.xG_for)&&Number.isFinite(x.xG_against)&&x.xG_for>=0.35&&x.xG_for<=3.2&&x.xG_against>=0.35&&x.xG_against<=3.2), Object.values(built.teams).slice(0,2));
  check('No direct stake/gate authority', built.state.directStakeAuthority===false&&built.state.directGateAuthority===false, built.state);
  const ev = failover.buildSeasonEvidence(built.state,new Date('2026-09-30T18:00:00Z'),()=>({status:'CURRENT_SEASON_XG',authorityWeight:0.75,sourceStart:2026,expectedStart:2026}));
  check('Estimated model cannot be promoted to certified current-season xG', ev.status==='MODEL_ESTIMATED_XG'&&ev.sourceClass==='MODEL_ESTIMATED', ev);
  check('Estimated model authority is capped at legacy proxy weight', ev.authorityWeight<=0.20, ev);
  const missing = model.buildFromFootballDataCsv('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nI2,01/09/26,A,B,1,0', {leagueName:'Serie B'});
  check('Missing shot columns fail closed', missing.state.status==='MODEL_UNAVAILABLE'&&missing.state.error==='CSV_SHOT_COLUMNS_MISSING', missing.state);
  const success = details.every(x=>x.ok);
  console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R3B',suite:'SERIE_B_MODEL_ESTIMATED_XG',checks:details.length,failures:details.filter(x=>!x.ok),details},null,2));
  process.exit(success?0:1);
} catch(e) {
  console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B',suite:'SERIE_B_MODEL_ESTIMATED_XG',error:e.stack||e.message,details},null,2));
  process.exit(1);
}
