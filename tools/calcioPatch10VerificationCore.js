'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const eventIdentity = require('../backend/calcioEventIdentity');
const understat = require('../backend/calcioUnderstatProviderV2');
const stakeLifecycle = require('../backend/calcioStakeLifecycle');
const professionalGuard = require('../backend/calcioProfessionalGuard');
const registry = require('../backend/calcioPatchRegistry');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function completeBook(home, away, lastUpdate, extraBooks = 0) {
    const bookmakers = [{
        key: 'book-a',
        last_update: lastUpdate,
        markets: [{
            key: 'h2h',
            outcomes: [
                { name: home, price: 2.4 },
                { name: 'Draw', price: 3.2 },
                { name: away, price: 2.9 }
            ]
        }]
    }];
    for (let i = 0; i < extraBooks; i++) bookmakers.push({ ...bookmakers[0], key: `book-${i + 2}` });
    return bookmakers;
}

function buildUnderstatFixture() {
    const teams = {};
    for (let i = 0; i < 18; i++) {
        teams[String(i + 1)] = {
            id: String(i + 1),
            title: `Bundesliga Team ${i + 1}`,
            history: [
                { xG: String(1.1 + i * 0.01), xGA: String(0.9 + i * 0.01) },
                { xG: String(1.3 + i * 0.01), xGA: String(1.0 + i * 0.01) }
            ]
        };
    }
    const encoded = JSON.stringify(teams)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e');
    return `<!doctype html><html><head><title>Bundesliga xG Table and Scorers for the 2025/2026 season | Understat.com</title></head><body><h1>Understat</h1><script>var teamsData = JSON.parse('${encoded}');</script>${' '.repeat(800)}</body></html>`;
}

