'use strict';
// ============================================================================
// AI BETTING QUANT PRO - PORTFOLIO AUDIT METRICS
// Step 68: drawdown da equity peak, bankroll reconciliation, CLV coverage,
//          coorti pre/post Step67 e learning audit da CLV/Brier.
// ============================================================================

const PORTFOLIO_AUDIT_METRICS_VERSION = 'STEP73_PORTFOLIO_DIAGNOSTICS_FIX_V1';

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
    return String(value || '').trim().toUpperCase();
}

function getStake(row = {}) {
    return Math.max(0, safeNumber(row.stake ?? row.operational_stake ?? row.real_stake ?? row.stake_amount ?? row.invested, 0));
}

function getProfit(row = {}) {
    return safeNumber(row.profit ?? row.net_profit ?? row.pnl, 0);
}

function getRowOrderTs(row = {}) {
    const rawDate = String(row.settled_at || row.created_at || row.match_date || row.date || '').trim();

    if (rawDate) {
        const italian = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*,?\s*(\d{1,2}):(\d{2}))?/);
        if (italian) {
            const year = Number(italian[3]) < 100 ? 2000 + Number(italian[3]) : Number(italian[3]);
            const parsed = new Date(year, Number(italian[2]) - 1, Number(italian[1]), Number(italian[4] || 0), Number(italian[5] || 0));
            if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
        }

        const parsed = new Date(rawDate);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    }

    return safeNumber(row.id, 0);
}

function sortRowsForEquity(rows = []) {
    return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
        const at = getRowOrderTs(a);
        const bt = getRowOrderTs(b);
        if (at !== bt) return at - bt;
        return safeNumber(a.id, 0) - safeNumber(b.id, 0);
    });
}

function calculateEquityAudit(rows = [], options = {}) {
    const baseBankroll = Math.max(0.01, safeNumber(options.baseBankroll, 1000));
    const ordered = sortRowsForEquity(rows).filter(row => getStake(row) > 0);

    let equity = baseBankroll;
    let peakEquity = baseBankroll;
    let maxDrawdownPct = 0;
    let maxDrawdownAmount = 0;
    let currentDrawdownPct = 0;
    let currentDrawdownAmount = 0;
    let troughEquity = baseBankroll;
    let totalProfit = 0;
    const points = [];

    for (const row of ordered) {
        const profit = getProfit(row);
        totalProfit += profit;
        equity += profit;

        if (equity > peakEquity) {
            peakEquity = equity;
        }

        currentDrawdownAmount = Math.max(0, peakEquity - equity);
        currentDrawdownPct = peakEquity > 0 ? (currentDrawdownAmount / peakEquity) * 100 : 0;

        if (currentDrawdownAmount > maxDrawdownAmount) {
            maxDrawdownAmount = currentDrawdownAmount;
            maxDrawdownPct = currentDrawdownPct;
            troughEquity = equity;
        }

        points.push({
            id: row.id ?? null,
            orderTs: getRowOrderTs(row),
            profit: round(profit, 4),
            equity: round(equity, 4),
            peakEquity: round(peakEquity, 4),
            drawdownPct: round(currentDrawdownPct, 4),
            drawdownAmount: round(currentDrawdownAmount, 4)
        });
    }

    const finalBankroll = baseBankroll + totalProfit;

    return {
        version: PORTFOLIO_AUDIT_METRICS_VERSION,
        method: 'EQUITY_PEAK_DRAWDOWN',
        sampleSize: ordered.length,
        initialBankroll: round(baseBankroll, 2),
        baseBankroll: round(baseBankroll, 2),
        totalProfit: round(totalProfit, 2),
        finalBankroll: round(finalBankroll, 2),
        peakEquity: round(peakEquity, 2),
        troughEquity: round(troughEquity, 2),
        maxDrawdown: round(maxDrawdownPct, 2),
        maxDrawdownPct: round(maxDrawdownPct, 2),
        maxDrawdownAmount: round(maxDrawdownAmount, 2),
        currentDrawdown: round(currentDrawdownPct, 2),
        currentDrawdownPct: round(currentDrawdownPct, 2),
        currentDrawdownAmount: round(currentDrawdownAmount, 2),
        alert: maxDrawdownPct > 8,
        hardStop: maxDrawdownPct > 15,
        points
    };
}

