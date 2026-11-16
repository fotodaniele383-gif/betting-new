'use strict';
// Isolated audit mathematics; no external provider, no automatic stake, no bankroll.
const asNumber=x=> (x===''||x===null||x===undefined||typeof x==='boolean'?NaN:Number(x));
function validOdd(x){const n=asNumber(x);return Number.isFinite(n)&&n>1&&n<=1000;}
function validLine(x){const n=asNumber(x);return Number.isFinite(n)&&Math.abs(n)<=20&&Math.abs(n*4-Math.round(n*4))<1e-8;}
function validateQuote(x){
 if(!x||!['AH','TOTAL'].includes(x.market))throw Error('MERCATO_ASIATICO_NON_VALIDO');
 if(!['HOME','AWAY','OVER','UNDER'].includes(x.side))throw Error('SELEZIONE_NON_VALIDA');
 if(x.market==='AH'&&!['HOME','AWAY'].includes(x.side))throw Error('ASIAN_HANDICAP_LATO_ERRATO');
 if(x.market==='TOTAL'&&!['OVER','UNDER'].includes(x.side))throw Error('ASIAN_TOTAL_LATO_ERRATO');
 if(!validLine(x.line))throw Error('LINEA_NON_VALIDA_QUARTI');
 if(x.market==='TOTAL'&&asNumber(x.line)<0)throw Error('TOTAL_NEGATIVO');
 if(!validOdd(x.odd))throw Error('QUOTA_NON_VALIDA');
 const book=String(x.bookmaker||'').trim();if(book.length<2||book.length>100)throw Error('BOOKMAKER_RICHIESTO');
 const ts=String(x.capturedAt||'').trim();if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(ts)||!Number.isFinite(Date.parse(ts)))throw Error('TIMESTAMP_QUOTA_CON_FUSO_RICHIESTO');
 const url=String(x.url||'').trim();if(url&&(!/^https:\/\//i.test(url)||url.length>700))throw Error('URL_NON_VALIDO');
 return {market:x.market,side:x.side,line:Number(x.line),odd:Number(x.odd),bookmaker:book,capturedAt:new Date(ts).toISOString(),url};
}
function poisson(lambda,k){let r=Math.exp(-lambda);for(let i=1;i<=k;i++)r*=lambda/i;return r;}
function scoreDistribution(h,a,max=32){if(![h,a].every(v=>Number.isFinite(v)&&v>=0.1&&v<=6))throw Error('XG_NON_VALIDI');
 const rows=[];let total=0;for(let i=0;i<=max;i++)for(let j=0;j<=max;j++){let p=poisson(h,i)*poisson(a,j);rows.push({home:i,away:j,p});total+=p;}
 // Truncated tail is disclosed. Do not silently pretend the distribution is complete.
 if(total<0.999999)throw Error('DISTRIBUZIONE_INCOMPLETA_TAIL');
 return rows.map(r=>({...r,p:r.p/total}));}
function settleHalf(m,side,line,home,away,odd){const v=m==='TOTAL'?(side==='OVER'?home+away-line:line-(home+away)):(side==='HOME'?home-away+line:away-home+line);
 if(v>1e-8)return odd-1;if(v< -1e-8)return -1;return 0;}
function profit(market,side,line,odd,home,away){
 // Asian quarter lines split a unit stake equally between adjacent half lines.
 const q=asNumber(line),isQ=Math.abs(q*2-Math.round(q*2))>1e-8;
 return isQ?(settleHalf(market,side,q-.25,home,away,odd)+settleHalf(market,side,q+.25,home,away,odd))/2:settleHalf(market,side,q,home,away,odd);
}
function evaluate(rows,q){const bins={fullWin:0,halfWin:0,push:0,halfLoss:0,fullLoss:0};let ev=0;
 for(const {home,away,p} of rows){const pay=profit(q.market,q.side,q.line,q.odd,home,away);ev+=p*pay;
 const key=pay>=q.odd-1-1e-8?'fullWin':pay>1e-8?'halfWin':pay< -1+1e-8?'fullLoss':pay< -1e-8?'halfLoss':'push';bins[key]+=p;}
 return {evPct:ev*100,probabilities:bins,model:'INDEPENDENT_POISSON_MANUAL_XG_UNCALIBRATED',calibrated:false};}
function brs({quotes=[],context={},evidence={},validDistribution=false}){
 const e=Object.values(evidence||{}).filter(x=>x&&typeof x==='object');const q=quotes;
 const quotePoints=Math.min(20, (q.length?5:0)+(q.length&&q.every(x=>x.bookmaker)?5:0)+(q.length&&q.every(x=>x.capturedAt)?5:0)+(q.length&&q.every(x=>x.url)?5:0));
 const dataPoints=(context.home&&context.away?5:0)+(context.kickoff?5:0)+(validDistribution?5:0)+(e.length?5:0);
 const sourcePoints=(e.some(x=>x.url)?5:0)+(e.some(x=>x.capturedAt)?5:0)+(q.length&&q.every(x=>x.url)?5:0);
 const probabilityPoints=0; // A numeric value alone is not empirical calibration.
 const robustnessPoints=validDistribution?5:0; // Mathematical coherence only; no out-of-sample certification.
 const antiPoints=15; // Machine checks: schema, provenance flags and no invented EV.
 const components={quotes:quotePoints,data:dataPoints,sources:sourcePoints,probabilityValidation:probabilityPoints,modelRobustness:robustnessPoints,antiHallucination:antiPoints};
 const total=Object.values(components).reduce((a,b)=>a+b,0);
 return {total,components,level:total>=90?'MOLTO_ALTA':total>=80?'ALTA':total>=70?'BUONA':total>=60?'SUFFICIENTE':total>=40?'DEBOLE':'INSUFFICIENTE',hardGate:'MODEL_NOT_CALIBRATED',thresholdSatisfied:total>=60,reason:'BRS diagnostico non certifica le probabilita; gate modello non calibrato = NO BET.'};
}
module.exports={validLine,validateQuote,scoreDistribution,profit,evaluate,brs};
