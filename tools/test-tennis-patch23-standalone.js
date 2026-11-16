#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
const registry = require('../backend/tennisPatchRegistry');

function dbFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ai_forward_test (
    id INTEGER PRIMARY KEY, bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT,
    prediction TEXT, odd REAL, stake REAL, status TEXT, profit REAL, estimated_prob REAL,
    edge REAL, edge_pp REAL, ev_pct REAL, league TEXT, strategy_tag TEXT, sport_type TEXT,
    ds_action TEXT, ds_suggestion TEXT, deep_scan_risk_level TEXT,
    reference_odd1 REAL, reference_odd2 REAL, reference_market_source TEXT,
    reference_market_quality TEXT, market_type TEXT, surface TEXT,
    tennis_canonical_match_key TEXT, tennis_event_fingerprint TEXT, provider_event_id TEXT,
    settlement_contract_status TEXT, settlement_source TEXT, settlement_evidence_hash TEXT
  );`);
  const ins = db.prepare(`INSERT INTO ai_forward_test VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run(1,'SINGLE_TENNIS','2026-07-20T12:00:00Z','Karolina Muchova','Linda Noskova','1',1.8,2,'PENDING',null,62,6,6,11.6,'WTA Prague','TENNIS_WTA_MONEYLINE','TENNIS','VALUE CONFERMATO','OK','OK',1.8,2.1,'ODDS_API','STRUCTURED','moneyline','Hard','wta-key','wta-fp','wta-event',null,null,null);
  ins.run(2,'SINGLE_TENNIS','2026-07-21T12:00:00Z','Jannik Sinner','Carlos Alcaraz','1',1.7,2,'PENDING',null,65,8,8,18,'ATP Wimbledon','TENNIS_ATP_MONEYLINE','TENNIS','EDGE TECNICO','OK','OK',1.7,2.2,'ODDS_API','STRUCTURED','moneyline','Grass','atp-key','atp-fp','atp-event',null,null,null);
  ins.run(3,'SINGLE_TENNIS','2026-07-01T12:00:00Z','Legacy A','Legacy B','1',1.9,2,'WON',1.8,60,5,5,14,'ATP Test','TENNIS_ATP_MONEYLINE','TENNIS','RISCHIO MODELLO','OK','RISCHIO MODELLO',1.9,2.0,'ODDS_API','STRUCTURED','moneyline','Hard','legacy-key','legacy-fp','legacy-event','VERIFIED','ODDS_API_SCORES','a'.repeat(64));
  retrieval.ensureInformationRetrievalSchema(db);
  return db;
}
function readiness() {
  return { success:true,status:'MIXED_CURRENT_STALE',version:'TENNIS_TOUR_DATA_READINESS_V1_PATCH22',sourceFreshnessNotMasked:true,targets:[
    {targetId:'ATP_MAIN',tour:'ATP',status:'CURRENT',dataAgeDays:7.9,latestMatchAt:'2026-07-12T12:00:00.000Z',providerId:'TENNISMYLIFE_BULK'},
    {targetId:'ATP_QUAL_CHALL',tour:'ATP',status:'CURRENT',dataAgeDays:6.9,latestMatchAt:'2026-07-13T12:00:00.000Z',providerId:'TENNISMYLIFE_BULK'},
    {targetId:'WTA_MAIN',tour:'WTA',status:'STALE',dataAgeDays:55.9,latestMatchAt:'2026-05-25T12:00:00.000Z',providerId:'LAST_KNOWN_GOOD'}
  ],tours:[] };
}
const aggregate = {status:'CURRENT',latestMatchAt:'2026-07-13T12:00:00.000Z',dataAgeDays:6.9,engine:{matchCount:31912,playerCount:2004,temporalLeakageGuard:true}};
const historical = {loaded:true,status:'READY_WITH_QUARANTINE',datasetId:'TEST',activeRecords:100,quarantinedRecords:1,seasons:{ATP:[2026,2025,2024],WTA:[2026,2025,2024]},linkCoveragePct:100,formatParity:'MATCH',warningCount:1,warningCodes:['TEST'],temporalLeakageGuard:true};
const opts = extra => ({tourDataReadinessReport:readiness(),playerDataHealth:aggregate,historicalPlayerStatsHealth:historical,...extra});

