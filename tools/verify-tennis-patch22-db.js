'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const readiness = require('../backend/tennisTourDataReadiness');
const intelligence = require('../backend/tennisMatchupIntelligence');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch22');
const reportPath = path.join(auditDir, 'patch22_db_verification_report.json');
const EXPECTED = {
  tennis_player_evidence_snapshots: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_status','activity_days','source_freshness_penalty','activity_penalty'],
  tennis_matchup_feature_snapshots: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_risk_status'],
  tennis_challenger_predictions: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_risk_status']
};
function count(db, table){try{return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n||0);}catch(_){return 0;}}
function cols(db, table){return db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);}
function stable(value){if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;return JSON.stringify(value);}
function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');}
function canary(){
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    intelligence.ensureMatchupIntelligenceSchema(db);
    const now='2026-07-20T08:00:00.000Z';
    const makeEvidence=(side,name,opponent)=>{const core={version:'TENNIS_PLAYER_EVIDENCE_V5_PATCH22',status:'VERIFIED_CURRENT',reason:'PATCH22_CANARY',sourceTier:'PATCH22_CANARY',playerName:name,normalizedName:name.toUpperCase(),opponentName:opponent,surface:'Hard',asOfAt:now,observedAt:'2026-07-13T12:00:00.000Z',freshnessStatus:'CURRENT',freshnessDays:7,sourceTargetId:'ATP_MAIN',sourceProviderId:'TENNISMYLIFE_BULK',sourceFreshnessStatus:'CURRENT',sourceFreshnessDays:7,sourceFreshnessPenalty:0,activityStatus:'RESTED',activityDays:22,activityPenalty:4,sourceFreshnessSeparateFromPlayerActivity:true,sourceFiles:[],sampleTotal:20,sampleSurface:12,sampleRecent:8,coverageScore:90,confidenceScore:84,overallElo:1600,surfaceElo:1610,recentWinRate:0.625,surfaceWinRate:0.66,servePointsWon:0.64,returnPointsWon:0.38,restDays:22,matches7d:0,matches14d:1,minutes14d:90,fatigueScore:10,retirement90d:0,side};return {...core,evidenceHash:hash(core)};};
    const p1=makeEvidence('P1','Canary Alpha','Canary Beta');
    const p2=makeEvidence('P2','Canary Beta','Canary Alpha');
    const matchupCore={version:'TENNIS_MATCHUP_FEATURE_V4_PATCH22',status:'OK',problems:[],player1:'Canary Alpha',player2:'Canary Beta',surface:'Hard',asOfAt:now,matchupLabel:'MATCHUP_ADVANTAGE_PLAYER_1',coverageScore:90,confidenceScore:82,sourceTargetId:'ATP_MAIN',sourceProviderId:'TENNISMYLIFE_BULK',sourceFreshnessStatus:'CURRENT',sourceFreshnessDays:7,activityRiskStatus:'NORMAL',featureProbabilityP1:0.61,featureProbabilityP2:0.39,p1ServeMatchup:0.11,p2ServeMatchup:-0.11,h2h:{p1Wins:0,p2Wins:0},components:[],p1EvidenceHash:p1.evidenceHash,p2EvidenceHash:p2.evidenceHash};
    const matchup={...matchupCore,featureHash:hash(matchupCore),p1,p2};
    const challengerCore={version:'TENNIS_CHALLENGER_MATCHUP_V3_PATCH22',mode:'SHADOW_ONLY_NO_STAKE_AUTHORITY',status:'SHADOW_ALIGNED',player1:'Canary Alpha',player2:'Canary Beta',prediction:'1',marketType:'h2h',asOfAt:now,marketProbabilityP1:55,marketProbabilityP2:45,productionProbabilityP1:60,productionProbabilityP2:40,challengerProbabilityP1:61,challengerProbabilityP2:39,selectedSide:'P1',selectedProductionProbability:60,selectedChallengerProbability:61,probabilityDeltaPp:1,uncertaintyLowPct:53,uncertaintyHighPct:69,confidenceScore:82,coverageScore:90,matchupLabel:matchup.matchupLabel,matchupStatus:matchup.status,matchupFeatureHash:matchup.featureHash};
    const challenger={...challengerCore,predictionHash:hash(challengerCore),matchup};
    db.exec('BEGIN');
    const result=intelligence.persistMatchupIntelligenceForBet(db,{id:922001,home_team:'Canary Alpha',away_team:'Canary Beta',match_date:now,tour_type:'ATP',market_type:'h2h',prediction:'1',estimated_prob:60},{home:'Canary Alpha',away:'Canary Beta',date:now,tour_type:'ATP',surface:'Hard',prediction:'1',estimatedProb:60,playerMatchupIntelligence:{matchup,challenger}},{snapshotId:'TPS22_CANARY',operationId:'PATCH22_DB_CANARY'});
    const evidence=db.prepare('SELECT source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_status,activity_days FROM tennis_player_evidence_snapshots ORDER BY player_side').all();
    const match=db.prepare('SELECT source_target_id,source_freshness_status,activity_risk_status FROM tennis_matchup_feature_snapshots').get();
    const challenge=db.prepare('SELECT source_target_id,source_freshness_status,activity_risk_status FROM tennis_challenger_predictions').get();
    let updateBlocked=false,deleteBlocked=false;
    try{db.prepare("UPDATE tennis_player_evidence_snapshots SET source_freshness_status='STALE'").run();}catch(_){updateBlocked=true;}
    try{db.prepare('DELETE FROM tennis_challenger_predictions').run();}catch(_){deleteBlocked=true;}
    db.exec('ROLLBACK');
    return {success:result.persisted===true&&evidence.length===2&&evidence.every(x=>x.source_freshness_status==='CURRENT'&&x.activity_status==='RESTED')&&match.activity_risk_status==='NORMAL'&&challenge.source_target_id==='ATP_MAIN'&&updateBlocked&&deleteBlocked,inside:{evidence,match,challenge},updateBlocked,deleteBlocked,rollbackCounts:{evidence:count(db,'tennis_player_evidence_snapshots'),matchup:count(db,'tennis_matchup_feature_snapshots'),challenger:count(db,'tennis_challenger_predictions')}};
  } finally { db.close(); }
}
if(!fs.existsSync(dbPath)) throw new Error(`PATCH22_DB_MISSING:${dbPath}`);
fs.mkdirSync(auditDir,{recursive:true});
const db=new Database(dbPath,{fileMustExist:true,readonly:true});
try{
  const integrity=db.pragma('integrity_check',{simple:true});
  const sourceRows=count(db,'ai_forward_test');
  const tennisRows=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
  const missing=Object.fromEntries(Object.entries(EXPECTED).map(([t,expected])=>[t,expected.filter(c=>!cols(db,t).includes(c))]));
  const counts=Object.fromEntries(Object.keys(EXPECTED).map(t=>[t,count(db,t)]));
  const health=readiness.buildReadinessHealth(db,{dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root});
  const c=canary();
  const success=integrity==='ok'&&sourceRows>0&&tennisRows>0&&Object.values(missing).every(x=>x.length===0)&&health.success===true&&health.sourceFreshnessNotMasked===true&&c.success===true;
  const report={success,patch:'22',integrity,sourceRows,tennisRows,counts,missingColumns:missing,readiness:{status:health.status,targets:health.targets,tours:health.tours,forwardStatus:health.forwardStatus,sourceFreshnessNotMasked:health.sourceFreshnessNotMasked},canary:c,readOnly:true,databaseRowsModified:0,generatedAt:new Date().toISOString()};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); if(!success)process.exitCode=2;
}finally{db.close();}
