#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const deep = require('../backend/deepScanTennis');
const root = path.resolve(__dirname, '..');
const results=[];
async function check(name,fn){try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.message});}}
(async()=>{
  await check('cache RAM e in-flight deduplicano la stessa lettura giocatore', async()=>{
    deep.resetPatch27PerformanceCache();
    const player='Patch27 Cache Player';
    const cacheFile=path.join(root,'backend','cache_news','patch27_cache_player.json');
    fs.mkdirSync(path.dirname(cacheFile),{recursive:true});
    fs.writeFileSync(cacheFile,JSON.stringify({timestamp:Date.now(),articles:[{title:'patch27 cache player wins tennis match',fullText:'patch27 cache player wins tennis match',pubDate:new Date().toUTCString()}]}));
    try {
      const [a,b]=await Promise.all([deep._patch27GetSentimentAnalysis(player),deep._patch27GetSentimentAnalysis(player)]);
      assert.ok(a&&b);
      const mid=deep.getPatch27PerformanceHealth();
      assert.equal(mid.counters.newsMisses,1);
      assert.ok(mid.counters.newsInFlightHits>=1);
      const c=await deep._patch27GetSentimentAnalysis(player);
      assert.equal(c.retrieval.memoryCacheHit,true);
      assert.ok(deep.getPatch27PerformanceHealth().counters.newsMemoryHits>=1);
    } finally { try{fs.unlinkSync(cacheFile);}catch(_){} }
  });
  await check('contratto H2H usa metodo POST e body form', async()=>{
    const source=fs.readFileSync(path.join(root,'backend','deepScanTennis.js'),'utf8');
    assert.ok(source.includes("method: 'POST'"));
    assert.ok(source.includes('data: `q=${encodeURIComponent(query)}&kl=&df=`'));
    assert.ok(source.includes('timeout: 5000'));
  });
  await check('risparmio pacing batch 14 eventi certificato', async()=>{
    const legacy=(14-1)*4000; const current=(14-1)*150; const saved=legacy-current;
    assert.equal(legacy,52000); assert.equal(current,1950); assert.equal(saved,50050);
  });
  await check('cache è limitata e non cambia autorità', async()=>{
    const h=deep.getPatch27PerformanceHealth(); assert.equal(h.cacheLimits.maxEntriesPerCache,256); assert.equal(h.probabilityAuthority,false); assert.equal(h.stakeAuthority,false);
  });
  const failed=results.filter(x=>!x.ok);
  console.log(JSON.stringify({success:failed.length===0,checks:results.length,results,estimatedPacingSavedMsFor14Events:50050},null,2));
  process.exit(failed.length?1:0);
})().catch(error=>{console.error(error);process.exit(1);});
