'use strict';

const fs = require('fs');
const path = require('path');
const enrichment = require('./calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2');

const AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION = 'AUDIT16D_R3_R3B_R2_R2_FREE_HISTORICAL_CALIBRATION_V1';
const AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION = 'AUDIT16D_R3_R3B_R2_R2_R1_PROVIDER_QUOTA_HEADER_SYNC_V1';
const HISTORICAL_SEASONS = Object.freeze([2022, 2023, 2024, 2025, 2026]);
const DEFAULT_MAX_NEW_STATS_PER_RUN = 72;
const DEFAULT_MAX_RUNTIME_MS = 12 * 60 * 1000;
const MIN_TEAM_HISTORY = 4;
const CALIBRATION_TARGET = 'POST_MATCH_GOALS_AS_VALIDATION_TARGET';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function round(v, d = 4) { const p = 10 ** d; return Math.round((Number(v) + Number.EPSILON) * p) / p; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function finite(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace('%','').trim());
  return Number.isFinite(n) ? n : fallback;
}
function safeJsonRead(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function safeJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  fs.renameSync(tmp, file);
}
function defaultCacheDir(projectRoot) { return enrichment._private.defaultCacheDir(projectRoot); }
function historicalRoot(cacheDir) { return path.join(cacheDir, 'historical_free_calibration'); }
function seasonDir(cacheDir, season) { return path.join(historicalRoot(cacheDir), String(Number(season))); }
function fixtureListFile(cacheDir, season) { return path.join(seasonDir(cacheDir, season), 'fixtures.json'); }
function statFile(cacheDir, season, fixtureId) { return path.join(seasonDir(cacheDir, season), 'stats', `${fixtureId}.json`); }
function backfillStatusFile(cacheDir) { return path.join(historicalRoot(cacheDir), 'backfill_status.json'); }
function calibrationReportFile(cacheDir) { return path.join(historicalRoot(cacheDir), 'shadow_calibration.json'); }

function sanitizeSeasons(seasons) {
  const allowed = new Set(HISTORICAL_SEASONS);
  return [...new Set((Array.isArray(seasons) ? seasons : HISTORICAL_SEASONS).map(Number).filter(x => allowed.has(x)))].sort((a,b)=>a-b);
}
function quotaSummary(q) {
  return {
    mode: q.mode,
    utcDay: q.utcDay,
    minuteUsed: q.minuteUsed,
    dayUsed: q.dayUsed,
    minuteRemaining: q.minuteRemaining,
    dayRemaining: q.dayRemaining,
    localMinuteRemaining: q.localMinuteRemaining,
    localDayRemaining: q.localDayRemaining,
    providerSyncActive: q.providerSyncActive,
    providerDailyLimit: q.providerDailyLimit,
    providerDailyRemaining: q.providerDailyRemaining,
    providerMinuteLimit: q.providerMinuteLimit,
    providerMinuteRemaining: q.providerMinuteRemaining,
    providerObservedAt: q.providerObservedAt,
    providerDailyReserve: q.providerDailyReserve,
    providerMinuteReserve: q.providerMinuteReserve
  };
}
function quotaWaitMs(cacheDir, now = new Date()) {
  const q = enrichment.quotaStatus(cacheDir, now);
  if (q.dayRemaining <= 0) return { stop: true, reason: 'DAILY_BUDGET_EXHAUSTED', waitMs: null, quota: q };
  if (q.canCall) return { stop: false, reason: null, waitMs: 0, quota: q };
  const ledger = q.ledger?.calls || [];
  const recent = ledger.filter(t => now.getTime() - Number(t) < 60000).sort((a,b)=>a-b);
  const first = recent[0];
  const waitMs = Number.isFinite(Number(first)) ? Math.max(250, Number(first) + 60250 - now.getTime()) : 1000;
  return { stop: false, reason: 'MINUTE_BUDGET_WAIT', waitMs, quota: q };
}
async function throttledApiCall({ url, apiKey, cacheDir, requestJson, deadlineMs, nowFn = () => new Date(), sleepFn = sleep }) {
  while (true) {
    const now = nowFn();
    const gate = quotaWaitMs(cacheDir, now);
    if (gate.stop) {
      const err = new Error(gate.reason);
      err.quota = gate.quota;
      throw err;
    }
    if (gate.waitMs > 0) {
      if (Date.now() + gate.waitMs > deadlineMs) {
        const err = new Error('BACKFILL_RUNTIME_BUDGET_REACHED');
        err.quota = gate.quota;
        throw err;
      }
      await sleepFn(gate.waitMs);
      continue;
    }
    return enrichment._private.apiCall({ url, apiKey, cacheDir, now, requestJson });
  }
}

