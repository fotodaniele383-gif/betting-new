#!/usr/bin/env node
'use strict';
const assert=require('assert'); const path=require('path'); const fs=require('fs');
const root=path.resolve(__dirname,'..'); const security=require('../backend/tennisReleaseSecurity'); const core=require('../backend/tennisCoreContractAudit'); const progression=require('../backend/tennisProgramProgressionAudit'); const registry=require('../backend/tennisPatchRegistry');
let DB;try{DB=require(path.join(root,'node_modules','better-sqlite3'));}catch(_){DB=require('node:sqlite').DatabaseSync;}
const db=new DB(path.join(root,'backend','database_betting.db')); const checks=[];function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
let securityHealth,coreHealth,progressionHealth;
try{securityHealth=security.buildSecurityHealth({projectRoot:root});coreHealth=core.buildCoreContractAudit({projectRoot:root});progressionHealth=progression.buildProgramProgressionAudit(db,{projectRoot:root});
check('registry 31',()=>assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'31'));
check('security health',()=>assert.equal(securityHealth.healthy,true));
check('zero persisted secrets',()=>assert.equal(securityHealth.secretPersistence.findingCount,0));
check('config token assente',()=>assert.equal(securityHealth.secretPersistence.persistedTelegramConfigToken,false));
check('release size guard',()=>assert.equal(securityHealth.releasePolicy.withinSizeGuard,true));
check('backup policy',()=>assert.equal(securityHealth.releasePolicy.backupsExcluded,true));
check('database release policy',()=>assert.equal(securityHealth.releasePolicy.databasesExcluded,true));
check('core contract',()=>assert.equal(coreHealth.healthy,true));
check('target package mancanti zero',()=>assert.equal(coreHealth.packageScripts.missingFileTargets.length,0));
check('import runtime mancanti zero',()=>assert.equal(coreHealth.runtimeDependencies.missing.length,0));
check('funzioni duplicate zero',()=>assert.equal(coreHealth.duplicateFunctionDeclarations.length,0));
check('progression audit',()=>assert.equal(progressionHealth.healthy,true));
}finally{db.close();}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_31_SECRETS_RELEASE_HARDENING',checks,security:{status:securityHealth?.status,secretFindingCount:securityHealth?.secretPersistence?.findingCount,secretsExposed:false,projectedMiB:securityHealth?.releasePolicy?.projectedMiB},coreContract:{status:coreHealth?.status,missingTargets:coreHealth?.packageScripts?.missingFileTargets?.length,missingImports:coreHealth?.runtimeDependencies?.missing?.length,duplicateFunctions:coreHealth?.duplicateFunctionDeclarations?.length},progression:{status:progressionHealth?.status,errors:progressionHealth?.errors?.length,warnings:progressionHealth?.warnings?.length}},null,2));process.exit(failed.length?1:0);
