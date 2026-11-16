'use strict';
const path=require('path');
const {createRequire}=require('module');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const req=createRequire(path.join(root,'package.json'));
const Database=req('better-sqlite3');
const db=new Database(path.join(root,'backend/database_betting.db'),{fileMustExist:true,readonly:true});
try{
 const integrity=db.pragma('integrity_check',{simple:true});
 const sourceRows=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
 const tennisRows=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
 const report={success:integrity==='ok',patch:'20',integrity,sourceRows,tennisRows,databaseChangedByPatch:false,newTables:0,generatedAt:new Date().toISOString()};
 console.log(JSON.stringify(report,null,2)); if(!report.success)process.exit(2);
}finally{db.close();}
