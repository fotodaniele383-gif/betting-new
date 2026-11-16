'use strict';

const CALCIO_DUAL_SCORE_VERSION = 'BETTING_PATCH_26F_C_DUAL_SCORE_ARCHITECTURE_SHADOW_V1';
const CALCIO_DUAL_SCORE_MODE = 'SHADOW_ONLY_NO_DECISION_OR_STAKE_AUTHORITY';

const FCS_WEIGHTS = Object.freeze({
    dataQuality: 0.32,
    modelAgreement: 0.24,
    historicalCoverage: 0.18,
    sourceCoverage: 0.14,
    monteCarloPrecision: 0.12
});
const VALUE_WEIGHTS = Object.freeze({ robustEv: 0.55, robustEdge: 0.30, priceQuality: 0.15 });

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function nullable(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, finite(value, min))); }
function round(value, decimals = 2) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;
}
function upper(value = '') {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function labelScore(score, bands) {
    const n = finite(score, 0);
    for (const [minimum, label] of bands) if (n >= minimum) return label;
    return bands.at(-1)?.[1] || 'N/D';
}

function historicalCoverageScore(audit = {}) {
    const status = upper(audit.status || audit.calcio_historical_coverage_status || '');
    const explicit = nullable(audit.confidence, audit.minConfidence, audit.calcio_historical_coverage_confidence);
    if (explicit !== null) return clamp(explicit, 0, 100);
    if (status.includes('PRIMARY_STRONG') || status.includes('HISTORY_PROXY_STRONG')) return 88;
    if (status.includes('PRIMARY') || status.includes('HISTORY_PROXY')) return 74;
    if (status.includes('PROMOTED')) return 58;
    if (status.includes('THIN')) return 38;
    if (status.includes('PRIOR_ONLY') || status.includes('NO_HISTORY')) return 15;
    return 35;
}

function sourceCoverageScore(input = {}) {
    const sourceConfidence = nullable(
        input.sourceConfidencePct,
        input.sourceIntelligence?.matchImpactConfidence,
        input.report?.sourceIntelligence?.matchImpactConfidence
    );
    if (sourceConfidence !== null) return clamp(sourceConfidence, 0, 100);
    const count = Math.max(0, finite(
        input.oddsCertification?.sourceCount
        ?? input.finalMarketDiagnostic?.oddsCertification?.sourceCount
        ?? input.oddsSourceCount,
        0
    ));
    if (count >= 12) return 92;
    if (count >= 8) return 84;
    if (count >= 5) return 72;
    if (count >= 3) return 58;
    if (count >= 1) return 40;
    return 20;
}

function monteCarloPrecisionScore(stdErrorPp) {
    const se = nullable(stdErrorPp);
    if (se === null) return 45;
    return clamp(100 - Math.max(0, se) * 28, 0, 100);
}

function paperTradingCalibration(input = {}, productionProbabilityPct = null) {
    const evidence = input.historicalEvidence || input.paperTradingEvidence || {};
    const sample = Math.max(0, finite(
        input.historicalSample
        ?? input.ptSample
        ?? evidence.resolved
        ?? evidence.sample,
        0
    ));
    const empiricalProbabilityPct = nullable(
        input.historicalAdjustedRatePct,
        input.historicalWinRatePct,
        input.ptProbabilityPct,
        evidence.adjustedRatePct,
        evidence.winRatePct
    );
    if (sample <= 0 || empiricalProbabilityPct === null || productionProbabilityPct === null) {
        return {
            sample,
            empiricalProbabilityPct,
            confidenceWeight: 0,
            maxArchitectureWeight: 0,
            adjustmentPp: 0,
            status: 'EXCLUDED_NO_SAMPLE_ZERO_WEIGHT',
            contributesToScore: false
        };
    }
    const confidenceWeight = clamp(sample / 50, 0, 1);
    const maxArchitectureWeight = 0.05 * confidenceWeight;
    const adjustmentPp = clamp((empiricalProbabilityPct - productionProbabilityPct) * 0.25 * confidenceWeight, -5, 5);
    return {
        sample,
        empiricalProbabilityPct: round(empiricalProbabilityPct, 2),
        confidenceWeight: round(confidenceWeight, 3),
        maxArchitectureWeight: round(maxArchitectureWeight, 4),
        adjustmentPp: round(adjustmentPp, 3),
        status: sample >= 50 ? 'MATURE_CALIBRATION_ADJUSTMENT' : sample >= 20 ? 'DEVELOPING_CALIBRATION_ADJUSTMENT' : 'LOW_SAMPLE_CALIBRATION_ADJUSTMENT',
        contributesToScore: true
    };
}

function forecastConfidence(input = {}) {
    const diagnostic = input.finalMarketDiagnostic || {};
    const probability = diagnostic.probability || {};
    const dataQuality = input.dataQuality || input.dataQualityAssessment || diagnostic.dataQuality || {};
    const historicalCoverage = input.historicalCoverage || input.historicalCoverageAudit || {};
    const productionProbabilityPct = nullable(
        input.productionProbabilityPct,
        diagnostic.probabilityPct,
        probability.modelProbabilityPct
    );
    const dataQualityScore = clamp(nullable(dataQuality.score, input.dataQualityScore) ?? 0, 0, 100);
    const disagreementPp = Math.abs(nullable(
        input.modelMarketGapPp,
        probability.disagreementPp,
        input.marketConsensusGapPp
    ) ?? 15);
    const modelAgreementScore = clamp(100 - disagreementPp * 7.5, 0, 100);
    const historyScore = historicalCoverageScore(historicalCoverage);
    const sourcesScore = sourceCoverageScore(input);
    const mcScore = monteCarloPrecisionScore(nullable(
        input.monteCarloStdErrorPp,
        probability.monteCarloSamplingErrorPp,
        input.monte_carlo_std_error_pp
    ));
    const base = dataQualityScore * FCS_WEIGHTS.dataQuality
        + modelAgreementScore * FCS_WEIGHTS.modelAgreement
        + historyScore * FCS_WEIGHTS.historicalCoverage
        + sourcesScore * FCS_WEIGHTS.sourceCoverage
        + mcScore * FCS_WEIGHTS.monteCarloPrecision;
    const paperTrading = paperTradingCalibration(input, productionProbabilityPct);
    const score = clamp(base + paperTrading.adjustmentPp, 0, 100);
    return {
        score: round(score, 2),
        label: labelScore(score, [[80, 'HIGH'], [65, 'MEDIUM_HIGH'], [50, 'MEDIUM'], [35, 'LOW'], [0, 'VERY_LOW']]),
        baseScore: round(base, 2),
        components: {
            dataQuality: { score: round(dataQualityScore, 2), weight: FCS_WEIGHTS.dataQuality, contribution: round(dataQualityScore * FCS_WEIGHTS.dataQuality, 2) },
            modelAgreement: { score: round(modelAgreementScore, 2), disagreementPp: round(disagreementPp, 3), weight: FCS_WEIGHTS.modelAgreement, contribution: round(modelAgreementScore * FCS_WEIGHTS.modelAgreement, 2) },
            historicalCoverage: { score: round(historyScore, 2), status: historicalCoverage.status || null, weight: FCS_WEIGHTS.historicalCoverage, contribution: round(historyScore * FCS_WEIGHTS.historicalCoverage, 2) },
            sourceCoverage: { score: round(sourcesScore, 2), weight: FCS_WEIGHTS.sourceCoverage, contribution: round(sourcesScore * FCS_WEIGHTS.sourceCoverage, 2) },
            monteCarloPrecision: { score: round(mcScore, 2), weight: FCS_WEIGHTS.monteCarloPrecision, contribution: round(mcScore * FCS_WEIGHTS.monteCarloPrecision, 2) },
            paperTradingCalibration: paperTrading
        },
        invariants: {
            edgeEvExcluded: true,
            stakeExcluded: true,
            deepScanTaxonomyExcluded: true,
            paperTradingNoSampleWeightZero: paperTrading.sample > 0 || paperTrading.maxArchitectureWeight === 0
        }
    };
}

function priceQuality(input = {}) {
    const certification = input.oddsCertification || input.finalMarketDiagnostic?.oddsCertification || {};
    const count = Math.max(0, finite(certification.sourceCount ?? input.oddsSourceCount, 0));
    const certified = certification.certified === true || certification.operationalEligible === true;
    const outlierPremium = Math.abs(nullable(input.oddsOutlierPremiumPct, certification.selectedPremiumPct) ?? 0);
    let score = certified ? 65 : 30;
    score += Math.min(25, count * 2.5);
    score -= Math.max(0, outlierPremium - 5) * 3;
    return clamp(score, 0, 100);
}

function valueScore(input = {}) {
    const diagnostic = input.finalMarketDiagnostic || {};
    const probability = diagnostic.probability || {};
    const odd = nullable(input.netExecutableOdd, input.odd, diagnostic.odd);
    const productionProbabilityPct = nullable(input.productionProbabilityPct, diagnostic.probabilityPct);
    const robustProbabilityPct = nullable(
        input.robustProbabilityPct,
        input.reliabilityAssessment?.robustProbabilityPct,
        input.stakeAuthority?.robustProbabilityPct
    );
    const usedProbabilityPct = robustProbabilityPct ?? productionProbabilityPct;
    const robustEvPct = nullable(
        input.robustEvPct,
        input.reliabilityAssessment?.robustEvPct,
        input.stakeAuthority?.robustEvPct
    );
    const computedEvPct = odd !== null && usedProbabilityPct !== null && odd > 1
        ? usedProbabilityPct / 100 * odd * 100 - 100
        : null;
    const ev = robustEvPct ?? computedEvPct ?? 0;
    const breakEvenPct = odd !== null && odd > 1 ? 100 / odd : null;
    const robustEdgePp = breakEvenPct !== null && usedProbabilityPct !== null ? usedProbabilityPct - breakEvenPct : 0;
    const evComponent = clamp(ev / 8 * 100, 0, 100);
    const edgeComponent = clamp(robustEdgePp / 5 * 100, 0, 100);
    const priceComponent = priceQuality(input);
    let score = evComponent * VALUE_WEIGHTS.robustEv
        + edgeComponent * VALUE_WEIGHTS.robustEdge
        + priceComponent * VALUE_WEIGHTS.priceQuality;
    const robustProbabilityMissing = robustProbabilityPct === null;
    if (robustProbabilityMissing) score = Math.min(score, 55);
    if (ev <= 0) score = Math.min(score, 25);
    return {
        score: round(clamp(score, 0, 100), 2),
        label: labelScore(score, [[80, 'STRONG_VALUE'], [65, 'VALUE'], [50, 'MARGINAL_VALUE'], [30, 'WEAK_VALUE'], [0, 'NO_VALUE']]),
        robustEvPct: round(ev, 3),
        robustEdgePp: round(robustEdgePp, 3),
        robustProbabilityPct: usedProbabilityPct === null ? null : round(usedProbabilityPct, 3),
        breakEvenPct: breakEvenPct === null ? null : round(breakEvenPct, 3),
        netExecutableOdd: odd === null ? null : round(odd, 4),
        robustProbabilityMissing,
        components: {
            robustEv: { score: round(evComponent, 2), weight: VALUE_WEIGHTS.robustEv, contribution: round(evComponent * VALUE_WEIGHTS.robustEv, 2) },
            robustEdge: { score: round(edgeComponent, 2), weight: VALUE_WEIGHTS.robustEdge, contribution: round(edgeComponent * VALUE_WEIGHTS.robustEdge, 2) },
            priceQuality: { score: round(priceComponent, 2), weight: VALUE_WEIGHTS.priceQuality, contribution: round(priceComponent * VALUE_WEIGHTS.priceQuality, 2) }
        },
        invariants: {
            dataQualityExcluded: true,
            reliabilityExcluded: true,
            forecastConfidenceExcluded: true,
            paperTradingExcluded: true
        }
    };
}

function contextRiskPenalty(input = {}) {
    const assessment = input.reliabilityAssessment || {};
    const history = input.historicalCoverage || input.historicalCoverageAudit || {};
    const days = nullable(input.daysToKickoff, assessment.daysToKickoff);
    const maturity = nullable(input.temporalMaturityScore, assessment.temporalMaturityScore, assessment.maturityScore);
    const uncertainty = clamp(nullable(input.epistemicUncertaintyScore, assessment.epistemicUncertaintyScore) ?? 100, 0, 100);
    const lineup = upper(input.lineupStatus || input.professionalAudit?.lineupNews?.status || '');
    const xg = upper(input.xgEvidenceMode || '');
    const crossGap = Math.abs(nullable(input.crossMarketGapPp, assessment.crossMarketGapPp, assessment.gapPp) ?? 0);
    const promoted = Boolean(input.promotedTeamPrior ?? history.promotedTeamPrior);

    const timingPenalty = maturity !== null
        ? clamp((100 - maturity) * 0.25, 0, 25)
        : days === null ? 15 : days > 21 ? 25 : days > 7 ? 16 : days > 2 ? 8 : 3;
    const uncertaintyPenalty = uncertainty * 0.25;
    const lineupPenalty = lineup.includes('CONFIRMED') && !lineup.includes('NOT') ? 0
        : lineup.includes('PARTIAL') || lineup.includes('UNCERTAIN') ? 8 : 15;
    const xgPenalty = xg.includes('STRONG_REAL_XG') || xg.includes('REAL_XG') ? 0
        : xg.includes('PROXY') ? 10 : 15;
    const crossMarketPenalty = clamp(crossGap, 0, 10);
    const promotedPenalty = promoted ? 8 : 0;
    const total = clamp(timingPenalty + uncertaintyPenalty + lineupPenalty + xgPenalty + crossMarketPenalty + promotedPenalty, 0, 100);
    return {
        score: round(total, 2),
        label: labelScore(100 - total, [[75, 'LOW_RISK'], [55, 'MODERATE_RISK'], [35, 'HIGH_RISK'], [0, 'VERY_HIGH_RISK']]),
        components: {
            timing: round(timingPenalty, 2),
            epistemicUncertainty: round(uncertaintyPenalty, 2),
            lineup: round(lineupPenalty, 2),
            xgEvidence: round(xgPenalty, 2),
            crossMarket: round(crossMarketPenalty, 2),
            promotedTeam: round(promotedPenalty, 2)
        },
        context: { daysToKickoff: days, temporalMaturityScore: maturity, epistemicUncertaintyScore: uncertainty, lineupStatus: lineup || null, xgEvidenceMode: xg || null, crossMarketGapPp: round(crossGap, 3), promotedTeamPrior: promoted },
        invariants: { noProbabilityReplacement: true, noStakeAuthority: true }
    };
}

function decisionReadiness(input = {}, fcs = {}, value = {}, risk = {}) {
    const dataQuality = input.dataQuality || input.dataQualityAssessment || input.finalMarketDiagnostic?.dataQuality || {};
    const marketId = String(input.marketId || input.finalMarketDiagnostic?.marketId || '').trim();
    const marketCertified = input.marketCertified ?? input.oddsCertification?.certified ?? Boolean(marketId);
    const days = nullable(input.daysToKickoff, input.reliabilityAssessment?.daysToKickoff);
    const raw = finite(fcs.score, 0) * 0.45 + finite(value.score, 0) * 0.35 + (100 - finite(risk.score, 100)) * 0.20;
    let score = clamp(raw, 0, 100);
    const caps = [];
    if (!marketId || marketCertified === false) { score = Math.min(score, 20); caps.push('MARKET_IDENTITY_NOT_CERTIFIED'); }
    if (dataQuality.blocking === true || upper(dataQuality.status).includes('BLOCK')) { score = Math.min(score, 25); caps.push('DATA_QUALITY_BLOCKING'); }
    if (finite(value.robustEvPct, -999) <= 0) { score = Math.min(score, 45); caps.push('ROBUST_EV_NON_POSITIVE'); }
    if (days !== null && days > 21 && finite(value.robustEvPct, -999) < 4) { score = Math.min(score, 55); caps.push('EARLY_EV_BELOW_RECHECK_THRESHOLD'); }
    if (finite(fcs.score, 0) < 45) { score = Math.min(score, 40); caps.push('FORECAST_CONFIDENCE_LOW'); }
    const final = clamp(score, 0, 100);
    const label = final >= 75 && finite(value.robustEvPct, 0) > 0 && finite(fcs.score, 0) >= 65 && finite(risk.score, 100) <= 35 && (days === null || days <= 7)
        ? 'SHADOW_BET_READY_CANDIDATE'
        : final >= 60 && finite(value.robustEvPct, 0) > 0
            ? 'SHADOW_VALUE_CANDIDATE'
            : final >= 45
                ? 'SHADOW_FORECAST_VALID'
                : 'SHADOW_NO_BET';
    return {
        score: round(final, 2),
        rawScore: round(raw, 2),
        label,
        caps,
        components: {
            forecastConfidence: { score: fcs.score, weight: 0.45, contribution: round(finite(fcs.score, 0) * 0.45, 2) },
            value: { score: value.score, weight: 0.35, contribution: round(finite(value.score, 0) * 0.35, 2) },
            contextSafety: { score: round(100 - finite(risk.score, 100), 2), weight: 0.20, contribution: round((100 - finite(risk.score, 100)) * 0.20, 2) }
        },
        authority: 'SHADOW_ONLY',
        canAuthorizeStake: false
    };
}

function evaluateShadow(input = {}) {
    const fcs = forecastConfidence(input);
    const value = valueScore(input);
    const risk = contextRiskPenalty(input);
    const readiness = decisionReadiness(input, fcs, value, risk);
    const oldIpm = nullable(input.oldIpmScore, input.predictionIndexScore, input.decision?.score);
    const oldComponents = input.oldIpmComponents || input.decision?.components || {};
    const oldPtContribution = nullable(oldComponents?.paperTrading?.contribution);
    const ptSample = fcs.components.paperTradingCalibration.sample;
    const legacyNeutralPtDetected = ptSample <= 0 && oldPtContribution !== null && oldPtContribution > 0;
    const currentDecisionState = input.currentDecisionState || input.finalMarketDiagnostic?.decisionState?.code || null;
    return {
        version: CALCIO_DUAL_SCORE_VERSION,
        mode: CALCIO_DUAL_SCORE_MODE,
        generatedAt: new Date().toISOString(),
        marketId: input.marketId || input.finalMarketDiagnostic?.marketId || null,
        prediction: input.prediction || input.finalMarketDiagnostic?.prediction || null,
        forecastConfidenceScore: fcs,
        valueScore: value,
        contextRiskPenalty: risk,
        decisionReadiness: readiness,
        comparison: {
            oldIpmScore: oldIpm === null ? null : round(oldIpm, 2),
            readinessDeltaVsOldIpm: oldIpm === null ? null : round(readiness.score - oldIpm, 2),
            oldIpmPaperTradingContribution: oldPtContribution === null ? null : round(oldPtContribution, 2),
            shadowPaperTradingContribution: round(fcs.components.paperTradingCalibration.adjustmentPp, 3),
            legacyNeutralPaperTradingDetected: legacyNeutralPtDetected,
            currentDecisionState,
            shadowDecisionState: readiness.label
        },
        architecture: {
            ipmRole: 'LEGACY_PRODUCTION_COMPARATOR_AND_RANKING_ONLY_IN_SHADOW_EVALUATION',
            legacyIpmComparatorPreserved: true,
            legacyIpmProductionAuthorityPreserved: true,
            stakeAuthorityIndependent: true,
            productionStakeAuthorityChanged: false,
            productionProbabilityChanged: false,
            portfolioCapsChanged: false,
            scoreFamiliesSeparated: true,
            duplicateValueReliabilityInputsRemoved: true,
            paperTradingNoSampleWeightZero: ptSample > 0 || fcs.components.paperTradingCalibration.maxArchitectureWeight === 0
        }
    };
}

function assertShadowInvariants(result = {}, options = {}) {
    const errors = [];
    if (result.mode !== CALCIO_DUAL_SCORE_MODE) errors.push('MODE_NOT_SHADOW_ONLY');
    if (result.architecture?.productionStakeAuthorityChanged !== false) errors.push('STAKE_AUTHORITY_CHANGED');
    if (result.architecture?.productionProbabilityChanged !== false) errors.push('PRODUCTION_PROBABILITY_CHANGED');
    if (result.forecastConfidenceScore?.components?.paperTradingCalibration?.sample <= 0
        && result.forecastConfidenceScore?.components?.paperTradingCalibration?.maxArchitectureWeight !== 0) errors.push('PT_NO_SAMPLE_NON_ZERO_WEIGHT');
    for (const [name, value] of [
        ['FCS', result.forecastConfidenceScore?.score],
        ['VALUE', result.valueScore?.score],
        ['CRP', result.contextRiskPenalty?.score],
        ['READINESS', result.decisionReadiness?.score]
    ]) if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) errors.push(`${name}_OUT_OF_RANGE`);
    const audit = { success: errors.length === 0, errors };
    if (!audit.success && options.throwOnError !== false) {
        const error = new Error(`PATCH26FC_SHADOW_INVARIANT_FAILED: ${errors.join(', ')}`);
        error.code = 'PATCH26FC_SHADOW_INVARIANT_FAILED';
        error.audit = audit;
        throw error;
    }
    return audit;
}

