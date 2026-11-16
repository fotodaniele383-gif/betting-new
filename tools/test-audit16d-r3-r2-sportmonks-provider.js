#!/usr/bin/env node
'use strict';
const path = require('path');
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(__dirname, '..');
const provider = require(path.join(ROOT, 'backend', 'calcioSportmonksXgProviderAudit16dR3R2'));

const details = [];
function check(name, ok, value = null) { details.push({ name, ok: Boolean(ok), details: value }); }
function fixture(id, seasonId, aId, aName, axg, bId, bName, bxg) {
  return { id, season_id: seasonId, participants: [{ id: aId, name: aName }, { id: bId, name: bName }], xgfixture: [
    { type_id: 5304, participant_id: aId, data: { value: axg } },
    { type_id: 5304, participant_id: bId, data: { value: bxg } }
  ] };
}
(async () => {
  try {
    const fixtures = [
      fixture(1, 999, 1, 'Team A', 1.8, 2, 'Team B', 0.7),
      fixture(2, 999, 3, 'Team C', 1.1, 4, 'Team D', 1.4),
      fixture(3, 999, 5, 'Team E', 2.2, 6, 'Team F', 0.9),
      fixture(4, 999, 7, 'Team G', 0.6, 8, 'Team H', 0.8),
      fixture(5, 999, 9, 'Team I', 1.3, 10, 'Team J', 1.2),
      fixture(6, 999, 1, 'Team A', 1.2, 3, 'Team C', 1.0)
    ];
    const agg = provider.aggregateFixtureXg(fixtures, 999);
    check('Fixture aggregate accepts complete two-team xG only', agg.fixturesAccepted === 6, agg);
    check('Fixture aggregate creates at least 8 valid teams', Object.keys(agg.teams).length === 10, Object.keys(agg.teams));
    check('xG_for average correct', agg.teams['Team A']?.xG_for === 1.5, agg.teams['Team A']);
    check('xG_against derived from opponent fixture xG', agg.teams['Team A']?.xG_against === 0.85, agg.teams['Team A']);
    check('No synthetic xGA field required', agg.teams['Team A']?.source === 'SPORTMONKS_FIXTURE_XG_AGGREGATE', agg.teams['Team A']);

    const ranges = provider.buildDateRanges('2026-01-01', '2026-09-28');
    check('Date ranges respect <=95 day chunks', ranges.length >= 3 && ranges.every(r => ((new Date(r.end)-new Date(r.start))/86400000) <= 94), ranges);

    let calls = [];
    const requestJson = async (url) => {
      calls.push(url);
      if (url.includes('/leagues/search/')) return { data: [{ id: 77, name: 'Serie A', active: true, country: { name: 'Italy' }, currentseason: { id: 999, name: '2026/2027', starting_at: '2026-08-01' } }] };
      if (url.includes('/fixtures/between/')) return { data: fixtures, pagination: { has_more: false } };
      throw new Error('UNEXPECTED_URL');
    };
    const result = await provider.getSportmonksLeagueXg('Serie A', { token: 'SECRET_TEST_TOKEN', requestJson, writeCache: false, now: new Date('2026-09-28T08:00:00Z') });
    check('Live provider becomes READY_LIVE', result.state.status === 'READY_LIVE' && result.state.sourceClass === 'LIVE_CERTIFIED', result.state);
    check('Live provider returns fixture aggregated teams', Object.keys(result.teams).length === 10, result.state);
    check('Provider does not expose token', !JSON.stringify(result).includes('SECRET_TEST_TOKEN') && result.state.tokenExposed === false, result.state);
    check('Fixture endpoint requests xGFixture + participants', calls.some(x => /include=participants;xGFixture/.test(decodeURIComponent(x))), calls);
    check('Fixture endpoint filters certified league', calls.some(x => decodeURIComponent(x).includes('fixtureLeagues:77')), calls);
    check('No direct stake/gate authority', result.state.directStakeAuthority === false && result.state.directGateAuthority === false, result.state);

    const noToken = await provider.getSportmonksLeagueXg('Serie A', { token: '', cacheDir: path.join(ROOT, '.audit_patches', 'AUDIT16D_R3_R2', 'nonexistent-cache') });
    check('No token fails closed without network', noToken.state.status === 'DISABLED_NO_TOKEN' && Object.keys(noToken.teams).length === 0, noToken.state);

    const success = details.every(x => x.ok);
    console.log(JSON.stringify({ success, patch: 'AUDIT16D_R3_R2', suite: 'SPORTMONKS_FIXTURE_XG_PROVIDER', checks: details.length, failures: details.filter(x => !x.ok), details }, null, 2));
    process.exit(success ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ success:false, patch:'AUDIT16D_R3_R2', suite:'SPORTMONKS_FIXTURE_XG_PROVIDER', error:e.stack || e.message }, null, 2));
    process.exit(1);
  }
})();
