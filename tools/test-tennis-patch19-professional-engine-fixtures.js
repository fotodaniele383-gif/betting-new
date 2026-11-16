'use strict';
const assert = require('assert');
const Markov = require('../backend/markov');
const Simulation = require('../backend/simulation');
const Stage = require('../backend/tennisTournamentStageModel');
const Ensemble = require('../backend/tennisProfessionalStatisticalEnsemble');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, success: true }); }
  catch (error) { results.push({ name, success: false, error: error.message }); }
}

test('MARKOV_POINT_GAME_SET_MATCH_DETERMINISTIC', () => {
  const a = Markov.runProfessionalMarkovMatchModel({ pA:0.64,pB:0.60,sampleA:80,sampleB:70,iterations:1200,seed:19019 });
  const b = Markov.runProfessionalMarkovMatchModel({ pA:0.64,pB:0.60,sampleA:80,sampleB:70,iterations:1200,seed:19019 });
  assert.deepStrictEqual(a,b); assert.equal(a.modelMode,'HIERARCHICAL_BETA_POINT_GAME_SET_MATCH_MARKOV');
});
test('MONTE_CARLO_TENNIS_PROFESSIONAL', () => {
  const out = Simulation.runTennisMonteCarlo({player1:0.55},{p1ServePoint:0.64,p2ServePoint:0.60,p1Sample:80,p2Sample:70,iterations:1200,seed:19036,sport:'tennis'});
  assert.equal(out.modelMode,'HIERARCHICAL_POINT_LEVEL_MARKOV_MONTE_CARLO'); assert.equal(out.degradedFallback,false);
});
test('MONTE_CARLO_FALLBACK_EXPLICIT', () => {
  const out = Simulation.runTennisMonteCarlo({player1:0.55},{iterations:1200,seed:19036,sport:'tennis'});
  assert.equal(out.modelMode,'DEGRADED_MATCH_LEVEL_FALLBACK'); assert.equal(out.degradedFallback,true);
});
test('ELO_SYMMETRY', () => { assert(Math.abs(Ensemble.eloProbability(1700,1600)+Ensemble.eloProbability(1600,1700)-1)<1e-12); });
test('ROUND_NORMALIZATION', () => { assert.equal(Stage.normalizeTournamentRound('Semifinale'),'SF'); assert.equal(Stage.normalizeTournamentRound('Final'),'F'); });
test('LATE_ROUND_ADJUSTMENT_CAPPED_NO_VETO', () => {
  const out=Stage.applyTournamentStageAdjustment({baseProbabilityP1:.61,round:'F',player1Evidence:{lateRoundSample:10,lateRoundWinRate:.8,lateRoundPerformanceVsExpected:.1,semifinalPlusSample:7,finalSample:4},player2Evidence:{lateRoundSample:10,lateRoundWinRate:.3,lateRoundPerformanceVsExpected:-.1,semifinalPlusSample:6,finalSample:3},recentPerformance:{degradationActive:true,severity:'HIGH'}});
  assert(Math.abs(out.stageAdjustmentPp)<=out.profile.maxAdjustmentPp); assert.equal(out.hardExclusion,false); assert.equal(out.hardVeto,false);
});
test('RECENT_DEGRADATION_DETECTED', () => {
  const rows=[]; for(let i=0;i<120;i++) rows.push({match_start_at:`2026-05-${String((i%28)+1).padStart(2,'0')}T10:00:00Z`,bet_id:i,production_probability_p1:.65,actual_winner_side:i%10<7?1:2});
  for(let i=0;i<60;i++) rows.push({match_start_at:`2026-07-${String((i%28)+1).padStart(2,'0')}T10:00:00Z`,bet_id:200+i,production_probability_p1:.65,actual_winner_side:i%10<4?1:2});
  const out=Stage.evaluateRecentPerformance(rows); assert.equal(out.degradationActive,true); assert.equal(out.hardExclusion,false);
});
test('BEST_AVAILABLE_FORECAST_ALWAYS_RETURNED', () => {
  const out=Ensemble.buildBestAvailableForecast({player1:'A',player2:'B',productionProbabilityP1:.54,marketProbabilityP1:.52,round:'SF'});
  assert([1,2].includes(out.bestForecastSide)); assert.equal(out.policy.forecastAlwaysAvailable,true); assert.equal(out.policy.hardExclusion,false);
});
test('NO_PRODUCTION_GATE_STAKE_AUTHORITY', () => {
  const out=Ensemble.buildBestAvailableForecast({player1:'A',player2:'B',productionProbabilityP1:.54});
  assert.equal(out.authority.productionProbability,false); assert.equal(out.authority.qualityGate,false); assert.equal(out.authority.stake,false);
});

const report={success:results.every(x=>x.success),patch:'19',tests:results.length,passed:results.filter(x=>x.success).length,results};
console.log(JSON.stringify(report,null,2)); if(!report.success) process.exit(2);
