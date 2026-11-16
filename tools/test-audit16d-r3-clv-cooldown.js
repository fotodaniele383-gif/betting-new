#!/usr/bin/env node
'use strict';
const path=require('path'),Module=require('module');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const checks=[];const add=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
const oldLoad=Module._load;
try{
  Module._load=function(request,parent,isMain){if(request==='axios')return{};return oldLoad.apply(this,arguments)};
  const m=require(path.join(ROOT,'backend','clvTracker'));
  const now=new Date('2026-09-25T12:00:00Z');
  add('R3 CLV version exported',m.AUDIT16D_R3_CLV_RUNTIME_VERSION==='AUDIT16D_R3_CLV_POST_MATCH_COOLDOWN_AND_LOG_SAMPLING_V1');
  const future=now.getTime()+3600000;
  const past=now.getTime()-3600000;
  const base={id:1,match_date:'2026-09-24T12:00:00Z',clv_last_attempt_result:'CLV_VAULT_NO_SNAPSHOT'};
  add('Post-match no-snapshot cooldown active',m.isAudit16dR3PostMatchCooldownActive({...base,clv_next_retry_ts:future},now)===true);
  add('Post-match retry becomes eligible after cooldown',m.isAudit16dR3PostMatchCooldownActive({...base,clv_next_retry_ts:past},now)===false);
  const filtered=m.filterBetsEligibleForClv([
    {...base,id:1,clv_next_retry_ts:future},
    {...base,id:2,clv_next_retry_ts:past}
  ],now);
  add('Eligible filter removes only active cooldown',filtered.length===1&&filtered[0].id===2,filtered.map(x=>x.id));
  const live={...base,id:3,match_date:'2026-09-25T11:30:00Z',clv_next_retry_ts:future};
  add('True closing window never blocked by post-match cooldown',m.filterBetsEligibleForClv([live],now).length===1);
  let updateSql='',updateArgs=[];
  const db={prepare(sql){if(sql.startsWith('PRAGMA'))return{all:()=>[]};updateSql=sql;return{run:(...args)=>{updateArgs=args;return{changes:1}}}}};
  const marked=m.markAudit16dR3PostMatchVaultCooldown(db,{id:77},'CLV_VAULT_NO_SNAPSHOT',now);
  add('Cooldown metadata update succeeds',marked===true);
  add('Cooldown does not increment API attempts',!updateSql.includes('clv_attempt_count'));
  const nextRetry=Number(updateArgs[3]);
  add('Default no-snapshot cooldown is 24h',Math.round((nextRetry-now.getTime())/3600000)===m.AUDIT16D_R3_POST_MATCH_NO_SNAPSHOT_COOLDOWN_HOURS,{hours:(nextRetry-now.getTime())/3600000});
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
finally{Module._load=oldLoad;}
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'CLV_COOLDOWN',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);
