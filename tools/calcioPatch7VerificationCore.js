'use strict';

const fs = require('fs');
const path = require('path');
const sourceIntelligence = require('../backend/calcioSourceIntelligence');
const entityResolution = require('../backend/calcioEntityResolution');
const understatContract = require('../backend/calcioUnderstatContract');
const teamSnapshot = require('../backend/calcioTeamSnapshot');
const registry = require('../backend/calcioPatchRegistry');

const ROOT = path.resolve(__dirname, '..');
function assert(ok, message) { if (!ok) throw new Error(message); }
function article(overrides = {}) {
    return {
        title: 'Everton team news: defender ruled out through injury',
        originalTitle: 'Everton team news: defender ruled out through injury',
        fullText: 'Everton team news confirms defender ruled out through injury.',
        pubDate: '2026-07-20T12:00:00.000Z',
        sourceName: 'Everton FC',
        sourceUrl: 'https://www.evertonfc.com/news/team-news',
        link: 'https://www.evertonfc.com/news/team-news',
        ...overrides
    };
}

function runPatch7Checks() {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const kickoff = new Date('2026-08-22T15:00:00.000Z');

    const u21 = sourceIntelligence.assessArticle(article({
        title: 'U21s preview Dagenham v Palace: Young Eagles begin pre-season campaign',
        fullText: 'Crystal Palace U21s Young Eagles pre-season injury update',
        sourceName: 'Crystal Palace F.C.', sourceUrl: 'https://www.cpfc.co.uk/news/under-21s/', link: 'https://www.cpfc.co.uk/news/under-21s/'
    }), 'Crystal Palace', { now, kickoff, officialDomain: 'cpfc.co.uk' });
    assert(u21.squadScope === 'U21' && u21.usable === false, 'U21s evidence not excluded');

    const women = sourceIntelligence.assessArticle(article({
        title: 'Injury update on My Cato',
        fullText: 'Crystal Palace injury update on My Cato',
        sourceName: 'Crystal Palace F.C.', sourceUrl: 'https://www.cpfc.co.uk/news/women/', link: 'https://www.cpfc.co.uk/news/women/'
    }), 'Crystal Palace', { now, kickoff, officialDomain: 'cpfc.co.uk' });
    assert(women.squadScope === 'WOMEN' && women.exclusionReason === 'KNOWN_WOMEN_PLAYER' && women.usable === false, 'Women entity resolution failed');

    const duplicate = article({ title: 'Everton sign exciting forward Mouchon - Everton FC', fullText: 'Everton transfer signing forward Mouchon' });
    const dedup = sourceIntelligence.summarizeTeamSourceResults('Everton', [
        { id: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS', tier: 'OFFICIAL_DOMAIN', status: 'OK', articles: [duplicate] },
        { id: 'GOOGLE_NEWS_GENERAL_RSS', tier: 'AGGREGATOR', status: 'OK', articles: [duplicate] }
    ], { now, kickoff, officialDomain: 'evertonfc.com' });
    assert(dedup.counts.receivedArticles === 2, 'Raw duplicate count wrong');
    assert(dedup.counts.uniqueArticles === 1 && dedup.counts.duplicateRetrievals === 1, 'Cross-provider duplicate not clustered');
    assert(dedup.counts.independentPublishers === 1, 'Duplicate publisher counted as independent');

    const firstTeam = sourceIntelligence.summarizeTeamSourceResults('Everton', [
        { id: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS', tier: 'OFFICIAL_DOMAIN', status: 'OK', articles: [article()] },
        { id: 'GOOGLE_NEWS_GENERAL_RSS', tier: 'AGGREGATOR', status: 'OK', articles: [article({ title: 'Everton injury update from Sky Sports', sourceName: 'Sky Sports', sourceUrl: 'https://www.skysports.com/football', link: 'https://www.skysports.com/football/everton-update' })] },
        { id: 'BING_NEWS_GENERAL_RSS', tier: 'AGGREGATOR', status: 'OK', articles: [] }
    ], { now, kickoff, officialDomain: 'evertonfc.com' });
    assert(firstTeam.coverageConfidence > firstTeam.matchImpactConfidence, 'Coverage and match-impact confidence not separated for early match');
    assert(firstTeam.providers.find(p => p.id === 'BING_NEWS_GENERAL_RSS').status === 'EMPTY', 'Empty provider not classified EMPTY');

    assert(sourceIntelligence.normalizeProviderStatus({ status: 'ERROR', error: 'Unknown pseudo-class :source' }, []) === 'PARSER_ERROR', 'Parser error classification failed');

    const invalidEmpty = understatContract.evaluateUnderstatCoverage({ '': { xG_for: 1.2, xG_against: 1.1 } }, 'Everton', 'Crystal Palace');
    assert(invalidEmpty.status === 'INVALID_EMPTY_TEAM', 'Empty Understat team not invalidated');
    const partial = understatContract.evaluateUnderstatCoverage({ Everton: { xG_for: 1.3, xG_against: 1.1 } }, 'Everton', 'Crystal Palace');
    assert(partial.status === 'PARTIAL_HOME_ONLY' && partial.bothTeams === false, 'Understat 1/2 contract failed');
    const both = understatContract.evaluateUnderstatCoverage({ Everton: { xG_for: 1.3, xG_against: 1.1 }, 'Crystal Palace': { xG_for: 1.4, xG_against: 1.2 } }, 'Everton', 'Crystal Palace');
    assert(both.status === 'AVAILABLE_BOTH_TEAMS' && both.bothTeams === true, 'Understat 2/2 contract failed');

    const e0Path = path.join(ROOT, 'backend', 'data', 'calcio_football_data', 'E0.csv');
    const index = teamSnapshot.getLeagueIndex({ csvData: fs.readFileSync(e0Path, 'utf8'), leagueName: 'Premier', code: 'E0' });
    const snapshots = teamSnapshot.buildMatchSnapshots(index, 'Everton', 'Crystal Palace', kickoff);
    assert(snapshots.home.matched && snapshots.home.season.sample > 0, 'Everton football-data snapshot missing');
    assert(snapshots.away.matched && snapshots.away.season.sample > 0, 'Crystal Palace football-data snapshot missing');
    const cutoffCsv = 'Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST\n01/01/2026,Everton,Crystal Palace,1,0,10,8,4,2\n01/09/2026,Everton,Crystal Palace,0,2,7,12,2,5\n';
    const cutoffIndex = teamSnapshot.getLeagueIndex({ csvData: cutoffCsv, leagueName: 'Premier', code: 'TEST', revisionToken: 'cutoff-test' });
    const cutoffSnapshot = teamSnapshot.buildTeamSnapshot(cutoffIndex, 'Everton', new Date('2026-08-22T15:00:00Z'));
    assert(cutoffSnapshot.season.sample === 1 && cutoffSnapshot.season.wins === 1, 'Temporal cutoff leaked future football-data row');

    const audit = sourceIntelligence.buildMatchSourceAudit({
        homeProfile: { sourceIntelligence: firstTeam }, awayProfile: { sourceIntelligence: firstTeam },
        extData: { footballDataLoaded: true, homeMatches: snapshots.home.season.sample, awayMatches: snapshots.away.season.sample, teamSnapshots: snapshots, understatCoverage: partial, xgEvidenceMode: 'GOAL_SHOT_PROXY', understatLoaded: false, homeProviderName: 'Everton', awayProviderName: 'Crystal Palace' }, now
    });
    assert(audit.sources.find(s => s.id === 'UNDERSTAT_XG').status === 'FALLBACK', 'Proxy/partial Understat not kept non-authoritative');
    assert(audit.sourceCoverageConfidence >= 0 && audit.matchImpactConfidence >= 0, 'Audit confidence fields missing');

    assert(Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 7, 'Registry current patch older than 7');
    const patch = registry.PATCHES.find(item => item.version === '7');
    assert(patch && patch.databaseMutation === false && patch.tennisAuthorityChanged === false && patch.footballProbabilityContractChanged === false && patch.stakeAuthorityChanged === false, 'Patch 7 boundaries invalid');

    const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const deepScanSource = fs.readFileSync(path.join(ROOT, 'backend', 'deepScanCalcio.js'), 'utf8');
    const scraperSource = fs.readFileSync(path.join(ROOT, 'backend', 'scraper.js'), 'utf8');
    assert(serverSource.includes("require('./calcioUnderstatContract')") && serverSource.includes("require('./calcioTeamSnapshot')"), 'Server Patch 7 wiring missing');
    assert(serverSource.includes('understatCoverage.bothTeams'), 'Server does not enforce Understat 2/2');
    assert(deepScanSource.includes('Copertura fonti') && deepScanSource.includes('Impatto match'), 'DeepScan dual confidence UI missing');
    assert(scraperSource.includes('UNDERSTAT_NO_VALID_NAMED_TEAM_ROWS'), 'Understat empty-team hardening missing');

    const checks = [
        'U21s and Young Eagles evidence is excluded from men first-team',
        'Women URL and My Cato are resolved outside men first-team',
        'Cross-provider duplicates become one evidence cluster',
        'Independent publishers are not inflated by retrieval paths',
        'Coverage and match-impact confidence are separated',
        'Empty and parser-error providers have explicit states',
        'Understat empty team is invalid',
        'Understat 1/2 is partial and non-authoritative',
        'Understat 2/2 is available for model input',
        'Everton and Crystal Palace football-data snapshots have samples',
        'Football-data snapshot applies as-of temporal cutoff',
        'DeepScan audit exposes source and match-impact confidence',
        'Server uses dual-team Understat and cached team snapshot modules',
        'Registry advances without database, Tennis, probability or stake authority'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_7',
        version: sourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
        diagnostics: {
            dedup: dedup.counts,
            confidence: { coverage: firstTeam.coverageConfidence, matchImpact: firstTeam.matchImpactConfidence },
            understat: { invalid: invalidEmpty.status, partial: partial.status, both: both.status },
            snapshots: { home: snapshots.home.season.sample, away: snapshots.away.season.sample, cutoffSample: cutoffSnapshot.season.sample },
            audit: { status: audit.status, coveragePct: audit.coveragePct, sourceCoverageConfidence: audit.sourceCoverageConfidence, matchImpactConfidence: audit.matchImpactConfidence }
        },
        checks
    };
}

module.exports = { runPatch7Checks };
