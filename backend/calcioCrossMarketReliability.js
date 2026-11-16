'use strict';

const CALCIO_CROSS_MARKET_RELIABILITY_VERSION = 'BETTING_PATCH_26E_C_CROSS_MARKET_RELIABILITY_V2';
const MINIMUM_OPERATIONAL_STAKE = 2;

const ACTIONS = Object.freeze({
    VALUE: 'VALUE CONFERMATO / MICRO',
    EDGE: 'EDGE TECNICO',
    WATCHLIST: 'WATCHLIST LOW EDGE',
    MODEL_RISK: 'RISCHIO MODELLO',
    HIGH_RISK: 'ALTO RISCHIO'
});
const SEVERITY = Object.freeze({
    [ACTIONS.VALUE]: 0,
    [ACTIONS.EDGE]: 1,
    [ACTIONS.WATCHLIST]: 2,
    [ACTIONS.MODEL_RISK]: 3,
    [ACTIONS.HIGH_RISK]: 4
});

function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function nullable(value) {
    // R61: missing observations must remain missing; Number(null) === 0 is unsafe.
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, num(value, min))); }
function round(value, d = 2) { const f = 10 ** d; return Math.round((num(value) + Number.EPSILON) * f) / f; }

function poissonPmf(lambda, k) {
    if (!(lambda >= 0) || k < 0) return 0;
    let result = Math.exp(-lambda);
    for (let i = 1; i <= k; i += 1) result *= lambda / i;
    return result;
}

function scoreProbabilities(lambdaHome, lambdaAway, maxGoals = 10) {
    let home = 0; let draw = 0; let away = 0; let over25 = 0; let btts = 0; let totalMass = 0;
    for (let h = 0; h <= maxGoals; h += 1) {
        const ph = poissonPmf(lambdaHome, h);
        for (let a = 0; a <= maxGoals; a += 1) {
            const p = ph * poissonPmf(lambdaAway, a);
            totalMass += p;
            if (h > a) home += p; else if (h === a) draw += p; else away += p;
            if (h + a >= 3) over25 += p;
            if (h > 0 && a > 0) btts += p;
        }
    }
    if (totalMass <= 0) return null;
    return {
        homePct: home / totalMass * 100,
        drawPct: draw / totalMass * 100,
        awayPct: away / totalMass * 100,
        over25Pct: over25 / totalMass * 100,
        under25Pct: (1 - over25 / totalMass) * 100,
        bttsPct: btts / totalMass * 100,
        noBttsPct: (1 - btts / totalMass) * 100
    };
}

function normalize1x2(odd1, oddX, odd2) {
    const odds = [num(odd1, 0), num(oddX, 0), num(odd2, 0)];
    if (odds.some(o => o <= 1)) return null;
    const inv = odds.map(o => 1 / o);
    const sum = inv.reduce((a, b) => a + b, 0);
    return {
        homePct: inv[0] / sum * 100,
        drawPct: inv[1] / sum * 100,
        awayPct: inv[2] / sum * 100,
        marginPct: (sum - 1) * 100
    };
}

function fitPoissonFrom1x2(odd1, oddX, odd2) {
    const target = normalize1x2(odd1, oddX, odd2);
    if (!target) return { available: false, status: 'ONE_X_TWO_ODDS_UNAVAILABLE' };
    let best = null;
    const evaluate = (lh, la) => {
        const p = scoreProbabilities(lh, la, 10);
        const error = (p.homePct - target.homePct) ** 2 + (p.drawPct - target.drawPct) ** 2 + (p.awayPct - target.awayPct) ** 2;
        if (!best || error < best.error) best = { lambdaHome: lh, lambdaAway: la, error, probabilities: p };
    };
    for (let lh = 0.2; lh <= 3.2; lh += 0.08) {
        for (let la = 0.2; la <= 3.2; la += 0.08) evaluate(round(lh, 3), round(la, 3));
    }
    const coarse = best;
    for (let lh = Math.max(0.05, coarse.lambdaHome - 0.16); lh <= coarse.lambdaHome + 0.16; lh += 0.01) {
        for (let la = Math.max(0.05, coarse.lambdaAway - 0.16); la <= coarse.lambdaAway + 0.16; la += 0.01) evaluate(round(lh, 3), round(la, 3));
    }
    return {
        available: true,
        status: best.error <= 8 ? 'ONE_X_TWO_POISSON_STRESS_USABLE' : 'ONE_X_TWO_POISSON_STRESS_WEAK_FIT',
        lambdaHome: round(best.lambdaHome, 3),
        lambdaAway: round(best.lambdaAway, 3),
        totalLambda: round(best.lambdaHome + best.lambdaAway, 3),
        fitRmsePp: round(Math.sqrt(best.error / 3), 3),
        target,
        probabilities: Object.fromEntries(Object.entries(best.probabilities).map(([k, v]) => [k, round(v, 3)]))
    };
}