function runPatch10Checks() {
    const events = [
        {
            id: 'stale-provider-id',
            home_team: 'Torino',
            away_team: 'Juventus',
            commence_time: '2026-08-23T16:30:00Z',
            rawEdge: 99,
            bookmakers: completeBook('Torino', 'Juventus', '2026-07-20T08:00:00Z', 1)
        },
        {
            id: 'current-provider-id',
            home_team: 'Torino',
            away_team: 'Juventus',
            commence_time: '2026-08-22T13:00:00Z',
            rawEdge: 1,
            bookmakers: completeBook('Torino', 'Juventus', '2026-07-22T08:00:00Z', 1)
        },
        {
            id: 'unique-event',
            home_team: 'Inter',
            away_team: 'Genoa',
            commence_time: '2026-08-22T18:45:00Z',
            bookmakers: completeBook('Inter', 'Genoa', '2026-07-22T07:00:00Z')
        }
    ];
    const dedup = eventIdentity.deduplicateCalcioEvents(events, {
        leagueKey: 'serie_a',
        leagueName: 'Serie A',
        provider: 'THE_ODDS_API',
        now: '2026-07-22T10:00:00Z'
    });
    assert(dedup.events.length === 2, 'Event Identity Guard did not remove pair duplicate');
    assert(dedup.diagnostics.duplicatesRemoved === 1, 'Duplicate count mismatch');
    assert(dedup.diagnostics.edgeUsedForSelection === false, 'Edge must never select canonical event');
    const torino = dedup.events.find(row => row.home_team === 'Torino');
    assert(torino && torino.id === 'current-provider-id', 'Canonical event was not selected by source freshness/coverage');
    assert(torino.calcioEventIdentity.status === 'PAIR_KICKOFF_CONFLICT_RESOLVED', 'Kickoff conflict not surfaced');

    const parsed = understat.parseUnderstatLeagueHtml(buildUnderstatFixture(), {
        finalUrl: 'https://understat.com/league/Bundesliga',
        source: 'TEST_FIXTURE'
    });
    assert(parsed.metadata.teamCount === 18, 'Understat teamsData parser did not validate all named teams');
    assert(parsed.metadata.parser === 'EMBEDDED_TEAMS_DATA_JSON', 'Understat parser is not structured-data based');
    assert(parsed.teams['Bundesliga Team 1'].xG_for > 0, 'Understat xG average missing');
    const prior = understat.classifySeasonForKickoff('2025/2026', '2026-08-29T13:30:00Z');
    const current = understat.classifySeasonForKickoff('2026/2027', '2026-08-29T13:30:00Z');
    assert(prior.status === 'PREVIOUS_SEASON_XG_PRIOR' && prior.authorityWeight === 0.25, 'Previous-season Understat was not downgraded to prior');
    assert(current.status === 'CURRENT_SEASON_XG' && current.authorityWeight === 0.75, 'Current-season Understat authority mismatch');
    let challengeCaught = false;
    try {
        understat.parseUnderstatLeagueHtml(`<html><body>Understat captcha checking your browser${' '.repeat(800)} teamsData</body></html>`, { finalUrl: 'https://understat.com/league/Bundesliga' });
    } catch (error) {
        challengeCaught = error.code === 'UNDERSTAT_CHALLENGE_OR_ACCESS_DENIED';
    }
    assert(challengeCaught, 'Understat challenge page not classified explicitly');

    const audit = professionalGuard.buildCalcioProfessionalAudit({
        home: 'Torino',
        away: 'Juventus',
        prediction: '1X',
        extData: {
            commenceTime: '2026-08-23T18:30:00Z',
            homeCsvName: 'Torino',
            awayCsvName: 'Juventus',
            homeMatches: 19,
            awayMatches: 19,
            footballDataLoaded: true,
            xgEvidenceMode: 'GOAL_SHOT_PROXY',
            lineupStatus: 'NOT_CONFIRMED',
            newsConfidence: 45
        },
        now: new Date('2026-07-22T10:00:00Z')
    });
    assert(audit.status === 'PROFESSIONAL_WATCHLIST', 'Far-future missing lineup incorrectly classified as model block');
    const unchangedClassification = professionalGuard.applyProfessionalRiskToClassification({ level: 'EDGE_TECNICO', action: 'EDGE TECNICO' }, audit);
    assert(unchangedClassification.level === 'EDGE_TECNICO', 'Early timing incorrectly rewrites DeepScan model classification');

    const early = stakeLifecycle.buildStakeLifecycle({
        theoreticalStake: 8,
        gate: { allowBet: false, status: 'CALCIO_EARLY_WATCHLIST', reasons: ['early'] },
        professionalAudit: audit,
        odd: 2
    });
    assert(early.theoreticalStake === 8 && early.operationalStake === 0, 'Early watchlist must preserve theoretical stake and zero only execution');
    assert(early.status === 'THEORETICAL_ONLY_EARLY_WATCHLIST', 'Early lifecycle state missing');

    const preMatch = stakeLifecycle.buildStakeLifecycle({
        theoreticalStake: 8,
        gate: { allowBet: true, status: 'CALCIO_WATCHLIST_MICRO', maxStake: 3, reasons: [] },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'PRE_MATCH_EARLY' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } },
        odd: 2
    });
    assert(preMatch.operationalStake === 2, '2-24h lifecycle must apply 25% micro cap');

    const finalGate = stakeLifecycle.buildStakeLifecycle({
        theoreticalStake: 8,
        gate: { allowBet: true, status: 'CALCIO_APPROVED_WITH_CAP', maxStake: 6, reasons: [] },
        professionalAudit: { status: 'PROFESSIONAL_OK', timing: { status: 'FINAL_GATE' }, lineupNews: { status: 'LINEUP_OK' } },
        odd: 2
    });
    assert(finalGate.operationalStake === 6 && finalGate.status === 'OPERATIONAL_AUTHORIZED', 'Final gate did not authorize capped stake');

    const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    const mirrorSource = fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js'), 'utf8');
    const scraperSource = fs.readFileSync(path.join(ROOT, 'backend', 'scraper.js'), 'utf8');
    assert(serverSource.includes("require('./calcioEventIdentity')") && serverSource.includes('deduplicateCalcioEvents(rawLiveMatches'), 'Server does not deduplicate before model');
    assert(serverSource.indexOf('deduplicateCalcioEvents(rawLiveMatches') < serverSource.indexOf('liveMatches.forEach(m =>'), 'Event dedupe occurs after model loop');
    assert(serverSource.includes('WHERE match_exposure_key = ?') && serverSource.includes('requestedEventKey'), 'DeepScan is not event-key scoped');
    assert(serverSource.includes('calcio_theoretical_stake') && serverSource.includes('calcio_operational_stake'), 'Stake lifecycle persistence columns missing');
    assert(scraperSource.includes("require('./calcioUnderstatProviderV2')"), 'Legacy scraper facade not wired to V2');
    assert(appSource.includes('eventKey: bet.event_key') && appSource.includes('Teorico €'), 'Frontend event identity/stake lifecycle missing');
    assert(appSource === mirrorSource, 'Frontend mirrors are not byte-identical');
    assert(Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 10, 'Registry is below Patch 10');
    const patch = registry.PATCHES.find(row => row.version === '10');
    assert(patch && patch.stakeAuthorityChanged === true && patch.databaseSchemaOnly === true && patch.tennisAuthorityChanged === false, 'Patch 10 authority boundaries invalid');

    const checks = [
        'Pair duplicates are removed before the model',
        'Canonical event selection never uses edge',
        'Kickoff conflicts are surfaced with provider identity',
        'Understat teamsData structured JSON is parsed and validated',
        'Challenge and schema failures have explicit states',
        'Previous-season xG is downgraded to prior authority',
        'Far-future missing lineup is watchlist, not model risk',
        'Theoretical stake survives an early operational block',
        '2-24h lifecycle applies a bounded micro cap',
        'Final gate can authorize capped operational stake',
        'DeepScan updates exactly one event-key row',
        'Frontend shows theoretical and operational stake',
        'Registry advances with schema-only DB migration and Tennis isolation'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_10',
        version: 'CALCIO_PATCH_10_EVENT_IDENTITY_UNDERSTAT_STAKE_LIFECYCLE',
        diagnostics: {
            eventIdentity: dedup.diagnostics,
            understat: parsed.metadata,
            seasonPrior: prior,
            professionalStatus: audit.status,
            stakeLifecycle: { early, preMatch, finalGate }
        },
        checks
    };
}

module.exports = { ROOT, buildUnderstatFixture, runPatch10Checks };
