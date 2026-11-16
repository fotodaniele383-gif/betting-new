'use strict';
// ============================================================================
// AI BETTING QUANT PRO - CALCIO OPERATIONAL/AUDIT SCOPE
// Step 67A: separazione esplicita audit-only vs paper operativo e portfolio reale.
// ============================================================================

const CALCIO_OPERATIONAL_SCOPE_VERSION = 'STEP67A_CALCIO_OPERATIONAL_SCOPE_V1';
const CURRENT_QUALITIES = new Set(['CURRENT', 'CURRENT_BOOTSTRAP']);

function safeUpper(value) {
    return String(value || '').trim().toUpperCase();
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function rowText(row = {}) {
    return [
        row.trading_scope,
        row.paper_trading_scope,
        row.portfolio_scope,
        row.exposure_role,
        row.exposure_group_status,
        row.exposure_reason,
        row.calcio_gate_status,
        row.calcio_operational_status,
        row.calcio_operational_action,
        row.deepscan_gate_status,
        row.deepscan_gate_reason
    ].map(safeUpper).join(' ');
}

function isCalcioRow(row = {}) {
    const text = [row.sport_type, row.sport, row.bet_type, row.strategy_tag, row.league]
        .map(safeUpper)
        .join(' ');

    if (text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA')) return false;
    return text.includes('CALCIO') || text.includes('FOOTBALL') || text.includes('SOCCER') || text.includes('SERIE') || text.includes('LIGA') || text.includes('PREMIER') || text.includes('BUNDESLIGA') || text.includes('LIGUE') || text.includes('SINGLE') || text.trim() === '';
}

function isCurrentClean(row = {}) {
    return CURRENT_QUALITIES.has(safeUpper(row.data_quality));
}

function isResolvedWonLost(row = {}) {
    return ['WON', 'LOST'].includes(safeUpper(row.status));
}

function getStake(row = {}) {
    return Math.max(0, safeNumber(row.stake ?? row.operational_stake ?? row.real_stake ?? row.stake_amount, 0));
}

function hasCalcioGate(row = {}) {
    return row.calcio_gate_status !== undefined && row.calcio_gate_status !== null && String(row.calcio_gate_status).trim() !== ''
        || row.calcio_gate_allow_bet !== undefined && row.calcio_gate_allow_bet !== null
        || row.deepscan_gate_status !== undefined && row.deepscan_gate_status !== null && String(row.deepscan_gate_status).trim() !== '';
}

function isBlockedOrNoBet(row = {}) {
    const text = rowText(row);
    return Number(row.calcio_gate_allow_bet) === 0
        || text.includes('NO_BET')
        || text.includes('NO BET')
        || text.includes('BLOCKED')
        || text.includes('BLOCCATA')
        || text.includes('BLOCK')
        || text.includes('REJECTED_HARD');
}

function isAuditAlternative(row = {}) {
    const text = rowText(row);
    return text.includes('AUDIT')
        || text.includes('COUNTERFACTUAL')
        || text.includes('ALTERNATIVE')
        || text.includes('WATCH_ONLY')
        || text.includes('SHADOW');
}

function classifyCalcioTradingScope(row = {}) {
    if (!isCalcioRow(row)) {
        return {
            scope: 'NOT_CALCIO',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: false,
            reason: 'La riga non appartiene al Calcio.',
            version: CALCIO_OPERATIONAL_SCOPE_VERSION
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
            version: CALCIO_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (hasCalcioGate(row) && isBlockedOrNoBet(row)) {
        return {
            scope: 'AUDIT_ONLY_BLOCKED_BY_GATE',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Gate/DeepScan Calcio blocca o classifica NO_BET.',
            version: CALCIO_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (isAuditAlternative(row)) {
        return {
            scope: 'AUDIT_ONLY_COUNTERFACTUAL',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Alternativa/counterfactual: non entra nel ROI operativo.',
            version: CALCIO_OPERATIONAL_SCOPE_VERSION
        };
    }

    if (stake <= 0) {
        return {
            scope: 'AUDIT_ONLY_ZERO_STAKE',
            portfolioEligible: false,
            paperOperational: false,
            auditOnly: true,
            reason: 'Stake zero: audit-only, esclusa da ROI/yield/drawdown.',
            version: CALCIO_OPERATIONAL_SCOPE_VERSION
        };
    }

    return {
        scope: 'PAPER_OPERATIONAL',
        portfolioEligible: isResolvedWonLost(row),
        paperOperational: true,
        auditOnly: false,
        reason: hasCalcioGate(row)
            ? 'Riga Calcio operativa: gate compatibile, stake > 0, non bloccata.'
            : 'Riga Calcio operativa legacy-clean con stake > 0; gate non presente ma non bloccante per compatibilità.',
        version: CALCIO_OPERATIONAL_SCOPE_VERSION
    };
}

function isCalcioPortfolioOperationalRow(row = {}) {
    return classifyCalcioTradingScope(row).paperOperational;
}

function buildCalcioPortfolioAuditBreakdown(rows = []) {
    const breakdown = {
        sport: 'CALCIO',
        version: CALCIO_OPERATIONAL_SCOPE_VERSION,
        total: 0,
        paperOperational: 0,
        portfolioEligible: 0,
        auditOnly: 0,
        excludedLegacyOrUnqualified: 0,
        zeroStake: 0,
        blockedByGate: 0,
        counterfactual: 0,
        reasons: {}
    };

    for (const row of Array.isArray(rows) ? rows : []) {
        if (!isCalcioRow(row)) continue;
        const c = classifyCalcioTradingScope(row);
        breakdown.total++;
        if (c.paperOperational) breakdown.paperOperational++;
        if (c.portfolioEligible) breakdown.portfolioEligible++;
        if (c.auditOnly) breakdown.auditOnly++;
        if (c.scope === 'EXCLUDED_LEGACY_OR_UNQUALIFIED') breakdown.excludedLegacyOrUnqualified++;
        if (c.scope === 'AUDIT_ONLY_ZERO_STAKE') breakdown.zeroStake++;
        if (c.scope === 'AUDIT_ONLY_BLOCKED_BY_GATE') breakdown.blockedByGate++;
        if (c.scope === 'AUDIT_ONLY_COUNTERFACTUAL') breakdown.counterfactual++;
        breakdown.reasons[c.scope] = (breakdown.reasons[c.scope] || 0) + 1;
    }

    return breakdown;
}

module.exports = {
    CALCIO_OPERATIONAL_SCOPE_VERSION,
    classifyCalcioTradingScope,
    isCalcioPortfolioOperationalRow,
    buildCalcioPortfolioAuditBreakdown,
    isCalcioRow,
    isCurrentClean,
    isResolvedWonLost
};
