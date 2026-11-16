'use strict';

const bettingMacroCausal = require('./bettingMacroCausal');
const probabilityFirst = require('./calcioProbabilityFirst'); // CALCIO_PROBABILITY_FIRST_PATCH_V1

const CALCIO_AI_FINALIZATION_VERSION = 'BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_V1';
const FINALIZED_MARKET_COUNT = 3;

const ACTION_CLASS = Object.freeze({
    CONFIRMATIVE: 'CONFIRMATIVE',
    TECH_EDGE: 'TECH_EDGE',
    WATCHLIST: 'WATCHLIST',
    MODEL_RISK: 'MODEL_RISK',
    HIGH_RISK: 'HIGH_RISK',
    UNKNOWN: 'UNKNOWN'
});

// Più alto = più prudente. WAIT_IN_PLAY è un timing advisory e non una
// categoria DeepScan operativa: non deve comparire nella colonna azione né
// sostituire il segnale quantitativo.
const ACTION_SEVERITY = Object.freeze({
    CONFIRMATIVE: 0,
    TECH_EDGE: 1,
    WATCHLIST: 2,
    MODEL_RISK: 4,
    HIGH_RISK: 5,
    UNKNOWN: 2
});
const ACTION_LABEL = Object.freeze({
    CONFIRMATIVE: 'VALUE CONFERMATO / MICRO',
    TECH_EDGE: 'EDGE TECNICO',
    WATCHLIST: 'WATCHLIST LOW EDGE',
    MODEL_RISK: 'RISCHIO MODELLO',
    HIGH_RISK: 'ALTO RISCHIO',
    UNKNOWN: 'WATCHLIST LOW EDGE'
});

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((num(value) + Number.EPSILON) * factor) / factor;
}
function safeClone(value) {
    if (value === null || value === undefined) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
}
function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}
function predictionKey(value) { return upper(value).replace(/\s+/g, ''); }

function classifyAction(value = '') {
    const t = upper(value);
    if (!t) return ACTION_CLASS.UNKNOWN;
    if (t.includes('ALTO RISCHIO') || t.includes('HIGH RISK') || t.includes('VALUE TRAP') || t.includes('SCARTA') || t.includes('BLOCK')) return ACTION_CLASS.HIGH_RISK;
    if (t.includes('RISCHIO MODELLO') || t.includes('MODEL RISK') || t.includes('MODEL_RISK') || t.includes('ALTERNATIVE_PRONOSTICO')) return ACTION_CLASS.MODEL_RISK;
    if (t.includes('WATCHLIST') || t.includes('LOW EDGE') || t.includes('VALUE QUALITATIVO')) return ACTION_CLASS.WATCHLIST;
    if (t.includes('EDGE TECNICO') || t.includes('TECH EDGE')) return ACTION_CLASS.TECH_EDGE;
    if (t.includes('VALUE CONFERMATO') || t.includes('VIA LIBERA') || t.includes('SUPER VALUE') || t.includes('CONFIRM_PRONOSTICO') || t.includes('APPROVE')) return ACTION_CLASS.CONFIRMATIVE;
    // Compatibilità con righe Patch 24: il timing WAIT non è una nuova voce
    // DeepScan. Viene ricondotto alla categoria WATCHLIST.
    if (t.includes('WAIT_IN_PLAY') || t.includes('WAIT IN PLAY') || t.includes('ATTENDI IN-PLAY') || t.includes('ATTENDI IN PLAY') || t.includes('ATTESA IN-PLAY') || t.includes('ATTESA IN PLAY')) return ACTION_CLASS.WATCHLIST;
    return ACTION_CLASS.UNKNOWN;
}

function classifyAdvisoryMode(value = '') {
    const t = upper(value);
    if (!t) return 'UNKNOWN';
    if (t.includes('ALTERNATIVE')) return 'ALTERNATIVE_PRONOSTICO';
    if (t.includes('WAIT') || t.includes('ATTEND') || t.includes('IN PLAY') || t.includes('IN-PLAY')) return 'WAIT_IN_PLAY';
    if (t.includes('CONFIRM') || t.includes('PRE_MATCH')) return 'CONFIRM_PRONOSTICO';
    return 'OTHER';
}

