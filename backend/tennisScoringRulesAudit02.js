'use strict';
const {resolveTennisMatchFormat}=require('./tennisMatchFormat');
const VERSION='TENNIS_SCORING_RULES_AUDIT02';
function resolveScoringRules(input={}) {
 const m=input.match||{};
 const title=[input.sportTitle,input.sport_title,input.title,input.league,input.tournament_name,input.tournament,m.sport_title,m.league,m.tournament_name,m.title].filter(Boolean).join(' ');
 const tourType=input.tourType||input.tour_type||input.tour||m.tour_type||m.tour;
 const base=resolveTennisMatchFormat({...input,match:m,sportTitle:title,tourType,tournament:title});
 const raw=[title,input.round,m.round,input.series,input.sportKey].filter(Boolean).join(' ');
 let reason=null;
 if(base.isDoubles||input.isDoubles===true||m.is_doubles===true)reason='DOUBLES_NOT_SUPPORTED';
 if(/NEXT\s*GEN|FAST\s*4|SHORT\s*SET|MATCH.?TIE.?BREAK|EXHIBITION|UTS|OLYMPIC/i.test(raw))reason='SPECIAL_FORMAT_NOT_SUPPORTED';
 if(input.matchTieBreak===true||m.match_tie_break===true||input.decidingSetMode==='MATCH_TIE_BREAK')reason='MATCH_TIE_BREAK_NOT_SUPPORTED';
 if(base.tourType==='UNKNOWN')reason=reason||'UNKNOWN_TOUR_FORMAT';
 if(/\bITF\b/i.test(raw))reason=reason||'ITF_FORMAT_REQUIRES_EXPLICIT_REVIEW';
 const year=String(input.matchDate||input.match_date||input.commence_time||m.commence_time||m.match_date||'').slice(0,4);
 if(base.isGrandSlam&&/^\d{4}$/.test(year)&&Number(year)<2023)reason=reason||'HISTORICAL_SLAM_FORMAT_REQUIRES_REVIEW';
 return Object.freeze({version:VERSION,bestOf:base.bestOf,tourType:base.tourType,isGrandSlam:base.isGrandSlam,isQualifying:base.isQualifying,supported:!reason,reason:reason||'STANDARD_SINGLES_RULES',tieBreakTarget:7,finalSetTieBreakTarget:base.isGrandSlam?10:7,tieBreakAtGames:6,decidingSetMode:'FULL_SET',source:base.isGrandSlam?'ITF_GRAND_SLAM_RULEBOOK_2026':'STANDARD_TOUR_SINGLES'});
}
function modelRules(input={}) {
 let rules=input.scoringRules;
 if(!rules && [input.sportTitle,input.sport_title,input.tournament,input.league,input.tourType,input.tour_type,input.tour].some(Boolean))rules=resolveScoringRules(input);
 if(rules) {
  if(rules.supported!==true||rules.decidingSetMode!=='FULL_SET'||rules.tieBreakAtGames!==6)throw new Error('AUDIT02_UNSUPPORTED_FORMAT: '+rules.reason);
  if(![3,5].includes(rules.bestOf))throw new Error('AUDIT02_INVALID_BEST_OF');
  if(input.bestOf!=null&&Number(input.bestOf)!==rules.bestOf)throw new Error('AUDIT02_CONFLICTING_BEST_OF');
 }
 if(![3,5].includes(Number(rules?.bestOf??input.bestOf??3)))throw new Error('AUDIT02_INVALID_BEST_OF');
 const regular=rules?.tieBreakTarget??input.tieBreakTarget??7;
 const final=rules?.finalSetTieBreakTarget??input.finalSetTieBreakTarget??7;
 if(regular!==7||![7,10].includes(final)||input.matchTieBreak===true||input.decidingSetMode==='MATCH_TIE_BREAK')throw new Error('AUDIT02_UNSUPPORTED_TIEBREAK_RULE');
 return rules||{version:VERSION,bestOf:input.bestOf??3,supported:true,tieBreakTarget:regular,finalSetTieBreakTarget:final,tieBreakAtGames:6,decidingSetMode:'FULL_SET',source:'EXPLICIT_ENGINE_PARAMETERS'};
}
module.exports={VERSION,resolveScoringRules,modelRules};
