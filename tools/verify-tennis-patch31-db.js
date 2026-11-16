#!/usr/bin/env node
'use strict';
const assert=require('assert'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'..'); const dbPath=path.join(root,'backend','database_betting.db');
let DB; try { DB=require(path.join(root,'node_modules','better-sqlite3')); } catch(_) { DB=require('node:sqlite').DatabaseSync; }
const db=new DB(dbPath); const checks=[]; function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
try{
 const total=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
 const tennis=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
 const snapshots=Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots').get().n||0);
 const anchors=Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n||0);
 const invalid=Number(db.prepare("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')").get().n||0);
 const rows=db.prepare("SELECT id,status,profit,settled_at,match_date,home_team,away_team,prediction,odd,estimated_prob,stake,professional_gate_status,tennis_operational_status,tennis_event_fingerprint,tennis_market_fingerprint,clv,clv_contract_status FROM ai_forward_test ORDER BY id").all();
 const businessHash=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 check('integrità ok',()=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
 check('foreign key zero',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
 check('righe totali 1161',()=>assert.equal(total,1161));
 check('righe Tennis 878',()=>assert.equal(tennis,878));
 check('snapshot 195',()=>assert.equal(snapshots,195));
 check('anchor 72',()=>assert.equal(anchors,72));
 check('snapshot invalidi zero',()=>assert.equal(invalid,0));
 check('business hash invariato',()=>assert.equal(businessHash,'9e390ecf674105ceee6caae384ba9a0646936faf3ddeb4da325f2e2694529f1a'));
 check('nessuna tabella Patch31',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE '%patch31%'").get().n,0));
 check('nessuna colonna Patch31',()=>assert(!db.prepare('PRAGMA table_info(ai_forward_test)').all().some(c=>/secret|release/i.test(c.name))));
} finally { db.close(); }
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
