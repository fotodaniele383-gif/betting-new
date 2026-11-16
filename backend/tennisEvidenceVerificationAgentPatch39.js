'use strict';

const crypto = require('crypto');

const VERSION = 'TENNIS_EVIDENCE_VERIFICATION_AGENT_V1_PATCH39';
const CLAIM_SCHEMA_VERSION = 'TENNIS_EVIDENCE_CLAIM_V1_PATCH39';
const CONFLICT_SCHEMA_VERSION = 'TENNIS_EVIDENCE_CONFLICT_V1_PATCH39';

function sha(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function text(value){return String(value==null?'':value).trim();}
function upper(value){return text(value).toUpperCase();}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function normalize(value=''){return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function hasEventIdentity(row={}) {
  const players=Boolean(text(row.tennis_player1_identity||row.home_team)&&text(row.tennis_player2_identity||row.away_team));
  const event=Boolean(text(row.tennis_event_fingerprint)||text(row.tennis_canonical_match_key)||text(row.provider_event_id));
  const time=Boolean(text(row.canonical_event_time_safety_utc)||text(row.canonical_match_datetime)||text(row.match_date));
  const tournament=Boolean(text(row.tournament_catalog_id)||text(row.canonical_tournament_key)||text(row.tournament_canonical_name)||text(row.tournament_name));
  const identityStatus=upper(row.tennis_event_identity_status);
  const statusOk=!identityStatus||['VERIFIED','CERTIFIED','READY','EXACT','CANONICAL'].some(token=>identityStatus.includes(token));
  return {certified:players&&event&&time&&tournament&&statusOk,players,event,time,tournament,status:identityStatus||null};
}
function sourceAuthority(source={}) {
  const status=upper(source.status);
  const verified=source.verified===true||status.includes('VERIFIED')||status==='FORECAST_RESOLVED'||status==='NOT_APPLICABLE_INDOOR';
  const parserConfidence=finite(source.parserConfidence);
  return {verified,parserConfidence,authoritative:verified&&(parserConfidence===null||parserConfidence>=0.8)};
}
function claim(claimType,value,options={}) {
  const status=options.status||'ABSTAIN';
  return {
    schemaVersion:CLAIM_SCHEMA_VERSION,
    claimType,
    value:value===undefined?null:value,
    status,
    reason:options.reason||null,
    sourceId:options.sourceId||null,
    sourceTier:options.sourceTier||null,
    retrievedAt:options.retrievedAt||null,
    asOf:options.asOf||null,
    parserVersion:options.parserVersion||null,
    parserConfidence:finite(options.parserConfidence),
    confidence:finite(options.confidence),
    authority:options.authority||'NO_AUTHORITY',
    factClass:options.factClass||'FACT',
    sourceUrlHash:options.sourceUrl?sha(options.sourceUrl):null,
    payloadHash:options.payloadHash||null
  };
}
function verify(row={}, intelligence={}, receipt=null) {
  const identity=hasEventIdentity(row);
  const claims=[];
  const conflicts=[];
  const rankings=intelligence.officialRankings||{};
  const rankingPlayers=Array.isArray(rankings.players)?rankings.players:[];
  for(const player of rankingPlayers){
    const authority=sourceAuthority(player);
    if(!identity.certified){claims.push(claim('PLAYER_RANK',null,{status:'ABSTAIN',reason:'AMBIGUOUS_EVENT_IDENTITY',sourceId:rankings.sourceId,sourceTier:rankings.sourceTier,authority:'DISPLAY_ONLY'}));continue;}
    if(!authority.authoritative||finite(player.rank)===null){claims.push(claim('PLAYER_RANK',null,{status:'ABSTAIN',reason:'OFFICIAL_RANKING_NOT_VERIFIED',sourceId:rankings.sourceId,sourceTier:rankings.sourceTier,retrievedAt:rankings.fetchedAt,parserConfidence:player.parserConfidence,authority:'DISPLAY_ONLY'}));continue;}
    claims.push(claim('PLAYER_RANK',{playerName:player.name,rank:Number(player.rank)},{status:'VERIFIED',sourceId:rankings.sourceId,sourceTier:rankings.sourceTier,retrievedAt:rankings.fetchedAt,parserConfidence:player.parserConfidence,confidence:player.parserConfidence,authority:'DISPLAY_AND_RISK_ONLY'}));
  }
  const weather=intelligence.weather||{};
  const weatherResolved=['FORECAST_RESOLVED','NOT_APPLICABLE_INDOOR'].includes(upper(weather.status));
  const venueStatus=upper(weather.venue?.status||'');
  if(!identity.certified){claims.push(claim('MATCH_WEATHER',null,{status:'ABSTAIN',reason:'AMBIGUOUS_EVENT_IDENTITY',sourceId:weather.sourceId,authority:'NO_AUTHORITY'}));}
  else if(!weatherResolved||['VENUE_UNRESOLVED','AMBIGUOUS_VENUE',''].includes(venueStatus)){claims.push(claim('MATCH_WEATHER',null,{status:'ABSTAIN',reason:venueStatus||upper(weather.status)||'WEATHER_UNAVAILABLE',sourceId:weather.sourceId,retrievedAt:weather.fetchedAt,authority:'NO_AUTHORITY'}));}
  else{claims.push(claim('MATCH_WEATHER',{venueId:weather.venue?.id||null,status:weather.status,risk:weather.risk||null},{status:'VERIFIED',sourceId:weather.sourceId,retrievedAt:weather.fetchedAt,confidence:0.95,authority:'RISK_ONLY'}));}
  const h2h=intelligence.h2h||{};
  if(identity.certified&&['READY','INSUFFICIENT_SAMPLE','NO_MEETINGS'].includes(upper(h2h.status))){claims.push(claim('HEAD_TO_HEAD',{status:h2h.status,sample:h2h.overall?.matches||0},{status:'VERIFIED_LOCAL',sourceId:'LOCAL_STRUCTURED_H2H',asOf:h2h.asOf||null,confidence:1,authority:'BOUNDED_MODEL_CONTEXT'}));}
  else{claims.push(claim('HEAD_TO_HEAD',null,{status:'ABSTAIN',reason:identity.certified?'H2H_UNAVAILABLE':'AMBIGUOUS_EVENT_IDENTITY',sourceId:'LOCAL_STRUCTURED_H2H',authority:'NO_AUTHORITY'}));}
  const receiptLinked=Boolean(receipt&&receipt.receipt_id&&Number(receipt.bet_id||0)===Number(row.id||0));
  claims.push(claim('EXTERNAL_RECEIPT_LINK',receiptLinked?receipt.receipt_id:null,{status:receiptLinked?'VERIFIED':'ABSTAIN',reason:receiptLinked?null:'RECEIPT_NOT_LINKED_TO_BET',sourceId:'TENNIS_EXTERNAL_INTELLIGENCE_RECEIPT',retrievedAt:receipt?.generated_at||null,confidence:receiptLinked?1:0,authority:'AUDIT_ONLY'}));
  const verifiedClaims=claims.filter(c=>String(c.status).startsWith('VERIFIED')).length;
  const abstentions=claims.filter(c=>c.status==='ABSTAIN').length;
  const result={
    version:VERSION,
    generatedAt:new Date().toISOString(),
    betId:Number(row.id||0)||null,
    eventIdentity:identity,
    status:!identity.certified?'ABSTAIN_EVENT_IDENTITY':abstentions?'PARTIAL_WITH_ABSTENTIONS':'VERIFIED_MULTI_SOURCE',
    claims,
    conflicts,
    metrics:{totalClaims:claims.length,verifiedClaims,abstentions,unsupportedClaims:0,falseClaimsAllowed:0},
    policy:{noSourceNoClaim:true,conflictNoAuthority:true,ambiguousEventAbstain:true,unparsedPageUnavailable:true,llmInferenceExplanationOnly:true},
    probabilityAuthority:false,
    stakeAuthority:false,
    settlementAuthority:false,
    automaticPredictionAuthority:false
  };
  result.reportHash=sha({...result,generatedAt:null});
  return result;
}
function createSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS tennis_evidence_agent_claims(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 claim_id TEXT NOT NULL UNIQUE,
 bet_id INTEGER,
 generated_at TEXT NOT NULL,
 version TEXT NOT NULL,
 claim_type TEXT NOT NULL,
 claim_status TEXT NOT NULL,
 source_id TEXT,
 authority TEXT NOT NULL,
 event_identity_certified INTEGER NOT NULL DEFAULT 0,
 payload_json TEXT NOT NULL,
 previous_hash TEXT,
 claim_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_tennis_evidence_claim_bet ON tennis_evidence_agent_claims(bet_id,generated_at);
CREATE TABLE IF NOT EXISTS tennis_evidence_conflicts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 conflict_id TEXT NOT NULL UNIQUE,
 bet_id INTEGER,
 generated_at TEXT NOT NULL,
 version TEXT NOT NULL,
 conflict_type TEXT NOT NULL,
 status TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 conflict_hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS trg_tennis_evidence_claims_no_update BEFORE UPDATE ON tennis_evidence_agent_claims BEGIN SELECT RAISE(ABORT,'TENNIS_EVIDENCE_AGENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_evidence_claims_no_delete BEFORE DELETE ON tennis_evidence_agent_claims BEGIN SELECT RAISE(ABORT,'TENNIS_EVIDENCE_AGENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_evidence_conflicts_no_update BEFORE UPDATE ON tennis_evidence_conflicts BEGIN SELECT RAISE(ABORT,'TENNIS_EVIDENCE_CONFLICT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_evidence_conflicts_no_delete BEFORE DELETE ON tennis_evidence_conflicts BEGIN SELECT RAISE(ABORT,'TENNIS_EVIDENCE_CONFLICT_APPEND_ONLY'); END;
`);}
function persist(db,row,report){
  if(!db||!report)return{claims:[],conflicts:[]};
  createSchema(db);
  let previous=db.prepare('SELECT claim_hash FROM tennis_evidence_agent_claims WHERE bet_id=? ORDER BY id DESC LIMIT 1').get(Number(row.id||0))?.claim_hash||null;
  const saved=[];
  for(const item of report.claims||[]){
    const identity={betId:Number(row.id||0)||null,eventFingerprint:row.tennis_event_fingerprint||null,claim:item};
    const deterministic=sha(identity);
    const id=`TEAC39_${Number(row.id||0)}_${deterministic.slice(0,16)}`;
    let existing=db.prepare('SELECT * FROM tennis_evidence_agent_claims WHERE claim_id=?').get(id);
    if(!existing){
      const canonical={...identity,previousHash:previous};
      const hash=sha(canonical);
      db.prepare('INSERT INTO tennis_evidence_agent_claims(claim_id,bet_id,generated_at,version,claim_type,claim_status,source_id,authority,event_identity_certified,payload_json,previous_hash,claim_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,Number(row.id||0)||null,report.generatedAt,VERSION,item.claimType,item.status,item.sourceId,item.authority,report.eventIdentity?.certified?1:0,JSON.stringify(canonical),previous,hash);
      existing=db.prepare('SELECT * FROM tennis_evidence_agent_claims WHERE claim_id=?').get(id);
    }
    saved.push(existing);previous=existing.claim_hash;
  }
  const conflicts=[];
  for(const item of report.conflicts||[]){
    const hash=sha({betId:Number(row.id||0),item}),id=`TECF39_${Number(row.id||0)}_${hash.slice(0,16)}`;
    let existing=db.prepare('SELECT * FROM tennis_evidence_conflicts WHERE conflict_id=?').get(id);
    if(!existing){db.prepare('INSERT INTO tennis_evidence_conflicts(conflict_id,bet_id,generated_at,version,conflict_type,status,payload_json,conflict_hash) VALUES(?,?,?,?,?,?,?,?)').run(id,Number(row.id||0)||null,report.generatedAt,CONFLICT_SCHEMA_VERSION,item.type||'SOURCE_CONFLICT',item.status||'OPEN',JSON.stringify(item),hash);existing=db.prepare('SELECT * FROM tennis_evidence_conflicts WHERE conflict_id=?').get(id);}
    conflicts.push(existing);
  }
  return{claims:saved,conflicts};
}
function health(db){createSchema(db);return{version:VERSION,claimRows:Number(db.prepare('SELECT COUNT(*) n FROM tennis_evidence_agent_claims').get().n),conflictRows:Number(db.prepare('SELECT COUNT(*) n FROM tennis_evidence_conflicts').get().n),policy:{noSourceNoClaim:true,ambiguousEventAbstain:true,unsupportedClaimsAllowed:0},predictionAuthority:false,stakeAuthority:false,settlementAuthority:false};}
module.exports={VERSION,CLAIM_SCHEMA_VERSION,CONFLICT_SCHEMA_VERSION,normalize,hasEventIdentity,sourceAuthority,claim,verify,createSchema,persist,health};
