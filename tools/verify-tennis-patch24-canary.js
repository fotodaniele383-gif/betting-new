#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');
const snapshots=require('../backend/tennisPredictionSnapshots');
const cohorts=require('../backend/tennisForwardCohorts');
const intelligence=require('../backend/tennisMatchupIntelligence');
const retrieval=require('../backend/tennisInformationRetrievalCertification');
const intake=require('../backend/tennisForwardSampleIntake');
const registry=require('../backend/tennisPatchRegistry');

const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const dbPath=process.env.BETTING_DB_PATH||path.join(root,'backend','database_betting.db');
const outDir=path.join(root,'audit_patch24');fs.mkdirSync(outDir,{recursive:true});
const db=new Database(dbPath,{fileMustExist:true});
const tables=['ai_forward_test','tennis_prediction_snapshots','tennis_calibration_eligibility','tennis_forward_cohorts','tennis_forward_cohort_members','tennis_player_evidence_snapshots','tennis_matchup_feature_snapshots','tennis_challenger_predictions','tennis_prediction_evidence_receipts'];
// tennis_forward_cohorts is a global cohort registry keyed by cohort_id, not a per-bet table.
const perBetTables=tables.filter(table=>!['ai_forward_test','tennis_forward_cohorts'].includes(table));
const count=(table,where='',params=[])=>Number(db.prepare(`SELECT COUNT(*) n FROM ${table}${where?` WHERE ${where}`:''}`).get(...params).n||0);
const counts=()=>Object.fromEntries(tables.map(t=>[t,count(t)]));
const sentinel='PATCH24_CANARY_ROLLBACK_SENTINEL';
try{
 snapshots.ensurePredictionSnapshotTable(db);cohorts.ensureForwardCohortSchema(db);intelligence.ensureMatchupIntelligenceSchema(db);retrieval.ensureInformationRetrievalSchema(db);
 const maxId=Number(db.prepare('SELECT COALESCE(MAX(id),0) n FROM ai_forward_test').get().n||0);const canaryId=maxId+2400000;
 const capturedAt=new Date().toISOString();const matchStartAt=new Date(Date.now()+24*3600*1000).toISOString();
 const eventFingerprint=`PATCH24_CANARY_EVENT_${canaryId}`;const marketFingerprint=`PATCH24_CANARY_MARKET_${canaryId}`;
 const before=counts();let inside=null;
 const transaction=db.transaction(()=>{
  db.prepare(`INSERT INTO ai_forward_test (
   id,bet_type,match_date,home_team,away_team,prediction,odd,opening_odd,stake,status,estimated_prob,edge_pp,ev_pct,
   league,strategy_tag,sport_type,data_quality,market_type,tour_type,surface,model_version,metric_version,engine_version,
   tennis_event_identity_status,tennis_event_identity_version,tennis_event_fingerprint,tennis_market_fingerprint,
   canonical_match_datetime,clv_contract_status,settlement_contract_status
  ) VALUES (@id,'SINGLE_TENNIS',@matchStartAt,'Jannik Sinner','Novak Djokovic','1',1.80,1.80,2,'PENDING',62,6.44,11.6,
   'ATP Patch24 Canary','PATCH24_FORWARD_CANARY','TENNIS','CURRENT','h2h','ATP','HARD','PATCH24_CANARY_MODEL','PATCH24_CANARY_METRIC','PATCH24_CANARY_ENGINE',
   'PROVIDER_KEYED','TENNIS_EVENT_IDENTITY_V1_PATCH_3',@eventFingerprint,@marketFingerprint,@matchStartAt,'PENDING','PENDING')`).run({id:canaryId,matchStartAt,eventFingerprint,marketFingerprint});
  const source=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(canaryId);
  const bet={home:'Jannik Sinner',away:'Novak Djokovic',date:matchStartAt,surface:'Hard',tourType:'ATP',prediction:'1',estimatedProb:62,marketImpliedProbability:55.56,marketType:'h2h',referenceOdd1:1.80,referenceOdd2:2.10};
  const snapshot=snapshots.capturePredictionSnapshot(db,source,{capturedAt,operationId:'PATCH24_CANARY',registryVersion:registry.TENNIS_PATCH_REGISTRY_VERSION,allowOriginal:true});
  if(!snapshot.inserted||Number(snapshot.snapshot?.is_calibration_anchor||0)!==1)throw new Error('PATCH24_CANARY_SNAPSHOT_NOT_ANCHOR');
  const ledger=snapshots.refreshCalibrationEligibilityForBet(db,canaryId,{operationId:'PATCH24_CANARY'});if(!ledger.updated)throw new Error(`PATCH24_CANARY_LEDGER:${ledger.reason}`);
  const cohort=cohorts.assignForwardCohortMember(db,canaryId,{operationId:'PATCH24_CANARY'});if(!cohort.assigned)throw new Error(`PATCH24_CANARY_COHORT:${cohort.reason}`);
  const intel=intelligence.persistMatchupIntelligenceForBet(db,source,bet,{snapshotId:snapshot.snapshot.snapshot_id,snapshotStatus:snapshot.snapshot.snapshot_status,operationId:'PATCH24_CANARY',dataDir:path.join(root,'backend','sackmann_data'),historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json'),tour:'ATP',cohort:cohort.member});
  const receipt=retrieval.persistPredictionEvidenceReceipt(db,source,bet,{snapshotId:snapshot.snapshot.snapshot_id,phase:retrieval.RECEIPT_PHASES.PREDICTION_CAPTURE,operationId:'PATCH24_CANARY',dataDir:path.join(root,'backend','sackmann_data'),historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json'),cacheDir:path.join(root,'backend','cache_news')});
  const post=intake.assertForwardCapturePostconditions(db,canaryId,{operationId:'PATCH24_CANARY',throwOnFailure:true});
  inside={snapshotId:snapshot.snapshot.snapshot_id,cohortId:cohort.member?.cohort_id||null,intelligencePersisted:Boolean(intel.persisted||intel.duplicate),receiptId:receipt.receipt?.receiptId||receipt.receipt?.receipt_id||null,postconditions:post};
  throw new Error(sentinel);
 });
 try{transaction();throw new Error('PATCH24_CANARY_DID_NOT_ROLLBACK');}catch(error){if(error.message!==sentinel)throw error;}
 const after=counts();const canaryRows={ai_forward_test:count('ai_forward_test','id=?',[canaryId])};
 for(const table of perBetTables) canaryRows[table]=count(table,'bet_id=?',[canaryId]);
 const countsRestored=tables.every(t=>before[t]===after[t]);const noCanaryRows=Object.values(canaryRows).every(n=>n===0);const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
 const success=countsRestored&&noCanaryRows&&integrity==='ok'&&inside?.postconditions?.structuralComplete===true&&inside?.postconditions?.certificationEligible===true;
 const report={success,patch:'24',version:intake.TENNIS_FORWARD_SAMPLE_INTAKE_VERSION,canaryId,before,inside,after,canaryRows,countsRestored,noCanaryRows,integrity,rollbackGuaranteed:true,historicalBackfill:false,authority:{productionProbability:false,qualityGate:false,stake:false,settlement:false}};
 fs.writeFileSync(path.join(outDir,'patch24_forward_sample_intake_canary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!success)process.exitCode=2;
}catch(error){console.error(error.stack||error.message);process.exitCode=2;}finally{db.close();}
