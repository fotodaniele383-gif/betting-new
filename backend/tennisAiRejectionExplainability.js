'use strict';

// ============================================================================
// STEP69 - TENNIS AI REJECTION EXPLAINABILITY
// Audit layer non mutante: spiega perché Analisi AI Tennis può restituire zero
// pick anche quando quote e nomi sono certificati. Non modifica modello, stake,
// gate, paper trading o CLV.
// ============================================================================

const STEP69_VERSION = 'STEP69_TENNIS_AI_REJECTION_EXPLAINABILITY_V1';
const STEP69_UI_MODE = 'COMPACT_SUMMARY_WITH_COLLAPSIBLE_DETAILS';
const DEFAULT_MAX_OPERATIONAL_MONEYLINE_ODD = 3.5;
const DEFAULT_TOP_LIMIT = 8;

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function safeUpper(value) {
    return String(value || '').toUpperCase();
}

function getFirstFinite(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function calcEvPct(probabilityPct, odd) {
    const p = Number(probabilityPct);
    const o = Number(odd);
    if (!Number.isFinite(p) || !Number.isFinite(o) || o <= 1) return null;
    return ((p / 100) * o - 1) * 100;
}

function inferMarketKey(marketType) {
    const m = safeUpper(marketType);
    if (m.includes('TOTAL')) return 'totals';
    return 'moneyline';
}

function isBootstrapCapLike(probabilityPct) {
    const p = Number(probabilityPct);
    if (!Number.isFinite(p)) return false;
    return Math.abs(p - 85) <= 0.75 || Math.abs(p - 15) <= 0.75;
}

function buildProbabilityAudit(evaluation = {}, odd = null) {
    const calibratedProbabilityPct = getFirstFinite(
        evaluation.calibrated_probability_pct,
        evaluation.probability,
        evaluation.estimatedProb,
        evaluation.model_probability_pct
    );
    const modelProbabilityPct = getFirstFinite(
        evaluation.model_probability_pct,
        evaluation.raw_probability_pct,
        evaluation.probability,
        calibratedProbabilityPct
    );
    const marketProbabilityPct = getFirstFinite(
        evaluation.market_probability_pct,
        evaluation.market_implied_probability_pct,
        evaluation.probMercato,
        null
    );

    const capOrFloorApplied = isBootstrapCapLike(calibratedProbabilityPct);
    const extremeOddGuard = safeNumber(odd, 0) >= 10 && capOrFloorApplied;

    let probabilityMode = 'CALIBRATED_MODEL_PROBABILITY';
    if (capOrFloorApplied) probabilityMode = 'BOOTSTRAP_CAPPED_OR_FLOORED';
    if (evaluation.probability_mode) probabilityMode = String(evaluation.probability_mode);

    return {
        probabilityMode,
        modelProbabilityPct: modelProbabilityPct === null ? null : round(modelProbabilityPct, 2),
        calibratedProbabilityPct: calibratedProbabilityPct === null ? null : round(calibratedProbabilityPct, 2),
        marketProbabilityPct: marketProbabilityPct === null ? null : round(marketProbabilityPct, 2),
        capOrFloorApplied,
        overconfidenceGuard: capOrFloorApplied || safeUpper(evaluation.reason).includes('OVERCONFIDENT'),
        extremeOddGuard,
        note: capOrFloorApplied
            ? 'Probabilità live compatibile con cap/floor bootstrap: utile per audit, non sufficiente da sola per sbloccare quote estreme.'
            : 'Probabilità calibrata disponibile senza evidenza di cap/floor bootstrap.'
    };
}

function buildEvAudit(evaluation = {}, odd = null, selected = false) {
    const probabilityAudit = buildProbabilityAudit(evaluation, odd);
    const calibratedProbabilityPct = probabilityAudit.calibratedProbabilityPct;
    const marketProbabilityPct = probabilityAudit.marketProbabilityPct;

    const theoreticalEdgePp = calibratedProbabilityPct !== null && marketProbabilityPct !== null
        ? calibratedProbabilityPct - marketProbabilityPct
        : null;

    const theoreticalEvPct = getFirstFinite(
        evaluation.calibrated_ev_pct,
        evaluation.recomputed_ev_pct,
        evaluation.raw_ev_pct,
        calcEvPct(calibratedProbabilityPct, odd)
    );

    const adjustedEdgePp = getFirstFinite(
        evaluation.edge_pp,
        evaluation.adjusted_edge_pp,
        evaluation.edge,
        null
    );
    const adjustedEvPct = getFirstFinite(
        evaluation.ev_pct,
        evaluation.adjusted_ev_pct,
        evaluation.expectedValue,
        null
    );

    const operationalEdgePp = selected ? getFirstFinite(adjustedEdgePp, theoreticalEdgePp, 0) : getFirstFinite(adjustedEdgePp, 0);
    const operationalEvPct = selected ? getFirstFinite(adjustedEvPct, theoreticalEvPct, 0) : getFirstFinite(adjustedEvPct, 0);

    const evSuppressed = !selected && theoreticalEvPct !== null && Math.abs(safeNumber(theoreticalEvPct, 0) - safeNumber(operationalEvPct, 0)) > 0.75;

    return {
        theoreticalEdgePp: theoreticalEdgePp === null ? null : round(theoreticalEdgePp, 2),
        operationalEdgePp: round(operationalEdgePp, 2),
        theoreticalEvPct: theoreticalEvPct === null ? null : round(theoreticalEvPct, 2),
        operationalEvPct: round(operationalEvPct, 2),
        evSuppressed,
        suppressionReason: evSuppressed
            ? 'EV operativo azzerato o ridotto perché il candidato non ha superato reliability/calibration/gate.'
            : null,
        source: evaluation.evSource || evaluation.appliedProbabilitySource || 'CALIBRATED_PROBABILITY_RECOMPUTED'
    };
}

function classifyDetailedReject({ evaluation = {}, cr = {}, stakePolicy = null, odd = null, marketType = 'moneyline', rejectCode = '' } = {}) {
    const reason = safeUpper(evaluation.reason || cr.reason || rejectCode);
    const thresholds = evaluation.thresholds_passed || {};
    const marketKey = inferMarketKey(marketType);
    const probabilityAudit = buildProbabilityAudit(evaluation, odd);
    const o = safeNumber(odd, 0);

    const maxOperationalOdd = marketKey === 'moneyline'
        ? DEFAULT_MAX_OPERATIONAL_MONEYLINE_ODD
        : 2.5;

    let code = 'VALUE_EVALUATION_INVALID';
    let group = 'VALUE_GATE';
    let severity = 'HARD_BLOCK';
    let message = 'Candidato non selezionato dal gate value/reliability.';

    // STEP69C_PRIORITY_FIX:
    // Priorità diagnostica stretta e non mutante:
    // 1) un veto esplicito di reliability resta CALIBRATION;
    // 2) il longshot/bootstrap ha priorità solo quando il blocco quota è esplicito
    //    (thresholds.max_odd=false) o non esiste alcun veto reliability specifico;
    // 3) i motivi generici CALIBRATION/UNKNOWN non devono nascondere il rischio
    //    longshot, ma non devono nemmeno sovrascrivere reliability=false.
    const explicitReliabilityVeto = thresholds.reliability === false;
    const explicitMaxOddVeto = thresholds.max_odd === false;
    const extremeBootstrapLongshot = marketKey === 'moneyline' &&
        probabilityAudit.capOrFloorApplied &&
        o >= 10;

    if (explicitReliabilityVeto) {
        code = 'RELIABILITY_THRESHOLD_FAILED';
        group = 'CALIBRATION';
        message = 'Soglia reliability non superata.';
    } else if (reason.includes('BRIER')) {
        code = 'BRIER_RELIABILITY_BLOCK';
        group = 'CALIBRATION';
        message = 'Blocco per qualità Brier/reliability del segmento.';
    } else if (extremeBootstrapLongshot && (explicitMaxOddVeto || o > maxOperationalOdd)) {
        code = 'EXTREME_ODD_BOOTSTRAP_BLOCK';
        group = 'MARKET_RISK';
        message = 'Longshot/quota estrema con probabilità bootstrap cappata o floorata: EV teorico non ammesso operativamente.';
    } else if (marketKey === 'moneyline' && (explicitMaxOddVeto || o > maxOperationalOdd)) {
        code = 'MAX_ODD_OPERATIONAL_BLOCK';
        group = 'MARKET_RISK';
        message = 'Quota oltre limite operativo moneyline.';
    } else if (reason.includes('CALIBRA') || reason.includes('CALIBRATION') || reason.includes('UNKNOWN')) {
        code = 'CALIBRATION_UNKNOWN_BLOCK';
        group = 'CALIBRATION';
        message = 'Blocco per calibrazione segmento non sufficiente o non affidabile.';
    } else if (safeUpper(rejectCode).includes('RELIABILITY')) {
        code = 'RELIABILITY_THRESHOLD_FAILED';
        group = 'CALIBRATION';
        message = 'Soglia reliability non superata.';
    } else if (probabilityAudit.capOrFloorApplied) {
        code = 'BOOTSTRAP_PROBABILITY_CAP_BLOCK';
        group = 'CALIBRATION';
        message = 'Probabilità compatibile con cap/floor bootstrap: serve conferma di calibrazione/CLV.';
    } else if (cr && cr.passed === false) {
        code = 'CROSS_REFERENCE_FAILED';
        group = 'CROSS_REFERENCE';
        message = 'Cross-reference non superato.';
    } else if (thresholds.edge_pp === false || thresholds.ev_pct === false || safeUpper(rejectCode).includes('EDGE') || safeUpper(rejectCode).includes('EV')) {
        code = 'EDGE_EV_THRESHOLD_BLOCK';
        group = 'VALUE_GATE';
        message = 'Edge/EV operativo non supera le soglie professionali.';
    } else if (thresholds.probability === false) {
        code = 'PROBABILITY_THRESHOLD_FAILED';
        group = 'VALUE_GATE';
        message = 'Probabilità minima non superata.';
    } else if (stakePolicy && safeNumber(stakePolicy.stake, 0) <= 0) {
        code = 'STAKE_POLICY_ZERO';
        group = 'STAKE_POLICY';
        message = 'Stake operativo zero dopo policy/rischio.';
    } else if (rejectCode) {
        code = safeUpper(rejectCode).replace(/\s+/g, '_');
        message = `Blocco ereditato dal gate: ${code}.`;
    }

    return {
        code,
        group,
        severity,
        message,
        sourceReason: evaluation.reason || cr.reason || rejectCode || null,
        marketKey
    };
}

function explainTennisCandidateRejection(input = {}) {
    const selected = input.selected === true;
    const evaluation = input.evaluation || {};
    const odd = input.odd;
    const probabilityAudit = buildProbabilityAudit(evaluation, odd);
    const evAudit = buildEvAudit(evaluation, odd, selected);
    const detail = selected
        ? { code: 'ACCEPTED_FOR_SELECTION', group: 'ACCEPTED', severity: 'INFO', message: 'Candidato selezionato.', marketKey: inferMarketKey(input.marketType) }
        : classifyDetailedReject(input);

    return {
        step69Version: STEP69_VERSION,
        detailedRejectCode: detail.code,
        blockerGroup: detail.group,
        severity: detail.severity,
        explanation: detail.message,
        sourceReason: detail.sourceReason || null,
        probabilityAudit,
        evAudit,
        auditLabel: `${detail.code}: ${detail.message}`
    };
}

function ensureStep69Audit(candidateAudit = {}) {
    if (!candidateAudit.step69 || typeof candidateAudit.step69 !== 'object') {
        candidateAudit.step69 = {
            mode: STEP69_VERSION,
            uiMode: STEP69_UI_MODE,
            purpose: 'Rende leggibile perché i candidati Analisi AI vengono respinti senza sbloccare pick non affidabili.',
            detailedRejected: { moneyline: {}, totals: {} },
            blockerGroups: {},
            evSuppressedCount: 0,
            probabilityCappedCount: 0,
            extremeOddGuardCount: 0,
            examples: [],
            notes: [
                'EV teorico e EV operativo sono separati: se il gate blocca, l’EV operativo può essere 0 anche con EV calibrato alto.',
                'Quote/nome certificati non implicano pick valido: servono anche calibration, CLV, edge, EV e risk gate.',
                'La UI usa riepiloghi compatti e dettagli espandibili per non rendere il pannello illeggibile.'
            ]
        };
    }
    return candidateAudit.step69;
}

function recordStep69Candidate(candidateAudit = {}, entry = {}, explanation = {}) {
    const step69 = ensureStep69Audit(candidateAudit);
    const marketKey = entry.marketType === 'totals' ? 'totals' : 'moneyline';
    const code = explanation.detailedRejectCode || 'UNKNOWN_REJECT';
    const group = explanation.blockerGroup || 'UNKNOWN';

    step69.detailedRejected[marketKey][code] = safeNumber(step69.detailedRejected[marketKey][code], 0) + 1;
    step69.blockerGroups[group] = safeNumber(step69.blockerGroups[group], 0) + 1;

    if (explanation.evAudit?.evSuppressed) step69.evSuppressedCount += 1;
    if (explanation.probabilityAudit?.capOrFloorApplied) step69.probabilityCappedCount += 1;
    if (explanation.probabilityAudit?.extremeOddGuard) step69.extremeOddGuardCount += 1;

    if (step69.examples.length < DEFAULT_TOP_LIMIT) {
        step69.examples.push({
            match: entry.match || 'N/D',
            prediction: entry.prediction || 'N/D',
            odd: entry.odd ?? null,
            detailedRejectCode: code,
            blockerGroup: group,
            probabilityMode: explanation.probabilityAudit?.probabilityMode || 'N/D',
            theoreticalEvPct: explanation.evAudit?.theoreticalEvPct ?? null,
            operationalEvPct: explanation.evAudit?.operationalEvPct ?? null,
            explanation: explanation.explanation || ''
        });
    }

    return step69;
}

function sortEntriesDesc(obj = {}) {
    return Object.entries(obj || {})
        .map(([key, value]) => ({ key, value: safeNumber(value, 0) }))
        .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

function finalizeStep69Explainability(diagnostics = {}) {
    if (!diagnostics || typeof diagnostics !== 'object') return diagnostics;
    const audit = diagnostics.candidateAudit;
    if (!audit || typeof audit !== 'object') return diagnostics;

    const step69 = ensureStep69Audit(audit);
    const evaluatedMoneyline = safeNumber(audit.evaluated?.moneyline, 0);
    const evaluatedTotals = safeNumber(audit.evaluated?.totals, 0);
    const evaluatedTotal = evaluatedMoneyline + evaluatedTotals;
    const rawCandidates = safeNumber(diagnostics.candidates?.moneylineRaw, 0) + safeNumber(diagnostics.candidates?.totalsRaw, 0);
    const selected = safeNumber(diagnostics.candidates?.selected, 0);
    const returned = safeNumber(diagnostics.candidates?.returned, 0);
    const saved = safeNumber(diagnostics.candidates?.savedAttempts, 0);

    const topDetailed = sortEntriesDesc({
        ...(step69.detailedRejected.moneyline || {}),
        ...(step69.detailedRejected.totals || {})
    }).slice(0, DEFAULT_TOP_LIMIT);
    const topGroups = sortEntriesDesc(step69.blockerGroups || {}).slice(0, DEFAULT_TOP_LIMIT);

    step69.candidateFunnel = {
        oddsEvents: safeNumber(diagnostics.api?.oddsEvents, 0),
        processedWithModel: safeNumber(diagnostics.events?.processedWithModel, 0),
        auditCandidatesEvaluated: evaluatedTotal,
        rawOperationalCandidates: rawCandidates,
        selectedCandidates: selected,
        returnedCandidates: returned,
        savedAttempts: saved
    };

    step69.topDetailedRejectCodes = topDetailed;
    step69.topBlockerGroups = topGroups;
    step69.topBlockersText = topDetailed.map(row => `${row.key}: ${row.value}`).join(' · ');

    const totalsEnabled = diagnostics.config?.useTotals === true;
    const guardrailActive = diagnostics.reliabilityGuardrail?.active === true;
    const hasCalibrationBlock = topGroups.some(row => row.key === 'CALIBRATION') || topDetailed.some(row => String(row.key).includes('CALIBRATION') || String(row.key).includes('BRIER'));

    step69.zeroPickExplanation = returned > 0
        ? 'Analisi AI ha prodotto candidati operativi.'
        : evaluatedTotal > 0
            ? `Zero pick: ${evaluatedTotal}/${evaluatedTotal} candidati audit sono stati respinti dai gate operativi. Quote/nome possono essere certificati, ma calibration/reliability/edge/EV/rischio non hanno autorizzato trading reale.`
            : 'Zero pick: nessun candidato audit valutabile dopo feed/API/precheck.';

    step69.dataSources = {
        liveOdds: 'The Odds API live, mercato h2h per moneyline certificata Step66/66B.',
        reliability: 'Nuovo storico Tennis clean/current usato solo per reliability/calibrazione, non per forzare pick.',
        paperTrading: 'Nessun salvataggio se la candidatura resta audit-only.'
    };

    step69.totalsStatus = totalsEnabled
        ? 'Totals richiesti; controllare totalsFeedDiagnostics per feed/linee/supporto Markov.'
        : 'Totals non valutati perché tennisUseTotals/useTotals=false.';

    step69.guardrailInterpretation = guardrailActive
        ? 'Step63 reliability guardrail attivo.'
        : hasCalibrationBlock
            ? 'Step63 guardrail non è attivo, ma il Value/Calibration Gate può comunque bloccare i candidati per qualità segmento, Brier, cap bootstrap o quota estrema.'
            : 'Step63 guardrail non attivo; i blocchi arrivano da gate successivi.';

    return diagnostics;
}

module.exports = {
    STEP69_VERSION,
    STEP69_UI_MODE,
    buildProbabilityAudit,
    buildEvAudit,
    classifyDetailedReject,
    explainTennisCandidateRejection,
    ensureStep69Audit,
    recordStep69Candidate,
    finalizeStep69Explainability
};
