'use strict';

const CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION = 'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1';
const MINIMUM_OPERATIONAL_STAKE_EUR = 2;
const FRACTIONAL_KELLY = 0.15;

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullable(value) {
    // R61: missing observations must remain missing; Number(null) === 0 is unsafe.
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, n(value, min))); }
function round(value, decimals = 2) { const f = 10 ** decimals; return Math.round((n(value) + Number.EPSILON) * f) / f; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(text))]; }

function fullKellyPct(probabilityPct, odd) {
    const p = clamp(probabilityPct, 0, 100) / 100;
    const o = n(odd, 0);
    if (!(o > 1) || !(p > 0 && p < 1)) return 0;
    const value = ((o * p) - 1) / (o - 1) * 100;
    return value > 0 ? value : 0;
}

function stakeBand(indexScore) {
    const score = n(indexScore, 0);
    if (score < 60) return { multiplier: 0, maxBankrollPct: 0, label: 'NO_STAKE' };
    if (score < 70) return { multiplier: 0.35, maxBankrollPct: 0.50, label: 'MICRO' };
    if (score < 80) return { multiplier: 0.55, maxBankrollPct: 0.75, label: 'VALUE' };
    if (score < 90) return { multiplier: 0.75, maxBankrollPct: 1.25, label: 'FORTE' };
    return { multiplier: 1, maxBankrollPct: 2, label: 'TOP' };
}

function timingPolicy(daysToKickoff) {
    const days = nullable(daysToKickoff);
    if (days === null) return { code: 'UNKNOWN_TIMING', capPct: 0.20, minRobustEvPct: 4, maxUncertainty: 65 };
    if (days > 21) return { code: 'EARLY_GT_21D', capPct: 0.20, minRobustEvPct: 4, maxUncertainty: 65 };
    if (days > 14) return { code: 'EARLY_15_21D', capPct: 0.25, minRobustEvPct: 3, maxUncertainty: 68 };
    if (days > 7) return { code: 'WATCH_8_14D', capPct: 0.35, minRobustEvPct: 2, maxUncertainty: 72 };
    if (days > 3) return { code: 'MATURE_4_7D', capPct: 0.50, minRobustEvPct: 1, maxUncertainty: 76 };
    if (days > 1) return { code: 'PREMATCH_2_3D', capPct: 0.65, minRobustEvPct: 0.5, maxUncertainty: 80 };
    return { code: 'FINAL_WINDOW', capPct: 0.75, minRobustEvPct: 0, maxUncertainty: 85 };
}

// AUDIT07_BANKROLL_ZERO_FAIL_CLOSED
function resolveAnalysisBankrollSnapshot({ requestedBankroll, currentCalcioBankroll, fallback = 0 } = {}) {
    const requestedProvided = requestedBankroll !== undefined && requestedBankroll !== null && String(requestedBankroll).trim() !== '';
    const currentProvided = currentCalcioBankroll !== undefined && currentCalcioBankroll !== null && String(currentCalcioBankroll).trim() !== '';
    const requested = requestedProvided ? nullable(requestedBankroll) : null;
    const current = currentProvided ? nullable(currentCalcioBankroll) : null;

    if (requestedProvided) {
        const snapshot = requested !== null && requested >= 0 ? requested : 0;
        return {
            snapshot: round(snapshot, 2),
            source: snapshot > 0 ? 'REQUEST_CALCIO_BANKROLL' : 'REQUEST_CALCIO_BANKROLL_ZERO_FAIL_CLOSED',
            version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION
        };
    }

    if (currentProvided && current !== null && current >= 0) {
        return {
            snapshot: round(current, 2),
            source: current > 0 ? 'BANKROLL_MANAGER_CALCIO' : 'BANKROLL_MANAGER_CALCIO_ZERO_FAIL_CLOSED',
            version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION
        };
    }

    // Positive fallbacks are intentionally ignored by AUDIT07: missing/invalid bankroll is fail-closed.
    void fallback;
    return {
        snapshot: 0,
        source: 'BANKROLL_UNAVAILABLE_FAIL_CLOSED',
        version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION
    };
}

