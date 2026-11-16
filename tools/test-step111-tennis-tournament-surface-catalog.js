// STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG standalone test
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TOURNAMENT_CATALOG, resolveTournamentCatalogContext } = require('../backend/tennisTournamentCatalog');
const { resolveTennisTournamentSurface } = require('../backend/tennisTournamentSurfaceResolver');

const expectedCounts = {
  MASTERS_1000: 9,
  WTA_1000: 10,
  ATP_500: 13,
  WTA_500: 12
};

function check(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (err) { console.error('FAIL', name); throw err; }
}

function expectResolved(input, expected) {
  const out = resolveTennisTournamentSurface(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(out[key], value, `${JSON.stringify(input)} ${key}: expected ${value}, got ${out[key]}`);
  }
  assert.strictEqual(out.isFallback, false, `${JSON.stringify(input)} must not be fallback`);
  assert.ok(out.confidence >= 0.99, `${JSON.stringify(input)} confidence too low: ${out.confidence}`);
  assert.ok(out.tournamentCatalogId || out.ruleId, `${JSON.stringify(input)} missing catalog/rule audit id`);
  return out;
}

check('catalog counts are complete', () => {
  assert.strictEqual(TOURNAMENT_CATALOG.length, 44, 'catalog must contain 44 user-supplied ATP/WTA 1000/500 entries');
  for (const [category, count] of Object.entries(expectedCounts)) {
    assert.strictEqual(TOURNAMENT_CATALOG.filter(x => x.category === category).length, count, `${category} count`);
  }
});

check('ATP Masters 1000 all resolve with correct surfaces', () => {
  const cases = [
    ['Indian Wells', 'Hard', false], ['Miami Open', 'Hard', false], ['Monte-Carlo', 'Clay', false],
    ['Madrid Open', 'Clay', false], ['Internazionali d’Italia – Roma', 'Clay', false],
    ['Canada Masters Toronto', 'Hard', false], ['Cincinnati Masters', 'Hard', false],
    ['Shanghai Masters', 'Hard', false], ['Paris-Bercy', 'Hard', true]
  ];
  for (const [name, surface, indoor] of cases) {
    expectResolved({ tournament: name, tour: 'ATP', sportKey: `tennis_atp_${name}` }, { surface, modelSurface: surface, indoor });
  }
});

check('WTA 1000 all resolve with correct surfaces', () => {
  const cases = [
    ['Doha', 'Hard', false], ['Dubai', 'Hard', false], ['Indian Wells', 'Hard', false],
    ['Miami Open', 'Hard', false], ['Madrid Open', 'Clay', false], ['Roma', 'Clay', false],
    ['Pechino', 'Hard', false], ['Guadalajara', 'Hard', false], ['Cincinnati', 'Hard', false],
    ['Canada Montreal', 'Hard', false]
  ];
  for (const [name, surface, indoor] of cases) {
    const out = expectResolved({ tournament: name, tour: 'WTA', sportKey: `tennis_wta_${name}` }, { surface, modelSurface: surface, indoor });
    assert.ok(['WTA 1000', 'ATP Masters 1000'].includes(out.tournamentLevel), `${name} unexpected level ${out.tournamentLevel}`);
  }
});

check('ATP 500 all resolve with correct surfaces', () => {
  const cases = [
    ['Rotterdam', 'Hard', true], ['Rio de Janeiro', 'Clay', false], ['Acapulco', 'Hard', false],
    ['Dubai', 'Hard', false], ['Barcelona', 'Clay', false], ['Halle', 'Grass', false],
    ['Queen’s', 'Grass', false], ['Washington Citi Open', 'Hard', false], ['Hamburg', 'Clay', false],
    ['Beijing', 'Hard', false], ['Tokyo', 'Hard', false], ['Basel', 'Hard', true], ['Vienna', 'Hard', true]
  ];
  for (const [name, surface, indoor] of cases) {
    const out = expectResolved({ tournament: name, tour: 'ATP', sportKey: `tennis_atp_${name}` }, { surface, modelSurface: surface, indoor });
    assert.strictEqual(out.tournamentLevel, 'ATP 500');
  }
});

check('WTA 500 all resolve with correct surfaces', () => {
  const cases = [
    ['Brisbane', 'Hard', false], ['Adelaide', 'Hard', false], ['Abu Dhabi', 'Hard', false],
    ['San Diego', 'Hard', false], ['Charleston', 'Clay', false], ['Stoccarda', 'Clay', true],
    ['Berlino', 'Grass', false], ['Eastbourne', 'Grass', false], ['Washington', 'Hard', false],
    ['Zhengzhou', 'Hard', false], ['Tokyo', 'Hard', false], ['Ostrava / Rotazione', 'Hard', true]
  ];
  for (const [name, surface, indoor] of cases) {
    const out = expectResolved({ tournament: name, tour: 'WTA', sportKey: `tennis_wta_${name}` }, { surface, modelSurface: surface, indoor });
    assert.strictEqual(out.tournamentLevel, 'WTA 500');
  }
});

check('provider conflict is overridden by tournament lock', () => {
  const monteCarlo = resolveTennisTournamentSurface({ tournament: 'Rolex Monte-Carlo Masters', tour: 'ATP', providerSurface: 'Hard' });
  assert.strictEqual(monteCarlo.surface, 'Clay');
  assert.strictEqual(monteCarlo.overriddenProviderSurface, 'Hard');
  const bercy = resolveTennisTournamentSurface({ tournament: 'Rolex Paris Masters Bercy', tour: 'ATP', providerSurface: 'Clay' });
  assert.strictEqual(bercy.surface, 'Hard');
  assert.strictEqual(bercy.indoor, true);
  assert.strictEqual(bercy.surfaceRegimeKey, 'indoor_hard');
  assert.strictEqual(bercy.overriddenProviderSurface, 'Clay');
});

check('series classification resolves WTA 1000/500 and ATP 500 from catalog', () => {
  assert.strictEqual(resolveTournamentCatalogContext({ tournament: 'Doha', tour: 'WTA' }).seriesLabel, 'WTA 1000');
  assert.strictEqual(resolveTournamentCatalogContext({ tournament: 'Ostrava Open', tour: 'WTA' }).seriesLabel, 'WTA500');
  assert.strictEqual(resolveTournamentCatalogContext({ tournament: 'Rotterdam', tour: 'ATP' }).seriesLabel, 'ATP500');
});

check('server persistence hooks are present and additive only', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.tennis.js'), 'utf8');
  for (const marker of [
    'STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG',
    "safeAlterTableAddColumn('ai_forward_test', 'tournament_catalog_id TEXT')",
    "['tournament_level'",
    "['surface_regime_key'",
    'resolveTournamentCatalogContext',
    'getAllowedSeriesKeys'
  ]) {
    assert.ok(server.includes(marker), `missing server marker ${marker}`);
  }
  assert.ok(!server.includes('DROP TABLE'), 'patch must not drop tables');
});

console.log('STEP111 standalone audit complete: tournament/surface catalog, DeepScan/Paper/Portfolio hooks OK.');
