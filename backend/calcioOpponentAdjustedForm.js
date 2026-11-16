'use strict';

const entityResolution = require('./calcioEntityResolution');

const CALCIO_OPPONENT_ADJUSTED_FORM_VERSION = 'BETTING_PATCH_26F_B_OPPONENT_ADJUSTED_FORM_V2';
const DEFAULT_PRIOR_MATCHES = 6;
const DEFAULT_FORM_WINDOW = 10;
const DEFAULT_RECENCY_DECAY = 0.86;
const DEFAULT_ADJUSTMENT_CAP = 0.08;
const DEFAULT_EVIDENCE_BLEND = 0.65;

const evidenceCache = new WeakMap();
const matchupCache = new Map();

function finite(value, fallback = null) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    const n = finite(value, min);
    return Math.max(min, Math.min(max, n));
}

function round(value, decimals = 4) {
    const n = finite(value, null);
    return n === null ? null : Number(n.toFixed(decimals));
}

function makeEmptyState() {
    return {
        matches: 0,
        homeMatches: 0,
        awayMatches: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        homeGoalsFor: 0,
        homeGoalsAgainst: 0,
        awayGoalsFor: 0,
        awayGoalsAgainst: 0
    };
}

function getTeamState(states, team) {
    if (!states.has(team)) states.set(team, makeEmptyState());
    return states.get(team);
}

function calculateRollingLeaguePrior(aggregate = {}) {
    const matches = Math.max(0, finite(aggregate.matches, 0));
    const pseudoMatches = 8;
    const defaultHome = 1.45;
    const defaultAway = 1.15;
    const homeGoals = Math.max(0, finite(aggregate.homeGoals, 0));
    const awayGoals = Math.max(0, finite(aggregate.awayGoals, 0));
    return {
        matches,
        homeGoalsPerMatch: (homeGoals + (defaultHome * pseudoMatches)) / (matches + pseudoMatches),
        awayGoalsPerMatch: (awayGoals + (defaultAway * pseudoMatches)) / (matches + pseudoMatches)
    };
}

function posteriorRate(total, sample, priorMean, priorMatches = DEFAULT_PRIOR_MATCHES) {
    const n = Math.max(0, finite(sample, 0));
    const prior = Math.max(0.05, finite(priorMean, 1));
    const strength = Math.max(0, finite(priorMatches, DEFAULT_PRIOR_MATCHES));
    return (Math.max(0, finite(total, 0)) + (prior * strength)) / Math.max(1, n + strength);
}

function getVenueProfile(state = {}, venue = 'all', leaguePrior = {}) {
    const homePrior = Math.max(0.2, finite(leaguePrior.homeGoalsPerMatch, 1.45));
    const awayPrior = Math.max(0.2, finite(leaguePrior.awayGoalsPerMatch, 1.15));
    if (venue === 'home') {
        return {
            sample: state.homeMatches || 0,
            attackRate: posteriorRate(state.homeGoalsFor, state.homeMatches, homePrior),
            concededRate: posteriorRate(state.homeGoalsAgainst, state.homeMatches, awayPrior),
            attackPrior: homePrior,
            concededPrior: awayPrior
        };
    }
    if (venue === 'away') {
        return {
            sample: state.awayMatches || 0,
            attackRate: posteriorRate(state.awayGoalsFor, state.awayMatches, awayPrior),
            concededRate: posteriorRate(state.awayGoalsAgainst, state.awayMatches, homePrior),
            attackPrior: awayPrior,
            concededPrior: homePrior
        };
    }
    const neutralPrior = (homePrior + awayPrior) / 2;
    return {
        sample: state.matches || 0,
        attackRate: posteriorRate(state.goalsFor, state.matches, neutralPrior),
        concededRate: posteriorRate(state.goalsAgainst, state.matches, neutralPrior),
        attackPrior: neutralPrior,
        concededPrior: neutralPrior
    };
}

function updateState(state, venue, goalsFor, goalsAgainst) {
    state.matches += 1;
    state.goalsFor += goalsFor;
    state.goalsAgainst += goalsAgainst;
    if (venue === 'home') {
        state.homeMatches += 1;
        state.homeGoalsFor += goalsFor;
        state.homeGoalsAgainst += goalsAgainst;
    } else {
        state.awayMatches += 1;
        state.awayGoalsFor += goalsFor;
        state.awayGoalsAgainst += goalsAgainst;
    }
}

