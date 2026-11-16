'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const cheerio = require('cheerio');

const IMPORTER_VERSION = 'TENNIS_HISTORICAL_PLAYER_STATS_IMPORTER_V1_PATCH16';
const DATASET_VERSION = 'TENNIS_HISTORICAL_PLAYER_STATS_DATASET_V1_PATCH16';
const DEFAULT_EXPECTED_YEAR = 2024;
const DEFAULT_EXPECTED_SEASONS = Object.freeze([2026, 2025, 2024]);

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function sha256Json(value) { return sha256Buffer(Buffer.from(stableJson(value))); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function round(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;
}
function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizePlayerName(value) {
  return normalizeWhitespace(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function cleanCountry(value) {
  const text = normalizeWhitespace(value);
  return !text || /^[—–-]+$/.test(text) ? null : text.toUpperCase();
}
function missing(value) {
  const text = normalizeWhitespace(value);
  return !text || /^[—–-]+$/.test(text) || /^(N\/A|NA|NULL)$/i.test(text);
}
function parseNumber(value) {
  if (value === null || value === undefined || missing(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = normalizeWhitespace(value).replace(/[%+]/g, '');
  if (!text) return null;
  // Excel/Italian exports use comma as decimal separator and dot as thousands separator.
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
function parseInteger(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
function parsePercent(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) ? round(n / 100, 6) : null;
}
function parseThousandsCorruptedByLocale(value) {
  const n = parseNumber(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Values such as 8.550 and 2.214 are read by Excel as 8.55 / 2.214.
  // Ranking points and Elo are integer-scale values, so values below 20 are expanded.
  return Math.round(n < 20 ? n * 1000 : n);
}
function parseSignedDelta(value) {
  if (missing(value)) return null;
  const text = normalizeWhitespace(value);
  const match = text.match(/(\d+)/);
  if (!match) return 0;
  let sign = 1;
  if (/[↓▼-]/.test(text)) sign = -1;
  if (/[↑▲+]/.test(text)) sign = 1;
  return sign * Number(match[1]);
}
function extractProviderIdentity(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/players\/([^/]+)\//i);
    return match ? match[1] : null;
  } catch (_) { return null; }
}
function fileDescriptor(file, role) {
  if (!file || !fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    role,
    file: path.basename(file),
    relativePath: path.relative(path.dirname(path.resolve(file, '..')), file),
    absolutePath: path.resolve(file),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256File(file)
  };
}

function sheetMatrixFromXlsx(sourceFile, sheetName) {
  const workbook = XLSX.readFile(sourceFile, { cellText: true, cellNF: true, cellDates: false });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`PATCH16_XLSX_SHEET_MISSING:${sheetName}`);
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false });
  const links = {};
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const address = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = worksheet[address];
    if (cell?.l?.Target) links[r + 1] = cell.l.Target;
  }
  return { rows, links, ref: worksheet['!ref'] || null };
}

function decodeWindows1252(buffer) {
  try { return new TextDecoder('windows-1252').decode(buffer); }
  catch (_) { return buffer.toString('latin1'); }
}
function sheetMatrixFromHtml(file) {
  const html = decodeWindows1252(fs.readFileSync(file));
  const $ = cheerio.load(html, { decodeEntities: true });
  const rows = [];
  const links = {};
  $('table').first().find('tr').each((rowIndex, tr) => {
    const row = [];
    $(tr).find('td,th').each((cellIndex, td) => {
      const cell = $(td);
      row.push(normalizeWhitespace(cell.text()) || null);
      if (cellIndex === 1) {
        const href = cell.find('a[href]').first().attr('href');
        if (href) links[rowIndex + 1] = href;
      }
    });
    if (row.length) rows.push(row);
  });
  return { rows, links, ref: `HTML:${rows.length}` };
}

function splitSections(tour, matrix, sourceFormat) {
  const sections = [];
  let current = null;
  for (let index = 0; index < matrix.rows.length; index += 1) {
    const row = matrix.rows[index] || [];
    const playerHeader = normalizeWhitespace(row[1]).toUpperCase();
    if (playerHeader === 'PLAYER') {
      const declaredYear = parseInteger(row[0]);
      current = {
        tour,
        sectionIndex: sections.length + 1,
        declaredYear,
        headerRow: index + 1,
        sourceFormat,
        sourceRef: matrix.ref,
        headers: row.map(normalizeWhitespace),
        rows: []
      };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const playerName = normalizeWhitespace(row[1]);
    if (!playerName) continue;
    current.rows.push({ sourceRow: index + 1, values: row, sourceUrl: matrix.links[index + 1] || null });
  }
  return sections;
}

function parseAtpRecord(section, row) {
  const v = row.values;
  const playerName = normalizeWhitespace(v[1]);
  const sourceUrl = row.sourceUrl;
  return {
    tour: 'ATP',
    season: section.declaredYear,
    playerName,
    normalizedName: normalizePlayerName(playerName),
    country: cleanCountry(v[2]),
    sourceUrl,
    providerIdentity: extractProviderIdentity(sourceUrl),
    sourceSectionIndex: section.sectionIndex,
    sourceRow: row.sourceRow,
    sourceRankOrder: parseInteger(v[0]),
    metrics: {
      sampleMatches: parseInteger(v[3]),
      acesPerMatch: round(parseNumber(v[4]), 3),
      doubleFaultsPerMatch: round(parseNumber(v[5]), 3),
      firstServeInPct: parsePercent(v[6]),
      firstServePointsWonPct: parsePercent(v[7]),
      secondServePointsWonPct: parsePercent(v[8]),
      breakPointsSavedPct: parsePercent(v[9]),
      breakPointsConvertedPct: parsePercent(v[10]),
      servicePointsWonPct: parsePercent(v[11]),
      returnPointsWonPct: parsePercent(v[12]),
      totalPointsWonPct: parsePercent(v[13])
    }
  };
}
function parseWtaRecord(section, row) {
  const v = row.values;
  const playerName = normalizeWhitespace(v[1]);
  const sourceUrl = row.sourceUrl;
  return {
    tour: 'WTA',
    season: section.declaredYear,
    playerName,
    normalizedName: normalizePlayerName(playerName),
    country: cleanCountry(v[2]),
    sourceUrl,
    providerIdentity: extractProviderIdentity(sourceUrl),
    sourceSectionIndex: section.sectionIndex,
    sourceRow: row.sourceRow,
    sourceRankOrder: parseInteger(v[0]),
    metrics: {
      rank: parseInteger(v[3]),
      rankingPoints: parseThousandsCorruptedByLocale(v[4]),
      weeklyRankDelta: parseSignedDelta(v[5]),
      ytdRankDelta: parseSignedDelta(v[6]),
      wins: parseInteger(v[7]),
      losses: parseInteger(v[8]),
      winPct: parsePercent(v[9]),
      titles: parseInteger(v[10]),
      recentRounds: missing(v[11]) ? null : normalizeWhitespace(v[11]),
      elo: parseThousandsCorruptedByLocale(v[12]),
      setWinPct: parsePercent(v[13]),
      setMargin: round(parseNumber(v[14]), 3),
      strengthOfSchedulePct: (() => {
        const n = parseNumber(v[15]);
        return Number.isFinite(n) ? round(n / 100, 6) : null;
      })(),
      winsVsExpected: round(parseNumber(v[16]), 3)
    }
  };
}

function invalidMetricReasons(record) {
  const reasons = [];
  const metrics = record.metrics || {};
  const finiteOrNull = value => value === null || value === undefined || Number.isFinite(Number(value));
  const inRange = (key, min, max, required = false) => {
    const value = metrics[key];
    if (value === null || value === undefined) {
      if (required) reasons.push(`${key}:MISSING`);
      return;
    }
    if (!finiteOrNull(value) || Number(value) < min || Number(value) > max) reasons.push(`${key}:OUT_OF_RANGE:${value}`);
  };
  if (record.tour === 'ATP') {
    inRange('sampleMatches', 1, 500, true);
    inRange('acesPerMatch', 0, 50);
    inRange('doubleFaultsPerMatch', 0, 30);
    for (const key of ['firstServeInPct','firstServePointsWonPct','secondServePointsWonPct','breakPointsSavedPct','breakPointsConvertedPct','servicePointsWonPct','returnPointsWonPct','totalPointsWonPct']) inRange(key, 0, 1, true);
  } else {
    inRange('rank', 1, 5000, false);
    inRange('rankingPoints', 0, 50000);
    inRange('wins', 0, 500, true);
    inRange('losses', 0, 500, true);
    inRange('winPct', 0, 1, true);
    inRange('titles', 0, 100);
    inRange('elo', 500, 4000);
    inRange('setWinPct', 0, 1);
    inRange('setMargin', -20, 20);
    inRange('strengthOfSchedulePct', 0, 1);
    inRange('winsVsExpected', -100, 100);
  }
  return reasons;
}

function metricCompleteness(record) {
  return Object.values(record.metrics || {}).filter(value => value !== null && value !== undefined && value !== '').length;
}
function recordFingerprint(record) {
  return sha256Json({
    tour: record.tour, season: record.season, normalizedName: record.normalizedName,
    country: record.country, sourceUrl: record.sourceUrl, metrics: record.metrics
  });
}

function selectIdentityVariants(records, warnings) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.tour}|${record.season}|${record.normalizedName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const [key, group] of groups) {
    if (group.length === 1) {
      group[0].recordStatus = group[0].recordStatus || 'ACTIVE';
      group[0].identityStatus = 'UNIQUE';
      continue;
    }
    const distinct = new Set(group.map(recordFingerprint));
    if (distinct.size === 1) {
      group[0].recordStatus = 'ACTIVE';
      group[0].identityStatus = 'EXACT_DUPLICATE_COLLAPSED';
      for (const item of group.slice(1)) {
        item.recordStatus = 'QUARANTINED_EXACT_DUPLICATE';
        item.identityStatus = 'EXACT_DUPLICATE_COLLAPSED';
      }
      warnings.push({ code: 'EXACT_DUPLICATE_COLLAPSED', key, rows: group.map(item => item.sourceRow) });
      continue;
    }
    const ranked = group.filter(item => Number.isFinite(item.metrics?.rank) && item.metrics.rank > 0);
    if (ranked.length === 1) {
      const selected = ranked[0];
      selected.recordStatus = 'ACTIVE';
      selected.identityStatus = 'PROVIDER_DUPLICATE_RANKED_VARIANT_SELECTED';
      for (const item of group) if (item !== selected) {
        item.recordStatus = 'QUARANTINED_PROVIDER_IDENTITY_DUPLICATE';
        item.identityStatus = 'PROVIDER_DUPLICATE_RANKED_VARIANT_NOT_SELECTED';
      }
      warnings.push({
        code: 'PROVIDER_IDENTITY_DUPLICATE_RANKED_VARIANT_SELECTED', key,
        selectedRow: selected.sourceRow, providerIdentities: group.map(item => item.providerIdentity)
      });
      continue;
    }
    // Do not guess when two provider identities have equal authority.
    for (const item of group) {
      item.recordStatus = 'QUARANTINED_AMBIGUOUS_IDENTITY';
      item.identityStatus = 'AMBIGUOUS_PROVIDER_IDENTITY';
    }
    warnings.push({
      code: 'AMBIGUOUS_PROVIDER_IDENTITY', key, rows: group.map(item => item.sourceRow),
      providerIdentities: group.map(item => item.providerIdentity), completeness: group.map(metricCompleteness)
    });
  }
}

function applySectionConflictPolicy(sections, warnings) {
  const firstByKey = new Map();
  for (const section of sections) {
    const key = `${section.tour}|${section.declaredYear}`;
    if (!Number.isInteger(section.declaredYear) || section.declaredYear < 2000 || section.declaredYear > 2100) {
      section.status = 'QUARANTINED_INVALID_YEAR';
      warnings.push({ code: 'INVALID_SECTION_YEAR', tour: section.tour, sectionIndex: section.sectionIndex, declaredYear: section.declaredYear });
      continue;
    }
    if (!firstByKey.has(key)) {
      firstByKey.set(key, section);
      section.status = 'ACTIVE';
    } else {
      section.status = 'QUARANTINED_DUPLICATE_TOUR_SEASON';
      const first = firstByKey.get(key);
      warnings.push({
        code: 'DUPLICATE_TOUR_SEASON_SECTION', tour: section.tour, season: section.declaredYear,
        activeSectionIndex: first.sectionIndex, quarantinedSectionIndex: section.sectionIndex,
        activeHeaderRow: first.headerRow, quarantinedHeaderRow: section.headerRow
      });
    }
  }
}

function validateSeasonHeaderPolicy(sections, warnings) {
  const byTour = {};
  let strictlyDescending = true;
  for (const tour of ['ATP', 'WTA']) {
    const tourSections = sections.filter(section => section.tour === tour);
    const years = tourSections.map(section => section.declaredYear);
    const tourDescending = years.every((year, index) => index === 0 || year < years[index - 1]);
    const duplicateCount = years.length - new Set(years).size;
    if (!tourDescending) {
      strictlyDescending = false;
      warnings.push({ code: 'SEASON_HEADERS_NOT_STRICTLY_DESCENDING', tour, years });
    }
    byTour[tour] = { years, strictlyDescending: tourDescending, duplicateCount };
  }
  return {
    binding: 'YEAR_HEADER_APPLIES_TO_ROWS_UNTIL_NEXT_YEAR_HEADER',
    byTour,
    strictlyDescending,
    duplicateTourSeasonSectionCount: sections.filter(section => section.status === 'QUARANTINED_DUPLICATE_TOUR_SEASON').length
  };
}

function buildRecords(sections, observedAt, warnings) {
  const records = [];
  for (const section of sections) {
    for (const row of section.rows) {
      const record = section.tour === 'ATP' ? parseAtpRecord(section, row) : parseWtaRecord(section, row);
      if (!record.normalizedName) {
        record.recordStatus = 'QUARANTINED_INVALID_PLAYER_NAME';
        record.identityStatus = 'INVALID_NAME';
      } else if (!record.sourceUrl) {
        record.recordStatus = 'QUARANTINED_MISSING_SOURCE_URL';
        record.identityStatus = 'SOURCE_LINK_MISSING';
      } else if (section.status !== 'ACTIVE') {
        record.recordStatus = 'QUARANTINED_SECTION_CONFLICT';
        record.identityStatus = section.status;
      } else {
        const metricReasons = invalidMetricReasons(record);
        if (metricReasons.length) {
          record.recordStatus = 'QUARANTINED_INVALID_METRIC';
          record.identityStatus = 'INVALID_METRIC';
          record.metricValidationErrors = metricReasons;
          warnings.push({ code: 'INVALID_METRIC_QUARANTINED', tour: record.tour, season: record.season, playerName: record.playerName, sourceRow: record.sourceRow, reasons: metricReasons });
        }
      }
      record.observedAt = observedAt;
      records.push(record);
    }
  }
  const activeSectionRecords = records.filter(item => !item.recordStatus);
  selectIdentityVariants(activeSectionRecords, warnings);
  for (const record of records) {
    if (!record.recordStatus) record.recordStatus = 'ACTIVE';
    if (!record.identityStatus) record.identityStatus = 'UNIQUE';
    const core = {
      tour: record.tour, season: record.season, playerName: record.playerName, normalizedName: record.normalizedName,
      country: record.country, sourceUrl: record.sourceUrl, providerIdentity: record.providerIdentity,
      sourceSectionIndex: record.sourceSectionIndex, sourceRow: record.sourceRow, recordStatus: record.recordStatus,
      identityStatus: record.identityStatus, observedAt: record.observedAt, metrics: record.metrics, metricValidationErrors: record.metricValidationErrors || []
    };
    record.evidenceHash = sha256Json(core);
    record.recordId = `TDB16_${record.tour}_${record.season}_${record.sourceSectionIndex}_${record.sourceRow}_${record.evidenceHash.slice(0, 12)}`;
  }
  return records;
}

function sectionsSummary(sections, records) {
  return sections.map(section => {
    const sectionRecords = records.filter(item => item.tour === section.tour && item.sourceSectionIndex === section.sectionIndex && item.season === section.declaredYear);
    return {
      tour: section.tour,
      season: section.declaredYear,
      sectionIndex: section.sectionIndex,
      headerRow: section.headerRow,
      status: section.status,
      sourceFormat: section.sourceFormat,
      rawRows: section.rows.length,
      activeRecords: sectionRecords.filter(item => item.recordStatus === 'ACTIVE').length,
      quarantinedRecords: sectionRecords.filter(item => item.recordStatus !== 'ACTIVE').length,
      headers: section.headers
    };
  });
}
function buildQuality(records, sections, warnings, expectedYear, seasonHeaderPolicy, expectedSeasons = DEFAULT_EXPECTED_SEASONS) {
  const active = records.filter(item => item.recordStatus === 'ACTIVE');
  const quarantined = records.filter(item => item.recordStatus !== 'ACTIVE');
  const rawWithLinks = records.filter(item => item.sourceUrl).length;
  const seasons = {};
  for (const tour of ['ATP', 'WTA']) {
    seasons[tour] = [...new Set(sections.filter(section => section.tour === tour).map(section => section.declaredYear).filter(Number.isInteger))].sort((a, b) => b - a);
  }
  const expectedPresent = ['ATP', 'WTA'].every(tour => seasons[tour].includes(expectedYear));
  if (!expectedPresent) warnings.push({ code: 'EXPECTED_YEAR_NOT_PRESENT_FOR_BOTH_TOURS', expectedYear, seasons });
  const expectedSeasonSequencePresent = ['ATP','WTA'].every(tour => JSON.stringify(seasons[tour]) === JSON.stringify(expectedSeasons));
  if (!expectedSeasonSequencePresent) warnings.push({ code: 'EXPECTED_SEASON_SEQUENCE_MISMATCH', expectedSeasons, seasons });
  return {
    rawRecords: records.length,
    activeRecords: active.length,
    quarantinedRecords: quarantined.length,
    linkCoveragePct: records.length ? round(rawWithLinks / records.length * 100, 2) : 0,
    activeByTour: Object.fromEntries(['ATP', 'WTA'].map(tour => [tour, active.filter(item => item.tour === tour).length])),
    quarantinedByReason: quarantined.reduce((acc, item) => { acc[item.recordStatus] = Number(acc[item.recordStatus] || 0) + 1; return acc; }, {}),
    seasons,
    expectedYear,
    expectedYearPresentForBothTours: expectedPresent,
    expectedSeasons,
    expectedSeasonSequencePresent,
    sectionYearBinding: seasonHeaderPolicy?.binding || null,
    seasonHeadersStrictlyDescending: seasonHeaderPolicy?.strictlyDescending === true,
    duplicateTourSeasonSectionCount: Number(seasonHeaderPolicy?.duplicateTourSeasonSectionCount || 0),
    warningCount: warnings.length,
    hardFailureCount: warnings.filter(item => ['INVALID_SECTION_YEAR', 'EXPECTED_YEAR_NOT_PRESENT_FOR_BOTH_TOURS', 'EXPECTED_SEASON_SEQUENCE_MISMATCH', 'XLSX_HTML_ROW_PARITY_MISMATCH'].includes(item.code)).length
  };
}

function parseHtmlParity(webDir) {
  if (!webDir || !fs.existsSync(webDir)) return null;
  const atpFile = path.join(webDir, 'sheet001.htm');
  const wtaFile = path.join(webDir, 'sheet002.htm');
  if (!fs.existsSync(atpFile) || !fs.existsSync(wtaFile)) return null;
  const sections = [
    ...splitSections('ATP', sheetMatrixFromHtml(atpFile), 'HTML'),
    ...splitSections('WTA', sheetMatrixFromHtml(wtaFile), 'HTML')
  ];
  return {
    files: [fileDescriptor(atpFile, 'HTML_ATP'), fileDescriptor(wtaFile, 'HTML_WTA')].filter(Boolean),
    sections: sections.map(item => ({ tour: item.tour, season: item.declaredYear, sectionIndex: item.sectionIndex, rawRows: item.rows.length, headerRow: item.headerRow }))
  };
}
function compareParity(xlsxSections, htmlParity) {
  if (!htmlParity) return { status: 'NOT_AVAILABLE', matched: false, rowParity: false, headerParity: false, differences: [] };
  const left = xlsxSections.map(item => ({ tour: item.tour, season: item.declaredYear, sectionIndex: item.sectionIndex, rows: item.rows.length }));
  const right = htmlParity.sections.map(item => ({ tour: item.tour, season: item.season, sectionIndex: item.sectionIndex, rows: item.rawRows }));
  const rowDifferences = [];
  const headerDifferences = [];
  for (const item of left) {
    const peer = right.find(value => value.tour === item.tour && value.sectionIndex === item.sectionIndex);
    if (!peer) { rowDifferences.push(`HTML_SECTION_MISSING:${item.tour}:${item.sectionIndex}`); continue; }
    if (peer.rows !== item.rows) rowDifferences.push(`ROW_COUNT:${item.tour}:${item.sectionIndex}:${item.rows}->${peer.rows}`);
    if (peer.season !== item.season) headerDifferences.push(`YEAR_HEADER:${item.tour}:${item.sectionIndex}:${item.season}->${peer.season}`);
  }
  for (const item of right) if (!left.some(value => value.tour === item.tour && value.sectionIndex === item.sectionIndex)) rowDifferences.push(`XLSX_SECTION_MISSING:${item.tour}:${item.sectionIndex}`);
  const rowParity = rowDifferences.length === 0;
  const headerParity = headerDifferences.length === 0;
  return {
    status: rowParity ? (headerParity ? 'MATCH' : 'MATCH_WITH_STALE_HTML_HEADER') : 'MISMATCH',
    matched: rowParity,
    rowParity,
    headerParity,
    differences: [...rowDifferences, ...headerDifferences],
    rowDifferences,
    headerDifferences
  };
}

function buildDataset(options = {}) {
  const sourceFile = path.resolve(options.sourceFile);
  if (!fs.existsSync(sourceFile)) throw new Error(`PATCH16_SOURCE_NOT_FOUND:${sourceFile}`);
  const expectedYear = Number(options.expectedYear || DEFAULT_EXPECTED_YEAR);
  const expectedSeasons = Array.isArray(options.expectedSeasons) && options.expectedSeasons.length ? options.expectedSeasons.map(Number) : [...DEFAULT_EXPECTED_SEASONS];
  const stat = fs.statSync(sourceFile);
  const importedAt = options.importedAt ? new Date(options.importedAt).toISOString() : new Date().toISOString();
  const warnings = [];
  let observedAt = options.observedAt ? new Date(options.observedAt).toISOString() : stat.mtime.toISOString();
  const observedMs = new Date(observedAt).getTime();
  const importedMs = new Date(importedAt).getTime();
  // ZIP/Windows timestamps can be decoded as local clock values and appear in the future.
  // Fail safe by clamping only impossible future mtimes to the actual import observation time.
  if (!options.observedAt && Number.isFinite(observedMs) && Number.isFinite(importedMs) && observedMs > importedMs + 5 * 60 * 1000) {
    warnings.push({ code: 'SOURCE_MTIME_FUTURE_CLAMPED', originalMtime: observedAt, clampedTo: importedAt });
    observedAt = importedAt;
  }
  const atp = sheetMatrixFromXlsx(sourceFile, 'ATP');
  const wta = sheetMatrixFromXlsx(sourceFile, 'WTA');
  const sections = [
    ...splitSections('ATP', atp, 'XLSX'),
    ...splitSections('WTA', wta, 'XLSX')
  ];
  applySectionConflictPolicy(sections, warnings);
  const seasonHeaderPolicy = validateSeasonHeaderPolicy(sections, warnings);
  const records = buildRecords(sections, observedAt, warnings);
  const quality = buildQuality(records, sections, warnings, expectedYear, seasonHeaderPolicy, expectedSeasons);
  const webDir = options.webDir ? path.resolve(options.webDir) : path.join(path.dirname(sourceFile), 'Dati statistici Giocatori web_file');
  const htmlParity = parseHtmlParity(webDir);
  const parity = compareParity(sections, htmlParity);
  if (parity.status === 'MISMATCH') warnings.push({ code: 'XLSX_HTML_ROW_PARITY_MISMATCH', differences: parity.rowDifferences });
  else if (parity.status === 'MATCH_WITH_STALE_HTML_HEADER') warnings.push({ code: 'HTML_YEAR_HEADER_STALE_XLSX_CANONICAL', differences: parity.headerDifferences });
  quality.warningCount = warnings.length;
  quality.hardFailureCount = warnings.filter(item => ['INVALID_SECTION_YEAR', 'EXPECTED_YEAR_NOT_PRESENT_FOR_BOTH_TOURS', 'EXPECTED_SEASON_SEQUENCE_MISMATCH', 'XLSX_HTML_ROW_PARITY_MISMATCH'].includes(item.code)).length;
  const pdfFile = options.pdfFile ? path.resolve(options.pdfFile) : path.join(path.dirname(sourceFile), 'Dati statistici Giocatori pdf.pdf');
  const primaryHash = sha256File(sourceFile);
  const datasetId = `TDB16_${primaryHash.slice(0, 20)}`;
  const sourceFiles = [
    fileDescriptor(sourceFile, 'PRIMARY_XLSX'),
    ...(htmlParity?.files || []),
    fileDescriptor(pdfFile, 'AUDIT_ONLY_PDF')
  ].filter(Boolean);
  const source = {
    primaryFormat: 'XLSX',
    preferredIntegrationFormat: 'XLSX',
    htmlRole: 'ROW_AND_LINK_PARITY_FALLBACK_XLSX_YEAR_CANONICAL',
    pdfRole: 'AUDIT_ONLY_NOT_MACHINE_AUTHORITY',
    sourceObservedAt: observedAt,
    importedAt,
    sourceFiles,
    formatParity: parity
  };
  const core = {
    version: DATASET_VERSION,
    importerVersion: IMPORTER_VERSION,
    datasetId,
    importedAt,
    sourceObservedAt: observedAt,
    source,
    quality,
    sections: sectionsSummary(sections, records),
    seasonHeaderPolicy,
    records,
    warnings,
    temporalPolicy: {
      currentSeasonEligibleOnlyAtOrAfterSourceObservedAt: true,
      completedSeasonEligibleOnlyAfterSeasonEnd: true,
      futureSeasonRejected: true,
      historicalBackfillAuthority: false
    },
    authority: {
      modelProbability: false,
      qualityGate: false,
      deepScanDecision: false,
      stake: false,
      settlement: false,
      role: 'AUXILIARY_AI_VALIDATION_SHADOW'
    }
  };
  return { ...core, datasetHash: sha256Json(core) };
}

function writeJsonAtomic(target, value, options = {}) {
  const resolved = path.resolve(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) {
    const previous = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const prevCount = Number(previous?.quality?.activeRecords || 0);
    const nextCount = Number(value?.quality?.activeRecords || 0);
    if (!options.force && prevCount > 0 && nextCount < prevCount * 0.8) {
      throw new Error(`PATCH16_ACTIVE_RECORD_REGRESSION:${prevCount}->${nextCount}`);
    }
    fs.copyFileSync(resolved, `${resolved}.patch16-lkg`);
  }
  const temp = `${resolved}.patch16-new`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, resolved);
  return resolved;
}

module.exports = {
  IMPORTER_VERSION,
  DATASET_VERSION,
  DEFAULT_EXPECTED_YEAR,
  DEFAULT_EXPECTED_SEASONS,
  normalizePlayerName,
  parseNumber,
  parsePercent,
  parseThousandsCorruptedByLocale,
  splitSections,
  applySectionConflictPolicy,
  validateSeasonHeaderPolicy,
  selectIdentityVariants,
  invalidMetricReasons,
  buildDataset,
  writeJsonAtomic,
  stableJson,
  sha256Json
};
