'use strict';
const path=require('path');
const Database=require('./sqlite-compat');
const obs=require('../backend/calcioObservability');
const dbPath=process.env.BETTING_DB_PATH||path.resolve(__dirname,'..','backend','database_betting.db');
const db=new Database(dbPath,{readonly:false});
try{
  obs.ensureSchema(db);
  const report=obs.buildDiagnosticsReport(db,{limit:100});
  console.log(JSON.stringify({
    ...report,
    patch:'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE',
    certification:'OBSERVABILITY_BASELINE_READY_NO_DECISION_AUTHORITY',
    note:'Le anomalie sono osservate e non corrette dalla Patch 26A.'
  },null,2));
}finally{db.close();}