function canonicalDeepScanDecision(report = {}, context = {}) {
    const rawAction = text(report.rawAction || report.action || report.displayAction);
    const macroAction = bettingMacroCausal.deepScanMacro({
        action: rawAction,
        summary: report.suggestionText || report.summary || context.summary || '',
        edge_pp: context.edgePp ?? context.edge_pp ?? context.edge,
        reliabilityScore: context.reliabilityScore,
        theoreticalStake: context.theoreticalStake,
        professionalRisk: context.professionalRisk ?? report.professionalAudit?.risk,
        professionalStatus: context.professionalStatus ?? report.professionalAudit?.status,
        disagreementPp: context.disagreementPp
    });
    const advisoryMode = text(report.deepScanAdvisory?.mode || report.advisory?.mode || report.recommendationMode);
    const advisoryClass = classifyAdvisoryMode(advisoryMode);
    const operationalGate = report.deepScanOperationalGate || report.operationalGate || {};
    const signals = [
        { source: 'QUANTITATIVE_ACTION', value: rawAction, cls: classifyAction(rawAction) },
        { source: 'MACRO_ACTION', value: macroAction, cls: classifyAction(macroAction) },
        { source: 'RISK_LEVEL', value: report.riskLevel || report.level || '', cls: classifyAction(report.riskLevel || report.level || '') }
    ];

    // Solo i blocchi HARD/strutturali e una vera alternativa smentiscono il
    // segnale quantitativo. WAIT_IN_PLAY resta nel campo advisory/timing e non
    // crea una sesta voce DeepScan né un veto successivo all'IPM.
    const gateText = upper(`${operationalGate.status || ''} ${operationalGate.action || ''} ${operationalGate.reason || ''}`);
    if (operationalGate && operationalGate.allowBet === false && /(HARD|STRUCTURAL|IDENTITY|INVALID|MODEL_RISK|HIGH_RISK)/.test(gateText)) {
        signals.push({ source: 'OPERATIONAL_GATE_HARD', value: gateText, cls: ACTION_CLASS.MODEL_RISK });
    }
    if (advisoryClass === 'ALTERNATIVE_PRONOSTICO') {
        signals.push({ source: 'ADVISORY_ALTERNATIVE', value: advisoryMode, cls: ACTION_CLASS.MODEL_RISK });
    }

    const considered = signals.filter(s => s.value && s.cls !== ACTION_CLASS.UNKNOWN);
    const winner = considered.sort((a, b) => (ACTION_SEVERITY[b.cls] ?? 2) - (ACTION_SEVERITY[a.cls] ?? 2))[0]
        || { source: 'FALLBACK', value: '', cls: ACTION_CLASS.WATCHLIST };
    return {
        rawAction,
        macroAction,
        advisoryMode: advisoryMode || null,
        advisoryClass,
        timingAdvisory: advisoryClass === 'WAIT_IN_PLAY' ? 'WAIT_IN_PLAY' : null,
        operationalGateStatus: operationalGate.status || null,
        canonicalClass: winner.cls,
        canonicalAction: ACTION_LABEL[winner.cls] || ACTION_LABEL.UNKNOWN,
        conservativeSource: winner.source,
        signals: signals.map(s => ({ ...s, severity: ACTION_SEVERITY[s.cls] ?? 2 })),
        advisoryHasStakeAuthority: false
    };
}

/**
 * Produce una sola azione DeepScan canonica. Da questo punto l'azione raw resta
 * solo auditabile e non ha autorità su IPM, Gate, DB o UI.
 */
function unifyDeepScanReport(report = {}, context = {}) {
    const canonical = canonicalDeepScanDecision(report, context);
    return {
        ...report,
        rawAction: canonical.rawAction,
        rawDisplayAction: text(report.displayAction),
        action: canonical.canonicalAction,
        displayAction: canonical.canonicalAction,
        unifiedAction: canonical.canonicalAction,
        ipmAction: canonical.canonicalAction,
        persistedAction: canonical.canonicalAction,
        canonicalDeepScan: canonical,
        deepScanActionVersion: CALCIO_AI_FINALIZATION_VERSION,
        deepScanActionUnified: true
    };
}

