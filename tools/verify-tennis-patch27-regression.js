#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const cp=require('child_process');const fs=require('fs');const root=path.resolve(__dirname,'..');
const runtime=cp.spawnSync(process.execPath,[path.join(root,'tools/test-tennis-patch26-deepscan-runtime.js')],{cwd:root,encoding:'utf8',env:{...process.env,TENNIS_DISABLE_NETWORK:'1'},maxBuffer:64*1024*1024});assert.equal(runtime.status,0,`${runtime.stdout}\n${runtime.stderr}`);
const deep=fs.readFileSync(path.join(root,'backend/deepScanTennis.js'),'utf8');assert.ok(deep.includes("modelAuthority: false"));assert.ok(deep.includes("settlementAuthority: false"));
const registry=require('../backend/tennisPatchRegistry');assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'27');
const global=require('../backend/calcioPatchRegistry');assert.equal(String(global.CALCIO_CURRENT_PATCH_VERSION),'37');
console.log(JSON.stringify({success:true,checks:5,patch26DeepScanRuntimePreserved:true,productionAuthoritiesPreserved:true},null,2));
