'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const {openDatabase}=require('./patch15-db-adapter');
const progression=require('../backend/tennisProgramProgressionAudit');
const dbPath=process.env.BETTING_DB_PATH||path.join(root,'backend','database_betting.db');
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
const before=sha();const {db}=openDatabase(dbPath,{projectRoot:root,fileMustExist:true,readonly:true});
let report;try{report=progression.buildProgramProgressionAudit(db,{projectRoot:root,historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json')});}finally{db.close();}
const after=sha();const front=report.checks.find(x=>x.name.startsWith('Frontend health truth'));
const checks=[
{name:'progressione certificata senza errori critici',ok:report.success===true&&report.healthy===true&&report.errors===0},
{name:'status warning o ok',ok:['WARN','OK'].includes(report.status)},
{name:'controllo frontend PASS',ok:front?.ok===true},
{name:'autorità frontend corrente riconosciuta',ok:['GLOBAL_REVISION','TENNIS_REVISION'].includes(front?.details?.frontendAuthority)},
{name:'registry globale 38 riconosciuto',ok:String(front?.details?.globalRegistryVersion)==='38'},
{name:'Patch26FF corrente riconosciuta',ok:front?.details?.currentGlobalPatchId==='BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS'},
{name:'copie app sincronizzate',ok:front?.details?.publicBackendAppSynchronized===true},
{name:'copie index sincronizzate',ok:front?.details?.publicBackendIndexSynchronized===true},
{name:'marker navigazione Tennis preservato',ok:front?.details?.navigationMarker===true},
{name:'marker runtime R3 preservato',ok:front?.details?.runtimeAlignmentMarker===true},
{name:'database byte-identico durante audit',ok:before===after}
];
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'BETTING_PATCH_26F_F_R1',checks:checks.length,report:{status:report.status,errors:report.errors,warnings:report.warnings,version:report.version,frontend:front},database:{before,after}},null,2));process.exit(failed.length?1:0);
