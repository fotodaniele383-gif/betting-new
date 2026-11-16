'use strict';

const CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION = 'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_PORTFOLIO_AUDIT_V1';

const CANONICAL_DEEP_SCAN = Object.freeze([
    'RISCHIO MODELLO',
    'EDGE TECNICO',
    'VALUE CONFERMATO / MICRO',
    'ALTO RISCHIO',
    'WATCHLIST LOW EDGE'
]);
const CANONICAL_QUALITY_GATE = Object.freeze([
    'WATCHLIST MICRO',
    'BLOCCATA SOFT',
    'BLOCCATA HARD',
    'APPROVATA CON CAP',
    'APPROVATA'
]);

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((finite(value, 0) + Number.EPSILON) * factor) / factor;
}
function upper(value = '') { return String(value || '').trim().toUpperCase(); }
function normalizeText(value = '') {
    return upper(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function firstFinite(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function normalizeDeepScan(row = {}) {
    const text = normalizeText(row.ds_action || row.deepScanAction || row.deep_scan || row.ds_suggestion || '');
    if (!text) return 'N/D';
    if (text.includes('ALTO RISCHIO') || text.includes('HIGH RISK') || text.includes('VALUE TRAP')) return 'ALTO RISCHIO';
    if (text.includes('RISCHIO MODELLO') || text.includes('MODEL RISK')) return 'RISCHIO MODELLO';
    if (text.includes('VALUE CONFERMATO') || text.includes('VIA LIBERA') || text.includes('SUPER VALUE') || text.includes('VALUE RIESAME OPERATIVO') || text.includes('OPERATIONAL VALUE')) return 'VALUE CONFERMATO / MICRO';
    if (text.includes('EDGE TECNICO')) return 'EDGE TECNICO';
    if (text.includes('WATCHLIST') || text.includes('LOW EDGE') || text.includes('VALUE QUALITATIVO')) return 'WATCHLIST LOW EDGE';
    return String(row.ds_action || row.deepScanAction || 'ALTRO').trim() || 'ALTRO';
}

function classifyDeepScanGateSignal(action = '', suggestion = '') {
    // Patch 15: la macro tecnica deve essere classificata separatamente dal testo di timing.
    // Una suggestion come "attendi i primi 20 minuti" non può degradare VALUE CONFERMATO o EDGE TECNICO.
    const actionCanonical = normalizeDeepScan({ ds_action: action });
    if (actionCanonical === 'ALTO RISCHIO') return 'HIGH_RISK';
    if (actionCanonical === 'RISCHIO MODELLO') return 'MODEL_RISK';
    if (actionCanonical === 'VALUE CONFERMATO / MICRO') return 'CONFIRMATIVE';
    if (actionCanonical === 'EDGE TECNICO') return 'TECH_EDGE';
    if (actionCanonical === 'WATCHLIST LOW EDGE') return 'WATCHLIST';

    const actionText = normalizeText(action);
    if (actionText.includes('ATTENDI') || actionText.includes('IN PLAY') || actionText.includes('WAIT') || actionText.includes('LIVE')) return 'WAIT_IN_PLAY';

    // Fallback solo quando la macro non è disponibile o non è canonica.
    const fallback = normalizeText(suggestion);
    if (fallback.includes('ALTO RISCHIO') || fallback.includes('HIGH RISK') || fallback.includes('SCARTA') || fallback.includes('NO BET')) return 'HIGH_RISK';
    if (fallback.includes('RISCHIO MODELLO') || fallback.includes('MODEL RISK')) return 'MODEL_RISK';
    if (fallback.includes('VIA LIBERA') || fallback.includes('VALUE CONFERMATO') || fallback.includes('SUPER VALUE') || fallback.includes('VALUE RIESAME OPERATIVO') || fallback.includes('OPERATIONAL VALUE')) return 'CONFIRMATIVE';
    if (fallback.includes('EDGE TECNICO') || fallback.includes('TECH EDGE')) return 'TECH_EDGE';
    if (fallback.includes('WATCHLIST') || fallback.includes('LOW EDGE')) return 'WATCHLIST';
    if (fallback.includes('ATTENDI') || fallback.includes('IN PLAY') || fallback.includes('WAIT') || fallback.includes('LIVE')) return 'WAIT_IN_PLAY';
    return 'UNKNOWN';
}

function normalizeQualityGate(row = {}) {
    const raw = row.calcio_quality_final_label || row.quality_final_label || row.qualityFinalLabel
        || row.calcio_gate_status || row.calcio_operational_status || row.professional_gate_status || '';
    const text = normalizeText(raw);
    if (!text) return 'N/D';
    if (text.includes('BLOCCATA HARD') || text.includes('BLOCKED HARD') || text.includes('NO BET HARD')) return 'BLOCCATA HARD';
    if (text.includes('APPROVATA CON CAP') || text.includes('APPROVED WITH CAP')) return 'APPROVATA CON CAP';
    if (text.includes('APPROVATA') || text.includes('APPROVED FULL') || text === 'APPROVED') return 'APPROVATA';
    if (text.includes('WATCHLIST MICRO') || text.includes('EARLY MICRO') || text.includes('MICRO')) return 'WATCHLIST MICRO';
    if (text.includes('BLOCCATA SOFT') || text.includes('BLOCKED SOFT') || text.includes('EARLY WATCHLIST') || text.includes('WATCHLIST TEMPORALE')) return 'BLOCCATA SOFT';
    return String(raw).trim() || 'ALTRO';
}

function theoreticalStake(row = {}) {
    return Math.max(0, finite(
        row.calcio_theoretical_stake ?? row.stake_theoretical ?? row.theoreticalStake ?? row.stake_base_before_deepscan,
        0
    ));
}
function operationalStake(row = {}) {
    return Math.max(0, finite(
        row.calcio_operational_stake ?? row.stake_operational ?? row.operationalStake ?? row.stake ?? row.invested,
        0
    ));
}

function classifyStakeCause(row = {}) {
    const theoretical = theoreticalStake(row);
    const operational = operationalStake(row);
    const lifecycle = normalizeText(row.calcio_stake_lifecycle_status || row.stake_lifecycle_status || '');
    const timing = normalizeText(row.calcio_timing_status || row.timingStatus || '');
    const stage = normalizeText(row.calcio_analysis_stage_code || row.analysis_stage_code || '');
    const stageReason = normalizeText(row.calcio_analysis_stage_reason || row.analysis_stage_reason || '');
    const policy = normalizeText(row.stake_policy_note || row.calcio_stake_reason || row.calcio_stake_lifecycle_reason || '');
    const score = firstFinite(row.calcio_prediction_reliability_score, row.quality_final_score, row.quality_base_score, row.confidence);

    const deepScan = normalizeText(row.ds_action || row.ds_suggestion || '');
    if (operational > 0) return 'OPERATIONAL_POSITIVE';
    if (lifecycle.includes('DATA UNRELIABLE') || policy.includes('INATTENDIBILE') || (score !== null && score < 55)) return 'DATA_UNRELIABLE';
    if (deepScan.includes('ALTO RISCHIO') || lifecycle.includes('BLOCKED HARD')) return 'HARD_VETO';
    if (deepScan.includes('RISCHIO MODELLO') || lifecycle.includes('MODEL REVIEW')) return 'MODEL_RISK_VETO';
    if (theoretical > 0 && (timing.includes('EARLY WATCHLIST') || lifecycle.includes('THEORETICAL ONLY EARLY'))) return 'EARLY_TIMING_ZERO';
    if (stageReason.includes('EDGE SOTTO SOGLIA') || stageReason.includes('PROBABILITA SOTTO SOGLIA') || stageReason.includes('QUOTA OLTRE') || stageReason.includes('QUOTA SOTTO') || stageReason.includes('CROSS REFERENCE')) return 'QUANT_THRESHOLD';
    if (lifecycle.includes('BLOCKED HARD') || lifecycle.includes('BLOCKED BY FINAL GATE') || normalizeQualityGate(row).includes('BLOCCATA')) return 'GATE_BLOCK';
    if (stage === 'NO VALUE SIGNAL') return 'NO_VALUE_SIGNAL';
    if (policy.includes('KELLY') || stageReason.includes('KELLY')) return 'KELLY_ZERO';
    if (theoretical > 0) return 'THEORETICAL_ONLY_OTHER';
    return 'NO_THEORETICAL_OTHER';
}

function statusOf(row = {}) {
    const status = upper(row.status || row.result || 'PENDING');
    if (status === 'WON' || status === 'LOST' || status === 'PUSH' || status === 'VOID') return status;
    return 'PENDING';
}

function buildStakeDiagnostics(rows = []) {
    const clean = Array.isArray(rows) ? rows : [];
    const byCause = {};
    const byTiming = {};
    const byPredictionIndexBand = {};
    let theoreticalPositive = 0;
    let operationalPositive = 0;
    let totalTheoreticalStake = 0;
    let totalOperationalStake = 0;
    let pending = 0;

    clean.forEach(row => {
        const theoretical = theoreticalStake(row);
        const operational = operationalStake(row);
        const cause = classifyStakeCause(row);
        const predictionIndex = firstFinite(row.calcio_prediction_index_score, row.predictionIndex?.score, row.prediction_index?.score);
        const timing = upper(row.calcio_timing_status || row.timingStatus || 'UNKNOWN') || 'UNKNOWN';
        const indexBand = upper(row.calcio_prediction_index_label || row.predictionIndex?.label || 'N/D') || 'N/D';
        byCause[cause] = (byCause[cause] || 0) + 1;
        byTiming[timing] = (byTiming[timing] || 0) + 1;
        byPredictionIndexBand[indexBand] = (byPredictionIndexBand[indexBand] || 0) + 1;
        if (theoretical > 0) theoreticalPositive += 1;
        if (operational > 0) operationalPositive += 1;
        totalTheoreticalStake += theoretical;
        totalOperationalStake += operational;
        if (statusOf(row) === 'PENDING') pending += 1;
    });

    return {
        version: CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION,
        sample: clean.length,
        pending,
        theoreticalPositive,
        operationalPositive,
        zeroOperational: Math.max(0, clean.length - operationalPositive),
        totalTheoreticalStake: round(totalTheoreticalStake, 2),
        totalOperationalStake: round(totalOperationalStake, 2),
        byCause,
        byTiming,
        byPredictionIndexBand,
        primaryCause: Object.entries(byCause).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NO_ROWS',
        policy: {
            minimumPositiveStakeEur: 2,
            earlyMicroCapEur: 3,
            earlyMicroFraction: 0.25,
            unreliableThreshold: 55,
            roiUsesResolvedOperationalStakeOnly: true,
            softBlockIsCapNotVeto: true,
            stakeAuthority: 'UNIFIED_PREDICTION_INDEX_ONLY',
            minimumPredictionIndexForStake: 60
        }
    };
}

function createGroup(deepScan, qualityGate) {
    return {
        deepScan,
        qualityGate,
        totalSignals: 0,
        pending: 0,
        won: 0,
        lost: 0,
        push: 0,
        void: 0,
        resolved: 0,
        theoreticalPositive: 0,
        operationalPositive: 0,
        totalTheoreticalStake: 0,
        totalOperationalStake: 0,
        resolvedOperationalStake: 0,
        profit: 0,
        probabilitySum: 0,
        probabilityCount: 0,
        edgeSum: 0,
        edgeCount: 0,
        evSum: 0,
        evCount: 0,
        realPtWeightedSum: 0,
        realPtWeight: 0,
        realPtSimpleSum: 0,
        realPtSimpleCount: 0,
        predictionIndexSum: 0,
        predictionIndexCount: 0,
        causeCounts: {}
    };
}

function buildDsGateMetrics(rows = []) {
    const clean = Array.isArray(rows) ? rows : [];
    const groups = new Map();

    clean.forEach(row => {
        const deepScan = normalizeDeepScan(row);
        const qualityGate = normalizeQualityGate(row);
        const key = `${deepScan}|||${qualityGate}`;
        if (!groups.has(key)) groups.set(key, createGroup(deepScan, qualityGate));
        const group = groups.get(key);
        const status = statusOf(row);
        const theoretical = theoreticalStake(row);
        const operational = operationalStake(row);
        const probability = firstFinite(row.estimated_prob, row.estimatedProb, row.probability, row.prob);
        const edge = firstFinite(row.edge_pp, row.edge);
        const ev = firstFinite(row.ev_pct, row.expected_roi, row.rawEdge);
        const predictionIndex = firstFinite(
            row.calcio_prediction_index_score,
            row.predictionIndex?.score,
            row.prediction_index?.score
        );
        const realPt = firstFinite(row.historical_combo_adjusted_rate_pct, row.historical_combo_win_rate_pct);
        const realPtWeight = Math.max(0, finite(row.historical_combo_resolved, 0));
        const cause = classifyStakeCause(row);

        group.totalSignals += 1;
        group.causeCounts[cause] = (group.causeCounts[cause] || 0) + 1;
        if (status === 'PENDING') group.pending += 1;
        else if (status === 'WON') { group.won += 1; group.resolved += 1; }
        else if (status === 'LOST') { group.lost += 1; group.resolved += 1; }
        else if (status === 'PUSH') group.push += 1;
        else if (status === 'VOID') group.void += 1;

        if (theoretical > 0) group.theoreticalPositive += 1;
        if (operational > 0) group.operationalPositive += 1;
        group.totalTheoreticalStake += theoretical;
        group.totalOperationalStake += operational;

        if ((status === 'WON' || status === 'LOST') && operational > 0) {
            group.resolvedOperationalStake += operational;
            group.profit += finite(row.profit, 0);
        }
        if (probability !== null) { group.probabilitySum += probability; group.probabilityCount += 1; }
        if (edge !== null) { group.edgeSum += edge; group.edgeCount += 1; }
        if (ev !== null) { group.evSum += ev; group.evCount += 1; }
        if (predictionIndex !== null) { group.predictionIndexSum += predictionIndex; group.predictionIndexCount += 1; }
        if (realPt !== null) {
            group.realPtSimpleSum += realPt;
            group.realPtSimpleCount += 1;
            if (realPtWeight > 0) {
                group.realPtWeightedSum += realPt * realPtWeight;
                group.realPtWeight += realPtWeight;
            }
        }
    });

    const result = [...groups.values()].map(group => {
        const hitRate = group.resolved > 0 ? group.won / group.resolved * 100 : null;
        const roi = group.resolvedOperationalStake > 0 ? group.profit / group.resolvedOperationalStake * 100 : null;
        const avgRealPt = group.realPtWeight > 0
            ? group.realPtWeightedSum / group.realPtWeight
            : (group.realPtSimpleCount > 0 ? group.realPtSimpleSum / group.realPtSimpleCount : null);
        let decision = 'SOLO AUDIT';
        if (group.resolvedOperationalStake > 0) {
            if (group.resolved >= 8 && roi >= 8 && hitRate >= 55) decision = 'PROMUOVI';
            else if (roi >= 0) decision = group.resolved < 5 ? 'MANTIENI · SAMPLE BASSO' : 'MANTIENI';
            else if (roi > -12) decision = 'RIDUCI';
            else decision = 'BLOCCA';
        } else if (group.deepScan === 'ALTO RISCHIO' || group.qualityGate === 'BLOCCATA HARD') {
            decision = 'BLOCCA / SOLO AUDIT';
        }
        return {
            version: CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION,
            deepScan: group.deepScan,
            qualityGate: group.qualityGate,
            totalSignals: group.totalSignals,
            pending: group.pending,
            resolved: group.resolved,
            won: group.won,
            lost: group.lost,
            push: group.push,
            void: group.void,
            hitRatePct: hitRate === null ? null : round(hitRate, 2),
            avgProbabilityPct: group.probabilityCount ? round(group.probabilitySum / group.probabilityCount, 2) : null,
            avgRealPtPct: avgRealPt === null ? null : round(avgRealPt, 2),
            realPtEvidenceRows: group.realPtSimpleCount,
            avgEdgePp: group.edgeCount ? round(group.edgeSum / group.edgeCount, 2) : null,
            avgEvPct: group.evCount ? round(group.evSum / group.evCount, 2) : null,
            avgPredictionIndex: group.predictionIndexCount ? round(group.predictionIndexSum / group.predictionIndexCount, 2) : null,
            theoreticalPositive: group.theoreticalPositive,
            operationalPositive: group.operationalPositive,
            avgTheoreticalStake: group.totalSignals ? round(group.totalTheoreticalStake / group.totalSignals, 2) : 0,
            avgOperationalStake: group.totalSignals ? round(group.totalOperationalStake / group.totalSignals, 2) : 0,
            totalOperationalStake: round(group.totalOperationalStake, 2),
            resolvedOperationalStake: round(group.resolvedOperationalStake, 2),
            profit: round(group.profit, 2),
            roiPct: roi === null ? null : round(roi, 2),
            decision,
            primaryZeroCause: Object.entries(group.causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NO_ROWS',
            causeCounts: group.causeCounts
        };
    });

    return {
        version: CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION,
        canonicalDeepScan: [...CANONICAL_DEEP_SCAN],
        canonicalQualityGate: [...CANONICAL_QUALITY_GATE],
        rows: result.sort((a, b) => b.totalSignals - a.totalSignals || b.resolved - a.resolved || (b.roiPct ?? -999) - (a.roiPct ?? -999) || a.deepScan.localeCompare(b.deepScan)),
        totals: buildStakeDiagnostics(clean)
    };
}

module.exports = {
    CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION,
    CANONICAL_DEEP_SCAN,
    CANONICAL_QUALITY_GATE,
    normalizeDeepScan,
    normalizeQualityGate,
    classifyDeepScanGateSignal,
    theoreticalStake,
    operationalStake,
    classifyStakeCause,
    buildStakeDiagnostics,
    buildDsGateMetrics
};
