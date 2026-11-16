'use strict';

const TENNIS_CLV_CONTRACT_VERSION = 'TENNIS_CLV_CONTRACT_V1_PATCH4';
const CLV_STATES = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  PENDING: 'PENDING',
  AVAILABLE_UNVERIFIED: 'AVAILABLE_UNVERIFIED',
  VERIFIED: 'VERIFIED',
  UNAVAILABLE: 'UNAVAILABLE',
  CONFLICT: 'CONFLICT'
});

function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function text(v){ return String(v==null?'':v).trim(); }
function upper(v){ return text(v).toUpperCase(); }
function parseTs(v){
  if(v==null||v==='') return null;
  if(typeof v==='number' && Number.isFinite(v)) return v < 1e12 ? v*1000 : v;
  const n=Number(v); if(Number.isFinite(n) && String(v).trim()!=='') return n < 1e12 ? n*1000 : n;
  const d=new Date(v); return Number.isFinite(d.getTime())?d.getTime():null;
}
function isTotals(row={}){ return /TOTAL|OVER|UNDER|OU|GAMES/.test(upper(row.market_type||row.market||row.bet_market)); }
function normalizeLine(v){ const n=num(v); return n==null?null:Number(n.toFixed(3)); }
function deriveBookmaker(bookmakers=[]){
  if(!Array.isArray(bookmakers)) return '';
  const names=bookmakers.map(b=>text(b?.title||b?.key||b?.bookmaker)).filter(Boolean);
  return [...new Set(names)].slice(0,5).join('|');
}
function calculateClvPct(openingOdd, closingOdd){
  const o=num(openingOdd), c=num(closingOdd);
  if(!(o>1) || !(c>1)) return null;
  return Number(((o/c-1)*100).toFixed(4));
}
function evaluateTennisClvContract(input={}){
  const openingOdd=num(input.opening_odd ?? input.openingOdd ?? input.odd);
  const closingOdd=num(input.closing_odd ?? input.closingOdd ?? input.clv);
  const source=text(input.clv_source ?? input.source);
  const side=upper(input.closing_odd_side ?? input.selection_side ?? input.prediction);
  const eventFp=text(input.tennis_event_fingerprint ?? input.eventFingerprint);
  const marketFp=text(input.tennis_market_fingerprint ?? input.marketFingerprint);
  const bookmaker=text(input.clv_bookmaker ?? input.bookmaker ?? deriveBookmaker(input.bookmakers));
  const sourceEventId=text(input.clv_source_event_id ?? input.source_event_id ?? input.provider_event_id);
  const openingTs=parseTs(input.clv_opening_ts ?? input.opening_ts ?? input.created_at);
  const closingTs=parseTs(input.clv_closing_ts ?? input.closing_ts ?? input.acquired_at);
  const matchTs=parseTs(input.canonical_match_datetime ?? input.match_date ?? input.commence_time);
  const line=normalizeLine(input.point_line ?? input.line);
  const closingLine=normalizeLine(input.clv_point_line ?? input.closing_point_line ?? input.point_line);
  const reasons=[];
  if(!(openingOdd>1)) reasons.push('INVALID_OPENING_ODD');
  if(!(closingOdd>1)) reasons.push('MISSING_CLOSING_ODD');
  if(!source) reasons.push('MISSING_SOURCE');
  if(!side) reasons.push('MISSING_SELECTION_SIDE');
  if(!eventFp) reasons.push('MISSING_EVENT_FINGERPRINT');
  if(!marketFp) reasons.push('MISSING_MARKET_FINGERPRINT');
  if(!bookmaker) reasons.push('MISSING_BOOKMAKER');
  if(!sourceEventId) reasons.push('MISSING_SOURCE_EVENT_ID');
  if(closingTs==null) reasons.push('MISSING_CLOSING_TIMESTAMP');
  if(openingTs!=null && closingTs!=null && closingTs<=openingTs) reasons.push('CLOSING_NOT_AFTER_OPENING');
  if(matchTs!=null && closingTs!=null && closingTs>matchTs) reasons.push('CLOSING_AFTER_MATCH_START');
  if(isTotals(input) && (line==null || closingLine==null || line!==closingLine)) reasons.push('TOTALS_LINE_MISMATCH');
  const conflict=Boolean(input.clv_conflict) || upper(input.clv_contract_status)==='CONFLICT';
  let status;
  if(conflict) status=CLV_STATES.CONFLICT;
  else if(!(closingOdd>1) && upper(input.clv_pending_reason||input.request_status)==='NOT_REQUESTED') status=CLV_STATES.NOT_REQUESTED;
  else if(!(closingOdd>1) && source) status=CLV_STATES.UNAVAILABLE;
  else if(!(closingOdd>1)) status=CLV_STATES.PENDING;
  else if(reasons.length===0) status=CLV_STATES.VERIFIED;
  else status=CLV_STATES.AVAILABLE_UNVERIFIED;
  return {
    version:TENNIS_CLV_CONTRACT_VERSION,status,verified:status===CLV_STATES.VERIFIED?1:0,
    closingLineAvailable:closingOdd>1?1:0,reasons,
    reason:reasons.join('|') || 'CONTRACT_OK', openingOdd,closingOdd,
    clvPct:calculateClvPct(openingOdd,closingOdd),source,side,eventFingerprint:eventFp,
    marketFingerprint:marketFp,bookmaker,sourceEventId,openingTs,closingTs,matchTs,line,closingLine
  };
}
function buildClvContractFields(input={}){
  const r=evaluateTennisClvContract(input);
  return {
    clv_contract_status:r.status, clv_contract_reason:r.reason,
    clv_contract_version:r.version, clv_opening_ts:r.openingTs,
    clv_closing_ts:r.closingTs, clv_bookmaker:r.bookmaker || null,
    clv_source_event_id:r.sourceEventId || null, clv_event_fingerprint:r.eventFingerprint || null,
    clv_market_fingerprint:r.marketFingerprint || null, clv_point_line:r.closingLine,
    clv_verified:r.verified, closing_line_available:r.closingLineAvailable
  };
}
module.exports={TENNIS_CLV_CONTRACT_VERSION,CLV_STATES,parseTs,calculateClvPct,evaluateTennisClvContract,buildClvContractFields,deriveBookmaker};
