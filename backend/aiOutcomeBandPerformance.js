'use strict';

const AI_OUTCOME_BAND_PERFORMANCE_VERSION = 'BETTING_PATCH_26F_F_AI_OUTCOME_BANDS_V1';
const AI_OUTCOME_BAND_POLICY_VERSION = 'BETTING_PATCH_26F_F_PERSISTED_SELECTION_PROBABILITY_POLICY_V1';

const BAND_DEFINITIONS = Object.freeze([
    Object.freeze({ key: '10_20', min: 10, max: 20, label: '10–20%' }),
    Object.freeze({ key: '20_30', min: 20, max: 30, label: '20–30%' }),
    Object.freeze({ key: '30_40', min: 30, max: 40, label: '30–40%' }),
    Object.freeze({ key: '40_50', min: 40, max: 50, label: '40–50%' }),
    Object.freeze({ key: '50_60', min: 50, max: 60, label: '50–60%' }),
    Object.freeze({ key: '60_70', min: 60, max: 70, label: '60–70%' }),
    Object.freeze({ key: '70_80', min: 70, max: 80, label: '70–80%' }),
    Object.freeze({ key: '80_90', min: 80, max: 90, label: '80–90%' }),
    Object.freeze({ key: '90_100', min: 90, max: 100.000001, label: '90–100%' })
]);

function safeText(value) {
    return String(value == null ? '' : value).trim();
}

function safeNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeSport(value) {
    const sport = safeText(value).toUpperCase();
    if (sport === 'FOOTBALL') return 'CALCIO';
    return sport === 'TENNIS' ? 'TENNIS' : 'CALCIO';
}

function inferSport(row = {}) {
    const explicit = safeText(row.sport_type).toUpperCase();
    if (explicit === 'TENNIS') return 'TENNIS';
    if (explicit === 'CALCIO' || explicit === 'FOOTBALL') return 'CALCIO';
    const text = [row.bet_type, row.strategy_tag, row.tour_type, row.league]
        .map(value => safeText(value).toUpperCase())
        .join(' ');
    return text.includes('TENNIS') || text.includes('[ATP]') || text.includes('[WTA]') ? 'TENNIS' : 'CALCIO';
}

function normalizeProbability(value) {
    let probability = safeNumber(value, null);
    if (probability == null) return null;
    if (probability > 0 && probability <= 1) probability *= 100;
    if (probability < 0 || probability > 100) return null;
    return probability;
}

function getBand(probability) {
    return BAND_DEFINITIONS.find(band => probability >= band.min && probability < band.max) || null;
}

function normalizeCompetitionLabel(row = {}, sport = inferSport(row)) {
    if (sport === 'TENNIS') {
        const league = safeText(row.league);
        if (league) return league.replace(/\s+/g, ' ');
        const tour = safeText(row.tour_type).toUpperCase();
        const category = safeText(row.tournament_category || row.tournament_level);
        if (tour || category) return [tour, category].filter(Boolean).join(' · ');
        return safeText(row.tournament_name) || 'Tennis · Altro';
    }
    return safeText(row.league || row.tournament_name) || 'Calcio · Altro';
}

function isResolvedOutcome(row = {}) {
    const status = safeText(row.status).toUpperCase();
    return status === 'WON' || status === 'LOST';
}

function isActiveNonConflicting(row = {}) {
    const active = row.paper_result_active == null ? 1 : safeNumber(row.paper_result_active, 0);
    const conflict = safeNumber(row.paper_result_conflict, 0);
    return active === 1 && conflict === 0;
}

function isSingle(row = {}) {
    return !safeText(row.bet_type).toUpperCase().includes('MULTI');
}

function isCertifiedQuality(row = {}) {
    const quality = safeText(row.data_quality).toUpperCase();
    return ['CURRENT', 'CURRENT_BOOTSTRAP', 'VERIFIED_CURRENT'].includes(quality);
}