function normalizeFixture(x) {
  return {
    id: Number(x?.fixture?.id),
    date: x?.fixture?.date || null,
    status: x?.fixture?.status?.short || null,
    home: x?.teams?.home?.name || null,
    away: x?.teams?.away?.name || null,
    homeGoals: finite(x?.goals?.home),
    awayGoals: finite(x?.goals?.away)
  };
}
async function getHistoricalFixtures({ season, apiKey, cacheDir, requestJson, deadlineMs, nowFn, sleepFn }) {
  const file = fixtureListFile(cacheDir, season);
  const cached = safeJsonRead(file);
  if (Array.isArray(cached?.fixtures) && cached.fixtures.length > 0) return { ...cached, cacheHit: true };
  const url = `${enrichment.API_HOST}/fixtures?league=${enrichment.SERIE_B_LEAGUE_ID}&season=${season}&status=FT-AET-PEN`;
  const r = await throttledApiCall({ url, apiKey, cacheDir, requestJson, deadlineMs, nowFn, sleepFn });
  const fixtures = (Array.isArray(r.json?.response) ? r.json.response : []).map(normalizeFixture)
    .filter(x => Number.isFinite(x.id) && x.home && x.away && Number.isFinite(x.homeGoals) && Number.isFinite(x.awayGoals));
  fixtures.sort((a,b)=>Date.parse(a.date || 0)-Date.parse(b.date || 0));
  const out = { season, leagueId: enrichment.SERIE_B_LEAGUE_ID, fixtures, cachedAt: nowFn().toISOString(), source: 'API_FOOTBALL_FREE_HISTORICAL' };
  safeJsonWrite(file, out);
  return { ...out, cacheHit: false };
}
async function getHistoricalStats({ season, fixture, apiKey, cacheDir, requestJson, deadlineMs, nowFn, sleepFn }) {
  const file = statFile(cacheDir, season, fixture.id);
  const cached = safeJsonRead(file);
  if (Array.isArray(cached?.response) && cached.response.length >= 2) return { ...cached, cacheHit: true };
  const url = `${enrichment.API_HOST}/fixtures/statistics?fixture=${fixture.id}`;
  const r = await throttledApiCall({ url, apiKey, cacheDir, requestJson, deadlineMs, nowFn, sleepFn });
  const response = Array.isArray(r.json?.response) ? r.json.response : [];
  const out = { fixtureId: fixture.id, season, response, cachedAt: nowFn().toISOString(), final: true, source: 'API_FOOTBALL_FREE_HISTORICAL' };
  safeJsonWrite(file, out);
  return { ...out, cacheHit: false };
}
function getCoverage(cacheDir, seasons = HISTORICAL_SEASONS) {
  const rows = [];
  for (const season of sanitizeSeasons(seasons)) {
    const fx = safeJsonRead(fixtureListFile(cacheDir, season), { fixtures: [] });
    const fixtures = Array.isArray(fx?.fixtures) ? fx.fixtures : [];
    let statsCached = 0;
    for (const f of fixtures) {
      const st = safeJsonRead(statFile(cacheDir, season, f.id));
      if (Array.isArray(st?.response) && st.response.length >= 2) statsCached++;
    }
    rows.push({ season, fixturesTotal: fixtures.length, statsCached, missingStats: Math.max(0, fixtures.length - statsCached), fixtureListCached: fixtures.length > 0 });
  }
  const totals = rows.reduce((a,r)=>({fixturesTotal:a.fixturesTotal+r.fixturesTotal,statsCached:a.statsCached+r.statsCached,missingStats:a.missingStats+r.missingStats}),{fixturesTotal:0,statsCached:0,missingStats:0});
  return { seasons: rows, totals, complete: totals.fixturesTotal > 0 && totals.missingStats === 0 };
}

