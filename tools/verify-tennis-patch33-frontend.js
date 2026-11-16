#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..'),checks=[];const read=r=>fs.readFileSync(path.join(root,r));const text=r=>read(r).toString('utf8');const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
check('app parity',()=>assert.equal(hash(read('public/app.js')),hash(read('backend/public/app.js'))));
check('index parity',()=>assert.equal(hash(read('public/index.html')),hash(read('backend/public/index.html'))));
check('marker body Patch33',()=>assert(text('public/index.html').includes('data-patch33-canonical-event-time-provider-time-quality="true"')));
check('cache buster Patch33',()=>assert(text('public/index.html').includes('app.js?v=patch33-canonical-event-time-provider-time-quality')));
check('endpoint frontend',()=>assert(text('public/app.js').includes('/api/tennis/canonical-event-time-health?limit=30')));
check('marker JS Patch33',()=>assert(text('public/app.js').includes('TENNIS_PATCH33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY')));
check('pannello event time presente',()=>assert(text('public/index.html').includes('id="tennisCanonicalEventTimePanel"')));
check('UI mostra conflitti e chain',()=>assert(/conflitti provider/i.test(text('public/app.js'))&&/catena hash/i.test(text('public/app.js'))));
check('UI dichiara no override',()=>assert(/automaticGateOverride|Override automatico/i.test(text('public/app.js'))));
const ids=[...text('public/index.html').matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);check('nessun ID duplicato',()=>assert.equal(ids.length,new Set(ids).size));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