function wilsonInterval(wins, total, z = 1.959963984540054) {
    if (!total) return { lowPct: null, highPct: null };
    const p = wins / total;
    const denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
    return {
        lowPct: Math.max(0, (center - margin) * 100),
        highPct: Math.min(100, (center + margin) * 100)
    };
}

function sampleReliability(total) {
    if (total >= 100) return 'ALTA';
    if (total >= 30) return 'BUONA';
    if (total >= 15) return 'MEDIA';
    if (total >= 5) return 'BASSA';
    if (total > 0) return 'MOLTO_BASSA';
    return 'NESSUN_CAMPIONE';
}

function createAccumulator(band) {
    return {
        key: band.key,
        label: band.label,
        minPct: band.min,
        maxPct: band.max > 100 ? 100 : band.max,
        resolved: 0,
        won: 0,
        lost: 0,
        probabilitySum: 0,
        certifiedRows: 0,
        legacyRows: 0,
        realStakeRows: 0
    };
}

function finalizeAccumulator(accumulator) {
    const resolved = accumulator.resolved;
    const winRatePct = resolved > 0 ? (accumulator.won / resolved) * 100 : null;
    const lossRatePct = resolved > 0 ? (accumulator.lost / resolved) * 100 : null;
    const averageAiProbabilityPct = resolved > 0 ? accumulator.probabilitySum / resolved : null;
    const interval = wilsonInterval(accumulator.won, resolved);
    return {
        ...accumulator,
        winRatePct,
        lossRatePct,
        averageAiProbabilityPct,
        calibrationGapPp: winRatePct == null || averageAiProbabilityPct == null
            ? null
            : winRatePct - averageAiProbabilityPct,
        certifiedCoveragePct: resolved > 0 ? (accumulator.certifiedRows / resolved) * 100 : null,
        reliability: sampleReliability(resolved),
        ciLowPct: interval.lowPct,
        ciHighPct: interval.highPct
    };
}

function aggregateRows(rows = []) {
    const bandMap = new Map(BAND_DEFINITIONS.map(band => [band.key, createAccumulator(band)]));
    let excludedMissingProbability = 0;
    let excludedOutsideRequestedBands = 0;
    let resolved = 0;
    let won = 0;
    let lost = 0;
    let probabilitySum = 0;
    let certifiedRows = 0;
    let legacyRows = 0;
    let realStakeRows = 0;

    rows.forEach(row => {
        const probability = normalizeProbability(row.estimated_prob);
        if (probability == null) {
            excludedMissingProbability += 1;
            return;
        }
        const band = getBand(probability);
        if (!band) {
            excludedOutsideRequestedBands += 1;
            return;
        }
        const status = safeText(row.status).toUpperCase();
        const certified = isCertifiedQuality(row);
        const realStake = safeNumber(row.stake, 0) > 0;
        const target = bandMap.get(band.key);
        target.resolved += 1;
        target.probabilitySum += probability;
        if (status === 'WON') target.won += 1;
        if (status === 'LOST') target.lost += 1;
        if (certified) target.certifiedRows += 1;
        else target.legacyRows += 1;
        if (realStake) target.realStakeRows += 1;

        resolved += 1;
        probabilitySum += probability;
        if (status === 'WON') won += 1;
        if (status === 'LOST') lost += 1;
        if (certified) certifiedRows += 1;
        else legacyRows += 1;
        if (realStake) realStakeRows += 1;
    });

    const winRatePct = resolved > 0 ? (won / resolved) * 100 : null;
    const lossRatePct = resolved > 0 ? (lost / resolved) * 100 : null;
    const averageAiProbabilityPct = resolved > 0 ? probabilitySum / resolved : null;
    const interval = wilsonInterval(won, resolved);

    return {
        summary: {
            resolved,
            won,
            lost,
            winRatePct,
            lossRatePct,
            averageAiProbabilityPct,
            calibrationGapPp: winRatePct == null || averageAiProbabilityPct == null
                ? null
                : winRatePct - averageAiProbabilityPct,
            certifiedRows,
            legacyRows,
            certifiedCoveragePct: resolved > 0 ? (certifiedRows / resolved) * 100 : null,
            realStakeRows,
            reliability: sampleReliability(resolved),
            ciLowPct: interval.lowPct,
            ciHighPct: interval.highPct,
            excludedMissingProbability,
            excludedOutsideRequestedBands
        },
        bands: BAND_DEFINITIONS.map(band => finalizeAccumulator(bandMap.get(band.key)))
    };
}

