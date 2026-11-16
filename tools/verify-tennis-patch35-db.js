#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const crypto=require('crypto');let DB;try{DB=require('better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const db=new DB(path.resolve(__dirname,'../backend/database_betting.db'));const checks=[];function c(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
const one=sql=>db.prepare(sql).get();const count=sql=>Number(one(sql).n||0);const hashRows=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
try{
 c('integrity ok',()=>assert.equal(Object.values(one('PRAGMA integrity_check'))[0],'ok'));
 c('foreign keys clean',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
 c('row count 1164',()=>assert.equal(count('select count(*) n from ai_forward_test'),1164));
 c('Tennis rows 881',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%'"),881));
 c('Tennis pending 45',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(status)='PENDING' and (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%')"),45));
 c('pending positive stake rows 2',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(status)='PENDING' and (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%') and coalesce(stake,0)>0"),2));
 c('pending stake total 4',()=>assert.equal(Number(one("select round(coalesce(sum(stake),0),2) n from ai_forward_test where upper(status)='PENDING' and (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%')").n),4));
 c('stake authority audit table exists',()=>assert(one("select 1 ok from sqlite_master where type='table' and name='tennis_stake_authority_decisions'")));
 c('stake authority append-only triggers',()=>assert.equal(count("select count(*) n from sqlite_master where type='trigger' and name in ('trg_tennis_stake_authority_decisions_no_update','trg_tennis_stake_authority_decisions_no_delete')"),2));
 c('45 authority decisions',()=>assert.equal(count('select count(*) n from tennis_stake_authority_decisions'),45));
 c('all current pending rows governed',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(status)='PENDING' and (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%') and tennis_stake_authority_version='TENNIS_FINAL_STAKE_AUTHORITY_V1_PATCH35'"),45));
 c('no n<5 positive stake',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(status)='PENDING' and (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%') and coalesce(stake,0)>0 and coalesce(tennis_stake_authority_sample,0)<5"),0));
 c('eight n=1 rows zeroed',()=>assert.equal(count("select count(*) n from ai_forward_test where upper(status)='PENDING' and tennis_stake_authority_sample=1 and tennis_stake_authority_status='PAPER_ONLY_INSUFFICIENT_SAMPLE' and coalesce(stake,0)=0"),8));
 c('Mannarino cap 3 to 2',()=>{const r=db.prepare('select stake,tennis_stake_authority_proposed_stake,tennis_stake_authority_sample,tennis_stake_authority_status from ai_forward_test where id=2451').get();assert.deepStrictEqual([Number(r.stake),Number(r.tennis_stake_authority_proposed_stake),Number(r.tennis_stake_authority_sample),r.tennis_stake_authority_status],[2,3,23,'AUTHORIZED_MICRO_SAMPLE_CAP']);});
 c('large-sample micro remains 2',()=>{const r=db.prepare('select stake,tennis_stake_authority_sample from ai_forward_test where id=2447').get();assert.deepStrictEqual([Number(r.stake),Number(r.tennis_stake_authority_sample)],[2,175]);});
 c('five Patch34 truth repairs preserved',()=>assert.equal(count('select count(*) n from tennis_settlement_truth_repairs'),5));
 for(const [id,status] of [[2433,'LOST'],[2439,'WON'],[2440,'WON'],[2465,'WON'],[2466,'LOST']])c(`settlement ${id} preserved`,()=>assert.equal(db.prepare('select status from ai_forward_test where id=?').get(id).status,status));
 const resolved=db.prepare("select id,status,prediction,odd,estimated_prob,profit from ai_forward_test where (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%') and upper(status)!='PENDING' order by id").all();
 c('resolved Tennis business hash unchanged',()=>assert.equal(hashRows(resolved),'270a049803ed19a395a44e3698d980601507d7a81b22f46ffa34ef7c3ca9b3d5'));
 const foreign=db.prepare("select id,status,prediction,odd,estimated_prob,profit from ai_forward_test where not (upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%') order by id").all();
 c('non-Tennis business hash unchanged',()=>assert.equal(hashRows(foreign),'e24051b7ed442a7f76ca3ccc866e401b60f67016016bc2e12dfea8fa18b94d45'));
 c('CLV discovery columns present',()=>{const cols=new Set(db.prepare('pragma table_info(ai_forward_test)').all().map(x=>x.name));for(const k of ['clv_sport_key_discovery_version','clv_sport_key_discovery_status','clv_sport_key_requested','clv_sport_key_resolved','clv_provider_error_code','clv_provider_error_at'])assert(cols.has(k),k);});
}finally{db.close();}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
