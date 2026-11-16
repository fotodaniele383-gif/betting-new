'use strict';

const AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION = 'AUDIT16D_R3_R3B_SERIE_B_MODEL_ESTIMATED_XG_V1';
const AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION = 'AUDIT16D_R3_R3B_R1_FOOTBALL_DATA_SEASON_CODE_NORMALIZATION_V1';
const MODEL_ID = 'SERIE_B_ESTIMATED_XG';
const MODEL_FAMILY = 'FOOTBALL_DATA_SHOT_MODEL';
const SOURCE_CLASS = 'MODEL_ESTIMATED';
const EVIDENCE_CLASS = 'MODEL_ESTIMATED_XG';
const MIN_VALID_TEAMS = 8;
const PRIOR_MATCHES = 3;
const AUTHORITY_WEIGHT_CAP = 0.20;

function finite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round(v, d = 3) { const p = 10 ** d; return Math.round((Number(v) + Number.EPSILON) * p) / p; }


function normalizeSeasonStart(season) {
  const raw = String(season ?? '').trim();
  if (!raw) return null;

  let m = raw.match(/^(20\d{2})(?:[\/-](20\d{2}))?$/);
  if (m) {
    const start = Number(m[1]);
    if (!Number.isFinite(start)) return null;
    if (m[2] && Number(m[2]) !== start + 1) return null;
    return start;
  }

  // Football-Data season codes use compact YYZZ form, e.g. 2627 = 2026/2027.
  m = raw.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const yy = Number(m[1]);
    const zz = Number(m[2]);
    if (!Number.isInteger(yy) || !Number.isInteger(zz) || zz !== ((yy + 1) % 100)) return null;
    return 2000 + yy;
  }

  return null;
}

