'use strict';

const certifiedOddsProvenance = require('./calcioCertifiedOddsProvenance');
const decisionCertification = require('./calcioDecisionCertification');

const CALCIO_UNIFIED_PREDICTION_INDEX_VERSION = 'BETTING_PATCH_25_CANONICAL_ACTION_NET_MATH_IPM_V1';
const MINIMUM_POSITIVE_STAKE_EUR = 2;
const MIN_INDEX_FOR_STAKE = 60;
const MIN_RELIABILITY_FOR_STAKE = 55;
const BASE_FRACTIONAL_KELLY = 0.15;
// Export legacy mantenuti per compatibilità; Patch 21 non applica cap successivi all'IPM.
const PRUDENTIAL_MICRO_CAP_EUR = 3;
const PRUDENTIAL_STANDARD_CAP_EUR = 5;

// Contratto Patch 17 ripristinato: l'IPM è l'unico punteggio quantitativo dello stake.
const WEIGHTS = Object.freeze({
    reliability: 0.30,
    probability: 0.20,
    value: 0.25,
    deepScan: 0.10,
    paperTrading: 0.10,
    analysis: 0.05
});

const DEEP_SCAN_SCORES = Object.freeze({
    CONFIRMATIVE: 90,
    TECH_EDGE: 80,
    WATCHLIST: 50,
    MODEL_RISK: 25,
    HIGH_RISK: 5,
    WAIT_IN_PLAY: 50,
    UNKNOWN: 50
});
const DEEP_SCAN_ADJUSTMENTS = Object.freeze({
    CONFIRMATIVE: 2,
    TECH_EDGE: 1,
    WATCHLIST: 0,
    MODEL_RISK: -8,
    HIGH_RISK: -15,
    WAIT_IN_PLAY: 0,
    UNKNOWN: -2
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function nullableFinite(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, finite(value, min))); }
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((finite(value, 0) + Number.EPSILON) * factor) / factor;
}
function upper(value = '') {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function jsonObject(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return null; }
}
function unique(values = []) { return [...new Set(values.filter(Boolean))]; }

function median(values = []) {
    const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}
function selectedSourceIsExchange(oddsCertification = {}) {
    const key = upper(oddsCertification?.selectedSource?.bookmakerKey || '');
    const title = upper(oddsCertification?.selectedSource?.bookmakerTitle || '');
    return key.includes('_EX_') || key.includes('EXCHANGE') || title.includes('EXCHANGE');
}
function executableOddDiagnostics(input = {}, oddsCertification = {}) {
    const grossOdd = finite(input.odd, 0);
    const explicitCommission = nullableFinite(
        input.exchangeCommissionPct,
        input.exchange_commission_pct,
        oddsCertification.exchangeCommissionPct
    );
    const commissionPct = explicitCommission !== null
        ? clamp(explicitCommission, 0, 20)
        : (selectedSourceIsExchange(oddsCertification) ? 5 : 0);
    const netOdd = grossOdd > 1
        ? 1 + (grossOdd - 1) * (1 - commissionPct / 100)
        : grossOdd;
    const prices = (Array.isArray(oddsCertification?.sources) ? oddsCertification.sources : [])
        .map(source => Number(source?.price))
        .filter(price => Number.isFinite(price) && price > 1);
    const medianOdd = median(prices);
    const premiumPct = medianOdd && medianOdd > 0
        ? (grossOdd / medianOdd - 1) * 100
        : 0;
    const outlierFactor = premiumPct >= 20 ? 0.45
        : premiumPct >= 15 ? 0.60
            : premiumPct >= 10 ? 0.78
                : premiumPct >= 7 ? 0.90
                    : 1;
    return {
        grossOdd: round(grossOdd, 4),
        netOdd: round(netOdd, 4),
        commissionPct: round(commissionPct, 2),
        exchangeSource: selectedSourceIsExchange(oddsCertification),
        sourceMedianOdd: medianOdd === null ? null : round(medianOdd, 4),
        selectedPremiumPct: round(premiumPct, 2),
        outlierFactor,
        sourceCount: prices.length
    };
}

