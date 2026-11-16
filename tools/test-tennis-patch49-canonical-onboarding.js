#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
let checks=0;function ok(v,m){assert.ok(v,m);checks++;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch49-canonical-'));
const source=path.join(root,'backend','database_betting.db');const dbPath=path.join(tmp,'database.db');fs.copyFileSync(source,dbPath);
const db=new DatabaseSync(dbPath);const mod=require(path.join(root,'backend','tennisDeepScanCanonicalOnboardingPatch49.js'));
try{
 const beforeBusiness=crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT id,estimated_prob,odd,closing_odd,clv,clv_edge,stake,status,profit,settlement_contract_status FROM ai_forward_test ORDER BY id`).all())).digest('hex');
 const ids=db.prepare(`SELECT id FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id DESC LIMIT 8`).all().map(x=>Number(x.id));ok(ids.length===8,'fixture 8 Tennis');
 const placeholders=ids.map(()=>'?').join(',');db.prepare(`UPDATE ai_forward_test SET tennis_deepscan_canonical_version=NULL,tennis_deepscan_canonical_action=NULL,tennis_deepscan_canonical_source=NULL,tennis_deepscan_canonical_hash=NULL,tennis_deepscan_canonical_at=NULL WHERE id IN (${placeholders})`).run(...ids);
 const gap=mod.getCoverage(db);ok(gap.coverageGap>=8,'gap rilevato');ok(ids.every(id=>gap.candidateIds.includes(id)),'ID fixture rilevati');
 const first=mod.reconcileCanonicalCoverage(db,{source:'PATCH49_TEST_FIRST'});ok(first.success,'primo reconcile');ok(first.repaired>=8,'otto righe riparate');ok(first.after.coverageGap===0&&first.after.covered===first.after.tennisRows,'copertura completa');
 const second=mod.reconcileCanonicalCoverage(db,{source:'PATCH49_TEST_SECOND'});ok(second.success&&second.repaired===0,'secondo passaggio idempotente');
 const afterBusiness=crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT id,estimated_prob,odd,closing_odd,clv,clv_edge,stake,status,profit,settlement_contract_status FROM ai_forward_test ORDER BY id`).all())).digest('hex');ok(beforeBusiness===afterBusiness,'valori business invariati');
 const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];ok(String(integrity).toLowerCase()==='ok','database integro');
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_49_CROSS_SPORT_ANALYSIS_MEMORY_PREDICTION_INDEX_BANDS_AI_RELIABILITY',checks,fixtureIds:ids,first:{repaired:first.repaired,after:first.after},second:{repaired:second.repaired}},null,2));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
