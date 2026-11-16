'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto'); const Database=require('better-sqlite3');
const ensemble=require('../backend/tennisProfessionalStatisticalEnsemble');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')); const dbPath=path.join(root,'backend','database_betting.db'); const auditDir=path.join(root,'audit_patch19');
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function tableState(db,t){const rows=db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();return{rows:rows.length,digest:sha(rows)};}
if(!fs.existsSync(dbPath)) throw new Error(`DB mancante: ${dbPath}`); const db=new Database(dbPath,{fileMustExist:true});
try{
 const integrityBefore=db.pragma('integrity_check',{simple:true}); if(integrityBefore!=='ok') throw new Error(`Integrità DB pre-migrazione: ${integrityBefore}`);
 const sourceBefore=tableState(db,'ai_forward_test'); const patch18Before=tableState(db,'tennis_statistical_challenger_predictions');
 ensemble.ensureSchema(db); const audit=ensemble.runProfessionalEngineAudit(db,{persist:true});
 if(!audit.success) throw new Error('PATCH19_ENGINE_AUDIT_FAILED');
 const sourceAfter=tableState(db,'ai_forward_test'); const patch18After=tableState(db,'tennis_statistical_challenger_predictions');
 if(sourceBefore.digest!==sourceAfter.digest) throw new Error('PATCH19_SOURCE_BETS_MODIFIED'); if(patch18Before.digest!==patch18After.digest) throw new Error('PATCH19_PATCH18_LEDGER_MODIFIED');
 const integrityAfter=db.pragma('integrity_check',{simple:true}); if(integrityAfter!=='ok') throw new Error(`Integrità DB post-migrazione: ${integrityAfter}`);
 const health=ensemble.getProfessionalEngineHealth(db); const output={success:true,patch:'19',migratedAt:new Date().toISOString(),dbPath,sourceBefore,sourceAfter,patch18Before,patch18After,sourceRowsModified:0,patch18RowsModified:0,audit,health,integrityBefore,integrityAfter};
 fs.mkdirSync(auditDir,{recursive:true}); fs.writeFileSync(path.join(auditDir,'patch19_migration_report.json'),JSON.stringify(output,null,2)); console.log(JSON.stringify(output,null,2));
}finally{db.close();}
