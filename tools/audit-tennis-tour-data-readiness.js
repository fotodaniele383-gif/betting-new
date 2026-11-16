'use strict';
const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');
const readiness=require('../backend/tennisTourDataReadiness');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend/database_betting.db');
const auditDir=path.join(root,'audit_patch22');
fs.mkdirSync(auditDir,{recursive:true});
const db=new Database(dbPath,{fileMustExist:true,readonly:true});
try{
 const report=readiness.buildReadinessHealth(db,{dataDir:path.join(root,'backend/sackmann_data'),projectRoot:root});
 const full={...report,patch:'22',generatedAt:new Date().toISOString(),readOnly:true};
 fs.writeFileSync(path.join(auditDir,'patch22_tour_data_readiness_audit.json'),JSON.stringify(full,null,2));
 const lines=['# Patch 22 — Tour-aware data readiness','',`- Stato: **${full.status}**`,`- Forward: **${full.forwardStatus}**`,`- Mascheramento aggregato: **${full.sourceFreshnessNotMasked?'NO':'ERRORE'}**`,'','## Target','','| Target | Tour | Stato | Ultimo match | Età giorni | Provider |','|---|---|---|---|---:|---|',...full.targets.map(x=>`| ${x.targetId} | ${x.tour} | ${x.status} | ${x.latestMatchAt||'N/D'} | ${x.dataAgeDays??'N/D'} | ${x.providerId||'N/D'} |`),'','## Circuiti','','| Circuito | Stato | Readiness | Current evidence | Shadow evidence |','|---|---|---|---|---|',...full.tours.map(x=>`| ${x.tour} | ${x.status} | ${x.readiness} | ${x.readyForCurrentEvidence?'SÌ':'NO'} | ${x.readyForShadowEvidence?'SÌ':'NO'} |`),'','La freschezza della sorgente e l’inattività del giocatore sono segnali separati. Nessuna autorità su probabilità production, DeepScan, Quality Gate o stake.'];
 fs.writeFileSync(path.join(auditDir,'patch22_tour_data_readiness_audit.md'),lines.join('\n'));
 console.log(JSON.stringify(full,null,2)); if(full.success!==true||full.sourceFreshnessNotMasked!==true)process.exitCode=2;
}finally{db.close();}
