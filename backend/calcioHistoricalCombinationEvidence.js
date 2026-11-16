'use strict';

const crypto = require('crypto');

const CALCIO_HISTORICAL_COMBINATION_VERSION = 'CALCIO_HISTORICAL_COMBINATION_EVIDENCE_V1_PATCH4';
const CALCIO_HISTORICAL_COMBINATION_MODE = 'CALCIO_PAPER_TRADING_RESOLVED_DS_GATE_AS_OF_SAFE_READ_ONLY';
const PRIOR_STRENGTH = 12;
const CONFIDENCE_Z = 1.96;
const MIN_DISPLAY_SAMPLE = 1;
const MIN_DECISION_SAMPLE = 8;

const DEEP_SCAN_LABEL = Object.freeze({
    VALUE_CONFIRMED: 'VALUE CONFERMATO / MICRO',
    MODEL_RISK: 'RISCHIO MODELLO',
    TECHNICAL_EDGE: 'EDGE TECNICO',
    HIGH_RISK: 'ALTO RISCHIO',
    WATCHLIST: 'WATCHLIST LOW EDGE',
    WAIT_IN_PLAY: 'ATTENDI IN-PLAY',
    UNKNOWN: 'SENZA DEEPSCAN'
});

const QUALITY_LABEL = Object.freeze({
    APPROVED: 'APPROVATA',
    APPROVED_WITH_CAP: 'APPROVATA CON CAP',
    WATCHLIST_MICRO: 'WATCHLIST MICRO',
    BLOCKED_SOFT: 'BLOCCATA SOFT',
    BLOCKED_HARD: 'BLOCCATA HARD',
    UNKNOWN: 'SENZA RESA QUALITÀ'
});

function numberOr(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
    const m = 10 ** digits;
    return Math.round(Number(value) * m) / m;
}

function upper(...parts) {
    return parts.flat().map(value => String(value ?? '')).join(' ').toUpperCase();
}

function cleanLabel(value, fallback = 'ALTRO') {
    return String(value || fallback).replace(/\s+/g, ' ').trim() || fallback;
}

