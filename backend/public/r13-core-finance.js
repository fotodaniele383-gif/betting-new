'use strict';
/* R13 Core Bridge: browser+Node pure scenario math, read-only, no stake/order API. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.R13CoreFinance=m;})(typeof window!=='undefined'?window:this,function(){
 const valid=x=>typeof x==='number'&&Number.isFinite(x);
 const asEuro=c=>Number((c/100).toFixed(2));
 function odds(x){if(!valid(x)||x<=1||x>1000)throw Error('QUOTA_NON_VALIDA');return x;}
 function quarter(line){if(!valid(line)||Math.abs(line)>100||Math.abs(line*4-Math.round(line*4))>1e-7)throw Error('LINEA_ASIATICA_NON_VALIDA');const h=line*2;return Math.abs(h-Math.round(h))<1e-9?[line]:[Math.floor(h)/2,Math.ceil(h)/2];}
 function winLose(v,odd){return v>1e-9?odd-1:v< -1e-9?-1:0;}
 function factor(b,s){if(!b||!s)throw Error('DATI_MERCATO_MANCANTI');const o=odds(b.odds);
  if(b.type==='football_total'||b.type==='football_asian_handicap'){
   if(s.sport!=='football'||s.completed!==true||!Number.isInteger(s.home)||!Number.isInteger(s.away)||s.home<0||s.away<0)throw Error('RISULTATO_CALCIO_NON_VALIDO');
   if(b.type==='football_total'&&!['over','under'].includes(b.side))throw Error('LATO_TOTAL_INVALIDO');
   if(b.type==='football_asian_handicap'&&!['home','away'].includes(b.side))throw Error('LATO_AH_INVALIDO');
   return quarter(b.line).reduce((sum,line)=>{
    const d=b.type==='football_total'?(s.home+s.away-line)*(b.side==='over'?1:-1):(s.home-s.away)*(b.side==='home'?1:-1)+line;
    return sum+winLose(d,o);
   },0)/quarter(b.line).length;
  }
  if(b.type==='tennis_match_winner'||b.type==='tennis_set_handicap'){
   if(b.settlementRuleId!=='PINNACLE_2026_05')throw Error('REGOLAMENTO_TENNIS_NON_VALIDATO');
   if(s.sport!=='tennis'||s.completed!==true||!['A','B'].includes(s.winner)||!['A','B'].includes(b.side)||!Number.isInteger(s.setsA)||!Number.isInteger(s.setsB)||s.setsA===s.setsB||s.winner!==(s.setsA>s.setsB?'A':'B'))throw Error('RISULTATO_TENNIS_NON_VALIDO');
   if(b.type==='tennis_match_winner')return s.winner===b.side?o-1:-1;
   const delta=b.side==='A'?s.setsA-s.setsB:s.setsB-s.setsA;
   return quarter(b.line).reduce((sum,line)=>sum+winLose(delta+line,o),0)/quarter(b.line).length;
  }
  throw Error('MERCATO_NON_SUPPORTATO');
 }
 function centRound(x){if(!valid(x))throw Error('AMMONTARE_NON_VALIDO');return Math.sign(x)*Math.round(Math.abs(x)+1e-9);}
 function optimize(bets,scenarios,budgetEuro=10){
  if(!Array.isArray(bets)||bets.length!==2||!Array.isArray(scenarios)||scenarios.length===0||scenarios.length>250)throw Error('DUE_SINGOLE_E_SCENARI_RICHIESTI');
  if(!valid(budgetEuro)||budgetEuro<=0||budgetEuro>1000)throw Error('BUDGET_NON_VALIDO');const budget=Math.round(budgetEuro*100);
  if(budget<2)throw Error('BUDGET_NON_VALIDO');
  const rows=scenarios.map(s=>bets.map(b=>factor(b,s)));
  let best=null;for(let a=1;a<budget;a++){
   const b=budget-a,vals=rows.map(f=>centRound(a*f[0])+centRound(b*f[1]));
   const worst=Math.min(...vals),sum=vals.reduce((x,y)=>x+y,0);
   if(!best||worst>best.worst||(worst===best.worst&&sum>best.sum)||(worst===best.worst&&sum===best.sum&&Math.abs(a-budget/2)<Math.abs(best.a-budget/2)))best={a,b,worst,sum,vals};
  }
  return {status:'SIMULATION_ONLY_NOT_ORDER',budgetEuro:asEuro(budget),stakesEuro:[asEuro(best.a),asEuro(best.b)],worstNetEuro:asEuro(best.worst),scenarioResults:scenarios.map((s,i)=>({scenario:s.id,netEuro:asEuro(best.vals[i])})),globalLossBoundEuro:-asEuro(budget)};
 }
 function tennisBO3(){return [
 {id:'A_2_0',sport:'tennis',winner:'A',setsA:2,setsB:0,completed:true},
 {id:'A_2_1',sport:'tennis',winner:'A',setsA:2,setsB:1,completed:true},
 {id:'B_2_0',sport:'tennis',winner:'B',setsA:0,setsB:2,completed:true},
 {id:'B_2_1',sport:'tennis',winner:'B',setsA:1,setsB:2,completed:true}
 ];}
 function footballScores(maxGoals=8){if(!Number.isInteger(maxGoals)||maxGoals<0||maxGoals>12)throw Error('GOALS_RANGE_INVALID');const r=[];for(let h=0;h<=maxGoals;h++)for(let a=0;a<=maxGoals;a++)r.push({id:`${h}-${a}`,sport:'football',home:h,away:a,completed:true});return r;}
 function quoteBet(q){if(!q||!['AH','TOTAL'].includes(q.market)||!valid(Number(q.line))||!valid(Number(q.odd)))throw Error('QUOTA_INVALIDA');
  return {type:q.market==='AH'?'football_asian_handicap':'football_total',side:String(q.side||'').toLowerCase(),line:Number(q.line),odds:odds(Number(q.odd))};
 }
 return {VERSION:'R13_CORE_BRIDGE_MATH_V1',factor,optimize,tennisBO3,footballScores,quoteBet,quarter};
});