function classifyDeepScan(action = '', suggestion = '') {
    const actionText = upper(action);
    if (actionText.includes('ALTO RISCHIO') || actionText.includes('HIGH RISK') || actionText.includes('VALUE TRAP') || actionText.includes('SCARTA')) return 'HIGH_RISK';
    if (actionText.includes('RISCHIO MODELLO') || actionText.includes('MODEL RISK')) return 'MODEL_RISK';
    if (actionText.includes('VALUE CONFERMATO') || actionText.includes('VIA LIBERA') || actionText.includes('SUPER VALUE') || actionText.includes('OPERATIONAL VALUE')) return 'CONFIRMATIVE';
    if (actionText.includes('EDGE TECNICO') || actionText.includes('TECH EDGE')) return 'TECH_EDGE';
    if (actionText.includes('WATCHLIST') || actionText.includes('LOW EDGE') || actionText.includes('VALUE QUALITATIVO')) return 'WATCHLIST';
    if (actionText.includes('ATTENDI') || actionText.includes('IN PLAY') || actionText.includes('WAIT') || actionText.includes('LIVE')) return 'WATCHLIST';

    const fallback = upper(suggestion);
    if (fallback.includes('ALTO RISCHIO') || fallback.includes('HIGH RISK') || fallback.includes('VALUE TRAP') || fallback.includes('SCARTA')) return 'HIGH_RISK';
    if (fallback.includes('RISCHIO MODELLO') || fallback.includes('MODEL RISK')) return 'MODEL_RISK';
    if (fallback.includes('VALUE CONFERMATO') || fallback.includes('VIA LIBERA') || fallback.includes('SUPER VALUE') || fallback.includes('OPERATIONAL VALUE')) return 'CONFIRMATIVE';
    if (fallback.includes('EDGE TECNICO') || fallback.includes('TECH EDGE')) return 'TECH_EDGE';
    if (fallback.includes('WATCHLIST') || fallback.includes('LOW EDGE') || fallback.includes('VALUE QUALITATIVO')) return 'WATCHLIST';
    if (fallback.includes('ATTENDI') || fallback.includes('IN PLAY') || fallback.includes('WAIT') || fallback.includes('LIVE')) return 'WATCHLIST';
    return 'UNKNOWN';
}

function dataClassFromScore(score) {
    const n = finite(score, 0);
    if (n < 55) return 'INATTENDIBILE';
    if (n < 70) return 'ATTENDIBILE';
    if (n < 85) return 'BUONA';
    return 'ALTA';
}
function predictionIndexLabel(score) {
    const n = finite(score, 0);
    if (n < 45) return 'SCARTA';
    if (n < 60) return 'SOLO ANALISI';
    if (n < 70) return 'MICRO';
    if (n < 80) return 'VALUE';
    if (n < 90) return 'FORTE';
    return 'TOP';
}
function stakeBand(score) {
    const n = finite(score, 0);
    if (n < 60) return { multiplier: 0, maxBankrollPct: 0, label: 'NO_STAKE' };
    if (n < 70) return { multiplier: 0.35, maxBankrollPct: 0.50, label: 'MICRO' };
    if (n < 80) return { multiplier: 0.55, maxBankrollPct: 0.75, label: 'VALUE' };
    if (n < 90) return { multiplier: 0.75, maxBankrollPct: 1.25, label: 'FORTE' };
    return { multiplier: 1, maxBankrollPct: 2, label: 'TOP' };
}
function fullKellyPct(probabilityPct, odd) {
    const p = clamp(probabilityPct, 0, 100) / 100;
    const o = finite(odd, 0);
    if (o <= 1 || p <= 0 || p >= 1) return 0;
    const numerator = (p * o) - 1;
    if (numerator <= 0) return 0;
    return numerator / (o - 1) * 100;
}
function reliabilityInput(input = {}) {
    return clamp(nullableFinite(
        input.reliabilityScore,
        input.predictionReliability?.score,
        input.calcio_prediction_reliability_score,
        input.quality_final_score,
        input.quality_base_score,
        input.confidence
    ) ?? 0, 0, 100);
}