function prepareRows(rows = [], sport = 'CALCIO', scope = 'AI_SIGNALS') {
    const normalizedSport = normalizeSport(sport);
    const normalizedScope = safeText(scope).toUpperCase() === 'REAL_STAKE' ? 'REAL_STAKE' : 'AI_SIGNALS';
    return rows.filter(row => {
        if (!isResolvedOutcome(row) || !isActiveNonConflicting(row) || !isSingle(row)) return false;
        if (inferSport(row) !== normalizedSport) return false;
        if (normalizedScope === 'REAL_STAKE' && safeNumber(row.stake, 0) <= 0) return false;
        return true;
    });
}

function buildScopeReport(rows = [], sport = 'CALCIO', scope = 'AI_SIGNALS') {
    const prepared = prepareRows(rows, sport, scope);
    const overall = aggregateRows(prepared);
    const competitionMap = new Map();
    prepared.forEach(row => {
        const label = normalizeCompetitionLabel(row, normalizeSport(sport));
        if (!competitionMap.has(label)) competitionMap.set(label, []);
        competitionMap.get(label).push(row);
    });
    const competitions = [...competitionMap.entries()]
        .map(([label, competitionRows]) => ({
            key: label,
            label,
            ...aggregateRows(competitionRows)
        }))
        .sort((a, b) => b.summary.resolved - a.summary.resolved || a.label.localeCompare(b.label, 'it'));
    return {
        scope,
        rowPolicy: scope === 'REAL_STAKE'
            ? 'WON_LOST_SINGLE_ACTIVE_NON_CONFLICTING_STAKE_GT_ZERO'
            : 'WON_LOST_SINGLE_ACTIVE_NON_CONFLICTING_ALL_AI_SIGNALS',
        overall,
        competitions
    };
}

function buildAiOutcomeBandPerformance(rows = [], options = {}) {
    const sport = normalizeSport(options.sport || 'CALCIO');
    return {
        success: true,
        readOnly: true,
        version: AI_OUTCOME_BAND_PERFORMANCE_VERSION,
        policyVersion: AI_OUTCOME_BAND_POLICY_VERSION,
        sport,
        probabilityField: 'estimated_prob',
        probabilityMeaning: 'PROBABILITA_AI_PERSISTITA_PER_LA_SELEZIONE_PRIMA_DEL_MATCH',
        bandPolicy: '10_POINT_FIXED_BANDS_10_TO_100',
        bandDefinitions: BAND_DEFINITIONS.map(band => ({ ...band, max: band.max > 100 ? 100 : band.max })),
        scopes: {
            AI_SIGNALS: buildScopeReport(rows, sport, 'AI_SIGNALS'),
            REAL_STAKE: buildScopeReport(rows, sport, 'REAL_STAKE')
        },
        safeguards: {
            readOnly: true,
            probabilityIsNotReliabilityScore: true,
            tpiExcluded: true,
            modelConfidenceExcluded: true,
            pendingExcluded: true,
            pushVoidExcluded: true,
            multiExcluded: true,
            conflictsExcluded: true,
            probabilityAuthorityChanged: false,
            qualityGateAuthorityChanged: false,
            stakeAuthorityChanged: false,
            settlementAuthorityChanged: false
        }
    };
}

module.exports = {
    AI_OUTCOME_BAND_PERFORMANCE_VERSION,
    AI_OUTCOME_BAND_POLICY_VERSION,
    BAND_DEFINITIONS,
    normalizeProbability,
    normalizeCompetitionLabel,
    inferSport,
    buildAiOutcomeBandPerformance,
    buildScopeReport,
    aggregateRows,
    wilsonInterval
};
