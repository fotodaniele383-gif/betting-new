'use strict';

const crypto = require('crypto');
const audit13 = require('./certifiedTradingOutcomeSearchAudit13');
const audit14 = require('./certifiedTradingOutcomeCoverageAudit14');

const VERSION = 'AUDIT15_CERTIFIED_MULTI_SOURCE_OUTCOME_FUSION_V1';
const POLICY_VERSION = 'AUDIT15_PRIMARY_OFFICIAL_SECONDARY_STRUCTURED_CONSENSUS_FAIL_CLOSED_V1';
const DEFAULT_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.AUDIT15_SOURCE_TIMEOUT_MS || 9000)));
const MAX_CACHE_MS = Math.max(30 * 1000, Math.min(30 * 60 * 1000, Number(process.env.AUDIT15_SOURCE_CACHE_MS || 5 * 60 * 1000)));
const memory = new Map();

const FOOTBALL_ESPN_LEAGUES = Object.freeze({
  E0: 'eng.1', SP1: 'esp.1', I1: 'ita.1', I2: 'ita.2', D1: 'ger.1', F1: 'fra.1'
});

function text(v) { return String(v == null ? '' : v).trim(); }
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  return v;
}
function sha256(v) { return crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(stable(v))).digest('hex'); }
function dateKey(v, now) {
  const d = audit13.parseEventInstant(v, now || new Date());
  return d ? d.toISOString().slice(0, 10) : '';
}
function ymd(v) { return String(v || '').replace(/-/g, ''); }
function plusDays(key, days) {
  const d = new Date(`${key}T12:00:00.000Z`); if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function normalizePlayer(v) {
  return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ').replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function playerLast(v) { const p = normalizePlayer(v).split(' ').filter(Boolean); return p[p.length - 1] || ''; }
function samePlayer(a, b) {
  const aa = normalizePlayer(a), bb = normalizePlayer(b); if (!aa || !bb) return false;
  if (aa === bb) return true;
  return Boolean(playerLast(aa) && playerLast(aa) === playerLast(bb) && aa[0] === bb[0]);
}
function canonicalTeam(v) { return audit14.canonicalTeam(v); }
function teamEq(a, b) { return canonicalTeam(a).replace(/\s+/g, '') === canonicalTeam(b).replace(/\s+/g, ''); }

async function fetchJson(url, options = {}) {
  if (options.allowNetwork !== true) return { ok:false, reason:'NETWORK_NOT_AUTHORIZED', url };
  if (typeof fetch !== 'function') return { ok:false, reason:'FETCH_UNAVAILABLE', url };
  const cached = memory.get(url);
  if (cached && Date.now() - cached.at <= MAX_CACHE_MS) return { ...cached.value, cacheHit:true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'accept':'application/json', 'user-agent':'BettingApp-AUDIT15/1.0' } });
    if (!res.ok) return { ok:false, reason:`HTTP_${res.status}`, url };
    const json = await res.json();
    const value = { ok:true, url, json, observedAt:new Date().toISOString() };
    memory.set(url, { at:Date.now(), value });
    return value;
  } catch (error) {
    return { ok:false, reason:error?.name === 'AbortError' ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR', error:text(error?.message), url };
  } finally { clearTimeout(timer); }
}

function completed(event) { return event?.status?.type?.completed === true || String(event?.status?.type?.state || '').toLowerCase() === 'post'; }
function competition(event) { return Array.isArray(event?.competitions) ? event.competitions[0] : null; }
function sideName(c) { return text(c?.team?.displayName || c?.team?.name || c?.athlete?.displayName || c?.athlete?.fullName || c?.displayName); }
function numericScore(c) { const n = Number(c?.score?.value ?? c?.score); return Number.isFinite(n) ? n : null; }

