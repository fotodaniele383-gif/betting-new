'use strict';
const path=require('path');
const crypto=require('crypto');
const Database=require('./sqlite-compat');
const dbPath=process.env.BETTING_DB_PATH||path.resolve(__dirname,'..','backend','database_betting.db');
const db=new Database(dbPath,{readonly:false});
function digestRows(){
 const rows=db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
 return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
try{
 const before=digestRows();
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'calcio_ai_observation_%' ORDER BY name").all().map(r=>r.name);
 if(tables.length!==4) throw new Error(`PATCH26B_OBSERVABILITY_BASELINE_MISSING:${tables.length}`);
 const after=digestRows();
 if(before!==after) throw new Error('PATCH26B_UNEXPECTED_AI_FORWARD_TEST_MUTATION');
 console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',migration:'NO_DATA_MUTATION',aiForwardTestDigestBefore:before,aiForwardTestDigestAfter:after,observabilityTables:tables},null,2));
}finally{db.close();}
