'use strict';

const CALCIO_PROGRAM_COHERENCE_VERSION = 'BETTINGAPP_R13_EVIDENCE_RISK_SEPARATION_20261108';

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, finite(value, min))); }
function round(value, decimals = 1) {
    const f = 10 ** decimals;
    return Math.round((finite(value, 0) + Number.EPSILON) * f) / f;
}
function labelFromScore(score) {
    const n = finite(score, 0);
    if (n >= 85) return 'ALTA';
    if (n >= 70) return 'BUONA';
    if (n >= 55) return 'MEDIA';
    if (n >= 40) return 'BASSA';
    return 'MOLTO_BASSA';
}
function coverageBase(mode = '') {
    return ({
        STRONG_REAL_XG: 90,
        HISTORY_PROXY_STRONG: 72,
        HISTORY_PROXY: 58,
        HISTORY_THIN: 43,
        PRIOR_ONLY: 28
    })[String(mode || '').toUpperCase()] ?? 38;
}

function buildPredictionReliability({ integrity = {}, market = '', professionalAudit = {}, sourceAudit = {}, historicalEvidence = null, multiProviderEvidence = null } = {}) {
    const selected = integrity?.diagnostics?.[market] || {};
    const disagreement = finite(selected.disagreementPp, integrity.maxDisagreementPp || 18);
    const mcError = finite(selected.monteCarloStdErrorPp, integrity.maxMonteCarloStdErrorPp || 1.5);
    const sourceCoverage = finite(sourceAudit.coveragePct, 50);
    const sourceImpact = finite(sourceAudit.matchImpactConfidence, sourceAudit.sourceMatchImpactConfidence || 0);
    const teamConfidence = finite(professionalAudit?.teamMatching?.confidence, 50);
    const dataScore = finite(professionalAudit?.dataReliability?.score, 50);
    const professionalRisk = finite(professionalAudit?.risk, 35);
    const resolved = finite(historicalEvidence?.resolved, 0);
    const historyReliability = String(historicalEvidence?.reliability || '').toUpperCase();

    // R13: the market disagreement is already penalised independently by
    // CrossMarketReliability (EV shrinkage, uncertainty and stake caps).
    // Reapplying the full 28-point penalty here and again via IPM/DeepScan
    // creates a circular NO_STAKE even if historical coverage is adequate.
    // Keep a smaller diagnostic penalty here; NEVER change R9 robust EV.
    const dataDetail = professionalAudit?.dataReliability || {};
    const homeMatches = finite(dataDetail.homeMatches, 0);
    const awayMatches = finite(dataDetail.awayMatches, 0);
    const historicalDocumented = dataDetail.footballDataLoaded === true
        && professionalAudit?.teamMatching?.status === 'MATCH_OK'
        && homeMatches >= 8 && awayMatches >= 8;
    const declaredCoverage = String(integrity.coverageMode || '').toUpperCase();
    const effectiveCoverage = historicalDocumented && ['HISTORY_THIN','HISTORY_PROXY'].includes(declaredCoverage)
        ? 'HISTORY_PROXY_STRONG' : declaredCoverage;
    // 8/8 actual recorded results permit the historical tier, NOT REAL XG.
    // Unverifiable counts cannot improve the tier.
    const independentDisagreementPenalty = Math.min(9, Math.max(0, disagreement) * 0.45);
    let score = coverageBase(effectiveCoverage);
    score -= independentDisagreementPenalty;
    score -= Math.max(0, mcError - 0.35) * 5;
    // News are qualitative: a dozen articles cannot simulate independent
    // quantitative evidence. Their influence on the SCORE is capped.
    score += Math.max(-3, Math.min(3, (sourceCoverage - 50) * 0.06));
    score += Math.min(2, sourceImpact * 0.025);
    score += (teamConfidence - 70) * 0.08;
    score += (dataScore - 65) * 0.10;
    score -= Math.max(0, professionalRisk - 25) * 0.18;
    if (resolved >= 30 && historyReliability === 'HIGH') score += 4;
    else if (resolved >= 10 && ['MEDIUM', 'HIGH'].includes(historyReliability)) score += 2;
    // n=0 is UNKNOWN, not an empirically observed losing strategy.
    const providerStatus = String(multiProviderEvidence?.status || '').toUpperCase();
    const quantitativeProviders = finite(multiProviderEvidence?.quantitativeProviders, 0);
    const authoritativeQuantitativeProviders = finite(multiProviderEvidence?.authoritativeQuantitativeProviders, quantitativeProviders);
    // Patch 14: only three distinct authoritative quantitative families can contribute.
    // Raw/retrieval-path counts and qualitative news never raise the score.
    if (providerStatus === 'MULTI_PROVIDER_STRONG' && authoritativeQuantitativeProviders >= 3) score += 3;
    else if (providerStatus === 'MULTI_PROVIDER_FRAGILE') score -= 4;
    // Patch 13: ALTA requires independent high-authority quantitative evidence.
    // A strong proxy can be useful, but must not be presented as top-tier certainty.
    const coverageMode = String(integrity.coverageMode || '').toUpperCase();
    const hasHighAuthority = coverageMode === 'STRONG_REAL_XG' || (authoritativeQuantitativeProviders >= 3 && providerStatus === 'MULTI_PROVIDER_STRONG');
    if (!hasHighAuthority) score = Math.min(score, 79);
    score = clamp(score, 0, 100);

    const label = labelFromScore(score);
    const legacy = score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : score >= 42 ? 'LOW' : 'VERY_LOW';
    const factors = {
        coverageMode: integrity.coverageMode || 'UNKNOWN',
        effectiveCoverageMode: effectiveCoverage,
        historicalDocumented,
        verifiedHomeMatches: historicalDocumented ? homeMatches : null,
        verifiedAwayMatches: historicalDocumented ? awayMatches : null,
        disagreementPenaltyOnce: round(independentDisagreementPenalty,2),
        r13Note: 'Disagreement affects model confidence once; robust EV and Authority remain independent',
        selectedMarket: market || null,
        selectedMarketDisagreementPp: round(disagreement, 2),
        monteCarloStdErrorPp: round(mcError, 2),
        sourceCoveragePct: round(sourceCoverage, 1),
        sourceMatchImpactPct: round(sourceImpact, 1),
        teamMatchConfidencePct: round(teamConfidence, 1),
        dataReliabilityScore: round(dataScore, 1),
        professionalRisk: round(professionalRisk, 1),
        historicalResolved: resolved,
        multiProviderStatus: providerStatus || 'UNKNOWN',
        quantitativeProviders,
        authoritativeQuantitativeProviders
    };
    return {
        version: CALCIO_PROGRAM_COHERENCE_VERSION,
        score: round(score, 1),
        label,
        legacyLabel: legacy,
        factors,
        evidenceAuthority: hasHighAuthority ? 'HIGH_AUTHORITY' : 'PROXY_OR_PARTIAL',
        canReachHigh: hasHighAuthority,
        note: 'R13: campione verificato separato da xG/news; disaccordo scontato una sola volta nel punteggio; R9 conserva il veto EV robusto. Non e una probabilita calibrata.'
    };
}


