'use strict';const path=require('path');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.resolve(__dirname,'..','backend','database_betting.db'));let out;
try{
 const integrity=db.prepare('pragma integrity_check').get().integrity_check,total=db.prepare('select count(*) n from ai_forward_test').get().n,tennis=db.prepare("select count(*) n from ai_forward_test where sport_type='TENNIS'").get().n;
 const verifiedIds=[2421,2422,2423,2424,2425,2426,2430,2432];
 const verified=verifiedIds.map(id=>db.prepare('select id,status,settlement_contract_status,settlement_source from ai_forward_test where id=?').get(id));
 const retirement=db.prepare('select id,status,settlement_contract_status,settlement_contract_reason,settlement_source from ai_forward_test where id=2431').get();
 const identity=db.prepare('select id,status,settlement_contract_status,settlement_contract_reason,settlement_source from ai_forward_test where id=2433').get();
 const future=db.prepare("select count(*) n from ai_forward_test where id in (2436,2437,2438,2439,2440) and status='PENDING'").get().n;
 const checks=[
 ['integrity ok',integrity==='ok'],['righe totali preservate',total>=1114],['righe Tennis preservate',tennis>=831],
 ['otto WTA risolti',verified.every(r=>r&&['WON','LOST'].includes(r.status))],
 ['otto contratti VERIFIED',verified.every(r=>r.settlement_contract_status==='VERIFIED')],
 ['fonti WTA ufficiali',verified.every(r=>r.settlement_source==='WTA_OFFICIAL_RESULTS_PATCH29')],
 ['ritiro resta PENDING',retirement?.status==='PENDING'],['ritiro MANUAL_REVIEW',retirement?.settlement_contract_status==='MANUAL_REVIEW'],
 ['ritiro richiede bookmaker',retirement?.settlement_contract_reason==='OFFICIAL_RETIREMENT_BOOKMAKER_RULE_REQUIRED'],
 ['mismatch resta PENDING',identity?.status==='PENDING'],['mismatch MANUAL_REVIEW',identity?.settlement_contract_status==='MANUAL_REVIEW'],
 ['mismatch fingerprint tracciato',identity?.settlement_contract_reason==='OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH'],
 ['futuri protetti',future===5]
 ];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);out={success:!bad.length,readOnly:true,integrity,total,tennis,verified,retirement,identity,futureProtected:future,checks:results};
}finally{db.close()}console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