function parseCsvLine(line = '') {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function estimateMatchXg({ shots = 0, shotsOnTarget = 0 } = {}) {
  const total = Math.max(0, finite(shots));
  const sot = clamp(finite(shotsOnTarget), 0, total);
  const nonTarget = Math.max(0, total - sot);
  // Transparent shot-quality proxy. It is deliberately NOT labelled real xG.
  // On-target attempts carry more expected scoring value than non-target attempts.
  const raw = (0.30 * sot) + (0.03 * nonTarget);
  return round(clamp(raw, 0.15, 4.00), 3);
}

function buildFromFootballDataCsv(csvData, options = {}) {
  const leagueName = options.leagueName || 'Serie B';
  const season = options.season || null;
  const now = options.now instanceof Date ? options.now : new Date();
  const text = String(csvData || '').replace(/^\uFEFF/, '').trim();
  if (!text) return unavailable('EMPTY_CSV', { leagueName, season, now });

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return unavailable('CSV_NO_ROWS', { leagueName, season, now });
  const headers = parseCsvLine(lines[0]).map(x => x.trim());
  const idx = name => headers.indexOf(name);
  const h = idx('HomeTeam'), a = idx('AwayTeam'), hs = idx('HS'), as = idx('AS'), hst = idx('HST'), ast = idx('AST');
  if ([h, a, hs, as, hst, ast].some(i => i < 0)) {
    return unavailable('CSV_SHOT_COLUMNS_MISSING', { leagueName, season, now, headers: headers.filter(x => ['HomeTeam','AwayTeam','HS','AS','HST','AST'].includes(x)) });
  }

  const acc = new Map();
  const fixtureEstimates = [];
  const ensure = name => {
    if (!acc.has(name)) acc.set(name, { games: 0, xgForSum: 0, xgAgainstSum: 0, shots: 0, sot: 0 });
    return acc.get(name);
  };
  let acceptedFixtures = 0;
  let rejectedFixtures = 0;

  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const home = String(c[h] || '').trim();
    const away = String(c[a] || '').trim();
    const homeShots = Number(c[hs]);
    const awayShots = Number(c[as]);
    const homeSot = Number(c[hst]);
    const awaySot = Number(c[ast]);
    if (!home || !away || ![homeShots, awayShots, homeSot, awaySot].every(Number.isFinite)) { rejectedFixtures++; continue; }
    if (homeShots < 0 || awayShots < 0 || homeSot < 0 || awaySot < 0) { rejectedFixtures++; continue; }

    const hxg = estimateMatchXg({ shots: homeShots, shotsOnTarget: homeSot });
    const axg = estimateMatchXg({ shots: awayShots, shotsOnTarget: awaySot });
    const hr = ensure(home), ar = ensure(away);
    hr.games++; hr.xgForSum += hxg; hr.xgAgainstSum += axg; hr.shots += homeShots; hr.sot += homeSot;
    ar.games++; ar.xgForSum += axg; ar.xgAgainstSum += hxg; ar.shots += awayShots; ar.sot += awaySot;
    fixtureEstimates.push({ home, away, homeEstimatedXg: hxg, awayEstimatedXg: axg });
    acceptedFixtures++;
  }

  if (!acceptedFixtures || acc.size < MIN_VALID_TEAMS) {
    return unavailable('INSUFFICIENT_SERIE_B_SHOT_COVERAGE', { leagueName, season, now, teamCount: acc.size, acceptedFixtures, rejectedFixtures });
  }

  const leagueTeamMatchCount = [...acc.values()].reduce((s, r) => s + r.games, 0);
  const leagueForSum = [...acc.values()].reduce((s, r) => s + r.xgForSum, 0);
  const leagueMean = leagueTeamMatchCount > 0 ? leagueForSum / leagueTeamMatchCount : 1.25;
  const teams = {};
  for (const [name, r] of acc.entries()) {
    const denom = r.games + PRIOR_MATCHES;
    const xGFor = (r.xgForSum + (PRIOR_MATCHES * leagueMean)) / denom;
    const xGAgainst = (r.xgAgainstSum + (PRIOR_MATCHES * leagueMean)) / denom;
    teams[name] = {
      xG_for: round(clamp(xGFor, 0.35, 3.20), 3),
      xG_against: round(clamp(xGAgainst, 0.35, 3.20), 3),
      games: r.games,
      avgShots: round(r.shots / r.games, 2),
      avgShotsOnTarget: round(r.sot / r.games, 2),
      source: 'FOOTBALL_DATA_CSV_SHOTS_SOT',
      providerId: MODEL_ID,
      evidenceClass: EVIDENCE_CLASS,
      modelEstimated: true
    };
  }

  return {
    teams,
    state: {
      version: AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION,
  AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION,
      providerId: MODEL_ID,
      providerFamily: MODEL_FAMILY,
      status: 'MODEL_READY',
      sourceClass: SOURCE_CLASS,
      evidenceClass: EVIDENCE_CLASS,
      leagueName,
      season: season || null,
      seasonStart: normalizeSeasonStart(season),
      seasonNormalizationRevision: AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION,
      teamCount: Object.keys(teams).length,
      acceptedFixtures,
      rejectedFixtures,
      leagueEstimatedXgMean: round(leagueMean, 3),
      priorMatches: PRIOR_MATCHES,
      authorityWeight: AUTHORITY_WEIGHT_CAP,
      modelFormula: '0.30*SOT + 0.03*(SHOTS-SOT), SHRINK_TO_LEAGUE_MEAN',
      source: 'FOOTBALL_DATA_CSV_SHOTS_SOT',
      checkedAt: now.toISOString(),
      selectionReason: 'SERIE_B_NO_CERTIFIED_XG_USING_DECLARED_MODEL',
      directStakeAuthority: false,
      directGateAuthority: false,
      realXg: false
    },
    diagnostics: {
      acceptedFixtures,
      rejectedFixtures,
      fixtureEstimates: options.includeFixtureEstimates ? fixtureEstimates : undefined
    }
  };
}

function unavailable(error, extra = {}) {
  return {
    teams: {},
    state: {
      version: AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION,
  AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION,
      providerId: MODEL_ID,
      providerFamily: MODEL_FAMILY,
      status: 'MODEL_UNAVAILABLE',
      sourceClass: 'NONE',
      evidenceClass: 'NONE',
      leagueName: extra.leagueName || 'Serie B',
      season: extra.season || null,
      teamCount: extra.teamCount || 0,
      acceptedFixtures: extra.acceptedFixtures || 0,
      rejectedFixtures: extra.rejectedFixtures || 0,
      error,
      checkedAt: (extra.now instanceof Date ? extra.now : new Date()).toISOString(),
      directStakeAuthority: false,
      directGateAuthority: false,
      realXg: false
    }
  };
}

module.exports = {
  AUDIT16D_R3_R3B_SERIE_B_ESTIMATED_XG_VERSION,
  AUDIT16D_R3_R3B_R1_SEASON_NORMALIZATION_VERSION,
  MODEL_ID,
  MODEL_FAMILY,
  SOURCE_CLASS,
  EVIDENCE_CLASS,
  MIN_VALID_TEAMS,
  PRIOR_MATCHES,
  AUTHORITY_WEIGHT_CAP,
  normalizeSeasonStart,
  parseCsvLine,
  estimateMatchXg,
  buildFromFootballDataCsv,
  unavailable
};
