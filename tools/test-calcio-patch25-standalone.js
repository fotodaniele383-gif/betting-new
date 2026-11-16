'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ai = require('../backend/calcioAiFinalization');
const index = require('../backend/calcioUnifiedPredictionIndex');
const selection = require('../backend/calcioProfessionalSelection');
const sourceIntel = require('../backend/calcioSourceIntelligence');
const registry = require('../backend/calcioPatchRegistry');
const payload = require('../backend/calcioDeepScanPayloadContract');

const PATCH = 'BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
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

check('WAIT_IN_PLAY remains timing advisory and never becomes a Calcio DeepScan action', () => {
  const r = ai.unifyDeepScanReport({
    success:true,
    action:'VIA LIBERA / VALUE',
    displayAction:'VALUE CONFERMATO / MICRO',
    deepScanAdvisory:{mode:'WAIT_IN_PLAY'},
    deepScanOperationalGate:{allowBet:true,status:'CALCIO_DEEPSCAN_APPROVED'}
  }, {edgePp:3,reliabilityScore:70});
  assert(!r.action.includes('ATTENDI'));
  assert(!r.action.includes('WAIT'));
  assert.equal(r.canonicalDeepScan.timingAdvisory,'WAIT_IN_PLAY');
  assert.equal(r.canonicalDeepScan.advisoryHasStakeAuthority,false);
  assert(Object.values(ai.ACTION_LABEL).includes(r.action));
  return {action:r.action,timing:r.canonicalDeepScan.timingAdvisory};
});

check('All authoritative DeepScan action fields are identical', () => {
  const r=ai.unifyDeepScanReport({action:'WATCHLIST / LOW EDGE',deepScanAdvisory:{mode:'WAIT_IN_PLAY'}},{edgePp:2.5,reliabilityScore:70});
  assert.equal(r.action,r.displayAction);
  assert.equal(r.action,r.ipmAction);
  assert.equal(r.action,r.persistedAction);
  assert.equal(r.action,'WATCHLIST LOW EDGE');
  return r.canonicalDeepScan;
});

check('A true alternative advisory conservatively becomes model risk', () => {
  const r=ai.unifyDeepScanReport({action:'VIA LIBERA / VALUE',deepScanAdvisory:{mode:'ALTERNATIVE_PRONOSTICO'}},{edgePp:5,reliabilityScore:80});
  assert.equal(r.action,'RISCHIO MODELLO');
  return r.canonicalDeepScan;
});

check('Legacy ATTENDI action is mapped to WATCHLIST in IPM and cannot create a new action class', () => {
  assert.equal(index.classifyDeepScan('ATTENDI IN-PLAY',''),'WATCHLIST');
  assert.equal(ai.classifyAction('ATTENDI IN-PLAY'),ai.ACTION_CLASS.WATCHLIST);
  assert(!Object.values(ai.ACTION_LABEL).includes('ATTENDI IN-PLAY'));
  return {indexClass:index.classifyDeepScan('ATTENDI IN-PLAY',''),labels:Object.values(ai.ACTION_LABEL)};
});