function candidateSnapshot(candidate = {}) {
    const extData = candidate.extData || {};
    return {
        prediction: text(candidate.prediction),
        calcio_probability_first: safeClone(candidate.calcio_probability_first || candidate.probability_first || null),
        market_type: candidate.market_type || candidate.marketType || null,
        odd: num(candidate.odd),
        estimatedProb: num(candidate.estimatedProb ?? candidate.estimated_prob ?? candidate.rawProb),
        rawProb: num(candidate.rawProb ?? candidate.estimatedProb ?? candidate.estimated_prob),
        edge: num(candidate.edge ?? candidate.edge_pp),
        edge_pp: num(candidate.edge_pp ?? candidate.edge),
        ev_pct: num(candidate.ev_pct),
        home: candidate.home || candidate.home_team || null,
        away: candidate.away || candidate.away_team || null,
        match: candidate.match || null,
        match_date: candidate.match_date || candidate.commence_time || candidate.date || null,
        commence_time: candidate.commence_time || candidate.match_date || candidate.date || null,
        date: candidate.date || candidate.match_date || null,
        league: candidate.league || null,
        event_key: candidate.event_key || candidate.eventKey || candidate.match_exposure_key || candidate.calcio_event_key || null,
        provider_event_id: candidate.provider_event_id || candidate.calcio_provider_event_id || null,
        providerHome: candidate.providerHome || candidate.provider_home_team || candidate.home || candidate.home_team || null,
        providerAway: candidate.providerAway || candidate.provider_away_team || candidate.away || candidate.away_team || null,
        historicalHomeKey: candidate.historicalHomeKey || candidate.calcio_historical_home_key || null,
        historicalAwayKey: candidate.historicalAwayKey || candidate.calcio_historical_away_key || null,
        odd1: nullableNumber(candidate.odd1),
        oddX: nullableNumber(candidate.oddX),
        odd2: nullableNumber(candidate.odd2),
        bankroll_snapshot: num(candidate.bankroll_snapshot ?? candidate.bankroll),
        prediction_reliability_score: num(candidate.prediction_reliability_score ?? candidate.calcio_prediction_reliability_score),
        prediction_reliability_label: candidate.prediction_reliability_label || candidate.calcio_prediction_reliability_label || '',
        analysisOnly: Boolean(candidate.analysisOnly),
        prediction_visibility: candidate.prediction_visibility || null,
        exposure_role: candidate.exposure_role || null,
        strategy_tag: candidate.strategy_tag || null,
        qualityGateSeed: candidate.qualityGateSeed || candidate.calcio_quality_final_label || candidate.quality_final_label || candidate.calcio_gate_status || 'WATCHLIST MICRO',
        analysis_thresholds: safeClone(candidate.analysis_thresholds || null),
        decisionIdentity: safeClone(candidate.decisionIdentity || candidate.decision_identity || null),
        oddsCertification: safeClone(candidate.oddsCertification || candidate.odds_certification || null),
        professionalAudit: safeClone(candidate.professionalAudit || null),
        probabilityIntegrity: safeClone(extData.probabilityIntegrity || candidate.probabilityIntegrity || null),
        multiProviderEvidence: safeClone(extData.multiProviderEvidence || candidate.multiProviderEvidence || null),
        clubEloEvidence: safeClone(extData.clubEloEvidence || candidate.clubEloEvidence || null),
        footballDataLoaded: extData.footballDataLoaded ?? candidate.footballDataLoaded ?? null,
        xgEvidenceMode: extData.xgEvidenceMode || candidate.xgEvidenceMode || null,
        candidate_selection_score: num(candidate.candidate_selection_score ?? candidate.predictionIndex?.score ?? candidate.prediction_index?.score),
        provisionalPredictionIndex: safeClone(candidate.predictionIndex || candidate.prediction_index || null)
    };
}


function projectCandidateReport(selectedReport = {}, candidate = {}, error = null) {
    const edge = num(candidate.edge_pp ?? candidate.edge, 0);
    const ev = num(candidate.ev_pct, 0);
    let cls = classifyAction(selectedReport.rawAction || selectedReport.action || selectedReport.displayAction);
    if (ev <= 0 || edge < 0) cls = ACTION_CLASS.HIGH_RISK;
    else if (edge < 2 && (ACTION_SEVERITY[cls] ?? 2) < ACTION_SEVERITY.WATCHLIST) cls = ACTION_CLASS.WATCHLIST;
    if (cls === ACTION_CLASS.UNKNOWN) cls = ACTION_CLASS.WATCHLIST;
    const action = ACTION_LABEL[cls] || ACTION_LABEL.UNKNOWN;
    return {
        ...safeClone(selectedReport),
        success: true,
        partial: false,
        rawAction: action,
        action,
        displayAction: action,
        ipmAction: action,
        persistedAction: action,
        marketSummary: {
            ...(selectedReport.marketSummary || {}),
            prediction: candidate.prediction,
            targetOdd: num(candidate.odd),
            modelProbabilityPct: num(candidate.estimatedProb ?? candidate.rawProb),
            finalEdgePp: edge,
            rawEvPct: ev
        },
        sharedMatchEvidenceProjection: true,
        finalizationMode: 'SHARED_MATCH_EVIDENCE_LOCAL_MARKET_PROJECTION',
        projectionReason: error ? text(error.message || error) : 'Alternative market finalized with shared match evidence',
        version: selectedReport.version || CALCIO_AI_FINALIZATION_VERSION
    };
}

