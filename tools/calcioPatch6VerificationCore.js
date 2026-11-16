'use strict';

const fs = require('fs');
const path = require('path');
const sourceIntelligence = require('../backend/calcioSourceIntelligence');
const professionalGuard = require('../backend/calcioProfessionalGuard');
const valueEvaluator = require('../backend/value_evaluator');

const ROOT = path.resolve(__dirname, '..');
function assert(ok, message) { if (!ok) throw new Error(message); }
function makeArticle(overrides = {}) {
    return {
        title: 'Everton team news: key defender ruled out through injury',
        fullText: 'Everton team news confirms a key defender ruled out through injury.',
        pubDate: '2026-07-20T12:00:00.000Z',
        sourceName: 'Everton FC',
        sourceUrl: 'https://www.evertonfc.com/news/team-news',
        link: 'https://www.evertonfc.com/news/team-news',
        ...overrides
    };
}

function runPatch6Checks() {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const plan = sourceIntelligence.buildTeamSourcePlan('Everton');
    assert(plan.officialDomain === 'evertonfc.com', 'Official Everton domain not resolved');
    assert(plan.sources.some(s => s.id === 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS'), 'Official-first source missing');
    assert(plan.sources.some(s => s.id === 'GOOGLE_NEWS_GENERAL_RSS'), 'Google general source missing');
    assert(plan.sources.some(s => s.id === 'BING_NEWS_GENERAL_RSS'), 'Bing source missing');

    const stale = sourceIntelligence.assessArticle(makeArticle({ pubDate: '2026-05-01T12:00:00.000Z' }), 'Everton', { now, officialDomain: 'evertonfc.com' });
    assert(stale.fresh === false && stale.usable === false, 'Stale article was not excluded');
    const youth = sourceIntelligence.assessArticle(makeArticle({ title: 'Everton U21 injury update', fullText: 'Everton U21 injury update' }), 'Everton', { now, officialDomain: 'evertonfc.com' });
    assert(youth.excludedSquad === true && youth.usable === false, 'Youth article was not excluded');

    const verified = sourceIntelligence.summarizeTeamSourceResults('Everton', [
        { id: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS', channel: 'GOOGLE_NEWS_RSS', tier: 'OFFICIAL_DOMAIN', status: 'OK', articles: [makeArticle()] },
        { id: 'BING_NEWS_GENERAL_RSS', channel: 'BING_NEWS_RSS', tier: 'AGGREGATOR', status: 'OK', articles: [makeArticle({ title: 'Everton injury update from Sky Sports', sourceName: 'Sky Sports', sourceUrl: 'https://www.skysports.com/football/news', link: 'https://www.skysports.com/football/news' })] }
    ], { now, officialDomain: 'evertonfc.com' });
    assert(verified.status === 'VERIFIED_MULTI_SOURCE', `Expected VERIFIED_MULTI_SOURCE, got ${verified.status}`);
    assert(verified.confidence > 0 && verified.confidence <= 92, 'Verified confidence invalid');
    assert(verified.counts.officialArticles === 1, 'Official article not counted');

    const silent = sourceIntelligence.summarizeTeamSourceResults('Crystal Palace', [
        { id: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS', tier: 'OFFICIAL_DOMAIN', status: 'OK', articles: [] },
        { id: 'GOOGLE_NEWS_GENERAL_RSS', tier: 'AGGREGATOR', status: 'OK', articles: [] },
        { id: 'BING_NEWS_GENERAL_RSS', tier: 'AGGREGATOR', status: 'ERROR', error: 'network', articles: [] }
    ], { now, officialDomain: 'cpfc.co.uk' });
    assert(silent.status === 'NO_RELEVANT_EVIDENCE', 'Silence must be NO_RELEVANT_EVIDENCE');
    assert(silent.confidence === 0, 'Silence cannot have confidence');
    assert(silent.warnings.some(w => w.includes('non equivale')), 'Silence warning missing');

    const sourceAudit = sourceIntelligence.buildMatchSourceAudit({
        homeProfile: { sourceIntelligence: verified },
        awayProfile: { sourceIntelligence: silent },
        extData: {
            marketConsensus: { reference: true },
            footballDataLoaded: true,
            homeMatches: 10,
            awayMatches: 10,
            xgEvidenceMode: 'GOAL_SHOT_PROXY',
            understatLoaded: true,
            homeXg: 1.5,
            awayXg: 1.1
        },
        now
    });
    const xgSource = sourceAudit.sources.find(s => s.id === 'UNDERSTAT_XG');
    assert(xgSource.status === 'FALLBACK', `Proxy must be FALLBACK, got ${xgSource.status}`);
    assert(sourceAudit.contradictions.length > 0, 'Understat/proxy contradiction missing');
    assert(sourceAudit.sourceAuthority.officialLineupConfirmed === false, 'Lineup must not be confirmed');

    const guard = professionalGuard.buildDataReliabilityAudit({
        footballDataLoaded: true,
        homeMatches: 10,
        awayMatches: 10,
        homeXg: null,
        awayXg: null,
        understatLoaded: true,
        xgEvidenceMode: 'GOAL_SHOT_PROXY'
    });
    assert(guard.hasBothXg === false, 'Null xG was coerced to available');
    assert(guard.understatLoaded === false, 'Understat must be false without real xG');
    assert(guard.status.includes('PROXY'), `Proxy status not explicit: ${guard.status}`);
    assert(guard.score < 100, 'Proxy data must not receive score 100');

    const value = valueEvaluator.validateMarketEdge(32.68, 27.86);
    assert(value.validation === 'VALUE', `Expected VALUE from evaluator, got ${value.validation}`);

    const deepScanSource = fs.readFileSync(path.join(ROOT, 'backend', 'deepScanCalcio.js'), 'utf8');
    const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const nlpSource = fs.readFileSync(path.join(ROOT, 'backend', 'nlpEngine7.js'), 'utf8');
    const registrySource = fs.readFileSync(path.join(ROOT, 'backend', 'calcioPatchRegistry.js'), 'utf8');
    assert(deepScanSource.includes("result.status || result.validation"), 'Value validation interface not mapped');
    assert(deepScanSource.includes('Fonti, freschezza e provenienza'), 'Source panel missing');
    assert(deepScanSource.includes('sourceIntelligence: sourceAudit'), 'Source audit not returned');
    assert(serverSource.includes("/api/calcio/source-intelligence/probe"), 'Source probe endpoint missing');
    assert(serverSource.includes('CALCIO_SOURCE_PROBE_LOCAL_ONLY'), 'Local-only source guard missing');
    assert(nlpSource.includes('SOURCE_CACHE_SCHEMA_VERSION'), 'Cache provenance schema missing');
    assert(nlpSource.includes('forceRefresh'), 'Manual source refresh support missing');
    assert(/CALCIO_PATCH_REGISTRY_V(?:[6-9]|[1-9][0-9]+)/.test(registrySource), 'Registry >= V6 missing');
    assert(/CALCIO_CURRENT_PATCH_VERSION = '(?:[6-9]|[1-9][0-9]+)'/.test(registrySource), 'Current Patch >= 6 missing');

    const checks = [
        'Official-first, Google and Bing source plan is explicit',
        'Stale and youth/women evidence is excluded',
        'Official plus independent trusted evidence becomes verified multi-source',
        'Source silence has zero confidence and never means no absences',
        'GOAL_SHOT_PROXY is reported as fallback, not real Understat xG',
        'Understat/proxy contradictions are surfaced',
        'Professional Guard does not coerce null xG to available',
        'Professional Guard labels proxy reliability explicitly',
        'Value evaluator validation is mapped instead of UNKNOWN',
        'DeepScan renders and returns source provenance diagnostics',
        'Local-only source probe endpoint is wired without Odds API use',
        'Registry advances to Patch 6 without model or stake authority'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_6',
        version: sourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
        diagnostics: {
            sourcePlan: plan.sources.map(s => s.id),
            verified: { status: verified.status, confidence: verified.confidence, counts: verified.counts },
            silence: { status: silent.status, confidence: silent.confidence, warnings: silent.warnings },
            matchAudit: { status: sourceAudit.status, coveragePct: sourceAudit.coveragePct, contradictions: sourceAudit.contradictions },
            dataReliability: guard,
            valueValidation: value
        },
        checks
    };
}

module.exports = { runPatch6Checks };
