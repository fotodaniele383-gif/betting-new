'use strict';

const crypto = require('crypto');

const VERSION = 'TENNIS_CLV_SPORT_KEY_DISCOVERY_V1_PATCH35';
const CATALOG_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.TENNIS_CLV_SPORT_CATALOG_TTL_MS || 30 * 60 * 1000));
const MIN_MATCH_SCORE = 45;
const MAX_KEYS_PER_BET = 2;

let cache = null;
let inflight = null;

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function normalize(value) {
  return text(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

const STOP = new Set(['atp','wta','tennis','open','masters','master','1000','500','250','grand','slam','the','national','bank','presented','by','rogers','men','women','singles','qualifying','main','draw','tour']);
const SYNONYMS = Object.freeze({
  montreal: ['montreal','canada','canadian','national bank'],
  toronto: ['toronto','canada','canadian','national bank'],
  washington: ['washington','dc','mubadala citi'],
  cincinnati: ['cincinnati','mason'],
  indian: ['indian wells'],
  miami: ['miami'],
  rome: ['rome','roma','italian'],
  madrid: ['madrid'],
  paris: ['paris','roland garros','french'],
  london: ['wimbledon','london'],
  new: ['us open','new york'],
  australian: ['australian','melbourne']
});

function tokens(value) {
  const out = normalize(value).split(' ').filter(Boolean).filter(t => !STOP.has(t) && t.length > 1);
  const expanded = new Set(out);
  for (const token of out) {
    const list = SYNONYMS[token];
    if (list) list.flatMap(v => normalize(v).split(' ')).forEach(v => { if (v && !STOP.has(v)) expanded.add(v); });
  }
  return [...expanded];
}

function inferTour(bet = {}) {
  const joined = upper([bet.league, bet.tournament, bet.tournament_name, bet.strategy_tag, bet.sport_type, bet.bet_type].filter(Boolean).join(' '));
  if (joined.includes('WTA')) return 'WTA';
  if (joined.includes('ATP')) return 'ATP';
  return 'UNKNOWN';
}

function tournamentText(bet = {}) {
  return [bet.tournament, bet.tournament_name, bet.league, bet.series, bet.competition].filter(Boolean).join(' ');
}

function normalizeCatalog(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .filter(s => upper(s?.group) === 'TENNIS' && text(s?.key))
    .map(s => ({
      key: text(s.key),
      title: text(s.title),
      group: text(s.group),
      active: s.active !== false,
      hasOutrights: s.has_outrights === true,
      keyNorm: normalize(s.key),
      titleNorm: normalize(s.title)
    }));
}

function errorInfo(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const providerCode = upper(error?.response?.data?.error_code || error?.providerCode || error?.code || '');
  const message = text(error?.response?.data?.message || error?.message || error);
  let category = 'PROVIDER_ERROR';
  if (status === 404 || providerCode.includes('UNKNOWN_SPORT') || providerCode.includes('INVALID_SPORT')) category = 'INVALID_SPORT_KEY';
  else if (status === 401 || status === 403) category = 'AUTHENTICATION_ERROR';
  else if (status === 429) category = 'RATE_LIMIT';
  else if (/TIMEOUT|ETIMEDOUT|ECONNABORTED/i.test(`${providerCode} ${message}`)) category = 'TIMEOUT';
  else if (/NETWORK|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test(`${providerCode} ${message}`)) category = 'NETWORK_ERROR';
  return { status, providerCode: providerCode || null, category, message: message.slice(0, 500) };
}

async function getActiveTennisCatalog(fetchOddsApiFunc, options = {}) {
  const now = Number(options.nowMs || Date.now());
  if (!options.forceRefresh && cache && cache.expiresAt > now && cache.sports.length) {
    return { ...cache, cacheHit: true, status: 'OK_CACHE' };
  }
  if (inflight) return inflight;
  if (typeof fetchOddsApiFunc !== 'function') {
    return cache?.sports?.length
      ? { ...cache, cacheHit: true, status: 'DEGRADED_LAST_KNOWN_GOOD', error: 'FETCH_FUNCTION_UNAVAILABLE' }
      : { version: VERSION, status: 'UNAVAILABLE', sports: [], cacheHit: false, error: 'FETCH_FUNCTION_UNAVAILABLE' };
  }
  inflight = (async () => {
    try {
      const raw = await fetchOddsApiFunc(
        'https://api.the-odds-api.com/v4/sports/?apiKey=API_KEY_PLACEHOLDER',
        { source: 'tennisClvSportKeyDiscoveryPatch35.js', route: 'getActiveTennisCatalog', step: VERSION, timeoutMs: 25000 }
      );
      const sports = normalizeCatalog(raw);
      if (!sports.length) throw Object.assign(new Error('ACTIVE_TENNIS_CATALOG_EMPTY_OR_INVALID'), { code: 'CATALOG_EMPTY' });
      const fetchedAt = new Date(now).toISOString();
      cache = { version: VERSION, status: 'OK_LIVE', sports, fetchedAt, expiresAt: now + CATALOG_TTL_MS, fingerprint: sha(sports.map(s => [s.key, s.title, s.active])) };
      return { ...cache, cacheHit: false };
    } catch (error) {
      const info = errorInfo(error);
      if (cache?.sports?.length) return { ...cache, cacheHit: true, status: 'DEGRADED_LAST_KNOWN_GOOD', error: info };
      return { version: VERSION, status: 'UNAVAILABLE', sports: [], cacheHit: false, error: info };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function scoreSport(bet, sport, inferredKey = '') {
  const tour = inferTour(bet);
  const key = upper(sport.key);
  const title = upper(sport.title);
  let score = 0;
  const reasons = [];
  if (inferredKey && text(inferredKey) === sport.key) { score += 100; reasons.push('EXACT_INFERRED_KEY'); }
  if (tour === 'ATP' && (key.includes('ATP') || title.includes('ATP'))) { score += 35; reasons.push('TOUR_ATP'); }
  if (tour === 'WTA' && (key.includes('WTA') || title.includes('WTA'))) { score += 35; reasons.push('TOUR_WTA'); }
  if (tour !== 'UNKNOWN' && ((tour === 'ATP' && (key.includes('WTA') || title.includes('WTA'))) || (tour === 'WTA' && (key.includes('ATP') || title.includes('ATP'))))) score -= 90;
  const wanted = tokens(tournamentText(bet));
  const hay = new Set(tokens(`${sport.key} ${sport.title}`));
  let overlaps = 0;
  for (const t of wanted) if (hay.has(t)) overlaps += 1;
  score += Math.min(50, overlaps * 16);
  if (overlaps) reasons.push(`TOKEN_OVERLAP_${overlaps}`);
  if (sport.active) score += 3;
  return { sport, score, reasons, wantedTokens: wanted };
}

function resolveBetSportKeys(bet = {}, catalog = [], inferredKey = '') {
  const active = (Array.isArray(catalog) ? catalog : []).filter(s => s.active !== false);
  const exact = active.find(s => s.key === inferredKey);
  if (exact) return { version: VERSION, status: 'VALIDATED_IN_ACTIVE_CATALOG', requestedKey: inferredKey, resolvedKeys: [exact.key], matches: [{ key: exact.key, score: 100, reasons: ['EXACT_INFERRED_KEY'] }] };
  const scored = active.map(s => scoreSport(bet, s, inferredKey)).filter(x => x.score >= MIN_MATCH_SCORE).sort((a,b) => b.score - a.score || a.sport.key.localeCompare(b.sport.key));
  if (!scored.length) return { version: VERSION, status: inferredKey ? 'INVALID_KEY_NO_ACTIVE_REPLACEMENT' : 'NO_ACTIVE_MATCH', requestedKey: inferredKey || null, resolvedKeys: [], matches: [] };
  const best = scored[0].score;
  const selected = scored.filter(x => x.score >= Math.max(MIN_MATCH_SCORE, best - 12)).slice(0, MAX_KEYS_PER_BET);
  return { version: VERSION, status: inferredKey ? 'INVALID_KEY_REPLACED_FROM_CATALOG' : 'RESOLVED_FROM_ACTIVE_CATALOG', requestedKey: inferredKey || null, resolvedKeys: selected.map(x => x.sport.key), matches: selected.map(x => ({ key:x.sport.key, title:x.sport.title, score:x.score, reasons:x.reasons })) };
}

function resolvePlanAgainstCatalog(plan = {}, bets = [], catalogResult = {}) {
  const byId = new Map((Array.isArray(bets) ? bets : []).map(b => [Number(b.id), b]));
  const activeKeys = new Set((catalogResult.sports || []).filter(s => s.active !== false).map(s => s.key));
  const groups = new Map();
  const blocked = [...(plan.blocked || [])];
  const decisions = [];
  for (const call of plan.calls || []) {
    for (const betId of call.betIds || []) {
      const bet = byId.get(Number(betId));
      if (!bet) continue;
      const isTennis = inferTour(bet) !== 'UNKNOWN' || upper([bet.sport_type,bet.bet_type,bet.strategy_tag].join(' ')).includes('TENNIS');
      const resolution = !isTennis
        ? { version:VERSION,status:'NON_TENNIS_PRESERVED',requestedKey:call.sportKey,resolvedKeys:[call.sportKey],matches:[{key:call.sportKey,score:100,reasons:['NON_TENNIS_PRESERVED']}] }
        : activeKeys.has(call.sportKey)
          ? { version:VERSION,status:'VALIDATED_IN_ACTIVE_CATALOG',requestedKey:call.sportKey,resolvedKeys:[call.sportKey],matches:[{key:call.sportKey,score:100,reasons:['PLAN_KEY_ACTIVE']}] }
          : resolveBetSportKeys(bet, catalogResult.sports || [], call.sportKey);
      decisions.push({ betId:Number(betId), match:`${text(bet.home_team)} - ${text(bet.away_team)}`, ...resolution });
      if (!resolution.resolvedKeys.length) {
        blocked.push({ id:Number(betId), reason:resolution.status, requestedSportKey:call.sportKey, priority:'CLV_PROVIDER_DISCOVERY' });
        continue;
      }
      for (const key of resolution.resolvedKeys) {
        const groupKey = `${key}|${call.markets || 'h2h'}`;
        if (!groups.has(groupKey)) groups.set(groupKey,{ sportKey:key, markets:call.markets || 'h2h', betIds:[], candidateCount:0, highestPriority:call.highestPriority || 0, source:'PATCH35_ACTIVE_CATALOG_DISCOVERY' });
        const g=groups.get(groupKey); if(!g.betIds.includes(Number(betId)))g.betIds.push(Number(betId)); g.candidateCount=g.betIds.length; g.highestPriority=Math.max(g.highestPriority,call.highestPriority||0);
      }
    }
  }
  const maxCalls = Math.max(0, Number(plan.maxApiCallsPerRun || 0));
  const allCalls = [...groups.values()].sort((a,b)=>b.highestPriority-a.highestPriority||b.candidateCount-a.candidateCount||a.sportKey.localeCompare(b.sportKey));
  const calls = allCalls.slice(0,maxCalls);
  allCalls.slice(maxCalls).forEach(c=>c.betIds.forEach(id=>blocked.push({id,reason:'CLV_API_MAX_CALLS_PER_RUN_EXCEEDED_AFTER_DISCOVERY',requestedSportKey:c.sportKey})));
  return { ...plan, calls, plannedApiCalls:calls.length, blocked, blockedCandidates:blocked, sportKeyDiscovery:{ version:VERSION, catalogStatus:catalogResult.status, catalogCacheHit:catalogResult.cacheHit===true, catalogSports:(catalogResult.sports||[]).length, catalogFingerprint:catalogResult.fingerprint||null, decisions, invalidRequestedKeys:decisions.filter(d=>d.status==='INVALID_KEY_REPLACED_FROM_CATALOG'||d.status==='INVALID_KEY_NO_ACTIVE_REPLACEMENT').length, unresolved:decisions.filter(d=>!d.resolvedKeys?.length).length } };
}

function resetCacheForTests(){ cache=null; inflight=null; }
function health(){ return { version:VERSION, catalogTtlMs:CATALOG_TTL_MS, minMatchScore:MIN_MATCH_SCORE, maxKeysPerBet:MAX_KEYS_PER_BET, cached:Boolean(cache?.sports?.length), cacheExpiresAt:cache?.expiresAt||null, cacheFingerprint:cache?.fingerprint||null, authority:'CLV_PROVIDER_ROUTING_ONLY', validatesAgainstActiveCatalog:true, singleFlight:true, providerErrorsDistinctFromValidEmpty:true, modelAuthority:false, stakeAuthority:false }; }

module.exports = { VERSION, CATALOG_TTL_MS, errorInfo, normalizeCatalog, getActiveTennisCatalog, resolveBetSportKeys, resolvePlanAgainstCatalog, inferTour, health, resetCacheForTests };
