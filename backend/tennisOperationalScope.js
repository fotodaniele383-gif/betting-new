'use strict';
// ============================================================================
// AI BETTING QUANT PRO - TENNIS OPERATIONAL/AUDIT SCOPE
// Step 67A: separazione esplicita audit-only vs paper operativo e portfolio reale.
// ============================================================================

const TENNIS_OPERATIONAL_SCOPE_VERSION = 'STEP67A_TENNIS_OPERATIONAL_SCOPE_V1';
const CURRENT_QUALITIES = new Set(['CURRENT', 'CURRENT_BOOTSTRAP']);

function safeUpper(value) {
    return String(value || '').trim().toUpperCase();
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeText(row = {}) {
    // STEP91X_TENNIS_SCOPE_SELF_LOCK_REPAIR
    // Lo scope è output del classificatore, non input. Non includere
    // trading_scope/paper_trading_scope/portfolio_scope, altrimenti le righe legacy
    // AUDIT_ONLY restano bloccate per sempre anche se Gate + stake sono poi validi.
    return [
        row.exposure_role,
        row.exposure_group_status,
        row.exposure_reason,
        row.professional_gate_status,
        row.professional_gate_reasons,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.tennis_operational_summary,
        row.ds_action,
        row.ds_suggestion,
        row.deepscan_gate_status,
        row.deepscan_gate_reason,
        row.stake_policy_note
    ].map(safeUpper).join(' ');
}

function isTennisRow(row = {}) {
    const text = [row.sport_type, row.sport, row.bet_type, row.strategy_tag, row.league]
        .map(safeUpper)
        .join(' ');
    return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA') || text.includes('CHALLENGER') || text.includes('GRAND SLAM');
}

function isCurrentClean(row = {}) {
    return CURRENT_QUALITIES.has(safeUpper(row.data_quality));
}

function isResolvedWonLost(row = {}) {
    return ['WON', 'LOST'].includes(safeUpper(row.status));
}

function hasOperationalGate(row = {}) {
    return row.professional_gate_status !== undefined && row.professional_gate_status !== null && String(row.professional_gate_status).trim() !== ''
        || row.tennis_operational_status !== undefined && row.tennis_operational_status !== null && String(row.tennis_operational_status).trim() !== ''
        || row.tennis_operational_action !== undefined && row.tennis_operational_action !== null && String(row.tennis_operational_action).trim() !== ''
        || row.professional_gate_allow_bet !== undefined && row.professional_gate_allow_bet !== null
        || row.deepscan_gate_status !== undefined && row.deepscan_gate_status !== null && String(row.deepscan_gate_status).trim() !== '';
}

function isBlockedOrNoBet(row = {}) {
    const text = normalizeText(row);
    return Number(row.professional_gate_allow_bet) === 0
        || text.includes('NO_BET')
        || text.includes('NO BET')
        || text.includes('BLOCKED')
        || text.includes('BLOCCATA')
        || text.includes('BLOCK')
        || text.includes('REJECTED_HARD');
}

function isAuditAlternative(row = {}) {
    const text = normalizeText(row);
    return text.includes('AUDIT_ALTERNATIVE')
        || text.includes('COUNTERFACTUAL')
        || text.includes('EXPOSURE_GUARD')
        || text.includes('ALTERNATIVE')
        || text.includes('WATCH_ONLY')
        || text.includes('SHADOW');
}

function getStake(row = {}) {
    return Math.max(0, safeNumber(row.stake ?? row.operational_stake ?? row.real_stake ?? row.stake_amount, 0));
}


// ============================================================================
// STEP101E_AUDIT_SAFE_NO_ANCHOR_REPAIR_PATCH
// Override scope per micro-test positivi Step96F/99/101: Paper operativo anche
// se la nota contiene "BLOCCATA SOFT". I veri hard veto restano bloccanti.
// ============================================================================
function hasStep101ETrueHardVeto(row = {}) {
    const text = normalizeText(row);
    if (
        text.includes('OPPOSITE_SIDE_CONFLICT') ||
        text.includes('SIDE_PROBABILITY_MISMATCH') ||
        text.includes('INVALID_ODD') ||
        text.includes('QUOTE NON VALIDE') ||
        text.includes('RETIREMENT') ||
        text.includes('WALKOVER') ||
        text.includes('NO_BET_HARD') ||
        text.includes('NO BET HARD') ||
        text.includes('REJECTED_HARD') ||
        text.includes('ALTO RISCHIO') ||
        text.includes('HIGH_RISK') ||
        text.includes('HIGH RISK')
    ) return true;
    const hasHard = text.includes('BLOCCATA HARD') || text.includes('BLOCKED_HARD') || text.includes('BLOCKED HARD');
    const hardIsOnlyDataOrCalibration =
        text.includes('DATA_SUFFICIENCY') ||
        text.includes('DATA INSUFFICIENT') ||
        text.includes('INSUFFICIENT') ||
        text.includes('CAMPIONE') ||
        text.includes('SAMPLE') ||
        text.includes('CALIBRAZIONE') ||
        text.includes('CALIBRATION') ||
        text.includes('UNKNOWN');
    return hasHard && !hardIsOnlyDataOrCalibration;
}

function hasStep101EPositiveMicroScopeOverride(row = {}) {
    const text = normalizeText(row);
    const stake = getStake(row);
    if (stake <= 0) return false;
    const gateAllow = row.professional_gate_allow_bet === true ||
        row.professional_gate_allow_bet === 1 ||
        String(row.professional_gate_allow_bet).toUpperCase() === 'TRUE';
    const hasMicro = text.includes('WATCHLIST_MICRO') ||
        text.includes('WATCHLIST MICRO') ||
        text.includes('PAPER_OR_MICRO_STAKE') ||
        text.includes('MICRO TEST') ||
        text.includes('MICRO-TEST') ||
        text.includes('STEP96F') ||
        text.includes('STEP99') ||
        text.includes('STEP101') ||
        text.includes('STEP101D') ||
        text.includes('STEP101E');
    return gateAllow && hasMicro && !hasStep101ETrueHardVeto(row);
}
// /STEP101E_AUDIT_SAFE_NO_ANCHOR_REPAIR_PATCH


// ============================================================================
// STEP101F_COMPLETE_DIRECT_PERSISTENCE_REPAIR_PATCH
// Scope override audit-safe per micro-test Tennis positivi Step96F/99/101.
// Una nota legacy può contenere ancora BLOCCATA SOFT; se lo stake è positivo,
// il gate è micro operativo e non esiste hard veto reale, la riga resta Paper
// Trading operativa. Il portfolio reale resta escluso fino a settlement valido.
// ============================================================================
function hasStep101FTrueHardVeto(row = {}) {
    const text = normalizeText(row);
    if (
        text.includes('OPPOSITE_SIDE_CONFLICT') ||
        text.includes('SIDE_PROBABILITY_MISMATCH') ||
        text.includes('INVALID_ODD') ||
        text.includes('QUOTE NON VALIDE') ||
        text.includes('RETIREMENT') ||
        text.includes('WALKOVER') ||
        text.includes('NO_BET_HARD') ||
        text.includes('NO BET HARD') ||
        text.includes('REJECTED_HARD') ||
        text.includes('ALTO RISCHIO') ||
        text.includes('HIGH_RISK') ||
        text.includes('HIGH RISK')
    ) return true;

    const hasHard = text.includes('BLOCCATA HARD') || text.includes('BLOCKED_HARD') || text.includes('BLOCKED HARD');
    const hardOnlyFromDataOrCalibration =
        text.includes('DATA_SUFFICIENCY') ||
        text.includes('DATA INSUFFICIENT') ||
        text.includes('INSUFFICIENT') ||
        text.includes('CAMPIONE') ||
        text.includes('SAMPLE') ||
        text.includes('CALIBRAZIONE') ||
        text.includes('CALIBRATION') ||
        text.includes('UNKNOWN');
    return hasHard && !hardOnlyFromDataOrCalibration;
}

function hasStep101FPositiveMicroScope(row = {}) {
    const text = normalizeText(row);
    const stake = getStake(row);
    if (stake <= 0) return false;

    const gateAllow = row.professional_gate_allow_bet === true ||
        row.professional_gate_allow_bet === 1 ||
        String(row.professional_gate_allow_bet).toUpperCase() === 'TRUE';

    const hasMicro = text.includes('WATCHLIST_MICRO') ||
        text.includes('WATCHLIST MICRO') ||
        text.includes('PAPER_OR_MICRO_STAKE') ||
        text.includes('MICRO TEST') ||
        text.includes('MICRO-TEST') ||
        text.includes('STEP96F') ||
        text.includes('STEP99') ||
        text.includes('STEP101');

    return gateAllow && hasMicro && !hasStep101FTrueHardVeto(row);
}
// /STEP101F_COMPLETE_DIRECT_PERSISTENCE_REPAIR_PATCH

function classifyTennisTradingScope(row = {}) {
    if (!isTennisRow(row)) {
        return {
            scope: 'NOT_TENNIS',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: false,
            reason: 'La riga non appartiene al Tennis.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    const stake = getStake(row);

    if (!isCurrentClean(row)) {
        return {
            scope: 'EXCLUDED_LEGACY_OR_UNQUALIFIED',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Data quality non CURRENT/CURRENT_BOOTSTRAP: esclusa dal portfolio reale.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (!hasOperationalGate(row)) {
        return {
            scope: 'AUDIT_ONLY_NO_OPERATIONAL_GATE',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Gate Tennis assente: riga conservata solo per audit/calibrazione.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (hasStep101ETrueHardVeto(row)) {
        return {
            scope: 'AUDIT_ONLY_HARD_VETO',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Step101E hard veto reale: riga esclusa dal Paper operativo e dal portfolio reale.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (hasStep101EPositiveMicroScopeOverride(row)) {
        return {
            scope: 'PAPER_OPERATIONAL',
            portfolioEligible: isResolvedWonLost(row),
            paperOperational: true,
            auditOnly: false,
            reason: 'Step101E micro-test positivo: Paper operativo; portfolio reale solo dopo settlement valido.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (hasStep101FTrueHardVeto(row)) {
        return {
            scope: 'AUDIT_ONLY_HARD_VETO',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Step101F hard veto reale: esclusa dal Paper operativo e dal portfolio reale.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (hasStep101FPositiveMicroScope(row)) {
        return {
            scope: 'PAPER_OPERATIONAL',
            portfolioEligible: isResolvedWonLost(row),
            paperOperational: true,
            auditOnly: false,
            reason: 'Step101F micro-test positivo: Paper operativo; portfolio reale solo dopo settlement valido.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (isBlockedOrNoBet(row)) {
        return {
            scope: 'AUDIT_ONLY_BLOCKED_BY_GATE',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Gate/DeepScan Tennis blocca o classifica NO_BET.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (isAuditAlternative(row)) {
        return {
            scope: 'AUDIT_ONLY_COUNTERFACTUAL',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Alternativa/counterfactual: non entra nel ROI operativo.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (stake <= 0) {
        return {
            scope: 'AUDIT_ONLY_ZERO_STAKE',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Stake zero: audit-only, esclusa da ROI/yield/drawdown.',
            version: TENNIS_OPERATIONAL_SCOPE_VERSION
        };
    }

    return {
        scope: 'PAPER_OPERATIONAL',
        portfolioEligible: isResolvedWonLost(row),
        paperOperational: true,
        auditOnly: false,
        reason: 'Riga Tennis operativa: gate presente, stake > 0, non bloccata.',
        version: TENNIS_OPERATIONAL_SCOPE_VERSION
    };
}

function isTennisPortfolioOperationalRow(row = {}) {
    return classifyTennisTradingScope(row).paperOperational;
}

function buildTennisPortfolioAuditBreakdown(rows = []) {
    const breakdown = {
        sport: 'TENNIS',
        version: TENNIS_OPERATIONAL_SCOPE_VERSION,
        total: 0,
        paperOperational: 0,
        portfolioEligible: 0,
        auditOnly: 0,
        excludedLegacyOrUnqualified: 0,
        zeroStake: 0,
        blockedByGate: 0,
        noOperationalGate: 0,
        counterfactual: 0,
        reasons: {}
    };

    for (const row of Array.isArray(rows) ? rows : []) {
        if (!isTennisRow(row)) continue;
        const c = classifyTennisTradingScope(row);
        breakdown.total++;
        if (c.paperOperational) breakdown.paperOperational++;
        if (c.portfolioEligible) breakdown.portfolioEligible++;
        if (c.auditOnly) breakdown.auditOnly++;
        if (c.scope === 'EXCLUDED_LEGACY_OR_UNQUALIFIED') breakdown.excludedLegacyOrUnqualified++;
        if (c.scope === 'AUDIT_ONLY_ZERO_STAKE') breakdown.zeroStake++;
        if (c.scope === 'AUDIT_ONLY_BLOCKED_BY_GATE') breakdown.blockedByGate++;
        if (c.scope === 'AUDIT_ONLY_NO_OPERATIONAL_GATE') breakdown.noOperationalGate++;
        if (c.scope === 'AUDIT_ONLY_COUNTERFACTUAL') breakdown.counterfactual++;
        breakdown.reasons[c.scope] = (breakdown.reasons[c.scope] || 0) + 1;
    }

    return breakdown;
}

module.exports = {
    TENNIS_OPERATIONAL_SCOPE_VERSION,
    classifyTennisTradingScope,
    isTennisPortfolioOperationalRow,
    buildTennisPortfolioAuditBreakdown,
    isTennisRow,
    isCurrentClean,
    isResolvedWonLost,
    hasStep101EPositiveMicroScopeOverride,
    hasStep101ETrueHardVeto,
    hasStep101FPositiveMicroScope,
    hasStep101FTrueHardVeto
};