function probabilityDiagnostics(input = {}, market = '') {
    const integrity = input.probabilityIntegrity || input.extData?.probabilityIntegrity || jsonObject(input.probability_integrity_json) || {};
    const detail = integrity?.diagnostics?.[market] || input.probabilityDetail || {};
    const probability = clamp(nullableFinite(input.probability, input.estimated_prob, input.estimatedProb, input.rawProb) ?? 0, 0, 100);
    const monteCarlo = nullableFinite(input.monteCarloProbabilityPct, detail.monteCarloProbabilityPct, input.mc_probability_pct);
    const model = nullableFinite(input.modelProbabilityPct, detail.modelProbabilityPct, input.model_probability_pct);
    const marketProbability = nullableFinite(input.marketProbabilityPct, detail.marketProbabilityPct, input.market_implied_prob);
    const monteCarloStdErrorPp = nullableFinite(
        input.monteCarloStdErrorPp,
        detail.monteCarloStdErrorPp,
        input.monte_carlo_std_error_pp,
        integrity.maxMonteCarloStdErrorPp
    );
    const monteCarloCiLowPct = nullableFinite(input.monteCarloCiLowPct, detail.monteCarloCiLowPct, detail.ciLowPct);
    const monteCarloCiHighPct = nullableFinite(input.monteCarloCiHighPct, detail.monteCarloCiHighPct, detail.ciHighPct);

    // Patch 23: il modello statistico è la stima centrale. Monte Carlo descrive la
    // distribuzione/incertezza della stessa stima e non costituisce un secondo voto.
    const modelCenter = Number.isFinite(model) ? model : probability;
    const mcModelDrift = Number.isFinite(monteCarlo) ? Math.abs(monteCarlo - modelCenter) : null;
    const mcIntervalWidth = Number.isFinite(monteCarloCiLowPct) && Number.isFinite(monteCarloCiHighPct)
        ? Math.max(0, monteCarloCiHighPct - monteCarloCiLowPct)
        : (Number.isFinite(monteCarloStdErrorPp) ? 3.92 * monteCarloStdErrorPp : null);
    const marketGap = Number.isFinite(marketProbability) ? Math.abs(modelCenter - marketProbability) : null;
    const finalGap = Math.abs(probability - modelCenter);

    const evidence = input.historicalEvidence || input.historicalCombinationEvidence || {};
    const historicalSample = Math.max(0, finite(input.historicalSample ?? input.historical_combo_resolved ?? evidence.resolved, 0));
    const historicalProbability = nullableFinite(
        input.historicalAdjustedRatePct,
        input.historical_combo_adjusted_rate_pct,
        evidence.adjustedRatePct,
        input.historicalWinRatePct,
        input.historical_combo_win_rate_pct,
        evidence.winRatePct
    );
    const historicalWeight = historicalSample > 0 && Number.isFinite(historicalProbability)
        ? clamp(historicalSample / 30, 0, 1)
        : 0;
    const historicalGap = historicalWeight > 0 ? Math.abs(modelCenter - historicalProbability) : null;

    const fallbackConsensus = clamp(nullableFinite(input.consensusConfidence, input.confidence) ?? 50, 0, 100);
    const marketPenalty = marketGap === null ? 0 : marketGap * 5;
    const finalBlendPenalty = finalGap * 2;
    const mcDistributionPenalty = (mcModelDrift === null ? 0 : mcModelDrift * 1.25)
        + (mcIntervalWidth === null ? 0 : Math.max(0, mcIntervalWidth - 1) * 1.5);
    const historicalPenalty = historicalGap === null ? 0 : historicalGap * 2.5 * historicalWeight;
    const consensusScore = (Number.isFinite(model) || Number.isFinite(marketProbability))
        ? clamp(100 - marketPenalty - finalBlendPenalty - mcDistributionPenalty - historicalPenalty, 0, 100)
        : fallbackConsensus;
    const absoluteScore = clamp((probability - 25) / 45 * 100, 0, 100);
    const score = clamp(absoluteScore * 0.30 + consensusScore * 0.70, 0, 100);
    const externalValues = [modelCenter, marketProbability, historicalWeight > 0 ? historicalProbability : null].filter(Number.isFinite);
    const externalSpread = externalValues.length >= 2 ? Math.max(...externalValues) - Math.min(...externalValues) : null;

    return {
        probability,
        monteCarlo,
        model,
        marketProbability,
        historicalProbability: historicalWeight > 0 ? round(historicalProbability, 2) : null,
        historicalSample,
        historicalWeight: round(historicalWeight, 3),
        modelCenterPct: round(modelCenter, 2),
        modelSpreadPp: null,
        monteCarloRole: 'DISTRIBUTION_ONLY_NOT_INDEPENDENT_VOTE',
        monteCarloModelDriftPp: mcModelDrift === null ? null : round(mcModelDrift, 2),
        monteCarloStdErrorPp: monteCarloStdErrorPp === null ? null : round(monteCarloStdErrorPp, 3),
        monteCarloIntervalWidthPp: mcIntervalWidth === null ? null : round(mcIntervalWidth, 3),
        marketGapPp: marketGap === null ? null : round(marketGap, 2),
        historicalGapPp: historicalGap === null ? null : round(historicalGap, 2),
        finalModelGapPp: round(finalGap, 2),
        spreadPp: externalSpread === null ? null : round(externalSpread, 2),
        absoluteScore: round(absoluteScore, 2),
        consensusScore: round(consensusScore, 2),
        score: round(score, 2),
        penalties: {
            market: round(marketPenalty, 2),
            finalBlend: round(finalBlendPenalty, 2),
            monteCarloDistribution: round(mcDistributionPenalty, 2),
            historicalIndependent: round(historicalPenalty, 2)
        },
        source: Number.isFinite(marketProbability)
            ? 'MODEL_CENTER_MARKET_EXTERNAL_MC_DISTRIBUTION_HISTORICAL'
            : 'MODEL_CENTER_MC_DISTRIBUTION_HISTORICAL_NO_MARKET'
    };
}

