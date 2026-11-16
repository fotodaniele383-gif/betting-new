'use strict';
const independentR11 = require('./calcioIndependentAiR11');

const CALCIO_DEEPSCAN_FINAL_STATE_VERSION = 'BETTINGAPP_R13_DEEPSCAN_NONCIRCULAR_20261108';

const ACTIONS = Object.freeze({
    VALUE: 'VALUE CONFERMATO / MICRO',
    EDGE: 'EDGE TECNICO',
    WATCHLIST: 'WATCHLIST LOW EDGE',
    MODEL_RISK: 'RISCHIO MODELLO',
    HIGH_RISK: 'ALTO RISCHIO'
});

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, num(value, min))); }
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((num(value) + Number.EPSILON) * factor) / factor;
}
function clone(value, fallback = null) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
}
function finiteFirst(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function pillarMap(report = {}) {
    const map = new Map();
    for (const pillar of Array.isArray(report.pillars) ? report.pillars : []) {
        map.set(upper(pillar.name), pillar);
    }
    const get = (...terms) => {
        for (const [name, pillar] of map.entries()) {
            if (terms.some(term => name.includes(term))) return pillar;
        }
        return null;
    };
    return { get };
}

function riskStatus(risk) {
    const r = clamp(risk);
    if (r >= 80) return 'FAIL';
    if (r >= 60) return 'WARN_HIGH';
    if (r >= 38) return 'WARN';
    return 'PASS';
}

function buildPillar(name, risk, weight, summary, evidence = []) {
    const normalized = round(clamp(risk), 1);
    return {
        name,
        risk: normalized,
        weight,
        contribution: round(normalized * weight, 2),
        status: riskStatus(normalized),
        summary,
        evidence: [...new Set((evidence || []).filter(Boolean).map(text))].slice(0, 6)
    };
}

function sourceConfidence(report = {}) {
    const home = num(report.medicalNews?.home?.confidence, 0);
    const away = num(report.medicalNews?.away?.confidence, 0);
    const sourceImpact = num(report.sourceMatchImpactConfidence ?? report.sourceIntelligence?.matchImpactConfidence, 0);
    const values = [home, away, sourceImpact].filter(value => value > 0);
    return values.length ? Math.min(...values) : 0;
}

function dataClassRisk(dataClass = '') {
    const cls = upper(dataClass);
    if (cls.includes('INATTENDIBILE') || cls.includes('PRIOR')) return 92;
    if (cls.includes('ATTENDIBILE')) return 34;
    if (cls.includes('BUONA')) return 24;
    if (cls.includes('OTTIMA') || cls.includes('ALTA')) return 16;
    return 50;
}

function recalculatePillars(report = {}, context = {}) {
    const old = pillarMap(report);
    const oldMarket = num(old.get('MARKET')?.risk, 45);
    const oldTactical = num(old.get('TATTICA', 'XG')?.risk, 45);
    const oldTeam = num(old.get('TEAM NEWS', 'MEDICAL')?.risk, 45);
    const oldMotivation = num(old.get('MOTIVAZIONE', 'CALENDARIO')?.risk, 45);
    const oldOverconfidence = num(old.get('OVERCONFIDENCE')?.risk, 45);
    const oldData = num(old.get('DATA QUALITY', 'COPERTURA')?.risk, 45);

    const edge = num(context.edgePp ?? context.edge_pp, 0);
    const ev = num(context.evPct ?? context.ev_pct, 0);
    const odd = num(context.odd, 0);
    const reliability = clamp(context.reliabilityScore, 0, 100);
    const reportModelProbability = finiteFirst(report.marketSummary?.modelProbabilityPct, report.finalMarket?.probability);
    const reportMarketProbability = finiteFirst(report.marketSummary?.bookmakerFairProbabilityPct, report.marketSummary?.marketProbabilityPct);
    const reportGap = reportModelProbability !== null && reportMarketProbability !== null
        ? Math.abs(reportModelProbability - reportMarketProbability)
        : null;
    const disagreement = Math.abs(finiteFirst(context.disagreementPp, report.probabilityIntegrity?.maxDisagreementPp, reportGap, 0));
    const marketGap = Math.abs(finiteFirst(context.modelMarketGapPp, reportGap, disagreement, 0));
    const selectedPremium = Math.max(0, num(context.selectedPremiumPct, 0));
    const xgMode = upper(context.xgEvidenceMode);
    const lineup = upper(context.lineupStatus || report.professionalAudit?.lineupNews?.status);
    const timing = upper(context.timingStatus || report.professionalAudit?.timing?.status);
    const sourceConf = sourceConfidence(report);
    const dataRiskBase = dataClassRisk(context.dataClass);

    let marketRisk = edge <= 0 ? 92 : edge < 1 ? 73 : edge < 2 ? 58 : edge < 3 ? 44 : edge < 5 ? 29 : 20;
    marketRisk += Math.min(22, disagreement * 2.2);
    marketRisk += selectedPremium > 8 ? 18 : selectedPremium > 5 ? 9 : 0;
    marketRisk = 0.65 * marketRisk + 0.35 * oldMarket;

    let tacticalRisk = oldTactical;
    if (!xgMode || xgMode.includes('PROXY') || xgMode.includes('PRIOR')) tacticalRisk += 10;
    if (xgMode.includes('STRONG_REAL_XG')) tacticalRisk -= 10;
    if (marketGap >= 8) tacticalRisk += 12;
    else if (marketGap >= 5) tacticalRisk += 6;

    let teamRisk = oldTeam;
    if (sourceConf <= 0) teamRisk = Math.max(teamRisk, 62);
    else if (sourceConf < 20) teamRisk = Math.max(teamRisk, 55);
    else if (sourceConf < 40) teamRisk = Math.max(teamRisk, 42);
    if (lineup.includes('NOT_CONFIRMED') || lineup.includes('UNKNOWN')) teamRisk += 8;
    if (context.selectedIssues === true) teamRisk = Math.max(teamRisk, 84);

    let motivationRisk = oldMotivation;
    if (timing.includes('EARLY')) motivationRisk = Math.max(motivationRisk, 48);
    if (timing.includes('LATE') || timing.includes('CLOSE')) motivationRisk -= 5;

    let overconfidenceRisk = oldOverconfidence;
    if (edge >= 3 && reliability < 55) overconfidenceRisk += 20;
    if (marketGap >= 10) overconfidenceRisk += 25;
    else if (marketGap >= 7) overconfidenceRisk += 15;
    else if (marketGap >= 4) overconfidenceRisk += 8;
    if (ev >= 8 && edge < 3) overconfidenceRisk += 8;

    let dataRisk = 0.55 * dataRiskBase + 0.25 * (100 - reliability) + 0.20 * oldData;
    if (sourceConf < 20) dataRisk += 8;
    if (!xgMode || xgMode.includes('PROXY') || xgMode.includes('PRIOR')) dataRisk += 8;

    const pillars = [
        buildPillar('Market traps / no-vig reference', marketRisk, 0.28,
            'Ricalcolato con edge, disaccordo modello-mercato e premio della quota finali.',
            [`Edge finale ${round(edge, 2)} pp`, `EV finale ${round(ev, 2)}%`, `Disaccordo ${round(disagreement, 2)} pp`, odd ? `Quota ${round(odd, 2)}` : null]),
        buildPillar('Tattica, xG e market regime', tacticalRisk, 0.20,
            'Ricalcolato sulla qualità xG/proxy e sulla coerenza tra modello e mercato.',
            [xgMode ? `xG ${xgMode}` : 'xG non dichiarato', `Gap modello-mercato ${round(marketGap, 2)} pp`]),
        buildPillar('Team news / medical / assenze', teamRisk, 0.20,
            'L’assenza di segnali critici non è trattata come evidenza positiva quando la copertura è debole.',
            [`Confidenza fonti minima ${round(sourceConf, 0)}%`, lineup ? `Lineup ${lineup}` : null]),
        buildPillar('Motivazione / calendario / rotazioni', motivationRisk, 0.12,
            'Ricalcolato sullo stato temporale e sui guardrail professionali disponibili.',
            [timing ? `Timing ${timing}` : null]),
        buildPillar('Overconfidence modello', overconfidenceRisk, 0.12,
            'Misura il rischio che edge e narrativa superino l’autorità effettiva dei dati.',
            [`Affidabilità ${round(reliability, 1)}/100`, `Gap modello-mercato ${round(marketGap, 2)} pp`]),
        buildPillar('Data quality / copertura fonti', dataRisk, 0.08,
            'Ricalcolato su classe dati, affidabilità, copertura news e qualità xG.',
            [`Classe dati ${text(context.dataClass) || 'N/D'}`, `Affidabilità ${round(reliability, 1)}/100`, `Confidenza fonti ${round(sourceConf, 0)}%`])
    ];
    const score = round(pillars.reduce((sum, pillar) => sum + pillar.contribution, 0), 1);
    return {
        pillars,
        score,
        failCount: pillars.filter(p => p.status === 'FAIL').length,
        highWarnCount: pillars.filter(p => p.status === 'WARN_HIGH').length,
        warnCount: pillars.filter(p => p.status === 'WARN' || p.status === 'WARN_HIGH').length,
        sourceConfidencePct: round(sourceConf, 1)
    };
}

function classifyFinalState(context = {}, assessment = {}) {
    const edge = num(context.edgePp, 0);
    const ev = num(context.evPct, 0);
    const reliability = clamp(context.reliabilityScore, 0, 100);
    // R62: The IPM already includes DeepScan. Do not use that output to classify
    // DeepScan itself: IPM -> HIGH_RISK -> IPM is a circular penalty.
    // Independent pillars, edge, EV, reliability and data certification remain active.
    const dataClass = upper(context.dataClass);
    const finalizationCertified = context.finalizationCertified !== false;
    const risk = num(assessment.score, 100);

    // R13: incomplete evidence is NOT an adverse finding and cannot on its own
    // force a red DeepScan. Monetary Authority/R9 separately continues to deny
    // stake for incomplete sources, negative robust EV and low reliability.
    // Previously DATA_CLASS -> RED DeepScan -> lower IPM -> DATA_CLASS was a
    // circular, multiply counted zero-stake feedback loop.
    if (!finalizationCertified || edge <= -1 || risk >= 72) {
        return { class: 'HIGH_RISK', action: ACTIONS.HIGH_RISK, reason: 'Risultato non finalizzato, edge negativo oppure rischio qualitativo elevato.' };
    }
    if (dataClass.includes('INATTENDIBILE') || dataClass.includes('PRIOR') || reliability < 25) {
        return { class: 'WATCHLIST', action: ACTIONS.WATCHLIST, reason: 'Copertura parziale: valutazione qualitativa possibile, autorizzazione stake separata e bloccata.' };
    }
    if (reliability < 45 || edge < 1 || risk >= 55) {
        return { class: 'MODEL_RISK', action: ACTIONS.MODEL_RISK, reason: 'Il mercato è finalizzato, ma il rischio modello/dati resta elevato.' };
    }
    if (edge < 2 || ev < 2 || risk >= 40) {
        return { class: 'WATCHLIST', action: ACTIONS.WATCHLIST, reason: 'Segnale finale valido ma edge, IPM o robustezza richiedono watchlist.' };
    }
    if (reliability >= 60 && edge >= 4 && ev >= 5 && risk < 32) {
        return { class: 'VALUE', action: ACTIONS.VALUE, reason: 'Edge finale, affidabilità e rischio qualitativo sono coerenti con un micro-value.' };
    }
    return { class: 'TECH_EDGE', action: ACTIONS.EDGE, reason: 'Edge tecnico finale positivo con autorità limitata e stake controllato.' };
}

function qualityLabel(action = '') {
    const a = upper(action);
    if (a.includes('VALUE CONFERMATO')) return 'APPROVATA';
    if (a.includes('EDGE TECNICO')) return 'APPROVATA CON CAP';
    if (a.includes('WATCHLIST')) return 'WATCHLIST MICRO';
    if (a.includes('RISCHIO MODELLO')) return 'BLOCCATA SOFT';
    return 'BLOCCATA HARD';
}

function finalizeCandidateReport(report = {}, context = {}) {
    const assessment = recalculatePillars(report, context);
    const classification = classifyFinalState(context, assessment);
    const rawAction = text(report.rawAction || report.signalAction || report.action || report.displayAction);
    const signalAction = text(report.signalAction || rawAction || report.action);
    const canonicalDeepScan = {
        ...(clone(report.canonicalDeepScan, {}) || {}),
        rawAction,
        canonicalClass: classification.class,
        canonicalAction: classification.action,
        conservativeSource: 'PATCH26E_A_FINAL_MARKET_STATE',
        finalStateRecalculated: true,
        finalStateVersion: CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
        timingAdvisory: report.canonicalDeepScan?.timingAdvisory || (upper(report.deepScanAdvisory?.mode).includes('WAIT') ? 'WAIT_IN_PLAY' : null),
        advisoryHasStakeAuthority: false
    };
    const advisory = clone(report.deepScanAdvisory, {}) || {};
    const rationale = `${classification.action}: ${classification.reason}`;
    advisory.rationale = rationale;
    advisory.confidence = classification.class === 'HIGH_RISK' ? 'MOLTO BASSA'
        : classification.class === 'MODEL_RISK' ? 'BASSA'
            : classification.class === 'WATCHLIST' ? 'MEDIA/BASSA' : 'MEDIA';
    return {
        ...report,
        rawAction,
        signalAction,
        operationalAction: classification.action,
        action: classification.action,
        displayAction: classification.action,
        unifiedAction: classification.action,
        ipmAction: classification.action,
        persistedAction: classification.action,
        riskLevel: classification.class,
        riskScore: assessment.score,
        pillars: assessment.pillars,
        deepScanAdvisory: advisory,
        canonicalDeepScan,
        finalStateDeepScan: {
            version: CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
            action: classification.action,
            class: classification.class,
            reason: classification.reason,
            qualityLabel: qualityLabel(classification.action),
            riskScore: assessment.score,
            sourceConfidencePct: assessment.sourceConfidencePct,
            edgePp: round(context.edgePp, 2),
            evPct: round(context.evPct, 2),
            reliabilityScore: round(context.reliabilityScore, 2),
            predictionIndexScore: round(context.predictionIndexScore, 2),
            finalizationCertified: context.finalizationCertified !== false,
            recalculatedAt: new Date().toISOString()
        },
        deepScanActionVersion: CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
        deepScanActionUnified: true
    };
}


function applyStakeAuthorityOutcome(report = {}, authority = {}, dataQuality = {}, prediction = '') {
    const action = text(authority.effectiveAction || report.action || ACTIONS.WATCHLIST);
    const quality = text(authority.qualityFinalLabel || qualityLabel(action));
    const narrative = text(authority.finalNarrative || authority.reason || `${action}: valutazione finale.`);
    const cls = action === ACTIONS.HIGH_RISK ? 'HIGH_RISK'
        : action === ACTIONS.MODEL_RISK ? 'MODEL_RISK'
            : action === ACTIONS.WATCHLIST ? 'WATCHLIST'
                : action === ACTIONS.EDGE ? 'TECH_EDGE' : 'VALUE';
    const advisory = clone(report.deepScanAdvisory, {}) || {};
    advisory.rationale = narrative;
    advisory.confidence = cls === 'HIGH_RISK' ? 'MOLTO BASSA' : cls === 'MODEL_RISK' ? 'BASSA' : cls === 'WATCHLIST' ? 'MEDIA/BASSA' : 'MEDIA';
    const finalState = {
        ...(clone(report.finalStateDeepScan, {}) || {}),
        version: CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
        action,
        class: cls,
        qualityLabel: quality,
        dataQualityStatus: dataQuality.status || null,
        dataQualityScore: dataQuality.score ?? null,
        stakeAuthorityStatus: authority.status || null,
        finalTheoreticalStake: num(authority.modelStake, 0),
        finalPreCapStake: num(authority.prePortfolioCapStake, 0),
        finalOperationalStake: num(authority.finalOperationalStake, authority.prePortfolioCapStake),
        finalNarrative: narrative,
        prediction: prediction || report.finalMarket?.prediction || null,
        recalculatedAt: new Date().toISOString()
    };
    return {
        ...report,
        signalAction: text(report.signalAction || report.rawAction || report.action || action),
        operationalAction: action,
        action,
        displayAction: action,
        unifiedAction: action,
        ipmAction: action,
        persistedAction: action,
        riskLevel: cls,
        qualityFinalLabel: quality,
        deepScanAdvisory: advisory,
        canonicalDeepScan: {
            ...(clone(report.canonicalDeepScan, {}) || {}),
            canonicalClass: cls,
            canonicalAction: action,
            conservativeSource: 'PATCH26E_C_UNIFIED_STAKE_AND_DATA_QUALITY_AUTHORITY',
            finalStateRecalculated: true,
            finalStateVersion: CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
            advisoryHasStakeAuthority: false
        },
        finalStateDeepScan: finalState,
        stakeAuthority: clone(authority, {}),
        dataQualityAuthority: clone(dataQuality, {}),
        finalNarrative: narrative
    };
}

function compactReport(report = {}, decision = {}, allocation = {}) {
    return {
        success: true,
        version: report.version,
        action: report.action,
        displayAction: report.displayAction || report.action,
        rawAction: report.rawAction,
        signalAction: report.signalAction || report.rawAction || report.action,
        operationalAction: report.operationalAction || report.action,
        temporalAnalysis: clone(report.temporalAnalysis, {}),
        suggestionText: report.suggestionText,
        riskLevel: report.riskLevel,
        riskScore: report.riskScore,
        pillars: clone(report.pillars, []),
        deepScanAdvisory: clone(report.deepScanAdvisory, {}),
        medicalNews: clone(report.medicalNews, {}),
        marketSummary: clone(report.marketSummary, {}),
        professionalAudit: clone(report.professionalAudit, {}),
        sourceIntelligence: clone(report.sourceIntelligence, {}),
        adaptiveAssessment: clone(report.adaptiveAssessment, {}),
        missingDataPrompt: typeof report.missingDataPrompt === 'string' ? report.missingDataPrompt.slice(0, 9000) : '',
        independentAiEvidence: clone(report.independentAiEvidence, {}),
        independentAiPrompt: typeof report.independentAiPrompt === 'string' ? report.independentAiPrompt.slice(0, 12500) : '',
        independentAiStatus: report.independentAiStatus || 'NOT_AVAILABLE_NOT_EXECUTED',
        r11StakeDiagnostics: independentR11.diagnostic(report,decision,allocation),
        canonicalDeepScan: clone(report.canonicalDeepScan, {}),
        finalStateDeepScan: clone(report.finalStateDeepScan, {}),
        reliabilityGuard: clone(report.reliabilityGuard || decision.reliabilityGuard, {}),
        stakeAuthority: clone(report.stakeAuthority || decision.stakeAuthority, {}),
        dataQualityAuthority: clone(report.dataQualityAuthority || decision.dataQualityAssessment, {}),
        finalNarrative: report.finalNarrative || decision.reason || null,
        finalMarket: clone(report.finalMarket, {}),
        analysisStage: clone(report.analysisStage, {}),
        qualityFinalLabel: report.qualityFinalLabel,
        predictionIndex: clone(decision, {}),
        stakeReconciliation: clone(decision, {}),
        stakeLifecycle: {
            theoreticalStake: num(decision.theoreticalStake, 0),
            operationalStake: num(allocation.operationalStake ?? decision.operationalStake, 0),
            estimatedOperationalProfit: num(allocation.estimatedProfit ?? decision.estimatedProfit, 0),
            status: allocation.status || decision.status,
            action: allocation.action || decision.action,
            reason: allocation.reason || decision.reason,
            automaticExecution: allocation.eligible ?? decision.eligible,
            dataClass: decision.dataClass
        },
        operationalState: clone(report.operationalState, {}),
        outputCoherence: clone(report.outputCoherence, {}),
        portfolioAllocation: clone(report.portfolioAllocation, {})
    };
}

module.exports = {
    CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
    ACTIONS,
    recalculatePillars,
    classifyFinalState,
    finalizeCandidateReport,
    qualityLabel,
    compactReport,
    applyStakeAuthorityOutcome
};