function buildBankrollReconciliation(rows = [], options = {}) {
    const baseBankroll = Math.max(0.01, safeNumber(options.baseBankroll, 1000));
    const totalProfit = rows.reduce((sum, row) => sum + getProfit(row), 0);
    const finalBankroll = baseBankroll + totalProfit;
    const displayedBankroll = safeNumber(options.displayedBankroll, finalBankroll);
    const diff = displayedBankroll - finalBankroll;

    return {
        version: PORTFOLIO_AUDIT_METRICS_VERSION,
        mode: 'INITIAL_PLUS_REALIZED_PROFIT',
        formula: 'finalBankroll = initialBankroll + realizedProfit',
        initialBankroll: round(baseBankroll, 2),
        realizedProfit: round(totalProfit, 2),
        finalBankroll: round(finalBankroll, 2),
        displayedBankroll: round(displayedBankroll, 2),
        difference: round(diff, 2),
        aligned: Math.abs(diff) <= 0.01,
        note: 'Usa initialBankroll come base equity. La UI deve distinguere bankroll base da equity finale calcolata.'
    };
}

function nullableNumber(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'string' && value.trim() === '') return NaN;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

function isTrueFlag(value) {
    const text = safeUpper(value).trim();
    return text === '1' || text === 'TRUE' || text === 'YES' || text === 'Y' || text === 'VERIFIED';
}

function getClvEvidenceText(row = {}) {
    return [
        row.clv_method,
        row.clv_source,
        row.clvQualitySource,
        row.clv_quality_source,
        row.clv_last_attempt_result
    ].map(safeUpper).join(' ');
}

function hasVerifiedClosingLineEvidence(row = {}) {
    // STEP91M_VERIFIED_CLV_PORTFOLIO_REPAIR
    // Regola senior audit: una quota reference/sharp o un campo legacy clv=0 non basta
    // per dire che la closing line è disponibile. Il CLV viene considerato valido solo
    // se esiste evidenza di closing line certificata/vault/API oppure flag esplicito.
    const closingOdd = nullableNumber(row.closing_odd);
    const legacyClosingOdd = nullableNumber(row.clv);
    const directPct = nullableNumber(row.clv_pct);
    const edgePct = nullableNumber(row.clv_edge);
    const verifiedFlag = isTrueFlag(row.clv_verified ?? row.clvVerified ?? row.clv_validated);
    const closingFlag = isTrueFlag(row.closing_line_available ?? row.closingLineAvailable);
    const evidenceText = getClvEvidenceText(row);
    const sourceHasClosing = evidenceText.includes('POST_MATCH')
        || evidenceText.includes('CLOSING')
        || evidenceText.includes('CLOSE')
        || evidenceText.includes('VAULT')
        || evidenceText.includes('LIVE_API')
        || evidenceText.includes('INTERNAL_VAULT');
    const explicitEvidence = verifiedFlag || closingFlag || sourceHasClosing;
    const hasNonZeroPct = (Number.isFinite(directPct) && directPct !== 0) || (Number.isFinite(edgePct) && edgePct !== 0);

    if (closingOdd > 1 && explicitEvidence) return true;
    if (legacyClosingOdd > 1 && explicitEvidence) return true;
    if (hasNonZeroPct && explicitEvidence) return true;

    return false;
}

function hasClosingLineEvidence(row = {}) {
    // Compatibilità nome funzione legacy: da Step91M è intentionally strict.
    return hasVerifiedClosingLineEvidence(row);
}

