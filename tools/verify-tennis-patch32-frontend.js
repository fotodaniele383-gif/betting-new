#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'..'),checks=[];const read=r=>fs.readFileSync(path.join(root,r));const text=r=>read(r).toString('utf8');const hash=b=>crypto.createHash('sha256').update(b).digest('hex');function check(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
check('app parity',()=>assert.equal(hash(read('public/app.js')),hash(read('backend/public/app.js'))));
check('index parity',()=>assert.equal(hash(read('public/index.html')),hash(read('backend/public/index.html'))));
check('marker body Patch32',()=>assert(text('public/index.html').includes('data-patch32-rejected-capture-observability="true"')));
check('cache buster Patch32',()=>assert(text('public/index.html').includes('app.js?v=patch32-rejected-capture-observability')));
check('endpoint frontend',()=>assert(text('public/app.js').includes('/api/tennis/rejected-capture-observability?limit=30')));
check('marker JS Patch32',()=>assert(text('public/app.js').includes('TENNIS_PATCH32_REJECTED_CAPTURE_OBSERVABILITY')));
check('UI mostra chain health',()=>assert(/chain/i.test(text('public/app.js'))));
check('UI dichiara no override',()=>assert(/automaticOverride|automaticReactivation|nessun override/i.test(text('public/app.js'))));
const ids=[...text('public/index.html').matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);check('nessun ID duplicato',()=>assert.equal(ids.length,new Set(ids).size));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
