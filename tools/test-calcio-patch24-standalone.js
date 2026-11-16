'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ai = require('../backend/calcioAiFinalization');
const index = require('../backend/calcioUnifiedPredictionIndex');
const selection = require('../backend/calcioProfessionalSelection');
const sourceIntel = require('../backend/calcioSourceIntelligence');
const registry = require('../backend/calcioPatchRegistry');

const PATCH = 'BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
const checks = [];
function check(name, fn) { checks.push(Promise.resolve().then(fn).then(details => ({ name, ok: true, details }))); }
function cert(market='O2.5', odd=1.97, key='onexbet') {
  return {
    market, status:'CERTIFIED_MULTI_SOURCE', certified:true, operationalEligible:true,
    realDirect:true, crossVerified:true, sourceCount:3, selectedPrice:odd,
    selectedSource:{bookmakerKey:key,bookmakerTitle:key.includes('betfair')?'Betfair':'1xBet',marketKey:['1','X','2'].includes(market)?'h2h':'totals',outcomeName:market,price:odd,direct:true,derived:false,lastUpdate:'2026-07-24T07:00:00Z'},
    sources:[{bookmakerKey:'a',price:odd},{bookmakerKey:'b',price:odd-.02},{bookmakerKey:'c',price:odd-.03}]
  };
}
function base(o={}) {
  return {
    home:'Alpha', away:'Beta', providerHome:'Alpha', providerAway:'Beta',
    decisionIdentity:{certified:true}, requireIdentityCertification:true,
    prediction:'O2.5', odd:1.97, probability:54.72, estimated_prob:54.72,
    edge_pp:2.97, ev_pct:5.85, reliabilityScore:74, bankroll:2003.69,
    deepScanAction:'WATCHLIST LOW EDGE', modelProbabilityPct:56.1,
    monteCarloProbabilityPct:55.7, marketProbabilityPct:50.0,
    monteCarloStdErrorPp:.3, historicalSample:0, oddsCertification:cert(), ...o
  };
}

check('Canonical DeepScan uses conservative advisory and all authoritative fields are identical', () => {
  const r = ai.unifyDeepScanReport({
    success:true,
    action:'VIA LIBERA / VALUE',
    displayAction:'VALUE CONFERMATO / MICRO',
    deepScanAdvisory:{mode:'WAIT_IN_PLAY'},
    deepScanOperationalGate:{allowBet:false,status:'SOFT_WATCHLIST'}
  }, {edgePp:3,reliabilityScore:70});
  assert.equal(r.action,'ATTENDI IN-PLAY');
  assert.equal(r.action,r.displayAction);
  assert.equal(r.action,r.ipmAction);
  assert.equal(r.action,r.persistedAction);
  assert.equal(r.rawAction,'VIA LIBERA / VALUE');
  return r.canonicalDeepScan;
});

check('Hard structural risk has precedence over a positive quantitative report', () => {
  const r=ai.unifyDeepScanReport({action:'VIA LIBERA / VALUE',deepScanAdvisory:{mode:'CONFIRM_PRONOSTICO'},deepScanOperationalGate:{allowBet:false,status:'HARD_IDENTITY_BLOCK'}},{});
  assert.equal(r.action,'ALTO RISCHIO');
  return r.canonicalDeepScan;
});

check('Top three markets are all finalized exactly once and winner is selected only after final ranking', async () => {
  const candidates=['1','O2.5','U2.5'].map((prediction,i)=>({prediction,odd:1.8+i*.1,candidate_selection_score:90-i}));
  const calls=new Map();
  const result=await ai.finalizeTopMarkets({
    candidates, selectedPrediction:'1', selectedReport:{success:true,action:'VIA LIBERA',deepScanAdvisory:{mode:'CONFIRM_PRONOSTICO'}}, topN:3,
    scanCandidate:async c=>({success:true,action:'VIA LIBERA',deepScanAdvisory:{mode:'CONFIRM_PRONOSTICO'},prediction:c.prediction}),
    finalizeCandidate:async(c,raw)=>{
      calls.set(c.prediction,(calls.get(c.prediction)||0)+1);
      const report=ai.unifyDeepScanReport(raw,{edgePp:5,reliabilityScore:75});
      const score=c.prediction==='O2.5'?72:c.prediction==='1'?68:61;
      return {candidate:c,report,decision:{score,rankValue:score*1000,operationalStake:5,eligible:true},evidence:{resolved:0}};
    }
  });
  assert.equal(result.finalizedCount,3);
  assert.equal(result.fullyFinalized,true);
  assert.equal(result.winner.candidate.prediction,'O2.5');
  assert.deepEqual(Object.fromEntries(calls),{'1':1,'O2.5':1,'U2.5':1});
  return {ranking:result.ranking,calls:Object.fromEntries(calls)};
});

