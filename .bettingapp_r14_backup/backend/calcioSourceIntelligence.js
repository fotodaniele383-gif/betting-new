'use strict';

const entityResolution = require('./calcioEntityResolution');
const understatContract = require('./calcioUnderstatContract');
const newsScopeR12 = require('./calcioNewsScopeR12');

const CALCIO_SOURCE_INTELLIGENCE_VERSION = 'BETTING_RECOVERY_R12_FIRST_TEAM_NEWS_SCOPE_20261108';
const SOURCE_CACHE_SCHEMA_VERSION = 'CALCIO_RECOVERY_R12_NLP_CACHE_V3';
const DEFAULT_MAX_AGE_DAYS = 14;

const OFFICIAL_TEAM_DOMAINS = Object.freeze({
    'arsenal': 'arsenal.com', 'aston villa': 'avfc.co.uk', 'bournemouth': 'afcb.co.uk',
    'brentford': 'brentfordfc.com', 'brighton': 'brightonandhovealbion.com',
    'brighton and hove albion': 'brightonandhovealbion.com', 'chelsea': 'chelseafc.com',
    'coventry': 'ccfc.co.uk', 'coventry city': 'ccfc.co.uk', 'crystal palace': 'cpfc.co.uk',
    'everton': 'evertonfc.com', 'fulham': 'fulhamfc.com', 'hull': 'wearehullcity.co.uk',
    'hull city': 'wearehullcity.co.uk', 'ipswich': 'itfc.co.uk', 'ipswich town': 'itfc.co.uk',
    'leeds': 'leedsunited.com', 'leeds united': 'leedsunited.com', 'liverpool': 'liverpoolfc.com',
    'manchester city': 'mancity.com', 'man city': 'mancity.com', 'manchester united': 'manutd.com',
    'man utd': 'manutd.com', 'newcastle': 'newcastleunited.com', 'newcastle united': 'newcastleunited.com',
    'nottingham forest': 'nottinghamforest.co.uk', 'sunderland': 'safc.com',
    'tottenham': 'tottenhamhotspur.com', 'tottenham hotspur': 'tottenhamhotspur.com',
    'west ham': 'whufc.com', 'west ham united': 'whufc.com',
    // Patch 14: official-first coverage for the major leagues actually analysed by BettingApp.
    'le havre': 'hac-foot.com', 'le havre ac': 'hac-foot.com', 'monaco': 'asmonaco.com', 'as monaco': 'asmonaco.com',
    'paris saint germain': 'psg.fr', 'psg': 'psg.fr', 'marseille': 'om.fr', 'lyon': 'ol.fr', 'lille': 'losc.fr',
    'espanyol': 'rcdespanyol.com', 'levante': 'levanteud.com', 'valencia': 'valenciacf.com',
    'real betis': 'realbetisbalompie.es', 'betis': 'realbetisbalompie.es', 'real madrid': 'realmadrid.com',
    'barcelona': 'fcbarcelona.com', 'atletico madrid': 'atleticodemadrid.com', 'athletic bilbao': 'athletic-club.eus',
    'freiburg': 'scfreiburg.com', 'sc freiburg': 'scfreiburg.com', 'werder bremen': 'werder.de', 'werder': 'werder.de',
    'bayern munich': 'fcbayern.com', 'bayern': 'fcbayern.com', 'borussia dortmund': 'bvb.de', 'dortmund': 'bvb.de',
    'bayer leverkusen': 'bayer04.de', 'leverkusen': 'bayer04.de', 'eintracht frankfurt': 'eintracht.de',
    'genoa': 'genoacfc.it', 'lecce': 'uslecce.it', 'inter milan': 'inter.it', 'inter': 'inter.it',
    'ac milan': 'acmilan.com', 'milan': 'acmilan.com', 'juventus': 'juventus.com', 'napoli': 'sscnapoli.it',
    'roma': 'asroma.com', 'lazio': 'sslazio.it', 'atalanta': 'atalanta.it', 'fiorentina': 'acffiorentina.com'
});

const TRUSTED_PUBLISHER_HINTS = Object.freeze([
    'bbc', 'sky sports', 'the guardian', 'reuters', 'associated press',
    'premier league', 'the athletic', 'espn', 'pa media'
]);

