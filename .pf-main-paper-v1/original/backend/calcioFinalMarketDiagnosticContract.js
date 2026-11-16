'use strict';

const crypto = require('crypto');

const CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION = 'BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1';
const CALCIO_DECISION_STATE_VERSION = 'BETTING_PATCH_26F_A_DECISION_STATE_MACHINE_V1';
const COHERENCE_CERTIFIED = 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED';
const COHERENCE_FAILED = 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_NOT_CERTIFIED';
const MINIMUM_OPERATIONAL_STAKE = 2;

const DECISION_STATES = Object.freeze({
    FORECAST_VALID: 'FORECAST_VALID',
    VALUE_CANDIDATE: 'VALUE_CANDIDATE',
    EARLY_RECHECK: 'EARLY_RECHECK',
    BET_READY: 'BET_READY',
    NO_BET_VALUE: 'NO_BET_VALUE',
    NO_BET_DATA: 'NO_BET_DATA',
    FAILED_ANALYSIS: 'FAILED_ANALYSIS'
});

function num(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
    const result = String(value ?? '').trim();
    return result || fallback;
}

function round(value, digits = 3) {
    const parsed = num(value, null);
    if (parsed === null) return null;
    const factor = 10 ** digits;
    return Math.round(parsed * factor) / factor;
}

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}

function normalizePrediction(value) {
    const raw = text(value).toUpperCase().replace(/\s+/g, '');
    const aliases = {
        HOME: '1', DRAW: 'X', AWAY: '2',
        OVER25: 'O2.5', 'OVER2.5': 'O2.5', O25: 'O2.5',
        UNDER25: 'U2.5', 'UNDER2.5': 'U2.5', U25: 'U2.5',
        BTTS: 'GG', YES: 'GG', NO: 'NG', NOBTTS: 'NG',
        '1X': '1X', X2: 'X2', '12': '12'
    };
    return aliases[raw] || raw;
}

function inferMarketType(prediction) {
    const market = normalizePrediction(prediction);
    if (['1', 'X', '2'].includes(market)) return '1X2';
    if (['O2.5', 'U2.5'].includes(market)) return 'TOTALS';
    if (['GG', 'NG'].includes(market)) return 'BTTS';
    if (['1X', 'X2', '12'].includes(market)) return 'DOUBLE_CHANCE';
    return 'UNKNOWN';
}

function confidenceLabel(score, fallback = 'VERY_LOW') {
    const value = num(score, null);
    if (value === null) return text(fallback, 'VERY_LOW').toUpperCase();
    if (value >= 80) return 'HIGH';
    if (value >= 65) return 'MEDIUM';
    if (value >= 50) return 'LOW';
    return 'VERY_LOW';
}