check('Final market certification promotes the actual final winner without a reselection veto', () => {
  const audit={fullyFinalized:true,finalRanking:[
    {prediction:'O2.5',score:72,finalized:true},
    {prediction:'1',score:68,finalized:true},
    {prediction:'U2.5',score:61,finalized:true}
  ]};
  const r=selection.finalizeSelectedMarket('1',{score:68},audit);
  assert.equal(r.status,'BEST_MARKET_FULLY_CERTIFIED');
  assert.equal(r.selectedPrediction,'O2.5');
  assert.equal(r.reselectionRequired,false);
  return r;
});

check('Portfolio caps run only on fully finalized eligible rows and respect all aggregate limits', () => {
  const rows=[
    {id:1,odd:4.5,commence_time:'2026-08-23T18:45:00Z',calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,predictionIndex:{score:80,eligible:true,prePortfolioCapStake:20,theoreticalStake:20,operationalStake:20,netExecutableOdd:4.5}},
    {id:2,odd:1.8,commence_time:'2026-08-23T18:45:00Z',calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,predictionIndex:{score:75,eligible:true,prePortfolioCapStake:30,theoreticalStake:30,operationalStake:30,netExecutableOdd:1.8}},
    {id:3,odd:1.9,commence_time:'2026-08-24T18:45:00Z',calcio_ai_finalization_status:'AWAITING_DEEPSCAN_TOP3_FINALIZATION',calcio_market_ranking_certified:0,predictionIndex:{score:75,eligible:true,prePortfolioCapStake:30,theoreticalStake:30,operationalStake:30,netExecutableOdd:1.9}}
  ];
  const r=selection.applyPortfolioExposureCaps(rows,1000,[],{totalExposurePct:5,longshotExposurePct:1,kickoffExposurePct:2});
  const provisional=r.candidates.find(x=>x.id===3);
  assert.equal(Number(provisional.operationalStake),0);
  assert(r.allocated.total<=50.001);
  assert(r.allocated.longshot<=10.001);
  assert(Object.values(r.allocated.kickoff).every(v=>v<=20.001));
  return r;
});

check('Edge, EV, Kelly and profit use the same net Betfair odd', () => {
  const r=index.evaluatePrediction(base({prediction:'2',odd:3.85,probability:29.97,estimated_prob:29.97,modelProbabilityPct:30.3,monteCarloProbabilityPct:31.5,marketProbabilityPct:26.2,edge_pp:2.99,ev_pct:11.53,deepScanAction:'VALUE CONFERMATO / MICRO',oddsCertification:cert('2',3.85,'betfair_ex_eu')}));
  assert.equal(r.netExecutableOdd,3.7075);
  const expectedEv=(r.probabilityPct/100*r.netExecutableOdd-1)*100;
  assert(Math.abs(r.evPct-expectedEv)<.02,JSON.stringify({actual:r.evPct,expectedEv}));
  assert(Math.abs(r.edgePp-(r.probabilityPct-(100/r.netExecutableOdd)))<.02);
  assert(Math.abs(r.estimatedProfit-r.operationalStake*(r.netExecutableOdd-1))<.02);
  return {netOdd:r.netExecutableOdd,edge:r.edgePp,ev:r.evPct,kelly:r.fullKellyPct,stake:r.operationalStake,profit:r.estimatedProfit};
});

check('Monte Carlo is distribution-only and model is the central estimate', () => {
  const d=index.probabilityDiagnostics(base({modelProbabilityPct:55,monteCarloProbabilityPct:65,marketProbabilityPct:52,monteCarloStdErrorPp:1.2}),'O2.5');
  assert.equal(d.monteCarloRole,'DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE');
  assert.equal(d.modelCenterPct,55);
  assert(String(d.source).includes('MODEL_CENTER_MARKET_EXTERNAL'));
  return d;
});

check('Operational state aligns all fields and PT absence remains explicit but neutral', () => {
  const p=index.paperTradingComponent({historicalSample:0},1.8);
  const state=ai.operationalState({operationalStake:5,eligible:true,safetyReasons:[]},{resolved:0},{strategy_tag:'CALCIO_ANALYSIS_ONLY'});
  assert.equal(p.score,50);
  assert.equal(state.analysisOnly,false);
  assert.equal(state.calcio_analysis_only,0);
  assert.equal(state.prediction_visibility,'OPERATIONAL_CANDIDATE');
  assert.equal(state.exposure_role,'PRIMARY_OPERATIONAL');
  assert(state.strategy_tag.endsWith('_OPERATIONAL'));
  assert.equal(state.ptCertificationStatus,'PT_ABSENT_NEUTRAL');
  assert(state.certificationLabel.includes('PT ASSENTE'));
  return {paperTrading:p,state};
});

