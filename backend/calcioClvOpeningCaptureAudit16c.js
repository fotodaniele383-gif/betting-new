'use strict';
const crypto = require('crypto');
const VERSION = 'AUDIT16C_CALCIO_CLV_OPENING_CAPTURE_V1';
function text(v){return String(v==null?'':v).trim();}
function num(v){if(v==null||text(v)==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function parseTs(v){if(v==null||v==='')return null;if(typeof v==='number'&&Number.isFinite(v))return v<1e12?v*1000:v;const n=Number(v);if(Number.isFinite(n)&&text(v)!=='')return n<1e12?n*1000:n;const d=new Date(v);return Number.isFinite(d.getTime())?d.getTime():null;}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function marketLine(row={}){const direct=num(row.point_line??row.clv_point_line);if(direct!=null)return direct;const m=/([OU])\s*(\d+(?:\.\d+)?)/i.exec(text(row.prediction));return m?Number(m[2]):null;}
function eventIdentity(row={}){return text(row.calcio_event_key||row.event_key||row.eventKey||row.match_exposure_key)||[text(row.league),text(row.home_team||row.home),text(row.away_team||row.away),text(row.match_date||row.commence_time)].join('|');}
function marketIdentity(row={},eventFp=''){return sha({event:eventFp,prediction:text(row.prediction).toUpperCase(),market:text(row.market_type).toUpperCase(),line:marketLine(row)});}
function buildOpeningEvidenceFields(row={},options={}){
  const existing=options.existing||{};const certification=row.oddsCertification||row.odds_certification||row.extData?.oddsCertification||row.extData?.odds_certification||{};const selected=certification.selectedSource||{};
  const prediction=text(row.prediction);const existingPrediction=text(existing.prediction);const sameMarket=prediction&&existingPrediction&&prediction.toUpperCase()===existingPrediction.toUpperCase();
  const eventFp=sha({sport:'CALCIO',identity:eventIdentity(row),league:text(row.league),home:text(row.home_team||row.home),away:text(row.away_team||row.away),kickoff:text(row.match_date||row.commence_time)});
  const marketFp=marketIdentity(row,eventFp);const existingOpening=num(existing.opening_odd);const preserve=Boolean(sameMarket&&existingOpening>1&&text(existing.clv_market_fingerprint));
  const openingOdd=preserve?existingOpening:num(row.odd);const matchTs=parseTs(row.match_date||row.commence_time||existing.match_date);let openingTs=preserve?parseTs(existing.clv_opening_ts):parseTs(selected.lastUpdate||row.odds_source_timestamp);
  const now=parseTs(options.now)||Date.now();if(openingTs==null&&matchTs!=null&&now<matchTs)openingTs=now;
  const bookmaker=preserve?text(existing.clv_bookmaker):text(selected.bookmakerTitle||selected.bookmakerKey||row.odds_source_title||row.odds_source||row.calcio_odds_bookmaker_title||row.calcio_odds_bookmaker_key);
  const sourceEventId=preserve?text(existing.clv_source_event_id):text(selected.providerEventId||row.provider_event_id||row.calcio_provider_event_id||existing.calcio_provider_event_id);
  const sportKey=text(options.sportKey||row.clv_sport_key_resolved||row.clv_cross_sport_sport_key||existing.clv_sport_key_resolved);
  const reasons=[];if(!(openingOdd>1))reasons.push('INVALID_OPENING_ODD');if(openingTs==null)reasons.push('MISSING_OPENING_TIMESTAMP');if(!bookmaker)reasons.push('MISSING_BOOKMAKER');if(!sourceEventId)reasons.push('MISSING_SOURCE_EVENT_ID');if(!sportKey)reasons.push('MISSING_SPORT_KEY');if(matchTs!=null&&openingTs!=null&&openingTs>=matchTs)reasons.push('OPENING_NOT_PREMATCH');
  return {opening_odd:openingOdd,clv_opening_ts:openingTs,clv_bookmaker:bookmaker||null,clv_source_event_id:sourceEventId||null,clv_event_fingerprint:eventFp,clv_market_fingerprint:marketFp,clv_point_line:marketLine(row),clv_sport_key_resolved:sportKey||null,clv_sport_key_requested:sportKey||null,clv_sport_key_discovery_version:VERSION,clv_sport_key_discovery_status:sportKey?'RESOLVED_AT_OPENING_CAPTURE':'UNRESOLVED_AT_OPENING_CAPTURE',clv_contract_status:'PENDING',clv_contract_reason:reasons.length?`OPENING_EVIDENCE_PARTIAL:${reasons.join('|')}`:'OPENING_EVIDENCE_CAPTURED_WAITING_CLOSING',clv_verified:0,closing_line_available:0,clv_last_attempt_result:'AUDIT16C_OPENING_CAPTURED',clv_pending_reason:'WAITING_CLOSING_WINDOW'};
}
module.exports={VERSION,parseTs,eventIdentity,marketIdentity,buildOpeningEvidenceFields};