function stableMarketId({ eventKey, prediction, marketType } = {}) {
    const normalizedPrediction = normalizePrediction(prediction);
    const normalizedType = text(marketType || inferMarketType(normalizedPrediction), 'UNKNOWN').toUpperCase();
    const identity = `${text(eventKey, 'UNKNOWN_EVENT')}|${normalizedType}|${normalizedPrediction}`;
    return `CALCIO_MARKET_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function firstFinite(...values) {
    for (const value of values) {
        const parsed = num(value, null);
        if (parsed !== null) return parsed;
    }
    return null;
}

function probabilityComponent(value) {
    const parsed = parseJson(value, {});
    if (parsed?.components?.probability && typeof parsed.components.probability === 'object') {
        return parsed.components.probability;
    }
    if (parsed?.probability && typeof parsed.probability === 'object') return parsed.probability;
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function deriveProbabilityFallback(options = {}, candidate = {}, report = {}, decision = {}) {
    const sources = [
        probabilityComponent(options.probabilityFallback || {}),
        probabilityComponent(options.probabilityIntegrityMarket || {}),
        probabilityComponent(candidate.probabilityIntegrityMarket || candidate.extData?.probabilityIntegrityMarket || {}),
        probabilityComponent(decision.components?.probability || {}),
        probabilityComponent(report.predictionIndex?.components?.probability || {}),
        probabilityComponent(report.stakeReconciliation?.components?.probability || {}),
        probabilityComponent(candidate.calcio_prediction_index_components || candidate.prediction_index_components || {})
    ];
    const value = keys => {
        for (const source of sources) {
            for (const key of keys) {
                const parsed = num(source?.[key], null);
                if (parsed !== null) return parsed;
            }
        }
        return null;
    };
    const label = keys => {
        for (const source of sources) {
            for (const key of keys) {
                const current = text(source?.[key]);
                if (current) return current;
            }
        }
        return '';
    };
    let sourceWeights = null;
    for (const source of sources) {
        if (source?.sourceWeights && typeof source.sourceWeights === 'object') {
            sourceWeights = source.sourceWeights;
            break;
        }
    }
    return {
        modelProbabilityPct: value(['modelProbabilityPct', 'model', 'modelCenterPct']),
        monteCarloProbabilityPct: value(['monteCarloProbabilityPct', 'monteCarlo']),
        marketProbabilityPct: value(['marketProbabilityPct', 'marketProbability']),
        disagreementPp: value(['disagreementPp', 'marketGapPp', 'spreadPp']),
        monteCarloSamplingErrorPp: value(['monteCarloSamplingErrorPp', 'monteCarloStdErrorPp']),
        modelAgreementReliability: label(['modelAgreementReliability', 'reliability']),
        sourceWeights
    };
}

function selectDiagnostic(probabilityIntegrity = {}, prediction, fallback = {}) {
    const market = normalizePrediction(prediction);
    const integrity = parseJson(probabilityIntegrity, {});
    const direct = integrity.diagnostics?.[market]
        || (normalizePrediction(integrity.selectedMarket?.prediction || integrity.selectedMarket?.market) === market
            ? integrity.selectedMarket
            : null)
        || {};
    return {
        modelProbabilityPct: round(direct.modelProbabilityPct ?? fallback.modelProbabilityPct),
        monteCarloProbabilityPct: round(direct.monteCarloProbabilityPct ?? fallback.monteCarloProbabilityPct),
        marketProbabilityPct: round(direct.marketProbabilityPct ?? fallback.marketProbabilityPct),
        disagreementPp: round(direct.disagreementPp ?? fallback.disagreementPp),
        monteCarloSamplingErrorPp: round(direct.monteCarloStdErrorPp ?? fallback.monteCarloSamplingErrorPp),
        modelAgreementReliability: text(
            direct.reliability
            || integrity.marketReliability?.[market]
            || fallback.modelAgreementReliability
            || integrity.reliability,
            'N/D'
        ).toUpperCase(),
        sourceWeights: direct.sourceWeights && typeof direct.sourceWeights === 'object' ? direct.sourceWeights : null
    };
}

function scorelineDistribution(monteCarlo = {}, limit = 5) {
    const source = parseJson(monteCarlo, {});
    const rows = Array.isArray(source.scoreDistribution) ? source.scoreDistribution : [];
    return rows.slice(0, Math.max(0, limit)).map(row => ({
        score: text(row.score || `${row.home ?? ''}-${row.away ?? ''}`),
        probability: round(row.probability, 6),
        probabilityPct: round(num(row.probabilityPct, num(row.probability, 0) * 100), 3)
    })).filter(row => row.score);
}

function dataBlocked(context = {}) {
    const status = text(context.dataQualityStatus || context.dataQuality?.status).toUpperCase();
    const coverage = text(context.coverageMode).toUpperCase();
    const dataClass = text(context.dataClass).toUpperCase();
    return context.dataQualityBlocking === true
        || context.dataQuality?.blocking === true
        || status.includes('BLOCKED')
        || coverage === 'PRIOR_ONLY'
        || dataClass === 'INATTENDIBILE';
}

function evaluateDecisionState(context = {}) {
    const finalizationStatus = text(context.finalizationStatus).toUpperCase();
    const failed = context.failed === true
        || finalizationStatus.includes('FAILED')
        || finalizationStatus.includes('ERROR');
    if (failed) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.FAILED_ANALYSIS,
            label: 'ANALISI FALLITA',
            reason: text(context.failureReason, 'La finalizzazione tecnica non è stata completata.'),
            operational: false
        };
    }

    if (dataBlocked(context)) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.NO_BET_DATA,
            label: 'NO BET · DATI INSUFFICIENTI',
            reason: text(context.reason, 'La previsione resta visibile, ma la qualità dei dati non consente autorità operativa.'),
            operational: false
        };
    }

    const operationalStake = Math.max(0, num(context.finalOperationalStake, 0));
    const eligible = context.eligible === true || context.allowBet === true;
    if (eligible && operationalStake >= MINIMUM_OPERATIONAL_STAKE) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.BET_READY,
            label: 'BET READY',
            reason: text(context.reason, `Pronostico operativo autorizzato con stake €${operationalStake.toFixed(2)}.`),
            operational: true
        };
    }

    const robustEv = num(context.robustEvPct, null);
    const timingCode = text(context.timingCode).toUpperCase();
    const forecastScore = num(context.forecastConfidenceScore, null);
    const finalizationCertified = context.finalizationCertified !== false;

    if (robustEv !== null && robustEv > 0 && timingCode.startsWith('EARLY')) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.EARLY_RECHECK,
            label: 'EARLY RECHECK',
            reason: text(context.reason, 'Valore potenziale rilevato, ma la finestra temporale richiede un nuovo controllo vicino al match.'),
            operational: false
        };
    }

    if (robustEv !== null && robustEv > 0 && finalizationCertified && (forecastScore === null || forecastScore >= 55)) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.VALUE_CANDIDATE,
            label: 'VALUE CANDIDATE',
            reason: text(context.reason, 'Previsione e quota mostrano valore potenziale, ma non tutti i requisiti operativi sono soddisfatti.'),
            operational: false
        };
    }

    if (robustEv !== null && robustEv <= 0) {
        return {
            version: CALCIO_DECISION_STATE_VERSION,
            code: DECISION_STATES.NO_BET_VALUE,
            label: 'NO BET · QUOTA INSUFFICIENTE',
            reason: text(context.reason, 'La previsione è analizzabile, ma il valore robusto alla quota disponibile non è positivo.'),
            operational: false
        };
    }

    return {
        version: CALCIO_DECISION_STATE_VERSION,
        code: DECISION_STATES.FORECAST_VALID,
        label: 'FORECAST VALID',
        reason: text(context.reason, 'Previsione finalizzata e valida per analisi; operatività non ancora autorizzata.'),
        operational: false
    };
}

function analysisStageFromDecisionState(decisionState = {}) {
    const code = text(decisionState.code, DECISION_STATES.FORECAST_VALID);
    const summary = text(decisionState.reason, 'Stato decisionale derivato dal mercato finalizzato.');
    return {
        code,
        label: text(decisionState.label, 'FORECAST VALID'),
        summary,
        // Alias mantenuto per compatibilità con i writer legacy che leggono stage.reason.
        reason: summary,
        version: CALCIO_DECISION_STATE_VERSION,
        analysisOnly: code !== DECISION_STATES.BET_READY
    };
}

function buildFinalMarketSnapshot(options = {}) {
    const candidate = options.candidate || {};
    const report = options.report || {};
    const decision = options.decision || {};
    const stakeAuthority = options.stakeAuthority || report.stakeAuthority || decision.stakeAuthority || {};
    const dataQuality = options.dataQuality || report.dataQualityAuthority || decision.dataQualityAssessment || {};
    const reliability = options.predictionReliability || report.predictionReliability || {};
    const prediction = normalizePrediction(options.prediction || candidate.prediction || report.finalMarket?.prediction);
    const marketType = text(options.marketType || candidate.market_type || candidate.marketType || inferMarketType(prediction)).toUpperCase();
    const probabilityIntegrity = options.probabilityIntegrity || candidate.probabilityIntegrity || candidate.extData?.probabilityIntegrity || {};
    // PATCH 26F-C R2: alcuni candidati finalizzati conservano le diagnostiche
    // complete nell'IPM, mentre il ramo probabilityIntegrity del vincitore puo
    // essere parziale. Il fallback legge esclusivamente evidenze gia calcolate:
    // non sostituisce ne ricalcola la probabilita production.
    const probabilityFallback = deriveProbabilityFallback(options, candidate, report, decision);
    const selected = selectDiagnostic(probabilityIntegrity, prediction, probabilityFallback);
    const probabilityPct = round(options.probabilityPct ?? candidate.estimatedProb ?? candidate.estimated_prob ?? report.finalMarket?.probability);
    const eventKey = text(options.eventKey || candidate.event_key || candidate.eventKey || candidate.match_exposure_key);
    const forecastConfidenceScore = round(reliability.score ?? candidate.calcio_prediction_reliability_score ?? candidate.prediction_reliability_score, 2);
    const forecastConfidenceLabel = text(
        reliability.label
        || candidate.calcio_prediction_reliability_label
        || candidate.prediction_reliability_label
        || confidenceLabel(forecastConfidenceScore),
        confidenceLabel(forecastConfidenceScore)
    ).toUpperCase();
    const robustEvPct = round(
        options.robustEvPct
        ?? stakeAuthority.robustEvPct
        ?? report.reliabilityGuard?.robustEvPct
        ?? decision.reliabilityGuard?.robustEvPct,
        3
    );
    const finalizationStatus = text(options.finalizationStatus || decision.finalizationStatus || report.marketSelectionFinalization?.status);
    const finalizationCertified = options.finalizationCertified ?? report.marketSelectionFinalization?.fullyFinalized ?? true;
    const finalOperationalStake = round(
        options.finalOperationalStake
        ?? stakeAuthority.finalOperationalStake
        ?? decision.operationalStake,
        2
    ) ?? 0;
    const timingCode = text(options.timingCode || stakeAuthority.timingPolicy?.code || report.reliabilityGuard?.timingPolicy?.code);
    const decisionState = evaluateDecisionState({
        failed: options.failed,
        failureReason: options.failureReason,
        finalizationStatus,
        finalizationCertified,
        dataQuality: dataQuality,
        dataQualityStatus: dataQuality.status,
        dataQualityBlocking: dataQuality.blocking,
        coverageMode: probabilityIntegrity.coverageMode,
        dataClass: decision.dataClass,
        finalOperationalStake,
        eligible: options.eligible ?? decision.eligible ?? stakeAuthority.eligible,
        allowBet: options.allowBet ?? decision.allowBet ?? stakeAuthority.allowBet,
        robustEvPct,
        timingCode,
        forecastConfidenceScore,
        reason: options.reason || stakeAuthority.reason || decision.reason
    });

    const snapshot = {
        version: CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION,
        generatedAt: new Date().toISOString(),
        eventKey: eventKey || null,
        marketId: stableMarketId({ eventKey, prediction, marketType }),
        prediction,
        marketType,
        odd: round(options.odd ?? candidate.odd ?? report.finalMarket?.odd, 3),
        probabilityPct,
        edgePp: round(options.edgePp ?? decision.edgePp ?? candidate.edge_pp ?? candidate.edge, 3),
        evPct: round(options.evPct ?? decision.evPct ?? candidate.ev_pct, 3),
        probability: {
            finalProbabilityPct: probabilityPct,
            modelProbabilityPct: selected.modelProbabilityPct,
            monteCarloProbabilityPct: selected.monteCarloProbabilityPct,
            marketProbabilityPct: selected.marketProbabilityPct,
            disagreementPp: selected.disagreementPp,
            monteCarloSamplingErrorPp: selected.monteCarloSamplingErrorPp,
            modelAgreementReliability: selected.modelAgreementReliability,
            sourceWeights: selected.sourceWeights
        },
        coverageMode: text(probabilityIntegrity.coverageMode || candidate.probability_coverage_mode, 'UNKNOWN').toUpperCase(),
        forecastConfidence: {
            score: forecastConfidenceScore,
            label: forecastConfidenceLabel,
            version: text(reliability.version || 'CALCIO_FORECAST_CONFIDENCE_CANONICAL_V1')
        },
        dataQuality: {
            status: text(dataQuality.status || candidate.calcio_data_quality_status, 'N/D'),
            label: text(dataQuality.label || candidate.calcio_data_quality_label, 'N/D'),
            score: round(dataQuality.score ?? candidate.calcio_data_quality_score, 2),
            blocking: dataQuality.blocking === true || Number(candidate.calcio_data_quality_blocking || 0) === 1
        },
        stake: {
            modelStake: round(stakeAuthority.modelStake ?? decision.theoreticalStake ?? candidate.calcio_stake_authority_model_stake, 2) ?? 0,
            reliabilityStake: round(stakeAuthority.reliabilityStake ?? decision.prePortfolioCapStake ?? candidate.calcio_stake_authority_reliability_stake, 2) ?? 0,
            prePortfolioCapStake: round(stakeAuthority.prePortfolioCapStake ?? decision.prePortfolioCapStake ?? candidate.calcio_portfolio_pre_cap_stake, 2) ?? 0,
            finalOperationalStake,
            authorityVersion: text(stakeAuthority.version || candidate.calcio_stake_authority_version),
            authorityStatus: text(stakeAuthority.status || candidate.calcio_stake_authority_status)
        },
        robustness: {
            robustProbabilityPct: round(stakeAuthority.robustProbabilityPct ?? report.reliabilityGuard?.robustProbabilityPct ?? decision.reliabilityGuard?.robustProbabilityPct, 3),
            robustEvPct,
            epistemicUncertaintyScore: round(stakeAuthority.epistemicUncertaintyScore ?? report.reliabilityGuard?.epistemicUncertaintyScore, 2),
            timingCode: timingCode || null
        },
        scorelineDistribution: scorelineDistribution(options.monteCarlo || candidate.extData?.monteCarlo || report.monteCarlo),
        decisionState,
        finalization: {
            status: finalizationStatus || null,
            certified: finalizationCertified === true
        }
    };
    const coherence = assertSnapshotCoherence(snapshot, { throwOnError: false });
    snapshot.coherence = coherence;
    return snapshot;
}

function refreshAfterAllocation(existingSnapshot, options = {}) {
    const existing = parseJson(existingSnapshot, {});
    const snapshot = {
        ...existing,
        version: CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION,
        generatedAt: new Date().toISOString(),
        stake: {
            ...(existing.stake || {}),
            finalOperationalStake: round(options.finalOperationalStake, 2) ?? 0,
            authorityStatus: text(options.authorityStatus || existing.stake?.authorityStatus)
        },
        dataQuality: {
            ...(existing.dataQuality || {}),
            ...(options.dataQuality || {})
        },
        finalization: {
            ...(existing.finalization || {}),
            status: text(options.finalizationStatus || existing.finalization?.status),
            certified: options.finalizationCertified ?? existing.finalization?.certified ?? true
        }
    };
    snapshot.decisionState = evaluateDecisionState({
        failed: options.failed,
        failureReason: options.failureReason,
        finalizationStatus: snapshot.finalization.status,
        finalizationCertified: snapshot.finalization.certified,
        dataQuality: snapshot.dataQuality,
        dataQualityStatus: snapshot.dataQuality.status,
        dataQualityBlocking: snapshot.dataQuality.blocking,
        coverageMode: snapshot.coverageMode,
        dataClass: options.dataClass,
        finalOperationalStake: snapshot.stake.finalOperationalStake,
        eligible: options.eligible,
        allowBet: options.allowBet,
        robustEvPct: snapshot.robustness?.robustEvPct,
        timingCode: snapshot.robustness?.timingCode,
        forecastConfidenceScore: snapshot.forecastConfidence?.score,
        reason: options.reason || snapshot.decisionState?.reason
    });
    snapshot.coherence = assertSnapshotCoherence(snapshot, { throwOnError: false });
    return snapshot;
}

function assertSnapshotCoherence(snapshot = {}, options = {}) {
    const errors = [];
    const prediction = normalizePrediction(snapshot.prediction);
    const expectedType = inferMarketType(prediction);
    if (!prediction) errors.push('PREDICTION_MISSING');
    if (!snapshot.marketId) errors.push('MARKET_ID_MISSING');
    if (text(snapshot.marketType).toUpperCase() !== expectedType) errors.push('MARKET_TYPE_MISMATCH');
    const finalProbability = num(snapshot.probabilityPct, null);
    const nestedProbability = num(snapshot.probability?.finalProbabilityPct, null);
    if (finalProbability === null || nestedProbability === null || Math.abs(finalProbability - nestedProbability) > 0.001) {
        errors.push('FINAL_PROBABILITY_MISMATCH');
    }
    if (!snapshot.forecastConfidence?.label) errors.push('FORECAST_CONFIDENCE_MISSING');
    if (!snapshot.decisionState?.code) errors.push('DECISION_STATE_MISSING');
    if (snapshot.decisionState?.code === DECISION_STATES.BET_READY && num(snapshot.stake?.finalOperationalStake, 0) < MINIMUM_OPERATIONAL_STAKE) {
        errors.push('BET_READY_WITHOUT_MINIMUM_STAKE');
    }
    const result = {
        status: errors.length ? COHERENCE_FAILED : COHERENCE_CERTIFIED,
        certified: errors.length === 0,
        errors,
        marketId: snapshot.marketId || null,
        prediction: prediction || null
    };
    if (options.throwOnError && errors.length) {
        const error = new Error(`PATCH26FA_FINAL_MARKET_CONTRACT:${errors.join(',')}`);
        error.code = 'PATCH26FA_FINAL_MARKET_CONTRACT';
        error.audit = result;
        throw error;
    }
    return result;
}

function persistenceFields(snapshot = {}) {
    const state = snapshot.decisionState || {};
    const coherence = snapshot.coherence || assertSnapshotCoherence(snapshot, { throwOnError: false });
    return {
        calcio_final_market_contract_version: CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION,
        calcio_final_market_id: snapshot.marketId || null,
        calcio_final_market_snapshot: JSON.stringify(snapshot),
        calcio_forecast_confidence_score: num(snapshot.forecastConfidence?.score, null),
        calcio_forecast_confidence_label: text(snapshot.forecastConfidence?.label),
        calcio_decision_state_version: CALCIO_DECISION_STATE_VERSION,
        calcio_decision_state: text(state.code),
        calcio_decision_state_reason: text(state.reason),
        calcio_diagnostic_coherence_status: text(coherence.status, COHERENCE_FAILED),
        calcio_diagnostic_coherence_audit: JSON.stringify(coherence)
    };
}

module.exports = {
    CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION,
    CALCIO_DECISION_STATE_VERSION,
    COHERENCE_CERTIFIED,
    COHERENCE_FAILED,
    MINIMUM_OPERATIONAL_STAKE,
    DECISION_STATES,
    num,
    text,
    round,
    parseJson,
    normalizePrediction,
    inferMarketType,
    confidenceLabel,
    stableMarketId,
    firstFinite,
    probabilityComponent,
    deriveProbabilityFallback,
    selectDiagnostic,
    scorelineDistribution,
    evaluateDecisionState,
    analysisStageFromDecisionState,
    buildFinalMarketSnapshot,
    refreshAfterAllocation,
    assertSnapshotCoherence,
    persistenceFields
};
