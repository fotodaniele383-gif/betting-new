'use strict';
const path=require('path');
const fs=require('fs');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const Database=require('better-sqlite3');
const dbPath=path.join(root,'backend/database_betting.db');
if(!fs.existsSync(dbPath))throw new Error(`DB_MISSING:${dbPath}`);
const db=new Database(dbPath,{fileMustExist:true,readonly:true});
function table(name){return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n||0)===1;}
try{
  const integrity=db.pragma('integrity_check',{simple:true});
  const sourceRows=table('ai_forward_test')?Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0):0;
  const patch18Rows=table('tennis_statistical_challenger_predictions')?Number(db.prepare('SELECT COUNT(*) n FROM tennis_statistical_challenger_predictions').get().n||0):0;
  const patch19Runs=table('tennis_statistical_engine_audit_runs')?Number(db.prepare('SELECT COUNT(*) n FROM tennis_statistical_engine_audit_runs').get().n||0):0;
  const patch21Tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tennis_multi_provider%' ORDER BY name").all().map(x=>x.name);
  const report={success:integrity==='ok'&&sourceRows>0&&patch18Rows>0&&patch19Runs>0&&patch21Tables.length===0,patch:'21',integrity,sourceRows,patch18Rows,patch19Runs,patch21Tables,databasePolicy:'NO_SCHEMA_OR_ROW_MUTATION',generatedAt:new Date().toISOString()};
  console.log(JSON.stringify(report,null,2));if(!report.success)process.exit(2);
}finally{db.close();}
