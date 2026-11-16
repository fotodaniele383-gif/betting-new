#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const os=require('os');
const assert=require('assert');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const mod=require(path.join(root,'backend','tennisMultiProviderData.js'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'t2r1-lock-'));
const dataDir=path.join(tmp,'data'); fs.mkdirSync(dataDir,{recursive:true});
const lock=path.join(dataDir,'.patch21_multi_provider.lock');
const details=[]; const check=(name,fn)=>{try{const d=fn();details.push({name,ok:true,details:d??null});}catch(e){details.push({name,ok:false,error:e.message});}};
try{
check('R1 revision exported',()=>{assert.equal(mod.AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION,'AUDIT16D_R3_T2_R1_REFRESH_LOCK_OWNERSHIP_RECOVERY_V1');return mod.AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION;});
check('Absent lock reported as ABSENT',()=>{const s=mod.getRefreshLockStatus(dataDir);assert.equal(s.exists,false);assert.equal(s.status,'ABSENT');return s;});
check('Live owner lock is never stolen',()=>{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));const s=mod.getRefreshLockStatus(dataDir);assert.equal(s.ownerAlive,true);assert.equal(s.recoverable,false);let msg=null;try{mod.acquireRefreshLock(dataDir);}catch(e){msg=e.message;}assert.equal(msg,'PATCH21_REFRESH_ALREADY_RUNNING');fs.rmSync(lock,{force:true});return s;});
check('Dead owner lock is recoverable even when recent',()=>{fs.writeFileSync(lock,JSON.stringify({pid:2147483647,at:new Date().toISOString()}));const s=mod.getRefreshLockStatus(dataDir);assert.equal(s.ownerAlive,false);assert.equal(s.recoverable,true);const release=mod.acquireRefreshLock(dataDir,{operationId:'SELFTEST_DEAD_OWNER'});const active=mod.getRefreshLockStatus(dataDir);assert.equal(active.ownerAlive,true);assert.equal(active.pid,process.pid);assert.ok(release.lockRecovery);release();assert.equal(fs.existsSync(lock),false);return{before:s,recovery:release.lockRecovery};});
check('Fresh malformed lock fails closed',()=>{fs.writeFileSync(lock,'not-json');let msg=null;try{mod.acquireRefreshLock(dataDir,{staleLockMs:1800000});}catch(e){msg=e.message;}assert.equal(msg,'PATCH21_REFRESH_LOCK_UNCERTAIN');fs.rmSync(lock,{force:true});return msg;});
check('Old malformed lock is recoverable',()=>{fs.writeFileSync(lock,'not-json');const old=new Date(Date.now()-2*3600000);fs.utimesSync(lock,old,old);const s=mod.getRefreshLockStatus(dataDir,{staleLockMs:1800000});assert.equal(s.recoverable,true);const release=mod.acquireRefreshLock(dataDir,{operationId:'SELFTEST_OLD_MALFORMED',staleLockMs:1800000});assert.ok(release.lockRecovery);release();return s;});
check('Release removes only own lock',()=>{const release=mod.acquireRefreshLock(dataDir,{operationId:'SELFTEST_RELEASE'});assert.equal(fs.existsSync(lock),true);release();assert.equal(fs.existsSync(lock),false);return true;});
check('Provider authority remains unchanged',()=>{const src=fs.readFileSync(path.join(root,'backend','tennisMultiProviderData.js'),'utf8');assert.ok(!src.includes('productionAuthority:true'));assert.ok(!src.includes('qualityGateAuthority:true'));assert.ok(!src.includes('stakeAuthority:true'));return{productionAuthority:false,qualityGateAuthority:false,stakeAuthority:false};});
check('T2 WTA zero-key support preserved',()=>{const plan=mod.providerPlan({year:2026});const tml=plan.providers.find(x=>x.id==='TENNISMYLIFE_BULK');assert.ok(tml.supports.includes('WTA_MAIN'));return tml;});
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const failures=details.filter(x=>!x.ok);const out={success:failures.length===0,patch:'AUDIT16D_R3_T2_R1',suite:'PATCH21_REFRESH_LOCK_OWNERSHIP_RECOVERY',checks:details.length,failures,details};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
