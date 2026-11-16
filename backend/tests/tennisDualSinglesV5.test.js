'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildResult } = require('../tennisDualSinglesV5');
test('Shelton/Van Assche: minimax 10EUR, no money authorized', () => {
  const x=buildResult({budget:10,favoriteOdds:1.30,underdogPlus15Odds:1.89});
  assert.equal(x.status,'SIMULATED');
  assert.equal(x.markets[0].simulatedStakeEur + x.markets[1].simulatedStakeEur, 10);
  assert.equal(x.operationalStakeEur,0);
  assert.equal(x.evCertified,false);
  assert.equal(x.evPct,null);
  assert.deepEqual(x.scenarios.map(y=>y.netProfitEur), [-2.30,5.41,-2.29,-2.29]);
  assert.equal(x.maximumOrdinaryLossEur,2.30);
  assert.equal(x.lossTargetMet,true);
});
test('missing odds fail closed', () => {
  const x=buildResult({budget:10,favoriteOdds:1.3});
  assert.equal(x.status,'NOT_CALCULABLE');
  assert.ok(x.missing.includes('UNDERDOG_PLUS_1_5_SETS_ODDS'));
});
test('BO5 not supported; do not pass off +1.5 set as hedge', () => {
  const x=buildResult({budget:10,favoriteOdds:1.3,underdogPlus15Odds:1.89,bestOf:5});
  assert.equal(x.status,'NOT_CALCULABLE');
});
test('invalid odds, budget and probabilities fail closed', () => {
  for (const invalid of [NaN,Infinity,1,0,1001,'1.30']) {
    assert.equal(buildResult({favoriteOdds:invalid,underdogPlus15Odds:1.89}).status,'NOT_CALCULABLE');
  }
  const x=buildResult({budget:10.001,favoriteOdds:1.3,underdogPlus15Odds:1.89});
  assert.equal(x.status,'NOT_CALCULABLE');
});
test('no arbitrary calibration flag may enable operational stake', () => {
  const x=buildResult({favoriteOdds:1.3,underdogPlus15Odds:1.89,
    calibratedScoreDistribution:{FAVORITE_2_0:0.2,FAVORITE_2_1:0.6,UNDERDOG_2_0:0.1,UNDERDOG_2_1:0.1},
    oddsEvidence:{favorite:{bookmaker:'X',sourceUrl:'https://example.org',observedAt:'2026-11-07T08:00:00Z'},underdog:{bookmaker:'Y',sourceUrl:'https://example.org',observedAt:'2026-11-07T08:00:00Z'}}
  });
  assert.equal(x.expectedValueEur,null);
  assert.equal(x.operationalStakeEur,0);
  assert.equal(x.roiCertified,false);
});
test('2 singles may both win; some odds cannot satisfy risk target', () => {
  const x=buildResult({favoriteOdds:1.1,underdogPlus15Odds:1.1});
  assert.equal(x.status,'SIMULATED');
  assert.equal(x.lossTargetMet,false);
  assert.ok(x.maximumOrdinaryLossPct > 25);
  assert.ok(x.scenarios[1].netProfitEur > 0);
});
test('settlement net profit matches cents across all scenarios', () => {
  for(let q1 of [1.15,1.3,1.61,2.5]) for(let q2 of [1.2,1.89,2.2,5.1]){
    const x=buildResult({favoriteOdds:q1,underdogPlus15Odds:q2,budget:10});
    const [a,b]=x.markets.map(v=>v.simulatedStakeEur);
    assert.equal(Math.round((a+b)*100),1000);
    const p=x.scenarios.map(v=>v.netProfitEur);
    assert.equal(p[0],Math.round((Math.round(a*100*(q1-1))-Math.round(b*100)))/100);
    assert.equal(p[1],Math.round((Math.round(a*100*(q1-1))+Math.round(b*100*(q2-1))))/100);
  }
});