function getClvPct(row = {}) {
    // STEP91M_VERIFIED_CLV_PORTFOLIO_REPAIR
    // Non usare clv/clv_edge/clv_pct se sono placeholder non verificati. Questo evita
    // schermate fuorvianti tipo coverage alta ma CLV beaten 0.0% con avg 0.00.
    if (!hasVerifiedClosingLineEvidence(row)) return null;

    const directPct = nullableNumber(row.clv_pct);
    if (Number.isFinite(directPct)) return directPct;

    const edgePct = nullableNumber(row.clv_edge);
    if (Number.isFinite(edgePct)) return edgePct;

    const openOdd = nullableNumber(row.odd ?? row.opening_odd ?? row.open_odd);
    const closingOdd = nullableNumber(row.closing_odd);
    if (Number.isFinite(openOdd) && Number.isFinite(closingOdd) && openOdd > 1 && closingOdd > 1) {
        return ((openOdd / closingOdd) - 1) * 100;
    }

    const legacyClosingOdd = nullableNumber(row.clv);
    if (Number.isFinite(openOdd) && Number.isFinite(legacyClosingOdd) && openOdd > 1 && legacyClosingOdd > 1) {
        return ((openOdd / legacyClosingOdd) - 1) * 100;
    }

    return null;
}

function summarizeClvCoverage(rows = [], operationalRows = []) {
    const strictRows = Array.isArray(rows) ? rows : [];
    const operational = Array.isArray(operationalRows) ? operationalRows : [];

    const values = strictRows.map(getClvPct).filter(v => v !== null && Number.isFinite(v));
    const positive = values.filter(v => v > 0).length;
    const opValues = operational.map(getClvPct).filter(v => v !== null && Number.isFinite(v));
    const opPositive = opValues.filter(v => v > 0).length;
    const invalidEvidenceRows = strictRows.filter(row => {
        const anyLegacyValue = Number.isFinite(nullableNumber(row.clv_pct))
            || Number.isFinite(nullableNumber(row.clv_edge))
            || Number.isFinite(nullableNumber(row.clv))
            || Number.isFinite(nullableNumber(row.closing_odd));
        return anyLegacyValue && !hasVerifiedClosingLineEvidence(row);
    }).length;

    const allValuesAreFlat = values.length > 0 && values.every(v => Math.abs(v) < 0.000001);
    const status = values.length === 0
        ? 'NO_VERIFIED_CLOSING_LINE'
        : (allValuesAreFlat ? 'CLV_FLAT_ZERO_REVIEW' : (positive === 0 ? 'CLV_AVAILABLE_NOT_BEATEN' : 'CLV_AVAILABLE'));

    return {
        version: PORTFOLIO_AUDIT_METRICS_VERSION,
        mode: 'CLV_VERIFIED_ONLY_COVERAGE_AND_BEATEN_RATES',
        step91mVerifiedOnly: true,
        status,
        totalSample: strictRows.length,
        totalWithClv: values.length,
        totalPositiveClv: positive,
        missingClv: Math.max(0, strictRows.length - values.length),
        invalidLegacyClvRows: invalidEvidenceRows,
        clvCoveragePct: strictRows.length ? round((values.length / strictRows.length) * 100, 2) : 0,
        beatenTotalPct: strictRows.length ? round((positive / strictRows.length) * 100, 2) : 0,
        beatenAvailablePct: values.length ? round((positive / values.length) * 100, 2) : 0,
        operationalSample: operational.length,
        operationalWithClv: opValues.length,
        operationalPositiveClv: opPositive,
        operationalMissingClv: Math.max(0, operational.length - opValues.length),
        operationalCoveragePct: operational.length ? round((opValues.length / operational.length) * 100, 2) : 0,
        operationalBeatenPct: opValues.length ? round((opPositive / opValues.length) * 100, 2) : 0,
        avgClvTotal: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : 0,
        avgClvOperational: opValues.length ? round(opValues.reduce((a, b) => a + b, 0) / opValues.length, 2) : 0,
        note: values.length === 0
            ? 'Nessuna closing line verificata: CLV mostrata come N/D, non come 0% beaten.'
            : 'CLV calcolata solo su righe con closing line verificata o fonte vault/API certificata.'
    };
}

