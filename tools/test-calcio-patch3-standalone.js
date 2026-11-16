'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const provider = require(path.join(root, 'backend', 'calcioFootballDataProvider.js'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry.js'));

const checks = [];
async function check(name, fn) {
    try { await fn(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
function fixture(rows = [
    ['01/05/26','Alpha','Beta','2','1'],
    ['08/05/26','Gamma','Delta','0','0'],
    ['15/05/26','Beta','Gamma','1','3']
]) {
    return ['Date,HomeTeam,AwayTeam,FTHG,FTAG,HST,AST,HS,AS', ...rows.map(r => [...r,'4','3','10','8'].join(','))].join('\n');
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calcio-patch3-'));
    const now = new Date('2026-07-21T10:00:00.000Z');

    await check('Dynamic season resolver crosses July boundary', () => {
        assert.deepStrictEqual(provider.buildSeasonCandidates(now), ['2627','2526','2425']);
        assert.deepStrictEqual(provider.buildSeasonCandidates(new Date('2026-06-30T23:59:59Z')), ['2526','2425','2324']);
    });

    await check('CSV validator rejects HTML and incomplete result rows', () => {
        assert.strictEqual(provider.inspectFootballDataCsv(fixture(), { code:'E0' }).valid, true);
        assert.strictEqual(provider.inspectFootballDataCsv('<html>404</html>', { code:'E0' }).valid, false);
        const blank = 'Date,HomeTeam,AwayTeam,FTHG,FTAG\n01/05/26,A,B,,';
        assert.strictEqual(provider.inspectFootballDataCsv(blank, { code:'E0' }).valid, false);
    });

    let calls = [];
    await check('Unavailable newest season falls back to last valid season', async () => {
        const result = await provider.getLeagueCsv({
            cacheDir: temp, code:'E0', leagueKey:'premier_league', leagueName:'Premier', now,
            fetchText: async url => { calls.push(url); if (url.includes('/2627/')) throw new Error('HTTP_404'); return fixture(); }
        });
        assert.strictEqual(result.source, 'NETWORK');
        assert.strictEqual(result.season, '2526');
        assert.strictEqual(result.validRows, 3);
        assert.strictEqual(calls.length, 2);
    });

    await check('Fresh local cache avoids all network calls', async () => {
        const result = await provider.getLeagueCsv({
            cacheDir: temp, code:'E0', leagueKey:'premier_league', leagueName:'Premier', now:new Date('2026-07-21T11:00:00Z'),
            fetchText: async () => { throw new Error('NETWORK_MUST_NOT_RUN'); }
        });
        assert.strictEqual(result.source, 'CACHE_FRESH');
    });

    await check('Network failure preserves LKG byte-exact', async () => {
        const csvPath = path.join(temp, 'E0.csv');
        const before = hash(csvPath);
        const result = await provider.getLeagueCsv({
            cacheDir: temp, code:'E0', leagueKey:'premier_league', leagueName:'Premier', now:new Date('2026-07-23T12:00:00Z'), forceRefresh:true,
            fetchText: async () => { throw new Error('OFFLINE'); }
        });
        assert.strictEqual(result.degraded, true);
        assert.strictEqual(result.source, 'LAST_KNOWN_GOOD');
        assert.strictEqual(hash(csvPath), before);
    });

    await check('Invalid download never replaces active LKG', async () => {
        const csvPath = path.join(temp, 'E0.csv');
        const before = hash(csvPath);
        const result = await provider.getLeagueCsv({
            cacheDir: temp, code:'E0', leagueKey:'premier_league', leagueName:'Premier', now:new Date('2026-07-24T12:00:00Z'), forceRefresh:true,
            fetchText: async () => '<html>blocked</html>'
        });
        assert.strictEqual(result.degraded, true);
        assert.strictEqual(hash(csvPath), before);
    });

    await check('Freshness guard recognizes offseason last complete data', () => {
        assert.strictEqual(provider.classifyMatchRecency('2026-05-15T12:00:00Z', now).status, 'OFFSEASON_LAST_COMPLETE');
        assert.strictEqual(provider.classifyFetchFreshness('2026-07-21T09:00:00Z', now).status, 'CURRENT');
        assert.strictEqual(provider.classifyFetchFreshness('2026-07-17T09:00:00Z', now).status, 'STALE');
    });

    await check('Server wiring removes static seasons in both flows', () => {
        const server = fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
        assert.strictEqual((server.match(/await calcioFootballDataProvider\.getLeagueCsv/g)||[]).length, 2);
        assert(!server.includes('mmz4281/2526/${config.code}.csv'));
        assert(!server.includes('mmz4281/2425/${config.code}.csv'));
        assert(server.includes("/api/calcio/football-data-freshness"));
        assert(server.includes("/api/calcio/football-data-refresh"));
        assert(server.includes('scheduleBestEffortRefresh'));
        assert(server.includes('CALCIO_FOOTBALL_DATA_REFRESH_LOCAL_ONLY'));
    });

    await check('Registry declares Patch 3 without DB or Tennis mutation', () => {
        const patch = registry.PATCHES.find(item => item.version === '3');
        assert(patch);
        assert.strictEqual(patch.databaseMutation, false);
        assert.strictEqual(patch.tennisAuthorityChanged, false);
        assert.strictEqual(patch.footballProbabilityContractChanged, false);
    });

    fs.rmSync(temp, {recursive:true, force:true});
    const success = checks.every(x => x.ok);
    console.log(JSON.stringify({
        success,
        patch:'CALCIO_PATCH_3',
        providerVersion:provider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        diagnostics:{seasonCandidates:provider.buildSeasonCandidates(now), networkCalls:calls.length},
        checks
    },null,2));
    if(!success) process.exit(2);
})().catch(error => { console.error(error); process.exit(2); });