function buildFinalizationCandidates(candidates = [], topN = FINALIZED_MARKET_COUNT) {
    const limit = Math.max(1, Math.min(3, num(topN, FINALIZED_MARKET_COUNT)));
    return (Array.isArray(candidates) ? candidates : []).slice(0, limit).map(candidateSnapshot);
}

function planFromAudit(auditInput, selectedCandidate = {}, topN = FINALIZED_MARKET_COUNT) {
    const audit = parseJson(auditInput, {}) || {};
    const fromAudit = Array.isArray(audit.finalizationCandidates)
        ? audit.finalizationCandidates.map(candidateSnapshot)
        : [];
    const selected = candidateSnapshot(selectedCandidate);
    const byPrediction = new Map();
    for (const candidate of [selected, ...fromAudit]) {
        if (!candidate.prediction) continue;
        const key = predictionKey(candidate.prediction);
        if (!byPrediction.has(key)) byPrediction.set(key, candidate);
    }
    const limit = Math.max(1, Math.min(3, num(topN, FINALIZED_MARKET_COUNT)));
    return [...byPrediction.values()].slice(0, limit);
}

async function finalizeTopMarkets(options = {}) {
    const { candidates = [], selectedPrediction, selectedReport, scanCandidate, finalizeCandidate, topN = FINALIZED_MARKET_COUNT } = options;
    if (typeof finalizeCandidate !== 'function') throw new Error('finalizeCandidate callback mancante');
    const requestedTopN = Math.max(1, Math.min(3, num(topN, FINALIZED_MARKET_COUNT)));
    const plan = (Array.isArray(candidates) ? candidates : []).slice(0, requestedTopN);
    if (plan.length < 1) throw new Error('Nessun mercato candidato disponibile per la finalizzazione');

    const jobs = plan.map(async candidate => {
        const isSelected = predictionKey(candidate.prediction) === predictionKey(selectedPrediction);
        let report = isSelected ? selectedReport : null;
        let fallbackUsed = false;
        let scanError = null;
        try {
            if (!report) {
                if (typeof scanCandidate !== 'function') throw new Error(`DeepScan alternativo non disponibile per ${candidate.prediction}`);
                report = await scanCandidate(candidate);
            }
        } catch (error) {
            scanError = error;
            if (!isSelected && selectedReport?.success === true) {
                report = projectCandidateReport(selectedReport, candidate, error);
                fallbackUsed = true;
            } else {
                return {
                    candidate,
                    report: { success: false, error: text(error.message || error) },
                    decision: { score: 0, rankValue: -1e9, operationalStake: 0, eligible: false },
                    finalized: false,
                    error: text(error.message || error)
                };
            }
        }
        if (!report || report.success !== true || report.partial === true) {
            if (!isSelected && selectedReport?.success === true) {
                report = projectCandidateReport(selectedReport, candidate, report?.error || report?.status || 'DEEPSCAN_FAILED');
                fallbackUsed = true;
            } else {
                return {
                    candidate,
                    report: report || { success: false, error: 'DEEPSCAN_EMPTY' },
                    decision: { score: 0, rankValue: -1e9, operationalStake: 0, eligible: false },
                    finalized: false,
                    error: report?.error || report?.status || 'DEEPSCAN_FAILED'
                };
            }
        }
        try {
            const result = await finalizeCandidate(candidate, report);
            return {
                ...result,
                candidate: result.candidate || candidate,
                finalized: result.finalized !== false,
                fallbackUsed,
                finalizationMode: fallbackUsed ? 'SHARED_MATCH_EVIDENCE_LOCAL_MARKET_PROJECTION' : 'DIRECT_MARKET_DEEPSCAN',
                scanError: scanError ? text(scanError.message || scanError) : null
            };
        } catch (error) {
            return {
                candidate,
                report,
                decision: { score: 0, rankValue: -1e9, operationalStake: 0, eligible: false },
                finalized: false,
                error: text(error.message || error),
                fallbackUsed
            };
        }
    });
    const finalRows = await Promise.all(jobs);
    const pfConfig = probabilityFirst.readConfig();
    // Post-DeepScan: use definitive data-quality and reliability evidence, NOT value/IPM as an artificial probability vote.
    function pfFinalAssessment(row) {
        const c = row?.candidate || {};
        return probabilityFirst.assess({
            ...c,
            prediction_reliability_score: row?.reliability?.score ?? c.prediction_reliability_score,
            calcio_data_quality_status: row?.dataQuality?.status ?? c.calcio_data_quality_status
        }, pfConfig);
    }
    const ranked = finalRows.slice().sort((a, b) => {
        if (process.env.SAFE13_MANUAL_PAPER === '1') {
            const stake = row => row?.stakeAuthority || row?.decision?.stakeAuthority || {};
            const av=stake(a), bv=stake(b);
            const as=av.eligible===true?num(av.prePortfolioCapStake):0;
            const bs=bv.eligible===true?num(bv.prePortfolioCapStake):0;
            if (as !== bs) return bs-as;
            const ae=num(av.robustNetEvAfterCalibrationPct,-100), be=num(bv.robustNetEvAfterCalibrationPct,-100);
            if (ae !== be) return be-ae;
        }
        if (pfConfig.mode === 'PROBABILITY_FIRST' && process.env.SAFE13_MANUAL_PAPER !== '1') {
            const pfOrder = probabilityFirst.compare(
                pfFinalAssessment(a),
                pfFinalAssessment(b)
            );
            if (pfOrder !== 0) return pfOrder;
        }
        return num(b.decision?.rankValue, num(b.decision?.score) * 1000) - num(a.decision?.rankValue, num(a.decision?.score) * 1000)
            || predictionKey(a.candidate?.prediction).localeCompare(predictionKey(b.candidate?.prediction));
    });
    const winner = ranked.find(row => row.finalized === true) || ranked[0] || null;
    const directFinalizedCount = ranked.filter(row => row.finalized === true && row.fallbackUsed !== true).length;
    const projectedCount = ranked.filter(row => row.finalized === true && row.fallbackUsed === true).length;
    const fullyFinalized = ranked.length >= 2 && directFinalizedCount === ranked.length;
    const singleMarketFinalized = ranked.length === 1 && directFinalizedCount === 1;
    const status = fullyFinalized
        ? 'MARKET_RANKING_FULLY_FINALIZED'
        : (singleMarketFinalized ? 'MARKET_SINGLE_DIRECT_FINALIZED' : 'MARKET_RANKING_PARTIAL_OR_DEGRADED');
    return {
        version: CALCIO_AI_FINALIZATION_VERSION,
        status,
        requestedTopN,
        candidateCount: plan.length,
        finalizedCount: ranked.filter(row => row.finalized).length,
        directFinalizedCount,
        projectedCount,
        singleMarketFinalized,
        fullyFinalized,
        winner,
        ranking: ranked.map((row, index) => ({
            rank: index + 1,
            prediction: row.candidate?.prediction || null,
            odd: num(row.candidate?.odd),
            probabilityPct: num(row.candidate?.estimatedProb ?? row.candidate?.estimated_prob),
            probabilityFirst: pfFinalAssessment(row),
            score: round(row.decision?.score, 2),
            rankValue: round(row.decision?.rankValue, 4),
            label: row.decision?.label || null,
            stakeBeforePortfolioCap: round(row.decision?.operationalStake, 2),
            deepScanAction: row.report?.action || null,
            paperTradingStatus: row.decision?.paperTradingStatus || row.evidence?.status || null,
            finalized: row.finalized === true,
            finalizationMode: row.finalizationMode || null,
            fallbackUsed: row.fallbackUsed === true,
            error: row.error || row.scanError || null
        }))
    };
}

