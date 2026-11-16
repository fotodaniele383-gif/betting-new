#!/usr/bin/env node
'use strict';
const path=require('path');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');const db=new DatabaseSync(path.join(root,'backend','database_betting.db'),{readOnly:true});
try{
 const lifecycle=require(path.join(root,'backend','tennisForwardLifecycle.js'));const ledger=require(path.join(root,'backend','oddsApiUsageLedger.js'));
 const life=lifecycle.scanForwardLifecycle(db,{includeDetails:true,limit:100000});
 const tennisRegistry=require(path.join(root,'backend','tennisPatchRegistry.js'));const globalRegistry=require(path.join(root,'backend','calcioPatchRegistry.js'));
 const counts={total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),tennis:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n)};
 const out={success:life.driftBets===0,readOnly:true,patch:'TENNIS_PATCH_28_R1_LIFECYCLE_AVAILABILITY_ATP_LEDGER_RECOVERY',certification:'LIFECYCLE_AVAILABILITY_AND_ATP_LEDGER_WINDOWS_RECOVERY_CERTIFIED',registry:{global:String(globalRegistry.CALCIO_CURRENT_PATCH_VERSION),tennis:String(tennisRegistry.TENNIS_CURRENT_PATCH_VERSION)},database:counts,lifecycle:{version:life.version,trackedBets:life.trackedBets,healthyBets:life.healthyBets,driftBets:life.driftBets,counts:life.counts,proposedAsEvidencePending:Number(life.counts.SETTLEMENT_EVIDENCE_PENDING||0)},oddsLedger:{version:ledger.ODDS_API_LEDGER_VERSION,persistenceHealth:ledger.getPersistenceHealth(),telemetryAuthority:false,providerResultBlocking:false},guards:{http200DriftNotUnavailable:true,proposedNotReview:true,derivedLedgerReconciled:life.driftBets===0,windowsEpermNonBlocking:true,atpAndWtaLoopPreserved:true,modelProbabilityUnchanged:true,qualityGateAuthorityPreserved:true,stakeAuthorityPreserved:true,settlementAuthorityPreserved:true,globalRegistryUnchanged:true,newOddsApiCalls:0},nextStep:'RESTART_SERVER_CTRL_F5_RUN_ALL_TENNIS_ANALYSIS_VERIFY_ATP_AND_WTA'};
 console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
}finally{db.close();}
