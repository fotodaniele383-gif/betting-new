'use strict';
const path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const r=cp.spawnSync(process.execPath,[path.join(root,'tools','audit-tennis-program-progression.js')],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,TERM:'dumb'}});
let data=null;try{data=JSON.parse(String(r.stdout||'').trim().replace(/\u001b\[[0-9;]*[A-Za-z]/g,''))}catch{}
const checks=[['audit eseguibile',r.status===0&&data],['progressione certificata',data?.success===true&&data?.healthy===true&&Number(data?.errors||0)===0],['versione R2/R3 compatibile',['TENNIS_PROGRAM_PROGRESSION_AUDIT_V15_PATCH28_R2','TENNIS_PROGRAM_PROGRESSION_AUDIT_V16_PATCH28_R3'].includes(data?.version)]];
const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results,summary:data?{status:data.status,errors:data.errors,warnings:data.warnings}:null},null,2));process.exit(bad.length?1:0);