function valueComponent(input = {}, probabilityDiagnosticsResult = {}, oddsCertification = {}) {
    const probability = finite(probabilityDiagnosticsResult.probability ?? input.probability ?? input.estimated_prob ?? input.estimatedProb, 0);
    const executable = executableOddDiagnostics(input, oddsCertification);
    const netOdd = executable.netOdd;
    const suppliedEdge = finite(input.edgePp ?? input.edge_pp ?? input.edge, 0);
    const netBreakEven = netOdd > 1 ? 100 / netOdd : 100;
    // PATCH 24: Edge, EV, Kelly e profitto condividono la stessa quota netta.
    // Gli eventuali valori supplied/adjusted restano diagnostica, senza autorità matematica.
    const netEdge = probability > 0 && netOdd > 1 ? probability - netBreakEven : 0;
    const edge = netEdge;
    const netEv = netOdd > 1 && probability > 0 ? probability / 100 * netOdd * 100 - 100 : 0;
    const suppliedEv = finite(input.evPct ?? input.ev_pct ?? input.expected_roi, netEv);
    const ev = netEv;

    const edgeScore = clamp(edge / 5 * 100, 0, 100);
    const evScore = clamp(ev / 12 * 100, 0, 100);
    const rawScore = edgeScore * 0.55 + evScore * 0.45;
    const probabilityFactor = probability < 20 ? 0.50
        : probability < 25 ? 0.62
            : probability < 30 ? 0.74
                : probability < 35 ? 0.84
                    : probability < 40 ? 0.92
                        : 1;
    const oddFactor = netOdd > 8 ? 0.55
        : netOdd > 5 ? 0.70
            : netOdd > 3.5 ? 0.86
                : 1;
    const gap = finite(probabilityDiagnosticsResult.marketGapPp, 0);
    const consensusFactor = gap >= 12 ? 0.60
        : gap >= 8 ? 0.75
            : gap >= 5 ? 0.88
                : 1;
    const riskFactor = probabilityFactor * oddFactor * executable.outlierFactor * consensusFactor;
    const score = clamp(rawScore * riskFactor, 0, 100);

    return {
        edgePp: round(edge, 2),
        rawEdgePp: round(suppliedEdge, 2),
        netBreakEvenPct: round(netBreakEven, 2),
        evPct: round(ev, 2),
        suppliedEvPct: round(suppliedEv, 2),
        edgeScore: round(edgeScore, 2),
        evScore: round(evScore, 2),
        rawScore: round(rawScore, 2),
        probabilityFactor: round(probabilityFactor, 3),
        oddFactor: round(oddFactor, 3),
        consensusFactor: round(consensusFactor, 3),
        outlierFactor: round(executable.outlierFactor, 3),
        riskFactor: round(riskFactor, 3),
        score: round(score, 2),
        executableOdd: executable,
        authority: 'IPM_VALUE_COMPONENT_SINGLE_NET_ODD_MATH_PATCH24'
    };
}

function paperTradingComponent(input = {}, odd = 0) {
    const evidence = input.historicalEvidence || input.historicalCombinationEvidence || {};
    const sample = Math.max(0, finite(input.historicalSample ?? input.historical_combo_resolved ?? evidence.resolved, 0));
    const empiricalProbability = nullableFinite(
        input.historicalAdjustedRatePct,
        input.historical_combo_adjusted_rate_pct,
        evidence.adjustedRatePct,
        input.historicalWinRatePct,
        input.historical_combo_win_rate_pct,
        evidence.winRatePct
    );
    if (sample <= 0 || empiricalProbability === null || finite(odd, 0) <= 1) {
        return {
            sample,
            empiricalProbabilityPct: empiricalProbability,
            breakEvenPct: finite(odd, 0) > 1 ? round(100 / finite(odd, 0), 2) : null,
            confidenceWeight: 0,
            score: 50,
            status: 'NO_SAMPLE_NEUTRAL'
        };
    }
    const breakEven = 100 / finite(odd, 0);
    const rawScore = clamp(50 + (empiricalProbability - breakEven) * 4, 0, 100);
    const confidenceWeight = clamp(sample / 30, 0, 1);
    const score = 50 + confidenceWeight * (rawScore - 50);
    return {
        sample,
        empiricalProbabilityPct: round(empiricalProbability, 2),
        breakEvenPct: round(breakEven, 2),
        confidenceWeight: round(confidenceWeight, 3),
        rawScore: round(rawScore, 2),
        score: round(score, 2),
        status: sample >= 30 ? 'MATURE' : sample >= 10 ? 'DEVELOPING' : 'LOW_SAMPLE'
    };
}

