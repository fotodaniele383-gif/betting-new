'use strict';
// PF paper authority on the *main* Calcio portfolio. Never usable outside SAFE13 manual paper.
// Does not assert statistical calibration; values are explicitly exploratory paper stakes.
const probabilityFirst = require('./calcioProbabilityFirst');
const stakeSafety = require('./calcioStakeSafetyContract'); // RECOVERY_R9_AUTHORITY
const VERSION = 'CALCIO_PF_MAIN_MANUAL_PAPER_V1_20261106';
const num = (x, fallback = null) => x === '' || x == null || !Number.isFinite(Number(x)) ? fallback : Number(x);
const round = (x,d=2) => Math.round((num(x,0)+Number.EPSILON)*10**d)/10**d;
const unique = values => [...new Set(values.filter(Boolean))];
function evaluate(input = {}) {
    if (process.env.SAFE13_MANUAL_PAPER !== '1') return null;
    const config = probabilityFirst.readConfig();
    if (config.mode !== 'PROBABILITY_FIRST' || config.mainPaperStakeEnabled !== true) return null;
    const data = input.dataQualityAssessment || {};
    const evidence = data.evidence || {};
    const odd = num(input.netExecutableOdd ?? input.odd);
    const p = num(input.productionProbabilityPct);
    const robust = num(input.robustProbabilityPct);
    const reliability = num(input.reliabilityScore);
    const bankroll = num(input.bankrollSnapshot);
    const days = num(input.daysToKickoff);
    const gap = num(input.crossMarketGapPp);
    const uncertainty = num(input.epistemicUncertaintyScore);
    const quotedAt = num(evidence.quoteAgeMinutes);
    const dataScore = num(data.score);
    const coverage = String(evidence.coverageMode || '').toUpperCase();
    const xg = String(evidence.xgEvidenceMode || '').toUpperCase();
    const invariant = stakeSafety.evaluate({
        robustProbabilityPct: input.robustProbabilityPct,
        robustEvPct: input.robustEvPct,
        netExecutableOdd: input.netExecutableOdd ?? input.odd,
        dataClass: evidence.dataClass,
        reliabilityGuard: input.reliabilityAssessment
    });
    const reasons = [...invariant.reasons];
    const cautions = [...(data.cautionReasons || [])];
    if (!(bankroll >= 400)) reasons.push('Bankroll paper inferiore a €400 per cap 0,5% e stake minimo €2.');
    if (!(odd >= config.minOdd && odd <= config.maxOdd)) reasons.push('Quota fuori fascia PF.');
    if (p === null || p < config.minProbabilityPct) reasons.push('Probabilità modello sotto soglia PF.');
    if (robust === null || robust < config.mainPaperMinRobustProbabilityPct) reasons.push('Probabilità prudenziale PF insufficiente.');
    if (reliability === null || reliability < config.mainPaperMinReliability) reasons.push('Affidabilità PF paper inferiore al limite sperimentale.');
    if (gap === null || Math.abs(gap) > config.mainPaperMaxGapPp) reasons.push('Disaccordo cross-market eccessivo o non disponibile.');
    if (uncertainty === null || uncertainty > 70) reasons.push('Incertezza epistemica eccessiva o non disponibile.');
    if (days === null || days < 0 || days > config.mainPaperMaxDays) reasons.push('Evento non nella finestra pre-match PF paper.');
    if (dataScore === null || dataScore < 60) reasons.push('Qualità evidenze strutturali sotto 60.');
    if (evidence.oddsCertified !== true || evidence.oddsOperationalEligible !== true || num(evidence.oddsSourceCount,0) < 2) reasons.push('Quote dirette multi-fonte non certificate.');
    if (evidence.identityCertified !== true) reasons.push('Identità evento o mercato non verificata.');
    if (quotedAt === null || quotedAt > 30 || quotedAt < 0) reasons.push('Quota assente o non fresca entro 30 minuti.');
    if (!['HISTORY_PROXY','HISTORY_PROXY_STRONG','STRONG_REAL_XG'].includes(coverage)) reasons.push('Storico squadra non sufficientemente coperto.');
    if (!xg || xg.includes('LEAGUE_PRIOR') || xg.includes('MISSING')) reasons.push('xG e proxy non disponibili.');
    // Never override genuine hard errors: only the *legacy threshold* blockers are policy-specific.
    for (const reason of data.hardReasons || []) {
        if (/^Affidabilit[aà] .+ sotto 55/i.test(reason)) continue;
        reasons.push(`Veto fonte: ${reason}`);
    }
    const accepted = reasons.length === 0;
    const targetStake = Math.min(config.mainPaperStakeEuro, bankroll === null ? 0 : Math.floor(bankroll * 0.005 * 100) / 100);
    const stake = accepted && targetStake >= 2 ? round(targetStake,2) : 0;
    if (accepted && stake < 2) reasons.push('Cap evento paper inferiore al minimo €2.');
    const eligible = stake >= 2 && reasons.length === 0;
    if (eligible) {
        data.pfPaperQualified = true;
        data.pfPaperVersion = VERSION;
        data.pfPaperReasons = ['Evidenze preliminari: soglia legacy di affidabilità non sovrascritta.'];
        cautions.push('PF PAPER: il veto Value/qualità legacy è conservato nell’audit. Nessuna certificazione di calibrazione.');
    }
    const explanation = eligible
        ? `PF PAPER autorizzato a €${stake.toFixed(2)}: probabilità modello ${round(p,2)}%, prudenziale ${round(robust,2)}%, quota ${round(odd,2)}. Kelly/EV e IPM diagnostici; qualità legacy ${data.status || 'N/D'}, affidabilità ${round(reliability,1)}.`
        : `PF PAPER non autorizzato: ${unique(reasons).join(' · ')}`;
    const result = {
        version: VERSION, policy: 'PF_PAPER_EXPLORATORY_MAIN', status: eligible ? 'PF_PAPER_MAIN_AUTHORIZED' : 'PF_PAPER_MAIN_NO_STAKE',
        eligible, allowBet: eligible, pfEvidenceGatePassed: eligible,
        bankrollSnapshot: round(bankroll,2), bankrollSource: input.bankrollSource || 'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT',
        netExecutableOdd: round(odd,4), productionProbabilityPct:p, robustProbabilityPct:robust,
        stakeProbabilityPct: robust, robustEvPct: invariant.recomputedRobustNetEvPct, stakeSafetyInvariant:invariant, epistemicUncertaintyScore:uncertainty,
        productionFullKellyPct: 0, stakeFullKellyPct:0, fractionalKelly:0,
        predictionIndexScore:num(input.predictionIndexScore), predictionIndexBand:{multiplier:eligible?1:0,maxBankrollPct:0.5,label:'PF_PAPER_ONLY'},
        modelStake:stake, reliabilityStake:stake, prePortfolioCapStake:stake, finalOperationalStake:stake,
        eventCapPct:0.5, eventCapStake:round((bankroll || 0)*0.005,2), minimumOperationalStake:2,
        timingPolicy:{code:'PF_MANUAL_PAPER_MAX_DAYS_'+config.mainPaperMaxDays},
        dataQualityStatus:data.status || null, dataQualityScore:data.score ?? null,
        effectiveAction:eligible?'WATCHLIST LOW EDGE':'ALTO RISCHIO',
        qualityFinalLabel:eligible?'PF PAPER · EVIDENZE PRELIMINARI':'PF PAPER · NON IDONEO',
        hardVetoes:unique(reasons), cautions:unique(cautions), reason:explanation,
        operationalAuthority:'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY', legacyStakeWritersAllowed:false,
        paperOnly:true, realMoney:false, automaticExecution:false,
        calculatedAt:new Date().toISOString(), crossMarketGapPp:gap
    };
    return result;
}
module.exports = {VERSION,evaluate};
