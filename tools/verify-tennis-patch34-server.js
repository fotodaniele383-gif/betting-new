#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.resolve(__dirname,'..');const registry=require('../backend/tennisPatchRegistry');const schedule=require('../backend/tennisOfficialScheduleAuthority');const runtime=require('../backend/tennisRuntimeHealthContract');const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const files=['backend/server.tennis.js','backend/tennisOfficialScheduleAuthority.js','backend/migrateTennisPatch34.js','backend/tennisRejectedCaptureObservability.js','backend/tennisProgramProgressionAudit.js','backend/tennisRuntimeHealthContract.js','backend/tennisPatchRegistry.js'];
for(const file of files)check(`syntax ${file}`,()=>{const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);});
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');const health=fs.readFileSync(path.join(root,'backend/tennisRuntimeHealthContract.js'),'utf8');const pkg=require('../package.json');
check('package 21.21.0',()=>assert.equal(pkg.version,'21.21.0'));
check('registry 34',()=>assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'34'));
check('registry V34',()=>assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION,'TENNIS_PATCH_REGISTRY_V34'));
check('Patch34 attiva',()=>assert(registry.PATCHES.some(x=>String(x.version)==='34'&&x.status==='ACTIVE')));
check('modulo schedule importato',()=>assert(server.includes("require('./tennisOfficialScheduleAuthority')")));
check('schedule prima del Prematch Gate',()=>assert(server.indexOf('OFFICIAL_SCHEDULE_LIFECYCLE_START')<server.indexOf('PREMATCH_CAPTURE_GATE_START')));
check('stato terminale blocca',()=>assert(server.includes('PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED')));
check('race guard prima del return',()=>assert(server.indexOf('OFFICIAL_SCHEDULE_CAPTURE_TOKEN_STABLE')<server.indexOf('return { saved: true')));
check('receipt rejected post rollback',()=>assert(server.indexOf("captureOutcome: 'REJECTED'")>server.indexOf('} catch (error)')));
check('endpoint collegato',()=>assert(server.includes("router.get('/official-schedule-health'")));
check('health role required capture',()=>assert(health.includes('tennisOfficialScheduleAuthority: COMPONENT_ROLES.REQUIRED_CAPTURE')));
check('self check schedule',()=>assert.equal(schedule.selfCheck().ok,true));
check('nessuna autorità settlement',()=>assert.equal(schedule.selfCheck().checks.noSettlementAuthority,true));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