function sha256Object(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDeepScanLabel(input = {}) {
    const text = upper(
        input.ds_action,
        input.deepScanAction,
        input.action,
        input.ds_suggestion,
        input.suggestionText,
        input.suggestion
    );

    if (text.includes('ALTO RISCHIO') || text.includes('PERICOLO') || text.includes('VALUE TRAP') || text.includes('NO_BET_HARD')) {
        return DEEP_SCAN_LABEL.HIGH_RISK;
    }
    if (text.includes('RISCHIO MODELLO') || text.includes('MODEL RISK') || text.includes('MODEL_RISK')) {
        return DEEP_SCAN_LABEL.MODEL_RISK;
    }
    if (text.includes('ATTENDI IN-PLAY') || text.includes('ATTENDI IN PLAY') || text.includes('WAIT_IN_PLAY') || text.includes('WAIT IN PLAY')) {
        return DEEP_SCAN_LABEL.WAIT_IN_PLAY;
    }
    if (text.includes('WATCHLIST') || text.includes('LOW EDGE')) {
        return DEEP_SCAN_LABEL.WATCHLIST;
    }
    if (text.includes('EDGE TECNICO') || text.includes('TECHNICAL EDGE')) {
        return DEEP_SCAN_LABEL.TECHNICAL_EDGE;
    }
    if (
        text.includes('VALUE CONFERMATO') ||
        text.includes('VIA LIBERA') ||
        text.includes('CONFERMATA') ||
        text.includes('LOW-MEDIUM') ||
        text.includes('LOW MEDIUM')
    ) {
        return DEEP_SCAN_LABEL.VALUE_CONFIRMED;
    }

    return DEEP_SCAN_LABEL.UNKNOWN;
}

function normalizeQualityLabel(input = {}) {
    const text = upper(
        input.quality_final_code,
        input.quality_final_label,
        input.calcio_gate_status,
        input.calcio_operational_status,
        input.deepscan_gate_status,
        input.gate_status_code,
        input.gate_status_label,
        input.professional_gate_status,
        input.quality,
        input.status
    );

    if (text.includes('BLOCKED_HARD') || text.includes('BLOCCATA HARD') || text.includes('NO_BET') || text.includes('NO BET')) {
        return QUALITY_LABEL.BLOCKED_HARD;
    }
    if (text.includes('BLOCKED_SOFT') || text.includes('BLOCCATA SOFT')) {
        return QUALITY_LABEL.BLOCKED_SOFT;
    }
    if (text.includes('WATCHLIST_MICRO') || text.includes('WATCHLIST MICRO')) {
        return QUALITY_LABEL.WATCHLIST_MICRO;
    }
    if (text.includes('APPROVED_WITH_CAP') || text.includes('APPROVATA CON CAP') || text.includes('WITH CAP')) {
        return QUALITY_LABEL.APPROVED_WITH_CAP;
    }
    if (text.includes('APPROVED_FULL_STAKE') || text.includes('APPROVED') || text.includes('APPROVATA')) {
        return QUALITY_LABEL.APPROVED;
    }

    return QUALITY_LABEL.UNKNOWN;
}

function isStrictCalcioRow(row = {}) {
    return upper(row.sport_type).trim() === 'CALCIO';
}

function isResolvedRow(row = {}) {
    const status = upper(row.status).trim();
    return status === 'WON' || status === 'LOST';
}

function isCurrentQualityRow(row = {}) {
    const quality = upper(row.data_quality).trim();
    return quality === 'CURRENT' || quality === 'CURRENT_BOOTSTRAP';
}

function isSingleRow(row = {}) {
    const type = upper(row.bet_type, row.betType).trim();
    return type === 'SINGLE' || type === 'SINGLE_CR' || (!type.includes('MULTI') && type.includes('SINGLE'));
}

function hasDsGateIdentity(row = {}) {
    return normalizeDeepScanLabel(row) !== DEEP_SCAN_LABEL.UNKNOWN &&
        normalizeQualityLabel(row) !== QUALITY_LABEL.UNKNOWN;
}

function parseTimestamp(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const isoMs = Date.parse(raw);
    if (Number.isFinite(isoMs)) return isoMs;

    // New Calcio analysis rows may store "dd/mm, hh:mm" without a year.
    // This format is intentionally not guessed here: the monotonic DB id cutoff
    // is the authoritative anti-leakage boundary for the live request.
    return null;
}

function filterHistoricalRows(rows = [], options = {}) {
    const excludeBetId = numberOr(options.excludeBetId, null);
    const cutoffId = numberOr(options.cutoffId, null);
    const asOfMs = parseTimestamp(options.asOf || options.calculatedAt || null);

    return (Array.isArray(rows) ? rows : []).filter(row => {
        if (!isStrictCalcioRow(row) || !isResolvedRow(row) || !isCurrentQualityRow(row) || !isSingleRow(row) || !hasDsGateIdentity(row)) {
            return false;
        }

        const id = numberOr(row.id, null);
        if (excludeBetId !== null && id === excludeBetId) return false;
        if (cutoffId !== null && id !== null && id > cutoffId) return false;

        if (asOfMs !== null) {
            const evidenceMs = parseTimestamp(row.settled_at || row.settlement_observed_at || row.match_date);
            if (evidenceMs !== null && evidenceMs > asOfMs) return false;
        }

        return true;
    });
}

function wilsonInterval(wins, total, z = CONFIDENCE_Z) {
    const n = Math.max(0, numberOr(total, 0));
    const w = Math.max(0, Math.min(n, numberOr(wins, 0)));
    if (n === 0) return { lowPct: null, highPct: null };

    const p = w / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;

    return {
        lowPct: round(Math.max(0, center - margin) * 100, 2),
        highPct: round(Math.min(1, center + margin) * 100, 2)
    };
}

function reliabilityFromSample(total) {
    const n = Math.max(0, numberOr(total, 0));
    if (n === 0) return 'NO_SAMPLE';
    if (n < MIN_DECISION_SAMPLE) return 'INSUFFICIENT';
    if (n < 20) return 'LOW';
    if (n < 50) return 'MEDIUM';
    return 'HIGH';
}

function summarizeRows(rows = []) {
    let wins = 0;
    let losses = 0;
    let operationalResolved = 0;
    let operationalWins = 0;
    let stake = 0;
    let profit = 0;
    let maxResolvedId = 0;

    for (const row of rows) {
        const status = upper(row.status).trim();
        if (status === 'WON') wins += 1;
        if (status === 'LOST') losses += 1;

        const rowStake = Math.max(0, numberOr(row.stake ?? row.invested, 0));
        if (rowStake > 0) {
            operationalResolved += 1;
            if (status === 'WON') operationalWins += 1;
            stake += rowStake;
            profit += numberOr(row.profit, 0);
        }

        maxResolvedId = Math.max(maxResolvedId, numberOr(row.id, 0));
    }

    const resolved = wins + losses;
    return {
        resolved,
        wins,
        losses,
        winRatePct: resolved > 0 ? round((wins / resolved) * 100, 2) : null,
        operationalResolved,
        operationalWins,
        operationalWinRatePct: operationalResolved > 0 ? round((operationalWins / operationalResolved) * 100, 2) : null,
        stake: round(stake, 2) || 0,
        profit: round(profit, 2) || 0,
        operationalRoiPct: stake > 0 ? round((profit / stake) * 100, 2) : null,
        maxResolvedId
    };
}

function buildCombinationEvidenceFromRows(rows = [], current = {}, options = {}) {
    const historical = filterHistoricalRows(rows, options);
    const deepScan = cleanLabel(options.deepScanLabel || normalizeDeepScanLabel(current));
    const quality = cleanLabel(options.qualityLabel || normalizeQualityLabel(current));
    const matching = historical.filter(row =>
        normalizeDeepScanLabel(row) === deepScan &&
        normalizeQualityLabel(row) === quality
    );

    const global = summarizeRows(historical);
    const exact = summarizeRows(matching);
    const globalRate = global.resolved > 0 ? global.wins / global.resolved : 0.5;
    const adjustedRatePct = exact.resolved > 0
        ? round(((exact.wins + PRIOR_STRENGTH * globalRate) / (exact.resolved + PRIOR_STRENGTH)) * 100, 2)
        : null;
    const interval = wilsonInterval(exact.wins, exact.resolved);
    const reliability = reliabilityFromSample(exact.resolved);
    const odd = numberOr(options.odd ?? current.odd, null);
    const breakEvenPct = odd !== null && odd > 1 ? round((1 / odd) * 100, 2) : null;
    const empiricalEdgePp = exact.winRatePct !== null && breakEvenPct !== null
        ? round(exact.winRatePct - breakEvenPct, 2)
        : null;
    const adjustedEmpiricalEdgePp = adjustedRatePct !== null && breakEvenPct !== null
        ? round(adjustedRatePct - breakEvenPct, 2)
        : null;
    const key = `${deepScan}|||${quality}`;
    const calculatedAt = options.calculatedAt || new Date().toISOString();

    const evidenceHash = sha256Object({
        version: CALCIO_HISTORICAL_COMBINATION_VERSION,
        key,
        exact: {
            resolved: exact.resolved,
            wins: exact.wins,
            losses: exact.losses,
            operationalResolved: exact.operationalResolved,
            stake: exact.stake,
            profit: exact.profit,
            maxResolvedId: exact.maxResolvedId
        },
        global: {
            resolved: global.resolved,
            wins: global.wins,
            maxResolvedId: global.maxResolvedId
        },
        priorStrength: PRIOR_STRENGTH,
        cutoffId: numberOr(options.cutoffId, null)
    });

    return {
        success: true,
        version: CALCIO_HISTORICAL_COMBINATION_VERSION,
        mode: CALCIO_HISTORICAL_COMBINATION_MODE,
        key,
        deepScan,
        quality,
        resolved: exact.resolved,
        wins: exact.wins,
        losses: exact.losses,
        winRatePct: exact.winRatePct,
        adjustedRatePct,
        displayRatePct: exact.resolved >= MIN_DISPLAY_SAMPLE ? exact.winRatePct : null,
        ci95LowPct: interval.lowPct,
        ci95HighPct: interval.highPct,
        reliability,
        minimumDecisionSample: MIN_DECISION_SAMPLE,
        decisionEligible: exact.resolved >= MIN_DECISION_SAMPLE,
        operationalResolved: exact.operationalResolved,
        operationalWins: exact.operationalWins,
        operationalWinRatePct: exact.operationalWinRatePct,
        operationalStake: exact.stake,
        operationalProfit: exact.profit,
        operationalRoiPct: exact.operationalRoiPct,
        breakEvenPct,
        empiricalEdgePp,
        adjustedEmpiricalEdgePp,
        globalResolved: global.resolved,
        globalWinRatePct: global.winRatePct,
        priorStrength: PRIOR_STRENGTH,
        sourceMaxResolvedId: global.maxResolvedId,
        evidenceHash,
        calculatedAt,
        asOf: options.asOf || calculatedAt,
        cutoffId: numberOr(options.cutoffId, null),
        strictSportIdentity: true,
        currentCleanOnly: true,
        historicalOnly: true,
        currentResultUsed: false,
        currentClvUsed: false,
        stakeAuthority: false,
        modelAuthority: false,
        probabilityMeaning: 'EMPIRICAL_PAPER_TRADING_WIN_RATE_NOT_SINGLE_MATCH_MODEL_PROBABILITY',
        note: exact.resolved === 0
            ? 'Nessun esito Calcio current-clean per questa combinazione DeepScan × Resa Qualità.'
            : exact.resolved < MIN_DECISION_SAMPLE
                ? `Win rate empirico disponibile su n=${exact.resolved}, ma campione inferiore alla soglia prudenziale n=${MIN_DECISION_SAMPLE}.`
                : 'Win rate empirico Paper Trading della combinazione DeepScan × Resa Qualità; informativo e senza autorità su modello o stake.'
    };
}

function loadHistoricalRows(db, options = {}) {
    if (!db || typeof db.prepare !== 'function') throw new Error('DB_ADAPTER_REQUIRED');
    const limit = Math.max(100, Math.min(100000, Math.trunc(numberOr(options.limit, 100000))));
    const cutoffId = numberOr(options.cutoffId, Number.MAX_SAFE_INTEGER);

    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE id <= ?
          AND UPPER(COALESCE(status,'')) IN ('WON','LOST')
          AND UPPER(COALESCE(sport_type,'')) = 'CALCIO'
          AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')
          AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
          AND TRIM(COALESCE(ds_action,'')) <> ''
          AND TRIM(COALESCE(calcio_gate_status, calcio_operational_status, '')) <> ''
        ORDER BY id
        LIMIT ?
    `).all(cutoffId, limit);
}

function resolveHistoricalCombinationEvidence(db, current = {}, options = {}) {
    const rows = Array.isArray(options.rows) ? options.rows : loadHistoricalRows(db, options);
    return buildCombinationEvidenceFromRows(rows, current, options);
}

function buildCombinationMatrix(db, options = {}) {
    const rows = Array.isArray(options.rows)
        ? filterHistoricalRows(options.rows, options)
        : filterHistoricalRows(loadHistoricalRows(db, options), options);

    const grouped = new Map();
    for (const row of rows) {
        const deepScan = normalizeDeepScanLabel(row);
        const quality = normalizeQualityLabel(row);
        const key = `${deepScan}|||${quality}`;
        if (!grouped.has(key)) grouped.set(key, { deepScan, quality });
    }

    const global = summarizeRows(rows);
    const combinations = [...grouped.values()]
        .map(group => buildCombinationEvidenceFromRows(rows, {}, {
            ...options,
            rows,
            deepScanLabel: group.deepScan,
            qualityLabel: group.quality,
            calculatedAt: options.calculatedAt
        }))
        .sort((a, b) =>
            b.resolved - a.resolved ||
            (b.winRatePct ?? -1) - (a.winRatePct ?? -1) ||
            a.key.localeCompare(b.key)
        );

    return {
        success: true,
        version: CALCIO_HISTORICAL_COMBINATION_VERSION,
        mode: CALCIO_HISTORICAL_COMBINATION_MODE,
        readOnly: true,
        strictSportIdentity: true,
        currentCleanOnly: true,
        historicalOnly: true,
        currentResultUsed: false,
        currentClvUsed: false,
        stakeAuthority: false,
        modelAuthority: false,
        resolvedRows: global.resolved,
        wins: global.wins,
        losses: global.losses,
        overallWinRatePct: global.winRatePct,
        sourceMaxResolvedId: global.maxResolvedId,
        combinations,
        warnings: [
            'La probabilità reale PT è una frequenza empirica storica, non la probabilità matematica del singolo match.',
            'Sono ammesse soltanto singole Calcio esplicite, current-clean e risolte WON/LOST.',
            'Campione, intervallo Wilson, break-even ed ROI operativo devono essere letti insieme.',
            'Il dato è shadow-only e non modifica probabilità, DeepScan, Resa Qualità o stake.'
        ]
    };
}

function toPersistenceFields(evidence = {}) {
    return {
        historical_combo_key: evidence.key || null,
        historical_combo_deepscan: evidence.deepScan || null,
        historical_combo_quality: evidence.quality || null,
        historical_combo_resolved: numberOr(evidence.resolved, 0),
        historical_combo_wins: numberOr(evidence.wins, 0),
        historical_combo_losses: numberOr(evidence.losses, 0),
        historical_combo_win_rate_pct: evidence.winRatePct,
        historical_combo_adjusted_rate_pct: evidence.adjustedRatePct,
        historical_combo_ci_low_pct: evidence.ci95LowPct,
        historical_combo_ci_high_pct: evidence.ci95HighPct,
        historical_combo_operational_resolved: numberOr(evidence.operationalResolved, 0),
        historical_combo_operational_roi_pct: evidence.operationalRoiPct,
        historical_combo_reliability: evidence.reliability || 'NO_SAMPLE',
        historical_combo_source_max_id: numberOr(evidence.sourceMaxResolvedId, 0),
        historical_combo_evidence_hash: evidence.evidenceHash || null,
        historical_combo_version: evidence.version || CALCIO_HISTORICAL_COMBINATION_VERSION,
        historical_combo_calculated_at: evidence.calculatedAt || new Date().toISOString()
    };
}

module.exports = {
    CALCIO_HISTORICAL_COMBINATION_VERSION,
    CALCIO_HISTORICAL_COMBINATION_MODE,
    PRIOR_STRENGTH,
    MIN_DISPLAY_SAMPLE,
    MIN_DECISION_SAMPLE,
    DEEP_SCAN_LABEL,
    QUALITY_LABEL,
    normalizeDeepScanLabel,
    normalizeQualityLabel,
    isStrictCalcioRow,
    isResolvedRow,
    isCurrentQualityRow,
    isSingleRow,
    hasDsGateIdentity,
    parseTimestamp,
    filterHistoricalRows,
    wilsonInterval,
    reliabilityFromSample,
    summarizeRows,
    buildCombinationEvidenceFromRows,
    loadHistoricalRows,
    resolveHistoricalCombinationEvidence,
    buildCombinationMatrix,
    toPersistenceFields
};
