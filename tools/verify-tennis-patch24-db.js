#!/usr/bin/env node
'use strict';
const path=require('path');
const intake=require('../backend/tennisForwardSampleIntake');
function openDb(file){try{const Database=require('better-sqlite3');return{db:new Database(file,{readonly:true,fileMustExist:true}),adapter:'better-sqlite3'};}catch(_){const{DatabaseSync}=require('node:sqlite');return{db:new DatabaseSync(file,{readOnly:true}),adapter:'node:sqlite'};}}
function main(){const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const{db,adapter}=openDb(path.join(root,'backend','database_betting.db'));try{
 const integrityRow=db.prepare('PRAGMA integrity_check').get();const integrity=integrityRow.integrity_check||integrityRow[Object.keys(integrityRow)[0]];
 const sourceBefore=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);const report=intake.inspectForwardSampleIntake(db);const sourceAfter=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
 const success=integrity==='ok'&&sourceBefore===sourceAfter&&report.structuralReady===true&&report.status!=='BLOCKED_CAPTURE'&&report.historicalBackfill===false;
 console.log(JSON.stringify({success,patch:'24',adapter,integrity,sourceRowsBefore:sourceBefore,sourceRowsAfter:sourceAfter,databaseRowsModified:sourceAfter-sourceBefore,readOnly:true,intake:report},null,2));if(!success)process.exitCode=2;
}finally{try{db.close();}catch(_){}}}
main();