async function backfillHistorical(options = {}) {
  const env = options.env || process.env;
  const key = enrichment.resolveApiKey(env);
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const cacheDir = path.resolve(options.cacheDir || defaultCacheDir(projectRoot));
  const seasons = sanitizeSeasons(options.seasons);
  const maxNewStats = Number.isFinite(Number(options.maxNewStatsPerRun)) ? Math.max(0, Math.min(72, Number(options.maxNewStatsPerRun))) : DEFAULT_MAX_NEW_STATS_PER_RUN;
  const maxRuntimeMs = Number.isFinite(Number(options.maxRuntimeMs)) ? Math.max(5000, Number(options.maxRuntimeMs)) : DEFAULT_MAX_RUNTIME_MS;
  const requestJson = options.requestJson || enrichment._private.defaultRequestJson;
  const nowFn = options.nowFn || (() => new Date());
  const sleepFn = options.sleepFn || sleep;
  fs.mkdirSync(historicalRoot(cacheDir), { recursive: true });

  if (!key.configured) return { success: false, status: 'NO_API_KEY', version: AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION, keyConfigured: false, coverage: getCoverage(cacheDir, seasons) };
  const startedAt = Date.now();
  const deadlineMs = startedAt + maxRuntimeMs;
  const beforeQuota = enrichment.quotaStatus(cacheDir, nowFn());
  const beforeDay = beforeQuota.dayUsed;
  const beforeUtcDay = beforeQuota.utcDay;
  const perSeason = [];
  let newStatsFetched = 0, cacheHits = 0, fixtureListCalls = 0;
  let stopReason = null;

  try {
    for (const season of seasons) {
      let fx;
      try {
        fx = await getHistoricalFixtures({ season, apiKey:key.value, cacheDir, requestJson, deadlineMs, nowFn, sleepFn });
        if (fx.cacheHit) cacheHits++; else fixtureListCalls++;
      } catch (err) {
        perSeason.push({ season, status:'FIXTURE_LIST_FAILED', error:String(err?.message || err), apiErrors:err?.apiErrors || null });
        continue;
      }
      let cachedCount = 0, fetchedThisSeason = 0;
      for (const fixture of fx.fixtures) {
        const cached = safeJsonRead(statFile(cacheDir, season, fixture.id));
        if (Array.isArray(cached?.response) && cached.response.length >= 2) { cachedCount++; continue; }
        if (newStatsFetched >= maxNewStats) { stopReason = 'RUN_STATS_LIMIT_REACHED'; break; }
        if (Date.now() >= deadlineMs) { stopReason = 'BACKFILL_RUNTIME_BUDGET_REACHED'; break; }
        try {
          const st = await getHistoricalStats({ season, fixture, apiKey:key.value, cacheDir, requestJson, deadlineMs, nowFn, sleepFn });
          if (st.cacheHit) { cacheHits++; cachedCount++; }
          else { newStatsFetched++; fetchedThisSeason++; }
        } catch (err) {
          if (['DAILY_BUDGET_EXHAUSTED','BACKFILL_RUNTIME_BUDGET_REACHED'].includes(String(err?.message))) { stopReason = String(err.message); break; }
          // Persist a lightweight error marker only in status, not fixture cache.
          perSeason.push({ season, fixtureId:fixture.id, status:'STAT_FETCH_ERROR', error:String(err?.message || err), apiErrors:err?.apiErrors || null });
        }
      }
      const coverage = getCoverage(cacheDir, [season]).seasons[0];
      perSeason.push({ season, status: coverage.missingStats === 0 && coverage.fixturesTotal > 0 ? 'COMPLETE' : 'PARTIAL', fetchedThisRun:fetchedThisSeason, ...coverage });
      if (stopReason) break;
    }
  } catch (err) {
    stopReason = stopReason || String(err?.message || err);
  }

  const after = enrichment.quotaStatus(cacheDir, nowFn());
  const coverage = getCoverage(cacheDir, seasons);
  const result = {
    success: true,
    version: AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION,
    mode: 'READ_WRITE_CACHE_ONLY_NO_PRODUCTION_MODEL_CHANGE',
    keyConfigured: true,
    keyEnvName: key.envName,
    tokenExposed: false,
    seasons,
    newStatsFetched,
    fixtureListCalls,
    cacheHits,
    quotaSyncRevision: AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION,
    apiCallsThisRun: after.utcDay === beforeUtcDay ? Math.max(0, after.dayUsed - beforeDay) : after.dayUsed,
    stopReason,
    coverage,
    localQuota: quotaSummary(after),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    liveModelChanged: false,
    perSeason
  };
  safeJsonWrite(backfillStatusFile(cacheDir), result);
  return result;
}