check('Top-3 finalization isolates an alternative market timeout and completes with shared match evidence', async () => {
  const candidates=[
    {prediction:'O2.5',odd:1.97,estimatedProb:54.72,edge_pp:2.97,ev_pct:5.85},
    {prediction:'U2.5',odd:1.90,estimatedProb:51.5,edge_pp:1.2,ev_pct:2.0},
    {prediction:'1',odd:2.30,estimatedProb:46,edge_pp:2.5,ev_pct:5.8}
  ];
  const selectedReport={success:true,action:'WATCHLIST / LOW EDGE',deepScanAdvisory:{mode:'WAIT_IN_PLAY'},riskLevel:'WATCHLIST_LOW_EDGE',pillars:[]};
  const calls=[];
  const result=await ai.finalizeTopMarkets({
    candidates,selectedPrediction:'O2.5',selectedReport,topN:3,
    scanCandidate:async c=>{
      calls.push(c.prediction);
      if(c.prediction==='U2.5'){const e=new Error('PROVIDER_TIMEOUT');e.code='TIMEOUT';throw e;}
      return {success:true,action:'VIA LIBERA / VALUE',deepScanAdvisory:{mode:'CONFIRM_PRONOSTICO'},riskLevel:'VIA_LIBERA'};
    },
    finalizeCandidate:async(c,raw)=>{
      const report=ai.unifyDeepScanReport(raw,{edgePp:c.edge_pp,reliabilityScore:72});
      const score=c.prediction==='1'?66:c.prediction==='O2.5'?64:58;
      return {candidate:c,report,decision:{score,rankValue:score*1000,operationalStake:score>=60?5:0,eligible:score>=60},evidence:{resolved:0}};
    }
  });
  assert.equal(result.finalizedCount,3);
  assert.equal(result.fullyFinalized,true);
  assert.equal(result.projectedCount,1);
  assert.equal(result.winner.candidate.prediction,'1');
  const projected=result.ranking.find(r=>r.prediction==='U2.5');
  assert.equal(projected.fallbackUsed,true);
  assert(!result.ranking.some(r=>String(r.deepScanAction).includes('ATTENDI')));
  return {calls,ranking:result.ranking};
});

check('Post-finalization caps normalize status, action and eligibility when allowed stake becomes zero', () => {
  const rows=[
    {id:1,event_key:'A',odd:1.8,commence_time:'2026-08-23T18:45:00Z',calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,predictionIndex:{score:80,eligible:true,status:'UNIFIED_INDEX_STAKE_AUTHORIZED',action:'BET_ALLOWED_UNIFIED_INDEX',prePortfolioCapStake:20,theoreticalStake:20,operationalStake:20,netExecutableOdd:1.8,reason:'pre'}},
    {id:2,event_key:'B',odd:1.9,commence_time:'2026-08-23T18:45:00Z',calcio_ai_finalization_status:'BEST_MARKET_FULLY_CERTIFIED',calcio_market_ranking_certified:1,predictionIndex:{score:70,eligible:true,status:'UNIFIED_INDEX_STAKE_AUTHORIZED',action:'BET_ALLOWED_UNIFIED_INDEX',prePortfolioCapStake:5,theoreticalStake:5,operationalStake:5,netExecutableOdd:1.9,reason:'pre'}}
  ];
  const r=selection.applyPortfolioExposureCaps(rows,1000,[],{totalExposurePct:5,longshotExposurePct:1,kickoffExposurePct:2});
  const second=r.candidates.find(x=>x.id===2).predictionIndex;
  assert.equal(second.operationalStake,0);
  assert.equal(second.eligible,false);
  assert.equal(second.status,'UNIFIED_INDEX_NO_STAKE');
  assert.equal(second.action,'ANALYSIS_ONLY_UNIFIED_INDEX');
  assert.equal(second.allowBet,false);
  return r;
});

check('Net Betfair EV, Kelly and profit still share one executable odd', () => {
  const r=index.evaluatePrediction(base({prediction:'2',odd:3.85,probability:29.97,estimated_prob:29.97,modelProbabilityPct:30.3,monteCarloProbabilityPct:31.5,marketProbabilityPct:26.2,edge_pp:2.99,ev_pct:11.53,deepScanAction:'VALUE CONFERMATO / MICRO',oddsCertification:cert('2',3.85,'betfair_ex_eu')}));
  assert.equal(r.netExecutableOdd,3.7075);
  const expectedEv=(r.probabilityPct/100*r.netExecutableOdd-1)*100;
  assert(Math.abs(r.evPct-expectedEv)<.02);
  assert(Math.abs(r.estimatedProfit-r.operationalStake*(r.netExecutableOdd-1))<.02);
  return {netOdd:r.netExecutableOdd,ev:r.evPct,kelly:r.fullKellyPct,stake:r.operationalStake,profit:r.estimatedProfit};
});

