'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const importer = require('./tennis-historical-player-stats-importer');
const { resolvePatch16Sources } = require('./resolve-tennis-patch16-sources');
const historical = require('../backend/tennisHistoricalPlayerStats');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const resolvedSources = resolvePatch16Sources({ root });
console.log(`[PATCH16 SOURCE] layout=${resolvedSources.layout}`);
console.log(`[PATCH16 SOURCE] XLSX=${resolvedSources.sourceFile}`);
console.log(`[PATCH16 SOURCE] HTML=${resolvedSources.webDir}`);
const dataset = importer.buildDataset({
  sourceFile: resolvedSources.sourceFile,
  webDir: resolvedSources.webDir,
  pdfFile: resolvedSources.pdfFile,
  expectedYear: 2024,
  expectedSeasons: [2026, 2025, 2024],
  importedAt: '2026-07-15T18:00:00Z'
});
assert.strictEqual(dataset.source.primaryFormat, 'XLSX');
assert.strictEqual(dataset.source.htmlRole, 'ROW_AND_LINK_PARITY_FALLBACK_XLSX_YEAR_CANONICAL');
assert.strictEqual(dataset.source.pdfRole, 'AUDIT_ONLY_NOT_MACHINE_AUTHORITY');
assert.strictEqual(dataset.source.formatParity.status, 'MATCH_WITH_STALE_HTML_HEADER');
assert.strictEqual(dataset.source.formatParity.rowParity, true);
assert.strictEqual(dataset.quality.rawRecords, 1336);
assert.strictEqual(dataset.quality.activeRecords, 1315);
assert.strictEqual(dataset.quality.quarantinedRecords, 21);
assert.strictEqual(dataset.quality.linkCoveragePct, 100);
assert.strictEqual(dataset.quality.quarantinedByReason.QUARANTINED_SECTION_CONFLICT || 0, 0);
assert.strictEqual(dataset.quality.quarantinedByReason.QUARANTINED_INVALID_METRIC || 0, 1);
const arthurFeryInvalid = dataset.records.find(r => r.tour === 'ATP' && r.season === 2026 && r.normalizedName === 'arthur fery' && r.recordStatus === 'QUARANTINED_INVALID_METRIC');
assert(arthurFeryInvalid, 'Arthur Fery invalid metric row must be quarantined');
assert.deepStrictEqual(dataset.quality.seasons.ATP, [2026, 2025, 2024]);
assert.deepStrictEqual(dataset.quality.seasons.WTA, [2026, 2025, 2024]);
assert.strictEqual(dataset.quality.seasonHeadersStrictlyDescending, true);
assert.strictEqual(dataset.quality.duplicateTourSeasonSectionCount, 0);
assert(dataset.sections.every(section => section.status === 'ACTIVE'), 'All corrected season sections must be active');
assert.strictEqual(dataset.quality.expectedYearPresentForBothTours, true);
assert.strictEqual(dataset.authority.modelProbability, false);
assert.strictEqual(dataset.authority.stake, false);

const sabalenka = dataset.records.find(r => r.recordStatus === 'ACTIVE' && r.tour === 'WTA' && r.season === 2026 && r.normalizedName === 'aryna sabalenka');
assert(sabalenka, 'Sabalenka active record missing');
assert.strictEqual(sabalenka.metrics.rankingPoints, 8550);
assert.strictEqual(sabalenka.metrics.elo, 2214);
assert(sabalenka.sourceUrl.includes('tennis-db.com'));

const target = path.join(root, 'data', 'tennisdb_historical_player_stats.json');
historical.loadDataset(target, { force: true });
const status = historical.getStatus();
const observed = new Date(status.sourceObservedAt).getTime();
const before = historical.getPlayerSnapshot('Jannik Sinner', 'ATP', new Date(observed - 60000).toISOString());
const after = historical.getPlayerSnapshot('Jannik Sinner', 'ATP', new Date(observed + 60000).toISOString());
assert.strictEqual(before.status, 'AVAILABLE_AUXILIARY');
assert.strictEqual(Number(before.season), 2025, 'Before source snapshot must use the latest completed season');
assert.strictEqual(after.status, 'AVAILABLE_AUXILIARY');
assert.strictEqual(Number(after.season), 2026);
const validation = historical.buildMatchValidation('Jannik Sinner', 'Carlos Alcaraz', 'ATP', new Date(observed + 60000).toISOString());
assert.strictEqual(validation.status, 'READY_SHADOW_VALIDATION');
assert.strictEqual(validation.modelProbabilityChanged, false);
assert.strictEqual(validation.stakeAuthority, false);

const db = new DatabaseSync(':memory:');
historical.ensureHistoricalStatsSchema(db);
const persisted = historical.persistDatasetToDb(db, JSON.parse(fs.readFileSync(target, 'utf8')));
assert.strictEqual(persisted.inserted, true);
const duplicate = historical.persistDatasetToDb(db, JSON.parse(fs.readFileSync(target, 'utf8')));
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(historical.getDatabaseHealth(db).success, true);
assert.throws(() => db.prepare(`UPDATE ${historical.TABLE_IMPORTS} SET version='X'`).run(), /IMMUTABLE/);
assert.throws(() => db.prepare(`DELETE FROM ${historical.TABLE_RECORDS}`).run(), /IMMUTABLE/);
db.close();

console.log(JSON.stringify({ success: true, patch: '16', sourceLayout: resolvedSources.layout, datasetId: dataset.datasetId, rawRecords: dataset.quality.rawRecords, activeRecords: dataset.quality.activeRecords, quarantinedRecords: dataset.quality.quarantinedRecords, formatParity: dataset.source.formatParity.status, temporalFallbackSeason: before.season, currentSeason: after.season, validationProbabilityP1: validation.validationProbabilityP1, authority: 'SHADOW_ONLY' }, null, 2));
