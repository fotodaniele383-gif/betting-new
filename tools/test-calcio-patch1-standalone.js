'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const quant = require(path.join(root, 'backend', 'calcioQuantEngine.js'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry.js'));

const checks = [];
function check(name, fn) {
    try {
        fn();
        checks.push({ name, ok: true });
    } catch (error) {
        checks.push({ name, ok: false, error: error.message });
    }
}

const probabilities = { '1': 45, X: 28, '2': 27, 'O2.5': 55 };
const fallback = quant.runMonteCarlo(probabilities, 20000, { seed: 12345 });
const low = quant.runMonteCarlo(probabilities, 20000, {
    expHomeGoals: 0.7,
    expAwayGoals: 0.6,
    seed: 6789
});
const high = quant.runMonteCarlo(probabilities, 20000, {
    expHomeGoals: 2.1,
    expAwayGoals: 1.4,
    seed: 6789
});
const repeated = quant.runMonteCarlo(probabilities, 20000, { seed: 12345 });

check('Patch identity', () => {
    assert.strictEqual(
        quant.CALCIO_QUANT_PATCH_VERSION,
        'CALCIO_PATCH_1_MONTE_CARLO_EXPECTED_GOALS_CONTRACT'
    );
});

check('Fallback does not collapse expected goals to zero', () => {
    assert.strictEqual(fallback.expectedGoals.source, 'INFERRED_FROM_PROBABILITIES');
    assert(fallback.expectedGoals.home > 0.5, JSON.stringify(fallback.expectedGoals));
    assert(fallback.expectedGoals.away > 0.5, JSON.stringify(fallback.expectedGoals));
    assert(fallback.drawProb < 0.65, `draw=${fallback.drawProb}`);
    assert(fallback.over2_5Prob > 0.15, `over2.5=${fallback.over2_5Prob}`);
});

check('Explicit expected goals remain authoritative', () => {
    assert.strictEqual(low.expectedGoals.source, 'EXPLICIT_EXPECTED_GOALS');
    assert.strictEqual(high.expectedGoals.source, 'EXPLICIT_EXPECTED_GOALS');
    assert.strictEqual(low.expectedGoals.home, 0.7);
    assert.strictEqual(low.expectedGoals.away, 0.6);
});

check('Monte Carlo is sensitive to low/high xG scenarios', () => {
    assert(high.over2_5Prob - low.over2_5Prob > 0.35, JSON.stringify({ low, high }));
    assert(high.golProb - low.golProb > 0.25, JSON.stringify({ low, high }));
});

check('Seeded simulation is deterministic', () => {
    assert.deepStrictEqual(fallback, repeated);
});

check('Probability invariants', () => {
    const sum = fallback.homeWinProb + fallback.drawProb + fallback.awayWinProb;
    assert(Math.abs(sum - 1) < 1e-12, `sum=${sum}`);
    assert(Math.abs(fallback.p1X - (fallback.homeWinProb + fallback.drawProb)) < 1e-12);
    assert(Math.abs(fallback.pX2 - (fallback.awayWinProb + fallback.drawProb)) < 1e-12);
});

check('Server wires model xG into both Monte Carlo call sites', () => {
    const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    const homeCount = (server.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g) || []).length;
    const awayCount = (server.match(/expAwayGoals:\s*xgResult\.expAwayGoals/g) || []).length;
    assert(homeCount >= 2, `home xG call sites=${homeCount}`);
    assert(awayCount >= 2, `away xG call sites=${awayCount}`);
});

check('Registry declares no DB or Tennis mutation', () => {
    const patch = registry.PATCHES.find(item => item.version === '1');
    assert(patch, 'Patch 1 missing');
    assert.strictEqual(patch.databaseMutation, false);
    assert.strictEqual(patch.tennisAuthorityChanged, false);
});

const success = checks.every(item => item.ok);
const output = {
    success,
    patch: 'CALCIO_PATCH_1',
    engineVersion: quant.CALCIO_QUANT_ENGINE_VERSION,
    patchVersion: quant.CALCIO_QUANT_PATCH_VERSION,
    diagnostics: {
        fallback: {
            expectedGoals: fallback.expectedGoals,
            homeWinProb: fallback.homeWinProb,
            drawProb: fallback.drawProb,
            awayWinProb: fallback.awayWinProb,
            over2_5Prob: fallback.over2_5Prob,
            golProb: fallback.golProb
        },
        lowXgOver2_5: low.over2_5Prob,
        highXgOver2_5: high.over2_5Prob
    },
    checks
};

console.log(JSON.stringify(output, null, 2));
if (!success) process.exit(2);