const TEAM_STOP_WORDS = new Set(['fc', 'cf', 'afc', 'club', 'football', 'united', 'city', 'the']);
const RELEVANT_PATTERNS = [
    /\binjur(?:y|ed|ies)\b/i, /\bfitness\b/i, /\bmedical\b/i, /\babsence\b/i,
    /\bruled out\b/i, /\bdoubt(?:ful)?\b/i, /\bsuspension\b/i, /\bsuspended\b/i,
    /\blineup\b/i, /\bteam news\b/i, /\bstarting xi\b/i, /\breturn(?:s|ed|ing)?\b/i,
    /\bavailable\b/i, /\bunavailable\b/i, /\btraining\b/i, /\bpre-season\b/i,
    /\bmanager\b/i, /\bcoach\b/i, /\btransfer\b/i, /\bsign(?:s|ed|ing)?\b/i,
    /\bdepart(?:s|ed|ure)?\b/i, /\bcontract\b/i, /\brotation\b/i, /\bfriendly\b/i
];
const HARD_MEDICAL_PATTERNS = [
    /\bruled out\b/i, /\bsidelined\b/i, /\bwill miss\b/i, /\bsurgery\b/i,
    /\bserious injury\b/i, /\blong[- ]term injury\b/i, /\bsuspended\b/i, /\bacl\b/i
];
const RETURN_PATTERNS = [/\bback in training\b/i, /\breturns?\b/i, /\bfit again\b/i, /\bavailable again\b/i];
const FOOTBALL_CONTEXT_PATTERNS = [
    /\bfootball\b/i, /\bsoccer\b/i, /\bcalcio\b/i, /\bserie [ab]\b/i,
    /\bchampions league\b/i, /\beuropa league\b/i, /\bcoppa italia\b/i,
    /\bmatch(?:day)?\b/i, /\bfixture\b/i, /\bgoal(?:keeper)?\b/i,
    /\bsquad\b/i, /\blineup\b/i, /\bstarting xi\b/i, /\btraining session\b/i,
    /\bmanager\b/i, /\bcoach\b/i, /\bdefender\b/i, /\bmidfielder\b/i,
    /\bstriker\b/i, /\bforward\b/i, /\btransfer\b/i, /\bsigning\b/i,
    /\bpre-season\b/i, /\bfriendly\b/i, /\brossoneri\b/i, /\bgranata\b/i
];
const NON_FOOTBALL_CONTEXT_PATTERNS = [
    /\bnba\b/i, /\bbasketball\b/i, /\bnfl\b/i, /\bbaseball\b/i,
    /\bnew york knicks\b/i, /\bmitchell robinson\b/i, /\bhit[- ]and[- ]run\b/i,
    /\bpolice\b/i, /\bcritically injured\b/i, /\bfamily pleads\b/i,
    /\bshooting\b/i, /\bcar crash\b/i, /\broad accident\b/i
];

function normalizeText(value = '') { return entityResolution.normalizeText(value); }
function strictFinite(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}
function round(value, decimals = 2) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;
}
function canonicalTeamKey(teamName = '') { return entityResolution.canonicalTeamName(teamName); }

function getOfficialDomain(teamName = '') {
    const key = canonicalTeamKey(teamName);
    if (OFFICIAL_TEAM_DOMAINS[key]) return OFFICIAL_TEAM_DOMAINS[key];
    const exact = Object.keys(OFFICIAL_TEAM_DOMAINS).find(name => key.includes(name) || name.includes(key));
    return exact ? OFFICIAL_TEAM_DOMAINS[exact] : null;
}

function buildTeamTokens(teamName = '') {
    return canonicalTeamKey(teamName).split(/\s+/).filter(token => token.length >= 3 && !TEAM_STOP_WORDS.has(token));
}

