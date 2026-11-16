'use strict';
const assert=require('assert'); const path=require('path'); const Database=require('./sqlite-compat');
const dbPath=process.env.BETTING_DB_PATH||path.join(__dirname,'..','backend','database_betting.db'); const db=new Database(dbPath);
try {
 const columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));
 const required=['calcio_historical_coverage_version','calcio_historical_coverage_status','calcio_historical_coverage_reason','calcio_historical_home_source','calcio_historical_away_source','calcio_historical_coverage_sample','calcio_historical_coverage_confidence','calcio_historical_coverage_audit'];
 const missing=required.filter(c=>!columns.has(c)); assert.deepStrictEqual(missing,[]);
 const counts={total:db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,tennis:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n,resolvedCalcio:db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n};
 console.log(JSON.stringify({success:true,verificationMode:'READ_ONLY_ADDITIVE_SCHEMA',database:dbPath,missingColumns:missing,counts},null,2));
} finally { db.close(); }