function mergePersistedPredictionReliability(computed = {}, persistedRow = {}, options = {}) {
    const evidenceComplete = options.evidenceComplete === true;
    if (evidenceComplete) return { ...computed, contextMode: 'LIVE_COMPLETE_EVIDENCE' };
    const storedScore = finite(
        persistedRow.calcio_prediction_reliability_score
        ?? persistedRow.prediction_reliability_score
        ?? persistedRow.quality_final_score,
        0
    );
    if (storedScore <= 0) return { ...computed, contextMode: 'LIVE_PARTIAL_NO_PERSISTED_EVIDENCE' };
    const storedLabel = String(
        persistedRow.calcio_prediction_reliability_label
        || persistedRow.prediction_reliability_label
        || labelFromScore(storedScore)
    ).toUpperCase();
    const legacyLabel = storedScore >= 80 ? 'HIGH' : storedScore >= 60 ? 'MEDIUM' : storedScore >= 42 ? 'LOW' : 'VERY_LOW';
    return {
        ...computed,
        score: round(storedScore, 1),
        label: storedLabel,
        legacyLabel,
        factors: {
            ...(computed.factors || {}),
            persistedCertifiedScore: round(storedScore, 1),
            evidenceContextMissingFromRequest: true
        },
        contextMode: 'PERSISTED_CERTIFIED_ANALYSIS_EVIDENCE_REUSED',
        note: 'Il DeepScan non ha ricevuto l’intero snapshot quantitativo dell’analisi: riusa il punteggio certificato persistito invece di degradarlo per campi assenti.'
    };
}

