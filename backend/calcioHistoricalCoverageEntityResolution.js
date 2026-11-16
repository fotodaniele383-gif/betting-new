'use strict';

const path = require('path');
const crypto = require('crypto');
const entityResolution = require('./calcioEntityResolution');
const footballDataProvider = require('./calcioFootballDataProvider');
const teamSnapshot = require('./calcioTeamSnapshot');

const CALCIO_HISTORICAL_COVERAGE_VERSION = 'BETTING_PATCH_26F_B_HISTORICAL_COVERAGE_ENTITY_RESOLUTION_V1';
const DEFAULT_PROMOTED_EVIDENCE_WEIGHT = 0.72;
const DEFAULT_PROMOTED_ATTACK_FACTOR = 0.88;
const DEFAULT_PROMOTED_DEFENSE_FACTOR = 1.12;
const DEFAULT_MIN_USABLE_SAMPLE = 5;
const DEFAULT_STRONG_SAMPLE = 10;

const LEAGUE_RELATIONSHIPS = Object.freeze({
    I1: Object.freeze({ key: 'serie_a', name: 'Serie A', lower: Object.freeze([{ code: 'I2', key: 'serie_b', name: 'Serie B', tierDelta: 1 }]) }),
    I2: Object.freeze({ key: 'serie_b', name: 'Serie B', lower: Object.freeze([]) }),
    E0: Object.freeze({ key: 'premier_league', name: 'Premier', lower: Object.freeze([{ code: 'E1', key: 'championship', name: 'Championship', tierDelta: 1 }]) }),
    SP1: Object.freeze({ key: 'la_liga', name: 'La Liga', lower: Object.freeze([{ code: 'SP2', key: 'segunda', name: 'Segunda Division', tierDelta: 1 }]) }),
    D1: Object.freeze({ key: 'bundesliga', name: 'Bundesliga', lower: Object.freeze([{ code: 'D2', key: 'bundesliga_2', name: '2. Bundesliga', tierDelta: 1 }]) }),
    F1: Object.freeze({ key: 'ligue_1', name: 'Ligue 1', lower: Object.freeze([{ code: 'F2', key: 'ligue_2', name: 'Ligue 2', tierDelta: 1 }]) })
});

const COVERAGE_REASONS = Object.freeze({
    PRIMARY_HISTORY: 'PRIMARY_HISTORY',
    PROMOTED_TEAM: 'PROMOTED_TEAM',
    TEAM_ALIAS_MISMATCH: 'TEAM_ALIAS_MISMATCH',
    LEAGUE_MAPPING_MISSING: 'LEAGUE_MAPPING_MISSING',
    SEASON_MAPPING_MISSING: 'SEASON_MAPPING_MISSING',
    HISTORY_FILE_MISSING: 'HISTORY_FILE_MISSING',
    INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
    PROVIDER_NOT_COVERED: 'PROVIDER_NOT_COVERED'
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, decimals = 4) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;
}

