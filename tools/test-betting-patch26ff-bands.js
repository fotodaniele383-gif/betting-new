'use strict';
const m=require('../backend/aiOutcomeBandPerformance');
const checks=[];const check=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),...(details?{details}:{})});
const rows=[
 {id:1,status:'WON',sport_type:'CALCIO',bet_type:'SINGLE',league:'Serie A',estimated_prob:15,stake:2,data_quality:'CURRENT_BOOTSTRAP',paper_result_active:1,paper_result_conflict:0},
 {id:2,status:'LOST',sport_type:'CALCIO',bet_type:'SINGLE',league:'Serie A',estimated_prob:25,stake:0,data_quality:'LEGACY_DIRTY',paper_result_active:1,paper_result_conflict:0},
 {id:3,status:'WON',sport_type:'CALCIO',bet_type:'SINGLE',league:'Premier',estimated_prob:.65,stake:3,data_quality:'CURRENT',paper_result_active:1,paper_result_conflict:0},
 {id:4,status:'LOST',sport_type:'CALCIO',bet_type:'MULTI_CALCIO',league:'Serie A',estimated_prob:75,stake:5,data_quality:'CURRENT',paper_result_active:1,paper_result_conflict:0},
 {id:5,status:'WON',sport_type:'CALCIO',bet_type:'SINGLE',league:'Serie A',estimated_prob:85,stake:2,data_quality:'CURRENT',paper_result_active:0,paper_result_conflict:0},
 {id:6,status:'WON',sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',league:'[ATP] ATP500',tour_type:'ATP',estimated_prob:55,stake:2,data_quality:'CURRENT_BOOTSTRAP',paper_result_active:1,paper_result_conflict:0},
 {id:7,status:'LOST',sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',league:'[ATP] ATP500',tour_type:'ATP',estimated_prob:55,stake:0,data_quality:'CURRENT_BOOTSTRAP',paper_result_active:1,paper_result_conflict:0},
 {id:8,status:'WON',sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',league:'[WTA] Grand Slam',tour_type:'WTA',estimated_prob:95,stake:2,data_quality:'LEGACY_DIRTY',paper_result_active:1,paper_result_conflict:0},
 {id:9,status:'PENDING',sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',league:'[ATP] ATP500',estimated_prob:65,stake:2,data_quality:'CURRENT',paper_result_active:1,paper_result_conflict:0},
 {id:10,status:'WON',sport_type:'TENNIS',bet_type:'SINGLE_TENNIS',league:'[ATP] ATP500',estimated_prob:65,stake:2,data_quality:'CURRENT',paper_result_active:1,paper_result_conflict:1}
];
const calcio=m.buildAiOutcomeBandPerformance(rows,{sport:'CALCIO'});
const tennis=m.buildAiOutcomeBandPerformance(rows,{sport:'TENNIS'});
check('versione modulo Patch26FF',calcio.version===m.AI_OUTCOME_BAND_PERFORMANCE_VERSION);
check('nove fasce fisse',calcio.bandDefinitions.length===9);
check('prima fascia 10-20',calcio.bandDefinitions[0].label==='10–20%');
check('ultima fascia 90-100',calcio.bandDefinitions[8].label==='90–100%');
check('probabilita 0-1 normalizzata',m.normalizeProbability(.65)===65);
check('calcio segnali risolti filtrati',calcio.scopes.AI_SIGNALS.overall.summary.resolved===3);
check('calcio stake reale filtrato',calcio.scopes.REAL_STAKE.overall.summary.resolved===2);
check('multi esclusa',calcio.scopes.AI_SIGNALS.overall.summary.resolved<4);
check('riga inattiva esclusa',calcio.scopes.AI_SIGNALS.overall.summary.resolved===3);
check('fascia 60-70 contiene probabilita normalizzata',calcio.scopes.AI_SIGNALS.overall.bands.find(x=>x.key==='60_70').resolved===1);
check('WON/LOST percentuali corrette',Math.abs(calcio.scopes.AI_SIGNALS.overall.summary.winRatePct-66.6666667)<.001);
check('qualita certificata separata',calcio.scopes.AI_SIGNALS.overall.summary.certifiedRows===2&&calcio.scopes.AI_SIGNALS.overall.summary.legacyRows===1);
check('competizioni calcio separate',calcio.scopes.AI_SIGNALS.competitions.length===2);
check('tennis segnali risolti filtrati',tennis.scopes.AI_SIGNALS.overall.summary.resolved===3);
check('ATP500 separato da WTA Grand Slam',tennis.scopes.AI_SIGNALS.competitions.some(x=>x.label==='[ATP] ATP500')&&tennis.scopes.AI_SIGNALS.competitions.some(x=>x.label==='[WTA] Grand Slam'));
check('pending e conflitto esclusi',tennis.scopes.AI_SIGNALS.overall.summary.resolved===3);
check('TPI escluso',tennis.safeguards.tpiExcluded===true);
check('affidabilita non usata come probabilita',tennis.safeguards.probabilityIsNotReliabilityScore===true);
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'BETTING_PATCH_26F_F',checks:checks.length,passed:checks.length-failed.length,failed:failed.length,results:checks},null,2));process.exit(failed.length?1:0);
