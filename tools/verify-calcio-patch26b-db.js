'use strict';
const path=require('path');const assert=require('assert/strict');const Database=require('./sqlite-compat');
const dbPath=process.env.BETTING_DB_PATH||path.resolve(__dirname,'..','backend','database_betting.db');
const db=new Database(dbPath,{readonly:true});
try{
 const total=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
 const tennis=db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
 const resolved=db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')").get().n;
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'calcio_ai_observation_%'").all();
 assert.equal(tables.length,4);
 assert.ok(total>0);assert.ok(tennis>0);
 console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',database:{total,tennis,resolved,observabilityTables:tables.length},mutation:'NONE'},null,2));
}finally{db.close();}