function stressProbabilityForPrediction(prediction, fit) {
    if (!fit?.available) return null;
    const p = fit.probabilities || {};
    const key = upper(prediction).replace(/\s+/g, '');
    if (key === '1') return p.homePct;
    if (key === 'X') return p.drawPct;
    if (key === '2') return p.awayPct;
    if (key.includes('O2.5') || key.includes('OVER2.5')) return p.over25Pct;
    if (key.includes('U2.5') || key.includes('UNDER2.5')) return p.under25Pct;
    if (key === 'GG' || key.includes('BTTSYES')) return p.bttsPct;
    if (key === 'NG' || key.includes('BTTSNO')) return p.noBttsPct;
    return null;
}

function daysToKickoff(matchDate, now = new Date()) {
    const kickoff = new Date(matchDate);
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(kickoff.getTime()) || Number.isNaN(current.getTime())) return null;
    return (kickoff.getTime() - current.getTime()) / 86400000;
}

function maturityMultiplier(days) {
    if (days === null) return 0.5;
    if (days > 21) return 0.25;
    if (days > 14) return 0.35;
    if (days > 7) return 0.5;
    if (days > 3) return 0.65;
    if (days > 1) return 0.8;
    if (days >= 0) return 1;
    return 0;
}

function maturityScore(days, lineupStatus, xgMode) {
    let score = days === null ? 45 : days > 21 ? 20 : days > 14 ? 30 : days > 7 ? 45 : days > 3 ? 60 : days > 1 ? 72 : 85;
    const lineup = upper(lineupStatus);
    if (lineup.includes('CONFIRMED') && !lineup.includes('NOT')) score += 10;
    else if (lineup.includes('NOT_CONFIRMED') || lineup.includes('UNKNOWN')) score -= 8;
    const xg = upper(xgMode);
    if (xg.includes('STRONG_REAL_XG')) score += 8;
    else if (xg.includes('PROXY') || xg.includes('PRIOR')) score -= 8;
    return round(clamp(score), 1);
}

function conservativeAction(currentAction, requestedAction) {
    const current = SEVERITY[currentAction] ?? 2;
    const requested = SEVERITY[requestedAction] ?? 2;
    return requested > current ? requestedAction : currentAction;
}

