'use strict';
const path = require('path');
const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : path.join(__dirname, '..'));
const model = require(path.join(ROOT, 'backend', 'calcioSerieBEstimatedXgAudit16dR3R3b'));
const details = [];
function check(name, ok, data=null){ details.push({name,ok:Boolean(ok),details:data}); }
function csvFixture(){
  const teams=['Cesena','Bari','Palermo','Modena','Sampdoria','Spezia','Catanzaro','Reggiana','Mantova','Juve Stabia'];
  const rows=['Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST'];
  for(let i=0;i<20;i++){
    const h=teams[i%teams.length], a=teams[(i+3)%teams.length];
    rows.push(`I2,${String(1+i).padStart(2,'0')}/09/26,${h},${a},1,1,${9+(i%6)},${7+((i+2)%5)},${3+(i%4)},${2+((i+1)%4)}`);
  }
  return rows.join('\n');
}
try {
  check('R1 revision exported', model.AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION === 'AUDIT16D_R3_R3B_R1_FOOTBALL_DATA_SEASON_CODE_NORMALIZATION_V1', model.AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION);
  check('Football-Data 2627 normalizes to 2026', model.normalizeSeasonStart('2627') === 2026, model.normalizeSeasonStart('2627'));
  check('Football-Data 2526 normalizes to 2025', model.normalizeSeasonStart('2526') === 2025, model.normalizeSeasonStart('2526'));
  check('Long season 2026/2027 normalizes to 2026', model.normalizeSeasonStart('2026/2027') === 2026, model.normalizeSeasonStart('2026/2027'));
  check('Long season 2026-2027 normalizes to 2026', model.normalizeSeasonStart('2026-2027') === 2026, model.normalizeSeasonStart('2026-2027'));
  check('Single year 2026 normalizes to 2026', model.normalizeSeasonStart('2026') === 2026, model.normalizeSeasonStart('2026'));
  check('Malformed compact season fails closed', model.normalizeSeasonStart('2628') === null, model.normalizeSeasonStart('2628'));
  check('Malformed long season fails closed', model.normalizeSeasonStart('2026/2028') === null, model.normalizeSeasonStart('2026/2028'));
  const built = model.buildFromFootballDataCsv(csvFixture(), {leagueName:'Serie B',season:'2627',now:new Date('2026-09-28T12:00:00Z')});
  check('Live Football-Data season code produces MODEL_READY', built.state.status === 'MODEL_READY', built.state);
  check('MODEL_READY state reports seasonStart 2026', built.state.seasonStart === 2026, built.state);
  check('Season normalization revision is recorded', built.state.seasonNormalizationRevision === model.AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION, built.state.seasonNormalizationRevision);
  check('Estimated/real boundary unchanged', built.state.sourceClass==='MODEL_ESTIMATED' && built.state.evidenceClass==='MODEL_ESTIMATED_XG' && built.state.realXg===false, built.state);
  check('Direct stake/gate authority remains false', built.state.directStakeAuthority===false && built.state.directGateAuthority===false, built.state);
  const success=details.every(x=>x.ok);
  console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R3B_R1',suite:'SERIE_B_SEASON_NORMALIZATION',checks:details.length,failures:details.filter(x=>!x.ok),details},null,2));
  process.exit(success?0:1);
} catch(e) {
  console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R1',suite:'SERIE_B_SEASON_NORMALIZATION',error:e.stack||e.message,details},null,2));
  process.exit(1);
}