async function main() {
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({name,ok:true}); } catch (e) { checks.push({name,ok:false,error:e.message}); } };
  assert.strictEqual(registry.TENNIS_CURRENT_PATCH_VERSION, '23');
  const db = dbFixture();
  try {
    check('WTA stale not masked', () => {
      const ai = retrieval.auditAiAnalysisLocal(db, opts({players:['Karolina Muchova','Linda Noskova']}));
      const row = ai.checks.find(x=>x.sourceId==='AI_PLAYER_DATA_LOCAL');
      assert.strictEqual(row.details.targetId,'WTA_MAIN'); assert.strictEqual(row.details.status,'STALE'); assert.strictEqual(row.score,35); assert.strictEqual(row.details.aggregateCompatibility.status,'CURRENT'); assert.strictEqual(row.details.aggregateStatusIgnored,true);
    });
    check('ATP remains current', () => {
      const ai = retrieval.auditAiAnalysisLocal(db, opts({players:['Jannik Sinner','Carlos Alcaraz']}));
      const row = ai.checks.find(x=>x.sourceId==='AI_PLAYER_DATA_LOCAL');
      assert.strictEqual(row.details.targetId,'ATP_MAIN'); assert.strictEqual(row.status,'PASS'); assert.strictEqual(row.score,100);
    });
    check('Unknown scope fail closed', () => {
      const scope = retrieval.resolveProbeScope(db,['Unknown Player'],opts());
      assert.strictEqual(scope.resolutionFallback,'WORST_AVAILABLE_TARGET_FAIL_CLOSED'); assert.strictEqual(scope.status,'STALE');
    });
    check('Legacy schema without player columns is safe', () => {
      const legacy = new DatabaseSync(':memory:');
      try {
        legacy.exec(`CREATE TABLE ai_forward_test (id INTEGER PRIMARY KEY, sport_type TEXT, bet_type TEXT, strategy_tag TEXT, league TEXT, reference_odd1 REAL, reference_odd2 REAL, tennis_canonical_match_key TEXT, surface TEXT); INSERT INTO ai_forward_test VALUES (1,'TENNIS','SINGLE_TENNIS','TENNIS_ATP_MONEYLINE','ATP Test',1.9,2.1,'2026|ATP|A|B','Hard');`);
        assert.deepStrictEqual(retrieval.selectProbePlayers(legacy,2),[]);
        const ai = retrieval.auditAiAnalysisLocal(legacy,opts());
        assert.strictEqual(ai.probeScope.resolutionFallback,'WORST_AVAILABLE_TARGET_FAIL_CLOSED');
        assert(ai.checks.some(x=>x.sourceId==='AI_TENNISDB_HISTORICAL_PLAYER_STATS'));
      } finally { legacy.close(); }
    });
    check('Optional API excluded', () => {
      const paper = retrieval.auditPaperTradingLocal(db,{oddsApiConfigured:false});
      const odds = paper.checks.find(x=>x.sourceId==='PAPER_ODDS_API_SCORES');
      assert.strictEqual(odds.status,'OPTIONAL_NOT_CONFIGURED'); assert.strictEqual(odds.scoreExcluded,true); assert.strictEqual(odds.healthWeight,0); assert(paper.score>70);
    });
    check('Receipt uses WTA scope', () => {
      const row=db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
      const receipt=retrieval.buildPredictionEvidenceReceipt(db,row,row,opts({betId:1,snapshotId:'TPS7_PATCH23'}));
      assert.strictEqual(receipt.summary.playerDataTargetId,'WTA_MAIN'); assert.strictEqual(receipt.summary.playerDataStatus,'STALE'); assert(receipt.receiptId.startsWith('TIR23_'));
    });
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'patch23-cache-')); const cache=path.join(root,'cache_news'); fs.mkdirSync(cache);
    for(const name of ['Karolina Muchova','Linda Noskova','Jannik Sinner']) fs.writeFileSync(path.join(cache,name.toLowerCase().replace(/[^a-z0-9]+/g,'_')+'.json'),JSON.stringify({timestamp:Date.now(),articles:[{title:name+' tennis',fullText:name+' ready',pubDate:new Date().toUTCString()}]}));
    check('Probe and canary separated',()=>{ const deep=retrieval.auditDeepScanLocal(db,{cacheDir:cache,players:['Karolina Muchova','Linda Noskova'],canaryPlayers:['Jannik Sinner']}); assert.deepStrictEqual(deep.probePlayers,['Karolina Muchova','Linda Noskova']); assert.deepStrictEqual(deep.canaryPlayers,['Jannik Sinner']); assert.strictEqual(deep.checks[0].details.scoreUsesProbePlayersOnly,true); });
    fs.rmSync(root,{recursive:true,force:true});
  } finally { db.close(); }
  const failed=checks.filter(x=>!x.ok);
  console.log(JSON.stringify({success:failed.length===0,patch:'23',version:retrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION,checks},null,2));
  if(failed.length) process.exitCode=2;
}
main().catch(e=>{console.error(e.stack||e.message);process.exit(2);});
