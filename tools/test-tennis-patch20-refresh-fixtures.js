'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const refresh = require('../backend/tennisPlayerDataRefresh');

function assert(condition, message) { if (!condition) throw new Error(message); }
function csv(dates = ['20260701', '20260702']) {
  const header = 'tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_name,loser_name,score,best_of';
  return [header, ...dates.map((date, index) => `T${index},Test,Hard,A,${date},${index},Player A ${index},Player B ${index},6-4 6-4,3`)].join('\n') + '\n';
}
function sources() { return refresh.defaultSources(2026).map(source => ({ ...source, minRows: 1 })); }
function seed(dir) { fs.mkdirSync(dir, { recursive: true }); for (const source of sources()) fs.writeFileSync(path.join(dir, source.localFile), csv(['20260501','20260502'])); }
function fakeEvidence() {
  let currentDir = null;
  return {
    init(dataDir) {
      currentDir = dataDir;
      const rows = sources().map(source => refresh.inspectCsvFile(path.join(dataDir, source.localFile), source)).filter(Boolean);
      return { initialized: true, fileCount: rows.length, matchCount: rows.reduce((n,r)=>n+r.validRows,0), playerCount: rows.length*4, rejectedRows:0, duplicateRows:0, earliestMatchAt: rows.map(r=>r.earliestMatchAt).sort()[0], latestMatchAt: rows.map(r=>r.latestMatchAt).sort().slice(-1)[0] };
    },
    getStatus() {
      const rows = currentDir ? sources().map(source => refresh.inspectCsvFile(path.join(currentDir, source.localFile), source)).filter(Boolean) : [];
      return { initialized:true, matchCount:rows.reduce((n,r)=>n+r.validRows,0), playerCount:rows.length*4, latestMatchAt:rows.map(r=>r.latestMatchAt).sort().slice(-1)[0] || null };
    }
  };
}
function retryable404(sourceId) {
  const error = new Error(`PATCH20_HTTP_404:${sourceId}:404`);
  error.httpStatus = 404; error.sourceId = sourceId;
  error.patch20Network = { sourceId, httpStatus:404, retryable:true, responseHeaders:{} };
  return error;
}

