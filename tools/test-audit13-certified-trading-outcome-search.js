'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rootArg = process.argv.find((arg, index) => process.argv[index - 1] === '--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..');
const audit13 = require(path.join(ROOT, 'backend', 'certifiedTradingOutcomeSearchAudit13'));
const official = require(path.join(ROOT, 'backend', 'tennisOfficialSettlementResolver'));

const checks = [];
function check(name, fn) {
  try { const value = fn(); checks.push({ name, ok: true, value: value === undefined ? null : value }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}

check('version', () => assert.strictEqual(audit13.VERSION, 'AUDIT13_CERTIFIED_TRADING_OUTCOME_SEARCH_V1'));
check('old event routed to archive, not recent API', () => {
  const plan = audit13.buildSearchPlan({ match_date: '2026-08-23T18:45:00Z' }, 'CALCIO', { now: new Date('2026-09-21T10:00:00Z') });
  assert.strictEqual(plan.archiveRecoveryRequired, true);
  assert.strictEqual(plan.recentProviderEligible, false);
  assert.strictEqual(plan.route, 'CERTIFIED_ARCHIVE_RECOVERY');
});
check('recent event stays in provider window', () => {
  const plan = audit13.buildSearchPlan({ match_date: '20/09/2026, 20:45' }, 'CALCIO', { now: new Date('2026-09-21T10:00:00Z') });
  assert.strictEqual(plan.recentProviderEligible, true);
  assert.strictEqual(plan.archiveRecoveryRequired, false);
});
check('football provider id exact match preferred', () => {
  assert.strictEqual(audit13.exactProviderIdMatch({ calcio_provider_event_id: 'abc' }, { id: 'abc', completed: true }, 'CALCIO'), true);
  assert.strictEqual(audit13.exactProviderIdMatch({ calcio_provider_event_id: 'abc' }, { id: 'def', completed: true }, 'CALCIO'), false);
});
check('football-data certified archive builds proof', () => {
  const fakeCsv = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nI1,23/08/2026,Torino,Milan,1,2,A\n';
  const fakeSnapshot = {
    valid: true,
    csvData: fakeCsv,
    inspection: { sha256: 'a'.repeat(64) },
    metadata: { fetchedAt: '2026-09-15T00:00:00.000Z', season: '2627', url: 'https://www.football-data.co.uk/mmz4281/2627/I1.csv' }
  };
  const row = { league: 'Serie A', home_team: 'Torino', away_team: 'Milan', match_date: '23/08/2026, 20:45', prediction: '2', odd: 2.1 };
  const resolution = audit13.resolveFootballFromLocalArchive(row, { readLocalLeagueSnapshot: () => fakeSnapshot, now: new Date('2026-09-21T00:00:00Z') });
  assert.ok(resolution);
  assert.strictEqual(resolution.homeGoals, 1);
  assert.strictEqual(resolution.awayGoals, 2);
  assert.strictEqual(resolution.sourceTier, 'CERTIFIED_ARCHIVE');
  assert.match(resolution.evidenceHash, /^[a-f0-9]{64}$/);
  const proof = audit13.buildSettlementProof(row, resolution, 'CALCIO', 'AUDIT13_TEST');
  assert.strictEqual(proof.settlement_source_tier, 'CERTIFIED_ARCHIVE');
  assert.match(proof.settlement_evidence_hash, /^[a-f0-9]{64}$/);
  assert.ok(proof.settlement_event_fingerprint);
  assert.ok(proof.settlement_market_fingerprint);
});
check('football-data ambiguous/non matching row fails closed', () => {
  const fakeSnapshot = { valid: true, csvData: 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nI1,23/08/2026,Torino,Inter,1,2,A\n', inspection: { sha256: 'b'.repeat(64) }, metadata: {} };
  const result = audit13.resolveFootballFromLocalArchive({ league: 'Serie A', home_team: 'Torino', away_team: 'Milan', match_date: '23/08/2026' }, { readLocalLeagueSnapshot: () => fakeSnapshot });
  assert.strictEqual(result, null);
});
check('ATP Canada official archive mapped', () => {
  const p = official.getOfficialProviderMetadata({ league: '[ATP] Canada', tournament_catalog_id: 'atp_m1000_canada', match_date: '08/08/2026' });
  assert.ok(p && p.tour === 'ATP' && /421\/results/.test(p.url));
});
check('WTA Canada official archive mapped', () => {
  const p = official.getOfficialProviderMetadata({ league: '[WTA] Canada', tournament_catalog_id: 'wta_1000_canada', match_date: '08/08/2026' });
  assert.ok(p && p.tour === 'WTA' && /806\/toronto\/2026\/draws/i.test(p.url));
});
check('Cincinnati official archives mapped both tours', () => {
  const atp = official.getOfficialProviderMetadata({ league: '[ATP] Cincinnati', tournament_catalog_id: 'atp_m1000_cincinnati', match_date: '18/08/2026' });
  const wta = official.getOfficialProviderMetadata({ league: '[WTA] Cincinnati', tournament_catalog_id: 'wta_1000_cincinnati', match_date: '18/08/2026' });
  assert.ok(/422\/results/.test(atp.url));
  assert.ok(/1017\/cincinnati\/2026\/draws/i.test(wta.url));
});
check('Grand Slam late Aug/Sep infers US Open by tour', () => {
  assert.strictEqual(official.getTournamentId({ league: '[ATP] Grand Slam', canonical_tournament_key: 'GRAND SLAM', match_date: '31/08/2026, 19:20:00' }), 'atp_gs_us_open');
  assert.strictEqual(official.getTournamentId({ league: '[WTA] Grand Slam', canonical_tournament_key: 'GRAND SLAM', match_date: '01/09/2026, 18:40:00' }), 'wta_gs_us_open');
});
check('Guadalajara WTA official mapped despite legacy catalog tier', () => {
  const p = official.getOfficialProviderMetadata({ league: '[WTA] Guadalajara', tournament_catalog_id: 'wta_1000_guadalajara', match_date: '16/09/2026' });
  assert.ok(p && /2075\/guadalajara\/2026\/draws/i.test(p.url));
});
check('ATP official result parser accepts final score evidence', () => {
  const html = '<html><body>Arthur Fils (21) 6 1 6 Frances Tiafoe (17) 3 6 0 Game Set and Match Arthur Fils. Arthur Fils wins the match 6-3 1-6 6-0 .</body></html>';
  const row = { home_team: 'Arthur Fils', away_team: 'Frances Tiafoe', match_date: '23/08/2026', tournament_catalog_id: 'atp_m1000_cincinnati' };
  const provider = official.getOfficialProviderMetadata(row);
  const result = official.parseOfficialResultText(html, row, provider);
  assert.ok(result && result.winner === 1 && result.totalGames === 22 && result.providerCompleted === true);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
});
check('WTA official draw parser accepts structured final score evidence', () => {
  const html = '<div>A. Sabalenka (1) | 6 | 6 | . |</div><div>C. Osorio | 2 | 4 | . |</div>';
  const row = { home_team: 'Aryna Sabalenka', away_team: 'Camila Osorio', match_date: '01/09/2026', tournament_catalog_id: 'wta_gs_us_open' };
  const provider = official.getOfficialProviderMetadata(row);
  const result = official.parseOfficialResultText(html, row, provider);
  assert.ok(result && result.winner === 1 && result.totalGames === 18 && result.providerCompleted === true);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
});
check('expired official tennis cache is semantically reusable', () => {
  assert.strictEqual(audit13.isReusableCertifiedTennisCache({ source: 'ATP_OFFICIAL_RESULTS_AUDIT13', providerCompleted: true, sourceEventId: 'ATP:1', evidenceHash: 'c'.repeat(64) }), true);
  assert.strictEqual(audit13.isReusableCertifiedTennisCache({ source: 'STEP58_WEB_FALLBACK_SCORE_GUARDED', providerCompleted: true, sourceEventId: 'x', evidenceHash: 'd'.repeat(64) }), false);
});
check('paper trading routes old events away from recent scores API', () => {
  const football = fs.readFileSync(path.join(ROOT, 'backend', 'paperTrading.js'), 'utf8');
  const tennis = fs.readFileSync(path.join(ROOT, 'backend', 'paperTrading.tennis.js'), 'utf8');
  assert.ok(football.includes('PENDING_AUDIT13_ARCHIVE_RESULT_NOT_FOUND'));
  assert.ok(football.includes('resolveFootballFromLocalArchive'));
  assert.ok(tennis.includes('PENDING_AUDIT13_OFFICIAL_ARCHIVE_RESULT_NOT_FOUND'));
  assert.ok(tennis.includes('supportsOfficialNetwork'));
});

let realDb = null;
check('real DB impact inspection is read-only', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(ROOT, 'backend', 'database_betting.db');
  const before = fs.readFileSync(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const calcio = db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='CALCIO'").all();
  const tennis = db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS'").all();
  let calcioArchiveEligible = 0, calcioLocallyResolvable = 0, tennisArchiveEligible = 0, tennisOfficialMapped = 0;
  for (const row of calcio) {
    const plan = audit13.buildSearchPlan(row, 'CALCIO');
    if (plan.archiveRecoveryRequired) {
      calcioArchiveEligible++;
      if (audit13.resolveFootballFromLocalArchive(row)) calcioLocallyResolvable++;
    }
  }
  for (const row of tennis) {
    const plan = audit13.buildSearchPlan(row, 'TENNIS');
    if (plan.archiveRecoveryRequired) {
      tennisArchiveEligible++;
      if (official.supportsOfficialNetwork(row)) tennisOfficialMapped++;
    }
  }
  db.close();
  const after = fs.readFileSync(dbPath);
  assert.strictEqual(Buffer.compare(before, after), 0);
  realDb = { calcioPending: calcio.length, calcioArchiveEligible, calcioLocallyResolvable, tennisPending: tennis.length, tennisArchiveEligible, tennisOfficialMapped };
  return realDb;
});

const failures = checks.filter(item => !item.ok);
const output = { success: failures.length === 0, patch: 'AUDIT13', checks: checks.length, failures, impact: realDb, details: checks };
console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exit(1);