function buildEvidenceIndex(index = {}) {
    if (evidenceCache.has(index)) return evidenceCache.get(index);
    const states = new Map();
    const aggregate = { matches: 0, homeGoals: 0, awayGoals: 0 };
    const byTeam = new Map();
    const matches = Array.isArray(index.matches) ? [...index.matches].sort((a, b) => a.date - b.date) : [];

    function push(team, evidence) {
        if (!byTeam.has(team)) byTeam.set(team, []);
        byTeam.get(team).push(evidence);
    }

    for (const match of matches) {
        const homeGoals = Math.max(0, finite(match.homeGoals, 0));
        const awayGoals = Math.max(0, finite(match.awayGoals, 0));
        const leaguePrior = calculateRollingLeaguePrior(aggregate);
        const homeState = getTeamState(states, match.home);
        const awayState = getTeamState(states, match.away);
        const homeProfile = getVenueProfile(homeState, 'home', leaguePrior);
        const awayProfile = getVenueProfile(awayState, 'away', leaguePrior);

        const awayAttackStrength = clamp(awayProfile.attackRate / awayProfile.attackPrior, 0.72, 1.38);
        const awayDefenseWeakness = clamp(awayProfile.concededRate / awayProfile.concededPrior, 0.72, 1.38);
        const homeAttackStrength = clamp(homeProfile.attackRate / homeProfile.attackPrior, 0.72, 1.38);
        const homeDefenseWeakness = clamp(homeProfile.concededRate / homeProfile.concededPrior, 0.72, 1.38);

        push(match.home, {
            date: match.date,
            dateIso: match.dateIso,
            venue: 'home',
            opponent: match.away,
            goalsFor: homeGoals,
            goalsAgainst: awayGoals,
            opponentPreMatchSample: awayProfile.sample,
            opponentAttackStrength: awayAttackStrength,
            opponentDefenseWeakness: awayDefenseWeakness,
            attackObservation: clamp((homeGoals / awayDefenseWeakness) / leaguePrior.homeGoalsPerMatch, 0.20, 3.00),
            defenseObservation: clamp((awayGoals / awayAttackStrength) / leaguePrior.awayGoalsPerMatch, 0.20, 3.00),
            points: homeGoals > awayGoals ? 3 : (homeGoals === awayGoals ? 1 : 0),
            leagueHomePrior: leaguePrior.homeGoalsPerMatch,
            leagueAwayPrior: leaguePrior.awayGoalsPerMatch,
            evidenceWeight: clamp(match.evidenceWeight ?? 1, 0.25, 1),
            sourceCode: match.sourceCode || index.code || null,
            sourceTierDelta: Math.max(0, finite(match.sourceTierDelta, 0)),
            promotedEvidence: Boolean(match.promotedEvidence || finite(match.sourceTierDelta, 0) > 0)
        });
        push(match.away, {
            date: match.date,
            dateIso: match.dateIso,
            venue: 'away',
            opponent: match.home,
            goalsFor: awayGoals,
            goalsAgainst: homeGoals,
            opponentPreMatchSample: homeProfile.sample,
            opponentAttackStrength: homeAttackStrength,
            opponentDefenseWeakness: homeDefenseWeakness,
            attackObservation: clamp((awayGoals / homeDefenseWeakness) / leaguePrior.awayGoalsPerMatch, 0.20, 3.00),
            defenseObservation: clamp((homeGoals / homeAttackStrength) / leaguePrior.homeGoalsPerMatch, 0.20, 3.00),
            points: awayGoals > homeGoals ? 3 : (awayGoals === homeGoals ? 1 : 0),
            leagueHomePrior: leaguePrior.homeGoalsPerMatch,
            leagueAwayPrior: leaguePrior.awayGoalsPerMatch,
            evidenceWeight: clamp(match.evidenceWeight ?? 1, 0.25, 1),
            sourceCode: match.sourceCode || index.code || null,
            sourceTierDelta: Math.max(0, finite(match.sourceTierDelta, 0)),
            promotedEvidence: Boolean(match.promotedEvidence || finite(match.sourceTierDelta, 0) > 0)
        });

        updateState(homeState, 'home', homeGoals, awayGoals);
        updateState(awayState, 'away', awayGoals, homeGoals);
        if (!index.primaryCode || !match.sourceCode || match.sourceCode === index.primaryCode || finite(match.sourceTierDelta, 0) === 0) {
            aggregate.matches += 1;
            aggregate.homeGoals += homeGoals;
            aggregate.awayGoals += awayGoals;
        }
    }

    const built = { version: CALCIO_OPPONENT_ADJUSTED_FORM_VERSION, byTeam, matches: matches.length };
    evidenceCache.set(index, built);
    return built;
}