function buildReliabilityAssessment(input = {}) {
    const modelProbabilityPct = nullable(input.modelProbabilityPct ?? input.probabilityPct);
    const marketProbabilityPct = nullable(input.marketProbabilityPct);
    const fit = fitPoissonFrom1x2(input.odd1, input.oddX, input.odd2);
    const stressProbabilityPct = stressProbabilityForPrediction(input.prediction, fit);
    const days = daysToKickoff(input.matchDate, input.now || new Date());
    const xgMode = upper(input.xgEvidenceMode);
    const lineupStatus = upper(input.lineupStatus);
    const reliabilityScore = clamp(input.reliabilityScore, 0, 100);
    const dataClass = upper(input.dataClass);
    const maturity = maturityScore(days, lineupStatus, xgMode);

    const marketAnchor = marketProbabilityPct ?? (input.odd > 1 ? 100 / num(input.odd) : modelProbabilityPct);
    const stressAnchor = stressProbabilityPct ?? marketAnchor;
    const anchor = marketAnchor !== null && stressAnchor !== null ? 0.7 * marketAnchor + 0.3 * stressAnchor : (marketAnchor ?? stressAnchor ?? modelProbabilityPct);
    let modelWeight = days === null ? 0.4 : days > 21 ? 0.25 : days > 14 ? 0.35 : days > 7 ? 0.45 : days > 3 ? 0.55 : days > 1 ? 0.65 : 0.75;
    if (xgMode.includes('STRONG_REAL_XG')) modelWeight += 0.08;
    if (xgMode.includes('PROXY') || xgMode.includes('PRIOR')) modelWeight -= 0.08;
    if (lineupStatus.includes('CONFIRMED') && !lineupStatus.includes('NOT')) modelWeight += 0.05;
    if (dataClass.includes('PRIOR') || dataClass.includes('INATTENDIBILE')) modelWeight -= 0.18;
    modelWeight *= clamp(reliabilityScore / 70, 0.35, 1);
    modelWeight = clamp(modelWeight, 0.12, 0.85);

    const robustProbabilityPct = modelProbabilityPct !== null && anchor !== null
        ? anchor + modelWeight * (modelProbabilityPct - anchor)
        : modelProbabilityPct;
    const robustEvPct = robustProbabilityPct !== null && num(input.odd, 0) > 1
        ? robustProbabilityPct / 100 * num(input.odd) * 100 - 100
        : null;
    const crossMarketGapPp = modelProbabilityPct !== null && stressProbabilityPct !== null
        ? modelProbabilityPct - stressProbabilityPct
        : null;
    const marketModelGapPp = modelProbabilityPct !== null && marketAnchor !== null
        ? modelProbabilityPct - marketAnchor
        : null;

    const timingRisk = days === null ? 55 : days > 21 ? 90 : days > 14 ? 78 : days > 7 ? 62 : days > 3 ? 45 : days > 1 ? 30 : 15;
    const xgRisk = xgMode.includes('STRONG_REAL_XG') ? 15 : xgMode.includes('PROXY') ? 65 : xgMode.includes('PRIOR') ? 85 : 55;
    const lineupRisk = lineupStatus.includes('CONFIRMED') && !lineupStatus.includes('NOT') ? 10 : 65;
    const crossRisk = crossMarketGapPp === null ? 45 : Math.min(100, Math.abs(crossMarketGapPp) * 7.5);
    const reliabilityRisk = 100 - reliabilityScore;
    const epistemicUncertaintyScore = round(0.30 * timingRisk + 0.22 * xgRisk + 0.20 * crossRisk + 0.13 * lineupRisk + 0.15 * reliabilityRisk, 1);
    const uncertaintyHalfWidthPp = round(2 + epistemicUncertaintyScore * 0.08, 2);

    let multiplier = maturityMultiplier(days);
    const reasons = [`Maturità temporale ${round(days, 1)} giorni → ×${round(multiplier, 2)}`];
    if (lineupStatus.includes('NOT_CONFIRMED') || lineupStatus.includes('UNKNOWN') || !lineupStatus) {
        multiplier = Math.min(multiplier, 0.75); reasons.push('Formazioni non confermate → cap ×0,75');
    }
    if (!xgMode.includes('STRONG_REAL_XG')) {
        multiplier = Math.min(multiplier, xgMode.includes('PRIOR') ? 0.35 : 0.75); reasons.push(`xG ${xgMode || 'N/D'} → cap prudenziale`);
    }
    if (crossMarketGapPp !== null) {
        const absGap = Math.abs(crossMarketGapPp);
        if (absGap >= 12) { multiplier = Math.min(multiplier, 0.15); reasons.push(`Conflitto cross-market ${round(absGap, 2)} pp → ×0,15`); }
        else if (absGap >= 10) { multiplier = Math.min(multiplier, 0.25); reasons.push(`Conflitto cross-market ${round(absGap, 2)} pp → ×0,25`); }
        else if (absGap >= 7) { multiplier = Math.min(multiplier, 0.4); reasons.push(`Conflitto cross-market ${round(absGap, 2)} pp → ×0,40`); }
        else if (absGap >= 4) { multiplier = Math.min(multiplier, 0.65); reasons.push(`Conflitto cross-market ${round(absGap, 2)} pp → ×0,65`); }
    }
    if (robustEvPct !== null) {
        if (robustEvPct <= -3) { multiplier = 0; reasons.push(`EV robusto ${round(robustEvPct, 2)}% ≤ -3% → nessuno stake`); }
        else if (robustEvPct <= 0) { multiplier = 0; reasons.push(`EV robusto ${round(robustEvPct, 2)}% non positivo → nessuno stake`); }
        else if (robustEvPct < 2) { multiplier = Math.min(multiplier, 0.5); reasons.push(`EV robusto ${round(robustEvPct, 2)}% debole → ×0,50`); }
    }
    if (dataClass.includes('INATTENDIBILE') || dataClass.includes('PRIOR') || reliabilityScore < 35) {
        multiplier = 0; reasons.push('Classe dati/prior o affidabilità insufficiente → nessuno stake');
    }
    multiplier = round(clamp(multiplier, 0, 1), 3);

    let requestedAction = input.currentAction || ACTIONS.WATCHLIST;
    if (multiplier === 0 || epistemicUncertaintyScore >= 78) requestedAction = ACTIONS.MODEL_RISK;
    else if (multiplier <= 0.4 || epistemicUncertaintyScore >= 55) requestedAction = ACTIONS.WATCHLIST;
    const effectiveAction = conservativeAction(input.currentAction || ACTIONS.WATCHLIST, requestedAction);
    const status = multiplier === 0 ? 'RELIABILITY_GUARD_NO_STAKE' : multiplier < 1 ? 'RELIABILITY_GUARD_REDUCED' : 'RELIABILITY_GUARD_CLEAR';

    return {
        version: CALCIO_CROSS_MARKET_RELIABILITY_VERSION,
        status,
        prediction: input.prediction,
        daysToKickoff: days === null ? null : round(days, 3),
        analysisMaturityScore: maturity,
        modelProbabilityPct: modelProbabilityPct === null ? null : round(modelProbabilityPct, 3),
        marketProbabilityPct: marketAnchor === null ? null : round(marketAnchor, 3),
        stressProbabilityPct: stressProbabilityPct === null ? null : round(stressProbabilityPct, 3),
        crossMarketGapPp: crossMarketGapPp === null ? null : round(crossMarketGapPp, 3),
        marketModelGapPp: marketModelGapPp === null ? null : round(marketModelGapPp, 3),
        robustProbabilityPct: robustProbabilityPct === null ? null : round(robustProbabilityPct, 3),
        robustEvPct: robustEvPct === null ? null : round(robustEvPct, 3),
        modelWeight: round(modelWeight, 3),
        epistemicUncertaintyScore,
        uncertaintyHalfWidthPp,
        robustIntervalPct: robustProbabilityPct === null ? null : {
            low: round(clamp(robustProbabilityPct - uncertaintyHalfWidthPp), 3),
            high: round(clamp(robustProbabilityPct + uncertaintyHalfWidthPp), 3)
        },
        stakeMultiplier: multiplier,
        currentAction: input.currentAction || null,
        effectiveAction,
        reasons,
        poissonStress: fit,
        operationalAuthority: 'ONE_WAY_REDUCE_OR_ZERO_ONLY',
        probabilityProductionChanged: false,
        noHistoricalCalibrationMode: true,
        stakeAmountAuthority: 'DIAGNOSTIC_ONLY_PATCH26EC',
        calculatedAt: new Date().toISOString()
    };
}

