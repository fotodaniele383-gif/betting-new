#!/usr/bin/env node
'use strict';
const path=require('path');const external=require('../backend/tennisExternalMatchIntelligencePatch37');
const dbPath=path.resolve(process.cwd(),process.argv.find(v=>/\.db$/i.test(v))||'backend/database_betting.db');
function open(){try{const B=require('better-sqlite3');return new B(dbPath);}catch(_){const {DatabaseSync}=require('node:sqlite');return new DatabaseSync(dbPath);}}
function table(db,n){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n));}
function cols(db,n){return new Set(db.prepare(`PRAGMA table_info(${n})`).all().map(r=>r.name));}
const db=open();try{
 const c=cols(db,'ai_forward_test');const required=['tennis_external_intelligence_version','tennis_external_intelligence_receipt_id','tennis_external_h2h_status','tennis_external_h2h_sample','tennis_external_h2h_adjustment_pp','tennis_external_ranking_status','tennis_external_weather_status','tennis_external_weather_risk_score','tennis_external_challenger_score','tennis_external_intelligence_updated_at'];
 const checks=[
  ['receipt table',table(db,'tennis_external_intelligence_receipts')],['challenger table',table(db,'tennis_external_challenger_runs')],['columns',required.every(x=>c.has(x))],
  ['receipt append trigger',Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_external_receipts_no_update'").get())],
  ['challenger append trigger',Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_external_challenger_no_update'").get())],
  ['baseline challenger row',Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_challenger_runs').get().n)===1],
  ['no historical receipt backfill',Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_intelligence_receipts').get().n)===0],
  ['integrity',String(Object.values(db.prepare('PRAGMA integrity_check').get())[0]).toLowerCase()==='ok'],['fk',db.prepare('PRAGMA foreign_key_check').all().length===0]
 ];
 const tennis="(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";
 const counts={total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),tennis:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennis}`).get().n),pending:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennis}`).get().n),positiveStake:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennis} AND COALESCE(stake,0)>0`).get().n),stakeTotal:Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennis}`).get().n)};
 checks.push(['business counts',JSON.stringify(counts)===JSON.stringify({total:1164,tennis:881,pending:45,positiveStake:2,stakeTotal:4})]);
 const failed=checks.filter(x=>!x[1]);console.log(JSON.stringify({success:failed.length===0,checks:checks.map(([name,ok])=>({name,ok})),counts,sourceHealth:external.sourceHealth()},null,2));if(failed.length)process.exit(1);
}finally{db.close();}
