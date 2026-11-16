#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'..'); const checks=[];
const read=r=>fs.readFileSync(path.join(root,r)); const text=r=>read(r).toString('utf8'); const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
check('app parity',()=>assert.equal(hash(read('public/app.js')),hash(read('backend/public/app.js'))));
check('index parity',()=>assert.equal(hash(read('public/index.html')),hash(read('backend/public/index.html'))));
check('telegram js parity',()=>assert.equal(hash(read('public/telegram.js')),hash(read('backend/public/telegram.js'))));
check('telegram html parity',()=>assert.equal(hash(read('public/telegram.html')),hash(read('backend/public/telegram.html'))));
check('marker Patch31 app',()=>assert(text('public/app.js').includes('TENNIS_PATCH31_SECRETS_RELEASE_HARDENING')));
check('marker Patch31 body',()=>assert(text('public/index.html').includes('data-patch31-secrets-release-hardening="true"')));
check('cache buster Patch31',()=>assert(text('public/index.html').includes('app.js?v=patch31-secrets-release-hardening')));
check('Telegram cache buster Patch31',()=>assert(text('public/telegram.html').includes('telegram.js?v=patch31-secrets-release-hardening')));
check('nessun campo token UI',()=>assert(!text('public/telegram.html').includes('id="botToken"')));
check('UI istruzioni rotazione',()=>assert(text('public/telegram.html').includes('TELEGRAM_TOKEN_ROTATION_REQUIRED=0')));
check('JS non serializza token',()=>assert(!text('public/telegram.js').includes('body.token')));
const ids=[...text('public/index.html').matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
check('nessun ID index duplicato',()=>assert.equal(ids.length,new Set(ids).size));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
