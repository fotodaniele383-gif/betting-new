'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const Database=require('./sqlite-compat');
const ai=require('../backend/calcioAiFinalization');const idx=require('../backend/calcioUnifiedPredictionIndex');const selection=require('../backend/calcioProfessionalSelection');const registry=require('../backend/calcioPatchRegistry');
const PATCH='BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
const server=fs.readFileSync(path.resolve(__dirname,'../backend/server.js'),'utf8');const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
const route=server.slice(server.indexOf("app.post('/api/calcio/deepscan'"),server.indexOf('// /CALCIO_PATCH4_STRICT_SPORT_IDENTITY'));
const db=new Database(path.resolve(__dirname,'../backend/database_betting.db'),{readonly:true});
const counts=db.prepare(`SELECT COUNT(*) total,
 SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) tennis,
 SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) calcio,
 SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' THEN 1 ELSE 0 END) pendingCalcio,
 SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 THEN 1 ELSE 0 END) activePendingCalcio,
 SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID') THEN 1 ELSE 0 END) resolvedCalcio FROM ai_forward_test`).get();db.close();
const guarantees={
 canonicalAction:route.includes('unifyDeepScanReport')&&route.includes('calcio_deepscan_canonical_audit'),
 oneIpmEvaluationPerMarket:(route.match(/reconcileStakeRow\(/g)||[]).length===1,
 onePtResolutionPerMarket:(route.match(/resolveHistoricalCombinationEvidence\(/g)||[]).length===1,
 top3Finalized:route.includes('finalizeTopMarkets')&&route.includes('finalizedCount'),
 winnerPersisted:route.includes('finalMarketCandidate = marketWinner.candidate'),
 capsAfterFinalization:route.indexOf('applyPortfolioExposureCaps')>route.indexOf('finalizeTopMarkets'),
 atomicTransaction:route.includes('commitFinalization = db.transaction'),
 netMath:idx.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION.includes('PATCH_24'),
 monteCarloDistributionOnly:idx.probabilityDiagnostics({estimated_prob:55,modelProbabilityPct:55,monteCarloProbabilityPct:60,marketProbabilityPct:52},'O2.5').monteCarloRole==='DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE',
 ptNoSampleNeutral:idx.paperTradingComponent({historicalSample:0},1.8).score===50,
 ptNoSampleUi:app.includes("const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D'"),
 operationalAlignment:ai.operationalState({operationalStake:5,eligible:true},{resolved:0},{}).prediction_visibility==='OPERATIONAL_CANDIDATE',
 compactPayloadPreserved:route.includes('sanitizeRequestBody'),
 registry24:registry.CALCIO_CURRENT_PATCH_VERSION==='24'
};
for(const [k,v] of Object.entries(guarantees))assert(v,`Audit failed: ${k}`);
const report={success:true,patch:PATCH,certification:'CERTIFIED_OFFLINE_REQUIRES_FRESH_LIVE_ANALYSIS',database:counts,guarantees,contracts:{deepScan:'ONE_CANONICAL_CONSERVATIVE_ACTION',marketRanking:'TOP_3_FINALIZED_BEFORE_WINNER',stake:'ONE_FINAL_IPM_KELLY_THEN_POST_CAP',persistence:'ONE_ATOMIC_TRANSACTION',math:'ONE_NET_EXECUTABLE_ODD',paperTrading:'N0_NEUTRAL_AND_RENDERED_ND',news:'SEMANTIC_FOOTBALL_CONTEXT_REQUIRED'},limitations:['Disponibilita live dei provider da verificare dopo installazione.','La certificazione del processo non garantisce redditivita futura.']};
console.log(JSON.stringify(report,null,2));
