#!/usr/bin/env node
'use strict';
const cp = require('child_process');
const path = require('path');
function resolveRoot(){const i=process.argv.indexOf('--root');return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');}
const root=resolveRoot();
const suites=[
  ['tools/test-tennis-patch53-sport-key-resolution.js','functional'],
  ['tools/test-tennis-patch53-clv-coverage.js','functional'],
  ['tools/test-tennis-patch53-runtime-contract.js','functional'],
  ['tools/audit-tennis-patch53.js','functional'],
  ['tools/test-tennis-patch52-r2-state-truth.js','functional'],
  ['tools/test-tennis-patch52-r2-server-contract.js','functional'],
  ['tools/test-tennis-patch52-wta-recovery.js','functional'],
  ['tools/test-tennis-patch52-cli-and-server.js','functional'],
  ['tools/test-tennis-patch51-settlement-exception-queue.js','functional'],
  ['tools/test-tennis-patch51-runtime-idempotency.js','functional'],
  ['tools/test-tennis-patch51-frontend.js','functional'],
  ['tools/test-tennis-patch50-health-alignment.js','functional'],
  ['tools/test-tennis-patch50-prediction-index-collapse.js','functional'],
  ['tools/test-tennis-patch49-analysis-memory.js','functional'],
  ['tools/test-tennis-patch49-prediction-index-bands.js','functional'],
  ['tools/test-tennis-patch49-frontend.js','functional'],
  ['tools/test-tennis-patch49-canonical-onboarding.js','functional'],
  ['tools/test-tennis-patch48-r5-exact-ledger-gap.js','functional'],
  ['tools/test-tennis-patch47-runtime-idempotency.js','functional'],
  ['tools/test-tennis-patch46-frontend.js','functional'],
  ['tools/test-tennis-patch51-core-progression.js','compatibility']
];
function parse(raw){raw=String(raw||'').trim();try{return JSON.parse(raw)}catch(_){const p=raw.lastIndexOf('\n{');if(p>=0)try{return JSON.parse(raw.slice(p+1))}catch(__){}return null}}
let functionalChecks=0,compatibilityChecks=0,failed=false;const results=[];
for(const [file,kind] of suites){
  const run=cp.spawnSync(process.execPath,[path.join(root,file),'--root',root],{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024,windowsHide:true,env:{...process.env,NODE_NO_WARNINGS:'1',TENNIS_PATCH52_WTA_AUTO_REFRESH:'0',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0',CLV_VERBOSE_AUDIT:'0',PATCH50_SKIP_NESTED_PROGRESSION:'1'}});
  const parsed=parse(run.stdout);let checks=Array.isArray(parsed?.details)?parsed.details.length:Number(parsed?.checks||0);if(!Number.isFinite(checks))checks=0;
  const ok=run.status===0&&!run.error&&parsed?.success!==false;
  if(kind==='functional')functionalChecks+=checks;else compatibilityChecks+=checks;
  results.push({file,ok,exitCode:run.status,signal:run.signal||null,checks,error:ok?null:(parsed?.error||run.error?.message||String(run.stderr||run.stdout).slice(-5000))});
  if(!ok)failed=true;
}
const output={success:!failed,patch:'TENNIS_PATCH_53_CLV_COVERAGE_CROSS_SPORT_SPORT_KEY_RESOLUTION',revision:'R1_WINDOWS_NODE_CLV_COVERAGE_CROSS_SPORT_ROUTING',verification:`${results.filter(r=>r.ok).length}/${results.length} PASS`,functionalChecks,compatibilityChecks,suites:results};
console.log(JSON.stringify(output,null,2));if(failed)process.exit(1);
