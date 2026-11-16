'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settlementTruthR4 = require('./tennisSettlementTruthPatch34R4');

const VERSION = 'TENNIS_OFFICIAL_SETTLEMENT_RESOLVER_V3_PATCH34_R4';
const AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION = 'AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';
const SEED_VERSION = 'TENNIS_OFFICIAL_SETTLEMENT_SEED_V2_PATCH29_R1';
const RETIREMENT_EVIDENCE_VERSION = 'TENNIS_OFFICIAL_RETIREMENT_EVIDENCE_V1_PATCH29_R1';
const CACHE_VERSION = 'TENNIS_OFFICIAL_SETTLEMENT_CACHE_V2_PATCH29_R1';
const DEFAULT_TIMEOUT_MS = Math.max(5000, Math.min(30000, Number(process.env.TENNIS_OFFICIAL_RESULTS_TIMEOUT_MS || 12000)));
const SEED_PATH = path.join(__dirname, 'tennisOfficialSettlementSeedPatch29R1.json');
const RETIREMENT_PATH = path.join(__dirname, 'tennisOfficialRetirementEvidencePatch29R1.json');
const CACHE_DIR = path.join(__dirname, 'cache_official_tennis_patch29');
const PAGE_CACHE_TTL_MS = Math.max(5 * 60 * 1000, Math.min(6 * 60 * 60 * 1000, Number(process.env.TENNIS_OFFICIAL_RESULTS_CACHE_TTL_MS || 30 * 60 * 1000)));
const pageMemoryCache = new Map();
const pageInFlight = new Map();
let lastOfficialNetworkFailure = null;

const OFFICIAL_TOURNAMENTS = Object.freeze({
  atp_500_washington: Object.freeze({
    tour: 'ATP', source: 'ATP_OFFICIAL_RESULTS_AUDIT13',
    url: 'https://www.atptour.com/en/scores/current/washington/418/results', format: 'ATP_RESULTS_TEXT'
  }),
  wta_500_washington: Object.freeze({
    tour: 'WTA', source: 'WTA_OFFICIAL_RESULTS_AUDIT13',
    urlTemplate: 'https://www.wtatennis.com/tournaments/1045/washington-dc/{year}/draws', format: 'WTA_DRAW_TEXT'
  }),
  atp_m1000_canada: Object.freeze({
    tour: 'ATP', source: 'ATP_OFFICIAL_RESULTS_AUDIT13',
    url: 'https://www.atptour.com/en/scores/current/montreal/421/results', format: 'ATP_RESULTS_TEXT'
  }),
  wta_1000_canada: Object.freeze({
    tour: 'WTA', source: 'WTA_OFFICIAL_RESULTS_AUDIT13',
    urlTemplate: 'https://www.wtatennis.com/tournaments/806/toronto/{year}/draws', format: 'WTA_DRAW_TEXT'
  }),
  atp_m1000_cincinnati: Object.freeze({
    tour: 'ATP', source: 'ATP_OFFICIAL_RESULTS_AUDIT13',
    url: 'https://www.atptour.com/en/scores/current/atp-masters-1000-cincinnati/422/results', format: 'ATP_RESULTS_TEXT'
  }),
  wta_1000_cincinnati: Object.freeze({
    tour: 'WTA', source: 'WTA_OFFICIAL_RESULTS_AUDIT13',
    urlTemplate: 'https://www.wtatennis.com/tournaments/1017/cincinnati/{year}/draws', format: 'WTA_DRAW_TEXT'
  }),
  atp_gs_us_open: Object.freeze({
    tour: 'ATP', source: 'ATP_OFFICIAL_RESULTS_AUDIT13',
    url: 'https://www.atptour.com/en/scores/current/us-open/560/results', format: 'ATP_RESULTS_TEXT'
  }),
  wta_gs_us_open: Object.freeze({
    tour: 'WTA', source: 'WTA_OFFICIAL_RESULTS_AUDIT13',
    urlTemplate: 'https://www.wtatennis.com/tournaments/905/us-open/{year}/draws', format: 'WTA_DRAW_TEXT'
  }),
  wta_1000_guadalajara: Object.freeze({
    tour: 'WTA', source: 'WTA_OFFICIAL_RESULTS_AUDIT13',
    urlTemplate: 'https://www.wtatennis.com/tournaments/2075/guadalajara/{year}/draws', format: 'WTA_DRAW_TEXT',
    note: 'Catalog id legacy WTA1000; official 2026 event is WTA500.'
  })
});

