'use strict';
// R13 DDRI — pure payout and scenario functions. No order placement, no database mutation.
const assert = require('node:assert/strict');
const finite = n => typeof n === 'number' && Number.isFinite(n);
function oddsCheck(odds){ if(!finite(odds) || odds<=1 || odds>1000) throw Error('INVALID_ODDS'); return odds; }
function cents(euro){if(!finite(euro)||euro<0||euro>1e8) throw Error('INVALID_STAKE'); return Math.round((euro+Number.EPSILON)*100);}
function toEuro(c){return Number((c/100).toFixed(2));}
function centRound(x){if(!finite(x))throw Error('INVALID_AMOUNT');return Math.sign(x)*Math.round(Math.abs(x)+1e-9);}
function resultFactor(outcome,odds){oddsCheck(odds);return outcome==='win'?odds-1:outcome==='push'||outcome==='void'?0:outcome==='lose'?-1:(()=>{throw Error('INVALID_RESULT')})();}
function quarterLines(line){
 if(!finite(line)||Math.abs(line)>100||Math.abs(line*4-Math.round(line*4))>1e-7)throw Error('INVALID_ASIAN_LINE');
 const half=line*2;return Math.abs(half-Math.round(half))<1e-9?[line]:[Math.floor(half)/2,Math.ceil(half)/2];
}
function basicOutcome(value){return value>1e-9?'win':value< -1e-9?'lose':'push';}
function singleResult(bet,scenario){
 if(!bet||typeof bet!=='object'||!scenario||typeof scenario!=='object')throw Error('INVALID_PAYOFF_INPUT');
 oddsCheck(bet.odds); const t=bet.type;
 if(t==='football_1x2'||t==='football_total'||t==='football_asian_handicap'){
  if(scenario.sport!=='football'||!Number.isInteger(scenario.home)||!Number.isInteger(scenario.away)||scenario.home<0||scenario.away<0||scenario.completed!==true)throw Error('FOOTBALL_FINAL_SCORE_REQUIRED');
  if(t==='football_1x2'){
   const res=scenario.home>scenario.away?'home':scenario.home<scenario.away?'away':'draw';
   if(!['home','draw','away'].includes(bet.side))throw Error('INVALID_SIDE');return resultFactor(res===bet.side?'win':'lose',bet.odds);
  }
  if(t==='football_total'){
   if(!['over','under'].includes(bet.side))throw Error('INVALID_SIDE');
   return quarterLines(bet.line).reduce((a,line)=>a+resultFactor(basicOutcome((scenario.home+scenario.away-line)*(bet.side==='over'?1:-1)),bet.odds),0)/quarterLines(bet.line).length;
  }
  if(!['home','away'].includes(bet.side))throw Error('INVALID_SIDE');
  const gd=(scenario.home-scenario.away)*(bet.side==='home'?1:-1);
  return quarterLines(bet.line).reduce((a,line)=>a+resultFactor(basicOutcome(gd+line),bet.odds),0)/quarterLines(bet.line).length;
 }
 if(t==='tennis_match_winner'||t==='tennis_set_handicap'||t==='tennis_total_games'||t==='tennis_game_handicap'){
  if(scenario.sport!=='tennis'||!['A','B'].includes(bet.side)||!['A','B'].includes(scenario.winner)||!Number.isInteger(scenario.setsA)||!Number.isInteger(scenario.setsB)||scenario.setsA<0||scenario.setsB<0)throw Error('TENNIS_OUTCOME_INVALID');
  if(bet.settlementRuleId!=='PINNACLE_2026_05')throw Error('TENNIS_SETTLEMENT_RULE_NOT_VERIFIED');
  if(scenario.completed!==true){
    if(scenario.retired===true&&bet.type==='tennis_match_winner'&&!Number.isInteger(scenario.completedSets))throw Error('TENNIS_COMPLETED_SETS_REQUIRED_FOR_RETIREMENT');
    if(bet.type==='tennis_match_winner' && scenario.completedSets>=1 && scenario.retired===true){return resultFactor(scenario.winner===bet.side?'win':'lose',bet.odds);}
    if(scenario.retired===true)return 0; // non-completed handicap/totals are void under PINNACLE_2026_05
    throw Error('TENNIS_COMPLETION_UNKNOWN');
  }
  if(scenario.setsA===scenario.setsB||scenario.winner!==(scenario.setsA>scenario.setsB?'A':'B'))throw Error('TENNIS_SETS_WINNER_CONFLICT');
  if(t==='tennis_match_winner')return resultFactor(scenario.winner===bet.side?'win':'lose',bet.odds);
  if(t==='tennis_set_handicap'){
    const delta=bet.side==='A'?scenario.setsA-scenario.setsB:scenario.setsB-scenario.setsA;
    return quarterLines(bet.line).reduce((a,line)=>a+resultFactor(basicOutcome(delta+line),bet.odds),0)/quarterLines(bet.line).length;
  }
  if(!Number.isInteger(scenario.gamesA)||!Number.isInteger(scenario.gamesB))throw Error('TENNIS_GAME_COUNTS_REQUIRED');
  if(t==='tennis_total_games'){
    if(!['over','under'].includes(bet.direction))throw Error('INVALID_SIDE');
    return quarterLines(bet.line).reduce((a,line)=>a+resultFactor(basicOutcome((scenario.gamesA+scenario.gamesB-line)*(bet.direction==='over'?1:-1)),bet.odds),0)/quarterLines(bet.line).length;
  }
  const gd=bet.side==='A'?scenario.gamesA-scenario.gamesB:scenario.gamesB-scenario.gamesA;
  return quarterLines(bet.line).reduce((a,line)=>a+resultFactor(basicOutcome(gd+line),bet.odds),0)/quarterLines(bet.line).length;
 }
 throw Error('UNSUPPORTED_MARKET_TYPE');
}
function settleCents(bet,scenario,stakeCents){if(!Number.isInteger(stakeCents)||stakeCents<0)throw Error('INVALID_CENTS');return centRound(stakeCents*singleResult(bet,scenario));}
const tennisBO3Scenarios=Object.freeze([
 {id:'A_2_0',sport:'tennis',winner:'A',setsA:2,setsB:0,completed:true},
 {id:'A_2_1',sport:'tennis',winner:'A',setsA:2,setsB:1,completed:true},
 {id:'B_2_0',sport:'tennis',winner:'B',setsA:0,setsB:2,completed:true},
 {id:'B_2_1',sport:'tennis',winner:'B',setsA:1,setsB:2,completed:true}
]);
function minimaxTwo(bets,scenarios,budgetEuro=10){
 if(!Array.isArray(bets)||bets.length!==2||!Array.isArray(scenarios)||!scenarios.length||scenarios.length>250)throw Error('MINIMAX_TWO_BETS_SCENARIOS_REQUIRED');
 const budget=cents(budgetEuro);if(budget<2||budget>100000)throw Error('MINIMAX_BUDGET_UNSUPPORTED');
 const factors=scenarios.map(s=>bets.map(b=>singleResult(b,s)));
 let best=null;
 for(let stakeA=1;stakeA<budget;stakeA++){
  const stakeB=budget-stakeA, profits=factors.map(f=>centRound(stakeA*f[0])+centRound(stakeB*f[1]));
  const worst=Math.min(...profits),sum=profits.reduce((a,b)=>a+b,0);
  if(!best||worst>best.worst||(worst===best.worst&&sum>best.sum)||(worst===best.worst&&sum===best.sum&&Math.abs(stakeA-budget/2)<Math.abs(best.stakeA-budget/2)))best={stakeA,stakeB,worst,sum,profits};
 }
 return {status:'SIMULATION_ONLY_NOT_ORDER',budgetEuro:toEuro(budget),stakesEuro:[toEuro(best.stakeA),toEuro(best.stakeB)],worstNetEuro:toEuro(best.worst),scenarioResults:scenarios.map((s,i)=>({scenario:s.id||String(i),netEuro:toEuro(best.profits[i])})),scope:'Enumerated scenarios only; no retirement/void unless explicitly supplied. Cent rounding is illustrative.'};
}
function scenarioEV(bet,scenarios){
 if(!Array.isArray(scenarios)||!scenarios.length)throw Error('DISTRIBUTION_REQUIRED');
 const sum=scenarios.reduce((a,s)=>{if(!finite(s.p)||s.p<0||s.p>1)throw Error('INVALID_SCENARIO_PROB');return a+s.p;},0);
 if(Math.abs(sum-1)>1e-8)throw Error('SCENARIO_PROB_SUM_NOT_ONE');
 return scenarios.reduce((a,s)=>a+s.p*singleResult(bet,s),0)*100;
}
function noVig(odds){if(!Array.isArray(odds)||odds.length<2)throw Error('FULL_MARKET_BOOK_REQUIRED');const p=odds.map(x=>1/oddsCheck(x));const total=p.reduce((a,b)=>a+b,0);return {overround:total-1,probabilities:p.map(x=>x/total)};}
module.exports={oddsCheck,cents,toEuro,centRound,quarterLines,singleResult,settleCents,tennisBO3Scenarios,minimaxTwo,scenarioEV,noVig};
