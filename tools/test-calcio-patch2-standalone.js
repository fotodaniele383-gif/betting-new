'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const requestIdentity = require(path.join(root, 'backend', 'calcioRequestIdentity.js'));
const marketConsensus = require(path.join(root, 'backend', 'calcioMarketConsensus.js'));
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

function makeEvent(includePinnacle = true) {
    const books = [
        { key: 'partial', markets: [{ key: 'h2h', outcomes: [{ name: 'Home', price: 2.50 }, { name: 'Draw', price: 3.1 }] }] },
        { key: 'bet365', markets: [
            { key: 'h2h', outcomes: [{ name: 'Home', price: 2.10 }, { name: 'Draw', price: 3.40 }, { name: 'Away', price: 3.50 }] },
            { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.95 }, { name: 'Under', point: 2.5, price: 1.90 }] }
        ] },
        { key: 'unibet', markets: [
            { key: 'h2h', outcomes: [{ name: 'Home', price: 2.12 }, { name: 'Draw', price: 3.35 }, { name: 'Away', price: 3.55 }] },
            { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.97 }, { name: 'Under', point: 2.5, price: 1.88 }] }
        ] }
    ];
    if (includePinnacle) books.push({ key: 'pinnacle', markets: [
        { key: 'h2h', outcomes: [{ name: 'Home', price: 2.05 }, { name: 'Draw', price: 3.50 }, { name: 'Away', price: 3.65 }] },
        { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.91 }, { name: 'Under', point: 2.5, price: 1.99 }] }
    ] });
    return { home_team: 'Home', away_team: 'Away', bookmakers: books };
}

const settings = {
    useCrossReference: true,
    onlyGlobal: false,
    useAdvancedMetrics: true,
    baseEdge: 4,
    baseProb: 45,
    leagueParams: { 'Serie A': { global: { edge: 4.5, prob: 47 } } },
    tennisOnly: 'ignored'
};
const identityBase = requestIdentity.buildCalcioAnalysisRequestIdentity({
    league: 'serie_a',
    bankroll: 1000,
    settings,
    availableLeagues: ['serie_a', 'premier_league'],
    versions: { server: '14.7', model: 'MODEL' }
});
const identityRepeat = requestIdentity.buildCalcioAnalysisRequestIdentity({
    league: 'SERIE_A',
    bankroll: '1000.00',
    settings: {
        leagueParams: { 'Serie A': { global: { prob: 47, edge: 4.5 } } },
        baseProb: 45,
        baseEdge: 4,
        useAdvancedMetrics: true,
        onlyGlobal: false,
        useCrossReference: true
    },
    availableLeagues: ['premier_league', 'serie_a'],
    versions: { model: 'MODEL', server: '14.7' }
});
const identityDifferentBankroll = requestIdentity.buildCalcioAnalysisRequestIdentity({
    league: 'serie_a', bankroll: 2000, settings, availableLeagues: ['serie_a', 'premier_league'], versions: { server: '14.7', model: 'MODEL' }
});
const withPinnacle = marketConsensus.buildCalcioMarketConsensus(makeEvent(true));
const withoutPinnacle = marketConsensus.buildCalcioMarketConsensus(makeEvent(false));

check('Patch 2 identities are deterministic', () => {
    assert.strictEqual(identityBase.cacheKey, identityRepeat.cacheKey);
});

check('Bankroll cannot collide in analysis cache', () => {
    assert.notStrictEqual(identityBase.cacheKey, identityDifferentBankroll.cacheKey);
});

check('TTL cache returns clones and expires', () => {
    const cache = {};
    requestIdentity.setCalcioAnalysisCache(cache, identityBase, { valueBets: [{ odd: 2.1 }] }, { now: 100, ttlMs: 1000, maxEntries: 4 });
    const hit = requestIdentity.getCalcioAnalysisCache(cache, identityBase, { now: 200, ttlMs: 1000, maxEntries: 4 });
    assert.strictEqual(hit.hit, true);
    hit.data.valueBets[0].odd = 99;
    assert.strictEqual(requestIdentity.getCalcioAnalysisCache(cache, identityBase, { now: 201, ttlMs: 1000, maxEntries: 4 }).data.valueBets[0].odd, 2.1);
    assert.strictEqual(requestIdentity.getCalcioAnalysisCache(cache, identityBase, { now: 1100, ttlMs: 1000, maxEntries: 4 }).hit, false);
});

