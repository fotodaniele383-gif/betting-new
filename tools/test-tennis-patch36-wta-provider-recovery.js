#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const multi=require('../backend/tennisMultiProviderData');const refresh=require('../backend/tennisPlayerDataRefresh');
const checks=[];function c(name,fn){try{const result=fn();checks.push({name,ok:true});return result;}catch(e){checks.push({name,ok:false,error:e.message});return null;}}
async function ca(name,fn){try{const result=await fn();checks.push({name,ok:true});return result;}catch(e){checks.push({name,ok:false,error:e.message});return null;}}
function csv(rows=520,lastDay=210){
  const headers=multi.CANONICAL_HEADERS;
  const out=[headers.join(',')];
  for(let i=0;i<rows;i++){
    const d=new Date(Date.UTC(2026,0,1+Math.min(lastDay,i%lastDay)));
    const date=`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
    const row=Object.fromEntries(headers.map(h=>[h,'']));
    Object.assign(row,{tourney_id:`WTA_${i}`,tourney_name:`Event ${i}`,surface:'Hard',draw_size:'32',tourney_level:'A',tourney_date:date,match_num:String(i+1),winner_id:String(1000+i),winner_name:`Winner ${i}`,winner_hand:'R',winner_ioc:'ITA',winner_age:'25',loser_id:String(2000+i),loser_name:`Loser ${i}`,loser_hand:'R',loser_ioc:'USA',loser_age:'24',score:'6-4 6-3',best_of:'3',round:'R32',winner_rank:'20',winner_rank_points:'1000',loser_rank:'40',loser_rank_points:'700'});
    out.push(headers.map(h=>String(row[h]??'')).join(','));
  }
  return out.join('\n')+'\n';
}
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch36-wta-'));try{
 const plan=multi.providerPlan({year:2026});
 c('GitHub provider enabled for WTA',()=>{const p=plan.providers.find(x=>x.id==='JEFF_SACKMANN_GITHUB');assert(p&&p.enabled&&p.supports.includes('WTA_MAIN')&&!p.apiKeyRequired);});
 c('provider no longer retired',()=>assert.equal(plan.retiredProviders.length,0));
 c('strategy zero-key before paid API',()=>assert(plan.strategy.includes('GITHUB_THEN_OPTIONAL')));
 let calls=0;const text=csv();
 const candidate=await ca('valid WTA GitHub fixture downloads',()=>multi.githubWtaCandidate({id:'WTA_MAIN',localFile:'wta_matches_2026.csv',minRows:500},{dataDir:tmp,year:2026,now:'2026-08-03T00:00:00Z',downloader:async()=>{calls++;return {statusCode:200,text,headers:{etag:'"abc"','last-modified':'Sun, 02 Aug 2026 00:00:00 GMT'},transport:'FIXTURE'};}}));
 c('single zero-key network call',()=>assert.equal(calls,1));
 c('candidate source identified',()=>assert.equal(candidate.providerId,'JEFF_SACKMANN_GITHUB'));
 c('candidate schema valid',()=>assert(refresh.inspectCsvText(candidate.text,{id:'WTA_MAIN',localFile:'wta_matches_2026.csv',minRows:500},{now:'2026-08-03T00:00:00Z'}).validRows>=500));
 const cached=await ca('fresh cache avoids network',()=>multi.githubWtaCandidate({id:'WTA_MAIN',localFile:'wta_matches_2026.csv',minRows:500},{dataDir:tmp,year:2026,now:'2026-08-03T01:00:00Z',downloader:async()=>{throw new Error('SHOULD_NOT_CALL');}}));
 c('fresh cache marked',()=>assert.equal(cached.fromCache,true));
 const stale=await ca('network failure preserves stale cache',()=>multi.githubWtaCandidate({id:'WTA_MAIN',localFile:'wta_matches_2026.csv',minRows:500},{dataDir:tmp,year:2026,now:'2026-08-04T00:00:00Z',force:true,downloader:async()=>{const e=new Error('NETWORK_DOWN');e.retryable=false;throw e;}}));
 c('stale cache preserved',()=>assert(stale.fromCache&&stale.staleCache));
 const source=refresh.defaultSources(2026).find(x=>x.id==='WTA_MAIN');
 const remote=refresh.inspectCsvText(text,source,{now:'2026-08-03T00:00:00Z'});const local=refresh.inspectCsvText(csv(520,100),source,{now:'2026-08-03T00:00:00Z'});
 c('newer remote accepted',()=>assert.equal(refresh.compareRemoteToLocal(remote,local,source).accepted,true));
 c('older remote rejected',()=>assert.equal(refresh.compareRemoteToLocal(local,remote,source).accepted,false));
 c('license declared',()=>assert.equal(plan.providers.find(x=>x.id==='JEFF_SACKMANN_GITHUB').license,'CC_BY_NC_SA_4_0'));
 c('provider has no model authority',()=>assert.equal(plan.productionAuthority,false));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
})().catch(e=>{console.log(JSON.stringify({success:false,error:e.message,checks},null,2));process.exit(1);});
