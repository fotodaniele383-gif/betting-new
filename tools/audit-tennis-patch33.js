#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');
const eventTime=require('../backend/tennisCanonicalEventTime');const core=require('../backend/tennisCoreContractAudit');const progression=require('../backend/tennisProgramProgressionAudit');const registry=require('../backend/tennisPatchRegistry');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const root=path.resolve(__dirname,'..'),db=new DB(path.join(root,'backend','database_betting.db')),checks=[];function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
let report,coreHealth,progressionHealth;
try{
 report=eventTime.buildProviderTimeQualityReport(db,{limit:10});coreHealth=core.buildCoreContractAudit({projectRoot:root});progressionHealth=progression.buildProgramProgressionAudit(db,{projectRoot:root});
 check('registry 33',()=>assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'33'));
 check('contratto Patch33 attivo',()=>assert.equal(eventTime.TENNIS_CANONICAL_EVENT_TIME_VERSION,'TENNIS_CANONICAL_EVENT_TIME_CONTRACT_V1_PATCH33'));
 check('provider time health sano',()=>assert.equal(report.healthy,true));
 check('ledger append-only',()=>assert.equal(report.schema.appendOnly,true));
 check('catena hash sana',()=>assert.equal(report.chain.healthy,true));
 check('ledger forward vuoto',()=>assert.equal(report.total,0));
 check('nessun backfill',()=>assert.equal(report.noHistoricalBackfill,true));
 check('safety rule conservativa',()=>assert.equal(report.conflictSafetyRule,'EARLIEST_CREDIBLE_TIME'));
 check('override automatico assente',()=>assert.equal(report.automaticGateOverride,false));
 check('nessuna autorità modello',()=>assert.equal(report.authority.modelProbability,false));
 check('nessuna autorità stake',()=>assert.equal(report.authority.stake,false));
 check('core contract sano',()=>assert.equal(coreHealth.healthy,true));
 check('target package mancanti zero',()=>assert.equal(coreHealth.packageScripts.missingFileTargets.length,0));
 check('import runtime mancanti zero',()=>assert.equal(coreHealth.runtimeDependencies.missing.length,0));
 check('funzioni duplicate zero',()=>assert.equal(coreHealth.duplicateFunctionDeclarations.length,0));
 check('progression audit sano',()=>assert.equal(progressionHealth.healthy,true));
 check('progression Patch33',()=>assert.equal(progressionHealth.version,'TENNIS_PROGRAM_PROGRESSION_AUDIT_V25_PATCH33'));
}finally{db.close();}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,providerTime:{status:report?.status,total:report?.total,chain:report?.chain?.healthy,appendOnly:report?.schema?.appendOnly},coreContract:{status:coreHealth?.status,missingTargets:coreHealth?.packageScripts?.missingFileTargets?.length,missingImports:coreHealth?.runtimeDependencies?.missing?.length,duplicateFunctions:coreHealth?.duplicateFunctionDeclarations?.length},progression:{status:progressionHealth?.status,errors:progressionHealth?.errors,warnings:progressionHealth?.warnings}},null,2));process.exit(failed.length?1:0);
