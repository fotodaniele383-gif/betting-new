'use strict';
// Only a theoretical two-single BO3 payoff calculator. No broker/portfolio/DB access.
const VERSION='BETTINGAPP_R10_MINIMAX_BO3_V1';
function validOdds(n){return typeof n==='number'&&Number.isFinite(n)&&n>1&&n<=1000}
function money(x){return Math.round((x+Number.EPSILON)*100)/100}
function calculate(qFavorite,qOther,budget=10){
 if(!validOdds(qFavorite)||!validOdds(qOther))throw Error('R10_VERIFIED_ODDS_REQUIRED');
 if(!Number.isInteger(Math.round(budget*100))||!Number.isFinite(budget)||budget<=0||budget>10000)throw Error('R10_BAD_BUDGET');
 const cents=Math.round(budget*100),exact=cents*qOther/(qFavorite+qOther);
 const candidates=new Set([Math.floor(exact),Math.ceil(exact)]);
 let best=null;
 for(const n of candidates){if(n<0||n>cents)continue;
  const a=n/100,b=(cents-n)/100;
  const raw=[a*qFavorite-budget,a*qFavorite+b*qOther-budget,b*qOther-budget];
  const minimum=Math.min(...raw);
  const candidate={favoriteStake:a,otherStake:b,net2to0:money(raw[0]),net2to1:money(raw[1]),netOtherWins:money(raw[2]),worst:money(minimum),worstRaw:minimum,raw};
  if(!best||candidate.worstRaw>best.worstRaw+1e-10||(Math.abs(candidate.worstRaw-best.worstRaw)<1e-10&&candidate.favoriteStake<best.favoriteStake))best=candidate;
 }
 return {version:VERSION,budget,qFavorite,qOther,formula:'x=budget*qOther/(qFavorite+qOther)',exactFavoriteStake:exact/100,...best,
  assumptions:['BO3 completed','A moneyline and B +1.5 SET accepted','both settled as described','no retirement or void/exception'],advice:'THEORETICAL_PAYOFF_NOT_VALUE_OR_EXECUTABLE_STAKE'};
}
module.exports={calculate,VERSION};
