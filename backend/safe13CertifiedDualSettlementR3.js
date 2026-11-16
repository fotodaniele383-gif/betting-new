'use strict';
// SAFE13 R3: consensus certificate computation. ZERO DB mutations.
// Internal sources remain the original AUDIT13/14/15 and ATP/WTA resolvers.
const crypto=require('node:crypto');
const path=require('node:path');
function t(x){return String(x==null?'':x).trim()}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex')}
function isoDate(x){
  const v=t(x); if(!v)return null;
  let m,y,mo,d,suffix;
  // Strict, day-first formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
  // DD.MM.YYYY and compact DDMMYYYY. A missing year is never inferred.
  if((m=/^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/.exec(v))){
    y=Number(m[1]);mo=Number(m[2]);d=Number(m[3]);suffix=v.slice(m[0].length);
    if(suffix&&!/^(?:T|\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(suffix))return null;
  }else if((m=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?=$|,|\s)/.exec(v))){
    d=Number(m[1]);mo=Number(m[2]);y=Number(m[3]);suffix=v.slice(m[0].length);
    if(suffix&&!/^(?:,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?$/.test(suffix))return null;
  }else if((m=/^(\d{2})(\d{2})(\d{4})(?=$|\s)/.exec(v))){
    d=Number(m[1]);mo=Number(m[2]);y=Number(m[3]);suffix=v.slice(m[0].length);
    if(suffix&&!/^\s+\d{1,2}:\d{2}(?::\d{2})?$/.test(suffix))return null;
  }else{return null}
  const ms=Date.UTC(y,mo-1,d);
  if(y<2020||y>2100||!Number.isFinite(ms))return null;
  const z=new Date(ms);
  if(z.getUTCFullYear()!==y||z.getUTCMonth()+1!==mo||z.getUTCDate()!==d)return null;
  return z.toISOString().slice(0,10);
}
// Always wait at least 24h after the scheduled start. When the timezone is
// unknown, use 24h after the END of the match date (fail-closed).
function afterSafetyWindow(raw,date,now){
  const v=t(raw);
  const explicit=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v);
  const started=explicit?Date.parse(v):Date.parse(date+'T00:00:00Z');
  if(!Number.isFinite(started))return false;
  const safeAfter=started+(explicit?24:48)*3600000;
  return now.getTime()>=safeAfter;
}
function norm(x){return t(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function sport(x){const s=t(x).toUpperCase();return ['CALCIO','FOOTBALL','SOCCER'].includes(s)?'CALCIO':s==='TENNIS'?'TENNIS':''}
function evaluate(row,st,result){
  const code=t(row.prediction).toUpperCase().replace(/\s+/g,'');
  const market=[row.market_type,row.bet_type,row.market,row.calcio_market_key].map(x=>t(x).toUpperCase()).join(' ');
  if(st==='CALCIO'){
    // No 1/X/2 interpretation without an explicitly identified 1X2 market.
    if(!/\b(1X2|MATCH[_ -]?RESULT|FULL[_ -]?TIME[_ -]?RESULT)\b/.test(market)||!['1','X','2'].includes(code))return null;
    if(!Number.isInteger(result.homeGoals)||!Number.isInteger(result.awayGoals)||result.homeGoals<0||result.awayGoals<0)return null;
    const actual=result.homeGoals>result.awayGoals?'1':result.homeGoals<result.awayGoals?'2':'X';
    return {status:actual===code?'WON':'LOST',actual};
  }
  if(st==='TENNIS'){
    if(!/\b(MONEYLINE|MATCH[_ -]?WINNER|WINNER[_ -]?MATCH)\b/.test(market)||!['1','2'].includes(code))return null;
    if(![1,2].includes(result.winnerSide))return null;
    return {status:String(result.winnerSide)===code?'WON':'LOST',actual:String(result.winnerSide)};
  }
  return null;
}
function completeEvidence(e,st){
  if(!e||e.providerCompleted!==true||!t(e.source)||!t(e.sourceEventId)||!t(e.evidenceHash)||!e.rawEvidence)return false;
  if(!/^[a-f0-9]{64}$/i.test(t(e.evidenceHash)))return false;
  if(e.isVoid===true||e.requiresBookmakerRule===true||e.retired===true||e.walkover===true)return false;
  const bag=JSON.stringify(e.rawEvidence)+' '+t(e.note)+' '+t(e.score);
  if(/\b(RETIREMENT|RETIRED|WALKOVER|W\/O|ABANDONED|CANCELLED|SUSPENDED)\b/i.test(bag))return false;
  if(st==='CALCIO'){
    if(!Number.isInteger(e.homeGoals)||!Number.isInteger(e.awayGoals)||e.homeGoals<0||e.awayGoals<0)return false;
    const winner=e.homeGoals>e.awayGoals?1:e.homeGoals<e.awayGoals?2:0;
    if(e.winnerSide!==winner)return false;
  }else{
    if(![1,2].includes(Number(e.winnerSide??e.winner)))return false;
    if(!t(e.score)||e.totalGames==null||!Number.isFinite(Number(e.totalGames)))return false;
  }
  return true;
}
function canonicalTennisSets(e){
  const score=t(e.score);
  if(!['WINNER_FIRST','PLAYER1_PLAYER2'].includes(t(e.scoreOrientation)))return null;
  const all=[...score.matchAll(/(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s*\([^)]*\))?/g)];
  if(all.length<2||all.length>5)return null;
  let sets=all.map(m=>[Number(m[1]),Number(m[2])]);
  if(sets.some(p=>p[0]<0||p[1]<0||p[0]>7||p[1]>7||p[0]===p[1]))return null;
  const w=Number(e.winnerSide??e.winner);
  if(e.scoreOrientation==='WINNER_FIRST'&&w===2)sets=sets.map(([a,b])=>[b,a]);
  const w1=sets.filter(([a,b])=>a>b).length,w2=sets.filter(([a,b])=>b>a).length;
  const total=sets.reduce((n,[a,b])=>n+a+b,0);
  if((w===1&&w1<=w2)||(w===2&&w2<=w1)||total!==Number(e.totalGames))return null;
  return sets.map(([a,b])=>a+'-'+b).join(' ');
}
function consensus(row,primary,secondary,options={}){
  const st=sport(row.sport_type);
  if(!st)return {status:'BLOCKED_SPORT_UNKNOWN'};
  if(t(row.status).toUpperCase()!=='PENDING')return {status:'BLOCKED_NOT_PENDING'};
  if(!Number.isSafeInteger(Number(row.id))||Number(row.id)<1)return {status:'BLOCKED_ROW_ID'};
  if(!t(row.home_team)||!t(row.away_team)||norm(row.home_team)===norm(row.away_team))return {status:'BLOCKED_IDENTITY'};
  if(t(row.match_date)&&!isoDate(row.match_date))return {status:'BLOCKED_DATE_MISSING_YEAR_OR_INVALID'};
  const date=isoDate(row.match_date)||isoDate(row.canonical_match_datetime);
  if(!date)return {status:'BLOCKED_DATE_MISSING_YEAR_OR_INVALID'};
  const canonical=isoDate(row.canonical_match_datetime);
  if(canonical&&canonical!==date)return {status:'BLOCKED_DATE_CONFLICT'};
  const now=options.now?new Date(options.now):new Date();
  if(!Number.isFinite(now.getTime()))return {status:'BLOCKED_CLOCK'};
  if(!afterSafetyWindow(row.match_date||row.canonical_match_datetime,date,now))return {status:'BLOCKED_RECENT_OR_FUTURE'};
  if(!completeEvidence(primary,st)||!completeEvidence(secondary,st))return {status:'INSUFFICIENT_CERTIFIED_SOURCES'};
  const ps=t(primary.source).toUpperCase(),ss=t(secondary.source).toUpperCase();
  if(ps===ss||t(primary.sourceEventId)===t(secondary.sourceEventId))return {status:'BLOCKED_SOURCES_NOT_INDEPENDENT'};
  if(!(/FOOTBALL_DATA|ATP_OFFICIAL|WTA_OFFICIAL|PATCH34_R4/.test(ps))||!/ESPN_STRUCTURED/.test(ss))return {status:'BLOCKED_SOURCE_TIERS'};
  if(st==='CALCIO' && (!t(primary.rawEvidence.snapshotSha256)||!t(primary.rawEvidence.rowHash)))return {status:'BLOCKED_ARCHIVE_PROVENANCE'};
  if(st==='CALCIO'&&(primary.homeGoals!==secondary.homeGoals||primary.awayGoals!==secondary.awayGoals))return {status:'SOURCE_CONFLICT_SCORE'};
  if(st==='TENNIS'){
    if(Number(primary.winnerSide??primary.winner)!==Number(secondary.winnerSide??secondary.winner))return {status:'SOURCE_CONFLICT_WINNER'};
    // Different score formats are not sufficient to authorize an automatic settlement.
    const aScore=canonicalTennisSets(primary),bScore=canonicalTennisSets(secondary);
    if(!aScore||!bScore||aScore!==bScore)return {status:'SOURCE_CONFLICT_SCORE'};
    if(Number(primary.totalGames)!==Number(secondary.totalGames))return {status:'SOURCE_CONFLICT_GAMES'};
  }
  const result=st==='CALCIO'?{homeGoals:primary.homeGoals,awayGoals:primary.awayGoals,winnerSide:primary.winnerSide}:{winnerSide:Number(primary.winnerSide??primary.winner),score:t(primary.score),totalGames:Number(primary.totalGames)};
  const market=evaluate(row,st,result);
  if(!market)return {status:'MANUAL_REVIEW_UNSUPPORTED_MARKET'};
  const odds=Number(row.odd),stake=Number(row.stake);
  if(!Number.isFinite(stake)||stake<0||!Number.isFinite(odds)||odds<=1)return {status:'BLOCKED_INVALID_FINANCIAL_INPUT'};
  const identity={id:Number(row.id),sport:st,home:t(row.home_team),away:t(row.away_team),date,prediction:t(row.prediction),market_type:t(row.market_type),bet_type:t(row.bet_type),stake,odd:odds,status:'PENDING'};
  const identityHash=hash(identity);
  const profit=market.status==='WON'?Math.round(stake*(odds-1)*100)/100:Math.round(-stake*100)/100;
  const certificate={version:'SAFE13_DUAL_SETTLEMENT_R3',identity,identityHash,marketStatus:market.status,profit,result,source1:{name:t(primary.source),eventId:t(primary.sourceEventId),evidenceHash:t(primary.evidenceHash)},source2:{name:t(secondary.source),eventId:t(secondary.sourceEventId),evidenceHash:t(secondary.evidenceHash)}};
  return {status:'CERTIFIED_CANDIDATE_REVIEW',certificate:{...certificate,certificateHash:hash(certificate)}};
}
function loadProviders(backend){
  // Lazy imports: testing the certificate never requires the live app or its caches.
  const audit14=require(path.join(backend,'certifiedTradingOutcomeCoverageAudit14.js'));
  const audit15=require(path.join(backend,'certifiedOutcomeSourceFusionAudit15.js'));
  const tennis=require(path.join(backend,'tennisOfficialSettlementResolver.js'));
  return {
    async primary(row){return sport(row.sport_type)==='CALCIO'?(await audit14.resolveFootballCertified(row,{allowNetworkRefresh:true,cacheDir:path.join(backend,'data','calcio_football_data')})).resolution:await tennis.resolveOfficialSettlement(row,{allowNetwork:true})},
    async secondary(row){return sport(row.sport_type)==='CALCIO'?(await audit15.resolveFootballStructured(row,{allowNetwork:true})).resolution:(await audit15.resolveTennisStructured(row,{allowNetwork:true})).resolution}
  };
}
async function resolve(row,providers,options={}){
  const gate=consensus(row,null,null,options);
  if(!['INSUFFICIENT_CERTIFIED_SOURCES'].includes(gate.status))return gate;
  let a,b;
  try{a=await providers.primary(row)}catch(error){return {status:'PRIMARY_PROVIDER_ERROR',reason:t(error.message).slice(0,100)}}
  try{b=await providers.secondary(row)}catch(error){return {status:'SECONDARY_PROVIDER_ERROR',reason:t(error.message).slice(0,100)}}
  return consensus(row,a,b,options);
}
module.exports={isoDate,afterSafetyWindow,sport,evaluate,consensus,resolve,loadProviders,canonicalTennisSets,hash};