function buildTeamSourcePlan(teamName = '') {
    const team = String(teamName || '').trim();
    const officialDomain = getOfficialDomain(team);
    const terms = '(injury OR injured OR "team news" OR lineup OR suspension OR fitness OR "back in training" OR transfer OR manager OR "press conference" OR "pre-season" OR friendly)';
    const generalQuery = `"${team}" ${terms}`;
    const sources = [
        { id: 'GOOGLE_NEWS_GENERAL_RSS', channel: 'GOOGLE_NEWS_RSS', tier: 'AGGREGATOR', officialDomain: null, url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${generalQuery} when:14d`)}` },
        { id: 'BING_NEWS_GENERAL_RSS', channel: 'BING_NEWS_RSS', tier: 'AGGREGATOR', officialDomain: null, url: `https://www.bing.com/news/search?q=${encodeURIComponent(generalQuery)}&format=rss` }
    ];
    if (officialDomain) {
        const officialQuery = `site:${officialDomain} "${team}" (injury OR "team news" OR lineup OR fitness OR training OR manager OR transfer OR "press conference" OR "pre-season" OR friendly)`;
        sources.unshift({ id: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS', channel: 'GOOGLE_NEWS_RSS', tier: 'OFFICIAL_DOMAIN', officialDomain, url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${officialQuery} when:21d`)}` });
    }
    return { team, officialDomain, sources };
}

function parsePublicationDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function ageDays(date, now = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return Math.max(0, (now.getTime() - date.getTime()) / 86400000);
}
function articleMentionsTeam(article = {}, teamName = '') {
    const text = normalizeText(`${article.title || ''} ${article.fullText || ''}`);
    const full = canonicalTeamKey(teamName);
    // R12: per 'AC Milan' non conteggiare per omonimia la sola dicitura
    // 'Inter Milan'. Le due identita' non sono intercambiabili.
    if (full === 'milan') {
        const withoutInter = text.replace(/\binter milan\b/g, ' ');
        return /\bmilan\b/.test(withoutInter) || /\brossoneri\b/.test(text);
    }
    if (full && text.includes(full)) return true;
    const tokens = buildTeamTokens(teamName);
    return tokens.length > 0 && tokens.every(token => text.includes(token));
}
function classifyArticle(article = {}) {
    const text = `${article.title || ''} ${article.fullText || ''}`;
    if (HARD_MEDICAL_PATTERNS.some(pattern => pattern.test(text))) return 'HARD_MEDICAL';
    if (RETURN_PATTERNS.some(pattern => pattern.test(text))) return 'RETURN_FITNESS';
    if (/\blineup\b|\bteam news\b|\bstarting xi\b/i.test(text)) return 'LINEUP';
    if (/\binjur|\bfitness\b|\bmedical\b|\bdoubt|\bacl\b/i.test(text)) return 'MEDICAL';
    if (/\btransfer\b|\bsign(?:s|ed|ing)?\b|\bdepart/i.test(text)) return 'TRANSFER';
    if (/\bmanager\b|\bcoach\b/i.test(text)) return 'MANAGER';
    if (/\bpre-season\b|\bfriendly\b|\btraining\b/i.test(text)) return 'PRESEASON';
    return 'OTHER';
}
function inferPublisherTrust(article = {}, officialDomain = null) {
    // R12: il dominio ufficiale va verificato nell'host HTTPS, non cercato
    // come sottostringa in querystring, titolo o dominio omonimo.
    const hosts = [article.sourceUrl, article.link].map(value => {
        try { const parsed = new URL(String(value || '')); return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase().replace(/^www\./, '') : ''; }
        catch (_) { return ''; }
    }).filter(Boolean);
    const canonicalDomain = String(officialDomain || '').toLowerCase().replace(/^www\./, '');
    if (canonicalDomain && hosts.some(host => host === canonicalDomain || host.endsWith('.' + canonicalDomain))) return { tier: 'OFFICIAL', weight: 1 };
    const sourceText = normalizeText(`${article.sourceName || ''} ${hosts.join(' ')}`);
    if (TRUSTED_PUBLISHER_HINTS.some(hint => sourceText.includes(normalizeText(hint)))) return { tier: 'TRUSTED_MEDIA', weight: 0.78 };
    return { tier: 'GENERAL_MEDIA', weight: 0.45 };
}

function temporalAuthority(category = 'OTHER', kickoff = null, now = new Date()) {
    const kickoffDate = kickoff ? new Date(kickoff) : null;
    if (!kickoffDate || Number.isNaN(kickoffDate.getTime())) {
        return { phase: 'NO_KICKOFF', weight: ['LINEUP', 'HARD_MEDICAL', 'MEDICAL'].includes(category) ? 0.55 : 0.35 };
    }
    const hours = (kickoffDate.getTime() - now.getTime()) / 3600000;
    if (hours <= 1.5) return { phase: 'LINEUP_WINDOW', weight: 1 };
    if (hours <= 24) return { phase: 'MATCHDAY', weight: 0.95 };
    if (hours <= 72) return { phase: 'FINAL_TEAM_NEWS', weight: 0.82 };
    if (hours <= 168) return { phase: 'PREMATCH_WEEK', weight: 0.62 };
    if (hours <= 504) return { phase: 'EARLY_PREMATCH', weight: 0.38 };
    return { phase: 'GENERAL_CONTEXT', weight: ['TRANSFER', 'PRESEASON', 'MANAGER'].includes(category) ? 0.22 : 0.12 };
}

function assessArticle(article = {}, teamName = '', options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const maxAgeDays = Number.isFinite(Number(options.maxAgeDays)) ? Number(options.maxAgeDays) : DEFAULT_MAX_AGE_DAYS;
    const publishedAt = parsePublicationDate(article.pubDate || article.publishedAt);
    const daysOld = ageDays(publishedAt, now);
    const mentionsTeam = articleMentionsTeam(article, teamName);
    const text = `${article.title || ''} ${article.fullText || ''}`;
    const relevantTopic = RELEVANT_PATTERNS.some(pattern => pattern.test(text));
    const fresh = daysOld !== null && daysOld <= maxAgeDays;
    const officialDomain = options.officialDomain || null;
    const trust = inferPublisherTrust(article, officialDomain);
    const category = classifyArticle(article);
    const scopeResolution = newsScopeR12.classifyNewsScope(article, teamName, entityResolution.classifyEvidenceScope(article));
    const excludedSquad = scopeResolution.scope !== entityResolution.TEAM_SCOPE.MEN_FIRST_TEAM;
    const footballContext = FOOTBALL_CONTEXT_PATTERNS.some(pattern => pattern.test(text));
    const nonFootballContext = NON_FOOTBALL_CONTEXT_PATTERNS.some(pattern => pattern.test(text));
    const officialEvidence = trust.tier === 'OFFICIAL';
    const medicalCategory = category === 'MEDICAL' || category === 'HARD_MEDICAL' || category === 'RETURN_FITNESS';
    // Le evidenze general-media su infortuni richiedono un contesto calcistico
    // esplicito. Una semplice omonimia del club + parola injury non basta.
    const semanticFootballContext = !nonFootballContext && (
        officialEvidence
        || footballContext
        || (!medicalCategory && trust.tier === 'TRUSTED_MEDIA')
    );
    const relevant = mentionsTeam && relevantTopic && !excludedSquad && semanticFootballContext;
    const usable = relevant && fresh;
    const temporal = temporalAuthority(category, options.kickoff, now);
    const matchImpactWeight = usable ? trust.weight * temporal.weight : 0;
    return {
        ...article,
        publishedAt: publishedAt ? publishedAt.toISOString() : null,
        ageDays: daysOld === null ? null : round(daysOld, 2),
        mentionsTeam,
        excludedSquad,
        exclusionReason: scopeResolution.reason,
        squadScope: scopeResolution.scope,
        subjectResolution: scopeResolution.subjectResolution,
        relevantTopic,
        footballContext,
        nonFootballContext,
        semanticFootballContext,
        fresh,
        relevant,
        usable,
        category,
        trustTier: trust.tier,
        trustWeight: trust.weight,
        temporalPhase: temporal.phase,
        temporalWeight: temporal.weight,
        matchImpactWeight: round(matchImpactWeight, 4)
    };
}

function normalizeProviderStatus(result = {}, rawArticles = []) {
    const rawStatus = String(result.status || '').toUpperCase();
    const error = String(result.error || '');
    if (rawStatus === 'ERROR' || error) {
        if (/timeout|timed out|etimedout/i.test(error)) return 'TIMEOUT';
        if (/pseudo-class|parser|xml|rss/i.test(error)) return 'PARSER_ERROR';
        if (result.httpStatus) return 'HTTP_ERROR';
        return 'ERROR';
    }
    if (!rawArticles.length) return 'EMPTY';
    return 'OK_WITH_RESULTS';
}

function summarizeTeamSourceResults(teamName = '', providerResults = [], options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const officialDomain = options.officialDomain || getOfficialDomain(teamName);
    const providers = [];
    const assessedArticles = [];

    for (const result of Array.isArray(providerResults) ? providerResults : []) {
        const rawArticles = Array.isArray(result.articles) ? result.articles : [];
        const assessed = rawArticles.map(article => assessArticle(article, teamName, {
            now,
            kickoff: options.kickoff,
            maxAgeDays: result.tier === 'OFFICIAL_DOMAIN' ? 21 : DEFAULT_MAX_AGE_DAYS,
            officialDomain
        }));
        assessedArticles.push(...assessed.map(article => ({ ...article, providerId: result.id })));
        const usable = assessed.filter(article => article.usable);
        providers.push({
            id: result.id,
            channel: result.channel || result.id,
            tier: result.tier || 'AGGREGATOR',
            status: normalizeProviderStatus(result, rawArticles),
            httpStatus: result.httpStatus ?? null,
            durationMs: result.durationMs ?? null,
            received: rawArticles.length,
            relevant: assessed.filter(article => article.relevant).length,
            fresh: assessed.filter(article => article.fresh).length,
            usable: usable.length,
            excluded: assessed.filter(article => article.excludedSquad).length,
            officialUsable: usable.filter(article => article.trustTier === 'OFFICIAL').length,
            error: result.error || null,
            fetchedAt: result.fetchedAt || now.toISOString()
        });
    }

    const allUsable = assessedArticles.filter(article => article.usable);
    const clusters = entityResolution.clusterEvidence(allUsable)
        .sort((a, b) => Number(b.primary.matchImpactWeight || 0) - Number(a.primary.matchImpactWeight || 0));
    const uniqueArticles = clusters.map(cluster => ({ ...cluster.primary, retrievalPaths: cluster.retrievalPaths, duplicateCount: cluster.duplicateCount }));
    const officialCount = uniqueArticles.filter(article => article.trustTier === 'OFFICIAL').length;
    const trustedCount = uniqueArticles.filter(article => article.trustTier === 'TRUSTED_MEDIA').length;
    const independentPublishers = new Set(uniqueArticles.map(entityResolution.canonicalPublisher)).size;
    const successfulProviders = providers.filter(provider => ['OK_WITH_RESULTS', 'EMPTY'].includes(provider.status)).length;
    const failedProviders = providers.length - successfulProviders;
    const providersWithResults = providers.filter(provider => provider.status === 'OK_WITH_RESULTS').length;

    let coverageConfidence = 0;
    if (providers.length) coverageConfidence += successfulProviders / providers.length * 35;
    coverageConfidence += Math.min(20, providersWithResults * 7);
    coverageConfidence += Math.min(25, independentPublishers * 8);
    coverageConfidence += Math.min(20, uniqueArticles.length * 3);
    if (!uniqueArticles.length) coverageConfidence = Math.min(coverageConfidence, 35);
    coverageConfidence = clamp(coverageConfidence, 0, 95);

    let matchImpactConfidence = 0;
    for (const article of uniqueArticles) {
        const categoryWeight = ['HARD_MEDICAL', 'LINEUP'].includes(article.category) ? 22
            : ['MEDICAL', 'RETURN_FITNESS'].includes(article.category) ? 16
                : ['MANAGER', 'TRANSFER'].includes(article.category) ? 7 : 5;
        matchImpactConfidence += categoryWeight * Number(article.matchImpactWeight || 0);
    }
    if (officialCount > 0) matchImpactConfidence += 8;
    if (independentPublishers >= 2) matchImpactConfidence += 6;
    matchImpactConfidence = clamp(matchImpactConfidence, 0, 90);
    if (!uniqueArticles.length) matchImpactConfidence = 0;

    let status = 'NO_RELEVANT_EVIDENCE';
    if (!providers.length || successfulProviders === 0) status = 'UNAVAILABLE';
    else if (officialCount > 0 && independentPublishers >= 2) status = 'VERIFIED_MULTI_SOURCE';
    else if (uniqueArticles.length > 0) status = 'PARTIAL';

    const excludedEvidence = assessedArticles.filter(article => !article.usable).slice(0, 12).map(article => ({
        title: article.title || '', sourceName: article.sourceName || '', squadScope: article.squadScope,
        reason: article.exclusionReason || (!article.fresh ? 'STALE' : !article.mentionsTeam ? 'TEAM_NOT_MENTIONED' : 'TOPIC_NOT_RELEVANT')
    }));
    const warnings = [];
    if (!officialDomain) warnings.push('Dominio ufficiale squadra non presente nel catalogo: verifica official-first non disponibile.');
    if (failedProviders) warnings.push(`${failedProviders} fonte/i non hanno risposto correttamente.`);
    if (!uniqueArticles.length) warnings.push('Nessuna notizia fresca e first-team rilevante verificata: non equivale a rosa completa o assenze zero.');
    if (uniqueArticles.length && officialCount === 0) warnings.push('Evidenza solo media/aggregatori: nessuna conferma ufficiale del club.');
    const duplicateCount = clusters.reduce((sum, cluster) => sum + cluster.duplicateCount, 0);
    if (duplicateCount) warnings.push(`${duplicateCount} recupero/i duplicati consolidati in cluster informativi unici.`);
    const rejectedSquad = assessedArticles.filter(article => article.excludedSquad);
    if (rejectedSquad.length) warnings.push(`R12: ${rejectedSquad.length} articolo/i di settore femminile, Primavera, giovanili o squadre diverse esclusi dalla valutazione first-team.`);

    return {
        version: CALCIO_SOURCE_INTELLIGENCE_VERSION,
        cacheSchemaVersion: SOURCE_CACHE_SCHEMA_VERSION,
        entityResolutionVersion: entityResolution.CALCIO_ENTITY_RESOLUTION_VERSION,
        team: teamName,
        officialDomain,
        status,
        confidence: round(matchImpactConfidence, 1),
        coverageConfidence: round(coverageConfidence, 1),
        matchImpactConfidence: round(matchImpactConfidence, 1),
        providers,
        counts: {
            providers: providers.length,
            successfulProviders,
            failedProviders,
            providersWithResults,
            receivedArticles: assessedArticles.length,
            relevantArticles: assessedArticles.filter(article => article.relevant).length,
            usableArticles: uniqueArticles.length,
            uniqueArticles: uniqueArticles.length,
            duplicateRetrievals: duplicateCount,
            evidenceClusters: clusters.length,
            officialArticles: officialCount,
            trustedArticles: trustedCount,
            independentChannels: independentPublishers,
            independentPublishers,
            excludedEvidence: assessedArticles.filter(article => !article.usable).length,
            excludedSquadArticles: assessedArticles.filter(article => article.excludedSquad).length
        },
        articles: uniqueArticles.slice(0, 8).map(article => ({
            title: article.title || '', originalTitle: article.originalTitle || '', fullText: article.fullText || '',
            sourceName: article.sourceName || '', sourceUrl: article.sourceUrl || '', link: article.link || '',
            publishedAt: article.publishedAt, ageDays: article.ageDays, category: article.category,
            trustTier: article.trustTier, providerId: article.providerId, retrievalPaths: article.retrievalPaths,
            duplicateCount: article.duplicateCount, squadScope: article.squadScope, temporalPhase: article.temporalPhase,
            matchImpactWeight: article.matchImpactWeight
        })),
        excludedEvidence,
        warnings
    };
}

function sourceRecord(id, label, status, details = {}) {
    return { id, label, status, authority: details.authority || 'CONTEXT_ONLY', available: ['AVAILABLE', 'PARTIAL', 'VERIFIED'].includes(status), ...details };
}

function buildMatchSourceAudit({ homeProfile = {}, awayProfile = {}, extData = {}, now = new Date() } = {}) {
    const homeNews = homeProfile.sourceIntelligence || null;
    const awayNews = awayProfile.sourceIntelligence || null;
    const probabilityIntegrity = extData.probabilityIntegrity || {};
    const xgEvidenceMode = String(extData.xgEvidenceMode || extData.xg_evidence_mode || probabilityIntegrity.xgEvidenceMode || 'UNKNOWN').toUpperCase();
    const proxyDeclared = ['PROXY','PRIOR','MODEL_ESTIMATED','UNKNOWN','GOAL_SHOT','HISTORY'].some(token => xgEvidenceMode.includes(token));
    const understatCoverage = extData.understatCoverage || understatContract.evaluateUnderstatCoverage(
        extData.understatData || {},
        extData.homeProviderName || extData.homeTeam || '',
        extData.awayProviderName || extData.awayTeam || ''
    );
    const explicitHomeXg = strictFinite(extData.homeUnderstatXg ?? extData.home_xg_real ?? extData.homeRealXg);
    const explicitAwayXg = strictFinite(extData.awayUnderstatXg ?? extData.away_xg_real ?? extData.awayRealXg);
    const explicitBoth = explicitHomeXg !== null && explicitAwayXg !== null;
    const dualTeamUnderstat = understatCoverage?.bothTeams === true || (explicitBoth && extData.understatLoaded === true);
    // RECOVERY_R8: two numeric xG estimates are NOT sufficient proof of current-season Understat.
    const certifiedProvider = ['LIVE_CERTIFIED','LKG_CERTIFIED'].includes(String(extData.xgProviderSourceClass || '').toUpperCase());
    const currentSeason = extData.understatSeasonEvidence?.status === 'CURRENT_SEASON_XG';
    const officialUnderstat = String(extData.xgProviderId || '').toUpperCase().startsWith('UNDERSTAT');
    const realXg = dualTeamUnderstat && !proxyDeclared && certifiedProvider && currentSeason && officialUnderstat && extData.understatLoaded === true;
    const footballDataXgObserved = String(extData.xgProviderId || '').toUpperCase()==='FOOTBALL_DATA_XG'
        && String(extData.xgProviderSourceClass || '').toUpperCase()==='LKG_CERTIFIED'
        && understatCoverage?.bothTeams===true && xgEvidenceMode==='CURRENT_SEASON_XG_LKG';
    const footballDataLoaded = extData.footballDataLoaded === true || strictFinite(extData.homeMatches) > 0 || strictFinite(extData.awayMatches) > 0;
    const marketAvailable = extData.marketReferenceAvailable === true;
    const marketFeedPresent = Boolean(extData.marketConsensus || extData.oddsConsensus || [extData.odd1, extData.oddX, extData.odd2].some(value => strictFinite(value) > 1));
    const homeMatches = strictFinite(extData.homeMatches) ?? extData.teamSnapshots?.home?.season?.sample ?? 0;
    const awayMatches = strictFinite(extData.awayMatches) ?? extData.teamSnapshots?.away?.season?.sample ?? 0;
    const homeStatus = homeNews?.status === 'VERIFIED_MULTI_SOURCE' ? 'VERIFIED' : homeNews?.status === 'PARTIAL' ? 'PARTIAL' : homeNews?.status === 'UNAVAILABLE' ? 'ERROR' : 'MISSING';
    const awayStatus = awayNews?.status === 'VERIFIED_MULTI_SOURCE' ? 'VERIFIED' : awayNews?.status === 'PARTIAL' ? 'PARTIAL' : awayNews?.status === 'UNAVAILABLE' ? 'ERROR' : 'MISSING';
    const clubEloEvidence = extData.clubEloEvidence || null;
    const clubEloStatus = clubEloEvidence?.available === true
        ? (clubEloEvidence.authoritative === true ? 'AVAILABLE' : 'PARTIAL')
        : clubEloEvidence?.status === 'UNAVAILABLE' ? 'ERROR' : 'MISSING';

    const sourceRows = [
        sourceRecord('MARKET_ODDS', 'Quote e riferimento no-vig', marketAvailable ? 'AVAILABLE' : marketFeedPresent ? 'PARTIAL' : 'MISSING', { authority: marketAvailable ? 'PROBABILITY_INPUT' : 'CONTEXT_ONLY', detail: marketAvailable ? 'Riferimento no-vig coerente e con provenienza esplicita.' : marketFeedPresent ? 'Feed quote disponibile; riferimento no-vig non certificato per bookmaker/istante.' : 'Quote/reference non disponibili.' }),
        sourceRecord('FOOTBALL_DATA', 'football-data storico', footballDataLoaded ? 'AVAILABLE' : 'MISSING', { authority: 'HISTORICAL_INPUT', detail: footballDataLoaded ? `Snapshot temporale disponibile; campioni home/away ${homeMatches}/${awayMatches}.` : 'Storico football-data non confermato.', teamSnapshots: extData.teamSnapshots || null }),
        sourceRecord('CLUB_ELO', 'ClubElo forza squadra', clubEloStatus, {
            authority: clubEloEvidence?.authoritative ? 'STRENGTH_INPUT' : 'CONTEXT_ONLY',
            confidence: clubEloEvidence?.matchConfidence || 0,
            detail: clubEloEvidence?.detail || 'Snapshot ClubElo non disponibile o non riconciliato 2/2.',
            diagnostics: clubEloEvidence
        }),
        sourceRecord('UNDERSTAT_XG', 'Understat / xG reale', realXg ? 'AVAILABLE' : (proxyDeclared ? 'FALLBACK' : understatCoverage?.status?.startsWith('PARTIAL') ? 'PARTIAL' : 'MISSING'), {
            authority: realXg ? 'MODEL_INPUT' : 'NO_DIRECT_AUTHORITY',
            detail: realXg ? 'xG reale riconciliato per entrambe le squadre.' : proxyDeclared ? `xG reale 2/2 assente: attivo ${xgEvidenceMode}.` : `Understat: ${understatCoverage?.status || 'MISSING'}.`,
            understatCoverage
        }),
        sourceRecord('FOOTBALL_DATA_XG', 'xG pubblicati Football-Data HxG/AxG', footballDataXgObserved ? 'AVAILABLE' : 'MISSING', {
            authority: footballDataXgObserved ? 'SECONDARY_OBSERVED_XG_INPUT_LIMITED' : 'NO_DIRECT_AUTHORITY',
            detail: footballDataXgObserved ? 'Serie corrente: xG osservati pubblicati per entrambe le squadre; fonte secondaria, algoritmo primario xG non verificato, peso prudente LKG.' : 'CSV xG secondari non disponibili o coppia squadra non validata.'
        }),
        sourceRecord('HOME_NEWS', 'News/medical squadra casa', homeStatus, { authority: 'QUALITATIVE_ONLY', confidence: homeNews?.matchImpactConfidence ?? homeNews?.confidence ?? 0, coverageConfidence: homeNews?.coverageConfidence ?? 0, matchImpactConfidence: homeNews?.matchImpactConfidence ?? homeNews?.confidence ?? 0, detail: homeNews ? `${homeNews.counts?.uniqueArticles || homeNews.counts?.usableArticles || 0} evidenze uniche first-team; ufficiali ${homeNews.counts?.officialArticles || 0}.` : 'Diagnostica news assente.', diagnostics: homeNews }),
        sourceRecord('AWAY_NEWS', 'News/medical squadra ospite', awayStatus, { authority: 'QUALITATIVE_ONLY', confidence: awayNews?.matchImpactConfidence ?? awayNews?.confidence ?? 0, coverageConfidence: awayNews?.coverageConfidence ?? 0, matchImpactConfidence: awayNews?.matchImpactConfidence ?? awayNews?.confidence ?? 0, detail: awayNews ? `${awayNews.counts?.uniqueArticles || awayNews.counts?.usableArticles || 0} evidenze uniche first-team; ufficiali ${awayNews.counts?.officialArticles || 0}.` : 'Diagnostica news assente.', diagnostics: awayNews })
    ];

    const contradictions = [];
    if (extData.understatLoaded === true && !realXg) contradictions.push('Understat dichiarato disponibile ma non riconciliato 2/2 o sostituito da proxy/prior.');
    if (understatCoverage?.status === understatContract.STATUS.INVALID_EMPTY_TEAM) contradictions.push('Understat ha restituito almeno una squadra vuota: payload invalidato.');
    if (dualTeamUnderstat && !realXg) contradictions.push('xG 2/2 presente ma provenienza/stagione non certificata: vietato presentarlo come xG reale.');
    const coverageWeight = { AVAILABLE: 1, VERIFIED: 1, PARTIAL: 0.6, FALLBACK: 0.55, MISSING: 0, ERROR: 0 };
    const coveragePct = round(sourceRows.reduce((sum, row) => sum + (coverageWeight[row.status] || 0), 0) / sourceRows.length * 100, 1);
    const newsCoverage = [homeNews?.coverageConfidence, awayNews?.coverageConfidence].filter(Number.isFinite);
    const newsImpact = [homeNews?.matchImpactConfidence, awayNews?.matchImpactConfidence].filter(Number.isFinite);
    const sourceCoverageConfidence = newsCoverage.length ? round(newsCoverage.reduce((a, b) => a + b, 0) / newsCoverage.length, 1) : 0;
    const matchImpactConfidence = newsImpact.length ? round(newsImpact.reduce((a, b) => a + b, 0) / newsImpact.length, 1) : 0;
    let status = coveragePct >= 82 && !contradictions.length ? 'STRONG' : coveragePct < 45 ? 'WEAK' : 'PARTIAL';
    const warnings = [];
    if (!realXg) warnings.push(footballDataXgObserved ? 'Understat primario non certificato; disponibile xG osservato da Football-Data con autorita secondaria limitata.' : 'xG reale 2/2 non certificato: proxy goal/tiri, prior e stime restano distinti da Understat verificato.');
    if (marketFeedPresent && !marketAvailable) warnings.push('Quote feed visibili, ma fonte no-vig coerente non verificata.');
    if (!((homeNews?.counts?.officialArticles || 0) + (awayNews?.counts?.officialArticles || 0))) warnings.push('Nessuna conferma official-first su lineup/assenze; il silenzio non equivale a rosa completa.');
    if (contradictions.length) warnings.push(...contradictions);

    return {
        version: CALCIO_SOURCE_INTELLIGENCE_VERSION,
        entityResolutionVersion: entityResolution.CALCIO_ENTITY_RESOLUTION_VERSION,
        understatContractVersion: understatContract.CALCIO_UNDERSTAT_CONTRACT_VERSION,
        generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
        status,
        coveragePct,
        sourceCoverageConfidence,
        matchImpactConfidence,
        sources: sourceRows,
        contradictions,
        warnings,
        sourceAuthority: {
            productionProbability: ['MARKET_ODDS', 'FOOTBALL_DATA', realXg ? 'UNDERSTAT_XG' : (footballDataXgObserved?'FOOTBALL_DATA_XG':'GOAL_SHOT_PROXY')],
            qualityGateQuantitative: ['MARKET_ODDS', 'FOOTBALL_DATA', ...(clubEloEvidence?.authoritative ? ['CLUB_ELO'] : []), ...(realXg ? ['UNDERSTAT_XG'] : []), ...(footballDataXgObserved ? ['FOOTBALL_DATA_XG'] : [])],
            qualitativeOnly: ['HOME_NEWS', 'AWAY_NEWS'],
            officialLineupConfirmed: extData.lineupsConfirmed === true
        }
    };
}

module.exports = {
    CALCIO_SOURCE_INTELLIGENCE_VERSION,
    SOURCE_CACHE_SCHEMA_VERSION,
    DEFAULT_MAX_AGE_DAYS,
    OFFICIAL_TEAM_DOMAINS,
    normalizeText,
    strictFinite,
    getOfficialDomain,
    buildTeamSourcePlan,
    assessArticle,
    normalizeProviderStatus,
    summarizeTeamSourceResults,
    buildMatchSourceAudit,
    temporalAuthority
};
