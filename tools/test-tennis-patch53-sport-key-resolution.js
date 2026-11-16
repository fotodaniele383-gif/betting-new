#!/usr/bin/env node
'use strict';
const path = require('path');
function root() { const i=process.argv.indexOf('--root'); return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.'); }
const mod = require(path.join(root(),'backend','clvCrossSportCoveragePatch53.js'));
const details=[]; function check(name, ok, extra=null){details.push({name,ok:Boolean(ok),details:extra});if(!ok)throw new Error(name);}
try {
  const fixtures = [
    ['Premier','soccer_epl'],['Premier League','soccer_epl'],['Serie A','soccer_italy_serie_a'],
    ['Serie B','soccer_italy_serie_b'],['La Liga','soccer_spain_la_liga'],['Ligue 1','soccer_france_ligue_one'],['Bundesliga','soccer_germany_bundesliga']
  ];
  for (const [league,key] of fixtures) {
    const r=mod.resolveSportKeyForBet({sport_type:'CALCIO',league,strategy_tag:`${league}_1X2`},mod.DEFAULT_FOOTBALL_LEAGUES);
    check(`Calcio ${league} risolto`,r.resolved&&r.sportKey===key,r);
  }
  const strategy=mod.resolveSportKeyForBet({sport_type:'CALCIO',league:'',strategy_tag:'PREMIER_1X2_ANALYSIS_ONLY'},mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Fallback strategy Premier',strategy.sportKey==='soccer_epl'&&strategy.status==='RESOLVED_FOOTBALL_CONFIG',strategy);
  const unknown=mod.resolveSportKeyForBet({sport_type:'CALCIO',league:'Unknown League'},mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Lega sconosciuta non inventata',unknown.resolved===false&&unknown.status==='UNRESOLVED_FOOTBALL_LEAGUE',unknown);
  const tennis=mod.resolveSportKeyForBet({sport_type:'TENNIS',league:'[ATP] Masters 1000',tournament_name:'Canada Masters (Toronto/Montreal)'},mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Tennis Canada inferito',tennis.sportKey==='tennis_atp_canadian_open'&&tennis.status==='RESOLVED_TENNIS_INFERENCE',tennis);
  const generic=mod.resolveSportKeyForBet({sport_type:'TENNIS',league:'[ATP] Grand Slam'},mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Grand Slam generico richiede catalogo',generic.resolved===false&&generic.status==='TENNIS_ACTIVE_CATALOG_REQUIRED',generic);
  const explicit=mod.resolveSportKeyForBet({sport_type:'TENNIS',clv_sport_key_resolved:'tennis_atp_canadian_open'},mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Chiave Tennis provider preservata',explicit.sportKey==='tennis_atp_canadian_open'&&explicit.source==='EXPLICIT_FIELD',explicit);
  check('Autorità solo routing',fixtures.every(([league])=>mod.resolveSportKeyForBet({sport_type:'CALCIO',league},mod.DEFAULT_FOOTBALL_LEAGUES).probabilityAuthority===false));
  check('Versioni Patch53',mod.VERSION==='CLV_CROSS_SPORT_COVERAGE_V1_PATCH53'&&mod.SPORT_KEY_RESOLUTION_VERSION==='CLV_CROSS_SPORT_SPORT_KEY_RESOLUTION_V1_PATCH53');
  console.log(JSON.stringify({success:true,checks:details.length,details},null,2));
} catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message,details},null,2));process.exit(1);}
