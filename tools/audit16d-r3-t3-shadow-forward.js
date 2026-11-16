#!/usr/bin/env node
'use strict';
const path=require('path');
const {openDatabase}=require('./patch15-db-adapter');
const shadow=require('../backend/tennisShadowFeatureEnrichment');
const intelligence=require('../backend/tennisMatchupIntelligence');
const playerRefresh=require('../backend/tennisPlayerDataRefresh');
const idx=process.argv.indexOf('--root');
const rootArg=process.argv.find(a=>a.startsWith('--root='));
const root=path.resolve(idx>=0&&process.argv[idx+1]?process.argv[idx+1]:rootArg?rootArg.slice(7):path.join(__dirname,'..'));
const dbPath=process.env.BETTING_DB_PATH||path.join(root,'backend','database_betting.db');
const dataDir=path.join(root,'backend','sackmann_data');
const {db,adapter,native}=openDatabase(dbPath,{projectRoot:root,readonly:true,fileMustExist:true});
try{
  const forward=shadow.summarizeForwardShadowEvidence(db);
  const health=intelligence.getIntelligenceHealth(db,{limit:5});
  const player=playerRefresh.getPlayerDataHealth({dataDir,initialize:true});
  const report={
    success:true,
    patch:'AUDIT16D_R3_T3',
    version:shadow.AUDIT16D_R3_T3_REVISION,
    mode:shadow.MODE,
    generatedAt:new Date().toISOString(),
    database:{adapter,native,readOnly:true},
    playerData:{status:player.status,readinessStatus:player.readinessStatus,latestMatchAt:player.latestMatchAt,dataAgeDays:player.dataAgeDays,autoRefreshRecurring:player.autoRefreshRecurring===true},
    shadowForward:forward,
    intelligence:{status:health.status,counts:health.counts,metrics:health.metrics,shadowFeatureVersion:health.shadowFeatureVersion,t3ShadowForward:health.t3ShadowForward},
    nextAction:forward.t3Snapshots===0?'WAIT_FOR_NEW_POST_T3_PREDICTIONS':forward.settledForwardRows<forward.thresholds.minimumOverallSettled?'ACCUMULATE_AND_SETTLE_T3_FORWARD_ROWS':'REVIEW_SEGMENT_EVIDENCE_NO_AUTOMATIC_PROMOTION',
    authority:{productionProbability:false,deepScanDecision:false,qualityGate:false,stake:false,settlement:false,automaticPromotion:false,automaticDemotion:false,historicalBetMutation:false}
  };
  console.log(JSON.stringify(report,null,2));
} finally { db.close(); }
