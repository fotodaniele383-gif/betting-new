'use strict';

const fs = require('fs');
const path = require('path');
const importer = require('./tennis-historical-player-stats-importer');
const { resolvePatch16Sources } = require('./resolve-tennis-patch16-sources');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function hasFlag(name) { return process.argv.includes(name); }

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
const outputFile = path.resolve(argValue('--output', path.join(root, 'data', 'tennisdb_historical_player_stats.json')));
const auditDir = path.join(root, 'audit_patch16');
const expectedYear = Number(argValue('--expected-year', importer.DEFAULT_EXPECTED_YEAR));
const expectedSeasons = String(argValue('--expected-seasons', importer.DEFAULT_EXPECTED_SEASONS.join(','))).split(',').map(value => Number(value.trim())).filter(Number.isInteger);
const verifyOnly = hasFlag('--verify-only');
const force = hasFlag('--force') || hasFlag('--replace-certified');

function markdown(report) {
  const quality = report.quality || {};
  const lines = [
    '# Patch 16 - Import dati statistici giocatori TennisDB',
    '',
    `- Dataset: ${report.datasetId}`,
    `- Versione: ${report.version}`,
    `- Formato primario: ${report.source?.primaryFormat}`,
    `- Record grezzi: ${quality.rawRecords}`,
    `- Record attivi: ${quality.activeRecords}`,
    `- Record in quarantena: ${quality.quarantinedRecords}`,
    `- Copertura link: ${quality.linkCoveragePct}%`,
    `- Stagioni ATP: ${(quality.seasons?.ATP || []).join(', ')}`,
    `- Stagioni WTA: ${(quality.seasons?.WTA || []).join(', ')}`,
    `- Stagioni attese: ${(quality.expectedSeasons || []).join(', ')}`,
    `- Sequenza stagioni certificata: ${quality.expectedSeasonSequencePresent ? 'sì' : 'no'}`,
    `- Anno minimo atteso ${quality.expectedYear}: ${quality.expectedYearPresentForBothTours ? 'presente per ATP e WTA' : 'non completo'}`,
    `- Parità XLSX/HTML: ${report.source?.formatParity?.status || 'N/D'}`,
    '',
    '## Sezioni',
    '',
    '| Tour | Stagione | Sezione | Stato | Righe | Attive | Quarantena |',
    '|---|---:|---:|---|---:|---:|---:|',
    ...(report.sections || []).map(item => `| ${item.tour} | ${item.season} | ${item.sectionIndex} | ${item.status} | ${item.rawRows} | ${item.activeRecords} | ${item.quarantinedRecords} |`),
    '',
    '## Avvisi principali',
    '',
    ...(report.warnings || []).slice(0, 40).map(item => `- ${item.code}: ${JSON.stringify(item)}`),
    '',
    '## Autorità operativa',
    '',
    '- Dati integrati come validazione ausiliaria shadow.',
    '- Nessuna modifica automatica a probabilità di produzione, Quality Gate, DeepScan, stake o settlement.',
    '- Le sezioni o identità ambigue restano in quarantena fino a correzione esplicita della fonte.'
  ];
  return `${lines.join('\n')}\n`;
}

try {
  const dataset = importer.buildDataset({ sourceFile, webDir, pdfFile, expectedYear, expectedSeasons });
  fs.mkdirSync(auditDir, { recursive: true });
  if (!verifyOnly) importer.writeJsonAtomic(outputFile, dataset, { force });
  const report = {
    sourceLayout: resolvedSources.layout,
    resolvedSources: { sourceFile, webDir, pdfFile: resolvedSources.pdfPresent ? pdfFile : null },
    success: dataset.quality.hardFailureCount === 0,
    mode: verifyOnly ? 'VERIFY_ONLY' : 'IMPORT_AND_ACTIVATE',
    outputFile: verifyOnly ? null : outputFile,
    ...dataset,
    records: undefined
  };
  fs.writeFileSync(path.join(auditDir, 'patch16_historical_import_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(auditDir, 'patch16_historical_import_report.md'), markdown(report));
  console.log(JSON.stringify({
    success: report.success,
    mode: report.mode,
    datasetId: report.datasetId,
    outputFile: report.outputFile,
    quality: report.quality,
    formatParity: report.source?.formatParity,
    warnings: report.warnings?.slice(0, 12)
  }, null, 2));
  if (!report.success) process.exitCode = 2;
} catch (error) {
  fs.mkdirSync(auditDir, { recursive: true });
  const failure = { success: false, error: error.message, stack: error.stack, sourceFile, webDir, pdfFile: resolvedSources.pdfPresent ? pdfFile : null, sourceLayout: resolvedSources.layout, outputFile, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(auditDir, 'patch16_historical_import_report.json'), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 2;
}
