'use strict';const c=require('./common');
function assess(input={}){
 const hardReasons=[],warnings=[];const playerA=c.first(input,['player1','playerA','homePlayer']),playerB=c.first(input,['player2','playerB','awayPlayer']);
 if(playerA&&playerB&&String(playerA).trim().toLowerCase()===String(playerB).trim().toLowerCase())hardReasons.push('TENNIS_DUPLICATE_PLAYER');
 const bestOf=c.number(c.first(input,['bestOf','best_of']));if(bestOf!==null&&![3,5].includes(bestOf))hardReasons.push('TENNIS_INVALID_BEST_OF');
 const surface=String(c.first(input,['surface'])||'').toUpperCase();if(surface&&!/^(HARD|CLAY|GRASS|CARPET|INDOOR HARD|OUTDOOR HARD)$/.test(surface))warnings.push('TENNIS_SURFACE_UNMAPPED');
 const temporal=c.periodCheck(c.first(input,['analysisCapturedAt','captureAt','analysisAt']),c.first(input,['kickoffUtc','matchStartUtc','match_start_at','canonical_match_datetime']),input.prematch===true||input.phase==='PREMATCH');
 hardReasons.push(...temporal.reasons);warnings.push(...temporal.warnings);
 return {id:'T1_EVENT_SURFACE_TEMPORAL',hardReasons,warnings,temporal,bestOf,surface,verified:!!playerA&&!!playerB&&!!surface&&[3,5].includes(bestOf)&&temporal.capture==='VALID'&&temporal.kickoff==='VALID'};
}
module.exports={assess};