function thresholdReason({ odd, maxOdd, probability, requiredProbability, edge, requiredEdge, crPassed = true, theoreticalStake = 0 } = {}) {
    const reasons = [];
    if (finite(odd, 0) < 1.5) reasons.push('quota sotto il minimo operativo 1.50');
    if (Number.isFinite(Number(maxOdd)) && finite(odd, 0) > finite(maxOdd, 0)) reasons.push(`quota oltre il limite ${finite(maxOdd, 0).toFixed(2)}`);
    if (finite(probability, 0) <= finite(requiredProbability, 0)) reasons.push(`probabilità sotto soglia ${finite(requiredProbability, 0).toFixed(1)}%`);
    if (finite(edge, 0) <= finite(requiredEdge, 0)) reasons.push(`edge sotto soglia ${finite(requiredEdge, 0).toFixed(1)} pp`);
    if (finite(edge, 0) > 15) reasons.push('edge oltre il guardrail massimo 15 pp');
    if (!crPassed) reasons.push('cross-reference non superato');
    if (!reasons.length && finite(theoreticalStake, 0) <= 0) reasons.push('stake Kelly/reliability pari a zero');
    return reasons;
}

function buildAnalysisStage({ candidate = {}, thresholds = {}, deepScan = null } = {}) {
    const theoreticalStake = finite(candidate.stake_theoretical ?? candidate.theoreticalStake, 0);
    const operationalStake = finite(candidate.invested ?? candidate.operationalStake, 0);
    const edge = finite(candidate.edge_pp ?? candidate.edge, 0);
    const valueSignal = edge > 0;
    const eligibilityReasons = thresholdReason({
        odd: candidate.odd,
        maxOdd: thresholds.maxOdd,
        probability: candidate.estimatedProb ?? candidate.estimated_prob,
        requiredProbability: thresholds.requiredProbability,
        edge,
        requiredEdge: thresholds.requiredEdge,
        crPassed: thresholds.crPassed !== false,
        theoreticalStake
    });
    let code = 'NO_VALUE_SIGNAL';
    let label = 'NESSUN VALUE';
    if (valueSignal && theoreticalStake <= 0) {
        code = 'VALUE_NON_OPERATIVO';
        label = 'VALUE QUALITATIVO · NON OPERATIVO';
    } else if (theoreticalStake > 0 && operationalStake <= 0) {
        code = 'THEORETICAL_ONLY';
        label = 'VALUE · RIESAME OPERATIVO';
    } else if (operationalStake > 0) {
        code = 'OPERATIONAL_VALUE';
        label = 'VIA LIBERA OPERATIVA';
    }
    if (deepScan?.riskLevel === 'ALTO_RISCHIO' || deepScan?.isHighRisk) {
        code = 'DEEPSCAN_BLOCKED';
        label = 'BLOCCATO DA DEEPSCAN';
    }
    return {
        version: CALCIO_PROGRAM_COHERENCE_VERSION,
        code,
        label,
        valueSignal,
        theoreticalEligible: theoreticalStake > 0,
        operationalEligible: operationalStake > 0,
        theoreticalStake: round(theoreticalStake, 2),
        operationalStake: round(operationalStake, 2),
        reasons: eligibilityReasons,
        summary: eligibilityReasons.length ? eligibilityReasons.join(' · ') : 'Soglie quantitative e gate operativi coerenti.'
    };
}

function buildBacktestHealth({ rowsParsed = 0, eligibleMatches = 0, leagueCount = 0, historicalOdds = true, chronological = true, asOfSafe = true, productionParity = true } = {}) {
    const warnings = [];
    if (!historicalOdds) warnings.push('Quote storiche non complete: il ROI non deve essere presentato come ROI reale.');
    if (!chronological) warnings.push('Ordine cronologico non certificato.');
    if (!asOfSafe) warnings.push('Cutoff as-of non certificato.');
    if (!productionParity) warnings.push('Parità con il motore production non certificata.');
    return {
        version: CALCIO_PROGRAM_COHERENCE_VERSION,
        status: warnings.length ? 'VALID_WITH_WARNINGS' : 'VALID',
        rowsParsed: finite(rowsParsed, 0),
        eligibleMatches: finite(eligibleMatches, 0),
        leagueCount: finite(leagueCount, 0),
        chronological,
        asOfSafe,
        productionParity,
        historicalOdds,
        validationMode: historicalOdds ? 'MODEL_AND_HISTORICAL_ODDS_VALIDATION' : 'MODEL_VALIDATION_ONLY',
        warnings
    };
}

module.exports = {
    CALCIO_PROGRAM_COHERENCE_VERSION,
    buildPredictionReliability,
    mergePersistedPredictionReliability,
    buildAnalysisStage,
    buildBacktestHealth,
    labelFromScore,
    thresholdReason
};
