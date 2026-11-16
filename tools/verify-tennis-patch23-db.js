#!/usr/bin/env node
'use strict';
const path = require('path');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
function openDb(dbPath) {
  try { const Database=require('better-sqlite3'); return {db:new Database(dbPath,{readonly:true,fileMustExist:true}),adapter:'better-sqlite3'}; }
  catch (_) { const {DatabaseSync}=require('node:sqlite'); return {db:new DatabaseSync(dbPath,{readOnly:true}),adapter:'node:sqlite'}; }
}
function main(){
 const root=path.resolve(process.argv[2]||path.join(__dirname,'..')); const {db,adapter}=openDb(path.join(root,'backend','database_betting.db'));
 try{
  const integrity=db.prepare('PRAGMA integrity_check').get();
  const integrityValue=integrity.integrity_check||integrity[Object.keys(integrity)[0]];
  const tables=[retrieval.TABLE_RUNS,retrieval.TABLE_CHECKS,retrieval.TABLE_RECEIPTS];
  const tableState=Object.fromEntries(tables.map(t=>[t,Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t).n||0)===1]));
  const triggers=Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_tennis_info_%' OR type='trigger' AND name LIKE 'trg_tennis_prediction_receipts_%'").get().n||0);
  const sourceBefore=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
  const report=retrieval.buildInformationRetrievalHealth(db,{dataDir:path.join(root,'backend','sackmann_data'),historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json'),cacheDir:path.join(root,'backend','cache_news')});
  const sourceAfter=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
  const success=integrityValue==='ok'&&Object.values(tableState).every(Boolean)&&triggers===6&&sourceBefore===sourceAfter&&report.sourceFreshnessNotMasked===true&&report.zeroKeyHealthScoringAligned===true;
  console.log(JSON.stringify({success,patch:'23',adapter,integrity:integrityValue,tableState,immutableTriggers:triggers,sourceRowsBefore:sourceBefore,sourceRowsAfter:sourceAfter,databaseRowsModified:sourceAfter-sourceBefore,probeScope:report.probeScope,sourceFreshnessNotMasked:report.sourceFreshnessNotMasked,zeroKeyHealthScoringAligned:report.zeroKeyHealthScoringAligned,readOnly:true},null,2));
  if(!success)process.exitCode=2;
 }finally{try{db.close();}catch(_){}}
}
main();
