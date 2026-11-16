'use strict';
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const Database=require('./sqlite-compat');
const obs=require('../backend/calcioObservability');
const dbPath=process.env.BETTING_DB_PATH||path.resolve(__dirname,'..','backend','database_betting.db');
const db=new Database(dbPath);
function digestRows(){return crypto.createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all())).digest('hex');}
const before={count:db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,digest:digestRows(),tennis:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n,resolvedCalcio:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n};
obs.ensureSchema(db);
const after={count:db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,digest:digestRows(),tennis:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n,resolvedCalcio:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n};
assert.deepEqual(after,before);
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'calcio_ai_observation_%' ORDER BY name").all().map(r=>r.name);
assert.deepEqual(tables,[
 'calcio_ai_observation_allocations',
 'calcio_ai_observation_batch_events',
 'calcio_ai_observation_batches',
 'calcio_ai_observation_finalizations'
]);
const addedBusinessColumns=db.prepare("PRAGMA table_info(ai_forward_test)").all().filter(c=>/calcio_observation|analysis_batch_id|event_finalization_id|portfolio_allocation_id/i.test(c.name));
assert.equal(addedBusinessColumns.length,0,'Patch 26A non deve aggiungere colonne business ad ai_forward_test');
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE',aiForwardTestUnchanged:true,tennisUnchanged:true,resolvedCalcioUnchanged:true,tables,before,after},null,2));
db.close();
