'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const coverage = require('../backend/calcioHistoricalCoverageEntityResolution');
const entity = require('../backend/calcioEntityResolution');
const opponent = require('../backend/calcioOpponentAdjustedForm');

const root = path.join(__dirname, '..');
const csv = fs.readFileSync(path.join(root, 'backend', 'data', 'calcio_football_data', 'I1.csv'), 'utf8');
const cutoff = new Date('2026-08-30T00:00:00.000Z');
const context = coverage.createCoverageContext({ projectRoot: root, primaryCsvData: csv, primaryCode: 'I1', primaryLeagueName: 'Serie A' });
const fixtures = [
 ['Genoa','Napoli'],['Torino','AC Milan'],['AS Roma','Fiorentina'],['Udinese','Como'],['Parma','Cagliari'],
 ['Bologna','Lazio'],['Venezia','Lecce'],['Inter Milan','Monza'],['Atalanta BC','Sassuolo'],['Frosinone','Juventus']
];
const results = [];
let checks = 0;
function check(name, fn) { fn(); checks++; results.push({ name, ok: true }); }

check('Serie A primary snapshot is complete', () => { assert.strictEqual(context.primary.teams.length, 20); assert.strictEqual(context.primary.matches.length, 380); });
check('Serie B related snapshot is loaded locally', () => { assert.strictEqual(context.relatedSources.length, 1); assert.strictEqual(context.relatedSources[0].code, 'I2'); assert.strictEqual(context.relatedSources[0].matches.length, 380); });
const audits = fixtures.map(([home,away]) => context.resolveMatch(home, away, cutoff, { minSample: 5, strongSample: 10, threshold: 0.82 }));
check('All ten live fixture identities resolve', () => assert.strictEqual(audits.filter(row => row.matched).length, 10));
check('No live fixture remains PRIOR_ONLY', () => assert.strictEqual(audits.filter(row => row.status === 'PRIOR_ONLY').length, 0));
check('Three fixtures use promoted-team prior', () => assert.strictEqual(audits.filter(row => row.promotedTeamPrior).length, 3));
check('Atalanta BC resolves to Atalanta', () => assert.strictEqual(entity.resolveTeamName('Atalanta BC', context.primary.teams).resolved, 'Atalanta'));
check('Inter Milan resolves to Inter', () => assert.strictEqual(entity.resolveTeamName('Inter Milan', context.primary.teams).resolved, 'Inter'));
check('AC Milan resolves to Milan', () => assert.strictEqual(entity.resolveTeamName('AC Milan', context.primary.teams).resolved, 'Milan'));
check('AS Roma resolves to Roma', () => assert.strictEqual(entity.resolveTeamName('AS Roma', context.primary.teams).resolved, 'Roma'));
for (const team of ['Venezia','Monza','Frosinone']) {
 check(`${team} uses real I2 history`, () => { const row=context.resolveTeam(team,cutoff,{minSample:5}); assert.strictEqual(row.sourceCode,'I2'); assert.strictEqual(row.sample,38); assert.strictEqual(row.promotedTeamPrior,true); });
 check(`${team} legacy stats are shrunk and usable`, () => { const row=context.buildLegacyTeamStats(team,cutoff,{minSample:5}); assert(row.stats); assert.strictEqual(row.stats.observedHomeMatches,19); assert.strictEqual(row.stats.observedAwayMatches,19); assert.strictEqual(row.stats.promotedTeamPrior,true); });
}
const adjusted = opponent.buildMatchAdjustment(context.compositeIndex, 'Venezia', 'Lecce', cutoff, { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 });
check('Opponent adjusted form recognizes promoted prior', () => assert.strictEqual(adjusted.status, 'PROMOTED_TEAM_PRIOR'));
check('Promoted adjustment is capped at four percent', () => { assert(Math.abs(adjusted.homeAdjustmentPct) <= 4.0001); assert(Math.abs(adjusted.awayAdjustmentPct) <= 4.0001); });
check('Promoted authority is conservative', () => assert(adjusted.authority <= 0.38));
check('Unknown entity produces explicit non-invented reason', () => { const row=context.resolveTeam('Club Inesistente XYZ',cutoff,{minSample:5}); assert.strictEqual(row.matched,false); assert(['TEAM_ALIAS_MISMATCH','PROVIDER_NOT_COVERED','INSUFFICIENT_SAMPLE'].includes(row.reasonCode)); assert.strictEqual(row.safeguards.inventedData,false); });
check('Coverage matrix contains primary and lower division', () => { const codes=new Set(context.coverageMatrix(cutoff).map(row=>row.sourceCode)); assert(codes.has('I1')); assert(codes.has('I2')); });

console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26F_B_CALCIO_HISTORICAL_COVERAGE_ENTITY_RESOLUTION', checks, fixtureCoverage: { total: 10, resolved: 10, priorOnly: 0, promotedTeamPrior: 3 }, results }, null, 2));
