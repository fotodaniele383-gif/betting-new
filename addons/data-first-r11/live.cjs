'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {classifyAudit,fmt,getLocalHealth}=require('./diagnosis.cjs');
const DEFAULT='C:\\Users\\pc-user\\Documents\\Personale\\BettingApp\\BettingApp v2';
const sha=x=>crypto.createHash('sha256').update(fs.readFileSync(x)).digest('hex');
(async()=>{try{const args=process.argv.slice(2);const root=path.resolve(args[0]||DEFAULT);const from=args.indexOf('--from-r10');let r10,db;
 if(from!==-1){const file=args[from+1];if(!file)throw Error('MISSING_R10_FILE');r10=JSON.parse(fs.readFileSync(file,'utf8'));}
 else{const a=require('../data-audit-r10/audit.cjs');db=path.join(root,'backend','database_betting.db');const before=sha(db);r10=await a.run(root,{samples:40,limit:250,http:false});if(before!==sha(db)||!r10.dbUnchanged)throw Error('R10_AUDIT_DB_CHANGED');}
 const hi=args.indexOf('--health-json');const health=hi!==-1?JSON.parse(fs.readFileSync(args[hi+1],'utf8')):await getLocalHealth();const report=classifyAudit(r10,health);
 const dir=path.resolve(process.env.LOCALAPPDATA||process.cwd(),'BettingApp_R11_Diagnostica');fs.mkdirSync(dir,{recursive:true});const t=new Date().toISOString().replace(/[:.]/g,'-'),file=path.join(dir,'R11_DIAGNOSI_'+t+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});fs.writeFileSync(file.replace('.json','.txt'),fmt(report),{flag:'wx'});
 console.log(`R11_AUDIT_PASS READ_ONLY=TRUE R10_DB_UNCHANGED=${report.dbUnchanged} TENNIS=${report.tennis.recordsExamined} CALCIO=${report.calcio.recordsExamined}`);console.log('R11_HTTP_HEALTH='+report.tennisHealth.status);console.log('R11_REPORT_JSON='+file);console.log('R11_REPORT_TXT='+file.replace('.json','.txt'));console.log('R11_SAFE=NO_BET_OR_SETTLEMENT_WRITEBACK');
 }catch(e){console.error('R11_AUDIT_ERROR='+String(e.message||e));process.exitCode=1;}})();
