'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const identity = require('../backend/paperTradingIdentity');
function openDb(file){
  const db=new DatabaseSync(file);
  db.pragma = (value)=> db.prepare(`PRAGMA ${value}`).get();
  db.transaction = fn => (...args)=>{ db.exec('BEGIN IMMEDIATE'); try{const out=fn(...args);db.exec('COMMIT');return out;}catch(e){try{db.exec('ROLLBACK')}catch{}throw e;} };
  return db;
}
function main(){
  const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
  const dbPath=process.env.BETTING_DB_PATH||path.join(root,'backend','database_betting.db');
  if(!fs.existsSync(dbPath)) throw new Error(`DB_MISSING:${dbPath}`);
  const db=openDb(dbPath); try{
    const before=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
    const report=identity.repairDuplicates(db);
    const after=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
    const active=db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=1').get().n;
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    const out={success:integrity==='ok',before,after,active,integrity,...report,database:path.relative(root,dbPath)};
    const dir=path.join(root,'audit_calcio_patch12');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'paper_trading_dedup_report.json'),JSON.stringify(out,null,2));
    console.log(JSON.stringify(out,null,2)); if(!out.success)process.exitCode=1;
  }finally{db.close();}
}
try{main();}catch(e){console.error('PATCH12 PAPER IDENTITY REPAIR ERROR:',e.stack||e.message);process.exit(1);}
