#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const root=path.resolve(__dirname,'..');
const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const statePath=path.join(root,'.tennis_patch34_state.json');
let state=null,db=null;
check('state Patch34 presente',()=>{assert(fs.existsSync(statePath));state=JSON.parse(fs.readFileSync(statePath,'utf8'));});
check('revisione R3 registrata',()=>{assert.equal(state.revision,'R3_WINDOWS_NODE_RUNTIME_BASELINE_RECOVERY');});
check('baseline proof runtime+schema',()=>{assert.equal(state.baselineProof,'PATCH33_RUNTIME_SCHEMA_INVARIANTS_CERTIFIED');});
check('state Patch33 non obbligatorio',()=>{assert.equal(state.baselineStatePolicy,'OPTIONAL_IF_RUNTIME_AND_SCHEMA_CERTIFIED');});
check('esito recovery registrato',()=>{assert(state.baselineRecovery&&typeof state.baselineRecovery.patch33StateFilePresent==='boolean');assert.equal(state.baselineRecovery.runtimeCertified,true);assert.equal(state.baselineRecovery.databaseSchemaCertified,true);});
try{
 db=new DB(path.join(root,'backend','database_betting.db'));
 check('schema Patch33 ancora certificato',()=>{assert(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_event_time_revisions'").get());assert(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_event_time_no_update'").get());assert(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_event_time_no_delete'").get());});
 check('schema Patch34 installato senza backfill',()=>{assert(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_schedule_receipts'").get());assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n||0),0);});
}finally{if(db)db.close();}
const failed=checks.filter(item=>!item.ok);
console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE',revision:'R3_WINDOWS_NODE_RUNTIME_BASELINE_RECOVERY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));
process.exit(failed.length?1:0);