function persistenceFields(result = {}) {
    return {
        calcio_dual_score_version: result.version || CALCIO_DUAL_SCORE_VERSION,
        calcio_dual_score_mode: result.mode || CALCIO_DUAL_SCORE_MODE,
        calcio_forecast_confidence_shadow: nullable(result.forecastConfidenceScore?.score),
        calcio_value_score_shadow: nullable(result.valueScore?.score),
        calcio_context_risk_penalty: nullable(result.contextRiskPenalty?.score),
        calcio_decision_readiness_shadow: nullable(result.decisionReadiness?.score),
        calcio_decision_readiness_label: result.decisionReadiness?.label || null,
        calcio_dual_score_old_ipm: nullable(result.comparison?.oldIpmScore),
        calcio_dual_score_delta_vs_ipm: nullable(result.comparison?.readinessDeltaVsOldIpm),
        calcio_dual_score_pt_sample: Math.max(0, finite(result.forecastConfidenceScore?.components?.paperTradingCalibration?.sample, 0)),
        calcio_dual_score_pt_weight: nullable(result.forecastConfidenceScore?.components?.paperTradingCalibration?.maxArchitectureWeight) ?? 0,
        calcio_dual_score_authority: 0,
        calcio_dual_score_audit: JSON.stringify(result || {})
    };
}