function matchBlocksToFixture(fixture, response) {
  const blocks = Array.isArray(response) ? response : [];
  const homeKey = enrichment.canonicalTeamName(fixture.home);
  const awayKey = enrichment.canonicalTeamName(fixture.away);
  let home = null, away = null;
  for (const block of blocks) {
    const key = enrichment.canonicalTeamName(block?.team?.name || '');
    if (key === homeKey) home = enrichment.statsObject(block);
    else if (key === awayKey) away = enrichment.statsObject(block);
  }
  if (!home || !away) {
    if (blocks.length >= 2) {
      home = home || enrichment.statsObject(blocks[0]);
      away = away || enrichment.statsObject(blocks[1]);
    }
  }
  return home && away ? { home, away } : null;
}
function loadHistoricalDataset(cacheDir, seasons = HISTORICAL_SEASONS) {
  const rows = [];
  const coverage = getCoverage(cacheDir, seasons);
  for (const s of coverage.seasons) {
    const fx = safeJsonRead(fixtureListFile(cacheDir, s.season), { fixtures: [] });
    for (const fixture of fx.fixtures || []) {
      const st = safeJsonRead(statFile(cacheDir, s.season, fixture.id));
      if (!Array.isArray(st?.response) || st.response.length < 2) continue;
      const sides = matchBlocksToFixture(fixture, st.response);
      if (!sides) continue;
      const req = [sides.home.totalShots,sides.home.shotsOnTarget,sides.away.totalShots,sides.away.shotsOnTarget];
      if (req.some(v => !Number.isFinite(Number(v)))) continue;
      rows.push({ ...fixture, season:s.season, homeStats:sides.home, awayStats:sides.away });
    }
  }
  rows.sort((a,b)=>(a.season-b.season)||(Date.parse(a.date||0)-Date.parse(b.date||0)));
  return { rows, coverage };
}
function compactScore(stats, a, b) {
  const total = Math.max(0, finite(stats?.totalShots,0));
  const sot = clamp(finite(stats?.shotsOnTarget,0),0,total);
  return clamp(a*sot + b*Math.max(0,total-sot),0.15,4.5);
}
function richScore(stats) {
  return enrichment.estimateEnrichedMatchXg(stats);
}
function stateKey(name) { return enrichment.canonicalTeamName(name); }
function ensureTeam(map, name) {
  const k = stateKey(name);
  if (!map.has(k)) map.set(k,{name,games:0,forSum:0,againstSum:0});
  return map.get(k);
}
function logFactorial(n) { let s=0; for(let i=2;i<=n;i++) s += Math.log(i); return s; }
function poissonNll(lambda, y) { const l=clamp(lambda,0.05,6); return l - y*Math.log(l) + logFactorial(Math.max(0,Math.round(y))); }
function evaluateRows(rows, scoreFn, priorMatches = 3, minHistory = MIN_TEAM_HISTORY) {
  const teams = new Map();
  let leagueSum=0, leagueGames=0;
  let count=0, abs=0, nll=0;
  const seasonSeen = new Set();
  for (const row of rows) {
    if (!seasonSeen.has(row.season)) {
      if (seasonSeen.size) { teams.clear(); leagueSum=0; leagueGames=0; }
      seasonSeen.add(row.season);
    }
    const h=ensureTeam(teams,row.home), a=ensureTeam(teams,row.away);
    const hs=scoreFn(row.homeStats), as=scoreFn(row.awayStats);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (h.games>=minHistory && a.games>=minHistory && leagueGames>0) {
      const mean=leagueSum/leagueGames;
      const hAtt=(h.forSum+priorMatches*mean)/(h.games+priorMatches);
      const hDef=(h.againstSum+priorMatches*mean)/(h.games+priorMatches);
      const aAtt=(a.forSum+priorMatches*mean)/(a.games+priorMatches);
      const aDef=(a.againstSum+priorMatches*mean)/(a.games+priorMatches);
      const lh=clamp((hAtt+aDef)/2,0.15,4.5), la=clamp((aAtt+hDef)/2,0.15,4.5);
      abs += Math.abs(lh-row.homeGoals)+Math.abs(la-row.awayGoals);
      nll += poissonNll(lh,row.homeGoals)+poissonNll(la,row.awayGoals);
      count += 2;
    }
    h.games++; h.forSum+=hs; h.againstSum+=as;
    a.games++; a.forSum+=as; a.againstSum+=hs;
    leagueSum += hs+as; leagueGames += 2;
  }
  return { observations:count, mae:count?abs/count:null, poissonNll:count?nll/count:null };
}
function candidateGrid() {
  const A=[0.22,0.26,0.30,0.34,0.38];
  const B=[0.015,0.025,0.035,0.045,0.055];
  const P=[3,5,8];
  const out=[]; for(const a of A) for(const b of B) for(const prior of P) out.push({a,b,prior});
  return out;
}
function pctImprovement(base, alt) {
  if (!Number.isFinite(base) || !Number.isFinite(alt) || base===0) return null;
  return round((base-alt)/base*100,3);
}
function runShadowCalibration(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const cacheDir = path.resolve(options.cacheDir || defaultCacheDir(projectRoot));
  const { rows, coverage } = loadHistoricalDataset(cacheDir, options.seasons || HISTORICAL_SEASONS);
  const trainRows = rows.filter(r => r.season===2022 || r.season===2023);
  const holdoutRows = rows.filter(r => r.season===2024);
  const baseCfg={a:0.30,b:0.03,prior:3};
  const baseTrain=evaluateRows(trainRows,s=>compactScore(s,baseCfg.a,baseCfg.b),baseCfg.prior);
  const baseHoldout=evaluateRows(holdoutRows,s=>compactScore(s,baseCfg.a,baseCfg.b),baseCfg.prior);
  let best=null;
  for(const c of candidateGrid()) {
    const m=evaluateRows(trainRows,s=>compactScore(s,c.a,c.b),c.prior);
    if (!Number.isFinite(m.poissonNll)) continue;
    if (!best || m.poissonNll<best.train.poissonNll) best={config:c,train:m};
  }
  const bestHoldout=best?evaluateRows(holdoutRows,s=>compactScore(s,best.config.a,best.config.b),best.config.prior):null;
  const richTrain=evaluateRows(trainRows,s=>richScore(s),3);
  const richHoldout=evaluateRows(holdoutRows,s=>richScore(s),3);
  const fullEnough = coverage.seasons.every(s=>s.fixturesTotal>=300 && s.missingStats===0) && holdoutRows.length>=300;
  const compactNllGain = bestHoldout ? pctImprovement(baseHoldout.poissonNll,bestHoldout.poissonNll) : null;
  const compactMaeGain = bestHoldout ? pctImprovement(baseHoldout.mae,bestHoldout.mae) : null;
  const richVsBestNllGain = bestHoldout ? pctImprovement(bestHoldout.poissonNll,richHoldout.poissonNll) : null;
  const promotionEligibleShadow = Boolean(fullEnough && bestHoldout?.observations>=400 && compactNllGain!==null && compactNllGain>=1.0 && bestHoldout.mae<=baseHoldout.mae);
  const paidDataPotential = Boolean(fullEnough && richHoldout?.observations>=400 && richVsBestNllGain!==null && richVsBestNllGain>=2.0);
  const report={
    success:true,
    version:AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION,
    mode:'SHADOW_ONLY_NO_LIVE_MODEL_CHANGE',
    calibrationTarget:CALIBRATION_TARGET,
    realXgGroundTruth:false,
    liveModelChanged:false,
    seasons:{train:[2022,2023],holdout:[2024]},
    coverage,
    usableFixtures:rows.length,
    baseline:{config:baseCfg,train:baseTrain,holdout:baseHoldout},
    compactCandidate:best?{config:best.config,train:best.train,holdout:bestHoldout,nllImprovementPct:compactNllGain,maeImprovementPct:compactMaeGain}:null,
    richHistoricalBenchmark:{train:richTrain,holdout:richHoldout,nllImprovementVsCompactCandidatePct:richVsBestNllGain},
    evidence:{fullEnough,promotionEligibleShadow,paidDataPotential},
    decision:'KEEP_LIVE_R1_UNCHANGED_PENDING_REVIEW',
    notes:[
      'Goals are used only as an out-of-sample validation target; this does not create REAL_XG labels.',
      'The compact candidate uses only shots and shots-on-target, which are available in the current 2026 Football-Data feed.',
      'The rich benchmark uses historical inside/outside-box and blocked-shot data only to measure the potential value of paid current-season data.',
      'No coefficient is promoted automatically to production.'
    ],
    generatedAt:new Date().toISOString()
  };
  safeJsonWrite(calibrationReportFile(cacheDir),report);
  return report;
}