function calculateLeaguePriorAtCutoff(index = {}, cutoff = new Date()) {
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const allMatches = (Array.isArray(index.matches) ? index.matches : []).filter(match => match.date < cutoffDate);
    const primaryMatches = allMatches.filter(match => !index.primaryCode || !match.sourceCode || match.sourceCode === index.primaryCode || finite(match.sourceTierDelta, 0) === 0);
    const matches = primaryMatches.length ? primaryMatches : allMatches;
    const aggregate = matches.reduce((acc, match) => {
        acc.matches += 1;
        acc.homeGoals += Math.max(0, finite(match.homeGoals, 0));
        acc.awayGoals += Math.max(0, finite(match.awayGoals, 0));
        return acc;
    }, { matches: 0, homeGoals: 0, awayGoals: 0 });
    const rolling = calculateRollingLeaguePrior(aggregate);
    return {
        sampleMatches: matches.length,
        homeGoalsPerMatch: round(rolling.homeGoalsPerMatch),
        awayGoalsPerMatch: round(rolling.awayGoalsPerMatch),
        totalGoalsPerMatch: round(rolling.homeGoalsPerMatch + rolling.awayGoalsPerMatch)
    };
}

function summarizeTeamForm(index = {}, requestedTeam = '', cutoff = new Date(), options = {}) {
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const resolution = entityResolution.resolveTeamName(requestedTeam, index.teams || [], { threshold: 0.82 });
    const window = Math.max(3, Math.min(20, finite(options.window, DEFAULT_FORM_WINDOW)));
    const priorMatches = Math.max(2, Math.min(12, finite(options.priorMatches, DEFAULT_PRIOR_MATCHES)));
    const recencyDecay = clamp(options.recencyDecay ?? DEFAULT_RECENCY_DECAY, 0.70, 0.98);

    if (!resolution.matched) {
        return {
            version: CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
            requestedTeam,
            resolvedTeam: null,
            matched: false,
            resolution,
            sample: 0,
            attackIndex: 1,
            defenseWeaknessIndex: 1,
            strengthOfSchedule: 1,
            posteriorPriorWeight: priorMatches,
            status: 'UNMATCHED'
        };
    }

    const evidence = buildEvidenceIndex(index);
    const all = (evidence.byTeam.get(resolution.resolved) || []).filter(item => item.date < cutoffDate);
    const selected = all.slice(-window);
    let weight = 1;
    let weightTotal = 0;
    let attackWeighted = 0;
    let defenseWeighted = 0;
    let scheduleWeighted = 0;
    let pointsWeighted = 0;
    let promotedWeight = 0;
    const sourceCodes = new Set();
    for (let i = selected.length - 1; i >= 0; i--) {
        const item = selected[i];
        const evidenceWeight = clamp(item.evidenceWeight ?? 1, 0.25, 1);
        const effectiveWeight = weight * evidenceWeight;
        attackWeighted += item.attackObservation * effectiveWeight;
        defenseWeighted += item.defenseObservation * effectiveWeight;
        scheduleWeighted += Math.sqrt(item.opponentAttackStrength * item.opponentDefenseWeakness) * effectiveWeight;
        pointsWeighted += item.points * effectiveWeight;
        weightTotal += effectiveWeight;
        if (item.promotedEvidence || finite(item.sourceTierDelta, 0) > 0) promotedWeight += effectiveWeight;
        if (item.sourceCode) sourceCodes.add(item.sourceCode);
        weight *= recencyDecay;
    }

    const sample = selected.length;
    const rawAttackIndex = weightTotal > 0 ? attackWeighted / weightTotal : 1;
    const rawDefenseWeakness = weightTotal > 0 ? defenseWeighted / weightTotal : 1;
    const posteriorAttackIndex = ((rawAttackIndex * sample) + priorMatches) / (sample + priorMatches);
    const posteriorDefenseWeakness = ((rawDefenseWeakness * sample) + priorMatches) / (sample + priorMatches);
    const strengthOfSchedule = weightTotal > 0 ? scheduleWeighted / weightTotal : 1;
    const weightedPpg = weightTotal > 0 ? pointsWeighted / weightTotal : null;
    const promotedEvidenceShare = weightTotal > 0 ? promotedWeight / weightTotal : 0;
    const status = sample === 0
        ? 'PRIOR_ONLY'
        : promotedEvidenceShare > 0.25
            ? 'PROMOTED_TEAM_PRIOR'
            : (sample < priorMatches ? 'EARLY_SEASON' : (sample < window ? 'PARTIAL' : 'MATURE'));

    return {
        version: CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
        requestedTeam,
        resolvedTeam: resolution.resolved,
        matched: true,
        resolution,
        cutoffAt: cutoffDate.toISOString(),
        sample,
        totalHistoricalSample: all.length,
        window,
        priorMatches,
        recencyDecay,
        rawAttackIndex: round(rawAttackIndex),
        rawDefenseWeaknessIndex: round(rawDefenseWeakness),
        attackIndex: round(clamp(posteriorAttackIndex, 0.72, 1.38)),
        defenseWeaknessIndex: round(clamp(posteriorDefenseWeakness, 0.72, 1.38)),
        strengthOfSchedule: round(clamp(strengthOfSchedule, 0.72, 1.38)),
        weightedPointsPerMatch: round(weightedPpg),
        posteriorPriorWeight: priorMatches,
        status,
        evidenceWeightTotal: round(weightTotal),
        promotedEvidenceShare: round(promotedEvidenceShare),
        sourceCodes: [...sourceCodes],
        sourceTierDelta: promotedEvidenceShare > 0.25 ? 1 : 0,
        firstEvidenceAt: selected.length ? selected[0].dateIso : null,
        lastEvidenceAt: selected.length ? selected[selected.length - 1].dateIso : null
    };
}

