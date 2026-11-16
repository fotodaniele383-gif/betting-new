'use strict';
const assert=require('assert/strict');
const Database=require('./sqlite-compat');
const finalization=require('../backend/calcioAiFinalization');
const selection=require('../backend/calcioProfessionalSelection');
const isolation=require('../backend/calcioEventFinalizationIsolation');

function candidate(prediction,score,eligible,odd=1.9){
 return {id:prediction,home:'Torino',away:'AC Milan',home_team:'Torino',away_team:'AC Milan',prediction,odd,estimatedProb:55,edge_pp:3,ev_pct:5,match_exposure_key:'EVT_A',calcio_event_key:'EVT_A',predictionIndex:{score,rankValue:score*1000,theoreticalStake:eligible?4:0,prePortfolioCapStake:eligible?4:0,operationalStake:eligible?4:0,eligible,netExecutableOdd:odd,components:{paperTrading:{sample:0}}}};
}
(async()=>{
 const all=[candidate('O2.5',61.9,true,1.97),candidate('U2.5',58,false,1.83),candidate('1',55,false,2.2),candidate('X',50,false,3.2),candidate('2',48,false,3.5)];
 const eligible=all.filter(x=>x.predictionIndex.eligible);
 const provisional=selection.selectPrimary(eligible).selected;
 const full=isolation.buildFullCandidateAudit(all,provisional,selection);
 assert.equal(full.candidatePoolCount,5);
 assert.equal(full.eligibleCandidateCount,1);
 assert.equal(full.audit.candidateCount,5);
 assert.equal(full.audit.finalizationCandidates.length,3);
 const plan=finalization.planFromAudit(full.audit,provisional,3);
 assert.equal(plan.length,3,'ONE_ELIGIBLE_FOUR_ANALYSIS deve conservare il TOP3');
 const result=await finalization.finalizeTopMarkets({
   candidates:plan,selectedPrediction:provisional.prediction,selectedReport:{success:true,action:'WATCHLIST LOW EDGE',displayAction:'WATCHLIST LOW EDGE',ipmAction:'WATCHLIST LOW EDGE',persistedAction:'WATCHLIST LOW EDGE'},topN:3,
   scanCandidate:async c=>({success:true,action:'WATCHLIST LOW EDGE',displayAction:'WATCHLIST LOW EDGE',ipmAction:'WATCHLIST LOW EDGE',persistedAction:'WATCHLIST LOW EDGE'}),
   finalizeCandidate:async(c,r)=>({candidate:c,report:r,decision:{score:Number(c.provisionalPredictionIndex?.score||c.candidate_selection_score||50),rankValue:Number(c.provisionalPredictionIndex?.rankValue||50000),operationalStake:0,eligible:false}})
 });
 assert.equal(result.candidateCount,3);
 assert.equal(result.finalizedCount,3);
 assert.equal(result.directFinalizedCount,3);
 assert.equal(result.fullyFinalized,true);

 const single=await finalization.finalizeTopMarkets({
   candidates:[plan[0]],selectedPrediction:plan[0].prediction,selectedReport:{success:true,action:'WATCHLIST LOW EDGE'},topN:3,
   finalizeCandidate:async(c,r)=>({candidate:c,report:r,decision:{score:60,rankValue:60000,operationalStake:0,eligible:false}})
 });
 assert.equal(single.candidateCount,1);
 assert.equal(single.singleMarketFinalized,true);
 assert.equal(single.fullyFinalized,false);
 assert.equal(single.status,'MARKET_SINGLE_DIRECT_FINALIZED');

 const degraded=await finalization.finalizeTopMarkets({
   candidates:plan.slice(0,2),selectedPrediction:plan[0].prediction,selectedReport:{success:true,action:'WATCHLIST LOW EDGE'},topN:2,
   scanCandidate:async()=>{throw new Error('fixture timeout');},
   finalizeCandidate:async(c,r)=>({candidate:c,report:r,decision:{score:55,rankValue:55000,operationalStake:0,eligible:false}})
 });
 assert.equal(degraded.projectedCount,1);
 assert.equal(degraded.fullyFinalized,false,'Una proiezione non può certificare il ranking completo');

 const current={...candidate('O2.5',62,true,1.97),id:1,calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,calcio_prediction_index_eligible:1,calcio_theoretical_stake:4,calcio_operational_stake:4,stake:4};
 const other={...candidate('U2.5',65,true,1.7),id:2,match_exposure_key:'EVT_B',calcio_event_key:'EVT_B',calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,calcio_prediction_index_eligible:1,calcio_theoretical_stake:8,calcio_operational_stake:8,stake:8};
 const allocation=isolation.allocateCurrentEventOnly({currentRow:current,latestRows:[current,other],bankroll:2003.69,professionalSelection:selection});
 assert.equal(allocation.candidates.length,1);
 assert.equal(allocation.currentEventKey,'EVT_A');
 assert.equal(allocation.portfolioBatchCertified,false);
 assert.equal(other.stake,8,'La preview locale non deve mutare gli altri eventi');

 const before=[{id:1,calcio_event_key:'EVT_A',stake:0},{id:2,calcio_event_key:'EVT_B',stake:8}];
 const afterCurrent=[{id:1,calcio_event_key:'EVT_A',stake:4},{id:2,calcio_event_key:'EVT_B',stake:8}];
 assert.deepEqual(isolation.assertOnlyCurrentEventMutated(before,afterCurrent,'EVT_A').mutatedEventKeys,['EVT_A']);
 assert.throws(()=>isolation.assertOnlyCurrentEventMutated(before,[{id:1,calcio_event_key:'EVT_A',stake:4},{id:2,calcio_event_key:'EVT_B',stake:7}],'EVT_A'),/CROSS_EVENT_WRITE/);

 console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',checks:['ONE_ELIGIBLE_FOUR_ANALYSIS full pool','TOP3 direct finalization','single market no crash','degraded projection not fully certified','event-local cap preview','cross-event mutation guard']},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