function evaluateStakeAuthority(input = {}) {
    const bankroll = Math.max(0, n(input.bankrollSnapshot ?? input.bankroll, 0));
    const odd = n(input.netExecutableOdd ?? input.odd, 0);
    const productionProbabilityPct = nullable(input.productionProbabilityPct ?? input.modelProbabilityPct);
    const robustProbabilityPct = nullable(input.robustProbabilityPct ?? input.reliabilityAssessment?.robustProbabilityPct);
    const robustEvPct = nullable(input.robustEvPct ?? input.reliabilityAssessment?.robustEvPct);
    const uncertainty = n(input.epistemicUncertaintyScore ?? input.reliabilityAssessment?.epistemicUncertaintyScore, 100);
    const days = nullable(input.daysToKickoff ?? input.reliabilityAssessment?.daysToKickoff);
    const indexScore = n(input.predictionIndexScore, 0);
    const reliabilityScore = n(input.reliabilityScore, 0);
    const dataQuality = input.dataQualityAssessment || {};
    const timing = timingPolicy(days);
    const band = stakeBand(indexScore);
    const pStake = productionProbabilityPct !== null && robustProbabilityPct !== null
        ? Math.min(productionProbabilityPct, robustProbabilityPct)
        : robustProbabilityPct ?? productionProbabilityPct;
    const productionKellyPct = productionProbabilityPct === null ? 0 : fullKellyPct(productionProbabilityPct, odd);
    const stakeKellyPct = pStake === null ? 0 : fullKellyPct(pStake, odd);
    const modelStakeRaw = bankroll * productionKellyPct / 100 * FRACTIONAL_KELLY * band.multiplier;
    const modelCap = bankroll * band.maxBankrollPct / 100;
    const modelStake = round(Math.min(modelStakeRaw, modelCap || 0), 2);

    const hardVetoes = [];
    const cautions = [];
    if (!(bankroll > 0)) hardVetoes.push('Bankroll snapshot non valido.');
    if (!(odd > 1)) hardVetoes.push('Quota eseguibile non valida.');
    if (pStake === null) hardVetoes.push('Probabilità stake non disponibile.');
    if (indexScore < 60) hardVetoes.push(`Indice Predizione ${round(indexScore, 1)}/100 sotto 60.`);
    if (reliabilityScore < 55) hardVetoes.push(`Affidabilità ${round(reliabilityScore, 1)}/100 sotto 55.`);
    if (dataQuality.blocking === true) hardVetoes.push(...(dataQuality.hardReasons || ['Qualità dati bloccante.']));
    if (robustEvPct === null) hardVetoes.push('EV robusto non disponibile.');
    else if (robustEvPct <= 0) hardVetoes.push(`EV robusto ${round(robustEvPct, 2)}% non positivo.`);
    if (robustEvPct !== null && robustEvPct > 0 && robustEvPct < timing.minRobustEvPct) {
        hardVetoes.push(`EV robusto ${round(robustEvPct, 2)}% sotto soglia ${timing.minRobustEvPct}% per ${timing.code}.`);
    }
    if (uncertainty > timing.maxUncertainty) hardVetoes.push(`Incertezza epistemica ${round(uncertainty, 1)}/100 sopra ${timing.maxUncertainty}.`);
    if (stakeKellyPct <= 0) hardVetoes.push('Kelly sulla probabilità prudenziale non positivo.');

    if (dataQuality.status && dataQuality.status !== 'DATA_QUALITY_CERTIFIED') cautions.push(`Qualità dati ${dataQuality.status}.`);
    if (days !== null && days > 7) cautions.push(`Analisi anticipata di ${round(days, 1)} giorni.`);
    if (upper(input.lineupStatus).includes('NOT_CONFIRMED') || !text(input.lineupStatus)) cautions.push('Formazioni non confermate.');
    if (!upper(input.xgEvidenceMode).includes('STRONG_REAL_XG')) cautions.push(`xG ${upper(input.xgEvidenceMode) || 'N/D'}.`);

    const qualityCapPct = dataQuality.status === 'DATA_QUALITY_CERTIFIED' ? band.maxBankrollPct
        : dataQuality.status === 'DATA_QUALITY_LIMITED' ? Math.min(band.maxBankrollPct, 0.35)
            : Math.min(band.maxBankrollPct, 0.20);
    const eventCapPct = Math.min(band.maxBankrollPct, timing.capPct, qualityCapPct);
    const eventCapStake = bankroll * eventCapPct / 100;
    const reliabilityStakeRaw = bankroll * stakeKellyPct / 100 * FRACTIONAL_KELLY * band.multiplier;
    let reliabilityStake = hardVetoes.length ? 0 : round(Math.min(reliabilityStakeRaw, eventCapStake), 2);
    if (reliabilityStake > 0 && reliabilityStake < MINIMUM_OPERATIONAL_STAKE_EUR) {
        hardVetoes.push(`Stake €${round(reliabilityStake, 2)} sotto il minimo operativo €${MINIMUM_OPERATIONAL_STAKE_EUR}.`);
        reliabilityStake = 0;
    }

    const eligible = reliabilityStake >= MINIMUM_OPERATIONAL_STAKE_EUR && hardVetoes.length === 0;
    let effectiveAction = text(input.currentAction || 'WATCHLIST LOW EDGE');
    if (!eligible && (robustEvPct ?? -1) <= 0) effectiveAction = 'RISCHIO MODELLO';
    if (dataQuality.blocking === true || reliabilityScore < 35 || indexScore < 45) effectiveAction = 'ALTO RISCHIO';
    const qualityFinalLabel = eligible
        ? (dataQuality.status === 'DATA_QUALITY_CERTIFIED' ? 'APPROVATA' : 'APPROVATA CON CAP')
        : effectiveAction === 'ALTO RISCHIO' ? 'BLOCCATA HARD'
            : effectiveAction === 'RISCHIO MODELLO' ? 'BLOCCATA SOFT'
                : 'WATCHLIST MICRO';
    const status = eligible ? 'STAKE_AUTHORITY_AUTHORIZED' : 'STAKE_AUTHORITY_NO_STAKE';
    const reason = eligible
        ? `Stake unico autorizzato: p prudenziale ${round(pStake, 2)}%, EV robusto ${round(robustEvPct, 2)}%, Kelly ${round(stakeKellyPct, 2)}%, cap evento ${round(eventCapPct, 2)}% su bankroll €${round(bankroll, 2)}.`
        : `Stake €0: ${unique(hardVetoes).join(' · ')}`;

    return {
        version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
        status,
        eligible,
        allowBet: eligible,
        bankrollSnapshot: round(bankroll, 2),
        bankrollSource: text(input.bankrollSource || 'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT'),
        netExecutableOdd: round(odd, 4),
        productionProbabilityPct: productionProbabilityPct === null ? null : round(productionProbabilityPct, 3),
        robustProbabilityPct: robustProbabilityPct === null ? null : round(robustProbabilityPct, 3),
        stakeProbabilityPct: pStake === null ? null : round(pStake, 3),
        robustEvPct: robustEvPct === null ? null : round(robustEvPct, 3),
        productionFullKellyPct: round(productionKellyPct, 3),
        stakeFullKellyPct: round(stakeKellyPct, 3),
        fractionalKelly: FRACTIONAL_KELLY,
        predictionIndexScore: round(indexScore, 2),
        predictionIndexBand: band,
        modelStake,
        reliabilityStake,
        prePortfolioCapStake: reliabilityStake,
        finalOperationalStake: reliabilityStake,
        eventCapPct: round(eventCapPct, 3),
        eventCapStake: round(eventCapStake, 2),
        minimumOperationalStake: MINIMUM_OPERATIONAL_STAKE_EUR,
        timingPolicy: timing,
        dataQualityStatus: dataQuality.status || null,
        dataQualityScore: dataQuality.score ?? null,
        effectiveAction,
        qualityFinalLabel,
        hardVetoes: unique(hardVetoes),
        cautions: unique([...(dataQuality.cautionReasons || []), ...cautions]),
        reason,
        operationalAuthority: 'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY',
        legacyStakeWritersAllowed: false,
        calculatedAt: new Date().toISOString()
    };
}