function buildMatchAdjustment(index = {}, homeTeam = '', awayTeam = '', cutoff = new Date(), options = {}) {
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const cacheKey = [
        index.revisionToken || 'no-revision',
        homeTeam,
        awayTeam,
        Number.isNaN(cutoffDate.getTime()) ? 'invalid' : cutoffDate.toISOString(),
        options.window || DEFAULT_FORM_WINDOW,
        options.priorMatches || DEFAULT_PRIOR_MATCHES,
        options.recencyDecay ?? DEFAULT_RECENCY_DECAY,
        options.adjustmentCap ?? DEFAULT_ADJUSTMENT_CAP,
        options.evidenceBlend ?? DEFAULT_EVIDENCE_BLEND
    ].join('|');
    if (matchupCache.has(cacheKey)) return matchupCache.get(cacheKey);

    const leaguePrior = calculateLeaguePriorAtCutoff(index, cutoffDate);
    const home = summarizeTeamForm(index, homeTeam, cutoffDate, options);
    const away = summarizeTeamForm(index, awayTeam, cutoffDate, options);
    const bothMatched = home.matched && away.matched;
    const minSample = Math.min(home.sample || 0, away.sample || 0);
    const priorMatches = Math.max(home.priorMatches || DEFAULT_PRIOR_MATCHES, away.priorMatches || DEFAULT_PRIOR_MATCHES);
    const sampleAuthority = minSample <= 0 ? 0 : minSample / (minSample + priorMatches);
    const evidenceBlend = clamp(options.evidenceBlend ?? DEFAULT_EVIDENCE_BLEND, 0.25, 0.85);
    const promotedTeamPrior = home.status === 'PROMOTED_TEAM_PRIOR' || away.status === 'PROMOTED_TEAM_PRIOR';
    const promotedAuthorityMultiplier = promotedTeamPrior ? 0.55 : 1;
    const authority = bothMatched ? clamp(sampleAuthority * evidenceBlend * promotedAuthorityMultiplier, 0, promotedTeamPrior ? 0.38 : 0.65) : 0;
    const rawHomeFactor = Math.sqrt((home.attackIndex || 1) * (away.defenseWeaknessIndex || 1));
    const rawAwayFactor = Math.sqrt((away.attackIndex || 1) * (home.defenseWeaknessIndex || 1));
    const requestedCap = clamp(options.adjustmentCap ?? DEFAULT_ADJUSTMENT_CAP, 0.02, 0.12);
    const cap = promotedTeamPrior ? Math.min(requestedCap, 0.04) : requestedCap;
    const homeFactor = clamp(1 + ((rawHomeFactor - 1) * authority), 1 - cap, 1 + cap);
    const awayFactor = clamp(1 + ((rawAwayFactor - 1) * authority), 1 - cap, 1 + cap);
    const applied = bothMatched && minSample > 0 && (Math.abs(homeFactor - 1) > 0.0005 || Math.abs(awayFactor - 1) > 0.0005);
    const status = !bothMatched
        ? 'UNAVAILABLE'
        : (minSample === 0
            ? 'PRIOR_ONLY'
            : (promotedTeamPrior
                ? 'PROMOTED_TEAM_PRIOR'
                : (minSample < priorMatches ? 'EARLY_SEASON' : (minSample < DEFAULT_FORM_WINDOW ? 'PARTIAL' : 'MATURE'))));
    const confidence = bothMatched ? Math.round(clamp(sampleAuthority * 100 * promotedAuthorityMultiplier, 0, promotedTeamPrior ? 68 : 100)) : 0;

    const result = {
        version: CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
        cutoffAt: cutoffDate.toISOString(),
        leagueName: index.leagueName || null,
        code: index.code || null,
        revisionToken: index.revisionToken || null,
        status,
        applied,
        authority: round(authority),
        confidence,
        promotedTeamPrior,
        promotedAuthorityMultiplier,
        minSample,
        earlySeasonPriorMatches: priorMatches,
        formWindow: options.window || DEFAULT_FORM_WINDOW,
        adjustmentCapPct: round(cap * 100, 2),
        homeFactor: round(homeFactor),
        awayFactor: round(awayFactor),
        homeAdjustmentPct: round((homeFactor - 1) * 100, 2),
        awayAdjustmentPct: round((awayFactor - 1) * 100, 2),
        leaguePrior,
        home,
        away,
        safeguards: {
            asOfSafe: true,
            futureRowsExcluded: true,
            opponentRatingsUsePreMatchRowsOnly: true,
            bayesianEarlySeasonShrink: true,
            promotedTeamPriorShrunk: promotedTeamPrior,
            crossDivisionEvidenceWeighted: true,
            deterministic: true,
            maximumAbsoluteAdjustmentPct: round(cap * 100, 2)
        }
    };
    matchupCache.set(cacheKey, result);
    if (matchupCache.size > 512) matchupCache.delete(matchupCache.keys().next().value);
    return result;
}

