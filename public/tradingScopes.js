(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TradingScopes=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
function number(v){if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string'||!/^\d+(?:[.,]\d+)?$/.test(v.trim()))return null;const n=Number(v.trim().replace(',','.'));return Number.isFinite(n)?n:null;}
function stake(r){return number(r.stake);}
function scope(r){const n=stake(r);return n===null||n<0?'INVALID':n===0?'STUDIO':'TRADING';}
// AUDIT16D_R3_T12_CURRENT_SCOPE_PNL_PROJECTION
// View-only projection: raw DB profit is preserved in raw_profit and is never written back.
const money=n=>Math.round((n+Math.sign(n)*Number.EPSILON)*100)/100;
function projectedProfit(r,mode=scope(r)){
 if(mode!=='TRADING')return null;
 const s=stake(r),st=String(r.status||'').toUpperCase();
 if(s===null||s<=0)return null;
 if(st==='LOST')return money(-s);
 if(st==='VOID'||st==='PUSH')return 0;
 if(st==='WON'){const o=number(r.odd);return o!==null&&o>1?money(s*(o-1)):null;}
 return null;
}
function projectRow(r,mode=scope(r)){
 const raw=Object.prototype.hasOwnProperty.call(r,'raw_profit')?r.raw_profit:r.profit;
 const p=projectedProfit(r,mode);
 return {...r,raw_profit:raw,portfolio_profit:p,profit:mode==='STUDIO'?null:(mode==='TRADING'&&p!==null?p:r.profit),portfolio_profit_source:mode==='TRADING'?'CURRENT_REGISTERED_STAKE_STATUS_ODD_PROJECTION':'NOT_APPLICABLE_STUDIO'};
}
function projectRows(rows,mode){return rows.map(r=>projectRow(r,mode));}
function filter(rows,mode){return rows.filter(r=>scope(r)===mode);}
function visible(r,sport){const q=String(r.data_quality||'').toUpperCase();return String(r.sport_type||'').toUpperCase()===sport&&Number(r.paper_result_active??1)===1&&Number(r.paper_result_conflict??0)!==1&&['CURRENT','CURRENT_BOOTSTRAP'].includes(q);}
function metrics(rows,mode){
 const selected=filter(rows,mode),data=selected.filter(r=>!String(r.bet_type||'').toUpperCase().includes('MULTI')),decisive=data.filter(r=>['WON','LOST'].includes(r.status)),settled=data.filter(r=>['WON','LOST','VOID','PUSH'].includes(r.status));
 const wins=decisive.filter(r=>r.status==='WON').length;
 const financial=settled.map(r=>({stake:stake(r),profit:typeof r.profit==='number'&&Number.isFinite(r.profit)?r.profit:null}));
 const complete=financial.every(x=>x.profit!==null),invested=financial.reduce((s,x)=>s+x.stake,0),profit=complete?financial.reduce((s,x)=>s+x.profit,0):null;
 const clv=data.filter(r=>r.clv_verified===1&&typeof r.clv_pct==='number'&&Number.isFinite(r.clv_pct));
 const predictions=decisive.filter(r=>typeof r.estimated_prob==='number'&&r.estimated_prob>=0&&r.estimated_prob<=100);
 return {mode,multipleRowsExcluded:selected.length-data.length,total:data.length,decisive:decisive.length,wins,losses:decisive.length-wins,pending:data.filter(r=>r.status==='PENDING').length,other:data.filter(r=>!['WON','LOST','PENDING'].includes(r.status)).length,hitRate:decisive.length?wins/decisive.length*100:null,exposure:mode==='TRADING'?data.filter(r=>r.status==='PENDING').reduce((s,r)=>s+stake(r),0):null,profit:mode==='TRADING'?profit:null,settledStake:mode==='TRADING'?invested:null,roi:mode==='TRADING'&&complete&&invested>0?profit/invested*100:null,missingProfit:financial.filter(x=>x.profit===null).length,clvPositiveRate:clv.length?clv.filter(r=>r.clv_pct>0).length/clv.length*100:null,clvCount:clv.length,clv:clv.length?clv.reduce((s,r)=>s+r.clv_pct,0)/clv.length:null,brierCount:predictions.length,brier:predictions.length?predictions.reduce((s,r)=>s+(r.estimated_prob/100-(r.status==='WON'?1:0))**2,0)/predictions.length:null};
}

// Summary adapter for the existing dashboard. Original rows are never changed.
function reporting(rows,mode){
 function build(input){
  const data=filter(input,mode).filter(r=>!String(r.bet_type||'').toUpperCase().includes('MULTI'));
  const closed=data.filter(r=>['WON','LOST'].includes(r.status)),m=metrics(closed,mode);
  const op={placed:closed.length,won:m.wins,lost:m.losses,hitRatePct:m.hitRate,stake:m.settledStake,profit:m.profit,roiPct:m.roi};
  const bands=[];
  for(let lo=0;lo<100;lo+=10){const b=closed.filter(r=>typeof r.estimated_prob==='number'&&r.estimated_prob>=lo&&(lo===90?r.estimated_prob<=100:r.estimated_prob<lo+10));if(!b.length)continue;const bm=metrics(b,mode),avg=b.reduce((s,r)=>s+r.estimated_prob,0)/b.length;bands.push({label:lo+'–'+(lo+10)+'%',sample:b.length,hitRatePct:bm.hitRate,avgProbabilityPct:avg,calibrationGapPp:bm.hitRate-avg,brier:bm.brier});}
  return {operational:op,signal:{...op},theoreticalFlat:{roiPct:(()=>{const flat=closed.filter(r=>typeof r.odd==='number'&&r.odd>1);return flat.length?flat.reduce((a,r)=>a+(r.status==='WON'?r.odd-1:-1),0)/flat.length*100:null;})()},statusCounts:data.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),clv:{beatenPct:m.clvPositiveRate,verified:m.clvCount,eligible:closed.length,coveragePct:closed.length?m.clvCount/closed.length*100:null},calibrationBands:bands};
 }
 const sorted=[...rows].sort((a,b)=>b.id-a.id);
 return {full:build(sorted),rolling:build(sorted.slice(0,200))};
}
return {number,stake,scope,projectedProfit,projectRow,projectRows,filter,visible,metrics,reporting};
});
