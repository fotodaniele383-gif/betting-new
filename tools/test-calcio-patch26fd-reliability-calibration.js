'use strict';
const assert = require('assert');
const calibration = require('../backend/calcioReliabilityCalibration');

const pending = [68,70,61,73,67,72,76,75,61,77].map((score, index) => ({
  id: index + 1,
  status: 'PENDING',
  calcio_prediction_reliability_score: score,
  calcio_prediction_reliability_label: score >= 70 ? 'BUONA' : 'MEDIA',
  estimated_prob: 55 + (index % 4)
}));
const emptyResolved = calibration.buildReliabilityCalibration(pending);
assert.strictEqual(emptyResolved.scoredRows, 10);
assert.strictEqual(emptyResolved.pendingScoredRows, 10);
assert.strictEqual(emptyResolved.resolvedScoredRows, 0);
assert.strictEqual(emptyResolved.empiricalStatus, 'NOT_VALIDATED_NO_RESOLVED_CALCIO_ROWS');
assert.strictEqual(emptyResolved.stakeAuthority, false);

const resolved = [];
for (let i = 0; i < 30; i += 1) {
  resolved.push({
    status: i < 21 ? 'WON' : 'LOST',
    calcio_prediction_reliability_score: 76,
    calcio_prediction_reliability_label: 'BUONA',
    estimated_prob: 70
  });
}
const mature = calibration.buildReliabilityCalibration(resolved);
const good = mature.bands.find(row => row.bandKey === 'GOOD');
assert.strictEqual(good.resolved, 30);
assert.strictEqual(good.won, 21);
assert.strictEqual(good.lost, 9);
assert.strictEqual(good.hitRatePct, 70);
assert.strictEqual(good.avgForecastProbabilityPct, 70);
assert.strictEqual(good.calibrationGapPp, 0);
assert.strictEqual(good.validationConfidencePct, 100);
assert.strictEqual(good.validationStatus, 'EMPIRICALLY_COHERENT');
assert.ok(good.hitRateCi95.lowPct < 70 && good.hitRateCi95.highPct > 70);

const finalSnapshot = calibration.resolveDeclaredReliability({
  calcio_final_market_snapshot: JSON.stringify({ forecastConfidence: { score: 67.9, label: 'MEDIA' } })
});
assert.strictEqual(finalSnapshot.available, true);
assert.strictEqual(finalSnapshot.score, 67.9);
assert.strictEqual(finalSnapshot.source, 'FINAL_MARKET_FORECAST_CONFIDENCE');

const directPriority = calibration.resolveDeclaredReliability({
  calcio_prediction_reliability_score: 71,
  calcio_prediction_reliability_label: 'BUONA',
  calcio_final_market_snapshot: JSON.stringify({ forecastConfidence: { score: 40, label: 'BASSA' } })
});
assert.strictEqual(directPriority.score, 71);
assert.strictEqual(directPriority.source, 'PREDICTION_RELIABILITY_FINAL');

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2',
  checks: 18,
  pendingFixture: {
    scoredRows: emptyResolved.scoredRows,
    resolvedScoredRows: emptyResolved.resolvedScoredRows,
    empiricalStatus: emptyResolved.empiricalStatus
  },
  matureFixture: good
}, null, 2));