function applyToExpectedGoals(homeExpectedGoals, awayExpectedGoals, adjustment = {}) {
    const homeBase = Math.max(0.05, finite(homeExpectedGoals, 1.35));
    const awayBase = Math.max(0.05, finite(awayExpectedGoals, 1.10));
    const homeFactor = clamp(adjustment.homeFactor ?? 1, 0.88, 1.12);
    const awayFactor = clamp(adjustment.awayFactor ?? 1, 0.88, 1.12);
    return {
        expHomeGoals: round(homeBase * homeFactor),
        expAwayGoals: round(awayBase * awayFactor),
        baseHomeGoals: round(homeBase),
        baseAwayGoals: round(awayBase),
        homeFactor: round(homeFactor),
        awayFactor: round(awayFactor),
        applied: Boolean(adjustment.applied),
        status: adjustment.status || 'UNAVAILABLE',
        version: CALCIO_OPPONENT_ADJUSTED_FORM_VERSION
    };
}

module.exports = {
    CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
    DEFAULT_PRIOR_MATCHES,
    DEFAULT_FORM_WINDOW,
    DEFAULT_RECENCY_DECAY,
    DEFAULT_ADJUSTMENT_CAP,
    buildEvidenceIndex,
    calculateLeaguePriorAtCutoff,
    summarizeTeamForm,
    buildMatchAdjustment,
    applyToExpectedGoals,
    _evidenceCache: evidenceCache,
    _matchupCache: matchupCache
};
