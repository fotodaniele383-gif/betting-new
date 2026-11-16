'use strict';

const TENNIS_UNIFIED_PREDICTION_INDEX_VERSION = 'BETTING_PATCH_26F_E_TENNIS_PREDICTION_INDEX_DISPLAY_V1';
const TENNIS_UNIFIED_PREDICTION_INDEX_AUTHORITY = 'DISPLAY_ONLY_NO_STAKE_AUTHORITY';

const BASE_WEIGHTS = Object.freeze({
    qualityGate: 0.30,
    modelConfidence: 0.20,
    value: 0.25,
    deepScan: 0.10,
    paperTrading: 0.10,
    dataSufficiency: 0.05
});

function finite(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}
function clamp(value, min = 0, max = 100) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
}
function round(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const m = 10 ** digits;
    return Math.round((n + Number.EPSILON) * m) / m;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function parseObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) { return null; }
}
function predictionIndexLabel(score) {
    const n = finite(score) ?? 0;
    if (n < 45) return 'SCARTA';
    if (n < 60) return 'SOLO ANALISI';
    if (n < 70) return 'MICRO';
    if (n < 80) return 'VALUE';
    if (n < 90) return 'FORTE';
    return 'TOP';
}
function normalizeDeepScanClass(value) {
    const raw = upper(value?.action || value?.displayAction || value?.class || value);
    if (!raw) return { available: false, cls: 'PENDING', score: null };
    if (raw.includes('ALTO RISCHIO') || raw.includes('HIGH_RISK') || raw.includes('PERICOLO') || raw.includes('🔴')) return { available: true, cls: 'HIGH_RISK', score: 15 };
    if (raw.includes('RISCHIO MODELLO') || raw.includes('MODEL_RISK') || raw.includes('🟠')) return { available: true, cls: 'MODEL_RISK', score: 40 };
    if (raw.includes('EDGE TECNICO') || raw.includes('TECHNICAL_EDGE') || raw.includes('📊')) return { available: true, cls: 'TECHNICAL_EDGE', score: 65 };
    if (raw.includes('VALUE CONFERMATO') || raw.includes('VIA LIBERA') || raw.includes('CONFIRMED_VALUE') || raw.includes('🟢')) return { available: true, cls: 'CONFIRMED_VALUE', score: 80 };
    if (raw.includes('WATCHLIST') || raw.includes('LOW EDGE') || raw.includes('🟡')) return { available: true, cls: 'WATCHLIST', score: 55 };
    return { available: true, cls: 'OTHER', score: 45 };
}
function resolveQualityGate(input = {}) {
    const nested = input.qualityGateV2 || input.quality_gate_v2 || input.qualityFinal || input.qualityBase || {};
    const score = clamp(finite(
        nested.score,
        input.quality_final_score,
        input.qualityFinalScore,
        input.quality_base_score,
        input.qualityBaseScore,
        input.professionalGate?.score
    ));
    const label = text(
        nested.label || input.quality_final_label || input.qualityFinalLabel ||
        input.quality_base_label || input.qualityBaseLabel || input.pre_match_gate_label || 'N/D'
    );
    const code = text(nested.code || input.quality_final_code || input.quality_base_code || input.pre_match_gate_code || '');
    const reason = text(nested.reason || input.quality_final_reason || input.quality_base_reason || input.tennis_operational_summary || '');
    return { available: score !== null, score, label, code, reason };
}
function resolveHistoricalEvidence(input = {}) {
    const nested = input.historicalCombinationEvidence || input.realProbabilityPaperTrading || input.historicalEvidence || {};
    const resolved = Math.max(0, Math.trunc(finite(nested.resolved, nested.sample, input.historical_combo_resolved) ?? 0));
    const score = clamp(finite(
        nested.adjustedRatePct,
        nested.adjusted_rate_pct,
        nested.winRatePct,
        input.historical_combo_adjusted_rate_pct,
        input.historical_combo_win_rate_pct
    ));
    return {
        available: resolved > 0 && score !== null,
        score,
        resolved,
        reliability: text(nested.reliability || input.historical_combo_reliability || 'N/D')
    };
}
function resolveValueComponent(input = {}) {
    const edgePp = finite(input.edge_pp, input.edgePp, input.edge, input.rawEdge);
    const evPct = finite(input.ev_pct, input.evPct, input.ev, input.expectedValue);
    if (edgePp === null && evPct === null) return { available: false, score: null, edgePp, evPct };
    const edgeScore = clamp(Math.max(0, edgePp ?? 0) / 8 * 100) ?? 0;
    const evScore = clamp(Math.max(0, evPct ?? 0) / 12 * 100) ?? 0;
    const score = round(edgeScore * 0.55 + evScore * 0.45, 2);
    return { available: true, score, edgePp: round(edgePp, 3), evPct: round(evPct, 3), edgeScore: round(edgeScore, 2), evScore: round(evScore, 2) };
}
function calculateTennisPredictionIndex(input = {}, options = {}) {
    const qualityGate = resolveQualityGate(input);
    const modelConfidenceScore = clamp(finite(
        input.model_confidence_score,
        input.modelConfidenceScore,
        input.valueScore,
        input.reliability?.score
    ));
    const value = resolveValueComponent(input);
    const deepScan = normalizeDeepScanClass(input.deepScan || input.ds_action || input.dsAction || input.deep_scan_action);
    const paperTrading = resolveHistoricalEvidence(input);
    const dataSufficiencyScore = clamp(finite(input.data_sufficiency_score, input.dataSufficiencyScore, input.dataSufficiency?.score));

    const components = {
        qualityGate: { available: qualityGate.available, score: qualityGate.score, weight: BASE_WEIGHTS.qualityGate, label: qualityGate.label, code: qualityGate.code },
        modelConfidence: { available: modelConfidenceScore !== null, score: modelConfidenceScore, weight: BASE_WEIGHTS.modelConfidence },
        value: { available: value.available, score: value.score, weight: BASE_WEIGHTS.value, edgePp: value.edgePp, evPct: value.evPct },
        deepScan: { available: deepScan.available, score: deepScan.score, weight: BASE_WEIGHTS.deepScan, class: deepScan.cls },
        paperTrading: { available: paperTrading.available, score: paperTrading.score, weight: BASE_WEIGHTS.paperTrading, sample: paperTrading.resolved, reliability: paperTrading.reliability },
        dataSufficiency: { available: dataSufficiencyScore !== null, score: dataSufficiencyScore, weight: BASE_WEIGHTS.dataSufficiency }
    };

    let activeWeight = 0;
    let weighted = 0;
    for (const component of Object.values(components)) {
        if (!component.available || component.score === null) {
            component.effectiveWeight = 0;
            component.contribution = 0;
            continue;
        }
        activeWeight += component.weight;
        weighted += component.score * component.weight;
    }
    const score = activeWeight > 0 ? round(weighted / activeWeight, 2) : null;
    for (const component of Object.values(components)) {
        component.effectiveWeight = component.available && activeWeight > 0 ? round(component.weight / activeWeight, 4) : 0;
        component.contribution = component.available && score !== null ? round(component.score * component.effectiveWeight, 2) : 0;
    }

    const finalQualityAvailable = Boolean(input.qualityGateV2 || input.quality_final_code || input.qualityFinal?.code);
    const phase = text(options.phase || input.phase || (deepScan.available && finalQualityAvailable ? 'POST_DEEPSCAN_FINAL' : 'PRE_DEEPSCAN_PROVISIONAL'));
    const missing = Object.entries(components).filter(([, component]) => !component.available).map(([key]) => key);
    const operationalStake = Math.max(0, finite(input.stake, input.invested, input.operationalStake, input.qualityGateV2?.stake?.amount) ?? 0);
    const label = score === null ? 'N/D' : predictionIndexLabel(score);
    const reasonParts = [
        phase.includes('FINAL') ? 'Indice Tennis finalizzato dopo DeepScan.' : 'Indice Tennis provvisorio prima del DeepScan.',
        missing.length ? `Componenti non disponibili: ${missing.join(', ')}.` : 'Tutte le componenti disponibili.',
        'Valore diagnostico: non autorizza né modifica lo stake.'
    ];
    return {
        success: score !== null,
        version: TENNIS_UNIFIED_PREDICTION_INDEX_VERSION,
        authority: TENNIS_UNIFIED_PREDICTION_INDEX_AUTHORITY,
        stakeAuthority: false,
        probabilityAuthority: false,
        displayOnly: true,
        phase,
        score,
        label,
        rankValue: score === null ? null : round(score * 1000 + Math.max(0, value.edgePp ?? 0) * 10 + Math.max(0, value.evPct ?? 0), 2),
        eligible: false,
        operationalStake: round(operationalStake, 2),
        activeWeight: round(activeWeight, 4),
        components,
        missingComponents: missing,
        reason: reasonParts.join(' ')
    };
}

module.exports = {
    TENNIS_UNIFIED_PREDICTION_INDEX_VERSION,
    TENNIS_UNIFIED_PREDICTION_INDEX_AUTHORITY,
    BASE_WEIGHTS,
    predictionIndexLabel,
    normalizeDeepScanClass,
    resolveQualityGate,
    resolveHistoricalEvidence,
    resolveValueComponent,
    calculateTennisPredictionIndex
};
