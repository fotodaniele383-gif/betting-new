'use strict';
const path=require('path'); const fs=require('fs'); const Database=require('better-sqlite3');
const ROOT=path.resolve(__dirname,'..'); const dbPath=path.join(ROOT,'backend','database_betting.db');
const cols=[['clv_contract_status','TEXT'],['clv_contract_reason','TEXT'],['clv_contract_version','TEXT'],['clv_opening_ts','INTEGER'],['clv_closing_ts','INTEGER'],['clv_bookmaker','TEXT'],['clv_source_event_id','TEXT'],['clv_event_fingerprint','TEXT'],['clv_market_fingerprint','TEXT'],['clv_point_line','REAL']];
const db=new Database(dbPath); const existing=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name)); let added=[];
const before=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
for(const [n,t] of cols){if(!existing.has(n)){db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${n} ${t}`);added.push(n)}}
const after=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n; const report={success:before===after,version:'PATCH4',added,alreadyPresent:cols.map(x=>x[0]).filter(x=>existing.has(x)),rowsBefore:before,rowsAfter:after,backfill:false};
fs.mkdirSync(path.join(ROOT,'audit_patch4'),{recursive:true});fs.writeFileSync(path.join(ROOT,'audit_patch4','patch4_schema_migration_report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));db.close();if(!report.success)process.exit(2);
