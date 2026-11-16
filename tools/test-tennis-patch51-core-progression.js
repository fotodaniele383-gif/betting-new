#!/usr/bin/env node
'use strict';
const path=require('path');
const i=process.argv.indexOf('--root'),root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const core=require(path.join(root,'backend','tennisCoreContractAudit')).buildCoreContractAudit({projectRoot:root});
const {openDatabase}=require(path.join(root,'tools','patch15-db-adapter'));
const progression=require(path.join(root,'backend','tennisProgramProgressionAudit'));
const {db}=openDatabase(path.join(root,'backend','database_betting.db'),{projectRoot:root,fileMustExist:true,readonly:true});
let report;try{report=progression.buildProgramProgressionAudit(db,{projectRoot:root,historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json')})}finally{try{db.close()}catch(_){}}
const success=core.healthy===true&&Number(report.errors||0)===0;
console.log(JSON.stringify({success,checks:Array.isArray(report.checks)?report.checks.length:0,core:{success:core.success,healthy:core.healthy,status:core.status},progression:{success:report.success,errors:report.errors,warnings:report.warnings,status:report.status}},null,2));if(!success)process.exit(1);