function analysisComponent(input = {}, probabilityResult = {}, oddsCertification = {}) {
    const crPassed = input.crPassed ?? input.analysis_thresholds?.crPassed;
    let score = 50;
    if (crPassed !== false) score += 10;
    if (oddsCertification?.certified === true && oddsCertification?.operationalEligible === true) score += 10;
    if (input.decisionIdentity?.certified === true || Number(input.calcio_identity_certified) === 1) score += 10;
    const role = upper(input.exposure_role || input.prediction_visibility || '');
    if (role.includes('PRIMARY') || role.includes('OPERATIONAL_CANDIDATE')) score += 5;
    if (probabilityResult.marketGapPp !== null && probabilityResult.marketGapPp <= 4) score += 10;
    else if (probabilityResult.marketGapPp !== null && probabilityResult.marketGapPp >= 10) score -= 10;
    return {
        score: round(clamp(score, 0, 100), 2),
        crPassed: crPassed !== false,
        status: 'FORECAST_STRUCTURE_AND_MARKET_FIT',
        valueDuplicated: false
    };
}

function hardSafetyReasons(input = {}, reliability = 0, probability = 0, odd = 0, value = {}, oddsCertification = {}, decisionGuard = {}) {
    const reasons = [...(decisionGuard.hardReasons || decisionGuard.reasons || [])];
    if (upper(input.calcio_decision_certification_status) === 'PATCH19_REQUIRES_PROVIDER_REFRESH') {
        reasons.push('riga legacy sospesa: refresh provider obbligatorio');
    }
    if (reliability < MIN_RELIABILITY_FOR_STAKE) reasons.push(`affidabilità ${round(reliability, 1)}/100 sotto ${MIN_RELIABILITY_FOR_STAKE}`);
    if (!(odd > 1)) reasons.push('quota non valida');
    if (!(probability > 0 && probability < 100)) reasons.push('probabilità non valida');
    if (value.edgePp > 25 || value.evPct > 75) reasons.push('anomalia valore oltre guardrail integrità');
    if (finite(value?.executableOdd?.selectedPremiumPct, 0) >= 20 && finite(value?.executableOdd?.sourceCount, 0) < 4) reasons.push('quota best-price outlier non sufficientemente confermata');
    if (oddsCertification?.selectedSource?.derived === true || oddsCertification?.realDirect === false) reasons.push('quota derivata, stimata o non diretta esclusa');
    if (oddsCertification?.certified !== true) reasons.push('quota senza bookmaker e timestamp certificati');
    else if (oddsCertification?.operationalEligible !== true) reasons.push(`quota diretta non verificata multi-fonte (${Number(oddsCertification?.sourceCount || 0)} fonte)`);
    const structural = upper(`${input.calcio_professional_status || ''} ${input.professionalAudit?.status || ''} ${input.calcioHealthStatus || input.healthStatus || ''}`);
    if (structural.includes('DATA_CORRUPT') || structural.includes('IDENTITY_CONFLICT') || structural.includes('TEAM_MATCH_FAILED')) reasons.push('anomalia strutturale di identità/dati');
    if (structural.includes('HEALTH_ERROR') || structural.includes('UNHEALTHY')) reasons.push('health Calcio non operativo');
    return unique(reasons);
}

// Patch 21: segnali soft e vecchie soglie restano visibili ma non trasformano lo stake dopo l'IPM.
function cautionPolicy(input = {}, decisionGuard = {}, paperTrading = {}, deepScanClass = 'UNKNOWN') {
    const warnings = [...(decisionGuard.advisoryReasons || decisionGuard.cautionReasons || [])];
    if (paperTrading.status === 'NO_SAMPLE_NEUTRAL') warnings.push('PT DS×Gate n=0: contributo neutrale 50/100');
    if (['WATCHLIST', 'MODEL_RISK', 'HIGH_RISK', 'WAIT_IN_PLAY'].includes(deepScanClass)) warnings.push(`DeepScan ${deepScanClass}: già incorporato nell'IPM`);
    return {
        active: false,
        mode: 'STANDARD_CERTIFIED',
        multiplier: 1,
        capEur: null,
        reasons: unique(warnings),
        policy: 'IPM_SINGLE_AUTHORITY_NO_POST_INDEX_VETO_OR_CAP',
        softBlockIsCapNotVeto: false,
        softBlockIsIndexInputOnly: true,
        earlyTimingIsIndexInputOnly: true,
        noExactPaperTradingSampleIsNeutral: true
    };
}

function normalizePositiveStake(value, maximum = Infinity, bankroll = Infinity) {
    let amount = Math.max(0, finite(value, 0));
    const max = Math.min(finite(maximum, Infinity), finite(bankroll, Infinity));
    if (amount <= 0 || max < MINIMUM_POSITIVE_STAKE_EUR) return 0;
    amount = Math.min(amount, max);
    if (amount > 0 && amount < MINIMUM_POSITIVE_STAKE_EUR) amount = MINIMUM_POSITIVE_STAKE_EUR;
    if (amount > max) amount = max;
    return amount >= MINIMUM_POSITIVE_STAKE_EUR ? round(amount, 2) : 0;
}

