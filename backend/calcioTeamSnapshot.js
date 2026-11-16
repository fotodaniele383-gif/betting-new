'use strict';

const crypto = require('crypto');
const entityResolution = require('./calcioEntityResolution');
const footballDataProvider = require('./calcioFootballDataProvider');

const CALCIO_TEAM_SNAPSHOT_VERSION = 'BETTINGAPP_R13_ASOF_FOOTBALL_DATA_XG_SNAPSHOT_V1';
const leagueIndexCache = new Map();

function round(value, decimals = 3) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;
}

function splitCsvLine(line = '') {
    const values = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < String(line).length; i++) {
        const char = line[i];
        if (char === '"') {
            if (quoted && line[i + 1] === '"') { current += '"'; i++; }
            else quoted = !quoted;
        } else if (char === ',' && !quoted) {
            values.push(current);
            current = '';
        } else current += char;
    }
    values.push(current);
    return values;
}

function strictNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function sha256Text(value = '') {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseLeagueCsv(csvData = '', options = {}) {
    const lines = String(csvData || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) return { version: CALCIO_TEAM_SNAPSHOT_VERSION, matches: [], teams: [], rejected: 0 };
    const headers = splitCsvLine(lines[0]).map(value => value.trim());
    const index = name => headers.indexOf(name);
    const required = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'];
    if (required.some(name => index(name) < 0)) throw new Error(`CSV football-data incompleto: ${required.filter(name => index(name) < 0).join(', ')}`);
    const idx = Object.fromEntries(headers.map((name, i) => [name, i]));
    const matches = [];
    let rejected = 0;
    for (const line of lines.slice(1)) {
        const cols = splitCsvLine(line);
        const home = String(cols[idx.HomeTeam] || '').trim();
        const away = String(cols[idx.AwayTeam] || '').trim();
        const date = footballDataProvider.parseFootballDataDate(cols[idx.Date]);
        const homeGoals = strictNumber(cols[idx.FTHG]);
        const awayGoals = strictNumber(cols[idx.FTAG]);
        if (!home || !away || !date || homeGoals === null || awayGoals === null) { rejected++; continue; }
        matches.push({
            date,
            dateIso: date.toISOString(),
            home,
            away,
            homeGoals,
            awayGoals,
            homeXg: strictNumber(cols[idx.HxG]),
            awayXg: strictNumber(cols[idx.AxG]),
            homeShots: strictNumber(cols[idx.HS]),
            awayShots: strictNumber(cols[idx.AS]),
            homeShotsOnTarget: strictNumber(cols[idx.HST]),
            awayShotsOnTarget: strictNumber(cols[idx.AST])
        });
    }
    matches.sort((a, b) => a.date - b.date);
    return {
        version: CALCIO_TEAM_SNAPSHOT_VERSION,
        leagueName: options.leagueName || null,
        code: options.code || null,
        revisionToken: options.revisionToken || sha256Text(csvData).slice(0, 24),
        matches,
        teams: [...new Set(matches.flatMap(match => [match.home, match.away]))].sort(),
        rejected
    };
}

function getLeagueIndex({ csvData = '', leagueName = '', code = '', revisionToken = '' } = {}) {
    const revision = revisionToken || sha256Text(csvData).slice(0, 24);
    const key = [code, revision].join('|');
    if (leagueIndexCache.has(key)) return leagueIndexCache.get(key);
    const index = parseLeagueCsv(csvData, { leagueName, code, revisionToken: revision });
    leagueIndexCache.set(key, index);
    if (leagueIndexCache.size > 16) leagueIndexCache.delete(leagueIndexCache.keys().next().value);
    return index;
}

function summarizeMatches(matches = [], team = '', venue = 'all', window = null) {
    const resolved = String(team || '');
    let teamMatches = matches.filter(match => match.home === resolved || match.away === resolved);
    if (venue === 'home') teamMatches = teamMatches.filter(match => match.home === resolved);
    if (venue === 'away') teamMatches = teamMatches.filter(match => match.away === resolved);
    if (Number.isFinite(Number(window)) && Number(window) > 0) teamMatches = teamMatches.slice(-Number(window));
    let goalsFor = 0, goalsAgainst = 0, shotsFor = 0, shotsAgainst = 0, sotFor = 0, sotAgainst = 0;
    let xgForTotal = 0, xgAgainstTotal = 0, xgSamples = 0;
    let wins = 0, draws = 0, losses = 0, cleanSheets = 0, btts = 0, over25 = 0;
    for (const match of teamMatches) {
        const isHome = match.home === resolved;
        const gf = isHome ? match.homeGoals : match.awayGoals;
        const ga = isHome ? match.awayGoals : match.homeGoals;
        const sf = isHome ? match.homeShots : match.awayShots;
        const sa = isHome ? match.awayShots : match.homeShots;
        const stf = isHome ? match.homeShotsOnTarget : match.awayShotsOnTarget;
        const sta = isHome ? match.awayShotsOnTarget : match.homeShotsOnTarget;
        goalsFor += gf; goalsAgainst += ga;
        const xgf=isHome?match.homeXg:match.awayXg, xga=isHome?match.awayXg:match.homeXg;
        if (Number.isFinite(xgf) && Number.isFinite(xga) && xgf>=0 && xga>=0 && xgf<=8 && xga<=8){xgForTotal+=xgf;xgAgainstTotal+=xga;xgSamples++;}
        if (sf !== null) shotsFor += sf;
        if (sa !== null) shotsAgainst += sa;
        if (stf !== null) sotFor += stf;
        if (sta !== null) sotAgainst += sta;
        if (gf > ga) wins++; else if (gf === ga) draws++; else losses++;
        if (ga === 0) cleanSheets++;
        if (gf > 0 && ga > 0) btts++;
        if (gf + ga > 2.5) over25++;
    }
    const n = teamMatches.length;
    return {
        sample: n,
        xgSample: xgSamples,
        xgForPerMatch: xgSamples?round(xgForTotal/xgSamples):null,
        xgAgainstPerMatch: xgSamples?round(xgAgainstTotal/xgSamples):null,
        wins,
        draws,
        losses,
        pointsPerGame: n ? round((wins * 3 + draws) / n) : null,
        goalsForPerMatch: n ? round(goalsFor / n) : null,
        goalsAgainstPerMatch: n ? round(goalsAgainst / n) : null,
        shotsForPerMatch: n ? round(shotsFor / n) : null,
        shotsAgainstPerMatch: n ? round(shotsAgainst / n) : null,
        shotsOnTargetForPerMatch: n ? round(sotFor / n) : null,
        shotsOnTargetAgainstPerMatch: n ? round(sotAgainst / n) : null,
        cleanSheetPct: n ? round(cleanSheets / n * 100, 1) : null,
        bttsPct: n ? round(btts / n * 100, 1) : null,
        over25Pct: n ? round(over25 / n * 100, 1) : null,
        firstMatchAt: n ? teamMatches[0].dateIso : null,
        lastMatchAt: n ? teamMatches[n - 1].dateIso : null
    };
}

function buildTeamSnapshot(index, requestedTeam = '', cutoff = new Date()) {
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const before = index.matches.filter(match => match.date < cutoffDate);
    const resolution = entityResolution.resolveTeamName(requestedTeam, index.teams, { threshold: 0.82 });
    if (!resolution.matched) {
        return {
            version: CALCIO_TEAM_SNAPSHOT_VERSION,
            requestedTeam,
            resolvedTeam: null,
            matched: false,
            resolution,
            cutoffAt: cutoffDate.toISOString(),
            samples: { season: 0, last10: 0, last5: 0, venue: 0 }
        };
    }
    const team = resolution.resolved;
    const season = summarizeMatches(before, team, 'all');
    const last10 = summarizeMatches(before, team, 'all', 10);
    const last5 = summarizeMatches(before, team, 'all', 5);
    return {
        version: CALCIO_TEAM_SNAPSHOT_VERSION,
        leagueName: index.leagueName,
        code: index.code,
        revisionToken: index.revisionToken,
        requestedTeam,
        resolvedTeam: team,
        matched: true,
        resolution,
        cutoffAt: cutoffDate.toISOString(),
        season,
        last10,
        last5,
        home: summarizeMatches(before, team, 'home'),
        away: summarizeMatches(before, team, 'away'),
        samples: { season: season.sample, last10: last10.sample, last5: last5.sample, home: summarizeMatches(before, team, 'home').sample, away: summarizeMatches(before, team, 'away').sample }
    };
}

function buildMatchSnapshots(index, homeTeam = '', awayTeam = '', cutoff = new Date()) {
    return {
        version: CALCIO_TEAM_SNAPSHOT_VERSION,
        cutoffAt: (cutoff instanceof Date ? cutoff : new Date(cutoff)).toISOString(),
        leagueName: index.leagueName,
        code: index.code,
        revisionToken: index.revisionToken,
        home: buildTeamSnapshot(index, homeTeam, cutoff),
        away: buildTeamSnapshot(index, awayTeam, cutoff)
    };
}

module.exports = {
    CALCIO_TEAM_SNAPSHOT_VERSION,
    splitCsvLine,
    parseLeagueCsv,
    getLeagueIndex,
    summarizeMatches,
    buildTeamSnapshot,
    buildMatchSnapshots,
    _cache: leagueIndexCache
};
