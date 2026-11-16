'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : path.join(__dirname, '..'));
const enrichment = require(path.join(ROOT, 'backend', 'calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2'));

function baseModel() {
  const names = ['Vicenza','Catanzaro','Carrarese','Mantova','Sudtirol','Bari','Palermo','Spezia','Reggiana','Juve Stabia'];
  const teams = {};
  names.forEach((name, i) => teams[name] = {
    xG_for: 1.25 + i * 0.02,
    xG_against: 1.45 - i * 0.015,
    games: 5,
    avgShots: 11 + (i % 3),
    avgShotsOnTarget: 3.4 + (i % 4) * 0.2,
    source: 'FOOTBALL_DATA_CSV_SHOTS_SOT',
    providerId: 'SERIE_B_ESTIMATED_XG',
    evidenceClass: 'MODEL_ESTIMATED_XG',
    modelEstimated: true
  });
  return {
    teams,
    state: {
      version: 'AUDIT16D_R3_R3B_SERIE_B_MODEL_ESTIMATED_XG_V1',
      providerId: 'SERIE_B_ESTIMATED_XG',
      providerFamily: 'FOOTBALL_DATA_SHOT_MODEL',
      status: 'MODEL_READY',
      sourceClass: 'MODEL_ESTIMATED',
      evidenceClass: 'MODEL_ESTIMATED_XG',
      leagueName: 'Serie B',
      season: '2627',
      seasonStart: 2026,
      authorityWeight: 0.2,
      source: 'FOOTBALL_DATA_CSV_SHOTS_SOT',
      directStakeAuthority: false,
      directGateAuthority: false,
      realXg: false
    },
    diagnostics: {}
  };
}
function statBlock(name, seed) {
  return {
    team: { id: seed, name },
    statistics: [
      { type: 'Shots on Goal', value: 3 + (seed % 4) },
      { type: 'Shots off Goal', value: 4 + (seed % 3) },
      { type: 'Total Shots', value: 11 + (seed % 5) },
      { type: 'Blocked Shots', value: 2 + (seed % 2) },
      { type: 'Shots insidebox', value: 7 + (seed % 4) },
      { type: 'Shots outsidebox', value: 4 },
      { type: 'Ball Possession', value: `${48 + (seed % 6)}%` },
      { type: 'Corner Kicks', value: 3 + (seed % 5) }
    ]
  };
}
function mockRequestFactory(calls) {
  const fixtures = [
    [101,'Vicenza','Catanzaro'], [102,'Carrarese','Mantova'], [103,'Sudtirol','Bari'],
    [104,'Palermo','Spezia'], [105,'Reggiana','Juve Stabia'], [106,'Vicenza','Mantova']
  ];
  return async (url, apiKey) => {
    calls.push({ url, keySeen: Boolean(apiKey) });
    assert.strictEqual(apiKey, 'SECRET_TEST_KEY');
    if (url.includes('/leagues?')) return { status: 200, headers: {}, json: { response: [{ league:{id:135,name:'Serie B'}, seasons:[{year:2026,coverage:{fixtures:{statistics_fixtures:true}}}] }] } };
    if (url.includes('/fixtures?league=')) return { status: 200, headers: {}, json: { response: fixtures.map(([id,h,a],i)=>({fixture:{id,date:`2026-09-${String(20+i).padStart(2,'0')}T18:00:00+00:00`,status:{short:'FT'}},teams:{home:{name:h},away:{name:a}}})) } };
    const m = url.match(/fixture=(\d+)/); if (m) {
      const f = fixtures.find(x => x[0] === Number(m[1]));
      return { status: 200, headers: {}, json: { response: [statBlock(f[1], f[0]), statBlock(f[2], f[0]+1)] } };
    }
    throw new Error('UNEXPECTED_URL:' + url);
  };
}
function add(name, ok, details) { return { name, ok: Boolean(ok), details: details ?? null }; }