function applyToDecision(decision = {}, authority = {}) {
    const finalStake = n(authority.prePortfolioCapStake, 0);
    const eligible = authority.eligible === true && finalStake >= MINIMUM_OPERATIONAL_STAKE_EUR;
    const odd = n(authority.netExecutableOdd ?? decision.netExecutableOdd, 0);
    return {
        ...decision,
        theoreticalStake: n(authority.modelStake, 0),
        unadjustedPrePortfolioCapStake: n(authority.modelStake, 0),
        reliabilityAdjustedStake: finalStake,
        prePortfolioCapStake: finalStake,
        operationalStake: finalStake,
        estimatedProfit: finalStake * Math.max(0, odd - 1),
        eligible,
        allowBet: eligible,
        status: eligible ? 'UNIFIED_STAKE_AUTHORITY_AUTHORIZED' : 'UNIFIED_STAKE_AUTHORITY_NO_STAKE',
        action: eligible ? 'BET_ALLOWED_UNIFIED_STAKE_AUTHORITY' : 'ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY',
        gateStatus: eligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO',
        reason: authority.reason,
        stakeAuthority: authority,
        stakeAuthorityVersion: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
        bankrollSnapshot: authority.bankrollSnapshot,
        netExecutableOdd: authority.netExecutableOdd || decision.netExecutableOdd
    };
}

