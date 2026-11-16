'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];
 const home=c.first(input,['home','home_team']),away=c.first(input,['away','away_team']);
 if(home&&away&&String(home).trim().toLowerCase()===String(away).trim().toLowerCase())hardReasons.push('CALCIO_SAME_TEAM_BOTH_SIDES');
 const sport=c.first(input,['sport']);if(sport&&!['CALCIO','FOOTBALL','SOCCER'].includes(String(sport).toUpperCase()))hardReasons.push('CALCIO_WRONG_SPORT');
 const started=c.first(input,['kickoffUtc','matchStartUtc','match_start_at','canonical_match_datetime']);
 const captured=c.first(input,['analysisCapturedAt','captureAt','analysisAt']);
 const temporal=c.periodCheck(captured,started,input.prematch===true||input.phase==='PREMATCH');hardReasons.push(...temporal.reasons);warnings.push(...temporal.warnings);
 return {id:'C1_EVENT_TEMPORAL',hardReasons,warnings,temporal,verified:!!home&&!!away&&temporal.capture==='VALID'&&temporal.kickoff==='VALID'};
}
module.exports={assess};