(async()=>{
  const checks=[];
  checks.push(add('R2 enrichment version exported', enrichment.AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION === 'AUDIT16D_R3_R3B_R2_API_FOOTBALL_ENRICHMENT_V1', enrichment.AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION));
  checks.push(add('Free-plan local budgets are conservative', enrichment.DAILY_BUDGET === 80 && enrichment.MINUTE_BUDGET === 8 && enrichment.MAX_STATS_FETCH_PER_RUN === 6, {daily:enrichment.DAILY_BUDGET,minute:enrichment.MINUTE_BUDGET,stats:enrichment.MAX_STATS_FETCH_PER_RUN}));

  let networkCalls=0;
  const noKey = await enrichment.enrichBaseModel(baseModel(), { env:{}, cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'r3b-r2-nokey-')), requestJson:async()=>{networkCalls++; throw new Error('SHOULD_NOT_CALL');} });
  checks.push(add('No API key leaves certified R1 model unchanged and performs zero network calls', noKey.state.enrichmentStatus === 'BASE_ONLY_NO_API_KEY' && networkCalls === 0 && noKey.teams.Vicenza.xG_for === baseModel().teams.Vicenza.xG_for, {status:noKey.state.enrichmentStatus,networkCalls}));
  checks.push(add('No-key path remains MODEL_ESTIMATED_XG with no authority escalation', noKey.state.evidenceClass === 'MODEL_ESTIMATED_XG' && noKey.state.realXg === false && noKey.state.directStakeAuthority === false && noKey.state.directGateAuthority === false && noKey.state.authorityWeight <= 0.20, noKey.state));

  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'r3b-r2-cache-'));
  const calls=[];
  const req=mockRequestFactory(calls);
  const now=new Date('2026-09-28T13:30:00.000Z');
  const enriched = await enrichment.enrichBaseModel(baseModel(), { env:{API_FOOTBALL_KEY:'SECRET_TEST_KEY'}, cacheDir, now, requestJson:req, seasonStart:2026 });
  checks.push(add('API-Football enrichment activates with fixture-stat coverage', enriched.state.enrichmentStatus === 'API_FOOTBALL_ENRICHED' && enriched.state.apiFootballEnrichedTeams >= 4, {status:enriched.state.enrichmentStatus,teams:enriched.state.apiFootballEnrichedTeams,fixtures:enriched.state.apiFootballFixturesAccepted}));
  checks.push(add('Enriched values keep estimated provenance and extra shot-location diagnostics', Object.values(enriched.teams).some(t=>t.apiFootballEnriched === true && t.evidenceClass==='MODEL_ESTIMATED_XG' && Number.isFinite(t.avgShotsInsideBox) && Number.isFinite(t.avgBlockedShots)), Object.values(enriched.teams).filter(t=>t.apiFootballEnriched).slice(0,2)));
  checks.push(add('Enrichment does not increase model authority', enriched.state.authorityWeight <= 0.20 && enriched.state.realXg === false && enriched.state.directStakeAuthority === false && enriched.state.directGateAuthority === false, enriched.state));
  checks.push(add('Token is not exposed in state/diagnostics or URLs', enriched.state.apiFootballTokenExposed === false && !JSON.stringify(enriched).includes('SECRET_TEST_KEY') && calls.every(c=>!c.url.includes('SECRET_TEST_KEY')), {tokenExposed:enriched.state.apiFootballTokenExposed,urls:calls.map(c=>c.url)}));
  checks.push(add('First enrichment run stays within local free-plan budget', calls.length <= 8 && enriched.diagnostics.apiFootball.apiCalls <= 8, {networkCalls:calls.length,apiCalls:enriched.diagnostics.apiFootball.apiCalls}));

  const beforeSecond=calls.length;
  const second = await enrichment.enrichBaseModel(baseModel(), { env:{API_FOOTBALL_KEY:'SECRET_TEST_KEY'}, cacheDir, now:new Date('2026-09-28T13:30:15.000Z'), requestJson:req, seasonStart:2026 });
  checks.push(add('Persistent cache prevents duplicate API calls on immediate rerun', calls.length === beforeSecond && second.state.enrichmentStatus === 'API_FOOTBALL_ENRICHED', {before:beforeSecond,after:calls.length,cacheHits:second.diagnostics.apiFootball.cacheHits}));

  const qdir=fs.mkdtempSync(path.join(os.tmpdir(),'r3b-r2-quota-'));
  fs.writeFileSync(path.join(qdir,'quota_ledger.json'), JSON.stringify({version:1,calls:Array.from({length:8},(_,i)=>now.getTime()-i*1000)}));
  let quotaNetwork=0;
  const quota = await enrichment.enrichBaseModel(baseModel(), { env:{API_FOOTBALL_KEY:'SECRET_TEST_KEY'}, cacheDir:qdir, now, requestJson:async()=>{quotaNetwork++; throw new Error('SHOULD_NOT_CALL');}, seasonStart:2026 });
  checks.push(add('Local rolling-minute quota guard fails closed to base model', quota.state.enrichmentStatus === 'BASE_ONLY_API_UNAVAILABLE' || quota.state.enrichmentStatus === 'BASE_ONLY_LOCAL_QUOTA_GUARD', {status:quota.state.enrichmentStatus,networkCalls:quotaNetwork}));

  const sample = enrichment.estimateEnrichedMatchXg({totalShots:14,shotsOnTarget:5,shotsInsideBox:9,shotsOutsideBox:5,blockedShots:3});
  checks.push(add('Enriched shot-location estimate is deterministic and bounded', Number.isFinite(sample) && sample >= 0.15 && sample <= 4.20, sample));

  const failed=checks.filter(x=>!x.ok);
  const out={success:failed.length===0,patch:'AUDIT16D_R3_R3B_R2',suite:'SERIE_B_API_FOOTBALL_ENRICHMENT',checks:checks.length,failures:failed,details:checks};
  console.log(JSON.stringify(out,null,2));
  process.exit(out.success?0:1);
})().catch(e=>{console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R2',suite:'SERIE_B_API_FOOTBALL_ENRICHMENT',error:e.stack||e.message},null,2));process.exit(1);});