function evaluatePrediction(input = {}) {
    const market = String(input.market || input.prediction || '').trim();
    const reliability = reliabilityInput(input);
    const probability = probabilityDiagnostics(input, market);
    const oddsCertification = certifiedOddsProvenance.certificationFromInput({ ...input, market });
    const certifiedOperationalOdd = oddsCertification.certified === true
        && oddsCertification.operationalEligible === true
        && oddsCertification.realDirect === true
        && oddsCertification?.selectedSource?.derived !== true;
    const rawValue = valueComponent({ ...input, probability: probability.probability }, probability, oddsCertification);
    const value = certifiedOperationalOdd
        ? { ...rawValue, status: 'CERTIFIED_ODDS_VALUE' }
        : {
            edgePp: 0,
            evPct: 0,
            edgeScore: 0,
            evScore: 0,
            score: 0,
            status: 'SUPPRESSED_UNCERTIFIED_ODDS',
            suppressedEdgePp: rawValue.edgePp,
            suppressedEvPct: rawValue.evPct,
            authority: 'IPM_VALUE_SUPPRESSED_UNCERTIFIED_ODDS'
        };
    const deepScanClass = classifyDeepScan(input.deepScanAction ?? input.ds_action, input.deepScanSuggestion ?? input.ds_suggestion);
    const deepScanScore = DEEP_SCAN_SCORES[deepScanClass] ?? DEEP_SCAN_SCORES.UNKNOWN;
    const deepScanAdjustment = DEEP_SCAN_ADJUSTMENTS[deepScanClass] ?? DEEP_SCAN_ADJUSTMENTS.UNKNOWN;
    const paperTrading = paperTradingComponent(input, certifiedOperationalOdd ? input.odd : 0);
    const analysis = analysisComponent(input, probability, oddsCertification);
    const decisionIdentity = input.decisionIdentity || decisionCertification.certifyIdentity(input);
    const marketCertification = decisionCertification.certifyMarket({ ...input, oddsCertification });
    const decisionGuard = decisionCertification.operationalGuard({
        ...input,
        probability: probability.probability,
        oddsCertification,
        decisionIdentity,
        marketCertification
    });

    const weightedBase = reliability * WEIGHTS.reliability
        + probability.score * WEIGHTS.probability
        + value.score * WEIGHTS.value
        + deepScanScore * WEIGHTS.deepScan
        + paperTrading.score * WEIGHTS.paperTrading
        + analysis.score * WEIGHTS.analysis;
    const score = clamp(weightedBase + deepScanAdjustment, 0, 100);
    const label = predictionIndexLabel(score);
    const band = stakeBand(score);
    const fullKelly = certifiedOperationalOdd ? fullKellyPct(probability.probability, value.executableOdd?.netOdd ?? input.odd) : 0;
    const fractionalKellyPct = fullKelly * BASE_FRACTIONAL_KELLY;
    const bankroll = Math.max(0, finite(input.bankroll ?? input.bankroll_snapshot, 0));
    const safetyReasons = hardSafetyReasons(input, reliability, probability.probability, finite(input.odd, 0), value, oddsCertification, decisionGuard);
    const positiveMath = fullKelly > 0 && value.evPct > 0;
    const caution = cautionPolicy(input, decisionGuard, paperTrading, deepScanClass);

    let theoreticalStake = 0;
    let operationalStake = 0;
    let reason;
    if (safetyReasons.length) {
        reason = `Stake €0: controllo integrità (${safetyReasons.join(' · ')}).`;
    } else if (!positiveMath) {
        reason = 'Stake €0: Kelly pieno non positivo; quota e probabilità non generano valore matematico.';
    } else if (score < MIN_INDEX_FOR_STAKE) {
        reason = `Stake €0: Indice Predizione ${round(score, 1)}/100 sotto ${MIN_INDEX_FOR_STAKE}.`;
    } else if (bankroll <= 0) {
        reason = 'Stake €0: bankroll non valido.';
    } else {
        const baseStake = bankroll * fractionalKellyPct / 100;
        const bandCap = bankroll * band.maxBankrollPct / 100;
        theoreticalStake = normalizePositiveStake(baseStake * band.multiplier, Math.min(bandCap, bankroll), bankroll);
        operationalStake = theoreticalStake;
        reason = operationalStake > 0
            ? `Stake autorizzato unicamente dall'Indice Predizione ${round(score, 1)}/100 (${label}): Kelly 15% × moltiplicatore ${band.multiplier}, cap ${band.maxBankrollPct}% bankroll.`
            : 'Stake €0: importo matematico finale inferiore al minimo operativo €2.';
    }

    const certificationStatus = operationalStake > 0
        ? (paperTrading.sample > 0 ? 'STRUCTURALLY_CERTIFIED_PT_VALIDATED' : 'STRUCTURALLY_CERTIFIED_PT_ABSENT')
        : 'DECISION_ANALYSIS_ONLY';
    const certification = {
        version: decisionCertification.CALCIO_DECISION_CERTIFICATION_VERSION,
        status: certificationStatus,
        reason,
        confidenceScore: round(score, 2),
        valueScore: round(value.score, 2),
        guard: decisionGuard,
        identity: decisionIdentity,
        market: marketCertification,
        caution,
        historicalHomeKey: input.historicalHomeKey || input.calcio_historical_home_key || null,
        historicalAwayKey: input.historicalAwayKey || input.calcio_historical_away_key || null
    };

    const components = {
        reliability: { score: round(reliability, 2), weight: WEIGHTS.reliability, contribution: round(reliability * WEIGHTS.reliability, 2) },
        probability: { ...probability, weight: WEIGHTS.probability, contribution: round(probability.score * WEIGHTS.probability, 2) },
        value: { ...value, weight: WEIGHTS.value, contribution: round(value.score * WEIGHTS.value, 2) },
        deepScan: { class: deepScanClass, score: deepScanScore, adjustment: deepScanAdjustment, weight: WEIGHTS.deepScan, contribution: round(deepScanScore * WEIGHTS.deepScan + deepScanAdjustment, 2) },
        paperTrading: { ...paperTrading, weight: WEIGHTS.paperTrading, contribution: round(paperTrading.score * WEIGHTS.paperTrading, 2) },
        analysis: { ...analysis, weight: WEIGHTS.analysis, contribution: round(analysis.score * WEIGHTS.analysis, 2) },
        decisionCertification: {
            status: certification.status,
            identityCertified: decisionIdentity.certified,
            marketCertified: marketCertification.certified,
            thresholdsDiagnosticOnly: true,
            legacyThresholdsPassed: decisionGuard.legacyThresholdsPassed,
            hardReasons: decisionGuard.hardReasons,
            advisoryReasons: caution.reasons,
            contribution: 0,
            authority: 'STRUCTURAL_CERTIFICATION_ONLY'
        },
        oddsCertification: {
            status: oddsCertification.status || 'UNCERTIFIED',
            certified: oddsCertification.certified === true,
            operationalEligible: oddsCertification.operationalEligible === true,
            realDirect: oddsCertification.realDirect === true,
            crossVerified: oddsCertification.crossVerified === true,
            sourceCount: Number(oddsCertification.sourceCount || 0),
            bookmaker: oddsCertification.selectedSource?.bookmakerTitle || oddsCertification.selectedSource?.bookmakerKey || null,
            lastUpdate: oddsCertification.selectedSource?.lastUpdate || null,
            contribution: 0,
            authority: 'HARD_EXECUTION_GUARD'
        }
    };

    return {
        version: CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
        score: round(score, 2),
        label,
        eligible: operationalStake > 0,
        rankValue: round((safetyReasons.length ? -1e6 : 0) + score * 1000 + probability.probability * 10 + value.score, 4),
        dataClass: dataClassFromScore(reliability),
        reliabilityScore: round(reliability, 2),
        probabilityPct: round(probability.probability, 2),
        edgePp: value.edgePp,
        evPct: value.evPct,
        valueScore: round(value.score, 2),
        netExecutableOdd: nullableFinite(value.executableOdd?.netOdd),
        grossExecutableOdd: nullableFinite(value.executableOdd?.grossOdd),
        exchangeCommissionPct: nullableFinite(value.executableOdd?.commissionPct),
        marketConsensusGapPp: nullableFinite(probability.marketGapPp),
        oddsOutlierPremiumPct: nullableFinite(value.executableOdd?.selectedPremiumPct),
        finalizationStatus: input.finalizationStatus || 'PATCH24_IPM_COMPUTED_ONCE',
        marketReselectionRequired: false,
        deepScanClass,
        oddsCertification,
        decisionCertification: certification,
        certifiedOperationalOdd,
        paperTradingStatus: paperTrading.status,
        fullKellyPct: round(fullKelly, 4),
        fractionalKellyPct: round(fractionalKellyPct, 4),
        scoreMultiplier: band.multiplier,
        maxBankrollPct: band.maxBankrollPct,
        cautionPolicy: caution,
        operationalMultiplier: 1,
        operationalCapEur: null,
        theoreticalStake: round(theoreticalStake, 2),
        operationalStake: round(operationalStake, 2),
        estimatedProfit: round(operationalStake * Math.max(0, finite(value.executableOdd?.netOdd ?? input.odd, 0) - 1), 2),
        minimumStakeApplied: operationalStake === MINIMUM_POSITIVE_STAKE_EUR && theoreticalStake > 0,
        safetyReasons,
        reason,
        components,
        policy: {
            stakeAuthority: 'UNIFIED_PREDICTION_INDEX_ONLY',
            hardIdentityMarketOddsGuard: true,
            legacyThresholdsDirectVeto: false,
            deepScanDirectVeto: false,
            qualityGateDirectVeto: false,
            timingDirectVeto: false,
            noExactPaperTradingSampleDirectVeto: false,
            noExactPaperTradingSampleNeutralScore: 50,
            valueContributesToPredictionIndex: true,
            valueWeight: WEIGHTS.value,
            valueContributesToDataReliability: false,
            minimumIndexForStake: MIN_INDEX_FOR_STAKE,
            minimumReliabilityForStake: MIN_RELIABILITY_FOR_STAKE,
            baseFractionalKelly: BASE_FRACTIONAL_KELLY,
            minimumPositiveStakeEur: MINIMUM_POSITIVE_STAKE_EUR,
            certifiedDirectOddsRequired: true,
            minimumIndependentOddsSources: certifiedOddsProvenance.OPERATIONAL_MIN_SOURCES,
            providerIdentityRequired: input.requireIdentityCertification === true,
            marketIdentityRequired: true,
            marketProbabilityIncludedInConsensus: true,
            monteCarloIndependentVote: false,
            monteCarloRole: 'DISTRIBUTION_AND_UNCERTAINTY',
            historicalEvidenceIndependentConsensusInput: true,
            exchangeCommissionNetting: true,
            bestPriceOutlierDiscount: true,
            longshotVarianceDiscountInsideValue: true,
            analysisComponentDuplicatesValue: false
        }
    };
}