function operationalState(decision = {}, evidence = {}, existing = {}) {
    const minimum = decision.stakeAuthority?.policy === 'EDGE_KELLY_MANUAL_PAPER_V15' ? 1 : 2;
    const operational = num(decision.operationalStake) >= minimum && decision.eligible === true;
    const ptSample = num(evidence.resolved ?? decision.components?.paperTrading?.sample, 0);
    const certificationLabel = operational
        ? (ptSample > 0 ? 'STRUTTURALMENTE CERTIFICATA · PT VALIDATO' : 'STRUTTURALMENTE CERTIFICATA · PT ASSENTE')
        : 'ANALISI · NESSUNA AUTORITÀ STAKE';
    const baseTag = text(existing.strategy_tag || 'CALCIO').replace(/_(ANALYSIS_ONLY|OPERATIONAL)$/i, '');
    return {
        analysisOnly: !operational,
        calcio_analysis_only: operational ? 0 : 1,
        prediction_visibility: operational ? 'OPERATIONAL_CANDIDATE' : 'ANALYSIS_ONLY',
        exposure_role: operational ? 'PRIMARY_OPERATIONAL' : 'ANALYSIS_ONLY',
        strategy_tag: `${baseTag}_${operational ? 'OPERATIONAL' : 'ANALYSIS_ONLY'}`,
        certificationLabel,
        ptCertificationStatus: ptSample > 0 ? 'PT_VALIDATED' : 'PT_ABSENT_NEUTRAL',
        structurallyCertified: operational || (decision.safetyReasons || []).length === 0
    };
}

