'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('./tennis-historical-player-stats-importer');
const { resolvePatch16Sources } = require('./resolve-tennis-patch16-sources');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const root = path.resolve(argValue('--root', path.join(__dirname, '..')));
const resolvedSources = resolvePatch16Sources({
  root,
  sourceFile: argValue('--source'),
  webDir: argValue('--web-dir'),
  pdfFile: argValue('--pdf')
});
const { sourceFile, webDir, pdfFile } = resolvedSources;
console.log(`[PATCH16 SOURCE] layout=${resolvedSources.layout}`);
console.log(`[PATCH16 SOURCE] XLSX=${sourceFile}`);
console.log(`[PATCH16 SOURCE] HTML=${webDir}`);
console.log(`[PATCH16 SOURCE] PDF=${resolvedSources.pdfPresent ? pdfFile : 'ASSENTE (audit-only)'}`);
const expectedSeasons = String(argValue('--expected-seasons', '2026,2025,2024'))
  .split(',').map(value => Number(value.trim())).filter(Number.isInteger);
const auditDir = path.join(root, 'audit_patch16');
fs.mkdirSync(auditDir, { recursive: true });

let report;
try {
  const dataset = importer.buildDataset({
    sourceFile,
    webDir,
    pdfFile,
    expectedYear: expectedSeasons[expectedSeasons.length - 1] || importer.DEFAULT_EXPECTED_YEAR,
    expectedSeasons
  });
  const seasons = dataset.quality?.seasons || {};
  const same = (left, right) => JSON.stringify(left || []) === JSON.stringify(right || []);
  const sectionConflicts = (dataset.records || []).filter(record => record.recordStatus === 'QUARANTINED_SECTION_CONFLICT').length;
  const duplicateWarnings = (dataset.warnings || []).filter(item => item.code === 'DUPLICATE_TOUR_SEASON_SECTION').length;
  const allSectionsActive = (dataset.sections || []).every(section => section.status === 'ACTIVE');
  const success = same(seasons.ATP, expectedSeasons)
    && same(seasons.WTA, expectedSeasons)
    && dataset.seasonHeaderPolicy?.strictlyDescending === true
    && Number(dataset.quality?.duplicateTourSeasonSectionCount || 0) === 0
    && sectionConflicts === 0
    && duplicateWarnings === 0
    && allSectionsActive;

  report = {
    success,
    patch: '16',
    sourceFile,
    webDir,
    pdfFile: resolvedSources.pdfPresent ? pdfFile : null,
    sourceLayout: resolvedSources.layout,
    expectedSeasons,
    actualSeasons: seasons,
    sectionYearBinding: dataset.seasonHeaderPolicy?.binding || null,
    strictlyDescending: dataset.seasonHeaderPolicy?.strictlyDescending === true,
    duplicateTourSeasonSectionCount: Number(dataset.quality?.duplicateTourSeasonSectionCount || 0),
    sectionConflictRecords: sectionConflicts,
    duplicateWarnings,
    allSectionsActive,
    sections: dataset.sections,
    generatedAt: new Date().toISOString()
  };
} catch (error) {
  report = {
    success: false,
    patch: '16',
    sourceFile,
    webDir,
    pdfFile: resolvedSources.pdfPresent ? pdfFile : null,
    sourceLayout: resolvedSources.layout,
    expectedSeasons,
    error: error.message,
    stack: error.stack,
    generatedAt: new Date().toISOString()
  };
}

const reportFile = path.join(auditDir, 'patch16_source_year_verification.json');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 2;