async function run() {
  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, success:true }); }
    catch (error) { results.push({ name, success:false, error:error.message }); }
  }
  await test('ALLOWLIST_THREE_CANDIDATES_WITH_CONTENTS_API', async () => {
    const s=sources()[0]; const c=refresh.sourceUrlCandidates(s);
    assert(c.length===3,'candidates'); assert(c[1].includes('api.github.com/repos/'),'api fallback'); assert(refresh.assertAllowedSource(s)===true,'allowlist');
  });
  await test('GITHUB_CONTENTS_API_BASE64_DECODE', async () => {
    const expected=csv(); const body=JSON.stringify({encoding:'base64',content:Buffer.from(expected).toString('base64')});
    assert(refresh.decodeGitHubContentsApiResponse(body,{'content-type':'application/json'})===expected,'decode');
  });
  await test('RETRY_404_TO_ALTERNATE_PATH', async () => {
    const calls=[];
    const downloader=async(url,o)=>{ calls.push(o.candidateIndex); if(calls.length===1) throw retryable404(o.source.id); return {statusCode:200,text:csv(),headers:{},url}; };
    const result=await refresh.downloadSourceWithPolicy(sources()[0],{downloader,retryCustomDownloader:true,retryDelaysMs:[0,1],sleepFn:async()=>{}});
    assert(result.attempts.length===2,'attempts'); assert(calls.join(',')==='0,1','candidate sequence');
  });
  await test('RETRY_ORDER_REVISITS_CONTENTS_API', async () => {
    const calls=[]; const downloader=async(_url,o)=>{calls.push(o.candidateIndex);throw retryable404(o.source.id);};
    try { await refresh.downloadSourceWithPolicy(sources()[0],{downloader,retryCustomDownloader:true,retryDelaysMs:[0,1,2,3],sleepFn:async()=>{}}); } catch(_) {}
    assert(calls.join(',')==='0,1,2,1','retry order');
  });
  await test('RETRY_EXHAUSTION_DIAGNOSTICS', async () => {
    const downloader=async(_url,o)=>{ throw retryable404(o.source.id); };
    let error; try { await refresh.downloadSourceWithPolicy(sources()[0],{downloader,retryCustomDownloader:true,retryDelaysMs:[0,1,2],sleepFn:async()=>{}}); } catch(e){ error=e; }
    assert(error && error.patch20Attempts.length===3,'attempt diagnostics'); assert(error.patch20Network.sourceId==='ATP_MAIN','source id');
  });
  await test('PROBE_READ_ONLY_THREE_SOURCES', async () => {
    const downloader=async url=>({statusCode:200,text:csv(),headers:{},url});
    const report=await refresh.probePlayerDataSources({sources:sources(),downloader,retryCustomDownloader:true,retryDelaysMs:[0],sleepFn:async()=>{}});
    assert(report.success && report.sources.length===3,'probe'); assert(report.activationPerformed===false,'no activation');
  });
  await test('ATOMIC_SUCCESS_AND_FAILURE_FILE_CLEAR', async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p20-success-'));
    try {
      seed(dir); fs.writeFileSync(path.join(dir,refresh.FAILURE_FILE),JSON.stringify({lastAttemptAt:'2026-07-01T00:00:00Z'}));
      const downloader=async url=>({statusCode:200,text:csv(['20260701','20260702','20260703']),headers:{etag:'x'},url});
      const result=await refresh.refreshPlayerData({dataDir:dir,sources:sources(),downloader,playerEvidence:fakeEvidence(),now:new Date('2026-07-15T00:00:00Z'),operationId:'P20_FIX_SUCCESS'});
      assert(result.success,'success'); assert(!fs.existsSync(path.join(dir,refresh.FAILURE_FILE)),'failure cleared');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  await test('FAILURE_PRESERVES_LKG_BYTES', async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p20-fail-'));
    try {
      seed(dir); const before=fs.readFileSync(path.join(dir,sources()[0].localFile));
      const downloader=async(_url,o)=>{ throw retryable404(o.source.id); };
      try { await refresh.refreshPlayerData({dataDir:dir,sources:sources(),downloader,retryCustomDownloader:true,retryDelaysMs:[0,1],sleepFn:async()=>{},playerEvidence:fakeEvidence(),now:new Date('2026-07-15T00:00:00Z'),operationId:'P20_FIX_FAIL'}); } catch(_) {}
      assert(fs.readFileSync(path.join(dir,sources()[0].localFile)).equals(before),'bytes changed');
      const failure=JSON.parse(fs.readFileSync(path.join(dir,refresh.FAILURE_FILE),'utf8'));
      assert(failure.degradedUsingLastKnownGood===true,'not degraded lkg'); assert(failure.sourceId==='ATP_MAIN','source missing');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  await test('HEALTH_DEGRADED_NOT_CRITICAL', async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p20-health-'));
    try {
      seed(dir);
      fs.writeFileSync(path.join(dir,refresh.FAILURE_FILE),JSON.stringify({lastAttemptAt:'2026-07-15T00:00:00Z',status:'FAILED_USING_LAST_KNOWN_GOOD',sourceId:'ATP_MAIN',error:'PATCH20_HTTP_404',attempts:[{attempt:1,statusCode:404}],degradedUsingLastKnownGood:true},null,2));
      const health=refresh.getPlayerDataHealth({dataDir:dir,sources:sources(),playerEvidence:fakeEvidence(),now:new Date('2026-07-15T00:00:00Z')});
      assert(health.success===true,'critical'); assert(health.degradedUsingLastKnownGood===true,'degraded missing'); assert(health.refreshState==='PLAYER_DATA_REFRESH_DEGRADED_USING_LAST_KNOWN_GOOD','state');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  await test('NO_MODEL_GATE_STAKE_AUTHORITY', async () => {
    const dir=path.join(__dirname,'..','backend','sackmann_data');
    const health=refresh.getPlayerDataHealth({dataDir:dir,initialize:false});
    assert(health.probabilityWeightsChanged===false,'probability'); assert(health.qualityGateAuthority===false,'gate'); assert(health.stakeAuthority===false,'stake');
  });
  const passed=results.filter(r=>r.success).length;
  const report={success:passed===results.length,patch:'20',version:refresh.TENNIS_PLAYER_DATA_REFRESH_VERSION,tests:results.length,passed,results,generatedAt:new Date().toISOString()};
  console.log(JSON.stringify(report,null,2));
  if(!report.success) process.exit(2);
}
run().catch(error=>{console.error(error.stack||error.message);process.exit(2);});
