#!/usr/bin/env node
'use strict';
const cp=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const i=process.argv.indexOf('--root');
const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const suites=[
  ['tools/test-tennis-patch50-health-alignment.js','functional',true],
  ['tools/test-tennis-patch50-prediction-index-collapse.js','functional',true],
  ['tools/audit-tennis-patch50.js','functional',true],
  ['tools/test-tennis-patch49-analysis-memory.js','functional',true],
  ['tools/test-tennis-patch49-prediction-index-bands.js','functional',true],
  ['tools/test-tennis-patch49-frontend.js','functional',true],
  ['tools/test-tennis-patch49-canonical-onboarding.js','functional',true],
  ['tools/audit-tennis-patch49.js','functional',true],
  ['tools/audit-tennis-patch48.js','functional',true],
  ['tools/audit-tennis-patch47.js','functional',true],
  ['tools/audit-tennis-patch46.js','functional',true],
  ['tools/audit-tennis-core-contract.js','compatibility',false],
  ['tools/audit-tennis-program-progression.js','compatibility',false]
];
function tailFile(file,max=7000){
  try{const st=fs.statSync(file),start=Math.max(0,st.size-max),fd=fs.openSync(file,'r'),buf=Buffer.alloc(st.size-start);fs.readSync(fd,buf,0,buf.length,start);fs.closeSync(fd);return buf.toString('utf8')}catch(_){return ''}
}
let functional=0,compatibility=0,failed=false;
const results=[];
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-patch50-verify-'));
try{
 for(let index=0;index<suites.length;index++){
  const [file,kind,withRoot]=suites[index];
  const args=[path.join(root,file)];if(withRoot)args.push('--root',root);else if(file.endsWith('audit-tennis-program-progression.js'))args.push(root);
  const outFile=path.join(tempRoot,`suite-${index}.out`),errFile=path.join(tempRoot,`suite-${index}.err`);
  const outFd=fs.openSync(outFile,'w'),errFd=fs.openSync(errFile,'w');let run;
  try{run=cp.spawnSync(process.execPath,args,{cwd:root,stdio:['ignore',outFd,errFd],timeout:180000,windowsHide:true,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:process.env.TERM||'dumb',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0',CLV_VERBOSE_AUDIT:'0',PATCH50_SKIP_NESTED_PROGRESSION:'1'}})}finally{fs.closeSync(outFd);fs.closeSync(errFd)}
  const parser=cp.spawnSync(process.execPath,[path.join(root,'tools','patch50-suite-result-parser.js'),outFile],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  let compact=null;try{compact=JSON.parse(String(parser.stdout||'').trim())}catch(_){}
  const ok=run.status===0&&!run.error&&parser.status===0&&compact?.parsed===true&&compact?.success!==false;
  const n=Number.isFinite(Number(compact?.checks))?Number(compact.checks):0;if(kind==='functional')functional+=n;else compatibility+=n;
  results.push({file,ok,exitCode:run.status,signal:run.signal||null,checks:n,error:ok?null:String(compact?.error||run.error?.message||tailFile(errFile)||tailFile(outFile)).slice(0,7000)});if(!ok)failed=true;
  fs.rmSync(outFile,{force:true});fs.rmSync(errFile,{force:true});
 }
}finally{fs.rmSync(tempRoot,{recursive:true,force:true})}
const out={success:!failed,patch:'TENNIS_PATCH_50_TECHNICAL_HEALTH_CHECK_ALIGNMENT_COLLAPSIBLE_PREDICTION_INDEX_BANDS',revision:'R1_WINDOWS_NODE_HEALTH_SEMANTIC_ALIGNMENT_COLLAPSIBLE_ANALYTICS',verification:`${results.filter(x=>x.ok).length}/${results.length} PASS`,functionalChecks:functional,compatibilityChecks:compatibility,suites:results};
console.log(JSON.stringify(out,null,2));if(failed)process.exit(1);
