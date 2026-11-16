'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPlayerIdentity, normalizePlayerName, buildSafeIdentityCandidates } = require('./tennisPlayerIdentity');
const tennisHistoricalPlayerStats = require('./tennisHistoricalPlayerStats');
const tennisTournamentStageModel = require('./tennisTournamentStageModel');
const tennisTourDataReadiness = require('./tennisTourDataReadiness');
const canonicalPlayerEvidenceBridge = require('./tennisCanonicalPlayerEvidenceBridge');

const TENNIS_PLAYER_EVIDENCE_VERSION = 'TENNIS_PLAYER_EVIDENCE_V6_PATCH26';
const TENNIS_MATCHUP_FEATURE_VERSION = 'TENNIS_MATCHUP_FEATURE_V5_PATCH26';
const SOURCE_TIER = 'STRUCTURED_LOCAL_VERIFIED_REFRESHABLE';
const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];

const state = {
  initialized: false,
  dataDir: null,
  loadedAt: null,
  files: [],
  rejectedRows: 0,
  duplicateRows: 0,
  matchCount: 0,
  latestMatchAt: null,
  earliestMatchAt: null,
  players: new Map(),
  aliases: new Map(),
  ambiguousAliases: new Set(),
  refreshManifest: null,
  sourceTierCounts: {}
};

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 4) {
  const number = finite(value, 0);
  return Number(number.toFixed(decimals));
}
function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function normalizeSurface(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('clay') || text.includes('terra')) return 'Clay';
  if (text.includes('grass') || text.includes('erba')) return 'Grass';
  if (text.includes('carpet')) return 'Carpet';
  return 'Hard';
}
function parseAsOfDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 12), Number(match[5] || 0), Number(match[6] || 0)));
  }
  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 12), Number(match[5] || 0), Number(match[6] || 0)));
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function dateIsoDay(value) {
  const date = parseAsOfDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}