function parseEspnFootballPayload(payload, row = {}, options = {}) {
  const targetDate = dateKey(row.canonical_match_datetime || row.match_date, options.now);
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const hits = [];
  for (const event of events) {
    if (!completed(event)) continue;
    const comp = competition(event); if (!comp || !Array.isArray(comp.competitors)) continue;
    const home = comp.competitors.find(x => x.homeAway === 'home');
    const away = comp.competitors.find(x => x.homeAway === 'away');
    if (!home || !away) continue;
    const eventDate = text(event.date).slice(0,10);
    if (targetDate && eventDate && targetDate !== eventDate) continue;
    if (!teamEq(sideName(home), row.home_team) || !teamEq(sideName(away), row.away_team)) continue;
    const hg = numericScore(home), ag = numericScore(away); if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    hits.push({ event, homeName:sideName(home), awayName:sideName(away), homeGoals:hg, awayGoals:ag, eventDate });
  }
  if (hits.length !== 1) return { resolution:null, trace:{ status:hits.length ? 'AMBIGUOUS_STRUCTURED_SOURCE' : 'STRUCTURED_SOURCE_NO_MATCH', candidateCount:hits.length } };
  const h = hits[0];
  const rawEvidence = { version:VERSION, provider:'ESPN_SITE_API', eventId:text(h.event.id), eventDate:h.eventDate, home:h.homeName, away:h.awayName, homeGoals:h.homeGoals, awayGoals:h.awayGoals, status:text(h.event?.status?.type?.name || h.event?.status?.type?.detail || 'FINAL') };
  return { resolution:{ homeGoals:h.homeGoals, awayGoals:h.awayGoals, totalGoals:h.homeGoals+h.awayGoals, winnerSide:h.homeGoals>h.awayGoals?1:h.homeGoals<h.awayGoals?2:0, source:'ESPN_STRUCTURED_SOCCER_AUDIT15', sourceTier:'STRUCTURED_WEB', sourceEventId:`ESPN:${text(h.event.id)}`, observedAt:options.observedAt || new Date().toISOString(), providerCompleted:true, confidence:0.94, rawEvidence, evidenceHash:sha256(rawEvidence), matchMethod:'AUDIT15_ESPN_DATE_HOME_AWAY_CANONICAL' }, trace:{ status:'STRUCTURED_SOURCE_CERTIFIED_MATCH', candidateCount:1 } };
}

function lineScores(c) {
  const arr = Array.isArray(c?.linescores) ? c.linescores : [];
  return arr.map(x => Number(x?.value ?? x?.displayValue ?? x)).filter(Number.isFinite);
}
function setWins(a, b) { let n=0; for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i]>b[i]) n++; return n; }
function parseEspnTennisPayload(payload, row = {}, options = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const targetDate = dateKey(row.canonical_match_datetime || row.match_date, options.now);
  const hits=[];
  for (const event of events) {
    if (!completed(event)) continue;
    const comp=competition(event); if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) continue;
    const a=comp.competitors[0], b=comp.competitors[1], an=sideName(a), bn=sideName(b);
    const direct=samePlayer(an,row.home_team)&&samePlayer(bn,row.away_team), reverse=samePlayer(an,row.away_team)&&samePlayer(bn,row.home_team);
    if (!direct && !reverse) continue;
    const eventDate=text(event.date).slice(0,10);
    if (targetDate && eventDate) {
      const dd=Math.abs((new Date(`${eventDate}T00:00:00Z`)-new Date(`${targetDate}T00:00:00Z`))/86400000);
      if (dd>1) continue;
    }
    const p1=direct?a:b, p2=direct?b:a; const s1=lineScores(p1), s2=lineScores(p2);
    if (s1.length < 2 || s2.length < 2 || Math.min(s1.length,s2.length) < 2) continue;
    const count=Math.min(s1.length,s2.length); const p1s=s1.slice(0,count),p2s=s2.slice(0,count);
    const w1=setWins(p1s,p2s),w2=setWins(p2s,p1s); if (w1<2 && w2<2) continue;
    hits.push({ event,eventDate,p1Name:sideName(p1),p2Name:sideName(p2),p1s,p2s,winnerSide:w1>w2?1:2 });
  }
  if (hits.length !== 1) return { resolution:null, trace:{ status:hits.length ? 'AMBIGUOUS_STRUCTURED_SOURCE' : 'STRUCTURED_SOURCE_NO_MATCH', candidateCount:hits.length } };
  const h=hits[0], score=h.p1s.map((v,i)=>`${v}-${h.p2s[i]}`).join(' '), totalGames=h.p1s.reduce((n,v,i)=>n+v+h.p2s[i],0);
  const rawEvidence={ version:VERSION, provider:'ESPN_SITE_API', eventId:text(h.event.id), eventDate:h.eventDate, player1:h.p1Name, player2:h.p2Name, score, winnerSide:h.winnerSide, status:text(h.event?.status?.type?.name || h.event?.status?.type?.detail || 'FINAL') };
  return { resolution:{ winner:h.winnerSide, winnerSide:h.winnerSide, winnerName:h.winnerSide===1?row.home_team:row.away_team, winner_player_name:h.winnerSide===1?row.home_team:row.away_team, totalGames, score, scoreOrientation:'PLAYER1_PLAYER2', isVoid:false, source:'ESPN_STRUCTURED_TENNIS_AUDIT15', sourceTier:'STRUCTURED_WEB', sourceEventId:`ESPN:${text(h.event.id)}`, observedAt:options.observedAt || new Date().toISOString(), providerCompleted:true, confidence:0.93, rawEvidence, evidenceHash:sha256(rawEvidence), note:'AUDIT15: risultato strutturato ESPN, identita giocatori e score set-by-set verificati.' }, trace:{ status:'STRUCTURED_SOURCE_CERTIFIED_MATCH', candidateCount:1 } };
}

