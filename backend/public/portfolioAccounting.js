(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PortfolioAccounting=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const initial=1000;
function num(v){if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v==='string'&&/^[+-]?\d+(?:[.,]\d+)?$/.test(v.trim())){const n=Number(v.trim().replace(',','.'));return Number.isFinite(n)?n:null;}return null;}
const money=n=>Math.round((n+Math.sign(n)*Number.EPSILON)*100)/100;
function active(r,sport){return r.sport_type===sport&&['CURRENT','CURRENT_BOOTSTRAP'].includes(r.data_quality)&&Number(r.paper_result_active??1)===1&&Number(r.paper_result_conflict??0)===0;}
function ledger(rows,sport){
 if(!['CALCIO','TENNIS'].includes(sport))throw Error('SPORT_REQUIRED');
 const selected=rows.filter(r=>active(r,sport));let profit=0,pending=0,invalid=0,mismatch=0,multi=0;const seen=new Set();
 for(const r of selected){if(r.id!=null){if(seen.has(r.id))throw Error('DUPLICATE_LEDGER_ID');seen.add(r.id);}const stake=num(r.stake);if(stake===null||stake<0){invalid++;continue;}if(stake===0)continue;if(String(r.bet_type||'').includes('MULTI')){multi++;continue;}
 if(r.status==='PENDING'){pending+=stake;continue;}
 if(!['WON','LOST','VOID','PUSH'].includes(r.status)){invalid++;continue;}
 const p=num(r.profit),odd=num(r.odd);if(p===null){invalid++;continue;}
 const expected=r.status==='LOST'?-stake:['VOID','PUSH'].includes(r.status)?0:odd>1?stake*(odd-1):null;
 if(expected===null||Math.abs(money(expected)-p)>0.011)mismatch++;
 profit+=p;
 }
 const complete=invalid===0&&multi===0;return {sport,baseBankroll:initial,initialBankroll:initial,baselineProfit:0,currentProfit:complete?money(profit):null,currentBankroll:complete?money(initial+profit):null,pendingStake:money(pending),availableBankroll:complete?money(initial+profit-pending):null,complete,invalidRows:invalid,unreconciledRows:mismatch,multipleRowsExcluded:multi,source:'AUDIT07S_R3_FIXED_INITIAL_REGISTERED_PROFIT'};
}
// AUDIT16D_R3_T12_PORTFOLIO_LEDGER_VIEW_ONLY
// Diagnostic Portfolio projection only. The production ledger() above is intentionally untouched
// because it can be consumed by operational bankroll/stake flows. No DB value is changed.
function portfolioLedger(rows,sport){
 if(!['CALCIO','TENNIS'].includes(sport))throw Error('SPORT_REQUIRED');
 const selected=rows.filter(r=>active(r,sport));let registered=0,projected=0,pending=0,invalid=0,mismatch=0,multi=0,rawSettled=0;const seen=new Set();
 for(const r of selected){
  if(r.id!=null){if(seen.has(r.id))throw Error('DUPLICATE_LEDGER_ID');seen.add(r.id);}
  const stake=num(r.stake);if(stake===null||stake<0){invalid++;continue;}
  if(stake===0)continue; // Studio never moves Portfolio capital.
  if(String(r.bet_type||'').toUpperCase().includes('MULTI')){multi++;continue;}
  const st=String(r.status||'').toUpperCase();
  if(st==='PENDING'){pending+=stake;continue;}
  if(!['WON','LOST','VOID','PUSH'].includes(st)){invalid++;continue;}
  const odd=num(r.odd),raw=num(r.profit);
  const expected=st==='LOST'?-stake:(st==='VOID'||st==='PUSH')?0:(odd!==null&&odd>1?stake*(odd-1):null);
  if(expected===null){invalid++;continue;}
  const exp=money(expected);projected+=exp;
  if(raw!==null){registered+=raw;rawSettled++;}
  if(raw===null||Math.abs(exp-raw)>0.011)mismatch++;
 }
 const complete=invalid===0&&multi===0;
 return {sport,baseBankroll:initial,initialBankroll:initial,registeredProfit:money(registered),registeredBankroll:money(initial+registered),currentProfit:complete?money(projected):null,currentBankroll:complete?money(initial+projected):null,pendingStake:money(pending),availableBankroll:complete?money(initial+projected-pending):null,complete,invalidRows:invalid,unreconciledRows:mismatch,multipleRowsExcluded:multi,rawSettledProfitRows:rawSettled,profitAuthority:'CURRENT_REGISTERED_STAKE_STATUS_ODD_PROJECTION',rawProfitPreserved:true,productionLedgerUntouched:true,source:'AUDIT16D_R3_T12_PORTFOLIO_VIEW_ONLY_CURRENT_SCOPE_PROJECTION'};
}
function clv(r){return Number(r.clv_verified)===1&&r.clv_verified!=null?num(r.clv_pct):null;}
function wilson(w,n){if(!Number.isInteger(n)||n<=0||!Number.isInteger(w)||w<0||w>n)return null;const z=1.959963984540054,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return [Math.max(0,c-h)*100,Math.min(100,c+h)*100];}
function interval(w,n){const a=wilson(w,n);return a?a.map(x=>x.toFixed(1)).join('–')+'%':'N/D';}
function calibration(report){const c=report?.calibration||report||{},buckets=Array.isArray(c.buckets)?c.buckets:[];const valid=buckets.filter(b=>b.sampleReliable===true||(b.sampleReliable!==false&&b.sample>=Number(b.minSample||c.minSample||10)));return {...report,...c,buckets:buckets.map(b=>({...b,calibrationError:num(b.observedWinRate)!==null&&num(b.avgPredictedProb)!==null?money(num(b.observedWinRate)-num(b.avgPredictedProb)):null})),summary:{...c.summary,quality:valid.length?(c.summary?.quality||'AUDIT'):'LOW_SAMPLE'}};}
return {initial,num,money,active,ledger,portfolioLedger,clv,wilson,interval,calibration};
});
