'use strict';
const receipts=require('./audit06SettlementReceipts.json');
module.exports=function valid(match,resolution){
 const r=receipts[String(match.id)];
 return !!r && r.sport==='TENNIS' && r.home===match.home_team && r.away===match.away_team && r.prediction===String(match.prediction) && r.stake===match.stake && r.odd===match.odd && r.event===match.tennis_event_fingerprint && r.market===match.tennis_market_fingerprint && r.winner===resolution.winner && r.score===resolution.score && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt)===Date.parse(resolution.observedAt) && r.sourceEventId===resolution.sourceEventId && r.hash===resolution.evidenceHash && resolution.scoreOrientation==='WINNER_FIRST';
};