function isPostStep67Row(row = {}) {
    const text = [
        row.trading_scope,
        row.paper_trading_scope,
        row.portfolio_scope,
        row.deepscan_gate_mode,
        row.deepscan_gate_status,
        row.audit_trail_id,
        row.audit_trail_event_id,
        row.calibration_version,
        row.clv_learning_action,
        row.engine_version,
        row.model_version,
        row.metric_version
    ].map(safeUpper).join(' ');

    return text.includes('STEP67')
        || text.includes('AUDIT_UPDATE')
        || text.includes('OPERATIONAL_GATE')
        || text.includes('PAPER_OPERATIONAL')
        || text.includes('PORTFOLIO_REAL')
        || text.includes('IMMUTABLE_AUDIT_TRAIL');
}

function isHighRiskRow(row = {}) {
    const text = [
        row.deep_scan_risk_level,
        row.deepscan_gate_status,
        row.deepscan_gate_reason,
        row.tennis_operational_status,
        row.tennis_operational_summary,
        row.professional_gate_status,
        row.professional_gate_reasons,
        row.ds_action,
        row.ds_suggestion,
        row.strategy_tag
    ].map(safeUpper).join(' ');

    return text.includes('ALTO RISCHIO')
        || text.includes('HIGH_RISK')
        || text.includes('HIGH RISK')
        || text.includes('RISK_HIGH')
        || text.includes('BLOCCATA HARD')
        || text.includes('BLOCKED_HARD');
}

function summarizeCohort(rows = []) {
    const sample = Array.isArray(rows) ? rows.length : 0;
    const stake = (rows || []).reduce((sum, row) => sum + getStake(row), 0);
    const profit = (rows || []).reduce((sum, row) => sum + getProfit(row), 0);
    const won = (rows || []).filter(row => safeUpper(row.status) === 'WON').length;
    const lost = (rows || []).filter(row => safeUpper(row.status) === 'LOST').length;
    return {
        sample,
        stake: round(stake, 2),
        profit: round(profit, 2),
        roi: stake > 0 ? round((profit / stake) * 100, 2) : 0,
        winRate: won + lost > 0 ? round((won / (won + lost)) * 100, 2) : 0,
        won,
        lost
    };
}

function buildStep67CohortBreakdown(operationalRows = []) {
    const rows = Array.isArray(operationalRows) ? operationalRows : [];
    const postStep67 = rows.filter(isPostStep67Row);
    const preStep67 = rows.filter(row => !isPostStep67Row(row));
    const highRiskPreStep67 = preStep67.filter(isHighRiskRow);
    const highRiskPostStep67 = postStep67.filter(isHighRiskRow);

    return {
        version: PORTFOLIO_AUDIT_METRICS_VERSION,
        mode: 'PRE_POST_STEP67_OPERATIONAL_COHORTS',
        allOperational: summarizeCohort(rows),
        preStep67: summarizeCohort(preStep67),
        postStep67: summarizeCohort(postStep67),
        highRiskPreStep67: summarizeCohort(highRiskPreStep67),
        highRiskPostStep67: summarizeCohort(highRiskPostStep67),
        warning: highRiskPreStep67.length > 0
            ? 'Sono presenti stake operativi alto rischio pre-Step67: valutarli separatamente dalla nuova logica Step67.'
            : null
    };
}

module.exports = {
    PORTFOLIO_AUDIT_METRICS_VERSION,
    safeNumber,
    round,
    getStake,
    getProfit,
    getClvPct,
    calculateEquityAudit,
    buildBankrollReconciliation,
    summarizeClvCoverage,
    isPostStep67Row,
    isHighRiskRow,
    buildStep67CohortBreakdown,
    summarizeCohort
};
