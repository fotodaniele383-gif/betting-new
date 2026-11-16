'use strict';
/** Stop interpreting unlabeled game totals or handicaps as tennis moneyline. */
const V='R25_TENNIS_MARKET_V1';
function evaluate(input={}){
 const raw=String(input.market_type??input.marketType??input.bet_type??'').toUpperCase();
 const selection=String(input.prediction??input.selection??'').toUpperCase().replace(',','.').trim();
 const isTotal=/\b(TOTAL|GAME[S]?\s*TOTAL|OVER|UNDER|O\/U)\b/.test(raw)||/^(OVER|UNDER|O|U)\s*\d/.test(selection);
 const isHandicap=/HANDICAP|SPREAD|\bAH\b/.test(raw) || /[+-]\s*\d+(?:\.\d+)?/.test(selection);
 if(isTotal){
  const match=selection.match(/^(?:OVER|UNDER|O|U)\s*\d+(?:\.\d+)?(?:\s*(?:GAME|GAMES))?$/);
  if(!match) return {type:'UNSUPPORTED',hardBlock:true,reason:'TOTAL_LINE_NOT_VERIFIED',version:V};
  if(/SET[S]?\s*TOTAL|SET_TOTAL/.test(raw))return {type:'UNSUPPORTED',hardBlock:true,reason:'SET_TOTAL_REQUIRES_DISTINCT_SETTLEMENT',version:V};
  if(/MONEYLINE|MATCH_WINNER/.test(raw))return {type:'UNSUPPORTED',hardBlock:true,reason:'CONFLICTING_MARKET_TYPE',version:V};
  if(!(/GAME[S]?|TOTAL|O\/U/.test(raw+' '+selection)))return {type:'UNSUPPORTED',hardBlock:true,reason:'GAMES_UNIT_UNVERIFIED',version:V};
  return {type:'TOTALS',hardBlock:false,reason:'GAMES_TOTAL_DETECTED',version:V};
 }
 if(isHandicap)return {type:'UNSUPPORTED',hardBlock:true,reason:'HANDICAP_REQUIRES_DISTINCT_SETTLEMENT_PROOF',version:V};
 if((raw===''||/MONEYLINE|MATCH_WINNER|\b1X2\b/.test(raw)) && /^[12]$/.test(selection))return {type:'MONEYLINE',hardBlock:false,reason:'MONEYLINE_STRUCTURED',version:V};
 return {type:'UNSUPPORTED',hardBlock:true,reason:'TENNIS_MARKET_IDENTITY_MISSING',version:V};
}
module.exports={V,evaluate};
