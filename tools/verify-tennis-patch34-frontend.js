#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..'),checks=[];function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const read=f=>fs.readFileSync(path.join(root,f),'utf8'),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');const app=read('public/app.js'),index=read('public/index.html');
check('app copie allineate',()=>assert.equal(hash('public/app.js'),hash('backend/public/app.js')));
check('index copie allineate',()=>assert.equal(hash('public/index.html'),hash('backend/public/index.html')));
check('marker Patch34 app',()=>assert(app.includes('TENNIS_PATCH34_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE')));
check('fetch endpoint schedule',()=>assert(app.includes('/api/tennis/official-schedule-health?limit=30')));
check('pannello schedule presente',()=>assert(index.includes('id="tennisOfficialSchedulePanel"')));
check('body marker Patch34',()=>assert(index.includes('data-patch34-official-schedule-authority-reschedule-lifecycle="true"')));
check('cache buster Patch34',()=>assert(index.includes('app.js?v=patch34-official-schedule-authority-reschedule-lifecycle')));
check('messaggio no settlement',()=>assert(/non determinano automaticamente settlement/i.test(index)));
const ids=[...index.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);const dup=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];check('ID HTML univoci',()=>assert.deepEqual(dup,[]));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
