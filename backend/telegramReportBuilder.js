// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
// Costruzione messaggi Telegram separata dal settlement e dalla UI principale.
const repo = require('./telegramRepository');

const STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER = 'STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER';
const TELEGRAM_MAX_MESSAGE_LENGTH = 3600;

function safeUpper(value) { return String(value || '').toUpperCase(); }
function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function euro(value) {
    const n = Number(value || 0);
    const sign = n > 0 ? '+' : '';
    return `${sign}€${n.toFixed(2)}`;
}
function statusIcon(status) {
    const s = safeUpper(status);
    if (s === 'WON') return '✅';
    if (s === 'LOST') return '❌';
    if (s === 'PUSH') return '➖';
    if (s === 'VOID') return '↩️';
    if (s === 'PENDING') return '⏳';
    return '•';
}
function predictedName(row = {}) {
    const pred = String(row.prediction || '').trim();
    if (row.predicted_player_name) return row.predicted_player_name;
    if (pred === '1') return row.home_team || 'Player 1';
    if (pred === '2') return row.away_team || 'Player 2';
    return pred || 'N/D';
}
function deepScanLabel(row = {}) {
    return row.deep_scan_risk_level || row.ds_action || row.deepscan_gate_status || 'N/D';
}
function gateLabel(row = {}) {
    return row.gate_status_label || row.pre_match_gate_label || row.tennis_operational_status || row.calcio_operational_status || row.professional_gate_status || row.calcio_gate_status || 'N/D';
}
function titleForOptions(options = {}) {
    const mode = options.mode || 'results_since_last';
    const area = options.area || 'both';
    const sport = options.sport || 'tennis';
    const modeLabel = {
        results_today: 'Esiti di oggi',
        results_since_last: 'Nuovi esiti',
        deep_scan_results: 'Esiti Resa Deep Scan IA',
        gate_results: 'Esiti Resa Qualità / Gate',
        predictions_today: 'Pronostici di oggi',
        predictions_tomorrow: 'Pronostici di domani',
        summary_real: 'Riepilogo reale operativo'
    }[mode] || mode;
    const areaLabel = area === 'deep_scan' ? 'Deep Scan IA' : area === 'gate' ? 'Qualità/Gate' : 'Deep Scan + Gate';
    const sportLabel = sport === 'all' ? 'Tutti gli sport' : sport.toUpperCase();
    return `📲 ${modeLabel} · ${areaLabel} · ${sportLabel}`;
}
function rowLine(row = {}) {
    const status = safeUpper(row.status);
    const isPending = status === 'PENDING';
    const match = `${row.home_team || 'N/D'} - ${row.away_team || 'N/D'}`;
    const pick = predictedName(row);
    const stake = toNumber(row.stake, 0);
    const profit = toNumber(row.profit, 0);
    const odd = toNumber(row.odd, null);
    const bits = [];
    bits.push(`${statusIcon(status)} <b>${escapeHtml(status)}</b> · #${escapeHtml(row.id)} · ${escapeHtml(row.match_date || '')}`);
    bits.push(`<b>${escapeHtml(match)}</b>`);
    bits.push(`Pick: <b>${escapeHtml(row.prediction || '')}</b> ${escapeHtml(pick)}${odd ? ` @${odd.toFixed(2)}` : ''}`);
    bits.push(`Stake: €${stake.toFixed(2)}${isPending ? '' : ` · Profit: <b>${escapeHtml(euro(profit))}</b>`}`);
    bits.push(`DeepScan: ${escapeHtml(deepScanLabel(row))}`);
    bits.push(`Gate: ${escapeHtml(gateLabel(row))}`);
    if (row.winner_player_name) bits.push(`Vincitore: ${escapeHtml(row.winner_player_name)}`);
    if (row.settlement_source) bits.push(`Fonte: ${escapeHtml(row.settlement_source)}`);
    return bits.join('\n');
}
function buildSummaryBlock(rows = []) {
    const s = repo.summarizeRows(rows);
    return [
        `<b>Totale righe:</b> ${s.total}`,
        `<b>Settled:</b> ${s.settled} · ✅ ${s.won} · ❌ ${s.lost} · ➖ ${s.push} · ↩️ ${s.void}`,
        `<b>Stake:</b> €${s.stake.toFixed(2)} · <b>Profit:</b> ${escapeHtml(euro(s.profit))} · <b>ROI:</b> ${s.roiPct.toFixed(2)}%`
    ].join('\n');
}
function splitMessages(header, blocks) {
    const messages = [];
    let current = header;
    for (const block of blocks) {
        const candidate = `${current}\n\n${block}`;
        if (candidate.length > TELEGRAM_MAX_MESSAGE_LENGTH && current !== header) {
            messages.push(current);
            current = `${header}\n\n${block}`;
        } else {
            current = candidate;
        }
    }
    messages.push(current);
    return messages;
}
function buildTelegramReport(rows = [], options = {}) {
    const generatedAt = new Date().toLocaleString('it-IT');
    const title = titleForOptions(options);
    const header = `<b>${escapeHtml(title)}</b>\n${escapeHtml(generatedAt)}\n\n${buildSummaryBlock(rows)}`;
    if (!rows.length) {
        return {
            title,
            rowIds: [],
            messages: [`${header}\n\nNessun match trovato con i filtri selezionati.`]
        };
    }
    const blocks = rows.map(rowLine);
    return {
        title,
        rowIds: rows.map(r => r.id),
        messages: splitMessages(header, blocks)
    };
}

module.exports = {
    STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
    TELEGRAM_MAX_MESSAGE_LENGTH,
    escapeHtml,
    predictedName,
    deepScanLabel,
    gateLabel,
    titleForOptions,
    rowLine,
    buildSummaryBlock,
    buildTelegramReport
};