function applyReportGuard(report = {}, assessment = {}) {
    const action = conservativeAction(report.action || ACTIONS.WATCHLIST, assessment.effectiveAction || ACTIONS.WATCHLIST);
    return {
        ...report,
        action,
        displayAction: action,
        unifiedAction: action,
        ipmAction: action,
        persistedAction: action,
        reliabilityGuard: assessment,
        canonicalDeepScan: {
            ...(report.canonicalDeepScan || {}),
            canonicalAction: action,
            conservativeSource: assessment.effectiveAction !== report.action
                ? 'PATCH26E_B_CROSS_MARKET_MATURITY_GUARD'
                : (report.canonicalDeepScan?.conservativeSource || 'PATCH26E_A_FINAL_MARKET_STATE'),
            reliabilityGuardVersion: CALCIO_CROSS_MARKET_RELIABILITY_VERSION
        }
    };
}

function applyStakeGuard(decision = {}, assessment = {}, bankroll = 0) {
    const rawStake = Math.max(0, num(decision.prePortfolioCapStake ?? decision.operationalStake ?? decision.theoreticalStake, 0));
    const days = assessment.daysToKickoff;
    const maxBankrollPct = days === null ? 0.15 : days > 21 ? 0.15 : days > 14 ? 0.20 : days > 7 ? 0.30 : 0.50;
    const maturityCap = Math.max(0, num(bankroll, 0) * maxBankrollPct / 100);
    let adjusted = Math.min(rawStake * num(assessment.stakeMultiplier, 0), maturityCap || rawStake);
    adjusted = round(adjusted, 2);
    if (adjusted > 0 && adjusted < MINIMUM_OPERATIONAL_STAKE) adjusted = 0;
    const eligible = decision.eligible === true && adjusted >= MINIMUM_OPERATIONAL_STAKE;
    const reason = `${text(decision.reason)} | Affidabilità 26E-B: ${assessment.reasons.join('; ')}. Stake modello €${round(rawStake, 2)} → affidabilità €${round(adjusted, 2)}.`.replace(/^ \| /, '');
    return {
        ...decision,
        unadjustedPrePortfolioCapStake: rawStake,
        reliabilityAdjustedStake: adjusted,
        prePortfolioCapStake: adjusted,
        operationalStake: adjusted,
        estimatedProfit: adjusted * Math.max(0, num(decision.netExecutableOdd, 0) - 1),
        eligible,
        allowBet: eligible,
        status: eligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
        action: eligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
        gateStatus: eligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO',
        reason,
        reliabilityGuard: assessment,
        reliabilityGuardVersion: CALCIO_CROSS_MARKET_RELIABILITY_VERSION,
        maturityCapPct: maxBankrollPct,
        maturityCapStake: round(maturityCap, 2)
    };
}

