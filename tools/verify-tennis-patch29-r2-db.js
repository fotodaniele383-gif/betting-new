#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),statePath=path.join(root,'.tennis_patch29_r2_state.json'),dbPath=path.join(root,'backend','database_betting.db');
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
let state=null;
try{state=JSON.parse(fs.readFileSync(statePath,'utf8'));add('dynamic installer state available',true,{patch:state.patch,revision:state.revision,rowCountGuard:state.rowCountGuard});}catch(error){add('dynamic installer state available',false,error.message);}
const db=new DatabaseSync(dbPath,{readOnly:true});
try{
 const integrity=db.prepare('pragma integrity_check').get().integrity_check;add('integrity',integrity==='ok',integrity);
 const total=Number(db.prepare('select count(*) n from ai_forward_test').get().n),tennis=Number(db.prepare("select count(*) n from ai_forward_test where sport_type='TENNIS'").get().n);
 const before=state?.rowCountsBefore||null,after=state?.rowCountsAfter||null;
 const installPreserved=Boolean(before&&after&&Number(before.total)===Number(after.total)&&Number(before.tennis)===Number(after.tennis)&&state.installCountsPreserved===true);
 add('install row counts preserved dynamically',installPreserved,{before,after,guard:state?.rowCountGuard||null});
 const noRegression=Boolean(after&&total>=Number(after.total)&&tennis>=Number(after.tennis));
 add('current row counts not below install snapshot',noRegression,{current:{total,tennis},installAfter:after,note:'Crescita successiva consentita; nessun valore statico.'});
 add('dynamic row-count guard active',state?.rowCountGuard==='DYNAMIC_INSTALL_SNAPSHOT',{rowCountGuard:state?.rowCountGuard||null});
 for(const id of [2431,2433]){
   const r=db.prepare('select * from ai_forward_test where id=?').get(id);
   add(`${id} pending manual`,r&&r.status==='PENDING'&&r.settlement_contract_status==='MANUAL_REVIEW',r||null);
   add(`${id} no applied outcome`,r&&r.profit==null&&r.settled_at==null&&r.total_games==null&&r.winner_side==null);
   add(`${id} manual source tier`,r&&r.settlement_source_tier==='MANUAL');
 }
 const c=db.prepare('select market_fingerprint from tennis_forward_cohort_members where bet_id=2433').get();
 const r=db.prepare('select settlement_market_fingerprint from ai_forward_test where id=2433').get();
 add('identity mismatch protected',Boolean(c&&r&&c.market_fingerprint!==r.settlement_market_fingerprint),{cohort:c?.market_fingerprint||null,evidence:r?.settlement_market_fingerprint||null});
}finally{db.close()}
const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,version:'PATCH29_R2_R2_DYNAMIC_INSTALL_SNAPSHOT_ROW_COUNT_GUARD',checks,failed:bad.length},null,2));process.exit(bad.length?1:0);
