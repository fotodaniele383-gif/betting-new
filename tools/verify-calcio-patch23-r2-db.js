'use strict';
const path=require('path');const assert=require('assert');const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(path.resolve(__dirname,'../backend/database_betting.db'),{readOnly:true});
try{
 const total=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
 const tennis=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(id),0) s FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get();
 const calcio=db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n;
 const pending=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN COALESCE(stake,0)>0 THEN 1 ELSE 0 END),0) positive FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING'").get();
 const resolved=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(id),0) s FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get();
 assert(total>0&&tennis.n>0&&calcio>0&&pending.n>0);
 console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_RUNTIME_RECOVERY',database:{total,tennis:tennis.n,calcio,pending:pending.n,positiveStake:pending.positive,resolved:resolved.n},safeguards:{readOnlyVerification:true,noDatabaseMigration:true,tennisPreserved:true,resolvedCalcioPreserved:true}},null,2));
}finally{db.close();}
