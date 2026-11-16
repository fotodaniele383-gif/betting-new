#!/usr/bin/env node
'use strict';

const path = require('path');
const root = path.resolve(__dirname, '..');
const { getTeamNlpProfile } = require(path.join(root, 'backend', 'nlpEngine7'));
const sourceIntelligence = require(path.join(root, 'backend', 'calcioSourceIntelligence'));
const footballData = require(path.join(root, 'backend', 'calcioFootballDataProvider'));
const understatContract = require(path.join(root, 'backend', 'calcioUnderstatContract'));
const teamSnapshot = require(path.join(root, 'backend', 'calcioTeamSnapshot'));

function arg(name, fallback = '') {
    const idx = process.argv.indexOf(`--${name}`);
    return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
function has(name) { return process.argv.includes(`--${name}`); }

async function probeUnderstat(league, home, away) {
    if (!has('include-understat')) return { status: 'NOT_REQUESTED', authority: 'MODEL_INPUT_ONLY_WHEN_BOTH_TEAMS' };
    try {
        const scraper = require(path.join(root, 'backend', 'scraper'));
        if (typeof scraper.getUnderstatxG !== 'function') return { status: 'ERROR', error: 'getUnderstatxG non esportato' };
        const started = Date.now();
        const data = await scraper.getUnderstatxG(league, 1);
        const coverage = understatContract.evaluateUnderstatCoverage(data, home, away);
        return {
            status: coverage.status,
            available: coverage.bothTeams,
            durationMs: Date.now() - started,
            league,
            teamCount: coverage.validTeamCount,
            sampleTeams: coverage.validTeams || [],
            coverage,
            data
        };
    } catch (error) {
        return { status: 'ERROR', league, error: error.message, available: false };
    }
}

async function buildFootballSnapshot(league, home, away, cutoff) {
    const config = footballData.DEFAULT_LEAGUES.find(item => item.name.toLowerCase() === league.toLowerCase() || item.key === league || item.code === league);
    if (!config) return { status: 'UNSUPPORTED_LEAGUE', league, snapshots: null };
    try {
        const result = await footballData.getLeagueCsv({
            leagueKey: config.key,
            leagueName: config.name,
            code: config.code,
            projectRoot: root
        });
        const index = teamSnapshot.getLeagueIndex({
            csvData: result.csvData,
            leagueName: config.name,
            code: config.code,
            revisionToken: result.sha256 || footballData.getRevisionToken({ projectRoot: root })
        });
        const snapshots = teamSnapshot.buildMatchSnapshots(index, home, away, cutoff);
        return { status: 'AVAILABLE', config, source: result.source, season: result.season, snapshots };
    } catch (error) {
        return { status: 'ERROR', league, error: error.message, snapshots: null };
    }
}

(async () => {
    const home = arg('home', 'Everton');
    const away = arg('away', 'Crystal Palace');
    const league = arg('league', 'Premier');
    const kickoffRaw = arg('kickoff', '2026-08-22T15:00:00.000Z');
    const kickoff = new Date(kickoffRaw);
    if (Number.isNaN(kickoff.getTime())) throw new Error(`KICKOFF_INVALID:${kickoffRaw}`);
    const startedAt = new Date();
    const [homeProfile, awayProfile, understat, footballSnapshot] = await Promise.all([
        getTeamNlpProfile(home, { forceRefresh: true, timeoutMs: Number(arg('timeout-ms', '8000')), kickoff }),
        getTeamNlpProfile(away, { forceRefresh: true, timeoutMs: Number(arg('timeout-ms', '8000')), kickoff }),
        probeUnderstat(league, home, away),
        buildFootballSnapshot(league, home, away, kickoff)
    ]);
    const health = footballData.getFootballDataHealth({ projectRoot: root });
    const snapshots = footballSnapshot.snapshots;
    const understatCoverage = understat.coverage || understatContract.evaluateUnderstatCoverage({}, home, away);
    const audit = sourceIntelligence.buildMatchSourceAudit({
        homeProfile,
        awayProfile,
        extData: {
            footballDataLoaded: Boolean(snapshots?.home?.matched && snapshots?.away?.matched),
            homeMatches: snapshots?.home?.season?.sample || 0,
            awayMatches: snapshots?.away?.season?.sample || 0,
            teamSnapshots: snapshots,
            xgEvidenceMode: understatCoverage.bothTeams ? 'REAL_XG' : 'GOAL_SHOT_PROXY',
            understatLoaded: understatCoverage.bothTeams,
            understatCoverage,
            understatData: understat.data || {},
            homeProviderName: home,
            awayProviderName: away,
            kickoff
        }
    });
    const report = {
        success: true,
        version: sourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
        mode: 'NO_ODDS_API_CREDITS',
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        match: { home, away, league, kickoff: kickoff.toISOString() },
        sourcePlan: { home: sourceIntelligence.buildTeamSourcePlan(home), away: sourceIntelligence.buildTeamSourcePlan(away) },
        news: { home: homeProfile.sourceIntelligence, away: awayProfile.sourceIntelligence },
        footballData: health,
        footballTeamSnapshots: footballSnapshot,
        understat,
        oddsApi: { status: 'NOT_CALLED', creditsConsumed: 0 },
        audit
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
})().catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
});
