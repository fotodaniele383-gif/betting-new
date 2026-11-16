'use strict';
// R25 BLUEPRINT: pure illustrative contracts, NO production writes, NO bookmaker actions.
const crypto = require('node:crypto');
const norm = x => String(x ?? '').trim().toUpperCase().replace(/\s+/g,' ');
const money = v => Number.isFinite(Number(v)) && Number(v)>=0 ? Math.round(Number(v)*100)/100 : null;
function marketIdentity(x={}) {
  const sport=norm(x.sport), eventId=String(x.eventId??'').trim(), bookmaker=norm(x.bookmaker);
  const odd=Number(x.odd), observedAt=Date.parse(String(x.observedAt??''));
  if(!['CALCIO','TENNIS'].includes(sport) || !eventId || !bookmaker || !Number.isFinite(odd) || odd<=1 || !Number.isFinite(observedAt)) return {ok:false,reason:'IDENTITY_OR_QUOTE_PROOF_MISSING'};
  const raw=norm(x.marketType), selection=norm(x.selection).replace(',','.');
  let type='',side='',line=null;
  if((sport==='CALCIO' && (raw==='1X2'||raw==='MATCH_ODDS'||raw==='')) && /^[1X2]$/.test(selection)) {type='1X2';side=selection;}
  else if(/(?:TOTAL|OVER|UNDER|O\/U)/.test(raw+' '+selection) || /^[OU]\s*\d/.test(selection)){
    const m=selection.match(/^(OVER|UNDER|O|U)\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(GAME|GAMES|GOALS?))?$/);
    if(!m) return {ok:false,reason:'TOTAL_LINE_OR_SIDE_UNPROVEN'};
    if(sport==='TENNIS' && !(/GAME/.test(raw+' '+selection))) return {ok:false,reason:'TENNIS_TOTAL_GAMES_UNIT_UNPROVEN'};
    type=sport==='TENNIS'?'TENNIS_GAMES_TOTAL':'FOOTBALL_GOALS_TOTAL';side=['O','OVER'].includes(m[1])?'OVER':'UNDER';line=Number(m[2]);
  } else if(sport==='TENNIS' && (raw==='MONEYLINE'||raw==='MATCH_WINNER') && /^[12]$/.test(selection)) {type='TENNIS_MONEYLINE';side=selection;}
  else return {ok:false,reason:'UNSUPPORTED_OR_AMBIGUOUS_MARKET'};
  const key=[sport,eventId,type,line===null?'-':line,side,bookmaker,odd.toFixed(4),new Date(observedAt).toISOString()].join('|');
  return {ok:true,sport,eventId,type,line,side,bookmaker,odd,observedAt:new Date(observedAt).toISOString(),key,sha256:crypto.createHash('sha256').update(key).digest('hex')};
}
function sameMarketAndPrice(a,b){return Boolean(a?.ok&&b?.ok&&a.key===b.key);}
function capDecision(x={}){
  const evalId=String(x.evaluationId??'');
  if(!evalId)return {stake:0,status:'EVALUATION_ID_MISSING'};
  const proposed=money(x.proposedStake),kelly=money(x.kellyStake),bankroll=money(x.bankroll);
  const caps=x.caps??{};
  for(const stage of ['quality','risk','calibration']){
    const c=caps[stage];
    if(!c || c.evaluationId!==evalId || c.evidenceValid!==true) return {stake:0,status:'CURRENT_CAP_PROOF_MISSING',firstBlocker:stage};
    if(money(c.amount)===null)return {stake:0,status:'CAP_INVALID',firstBlocker:stage};
    if(c.hardVeto===true)return {stake:0,status:'HARD_VETO',firstBlocker:stage};
  }
  if(proposed===null||kelly===null||bankroll===null)return{stake:0,status:'AMOUNT_INVALID'};
  const stages=[['proposal',proposed],['kelly',kelly],...['quality','risk','calibration'].map(s=>[s,money(caps[s].amount)]),['bankroll',bankroll]];
  const first=stages.find(([,v])=>v<=0);
  if(first)return{stake:0,status:'ZERO_WITH_PROVEN_CAUSE',firstBlocker:first[0]};
  const stake=Math.min(...stages.map(([,v])=>v));
  return {stake,status:'BOUNDED_PAPER_CANDIDATE_ONLY',evaluationId:evalId};
}
function sourceClassification(article={},match={}){
  const team=norm(match.team),opponent=norm(match.opponent),title=norm(article.title),publish=Date.parse(String(article.publishedAt??'')),asof=Date.parse(String(match.asOf??''));
  if(!team||!opponent||!title||!Number.isFinite(publish)||!Number.isFinite(asof))return{status:'MISSING_OR_UNVERIFIED'};
  if(publish>asof)return{status:'REJECT_FUTURE_PUBLICATION'};
  if(!title.includes(team))return{status:'NOT_TEAM_EVIDENCE'};
  // This prototype deliberately fails closed; final runtime must use a certified team-entity resolver.
  if(!title.includes(opponent))return{status:'TEAM_CONTEXT_ONLY',matchImpactAuthority:false};
  return{status:'MATCH_CANDIDATE_REQUIRES_SOURCE_VALIDATION',matchImpactAuthority:false};
}
function settlementMoneylineAudit(row={}){
  const stake=money(row.stake),odd=Number(row.odd),status=norm(row.status),profit=Number(row.profit);
  if(!(stake>0)||!(odd>1)||!Number.isFinite(profit))return{classification:'NOT_AUDITABLE'};
  if(!['WON','LOST'].includes(status))return{classification:'NOT_SIMPLE_SETTLED'};
  const expected=Math.round((status==='WON'?stake*(odd-1):-stake)*100)/100;
  return{classification:Math.abs(expected-profit)>0.01?'PAYOUT_CONFLICT_NEEDS_RECEIPT':'MATH_RECONCILED',expected,actual:profit,autocorrect:false};
}
function displayState(x={}){
  const status=norm(x.status),paper=money(x.paperStake);
  if(status==='PENDING'||status==='FINALIZING')return{state:'PENDING_COMMIT',paperStakeConfirmed:null,realMoneyAuthorized:false};
  if(status!=='COMMITTED_BATCH'||paper===null)return{state:'UNVERIFIED',paperStakeConfirmed:null,realMoneyAuthorized:false};
  if(paper===0)return{state:'FINAL_ZERO_WITH_VETO_REASON',paperStakeConfirmed:0,realMoneyAuthorized:false};
  return{state:x.evidenceMature===true?'PAPER_ALLOCATED_VERIFIED':'PAPER_ALLOCATED_PRELIMINARY_EVIDENCE',paperStakeConfirmed:paper,realMoneyAuthorized:false};
}
module.exports={marketIdentity,sameMarketAndPrice,capDecision,sourceClassification,settlementMoneylineAudit,displayState};
