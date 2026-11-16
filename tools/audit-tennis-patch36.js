#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const fs=require('fs');
const drift=require('../backend/tennisTourDriftAuthorityPatch36');
const risk=require('../backend/tennisRiskAuthorityPatch36');
const multi=require('../backend/tennisMultiProviderData');
let DB;try{DB=require('better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const root=path.resolve(__dirname,'..');const db=new DB(path.join(root,'backend','database_betting.db'));const checks=[];
function c(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
let report;
try{
 const tennis="(upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%')";
 report=drift.loadFromDb(db);
 c('database rows unchanged',()=>assert.equal(Number(db.prepare('select count(*) n from ai_forward_test').get().n),1164));
 c('tennis rows unchanged',()=>assert.equal(Number(db.prepare(`select count(*) n from ai_forward_test where ${tennis}`).get().n),881));
 c('pending rows unchanged',()=>assert.equal(Number(db.prepare(`select count(*) n from ai_forward_test where upper(status)='PENDING' and ${tennis}`).get().n),45));
 c('pending exposure remains €4',()=>assert.equal(Number(db.prepare(`select round(coalesce(sum(stake),0),2) n from ai_forward_test where upper(status)='PENDING' and ${tennis}`).get().n),4));
 c('all pending rows governed by Patch36',()=>assert.equal(Number(db.prepare(`select count(*) n from ai_forward_test where upper(status)='PENDING' and ${tennis} and tennis_risk_authority_version=?`).get(risk.VERSION).n),45));
 c('WTA stale circuit breaker applied',()=>assert(Number(db.prepare(`select count(*) n from ai_forward_test where upper(status)='PENDING' and ${tennis} and tennis_risk_authority_circuit_breaker=1`).get().n)>0));
 c('WTA stale exposure zero',()=>assert.equal(Number(db.prepare(`select count(*) n from ai_forward_test where upper(status)='PENDING' and ${tennis} and upper(coalesce(league,'')) like '%WTA%' and coalesce(stake,0)>0`).get().n),0));
 c('ATP exposure remains two micro stakes',()=>assert.equal(Number(db.prepare(`select count(*) n from ai_forward_test where upper(status)='PENDING' and ${tennis} and upper(coalesce(league,'')) like '%ATP%' and coalesce(stake,0)>0`).get().n),2));
 c('risk authority audit rows 45',()=>assert.equal(Number(db.prepare('select count(*) n from tennis_risk_authority_decisions').get().n),45));
 c('drift authority audit row present',()=>assert.equal(Number(db.prepare('select count(*) n from tennis_tour_drift_authority_runs').get().n),1));
 c('risk ledger append-only',()=>assert.equal(Number(db.prepare("select count(*) n from sqlite_master where type='trigger' and tbl_name='tennis_risk_authority_decisions'").get().n),2));
 c('drift ledger append-only',()=>assert.equal(Number(db.prepare("select count(*) n from sqlite_master where type='trigger' and tbl_name='tennis_tour_drift_authority_runs'").get().n),2));
 c('retrospective degradation remains diagnostic',()=>assert.equal(report.retrospective.overall.degradationActive,true));
 c('retrospective probability authority disabled',()=>assert.equal(report.probabilityAdjustmentAuthority,false));
 c('forward sample remains immature',()=>assert.equal(report.forwardOverallMature,false));
 c('settlement truth repairs preserved',()=>assert.equal(Number(db.prepare('select count(*) n from tennis_settlement_truth_repairs').get().n),5));
 c('Patch35 stake ledger preserved',()=>assert.equal(Number(db.prepare('select count(*) n from tennis_stake_authority_decisions').get().n),45));
 c('database integrity',()=>assert.equal(String(Object.values(db.prepare('pragma integrity_check').get())[0]).toLowerCase(),'ok'));
 c('foreign keys clean',()=>assert.equal(db.prepare('pragma foreign_key_check').all().length,0));
}finally{db.close();}
c('final risk authority is sole stake authority',()=>assert.equal(risk.health().soleFinalStakeAuthority,true));
c('stale WTA cannot carry stake',()=>assert.equal(risk.decide({proposedStake:4,league:'WTA',qualityCode:'APPROVED',historicalEvidence:{resolved:100},dataReadiness:{status:'STALE',dataAgeDays:70.3}}).finalStake,0));
c('GitHub WTA provider enabled',()=>{const p=multi.providerPlan({year:2026}).providers.find(x=>x.id==='JEFF_SACKMANN_GITHUB');assert(p&&p.enabled&&!p.apiKeyRequired&&p.supports.includes('WTA_MAIN'));});
c('WTA provider recovery remains data-only',()=>assert.equal(multi.getHealth({dataDir:path.join(root,'backend','sackmann_data')}).productionAuthority??false,false));
c('frontend Patch36 marker active',()=>assert(fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('patch36-wta-provider-tour-drift-authority')));
c('Calcio registry isolated',()=>assert.equal(String(require('../backend/calcioPatchRegistry').CALCIO_CURRENT_PATCH_VERSION||require('../backend/calcioPatchRegistry').CURRENT_PATCH_VERSION||'38'),'38'));
const failed=checks.filter(x=>!x.ok);const out={success:!failed.length,patch:'TENNIS_PATCH_36_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_GUARD',revision:'R1_WINDOWS_NODE_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_GUARD',checks,passed:checks.length-failed.length,failed:failed.length,authority:risk.health(),drift:report?{retrospective:report.retrospective.overall,forwardRows:report.forward.rows,probabilityAdjustmentAuthority:report.probabilityAdjustmentAuthority}:null,provider:multi.providerPlan({year:2026})};console.log(JSON.stringify(out,null,2));process.exit(failed.length?1:0);
