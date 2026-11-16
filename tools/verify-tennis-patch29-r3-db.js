#!/usr/bin/env node
'use strict';
const path=require('path'),assert=require('assert'),crypto=require('crypto');
const {openDatabase,COLUMNS}=require('../backend/migrateTennisPatch29R3');
const root=path.resolve(__dirname,'..'),dbPath=path.join(root,'backend','database_betting.db');
const {db,adapter}=openDatabase(dbPath);const checks=[];function check(name,fn){try{fn();checks.push({name,ok:true})}catch(e){checks.push({name,ok:false,error:e.message})}}
function count(sql){return Number(db.prepare(sql).get().n||0)}
function stableHash(sql){const rows=db.prepare(sql).all();return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}
try{
 const columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));
 const total=count('SELECT COUNT(*) n FROM ai_forward_test');
 const tennis=count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'");
 const statePath=path.join(root,'.tennis_patch29_r3_state.json');let state={};try{state=require(statePath)}catch(_){}
 check('integrità SQLite',()=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
 check('foreign key clean',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
 check('sei colonne gate presenti',()=>assert(COLUMNS.every(([name])=>columns.has(name))));
 check('row count totale preservato',()=>assert.equal(total,Number(state.rowCountsBefore?.total||1161)));
 check('row count Tennis preservato',()=>assert.equal(tennis,Number(state.rowCountsBefore?.tennis||878)));
 check('nessun backfill storico R3',()=>assert.equal(count('SELECT COUNT(*) n FROM ai_forward_test WHERE prematch_capture_gate_version IS NOT NULL'),0));
 check('snapshot count preservato',()=>assert.equal(count('SELECT COUNT(*) n FROM tennis_prediction_snapshots'),Number(state.snapshotCountsBefore?.snapshots||195)));
 check('anchor count preservato',()=>assert.equal(count('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1'),Number(state.snapshotCountsBefore?.anchors||72)));
 check('snapshot chain senza invalidi nuovi',()=>assert.equal(count("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')"),Number(state.snapshotCountsBefore?.invalid||0)));
 const dataHash=stableHash("SELECT id,status,profit,settled_at,match_date,home_team,away_team,prediction,odd,estimated_prob,stake,professional_gate_status,tennis_operational_status,tennis_event_fingerprint,tennis_market_fingerprint,clv,clv_contract_status FROM ai_forward_test ORDER BY id");
 check('dati business invariati',()=>assert(!state.businessRowsHashBefore||state.businessRowsHashBefore===dataHash));
 const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_29_R3',adapter,database:dbPath,counts:{total,tennis},businessRowsHash:dataHash,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exitCode=failed.length?1:0;
}finally{db.close()}