function text(value) { return String(value == null ? '' : value).trim(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex'); }
function normalizeName(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ').replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function lastName(value) { const p = normalizeName(value).split(' ').filter(Boolean); return p[p.length - 1] || ''; }
function samePlayer(a, b) {
  const aa = normalizeName(a), bb = normalizeName(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const la = lastName(aa), lb = lastName(bb);
  return Boolean(la && la === lb && aa[0] === bb[0]);
}
function parseDateKey(value) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const it = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}
function parseScore(score) {
  const raw = text(score);
  const sets = [];
  const re = /(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s*\([^)]*\))?/g;
  let match;
  while ((match = re.exec(raw))) sets.push([Number(match[1]), Number(match[2])]);
  return {
    valid: sets.length > 0 && sets.every(([a, b]) => a !== b && a >= 0 && b >= 0 && a <= 30 && b <= 30),
    totalGames: sets.length ? sets.reduce((n, [a, b]) => n + a + b, 0) : null,
    sets
  };
}
function decodeHtml(value) {
  return text(value).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&ndash;|&mdash;/gi, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function htmlToText(html) {
  return decodeHtml(String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}
function htmlToStructuredLines(html) {
  const raw = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:div|li|tr|td|th|p|section|article|h[1-6]|a|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtml(raw).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function getTournamentId(match = {}) {
  const explicit = text(match.tournament_catalog_id || match.tournamentCatalogId || match.canonical_tournament_key).toLowerCase();
  if (OFFICIAL_TOURNAMENTS[explicit]) return explicit;
  const hay = [match.league, match.tournament, match.tournament_name, match.tournament_canonical_name, match.canonical_tournament_key].map(text).join(' ').toLowerCase();
  const isWta = /\bwta\b/.test(hay);
  const isAtp = /\batp\b/.test(hay);
  if (hay.includes('washington') || hay.includes('citi open') || hay.includes('mubadala dc')) return isWta ? 'wta_500_washington' : 'atp_500_washington';
  if (hay.includes('cincinnati')) return isWta ? 'wta_1000_cincinnati' : 'atp_m1000_cincinnati';
  if (hay.includes('canada') || hay.includes('toronto') || hay.includes('montreal') || hay.includes('national bank')) return isWta ? 'wta_1000_canada' : 'atp_m1000_canada';
  if (hay.includes('guadalajara')) return 'wta_1000_guadalajara';
  if (hay.includes('us open') || hay.includes('new york')) return isWta ? 'wta_gs_us_open' : 'atp_gs_us_open';

  // Provider legacy usa spesso soltanto "[ATP/WTA] Grand Slam". Nel periodo fine agosto/settembre
  // il torneo corrisponde allo US Open; fuori da questa finestra il resolver resta fail-closed.
  if (hay.includes('grand slam')) {
    const dateKey = parseDateKey(match.canonical_match_datetime || match.match_date);
    const month = Number(String(dateKey).slice(5, 7));
    const day = Number(String(dateKey).slice(8, 10));
    const usOpenWindow = month === 9 || (month === 8 && day >= 20);
    if (usOpenWindow) return isWta ? 'wta_gs_us_open' : isAtp ? 'atp_gs_us_open' : '';
  }
  return '';
}
function getOfficialProviderMetadata(match = {}) {
  const tournamentId = getTournamentId(match);
  const base = OFFICIAL_TOURNAMENTS[tournamentId];
  if (!base) return null;
  const dateKey = parseDateKey(match.canonical_match_datetime || match.match_date);
  const year = /^\d{4}/.test(dateKey) ? dateKey.slice(0, 4) : String(new Date().getUTCFullYear());
  const url = base.url || text(base.urlTemplate).replace('{year}', year);
  if (!url) return null;
  return { ...base, tournamentId, year, url };
}
function supportsOfficialNetwork(match = {}) { return Boolean(getOfficialProviderMetadata(match)); }
function pairMatches(record, match) {
  return (samePlayer(record.home, match.home_team || match.home) && samePlayer(record.away, match.away_team || match.away)) ||
    (samePlayer(record.home, match.away_team || match.away) && samePlayer(record.away, match.home_team || match.home));
}
function verifySeedRecord(record) {
  const copy = { ...record };
  const expected = text(copy.recordHash);
  delete copy.recordHash;
  return Boolean(expected && sha256(copy) === expected && parseScore(record.score).valid && record.providerCompleted === true);
}
function loadSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const computedSeedHash = sha256(seed.records || []);
  const valid = seed.version === SEED_VERSION && computedSeedHash === seed.seedHash && Array.isArray(seed.records) && seed.records.every(verifySeedRecord);
  if (!valid) throw new Error('PATCH29_R1_OFFICIAL_SEED_INTEGRITY_FAILED');
  return seed;
}
function verifyRetirementRecord(record) {
  const copy = { ...record };
  const expected = text(copy.recordHash);
  delete copy.recordHash;
  return Boolean(expected && sha256(copy) === expected && /\bRET\b|W\/O|WALKOVER/i.test(text(record.score)) && record.requiresBookmakerRule === true && record.automaticSettlement === false);
}
function loadRetirementEvidence() {
  const evidence = JSON.parse(fs.readFileSync(RETIREMENT_PATH, 'utf8'));
  const valid = evidence.version === RETIREMENT_EVIDENCE_VERSION && sha256(evidence.records || []) === evidence.evidenceHash && Array.isArray(evidence.records) && evidence.records.every(verifyRetirementRecord);
  if (!valid) throw new Error('PATCH29_R1_RETIREMENT_EVIDENCE_INTEGRITY_FAILED');
  return evidence;
}
function buildResolution(record, match, origin = 'SEED') {
  const home = match.home_team || match.home;
  const away = match.away_team || match.away;
  let winnerSide = null;
  if (samePlayer(record.winner, home)) winnerSide = 1;
  else if (samePlayer(record.winner, away)) winnerSide = 2;
  if (!winnerSide) return null;
  const scoreAudit = parseScore(record.score);
  if (!scoreAudit.valid) return null;
  return {
    winner: winnerSide,
    winnerName: record.winner,
    winner_player_name: record.winner,
    totalGames: record.totalGames == null ? scoreAudit.totalGames : Number(record.totalGames),
    isVoid: false,
    source: record.source || `${record.tour || 'TOUR'}_OFFICIAL_RESULTS_PATCH29`,
    sourceEventId: record.sourceEventId,
    observedAt: record.observedAt || new Date().toISOString(),
    providerCompleted: true,
    score: record.score,
    scoreOrientation: 'WINNER_FIRST',
    confidence: Number(record.confidence || 0.99),
    rawEvidence: { ...record, recordHash: record.recordHash || sha256(record), resolverVersion: VERSION, origin },
    evidenceHash: record.recordHash || sha256(record),
    officialUrl: record.sourceUrl || null,
    note: `Patch 29 R1: risultato ufficiale ${record.tour || 'Tennis'} verificato (${origin}).`
  };
}
function buildRetirementReview(record, match, origin = 'SIGNED_OFFICIAL_RETIREMENT') {
  const home = match.home_team || match.home;
  const away = match.away_team || match.away;
  const winnerSide = samePlayer(record.winner, home) ? 1 : samePlayer(record.winner, away) ? 2 : null;
  if (!winnerSide) return null;
  return {
    winner: winnerSide,
    winnerName: record.winner,
    winner_player_name: record.winner,
    totalGames: null,
    isVoid: false,
    source: record.source,
    sourceEventId: record.sourceEventId,
    observedAt: record.observedAt || new Date().toISOString(),
    providerCompleted: true,
    score: record.score,
    scoreOrientation: 'WINNER_FIRST',
    confidence: Number(record.confidence || 0.99),
    rawEvidence: { ...record, resolverVersion: VERSION, origin },
    evidenceHash: record.recordHash || sha256(record),
    officialUrl: record.sourceUrl || null,
    requiresBookmakerRule: true,
    automaticSettlement: false,
    note: 'Risultato ufficiale con ritiro acquisito; la chiusura del mercato richiede la regola del bookmaker.'
  };
}
function dateDistanceDays(a, b) {
  const aa = Date.parse(`${a}T00:00:00Z`), bb = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(aa) && Number.isFinite(bb) ? Math.abs(aa - bb) / 86400000 : Number.POSITIVE_INFINITY;
}
function resolveFromSeed(match, seed = loadSeed()) {
  const matchDate = parseDateKey(match.canonical_match_datetime || match.match_date);
  const tournamentId = getTournamentId(match);
  const candidates = (seed.records || []).filter(record => pairMatches(record, match) && (!tournamentId || record.tournamentCatalogId === tournamentId));
  const exact = candidates.find(record => record.date === matchDate);
  if (exact) return buildResolution(exact, match, 'SIGNED_OFFICIAL_SEED');
  const adjacent = candidates.filter(record => dateDistanceDays(record.date, matchDate) <= 1);
  return adjacent.length === 1 ? buildResolution(adjacent[0], match, 'SIGNED_OFFICIAL_SEED_ADJACENT_DATE') : null;
}
function resolveRetirementEvidence(match, evidence = loadRetirementEvidence()) {
  const matchDate = parseDateKey(match.canonical_match_datetime || match.match_date);
  const tournamentId = getTournamentId(match);
  const candidates = (evidence.records || []).filter(record => pairMatches(record, match) && (!tournamentId || record.tournamentCatalogId === tournamentId));
  const exact = candidates.find(record => record.date === matchDate);
  if (exact) return buildRetirementReview(exact, match);
  const adjacent = candidates.filter(record => dateDistanceDays(record.date, matchDate) <= 1);
  return adjacent.length === 1 ? buildRetirementReview(adjacent[0], match, 'SIGNED_OFFICIAL_RETIREMENT_ADJACENT_DATE') : null;
}
function scoreCellsFromLine(line, playerName) {
  const cleaned = text(line).replace(new RegExp(`^.*?${lastName(playerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '')
    .replace(/\(\s*\d+\s*\)/g, ' ').replace(/\^\{\d+\}/g, ' ').replace(/[·•]/g, ' ');
  const pipeCells = cleaned.split('|').map(cell => cell.trim()).filter(Boolean);
  const source = pipeCells.length >= 2 ? pipeCells : [cleaned];
  const values = [];
  for (const cell of source) {
    const m = cell.match(/(?:^|\s)([0-7])(?:\s|$|\.)/);
    if (m) values.push(Number(m[1]));
  }
  if (!values.length) {
    for (const m of cleaned.matchAll(/(?:^|\s)([0-7])(?=\s|$|\.)/g)) values.push(Number(m[1]));
  }
  return values.slice(0, 3);
}
function setsWon(scores, opponentScores) {
  let won = 0;
  for (let i = 0; i < Math.min(scores.length, opponentScores.length); i += 1) if (scores[i] > opponentScores[i]) won += 1;
  return won;
}
function buildRuntimeRecord(match, metadata, homeScores, awayScores, winnerSide, origin) {
  const home = match.home_team || match.home;
  const away = match.away_team || match.away;
  const winner = winnerSide === 1 ? home : away;
  const winnerScores = winnerSide === 1 ? homeScores : awayScores;
  const loserScores = winnerSide === 1 ? awayScores : homeScores;
  const setCount = Math.min(winnerScores.length, loserScores.length);
  if (setCount < 2) return null;
  const score = Array.from({ length: setCount }, (_, i) => `${winnerScores[i]}-${loserScores[i]}`).join(' ');
  const audit = parseScore(score);
  if (!audit.valid) return null;
  const record = {
    date: parseDateKey(match.canonical_match_datetime || match.match_date), home, away, winner,
    winnerSide, score, totalGames: audit.totalGames,
    tour: metadata.tour || 'WTA', tournamentCatalogId: getTournamentId(match),
    source: metadata.source || 'WTA_OFFICIAL_RESULTS_PATCH29', sourceUrl: metadata.url || null,
    sourceEventId: `${metadata.tour || 'WTA'}OFF:${sha256({ date: parseDateKey(match.match_date), home: normalizeName(home), away: normalizeName(away), winner: normalizeName(winner), score }).slice(0, 24)}`,
    observedAt: new Date().toISOString(), providerCompleted: true, confidence: 0.99,
    evidenceType: 'OFFICIAL_TOUR_RESULT_RUNTIME'
  };
  record.recordHash = sha256(record);
  return buildResolution(record, match, origin);
}
function parseWtaOfficialDrawText(raw, match, metadata = {}) {
  const lines = htmlToStructuredLines(raw);
  const home = match.home_team || match.home;
  const away = match.away_team || match.away;
  const homeLast = lastName(home), awayLast = lastName(away);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].toLowerCase().includes(homeLast)) continue;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 10); j += 1) {
      if (!lines[j].toLowerCase().includes(awayLast)) continue;
      const homeScores = scoreCellsFromLine(lines[i], home);
      const awayScores = scoreCellsFromLine(lines[j], away);
      if (homeScores.length < 2 || awayScores.length < 2) continue;
      const homeWon = setsWon(homeScores, awayScores), awayWon = setsWon(awayScores, homeScores);
      if (homeWon < 2 && awayWon < 2) continue;
      return buildRuntimeRecord(match, metadata, homeScores, awayScores, homeWon > awayWon ? 1 : 2, 'LIVE_WTA_OFFICIAL_DRAW');
    }
  }
  const body = htmlToText(raw);
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const homePattern = `(?:${normalizeName(home)[0]}\\.?\\s*)?${escaped(homeLast)}`;
  const awayPattern = `(?:${normalizeName(away)[0]}\\.?\\s*)?${escaped(awayLast)}`;
  const scoreCellsPattern = '([0-7](?:\\s+[0-7]){1,2})';
  const patterns = [
    new RegExp(`${homePattern}[^A-Za-z]{0,80}${scoreCellsPattern}[\s\S]{0,160}?${awayPattern}[^A-Za-z]{0,80}${scoreCellsPattern}`, 'i'),
    new RegExp(`${awayPattern}[^A-Za-z]{0,80}${scoreCellsPattern}[\s\S]{0,160}?${homePattern}[^A-Za-z]{0,80}${scoreCellsPattern}`, 'i')
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const found = body.match(patterns[index]);
    if (!found) continue;
    const parse = value => [...value.matchAll(/(?:^|\s)([0-7])(?=\s|$)/g)].map(m => Number(m[1])).slice(0, 3);
    const first = parse(found[1]), second = parse(found[2]);
    const homeScores = index === 0 ? first : second;
    const awayScores = index === 0 ? second : first;
    const homeWon = setsWon(homeScores, awayScores), awayWon = setsWon(awayScores, homeScores);
    if (homeWon >= 2 || awayWon >= 2) return buildRuntimeRecord(match, metadata, homeScores, awayScores, homeWon > awayWon ? 1 : 2, 'LIVE_WTA_OFFICIAL_DRAW_FLAT');
  }
  return null;
}
function parseAtpOfficialResultText(raw, match, metadata = {}) {
  const body = htmlToText(raw);
  const home = match.home_team || match.home;
  const away = match.away_team || match.away;
  const markers = [...body.matchAll(/Game Set and Match\s+([^\.]{2,90})\.\s*([^\.]{2,90})\s+wins the match\s+([0-9][0-9\s\-:()]+(?:RET\.?|W\/O)?)/gi)];
  for (const marker of markers) {
    const winner = text(marker[1]);
    if (!samePlayer(winner, home) && !samePlayer(winner, away)) continue;
    const index = marker.index || 0;
    const windowText = body.slice(Math.max(0, index - 700), Math.min(body.length, index + marker[0].length + 100));
    if (!windowText.toLowerCase().includes(lastName(home)) || !windowText.toLowerCase().includes(lastName(away))) continue;
    const score = text(marker[3]).replace(/\s+RET\.?$/i, ' RET').trim();
    if (/\bRET\b|W\/O/i.test(score)) return null;
    const audit = parseScore(score);
    if (!audit.valid) continue;
    const record = {
      date: parseDateKey(match.canonical_match_datetime || match.match_date), home, away, winner,
      winnerSide: samePlayer(winner, home) ? 1 : 2, score, totalGames: audit.totalGames,
      tour: metadata.tour || 'ATP', tournamentCatalogId: getTournamentId(match),
      source: metadata.source || 'ATP_OFFICIAL_RESULTS_PATCH29', sourceUrl: metadata.url || null,
      sourceEventId: `${metadata.tour || 'ATP'}OFF:${sha256({ date: parseDateKey(match.match_date), home: normalizeName(home), away: normalizeName(away), winner: normalizeName(winner), score }).slice(0, 24)}`,
      observedAt: new Date().toISOString(), providerCompleted: true, confidence: 0.99,
      evidenceType: 'OFFICIAL_TOUR_RESULT_RUNTIME'
    };
    record.recordHash = sha256(record);
    return buildResolution(record, match, 'LIVE_ATP_OFFICIAL_PAGE');
  }
  return null;
}
function parseOfficialResultText(raw, match, metadata = {}) {
  if (String(metadata.tour || '').toUpperCase() === 'WTA' || metadata.format === 'WTA_DRAW_TEXT') return parseWtaOfficialDrawText(raw, match, metadata);
  return parseAtpOfficialResultText(raw, match, metadata);
}
function cachePathForUrl(url) { return path.join(CACHE_DIR, `${sha256(url)}.json`); }
function readCachedPage(url, now = Date.now()) {
  const memory = pageMemoryCache.get(url);
  if (memory && now - memory.cachedAt <= PAGE_CACHE_TTL_MS) return { text: memory.text, source: 'MEMORY' };
  try {
    const file = cachePathForUrl(url);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.url !== url || !parsed.text || now - Number(parsed.cachedAt || 0) > PAGE_CACHE_TTL_MS) return null;
    pageMemoryCache.set(url, { text: parsed.text, cachedAt: Number(parsed.cachedAt) });
    return { text: parsed.text, source: 'DISK' };
  } catch (_) { return null; }
}
function writeCachedPage(url, body, now = Date.now()) {
  pageMemoryCache.set(url, { text: body, cachedAt: now });
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = cachePathForUrl(url), temp = `${file}.tmp-${process.pid}-${now}`;
    fs.writeFileSync(temp, JSON.stringify({ version: CACHE_VERSION, url, cachedAt: now, text: body }));
    try { fs.renameSync(temp, file); } catch (_) { fs.copyFileSync(temp, file); fs.rmSync(temp, { force: true }); }
  } catch (_) { /* cache diagnostics must never block settlement */ }
}
async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'BettingApp-TennisSettlement/29-R1', accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok) throw new Error(`OFFICIAL_HTTP_${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
async function fetchTextCached(url, options = {}) {
  const cached = options.forceRefresh === true ? null : readCachedPage(url);
  if (cached) return cached.text;
  if (pageInFlight.has(url)) return pageInFlight.get(url);
  const task = Promise.resolve().then(() => (options.fetchText || fetchText)(url, options)).then(body => {
    writeCachedPage(url, body);
    return body;
  }).finally(() => pageInFlight.delete(url));
  pageInFlight.set(url, task);
  return task;
}
async function resolveOfficialSettlement(match, options = {}) {
  const patch34R4Truth = settlementTruthR4.resolve(match, options.patch34R4 || {});
  if (patch34R4Truth) return patch34R4Truth;
  const seedResolution = resolveFromSeed(match, options.seed || loadSeed());
  if (seedResolution) return seedResolution;
  const retirementReview = resolveRetirementEvidence(match, options.retirementEvidence || loadRetirementEvidence());
  if (retirementReview) return retirementReview;
  if (options.allowNetwork === false) return null;
  const provider = getOfficialProviderMetadata(match);
  if (!provider || typeof fetch !== 'function') return null;
  let html;
  try {
    html = await fetchTextCached(provider.url, options);
    lastOfficialNetworkFailure = null;
  } catch (error) {
    // AUDIT16D_R3_T1: the official page is one evidence source, not the settlement
    // authority itself. Network denial/timeouts must fail closed for this provider and
    // allow the existing downstream vault/certified/API fallbacks to continue.
    lastOfficialNetworkFailure = {
      observedAt: new Date().toISOString(),
      tournamentId: provider.tournamentId || null,
      tour: provider.tour || null,
      host: (() => { try { return new URL(provider.url).hostname; } catch (_) { return null; } })(),
      code: error?.code || null,
      name: error?.name || 'Error',
      message: text(error?.message || 'OFFICIAL_NETWORK_ERROR').slice(0, 160),
      fallbackAllowed: true,
      settlementAuthority: false
    };
    if (typeof options.onNetworkFailure === 'function') {
      try { options.onNetworkFailure({ ...lastOfficialNetworkFailure }); } catch (_) { /* diagnostics callback cannot block fallback */ }
    }
    return null;
  }
  return parseOfficialResultText(html, match, provider);
}
function buildPreview(rows = [], options = {}) {
  const seed = options.seed || loadSeed();
  const retirementEvidence = options.retirementEvidence || loadRetirementEvidence();
  const now = Number(options.now || Date.now());
  const details = [];
  for (const row of rows) {
    const start = new Date(row.canonical_match_datetime || row.match_date).getTime();
    if (Number.isFinite(start) && start > now) {
      details.push({ betId: row.id, match: `${row.home_team} - ${row.away_team}`, status: 'FUTURE_NOT_ELIGIBLE' });
      continue;
    }
    const resolution = resolveFromSeed(row, seed);
    const retirement = resolution ? null : resolveRetirementEvidence(row, retirementEvidence);
    details.push({
      betId: row.id, match: `${row.home_team} - ${row.away_team}`,
      status: resolution ? 'OFFICIAL_VERIFIED_CANDIDATE' : retirement ? 'OFFICIAL_RETIREMENT_MANUAL_REVIEW' : 'NO_OFFICIAL_EVIDENCE',
      source: resolution?.source || retirement?.source || null, winner: resolution?.winnerName || retirement?.winnerName || null,
      score: resolution?.score || retirement?.score || null, sourceEventId: resolution?.sourceEventId || retirement?.sourceEventId || null,
      requiresBookmakerRule: retirement?.requiresBookmakerRule === true
    });
  }
  return {
    success: true, version: VERSION, readOnly: true, scanned: details.length,
    officialCandidates: details.filter(x => x.status === 'OFFICIAL_VERIFIED_CANDIDATE').length,
    retirementManualReview: details.filter(x => x.status === 'OFFICIAL_RETIREMENT_MANUAL_REVIEW').length,
    future: details.filter(x => x.status === 'FUTURE_NOT_ELIGIBLE').length,
    pendingEvidence: details.filter(x => x.status === 'NO_OFFICIAL_EVIDENCE').length,
    details
  };
}
function health() {
  const seed = loadSeed();
  const retirement = loadRetirementEvidence();
  return {
    success: true, healthy: true, status: lastOfficialNetworkFailure ? 'READY_WITH_OFFICIAL_NETWORK_DEGRADED' : 'READY', version: VERSION,
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    seedVersion: seed.version, seedRecords: seed.records.length, seedHash: seed.seedHash,
    seedByTour: seed.records.reduce((acc, record) => { acc[record.tour] = Number(acc[record.tour] || 0) + 1; return acc; }, {}),
    retirementEvidenceVersion: retirement.version, retirementEvidenceRecords: retirement.records.length, retirementEvidenceHash: retirement.evidenceHash,
    officialTournamentProviders: Object.keys(OFFICIAL_TOURNAMENTS),
    pageCacheTtlMs: PAGE_CACHE_TTL_MS, memoryCacheEntries: pageMemoryCache.size, inFlightRequests: pageInFlight.size,
    lastOfficialNetworkFailure: lastOfficialNetworkFailure ? { ...lastOfficialNetworkFailure } : null,
    zeroOddsApiCalls: true, retirementAutoSettlement: false, wtaDrawParserActive: true,
    patch34R4Truth: settlementTruthR4.health(),
    policy: 'PATCH34_R4_SIGNED_TRUTH_FIRST_OFFICIAL_TOUR_WTA_DRAW_RETIREMENT_AND_SUSPENSION_NEVER_AUTO_SETTLE_WEAK_WEB_PROPOSE_ONLY'
  };
}

module.exports = {
  VERSION, AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION, SEED_VERSION, RETIREMENT_EVIDENCE_VERSION, CACHE_VERSION, PAGE_CACHE_TTL_MS, OFFICIAL_TOURNAMENTS,
  normalizeName, samePlayer, parseDateKey, dateDistanceDays, parseScore, htmlToText, htmlToStructuredLines, getTournamentId, getOfficialProviderMetadata, supportsOfficialNetwork,
  loadSeed, verifySeedRecord, loadRetirementEvidence, verifyRetirementRecord, resolveFromSeed, resolveRetirementEvidence,
  parseAtpOfficialResultText, parseWtaOfficialDrawText, parseOfficialResultText,
  resolveOfficialSettlement, buildPreview, health, readCachedPage, writeCachedPage, fetchTextCached, sha256
};