check('Output coherence requires canonical action, net math, final ranking and operational role', () => {
  const report=ai.unifyDeepScanReport({action:'VALUE CONFERMATO',deepScanAdvisory:{mode:'CONFIRM_PRONOSTICO'}},{});
  const decision={probabilityPct:60,netExecutableOdd:1.8,evPct:8,operationalStake:5,estimatedProfit:4,eligible:true};
  const state=ai.operationalState(decision,{resolved:0},{});
  const marketFinalization={fullyFinalized:true};
  const ok=ai.assertOutputCoherence({report,decision,state,displayedEvPct:8,persistedAction:report.action,marketFinalization});
  assert.equal(ok.certified,true,JSON.stringify(ok));
  const bad=ai.assertOutputCoherence({report:{...report,displayAction:'WATCHLIST LOW EDGE'},decision,state,displayedEvPct:9,persistedAction:report.action,marketFinalization:{fullyFinalized:false}});
  assert.equal(bad.certified,false);
  return {ok,bad};
});

check('Semantic news filter rejects non-football medical contamination and accepts real football evidence', () => {
  const now=new Date('2026-07-24T08:00:00Z');
  const fake=sourceIntel.assessArticle({title:'Mitchell Robinson possibly out for all of 2024 with injury Torino vs Sassuolo',fullText:'NBA New York Knicks basketball injury',pubDate:'2026-07-22T08:00:00Z',sourceName:'Mshale'},'Torino',{now,kickoff:'2026-08-23T18:45:00Z'});
  const real=sourceIntel.assessArticle({title:'Torino defender ruled out of Serie A match after training injury',fullText:'The football club confirmed the first-team defender will miss the match.',pubDate:'2026-07-22T08:00:00Z',sourceName:'Sky Sports'},'Torino',{now,kickoff:'2026-08-23T18:45:00Z'});
  assert.equal(fake.usable,false);
  assert.equal(fake.nonFootballContext,true);
  assert.equal(real.usable,true);
  assert.equal(real.semanticFootballContext,true);
  return {fake:{usable:fake.usable,reason:fake.nonFootballContext},real:{usable:real.usable,football:real.footballContext}};
});

check('Frontend renders PT n=0 as N/D and mirrors remain aligned', () => {
  const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
  const mirror=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');
  assert.equal(app,mirror);
  assert(app.includes("const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D'"));
  assert(app.includes("const ciText = resolvedSample > 0"));
  return {bytes:Buffer.byteLength(app),markers:true};
});

check('Server enforces one final IPM evaluation per market, post-final caps and one transaction', () => {
  const server=fs.readFileSync(path.resolve(__dirname,'../backend/server.js'),'utf8');
  const route=server.slice(server.indexOf("app.post('/api/calcio/deepscan'"),server.indexOf("// /CALCIO_PATCH4_STRICT_SPORT_IDENTITY"));
  assert(route.includes('finalizeTopMarkets'));
  assert.equal((route.match(/reconcileStakeRow\(/g)||[]).length,1);
  assert.equal((route.match(/resolveHistoricalCombinationEvidence\(/g)||[]).length,1);
  assert(route.indexOf('applyPortfolioExposureCaps')>route.indexOf('finalizeTopMarkets'));
  assert(route.includes('commitFinalization = db.transaction'));
  assert(route.includes('calcio_market_ranking_certified'));
  assert(route.includes('calcio_deepscan_canonical_audit'));
  const pre=server.slice(server.indexOf('globalValueBetsSingle = calcioProfessionalSelection.rankCandidates'),server.indexOf('diagnostics.savedAttempts',server.indexOf('globalValueBetsSingle = calcioProfessionalSelection.rankCandidates')));
  assert(!pre.includes('applyPortfolioExposureCaps'));
  assert(pre.includes('AWAITING_DEEPSCAN_TOP3_FINALIZATION'));
  return {routeReconcileCalls:1,routeEvidenceCalls:1,postFinalCaps:true,transactional:true};
});

check('Registry advances to Patch 24 preserving R2 compact payload and certified safeguards', () => {
  assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION,'24');
  const p=registry.PATCHES.find(x=>x.version==='24');
  assert(p);
  assert.equal(p.canonicalDeepScanActionRequired,true);
  assert.equal(p.singleFinalIpmKellyEvaluationPerMarket,true);
  assert.equal(p.postFinalizationPortfolioCaps,true);
  assert.equal(p.atomicBatchFinalizationTransaction,true);
  assert.equal(p.newOddsApiCalls,0);
  return p;
});

Promise.all(checks).then(results=>{
  console.log(JSON.stringify({success:true,patch:PATCH,version:ai.CALCIO_AI_FINALIZATION_VERSION,checks:results},null,2));
}).catch(error=>{console.error(error.stack||error);process.exit(1);});