function fromRow(row = {}) {
    const audit = parseJson(row.calcio_dual_score_audit, {});
    if (audit && audit.version) return audit;
    if (!row.calcio_dual_score_version) return null;
    return {
        version: row.calcio_dual_score_version,
        mode: row.calcio_dual_score_mode,
        forecastConfidenceScore: { score: nullable(row.calcio_forecast_confidence_shadow) },
        valueScore: { score: nullable(row.calcio_value_score_shadow) },
        contextRiskPenalty: { score: nullable(row.calcio_context_risk_penalty) },
        decisionReadiness: { score: nullable(row.calcio_decision_readiness_shadow), label: row.calcio_decision_readiness_label },
        comparison: { oldIpmScore: nullable(row.calcio_dual_score_old_ipm), readinessDeltaVsOldIpm: nullable(row.calcio_dual_score_delta_vs_ipm) },
        architecture: { productionStakeAuthorityChanged: false, productionProbabilityChanged: false }
    };
}

module.exports = {
    CALCIO_DUAL_SCORE_VERSION,
    CALCIO_DUAL_SCORE_MODE,
    FCS_WEIGHTS,
    VALUE_WEIGHTS,
    historicalCoverageScore,
    sourceCoverageScore,
    monteCarloPrecisionScore,
    paperTradingCalibration,
    forecastConfidence,
    valueScore,
    contextRiskPenalty,
    decisionReadiness,
    evaluateShadow,
    assertShadowInvariants,
    persistenceFields,
    fromRow
};
