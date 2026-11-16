#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const os=require('os');const cp=require('child_process');
let DB;try{DB=require('better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const root=path.resolve(__dirname,'..');const src=path.join(root,'backend','database_betting.db');const tmp=path.join(os.tmpdir(),`patch34r4_${process.pid}.db`);fs.copyFileSync(src,tmp);
const checks=[];function check(n,fn){try{fn();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
let db;
try{
 const run=cp.spawnSync(process.execPath,[path.join(root,'backend','migrateTennisPatch34R4.js'),'--apply',tmp],{cwd:root,encoding:'utf8'});check('migrazione temp exit 0',()=>assert.equal(run.status,0,run.stderr||run.stdout));
 const out=JSON.parse(run.stdout);check('migrazione success',()=>assert.equal(out.success,true));check('5 repair audit',()=>assert.equal(out.auditRows,5));
 db=new DB(tmp);const expected={2433:['LOST','2','Janice Tjen'],2439:['WON','2','Jessica Pegula'],2440:['WON','1','Alexandra Eala'],2465:['WON','1','Sara Bejlek'],2466:['LOST','1','Aoi Ito']};
 for(const [id,e] of Object.entries(expected)){const r=db.prepare('SELECT status,prediction,predicted_player_name,settlement_contract_status,prediction_snapshot_authority_id FROM ai_forward_test WHERE id=?').get(Number(id));check(`${id} outcome`,()=>assert.equal(r.status,e[0]));check(`${id} prediction snapshot`,()=>assert.equal(String(r.prediction),e[1]));check(`${id} player snapshot`,()=>assert.equal(r.predicted_player_name,e[2]));check(`${id} VERIFIED`,()=>assert.equal(r.settlement_contract_status,'VERIFIED'));check(`${id} anchor id`,()=>assert(/^TPS7_/.test(r.prediction_snapshot_authority_id)));}
 for(const id of [2431,2441,2442,2469,2484]){const r=db.prepare('SELECT status,settlement_contract_reason FROM ai_forward_test WHERE id=?').get(id);check(`${id} resta pending`,()=>assert.equal(r.status,'PENDING'));check(`${id} reason semantica`,()=>assert(/RETIREMENT|SUSPEND/.test(r.settlement_contract_reason)));}
 check('audit append only update',()=>assert.throws(()=>db.prepare('UPDATE tennis_settlement_truth_repairs SET outcome=outcome').run(),/append-only/));
 check('audit append only delete',()=>assert.throws(()=>db.prepare('DELETE FROM tennis_settlement_truth_repairs').run(),/append-only/));
 const second=cp.spawnSync(process.execPath,[path.join(root,'backend','migrateTennisPatch34R4.js'),'--apply',tmp],{cwd:root,encoding:'utf8'});check('seconda migrazione idempotente',()=>assert.equal(second.status,0,second.stderr||second.stdout));
 check('audit resta 5',()=>assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM tennis_settlement_truth_repairs').get().n),5));
 check('integrity ok',()=>assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok'));check('foreign keys clean',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
}finally{if(db)db.close();try{fs.rmSync(tmp,{force:true});}catch(_){}}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'PATCH34_R4',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