function persistenceFields(result = {}) {
    return {
        ...certifiedOddsProvenance.persistenceFields(result.oddsCertification || {}),
        ...decisionCertification.persistenceFields(result.decisionCertification || {}),
        stake: finite(result.operationalStake, 0),
        calcio_theoretical_stake: finite(result.theoreticalStake, 0),
        calcio_operational_stake: finite(result.operationalStake, 0),
        calcio_stake_lifecycle_status: result.operationalStake > 0 ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
        calcio_stake_lifecycle_reason: result.reason || '',
        stake_policy_mode: CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
        stake_policy_note: result.reason || '',
        stake_confidence_level: result.dataClass || '',
        kelly_fraction_pct: nullableFinite(result.fractionalKellyPct),
        kelly_raw_stake: null,
        stake_confidence_multiplier: nullableFinite(result.scoreMultiplier),
        stake_min_applied: result.minimumStakeApplied ? 1 : 0,
        stake_cap_applied: result.maxBankrollPct > 0 ? 1 : 0,
        calcio_stake_caution_mode: 'IPM_SINGLE_AUTHORITY',
        calcio_stake_caution_reasons: (result.cautionPolicy?.reasons || []).join(' · '),
        calcio_stake_operational_multiplier: 1,
        calcio_stake_operational_cap: null,
        calcio_prediction_index_score: nullableFinite(result.score),
        calcio_prediction_index_label: result.label || '',
        calcio_prediction_index_version: result.version || CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
        calcio_prediction_index_reason: result.reason || '',
        calcio_prediction_index_components: JSON.stringify(result.components || {}),
        calcio_prediction_index_rank_value: nullableFinite(result.rankValue),
        calcio_prediction_index_eligible: result.eligible ? 1 : 0,
        calcio_net_executable_odd: nullableFinite(result.netExecutableOdd),
        calcio_market_consensus_gap_pp: nullableFinite(result.marketConsensusGapPp),
        calcio_odds_outlier_premium_pct: nullableFinite(result.oddsOutlierPremiumPct),
        calcio_exchange_commission_pct: nullableFinite(result.exchangeCommissionPct),
        calcio_ai_finalization_status: result.finalizationStatus || 'IPM_COMPUTED',
        calcio_market_reselection_required: 0,
        calcio_gate_allow_bet: result.eligible ? 1 : 0,
        calcio_gate_max_stake: finite(result.operationalStake, 0),
        calcio_operational_action: result.eligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
        calcio_operational_summary: result.reason || '',
        quality_stake_mode: result.eligible ? 'UNIFIED_INDEX' : 'UNIFIED_INDEX_NO_STAKE',
        quality_stake_amount: finite(result.operationalStake, 0)
    };
}

module.exports = {
    CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
    MINIMUM_POSITIVE_STAKE_EUR,
    MIN_INDEX_FOR_STAKE,
    MIN_RELIABILITY_FOR_STAKE,
    BASE_FRACTIONAL_KELLY,
    PRUDENTIAL_MICRO_CAP_EUR,
    PRUDENTIAL_STANDARD_CAP_EUR,
    WEIGHTS,
    DEEP_SCAN_SCORES,
    DEEP_SCAN_ADJUSTMENTS,
    classifyDeepScan,
    dataClassFromScore,
    predictionIndexLabel,
    stakeBand,
    fullKellyPct,
    executableOddDiagnostics,
    probabilityDiagnostics,
    valueComponent,
    paperTradingComponent,
    analysisComponent,
    hardSafetyReasons,
    cautionPolicy,
    evaluatePrediction,
    persistenceFields
};
