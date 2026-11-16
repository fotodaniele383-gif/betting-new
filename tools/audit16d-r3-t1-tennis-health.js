#!/usr/bin/env node
'use strict';
const path = require('path');
const { openDatabase } = require('./patch15-db-adapter');
const forward = require('../backend/tennisForwardSampleIntake');
const playerRefresh = require('../backend/tennisPlayerDataRefresh');
const multiProvider = require('../backend/tennisMultiProviderData');
const coreAudit = require('../backend/tennisCoreContractAudit');
const releaseSecurity = require('../backend/tennisReleaseSecurity');
const settlement = require('../backend/tennisOfficialSettlementResolver');
const drift = require('../backend/tennisTourDriftAuthorityPatch36');
const challenger = require('../backend/tennisStatisticalChallenger');

const PATCH = 'AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';
const idx = process.argv.indexOf('--root');
const rootArgEq = process.argv.find(a => a.startsWith('--root='));
const root = path.resolve(idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : rootArgEq ? rootArgEq.slice(7) : path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const dataDir = path.join(root, 'backend', 'sackmann_data');
const { db, adapter, native } = openDatabase(dbPath, { projectRoot: root, readonly: true, fileMustExist: true });
function tableExists(name){try{return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch(_){return false;}}
function tennisWhere(){return "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";}
function queryScope(){
  const where=tennisWhere();
  const row=db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN CAST(stake AS REAL)>0 THEN 1 ELSE 0 END) trading,
    SUM(CASE WHEN CAST(stake AS REAL)=0 THEN 1 ELSE 0 END) studio,
    SUM(CASE WHEN stake IS NULL OR TRIM(CAST(stake AS TEXT))='' THEN 1 ELSE 0 END) missingStake,
    SUM(CASE WHEN UPPER(COALESCE(status,''))='PENDING' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN UPPER(COALESCE(status,''))='WON' THEN 1 ELSE 0 END) won,
    SUM(CASE WHEN UPPER(COALESCE(status,''))='LOST' THEN 1 ELSE 0 END) lost,
    SUM(CASE WHEN UPPER(COALESCE(status,''))='VOID' THEN 1 ELSE 0 END) voided
    FROM ai_forward_test WHERE ${where}`).get();
  return Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[k,Number(v||0)]));
}
function queryClv(){
  const result={snapshotTablePresent:tableExists('tennis_clv_snapshot_checkpoints'),degradedLedgerPresent:tableExists('tennis_clv_degraded_ledger_patch47'),snapshots:0,distinctBets:0,degradedLedgerRows:0,states:[]};
  if(result.snapshotTablePresent){const r=db.prepare('SELECT COUNT(*) snapshots,COUNT(DISTINCT bet_id) distinctBets FROM tennis_clv_snapshot_checkpoints').get();result.snapshots=Number(r.snapshots||0);result.distinctBets=Number(r.distinctBets||0);}
  if(result.degradedLedgerPresent){result.degradedLedgerRows=Number(db.prepare('SELECT COUNT(*) n FROM tennis_clv_degraded_ledger_patch47').get().n||0);result.states=db.prepare('SELECT COALESCE(degraded_state,\'NULL\') state,COUNT(*) n FROM tennis_clv_degraded_ledger_patch47 GROUP BY COALESCE(degraded_state,\'NULL\') ORDER BY state').all().map(x=>({state:x.state,n:Number(x.n||0)}));}
  return result;
}
try {
  const f=forward.inspectForwardSampleIntake(db);
  const p=playerRefresh.getPlayerDataHealth({dataDir,initialize:true});
  const m=multiProvider.getHealth({dataDir});
  const c=coreAudit.buildCoreContractAudit({projectRoot:root});
  const r=releaseSecurity.buildSecurityHealth({projectRoot:root});
  const s=settlement.health();
  const d=drift.loadFromDb(db);
  const ch=challenger.getStatisticalChallengerHealth(db);
  const scopes=queryScope();
  const clv=queryClv();
  const dataCurrent=['CURRENT','AGING'].includes(String(p.status||'')) && p.degradedUsingLastKnownGood!==true;
  const forwardReady=f.structuralReady===true && f.structuralGaps.length===0;
  const forwardMature=d.forwardOverallMature===true;
  const hardErrors=[];
  if(!c.healthy) hardErrors.push('CORE_CONTRACT');
  if(!r.healthy) hardErrors.push('RELEASE_SECURITY');
  if(!forwardReady) hardErrors.push('FORWARD_CAPTURE');
  const warnings=[];
  if(!dataCurrent) warnings.push('PLAYER_DATA_STALE_OR_DEGRADED');
  if(!forwardMature) warnings.push('FORWARD_DRIFT_SAMPLE_IMMATURE');
  if(ch.stabilityGuard?.eligible!==true) warnings.push('CHALLENGER_NOT_PROMOTION_ELIGIBLE');
  if(String(s.status||'').includes('DEGRADED')) warnings.push('OFFICIAL_SETTLEMENT_NETWORK_DEGRADED');
  const report={
    success:hardErrors.length===0,
    patch:PATCH,
    status:hardErrors.length?'BLOCKED':warnings.length?'READY_WITH_WARNINGS':'READY',
    generatedAt:new Date().toISOString(),
    database:{adapter,native,readOnly:true},
    tradingScopes:{...scopes,rule:'Trading=stake>0; Trading Studio=stake=0; missing/malformed stake is not zero'},
    forwardCapture:{status:f.status,structuralReady:f.structuralReady,structuralGaps:f.structuralGaps,coverage:f.coverage,actionableRows:f.forwardSample?.actionableRows||0,minimumActionableRows:f.forwardSample?.minimumActionableRows||0,promotionAuthority:false},
    playerData:{status:p.status,readinessStatus:p.readinessStatus,refreshState:p.refreshState,latestMatchAt:p.latestMatchAt,dataAgeDays:p.dataAgeDays,lastRefreshAt:p.lastRefreshAt,degradedUsingLastKnownGood:p.degradedUsingLastKnownGood,providerStrategy:p.providerStrategy||m.strategy,selectedProviders:m.selectedProviders||[],productionAuthority:false},
    clv:{...clv,productionAuthority:false},
    settlement:{status:s.status,lastOfficialNetworkFailure:s.lastOfficialNetworkFailure||null,fallbackAllowed:true,productionAuthority:'EXISTING_SETTLEMENT_CONTRACT_ONLY'},
    challenger:{status:ch.status,stabilityGuard:ch.stabilityGuard,productionAuthority:false,automaticPromotion:false},
    drift:{forwardRows:d.forward?.rows||0,forwardOverallMature:d.forwardOverallMature===true,forwardTourMature:d.forwardTourMature||{},probabilityAdjustmentAuthority:d.probabilityAdjustmentAuthority===true},
    coreContract:{healthy:c.healthy,status:c.status,missingRuntimeDependencies:c.runtimeDependencies?.missing?.length||0},
    release:{healthy:r.healthy,status:r.status,projectedMiB:r.releasePolicy?.projectedMiB,maxMiB:r.releasePolicy?.maxMiB,withinSizeGuard:r.releasePolicy?.withinSizeGuard},
    readiness:{dataCurrent,forwardCaptureReady:forwardReady,forwardMature,automaticPromotionAllowed:false,automaticDemotionAllowed:false,nextPhase:dataCurrent&&forwardMature?'T2_SEGMENT_CALIBRATION_REVIEW':'T1_DATA_REFRESH_AND_FORWARD_ACCUMULATION'},
    authority:{probabilityChanged:false,qualityGateChanged:false,stakeChanged:false,settlementContractChanged:false,historicalRowsRewritten:false,automaticPromotion:false,automaticDemotion:false},
    hardErrors,warnings
  };
  console.log(JSON.stringify(report,null,2));
  if(!report.success) process.exitCode=2;
} finally { db.close(); }