check('Incomplete first bookmaker cannot block complete books', () => {
    assert.strictEqual(withPinnacle.hasCompleteH2H, true);
    assert.strictEqual(withPinnacle.summary.completeH2HBookmakers, 3);
});

check('Partial bookmaker isolated price is excluded', () => {
    assert.strictEqual(withPinnacle.executionOdds['1'], 2.12);
    assert.strictEqual(withPinnacle.executionSources['1'].bookmakerKey, 'unibet');
});

check('Best executable prices are selected per complete market', () => {
    assert.strictEqual(withPinnacle.executionOdds.X, 3.5);
    assert.strictEqual(withPinnacle.executionOdds['2'], 3.65);
    assert.strictEqual(withPinnacle.executionOdds['O2.5'], 1.97);
    assert.strictEqual(withPinnacle.executionOdds['U2.5'], 1.99);
    assert.strictEqual(withPinnacle.executionSources['1X'].bookmakerKey, withPinnacle.summary.coherentDerivativeBookmaker);
    assert.strictEqual(withPinnacle.executionSources['1X'].derivedFromCompleteH2H, true);
});

check('Pinnacle no-vig is the preferred reference', () => {
    assert.strictEqual(withPinnacle.referenceSource.h2h, 'PINNACLE_NO_VIG');
    assert.strictEqual(withPinnacle.referenceSource.totals, 'PINNACLE_NO_VIG');
});

check('Median no-vig fallback works without Pinnacle', () => {
    assert.strictEqual(withoutPinnacle.referenceSource.h2h, 'CONSENSUS_MEDIAN_NO_VIG');
    assert.strictEqual(withoutPinnacle.referenceSampleSize.h2h, 2);
});

check('Server wiring removes league-only cache and first-bookmaker dependency', () => {
    const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    assert(server.includes('buildCalcioAnalysisRequestIdentity'));
    assert(server.includes('buildCalcioMarketConsensus'));
    const analyzeStart = server.indexOf("app.post('/api/analyze'");
    const analyzeEnd = server.indexOf("app.get('/api/backtest'", analyzeStart);
    const analyzeSource = server.slice(analyzeStart, analyzeEnd);
    assert(!server.includes('const book1 = m.bookmakers[0]'));
    assert(!server.includes('const cacheKey = `calcio_${league}`'));
    assert(analyzeSource.includes('UNAVAILABLE_NO_OPENING_SNAPSHOT'));
    assert(!analyzeSource.includes('closingOddForPred > openingOddForPred * 1.05'));
});

check('Registry contains Patch 1 and Patch 2 without DB/Tennis mutation', () => {
    const patch1 = registry.PATCHES.find(item => item.version === '1');
    const patch2 = registry.PATCHES.find(item => item.version === '2');
    assert(patch1 && patch2);
    assert.strictEqual(patch2.databaseMutation, false);
    assert.strictEqual(patch2.tennisAuthorityChanged, false);
});

const success = checks.every(item => item.ok);
const output = {
    success,
    patch: 'CALCIO_PATCH_2',
    requestIdentityVersion: requestIdentity.CALCIO_REQUEST_IDENTITY_VERSION,
    marketConsensusVersion: marketConsensus.CALCIO_MARKET_CONSENSUS_VERSION,
    diagnostics: {
        cacheDigest: identityBase.digestPrefix,
        bestPrices: withPinnacle.executionOdds,
        referenceSource: withPinnacle.referenceSource,
        fallbackReferenceSource: withoutPinnacle.referenceSource
    },
    checks
};
console.log(JSON.stringify(output, null, 2));
if (!success) process.exit(2);