function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current); current = '';
    } else current += char;
  }
  values.push(current);
  return values;
}
function parseCsvFile(file) {
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = values[i] ?? '';
    return row;
  });
}
function parseSackmannDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isFinite(date.getTime()) ? date : null;
}
function parseStats(row, prefix) {
  const svpt = finite(row[`${prefix}_svpt`], null);
  const firstIn = finite(row[`${prefix}_1stIn`], null);
  const firstWon = finite(row[`${prefix}_1stWon`], null);
  const secondWon = finite(row[`${prefix}_2ndWon`], null);
  const serviceGames = finite(row[`${prefix}_SvGms`], null);
  const bpSaved = finite(row[`${prefix}_bpSaved`], null);
  const bpFaced = finite(row[`${prefix}_bpFaced`], null);
  const ace = finite(row[`${prefix}_ace`], null);
  const df = finite(row[`${prefix}_df`], null);
  const complete = [svpt, firstIn, firstWon, secondWon].every(value => value !== null) && svpt > 0;
  return { svpt, firstIn, firstWon, secondWon, serviceGames, bpSaved, bpFaced, ace, df, complete };
}
function scoreMetrics(score, wonPerspective = true, bestOf = 3) {
  const text = String(score || '').toUpperCase();
  const retired = /RET|DEF|ABD/.test(text);
  const walkover = /W\/O|WALKOVER|WO\b/.test(text);
  const sets = [];
  for (const token of text.split(/\s+/)) {
    const match = token.match(/^(\d{1,2})-(\d{1,2})(?:\([^)]*\))?$/);
    if (!match) continue;
    const winnerGames = Number(match[1]); const loserGames = Number(match[2]);
    const own = wonPerspective ? winnerGames : loserGames;
    const opp = wonPerspective ? loserGames : winnerGames;
    sets.push({ own, opp, won: own > opp, tiebreak: (winnerGames === 7 && loserGames === 6) || (winnerGames === 6 && loserGames === 7) });
  }
  const setsNeeded = Math.ceil(Number(bestOf || 3) / 2);
  const ownSets = sets.filter(set => set.won).length;
  const oppSets = sets.length - ownSets;
  const decidingSetPlayed = sets.length >= (setsNeeded * 2 - 1);
  const decidingSetWon = decidingSetPlayed && sets.length > 0 ? sets[sets.length - 1].won : null;
  const tiebreakSets = sets.filter(set => set.tiebreak);
  return {
    retired, walkover, setCount: sets.length, ownSets, oppSets,
    decidingSetPlayed, decidingSetWon,
    tiebreakPlayed: tiebreakSets.length,
    tiebreakWon: tiebreakSets.filter(set => set.won).length
  };
}
function kFactor(level) {
  const key = String(level || '').toUpperCase();
  if (key === 'G') return 30;
  if (['M', 'F'].includes(key)) return 27;
  if (['A', 'P', 'I'].includes(key)) return 24;
  if (['C', 'D'].includes(key)) return 20;
  return 22;
}
function eloExpected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function ensurePlayer(canonicalName) {
  if (!state.players.has(canonicalName)) {
    state.players.set(canonicalName, {
      name: canonicalName,
      overallElo: 1500,
      surfaceElo: Object.fromEntries(SURFACES.map(surface => [surface, 1500])),
      history: []
    });
  }
  return state.players.get(canonicalName);
}
function addAlias(name) {
  const identity = buildPlayerIdentity(name);
  for (const key of [identity.normalized, identity.key, ...(identity.possibleKeys || [])].filter(Boolean)) {
    if (state.ambiguousAliases.has(key)) continue;
    if (!state.aliases.has(key)) state.aliases.set(key, identity.normalized);
    else if (state.aliases.get(key) !== identity.normalized) {
      state.aliases.delete(key); state.ambiguousAliases.add(key);
    }
  }
}
function resetState() {
  state.initialized = false; state.dataDir = null; state.loadedAt = null; state.files = [];
  state.rejectedRows = 0; state.duplicateRows = 0; state.matchCount = 0;
  state.latestMatchAt = null; state.earliestMatchAt = null;
  state.players = new Map(); state.aliases = new Map(); state.ambiguousAliases = new Set();
  state.refreshManifest = null; state.sourceTierCounts = {};
}
function readRefreshManifest(dataDir) {
  try {
    const file = path.join(dataDir, 'tennis_data_refresh_manifest.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}
function inferSourceTier(sourceName, manifest = null) {
  const mapped = manifest?.sources?.find(item => item.localFile === sourceName);
  if (mapped?.sourceTier) return mapped.sourceTier;
  const lower = String(sourceName || '').toLowerCase();
  if (lower.includes('challenger') || lower.includes('qual_chall')) return lower.startsWith('wta') ? 'WTA_QUAL_ITF_STRUCTURED' : 'ATP_QUAL_CHALL_STRUCTURED';
  return lower.startsWith('wta') ? 'WTA_MAIN_STRUCTURED' : 'ATP_MAIN_STRUCTURED';
}
function discoverFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter(name => /^(atp|wta)_matches(?:_(?:challenger|qual_chall|qual_itf))?_20\d{2}\.csv$/i.test(name))
    .map(name => path.join(dataDir, name))
    .sort();
}
function init(dataDir, options = {}) {
  const resolved = path.resolve(dataDir || path.join(__dirname, 'sackmann_data'));
  if (state.initialized && state.dataDir === resolved && options.force !== true) return getStatus();
  resetState(); state.dataDir = resolved;
  state.refreshManifest = readRefreshManifest(resolved);
  const files = discoverFiles(resolved);
  if (!files.length) throw new Error(`PATCH12_SACKMANN_LOCAL_DATA_NOT_FOUND:${resolved}`);
  const rawMatches = [];
  const dedupe = new Set();
  for (const file of files) {
    const stat = fs.statSync(file);
    const fileHash = sha256(fs.readFileSync(file));
    const sourceName = path.basename(file);
    const sourceTier = inferSourceTier(sourceName, state.refreshManifest);
    state.sourceTierCounts[sourceTier] = Number(state.sourceTierCounts[sourceTier] || 0);
    const tour = sourceName.toLowerCase().startsWith('wta') ? 'WTA' : 'ATP';
    const rows = parseCsvFile(file);
    const sourceYearMatch = sourceName.match(/(20\d{2})\.csv$/);
    const sourceYear = sourceYearMatch ? Number(sourceYearMatch[1]) : null;
    let accepted = 0; let rejected = 0;
    for (const row of rows) {
      const date = parseSackmannDate(row.tourney_date);
      const dateYear = date ? date.getUTCFullYear() : null;
      const winner = normalizePlayerName(row.winner_name);
      const loser = normalizePlayerName(row.loser_name);
      if (!date || (sourceYear && (dateYear < sourceYear - 1 || dateYear > sourceYear)) || !winner || !loser || winner === loser) { rejected += 1; state.rejectedRows += 1; continue; }
      const key = [tour, row.tourney_id, row.match_num, date.toISOString().slice(0, 10), winner, loser].join('|');
      if (dedupe.has(key)) { state.duplicateRows += 1; continue; }
      dedupe.add(key); accepted += 1;
      rawMatches.push({
        key, tour, dateMs: date.getTime(), dateIso: date.toISOString(), surface: normalizeSurface(row.surface),
        level: row.tourney_level || null, tournament: row.tourney_name || null, round: row.round || null,
        winner, loser, winnerRank: finite(row.winner_rank, null), loserRank: finite(row.loser_rank, null),
        score: row.score || '', bestOf: finite(row.best_of, 3), minutes: finite(row.minutes, null),
        winnerStats: parseStats(row, 'w'), loserStats: parseStats(row, 'l'),
        sourceFile: sourceName, sourceHash: fileHash, sourceTier
      });
      state.sourceTierCounts[sourceTier] += 1;
      addAlias(winner); addAlias(loser);
    }
    const refreshSource = state.refreshManifest?.sources?.find(item => item.localFile === sourceName) || null;
    state.files.push({ path: sourceName, sourceTier, sourceId: refreshSource?.id || null, remotePath: refreshSource?.remotePath || null, refreshedAt: state.refreshManifest?.lastSuccessAt || null, sizeBytes: stat.size, sha256: fileHash, rows: rows.length, accepted, rejected, modifiedAt: stat.mtime.toISOString() });
  }
  rawMatches.sort((a, b) => a.dateMs - b.dateMs || a.key.localeCompare(b.key));
  for (const match of rawMatches) {
    const winner = ensurePlayer(match.winner); const loser = ensurePlayer(match.loser);
    const surface = match.surface;
    const winnerOverallPre = winner.overallElo; const loserOverallPre = loser.overallElo;
    const winnerSurfacePre = winner.surfaceElo[surface] || 1500; const loserSurfacePre = loser.surfaceElo[surface] || 1500;
    const expectedWinner = eloExpected(winnerOverallPre, loserOverallPre);
    const expectedWinnerSurface = eloExpected(winnerSurfacePre, loserSurfacePre);
    const k = kFactor(match.level);
    winner.overallElo += k * (1 - expectedWinner); loser.overallElo += k * (0 - (1 - expectedWinner));
    const surfaceK = k * 0.85;
    winner.surfaceElo[surface] = winnerSurfacePre + surfaceK * (1 - expectedWinnerSurface);
    loser.surfaceElo[surface] = loserSurfacePre + surfaceK * (0 - (1 - expectedWinnerSurface));
    const winnerScore = scoreMetrics(match.score, true, match.bestOf);
    const loserScore = scoreMetrics(match.score, false, match.bestOf);
    winner.history.push({
      dateMs: match.dateMs, dateIso: match.dateIso, surface, tour: match.tour, level: match.level, tournament: match.tournament, round: tennisTournamentStageModel.normalizeTournamentRound(match.round),
      opponent: match.loser, won: true, rank: match.winnerRank, opponentRank: match.loserRank, score: winnerScore,
      stats: match.winnerStats, opponentStats: match.loserStats, minutes: match.minutes,
      opponentEloPre: loserOverallPre, expectedPre: expectedWinner,
      overallEloPost: winner.overallElo, surfaceEloPost: { ...winner.surfaceElo }, sourceFile: match.sourceFile, sourceHash: match.sourceHash, sourceTier: match.sourceTier
    });
    loser.history.push({
      dateMs: match.dateMs, dateIso: match.dateIso, surface, tour: match.tour, level: match.level, tournament: match.tournament, round: tennisTournamentStageModel.normalizeTournamentRound(match.round),
      opponent: match.winner, won: false, rank: match.loserRank, opponentRank: match.winnerRank, score: loserScore,
      stats: match.loserStats, opponentStats: match.winnerStats, minutes: match.minutes,
      opponentEloPre: winnerOverallPre, expectedPre: 1 - expectedWinner,
      overallEloPost: loser.overallElo, surfaceEloPost: { ...loser.surfaceElo }, sourceFile: match.sourceFile, sourceHash: match.sourceHash, sourceTier: match.sourceTier
    });
  }
  state.initialized = true; state.loadedAt = new Date().toISOString(); state.matchCount = rawMatches.length;
  state.latestMatchAt = rawMatches.length ? rawMatches[rawMatches.length - 1].dateIso : null;
  state.earliestMatchAt = rawMatches.length ? rawMatches[0].dateIso : null;
  return getStatus();
}
function ensureInitialized(dataDir) {
  if (!state.initialized) init(dataDir || path.join(__dirname, 'sackmann_data'));
  return state;
}
function resolvePlayerName(name) {
  const normalized = normalizePlayerName(name);
  if (!normalized) return { status: 'UNAVAILABLE', requested: String(name || ''), canonical: null };
  if (state.players.has(normalized)) return { status: 'EXACT', requested: String(name || ''), canonical: normalized };
  const safeCandidates = buildSafeIdentityCandidates(name).filter(candidate => candidate !== normalized && state.players.has(candidate));
  if (safeCandidates.length === 1) {
    return { status: 'SAFE_SUFFIX_ALIAS', requested: String(name || ''), canonical: safeCandidates[0], reason: 'GENERATIONAL_SUFFIX_REMOVED' };
  }
  if (safeCandidates.length > 1) {
    return { status: 'CONFLICT', requested: String(name || ''), canonical: null, reason: 'MULTIPLE_SAFE_SUFFIX_CANDIDATES' };
  }
  const identity = buildPlayerIdentity(name);
  const candidates = new Set();
  for (const key of [identity.normalized, identity.key, ...(identity.possibleKeys || [])].filter(Boolean)) {
    if (state.ambiguousAliases.has(key)) return { status: 'CONFLICT', requested: String(name || ''), canonical: null, reason: `AMBIGUOUS_ALIAS:${key}` };
    const found = state.aliases.get(key); if (found) candidates.add(found);
  }
  if (candidates.size === 1) return { status: 'ALIAS', requested: String(name || ''), canonical: [...candidates][0] };
  if (candidates.size > 1) return { status: 'CONFLICT', requested: String(name || ''), canonical: null, reason: 'MULTIPLE_IDENTITY_CANDIDATES' };
  return { status: 'UNAVAILABLE', requested: String(name || ''), canonical: null, reason: 'PLAYER_NOT_FOUND' };
}
function historyBefore(player, asOfMs) {
  const rows = player?.history || [];
  let low = 0; let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].dateMs < asOfMs) low = mid + 1; else high = mid;
  }
  return rows.slice(0, low);
}
function weightedAverage(rows, getter, asOfMs, halfLifeDays = 90) {
  let numerator = 0; let denominator = 0;
  for (const row of rows) {
    const value = getter(row);
    if (!Number.isFinite(value)) continue;
    const days = Math.max(0, (asOfMs - row.dateMs) / 86400000);
    const weight = Math.pow(0.5, days / halfLifeDays);
    numerator += value * weight; denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}
function aggregateServeReturn(rows) {
  const totals = { svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, serviceGames: 0, bpSaved: 0, bpFaced: 0, ace: 0, df: 0, returnPoints: 0, returnWon: 0, returnGames: 0, breaks: 0, statMatches: 0 };
  for (const row of rows) {
    const own = row.stats || {}; const opp = row.opponentStats || {};
    if (own.complete) {
      totals.statMatches += 1; totals.svpt += own.svpt || 0; totals.firstIn += own.firstIn || 0;
      totals.firstWon += own.firstWon || 0; totals.secondWon += own.secondWon || 0;
      totals.serviceGames += own.serviceGames || 0; totals.bpSaved += own.bpSaved || 0; totals.bpFaced += own.bpFaced || 0;
      totals.ace += own.ace || 0; totals.df += own.df || 0;
    }
    if (opp.complete) {
      totals.returnPoints += opp.svpt || 0;
      totals.returnWon += Math.max(0, (opp.svpt || 0) - (opp.firstWon || 0) - (opp.secondWon || 0));
      totals.returnGames += opp.serviceGames || 0;
      if (opp.bpFaced !== null && opp.bpSaved !== null) totals.breaks += Math.max(0, opp.bpFaced - opp.bpSaved);
    }
  }
  const secondServeAttempts = Math.max(0, totals.svpt - totals.firstIn);
  return {
    statMatches: totals.statMatches,
    servePointsWon: totals.svpt > 0 ? (totals.firstWon + totals.secondWon) / totals.svpt : null,
    returnPointsWon: totals.returnPoints > 0 ? totals.returnWon / totals.returnPoints : null,
    firstServeIn: totals.svpt > 0 ? totals.firstIn / totals.svpt : null,
    firstServeWon: totals.firstIn > 0 ? totals.firstWon / totals.firstIn : null,
    secondServeWon: secondServeAttempts > 0 ? totals.secondWon / secondServeAttempts : null,
    aceRate: totals.svpt > 0 ? totals.ace / totals.svpt : null,
    doubleFaultRate: totals.svpt > 0 ? totals.df / totals.svpt : null,
    holdProxy: totals.serviceGames > 0 ? clamp(1 - (Math.max(0, totals.bpFaced - totals.bpSaved) / totals.serviceGames), 0, 1) : null,
    breakProxy: totals.returnGames > 0 ? clamp(totals.breaks / totals.returnGames, 0, 1) : null,
    breakPointsSaved: totals.bpFaced > 0 ? totals.bpSaved / totals.bpFaced : null
  };
}
function fatigueScore(restDays, matches14d, minutes14d) {
  let score = 70;
  if (restDays === null) score -= 10;
  else if (restDays < 1.5) score -= 28;
  else if (restDays < 2.5) score -= 14;
  else if (restDays > 14) score -= 5;
  score -= Math.max(0, matches14d - 4) * 7;
  score -= Math.max(0, minutes14d - 500) / 45;
  return clamp(score, 0, 100);
}
function buildHistoricalAggregate(playerName, asOf, options = {}) {
  try {
    return tennisHistoricalPlayerStats.getPlayerSnapshot(playerName, options.tour || options.tourType || options.league, asOf, {
      datasetPath: options.historicalDatasetPath,
      optional: true
    });
  } catch (error) {
    return {
      version: tennisHistoricalPlayerStats.TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
      status: 'UNAVAILABLE', reason: `PATCH16_HISTORICAL_DATA_ERROR:${error.message}`,
      playerName: String(playerName || ''), authority: 'AUXILIARY_SHADOW_ONLY',
      modelProbabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false
    };
  }
}
function buildPlayerEvidence(playerName, opponentName, surface, asOf, options = {}) {
  // PATCH12_R1_LEGACY_PLAYER_EVIDENCE_API_COMPATIBILITY
  // Compatibilità con la firma storica:
  //   buildPlayerEvidence(playerName, surface, asOf, options)
  // La firma interna completa resta:
  //   buildPlayerEvidence(playerName, opponentName, surface, asOf, options)
  if (asOf && typeof asOf === 'object' && !Array.isArray(asOf)) {
    options = asOf;
    asOf = surface;
    surface = opponentName;
    opponentName = options.opponentName || null;
  }
  options = options && typeof options === 'object' ? options : {};
  ensureInitialized(options.dataDir);
  const asOfDate = parseAsOfDate(asOf);
  const identity = resolvePlayerName(playerName);
  if (!asOfDate) return { version: TENNIS_PLAYER_EVIDENCE_VERSION, status: 'CONFLICT', reason: 'AS_OF_DATE_INVALID', playerName, opponentName, surface: normalizeSurface(surface), asOfAt: null, coverageScore: 0, confidenceScore: 0, historicalAggregate: null };
  const historicalAggregate = buildHistoricalAggregate(playerName, asOfDate, options);
  if (!identity.canonical) return { version: TENNIS_PLAYER_EVIDENCE_VERSION, status: identity.status === 'CONFLICT' ? 'CONFLICT' : 'UNAVAILABLE', reason: identity.reason || 'PLAYER_NOT_FOUND', playerName, normalizedName: normalizePlayerName(playerName), opponentName, surface: normalizeSurface(surface), asOfAt: asOfDate.toISOString(), coverageScore: 0, confidenceScore: 0, historicalAggregate, historicalValidationAuthority: false };
  const player = state.players.get(identity.canonical);
  const rows = historyBefore(player, asOfDate.getTime());
  if (!rows.length) return { version: TENNIS_PLAYER_EVIDENCE_VERSION, status: 'UNAVAILABLE', reason: 'NO_PREMATCH_HISTORY', playerName, normalizedName: identity.canonical, opponentName, surface: normalizeSurface(surface), asOfAt: asOfDate.toISOString(), coverageScore: 5, confidenceScore: 0, historicalAggregate, historicalValidationAuthority: false };
  const normalizedSurface = normalizeSurface(surface);
  const latest = rows[rows.length - 1];
  const last365 = rows.filter(row => asOfDate.getTime() - row.dateMs <= 365 * 86400000).slice(-60);
  const last180 = rows.filter(row => asOfDate.getTime() - row.dateMs <= 180 * 86400000).slice(-40);
  const surfaceRows = rows.filter(row => row.surface === normalizedSurface);
  const surfaceRecent = surfaceRows.filter(row => asOfDate.getTime() - row.dateMs <= 540 * 86400000).slice(-40);
  const statsRows = last365.length ? last365 : rows.slice(-50);
  const stats = aggregateServeReturn(statsRows);
  const recentWinRate = weightedAverage(last180, row => row.won ? 1 : 0, asOfDate.getTime(), 60);
  const opponentAdjusted = weightedAverage(last180, row => (row.won ? 1 : 0) - row.expectedPre, asOfDate.getTime(), 75);
  const recentQualityScore = opponentAdjusted === null ? null : clamp(50 + opponentAdjusted * 100, 0, 100);
  const surfaceWinRate = surfaceRecent.length ? surfaceRecent.filter(row => row.won).length / surfaceRecent.length : null;
  const currentRankRow = [...rows].reverse().find(row => Number.isFinite(row.rank));
  const currentRank = currentRankRow ? currentRankRow.rank : null;
  const restDays = Math.max(0, (asOfDate.getTime() - latest.dateMs) / 86400000);
  const last7 = rows.filter(row => asOfDate.getTime() - row.dateMs <= 7 * 86400000);
  const last14 = rows.filter(row => asOfDate.getTime() - row.dateMs <= 14 * 86400000);
  const minutes14d = last14.reduce((sum, row) => sum + (row.minutes || 0), 0);
  const last90 = rows.filter(row => asOfDate.getTime() - row.dateMs <= 90 * 86400000);
  const retirement90d = last90.filter(row => row.score?.retired).length;
  const deciding = statsRows.filter(row => row.score?.decidingSetPlayed);
  const tiebreakPlayed = statsRows.reduce((sum, row) => sum + Number(row.score?.tiebreakPlayed || 0), 0);
  const tiebreakWon = statsRows.reduce((sum, row) => sum + Number(row.score?.tiebreakWon || 0), 0);
  const lateRoundRows = rows.filter(row => ['QF', 'SF', 'F'].includes(tennisTournamentStageModel.normalizeTournamentRound(row.round))).slice(-40);
  const semifinalPlusRows = rows.filter(row => ['SF', 'F'].includes(tennisTournamentStageModel.normalizeTournamentRound(row.round))).slice(-30);
  const finalRows = rows.filter(row => tennisTournamentStageModel.normalizeTournamentRound(row.round) === 'F').slice(-20);
  const lateRoundWinRate = lateRoundRows.length ? lateRoundRows.filter(row => row.won).length / lateRoundRows.length : null;
  const lateRoundExpectedWinRate = lateRoundRows.length
    ? lateRoundRows.reduce((sum, row) => sum + clamp(finite(row.expectedPre, 0.5), 0, 1), 0) / lateRoundRows.length
    : null;
  const lateRoundPerformanceVsExpected = lateRoundWinRate === null || lateRoundExpectedWinRate === null
    ? null
    : lateRoundWinRate - lateRoundExpectedWinRate;
  const semifinalPlusWinRate = semifinalPlusRows.length ? semifinalPlusRows.filter(row => row.won).length / semifinalPlusRows.length : null;
  const finalWinRate = finalRows.length ? finalRows.filter(row => row.won).length / finalRows.length : null;
  const previousDifferentSurface = [...rows].reverse().find(row => row.surface !== normalizedSurface);
  const surfaceTransitionDays = previousDifferentSurface ? Math.max(0, (asOfDate.getTime() - previousDifferentSurface.dateMs) / 86400000) : null;
  // PATCH22_TOUR_AWARE_SOURCE_FRESHNESS_ACTIVITY_SEPARATION
  // Source freshness and player inactivity are different signals. A rested player must not
  // make a current source look stale, and a fresh ATP file must never mask stale WTA data.
  const evidenceReadiness = tennisTourDataReadiness.resolveEvidenceReadiness({
    tour: options.tour || options.tourType || options.league,
    tourType: options.tourType,
    league: options.league,
    tournamentName: options.tournamentName,
    tournamentLevel: options.tournamentLevel,
    tournamentCategory: options.tournamentCategory,
    targetId: options.targetId,
    restDays,
    activityDays: restDays
  }, {
    dataDir: options.dataDir || state.dataDir,
    now: asOfDate,
    projectRoot: options.projectRoot,
    report: options.tourDataReadinessReport
  });
  const freshnessDays = evidenceReadiness.sourceFreshnessDays;
  const freshnessStatus = evidenceReadiness.sourceFreshnessStatus;
  const sampleTotal = rows.length; const sampleSurface = surfaceRows.length; const sampleRecent = last180.length;
  const coverageScore = clamp(
    10 + Math.min(15, sampleTotal / 40 * 15) + Math.min(20, sampleSurface / 15 * 20) +
    Math.min(15, sampleRecent / 10 * 15) + Math.min(20, stats.statMatches / 15 * 20) +
    (currentRank ? 10 : 0) + (freshnessStatus === 'CURRENT' ? 10 : freshnessStatus === 'AGING' ? 4 : 0), 0, 100
  );
  const sourceFreshnessPenalty = Number(evidenceReadiness.sourceFreshnessPenalty || 0);
  const activityPenalty = Number(evidenceReadiness.activityPenalty || 0);
  const confidenceRaw = clamp(coverageScore * 0.72 + Math.min(18, Math.sqrt(sampleTotal) * 2.2) + Math.min(10, Math.sqrt(sampleSurface) * 2) - sourceFreshnessPenalty - activityPenalty, 0, 100);
  const confidenceScore = Math.min(confidenceRaw, Number(evidenceReadiness.combinedConfidenceCap || 100));
  let status = 'PARTIAL';
  if (coverageScore >= 70 && freshnessStatus === 'CURRENT') status = 'VERIFIED_CURRENT';
  else if (coverageScore >= 70 && ['AGING', 'STALE'].includes(freshnessStatus)) status = 'VERIFIED_STALE';
  else if (coverageScore < 35 || freshnessStatus === 'UNAVAILABLE') status = 'UNAVAILABLE';
  const sourceFiles = [...new Set(statsRows.map(row => row.sourceFile))].sort();
  const sourceTiers = [...new Set(statsRows.map(row => row.sourceTier).filter(Boolean))].sort();
  const core = {
    version: TENNIS_PLAYER_EVIDENCE_VERSION, status,
    reason: status === 'VERIFIED_STALE' ? (freshnessStatus === 'AGING' ? 'SOURCE_DATA_AGING' : 'SOURCE_DATA_STALE') : null,
    sourceTier: SOURCE_TIER, sourceTiers, playerName: String(playerName || ''), normalizedName: identity.canonical,
    identityStatus: identity.status, opponentName: String(opponentName || ''), surface: normalizedSurface,
    asOfAt: asOfDate.toISOString(), observedAt: latest.dateIso,
    freshnessStatus, freshnessDays: freshnessDays === null ? null : round(freshnessDays, 1),
    sourceTargetId: evidenceReadiness.targetId,
    sourceProviderId: evidenceReadiness.sourceProviderId,
    sourceFreshnessStatus: evidenceReadiness.sourceFreshnessStatus,
    sourceFreshnessDays: evidenceReadiness.sourceFreshnessDays,
    sourceLatestMatchAt: evidenceReadiness.sourceLatestMatchAt,
    sourceFreshnessPenalty: evidenceReadiness.sourceFreshnessPenalty,
    activityStatus: evidenceReadiness.activityStatus,
    activityDays: evidenceReadiness.activityDays,
    activityPenalty: evidenceReadiness.activityPenalty,
    sourceFreshnessSeparateFromPlayerActivity: true,
    sourceFiles, sampleTotal, sampleSurface, sampleRecent, coverageScore: round(coverageScore, 2), confidenceScore: round(confidenceScore, 2),
    overallElo: round(latest.overallEloPost, 2), surfaceElo: round(latest.surfaceEloPost?.[normalizedSurface] || 1500, 2), currentRank,
    recentWinRate: recentWinRate === null ? null : round(recentWinRate, 4),
    recentQualityScore: recentQualityScore === null ? null : round(recentQualityScore, 2),
    surfaceWinRate: surfaceWinRate === null ? null : round(surfaceWinRate, 4),
    servePointsWon: stats.servePointsWon === null ? null : round(stats.servePointsWon, 4),
    returnPointsWon: stats.returnPointsWon === null ? null : round(stats.returnPointsWon, 4),
    firstServeIn: stats.firstServeIn === null ? null : round(stats.firstServeIn, 4),
    firstServeWon: stats.firstServeWon === null ? null : round(stats.firstServeWon, 4),
    secondServeWon: stats.secondServeWon === null ? null : round(stats.secondServeWon, 4),
    aceRate: stats.aceRate === null ? null : round(stats.aceRate, 4),
    doubleFaultRate: stats.doubleFaultRate === null ? null : round(stats.doubleFaultRate, 4),
    holdProxy: stats.holdProxy === null ? null : round(stats.holdProxy, 4),
    breakProxy: stats.breakProxy === null ? null : round(stats.breakProxy, 4),
    breakPointsSaved: stats.breakPointsSaved === null ? null : round(stats.breakPointsSaved, 4),
    decidingSetWinRate: deciding.length ? round(deciding.filter(row => row.score.decidingSetWon).length / deciding.length, 4) : null,
    tiebreakWinRate: tiebreakPlayed ? round(tiebreakWon / tiebreakPlayed, 4) : null,
    lateRoundSample: lateRoundRows.length,
    lateRoundWinRate: lateRoundWinRate === null ? null : round(lateRoundWinRate, 4),
    lateRoundExpectedWinRate: lateRoundExpectedWinRate === null ? null : round(lateRoundExpectedWinRate, 4),
    lateRoundPerformanceVsExpected: lateRoundPerformanceVsExpected === null ? null : round(lateRoundPerformanceVsExpected, 4),
    semifinalPlusSample: semifinalPlusRows.length,
    semifinalPlusWinRate: semifinalPlusWinRate === null ? null : round(semifinalPlusWinRate, 4),
    finalSample: finalRows.length,
    finalWinRate: finalWinRate === null ? null : round(finalWinRate, 4),
    roundPressureEvidenceVersion: tennisTournamentStageModel.TENNIS_TOURNAMENT_STAGE_MODEL_VERSION,
    restDays: round(restDays, 2), matches7d: last7.length, matches14d: last14.length, minutes14d,
    fatigueScore: round(fatigueScore(restDays, last14.length, minutes14d), 2), retirement90d,
    surfaceTransitionDays: surfaceTransitionDays === null ? null : round(surfaceTransitionDays, 1),
    lastTournament: latest.tournament || null, lastLevel: latest.level || null,
    historicalAggregate, historicalValidationAuthority: false, historicalModelProbabilityChanged: false
  };
  return { ...core, evidenceHash: sha256(core) };
}
function logistic(value) { return 1 / (1 + Math.exp(-value)); }
function availableNumber(value) { return Number.isFinite(Number(value)); }
function buildMatchupEvidence(player1, player2, surface, asOf, options = {}) {
  const p1 = buildPlayerEvidence(player1, player2, surface, asOf, options);
  const p2 = buildPlayerEvidence(player2, player1, surface, asOf, options);
  const asOfDate = parseAsOfDate(asOf);
  const problems = [];
  if (!['VERIFIED_CURRENT', 'VERIFIED_STALE', 'PARTIAL'].includes(p1.status)) problems.push(`P1_${p1.status}`);
  if (!['VERIFIED_CURRENT', 'VERIFIED_STALE', 'PARTIAL'].includes(p2.status)) problems.push(`P2_${p2.status}`);
  const components = [];
  const add = (name, probabilityP1, weight, details) => {
    if (!availableNumber(probabilityP1) || !(weight > 0)) return;
    components.push({ name, probabilityP1: clamp(Number(probabilityP1), 0.05, 0.95), weight, details });
  };
  if (availableNumber(p1.overallElo) && availableNumber(p2.overallElo)) add('OVERALL_ELO', eloExpected(p1.overallElo, p2.overallElo), 0.28, { p1: p1.overallElo, p2: p2.overallElo });
  if (availableNumber(p1.surfaceElo) && availableNumber(p2.surfaceElo) && p1.sampleSurface >= 3 && p2.sampleSurface >= 3) add('SURFACE_ELO', eloExpected(p1.surfaceElo, p2.surfaceElo), 0.22, { p1: p1.surfaceElo, p2: p2.surfaceElo });
  let p1ServeMatchup = null; let p2ServeMatchup = null;
  if (availableNumber(p1.servePointsWon) && availableNumber(p2.returnPointsWon)) p1ServeMatchup = (p1.servePointsWon + (1 - p2.returnPointsWon)) / 2;
  if (availableNumber(p2.servePointsWon) && availableNumber(p1.returnPointsWon)) p2ServeMatchup = (p2.servePointsWon + (1 - p1.returnPointsWon)) / 2;
  if (availableNumber(p1ServeMatchup) && availableNumber(p2ServeMatchup)) add('SERVE_RETURN', clamp(0.5 + (p1ServeMatchup - p2ServeMatchup) * 1.65, 0.18, 0.82), 0.20, { p1ServeMatchup: round(p1ServeMatchup, 4), p2ServeMatchup: round(p2ServeMatchup, 4) });
  if (availableNumber(p1.recentQualityScore) && availableNumber(p2.recentQualityScore)) add('RECENT_OPPONENT_ADJUSTED_FORM', logistic((p1.recentQualityScore - p2.recentQualityScore) / 12), 0.13, { p1: p1.recentQualityScore, p2: p2.recentQualityScore });
  if (availableNumber(p1.currentRank) && availableNumber(p2.currentRank) && p1.currentRank > 0 && p2.currentRank > 0) add('RANK', logistic(Math.log(p2.currentRank / p1.currentRank) * 1.15), 0.07, { p1: p1.currentRank, p2: p2.currentRank });
  if (availableNumber(p1.fatigueScore) && availableNumber(p2.fatigueScore)) add('FATIGUE', logistic((p1.fatigueScore - p2.fatigueScore) / 18), 0.05, { p1: p1.fatigueScore, p2: p2.fatigueScore });
  const p1ClutchValues = [p1.breakPointsSaved, p1.decidingSetWinRate, p1.tiebreakWinRate].filter(availableNumber);
  const p2ClutchValues = [p2.breakPointsSaved, p2.decidingSetWinRate, p2.tiebreakWinRate].filter(availableNumber);
  const p1Clutch = p1ClutchValues.length ? p1ClutchValues.reduce((a, b) => a + Number(b), 0) / p1ClutchValues.length : null;
  const p2Clutch = p2ClutchValues.length ? p2ClutchValues.reduce((a, b) => a + Number(b), 0) / p2ClutchValues.length : null;
  if (availableNumber(p1Clutch) && availableNumber(p2Clutch)) add('CLUTCH', logistic((p1Clutch - p2Clutch) * 6), 0.05, { p1: round(p1Clutch, 4), p2: round(p2Clutch, 4) });
  const stageProfile = tennisTournamentStageModel.getStageProfile(options.round || options.tournamentRound || options.stage);
  if (stageProfile.isLateRound && Number(p1.lateRoundSample || 0) >= 3 && Number(p2.lateRoundSample || 0) >= 3) {
    const p1Resilience = tennisTournamentStageModel.buildRoundResilience(p1);
    const p2Resilience = tennisTournamentStageModel.buildRoundResilience(p2);
    add('LATE_ROUND_RESILIENCE', logistic((p1Resilience.resilienceScore - p2Resilience.resilienceScore) / 12), 0.045, {
      round: stageProfile.canonicalRound,
      stage: stageProfile.stage,
      p1: p1Resilience,
      p2: p2Resilience,
      hardExclusion: false
    });
  }
  let h2hP1 = 0; let h2hP2 = 0;
  if (asOfDate && p1.normalizedName && p2.normalizedName && state.players.has(p1.normalizedName)) {
    for (const row of historyBefore(state.players.get(p1.normalizedName), asOfDate.getTime())) {
      if (row.opponent === p2.normalizedName) { if (row.won) h2hP1 += 1; else h2hP2 += 1; }
    }
  }
  if (h2hP1 + h2hP2 >= 2) add('H2H_CAPPED', (h2hP1 + 1) / (h2hP1 + h2hP2 + 2), 0.03, { p1Wins: h2hP1, p2Wins: h2hP2 });
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const rawProbability = totalWeight > 0 ? components.reduce((sum, component) => sum + component.probabilityP1 * component.weight, 0) / totalWeight : 0.5;
  const coverageScore = Math.min(Number(p1.coverageScore || 0), Number(p2.coverageScore || 0));
  const confidenceScore = Math.min(Number(p1.confidenceScore || 0), Number(p2.confidenceScore || 0));
  const shrink = clamp(0.25 + confidenceScore / 100 * 0.70, 0.25, 0.95);
  const featureProbabilityP1 = clamp(0.5 + (rawProbability - 0.5) * shrink, 0.08, 0.92);
  const featureProbabilityP2 = 1 - featureProbabilityP1;
  const label = featureProbabilityP1 >= 0.56 ? 'MATCHUP_ADVANTAGE_P1' : featureProbabilityP1 <= 0.44 ? 'MATCHUP_ADVANTAGE_P2' : 'MATCHUP_BALANCED';
  const status = problems.length ? 'INSUFFICIENT_EVIDENCE' : (p1.status === 'VERIFIED_STALE' || p2.status === 'VERIFIED_STALE' ? 'STALE_EVIDENCE' : 'READY_SHADOW');
  let historicalValidation;
  try {
    historicalValidation = tennisHistoricalPlayerStats.buildMatchValidation(player1, player2, options.tour || options.tourType || options.league, asOf, { datasetPath: options.historicalDatasetPath, optional: true });
  } catch (error) {
    historicalValidation = { status: 'UNAVAILABLE', reason: `PATCH16_HISTORICAL_MATCH_VALIDATION_ERROR:${error.message}`, modelProbabilityChanged: false, stakeAuthority: false };
  }
  const canonicalBridge = canonicalPlayerEvidenceBridge.buildMatchupBridge(
    player1,
    player2,
    options.tour || options.tourType || options.league,
    asOf,
    { p1, p2 },
    { historicalDatasetPath: options.historicalDatasetPath }
  );
  const sourceFreshnessStatus = tennisTourDataReadiness.worstStatus([p1.sourceFreshnessStatus, p2.sourceFreshnessStatus]);
  const activityRiskStatus = [p1.activityStatus, p2.activityStatus].includes('VERY_LONG_ABSENCE')
    ? 'VERY_LONG_ABSENCE'
    : [p1.activityStatus, p2.activityStatus].includes('LONG_ABSENCE') ? 'LONG_ABSENCE' : 'NORMAL';
  if (activityRiskStatus !== 'NORMAL') problems.push(`ACTIVITY_${activityRiskStatus}`);
  const core = {
    version: TENNIS_MATCHUP_FEATURE_VERSION, status, problems, player1: String(player1 || ''), player2: String(player2 || ''),
    surface: normalizeSurface(surface), asOfAt: asOfDate?.toISOString() || null, matchupLabel: label,
    sourceTargetId: p1.sourceTargetId || p2.sourceTargetId || null,
    sourceProviderId: p1.sourceProviderId || p2.sourceProviderId || null,
    sourceFreshnessStatus,
    sourceFreshnessDays: Math.max(Number(p1.sourceFreshnessDays || 0), Number(p2.sourceFreshnessDays || 0)) || null,
    activityRiskStatus,
    sourceFreshnessSeparateFromPlayerActivity: true,
    tournamentRound: tennisTournamentStageModel.normalizeTournamentRound(options.round || options.tournamentRound || options.stage),
    tournamentStage: tennisTournamentStageModel.roundStage(options.round || options.tournamentRound || options.stage),
    lateRoundEvidenceIntegrated: components.some(component => component.name === 'LATE_ROUND_RESILIENCE'),
    hardExclusionByRoundEvidence: false,
    coverageScore: round(coverageScore, 2), confidenceScore: round(confidenceScore, 2),
    featureProbabilityP1: round(featureProbabilityP1, 6), featureProbabilityP2: round(featureProbabilityP2, 6),
    p1ServeMatchup: availableNumber(p1ServeMatchup) ? round(p1ServeMatchup, 4) : null,
    p2ServeMatchup: availableNumber(p2ServeMatchup) ? round(p2ServeMatchup, 4) : null,
    h2h: { p1Wins: h2hP1, p2Wins: h2hP2 }, components,
    p1EvidenceHash: p1.evidenceHash || null, p2EvidenceHash: p2.evidenceHash || null,
    historicalValidation, historicalValidationAuthority: false, historicalModelProbabilityChanged: false,
    canonicalBridge,
    canonicalBridgeAuthority: 'DEEPSCAN_CONTEXT_ONLY',
    canonicalBridgeModelProbabilityChanged: false,
    canonicalBridgeQualityGateChanged: false,
    canonicalBridgeStakeChanged: false
  };
  return { ...core, featureHash: sha256(core), p1, p2 };
}
function buildChallengerPrediction(input = {}, options = {}) {
  const matchup = input.matchup || buildMatchupEvidence(input.player1, input.player2, input.surface, input.asOf, options);
  const marketP1 = clamp(Number(input.marketProbabilityP1 ?? 50) / 100, 0.01, 0.99);
  const marketP2 = clamp(Number(input.marketProbabilityP2 ?? (100 - marketP1 * 100)) / 100, 0.01, 0.99);
  const normalizedMarketP1 = marketP1 / (marketP1 + marketP2);
  const productionP1 = clamp(Number(input.productionProbabilityP1 ?? normalizedMarketP1 * 100) / 100, 0.01, 0.99);
  const productionP2 = 1 - productionP1;
  const confidence = Number(matchup.confidenceScore || 0);
  const coverage = Number(matchup.coverageScore || 0);
  const applicable = String(input.marketType || 'h2h').toLowerCase().includes('h2h') || ['1', '2'].includes(String(input.prediction || '').trim());
  let status = 'SHADOW_ONLY';
  let featureWeight = clamp(0.10 + confidence / 100 * 0.35, 0.10, 0.45);
  if (matchup.status === 'INSUFFICIENT_EVIDENCE') { status = 'INSUFFICIENT_EVIDENCE'; featureWeight = 0.08; }
  else if (matchup.status === 'STALE_EVIDENCE') { status = 'STALE_EVIDENCE'; featureWeight = Math.min(featureWeight, 0.22); }
  if (!applicable) status = 'NOT_APPLICABLE_TOTALS';
  const productionWeight = applicable ? 0.20 : 0;
  const marketWeight = 1 - featureWeight - productionWeight;
  const challengerP1 = applicable ? clamp(matchup.featureProbabilityP1 * featureWeight + productionP1 * productionWeight + normalizedMarketP1 * marketWeight, 0.05, 0.95) : productionP1;
  const challengerP2 = 1 - challengerP1;
  const selectedSide = String(input.prediction || '').trim() === '2' ? 'P2' : String(input.prediction || '').trim() === '1' ? 'P1' : null;
  const selectedProduction = selectedSide === 'P2' ? productionP2 : selectedSide === 'P1' ? productionP1 : null;
  const selectedChallenger = selectedSide === 'P2' ? challengerP2 : selectedSide === 'P1' ? challengerP1 : null;
  const deltaPp = selectedSide ? (selectedChallenger - selectedProduction) * 100 : 0;
  if (applicable && status === 'SHADOW_ONLY') status = Math.abs(deltaPp) > 7 ? 'SHADOW_DIVERGENCE_STRONG' : Math.abs(deltaPp) > 3 ? 'SHADOW_DIVERGENCE_SOFT' : 'SHADOW_AGREE';
  const uncertaintyHalfWidthPp = clamp(17 - confidence * 0.09 - coverage * 0.03, 6, 17);
  const core = {
    version: 'TENNIS_CHALLENGER_MATCHUP_V1_PATCH12', mode: 'SHADOW_ONLY_NO_STAKE_AUTHORITY', status,
    player1: input.player1 || matchup.player1, player2: input.player2 || matchup.player2, prediction: input.prediction || null,
    marketType: input.marketType || 'h2h', asOfAt: matchup.asOfAt,
    marketProbabilityP1: round(normalizedMarketP1 * 100, 4), marketProbabilityP2: round((1 - normalizedMarketP1) * 100, 4),
    productionProbabilityP1: round(productionP1 * 100, 4), productionProbabilityP2: round(productionP2 * 100, 4),
    challengerProbabilityP1: round(challengerP1 * 100, 4), challengerProbabilityP2: round(challengerP2 * 100, 4),
    selectedSide, selectedProductionProbability: selectedProduction === null ? null : round(selectedProduction * 100, 4),
    selectedChallengerProbability: selectedChallenger === null ? null : round(selectedChallenger * 100, 4),
    probabilityDeltaPp: round(deltaPp, 4), uncertaintyLowPct: selectedChallenger === null ? null : round(clamp(selectedChallenger * 100 - uncertaintyHalfWidthPp, 1, 99), 2),
    uncertaintyHighPct: selectedChallenger === null ? null : round(clamp(selectedChallenger * 100 + uncertaintyHalfWidthPp, 1, 99), 2),
    confidenceScore: round(confidence, 2), coverageScore: round(coverage, 2), featureWeight: round(featureWeight, 4),
    matchupLabel: matchup.matchupLabel, matchupStatus: matchup.status, matchupFeatureHash: matchup.featureHash,
    historicalValidation: matchup.historicalValidation || null, historicalValidationAuthority: false, historicalModelProbabilityChanged: false
  };
  return { ...core, predictionHash: sha256(core), matchup };
}
function getLegacyCompatibleMatchup(player1, player2, surface, asOf, options = {}) {
  try {
    const matchup = buildMatchupEvidence(player1, player2, surface, asOf, options);
    const bridge = matchup?.canonicalBridge || canonicalPlayerEvidenceBridge.buildMatchupBridge(
      player1, player2, options.tour || options.tourType || options.league, asOf,
      { p1: matchup?.p1 || {}, p2: matchup?.p2 || {} },
      { historicalDatasetPath: options.historicalDatasetPath }
    );
    const productionEligible = matchup && matchup.status === 'READY_SHADOW' && Number(matchup.confidenceScore || 0) >= 70 &&
      Math.min(matchup.p1?.sampleTotal || 0, matchup.p2?.sampleTotal || 0) >= 8 &&
      Math.min(matchup.p1?.sampleSurface || 0, matchup.p2?.sampleSurface || 0) >= 3;
    const common = {
      sourceStatus: matchup?.status || 'UNAVAILABLE',
      asOfSafe: true,
      evidenceVersion: TENNIS_PLAYER_EVIDENCE_VERSION,
      matchupFeatureVersion: TENNIS_MATCHUP_FEATURE_VERSION,
      matchupFeatureHash: matchup?.featureHash || null,
      coverageScore: matchup?.coverageScore ?? 0,
      confidenceScore: matchup?.confidenceScore ?? 0,
      historicalValidation: matchup?.historicalValidation || null,
      historicalValidationAuthority: false,
      canonicalBridge: bridge,
      canonicalBridgeAuthority: 'DEEPSCAN_CONTEXT_ONLY',
      canonicalBridgeModelProbabilityChanged: false,
      canonicalBridgeQualityGateChanged: false,
      canonicalBridgeStakeChanged: false,
      p1_rank: bridge?.p1?.currentRank ?? (matchup?.p1?.currentRank != null && Number.isFinite(Number(matchup.p1.currentRank)) ? Number(matchup.p1.currentRank) : null),
      p2_rank: bridge?.p2?.currentRank ?? (matchup?.p2?.currentRank != null && Number.isFinite(Number(matchup.p2.currentRank)) ? Number(matchup.p2.currentRank) : null),
      p1_overall_elo: bridge?.p1?.overallElo ?? (matchup?.p1?.overallElo != null && Number.isFinite(Number(matchup.p1.overallElo)) ? Number(matchup.p1.overallElo) : null),
      p2_overall_elo: bridge?.p2?.overallElo ?? (matchup?.p2?.overallElo != null && Number.isFinite(Number(matchup.p2.overallElo)) ? Number(matchup.p2.overallElo) : null),
      p1_dominance_ratio: bridge?.p1?.dominanceRatio ?? null,
      p2_dominance_ratio: bridge?.p2?.dominanceRatio ?? null,
      canonicalDataAvailable: bridge?.status !== 'UNAVAILABLE'
    };
    if (!productionEligible) return {
      ...common,
      hasData: false,
      reason: 'PATCH26_PRODUCTION_MATCH_LEVEL_EVIDENCE_NOT_CURRENT_OR_INSUFFICIENT_CANONICAL_CONTEXT_AVAILABLE'
    };
    return {
      ...common,
      hasData: true,
      finalProb1: round(matchup.featureProbabilityP1 * 100, 4), finalProb2: round(matchup.featureProbabilityP2 * 100, 4),
      p1_point: matchup.p1ServeMatchup ?? matchup.p1.servePointsWon ?? null,
      p2_point: matchup.p2ServeMatchup ?? matchup.p2.servePointsWon ?? null,
      p1_surface_elo: Number.isFinite(Number(matchup.p1.surfaceElo)) ? Number(matchup.p1.surfaceElo) : null,
      p2_surface_elo: Number.isFinite(Number(matchup.p2.surfaceElo)) ? Number(matchup.p2.surfaceElo) : null,
      p1_late_round_sample: matchup.p1.lateRoundSample || 0, p2_late_round_sample: matchup.p2.lateRoundSample || 0,
      p1_late_round_win_rate: matchup.p1.lateRoundWinRate, p2_late_round_win_rate: matchup.p2.lateRoundWinRate,
      p1_clutch: matchup.p1.breakPointsSaved ?? matchup.p1.decidingSetWinRate ?? null,
      p2_clutch: matchup.p2.breakPointsSaved ?? matchup.p2.decidingSetWinRate ?? null,
      sample: Math.min(matchup.p1.sampleTotal || 0, matchup.p2.sampleTotal || 0),
      surfaceSample: Math.min(matchup.p1.sampleSurface || 0, matchup.p2.sampleSurface || 0)
    };
  } catch (error) {
    let bridge = null;
    try {
      bridge = canonicalPlayerEvidenceBridge.buildMatchupBridge(player1, player2, options.tour || options.tourType || options.league, asOf, {}, { historicalDatasetPath: options.historicalDatasetPath });
    } catch (_) {}
    return { hasData: false, sourceStatus: 'ERROR', error: error.message, asOfSafe: true, evidenceVersion: TENNIS_PLAYER_EVIDENCE_VERSION, canonicalBridge: bridge, canonicalDataAvailable: bridge?.status !== 'UNAVAILABLE' };
  }
}
function getPreScreenerData(player1, player2, surface, asOf = new Date(), options = {}) {
  const matchup = buildMatchupEvidence(player1, player2, surface, asOf, options);
  const usable = matchup.status === 'READY_SHADOW' && Number(matchup.confidenceScore || 0) >= 60;
  return {
    p1SurfWr: usable && availableNumber(matchup.p1.surfaceWinRate) ? round(matchup.p1.surfaceWinRate * 100, 2) : 50,
    p2SurfWr: usable && availableNumber(matchup.p2.surfaceWinRate) ? round(matchup.p2.surfaceWinRate * 100, 2) : 50,
    p1H2hWins: matchup.h2h?.p1Wins || 0, p2H2hWins: matchup.h2h?.p2Wins || 0,
    evidenceStatus: matchup.status, asOfSafe: true
  };
}
function getStatus() {
  const latestMs = state.latestMatchAt ? new Date(state.latestMatchAt).getTime() : null;
  const dataAgeDays = Number.isFinite(latestMs) ? Math.max(0, (Date.now() - latestMs) / 86400000) : null;
  return {
    version: TENNIS_PLAYER_EVIDENCE_VERSION, matchupVersion: TENNIS_MATCHUP_FEATURE_VERSION,
    initialized: state.initialized, mode: 'LOCAL_STRUCTURED_AS_OF_SAFE', dataDir: state.dataDir,
    loadedAt: state.loadedAt, files: state.files.map(file => ({ ...file })), fileCount: state.files.length,
    matchCount: state.matchCount, playerCount: state.players.size, rejectedRows: state.rejectedRows,
    duplicateRows: state.duplicateRows, earliestMatchAt: state.earliestMatchAt, latestMatchAt: state.latestMatchAt,
    dataAgeDays: dataAgeDays === null ? null : round(dataAgeDays, 1),
    freshnessPolicy: { currentMaxDays: 21, agingMaxDays: 45, staleAfterDays: 45 },
    productionEvidencePolicy: 'READY_SHADOW_CURRENT_ONLY_CONFIDENCE_GTE_70_MIN_8_MATCHES_MIN_3_SURFACE',
    productionEligibleLatestData: dataAgeDays !== null && dataAgeDays <= 21,
    networkUsed: false, temporalLeakageGuard: true, refreshable: true,
    refreshManifest: state.refreshManifest, sourceTierCounts: { ...state.sourceTierCounts },
    historicalPlayerStats: tennisHistoricalPlayerStats.getStatus({ initialize: true })
  };
}

module.exports = {
  TENNIS_PLAYER_EVIDENCE_VERSION,
  TENNIS_MATCHUP_FEATURE_VERSION,
  SOURCE_TIER,
  init,
  getStatus,
  parseAsOfDate,
  normalizeSurface,
  resolvePlayerName,
  buildPlayerEvidence,
  buildMatchupEvidence,
  buildChallengerPrediction,
  getLegacyCompatibleMatchup,
  getPreScreenerData
};
