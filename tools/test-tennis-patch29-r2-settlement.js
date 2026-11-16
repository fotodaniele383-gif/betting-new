'use strict';
const assert=require('assert'),path=require('path');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),audit=require('../backend/tennisSettlementUpdateAudit');
const db=new DatabaseSync(path.join(root,'backend','database_betting.db'),{readOnly:true});
const checks=[];function check(name,fn){try{fn();checks.push({name,ok:true})}catch(e){checks.push({name,ok:false,error:e.message})}}
let r2431,r2433,cohort2433;try{r2431=db.prepare('select * from ai_forward_test where id=2431').get();r2433=db.prepare('select * from ai_forward_test where id=2433').get();cohort2433=db.prepare('select * from tennis_forward_cohort_members where bet_id=2433').get();}finally{db.close()}
for(const [id,row] of [[2431,r2431],[2433,r2433]]){
 check(`${id} pending`,()=>assert.equal(row.status,'PENDING'));
 check(`${id} manual review`,()=>assert.equal(row.settlement_contract_status,'MANUAL_REVIEW'));
 check(`${id} risultato non applicato`,()=>assert(row.profit==null&&row.settled_at==null&&row.total_games==null&&row.winner_side==null));
 check(`${id} protetto helper`,()=>assert.equal(audit.isProtectedManualReview(row),true));
}
check('2431 reason bookmaker',()=>assert.equal(r2431.settlement_contract_reason,'OFFICIAL_RETIREMENT_BOOKMAKER_RULE_REQUIRED'));
check('2431 fonte manuale ufficiale',()=>assert.equal(r2431.settlement_source_tier,'MANUAL'));
check('2433 reason fingerprint',()=>assert.equal(r2433.settlement_contract_reason,'OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH'));
check('2433 mismatch ancora visibile',()=>assert.notEqual(cohort2433.market_fingerprint,r2433.settlement_market_fingerprint));
const a=audit.buildAttemptAudit({match:r2431,before:r2431,after:r2431,outcome:audit.OUTCOMES.SKIPPED_MANUAL_REVIEW,rowsMatched:1,rowsChanged:0});
check('audit contiene betId e righe',()=>assert(a.betId===2431&&a.rowsMatched===1&&a.rowsChanged===0));
check('audit no errore fittizio',()=>assert(a.errorCode==null&&a.errorMessage==null));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_29_R2_SETTLEMENT',checks:checks.length,passed:checks.length-failed.length,failed:failed.length,results:checks},null,2));process.exit(failed.length?1:0);
