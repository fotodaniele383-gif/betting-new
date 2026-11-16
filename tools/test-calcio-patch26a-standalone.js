'use strict';

const assert = require('assert/strict');
const Database = require('./sqlite-compat');
const obs = require('../backend/calcioObservability');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE ai_forward_test (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT,
    prediction TEXT, odd REAL, stake REAL, status TEXT, sport_type TEXT,
    paper_result_active INTEGER DEFAULT 1, paper_result_conflict INTEGER DEFAULT 0,
    match_exposure_key TEXT, calcio_event_key TEXT,
    calcio_operational_stake REAL, calcio_theoretical_stake REAL,
    calcio_prediction_index_score REAL, calcio_prediction_index_label TEXT,
    calcio_prediction_index_eligible INTEGER, ds_action TEXT,
    calcio_ai_finalization_status TEXT, calcio_market_finalized_count INTEGER,
    calcio_market_finalization_candidate_count INTEGER,
    calcio_output_coherence_status TEXT, calcio_runtime_consistency_status TEXT,
    calcio_finalization_transaction_id TEXT, calcio_finalization_transaction_status TEXT,
    calcio_stake_lifecycle_status TEXT, calcio_analysis_only INTEGER,
    prediction_visibility TEXT, exposure_role TEXT, strategy_tag TEXT
  );
`);
const insert = db.prepare(`INSERT INTO ai_forward_test
  (bet_type, match_date, home_team, away_team, prediction, odd, stake, status, sport_type,
   match_exposure_key, calcio_event_key, calcio_operational_stake, calcio_theoretical_stake,
   calcio_prediction_index_score, calcio_ai_finalization_status)
  VALUES ('SINGLE', ?, ?, ?, ?, ?, ?, 'PENDING', 'CALCIO', ?, ?, ?, ?, ?, ?)`);
insert.run('2026-08-23','Torino','AC Milan','O2.5',1.97,0,'EVT_A','EVT_A',0,4.22,61.9,'AWAITING_DEEPSCAN_TOP3_FINALIZATION');
insert.run('2026-08-22','Genoa','Napoli','U2.5',1.70,7.96,'EVT_B','EVT_B',7.96,7.96,61.16,'BEST_MARKET_FULLY_CERTIFIED');
obs.ensureSchema(db);

const batch = obs.startAnalysisBatch(db, { route:'/api/analyze', league:'serie_a', bankrollSnapshot:2003.69, requestDigest:'fixture' });
assert.match(batch.batchId, /^CALCIO_BATCH_/);
obs.completeAnalysisBatch(db, batch, { events:[{event_key:'EVT_A', prediction:'O2.5'},{event_key:'EVT_B', prediction:'U2.5'}] });
assert.equal(obs.resolveBatchIdForEvent ? typeof obs.resolveBatchIdForEvent : 'undefined', 'undefined');

const eventOne = obs.startEventFinalization(db, { eventKey:'EVT_A', betId:1, prediction:'O2.5' });
obs.updateEventPlan(db, eventOne, { candidatePoolCount:1, candidateSummary:[{prediction:'O2.5'}] });
db.prepare("UPDATE ai_forward_test SET calcio_prediction_index_label='MICRO' WHERE id=1").run();
const completionOne = obs.completeEventFinalization(db, eventOne, {
  ranking:[{prediction:'O2.5', finalized:true, finalizationMode:'DIRECT_MARKET_DEEPSCAN'}],
  transactionId:'TX_A', finalizationStatus:'SINGLE_MARKET_FINALIZED'
});
assert.equal(completionOne.crossEventWriteDetected, false);
assert.deepEqual(completionOne.mutatedEventKeys, ['EVT_A']);

const eventTwo = obs.startEventFinalization(db, { eventKey:'EVT_A', betId:1, prediction:'O2.5' });
obs.updateEventPlan(db, eventTwo, { candidatePoolCount:1, candidateSummary:[{prediction:'O2.5'}] });
db.prepare("UPDATE ai_forward_test SET calcio_prediction_index_label='VALUE' WHERE id IN (1,2)").run();
const completionTwo = obs.completeEventFinalization(db, eventTwo, { ranking:[], transactionId:'TX_CROSS' });
assert.equal(completionTwo.crossEventWriteDetected, true);
assert.deepEqual(completionTwo.mutatedEventKeys.sort(), ['EVT_A','EVT_B']);

const report = obs.buildDiagnosticsReport(db, { limit:20 });
assert.equal(report.success, true);
assert.equal(report.decisionAuthorityChanged, false);
assert.equal(report.stakeAuthorityChanged, false);
assert.equal(report.invariants.observedCrossEventWriteCount, 1);
assert.ok(report.anomalies.awaitingFinalization.some(row => row.eventKey === 'EVT_A'));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'calcio_ai_observation_%' ORDER BY name").all().map(r=>r.name);
assert.equal(tables.length, 4);

console.log(JSON.stringify({
  success:true,
  patch:'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE',
  version:obs.CALCIO_OBSERVABILITY_VERSION,
  checks:[
    'analysis batch identity',
    'event finalization identity',
    'candidate pool audit',
    'single-event mutation detection',
    'cross-event mutation detection',
    'read-only invariant report',
    'no decision or stake authority'
  ],
  diagnostics:{batchId:batch.batchId, first:completionOne, crossEvent:completionTwo, invariants:report.invariants}
},null,2));
db.close();