function finalNarrative(authority = {}, prediction = '') {
    const selection = text(prediction || 'selezione');
    if (authority.eligible) {
        return `${authority.effectiveAction}: ${selection} autorizzata a €${round(authority.prePortfolioCapStake, 2)} con probabilità prudenziale ${round(authority.stakeProbabilityPct, 2)}% ed EV robusto ${round(authority.robustEvPct, 2)}%.`;
    }
    return `${authority.effectiveAction}: ${selection} senza stake. ${authority.hardVetoes?.[0] || authority.reason || 'Affidabilità insufficiente.'}`;
}

function persistenceFields(authority = {}) {
    return {
        calcio_stake_authority_version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
        calcio_stake_authority_status: authority.status || null,
        calcio_stake_authority_model_stake: authority.modelStake ?? null,
        calcio_stake_authority_reliability_stake: authority.reliabilityStake ?? null,
        calcio_stake_authority_pre_cap_stake: authority.prePortfolioCapStake ?? null,
        calcio_stake_authority_final_stake: authority.finalOperationalStake ?? null,
        calcio_stake_probability_pct: authority.stakeProbabilityPct ?? null,
        calcio_stake_full_kelly_pct: authority.stakeFullKellyPct ?? null,
        calcio_stake_fractional_kelly: authority.fractionalKelly ?? FRACTIONAL_KELLY,
        calcio_stake_event_cap_pct: authority.eventCapPct ?? null,
        calcio_stake_minimum_eur: authority.minimumOperationalStake ?? MINIMUM_OPERATIONAL_STAKE_EUR,
        calcio_stake_bankroll_snapshot: authority.bankrollSnapshot ?? null,
        calcio_stake_bankroll_source: authority.bankrollSource || null,
        calcio_stake_authority_reason: authority.reason || null,
        calcio_stake_authority_audit: JSON.stringify(authority || {}),
        calcio_bankroll_snapshot_consistent: 1,
        calcio_final_narrative_version: CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
        calcio_final_narrative: finalNarrative(authority)
    };
}

module.exports = {
    CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
    MINIMUM_OPERATIONAL_STAKE_EUR,
    FRACTIONAL_KELLY,
    fullKellyPct,
    stakeBand,
    timingPolicy,
    resolveAnalysisBankrollSnapshot,
    evaluateStakeAuthority,
    applyToDecision,
    finalNarrative,
    persistenceFields
};