function sha256Text(value = '') {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function inferRelationship(code = '', leagueName = '') {
    const normalizedCode = normalizeCode(code);
    if (LEAGUE_RELATIONSHIPS[normalizedCode]) return LEAGUE_RELATIONSHIPS[normalizedCode];
    const normalizedLeague = entityResolution.normalizeText(leagueName);
    for (const [candidateCode, relationship] of Object.entries(LEAGUE_RELATIONSHIPS)) {
        const names = [relationship.name, relationship.key, candidateCode].map(entityResolution.normalizeText);
        if (names.includes(normalizedLeague)) return relationship;
    }
    return null;
}

function sourceDescriptor({ code, leagueName, index, tierDelta = 0, source = 'LOCAL_ACTIVE', season = null, available = true, error = null } = {}) {
    return {
        code: normalizeCode(code),
        leagueName: leagueName || index?.leagueName || null,
        tierDelta: Math.max(0, finite(tierDelta, 0)),
        source,
        season,
        available: Boolean(available && index),
        error: error || null,
        index: index || null,
        teams: index?.teams || [],
        matches: index?.matches || []
    };
}

function loadLocalRelatedSources({ projectRoot, primaryCode, cacheDir } = {}) {
    const relationship = inferRelationship(primaryCode);
    if (!relationship) return { relationship: null, sources: [], missing: [] };
    const sources = [];
    const missing = [];
    for (const related of relationship.lower) {
        try {
            const snapshot = footballDataProvider.readLocalLeagueSnapshot({
                code: related.code,
                cacheDir: cacheDir || path.join(projectRoot || path.resolve(__dirname, '..'), 'backend', 'data', 'calcio_football_data')
            });
            if (!snapshot?.valid) {
                missing.push({ ...related, reason: COVERAGE_REASONS.HISTORY_FILE_MISSING });
                continue;
            }
            const index = teamSnapshot.getLeagueIndex({
                csvData: snapshot.csvData,
                leagueName: related.name,
                code: related.code,
                revisionToken: snapshot.metadata?.sha256 || snapshot.inspection?.sha256 || sha256Text(snapshot.csvData).slice(0, 24)
            });
            sources.push(sourceDescriptor({
                ...related,
                index,
                source: snapshot.metadata?.source || 'LOCAL_ACTIVE',
                season: snapshot.metadata?.season || null,
                available: true
            }));
        } catch (error) {
            missing.push({ ...related, reason: COVERAGE_REASONS.HISTORY_FILE_MISSING, error: error.message });
        }
    }
    return { relationship, sources, missing };
}

function teamSample(index = {}, resolvedTeam = '', cutoff = new Date()) {
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    if (!resolvedTeam || Number.isNaN(cutoffDate.getTime())) return 0;
    return (index.matches || []).filter(match => match.date < cutoffDate && (match.home === resolvedTeam || match.away === resolvedTeam)).length;
}

function resolveWithinSource(requestedTeam, source, cutoff, options = {}) {
    if (!source?.available || !source.index) return null;
    const resolution = entityResolution.resolveTeamName(requestedTeam, source.index.teams || [], {
        threshold: options.threshold ?? 0.82
    });
    if (!resolution.matched) return { source, resolution, matched: false, sample: 0 };
    const sample = teamSample(source.index, resolution.resolved, cutoff);
    return { source, resolution, matched: true, sample };
}

function classifyResolvedCoverage(result, options = {}) {
    const minSample = Math.max(1, finite(options.minSample, DEFAULT_MIN_USABLE_SAMPLE));
    const strongSample = Math.max(minSample, finite(options.strongSample, DEFAULT_STRONG_SAMPLE));
    const promoted = finite(result.source?.tierDelta, 0) > 0;
    let status = promoted ? 'PROMOTED_TEAM_PRIOR' : 'HISTORY_PRIMARY';
    let reasonCode = promoted ? COVERAGE_REASONS.PROMOTED_TEAM : COVERAGE_REASONS.PRIMARY_HISTORY;
    if (result.sample < minSample) {
        status = result.sample > 0 ? 'HISTORY_THIN' : 'PRIOR_ONLY';
        reasonCode = COVERAGE_REASONS.INSUFFICIENT_SAMPLE;
    } else if (!promoted && result.sample >= strongSample) {
        status = 'HISTORY_PRIMARY_STRONG';
    }
    const confidence = promoted
        ? clamp(28 + Math.min(result.sample, 20) * 2.1, 28, 68)
        : clamp(35 + Math.min(result.sample, 20) * 2.8, 35, 91);
    return { status, reasonCode, confidence: Math.round(confidence) };
}

function closestCandidate(requestedTeam, sources = []) {
    let best = null;
    for (const source of sources) {
        const resolution = entityResolution.resolveTeamName(requestedTeam, source.teams || [], { threshold: 0.60 });
        const confidence = finite(resolution.confidence, 0);
        if (!best || confidence > best.confidence) best = { source, resolution, confidence };
    }
    return best;
}

function createCoverageContext({
    projectRoot = path.resolve(__dirname, '..'),
    primaryCsvData = '',
    primaryCode = '',
    primaryLeagueName = '',
    primaryRevisionToken = '',
    primarySeason = null,
    cacheDir = null,
    relatedSources = null
} = {}) {
    const code = normalizeCode(primaryCode);
    const primaryIndex = teamSnapshot.getLeagueIndex({
        csvData: primaryCsvData,
        leagueName: primaryLeagueName,
        code,
        revisionToken: primaryRevisionToken || sha256Text(primaryCsvData).slice(0, 24)
    });
    const primary = sourceDescriptor({
        code,
        leagueName: primaryLeagueName,
        index: primaryIndex,
        tierDelta: 0,
        source: 'PRIMARY_ACTIVE',
        season: primarySeason,
        available: true
    });
    const loaded = Array.isArray(relatedSources)
        ? { relationship: inferRelationship(code, primaryLeagueName), sources: relatedSources, missing: [] }
        : loadLocalRelatedSources({ projectRoot, primaryCode: code, cacheDir });
    const normalizedRelated = (loaded.sources || []).map(source => source.index
        ? sourceDescriptor(source)
        : sourceDescriptor({ ...source, available: false }));
    const allSources = [primary, ...normalizedRelated];

    const compositeMatches = [];
    for (const source of allSources) {
        if (!source.available) continue;
        const evidenceWeight = source.tierDelta > 0 ? DEFAULT_PROMOTED_EVIDENCE_WEIGHT : 1;
        for (const match of source.matches) {
            compositeMatches.push({
                ...match,
                sourceCode: source.code,
                sourceLeagueName: source.leagueName,
                sourceTierDelta: source.tierDelta,
                evidenceWeight,
                promotedEvidence: source.tierDelta > 0
            });
        }
    }
    compositeMatches.sort((a, b) => a.date - b.date || String(a.sourceCode).localeCompare(String(b.sourceCode)));
    const compositeIndex = {
        version: CALCIO_HISTORICAL_COVERAGE_VERSION,
        leagueName: primaryLeagueName,
        code,
        primaryCode: code,
        revisionToken: sha256Text(JSON.stringify(allSources.map(source => ({ code: source.code, revision: source.index?.revisionToken, season: source.season })))).slice(0, 24),
        matches: compositeMatches,
        teams: [...new Set(compositeMatches.flatMap(match => [match.home, match.away]))].sort(),
        sources: allSources.map(source => ({
            code: source.code,
            leagueName: source.leagueName,
            tierDelta: source.tierDelta,
            available: source.available,
            season: source.season,
            teamCount: source.teams.length,
            matchCount: source.matches.length
        }))
    };

    function resolveTeam(requestedTeam = '', cutoff = new Date(), options = {}) {
        const primaryResult = resolveWithinSource(requestedTeam, primary, cutoff, options);
        if (primaryResult?.matched) {
            const classification = classifyResolvedCoverage(primaryResult, options);
            return {
                version: CALCIO_HISTORICAL_COVERAGE_VERSION,
                requestedTeam,
                matched: true,
                resolvedTeam: primaryResult.resolution.resolved,
                method: primaryResult.resolution.method,
                resolutionConfidence: primaryResult.resolution.confidence,
                sourceCode: primary.code,
                sourceLeagueName: primary.leagueName,
                sourceTierDelta: 0,
                sample: primaryResult.sample,
                evidenceWeight: 1,
                promotedTeamPrior: false,
                ...classification,
                safeguards: { fuzzyThreshold: options.threshold ?? 0.82, inventedData: false, asOfSafe: true }
            };
        }
        for (const source of normalizedRelated) {
            const result = resolveWithinSource(requestedTeam, source, cutoff, options);
            if (!result?.matched) continue;
            const classification = classifyResolvedCoverage(result, options);
            return {
                version: CALCIO_HISTORICAL_COVERAGE_VERSION,
                requestedTeam,
                matched: result.sample > 0,
                resolvedTeam: result.resolution.resolved,
                method: result.resolution.method,
                resolutionConfidence: result.resolution.confidence,
                sourceCode: source.code,
                sourceLeagueName: source.leagueName,
                sourceTierDelta: source.tierDelta,
                sample: result.sample,
                evidenceWeight: DEFAULT_PROMOTED_EVIDENCE_WEIGHT,
                promotedTeamPrior: true,
                ...classification,
                safeguards: {
                    fuzzyThreshold: options.threshold ?? 0.82,
                    inventedData: false,
                    asOfSafe: true,
                    crossDivisionEvidence: true,
                    lowerDivisionShrink: true
                }
            };
        }
        const closest = closestCandidate(requestedTeam, allSources);
        const relationshipMissing = !loaded.relationship;
        const allRelatedMissing = Boolean(loaded.relationship?.lower?.length) && normalizedRelated.length === 0;
        let reasonCode = relationshipMissing
            ? COVERAGE_REASONS.LEAGUE_MAPPING_MISSING
            : allRelatedMissing
                ? COVERAGE_REASONS.HISTORY_FILE_MISSING
                : closest?.confidence >= 0.60
                    ? COVERAGE_REASONS.TEAM_ALIAS_MISMATCH
                    : COVERAGE_REASONS.PROVIDER_NOT_COVERED;
        return {
            version: CALCIO_HISTORICAL_COVERAGE_VERSION,
            requestedTeam,
            matched: false,
            resolvedTeam: null,
            method: closest?.resolution?.method || 'NO_CONSERVATIVE_MATCH',
            resolutionConfidence: closest?.confidence || 0,
            closest: closest?.resolution?.resolved || closest?.resolution?.closest || null,
            sourceCode: null,
            sourceLeagueName: null,
            sourceTierDelta: null,
            sample: 0,
            evidenceWeight: 0,
            promotedTeamPrior: false,
            status: 'PRIOR_ONLY',
            reasonCode,
            confidence: 0,
            missingSources: loaded.missing || [],
            safeguards: { inventedData: false, asOfSafe: true }
        };
    }

    function resolveMatch(homeTeam = '', awayTeam = '', cutoff = new Date(), options = {}) {
        const home = resolveTeam(homeTeam, cutoff, options);
        const away = resolveTeam(awayTeam, cutoff, options);
        const matched = home.matched && away.matched;
        const minSample = Math.min(home.sample || 0, away.sample || 0);
        const promotedSides = [home, away].filter(side => side.promotedTeamPrior).length;
        const reasons = [home.reasonCode, away.reasonCode];
        const status = !matched
            ? 'PRIOR_ONLY'
            : promotedSides > 0
                ? 'PROMOTED_TEAM_PRIOR'
                : minSample >= DEFAULT_STRONG_SAMPLE
                    ? 'HISTORY_PROXY_STRONG'
                    : minSample >= DEFAULT_MIN_USABLE_SAMPLE
                        ? 'HISTORY_PROXY'
                        : 'HISTORY_THIN';
        return {
            version: CALCIO_HISTORICAL_COVERAGE_VERSION,
            leagueName: primaryLeagueName,
            code,
            cutoffAt: (cutoff instanceof Date ? cutoff : new Date(cutoff)).toISOString(),
            matched,
            status,
            reasonCode: matched ? (promotedSides > 0 ? COVERAGE_REASONS.PROMOTED_TEAM : COVERAGE_REASONS.PRIMARY_HISTORY) : reasons.find(reason => reason !== COVERAGE_REASONS.PRIMARY_HISTORY) || COVERAGE_REASONS.PROVIDER_NOT_COVERED,
            minSample,
            promotedSides,
            promotedTeamPrior: promotedSides > 0,
            confidence: Math.min(home.confidence || 0, away.confidence || 0),
            home,
            away,
            sourceCodes: [...new Set([home.sourceCode, away.sourceCode].filter(Boolean))],
            safeguards: {
                inventedData: false,
                asOfSafe: true,
                sourceTierExplicit: true,
                promotedTeamEvidenceShrunk: promotedSides > 0
            }
        };
    }

    function buildLegacyTeamStats(requestedTeam = '', cutoff = new Date(), options = {}) {
        const coverage = resolveTeam(requestedTeam, cutoff, options);
        if (!coverage.matched || !coverage.resolvedTeam || !coverage.sourceCode) return { coverage, stats: null };
        const source = allSources.find(item => item.code === coverage.sourceCode);
        if (!source?.index) return { coverage: { ...coverage, matched: false, status: 'PRIOR_ONLY', reasonCode: COVERAGE_REASONS.HISTORY_FILE_MISSING }, stats: null };
        const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
        const team = coverage.resolvedTeam;
        const relevant = source.index.matches.filter(match => match.date < cutoffDate && (match.home === team || match.away === team));
        const stats = { hp: 0, hs: 0, hc: 0, hsot: 0, hcot: 0, ap: 0, as: 0, ac: 0, asot: 0, acot: 0, recS: [], recC: [], elo: 1500, matches: [] };
        const promoted = coverage.promotedTeamPrior;
        const attackFactor = promoted ? DEFAULT_PROMOTED_ATTACK_FACTOR : 1;
        const defenseFactor = promoted ? DEFAULT_PROMOTED_DEFENSE_FACTOR : 1;
        for (const match of relevant) {
            const isHome = match.home === team;
            const goalsForRaw = isHome ? match.homeGoals : match.awayGoals;
            const goalsAgainstRaw = isHome ? match.awayGoals : match.homeGoals;
            const shotsForRaw = isHome ? match.homeShots : match.awayShots;
            const shotsAgainstRaw = isHome ? match.awayShots : match.homeShots;
            const sotForRaw = isHome ? match.homeShotsOnTarget : match.awayShotsOnTarget;
            const sotAgainstRaw = isHome ? match.awayShotsOnTarget : match.homeShotsOnTarget;
            const goalsFor = goalsForRaw * attackFactor;
            const goalsAgainst = goalsAgainstRaw * defenseFactor;
            const shotsFor = finite(shotsForRaw, 0) * (promoted ? 0.92 : 1);
            const shotsAgainst = finite(shotsAgainstRaw, 0) * (promoted ? 1.08 : 1);
            const sotFor = finite(sotForRaw, 0) * (promoted ? 0.92 : 1);
            const sotAgainst = finite(sotAgainstRaw, 0) * (promoted ? 1.08 : 1);
            if (isHome) {
                stats.hp += 1; stats.hs += goalsFor; stats.hc += goalsAgainst; stats.hsot += sotFor; stats.hcot += sotAgainst;
            } else {
                stats.ap += 1; stats.as += goalsFor; stats.ac += goalsAgainst; stats.asot += sotFor; stats.acot += sotAgainst;
            }
            stats.recS.push(goalsFor);
            stats.recC.push(goalsAgainst);
            stats.matches.push({
                goalsFor, goalsAgainst, shots: shotsFor, shotsOnTarget: sotFor,
                shotsAgainst, shotsOnTargetAgainst: sotAgainst,
                sourceCode: coverage.sourceCode,
                sourceTierDelta: coverage.sourceTierDelta,
                evidenceWeight: coverage.evidenceWeight
            });
            if (stats.recS.length > 10) { stats.recS.shift(); stats.recC.shift(); stats.matches.shift(); }
        }
        stats.historicalCoverage = coverage;
        stats.teamName = team;
        stats.observedHomeMatches = stats.hp;
        stats.observedAwayMatches = stats.ap;
        stats.observedMatches = relevant.length;
        stats.promotedTeamPrior = promoted;
        stats.sourceCode = coverage.sourceCode;
        return { coverage, stats };
    }

    function coverageMatrix(cutoff = new Date()) {
        const rows = [];
        for (const source of allSources) {
            if (!source.available) continue;
            for (const team of source.teams) {
                const sample = teamSample(source.index, team, cutoff);
                rows.push({
                    leagueCode: code,
                    sourceCode: source.code,
                    sourceLeagueName: source.leagueName,
                    team,
                    tierDelta: source.tierDelta,
                    sample,
                    status: source.tierDelta > 0 ? 'PROMOTED_POOL_AVAILABLE' : 'PRIMARY_POOL_AVAILABLE'
                });
            }
        }
        return rows;
    }

    return {
        version: CALCIO_HISTORICAL_COVERAGE_VERSION,
        code,
        leagueName: primaryLeagueName,
        relationship: loaded.relationship,
        primary,
        relatedSources: normalizedRelated,
        missingSources: loaded.missing || [],
        compositeIndex,
        resolveTeam,
        resolveMatch,
        buildLegacyTeamStats,
        coverageMatrix,
        diagnostics: {
            primaryTeams: primary.teams.length,
            primaryMatches: primary.matches.length,
            relatedSourcesAvailable: normalizedRelated.length,
            relatedTeams: normalizedRelated.reduce((sum, source) => sum + source.teams.length, 0),
            relatedMatches: normalizedRelated.reduce((sum, source) => sum + source.matches.length, 0),
            missingSources: loaded.missing || []
        }
    };
}

function buildPersistenceFields(audit = {}) {
    return {
        calcio_historical_coverage_version: audit.version || CALCIO_HISTORICAL_COVERAGE_VERSION,
        calcio_historical_coverage_status: audit.status || 'PRIOR_ONLY',
        calcio_historical_coverage_reason: audit.reasonCode || COVERAGE_REASONS.PROVIDER_NOT_COVERED,
        calcio_historical_home_source: audit.home?.sourceCode || null,
        calcio_historical_away_source: audit.away?.sourceCode || null,
        calcio_historical_coverage_sample: finite(audit.minSample, 0),
        calcio_historical_coverage_confidence: finite(audit.confidence, 0),
        calcio_historical_coverage_audit: JSON.stringify(audit || {})
    };
}

module.exports = {
    CALCIO_HISTORICAL_COVERAGE_VERSION,
    DEFAULT_PROMOTED_EVIDENCE_WEIGHT,
    DEFAULT_PROMOTED_ATTACK_FACTOR,
    DEFAULT_PROMOTED_DEFENSE_FACTOR,
    DEFAULT_MIN_USABLE_SAMPLE,
    DEFAULT_STRONG_SAMPLE,
    LEAGUE_RELATIONSHIPS,
    COVERAGE_REASONS,
    inferRelationship,
    loadLocalRelatedSources,
    createCoverageContext,
    buildPersistenceFields
};
