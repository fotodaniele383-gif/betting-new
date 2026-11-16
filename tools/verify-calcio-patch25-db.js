'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');const cp=require('child_process');const Database=require('./sqlite-compat');
const PATCH='BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
const src=path.resolve(__dirname,'../backend/database_betting.db');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch25-db-'));const copy=path.join(tmp,'database.db');fs.copyFileSync(src,copy);
function aggregate(db,where){return db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(id),0) idSum,COALESCE(SUM(COALESCE(stake,0)),0) stakeSum,COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE ${where}`).get();}
let db=new Database(copy);
const tennisBefore=aggregate(db,"UPPER(COALESCE(sport_type,''))='TENNIS'");
const resolvedBefore=aggregate(db,"UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')");
const rows=db.prepare("SELECT id FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 ORDER BY id DESC LIMIT 2").all();
assert(rows.length>=2,'Need two pending Calcio rows');
const [waitId,stateId]=rows.map(r=>r.id);
db.prepare("UPDATE ai_forward_test SET ds_action='ATTENDI IN-PLAY',calcio_deepscan_unified_action='ATTENDI IN-PLAY',stake=0,calcio_operational_stake=0 WHERE id=?").run(waitId);
db.prepare("UPDATE ai_forward_test SET stake=0,calcio_operational_stake=0,calcio_stake_lifecycle_status='UNIFIED_INDEX_STAKE_AUTHORIZED',calcio_prediction_index_eligible=1,calcio_analysis_only=0,prediction_visibility='OPERATIONAL_CANDIDATE',exposure_role='PRIMARY_OPERATIONAL' WHERE id=?").run(stateId);
db.close();
function migrate(){const r=cp.spawnSync(process.execPath,[path.resolve(__dirname,'migrate-calcio-patch25.js'),'--db',copy],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);return JSON.parse(r.stdout);}
const first=migrate();const second=migrate();
db=new Database(copy);
const wait=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(waitId);
const state=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(stateId);
const tennisAfter=aggregate(db,"UPPER(COALESCE(sport_type,''))='TENNIS'");
const resolvedAfter=aggregate(db,"UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')");
const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));db.close();
for(const c of ['calcio_deepscan_timing_advisory','calcio_market_projected_count','calcio_market_finalization_mode','calcio_runtime_consistency_status'])assert(cols.has(c),`Missing ${c}`);
assert.equal(wait.ds_action,'WATCHLIST LOW EDGE');assert.equal(wait.calcio_deepscan_timing_advisory,'WAIT_IN_PLAY');assert.equal(wait.calcio_market_ranking_certified,0);
assert.equal(state.calcio_prediction_index_eligible,0);assert.equal(state.calcio_analysis_only,1);assert.equal(state.prediction_visibility,'ANALYSIS_ONLY');assert.equal(state.exposure_role,'ANALYSIS_ONLY');assert.equal(state.calcio_stake_lifecycle_status,'UNIFIED_INDEX_NO_STAKE');
assert.equal(first.after.waitActionsRemaining,0);assert.equal(first.after.authorizedZeroRemaining,0);assert.equal(second.updated.waitActionsNormalized,0);assert.equal(second.updated.authorizedZeroNormalized,0);
assert.deepEqual(tennisAfter,tennisBefore);assert.deepEqual(resolvedAfter,resolvedBefore);
console.log(JSON.stringify({success:true,patch:PATCH,first,second:{addedCount:second.addedCount,updated:second.updated,idempotent:true},fixtures:{wait:{id:waitId,action:wait.ds_action,timing:wait.calcio_deepscan_timing_advisory},state:{id:stateId,stake:state.calcio_operational_stake,status:state.calcio_stake_lifecycle_status,visibility:state.prediction_visibility}},safeguards:{tennisUnchanged:true,resolvedCalcioUnchanged:true}},null,2));
try{fs.rmSync(tmp,{recursive:true,force:true});}catch(_){}