function assertOutputCoherence(input = {}) {
    const report = input.report || {};
    const decision = input.decision || {};
    const state = input.state || {};
    const displayedEv = nullableNumber(input.displayedEvPct ?? input.ev_pct);
    const p = num(decision.probabilityPct ?? input.probabilityPct, 0) / 100;
    const netOdd = num(decision.netExecutableOdd ?? input.netOdd, 0);
    const expectedEv = netOdd > 1 && p > 0 ? (p * netOdd - 1) * 100 : 0;
    const expectedProfit = num(decision.operationalStake) * Math.max(0, netOdd - 1);
    const issues = [];
    const actionValues = [report.action, report.displayAction, report.ipmAction, report.persistedAction, input.persistedAction].filter(v => v !== undefined && v !== null && text(v));
    if (new Set(actionValues.map(text)).size > 1) issues.push('DEEPSCAN_ACTION_UNIFICATION_MISMATCH');
    if (displayedEv !== null && Math.abs(displayedEv - expectedEv) > 0.02) issues.push('EV_NET_ODD_MISMATCH');
    if (Math.abs(num(decision.estimatedProfit) - expectedProfit) > 0.02) issues.push('POTENTIAL_PROFIT_MISMATCH');
    const minimum = decision.stakeAuthority?.policy === 'EDGE_KELLY_MANUAL_PAPER_V15' ? 1 : 2;
    const operational = num(decision.operationalStake) >= minimum && decision.eligible === true;
    if (operational && (state.analysisOnly !== false || state.prediction_visibility !== 'OPERATIONAL_CANDIDATE' || state.exposure_role !== 'PRIMARY_OPERATIONAL')) issues.push('OPERATIONAL_ROLE_MISMATCH');
    if (!operational && state.analysisOnly === false) issues.push('ANALYSIS_ROLE_MISMATCH');
    if (input.marketFinalization?.fullyFinalized !== true) issues.push('MARKET_RANKING_NOT_FULLY_FINALIZED');
    return {
        version: CALCIO_AI_FINALIZATION_VERSION,
        certified: issues.length === 0,
        status: issues.length === 0 ? 'OUTPUT_COHERENCE_CERTIFIED' : 'OUTPUT_COHERENCE_FAILED',
        issues,
        checks: {
            actionUnified: new Set(actionValues.map(text)).size <= 1,
            evNetOdd: displayedEv === null || Math.abs(displayedEv - expectedEv) <= 0.02,
            profitNetOdd: Math.abs(num(decision.estimatedProfit) - expectedProfit) <= 0.02,
            operationalState: operational
                ? state.analysisOnly === false && state.prediction_visibility === 'OPERATIONAL_CANDIDATE' && state.exposure_role === 'PRIMARY_OPERATIONAL'
                : state.analysisOnly !== false,
            marketFullyFinalized: input.marketFinalization?.fullyFinalized === true
        },
        expected: { evPct: round(expectedEv, 2), potentialProfit: round(expectedProfit, 2) }
    };
}

module.exports = {
    CALCIO_AI_FINALIZATION_VERSION,
    FINALIZED_MARKET_COUNT,
    ACTION_CLASS,
    ACTION_SEVERITY,
    ACTION_LABEL,
    num,
    text,
    parseJson,
    predictionKey,
    classifyAction,
    classifyAdvisoryMode,
    canonicalDeepScanDecision,
    unifyDeepScanReport,
    candidateSnapshot,
    buildFinalizationCandidates,
    planFromAudit,
    projectCandidateReport,
    finalizeTopMarkets,
    operationalState,
    assertOutputCoherence
};