function footballLeagueSlug(row={}) { return FOOTBALL_ESPN_LEAGUES[audit13.getFootballDataLeagueCode(row)] || ''; }
function tennisTourSlug(row={}) {
  const hay=[row.league,row.tournament,row.tournament_name,row.tournament_catalog_id,row.canonical_tournament_key].map(text).join(' ').toLowerCase();
  if (/\bwta\b/.test(hay)) return 'wta'; if (/\batp\b/.test(hay)) return 'atp'; return '';
}

async function resolveFootballStructured(row={}, options={}) {
  const league=footballLeagueSlug(row), key=dateKey(row.canonical_match_datetime || row.match_date, options.now);
  if (!league) return { resolution:null, trace:{ status:'SECONDARY_LEAGUE_UNMAPPED' } };
  if (!key) return { resolution:null, trace:{ status:'SECONDARY_EVENT_TIME_UNKNOWN' } };
  const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd(key)}`;
  const fetched=await fetchJson(url, options); if (!fetched.ok) return { resolution:null, trace:{ status:fetched.reason, url } };
  const parsed=parseEspnFootballPayload(fetched.json,row,{...options,observedAt:fetched.observedAt}); return { ...parsed, trace:{...parsed.trace,url,provider:'ESPN_SITE_API',cacheHit:fetched.cacheHit===true} };
}
async function resolveTennisStructured(row={}, options={}) {
  const tour=tennisTourSlug(row), key=dateKey(row.canonical_match_datetime || row.match_date, options.now);
  if (!tour) return { resolution:null, trace:{ status:'SECONDARY_TOUR_UNMAPPED' } };
  if (!key) return { resolution:null, trace:{ status:'SECONDARY_EVENT_TIME_UNKNOWN' } };
  const from=ymd(plusDays(key,-1)),to=ymd(plusDays(key,1));
  const url=`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?dates=${from}-${to}`;
  const fetched=await fetchJson(url, options); if (!fetched.ok) return { resolution:null, trace:{ status:fetched.reason,url } };
  const parsed=parseEspnTennisPayload(fetched.json,row,{...options,observedAt:fetched.observedAt}); return { ...parsed, trace:{...parsed.trace,url,provider:'ESPN_SITE_API',cacheHit:fetched.cacheHit===true} };
}

function compareEvidence(primary, secondary) {
  if (!primary || !secondary) return { status:'INSUFFICIENT_FOR_CONSENSUS', agree:null };
  const pWinner=Number(primary.winnerSide ?? primary.winner), sWinner=Number(secondary.winnerSide ?? secondary.winner);
  const pScore=text(primary.score || (Number.isFinite(primary.homeGoals)&&Number.isFinite(primary.awayGoals)?`${primary.homeGoals}-${primary.awayGoals}`:''));
  const sScore=text(secondary.score || (Number.isFinite(secondary.homeGoals)&&Number.isFinite(secondary.awayGoals)?`${secondary.homeGoals}-${secondary.awayGoals}`:''));
  const winnerAgree=Number.isFinite(pWinner)&&Number.isFinite(sWinner)?pWinner===sWinner:true;
  const scoreAgree=pScore&&sScore?pScore===sScore:true;
  return { status:winnerAgree&&scoreAgree?'SOURCE_CONSENSUS':'SOURCE_CONFLICT', agree:winnerAgree&&scoreAgree, winnerAgree, scoreAgree, primarySource:text(primary.source), secondarySource:text(secondary.source) };
}

module.exports={ VERSION,POLICY_VERSION,FOOTBALL_ESPN_LEAGUES,footballLeagueSlug,tennisTourSlug,parseEspnFootballPayload,parseEspnTennisPayload,resolveFootballStructured,resolveTennisStructured,compareEvidence,_private:{fetchJson,dateKey,plusDays,teamEq,samePlayer,lineScores} };
