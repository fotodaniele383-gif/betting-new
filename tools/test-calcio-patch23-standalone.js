'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ai = require('../backend/calcioAiFinalization');
const index = require('../backend/calcioUnifiedPredictionIndex');
const selection = require('../backend/calcioProfessionalSelection');
const registry = require('../backend/calcioPatchRegistry');
const PATCH = 'BETTING_PATCH_23_CALCIO_AI_DETERMINISTIC_FINALIZATION_CERTIFICATION';
const checks = [];
function check(name, fn) { checks.push(Promise.resolve().then(fn).then(details => ({ name, ok: true, details }))); }
function cert(market='O2.5', odd=1.97, key='onexbet') {
  return { market, status:'CERTIFIED_MULTI_SOURCE', certified:true, operationalEligible:true, realDirect:true, crossVerified:true, sourceCount:3, selectedPrice:odd,
    selectedSource:{ bookmakerKey:key, bookmakerTitle:key.includes('betfair')?'Betfair':'1xBet', marketKey:['1','X','2'].includes(market)?'h2h':'totals', outcomeName:market, price:odd, direct:true, derived:false, lastUpdate:'2026-07-24T07:00:00Z' },
    sources:[{bookmakerKey:'a',price:odd},{bookmakerKey:'b',price:odd-.02},{bookmakerKey:'c',price:odd-.03}] };
}
function base(o={}) { return { home:'Alpha', away:'Beta', providerHome:'Alpha', providerAway:'Beta', decisionIdentity:{certified:true}, requireIdentityCertification:true,
  prediction:'O2.5', odd:1.97, probability:54.72, estimated_prob:54.72, edge_pp:2.97, ev_pct:5.85, reliabilityScore:74, bankroll:2003.69,
  deepScanAction:'WATCHLIST LOW EDGE', modelProbabilityPct:56.1, monteCarloProbabilityPct:55.7, marketProbabilityPct:51.2, monteCarloStdErrorPp:.3,
  historicalSample:0, oddsCertification:cert(), ...o }; }

