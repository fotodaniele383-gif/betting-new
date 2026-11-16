#!/usr/bin/env node
'use strict';
const mod=require('../backend/quantv2OpenSources');
const only=process.argv.slice(2);
const sources=only.length?only:['openfootball_seriea','openfootball_seriea_previous','openfootball_epl','openfootball_epl_previous','statsbomb_competitions'];
(async()=>{
 const rows=[];
 for(const id of sources){try{const r=await mod.sync(id);rows.push({id,status:'PASS',rows:r.recordCount,sha256:r.sha256});}
 catch(e){rows.push({id,status:'FAIL',error:e.message});}}
 process.stdout.write(JSON.stringify({version:mod.VERSION,results:rows},null,2)+'\n');
 process.exitCode=rows.some(x=>x.status==='FAIL')?2:0;
})();