check('Monte Carlo remains distribution-only and PT n=0 remains neutral', () => {
  const d=index.probabilityDiagnostics(base({modelProbabilityPct:55,monteCarloProbabilityPct:65,marketProbabilityPct:52,monteCarloStdErrorPp:1.2}),'O2.5');
  const pt=index.paperTradingComponent({historicalSample:0},1.8);
  assert.equal(d.monteCarloRole,'DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE');
  assert.equal(d.modelCenterPct,55);
  assert.equal(pt.score,50);
  assert.equal(pt.status,'NO_SAMPLE_NEUTRAL');
  return {probability:d,paperTrading:pt};
});

check('Semantic news filter still rejects non-football contamination', () => {
  const now=new Date('2026-07-24T08:00:00Z');
  const fake=sourceIntel.assessArticle({title:'Mitchell Robinson possibly out with injury Torino vs Sassuolo',fullText:'NBA New York Knicks basketball injury',pubDate:'2026-07-22T08:00:00Z',sourceName:'Mshale'},'Torino',{now,kickoff:'2026-08-23T18:45:00Z'});
  const real=sourceIntel.assessArticle({title:'Torino defender ruled out of Serie A match after training injury',fullText:'The football club confirmed the first-team defender will miss the match.',pubDate:'2026-07-22T08:00:00Z',sourceName:'Sky Sports'},'Torino',{now,kickoff:'2026-08-23T18:45:00Z'});
  assert.equal(fake.usable,false);
  assert.equal(real.usable,true);
  return {fake:{usable:fake.usable,nonFootball:fake.nonFootballContext},real:{usable:real.usable}};
});

check('Compact DeepScan payload contract from Patch 23 R2 is preserved', () => {
  assert(payload.CLIENT_TARGET_BYTES<=65536);
  assert(payload.SERVER_MAX_BYTES===262144);
  const compact=payload.sanitizeRequestBody({homeTeam:'A',awayTeam:'B',prediction:'O2.5',odd:1.9,prob:55,extData:{huge:'x'.repeat(150000)}},{});
  assert(compact.diagnostics.compactBytes<65536);
  return compact.diagnostics;
});

check('Frontend separates API success from UI rendering errors and never certifies stake zero', () => {
  const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
  const mirror=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');
  assert.equal(app,mirror);
  assert(app.includes('let deepScanApiSucceeded = false'));
  assert(app.includes("if (deepScanApiSucceeded) badgeEl.innerHTML = '⚠️ UI'"));
  assert(app.includes('index.operationalStake >= 2'));
  assert(app.includes("const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D'"));
  return {bytes:Buffer.byteLength(app)};
});

check('Server preserves atomic transaction and rejects a missing current-row cap allocation', () => {
  const server=fs.readFileSync(path.resolve(__dirname,'../backend/server.js'),'utf8');
  const route=server.slice(server.indexOf("app.post('/api/calcio/deepscan'"),server.indexOf('// /CALCIO_PATCH4_STRICT_SPORT_IDENTITY'));
  assert(route.includes('finalizeTopMarkets'));
  assert(route.includes('commitFinalization = db.transaction'));
  assert(route.includes('PATCH25_CURRENT_ROW_NOT_INCLUDED_IN_POST_FINALIZATION_CAPS'));
  assert(route.includes('calcio_runtime_consistency_status'));
  assert(route.includes('calcio_deepscan_timing_advisory'));
  return {transactional:true,currentRowGuard:true};
});

check('Registry advances to Patch 25 without changing certified Tennis or API contracts', () => {
  assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION,'25');
  const p=registry.PATCHES.find(x=>x.version==='25');
  assert(p);
  assert.equal(p.waitInPlayIsTimingAdvisoryOnly,true);
  assert.equal(p.finalCapStateNormalization,true);
  assert.equal(p.patch23R2CompactPayloadPreserved,true);
  assert.equal(p.patch24AtomicTransactionPreserved,true);
  assert.equal(p.newOddsApiCalls,0);
  return p;
});

Promise.all(checks).then(results=>{
  console.log(JSON.stringify({success:true,patch:PATCH,version:ai.CALCIO_AI_FINALIZATION_VERSION,checks:results},null,2));
}).catch(error=>{console.error(error.stack||error);process.exit(1);});
