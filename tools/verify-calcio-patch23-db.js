'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const cp=require('child_process');const {DatabaseSync}=require('node:sqlite');
const PATCH='BETTING_PATCH_23_CALCIO_AI_DETERMINISTIC_FINALIZATION_CERTIFICATION';
const source=path.resolve(__dirname,'../backend/database_betting.db');
const temp=path.join(os.tmpdir(),`patch23-db-${process.pid}-${Date.now()}.db`);fs.copyFileSync(source,temp);
function snap(db,where){return db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(id),0) idSum,COALESCE(SUM(COALESCE(stake,0)),0) stakeSum,COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE ${where}`).get();}
const tennis="UPPER(COALESCE(sport_type,''))='TENNIS'", resolved="UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')";
const db0=new DatabaseSync(temp);const before={tennis:snap(db0,tennis),resolved:snap(db0,resolved)};db0.close();
const script=path.resolve(__dirname,'reconcile-calcio-ai-patch23.js');
const first=cp.spawnSync(process.execPath,[script,temp],{encoding:'utf8'});if(first.status!==0)throw new Error(first.stderr||first.stdout);const f=JSON.parse(first.stdout);
const second=cp.spawnSync(process.execPath,[script,temp],{encoding:'utf8'});if(second.status!==0)throw new Error(second.stderr||second.stdout);const s=JSON.parse(second.stdout);
const db=new DatabaseSync(temp);const after={tennis:snap(db,tennis),resolved:snap(db,resolved)};const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name));
const needed=['calcio_deepscan_unified_action','calcio_market_finalization_audit','calcio_output_coherence_status','calcio_pt_certification_status','calcio_finalization_transaction_status'];for(const c of needed)if(!cols.has(c))throw new Error('Colonna mancante '+c);
const positive=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(stake,0)>0").get().n);db.close();fs.unlinkSync(temp);
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Tennis o Calcio risolto modificati');if(positive!==0)throw new Error('Righe pre-Patch23 ancora operative');if(s.updated!==0)throw new Error('Migrazione non idempotente');
console.log(JSON.stringify({success:true,patch:PATCH,first:f,second:{updated:s.updated,idempotent:true},columns:needed,safeguards:{tennisUnchanged:true,resolvedCalcioUnchanged:true,legacyPositiveStake:positive}},null,2));
