'use strict';
const path=require('node:path'),fs=require('node:fs');
const {run,textReport}=require('./audit.cjs');
const DEFAULT='C:\\Users\\pc-user\\Documents\\Personale\\BettingApp\\BettingApp v2';
(async()=>{try{
 const args=process.argv.slice(2);const root=path.resolve(args[0]||DEFAULT);const location=args[1]||path.join(process.env.LOCALAPPDATA||process.cwd(),'BettingApp_R10_Diagnostica');
 const http=args.includes('--http');
 const r=await run(root,{samples:20,limit:250,http});
 fs.mkdirSync(location,{recursive:true});
 const time=new Date().toISOString().replace(/[:.]/g,'-');
 const j=path.join(location,'BETTINGAPP_R10_REAL_DATA_'+time+'.json'),t=j.replace('.json','.txt');
 fs.writeFileSync(j,JSON.stringify(r,null,2)+'\n',{flag:'wx'});fs.writeFileSync(t,textReport(r),{flag:'wx'});
 console.log('R10_DATA_AUDIT_PASS SQLITE_READ_ONLY=TRUE DB_SHA_UNCHANGED='+r.dbUnchanged);
 console.log('TENNIS_REAL_ROWS='+r.sports.TENNIS.scannedRows+' CALCIO_REAL_ROWS='+r.sports.CALCIO.scannedRows);
 console.log('T11_TRACE='+r.tennisT11.status+' T11_UNIQUE_BETS='+r.tennisT11.uniqueBets);
 console.log('CALCIO_AUTHORITY_ROWS='+r.calcioAuthorityAudit.rowsExamined);
 console.log('AUDIT_JSON='+j);console.log('AUDIT_TXT='+t);
 console.log('R10_NOTICE=CAUSAL_TRACE_WHERE_PRESENT;UNKNOWN_STAYS_UNCERTIFIED;NO_BET_EXECUTION');
}catch(e){console.error('R10_DATA_AUDIT_FAIL='+String(e.message||e));process.exitCode=1;}})();