function persistenceFields(assessment = {}, decision = {}) {
    return {
        calcio_cross_market_reliability_version: CALCIO_CROSS_MARKET_RELIABILITY_VERSION,
        calcio_cross_market_stress_status: assessment.poissonStress?.status || 'UNAVAILABLE',
        calcio_cross_market_stress_probability: assessment.stressProbabilityPct,
        calcio_cross_market_gap_pp: assessment.crossMarketGapPp,
        calcio_cross_market_lambda_home: assessment.poissonStress?.lambdaHome ?? null,
        calcio_cross_market_lambda_away: assessment.poissonStress?.lambdaAway ?? null,
        calcio_analysis_maturity_score: assessment.analysisMaturityScore,
        calcio_days_to_kickoff: assessment.daysToKickoff,
        calcio_epistemic_uncertainty_score: assessment.epistemicUncertaintyScore,
        calcio_robust_probability: assessment.robustProbabilityPct,
        calcio_robust_ev_pct: assessment.robustEvPct,
        calcio_reliability_stake_multiplier: assessment.stakeMultiplier,
        calcio_unadjusted_pre_cap_stake: decision.unadjustedPrePortfolioCapStake ?? null,
        calcio_reliability_adjusted_stake: decision.reliabilityAdjustedStake ?? null,
        calcio_reliability_guard_status: assessment.status,
        calcio_reliability_guard_audit: JSON.stringify(assessment)
    };
}

module.exports = {
    CALCIO_CROSS_MARKET_RELIABILITY_VERSION,
    ACTIONS,
    normalize1x2,
    fitPoissonFrom1x2,
    stressProbabilityForPrediction,
    buildReliabilityAssessment,
    applyReportGuard,
    applyStakeGuard,
    persistenceFields,
    daysToKickoff,
    scoreProbabilities
};