check('DeepScan action is canonical and identical for IPM, display and persistence', () => {
  const r = ai.unifyDeepScanReport({success:true, action:'EDGE TECNICO', displayAction:'WATCHLIST'}, {edgePp:2.5,reliabilityScore:70});
  assert.equal(r.action, r.displayAction); assert.equal(r.action, r.unifiedAction); assert.equal(r.rawAction,'EDGE TECNICO');
  return r;
});
check('Top three markets are finalized and final ranking uses finalized IPM', async () => {
  const candidates = ['1','O2.5','U2.5'].map((prediction,i)=>({prediction, candidate_selection_score:90-i, odd:1.8+i*.1}));
  const result = await ai.finalizeTopMarkets({candidates, selectedPrediction:'1', selectedReport:{success:true,action:'WATCHLIST'}, topN:3,
    scanCandidate: async c=>({success:true,action:'WATCHLIST',prediction:c.prediction}),
    finalizeCandidate: async (c,r)=>({candidate:c,report:{...r,displayAction:r.action},decision:{score:c.prediction==='O2.5'?72:c.prediction==='1'?68:61,rankValue:c.prediction==='O2.5'?72000:c.prediction==='1'?68000:61000,operationalStake:5,eligible:true},evidence:{resolved:0}})
  });
  assert.equal(result.finalizedCount,3); assert.equal(result.fullyFinalized,true); assert.equal(result.winner.candidate.prediction,'O2.5');
  return result.ranking;
});
check('Portfolio caps are applied to final theoretical stakes after finalization', () => {
  const rows=[
    {id:1,odd:4.5,commence_time:'2026-08-23T18:45:00Z',predictionIndex:{score:80,prePortfolioCapStake:20,theoreticalStake:20,operationalStake:20,netExecutableOdd:4.5}},
    {id:2,odd:1.8,commence_time:'2026-08-23T18:45:00Z',predictionIndex:{score:75,prePortfolioCapStake:30,theoreticalStake:30,operationalStake:30,netExecutableOdd:1.8}},
    {id:3,odd:1.9,commence_time:'2026-08-24T18:45:00Z',predictionIndex:{score:70,prePortfolioCapStake:30,theoreticalStake:30,operationalStake:30,netExecutableOdd:1.9}}
  ];
  const r=selection.applyPortfolioExposureCaps(rows,1000,[],{totalExposurePct:5,longshotExposurePct:1,kickoffExposurePct:2});
  assert(r.allocated.total<=50.001); assert(r.allocated.longshot<=10.001); assert(Object.values(r.allocated.kickoff).every(v=>v<=20.001));
  return r.allocated;
});
check('Post-finalization portfolio persistence keeps the net executable odd', () => {
  const row={id:44,odd:3.85,calcio_net_executable_odd:3.7075,calcio_exchange_commission_pct:5,calcio_prediction_index_score:65,calcio_prediction_index_label:'MICRO',calcio_prediction_index_rank_value:65000,calcio_prediction_index_eligible:1,calcio_theoretical_stake:4.32,calcio_operational_stake:4.32,commence_time:'2026-08-24T16:30:00Z'};
  const r=selection.applyPortfolioExposureCaps([row],2003.69,[],{totalExposurePct:5,longshotExposurePct:1,kickoffExposurePct:2});
  const d=r.candidates[0].predictionIndex;
  assert.equal(d.netExecutableOdd,3.7075); assert(Math.abs(d.estimatedProfit-4.32*(3.7075-1))<.02);
  return {netOdd:d.netExecutableOdd,profit:d.estimatedProfit};
});
check('EV, Kelly and profit share the same net Betfair odd', () => {
  const r=index.evaluatePrediction(base({prediction:'2',odd:3.85,probability:29.97,estimated_prob:29.97,modelProbabilityPct:30.3,monteCarloProbabilityPct:31.5,marketProbabilityPct:26.2,ev_pct:11.53,oddsCertification:cert('2',3.85,'betfair_ex_eu')}));
  const expected=(r.probabilityPct/100*r.netExecutableOdd-1)*100;
  assert(Math.abs(r.evPct-expected)<.02, JSON.stringify({rEv:r.evPct,expected,prob:r.probabilityPct,net:r.netExecutableOdd})); assert(Math.abs(r.estimatedProfit-r.operationalStake*(r.netExecutableOdd-1))<.02);
  return {netOdd:r.netExecutableOdd,evPct:r.evPct,stake:r.operationalStake,profit:r.estimatedProfit};
});
check('Monte Carlo is distribution only and does not vote as an independent consensus source', () => {
  const d=index.probabilityDiagnostics(base({modelProbabilityPct:55,monteCarloProbabilityPct:65,marketProbabilityPct:52,monteCarloStdErrorPp:1.2}),'O2.5');
  assert.equal(d.monteCarloRole,'DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE'); assert(String(d.source).includes('MODEL_CENTER_MARKET_EXTERNAL'));
  return d;
});
check('Operational role fields are atomic and never remain ANALYSIS with positive stake', () => {
  const state=ai.operationalState({operationalStake:5,eligible:true,safetyReasons:[]},{resolved:0},{strategy_tag:'CALCIO_ANALYSIS_ONLY'});
  assert.equal(state.analysisOnly,false); assert.equal(state.prediction_visibility,'OPERATIONAL_CANDIDATE'); assert.equal(state.exposure_role,'PRIMARY_OPERATIONAL'); assert(state.strategy_tag.endsWith('_OPERATIONAL'));
  return state;
});
check('PT n=0 remains neutral but certification explicitly says PT absent', () => {
  const p=index.paperTradingComponent({historicalSample:0},1.8); const state=ai.operationalState({operationalStake:5,eligible:true},{resolved:0},{});
  assert.equal(p.score,50); assert.equal(state.ptCertificationStatus,'PT_ABSENT_NEUTRAL'); assert(state.certificationLabel.includes('PT ASSENTE'));
  return {paperTrading:p,state};
});
check('Output coherence guard detects any mismatch and certifies aligned output', () => {
  const decision={probabilityPct:60,netExecutableOdd:1.8,evPct:8,operationalStake:5,estimatedProfit:4,eligible:true};
  const state=ai.operationalState(decision,{resolved:0},{});
  const ok=ai.assertOutputCoherence({report:{action:'VALUE',displayAction:'VALUE'},decision,state,displayedEvPct:8,persistedAction:'VALUE'});
  assert.equal(ok.certified,true);
  const bad=ai.assertOutputCoherence({report:{action:'VALUE',displayAction:'WATCHLIST'},decision,state,displayedEvPct:9,persistedAction:'VALUE'});
  assert.equal(bad.certified,false);
  return {ok,bad};
});
check('Server contains one unified DeepScan path and atomic post-finalization cap transaction', () => {
  const server=fs.readFileSync(path.resolve(__dirname,'../backend/server.js'),'utf8');
  assert(server.includes('unifyDeepScanReport')); assert(server.includes('finalizeTopMarkets')); assert(server.includes('commitFinalization = db.transaction'));
  assert(server.lastIndexOf('applyPortfolioExposureCaps')>server.indexOf('finalizeTopMarkets'));
  assert(server.includes("displayAction = report.action"));
  return {markers:true};
});
check('Registry advances to Patch 23 with all requested guarantees', () => {
  assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION,'23'); const p=registry.PATCHES.find(x=>x.version==='23'); assert(p); assert.equal(p.fullFinalizationTransactional,true); assert.equal(p.monteCarloRole,'DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE'); return p;
});

Promise.all(checks).then(results=>console.log(JSON.stringify({success:true,patch:PATCH,version:ai.CALCIO_AI_FINALIZATION_VERSION,checks:results},null,2))).catch(error=>{console.error(error.stack||error);process.exit(1);});