function status(options={}) {
  const projectRoot=path.resolve(options.projectRoot || path.join(__dirname,'..'));
  const cacheDir=path.resolve(options.cacheDir || defaultCacheDir(projectRoot));
  return {
    success:true,
    version:AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION,
    quotaSyncRevision:AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION,
    coverage:getCoverage(cacheDir,options.seasons||HISTORICAL_SEASONS),
    currentSeasonCapability:enrichment.getCachedSeasonDenial(cacheDir,2026,new Date()),
    lastBackfill:safeJsonRead(backfillStatusFile(cacheDir)),
    lastCalibration:safeJsonRead(calibrationReportFile(cacheDir)),
    localQuota:(()=>quotaSummary(enrichment.quotaStatus(cacheDir,new Date())))(),
    liveModelChanged:false
  };
}

module.exports={
  AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION,
  AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION,
  HISTORICAL_SEASONS,
  DEFAULT_MAX_NEW_STATS_PER_RUN,
  CALIBRATION_TARGET,
  backfillHistorical,
  runShadowCalibration,
  getCoverage,
  loadHistoricalDataset,
  status,
  _private:{historicalRoot,seasonDir,fixtureListFile,statFile,throttledApiCall,getHistoricalFixtures,getHistoricalStats,compactScore,richScore,evaluateRows,candidateGrid,matchBlocksToFixture,safeJsonRead,safeJsonWrite}
};
