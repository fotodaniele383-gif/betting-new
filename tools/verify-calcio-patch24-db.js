'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');const cp=require('child_process');const Database=require('./sqlite-compat');
const PATCH='BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
const src=path.resolve(__dirname,'../backend/database_betting.db');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch24-db-'));const copy=path.join(tmp,'database.db');fs.copyFileSync(src,copy);
function snap(db){return {
 total:db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,
 tennis:db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get(),
 resolved:db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')").get(),
 pending:db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING'").get()
};}
let db=new Database(copy);const before=snap(db);db.close();
function migrate(){const r=cp.spawnSync(process.execPath,[path.resolve(__dirname,'migrate-calcio-patch24.js'),'--db',copy],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);return JSON.parse(r.stdout);}
const first=migrate();const second=migrate();db=new Database(copy);const after=snap(db);const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));db.close();
for(const c of ['calcio_deepscan_canonical_audit','calcio_market_finalized_count','calcio_market_ranking_certified','calcio_output_coherence_status','prediction_visibility','exposure_role'])assert(cols.has(c),`Missing ${c}`);
assert.deepEqual(after,before,'Migration changed data rows');assert.equal(second.addedCount,0);assert.equal(second.dataRowsUpdated,0);
console.log(JSON.stringify({success:true,patch:PATCH,first,second:{addedCount:second.addedCount,idempotent:true},before,after,safeguards:{dataRowsUnchanged:true,tennisUnchanged:true,resolvedCalcioUnchanged:true,pendingCalcioUnchanged:true}},null,2));
try{fs.rmSync(tmp,{recursive:true,force:true});}catch(_){}
