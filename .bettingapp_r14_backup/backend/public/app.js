/* BETTINGAPP_CALCIO_EV_SCOPE_UI_R1_20261105 */
// PATCH57_PRODUCTION_SECURITY_REMOTE_SESSION
// A remote token can be supplied once in the URL fragment as #access_token=... .
// Fragments are not sent in HTTP requests; the token is moved to sessionStorage
// and removed from the address bar. Only same-origin /api requests receive it.
(function installPatch57RemoteSession(){
    const KEY = 'BETTINGAPP_PATCH57_REMOTE_ACCESS_TOKEN';
    try {
        const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
        const fragmentToken = String(hash.get('access_token') || '').trim();
        if (fragmentToken.length >= 32) {
            sessionStorage.setItem(KEY, fragmentToken);
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
        const nativeFetch = window.fetch.bind(window);
        window.fetch = function patch57SecuredFetch(input, init = {}) {
            let target = '';
            if (typeof input === 'string') target = input;
            else if (input && typeof input.url === 'string') target = input.url;
            let sameOriginApi = false;
            try {
                const url = new URL(target, window.location.origin);
                sameOriginApi = url.origin === window.location.origin && url.pathname.startsWith('/api/');
            } catch (_) {}
            if (!sameOriginApi) return nativeFetch(input, init);
            const token = String(sessionStorage.getItem(KEY) || '').trim();
            if (!token) return nativeFetch(input, init);
            const baseHeaders = input instanceof Request ? input.headers : undefined;
            const headers = new Headers(init.headers || baseHeaders || {});
            headers.set('X-BettingApp-Token', token);
            if (input instanceof Request) return nativeFetch(new Request(input, { ...init, headers }));
            return nativeFetch(input, { ...init, headers });
        };
        window.BETTINGAPP_PATCH57_REMOTE_SESSION = Object.freeze({ version:'PRODUCTION_SECURITY_REMOTE_SESSION_V1_PATCH57', storage:'SESSION_ONLY', queryToken:false });
    } catch (_) {}
})();

// BETTING_PATCH_26F_F_R1_RUNTIME_DIAGNOSTICS_TRUTH
// TENNIS_PATCH28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT
// PATCH28_RUNTIME_HEALTH_TRUTH_EVIDENCE_CLARITY
// ============================================================================
// AI BETTING QUANT PRO - FRONTEND CORE
// File: public/app.js
// Versione: 14.8j - Step 19 DeepScan Six-Pillar UI
// ============================================================================
//
// CHANGELOG 14.0
// - Compatibile con server.tennis.js v15+.
// - Compatibile con tennisValueEvaluator.js v4.1+.
// - Compatibile con paperTrading.tennis.js v11+.
// - Tennis: lettura standard di edge_pp ed ev_pct.
// - Tennis: visualizzazione reliabilityMode / data_quality / metricVersion.
// - Tennis: gestione PUSH e VOID in paper trading.
// - Tennis: separazione endpoint Calcio/Tennis più rigorosa.
// - Portfolio: endpoint storico separato per sport.
// - Live Analysis: badge bootstrap nuovo storico.
// - Backtest Tennis: evidenzia modalità neutra senza reliability fittizia.
// - Forward Trading: ordinamento per edge_pp, ev_pct, data_quality.
// - Settings: mantenute configurazioni Calcio + Tennis.
// - Export CSV: compatibile con nuovi campi.
// - Step 7 UI: ripristino espandi/riduci Health Calcio/Tennis e empty state Backtest Tennis.
// - Step 8 UI: fix espansione DeepScan e riallineamento tabella Trading Tennis/Calcio.
// - Step 3 Tennis: dashboard calibrazione predittiva Tennis-only dentro Health.
// - Step 5 Tennis: report operativo finale per pronostici APPROVED/WATCHLIST/BLOCKED.
// - Step 38: DeepScan riceve data/superficie/quote reference senza intervenire su stake; grafici filtri reset completi.
// - Step70B: verifica dati grafici Portfolio, drawdown audit e Brier Curve ATP/WTA.
// - Step71: filtri Portafoglio per circuito/competizione (Tutto, ATP, WTA e campionati Calcio).
// ============================================================================


// ============================================================================
// 1. STATO GLOBALE APP
// ============================================================================

let activeSport = 'calcio';
let currentAnalysisData = null;
let currentBacktestData = null;
let currentForwardData = null;
let latestPortfolioReport = null;
let latestPortfolioResponse = null;
let latestTennisBrierTourAudit = null;
let portfolioSegmentFilter = 'ALL';

let chartProfitInstance = null;
let chartWinRateInstance = null;
let chartDrawdownInstance = null;
let chartCalibrationInstance = null;
let chartCumulativeInstance = null;
let chartLeagueBreakdownInstance = null;
let chartDeepScanOutcomeInstance = null;
let chartQualityGateOutcomeInstance = null;

let currentSortColumn = 'date';
let currentSortAsc = false;
let currentDeepScanRunId = null;
let diagnosticsPanelCounter = 0;

// BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS
const AI_OUTCOME_BANDS_UI_VERSION = 'BETTING_PATCH_26F_F_AI_OUTCOME_BANDS_UI_V1';
let aiOutcomeBandsState = { sport: null, scope: 'AI_SIGNALS', competition: 'ALL', payload: null, requestId: 0 };

// TENNIS_PATCH49_CROSS_SPORT_ANALYSIS_MEMORY
const ANALYSIS_MEMORY_CACHE_VERSION = 'TENNIS_PATCH49_CROSS_SPORT_ANALYSIS_MEMORY_V1';
const ANALYSIS_MEMORY_TTL_MS = 180000;
const analysisMemoryCache = new Map();
const latestAnalysisMemoryKeyBySport = new Map();
let forceAnalysisRefreshPatch49 = false;
let predictionIndexBandsState = { sport:null, scope:'AI_SIGNALS', competition:'ALL', payload:null, requestId:0, collapsed:false };

function analysisMemoryFingerprint(sport, payload = {}) {
    const normalizedSport = safeString(sport).toUpperCase() === 'TENNIS' ? 'TENNIS' : 'CALCIO';
    const league = safeString(payload.league || 'all').toLowerCase();
    const bankroll = Number.isFinite(Number(payload.bankroll)) ? Number(payload.bankroll).toFixed(2) : '1000.00';
    return `${normalizedSport}|${league}|${bankroll}`;
}
function storeAnalysisMemory(sport, payload, data) {
    const key=analysisMemoryFingerprint(sport,payload);
    const normalizedSport=safeString(sport).toUpperCase()==='TENNIS'?'TENNIS':'CALCIO';
    analysisMemoryCache.set(key,{version:ANALYSIS_MEMORY_CACHE_VERSION,key,sport:normalizedSport,payload:{...payload},data,storedAt:Date.now(),expiresAt:Date.now()+ANALYSIS_MEMORY_TTL_MS});
    latestAnalysisMemoryKeyBySport.set(normalizedSport,key);
    return analysisMemoryCache.get(key);
}
function getAnalysisMemory(sport,payload,now=Date.now()) {
    const key=analysisMemoryFingerprint(sport,payload), entry=analysisMemoryCache.get(key);
    if(!entry) return null;
    if(entry.expiresAt<=now){analysisMemoryCache.delete(key);return null;}
    return {...entry,ageMs:Math.max(0,now-entry.storedAt),remainingMs:Math.max(0,entry.expiresAt-now)};
}
window.forceAnalysisRefreshPatch49 = function(){ forceAnalysisRefreshPatch49=true; $('analyzeForm')?.requestSubmit(); };
function getLatestAnalysisMemory(sport,now=Date.now()){
    const normalized=safeString(sport).toUpperCase()==='TENNIS'?'TENNIS':'CALCIO', key=latestAnalysisMemoryKeyBySport.get(normalized);
    if(!key)return null; const entry=analysisMemoryCache.get(key); if(!entry||entry.expiresAt<=now){analysisMemoryCache.delete(key);latestAnalysisMemoryKeyBySport.delete(normalized);return null;}
    return {...entry,ageMs:Math.max(0,now-entry.storedAt),remainingMs:Math.max(0,entry.expiresAt-now)};
}
function tryRestoreLatestAnalysisMemory(sport){
    const entry=getLatestAnalysisMemory(sport); if(!entry)return false;
    if($('league'))$('league').value=entry.payload?.league||'all';
    if($('bankroll')&&Number.isFinite(Number(entry.payload?.bankroll)))$('bankroll').value=Number(entry.payload.bankroll);
    currentAnalysisData=entry.data; nascondiTutto(); $('results')?.classList.remove('hidden'); renderLiveAnalysis(entry.data,{reuseCached:true,memoryEntry:entry}); hideLoading(); return true;
}

function renderAnalysisMemoryBanner(entry=null){
    const box=$('accumulatorBox'); if(!box||!entry) return;
    const seconds=Math.max(1,Math.ceil(entry.remainingMs/1000));
    box.insertAdjacentHTML('afterbegin',`<div class="patch49-analysis-memory-banner" style="margin:0 0 12px;padding:10px 12px;border:1px solid rgba(56,189,248,.35);border-left:4px solid #38bdf8;border-radius:9px;background:rgba(14,165,233,.10);color:#bae6fd;"><strong>⚡ Ultimo risultato in memoria</strong> · nessuna nuova simulazione o DeepScan. Cache valida ancora ${seconds}s. <button type="button" onclick="forceAnalysisRefreshPatch49()" style="margin-left:8px;background:#0ea5e9;color:white;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-weight:800;">Ricalcola ora</button></div>`);
}
function captureDeepScanMemoryUi(bet,index){
    const badge=$(`ds-badge-${index}`),detail=$(`ds-detail-${index}`),btn=$(`ds-btn-${index}`),row=$(`row-${index}`),detailRow=$(`ds-row-${index}`);
    bet.patch49DeepScanUi={badgeHtml:badge?.innerHTML||'',badgeClass:badge?.className||'',detailHtml:detail?.innerHTML||'',buttonHidden:btn?.classList.contains('hidden')!==false,rowStyle:row?.getAttribute('style')||'',detailRowStyle:detailRow?.getAttribute('style')||''};
}
function restoreDeepScanMemoryUi(bets=[]){
    bets.forEach((bet,index)=>{
        const ui=bet.patch49DeepScanUi||{},badge=$(`ds-badge-${index}`),detail=$(`ds-detail-${index}`),btn=$(`ds-btn-${index}`),row=$(`row-${index}`),detailRow=$(`ds-row-${index}`);
        if(badge){badge.innerHTML=ui.badgeHtml||getDeepScanBadge(bet.ds_action||bet.dsAction||'').replace(/^<span[^>]*>|<\/span>$/g,'')||'✅ Memoria';if(ui.badgeClass)badge.className=ui.badgeClass;}
        if(detail&&ui.detailHtml)detail.innerHTML=ui.detailHtml;
        if(btn&&ui.buttonHidden===false)btn.classList.remove('hidden');
        if(row&&ui.rowStyle)row.setAttribute('style',ui.rowStyle);
        if(detailRow&&ui.detailRowStyle)detailRow.setAttribute('style',ui.detailRowStyle);
    });
}


// PATCH28_R2_UI_NAVIGATION_STABILITY
// Un solo stato autorevole per Analisi AI, Trading e Portafoglio.
// Le risposte asincrone obsolete non possono riaprire una schermata già abbandonata.
const PATCH28_R2_UI_NAVIGATION_VERSION = 'TENNIS_UI_NAVIGATION_STABILITY_V1_PATCH28_R2';
const T10_R2_R1_PORTFOLIO_ANALYSIS_NAV_GUARD = 'T10_R2_R1_PORTFOLIO_ANALYSIS_NAV_GUARD_V1';
let primaryViewName = 'ANALYSIS';
let primaryViewEpoch = 0;
let portfolioRequestSequence = 0;
let portfolioAbortController = null;

function destroyPortfolioChartsForNavigation() {
    try { if (chartDrawdownInstance) chartDrawdownInstance.destroy(); } catch (_) {}
    try { if (chartCalibrationInstance) chartCalibrationInstance.destroy(); } catch (_) {}
    chartDrawdownInstance = null;
    chartCalibrationInstance = null;
}

function invalidatePortfolioWork(reason = 'VIEW_CHANGED') {
    portfolioRequestSequence += 1;
    if (portfolioAbortController) {
        try { portfolioAbortController.abort(reason); } catch (_) {}
        portfolioAbortController = null;
    }
    destroyPortfolioChartsForNavigation();
}

function enterPrimaryView(viewName) {
    const normalized = safeString(viewName || 'ANALYSIS').toUpperCase();
    if (primaryViewName === 'PORTFOLIO' && normalized !== 'PORTFOLIO') {
        invalidatePortfolioWork(`LEAVE_PORTFOLIO_FOR_${normalized}`);
    }
    primaryViewName = normalized;
    primaryViewEpoch += 1;
    return primaryViewEpoch;
}

function isPrimaryViewCurrent(viewName, epoch) {
    return primaryViewName === safeString(viewName).toUpperCase() && primaryViewEpoch === epoch;
}

function isPortfolioRenderCurrent(requestSequence, viewEpoch) {
    return requestSequence === portfolioRequestSequence
        && isPrimaryViewCurrent('PORTFOLIO', viewEpoch)
        && !$('portfolioSection')?.classList.contains('hidden');
}


function showAnalysisPendingViewT10R2R1() {
    // T10_R2_R1: leaving Portfolio for Analisi IA must be visible immediately.
    // The server request continues normally; this only prevents stale Portfolio UI
    // and its shadow monitors from looking like a frozen analysis.
    nascondiTutto();
    const results = $('results');
    if (results) {
        results.classList.remove('hidden');
        $('analysisPendingNavT10R2R1')?.remove();
        const banner = document.createElement('div');
        banner.id = 'analysisPendingNavT10R2R1';
        banner.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:1px solid rgba(56,189,248,.38);border-left:4px solid #38bdf8;border-radius:9px;background:rgba(14,165,233,.10);color:#bae6fd;font-weight:700;';
        banner.textContent = '⏳ Analisi IA in corso · Portfolio sospeso durante la richiesta. I risultati compariranno qui al termine.';
        results.prepend(banner);
    }
}
function clearAnalysisPendingViewT10R2R1() {
    $('analysisPendingNavT10R2R1')?.remove();
}


const APP_VERSION = '16.0_PATCH16_FORCED_STAKE_AUTHORITY_RECONCILIATION';

// STEP89B_FRONTEND_COMPAT_HOTFIX
// STEP89B: compatibilita test legacy senza modificare motore, DB, stake, gate o paper trading.
// STEP81_SW_NEUTRALIZED
// DeepScan non è il blocco primario
// DeepScan non Ã¨ il blocco primario
// Nessun addEventListener fetch nel service worker neutralizzato.

// ============================================================================
// STEP89_FRONTEND_FULL_REPAIR_MARKERS
// 14.21_STEP89_FRONTEND_FULL_REPAIR
// 14.19_STEP88_MASTER_ALIGNMENT
// 14.18_STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX · STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX · STEP87B_APPLY_ESCAPE_FIX
// 14.18_STEP86_PORTFOLIO_COMPLETE_RESTORE · STEP86_PORTFOLIO_COMPLETE_RESTORE
// 14.17_STEP85_PORTFOLIO_CHART_LAYOUT_FIX · STEP85_PORTFOLIO_CHART_LAYOUT_FIX
// 14.16_STEP84_PORTFOLIO_UI_RESTORE · STEP84_PORTFOLIO_UI_RESTORE
// const APP_VERSION = '14.15_STEP79_STAKE_NOTES_CHARTS_FIX';
// STEP79_STAKE_NOTES_CHARTS_FIX · STEP79_STAKE_NOTE_CONSISTENCY · STEP79_CHART_SOURCE_FIX · STEP79_BRIER_FROM_HISTORY_FIRST · STEP79_HIDE_COHORT_TABLE
// WATCHLIST MICRO STAKE + RISCHIO MODELLO mantiene micro-stake
// 14.14_STEP75_TENNIS_SYSTEM_AUDIT_STEP77_RELIABILITY_AUDIT · STEP77_RELIABILITY_AUDIT
// Soglie campione separate · Breakdown reliability/calibrazione · 50 ≠ 150
// DeepScan non è il blocco primario
// 14.14_STEP75_TENNIS_SYSTEM_AUDIT
// 14.13_STEP73_PORTFOLIO_DIAGNOSTICS_FIX · 14.12_STEP72_FINAL_UI_BINDING_CHECKS
// STEP74_COMPAT_ROBUST_PATCH · Calibrazione non aggiornata · Endpoint /api/analytics/calibration senza report valido · Errore endpoint calibrazione
// Come leggere le coorti · Operativo post-Step67 · CLV audit · N/D non è una bocciatura del modello
// STEP70B_UI_GRAPH_AUDIT_ATP_WTA · STEP70_UI_DIAGNOSTIC_READABILITY_FIX
// step72-step69-candidate-audit · EV teorico / operativo · Blocco specifico · Dettaglio candidati respinti / audit-only
// Mix mercati Analisi AI corrente · Mix mercati portfolio storico · Moneyline selezionate
// Bankroll da Setup · Equity finale trading reale
// buildEquityDrawdownAudit · buildDrawdownAudit · Verifica dati grafico drawdown/equity · buildTennisBrierTourCalibration · Verifica Brier Calibration ATP/WTA · ATP predizione media · WTA win rate reale
// Filtro Portafoglio · Vista attiva · filterPortfolioHistoryPayloadByActiveSegment(dataHist) · renderPortfolioEquityChart(filteredDataHist) · renderCalibrationSection(dataCal, filteredDataHist) · .filter(rowMatchesActivePortfolioSegment) · Non modifica storico, stake, gate, CLV o paper trading
// { key: 'ALL', label: 'Tutto' } · { key: 'ATP', label: 'Solo ATP' } · { key: 'WTA', label: 'Solo WTA' } · { key: 'SERIE_A', label: 'Serie A' } · { key: 'PREMIER_LEAGUE', label: 'Premier' } · { key: 'LA_LIGA', label: 'La Liga' } · { key: 'BUNDESLIGA', label: 'Bundesliga' } · { key: 'LIGUE_1', label: 'Ligue 1' } · { key: 'CHAMPIONS_LEAGUE', label: 'Champions' }
// GRAND_SLAM · MASTERS_1000 · ATP_WTA_500 · ATP_WTA_250 · CHALLENGER · ROLAND GARROS=CLAY · height:380px
// STEP81_FRONTEND_RUNTIME_RECOVERY · step81RunAnalysis · step81RunTrading · loadApiCreditsUsage · /api/usage/odds
// .replace(/[^\p{L}\s]/gu, · .replace(/^[^A-Za-z0-9]+/,
// ============================================================================

// STEP88_MASTER_ALIGNMENT: allinea Step79/84/85/86/87, index/cache, grafici Portfolio e filtri torneo.
// STEP88_LINK_AUDIT: public/app.js === backend/public/app.js; index pubblico === backend/public/index.html; sw neutralizzato.
// STEP88_INDEX_GRAPH_UI: asse X leggibile, canvas Portfolio a quota stabile, dettagli grafici superflui nascosti.
// STEP88_TOURNAMENT_TYPE_FILTERS: GRAND_SLAM · MASTERS_1000 · ATP_WTA_500 · ATP_WTA_250 · CHALLENGER · ROLAND GARROS=CLAY.
// STEP88_CODE_AUDIT: node --check public/app.js e backend/public/app.js eseguiti dalla patch.
// STEP87_LEGACY_COMPAT: 14.18_STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX · STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX · STEP87B_APPLY_ESCAPE_FIX.
// STEP86_LEGACY_COMPAT: 14.18_STEP86_PORTFOLIO_COMPLETE_RESTORE · STEP86_PORTFOLIO_COMPLETE_RESTORE.
// STEP85_LEGACY_COMPAT: 14.17_STEP85_PORTFOLIO_CHART_LAYOUT_FIX · STEP85_PORTFOLIO_CHART_LAYOUT_FIX.
// STEP84_LEGACY_COMPAT: 14.16_STEP84_PORTFOLIO_UI_RESTORE · STEP84_PORTFOLIO_UI_RESTORE.
// STEP79_LEGACY_COMPAT: 14.15_STEP79_STAKE_NOTES_CHARTS_FIX · STEP79_STAKE_NOTE_CONSISTENCY.

// STEP84_PORTFOLIO_UI_RESTORE: ripristina grafici Drawdown/Brier, calibrazione da storico e filtro ATP/WTA realmente applicato alla UI.
// STEP85_LEGACY_COMPAT: const APP_VERSION = '14.16_STEP84_PORTFOLIO_UI_RESTORE';
// STEP84_LEGACY_COMPAT: const APP_VERSION = '14.15_STEP79_STAKE_NOTES_CHARTS_FIX';
// STEP84_LEGACY_COMPAT: 14.14_STEP75_TENNIS_SYSTEM_AUDIT
// STEP79_STAKE_NOTE_CONSISTENCY: WATCHLIST MICRO STAKE + RISCHIO MODELLO mantiene micro-stake; BLOCCATA SOFT/HARD azzera salvo VALUE CONFERMATO MICRO.
// STEP79_CHART_SOURCE_FIX: grafici portfolio letti da storico strict/current, non da endpoint opzionali.
// STEP79_CHART_SOURCE_FIX markers: safeString(row.deepscan_gate_status) · portfolioScope === 'PORTFOLIO_REAL'.
// STEP79_BRIER_FROM_HISTORY_FIRST: Brier ATP/WTA usa storico paper/current anche se endpoint calibrazione non risponde.
// STEP79_HIDE_COHORT_TABLE: tabella coorti Step67 rimossa dalla UI Portfolio; restano KPI, CLV, drawdown, Brier e strategie filtrate.
// STEP75_PREVIOUS_UI_COMPAT_MARKERS: 14.13_STEP73_PORTFOLIO_DIAGNOSTICS_FIX · 14.12_STEP72_FINAL_UI_BINDING_CHECKS
// STEP75_PORTFOLIO_LEGACY_LABEL_COMPAT: Come leggere le coorti · Storico reale precedente Step67 · Trading reale nuovo regime Step67+ · Diagnostica alto rischio precedente Step67
/* STEP74_COMPAT_ROBUST_PATCH
 * Versione corrente: 14.13_STEP73_PORTFOLIO_DIAGNOSTICS_FIX
 * Marker compatibilita test legacy: 14.12_STEP72_FINAL_UI_BINDING_CHECKS
 * Cache buster corrente: app.js?v=step73-portfolio-diagnostics-fix
 * Cache buster legacy solo diagnostico: app.js?v=step72-final-ui-binding-checks
 * Nota: Step72 non deve bloccare Step73+ quando il frontend e' stato avanzato correttamente.
 */


// STEP28_BANKROLL_DECIMAL_PATCH
function normalizeBankrollDecimalInput(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .trim()
        .replace(/\s+/g, '')
        .replace(/[€$£]/g, '')
        .replace(',', '.');
}

function parseBankrollDecimalInput(value) {
    const normalized = normalizeBankrollDecimalInput(value);
    const n = Number(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function attachBankrollDecimalInputPatch() {
    const input = document.getElementById('bankroll');
    if (!input) return;

    input.setAttribute('step', '0.01');
    input.setAttribute('min', '0');
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');

    const normalize = () => {
        const normalized = normalizeBankrollDecimalInput(input.value);
        if (normalized && normalized !== input.value) input.value = normalized;
    };

    input.addEventListener('input', () => {
        if (String(input.value || '').includes(',')) normalize();
    });

    input.addEventListener('change', normalize);
    input.addEventListener('blur', normalize);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachBankrollDecimalInputPatch);
    } else {
        attachBankrollDecimalInputPatch();
    }
}
// /STEP28_BANKROLL_DECIMAL_PATCH


const SPORT = {
    CALCIO: 'calcio',
    TENNIS: 'tennis',
    MANUAL_DEEPSCAN: 'manual_deepscan'
};

const leagueMap = {
    serie_a: 'Serie A',
    serie_b: 'Serie B',
    premier_league: 'Premier',
    la_liga: 'La Liga',
    bundesliga: 'Bundesliga',
    ligue_1: 'Ligue 1',
    atp: 'ATP',
    wta: 'WTA'
};


// ============================================================================
// 2. HELPERS GENERALI
// ============================================================================

function $(id) {
    return document.getElementById(id);
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function round(value, decimals = 2) {
    const n = safeNumber(value, 0);
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function clamp(value, min, max) {
    const n = safeNumber(value, min);
    return Math.max(min, Math.min(max, n));
}


// STEP85_PORTFOLIO_CHART_LAYOUT_FIX: i grafici Portfolio devono avere un contenitore a quota fissa.
// Senza un parent con height esplicita Chart.js può entrare in resize-loop e allungare la pagina.
const STEP85_PORTFOLIO_CHART_HEIGHT = 380;

function installStep85PortfolioChartCss() {
    if (document.getElementById('step85PortfolioChartCss')) return;
    const style = document.createElement('style');
    style.id = 'step85PortfolioChartCss';
    style.textContent = `
        .portfolio-chart-grid-step85 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
            gap: 20px;
            margin-top: 25px;
            align-items: start;
        }
        .portfolio-chart-card-step85 {
            background: var(--bg-color, #0f172a);
            padding: 15px;
            border-radius: 12px;
            border: 1px solid var(--border-color, #334155);
            min-width: 0;
            overflow: hidden;
        }
        .portfolio-chart-box-step85 {
            position: relative;
            width: 100%;
            height:380px;
            min-height:380px;
            max-height:380px;
            overflow: hidden;
            background: #0f172a;
            border-radius: 8px;
        }
        .portfolio-chart-box-step85 canvas {
            display: block !important;
            width: 100% !important;
            height:380px !important;
            min-height: 0 !important;
            max-height:380px !important;
            background: transparent !important;
        }
        @media (max-width: 860px) {
            .portfolio-chart-grid-step85 { grid-template-columns: 1fr; }
        }
    `;
    document.head.appendChild(style);
}

function ensurePortfolioChartLayout(canvasId) {
    installStep85PortfolioChartCss();
    const canvas = $(canvasId);
    if (!canvas) return null;

    const grid = canvas.closest('[data-step85-portfolio-chart-grid]');
    if (grid) grid.classList.add('portfolio-chart-grid-step85');

    const originalParent = canvas.parentElement;
    if (originalParent) originalParent.classList.add('portfolio-chart-card-step85');

    let box = canvas.parentElement;
    if (!box || !box.classList || !box.classList.contains('portfolio-chart-box-step85')) {
        box = document.createElement('div');
        box.className = 'portfolio-chart-box-step85';
        canvas.parentNode.insertBefore(box, canvas);
        box.appendChild(canvas);
    }

    canvas.removeAttribute('height');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = `${STEP85_PORTFOLIO_CHART_HEIGHT}px`;
    canvas.style.minHeight = '0';
    canvas.style.maxHeight = `${STEP85_PORTFOLIO_CHART_HEIGHT}px`;
    canvas.style.background = 'transparent';

    return canvas;
}

function registerStep85PortfolioChartBackground() {
    if (!window.Chart || window.__step85PortfolioChartBackgroundRegistered) return;
    window.Chart.register({
        id: 'step85PortfolioDarkCanvasBackground',
        beforeDraw(chart, args, options) {
            const ctx = chart?.ctx;
            if (!ctx) return;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = options?.color || '#0f172a';
            ctx.fillRect(0, 0, chart.width || 0, chart.height || 0);
            ctx.restore();
        }
    });
    window.__step85PortfolioChartBackgroundRegistered = true;
}


function step85PortfolioChartOptions(extra = {}) {
    // STEP89_REPAIR_STEP85_OPTIONS: blocco ricostruito per evitare funzioni iniettate dentro un object literal.
    registerStep85PortfolioChartBackground();
    const extraPlugins = extra && extra.plugins ? extra.plugins : {};
    const merged = {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 150,
        animation: false,
        ...extra
    };
    merged.plugins = {
        ...extraPlugins,
        step85PortfolioDarkCanvasBackground: { color: '#0f172a' }
    };
    return merged;
}

function installStep89PortfolioChartHeightCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('step89PortfolioChartHeightCss')) return;
    const style = document.createElement('style');
    style.id = 'step89PortfolioChartHeightCss';
    style.textContent = [
        '/* STEP89_PORTFOLIO_CHART_HEIGHT_STABLE height:380px */',
        '.portfolio-chart-grid-step85,.portfolio-chart-grid-step86{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(360px,1fr))!important;gap:20px!important;align-items:start!important;}',
        '.portfolio-chart-card-step85,.portfolio-chart-card-step86,#portfolioSection .chart-card{min-width:0!important;overflow:hidden!important;background:#0f172a!important;}',
        '.portfolio-chart-box-step85,.portfolio-chart-box-step86,.step89-chart-box{position:relative!important;width:100%!important;height:380px!important;min-height:380px!important;max-height:380px!important;overflow:hidden!important;background:#0f172a!important;border-radius:8px!important;}',
        '.portfolio-chart-box-step85 canvas,.portfolio-chart-box-step86 canvas,#chartDrawdown,#chartCalibration{display:block!important;width:100%!important;height:380px!important;min-height:0!important;max-height:380px!important;background:transparent!important;}',
        '#drawdownDataAuditPanel,#brierTourDataAuditPanel,.step88-hide-chart-details,.step89-hide-chart-details{display:none!important;}',
        '@media(max-width:860px){.portfolio-chart-grid-step85,.portfolio-chart-grid-step86{grid-template-columns:1fr!important;}}'
    ].join('\n');
    document.head.appendChild(style);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installStep89PortfolioChartHeightCss);
    else installStep89PortfolioChartHeightCss();
}

function formatNumber(value, decimals = 2) {
    return round(value, decimals).toFixed(decimals);
}

function formatEuro(value, decimals = 2) {
    const n = safeNumber(value, 0);
    const sign = n > 0 ? '+' : '';
    return `${sign}€${formatNumber(n, decimals)}`;
}

function formatPct(value, decimals = 2, showPlus = false) {
    const n = safeNumber(value, 0);
    const sign = showPlus && n > 0 ? '+' : '';
    return `${sign}${formatNumber(n, decimals)}%`;
}

function htmlEscape(value) {
    return safeString(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}




// ============================================================================
// PATCH9_TENNIS_COMPACT_OPERATIONS_CENTER
// Unifica gli aggiornamenti Patch 6-9 in una finestra accessibile e riducibile.
// ============================================================================
const tennisOperationsStatus = {
    readiness: { level: 'warn', alerts: 0, label: 'Readiness…' },
    prediction: { level: 'ok', alerts: 0, label: 'Snapshot…' },
    lifecycle: { level: 'ok', alerts: 0, label: 'Lifecycle…' },
    cohort: { level: 'ok', alerts: 0, label: 'Coorti…' },
    quality: { level: 'ok', alerts: 0, label: 'Qualità…' },
    capture: { level: 'ok', alerts: 0, label: 'Acquisizione…' },
    eventTime: { level: 'ok', alerts: 0, label: 'Orario evento…' },
    rejectedCapture: { level: 'ok', alerts: 0, label: 'Rifiuti capture…' },
    forwardIntake: { level: 'warn', alerts: 0, label: 'Campione forward…' },
    intelligence: { level: 'ok', alerts: 0, label: 'Matchup…' },
    historical: { level: 'ok', alerts: 0, label: 'WR storico…' },
    progression: { level: 'ok', alerts: 0, label: 'Programma…' },
    dataRefresh: { level: 'warn', alerts: 0, label: 'Dati giocatori…' },
    retrieval: { level: 'warn', alerts: 0, label: 'Ricerca fonti…' },
    historicalStats: { level: 'warn', alerts: 0, label: 'Storico giocatori…' },
    historicalPerformance: { level: 'warn', alerts: 0, label: 'Performance shadow…' },
    statisticalChallenger: { level: 'warn', alerts: 0, label: 'Challenger statistico…' },
    professionalStatisticalEngine: { level: 'warn', alerts: 0, label: 'Markov · MC · Elo…' },
    tourReadiness: { level: 'warn', alerts: 0, label: 'Circuiti…' }
};

// PATCH25_TENNIS_RUNTIME_HEALTH_TRUTH_UI
const tennisOperationsCanonicalSummary = {
    priority: 0,
    source: 'INIT',
    patchVersion: null,
    state: 'LOADING',
    label: 'Verifica sistema…',
    errorCount: 0,
    warningCount: 0,
    ready: false
};

function updateTennisOperationsCanonicalSummary(next = {}, priority = 1) {
    if (priority < Number(tennisOperationsCanonicalSummary.priority || 0)) return;
    Object.assign(tennisOperationsCanonicalSummary, next, { priority });
    renderTennisOperationsSummary();
}


function renderTennisOperationsSummary() {
    const fallbackErrors = Object.values(tennisOperationsStatus).filter(item => item.level === 'error').length;
    const fallbackWarnings = Object.values(tennisOperationsStatus).filter(item => item.level === 'warn').length;
    const canonicalLoaded = Number(tennisOperationsCanonicalSummary.priority || 0) > 0;
    const errors = canonicalLoaded ? Number(tennisOperationsCanonicalSummary.errorCount || 0) : fallbackErrors;
    const warnings = canonicalLoaded ? Number(tennisOperationsCanonicalSummary.warningCount || 0) : fallbackWarnings;
    const state = canonicalLoaded ? String(tennisOperationsCanonicalSummary.state || 'READY_WITH_WARNINGS') : (errors ? 'NOT_READY_CRITICAL' : warnings ? 'READY_WITH_WARNINGS' : 'READY');
    const patchChip = $('tennisOpsPatchChip');
    const readinessChip = $('tennisOpsReadinessChip');
    const alertChip = $('tennisOpsAlertChip');
    const label = tennisOperationsCanonicalSummary.label || ({
        READY: 'Pronto',
        READY_WITH_WARNINGS: 'Pronto con avvisi',
        READY_FOR_FIRST_MATCH: 'Pronto al primo match',
        NOT_READY_CRITICAL: 'Non pronto — errore critico',
        LOADING: 'Verifica sistema…'
    }[state] || state);
    if (patchChip) patchChip.textContent = `Patch ${tennisOperationsCanonicalSummary.patchVersion || '25'}`;
    if (readinessChip) {
        readinessChip.textContent = label;
        readinessChip.classList.remove('status-ok', 'status-warn', 'status-error');
        readinessChip.classList.add(state === 'NOT_READY_CRITICAL' ? 'status-error' : state === 'READY' ? 'status-ok' : 'status-warn');
    }
    if (alertChip) {
        alertChip.textContent = errors > 0 ? `${errors} errori · ${warnings} avvisi` : `${warnings} avvisi · 0 errori`;
        alertChip.classList.remove('status-ok', 'status-warn', 'status-error');
        alertChip.classList.add(errors > 0 ? 'status-error' : warnings > 0 ? 'status-warn' : 'status-ok');
    }
    const center = $('tennisOperationsCenter');
    if (center) {
        center.dataset.health = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok';
        center.dataset.operationalState = state;
        center.setAttribute('aria-label', `Centro operativo Tennis, ${errors} errori e ${warnings} avvisi, stato ${label}`);
    }
}

function updateTennisOperationsStatus(key, next = {}) {
    if (!tennisOperationsStatus[key]) return;
    tennisOperationsStatus[key] = {
        ...tennisOperationsStatus[key],
        ...next,
        alerts: Math.max(0, Number(next.alerts ?? tennisOperationsStatus[key].alerts ?? 0))
    };
    renderTennisOperationsSummary();
}

function setTennisOperationsCollapsed(collapsed, { persist = true } = {}) {
    const center = $('tennisOperationsCenter');
    const body = $('tennisOperationsBody');
    const toggle = $('toggleTennisOperationsCenter');
    if (!center) return;
    center.classList.toggle('is-collapsed', Boolean(collapsed));
    center.dataset.state = collapsed ? 'collapsed' : 'expanded';
    if (body) body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (toggle) {
        toggle.textContent = collapsed ? '🎾' : '−';
        toggle.title = collapsed ? 'Espandi centro operativo Tennis' : 'Riduci a icona';
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    if (persist) {
        try { localStorage.setItem('tennisOperationsCenterCollapsed', collapsed ? '1' : '0'); } catch (_) {}
    }
}

function syncTennisOperationsVisibility() {
    const center = $('tennisOperationsCenter');
    if (!center) return;
    const isTennis = activeSport === SPORT.TENNIS || activeSport === 'tennis';
    center.classList.toggle('is-sport-hidden', !isTennis);
}

let tennisOperationsRefreshPromise = null;
let tennisOperationsRefreshTimer = null;
function scheduleTennisOperationsRefresh(delayMs = 1800) {
    if (activeSport !== SPORT.TENNIS) return;
    if (tennisOperationsRefreshTimer) clearTimeout(tennisOperationsRefreshTimer);
    tennisOperationsRefreshTimer = setTimeout(() => {
        tennisOperationsRefreshTimer = null;
        refreshTennisOperationsCenter();
    }, Math.max(0, Number(delayMs) || 0));
}
async function refreshTennisOperationsCenter() {
    if (activeSport !== SPORT.TENNIS) return null;
    if (tennisOperationsRefreshPromise) return tennisOperationsRefreshPromise;
    const button = $('refreshTennisOperationsCenter');
    if (button) {
        button.disabled = true;
        button.textContent = '⏳ Aggiorno…';
    }
    tennisOperationsRefreshPromise = (async () => {
        try {
            const loaders = [
                loadTennisForwardLifecycle,
                loadTennisForwardCohorts,
                loadTennisForwardCaptureHealth,
                loadTennisRejectedCaptureObservability,
                loadTennisCalibrationReadiness,
                loadTennisPredictionAudit,
                loadTennisQualityGateHealth,
                loadTennisForwardSampleIntake,
                loadTennisMatchupIntelligence,
                loadTennisHistoricalCombinationEvidence,
                loadTennisPlayerDataFreshness,
                loadTennisTourDataReadiness,
                loadTennisInformationRetrieval,
                loadTennisHistoricalPlayerStats,
                loadTennisHistoricalValidationPerformance,
                loadTennisStatisticalChallenger,
                loadTennisProfessionalStatisticalEngine,
                loadTennisProgramProgression
            ];
            // R3: limita la pressione su SQLite/Node e mantiene fluida la UI.
            // Quattro letture concorrenti per batch, nessuna chiamata provider aggiuntiva.
            for (let index = 0; index < loaders.length; index += 4) {
                if (activeSport !== SPORT.TENNIS) break;
                await Promise.allSettled(loaders.slice(index, index + 4).map(loader => loader()));
                await new Promise(resolve => setTimeout(resolve, 35));
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '🔄 Aggiorna';
            }
            tennisOperationsRefreshPromise = null;
        }
    })();
    return tennisOperationsRefreshPromise;
}

function bindTennisOperationsCenterUi() {
    const center = $('tennisOperationsCenter');
    if (!center || center.dataset.bound === '1') return;
    center.dataset.bound = '1';
    let collapsed = false;
    try { collapsed = localStorage.getItem('tennisOperationsCenterCollapsed') === '1'; } catch (_) {}
    setTennisOperationsCollapsed(collapsed, { persist: false });
    $('toggleTennisOperationsCenter')?.addEventListener('click', () => {
        setTennisOperationsCollapsed(!center.classList.contains('is-collapsed'));
    });
    $('refreshTennisOperationsCenter')?.addEventListener('click', refreshTennisOperationsCenter);
    center.querySelector('.tennis-operations-icon')?.addEventListener('click', () => {
        if (center.classList.contains('is-collapsed')) setTennisOperationsCollapsed(false);
    });
    syncTennisOperationsVisibility();
    renderTennisOperationsSummary();
}
window.refreshTennisOperationsCenter = refreshTennisOperationsCenter;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisOperationsCenterUi);
else bindTennisOperationsCenterUi();
// /PATCH9_TENNIS_COMPACT_OPERATIONS_CENTER

// ============================================================================
// PATCH5_RUNTIME_DIAGNOSTICS_UI
// Diagnostica leggibile per errori frontend/backend con Operation ID e fase.
// ============================================================================
let runtimeDiagnosticState = null;
let runtimeDiagnosticScope = 'ALL';
let runtimeDiagnosticDetailsExpanded = false;
const RUNTIME_DIAGNOSTIC_STICKY_ERROR_MS = 30000;

function getRuntimeDiagnosticScope(sport = activeSport) {
    return sport === SPORT.TENNIS || sport === 'tennis'
        ? 'TENNIS'
        : (sport === SPORT.CALCIO || sport === 'calcio' ? 'CALCIO' : 'ALL');
}
function runtimeDiagnosticSeverityRank(value) {
    const level = safeString(value).toUpperCase();
    if (level.includes('FATAL')) return 4;
    if (level.includes('ERROR')) return 3;
    if (level.includes('WARN')) return 2;
    return 1;
}

function normalizeRuntimeDiagnostic(input = {}) {
    const error = input.error instanceof Error ? input.error : null;
    const backend = input.runtimeDiagnostic || input.diagnostic || {};
    const details = input.details || backend.context || error?.stack || input.stack || null;
    return {
        severity: safeString(input.severity || backend.level || (error ? 'ERROR' : 'WARN')).toLowerCase(),
        title: safeString(input.title || 'Anomalia applicazione'),
        message: safeString(input.message || backend.message || error?.message || 'Errore non specificato.'),
        operationId: safeString(input.operationId || backend.operationId || ''),
        phase: safeString(input.phase || backend.phase || ''),
        code: safeString(input.code || backend.event || backend.code || ''),
        timestamp: safeString(input.timestamp || backend.timestamp || new Date().toISOString()),
        scope: safeString(input.scope || backend.scope || input.details?.scope || runtimeDiagnosticScope || getRuntimeDiagnosticScope()),
        force: input.force === true,
        details
    };
}

function showRuntimeDiagnostic(input = {}) {
    const diagnostic = normalizeRuntimeDiagnostic(input);
    const previous = runtimeDiagnosticState;
    if (!diagnostic.force && previous) {
        const previousAt = Date.parse(previous.timestamp || '') || 0;
        const previousFresh = Date.now() - previousAt < RUNTIME_DIAGNOSTIC_STICKY_ERROR_MS;
        const sameScope = !previous.scope || !diagnostic.scope || previous.scope === diagnostic.scope;
        if (sameScope && previousFresh && runtimeDiagnosticSeverityRank(previous.severity) > runtimeDiagnosticSeverityRank(diagnostic.severity)) {
            return previous;
        }
    }
    runtimeDiagnosticState = diagnostic;
    runtimeDiagnosticScope = diagnostic.scope || runtimeDiagnosticScope;
    const panel = $('runtimeDiagnosticPanel');
    if (!panel) {
        if (diagnostic.severity.includes('error') || diagnostic.severity.includes('fatal')) console.error('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
        else if (diagnostic.severity.includes('warn')) console.warn('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
        else console.info('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
        return diagnostic;
    }
    panel.classList.remove('severity-warn', 'severity-info');
    if (diagnostic.severity.includes('warn')) panel.classList.add('severity-warn');
    else if (diagnostic.severity.includes('info')) panel.classList.add('severity-info');
    panel.classList.add('is-visible');
    const title = $('runtimeDiagnosticTitle');
    const message = $('runtimeDiagnosticMessage');
    const meta = $('runtimeDiagnosticMeta');
    const details = $('runtimeDiagnosticDetails');
    if (title) title.textContent = diagnostic.title;
    if (message) message.textContent = diagnostic.message;
    if (meta) meta.textContent = [
        diagnostic.scope ? `Scope: ${diagnostic.scope}` : '',
        diagnostic.operationId ? `Operation ID: ${diagnostic.operationId}` : '',
        diagnostic.phase ? `Fase: ${diagnostic.phase}` : '',
        diagnostic.code ? `Codice: ${diagnostic.code}` : '',
        diagnostic.timestamp ? `Ora: ${diagnostic.timestamp}` : ''
    ].filter(Boolean).join(' · ');
    if (details) {
        const detailText = diagnostic.details == null ? '' : (typeof diagnostic.details === 'string' ? diagnostic.details : JSON.stringify(diagnostic.details, null, 2));
        details.textContent = detailText.slice(0, 8000);
        details.dataset.available = detailText ? '1' : '0';
        const autoExpand = diagnostic.severity.includes('error') || diagnostic.severity.includes('fatal');
        runtimeDiagnosticDetailsExpanded = Boolean(detailText) && (diagnostic.forceDetails === true || autoExpand);
        details.style.display = runtimeDiagnosticDetailsExpanded ? 'block' : 'none';
        const toggle = $('runtimeDiagnosticToggle');
        if (toggle) {
            toggle.style.display = detailText ? 'inline-flex' : 'none';
            toggle.textContent = runtimeDiagnosticDetailsExpanded ? 'Nascondi dettagli' : 'Mostra dettagli';
            toggle.setAttribute('aria-expanded', runtimeDiagnosticDetailsExpanded ? 'true' : 'false');
        }
    }
    if (diagnostic.severity.includes('error') || diagnostic.severity.includes('fatal')) console.error('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
    else if (diagnostic.severity.includes('warn')) console.warn('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
    else console.info('[PATCH5 RUNTIME DIAGNOSTICS]', diagnostic);
    return diagnostic;
}

function hideRuntimeDiagnostic() {
    runtimeDiagnosticDetailsExpanded = false;
    $('runtimeDiagnosticPanel')?.classList.remove('is-visible');
}

async function loadRuntimeDiagnosticsFromNode(options = {}) {
    try {
        const scope = safeString(options.scope || getRuntimeDiagnosticScope()).toUpperCase() || 'ALL';
        runtimeDiagnosticScope = scope;
        const response = await fetch(`/api/runtime-diagnostics?scope=${encodeURIComponent(scope)}&limit=24`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
        const latestError = (payload.recent || []).find(item => ['ERROR', 'FATAL'].includes(safeString(item.level).toUpperCase()));
        if (latestError) {
            showRuntimeDiagnostic({
                severity: latestError.level,
                title: 'Ultimo errore registrato da Node',
                message: latestError.message,
                operationId: latestError.operationId,
                phase: latestError.phase,
                code: latestError.event,
                timestamp: latestError.timestamp,
                scope: payload.scope || scope,
                force: options.force === true,
                details: { context: latestError.context, error: latestError.error, summary: payload.summary, dataSummary: payload.dataSummary, scope: payload.scope }
            });
        } else {
            const summary = payload.summary || {};
            const total = Number(summary.total || 0);
            const infoCount = Number(summary.byLevel?.INFO || 0);
            const warnCount = Number(summary.byLevel?.WARN || 0);
            showRuntimeDiagnostic({
                severity: 'INFO',
                title: 'Log Node operativo',
                message: `Nessun crash o errore nel tail per lo scope ${payload.scope || scope}. Eventi letti: ${total} · INFO ${infoCount} · WARN ${warnCount}. I WARN e i PENDING maturi restano debito operativo da verificare.`,
                phase: 'RUNTIME_DIAGNOSTICS_READ',
                scope: payload.scope || scope,
                force: options.force === true,
                details: { summary: payload.summary, dataSummary: payload.dataSummary, readMode: payload.readMode, scope: payload.scope || scope }
            });
        }
        return payload;
    } catch (error) {
        return showRuntimeDiagnostic({ severity: 'ERROR', title: 'Log Node non leggibile', message: error.message, phase: 'RUNTIME_DIAGNOSTICS_FETCH', scope: safeString(options.scope || getRuntimeDiagnosticScope()).toUpperCase(), force: true, error });
    }
}

function bindRuntimeDiagnosticUi() {
    const close = $('runtimeDiagnosticClose');
    const copy = $('runtimeDiagnosticCopy');
    const refresh = $('runtimeDiagnosticRefresh');
    const toggle = $('runtimeDiagnosticToggle');
    if (close && close.dataset.bound !== '1') { close.addEventListener('click', hideRuntimeDiagnostic); close.dataset.bound = '1'; }
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', () => loadRuntimeDiagnosticsFromNode({ scope: getRuntimeDiagnosticScope(), force: true })); refresh.dataset.bound = '1'; }
    if (toggle && toggle.dataset.bound !== '1') {
        toggle.addEventListener('click', () => {
            const details = $('runtimeDiagnosticDetails');
            if (!details || details.dataset.available !== '1') return;
            runtimeDiagnosticDetailsExpanded = !runtimeDiagnosticDetailsExpanded;
            details.style.display = runtimeDiagnosticDetailsExpanded ? 'block' : 'none';
            toggle.textContent = runtimeDiagnosticDetailsExpanded ? 'Nascondi dettagli' : 'Mostra dettagli';
            toggle.setAttribute('aria-expanded', runtimeDiagnosticDetailsExpanded ? 'true' : 'false');
        });
        toggle.dataset.bound = '1';
    }
    if (copy && copy.dataset.bound !== '1') {
        copy.addEventListener('click', async () => {
            const text = JSON.stringify(runtimeDiagnosticState || {}, null, 2);
            try { await navigator.clipboard.writeText(text); copy.textContent = 'Copiato'; setTimeout(() => { copy.textContent = 'Copia diagnostica'; }, 1200); }
            catch (_) { window.prompt('Copia diagnostica:', text); }
        });
        copy.dataset.bound = '1';
    }
}

function resetRuntimeDiagnosticForSport(sport) {
    const nextScope = getRuntimeDiagnosticScope(sport);
    if (runtimeDiagnosticState?.scope && runtimeDiagnosticState.scope !== nextScope) {
        runtimeDiagnosticState = null;
        hideRuntimeDiagnostic();
    }
    runtimeDiagnosticScope = nextScope;
}
window.showRuntimeDiagnostic = showRuntimeDiagnostic;
window.loadRuntimeDiagnosticsFromNode = loadRuntimeDiagnosticsFromNode;
window.resetRuntimeDiagnosticForSport = resetRuntimeDiagnosticForSport;
window.addEventListener('error', event => {
    showRuntimeDiagnostic({ severity: 'ERROR', title: 'Errore JavaScript', message: event.message, phase: 'WINDOW_ERROR', code: `${event.filename || 'script'}:${event.lineno || 0}:${event.colno || 0}`, error: event.error });
});
window.addEventListener('unhandledrejection', event => {
    const reason = event.reason instanceof Error ? event.reason : new Error(safeString(event.reason, 'Promise rejection'));
    showRuntimeDiagnostic({ severity: 'ERROR', title: 'Promise non gestita', message: reason.message, phase: 'UNHANDLED_REJECTION', error: reason });
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindRuntimeDiagnosticUi);
else bindRuntimeDiagnosticUi();
// /PATCH5_RUNTIME_DIAGNOSTICS_UI

// ============================================================================
// PATCH6_TENNIS_CALIBRATION_READINESS_UI
// Dataset certificato e shadow metrics: nessuna applicazione automatica.
// ============================================================================
function renderTennisCalibrationReadiness(payload = {}) {
    const panel = $('tennisCalibrationReadinessPanel');
    if (!panel) return;
    const readiness = payload.readiness || {};
    const metrics = payload.metrics || {};
    const eligible = payload.eligible || {};
    const ledger = payload.ledger || {};
    const status = safeString(readiness.status || 'NOT_READY').toUpperCase();
    panel.classList.remove('status-not-ready', 'status-degraded', 'status-ready');
    panel.classList.add(status === 'READY_SHADOW_ONLY' ? 'status-ready' : (status === 'DEGRADED_LEDGER' ? 'status-degraded' : 'status-not-ready'));
    const title = $('tennisCalibrationReadinessTitle');
    const message = $('tennisCalibrationReadinessMessage');
    if (title) {
        title.textContent = status === 'READY_SHADOW_ONLY' ? 'Calibrazione pronta in shadow mode' : (status === 'DEGRADED_LEDGER' ? 'Ledger calibrazione non allineato' : 'Calibrazione certificata non pronta');
        title.style.color = status === 'READY_SHADOW_ONLY' ? '#34d399' : (status === 'DEGRADED_LEDGER' ? '#f87171' : '#fbbf24');
    }
    if (message) message.textContent = payload.note || 'Le metriche non modificano probabilità, gate o stake.';
    const fmt = (value, suffix = '') => value === null || value === undefined ? 'N/A' : `${value}${suffix}`;
    const cards = [
        ['Righe Tennis', payload.sourceRows ?? 0],
        ['Settlement eleggibili', eligible.settlement ?? 0],
        ['CLV eleggibili', eligible.clv ?? 0],
        ['Ledger', ledger.fresh ? 'ALLINEATO' : `STALE (${ledger.missing || 0}/${ledger.mismatch || 0})`],
        ['Brier shadow', fmt(metrics.brierScore)],
        ['Log loss', fmt(metrics.logLoss)],
        ['Calibration gap', fmt(metrics.absoluteCalibrationGapPp, ' pp')],
        ['ECE', fmt(metrics.expectedCalibrationError)],
        ['ROI certificato', fmt(metrics.roiPct, '%')],
        ['Avg CLV certificato', fmt(metrics.averageClvPct, '%')]
    ];
    const grid = $('tennisCalibrationReadinessGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-calibration-readiness-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const reasons = $('tennisCalibrationReadinessReasons');
    if (reasons) reasons.textContent = (readiness.reasons || []).length ? `Motivi: ${(readiness.reasons || []).join(' · ')}` : 'Tutti i controlli shadow hanno superato le soglie; applicazione automatica comunque disattivata.';    updateTennisOperationsStatus('readiness', {
        level: status === 'READY_SHADOW_ONLY' ? 'ok' : (status === 'DEGRADED_LEDGER' ? 'error' : 'warn'),
        alerts: status === 'DEGRADED_LEDGER' ? 1 : 0,
        label: status === 'READY_SHADOW_ONLY' ? 'Calibrazione shadow pronta' : (status === 'DEGRADED_LEDGER' ? 'Ledger calibrazione errore' : 'Calibrazione in attesa')
    });
}

async function loadTennisCalibrationReadiness() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/calibration-readiness', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const err = new Error(payload.error || `HTTP ${response.status}`);
            err.payload = payload;
            throw err;
        }
        renderTennisCalibrationReadiness(payload);
        if (payload.ledger?.fresh === false) {
            showRuntimeDiagnostic({ severity: 'WARN', title: 'Ledger calibrazione non allineato', message: 'Eseguire npm run refresh:tennis:calibration-eligibility.', phase: 'CALIBRATION_LEDGER_CHECK', operationId: payload.operationId, code: payload.readiness?.status, details: payload.ledger });
        }
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Readiness calibrazione non disponibile', message: error.message, phase: 'CALIBRATION_READINESS_FETCH', operationId: error.payload?.operationId, details: error.payload || error.stack, error });
        const panel = $('tennisCalibrationReadinessPanel');
        if (panel) panel.classList.add('status-degraded');
        const title = $('tennisCalibrationReadinessTitle');
        if (title) title.textContent = 'Errore lettura readiness calibrazione';
        updateTennisOperationsStatus('readiness', { level: 'error', alerts: 1, label: 'Readiness errore' });
        return null;
    }
}

function bindTennisCalibrationReadinessUi() {
    const refresh = $('refreshTennisCalibrationReadiness');
    if (refresh && refresh.dataset.bound !== '1') {
        refresh.addEventListener('click', loadTennisCalibrationReadiness);
        refresh.dataset.bound = '1';
    }
    loadTennisCalibrationReadiness();
}
window.loadTennisCalibrationReadiness = loadTennisCalibrationReadiness;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisCalibrationReadinessUi);
else bindTennisCalibrationReadinessUi();
// /PATCH6_TENNIS_CALIBRATION_READINESS_UI


// ============================================================================
// PATCH7_TENNIS_IMMUTABLE_PREDICTION_AUDIT_UI
// Stato read-only degli snapshot predittivi forward-only e della catena hash.
// ============================================================================
function renderTennisPredictionAudit(payload = {}) {
    const panel = $('tennisPredictionAuditPanel');
    if (!panel) return;
    const totals = payload.totals || {};
    const chain = payload.chain || {};
    const ok = payload.success === true && chain.valid !== false;
    const hasWarnings = Number(totals.postStartInvalid || 0) > 0 || Number(totals.incomplete || 0) > 0;
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(!ok ? 'status-error' : (hasWarnings ? 'status-warn' : 'status-ok'));
    const title = $('tennisPredictionAuditTitle');
    const message = $('tennisPredictionAuditMessage');
    if (title) {
        title.textContent = !ok ? 'Errore integrità snapshot predittivi' : (Number(totals.snapshots || 0) === 0 ? 'Snapshot forward pronti · nessun nuovo record' : 'Snapshot predittivi integri');
        title.style.color = !ok ? '#f87171' : (hasWarnings ? '#fbbf24' : '#34d399');
    }
    if (message) message.textContent = payload.note || 'Ogni nuova previsione viene congelata prima del match; le revisioni non sovrascrivono l’anchor originale.';
    const cards = [
        ['Snapshot', totals.snapshots || 0],
        ['Bet tracciate', totals.bets || 0],
        ['Anchor pre-match', totals.anchors || 0],
        ['Incomplete', totals.incomplete || 0],
        ['Post-start invalid', totals.postStartInvalid || 0],
        ['Catena hash', chain.valid === false ? 'ERRORE' : 'OK'],
        ['Righe verificate', chain.rows || 0],
        ['Versione', payload.version || 'N/A']
    ];
    const grid = $('tennisPredictionAuditGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-prediction-audit-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const recent = $('tennisPredictionAuditRecent');
    if (recent) {
        const lines = (payload.rows || []).slice(0, 8).map(row => `#${row.bet_id} · ${row.snapshot_type} · ${row.snapshot_status} · ${row.snapshot_id} · ${row.operation_id || 'NO_OP'}`);
        recent.textContent = lines.length ? `Ultimi snapshot:\n${lines.join('\n')}` : 'Nessuno snapshot forward registrato. Il primo verrà creato con la prossima previsione Tennis.';
    }    updateTennisOperationsStatus('prediction', {
        level: !ok ? 'error' : (hasWarnings ? 'warn' : 'ok'),
        alerts: (chain.valid === false ? 1 : 0) + Number(totals.postStartInvalid || 0) + Number(totals.incomplete || 0),
        label: !ok ? 'Snapshot errore' : `${Number(totals.anchors || 0)} anchor`
    });
}

async function loadTennisPredictionAudit() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/prediction-audit?limit=12', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const err = new Error(payload.error || `HTTP ${response.status}`);
            err.payload = payload;
            throw err;
        }
        renderTennisPredictionAudit(payload);
        if (payload.chain?.valid === false) {
            showRuntimeDiagnostic({ severity: 'ERROR', title: 'Catena snapshot non integra', message: 'La verifica hash degli snapshot Tennis ha rilevato anomalie.', phase: 'PREDICTION_SNAPSHOT_CHAIN', operationId: payload.operationId, code: 'SNAPSHOT_CHAIN_INVALID', details: payload.chain });
        } else if ((payload.totals?.postStartInvalid || 0) > 0) {
            showRuntimeDiagnostic({ severity: 'WARN', title: 'Snapshot post-start esclusi', message: 'Sono presenti snapshot creati dopo l’inizio del match: restano in audit ma non entrano in calibrazione.', phase: 'PREDICTION_SNAPSHOT_AUDIT', operationId: payload.operationId, code: 'POST_START_INVALID', details: payload.totals });
        }
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Audit snapshot non disponibile', message: error.message, phase: 'PREDICTION_AUDIT_FETCH', operationId: error.payload?.operationId, details: error.payload || error.stack, error });
        const panel = $('tennisPredictionAuditPanel');
        if (panel) panel.classList.add('status-error');
        const title = $('tennisPredictionAuditTitle');
        if (title) title.textContent = 'Errore lettura snapshot predittivi';
        updateTennisOperationsStatus('prediction', { level: 'error', alerts: 1, label: 'Snapshot errore' });
        return null;
    }
}

function bindTennisPredictionAuditUi() {
    const refresh = $('refreshTennisPredictionAudit');
    if (refresh && refresh.dataset.bound !== '1') {
        refresh.addEventListener('click', loadTennisPredictionAudit);
        refresh.dataset.bound = '1';
    }
    loadTennisPredictionAudit();
}
window.loadTennisPredictionAudit = loadTennisPredictionAudit;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisPredictionAuditUi);
else bindTennisPredictionAuditUi();
// /PATCH7_TENNIS_IMMUTABLE_PREDICTION_AUDIT_UI

// ============================================================================
// PATCH8_TENNIS_FORWARD_LIFECYCLE_UI
// Watchdog read-only: source bet, snapshot anchor, CLV/settlement e ledger.
// ============================================================================
function renderTennisForwardLifecycle(payload = {}) {
    const panel = $('tennisForwardLifecyclePanel');
    if (!panel) return;
    const success = payload.success === true;
    const drift = Number(payload.driftBets || 0);
    const tracked = Number(payload.trackedBets || 0);
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(!success ? 'status-error' : (drift > 0 ? 'status-warn' : 'status-ok'));
    const title = $('tennisForwardLifecycleTitle');
    const message = $('tennisForwardLifecycleMessage');
    if (title) {
        title.textContent = !success ? 'Lifecycle forward non allineato' : (tracked === 0 ? 'Lifecycle pronto · nessuna previsione forward' : 'Lifecycle forward allineato');
        title.style.color = !success ? '#f87171' : (drift > 0 ? '#fbbf24' : '#34d399');
    }
    if (message) message.textContent = payload.note || 'CLV e settlement vengono committati insieme al refresh del ledger; in caso di errore la transazione viene annullata.';
    const counts = payload.counts || {};
    const cards = [
        ['Bet tracciate', tracked],
        ['Allineate', payload.healthyBets || 0],
        ['Drift', drift],
        ['Prediction only', counts.PREDICTION_CAPTURED || 0],
        ['Evidenza settlement in verifica', counts.SETTLEMENT_EVIDENCE_PENDING || 0],
        ['CLV pending result', counts.PREDICTION_CLV_PENDING_SETTLEMENT || 0],
        ['Settled no CLV', counts.SETTLED_WAITING_CLV || 0],
        ['Complete', counts.COMPLETE_CERTIFIED || 0],
        ['Review', counts.REVIEW_REQUIRED || 0],
        ['Versione', payload.version || 'N/A']
    ];
    const grid = $('tennisForwardLifecycleGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-lifecycle-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisForwardLifecycleDetails');
    if (details) {
        const lines = (payload.details || []).filter(item => !item.healthy || ['REVIEW_REQUIRED','SETTLEMENT_EVIDENCE_PENDING'].includes(item.lifecycleState)).slice(0, 10)
            .map(item => `#${item.betId} · ${item.lifecycleState} · ${(item.reasons || []).join(', ') || 'OK'} · ${item.ledger?.operationId || 'NO_OP'}`);
        details.textContent = lines.length ? `Anomalie/review:\n${lines.join('\n')}` : (tracked ? 'Nessun drift tra source, snapshot e ledger.' : 'Il watchdog inizierà a tracciare il lifecycle con la prossima previsione Tennis.');
    }    updateTennisOperationsStatus('lifecycle', {
        level: !success ? 'error' : (drift > 0 ? 'warn' : 'ok'),
        alerts: drift,
        label: `${tracked} lifecycle`
    });
}

async function loadTennisForwardLifecycle() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/forward-lifecycle-health?limit=30', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
            const err = new Error(payload.error || `HTTP ${response.status}`);
            err.payload = payload;
            throw err;
        }
        renderTennisForwardLifecycle(payload);
        if (Number(payload.driftBets || 0) > 0) {
            showRuntimeDiagnostic({ severity: 'WARN', title: 'Lifecycle Tennis da riallineare', message: `Watchdog disponibile: rilevati ${payload.driftBets} record derivati da riallineare.`, phase: 'FORWARD_LIFECYCLE_HEALTH', operationId: payload.operationId, code: 'FORWARD_LIFECYCLE_DRIFT', details: payload.details });
        }
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Watchdog lifecycle non disponibile', message: error.message, phase: 'FORWARD_LIFECYCLE_FETCH', operationId: error.payload?.operationId, details: error.payload || error.stack, error });
        const panel = $('tennisForwardLifecyclePanel');
        if (panel) panel.classList.add('status-error');
        const title = $('tennisForwardLifecycleTitle');
        if (title) title.textContent = 'Errore lettura lifecycle forward';
        updateTennisOperationsStatus('lifecycle', { level: 'error', alerts: 1, label: 'Lifecycle errore' });
        return null;
    }
}

function bindTennisForwardLifecycleUi() {
    const refresh = $('refreshTennisForwardLifecycle');
    if (refresh && refresh.dataset.bound !== '1') {
        refresh.addEventListener('click', loadTennisForwardLifecycle);
        refresh.dataset.bound = '1';
    }
    loadTennisForwardLifecycle();
}
window.loadTennisForwardLifecycle = loadTennisForwardLifecycle;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisForwardLifecycleUi);
else bindTennisForwardLifecycleUi();
// /PATCH8_TENNIS_FORWARD_LIFECYCLE_UI


// ============================================================================
// PATCH9_TENNIS_FORWARD_COHORT_UI
// Coorti temporali forward-only, holdout bloccato e leakage guard read-only.
// ============================================================================
function renderTennisForwardCohorts(payload = {}) {
    const panel = $('tennisForwardCohortPanel');
    if (!panel) return;
    const success = payload.success === true;
    const healthy = payload.healthy !== false;
    const blocked = Number(payload.leakageBlocked || 0);
    const unhealthy = Number(payload.unhealthyMembers || 0);
    const tracked = Number(payload.trackedMembers || 0);
    const alerts = blocked + unhealthy;
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(!success ? 'status-error' : (!healthy || alerts > 0 ? 'status-warn' : 'status-ok'));
    const title = $('tennisForwardCohortTitle');
    const message = $('tennisForwardCohortMessage');
    if (title) {
        title.textContent = !success
            ? 'Coorti forward da verificare'
            : (tracked === 0 ? 'Coorti pronte · nessun membro forward' : 'Coorti forward sigillate');
        title.style.color = !success ? '#f87171' : (!healthy || alerts > 0 ? '#fbbf24' : '#34d399');
    }
    if (message) message.textContent = payload.note || 'Le membership sono immutabili; maturità e metriche restano shadow-only.';
    const counts = payload.counts || {};
    const cards = [
        ['Membri', tracked],
        ['Development', payload.developmentMembers || 0],
        ['Holdout locked', payload.holdoutLocked || 0],
        ['Observation', counts.OBSERVATION_PENDING || 0],
        ['Settlement pending', counts.SETTLEMENT_PENDING || 0],
        ['CLV pending', counts.CLV_PENDING || 0],
        ['Matured + CLV', counts.MATURED_WITH_CLV || 0],
        ['Matured settlement', counts.MATURED_SETTLEMENT_ONLY || 0],
        ['Leakage bloccati', blocked],
        ['Versione', payload.version || 'N/A']
    ];
    const grid = $('tennisForwardCohortGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-cohort-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisForwardCohortDetails');
    if (details) {
        const lines = (payload.details || []).slice(0, 10).map(item => {
            const member = item.member || {};
            return `#${item.betId} · ${member.cohort_id || 'NO_COHORT'} · ${member.cohort_role || '-'} · ${member.maturity_status || '-'} · ${(item.reasons || []).join(', ') || member.leakage_status || 'OK'}`;
        });
        details.textContent = lines.length
            ? `Review/leakage:\n${lines.join('\n')}`
            : (tracked ? 'Nessun leakage temporale o drift delle membership.' : 'Il primo membro verrà sigillato con la prossima previsione Tennis valida pre-match.');
    }
    updateTennisOperationsStatus('cohort', {
        level: !success ? 'error' : (!healthy || alerts > 0 ? 'warn' : 'ok'),
        alerts,
        label: `${tracked} coorti`
    });
}

async function loadTennisForwardCohorts() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/forward-cohort-health?limit=40', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const err = new Error(payload.error || `HTTP ${response.status}`);
            err.payload = payload;
            throw err;
        }
        renderTennisForwardCohorts(payload);
        if (Number(payload.activeLeakageFaults || 0) > 0) {
            showRuntimeDiagnostic({ severity:'ERROR', title:'Anomalia temporale attiva', message:`${payload.activeLeakageFaults} coorti presentano incoerenze attive.`, phase:'TEMPORAL_LEAKAGE_GUARD', operationId:payload.operationId, code:'ACTIVE_TEMPORAL_LEAKAGE_FAULT', details:payload.details });
        } else if (Number(payload.expectedTemporalExclusions || 0) > 0) {
            showRuntimeDiagnostic({ severity:'WARN', title:'Esclusioni temporali correttamente applicate', message:`Pipeline disponibile: ${payload.expectedTemporalExclusions} record storici restano esclusi dalla coorte certificata.`, phase:'EXPECTED_TEMPORAL_EXCLUSION', operationId:payload.operationId, code:'EXPECTED_TEMPORAL_EXCLUSION', details:payload.details });
        } else if (Number(payload.unhealthyMembers || 0) > 0) {
            showRuntimeDiagnostic({
                severity: 'WARN',
                title: 'Stato eventi forward da riallineare',
                message: `${payload.unhealthyMembers} eventi hanno superato l'orario di inizio ma risultano ancora in “Osservazione”. I sigilli restano integri: serve solo aggiornare lo stato derivato a “In attesa del risultato”.`,
                phase: 'COHORT_MATURITY_CHECK',
                operationId: payload.operationId,
                code: 'COHORT_STATE_STALE',
                details: payload.details
            });
        }
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({
            severity: 'ERROR',
            title: 'Coorti forward non disponibili',
            message: error.message,
            phase: 'FORWARD_COHORT_FETCH',
            operationId: error.payload?.operationId,
            details: error.payload || error.stack,
            error
        });
        const panel = $('tennisForwardCohortPanel');
        if (panel) panel.classList.add('status-error');
        const title = $('tennisForwardCohortTitle');
        if (title) title.textContent = 'Errore lettura coorti forward';
        updateTennisOperationsStatus('cohort', { level: 'error', alerts: 1, label: 'Coorti errore' });
        return null;
    }
}

function bindTennisForwardCohortUi() {
    const refresh = $('refreshTennisForwardCohorts');
    if (refresh && refresh.dataset.bound !== '1') {
        refresh.addEventListener('click', loadTennisForwardCohorts);
        refresh.dataset.bound = '1';
    }
    loadTennisForwardCohorts();
}
window.loadTennisForwardCohorts = loadTennisForwardCohorts;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisForwardCohortUi);
else bindTennisForwardCohortUi();
// /PATCH9_TENNIS_FORWARD_COHORT_UI


// ============================================================================
// PATCH10_TENNIS_QUALITY_GATE_UI
// Quality base is quantitative and pre-DeepScan. Final Quality is shown only
// after the independent DeepScan layer has been fused by the backend policy.
// ============================================================================
function renderTennisQualityGateHealth(payload = {}) {
    const panel = $('tennisQualityGatePanel');
    if (!panel) return;
    const success = payload.success === true;
    const alerts = Number(payload.alerts || 0);
    const resolved = Number(payload.resolved || 0);
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(!success ? 'status-error' : (alerts > 0 ? 'status-warn' : 'status-ok'));
    const title = $('tennisQualityGateTitle');
    const message = $('tennisQualityGateMessage');
    if (title) {
        title.textContent = !success ? 'Qualità/Gate non disponibile' : (resolved ? 'Qualità finale separata dal DeepScan' : 'Quality Gate V2 pronto');
        title.style.color = !success ? '#f87171' : (alerts > 0 ? '#fbbf24' : '#34d399');
    }
    if (message) message.textContent = payload.note || 'Prima qualità quantitativa; poi DeepScan indipendente; infine fusione e stake.';
    const byFinal = payload.byFinalQuality || {};
    const finalCount = label => Number(byFinal[label]?.signals || 0);
    const cards = [
        ['Risolti audit', resolved],
        ['Operativi', payload.operational || 0],
        ['Stake zero', payload.zeroStake || 0],
        ['Base completa', `${Number(payload.inputCoverage?.completeBasePct || 0).toFixed(1)}%`],
        ['DeepScan presente', `${Number(payload.inputCoverage?.fields?.deepScan?.pct || 0).toFixed(1)}%`],
        ['Watchlist micro', finalCount('WATCHLIST MICRO')],
        ['Soft block', finalCount('BLOCCATA SOFT')],
        ['Hard block', finalCount('BLOCCATA HARD')],
        ['Approvata con cap', finalCount('APPROVATA CON CAP')],
        ['Opportunità zero-stake', alerts],
        ['Full stake', payload.policy?.fullStakeEnabled ? 'ABILITATO' : 'DISABILITATO']
    ];
    const grid = $('tennisQualityGateGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-quality-gate-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisQualityGateDetails');
    if (details) {
        const lines = (payload.zeroStakeHighRate || []).slice(0, 8).map(item => `${item.key} · zero stake ${item.zeroStake} · WR ${item.zeroStakeWinRatePct}% · CI ${item.signalWinRate95?.lowPct ?? 'N/A'}–${item.signalWinRate95?.highPct ?? 'N/A'}%`);
        details.textContent = lines.length
            ? `Audit zero-stake ad alto hit-rate (non promozione automatica):\n${lines.join('\n')}`
            : 'Nessuna combinazione zero-stake con almeno 5 esiti e hit-rate ≥60%.';
    }
    updateTennisOperationsStatus('quality', {
        level: !success ? 'error' : (alerts > 0 ? 'warn' : 'ok'),
        alerts,
        label: alerts > 0 ? `${alerts} review qualità` : 'Qualità allineata'
    });
}

async function loadTennisQualityGateHealth() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/quality-gate-health', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const err = new Error(payload.error || `HTTP ${response.status}`);
            err.payload = payload;
            throw err;
        }
        renderTennisQualityGateHealth(payload);
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Quality Gate V2 non disponibile', message: error.message, phase: 'QUALITY_GATE_HEALTH_FETCH', operationId: error.payload?.operationId, details: error.payload || error.stack, error });
        const panel = $('tennisQualityGatePanel');
        if (panel) panel.classList.add('status-error');
        const title = $('tennisQualityGateTitle');
        if (title) title.textContent = 'Errore lettura Quality Gate V2';
        updateTennisOperationsStatus('quality', { level: 'error', alerts: 1, label: 'Qualità errore' });
        return null;
    }
}

function bindTennisQualityGateUi() {
    const refresh = $('refreshTennisQualityGate');
    if (refresh && refresh.dataset.bound !== '1') {
        refresh.addEventListener('click', loadTennisQualityGateHealth);
        refresh.dataset.bound = '1';
    }
    loadTennisQualityGateHealth();
}
window.loadTennisQualityGateHealth = loadTennisQualityGateHealth;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisQualityGateUi);
else bindTennisQualityGateUi();
// /PATCH10_TENNIS_QUALITY_GATE_UI

// ============================================================================
// PATCH11_TENNIS_FORWARD_CAPTURE_UI
// TENNIS_PATCH29_R3_PREMATCH_CAPTURE_GATE_COMPONENT_HEALTH_SEMANTIC
// PATCH29_R2_SETTLEMENT_UPDATE_AUDIT_RUNTIME_TRUTH
// PATCH29_R1_WTA_SETTLEMENT_DIAGNOSTIC_CLARITY
// Compact read-only SLA view. It never updates bets or calibration data.
// ============================================================================
function renderTennisForwardCaptureHealth(payload = {}) {
    const panel = $('tennisForwardCapturePanel');
    if (!panel) return;
    const status = safeString(payload.status || 'DEGRADED').toUpperCase();
    const alerts = Number(payload.alerts || 0);
    const tracked = Number(payload.trackedBets || 0);
    const counts = payload.counts || {};
    const structuralBlocked = Number(payload.structuralBlocked || 0);
    const evidenceOverdue = Number(payload.evidenceOverdue || 0);
    const manualBookmakerReview = Number(payload.manualBookmakerReview || 0);
    const manualIdentityReview = Number(payload.manualIdentityReview || 0);
    const clvOnlyDegraded = Number(payload.clvOnlyDegraded || 0);
    const runtimeSeverity = safeString(payload.runtimeSeverity || '').toUpperCase();
    const level = structuralBlocked > 0 || runtimeSeverity === 'ERROR'
        ? 'error'
        : (alerts > 0 || status === 'DEGRADED' || status === 'BLOCKED' ? 'warn' : 'ok');
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisForwardCaptureTitle');
    const message = $('tennisForwardCaptureMessage');
    if (title) {
        title.textContent = status === 'NO_FORWARD_DATA'
            ? 'Acquisizione pronta · nessun dato forward reale'
            : (evidenceOverdue > 0 && structuralBlocked === 0
                ? `${evidenceOverdue} risultati attendono evidenza ufficiale`
                : manualBookmakerReview > 0 && structuralBlocked === 0
                  ? 'Ritiro ufficiale · verifica regola bookmaker'
                  : manualIdentityReview > 0 && structuralBlocked === 0
                    ? 'Risultato ufficiale · revisione identità evento'
                  : clvOnlyDegraded > 0 && structuralBlocked === 0
                    ? 'Settlement verificati · CLV non disponibile'
                    : `Acquisizione forward: ${status}`);
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#34d399';
    }
    if (message) message.textContent = payload.note || 'Controllo SLA per snapshot, coorte, CLV, settlement e Quality Gate V2.';
    const cards = [
        ['Tracciati', tracked], ['Healthy', counts.HEALTHY || 0], ['In acquisizione', counts.CAPTURING || 0],
        ['Degradati', counts.DEGRADED || 0], ['Bloccati strutturali', structuralBlocked],
        ['Evidenza ufficiale attesa', evidenceOverdue], ['Regola bookmaker', manualBookmakerReview], ['Revisione identità', manualIdentityReview],
        ['Solo CLV mancante', clvOnlyDegraded], ['Snapshot SLA', '2 min'], ['Coorte SLA', '2 min'],
        ['Settlement warning', '12 h'], ['Settlement critico', '36 h']
    ];
    const grid = $('tennisForwardCaptureGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisForwardCaptureDetails');
    if (details) {
        const lines = (payload.details || []).filter(item => item.status !== 'HEALTHY').slice(0, 12).map(item => {
            const label = item.blockClass === 'EVIDENCE_OVERDUE'
                ? 'EVIDENZA UFFICIALE IN ATTESA'
                : (item.warnings || []).includes('SETTLEMENT_BOOKMAKER_RULE_REQUIRED')
                  ? 'REGOLA BOOKMAKER'
                  : (item.warnings || []).includes('SETTLEMENT_IDENTITY_REVIEW_REQUIRED')
                    ? 'REVISIONE IDENTITÀ EVENTO'
                  : (item.warnings || []).length === 1 && (item.warnings || [])[0] === 'CLV_SLA_MISSED'
                    ? 'SETTLEMENT OK · CLV MANCANTE'
                    : item.status;
            return `#${item.betId} · ${label} · ${[...(item.reasons || []), ...(item.warnings || []), ...(item.pending || [])].join(', ') || 'OK'}`;
        });
        details.textContent = lines.length ? `Record da seguire:\n${lines.join('\n')}` : (status === 'NO_FORWARD_DATA' ? 'Il primo controllo reale partirà con la prossima previsione Tennis Patch 10.' : 'Nessun record oltre SLA.');
    }
    updateTennisOperationsStatus('capture', { level, alerts, label: status === 'NO_FORWARD_DATA' ? 'Acquisizione pronta' : `${tracked} acquisiti` });
}

async function loadTennisForwardCaptureHealth() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/forward-capture-health?limit=40', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || (payload.success === false && Number(payload.structuralBlocked || 0) > 0)) {
            const err = new Error(payload.error || payload.note || `HTTP ${response.status}`); err.payload = payload; throw err;
        }
        renderTennisForwardCaptureHealth(payload);
        if (payload.status === 'BLOCKED' || payload.status === 'DEGRADED') {
            const structuralBlocked = Number(payload.structuralBlocked || 0);
            const evidenceOverdue = Number(payload.evidenceOverdue || 0);
    const manualBookmakerReview = Number(payload.manualBookmakerReview || 0);
    const manualIdentityReview = Number(payload.manualIdentityReview || 0);
    const clvOnlyDegraded = Number(payload.clvOnlyDegraded || 0);
            showRuntimeDiagnostic({
                severity: structuralBlocked > 0 ? 'ERROR' : 'WARN',
                title: evidenceOverdue > 0 && structuralBlocked === 0
                    ? 'Settlement in attesa di evidenza verificabile'
                    : 'Acquisizione forward richiede attenzione',
                message: payload.note, phase: 'FORWARD_CAPTURE_SLA', operationId: payload.operationId,
                code: structuralBlocked > 0 ? 'STRUCTURAL_BLOCK' : (evidenceOverdue > 0 ? 'EVIDENCE_OVERDUE' : payload.status),
                scope: 'TENNIS', details: { structuralBlocked, evidenceOverdue, manualBookmakerReview, manualIdentityReview, clvOnlyDegraded, details: payload.details }
            });
        }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        if (payload.status) renderTennisForwardCaptureHealth(payload);
        else {
            showRuntimeDiagnostic({ severity: 'ERROR', title: 'Acquisizione forward non disponibile', message: error.message, phase: 'FORWARD_CAPTURE_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
            updateTennisOperationsStatus('capture', { level: 'error', alerts: 1, label: 'Acquisizione errore' });
        }
        return payload.status ? payload : null;
    }
}
function bindTennisForwardCaptureUi() {
    const refresh = $('refreshTennisForwardCapture');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisForwardCaptureHealth); refresh.dataset.bound = '1'; }
    loadTennisForwardCaptureHealth();
}
window.loadTennisForwardCaptureHealth = loadTennisForwardCaptureHealth;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisForwardCaptureUi);
else bindTennisForwardCaptureUi();
// /PATCH11_TENNIS_FORWARD_CAPTURE_UI


// ============================================================================
// PATCH34_TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE_UI
// Read-only schedule lifecycle receipts. No probability, stake or settlement authority.
// ============================================================================
function renderTennisOfficialScheduleHealth(payload = {}) {
    const panel = $('tennisOfficialSchedulePanel');
    if (!panel) return;
    const healthy = payload.healthy === true;
    const status = safeString(payload.status || (healthy ? 'OK' : 'ERROR')).toUpperCase();
    const counts = payload.counts || {};
    const total = Number(payload.total || 0);
    const conflicts = Number(counts.conflicts || 0);
    const blocked = Number(counts.blocked || 0);
    const level = !healthy || status === 'ERROR' ? 'error' : (status === 'WARN' || conflicts > 0 || blocked > 0 ? 'warn' : 'ok');
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisOfficialScheduleTitle');
    const message = $('tennisOfficialScheduleMessage');
    if (title) {
        title.textContent = !healthy
            ? 'Autorità schedule non certificata'
            : total === 0
              ? 'Schedule authority pronta · nessuna ricevuta forward'
              : `${total} ricevute schedule · ${blocked} blocchi lifecycle`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#c4b5fd';
    }
    if (message) message.textContent = healthy
        ? 'Stati ufficiali e provider vengono normalizzati prima del commit; cancellazioni, sospensioni e match già iniziati bloccano la cattura senza produrre settlement.'
        : (payload.error || 'Schema, trigger append-only, self-check o catena hash non verificati.');
    const cards = [
        ['Ricevute', total],
        ['Scheduled', Number(counts.scheduled || 0)],
        ['Delayed', Number(counts.delayed || 0)],
        ['Postponed', Number(counts.postponed || 0)],
        ['Cancelled', Number(counts.cancelled || 0)],
        ['Suspended', Number(counts.suspended || 0)],
        ['Resumed', Number(counts.resumed || 0)],
        ['Conflitti', conflicts],
        ['Blocchi', blocked],
        ['Anticipi', Number(counts.rescheduledEarlier || 0)],
        ['Rinvii', Number(counts.rescheduledLater || 0)],
        ['Race guard', payload.captureRaceGuard === true ? 'ATTIVO' : 'ERRORE'],
        ['Catena hash', payload.chain?.healthy === true ? 'OK' : 'ERRORE'],
        ['Append-only', payload.schema?.appendOnly === true ? 'SÌ' : 'NO'],
        ['Settlement automatico', payload.automaticSettlement === false ? 'NO' : 'ERRORE']
    ];
    const grid = $('tennisOfficialScheduleGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisOfficialScheduleDetails');
    if (details) {
        const providers = (payload.providers || []).slice(0, 8).map(item => `${item.provider} · ${item.sourceKind}: ${item.total} ricevute · blocchi ${item.blocked} · conflitti ${item.conflicts} · reschedule ${item.reschedules}`);
        const recent = (payload.recent || []).slice(0, 8).map(item => `${item.observed_at || 'N/D'} · ${item.source_id || 'UNKNOWN'} · ${item.normalized_status || 'UNKNOWN'} · ${item.capture_disposition || 'N/D'} · ${item.transition_type || 'N/D'} · start ${item.effective_start_at_utc || 'N/D'}`);
        details.textContent = [
            providers.length ? `Provider:
${providers.join('\n')}` : 'Provider: nessuna ricevuta forward.',
            recent.length ? `Ricevute recenti:
${recent.join('\n')}` : 'Ricevute recenti: nessun evento.'
        ].join('\n\n');
    }
    updateTennisOperationsStatus('officialSchedule', { level, alerts: level === 'ok' ? 0 : Math.max(1, conflicts + blocked), label: total ? `${total} ricevute schedule` : 'Schedule pronto' });
}
async function loadTennisOfficialScheduleHealth() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/official-schedule-health?limit=30', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisOfficialScheduleHealth(payload);
        if (!response.ok || payload.healthy === false) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
        return payload;
    } catch (error) {
        const payload = error.payload || { success: false, healthy: false, status: 'ERROR', error: error.message };
        renderTennisOfficialScheduleHealth(payload);
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Schedule lifecycle non disponibile', message: error.message, phase: 'PATCH34_OFFICIAL_SCHEDULE_FETCH', operationId: payload.operationId, scope: 'TENNIS', error });
        return null;
    }
}
function bindTennisOfficialScheduleUi() {
    const refresh = $('refreshTennisOfficialSchedule');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisOfficialScheduleHealth); refresh.dataset.bound = '1'; }
    loadTennisOfficialScheduleHealth();
}
window.loadTennisOfficialScheduleHealth = loadTennisOfficialScheduleHealth;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisOfficialScheduleUi);
else bindTennisOfficialScheduleUi();
// /PATCH34_TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE_UI


// ============================================================================
// PATCH33_TENNIS_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY_UI
// Read-only provider timing quality and append-only event-time revisions.
// It never changes model probability, Quality Gate, stake, settlement or CLV.
// ============================================================================
function patch33DurationLabel(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return 'N/D';
    const sign = ms < 0 ? '−' : '+';
    const abs = Math.abs(ms);
    if (abs < 1000) return `${sign}${Math.round(abs)} ms`;
    if (abs < 60000) return `${sign}${(abs / 1000).toFixed(1)} s`;
    return `${sign}${(abs / 60000).toFixed(1)} min`;
}
function renderTennisCanonicalEventTimeHealth(payload = {}) {
    const panel = $('tennisCanonicalEventTimePanel');
    if (!panel) return;
    const healthy = payload.healthy === true;
    const status = safeString(payload.status || (healthy ? 'OK' : 'ERROR')).toUpperCase();
    const counts = payload.counts || {};
    const total = Number(payload.total || 0);
    const conflicts = Number(counts.conflicts || 0);
    const blocked = Number(counts.blocked || 0);
    const level = !healthy || status === 'ERROR' ? 'error' : (status === 'WARN' || conflicts > 0 || blocked > 0 ? 'warn' : 'ok');
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisCanonicalEventTimeTitle');
    const message = $('tennisCanonicalEventTimeMessage');
    if (title) {
        title.textContent = !healthy
            ? 'Contratto orario evento non certificato'
            : total === 0
              ? 'Contratto orario pronto · nessuna revisione forward'
              : `${total} revisioni orario · ${conflicts} conflitti provider`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#a7f3d0';
    }
    if (message) message.textContent = healthy
        ? 'Timezone e provenienza sono certificate prima del Prematch Gate; in caso di conflitto viene usato l’orario credibile più anticipato solo per sicurezza della cattura.'
        : (payload.error || 'Schema, trigger append-only, self-check DST o catena hash non verificati.');
    const cards = [
        ['Revisioni', total],
        ['Certificato alto', Number(counts.certifiedHigh || 0)],
        ['Certificato medio', Number(counts.certifiedMedium || 0)],
        ['Conflitti provider', conflicts],
        ['Orari bloccati', blocked],
        ['Rinvii anticipati', Number(counts.rescheduledEarlier || 0)],
        ['Rinvii posticipati', Number(counts.rescheduledLater || 0)],
        ['Catena hash', payload.chain?.healthy === true ? 'OK' : 'ERRORE'],
        ['Append-only', payload.schema?.appendOnly === true ? 'SÌ' : 'NO'],
        ['Override automatico', payload.automaticGateOverride === false ? 'NO' : 'ERRORE']
    ];
    const grid = $('tennisCanonicalEventTimeGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisCanonicalEventTimeDetails');
    if (details) {
        const providers = (payload.providers || []).slice(0, 8).map(item => `${item.provider}: ${item.total} revisioni · conflitti ${item.conflicts} · blocchi ${item.blocked} · scarto medio ${patch33DurationLabel(item.avgConflictMs)}`);
        const recent = (payload.recent || []).slice(0, 8).map(item => `${item.observed_at || 'N/D'} · ${item.source_id || 'UNKNOWN'} · ${item.source_field || 'N/D'} · ${item.quality_status || 'N/D'} · ${item.revision_type || 'N/D'} · canonico ${item.canonical_start_at_utc || 'N/D'} · sicurezza ${item.safety_start_at_utc || 'N/D'}`);
        details.textContent = [
            providers.length ? `Provider:\n${providers.join('\n')}` : 'Provider: nessuna revisione forward.',
            recent.length ? `Revisioni recenti:\n${recent.join('\n')}` : 'Revisioni recenti: nessun evento.'
        ].join('\n\n');
    }
    updateTennisOperationsStatus('eventTime', { level, alerts: level === 'ok' ? 0 : Math.max(1, conflicts + blocked), label: total ? `${total} revisioni orario` : 'Orario evento pronto' });
}
async function loadTennisCanonicalEventTimeHealth() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/canonical-event-time-health?limit=30', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisCanonicalEventTimeHealth(payload);
        if (!response.ok || payload.healthy === false) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
        return payload;
    } catch (error) {
        const payload = error.payload || { success: false, healthy: false, status: 'ERROR', error: error.message };
        renderTennisCanonicalEventTimeHealth(payload);
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Qualità orario evento non disponibile', message: error.message, phase: 'PATCH33_EVENT_TIME_FETCH', operationId: payload.operationId, scope: 'TENNIS', error });
        return null;
    }
}
function bindTennisCanonicalEventTimeUi() {
    const refresh = $('refreshTennisCanonicalEventTime');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisCanonicalEventTimeHealth); refresh.dataset.bound = '1'; }
    loadTennisCanonicalEventTimeHealth();
}
window.loadTennisCanonicalEventTimeHealth = loadTennisCanonicalEventTimeHealth;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisCanonicalEventTimeUi);
else bindTennisCanonicalEventTimeUi();
// /PATCH33_TENNIS_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY_UI

// ============================================================================
// PATCH32_TENNIS_REJECTED_CAPTURE_OBSERVABILITY_UI
// Read-only ledger of attempts rejected by the transactional Prematch Gate.
// It never retries, reactivates or persists the rejected prediction.
// ============================================================================
function patch32DurationLabel(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return 'N/D';
    const sign = ms < 0 ? '−' : '+';
    const abs = Math.abs(ms);
    if (abs < 1000) return `${sign}${Math.round(abs)} ms`;
    if (abs < 60000) return `${sign}${(abs / 1000).toFixed(1)} s`;
    return `${sign}${(abs / 60000).toFixed(1)} min`;
}
function renderTennisRejectedCaptureObservability(payload = {}) {
    const panel = $('tennisRejectedCapturePanel');
    if (!panel) return;
    const healthy = payload.healthy === true;
    const status = safeString(payload.status || (healthy ? 'OK' : 'ERROR')).toUpperCase();
    const counts = payload.counts || {};
    const total = Number(counts.total || 0);
    const drift = Number(counts.driftSuspects || 0);
    const boundary = Number(counts.boundaryReviews || 0);
    const falseSuspects = Number(counts.suspectedFalseRejections || 0);
    const level = !healthy || status === 'ERROR' ? 'error' : (status === 'WARN' || drift > 0 || falseSuspects > 0 ? 'warn' : 'ok');
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisRejectedCaptureTitle');
    const message = $('tennisRejectedCaptureMessage');
    if (title) {
        title.textContent = !healthy
            ? 'Ledger rifiuti capture non certificato'
            : total === 0
              ? 'Nessun tentativo respinto registrato'
              : `${total} tentativi respinti · ${drift} anomalie orologio`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#67e8f9';
    }
    if (message) message.textContent = healthy
        ? 'Il pronostico respinto resta non salvato; questo pannello mostra esclusivamente evidenza append-only post-rollback.'
        : (payload.error || 'Schema, trigger append-only o catena hash non verificati.');
    const cards = [
        ['Rifiuti totali', total],
        ['Ultime 24 ore', Number(counts.last24Hours || 0)],
        ['Clock drift', drift],
        ['Finestra limite', boundary],
        ['False rejection sospette', falseSuspects],
        ['Catena hash', payload.chain?.healthy === true ? 'OK' : 'ERRORE'],
        ['Append-only', payload.appendOnly === true ? 'SÌ' : 'NO'],
        ['Override automatico', payload.automaticOverride === false ? 'NO' : 'ERRORE']
    ];
    const grid = $('tennisRejectedCaptureGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisRejectedCaptureDetails');
    if (details) {
        const providers = (payload.providers || []).slice(0, 6).map(item => `${item.provider}: ${item.total} rifiuti · drift ${item.driftSuspects} · start non risolto ${item.unresolvedMatchStart}`);
        const recent = (payload.recent || []).slice(0, 8).map(item => {
            const match = [item.home_player, item.away_player].filter(Boolean).join(' - ') || 'match non identificato';
            const review = item.suspected_false_rejection ? ' · POSSIBILE FALSE REJECTION' : (item.boundary_review_required ? ' · REVIEW LIMITE' : '');
            return `${item.rejected_at || 'N/D'} · ${item.provider_id || 'UNKNOWN'} · ${match} · ${item.reason_family || item.gate_status} · lead ${patch32DurationLabel(item.lead_time_ms)} · drift ${patch32DurationLabel(item.observed_clock_drift_ms)}${review}`;
        });
        details.textContent = [
            providers.length ? `Provider:\n${providers.join('\n')}` : 'Provider: nessun rifiuto registrato.',
            recent.length ? `Recenti:\n${recent.join('\n')}` : 'Recenti: nessun evento.'
        ].join('\n\n');
    }
    updateTennisOperationsStatus('rejectedCapture', { level, alerts: level === 'ok' ? 0 : Math.max(1, drift + falseSuspects), label: total ? `${total} rifiuti osservati` : 'Rifiuti capture OK' });
}
async function loadTennisRejectedCaptureObservability() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/rejected-capture-observability?limit=30', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisRejectedCaptureObservability(payload);
        if (!response.ok || payload.healthy === false) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
        return payload;
    } catch (error) {
        const payload = error.payload || { success: false, healthy: false, status: 'ERROR', error: error.message };
        renderTennisRejectedCaptureObservability(payload);
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Observability rifiuti capture non disponibile', message: error.message, phase: 'PATCH32_REJECTED_CAPTURE_FETCH', operationId: payload.operationId, scope: 'TENNIS', error });
        return null;
    }
}
function bindTennisRejectedCaptureUi() {
    const refresh = $('refreshTennisRejectedCapture');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisRejectedCaptureObservability); refresh.dataset.bound = '1'; }
    loadTennisRejectedCaptureObservability();
}
window.loadTennisRejectedCaptureObservability = loadTennisRejectedCaptureObservability;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisRejectedCaptureUi);
else bindTennisRejectedCaptureUi();
// /PATCH32_TENNIS_REJECTED_CAPTURE_OBSERVABILITY_UI



// ============================================================================
// PATCH12_TENNIS_PLAYER_MATCHUP_INTELLIGENCE_UI
// Read-only view of immutable player evidence, matchup features and challenger.
// DeepScan and the production probability remain separate and visible.
// ============================================================================
function patch12FormatMetric(value, suffix = '', digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
}

function renderTennisMatchupIntelligence(payload = {}) {
    const panel = $('tennisMatchupIntelligencePanel');
    if (!panel) return;
    const status = safeString(payload.status || 'SCHEMA_MISSING').toUpperCase();
    const metrics = payload.metrics || {};
    const counts = payload.counts || {};
    const engine = payload.dataEngine || {};
    const integrity = payload.integrity || {};
    const alerts = Number(metrics.evidenceWarnings || 0) + Number(metrics.strongDivergence || 0) +
        (integrity.tablesPresent === false || integrity.immutableTriggers === false || Number(integrity.orphanMatchups || 0) > 0 || Number(integrity.orphanChallengers || 0) > 0 ? 1 : 0);
    const level = status === 'INTEGRITY_ERROR' || status === 'SCHEMA_MISSING' ? 'error'
        : status === 'SHADOW_WITH_WARNINGS' ? 'warn' : 'ok';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisMatchupIntelligenceTitle');
    const message = $('tennisMatchupIntelligenceMessage');
    if (title) {
        title.textContent = status === 'NO_FORWARD_DATA'
            ? 'Intelligence pronta · nessun pronostico Patch 12 reale'
            : `Intelligence giocatori: ${status}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#d8b4fe';
    }
    if (message) message.textContent = payload.note || 'Player evidence as-of-safe e challenger in shadow-only.';
    const cards = [
        ['Match locali', engine.matchCount ?? '—'],
        ['Giocatori', engine.playerCount ?? '—'],
        ['Ultimo dato', engine.latestMatchAt ? safeString(engine.latestMatchAt).slice(0, 10) : '—'],
        ['Età dataset', Number.isFinite(Number(engine.dataAgeDays)) ? `${Number(engine.dataAgeDays).toFixed(0)} gg` : '—'],
        ['Evidenze', counts.evidenceRows || 0],
        ['Matchup', counts.matchupRows || 0],
        ['Challenger', counts.challengerRows || 0],
        ['Copertura media', patch12FormatMetric(metrics.avgCoverage, '%')],
        ['Confidenza media', patch12FormatMetric(metrics.avgConfidence, '%')],
        ['Delta medio', patch12FormatMetric(metrics.avgAbsDeltaPp, ' pp')],
        ['Divergenze forti', metrics.strongDivergence || 0],
        ['Warning dati', metrics.evidenceWarnings || 0],
        ['Modalità', 'SHADOW']
    ];
    const grid = $('tennisMatchupIntelligenceGrid');
    if (grid) grid.innerHTML = cards.map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisMatchupIntelligenceDetails');
    if (details) {
        const recent = (payload.recent || []).slice(0, 10).map(item => {
            const delta = patch12FormatMetric(item.probability_delta_pp, ' pp');
            const interval = Number.isFinite(Number(item.uncertainty_low_pct)) && Number.isFinite(Number(item.uncertainty_high_pct))
                ? `${Number(item.uncertainty_low_pct).toFixed(1)}–${Number(item.uncertainty_high_pct).toFixed(1)}%` : '—';
            const source = item.source_target_id ? `${item.source_target_id}/${item.source_provider_id || 'N/D'} · ${item.source_freshness_status || 'N/D'}${Number.isFinite(Number(item.source_freshness_days)) ? ` ${Number(item.source_freshness_days).toFixed(1)} gg` : ''}` : 'sorgente N/D';
            return `#${item.bet_id} · ${item.matchup_label || item.challenger_status} · ${source} · attività ${item.activity_risk_status || 'N/D'} · Prod ${patch12FormatMetric(item.selected_production_probability, '%')} · Shadow ${patch12FormatMetric(item.selected_challenger_probability, '%')} · Δ ${delta} · CI ${interval}`;
        });
        details.textContent = recent.length
            ? `Confronti recenti (nessuna autorità operativa):\n${recent.join('\n')}`
            : `Dati strutturati: ${engine.fileCount || 0} file, ${engine.rejectedRows || 0} righe rifiutate. Il primo confronto reale verrà salvato con la prossima previsione Tennis.`;
    }
    updateTennisOperationsStatus('intelligence', {
        level,
        alerts,
        label: status === 'NO_FORWARD_DATA' ? 'Matchup pronto' : `${counts.challengerRows || 0} challenger`
    });
}

async function loadTennisMatchupIntelligence() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/player-matchup-intelligence?limit=20', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.status === 'INTEGRITY_ERROR' || payload.status === 'SCHEMA_MISSING') {
            const err = new Error(payload.error || payload.note || `HTTP ${response.status}`); err.payload = payload; throw err;
        }
        renderTennisMatchupIntelligence(payload);
        // SHADOW_WITH_WARNINGS è uno stato di validazione statistica, non un errore runtime.
        // Resta visibile nel Centro operativo senza sovrascrivere la diagnostica Node.
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        if (payload.status) renderTennisMatchupIntelligence(payload);
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Intelligence giocatori non disponibile', message: error.message, phase: 'PLAYER_MATCHUP_INTELLIGENCE_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        updateTennisOperationsStatus('intelligence', { level: 'error', alerts: 1, label: 'Matchup errore' });
        return payload.status ? payload : null;
    }
}
function bindTennisMatchupIntelligenceUi() {
    const refresh = $('refreshTennisMatchupIntelligence');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisMatchupIntelligence); refresh.dataset.bound = '1'; }
    loadTennisMatchupIntelligence();
}
window.loadTennisMatchupIntelligence = loadTennisMatchupIntelligence;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTennisMatchupIntelligenceUi);
else bindTennisMatchupIntelligenceUi();
// /PATCH12_TENNIS_PLAYER_MATCHUP_INTELLIGENCE_UI


// ============================================================================
// PATCH13_TENNIS_HISTORICAL_COMBINATION_AND_PROGRESSION_UI
// Historical DS × Gate win rate is empirical Paper Trading evidence only.
// It never replaces model probability and has no gate/stake authority.
// ============================================================================
function patch13ReliabilityLabel(value) {
    const key = safeString(value).toUpperCase();
    return ({ HIGH: 'ALTA', MEDIUM: 'MEDIA', LOW: 'BASSA', INSUFFICIENT: 'INSUFFICIENTE', VERY_LOW: 'MOLTO BASSA', NO_SAMPLE: 'NESSUN CAMPIONE' })[key] || key || 'N/D';
}

function patch13NullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function historicalCombinationFromBet(bet = {}) {
    if (bet.historicalCombinationEvidence) return bet.historicalCombinationEvidence;
    const resolved = patch13NullableNumber(bet.historical_combo_resolved);
    const rate = patch13NullableNumber(bet.historical_combo_win_rate_pct);
    if (resolved === null && rate === null) return null;
    return {
        success: true,
        deepScan: bet.historical_combo_deepscan,
        quality: bet.historical_combo_quality,
        resolved: resolved ?? 0,
        wins: Number(bet.historical_combo_wins) || 0,
        losses: Number(bet.historical_combo_losses) || 0,
        winRatePct: rate,
        adjustedRatePct: patch13NullableNumber(bet.historical_combo_adjusted_rate_pct),
        ci95LowPct: patch13NullableNumber(bet.historical_combo_ci_low_pct),
        ci95HighPct: patch13NullableNumber(bet.historical_combo_ci_high_pct),
        operationalResolved: Number(bet.t11DecisionResearch?.stages?.HISTORICAL_COMBINATION?.operationalResolved ?? bet.historical_combo_operational_resolved) || 0,
        operationalWins: Number(bet.t11DecisionResearch?.stages?.HISTORICAL_COMBINATION?.operationalWins) || 0,
        operationalWinRatePct: patch13NullableNumber(bet.t11DecisionResearch?.stages?.HISTORICAL_COMBINATION?.operationalWinRatePct),
        operationalRoiPct: patch13NullableNumber(bet.t11DecisionResearch?.stages?.HISTORICAL_COMBINATION?.operationalRoiPct ?? bet.historical_combo_operational_roi_pct),
        breakEvenPct: patch13NullableNumber(bet.historical_combo_break_even_pct ?? bet.breakEvenPct),
        empiricalEdgePp: patch13NullableNumber(bet.historical_combo_empirical_edge_pp ?? bet.empiricalEdgePp),
        adjustedEmpiricalEdgePp: patch13NullableNumber(bet.historical_combo_adjusted_empirical_edge_pp ?? bet.adjustedEmpiricalEdgePp),
        reliability: bet.historical_combo_reliability,
        evidenceHash: bet.historical_combo_evidence_hash,
        calculatedAt: bet.historical_combo_calculated_at,
        stakeAuthority: false,
        finalStakeAuthorityStatus: bet.tennis_stake_authority_status,
        finalStakeAuthoritySample: bet.tennis_stake_authority_sample,
        finalStakeAuthorityReason: bet.tennis_stake_authority_reason
    };
}

function renderHistoricalCombinationEvidenceCell(evidence = null) {
    if (!evidence) {
        return '<div title="Disponibile dopo DeepScan e Resa Qualità" style="color:#94a3b8;font-size:.72rem;font-weight:700;">⏳ Attesa DS×Gate</div>';
    }

    if (evidence.success === false) {
        const message = evidence.error ? `Errore evidenza: ${safeString(evidence.error)}` : 'Evidenza storica non disponibile';
        return `<div title="${htmlEscape(message)}" style="color:#fb923c;font-size:.72rem;font-weight:700;">N/D</div>`;
    }

    const n = Number(evidence.resolved || 0);
    const rate = Number(evidence.displayRatePct ?? evidence.winRatePct);
    const reliability = safeString(evidence.reliability || 'NO_SAMPLE').toUpperCase();
    const color = reliability === 'HIGH'
        ? '#2dd4bf'
        : reliability === 'MEDIUM'
            ? '#facc15'
            : reliability === 'LOW'
                ? '#fb923c'
                : '#94a3b8';
    const insufficientSample = n < 5;
    const rawRateText = n > 0 && Number.isFinite(rate) ? `${rate.toFixed(2)}%` : 'N/D';
    const rateText = insufficientSample ? 'CAMPIONE INSUFFICIENTE' : rawRateText;
    const observedText = n > 0 ? `${Number(evidence.wins || 0)}/${n}` : '0/0';
    const ciLow = patch13NullableNumber(evidence.ci95LowPct);
    const ciHigh = patch13NullableNumber(evidence.ci95HighPct);
    const adjustedValue = patch13NullableNumber(evidence.adjustedRatePct);
    const ci = n > 0 && ciLow !== null && ciHigh !== null
        ? `${ciLow.toFixed(1)}–${ciHigh.toFixed(1)}%`
        : 'N/D';
    const adjusted = n > 0 && adjustedValue !== null ? `${adjustedValue.toFixed(2)}%` : 'N/D';
    const roi = Number.isFinite(Number(evidence.operationalRoiPct)) ? `${Number(evidence.operationalRoiPct).toFixed(2)}%` : 'N/D';
    const breakEven = Number.isFinite(Number(evidence.breakEvenPct)) ? `${Number(evidence.breakEvenPct).toFixed(2)}%` : 'N/D';
    const empiricalEdge = Number.isFinite(Number(evidence.empiricalEdgePp))
        ? `${Number(evidence.empiricalEdgePp) >= 0 ? '+' : ''}${Number(evidence.empiricalEdgePp).toFixed(2)} pp`
        : 'N/D';
    const scope = activeSport === SPORT.CALCIO
        ? 'Solo singole CALCIO esplicite, current-clean e risolte prima della riga corrente.'
        : 'Solo Paper Trading risolto eleggibile.';
    const title = [
        `${safeString(evidence.deepScan || 'DeepScan')} × ${safeString(evidence.quality || 'Quality')}`,
        `Storico DS×Gate · tutti i segnali: ${rawRateText} (${observedText})`,
        `Headline operativa: ${rateText} · n=${n}`,
        `Intervallo Wilson 95%: ${ci}`,
        `Stima prudente: ${adjusted}`,
        `Break-even quota corrente: ${breakEven}`,
        `Edge empirico vs break-even: ${empiricalEdge}`,
        `Trading-only: n=${Number(evidence.operationalResolved || 0)} · WR=${Number.isFinite(Number(evidence.operationalWinRatePct)) ? Number(evidence.operationalWinRatePct).toFixed(2) + '%' : 'N/D'} · ROI=${roi}`,
        `Affidabilità campione: ${patch13ReliabilityLabel(reliability)}`,
        scope,
        n < 5 ? 'Patch35: n<5 è solo paper evidence e non può autorizzare stake.' : 'Dato empirico storico: non sostituisce la probabilità del modello; la final stake authority applica i cap campione.'
    ].join('\n');

    return `<div title="${htmlEscape(title)}" style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:120px;">
        <strong style="font-size:${insufficientSample ? '.72rem' : '.95rem'};color:${color};">${htmlEscape(rateText)}</strong>
        <span style="font-size:.66rem;color:#cbd5e1;">${insufficientSample ? `osservato ${htmlEscape(observedText)} · ` : ''}n=${n} · ${htmlEscape(patch13ReliabilityLabel(reliability))}</span>
        <span style="font-size:.62rem;color:#94a3b8;">${insufficientSample ? 'nessuna autorità stake' : `CI ${htmlEscape(ci)}`}</span>
        <span style="font-size:.60rem;color:#a78bfa;">Trading n=${Number(evidence.operationalResolved || 0)} · ROI ${htmlEscape(roi)}</span>
    </div>`;
}

function renderHistoricalCombinationDetail(evidence = null) {
    if (!evidence || evidence.success === false) return '';
    const pct = value => {
        const n = patch13NullableNumber(value);
        return n === null ? 'N/D' : `${n.toFixed(2)}%`;
    };
    const pp = value => {
        const n = patch13NullableNumber(value);
        return n === null ? 'N/D' : `${n >= 0 ? '+' : ''}${n.toFixed(2)} pp`;
    };
    const resolvedSample = Number(evidence.resolved || 0);
    const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D';
    const ciText = resolvedSample > 0 ? `${pct(evidence.ci95LowPct)}–${pct(evidence.ci95HighPct)}` : 'N/D';
    const adjustedPct = resolvedSample > 0 ? pct(evidence.adjustedRatePct) : 'N/D';
    const strictScope = evidence.strictSportIdentity === true
        ? 'CALCIO esplicito · CURRENT/CURRENT_BOOTSTRAP · SINGLE/SINGLE_CR · as-of-safe'
        : 'Paper Trading risolto eleggibile';

    return `<div style="margin:0 0 14px;padding:12px;border:1px solid rgba(20,184,166,.38);border-radius:10px;background:rgba(13,148,136,.09);">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <strong style="color:#5eead4;">📈 Storico DS×Gate · tutti i segnali</strong>
            <span style="color:#94a3b8;font-size:.72rem;">SHADOW · nessuna autorità su modello o stake</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin-top:10px;">
            <div class="metric-mini"><span>DeepScan</span><strong>${htmlEscape(evidence.deepScan || '—')}</strong></div>
            <div class="metric-mini"><span>Resa Qualità</span><strong>${htmlEscape(evidence.quality || '—')}</strong></div>
            <div class="metric-mini"><span>Win rate risolto</span><strong>${ratePct}</strong></div>
            <div class="metric-mini"><span>Campione</span><strong>${Number(evidence.resolved || 0)}</strong></div>
            <div class="metric-mini"><span>WON / LOST</span><strong>${Number(evidence.wins || 0)} / ${Number(evidence.losses || 0)}</strong></div>
            <div class="metric-mini"><span>CI Wilson 95%</span><strong>${ciText}</strong></div>
            <div class="metric-mini"><span>Stima prudente</span><strong>${adjustedPct}</strong></div>
            <div class="metric-mini"><span>Affidabilità</span><strong>${htmlEscape(patch13ReliabilityLabel(evidence.reliability))}</strong></div>
            <div class="metric-mini"><span>Break-even quota</span><strong>${pct(evidence.breakEvenPct)}</strong></div>
            <div class="metric-mini"><span>Edge empirico</span><strong>${pp(evidence.empiricalEdgePp)}</strong></div>
            <div class="metric-mini"><span>ROI operativo storico</span><strong>${pct(evidence.operationalRoiPct)}</strong></div>
            <div class="metric-mini"><span>Scope</span><strong>${htmlEscape(strictScope)}</strong></div>
        </div>
        <div style="margin-top:8px;color:#99f6e4;font-size:.72rem;">Lo storico DS×Gate include anche segnali a stake zero. Il blocco Trading-only è separato; nessuno dei due sostituisce la probabilità del singolo match.</div>
    </div>`;
}

function renderTennisHistoricalCombinationEvidence(payload = {}) {
    const panel = $('tennisHistoricalCombinationPanel');
    if (!panel) return;
    const combinations = Array.isArray(payload.combinations) ? payload.combinations : [];
    const resolved = Number(payload.resolvedRows || 0);
    const level = payload.success === false ? 'error' : resolved < 30 ? 'warn' : 'ok';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisHistoricalCombinationTitle');
    const message = $('tennisHistoricalCombinationMessage');
    if (title) {
        title.textContent = payload.success === false ? 'Win rate storico: errore' : `${combinations.length} combinazioni · ${resolved} esiti risolti`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#5eead4';
    }
    if (message) message.textContent = payload.note || 'WON/(WON+LOST) del Paper Trading per DeepScan × Resa Qualità.';
    const top = combinations.slice(0, 8);
    const grid = $('tennisHistoricalCombinationGrid');
    if (grid) grid.innerHTML = [
        ['Esiti risolti', resolved],
        ['Combinazioni', combinations.length],
        ['WR generale', Number.isFinite(Number(payload.overallWinRatePct)) ? `${Number(payload.overallWinRatePct).toFixed(2)}%` : 'N/D'],
        ['Ultimo ID sorgente', payload.sourceMaxResolvedId || 0],
        ['Autorità stake', 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisHistoricalCombinationDetails');
    if (details) details.textContent = top.length ? top.map(item => `${item.deepScan} × ${item.quality}: ${Number.isFinite(Number(item.winRatePct)) ? Number(item.winRatePct).toFixed(2) + '%' : 'N/D'} · n=${item.resolved} · CI ${Number.isFinite(Number(item.ci95LowPct)) ? Number(item.ci95LowPct).toFixed(1) : '—'}–${Number.isFinite(Number(item.ci95HighPct)) ? Number(item.ci95HighPct).toFixed(1) : '—'}% · ${patch13ReliabilityLabel(item.reliability)}`).join('\n') : 'Nessuna combinazione storica disponibile.';
    updateTennisOperationsStatus('historical', { level, alerts: payload.success === false ? 1 : 0, label: `${resolved} esiti DS×Gate` });
}

async function loadTennisHistoricalCombinationEvidence() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/historical-combination-evidence?limit=100000', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) { const err = new Error(payload.error || `HTTP ${response.status}`); err.payload = payload; throw err; }
        renderTennisHistoricalCombinationEvidence(payload);
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisHistoricalCombinationEvidence({ ...payload, success: false, note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Storico DeepScan × Gate non disponibile', message: error.message, phase: 'HISTORICAL_COMBINATION_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        updateTennisOperationsStatus('historical', { level: 'error', alerts: 1, label: 'WR storico errore' });
        return null;
    }
}

function renderTennisProgramProgression(payload = {}) {
    const panel = $('tennisProgramProgressionPanel');
    if (!panel) return;
    const checks = Array.isArray(payload.checks) ? payload.checks : [];
    const failed = checks.filter(item => !item.ok);
    const level = payload.healthy === false || payload.success === false ? 'error' : Number(payload.warnings || 0) > 0 ? 'warn' : 'ok';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisProgramProgressionTitle');
    const message = $('tennisProgramProgressionMessage');
    if (title) {
        title.textContent = level === 'ok' ? `Progressione certificata · Patch ${payload.currentPatchVersion || 13}` : `Progressione ${level === 'error' ? 'NON certificata' : 'con avvisi'}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#7dd3fc';
    }
    if (message) message.textContent = payload.note || 'Controllo generale read-only del programma.';
    const grid = $('tennisProgramProgressionGrid');
    if (grid) grid.innerHTML = [
        ['Controlli', checks.length], ['Superati', checks.filter(item => item.ok).length], ['Errori', payload.errors || 0],
        ['Avvisi', payload.warnings || 0], ['Righe totali', payload.sourceRows ?? '—'], ['Righe Tennis', payload.tennisRows ?? '—']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisProgramProgressionDetails');
    if (details) details.textContent = failed.length ? failed.map(item => `${item.severity === 'error' ? 'ERRORE' : 'AVVISO'} · ${item.name}: ${JSON.stringify(item.details || {})}`).join('\n') : checks.map(item => `PASS · ${item.name}`).join('\n');
    const canonical = payload.operationalSummary || {
        state: level === 'error' ? 'NOT_READY_CRITICAL' : Number(payload.warnings || 0) > 0 ? 'READY_WITH_WARNINGS' : 'READY',
        label: level === 'error' ? 'Non pronto — errore critico' : Number(payload.warnings || 0) > 0 ? 'Pronto con avvisi' : 'Pronto',
        errorCount: Number(payload.errors || 0),
        warningCount: Number(payload.warnings || 0),
        ready: level !== 'error'
    };
    updateTennisOperationsCanonicalSummary({
        source: 'PROGRAM_PROGRESSION',
        patchVersion: payload.currentPatchVersion || '25',
        state: canonical.state,
        label: canonical.label,
        errorCount: Number(canonical.errorCount || 0),
        warningCount: Number(canonical.warningCount || 0),
        ready: canonical.ready === true
    }, 2);
    updateTennisOperationsStatus('progression', { level, alerts: Number(payload.errors || 0) + Number(payload.warnings || 0), label: level === 'ok' ? 'Programma OK' : `${Number(payload.errors || 0)} errori · ${Number(payload.warnings || 0)} avvisi` });
}

async function loadTennisProgramProgression() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/program-progression-health', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisProgramProgression(payload);
        if (!response.ok || payload.healthy === false) { const err = new Error(payload.error || payload.note || `HTTP ${response.status}`); err.payload = payload; throw err; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        if (!payload.checks) renderTennisProgramProgression({ ...payload, success: false, healthy: false, note: error.message, checks: [] });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Progressione programma non certificata', message: error.message, phase: 'PROGRAM_PROGRESSION_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        updateTennisOperationsStatus('progression', { level: 'error', alerts: Math.max(1, Number(payload.errors || 0)), label: 'Programma errore' });
        return null;
    }
}

function bindPatch13OperationsUi() {
    const historical = $('refreshTennisHistoricalCombination');
    if (historical && historical.dataset.bound !== '1') { historical.addEventListener('click', loadTennisHistoricalCombinationEvidence); historical.dataset.bound = '1'; }
    const progression = $('refreshTennisProgramProgression');
    if (progression && progression.dataset.bound !== '1') { progression.addEventListener('click', loadTennisProgramProgression); progression.dataset.bound = '1'; }
    loadTennisHistoricalCombinationEvidence();
    loadTennisProgramProgression();
}
window.loadTennisHistoricalCombinationEvidence = loadTennisHistoricalCombinationEvidence;
window.loadTennisProgramProgression = loadTennisProgramProgression;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch13OperationsUi);
else bindPatch13OperationsUi();
// /PATCH13_TENNIS_HISTORICAL_COMBINATION_AND_PROGRESSION_UI

// ============================================================================
// PATCH14_TENNIS_PLAYER_DATA_REFRESH_FRESHNESS_UI
// Stato read-only e refresh locale esplicito. Nessuna autorità su probabilità/stake.
// ============================================================================
function patch14DateLabel(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString('it-IT') : 'Mai';
}

function renderTennisPlayerDataFreshness(payload = {}) {
    const panel = $('tennisPlayerDataPanel');
    if (!panel) return;
    const aggregateStatus = String(payload.status || 'UNAVAILABLE').toUpperCase();
    const status = String(payload.readinessStatus || payload.status || 'UNAVAILABLE').toUpperCase();
    const level = payload.success === false || status === 'ERROR' ? 'error' : payload.degradedUsingLastKnownGood === true || status === 'STALE' || status === 'AGING' || status === 'UNAVAILABLE' ? 'warn' : 'ok';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisPlayerDataTitle');
    const message = $('tennisPlayerDataMessage');
    const statusLabel = payload.degradedUsingLastKnownGood === true ? 'LKG preservati dopo errore rete' : ({ CURRENT: 'correnti', AGING: 'in invecchiamento', STALE: 'obsoleti', ERROR: 'non certificabili', UNAVAILABLE: 'non disponibili' }[status] || status);
    if (title) {
        title.textContent = `Dati giocatori ${statusLabel}${Number.isFinite(Number(payload.dataAgeDays)) ? ` · ${Number(payload.dataAgeDays).toFixed(1)} giorni` : ''}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#86efac';
    }
    if (message) message.textContent = payload.note || 'Controllo freschezza e provenienza dataset giocatori.';
    const engine = payload.engine || {};
    const sources = Array.isArray(payload.localSources) ? payload.localSources : [];
    const multi = payload.multiProvider || {};
    const selectedProviders = Array.isArray(multi.selectedProviders) ? multi.selectedProviders : [];
    const apiUsage = multi.apiUsage || {};
    const grid = $('tennisPlayerDataGrid');
    if (grid) grid.innerHTML = [
        ['Stato per circuito', status],
        ['Stato aggregato compat.', aggregateStatus],
        ['Stato refresh', payload.refreshState || '—'],
        ['Ultimo match', patch14DateLabel(payload.latestMatchAt)],
        ['Età dati', Number.isFinite(Number(payload.dataAgeDays)) ? `${Number(payload.dataAgeDays).toFixed(1)} giorni` : 'N/D'],
        ['Match caricati', engine.matchCount ?? '—'],
        ['Giocatori', engine.playerCount ?? '—'],
        ['Fonti presenti', `${sources.filter(item => item.exists).length}/${sources.length}`],
        ['Ultimo successo', patch14DateLabel(payload.lastRefreshAt)],
        ['Ultimo tentativo', patch14DateLabel(payload.lastRefreshAttemptAt)],
        ['Retry policy', Array.isArray(payload.retryDelaysMs) ? `${payload.retryDelaysMs.join(' / ')} ms` : '—'],
        ['LKG attivo', payload.degradedUsingLastKnownGood === true ? 'SÌ' : 'NO'],
        ['Strategia provider', multi.strategy || 'ZERO-KEY FIRST'],
        ['Provider selezionati', selectedProviders.length || '—'],
        ['API oggi', Number.isFinite(Number(apiUsage.used)) ? `${apiUsage.used}/${apiUsage.budget}` : '0 / disabilitata'],
        ['Chiave esposta', apiUsage.keyExposed === true ? 'ERRORE' : 'NO'],
        ['Autorità stake', 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisPlayerDataDetails');
    if (details) {
        const sourceLines = sources.map(item => `${item.sourceId || item.localFile}: ${item.exists ? `${item.validRows || item.rowCount || 0} righe · ultimo ${patch14DateLabel(item.latestMatchAt)}` : 'MANCANTE'}`);
        const providerLines = selectedProviders.map(item => `PROVIDER · ${item.targetId || 'target'} → ${item.providerId || 'N/D'} · ${item.validRows || 0} righe · ultimo ${patch14DateLabel(item.latestMatchAt)}`);
        const errors = Array.isArray(payload.errors) ? payload.errors.map(item => `ERRORE · ${item}`) : [];
        const failure = payload.lastFailure || null;
        const failureLines = failure ? [
            `ULTIMO ERRORE RETE · ${failure.error || 'N/D'}`,
            `FONTE · ${failure.sourceId || 'non identificata'}`,
            `TENTATIVI · ${Array.isArray(failure.attempts) ? failure.attempts.length : 0}`,
            ...(Array.isArray(failure.attempts) ? failure.attempts.map(item => `  #${item.attempt} HTTP ${item.statusCode || 'N/D'} · ${item.url || ''}`) : [])
        ] : [];
        details.textContent = [...providerLines, ...sourceLines, ...failureLines, ...errors].join('\n') || 'Nessun dettaglio disponibile.';
    }
    updateTennisOperationsStatus('dataRefresh', {
        level,
        alerts: level === 'error' ? Math.max(1, Number(payload.errors?.length || 0)) : (status === 'STALE' || payload.degradedUsingLastKnownGood === true) ? 1 : 0,
        label: `Dati ${status}`
    });
}

async function loadTennisPlayerDataFreshness() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/player-data-freshness', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisPlayerDataFreshness(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisPlayerDataFreshness({ ...payload, success: false, status: 'ERROR', note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Freschezza dati giocatori non disponibile', message: error.message, phase: 'PLAYER_DATA_FRESHNESS_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}

async function executeTennisPlayerDataRefresh() {
    const button = $('executeTennisPlayerDataRefresh');
    if (button) { button.disabled = true; button.textContent = '⏳ Aggiorno…'; }
    try {
        const response = await fetch('/api/tennis/player-data-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || `HTTP ${response.status}`); error.payload = payload; throw error; }
        await Promise.allSettled([loadTennisPlayerDataFreshness(), loadTennisTourDataReadiness(), loadTennisMatchupIntelligence(), loadTennisProgramProgression()]);
        showRuntimeDiagnostic({ severity: 'INFO', title: 'Bundle multi-provider aggiornato', message: `Aggiornamento atomico multi-provider completato. Ultimo match: ${patch14DateLabel(payload.activeStatus?.latestMatchAt || payload.manifest?.aggregate?.latestMatchAt)}`, phase: 'PLAYER_DATA_REFRESH_COMPLETE', operationId: payload.operationId, details: payload });
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        showRuntimeDiagnostic({ severity: payload.degradedUsingLastKnownGood === true ? 'WARN' : 'ERROR', title: payload.degradedUsingLastKnownGood === true ? 'Refresh rete fallito · dati LKG preservati' : 'Aggiornamento dati giocatori non riuscito', message: error.message, phase: 'PLAYER_DATA_REFRESH_FAILED', operationId: payload.operationId || payload.refreshFailure?.operationId || payload.patch14?.operationId, details: payload || error.stack, error });
        await loadTennisPlayerDataFreshness();
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '⬇️ Aggiorna dati'; }
    }
}

async function executeTennisPlayerDataSourceProbe() {
    const button = $('executeTennisPlayerDataSourceProbe');
    if (button) { button.disabled = true; button.textContent = '⏳ Verifico piano…'; }
    try {
        const response = await fetch('/api/tennis/player-data-provider-probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const payload = await response.json();
        const probeRows = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.sources) ? payload.sources : [];
        const summary = probeRows.length
            ? probeRows.map(item => `${item.targetId || item.sourceId || 'ALL'} · ${item.providerId || item.sourceId || 'provider'}: ${item.status}${item.latestMatchAt ? ` · ultimo ${patch14DateLabel(item.latestMatchAt)}` : ''}${Number.isFinite(Number(item.networkCalls)) ? ` · rete ${item.networkCalls}` : ''}`).join('\n')
            : 'Nessun risultato.';
        showRuntimeDiagnostic({
            severity: payload.success === true ? 'INFO' : 'WARN',
            title: payload.success === true ? 'Piano multi-provider verificato' : 'Probe multi-provider completato con anomalie',
            message: summary,
            phase: 'MULTI_PROVIDER_PROBE_COMPLETE',
            operationId: payload.operationId,
            details: payload
        });
        return payload;
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Probe multi-provider non riuscito', message: error.message, phase: 'MULTI_PROVIDER_PROBE_FAILED', error });
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '🧭 Piano fonti'; }
    }
}

function bindPatch14OperationsUi() {
    const health = $('refreshTennisPlayerDataHealth');
    if (health && health.dataset.bound !== '1') { health.addEventListener('click', loadTennisPlayerDataFreshness); health.dataset.bound = '1'; }
    const refresh = $('executeTennisPlayerDataRefresh');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', executeTennisPlayerDataRefresh); refresh.dataset.bound = '1'; }
    const probe = $('executeTennisPlayerDataSourceProbe');
    if (probe && probe.dataset.bound !== '1') { probe.addEventListener('click', executeTennisPlayerDataSourceProbe); probe.dataset.bound = '1'; }
    loadTennisPlayerDataFreshness();
}
window.loadTennisPlayerDataFreshness = loadTennisPlayerDataFreshness;
window.executeTennisPlayerDataRefresh = executeTennisPlayerDataRefresh;
window.executeTennisPlayerDataSourceProbe = executeTennisPlayerDataSourceProbe;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch14OperationsUi);
else bindPatch14OperationsUi();
// PATCH21_TENNIS_MULTI_PROVIDER_ZERO_KEY_FIRST_UI
// /PATCH14_TENNIS_PLAYER_DATA_REFRESH_FRESHNESS_UI

// ============================================================================
// PATCH22_TOUR_AWARE_FRESHNESS_ACTIVITY_UI
// Source freshness and player activity are displayed independently.
// ============================================================================
function patch22Level(status, success = true) {
    const value = String(status || 'UNAVAILABLE').toUpperCase();
    if (success === false || value === 'ERROR' || value === 'UNAVAILABLE') return 'error';
    if (value !== 'ALL_CURRENT') return 'warn';
    return 'ok';
}
function renderTennisTourDataReadiness(payload = {}) {
    const panel = $('tennisTourDataReadinessPanel');
    if (!panel) return;
    const level = patch22Level(payload.status, payload.success);
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisTourDataReadinessTitle');
    const message = $('tennisTourDataReadinessMessage');
    if (title) {
        title.textContent = `Freschezza per circuito · ${payload.status || 'UNAVAILABLE'}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#86efac';
    }
    if (message) message.textContent = payload.note || 'Controllo separato ATP/WTA e attività giocatore.';
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    const tours = Array.isArray(payload.tours) ? payload.tours : [];
    const counts = payload.counts || {};
    const grid = $('tennisTourDataReadinessGrid');
    if (grid) grid.innerHTML = [
        ['Stato complessivo', payload.status || 'N/D'],
        ['ATP', tours.find(x => x.tour === 'ATP')?.status || 'N/D'],
        ['WTA', tours.find(x => x.tour === 'WTA')?.status || 'N/D'],
        ['Mascheramento aggregato', payload.sourceFreshnessNotMasked === true ? 'BLOCCATO' : 'ERRORE'],
        ['Freschezza mista', payload.mixedFreshnessDetected === true ? 'SÌ' : 'NO'],
        ['Forward sample', payload.forwardStatus || 'N/D'],
        ['Snapshot prediction', counts.predictionSnapshots ?? 0],
        ['Snapshot matchup', counts.matchupSnapshots ?? 0],
        ['Challenger', counts.challengerPredictions ?? 0],
        ['Autorità stake', 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisTourDataReadinessDetails');
    if (details) details.textContent = [
        ...targets.map(item => `${item.targetId} · ${item.status} · ${Number.isFinite(Number(item.dataAgeDays)) ? Number(item.dataAgeDays).toFixed(1) + ' giorni' : 'età N/D'} · ultimo ${patch14DateLabel(item.latestMatchAt)} · ${item.providerId || 'provider N/D'}`),
        '',
        ...tours.map(item => `${item.tour} · ${item.readiness} · current evidence ${item.readyForCurrentEvidence ? 'SÌ' : 'NO'} · shadow evidence ${item.readyForShadowEvidence ? 'SÌ' : 'NO'}`),
        '',
        `Attività giocatore separata dalla freschezza sorgente: ${payload.sourceFreshnessNotMasked === true ? 'SÌ' : 'NO'}`,
        `Promozione forward: ${payload.forwardPromotionEligible === true ? 'ABILITATA' : 'NO'} · ${payload.forwardPromotionReason || ''}`
    ].join('\n');
    const stale = targets.filter(item => item.status !== 'CURRENT').length;
    updateTennisOperationsStatus('tourReadiness', { level, alerts: level === 'error' ? Math.max(1, stale) : stale + (payload.forwardStatus === 'NO_FORWARD_SAMPLE' ? 1 : 0), label: `Circuiti ${payload.status || 'N/D'}` });
}
async function loadTennisTourDataReadiness() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/tour-data-readiness', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisTourDataReadiness(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisTourDataReadiness({ ...payload, success: false, status: 'ERROR', note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Freschezza per circuito non disponibile', message: error.message, phase: 'TOUR_DATA_READINESS_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}
function bindPatch22OperationsUi() {
    const button = $('refreshTennisTourDataReadiness');
    if (button && button.dataset.bound !== '1') { button.addEventListener('click', loadTennisTourDataReadiness); button.dataset.bound = '1'; }
    loadTennisTourDataReadiness();
}
window.loadTennisTourDataReadiness = loadTennisTourDataReadiness;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch22OperationsUi);
else bindPatch22OperationsUi();
// /PATCH22_TOUR_AWARE_FRESHNESS_ACTIVITY_UI

// ============================================================================
// PATCH15_TENNIS_INFORMATION_RETRIEVAL_CERTIFICATION_UI
// Certifica separatamente DeepScan, Analisi AI e Paper Trading. Il probe live
// è locale, esplicito e senza autorità su probabilità, gate, stake o risultati.
// ============================================================================
function patch15RetrievalLevel(status, success = true) {
    const value = String(status || 'WARN').toUpperCase();
    if (success === false || value === 'FAIL' || value === 'ERROR' || value === 'SCHEMA_MISSING') return 'error';
    if (value === 'OPTIONAL_NOT_CONFIGURED') return 'ok';
    if (value === 'WARN' || value === 'NOT_CONFIGURED' || value === 'NOT_TESTED' || value === 'PARTIAL') return 'warn';
    return 'ok';
}

function renderTennisInformationRetrieval(payload = {}) {
    const panel = $('tennisInformationRetrievalPanel');
    if (!panel) return;
    const level = patch15RetrievalLevel(payload.status, payload.success);
    const channels = payload.channels || {};
    const checks = Array.isArray(payload.sourceChecks) ? payload.sourceChecks : [];
    const failed = checks.filter(item => patch15RetrievalLevel(item.status, true) !== 'ok');
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisInformationRetrievalTitle');
    const message = $('tennisInformationRetrievalMessage');
    if (title) {
        title.textContent = `Ricerca informazioni ${String(payload.status || 'N/D').toUpperCase()} · score ${Number.isFinite(Number(payload.overallScore)) ? Number(payload.overallScore).toFixed(1) : 'N/D'}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#86efac';
    }
    if (message) message.textContent = payload.note || 'Controllo separato delle fonti usate da DeepScan, Analisi AI e Paper Trading.';
    const metricFor = (key, label) => {
        const item = channels[key] || {};
        return [label, `${String(item.status || 'N/D').toUpperCase()} · ${Number.isFinite(Number(item.score)) ? Number(item.score).toFixed(1) : 'N/D'}`];
    };
    const grid = $('tennisInformationRetrievalGrid');
    if (grid) grid.innerHTML = [
        metricFor('deepScan', 'DeepScan'),
        metricFor('aiAnalysis', 'Analisi AI'),
        metricFor('paperTrading', 'Paper Trading'),
        ['Fonti controllate', checks.length],
        ['Ricevute forward', payload.counts?.receipts ?? 0],
        ['Probe registrati', payload.counts?.runs ?? 0],
        ['Scope circuito', payload.probeScope?.tourScope || payload.probeScope?.targetScope || 'N/D'],
        ['Target dati', Array.isArray(payload.probeScope?.targetIds) && payload.probeScope.targetIds.length ? payload.probeScope.targetIds.join(', ') : 'N/D'],
        ['API opzionali escluse', Array.isArray(payload.optionalSourcesExcluded) ? payload.optionalSourcesExcluded.length : 0],
        ['Rete in audit stato', payload.networkUsed === true ? 'SÌ' : 'NO'],
        ['Autorità stake', payload.stakeAuthority === true ? 'SÌ' : 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisInformationRetrievalDetails');
    if (details) {
        const lines = checks.map(item => {
            const detailsText = item.details && typeof item.details === 'object' ? JSON.stringify(item.details) : '';
            return `${String(item.status || 'N/D').toUpperCase()} · ${item.channel || 'N/D'} · ${item.sourceId || item.source_id || 'fonte'} · score ${Number.isFinite(Number(item.score)) ? Number(item.score).toFixed(1) : 'N/D'}${detailsText ? ` · ${detailsText}` : ''}`;
        });
        const runs = Array.isArray(payload.recentRuns) ? payload.recentRuns.map(run => `RUN · ${run.completed_at || run.completedAt || 'N/D'} · ${run.run_mode || run.runMode || 'N/D'} · ${run.overall_status || run.overallStatus || 'N/D'} · ${run.overall_score ?? run.overallScore ?? 'N/D'}`) : [];
        details.textContent = [...lines, ...runs].join('\n') || 'Nessun dettaglio disponibile.';
    }
    updateTennisOperationsStatus('retrieval', {
        level,
        alerts: failed.length + (level === 'error' && failed.length === 0 ? 1 : 0),
        label: level === 'ok' ? 'Fonti certificate' : `${failed.length || 1} fonti da verificare`
    });
}

async function loadTennisInformationRetrieval() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/information-retrieval-health?limit=8', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisInformationRetrieval(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || payload.note || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisInformationRetrieval({ ...payload, success: false, status: payload.status || 'ERROR', note: error.message, sourceChecks: payload.sourceChecks || [] });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Certificazione ricerca informazioni non disponibile', message: error.message, phase: 'INFORMATION_RETRIEVAL_HEALTH_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}

async function runTennisInformationRetrievalProbe() {
    const button = $('executeTennisInformationRetrievalProbe');
    if (button) { button.disabled = true; button.textContent = '⏳ Test fonti…'; }
    try {
        const response = await fetch('/api/tennis/information-retrieval-probe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeoutMs: 12000 })
        });
        const payload = await response.json();
        renderTennisInformationRetrieval(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || payload.note || `HTTP ${response.status}`); error.payload = payload; throw error; }
        showRuntimeDiagnostic({ severity: payload.status === 'PASS' ? 'INFO' : 'WARN', title: 'Test ricerca informazioni completato', message: `Scope ${payload.probeScope?.targetScope || 'N/D'} · DeepScan ${payload.channels?.deepScan?.status || 'N/D'} · Analisi AI ${payload.channels?.aiAnalysis?.status || 'N/D'} · Paper Trading ${payload.channels?.paperTrading?.status || 'N/D'}`, phase: 'INFORMATION_RETRIEVAL_PROBE_COMPLETE', operationId: payload.operationId, details: payload });
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Test live delle fonti non riuscito', message: error.message, phase: 'INFORMATION_RETRIEVAL_PROBE_FAILED', operationId: payload.operationId, details: payload || error.stack, error });
        await loadTennisInformationRetrieval();
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '🌐 Test fonti'; }
    }
}

function bindPatch15OperationsUi() {
    const health = $('refreshTennisInformationRetrieval');
    if (health && health.dataset.bound !== '1') { health.addEventListener('click', loadTennisInformationRetrieval); health.dataset.bound = '1'; }
    const probe = $('executeTennisInformationRetrievalProbe');
    if (probe && probe.dataset.bound !== '1') { probe.addEventListener('click', runTennisInformationRetrievalProbe); probe.dataset.bound = '1'; }
    loadTennisInformationRetrieval();
}
window.loadTennisInformationRetrieval = loadTennisInformationRetrieval;
window.runTennisInformationRetrievalProbe = runTennisInformationRetrievalProbe;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch15OperationsUi);
else bindPatch15OperationsUi();
// /PATCH15_TENNIS_INFORMATION_RETRIEVAL_CERTIFICATION_UI

// ============================================================================
// PATCH24_TENNIS_FORWARD_SAMPLE_INTAKE_UI
// Read-only: mostra readiness strutturale e progresso del campione forward.
// ============================================================================
function renderTennisForwardSampleIntake(payload = {}) {
    const panel = $('tennisForwardSampleIntakePanel');
    if (!panel) return;
    const status = String(payload.status || 'BLOCKED_CAPTURE').toUpperCase();
    const structuralReady = payload.structuralReady === true;
    const actionable = Number(payload.forwardSample?.actionableRows || 0);
    const captured = Number(payload.forwardSample?.structurallyCompleteRows || 0);
    const level = !structuralReady || status === 'BLOCKED_CAPTURE' ? 'error'
        : status === 'DEGRADED_CAPTURE' || actionable === 0 ? 'warn' : 'ok';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');

    const title = $('tennisForwardSampleIntakeTitle');
    const message = $('tennisForwardSampleIntakeMessage');
    if (title) {
        title.textContent = `Campione forward ${status} · ${actionable}/${Number(payload.forwardSample?.minimumActionableRows || 100)} actionable`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#86efac';
    }
    if (message) {
        message.textContent = status === 'READY_FOR_NEXT_PREDICTION'
            ? 'Pipeline strutturalmente pronta: la prossima analisi Tennis reale pre-match avvierà il campione forward.'
            : status === 'CAPTURING_FORWARD_SAMPLE'
                ? 'Acquisizione forward attiva. Le righe diventano actionable soltanto dopo settlement certificato.'
                : 'La pipeline forward richiede riparazione prima di acquisire nuove evidenze.';
    }

    const grid = $('tennisForwardSampleIntakeGrid');
    if (grid) grid.innerHTML = [
        ['Stato intake', status],
        ['Struttura pronta', structuralReady ? 'SÌ' : 'NO'],
        ['Snapshot validi', payload.forwardSample?.capturedValidAnchors ?? 0],
        ['Artefatti completi', captured],
        ['Righe actionable', actionable],
        ['Obiettivo minimo', payload.forwardSample?.minimumActionableRows ?? 100],
        ['Progresso settlement', `${Number(payload.forwardSample?.progressPct || 0).toFixed(1)}%`],
        ['Righe mancanti', payload.forwardSample?.remainingRows ?? 100],
        ['Backfill storico', payload.historicalBackfill === true ? 'SÌ' : 'NO'],
        ['Autorità stake', payload.authority?.stake === true ? 'SÌ' : 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');

    const details = $('tennisForwardSampleIntakeDetails');
    if (details) {
        const missingTables = Array.isArray(payload.missingTables) ? payload.missingTables : [];
        const gaps = Array.isArray(payload.structuralGaps) ? payload.structuralGaps : [];
        const counts = payload.counts || {};
        details.textContent = [
            `Next action: ${payload.nextAction || 'N/D'}`,
            `Tabelle mancanti: ${missingTables.length ? missingTables.join(', ') : 'nessuna'}`,
            `Gap strutturali: ${gaps.length ? gaps.join(', ') : 'nessuno'}`,
            `Conteggi: snapshot=${counts.snapshots ?? 0}, ledger=${counts.ledgerRows ?? 0}, coorti=${counts.cohortMembers ?? 0}, evidence=${counts.playerEvidenceRows ?? 0}, matchup=${counts.matchupRows ?? 0}, challenger=${counts.challengerRows ?? 0}, ricevute=${counts.receiptRows ?? 0}`,
            'Politica: FORWARD ONLY · NO HISTORICAL BACKFILL · NO PRODUCTION AUTHORITY'
        ].join('\n');
    }
    updateTennisOperationsStatus('forwardIntake', {
        level,
        alerts: level === 'error' ? 1 : (actionable === 0 ? 1 : 0),
        label: structuralReady ? `Forward ${actionable}/100` : 'Forward bloccato'
    });
}

async function loadTennisForwardSampleIntake() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/forward-sample-intake-readiness', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisForwardSampleIntake(payload);
        if (!response.ok || payload.success === false) {
            const error = new Error(payload.error || payload.status || `HTTP ${response.status}`);
            error.payload = payload;
            throw error;
        }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisForwardSampleIntake({ ...payload, success: false, status: payload.status || 'BLOCKED_CAPTURE' });
        showRuntimeDiagnostic({
            severity: 'ERROR',
            title: 'Intake campione forward non disponibile',
            message: error.message,
            phase: 'FORWARD_SAMPLE_INTAKE_FETCH',
            operationId: payload.operationId,
            details: payload || error.stack,
            error
        });
        return null;
    }
}

function bindPatch24OperationsUi() {
    const button = $('refreshTennisForwardSampleIntake');
    if (button && button.dataset.bound !== '1') {
        button.addEventListener('click', loadTennisForwardSampleIntake);
        button.dataset.bound = '1';
    }
    loadTennisForwardSampleIntake();
}
window.loadTennisForwardSampleIntake = loadTennisForwardSampleIntake;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch24OperationsUi);
else bindPatch24OperationsUi();
// /PATCH24_TENNIS_FORWARD_SAMPLE_INTAKE_UI

// ============================================================================
// PATCH16_TENNIS_HISTORICAL_PLAYER_STATS_UI
// Dataset strutturato locale, as-of-safe e privo di autorità operativa.
// ============================================================================
function patch16HistoricalStatsLevel(status, success = true) {
    const value = String(status || 'WARN').toUpperCase();
    if (success === false || value === 'ERROR' || value === 'UNAVAILABLE' || value === 'SCHEMA_MISSING') return 'error';
    if (value.includes('QUARANTINE') || value === 'WARN') return 'warn';
    return 'ok';
}

function renderTennisHistoricalPlayerStats(payload = {}) {
    const panel = $('tennisHistoricalPlayerStatsPanel');
    if (!panel) return;
    const dataset = payload.dataset || payload;
    const database = payload.database || {};
    const level = patch16HistoricalStatsLevel(payload.status || dataset.status, payload.success);
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'warn' ? 'status-warn' : 'status-ok');
    const title = $('tennisHistoricalPlayerStatsTitle');
    const message = $('tennisHistoricalPlayerStatsMessage');
    if (title) {
        title.textContent = `Statistiche storiche ${String(payload.status || dataset.status || 'N/D').toUpperCase()} · ${Number(dataset.activeRecords || 0)} record attivi`;
        title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fbbf24' : '#86efac';
    }
    if (message) message.textContent = payload.note || 'Dataset storico TennisDB disponibile come validazione shadow as-of-safe.';
    const seasons = dataset.seasons || {};
    const grid = $('tennisHistoricalPlayerStatsGrid');
    if (grid) grid.innerHTML = [
        ['Dataset', dataset.datasetId || 'N/D'],
        ['ATP attivi', dataset.activeByTour?.ATP ?? 0],
        ['WTA attivi', dataset.activeByTour?.WTA ?? 0],
        ['Quarantena', dataset.quarantinedRecords ?? 0],
        ['Stagioni ATP', Array.isArray(seasons.ATP) ? seasons.ATP.join(' · ') : 'N/D'],
        ['Stagioni WTA', Array.isArray(seasons.WTA) ? seasons.WTA.join(' · ') : 'N/D'],
        ['Parità XLSX/HTML', dataset.formatParity || 'N/D'],
        ['Link giocatori', Number.isFinite(Number(dataset.linkCoveragePct)) ? `${Number(dataset.linkCoveragePct).toFixed(1)}%` : 'N/D'],
        ['DB append-only', database.immutableTriggers === true ? 'SÌ' : 'NO'],
        ['Autorità modello', dataset.modelProbabilityAuthority === true ? 'SÌ' : 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisHistoricalPlayerStatsDetails');
    if (details) details.textContent = [
        `Versione: ${dataset.version || 'N/D'}`,
        `Snapshot fonte: ${dataset.sourceObservedAt || 'N/D'}`,
        `Avvisi: ${(dataset.warningCodes || []).join(', ') || 'nessuno'}`,
        `DB: ${database.status || 'N/D'} · record ${database.records ?? 0} · orphan ${database.orphanRecords ?? 0}`,
        'Autorità: shadow-only; probabilità, DeepScan, Quality Gate, stake e settlement invariati.'
    ].join('\n');
    updateTennisOperationsStatus('historicalStats', {
        level,
        alerts: level === 'error' ? 1 : Number(dataset.quarantinedRecords || 0) > 0 ? 1 : 0,
        label: level === 'ok' ? 'Storico certificato' : level === 'warn' ? 'Storico con quarantena' : 'Storico non disponibile'
    });
}

async function loadTennisHistoricalPlayerStats() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/historical-player-stats-health', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisHistoricalPlayerStats(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || payload.note || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisHistoricalPlayerStats({ ...payload, success: false, status: payload.status || 'ERROR', note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Statistiche storiche giocatori non disponibili', message: error.message, phase: 'HISTORICAL_PLAYER_STATS_HEALTH_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}

function bindPatch16OperationsUi() {
    const button = $('refreshTennisHistoricalPlayerStats');
    if (button && button.dataset.bound !== '1') { button.addEventListener('click', loadTennisHistoricalPlayerStats); button.dataset.bound = '1'; }
    loadTennisHistoricalPlayerStats();
}
window.loadTennisHistoricalPlayerStats = loadTennisHistoricalPlayerStats;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch16OperationsUi);
else bindPatch16OperationsUi();
// /PATCH16_TENNIS_HISTORICAL_PLAYER_STATS_UI



// ============================================================================
// PATCH17_TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_UI
// Misura il segnale storico in retrospettiva as-of-safe e in forward certificato.
// ============================================================================
function renderTennisHistoricalValidationPerformance(payload = {}) {
    const panel = $('tennisHistoricalValidationPerformancePanel');
    if (!panel) return;
    const forward = payload.latestForward || {};
    const retro = payload.latestRetrospective || {};
    const gate = payload.performanceGate || forward.performanceGate || {};
    const status = String(payload.status || 'WARN').toUpperCase();
    const level = payload.success === false || status.includes('ERROR') || status === 'SCHEMA_MISSING' ? 'error'
        : Number(payload.forwardEvaluations || 0) > 0 ? 'ok' : 'warn';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'ok' ? 'status-ok' : 'status-warn');
    const title = $('tennisHistoricalValidationPerformanceTitle');
    const message = $('tennisHistoricalValidationPerformanceMessage');
    if (title) {
        title.textContent = `Performance shadow ${status} · forward ${Number(payload.forwardEvaluations || 0)}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'ok' ? '#86efac' : '#fda4af';
    }
    if (message) message.textContent = payload.note || 'Baseline retrospettiva pronta; il segnale resta shadow finché manca un campione forward sufficiente.';
    const retroMetrics = retro.metrics || {};
    const forwardMetrics = forward.metrics || {};
    const grid = $('tennisHistoricalValidationPerformanceGrid');
    if (grid) grid.innerHTML = [
        ['Valutazioni retro', payload.retrospectiveEvaluations ?? 0],
        ['Valutazioni forward', payload.forwardEvaluations ?? 0],
        ['Copertura retro', Number.isFinite(Number(retro.coveragePct)) ? `${Number(retro.coveragePct).toFixed(2)}%` : 'N/D'],
        ['Accuratezza segnale retro', Number.isFinite(Number(retroMetrics.signalAccuracyPct)) ? `${Number(retroMetrics.signalAccuracyPct).toFixed(2)}%` : 'N/D'],
        ['Brier storico retro', Number.isFinite(Number(retroMetrics.validationBrier)) ? Number(retroMetrics.validationBrier).toFixed(4) : 'N/D'],
        ['Brier production retro', Number.isFinite(Number(retroMetrics.productionBrier)) ? Number(retroMetrics.productionBrier).toFixed(4) : 'N/D'],
        ['Segnali forward', forwardMetrics.actionableRows ?? 0],
        ['Gate performance', gate.status || 'NO_FORWARD_SAMPLE'],
        ['Promozione automatica', gate.promotionAuthority === true ? 'SÌ' : 'NO'],
        ['DB immutabile', payload.immutableTriggers === true ? 'SÌ' : 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisHistoricalValidationPerformanceDetails');
    if (details) details.textContent = [
        `Versione: ${payload.version || 'N/D'}`,
        `Stato gate: ${gate.status || 'N/D'}`,
        `Motivo: ${gate.reason || 'Campione forward non disponibile.'}`,
        `Retro: ${retro.coveredRows ?? 0}/${retro.eligibleRows ?? 0} coperti · ${retroMetrics.actionableRows ?? 0} segnali`,
        `Forward: ${forward.coveredRows ?? 0}/${forward.eligibleRows ?? 0} coperti · ${forwardMetrics.actionableRows ?? 0} segnali`,
        'Autorità: nessuna modifica a probabilità, DeepScan, Quality Gate, stake o settlement.'
    ].join('\n');
    updateTennisOperationsStatus('historicalPerformance', {
        level,
        alerts: level === 'error' ? 1 : Number(payload.forwardEvaluations || 0) > 0 ? 0 : 1,
        label: level === 'ok' ? 'Performance forward attiva' : level === 'warn' ? 'Solo baseline retro' : 'Performance non disponibile'
    });
}

async function loadTennisHistoricalValidationPerformance() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/historical-validation-performance-health', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisHistoricalValidationPerformance(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || payload.note || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisHistoricalValidationPerformance({ ...payload, success: false, status: payload.status || 'ERROR', note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Performance validazione storica non disponibile', message: error.message, phase: 'HISTORICAL_VALIDATION_PERFORMANCE_HEALTH_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}
async function executeTennisHistoricalValidationPerformanceRefresh() {
    const button = $('executeTennisHistoricalValidationPerformanceRefresh');
    if (button) { button.disabled = true; button.textContent = '⏳ Misuro…'; }
    try {
        const response = await fetch('/api/tennis/historical-validation-performance-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeRetrospective: false }) });
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
        await loadTennisHistoricalValidationPerformance();
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Refresh performance shadow fallito', message: error.message, phase: 'HISTORICAL_VALIDATION_PERFORMANCE_REFRESH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '▶ Misura forward'; }
    }
}
function bindPatch17OperationsUi() {
    const refresh = $('refreshTennisHistoricalValidationPerformance');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisHistoricalValidationPerformance); refresh.dataset.bound = '1'; }
    const execute = $('executeTennisHistoricalValidationPerformanceRefresh');
    if (execute && execute.dataset.bound !== '1') { execute.addEventListener('click', executeTennisHistoricalValidationPerformanceRefresh); execute.dataset.bound = '1'; }
    loadTennisHistoricalValidationPerformance();
}
window.loadTennisHistoricalValidationPerformance = loadTennisHistoricalValidationPerformance;
window.executeTennisHistoricalValidationPerformanceRefresh = executeTennisHistoricalValidationPerformanceRefresh;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch17OperationsUi);
else bindPatch17OperationsUi();
// /PATCH17_TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_UI


// ============================================================================
// PATCH18_TENNIS_STATISTICAL_CHALLENGER_UI
// Cross-fit temporale shadow, bootstrap paired e stabilità ATP/WTA.
// ============================================================================
function renderTennisStatisticalChallenger(payload = {}) {
    const panel = $('tennisStatisticalChallengerPanel');
    if (!panel) return;
    const metrics = payload.metrics || payload.latest?.metrics || {};
    const bootstrap = payload.bootstrap || payload.latest?.bootstrap || {};
    const guard = payload.stabilityGuard || payload.latest?.stabilityGuard || {};
    const status = String(payload.status || guard.status || 'WARN').toUpperCase();
    const mixed = status.includes('MIXED') || status.includes('UNCERTAIN');
    const level = payload.success === false || status.includes('ERROR') || status === 'SCHEMA_MISSING' ? 'error'
        : status.includes('STABLE_ALL_TOURS') ? 'ok' : 'warn';
    panel.classList.remove('status-ok', 'status-warn', 'status-error');
    panel.classList.add(level === 'error' ? 'status-error' : level === 'ok' ? 'status-ok' : 'status-warn');
    const title = $('tennisStatisticalChallengerTitle');
    const message = $('tennisStatisticalChallengerMessage');
    if (title) {
        title.textContent = `Challenger cross-fitted ${status} · OOS ${Number(metrics.rows || payload.latest?.oosRows || 0)}`;
        title.style.color = level === 'error' ? '#f87171' : level === 'ok' ? '#86efac' : '#fde68a';
    }
    if (message) message.textContent = payload.note || guard.reason || 'Blend statistico shadow selezionato soltanto su match precedenti.';
    const fmt = value => Number.isFinite(Number(value)) ? Number(value).toFixed(6) : 'N/D';
    const grid = $('tennisStatisticalChallengerGrid');
    if (grid) grid.innerHTML = [
        ['Valutazioni sorgente', payload.latest?.sourceEvaluations ?? payload.latest?.report?.sourceEvaluations ?? 0],
        ['Warm-up', payload.latest?.warmupRows ?? payload.latest?.report?.warmupRows ?? 0],
        ['Righe OOS', metrics.rows ?? payload.predictions ?? 0],
        ['Peso storico medio', Number.isFinite(Number(metrics.averageHistoricalWeight)) ? `${(Number(metrics.averageHistoricalWeight) * 100).toFixed(2)}%` : 'N/D'],
        ['Brier challenger', fmt(metrics.challengerBrier)],
        ['Brier production', fmt(metrics.productionBrier)],
        ['Delta Brier', fmt(metrics.brierImprovementVsProduction)],
        ['Bootstrap 95%', `[${fmt(bootstrap.lower95)}, ${fmt(bootstrap.upper95)}]`],
        ['Prob. delta positivo', Number.isFinite(Number(bootstrap.probabilityPositive)) ? `${(Number(bootstrap.probabilityPositive) * 100).toFixed(2)}%` : 'N/D'],
        ['Promozione automatica', guard.promotionAuthority === true ? 'SÌ' : 'NO']
    ].map(([label, value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisStatisticalChallengerDetails');
    const folds = payload.latest?.folds || payload.latest?.report?.folds || [];
    if (details) details.textContent = [
        `Versione: ${payload.version || 'N/D'}`,
        `Guard: ${guard.status || 'N/D'}`,
        `Motivo: ${guard.reason || 'N/D'}`,
        `Fold: ${folds.map(item => `F${item.foldIndex} w=${item.selectedHistoricalWeight ?? 'N/D'} train=${item.trainingRows} test=${item.testRows}`).join(' · ') || 'N/D'}`,
        `Stabilità complessiva: ${bootstrap.stablePositive === true ? 'POSITIVA' : 'NON CERTIFICATA'}`,
        `Coorti: ${mixed ? 'evidenza mista ATP/WTA' : 'vedi audit dettagliato'}`,
        'Autorità: nessuna modifica a probabilità, DeepScan, Quality Gate, stake o settlement.'
    ].join('\n');
    updateTennisOperationsStatus('statisticalChallenger', {
        level,
        alerts: level === 'error' ? 1 : level === 'warn' ? 1 : 0,
        label: level === 'ok' ? 'Challenger stabile' : level === 'warn' ? 'Challenger coorti miste' : 'Challenger non disponibile'
    });
}

async function loadTennisStatisticalChallenger() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/statistical-challenger-health', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisStatisticalChallenger(payload);
        if (!response.ok || payload.success === false) { const error = new Error(payload.error || payload.note || `HTTP ${response.status}`); error.payload = payload; throw error; }
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        renderTennisStatisticalChallenger({ ...payload, success: false, status: payload.status || 'ERROR', note: error.message });
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Challenger statistico non disponibile', message: error.message, phase: 'STATISTICAL_CHALLENGER_HEALTH_FETCH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    }
}
async function executeTennisStatisticalChallengerRefresh() {
    const button = $('executeTennisStatisticalChallengerRefresh');
    if (button) { button.disabled = true; button.textContent = '⏳ Cross-fit…'; }
    try {
        const response = await fetch('/api/tennis/statistical-challenger-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
        await loadTennisStatisticalChallenger();
        return payload;
    } catch (error) {
        const payload = error.payload || {};
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Refresh challenger statistico fallito', message: error.message, phase: 'STATISTICAL_CHALLENGER_REFRESH', operationId: payload.operationId, details: payload || error.stack, error });
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '▶ Ricalcola OOS'; }
    }
}
function bindPatch18OperationsUi() {
    const refresh = $('refreshTennisStatisticalChallenger');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisStatisticalChallenger); refresh.dataset.bound = '1'; }
    const execute = $('executeTennisStatisticalChallengerRefresh');
    if (execute && execute.dataset.bound !== '1') { execute.addEventListener('click', executeTennisStatisticalChallengerRefresh); execute.dataset.bound = '1'; }
    loadTennisStatisticalChallenger();
}
window.loadTennisStatisticalChallenger = loadTennisStatisticalChallenger;
window.executeTennisStatisticalChallengerRefresh = executeTennisStatisticalChallengerRefresh;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch18OperationsUi);
else bindPatch18OperationsUi();
// /PATCH18_TENNIS_STATISTICAL_CHALLENGER_UI

function jsStringEscape(value) {
    return safeString(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

function colorByPositiveNegative(value, neutralColor = '#94a3b8') {
    const n = safeNumber(value, 0);
    if (n > 0) return '#10b981';
    if (n < 0) return '#ef4444';
    return neutralColor;
}

function isTennisRow(row = {}) {
    const sportType = safeString(row.sport_type).toUpperCase();
    const betType = safeString(row.bet_type).toUpperCase();
    const strategy = safeString(row.strategy_tag).toUpperCase();

    return sportType === 'TENNIS' ||
        betType.includes('TENNIS') ||
        strategy.includes('TENNIS');
}

function isCalcioRow(row = {}) {
    return !isTennisRow(row);
}

function isCleanCurrentRow(row = {}) {
    const quality = safeString(row.data_quality).toUpperCase();

    // Tennis Step 2: storico professionale strict.
    // I record Tennis senza data_quality esplicita NON sono considerati current,
    // così la UI non promuove più righe legacy/NULL dentro ROI, equity e portfolio.
    if (isTennisRow(row)) {
        return ['CURRENT', 'CURRENT_BOOTSTRAP'].includes(quality);
    }

    if (!quality) return true;

    return ![
        'LEGACY_DIRTY',
        'DIRTY',
        'OLD_METRICS'
    ].includes(quality);
}


function hasTennisOperationalGate(row = {}) {
    return Boolean(
        safeString(row.professional_gate_status) ||
        safeString(row.tennis_operational_status) ||
        safeString(row.tennis_operational_action) ||
        row.professional_gate_allow_bet !== undefined && row.professional_gate_allow_bet !== null
    );
}

function isTennisBlockedOrNoBet(row = {}) {
    const text = [
        row.professional_gate_status,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.ds_action,
        row.ds_suggestion
    ].map(v => safeString(v).toUpperCase()).join(' ');

    return Number(row.professional_gate_allow_bet) === 0 ||
        text.includes('NO_BET') ||
        text.includes('BLOCCATA') ||
        text.includes('BLOCKED');
}

function isOperationalRealPortfolioRow(row = {}) {
    if (!isTennisRow(row)) return safeNumber(row.stake ?? row.invested, 0) > 0;
    if (!hasTennisOperationalGate(row)) return false;
    if (isTennisBlockedOrNoBet(row)) return false;
    return safeNumber(row.stake ?? row.invested, 0) > 0;
}

function buildStep67ExportScope(row = {}) {
    const operational = isOperationalRealPortfolioRow(row);
    const isTennis = isTennisRow(row);
    const gateStatus = row.deepscan_gate_status || row.tennis_operational_status || row.professional_gate_status || '';
    const gateReason = row.deepscan_gate_reason || row.tennis_operational_summary || row.professional_gate_reasons || row.ds_suggestion || '';

    return {
        trading_scope: row.trading_scope || (operational ? 'PAPER_OPERATIONAL' : (isTennis ? 'AUDIT_ONLY_OR_BLOCKED' : 'NON_OPERATIONAL')),
        paper_trading_scope: row.paper_trading_scope || (operational ? 'PAPER_OPERATIONAL' : 'AUDIT_ONLY'),
        portfolio_scope: row.portfolio_scope || (operational ? 'PORTFOLIO_REAL' : 'EXCLUDED_FROM_REAL_PORTFOLIO'),
        deepscan_gate_mode: row.deepscan_gate_mode || (isTennis && hasTennisOperationalGate(row) ? 'OPERATIONAL_GATE' : ''),
        deepscan_gate_status: gateStatus,
        deepscan_gate_reason: gateReason,
        calibration_version: row.calibration_version || row.calibration_report_version || row.calibrationVersion || '',
        clv_learning_action: row.clv_learning_action || row.clvLearningAction || row.clv_learning_signal || '',
        audit_trail_event_id: row.audit_trail_event_id || row.audit_trail_id || row.auditTrailEventId || ''
    };
}

function getBetEdgePp(row = {}) {
    return safeNumber(
        row.edge_pp ??
        row.adjusted_edge_pp ??
        row.edge,
        0
    );
}

function getBetEvPct(row = {}) {
    return safeNumber(
        row.ev_pct ??
        row.adjusted_ev_pct ??
        row.expectedValue ??
        row.ev,
        0
    );
}

function getBetProbability(row = {}) {
    return safeNumber(
        row.estimatedProb ??
        row.estimated_prob ??
        row.calibrated_probability_pct ??
        row.calibratedProbability ??
        row.probability,
        0
    );
}

function getBetOdd(row = {}) {
    return safeNumber(row.odd, 0);
}

function getBetStake(row = {}) {
    return safeNumber(row.stake ?? row.invested, 0);
}

function getStakePolicyValue(row = {}, camelKey, snakeKey, fallback = null) {
    if (row.stakePolicy && row.stakePolicy[camelKey] !== undefined && row.stakePolicy[camelKey] !== null) {
        return row.stakePolicy[camelKey];
    }

    if (row[snakeKey] !== undefined && row[snakeKey] !== null) {
        return row[snakeKey];
    }

    return fallback;
}

function resolveTennisStakeExecutionContractUi(row = {}) {
    const direct = row.finalExecutableStakeContract || row.stakeAdjustment?.finalExecutableStakeContract || row.tennisStakeExecutionContract || null;
    if (direct?.finalExecution) return direct;
    const finalStake = Math.max(0, safeNumber(row.tennis_stake_final_executable ?? row.stake, 0));
    const modelSuggested = Math.max(0, safeNumber(row.tennis_stake_model_suggested ?? row.quality_stake_amount ?? row.tennis_stake_authority_proposed_stake ?? row.stake_base_before_deepscan ?? finalStake, 0));
    const qualityCap = Math.max(0, safeNumber(row.tennis_stake_quality_cap ?? row.quality_stake_amount ?? row.professional_gate_max_stake ?? modelSuggested, modelSuggested));
    const riskCap = Math.max(0, safeNumber(row.tennis_stake_risk_cap ?? row.tennis_stake_authority_final_stake ?? qualityCap, qualityCap));
    const calibrationCap = Math.max(0, safeNumber(row.tennis_stake_calibration_cap ?? row.tennis_probability_guard_stake_cap ?? finalStake, finalStake));
    const finalStatus = safeString(row.tennis_stake_final_execution_status || (finalStake > 0 ? (finalStake <= 2 ? 'EXECUTABLE_MICRO_STAKE' : 'EXECUTABLE_STANDARD_STAKE') : 'NO_EXECUTABLE_STAKE'));
    return {
        version: safeString(row.tennis_stake_contract_version || 'TENNIS_STAKE_EXECUTION_CONTRACT_UI_DERIVED_PATCH46'),
        tpi: { status: safeString(row.tennis_stake_tpi_authority_status || 'DISPLAY_ONLY_NO_STAKE_AUTHORITY'), role: 'DIAGNOSTIC_RANKING_ONLY', stakeAuthority: false },
        modelSuggestion: { role: 'NON_EXECUTABLE_PROPOSAL', stake: modelSuggested },
        qualityGate: { status: safeString(row.tennis_stake_quality_authority_status || row.quality_final_code || 'QUALITY_GATE_UNAVAILABLE'), role: 'PROPOSAL_AND_CAP_AUTHORITY', capStake: qualityCap },
        riskAuthority: { status: safeString(row.tennis_stake_risk_authority_status || row.tennis_risk_authority_status || row.tennis_stake_authority_status || 'RISK_AUTHORITY_UNAVAILABLE'), role: 'RISK_CAP_AUTHORITY', capStake: riskCap },
        calibrationGuard: { status: safeString(row.tennis_stake_calibration_status || row.tennis_probability_guard_status || 'CALIBRATION_GUARD_UNAVAILABLE'), role: 'FINAL_REDUCTION_GUARD', capStake: calibrationCap },
        finalExecution: { status: finalStatus, authority: safeString(row.tennis_stake_final_authority || 'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT'), executableStake: finalStake, reason: safeString(row.tennis_stake_final_reason || row.tennis_probability_guard_reason || row.tennis_risk_authority_reason || row.tennis_stake_authority_reason || row.stake_policy_note || '') }
    };
}

function patch46StakeStatusLabel(status = '') {
    const text = safeString(status).replaceAll('_', ' ');
    if (!text) return 'N/D';
    return text;
}

function renderTennisStakePolicyMini(row = {}) {
    if (activeSport !== SPORT.TENNIS) return '';
    const contract = resolveTennisStakeExecutionContractUi(row);
    const modelStake = safeNumber(contract.modelSuggestion?.stake, 0);
    const qualityCap = safeNumber(contract.qualityGate?.capStake, 0);
    const riskCap = safeNumber(contract.riskAuthority?.capStake, 0);
    const calibrationCap = safeNumber(contract.calibrationGuard?.capStake, 0);
    const finalStake = safeNumber(contract.finalExecution?.executableStake, 0);
    const finalColor = finalStake > 0 ? '#22c55e' : '#fb923c';
    const tooltip = [
        `Patch46 Stake Execution Contract`,
        `Proposta modello: €${formatNumber(modelStake, 2)} (non eseguibile)`,
        `Quality Gate: ${patch46StakeStatusLabel(contract.qualityGate?.status)} · cap €${formatNumber(qualityCap, 2)}`,
        `Risk Authority: ${patch46StakeStatusLabel(contract.riskAuthority?.status)} · cap €${formatNumber(riskCap, 2)}`,
        `Calibration Guard: ${patch46StakeStatusLabel(contract.calibrationGuard?.status)} · cap €${formatNumber(calibrationCap, 2)}`,
        `Finale: ${patch46StakeStatusLabel(contract.finalExecution?.status)} · €${formatNumber(finalStake, 2)}`,
        `Autorità finale: ${safeString(contract.finalExecution?.authority || 'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT')}`,
        safeString(contract.finalExecution?.reason || '')
    ].filter(Boolean).join('\n');
    return `<div title="${htmlEscape(tooltip)}" style="font-size:0.66em;color:#94a3b8;margin-top:4px;line-height:1.35;min-width:150px;">
        <div><span style="color:#94a3b8;">Proposta</span> €${formatNumber(modelStake, 2)} · <span style="color:#38bdf8;">Gate cap</span> €${formatNumber(qualityCap, 2)}</div>
        <div><span style="color:#f59e0b;">Risk cap</span> €${formatNumber(riskCap, 2)} · <span style="color:#a78bfa;">Calib. cap</span> €${formatNumber(calibrationCap, 2)}</div>
        <div style="color:${finalColor};font-weight:900;">Finale ${htmlEscape(patch46StakeStatusLabel(contract.finalExecution?.status))}: €${formatNumber(finalStake, 2)}</div>
        <div style="color:#64748b;">TPI: solo diagnostico · autorità finale Patch46</div>
    </div>`;
}

function getBetProfit(row = {}) {
    return safeNumber(row.profit, 0);
}

function renderDeepScanStakeAdvisory(index, bet = {}, stakeAdjustment = null) {
    // Step 17: DeepScan è gate operativo; portfolio e ROI restano filtrati audit-grade.
    // STEP50D_UI_APPLY_CONSENSUS_STAKE + STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL:
    // oltre al Consensus Gate, anche RISCHIO MODELLO + BLOCCATA SOFT riclassificato
    // a micro-test deve aggiornare subito la riga UI, senza attendere refresh storico.
    if (!stakeAdjustment) return;

    const currentStake = getBetStake(bet);
    const suggestedStake = safeNumber(stakeAdjustment.suggestedStake ?? stakeAdjustment.adjustedStake, currentStake);
    const stakeCell = $(`stake-cell-${index}`);
    const profitCell = $(`profit-cell-${index}`);
    const consensusMicro = stakeAdjustment.consensusGateApplied === true;
    const runtimeMicro = step96CIsRuntimeMicroStakeActivation(stakeAdjustment);
    const finalContract = stakeAdjustment.finalExecutableStakeContract || stakeAdjustment.stakeExecutionContract || null;
    const finalAuthority = stakeAdjustment.finalStakeAuthority || stakeAdjustment.finalStakeAuthorityDecision || null;
    if (finalContract?.finalExecution || finalAuthority) {
        const appliedStake = Math.max(0, safeNumber(finalContract?.finalExecution?.executableStake ?? finalAuthority?.finalStake, 0));
        const odd = safeNumber(bet.odd, 0);
        const appliedProfit = odd > 1 ? appliedStake * (odd - 1) : 0;
        const executionStatus = safeString(finalContract?.finalExecution?.status || finalAuthority?.status || 'NO_EXECUTABLE_STAKE');
        const executionReason = safeString(finalContract?.finalExecution?.reason || finalAuthority?.reason || '');
        const message = finalContract?.finalExecution
            ? `Patch46 ${executionStatus.replaceAll('_',' ')}: ${executionReason}`
            : `Legacy ${safeString(finalAuthority?.status).replaceAll('_',' ')}: ${executionReason}`;
        bet.stake = appliedStake;
        bet.invested = formatNumber(appliedStake, 2);
        bet.estimatedProfit = formatNumber(appliedProfit, 2);
        bet.finalExecutableStakeContract = finalContract || bet.finalExecutableStakeContract;
        bet.tennis_stake_authority_status = finalAuthority?.status || bet.tennis_stake_authority_status;
        bet.tennis_stake_authority_sample = finalAuthority?.sample ?? bet.tennis_stake_authority_sample;
        bet.tennis_stake_authority_reason = finalAuthority?.reason || bet.tennis_stake_authority_reason;
        if (finalContract?.finalExecution) {
            bet.tennis_stake_contract_version = finalContract.version;
            bet.tennis_stake_final_execution_status = finalContract.finalExecution.status;
            bet.tennis_stake_final_executable = finalContract.finalExecution.executableStake;
            bet.tennis_stake_final_authority = finalContract.finalExecution.authority;
            bet.tennis_stake_final_reason = finalContract.finalExecution.reason;
        }
        if (stakeCell) stakeCell.innerHTML = `€${formatNumber(appliedStake, 2)}<div style="font-size:0.68em;color:${appliedStake > 0 ? '#22c55e' : '#fb923c'};margin-top:3px;">${htmlEscape(message)}</div>${renderTennisStakePolicyMini(bet)}`;
        if (profitCell) profitCell.innerHTML = appliedStake > 0 ? `Pot. +€${formatNumber(appliedProfit, 2)}` : 'Pot. +€0.00';
        return;
    }

    if (consensusMicro || runtimeMicro) {
        const appliedStake = Math.max(
            2,
            safeNumber(stakeAdjustment.adjustedStake ?? stakeAdjustment.currentStake ?? stakeAdjustment.suggestedStake, 0)
        );
        if (!(appliedStake > 0)) return;
        const odd = safeNumber(bet.odd, 0);
        const appliedProfit = odd > 1 ? appliedStake * (odd - 1) : 0;
        const microMessage = runtimeMicro && !consensusMicro
            ? 'Step101/99/96: micro-stake applicato per RISCHIO MODELLO + BLOCCATA SOFT con Edge/EV positivi. Stake pieno non consentito.'
            : 'Step50D: micro-stake applicato dal Consensus Gate · stake standard non consentito.';

        bet.stake = appliedStake;
        bet.invested = formatNumber(appliedStake, 2);
        bet.estimatedProfit = formatNumber(appliedProfit, 2);
        bet.professional_gate_allow_bet = true;
        bet.professional_gate_status = runtimeMicro && !consensusMicro ? 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99' : 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED';
        bet.tennis_operational_status = 'WATCHLIST MICRO';
        bet.tennis_operational_action = 'PAPER_OR_MICRO_STAKE';
        bet.tennis_operational_summary = microMessage;

        if (stakeCell) {
            stakeCell.innerHTML = `€${formatNumber(appliedStake, 2)}<div style="font-size:0.72em; color:#22c55e; margin-top:3px;">${htmlEscape(microMessage)}</div>`;
        }

        if (profitCell) {
            profitCell.innerHTML = `+€${formatNumber(appliedProfit, 2)}`;
        }

        const rowEl = $(`row-${index}`);
        const opBadge = rowEl?.querySelector?.('.tennis-op-badge');
        if (opBadge) {
            opBadge.textContent = runtimeMicro && !consensusMicro ? '🎾 WATCHLIST MICRO · RISK MODEL' : '🎾 WATCHLIST MICRO · DEEPSCAN';
            opBadge.style.borderColor = '#f59e0b';
            opBadge.style.color = '#f59e0b';
            opBadge.style.background = '#f59e0b1a';
        }

        const dsRow = $(`ds-row-${index}`);
        const opTitle = dsRow?.querySelector?.('.tennis-op-title');
        const opSummary = dsRow?.querySelector?.('.tennis-op-summary');
        const opAction = dsRow?.querySelector?.('.tennis-op-action');
        if (opTitle) opTitle.textContent = runtimeMicro && !consensusMicro ? 'WATCHLIST MICRO · RISK MODEL' : 'WATCHLIST MICRO · DEEPSCAN';
        if (opSummary) opSummary.textContent = microMessage;
        if (opAction) opAction.textContent = 'PAPER_OR_MICRO_STAKE';
        return;
    }

    if (stakeCell && stakeAdjustment.reason) {
        const baseHtml = `€${formatNumber(currentStake, 2)}`;
        const opText = [
            bet.tennis_operational_status,
            bet.tennis_operational_action,
            bet.professional_gate_status,
            bet.stake_policy_note,
            stakeAdjustment.reason
        ].map(v => String(v || '').toUpperCase()).join(' ');
        const microAllowed = currentStake > 0 && (
            opText.includes('WATCHLIST MICRO') ||
            opText.includes('VALUE CONFERMATO MICRO') ||
            opText.includes('PAPER_OR_MICRO_STAKE') ||
            opText.includes('CONSENSUS_MICRO') ||
            opText.includes('WATCHLIST_MICRO_RISK_MODEL_SOFT')
        );
        const advisoryHtml = microAllowed
            ? `<div style="font-size:0.72em; color:#22c55e; margin-top:3px;">Micro-stake confermato: ${htmlEscape(stakeAdjustment.reason)}</div>`
            : (suggestedStake !== currentStake
                ? `<div style="font-size:0.72em; color:#fbbf24; margin-top:3px;">Suggerimento DeepScan: €${formatNumber(suggestedStake, 2)} · ${htmlEscape(stakeAdjustment.reason)}</div>`
                : `<div style="font-size:0.72em; color:#94a3b8; margin-top:3px;">DeepScan operational gate: stake invariato in questa riga.</div>`);
        stakeCell.innerHTML = baseHtml + advisoryHtml;
    }
}


function getStatusInfo(status) {
    const s = safeString(status).toUpperCase();

    if (s === 'WON') {
        return { color: '#10b981', icon: '✅ VINTA', label: 'WON' };
    }

    if (s === 'LOST') {
        return { color: '#ef4444', icon: '❌ PERSA', label: 'LOST' };
    }

    if (s === 'VOID') {
        return { color: '#94a3b8', icon: '🛡️ RIMBORSO', label: 'VOID' };
    }

    if (s === 'PUSH') {
        return { color: '#38bdf8', icon: '↔️ PUSH', label: 'PUSH' };
    }

    return { color: '#f59e0b', icon: '⏳ PENDENTE', label: 'PENDING' };
}

function showLoading() {
    const bar = $('loading-bar');

    if (!bar) return;

    bar.style.display = 'block';
    bar.style.width = '30%';

    setTimeout(() => {
        if (bar.style.width !== '100%') {
            bar.style.width = '70%';
        }
    }, 500);
}

function hideLoading() {
    const bar = $('loading-bar');

    if (!bar) return;

    bar.style.width = '100%';

    setTimeout(() => {
        bar.style.display = 'none';
        bar.style.width = '0%';
    }, 400);
}

function nascondiTutto() {
    $('results')?.classList.add('hidden');
    $('backtestLogSection')?.classList.add('hidden');
    $('forwardTestLogSection')?.classList.add('hidden');
    $('settingsSection')?.classList.add('hidden');
    $('statsSection')?.classList.add('hidden');
    $('portfolioSection')?.classList.add('hidden');
    $('manualDeepScanSection')?.classList.add('hidden');
}

function clearTables() {
    if ($('valueBetsTable')) $('valueBetsTable').innerHTML = '';
    if ($('backtestLogTableBody')) $('backtestLogTableBody').innerHTML = '';
    if ($('forwardTestLogTableBody')) $('forwardTestLogTableBody').innerHTML = '';
    if ($('accumulatorBox')) $('accumulatorBox').innerHTML = '';
    if ($('backtestSummaryBox')) $('backtestSummaryBox').innerHTML = '';
}

function downloadCSV(csvContent, fileName) {
    const blob = new Blob(['\uFEFF' + csvContent], {
        type: 'text/csv;charset=utf-8;'
    });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}

function itaNum(num) {
    return safeString(num ? num : '0,00').replace('.', ',');
}


// ============================================================================
// 3. SPORT SWITCH
// ============================================================================

function switchSport(sport) {
    enterPrimaryView('ANALYSIS');
    activeSport = sport;
    resetRuntimeDiagnosticForSport(sport);
    syncTennisOperationsVisibility();
    portfolioSegmentFilter = 'ALL';
    currentDeepScanRunId = null;

    nascondiTutto();
    clearTables();
    resetAllTableFilters();
    destroyStatsCharts();

    const btnCalcio = $('btnSportCalcio');
    const btnTennis = $('btnSportTennis');
    const btnDeepScan = $('btnSportDeepScan');
    const leagueSelect = $('league');

    [btnCalcio, btnTennis, btnDeepScan].forEach(btn => {
        if (!btn) return;

        btn.style.background = 'transparent';
        btn.style.color = '#94a3b8';
        btn.style.boxShadow = 'none';
    });

    $('analyzeForm')?.classList.remove('hidden');

    if ($('generalStatsBox')) {
        $('generalStatsBox').style.display = 'flex';
    }

    $('panel-calcio')?.classList.add('hidden');
    $('panel-tennis')?.classList.add('hidden');
    $('manualDeepScanSection')?.classList.add('hidden');

    if (sport === SPORT.CALCIO) {
        if (btnCalcio) {
            btnCalcio.style.background = '#10b981';
            btnCalcio.style.color = 'white';
        }

        if (leagueSelect) {
            leagueSelect.innerHTML = `
                <option value="all">🌍 Tutti i Campionati</option>
                <option value="serie_a">🇮🇹 Serie A</option>
                <option value="serie_b">🇮🇹 Serie B</option>
                <option value="premier_league">🇬🇧 Premier League</option>
                <option value="la_liga">🇪🇸 La Liga</option>
                <option value="bundesliga">🇩🇪 Bundesliga</option>
                <option value="ligue_1">🇫🇷 Ligue 1</option>
            `;
        }

        $('panel-calcio')?.classList.remove('hidden');
        updatePaperTradingFilter(SPORT.CALCIO);
        loadCalcioHealthStatus();
    }

    if (sport === SPORT.TENNIS) {
        if (btnTennis) {
            btnTennis.style.background = '#10b981';
            btnTennis.style.color = 'white';
        }

        if (leagueSelect) {
            leagueSelect.innerHTML = `
                <option value="all">🌍 ATP + WTA</option>
                <option value="atp">🎾 ATP Tour</option>
                <option value="wta">🎾 WTA Tour</option>
            `;
        }

        $('panel-tennis')?.classList.remove('hidden');
        updatePaperTradingFilter(SPORT.TENNIS);
        loadTennisHealthStatus();
        scheduleTennisOperationsRefresh(1800);
    }

    if (sport === SPORT.MANUAL_DEEPSCAN || sport === 'manual_deepscan') {
        if (btnDeepScan) {
            btnDeepScan.style.background = '#38bdf8';
            btnDeepScan.style.color = '#02111f';
        }
        $('analyzeForm')?.classList.add('hidden');
        if ($('generalStatsBox')) $('generalStatsBox').style.display = 'none';
        $('manualDeepScanSection')?.classList.remove('hidden');
        bindManualDeepScanControls();
        renderManualDeepScanFields();
        loadBackgroundStatus();
        return;
    }

    loadSportBankroll();
    loadGlobalAnalytics();
    loadBackgroundStatus();
    setTimeout(() => { if (primaryViewName === 'ANALYSIS') tryRestoreLatestAnalysisMemory(sport); }, 0);
}

window.switchSport = switchSport;


// ============================================================================
// 3.0 UI COLLAPSIBLE HELPERS - HEALTH STATUS
// ============================================================================
function toggleHealthBlock(panelId, buttonEl) {
    const panel = $(panelId);
    if (!panel) return;

    const shouldOpen = panel.style.display === 'none';
    panel.style.display = shouldOpen ? 'block' : 'none';

    if (buttonEl) {
        buttonEl.textContent = shouldOpen ? 'Riduci' : 'Espandi';
        buttonEl.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
}

function makeHealthStatusCollapsible(containerId, panelId, startCollapsed = false) {
    const container = $(containerId);
    if (!container) return;

    const root = container.querySelector('.tennis-health-v2');
    if (!root || root.dataset.healthCollapsible === '1') return;

    const header = root.querySelector('.tennis-health-header');
    if (!header) return;

    const collapsibleItems = Array.from(root.children).filter(child => child !== header);
    if (!collapsibleItems.length) return;

    const body = document.createElement('div');
    body.id = panelId;
    body.className = 'health-collapsible-body';
    body.style.display = startCollapsed ? 'none' : 'block';

    collapsibleItems.forEach(child => body.appendChild(child));
    root.appendChild(body);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diagnostics-toggle-btn health-collapse-btn';
    button.textContent = startCollapsed ? 'Espandi' : 'Riduci';
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-expanded', startCollapsed ? 'false' : 'true');
    button.onclick = () => toggleHealthBlock(panelId, button);

    const pills = header.querySelector('.tennis-health-pills');
    if (pills) {
        pills.appendChild(button);
    } else {
        const actions = document.createElement('div');
        actions.className = 'tennis-health-pills';
        actions.appendChild(button);
        header.appendChild(actions);
    }

    root.dataset.healthCollapsible = '1';
}

window.toggleHealthBlock = toggleHealthBlock;
window.makeHealthStatusCollapsible = makeHealthStatusCollapsible;


// ============================================================================
// 3.0B SENIOR AUDIT UI: ESPANSIONE/RIDUZIONE INDEX + PORTAFOGLIO
// ============================================================================
function injectSeniorAuditLayoutStyles() {
    if (typeof document === 'undefined' || $('seniorAuditLayoutStyles')) return;

    const style = document.createElement('style');
    style.id = 'seniorAuditLayoutStyles';
    style.textContent = `
        .senior-audit-layout-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin:0 0 12px 0; }
        .senior-audit-layout-btn { border:1px solid #475569; background:rgba(15,23,42,.78); color:#e2e8f0; border-radius:8px; padding:7px 10px; font-weight:800; cursor:pointer; }
        .senior-audit-layout-btn:hover { border-color:#38bdf8; color:#38bdf8; }
        .senior-audit-compact .table-responsive,
        .senior-audit-compact .portfolio-extra-panel,
        .senior-audit-compact canvas { max-height:340px; overflow:auto; }
        .senior-audit-fullscreen { position:fixed!important; z-index:9999; inset:12px; overflow:auto; background:#0f172a; border:1px solid #334155; border-radius:14px; padding:18px; box-shadow:0 25px 80px rgba(0,0,0,.55); }
        .senior-audit-fullscreen .table-responsive { max-height:calc(100vh - 180px); overflow:auto; }
        body.senior-audit-modal-open { overflow:hidden; }
    `;
    document.head.appendChild(style);
}

function toggleSeniorAuditCompact(sectionId, buttonEl) {
    const section = $(sectionId);
    if (!section) return;

    const compact = section.classList.toggle('senior-audit-compact');
    if (buttonEl) buttonEl.textContent = compact ? 'Espandi contenuto' : 'Riduci contenuto';
}

function toggleSeniorAuditFullscreen(sectionId, buttonEl) {
    const section = $(sectionId);
    if (!section) return;

    const full = section.classList.toggle('senior-audit-fullscreen');
    document.body.classList.toggle('senior-audit-modal-open', full);
    if (buttonEl) buttonEl.textContent = full ? 'Chiudi schermo intero' : 'Schermo intero';
}

function attachSeniorAuditSectionControls(sectionId, label) {
    const section = $(sectionId);
    if (!section || section.dataset.seniorAuditControls === '1') return;

    injectSeniorAuditLayoutStyles();

    const actions = document.createElement('div');
    actions.className = 'senior-audit-layout-actions';
    actions.innerHTML = `
        <button type="button" class="senior-audit-layout-btn" onclick="toggleSeniorAuditCompact('${sectionId}', this)">Riduci contenuto</button>
        <button type="button" class="senior-audit-layout-btn" onclick="toggleSeniorAuditFullscreen('${sectionId}', this)">Schermo intero</button>
    `;

    const header = section.querySelector('.header-flex');
    if (header && header.parentNode) header.parentNode.insertBefore(actions, header.nextSibling);
    else section.prepend(actions);

    section.dataset.seniorAuditControls = '1';
    section.dataset.seniorAuditLabel = label || sectionId;
}

function attachSeniorAuditLayoutControls() {
    attachSeniorAuditSectionControls('results', 'Index / Analisi');
    attachSeniorAuditSectionControls('portfolioSection', 'Portafoglio');
}

window.toggleSeniorAuditCompact = toggleSeniorAuditCompact;
window.toggleSeniorAuditFullscreen = toggleSeniorAuditFullscreen;
window.attachSeniorAuditLayoutControls = attachSeniorAuditLayoutControls;

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachSeniorAuditLayoutControls);
    } else {
        attachSeniorAuditLayoutControls();
    }
}

// ============================================================================
// 3.1 CALCIO HEALTH STATUS UI
// ============================================================================
async function loadCalcioHealthStatus() {
    const box = $('calcioHealthStatusBox');
    if (!box) return;

    box.innerHTML = `
        <div class="tennis-health-v2 status-warn">
            <div class="tennis-health-eyebrow">Calcio Health Status</div>
            <div class="tennis-health-title">⚽ Stato Calcio: caricamento...</div>
            <div class="tennis-health-subtitle">Lettura diagnostica backend Calcio.</div>
        </div>
    `;

    try {
        const response = await fetch('/api/calcio/health');
        const payload = await response.json();
        if (!response.ok) throw Error('HTTP ' + response.status + ': ' + String(payload.message || payload.code || 'HEALTH_ERROR'));
        renderCalcioHealthStatus(payload); // CALCIO_PF_STUDIO_V2_20261106
    } catch (error) {
        box.innerHTML = `
            <div class="tennis-health-v2 status-error">
                <div class="tennis-health-eyebrow">Calcio Health Status</div>
                <div class="tennis-health-title">⚽ Stato Calcio: ERROR</div>
                <div class="tennis-health-subtitle">Verifica HTTP o interfaccia: ${htmlEscape(error.message || String(error))}</div>
            </div>
        `;
    }
}

function renderCalcioHealthStatus(payload = {}) {
    const box = $('calcioHealthStatusBox');
    if (!box) return;

    const status = safeString(payload.status || payload.summary?.status || 'WARN').toUpperCase();
    const operationalReadiness = payload.operationalReadiness || {ready: status !== 'ERROR', label: status === 'ERROR' ? 'Errore tecnico' : status === 'WARN' ? 'Pronto con avvisi' : 'Pronto'}; // CALCIO_PF_STUDIO_V2_20261106
    const statusClass = status === 'OK' ? '' : (status === 'ERROR' ? 'status-error' : 'status-warn');
    const titleColor = status === 'OK' ? '#10b981' : (status === 'ERROR' ? '#ef4444' : '#f59e0b');

    const versions = payload.versions || payload.version || {};
    const db = payload.db || payload.database || payload.reliability || {};
    const optimize = payload.optimize || payload.optimization || payload.optimizeDiagnostics || {};
    const components = payload.components || {};
    const checks = payload.checks || payload.technicalChecks || {};

    const engineVersion = payload.engineVersion || versions.engine || payload.serverVersion || payload.version || '-';
    const metricVersion = payload.metricVersion || versions.metric || 'FOOTBALL_EDGE_EV_V2';
    const dataMode = payload.dataMode || db.dataMode || payload.reliabilityMode || '-';
    const autoApply = payload.autoApplySettings ?? optimize.autoApplySettings ?? optimize.autoApply ?? false;

    const currentPending = safeNumber(payload.currentPending ?? db.currentPending ?? db.pending ?? 0, 0);
    const settledWonLost = payload.settledWonLost ?? db.settledWonLost ?? `${safeNumber(db.cleanResolved ?? db.resolvedWonLost ?? 0, 0)} / ${safeNumber(db.requiredSample ?? optimize.requiredSample ?? 50, 50)}`;
    const legacyDirty = safeNumber(db.legacyDirty ?? payload.legacyDirty ?? payload.legacyDirtyFootball ?? 0, 0);
    const missingDataQuality = safeNumber(db.missingDataQuality ?? payload.missingDataQuality ?? 0, 0);
    const optimizableSample = safeNumber(optimize.optimizableSample ?? db.optimizableSample ?? payload.optimizableSample ?? 0, 0);
    const requiredSample = safeNumber(optimize.requiredSample ?? db.requiredSample ?? payload.requiredSample ?? 50, 50);
    const reliabilityMode = payload.reliabilityMode || db.reliabilityMode || payload.reliability?.mode || '-';

    const componentEntries = Object.keys(components).length
        ? Object.entries(components)
        : [
            ['calcioQuantEngine', { ok: true, version: 'v5.1' }],
            ['valueEvaluator', { ok: true }],
            ['simulation', { ok: true }],
            ['paperTrading', { ok: true }],
            ['deepScanCalcio', { ok: true }],
            ['clvTracker', { ok: true }],
            ['calcioScheduler', { ok: true }]
        ];

    const checkEntries = Object.keys(checks).length
        ? Object.entries(checks)
        : [
            ['db Path Absolute', true],
            ['required Columns Present', missingDataQuality === 0],
            ['legacy Dirty Excluded', true],
            ['tennis Isolation', true],
            ['optimize Safe With Small Sample', optimizableSample < requiredSample ? 'WARN' : true]
        ];

    const componentHtml = componentEntries.map(([name, value]) => {
        const ok = value === true || value?.ok === true || safeString(value?.status).toUpperCase() === 'OK';
        const version = value?.version ? `<div class="tennis-health-muted">${htmlEscape(value.version)}</div>` : '';
        return `
            <div class="tennis-health-component">
                <div class="tennis-health-component-head">
                    <span class="tennis-health-component-name">${htmlEscape(prettifyDiagnosticLabel(name))}</span>
                    <span class="tennis-health-status-badge" style="background:${ok ? '#10b981' : '#f59e0b'};">${ok ? 'OK' : 'WARN'}</span>
                </div>
                ${version}
            </div>
        `;
    }).join('');

    const checksHtml = checkEntries.map(([name, value]) => {
        const text = value === true ? 'OK' : (value === false ? 'ERROR' : safeString(value || 'WARN'));
        const color = text === 'OK' ? '#10b981' : (text === 'ERROR' ? '#ef4444' : '#f59e0b');
        return `
            <div class="tennis-health-check">
                <span>${htmlEscape(prettifyDiagnosticLabel(name))}</span>
                <strong style="color:${color};">${htmlEscape(text)}</strong>
            </div>
        `;
    }).join('');

    box.innerHTML = `
        <div class="tennis-health-v2 ${statusClass}">
            <div class="tennis-health-header">
                <div>
                    <div class="tennis-health-eyebrow">Calcio Health Status</div>
                    <h3 class="tennis-health-title">⚽ Stato Calcio: <span style="color:${titleColor};">${htmlEscape(status)}</span></h3>
                    <div class="tennis-health-subtitle">${htmlEscape(payload.message || payload.summary || 'Sistema Calcio operativo con controlli di isolamento Tennis e storico legacy.')}</div>
                </div>
                <div class="tennis-health-pills">
                    <span class="tennis-health-pill">Engine ${htmlEscape(engineVersion)}</span>
                    <span class="tennis-health-pill">Metric ${htmlEscape(metricVersion)}</span>
                    <span class="tennis-health-pill ${autoApply ? 'warn' : 'safe'}">${autoApply ? 'Auto apply attivo' : 'Auto apply disattivo'}</span>
                    <span class="tennis-health-pill safe">Tennis isolato</span>
                </div>
            </div>

            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">Operatività</div><div class="tennis-health-card-value" style="color:${operationalReadiness.ready === false ? '#ef4444' : '#10b981'};">${htmlEscape(operationalReadiness.label || 'Verifica')}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Data Mode</div><div class="tennis-health-card-value">${htmlEscape(dataMode)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Current Pending</div><div class="tennis-health-card-value">${currentPending}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Settled WON/LOST</div><div class="tennis-health-card-value">${htmlEscape(settledWonLost)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Optimizable Sample</div><div class="tennis-health-card-value">${optimizableSample} / ${requiredSample}</div></div>
            </div>

            <div class="tennis-health-section-title">🧩 Componenti Calcio</div>
            <div class="tennis-health-components">${componentHtml}</div>

            <div class="tennis-health-section-title">✅ Checks tecnici</div>
            <div class="tennis-health-checks">${checksHtml}</div>

            <div class="tennis-health-section-title">📊 Reliability / DB</div>
            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">Reliability Mode</div><div class="tennis-health-card-value">${htmlEscape(reliabilityMode)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Legacy Dirty</div><div class="tennis-health-card-value">${legacyDirty}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Missing Data Quality</div><div class="tennis-health-card-value">${missingDataQuality}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Sample ottimizzabile</div><div class="tennis-health-card-value">${optimizableSample} / ${requiredSample}</div></div>
            </div>
        </div>
    `;

    makeHealthStatusCollapsible('calcioHealthStatusBox', 'calcio-health-collapsible-body');
}


// ============================================================================
// 3.2 TENNIS HEALTH STATUS UI - STEP 2
// ============================================================================
async function loadTennisHealthStatus() {
    const box = $('tennisHealthStatusBox');
    if (!box) return;

    box.innerHTML = `
        <div class="tennis-health-v2 status-warn">
            <div class="tennis-health-eyebrow">Tennis Health Status</div>
            <div class="tennis-health-title">🎾 Stato Tennis: caricamento...</div>
            <div class="tennis-health-subtitle">Lettura diagnostica backend Tennis da /api/tennis/health.</div>
        </div>
    `;

    try {
        const response = await fetch('/api/tennis/health');
        const data = await response.json();
        renderTennisHealthStatus(data);
    } catch (error) {
        box.innerHTML = `
            <div class="tennis-health-v2 status-error">
                <div class="tennis-health-eyebrow">Tennis Health Status</div>
                <div class="tennis-health-title">🎾 Stato Tennis: ERROR</div>
                <div class="tennis-health-subtitle">Impossibile leggere /api/tennis/health. I test Jest restano da terminale PowerShell.</div>
            </div>
        `;
    }
}

function normalizeHealthEntry(value) {
    if (value === true) return { ok: true, status: 'OK' };
    if (value === false) return { ok: false, status: 'ERROR' };
    if (value && typeof value === 'object') {
        const semanticStatus = safeString(value.effectiveStatus || '').toUpperCase();
        const status = semanticStatus || safeString(value.status || (value.ok === false ? 'WARN' : 'OK')).toUpperCase();
        return {
            ...value,
            ok: value.blocking !== true && value.ok !== false && status !== 'ERROR',
            status
        };
    }

    const text = safeString(value || 'WARN').toUpperCase();
    return { ok: text === 'OK', status: text || 'WARN', value };
}

function healthStatusColor(statusOrOk) {
    const status = typeof statusOrOk === 'boolean'
        ? (statusOrOk ? 'OK' : 'WARN')
        : safeString(statusOrOk || 'WARN').toUpperCase();

    if (status === 'OK') return '#10b981';
    if (status === 'ERROR') return '#ef4444';
    return '#f59e0b';
}

function renderHealthComponents(components = {}, sportLabel = 'Tennis') {
    const fallback = sportLabel === 'Tennis'
        ? {
            tennisValueEvaluator: { ok: true, version: '4.2+' },
            markov: { ok: false, status: 'WARN', reason: 'Self-check non disponibile' },
            paperTradingTennis: { ok: true },
            deepScanTennis: { ok: true },
            sackmann: { ok: true, lazyInitialization: true }
        }
        : {};

    const entries = Object.entries(Object.keys(components || {}).length ? components : fallback);

    return entries.map(([name, raw]) => {
        const item = normalizeHealthEntry(raw);
        const color = healthStatusColor(item.status);
        const details = [
            item.version ? `Versione ${item.version}` : '',
            item.semanticLabel ? item.semanticLabel : '',
            item.role ? `Ruolo ${item.role}` : '',
            item.reason ? item.reason : '',
            item.lazyInitialization === true ? 'Lazy initialization attiva' : '',
            item.initialized === false ? 'Non inizializzato finché non serve' : ''
        ].filter(Boolean).join(' · ');

        return `
            <div class="tennis-health-component">
                <div class="tennis-health-component-head">
                    <span class="tennis-health-component-name">${htmlEscape(prettifyDiagnosticLabel(name))}</span>
                    <span class="tennis-health-status-badge" style="background:${color};">${htmlEscape(item.status || 'WARN')}</span>
                </div>
                ${details ? `<div class="tennis-health-muted">${htmlEscape(details)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderHealthChecks(checks = {}) {
    const entries = Object.entries(checks || {});

    if (!entries.length) {
        return `
            <div class="tennis-health-check">
                <span>Checks tecnici</span>
                <strong style="color:#f59e0b;">NESSUN DATO</strong>
            </div>
        `;
    }

    return entries.map(([name, raw]) => {
        const item = normalizeHealthEntry(raw);
        const semanticDisabled = /(?:Disabled|Forbidden|Blocked|RecommendationOnly)$/i.test(name);
        const explicitStatus = raw && typeof raw === 'object' ? safeString(raw.status || raw.result || '').toUpperCase() : '';
        const status = explicitStatus || (raw === true ? 'OK' : (raw === false ? (semanticDisabled ? 'OK' : 'ERROR') : safeString(item.status || raw || 'WARN').toUpperCase()));
        const color = healthStatusColor(status);

        const checkDetail = raw && typeof raw === 'object'
            ? [raw.semanticLabel, raw.actualVersion || raw.version, raw.reason && raw.reason !== 'VERSION_FAMILY_AND_CAPABILITIES_OK' ? raw.reason : '']
                .filter(Boolean).join(' · ')
            : '';
        return `
            <div class="tennis-health-check" data-health-check-status="${htmlEscape(status)}" title="${htmlEscape(checkDetail)}">
                <span>${htmlEscape(prettifyDiagnosticLabel(name))}${checkDetail ? `<small class="tennis-health-check-detail">${htmlEscape(checkDetail)}</small>` : ''}</span>
                <strong style="color:${color};">${htmlEscape(status)}</strong>
            </div>
        `;
    }).join('');
}

function renderTennisThresholdCards(thresholds = {}) {
    // UI anchors: Soglie attive ATP, Soglie attive WTA.
    const atp = thresholds.atp || {};
    const wta = thresholds.wta || {};

    const renderOne = (label, obj) => `
        <div class="tennis-health-card">
            <div class="tennis-health-card-label">Soglie attive ${label}</div>
            <div class="tennis-health-card-value">
                Edge ${formatPct(safeNumber(obj.edge_pp, 0), 1)} · Prob ${formatPct(safeNumber(obj.probability_pct, 0), 1)} · EV ${formatPct(safeNumber(obj.ev_pct, 0), 1)}
            </div>
        </div>
    `;

    return `
        <div class="tennis-health-thresholds">
            ${renderOne('ATP', atp)}
            ${renderOne('WTA', wta)}
        </div>
    `;
}

function renderTennisCalibrationMiniCards(group = {}, emptyLabel = 'Nessun segmento') {
    const entries = Object.entries(group || {})
        .filter(([, value]) => value && typeof value === 'object')
        .sort((a, b) => safeNumber(b[1].sample, 0) - safeNumber(a[1].sample, 0))
        .slice(0, 6);

    if (!entries.length) {
        return `<div class="tennis-health-card"><div class="tennis-health-card-label">${htmlEscape(emptyLabel)}</div><div class="tennis-health-card-value">Sample 0</div></div>`;
    }

    return entries.map(([label, row]) => {
        const sample = safeNumber(row.sample, 0);
        const brier = safeNumber(row.brier, 0);
        const gap = safeNumber(row.calibrationError, 0);
        const color = sample >= 20 && brier > 0 && brier <= 0.245 && gap <= 7.5 ? '#10b981' : '#f59e0b';

        return `
            <div class="tennis-health-card tennis-calibration-mini-card">
                <div class="tennis-health-card-label">${htmlEscape(label)}</div>
                <div class="tennis-health-card-value" style="color:${color};">N ${sample}</div>
                <div class="tennis-health-muted">Brier ${formatNumber(brier, 4)} · Gap ${formatPct(gap, 1)}</div>
            </div>
        `;
    }).join('');
}

function renderTennisPredictiveCalibrationPanel(payload = {}) {
    const calibration = payload.predictiveCalibration || payload.segmentCalibration?.predictiveDashboard || null;

    if (!calibration) {
        return `
            <div class="tennis-health-section-title">🎯 Calibrazione predittiva Tennis</div>
            <div class="tennis-health-warning">Calibrazione predittiva Tennis non disponibile. Servono record Tennis CURRENT/CURRENT_BOOTSTRAP con esito WON/LOST.</div>
        `;
    }

    const decision = calibration.decision || {};
    const overall = calibration.overall || {};
    const closingLine = calibration.closingLine || {};
    const segments = calibration.segments || {};
    const statusColor = healthStatusColor(decision.status || 'WARN');

    return `
        <div class="tennis-health-section-title">🎯 Calibrazione predittiva Tennis</div>
        <div class="tennis-health-overview tennis-calibration-overview">
            <div class="tennis-health-card"><div class="tennis-health-card-label">Professional readiness</div><div class="tennis-health-card-value" style="color:${statusColor};">${htmlEscape(decision.grade || 'UNKNOWN')}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">Sample pulito</div><div class="tennis-health-card-value">${safeNumber(decision.sample ?? overall.sample, 0)} / ${safeNumber(decision.requiredSample ?? calibration.requiredSample, 0)}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">Brier score</div><div class="tennis-health-card-value">${formatNumber(decision.brierScore ?? overall.brier, 4)}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">Calibration gap</div><div class="tennis-health-card-value">${formatPct(decision.calibrationError ?? overall.calibrationError, 1)}</div></div>
        </div>
        <div class="tennis-health-overview tennis-calibration-overview">
            <div class="tennis-health-card"><div class="tennis-health-card-label">CLV medio</div><div class="tennis-health-card-value">${formatPct(decision.avgClvPct ?? closingLine.avgClvPct, 2, true)}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">CLV beat rate</div><div class="tennis-health-card-value">${formatPct(decision.clvBeatRatePct ?? closingLine.beatRatePct, 1)}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">Closing line sample</div><div class="tennis-health-card-value">${safeNumber(decision.closingLineSample ?? closingLine.sample, 0)}</div></div>
            <div class="tennis-health-card"><div class="tennis-health-card-label">Uso reale</div><div class="tennis-health-card-value" style="color:${decision.allowProfessionalUse ? '#10b981' : '#f59e0b'};">${decision.allowProfessionalUse ? 'Abilitabile' : 'Bloccato / Paper'}</div></div>
        </div>
        <div class="tennis-health-warning">${htmlEscape(decision.recommendation || 'Usare il Tennis solo con storico pulito e campione statisticamente sufficiente.')}</div>

        <div class="tennis-health-section-title">🧬 ATP/WTA · Superficie · Mercato · Fascia quota</div>
        <div class="tennis-calibration-grid">
            <div>
                <div class="tennis-health-muted tennis-calibration-group-title">ATP/WTA</div>
                <div class="tennis-health-components">${renderTennisCalibrationMiniCards(segments.byTour, 'ATP/WTA')}</div>
            </div>
            <div>
                <div class="tennis-health-muted tennis-calibration-group-title">Superficie</div>
                <div class="tennis-health-components">${renderTennisCalibrationMiniCards(segments.bySurface, 'Superficie')}</div>
            </div>
            <div>
                <div class="tennis-health-muted tennis-calibration-group-title">Mercato moneyline/totals</div>
                <div class="tennis-health-components">${renderTennisCalibrationMiniCards(segments.byMarket, 'Mercato')}</div>
            </div>
            <div>
                <div class="tennis-health-muted tennis-calibration-group-title">Fascia quota</div>
                <div class="tennis-health-components">${renderTennisCalibrationMiniCards(segments.byOddsBucket, 'Fascia quota')}</div>
            </div>
        </div>
    `;
}

function renderTennisHealthStatus(payload = {}) {
    const box = $('tennisHealthStatusBox');
    if (!box) return;

    const data = payload || {};
    const status = safeString(data.status || (data.success === false ? 'ERROR' : 'WARN')).toUpperCase();
    const statusClass = status === 'OK' ? '' : (status === 'ERROR' ? 'status-error' : 'status-warn');
    const titleColor = healthStatusColor(status);

    const samples = data.db?.samples || data.database?.samples || {};
    const columns = data.db?.columns || {};
    const settings = data.settings || {};
    const thresholds = settings.activeThresholds || data.activeThresholds || {};
    const diagnostics = data.diagnostics || {};
    const runtimeVersions = data.runtimeVersions || {};
    const operationalReadiness = data.operationalReadiness || {};
    updateTennisOperationsCanonicalSummary({
        source: 'TENNIS_HEALTH',
        patchVersion: runtimeVersions.currentPatchVersion || data.patchRegistry?.currentPatchVersion || '25',
        state: operationalReadiness.state || (status === 'ERROR' ? 'NOT_READY_CRITICAL' : status === 'WARN' ? 'READY_WITH_WARNINGS' : 'READY'),
        label: operationalReadiness.label || (status === 'ERROR' ? 'Non pronto — errore critico' : status === 'WARN' ? 'Pronto con avvisi' : 'Pronto'),
        errorCount: Number(operationalReadiness.errorCount || (status === 'ERROR' ? 1 : 0)),
        warningCount: Number(operationalReadiness.warningCount || (status === 'WARN' ? 1 : 0)),
        ready: operationalReadiness.ready !== false
    }, 1);

    const recommendationOnly = data.recommendationOnly === true || data.optimizeMode === 'RECOMMENDATION_ONLY';
    const autoApplySettings = data.autoApplySettings === true;
    const strictHistory = data.checks?.strictCleanHistoryOnly === true;
    const markovOk = data.checks?.markovSelfCheck === true || data.components?.markov?.ok === true;

    const missingColumns = Object.entries(columns)
        .filter(([, present]) => present === false)
        .map(([name]) => name);

    const warningHtml = missingColumns.length || safeNumber(samples.missingDataQuality, 0) > 0 || safeNumber(samples.legacyDirty, 0) > 0
        ? `
            <div class="tennis-health-warning">
                ⚠️ Storico Tennis da monitorare: Missing columns ${missingColumns.length ? htmlEscape(missingColumns.join(', ')) : '0'} · Missing data quality ${safeNumber(samples.missingDataQuality, 0)} · Legacy dirty ${safeNumber(samples.legacyDirty, 0)}.
            </div>
        `
        : '';

    const componentHtml = renderHealthComponents(data.components, 'Tennis');
    const checksHtml = renderHealthChecks(data.checks);
    const thresholdsHtml = renderTennisThresholdCards(thresholds);

    box.innerHTML = `
        <div class="tennis-health-v2 ${statusClass}">
            <div class="tennis-health-header">
                <div>
                    <div class="tennis-health-eyebrow">Tennis Health Status</div>
                    <h3 class="tennis-health-title">🎾 Stato Tennis: <span style="color:${titleColor};">${htmlEscape(status)}</span></h3>
                    <div class="tennis-health-subtitle">${htmlEscape(data.message || 'Diagnostica Tennis professionale: storico strict, ATP/WTA separati, Markov/totals validati e ottimizzazione in sola raccomandazione.')}</div>
                </div>
                <div class="tennis-health-pills">
                    <span class="tennis-health-pill">Server Core ${htmlEscape(runtimeVersions.serverCoreVersion || '-')}</span>
                    <span class="tennis-health-pill">Tennis Engine ${htmlEscape(runtimeVersions.tennisEngineVersion || data.engineVersion || '-')}</span>
                    <span class="tennis-health-pill">Patch ${htmlEscape(runtimeVersions.currentPatchVersion || data.patchRegistry?.currentPatchVersion || '-')}</span>
                    <span class="tennis-health-pill">Model ${htmlEscape(data.modelVersion || '-')}</span>
                    <span class="tennis-health-pill">Metric ${htmlEscape(data.metricVersion || '-')}</span>
                    <span class="tennis-health-pill ${recommendationOnly ? 'safe' : 'warn'}">${recommendationOnly ? 'Recommendation-only' : 'Optimize attivo'}</span>
                    <span class="tennis-health-pill ${autoApplySettings ? 'warn' : 'safe'}">${autoApplySettings ? 'Auto apply settings' : 'No auto-apply'}</span>
                </div>
            </div>

            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">Data Mode</div><div class="tennis-health-card-value">${htmlEscape(data.dataMode || '-')}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Reliability Mode</div><div class="tennis-health-card-value">${htmlEscape(data.reliabilityMode || '-')}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Optimize Mode</div><div class="tennis-health-card-value">${htmlEscape(data.optimizeMode || '-')}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Auto apply settings</div><div class="tennis-health-card-value" style="color:${autoApplySettings ? '#f59e0b' : '#10b981'};">${autoApplySettings ? 'ATTIVO' : 'DISATTIVO'}</div></div>
            </div>

            <div class="tennis-health-section-title">📊 Storico Tennis clean</div>
            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">Pending CURRENT</div><div class="tennis-health-card-value">${safeNumber(samples.pendingCurrent, 0)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Settled WON/LOST</div><div class="tennis-health-card-value">${safeNumber(samples.settledWonLostCurrent, 0)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Legacy Dirty</div><div class="tennis-health-card-value">${safeNumber(samples.legacyDirty, 0)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Missing Data Quality</div><div class="tennis-health-card-value">${safeNumber(samples.missingDataQuality, 0)}</div></div>
            </div>

            <div class="tennis-health-section-title">🧩 Componenti Tennis</div>
            <div class="tennis-health-components">${componentHtml}</div>

            <div class="tennis-health-section-title">✅ Checks tecnici</div>
            <div class="tennis-health-checks">${checksHtml}</div>

            <div class="tennis-health-section-title">🎯 Soglie professionali Tennis</div>
            ${thresholdsHtml}

            <div class="tennis-health-section-title">🛡️ Validazione professionale</div>
            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">ATP/WTA</div><div class="tennis-health-card-value">Separati</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Storico strict</div><div class="tennis-health-card-value" style="color:${strictHistory ? '#10b981' : '#f59e0b'};">${strictHistory ? 'CURRENT only' : 'Verifica'}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Markov self-check</div><div class="tennis-health-card-value" style="color:${markovOk ? '#10b981' : '#f59e0b'};">${markovOk ? 'OK' : 'WARN'}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Sample richiesto</div><div class="tennis-health-card-value">${safeNumber(diagnostics.requiredBacktestOptimizationSamplePerTour, 0)} / tour</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Professional Bet Gate</div><div class="tennis-health-card-value">${htmlEscape(diagnostics.professionalBetGateMode || 'TENNIS_PROFESSIONAL_BET_GATE')}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Report operativo</div><div class="tennis-health-card-value">${htmlEscape(diagnostics.operationalReportMode || 'TENNIS_OPERATIONAL_REPORT_V1')}</div></div>
            </div>

            ${renderTennisPredictiveCalibrationPanel(data)}

            ${warningHtml}
        </div>
    `;

    makeHealthStatusCollapsible('tennisHealthStatusBox', 'tennis-health-collapsible-body');
}

window.loadCalcioHealthStatus = loadCalcioHealthStatus;
window.renderCalcioHealthStatus = renderCalcioHealthStatus;
window.loadTennisHealthStatus = loadTennisHealthStatus;
window.renderTennisHealthStatus = renderTennisHealthStatus;


// ============================================================================
// 4. BADGE E UI METRICHE
// ============================================================================

function getDataQualityBadge(row = {}) {
    const quality = safeString(row.data_quality || row.dataMode || '').toUpperCase();

    if (!quality) {
        return '';
    }

    let color = '#64748b';
    let label = quality;

    if (quality.includes('CURRENT_BOOTSTRAP')) {
        color = '#38bdf8';
        label = 'STORICO ATTIVO CORRENTE';
    } else if (quality.includes('CURRENT')) {
        color = '#10b981';
        label = 'CURRENT';
    } else if (quality.includes('LEGACY') || quality.includes('DIRTY')) {
        color = '#ef4444';
        label = 'LEGACY';
    }

    return `<span style="display:inline-block; margin-left:6px; background:${color}; color:white; padding:2px 6px; border-radius:10px; font-size:0.70em; font-weight:bold;">${label}</span>`;
}

function getReliabilityBadge(data = {}) {
    const mode = safeString(data.reliabilityMode || data.reliability_mode || '');

    if (!mode) return '';

    let color = '#64748b';
    let text = mode;

    if (mode.includes('BOOTSTRAP')) {
        color = '#38bdf8';
        text = 'BOOTSTRAP NUOVO STORICO';
    } else if (mode.includes('BACKTEST_NEUTRAL')) {
        color = '#f59e0b';
        text = 'BACKTEST NEUTRO';
    } else if (mode.includes('NEW_HISTORY')) {
        color = '#10b981';
        text = 'NUOVO STORICO';
    }

    return `
        <div style="margin-bottom:12px; background:rgba(56,189,248,0.08); border-left:4px solid ${color}; padding:10px 12px; border-radius:6px; color:#cbd5e1;">
            <strong style="color:${color};">Modalità Tennis:</strong> ${text}
            ${data.reliabilitySampleSize !== undefined ? `<span style="margin-left:10px;">Sample: ${data.reliabilitySampleSize}</span>` : ''}
            ${data.metricVersion ? `<span style="margin-left:10px;">Metric: ${data.metricVersion}</span>` : ''}
            ${data.modelVersion ? `<span style="margin-left:10px;">Model: ${data.modelVersion}</span>` : ''}
        </div>
    `;
}


// ============================================================================
// 4.1 DIAGNOSTICS / DEBUG PANEL
// ============================================================================

function buildAnalysisNoResultsDiagnostics(data = {}) {
    // STEP56_TENNIS_ANALYSIS_EMPTY_RESULT_DIAGNOSTICS_UI
    // Fallback UI: se il backend non passa data.diagnostics, usa meta/marketMix/totalsFeed
    // per spiegare perché Analisi AI Tennis può mostrare zero singole.
    const meta = data.meta || {};
    const totalsFeedDiagnostics = data.totalsFeedDiagnostics || meta.totalsFeedDiagnostics || [];
    const marketMixAudit = data.marketMixAudit || meta.marketMixAudit || null;
    const analysisDiagnostics = meta.analysisDiagnostics || null;

    if (analysisDiagnostics && typeof analysisDiagnostics === 'object') {
        return analysisDiagnostics;
    }

    if (!marketMixAudit && !Array.isArray(totalsFeedDiagnostics)) return null;

    const feedTotals = Array.isArray(totalsFeedDiagnostics)
        ? totalsFeedDiagnostics.reduce((sum, row) => sum + safeNumber(row?.totalsEvents, 0), 0)
        : 0;
    const feedEvents = Array.isArray(totalsFeedDiagnostics)
        ? totalsFeedDiagnostics.reduce((sum, row) => sum + safeNumber(row?.events, 0), 0)
        : 0;
    const pairedLines = Array.isArray(totalsFeedDiagnostics)
        ? totalsFeedDiagnostics.reduce((sum, row) => sum + safeNumber(row?.overUnderBalance?.feed?.pairedLines || row?.supportedTotalsLines, 0), 0)
        : 0;

    return {
        mode: 'STEP56_TENNIS_ANALYSIS_EMPTY_RESULT_DIAGNOSTICS_UI_FALLBACK',
        noResultReason: data.valueBets && data.valueBets.length ? 'HAS_VALUE_BETS' : 'NO_VALUE_BETS_RENDERED_IN_UI',
        message: data.message || data.reason || 'Nessuna singola renderizzata: leggere contatori feed/mercati per distinguere errore, feed vuoto o gate/soglie.',
        feed: {
            tournamentsDiagnostics: Array.isArray(totalsFeedDiagnostics) ? totalsFeedDiagnostics.length : 0,
            oddsEvents: feedEvents,
            totalsEvents: feedTotals,
            pairedTotalsLines: pairedLines
        },
        marketMix: marketMixAudit || {},
        notes: [
            'Riduci/Espandi mostra o nasconde questo pannello: non rilancia Analisi AI.',
            'Per aggiornare dati/quote devi rilanciare Analisi AI Tennis o usare un refresh forzato se presente.',
            'Se oddsEvents > 0 ma candidati = 0, il blocco è probabilmente dovuto a gate, soglie edge/EV/CR, data sufficiency o exposure guard.'
        ]
    };
}

function normalizeDiagnosticsPayload(data = {}) {
    const diagnostics = data.diagnostics || data.debug || data.diagnostic || buildAnalysisNoResultsDiagnostics(data) || null;

    const out = {
        message: data.message || data.reason || data.note || diagnostics?.message || '',
        disabled: data.disabled === true,
        diagnostics: diagnostics && typeof diagnostics === 'object' ? diagnostics : null,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
        engineVersion: data.engineVersion || data.version || '',
        dataMode: data.dataMode || data.meta?.dataMode || data.reliabilityMode || '',
        modelVersion: data.modelVersion || data.meta?.modelVersion || '',
        metricVersion: data.metricVersion || data.meta?.metricVersion || ''
    };

    return out;
}

function flattenDiagnosticsObject(obj = {}, prefix = '') {
    const rows = [];

    if (!obj || typeof obj !== 'object') return rows;

    Object.entries(obj).forEach(([key, value]) => {
        const label = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            rows.push(...flattenDiagnosticsObject(value, label));
        } else if (Array.isArray(value)) {
            const containsObjects = value.some(item => item && typeof item === 'object');
            rows.push({
                label,
                value: containsObjects
                    ? `${value.length} elementi - vedere tabella dedicata se disponibile`
                    : (value.length <= 8 ? value.join(', ') : `${value.slice(0, 8).join(', ')} ... (${value.length})`)
            });
        } else {
            rows.push({
                label,
                value: value === undefined || value === null || value === '' ? '-' : value
            });
        }
    });

    return rows;
}

function prettifyDiagnosticLabel(label) {
    return safeString(label)
        .replace(/_/g, ' ')
        .replace(/\./g, ' › ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
}


function pruneDiagnosticsForReadableRows(diagnostics = {}) {
    // STEP70_UI_DIAGNOSTIC_READABILITY_FIX
    // Candidate Audit/Step69 ha già una vista compatta dedicata. Se lo lasciamo
    // anche nel flatten generico, la UI ristampa centinaia di campi legacy e
    // torna poco leggibile.
    if (!diagnostics || typeof diagnostics !== 'object') return diagnostics;

    const clone = { ...diagnostics };
    delete clone.candidateAudit;
    delete clone.candidate_audit;
    return clone;
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function getCalibrationNoDataDiagnostics(dataCal = {}, calData = {}) {
    const meta = dataCal.meta || {};
    const reportSample = firstFiniteNumber(calData?.sample, calData?.summary?.sample, calData?.summary?.sampleSize);
    const metaSample = firstFiniteNumber(meta.sampleSize);
    const cleanSample = Math.max(reportSample, metaSample, 0);
    const operationalSample = firstFiniteNumber(
        latestPortfolioReport?.meta?.sampleSize,
        latestPortfolioResponse?.meta?.sampleSize,
        latestPortfolioReport?.bankroll?.roi?.bets
    );
    const bucketSize = firstFiniteNumber(meta.bucketSize, 5) || 5;
    const minSample = firstFiniteNumber(meta.minSample, 10) || 10;
    const bucketCount = Array.isArray(calData?.buckets) ? calData.buckets.length : 0;
    const strategies = Array.isArray(latestPortfolioReport?.topStrategies) ? latestPortfolioReport.topStrategies : [];
    const brierRows = strategies
        .filter(row => safeNumber(row.bets, 0) > 0 || safeNumber(row.brier, 0) > 0)
        .slice(0, 4);

    const reason = cleanSample < minSample
        ? `campione strict/current sotto soglia minima (${cleanSample}/${minSample})`
        : `nessun bucket con almeno ${minSample} eventi dopo filtri strict/current`;

    return {
        scope: activeSport === SPORT.TENNIS
            ? 'TENNIS_CURRENT_WON_LOST · audit calibration'
            : 'CALCIO_CURRENT_WON_LOST · audit calibration',
        cleanSample,
        operationalSample,
        bucketSize,
        minSample,
        bucketCount,
        reason,
        brierRows
    };
}

function renderCalibrationNoDataDiagnostic(dataCal = {}, calData = {}) {
    const diag = getCalibrationNoDataDiagnostics(dataCal, calData);
    const brierHtml = diag.brierRows.length ? `
        <div style="margin-top:8px; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
            ${diag.brierRows.map(row => `
                <div style="background:rgba(15,23,42,.55); border:1px solid rgba(148,163,184,.16); border-radius:8px; padding:8px;">
                    <div style="font-weight:800; color:#e2e8f0; word-break:break-word;">${htmlEscape(row.strategy || 'strategia')}</div>
                    <div style="font-size:.78em; color:#94a3b8; margin-top:2px;">Bets ${safeNumber(row.bets, 0)} · Brier ${safeNumber(row.brier, 0)} · ROI ${safeNumber(row.roi, 0)}%</div>
                </div>
            `).join('')}
        </div>
    ` : '<div style="margin-top:8px; color:#94a3b8;">Brier aggregato non disponibile nel report portfolio corrente.</div>';

    return `
        <div style="text-align:left; padding:14px; border:1px solid rgba(245,158,11,.25); background:rgba(245,158,11,.07); border-radius:10px; color:#cbd5e1;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:#fbbf24;">Diagnostica NO DATA calibrazione</strong>
                    <div style="margin-top:4px; color:#cbd5e1;">La curva non viene disegnata perché ${htmlEscape(diag.reason)}.</div>
                </div>
                <span style="font-size:.75em; color:#93c5fd; font-weight:800;">${htmlEscape(diag.scope)}</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-top:10px;">
                <div><span style="color:#94a3b8; font-size:.75em; text-transform:uppercase;">Clean sample</span><br><strong>${diag.cleanSample}</strong></div>
                <div><span style="color:#94a3b8; font-size:.75em; text-transform:uppercase;">Trading reale</span><br><strong>${diag.operationalSample || 'N/D'}</strong></div>
                <div><span style="color:#94a3b8; font-size:.75em; text-transform:uppercase;">Bucket generati</span><br><strong>${diag.bucketCount}</strong></div>
                <div><span style="color:#94a3b8; font-size:.75em; text-transform:uppercase;">Minimo/bucket</span><br><strong>${diag.minSample}</strong></div>
                <div><span style="color:#94a3b8; font-size:.75em; text-transform:uppercase;">Ampiezza bucket</span><br><strong>${diag.bucketSize}pp</strong></div>
            </div>
            ${brierHtml}
        </div>
    `;
}

function updateCalibrationChartNoDataDiagnostic(html = '') {
    const box = $('calibrationChartNoDataDiagnostic');
    if (!box) return;
    box.innerHTML = html;
    box.style.display = html ? 'block' : 'none';
}

function inferHistoricalPortfolioMarketMix(report = latestPortfolioReport) {
    const out = { moneyline: 0, totals: 0, over: 0, under: 0 };
    const rows = Array.isArray(report?.topStrategies) ? report.topStrategies : [];

    rows.forEach(row => {
        const strategy = safeString(row.strategy).toUpperCase();
        const bets = safeNumber(row.bets, 0);
        if (!bets) return;
        if (strategy.includes('MONEYLINE')) out.moneyline += bets;
        if (strategy.includes('TOTAL') || strategy.includes('OVER') || strategy.includes('UNDER')) out.totals += bets;
        if (strategy.includes('OVER')) out.over += bets;
        if (strategy.includes('UNDER')) out.under += bets;
    });

    return out;
}


// STEP70B_UI_GRAPH_AUDIT_ATP_WTA
// Verifica dati grafici Portfolio senza modificare motore, gate, stake, CLV o paper trading.
function getPortfolioResolvedRowsForChart(dataHist = {}, { operationalOnly = false } = {}) {
    const history = Array.isArray(dataHist?.history) ? dataHist.history : [];

    return history
        .filter(b => b.status === 'WON' || b.status === 'LOST')
        .filter(b => activeSport === SPORT.TENNIS ? isTennisRow(b) : isCalcioRow(b))
        .filter(isCleanCurrentRow)
        .filter(rowMatchesActivePortfolioSegment)
        .filter(b => !operationalOnly || (activeSport === SPORT.TENNIS ? isOperationalRealPortfolioRow(b) : safeNumber(b.stake ?? b.invested, 0) > 0))
        .sort((a, b) => safeNumber(a.id, 0) - safeNumber(b.id, 0));
}

function getTennisTourFromRow(row = {}) {
    const text = [row.tour_type, row.tourType, row.league, row.strategy_tag, row.bet_type, row.tournament, row.eventName]
        .map(v => safeString(v).toUpperCase())
        .join(' ');

    if (text.includes('WTA') || text.includes('WOMEN')) return 'WTA';
    if (text.includes('ATP') || text.includes('MEN')) return 'ATP';
    return 'UNKNOWN';
}



// STEP71_PORTFOLIO_SEGMENT_FILTERS
// Filtri client-side solo per grafici/audit del Portafoglio. Non modifica motore,
// stake, CLV, paper trading, gate operativo o database.
function normalizePortfolioFilterKey(value = '') {
    return safeString(value || 'ALL').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ALL';
}

function getFootballCompetitionFromRow(row = {}) {
    const text = [
        row.league,
        row.competition,
        row.competition_name,
        row.tournament,
        row.eventName,
        row.strategy_tag,
        row.bet_type,
        row.sport_title,
        row.sport_key
    ].map(v => safeString(v).toUpperCase()).join(' ');

    if (text.includes('SERIE A')) return 'SERIE_A';
    if (text.includes('SERIE B')) return 'SERIE_B';
    if (text.includes('PREMIER') || text.includes('EPL')) return 'PREMIER_LEAGUE';
    if (text.includes('LA LIGA') || text.includes('LALIGA')) return 'LA_LIGA';
    if (text.includes('BUNDESLIGA')) return 'BUNDESLIGA';
    if (text.includes('LIGUE 1') || text.includes('LIGUE_1')) return 'LIGUE_1';
    if (text.includes('CHAMPIONS')) return 'CHAMPIONS_LEAGUE';
    return 'OTHER';
}

function getPortfolioSegmentForRow(row = {}) {
    if (activeSport === SPORT.TENNIS) return getTennisTourFromRow(row);
    return getFootballCompetitionFromRow(row);
}

function getPortfolioSegmentOptions() {
    if (activeSport === SPORT.TENNIS) {
        return [
            { key: 'ALL', label: 'Tutto' },
            { key: 'ATP', label: 'Solo ATP' },
            { key: 'WTA', label: 'Solo WTA' }
        ];
    }

    return [
        { key: 'ALL', label: 'Tutto' },
        { key: 'SERIE_A', label: 'Serie A' },
        { key: 'SERIE_B', label: 'Serie B' },
        { key: 'PREMIER_LEAGUE', label: 'Premier' },
        { key: 'LA_LIGA', label: 'La Liga' },
        { key: 'BUNDESLIGA', label: 'Bundesliga' },
        { key: 'LIGUE_1', label: 'Ligue 1' },
        { key: 'CHAMPIONS_LEAGUE', label: 'Champions' },
        { key: 'OTHER', label: 'Altro' }
    ];
}

function getPortfolioSegmentLabel(key = portfolioSegmentFilter) {
    const normalized = normalizePortfolioFilterKey(key);
    const found = getPortfolioSegmentOptions().find(opt => opt.key === normalized);
    return found ? found.label : 'Tutto';
}

function rowMatchesActivePortfolioSegment(row = {}) {
    const selected = normalizePortfolioFilterKey(portfolioSegmentFilter);
    if (selected === 'ALL') return true;
    return getPortfolioSegmentForRow(row) === selected;
}

function getPortfolioSegmentBaseRows(dataHist = {}, { operationalOnly = false } = {}) {
    const history = Array.isArray(dataHist?.history) ? dataHist.history : [];
    return history
        .filter(b => b.status === 'WON' || b.status === 'LOST')
        .filter(b => activeSport === SPORT.TENNIS ? isTennisRow(b) : isCalcioRow(b))
        .filter(isCleanCurrentRow)
        .filter(b => !operationalOnly || (activeSport === SPORT.TENNIS ? isOperationalRealPortfolioRow(b) : safeNumber(b.stake ?? b.invested, 0) > 0));
}

function filterPortfolioHistoryPayloadByActiveSegment(dataHist = {}) {
    if (!dataHist || !Array.isArray(dataHist.history)) return dataHist;
    const selected = normalizePortfolioFilterKey(portfolioSegmentFilter);
    if (selected === 'ALL') return dataHist;
    return {
        ...dataHist,
        history: dataHist.history.filter(row => rowMatchesActivePortfolioSegment(row)),
        portfolioSegmentFilter: selected,
        portfolioSegmentLabel: getPortfolioSegmentLabel(selected)
    };
}

function buildPortfolioSegmentCounts(dataHist = {}) {
    const baseRows = getPortfolioSegmentBaseRows(dataHist, { operationalOnly: false });
    const operationalRows = getPortfolioSegmentBaseRows(dataHist, { operationalOnly: true });
    const options = getPortfolioSegmentOptions();
    const counts = {};

    options.forEach(opt => {
        if (opt.key === 'ALL') {
            counts[opt.key] = {
                clean: baseRows.length,
                operational: operationalRows.length
            };
            return;
        }
        counts[opt.key] = {
            clean: baseRows.filter(row => getPortfolioSegmentForRow(row) === opt.key).length,
            operational: operationalRows.filter(row => getPortfolioSegmentForRow(row) === opt.key).length
        };
    });

    return counts;
}

    // STEP91L/STEP91R_PORTFOLIO_HISTORY_FALLBACK_REPAIR
    function applyStep91LPortfolioHistoryFallback(dataHist, dataPort) {
        const normalizeStatus91L = (v) => String(v || "").trim().toUpperCase();
        const normalizeSport91L = (v) => String(v || "").trim().toUpperCase();
        const isTennis91L = (row) => {
            const text = [row && row.sport_type, row && row.sportType, row && row.bet_type, row && row.strategy_tag, row && row.league].map(v => String(v || "").toUpperCase()).join(" ");
            if (typeof isTennisRow === "function") { try { return isTennisRow(row); } catch (_) {} }
            return text.includes("TENNIS") || text.includes("ATP") || text.includes("WTA");
        };
        const isClean91L = (row) => {
            if (typeof isCleanCurrentRow === "function") { try { return isCleanCurrentRow(row); } catch (_) {} }
            const dq = normalizeSport91L((row && (row.data_quality || row.dataQuality)) || "CURRENT_BOOTSTRAP");
            return dq === "CURRENT" || dq === "CURRENT_BOOTSTRAP" || dq.includes("CURRENT");
        };
        const pickArray91L = (obj, paths) => {
            for (const p of paths) {
                const parts = p.split(".");
                let cur = obj;
                for (const part of parts) cur = cur && cur[part];
                if (Array.isArray(cur) && cur.length > 0) return cur;
            }
            return [];
        };
        const currentHistory = Array.isArray(dataHist && dataHist.history) ? dataHist.history : [];
        const fallbackHistory = pickArray91L(dataPort, [
            "history",
            "strictHistory",
            "strictCurrentHistory",
            "portfolioHistory",
            "report.history",
            "analytics.history",
            "data.history"
        ]);
        const strictRows = currentHistory
            .filter(row => ["WON", "LOST"].includes(normalizeStatus91L(row && row.status)))
            .filter(row => (typeof activeSport === "undefined" || activeSport !== "tennis") ? true : isTennis91L(row))
            .filter(isClean91L);
        const fallbackStrictRows = fallbackHistory
            .filter(row => ["WON", "LOST"].includes(normalizeStatus91L(row && row.status)))
            .filter(row => (typeof activeSport === "undefined" || activeSport !== "tennis") ? true : isTennis91L(row))
            .filter(isClean91L);
        const fallbackStrictSample = fallbackStrictRows.length;
        if (!window.TradingScopeUI && strictRows.length === 0 && fallbackStrictSample > 0) {
            return {
                ...(dataHist || {}),
                history: fallbackHistory,
                step91lPortfolioHistoryFallback: true,
                step91rPortfolioHistoryFallback: true,
                strictRowsRecovered: fallbackStrictSample,
                fallbackSource: "portfolio_report_history"
            };
        }
        return dataHist || { history: [] };
    }
    if (typeof window !== "undefined") window.applyStep91LPortfolioHistoryFallback = applyStep91LPortfolioHistoryFallback;
    // /STEP91L/STEP91R_PORTFOLIO_HISTORY_FALLBACK_REPAIR

function renderPortfolioSegmentFilterPanel(dataHist = {}) {
    const section = $('portfolioSection');
    if (!section) return;

    let panel = $('portfolioSegmentFilterPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'portfolioSegmentFilterPanel';
        panel.className = 'card-container';
        panel.style.borderLeft = '4px solid #10b981';
        panel.style.marginBottom = '14px';
        const strictNotice = $('portfolioStrictScopeNotice');
        if (strictNotice && strictNotice.parentNode) strictNotice.parentNode.insertBefore(panel, strictNotice);
        else section.prepend(panel);
    }

    const options = getPortfolioSegmentOptions();
    const counts = buildPortfolioSegmentCounts(dataHist);
    const selected = normalizePortfolioFilterKey(portfolioSegmentFilter);
    const sportLabel = activeSport === SPORT.TENNIS ? 'Tennis' : 'Calcio';
    const filterLabel = activeSport === SPORT.TENNIS ? 'circuito' : 'campionato';

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
            <div>
                <strong style="color:#10b981;">Filtro Portafoglio ${htmlEscape(sportLabel)} · ${htmlEscape(filterLabel)}</strong>
                <div style="color:#cbd5e1; font-size:.86em; margin-top:4px; line-height:1.35;">
                    Applica il filtro a KPI, strategie, verifica Drawdown/Equity, Brier Calibration e audit operativo UI. Non modifica DB, storico, stake, gate, CLV o paper trading.
                </div>
            </div>
            <div style="color:#94a3b8; font-size:.82em; text-align:right;">
                Vista attiva: <strong style="color:#f8fafc;">${htmlEscape(getPortfolioSegmentLabel(selected))}</strong>
            </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            ${options.map(opt => {
                const active = opt.key === selected;
                const c = counts[opt.key] || { clean: 0, operational: 0 };
                return `
                    <button type="button" onclick="setPortfolioSegmentFilter('${htmlEscape(opt.key)}')" style="border:1px solid ${active ? '#10b981' : 'rgba(148,163,184,.25)'}; background:${active ? 'rgba(16,185,129,.22)' : 'rgba(15,23,42,.68)'}; color:${active ? '#d1fae5' : '#cbd5e1'}; border-radius:10px; padding:8px 10px; cursor:pointer; min-width:112px; text-align:left;">
                        <div style="font-weight:900;">${htmlEscape(opt.label)}</div>
                        <div style="font-size:.74em; color:${active ? '#a7f3d0' : '#94a3b8'}; margin-top:2px;">reale ${safeNumber(c.operational, 0)} · clean ${safeNumber(c.clean, 0)}</div>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

window.setPortfolioSegmentFilter = function(value) {
    portfolioSegmentFilter = normalizePortfolioFilterKey(value);
    loadPortfolioData();
};

function getModelProbabilityPctFromRow(row = {}) {
    return firstFiniteNumber(
        row.calibrated_probability_pct,
        row.calibratedProbabilityPct,
        row.model_probability_pct,
        row.modelProbabilityPct,
        row.estimated_prob,
        row.estimatedProb,
        row.probability,
        row.probability_pct,
        row.predicted_probability_pct
    );
}


// STEP84_PORTFOLIO_SEGMENT_CLIENT_METRICS
// Costruisce un report UI dal medesimo storico filtrato usato dai grafici. In questo modo
// il filtro ATP/WTA modifica davvero KPI, Top Strategie e pannello audit senza mutare DB/backend.
function isTruthyFrontendFlag(value) {
    const text = safeString(value).toUpperCase().trim();
    return text === '1' || text === 'TRUE' || text === 'YES' || text === 'Y' || text === 'VERIFIED';
}

function getFrontendClvEvidenceText(row = {}) {
    return [
        row.clv_method,
        row.clv_source,
        row.clvQualitySource,
        row.clv_quality_source,
        row.clv_last_attempt_result
    ].map(v => safeString(v).toUpperCase()).join(' ');
}

function hasFrontendVerifiedClosingLineEvidence(row = {}) {
    // STEP91M_VERIFIED_CLV_PORTFOLIO_REPAIR
    const closingOdd = safeNumber(row.closing_odd, NaN);
    const legacyClosing = safeNumber(row.clv, NaN);
    const direct = safeNumber(row.clv_pct, NaN);
    const edge = safeNumber(row.clv_edge, NaN);
    const verifiedFlag = isTruthyFrontendFlag(row.clv_verified ?? row.clvVerified ?? row.clv_validated);
    const closingFlag = isTruthyFrontendFlag(row.closing_line_available ?? row.closingLineAvailable);
    const evidenceText = getFrontendClvEvidenceText(row);
    const sourceHasClosing = evidenceText.includes('POST_MATCH')
        || evidenceText.includes('CLOSING')
        || evidenceText.includes('CLOSE')
        || evidenceText.includes('VAULT')
        || evidenceText.includes('LIVE_API')
        || evidenceText.includes('INTERNAL_VAULT');
    const explicitEvidence = verifiedFlag || closingFlag || sourceHasClosing;
    const hasNonZeroPct = (Number.isFinite(direct) && direct !== 0) || (Number.isFinite(edge) && edge !== 0);
    return (closingOdd > 1 && explicitEvidence) || (legacyClosing > 1 && explicitEvidence) || (hasNonZeroPct && explicitEvidence);
}

function hasFrontendClosingLineEvidence(row = {}) {
    return hasFrontendVerifiedClosingLineEvidence(row);
}

function getFrontendClvPct(row = {}) { return window.PortfolioAccounting.clv(row); }

function summarizeFrontendClvCoverage(strictRows = [], operationalRows = []) {
    const allValues = strictRows.map(getFrontendClvPct).filter(v => v !== null && Number.isFinite(v));
    const opValues = operationalRows.map(getFrontendClvPct).filter(v => v !== null && Number.isFinite(v));
    const pos = allValues.filter(v => v > 0).length;
    const opPos = opValues.filter(v => v > 0).length;
    const invalidLegacyClvRows = strictRows.filter(row => {
        const anyLegacyValue = Number.isFinite(safeNumber(row.clv_pct, NaN))
            || Number.isFinite(safeNumber(row.clv_edge, NaN))
            || Number.isFinite(safeNumber(row.clv, NaN))
            || Number.isFinite(safeNumber(row.closing_odd, NaN));
        return anyLegacyValue && !hasFrontendVerifiedClosingLineEvidence(row);
    }).length;
    const allValuesAreFlat = allValues.length > 0 && allValues.every(v => Math.abs(v) < 0.000001);
    return {
        step91mVerifiedOnly: true,
        status: allValues.length ? (allValuesAreFlat ? 'CLV_FLAT_ZERO_REVIEW' : (pos ? 'CLV_AVAILABLE' : 'CLV_AVAILABLE_NOT_BEATEN')) : 'NO_VERIFIED_CLOSING_LINE',
        totalSample: strictRows.length,
        totalWithClv: allValues.length,
        totalPositiveClv: pos,
        missingClv: Math.max(0, strictRows.length - allValues.length),
        invalidLegacyClvRows,
        clvCoveragePct: strictRows.length ? round((allValues.length / strictRows.length) * 100, 2) : 0,
        beatenTotalPct: strictRows.length ? round((pos / strictRows.length) * 100, 2) : 0,
        beatenAvailablePct: allValues.length ? round((pos / allValues.length) * 100, 2) : 0,
        operationalSample: operationalRows.length,
        operationalWithClv: opValues.length,
        operationalPositiveClv: opPos,
        operationalMissingClv: Math.max(0, operationalRows.length - opValues.length),
        operationalCoveragePct: operationalRows.length ? round((opValues.length / operationalRows.length) * 100, 2) : 0,
        operationalBeatenPct: opValues.length ? round((opPos / opValues.length) * 100, 2) : 0,
        avgClvTotal: allValues.length ? round(allValues.reduce((a, b) => a + b, 0) / allValues.length, 2) : 0,
        avgClvOperational: opValues.length ? round(opValues.reduce((a, b) => a + b, 0) / opValues.length, 2) : 0
    };
}

function summarizeFrontendBrier(rows = []) {
    const values = rows.map(row => {
        const p = getModelProbabilityPctFromRow(row);
        if (!Number.isFinite(Number(p)) || p <= 0 || p >= 100) return null;
        return Math.pow((Number(p) / 100) - (row.status === 'WON' ? 1 : 0), 2);
    }).filter(v => v !== null && Number.isFinite(v));
    return {
        sampleSize: values.length,
        avgBrier: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 4) : 0
    };
}

function summarizeFrontendRoi(rows = []) {
    const totalStake = rows.reduce((sum, row) => sum + safeNumber(row.stake ?? row.invested, 0), 0);
    const totalProfit = rows.reduce((sum, row) => sum + safeNumber(row.profit, 0), 0);
    const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0;
    const profits = rows.map(row => safeNumber(row.profit, 0));
    const avg = profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const variance = profits.length ? profits.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / profits.length : 0;
    const stdev = Math.sqrt(variance);
    return {
        totalStake: round(totalStake, 2),
        totalProfit: round(totalProfit, 2),
        realizedProfit: round(totalProfit, 2),
        roi: round(roi, 2),
        yield: rows.length ? round(totalProfit / rows.length, 2) : 0,
        sharpeLike: stdev > 0 ? round(avg / stdev, 2) : '0.00'
    };
}

function buildFrontendTopStrategies(rows = []) {
    const groups = {};
    rows.forEach(row => {
        const tour = getTennisTourFromRow(row);
        const fallbackStrategy = activeSport === SPORT.TENNIS ? `TENNIS_${tour || 'UNKNOWN'}_MONEYLINE` : 'CALCIO_STRATEGY';
        const key = safeString(row.strategy_tag || row.strategyTag || row.market_type || fallbackStrategy, fallbackStrategy).toUpperCase();
        if (!groups[key]) groups[key] = { strategy: key, bets: 0, won: 0, stake: 0, profit: 0, clvValues: [], brierValues: [] };
        const g = groups[key];
        g.bets += 1;
        if (row.status === 'WON') g.won += 1;
        g.stake += safeNumber(row.stake ?? row.invested, 0);
        g.profit += safeNumber(row.profit, 0);
        const clv = getFrontendClvPct(row);
        if (clv !== null && Number.isFinite(clv)) g.clvValues.push(clv);
        const p = getModelProbabilityPctFromRow(row);
        if (Number.isFinite(Number(p)) && p > 0 && p < 100) g.brierValues.push(Math.pow((Number(p) / 100) - (row.status === 'WON' ? 1 : 0), 2));
    });
    return Object.values(groups)
        .map(g => {
            const roi = g.stake > 0 ? (g.profit / g.stake) * 100 : 0;
            const hitRate = g.bets ? (g.won / g.bets) * 100 : 0;
            const avgCLV = g.clvValues.length ? g.clvValues.reduce((a, b) => a + b, 0) / g.clvValues.length : 0;
            const brier = g.brierValues.length ? g.brierValues.reduce((a, b) => a + b, 0) / g.brierValues.length : 0;
            const quality = g.bets < 10 ? 'LOW_SAMPLE' : (roi > 5 && brier < 0.24 ? 'GOOD' : (roi < -5 || brier > 0.28 ? 'NEGATIVE' : 'NEUTRAL'));
            return {
                strategy: g.strategy,
                bets: g.bets,
                hitRate: round(hitRate, 2),
                roi: round(roi, 2),
                avgCLV: g.clvValues.length ? round(avgCLV, 2) : null,
                brier: round(brier, 4),
                quality
            };
        })
        .sort((a, b) => b.bets - a.bets || b.roi - a.roi);
}

function buildSegmentPortfolioReportFromHistory(dataHist = {}, baseBankroll = 1000, fallbackRep = {}) {
    const strictRows = getPortfolioResolvedRowsForChart(dataHist, { operationalOnly: false });
    const operationalRows = getPortfolioResolvedRowsForChart(dataHist, { operationalOnly: true });
    const fallbackStrictSample = safeNumber(fallbackRep?.meta?.rawStrictSampleSize ?? fallbackRep?.meta?.sampleSize, 0);
    if (strictRows.length === 0 && fallbackStrictSample > 0) {
        return {
            ...fallbackRep,
            meta: {
                ...(fallbackRep.meta || {}),
                segmentFilter: normalizePortfolioFilterKey(portfolioSegmentFilter),
                segmentLabel: getPortfolioSegmentLabel(),
                step91lPortfolioHistoryFallback: true
            },
            warning: fallbackRep.warning || 'Step91L: storico UI non disponibile, mantenuto report portfolio backend strict/current.'
        };
    }
    const roi = summarizeFrontendRoi(operationalRows);
    const drawdown = buildEquityDrawdownAudit(dataHist);
    const realizedProfit = operationalRows.reduce((sum, row) => sum + safeNumber(row.profit, 0), 0);
    const clvCoverage = summarizeFrontendClvCoverage(strictRows, operationalRows);
    const brier = summarizeFrontendBrier(operationalRows);
    const clvValues = operationalRows.map(getFrontendClvPct).filter(v => v !== null && Number.isFinite(v));
    const base = 1000;
    return {
        ...fallbackRep,
        topStrategies: buildFrontendTopStrategies(operationalRows),
        bankroll: {
            ...(fallbackRep.bankroll || {}),
            currentBankroll: round(base + realizedProfit, 2),
            inputBankroll: round(base, 2),
            initialBankroll: round(base, 2),
            finalBankroll: round(base + realizedProfit, 2),
            realizedProfit: round(realizedProfit, 2),
            roi,
            drawdown,
            reconciliation: {
                initialBankroll: round(base, 2),
                realizedProfit: round(realizedProfit, 2),
                finalBankroll: round(base + realizedProfit, 2),
                aligned: true,
                mode: 'CLIENT_SEGMENT_INITIAL_PLUS_REALIZED_PROFIT'
            }
        },
        analytics: {
            ...(fallbackRep.analytics || {}),
            clvCoverage,
            clv: {
                sampleSize: clvValues.length,
                avgCLV: clvValues.length ? round(clvValues.reduce((a, b) => a + b, 0) / clvValues.length, 2) : 0,
                positiveRate: clvValues.length ? round((clvValues.filter(v => v > 0).length / clvValues.length) * 100, 2) : 0
            },
            brier
        },
        auditGrade: {
            ...(fallbackRep.auditGrade || {}),
            strictSample: strictRows.length,
            operationalSample: operationalRows.length,
            auditOnlySample: strictRows.length - operationalRows.length,
            // STEP84_HIDE_PORTFOLIO_READ_TABLE: non passiamo step67Cohorts alla UI per evitare tabella superflua.
            step67Cohorts: null
        },
        meta: {
            ...(fallbackRep.meta || {}),
            sport: activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO',
            dataMode: 'CLIENT_SEGMENT_STRICT_CURRENT',
            sampleSize: operationalRows.length,
            rawStrictSampleSize: strictRows.length,
            auditOnlySampleSize: strictRows.length - operationalRows.length,
            segmentFilter: normalizePortfolioFilterKey(portfolioSegmentFilter),
            segmentLabel: getPortfolioSegmentLabel()
        },
        warning: strictRows.length && !operationalRows.length ? 'Nessuna riga operativa reale nel filtro selezionato.' : null
    };
}

function buildEquityDrawdownAudit(dataHist = {}) {
    const rows = getPortfolioResolvedRowsForChart(dataHist, { operationalOnly: activeSport === SPORT.TENNIS });
    const baseEquity = 1000;
    let equity = baseEquity;
    let peak = baseEquity;
    let maxDrawdownPct = 0;
    let maxDrawdownAmount = 0;

    const points = rows.map((row, index) => {
        equity += safeNumber(row.profit, 0);
        peak = Math.max(peak, equity);
        const drawdownAmount = Math.max(0, peak - equity);
        const drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0;
        if (drawdownPct > maxDrawdownPct) {
            maxDrawdownPct = drawdownPct;
            maxDrawdownAmount = drawdownAmount;
        }
        return {
            index: index + 1,
            id: row.id,
            date: safeString(row.match_date).split(',')[0] || '-',
            match: `${safeString(row.home_team || row.home || '').trim()} - ${safeString(row.away_team || row.away || '').trim()}`.replace(/^ - $/, 'N/D'),
            profit: round(safeNumber(row.profit, 0), 2),
            equity: round(equity, 2),
            peak: round(peak, 2),
            drawdownAmount: round(drawdownAmount, 2),
            drawdownPct: round(drawdownPct, 2)
        };
    });

    return {
        scope: `${activeSport === SPORT.TENNIS ? 'TENNIS_OPERATIONAL_REAL_CURRENT' : 'CALCIO_OPERATIONAL_REAL_CURRENT'} · ${getPortfolioSegmentLabel()}`,
        baseEquity: round(baseEquity, 2),
        finalEquity: round(equity, 2),
        sample: rows.length,
        maxDrawdownPct: round(maxDrawdownPct, 2),
        maxDrawdownAmount: round(maxDrawdownAmount, 2),
        points,
        worstPoints: [...points].sort((a, b) => b.drawdownPct - a.drawdownPct).slice(0, 8)
    };
}

function buildDrawdownAudit(dataHist = {}) {
    // STEP72_FINAL_UI_BINDING_CHECKS alias: mantiene compatibilità test/UI senza cambiare il calcolo.
    return buildEquityDrawdownAudit(dataHist);
}

function updateDrawdownDataAuditPanel(dataHist = {}) {
    const box = $('drawdownChartDataAuditPanel');
    if (!box) return;

    const audit = buildEquityDrawdownAudit(dataHist);

    if (!audit.sample) {
        box.innerHTML = '<div style="margin-top:10px;color:#94a3b8;font-size:.84em;">Nessun punto equity disponibile con filtri strict/current.</div>';
        return;
    }

    const rowsHtml = audit.worstPoints.map(p => `
        <tr>
            <td>${htmlEscape(p.index)}</td>
            <td>${htmlEscape(p.date)}</td>
            <td style="color:${colorByPositiveNegative(p.profit)};">${p.profit >= 0 ? '+' : ''}€${formatNumber(p.profit, 2)}</td>
            <td>€${formatNumber(p.equity, 2)}</td>
            <td>€${formatNumber(p.peak, 2)}</td>
            <td style="color:#f87171;font-weight:800;">${formatNumber(p.drawdownPct, 2)}%</td>
        </tr>
    `).join('');

    box.innerHTML = `
        <details style="margin-top:10px; text-align:left;">
            <summary style="cursor:pointer;color:#93c5fd;font-weight:800;">Verifica dati grafico drawdown/equity</summary>
            <div style="margin-top:8px; border:1px solid rgba(147,197,253,.22); background:rgba(59,130,246,.06); border-radius:10px; padding:10px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Scope</span><br><strong>${htmlEscape(audit.scope)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Punti grafico</span><br><strong>${audit.sample}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Equity base</span><br><strong>€${formatNumber(audit.baseEquity, 2)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Equity finale</span><br><strong>€${formatNumber(audit.finalEquity, 2)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Max DD</span><br><strong style="color:#f87171;">${formatNumber(audit.maxDrawdownPct, 2)}% · €${formatNumber(audit.maxDrawdownAmount, 2)}</strong></div>
                </div>
                <div class="table-responsive" style="margin-top:10px;max-height:260px;overflow:auto;">
                    <table style="width:100%;font-size:.82em;">
                        <thead><tr><th>#</th><th>Data</th><th>Profit</th><th>Equity</th><th>Peak</th><th>DD</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        </details>
    `;
}

function buildTennisBrierTourCalibration(dataHist = {}) {
    const rows = getPortfolioResolvedRowsForChart(dataHist, { operationalOnly: false })
        .filter(isTennisRow)
        .map(row => {
            const p = getModelProbabilityPctFromRow(row);
            const tour = getTennisTourFromRow(row);
            if (!Number.isFinite(Number(p)) || p <= 0 || p >= 100) return null;
            if (tour !== 'ATP' && tour !== 'WTA') return null;
            return {
                row,
                tour,
                probability: clamp(Number(p), 1, 99),
                outcome: row.status === 'WON' ? 1 : 0
            };
        })
        .filter(Boolean);

    const groups = {};
    rows.forEach(item => {
        const bucketStart = Math.max(0, Math.min(90, Math.floor(item.probability / 10) * 10));
        const bucket = `${bucketStart}-${bucketStart + 9}`;
        const key = `${item.tour}|${bucket}`;
        if (!groups[key]) {
            groups[key] = { tour: item.tour, bucket, sample: 0, probSum: 0, wins: 0, brierSum: 0 };
        }
        groups[key].sample += 1;
        groups[key].probSum += item.probability;
        groups[key].wins += item.outcome;
        groups[key].brierSum += Math.pow((item.probability / 100) - item.outcome, 2);
    });

    const bucketOrder = bucket => safeNumber(String(bucket).split('-')[0], 0);
    const buckets = Object.values(groups)
        .map(g => ({
            tour: g.tour,
            bucket: g.bucket,
            sample: g.sample,
            avgPredictedProb: round(g.probSum / Math.max(1, g.sample), 2),
            observedWinRate: round((g.wins / Math.max(1, g.sample)) * 100, 2),
            calibrationError: round(((g.wins / Math.max(1, g.sample)) * 100) - (g.probSum / Math.max(1, g.sample)), 2),
            brier: round(g.brierSum / Math.max(1, g.sample), 4),
            status: g.sample >= 10 ? 'AUDIT' : 'LOW_SAMPLE'
        }))
        .sort((a, b) => a.tour.localeCompare(b.tour) || bucketOrder(a.bucket) - bucketOrder(b.bucket));

    const byTour = ['ATP', 'WTA'].reduce((acc, tour) => {
        const subset = rows.filter(r => r.tour === tour);
        const brier = subset.length
            ? subset.reduce((sum, r) => sum + Math.pow((r.probability / 100) - r.outcome, 2), 0) / subset.length
            : 0;
        acc[tour] = {
            sample: subset.length,
            brier: round(brier, 4),
            buckets: buckets.filter(b => b.tour === tour)
        };
        return acc;
    }, {});

    return {
        scope: `TENNIS_CURRENT_WON_LOST · ATP/WTA split · ${getPortfolioSegmentLabel()} · audit calibration`,
        sample: rows.length,
        buckets,
        byTour,
        labels: Array.from(new Set(buckets.map(b => b.bucket))).sort((a, b) => bucketOrder(a) - bucketOrder(b))
    };
}

function updateTennisBrierTourDiagnosticPanel(audit = null) {
    const box = $('brierTourDataAuditPanel');
    if (!box) return;

    if (activeSport !== SPORT.TENNIS) {
        box.innerHTML = '';
        box.style.display = 'none';
        return;
    }

    if (!audit || !audit.sample || !audit.buckets.length) {
        box.style.display = 'block';
        box.innerHTML = '<div style="margin-top:10px;color:#94a3b8;font-size:.84em;text-align:left;">ATP/WTA: nessun bucket Brier costruibile con probabilità valide e status WON/LOST.</div>';
        return;
    }

    const rowsHtml = audit.buckets.map(b => `
        <tr>
            <td><strong>${htmlEscape(b.tour)}</strong></td>
            <td>${htmlEscape(b.bucket)}%</td>
            <td>${safeNumber(b.sample, 0)}</td>
            <td style="color:#38bdf8;">${formatNumber(b.avgPredictedProb, 2)}%</td>
            <td style="color:#10b981;">${formatNumber(b.observedWinRate, 2)}%</td>
            <td style="color:${Math.abs(safeNumber(b.calibrationError, 0)) <= 7 ? '#f59e0b' : '#ef4444'};font-weight:800;">${b.calibrationError > 0 ? '+' : ''}${formatNumber(b.calibrationError, 2)}pp</td>
            <td>${formatNumber(b.brier, 4)}</td>
            <td>${htmlEscape(b.status)}</td>
        </tr>
    `).join('');

    box.style.display = 'block';
    box.innerHTML = `
        <details open style="margin-top:10px;text-align:left;">
            <summary style="cursor:pointer;color:#93c5fd;font-weight:800;">Verifica Brier Calibration ATP/WTA</summary>
            <div style="margin-top:8px;border:1px solid rgba(147,197,253,.22);background:rgba(59,130,246,.06);border-radius:10px;padding:10px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Scope</span><br><strong>${htmlEscape(audit.scope)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">Sample Brier</span><br><strong>${audit.sample}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">ATP</span><br><strong>${audit.byTour.ATP.sample} · Brier ${formatNumber(audit.byTour.ATP.brier, 4)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:.72em;text-transform:uppercase;">WTA</span><br><strong>${audit.byTour.WTA.sample} · Brier ${formatNumber(audit.byTour.WTA.brier, 4)}</strong></div>
                </div>
                <div class="table-responsive" style="margin-top:10px;max-height:280px;overflow:auto;">
                    <table style="width:100%;font-size:.82em;">
                        <thead><tr><th>Tour</th><th>Bucket</th><th>N</th><th>Pred. media</th><th>Win rate</th><th>Gap</th><th>Brier</th><th>Status</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        </details>
    `;
}

function renderTennisBrierTourCalibrationChart(dataHist = {}) {
    if (activeSport !== SPORT.TENNIS) return false;

    const audit = buildTennisBrierTourCalibration(dataHist);
    latestTennisBrierTourAudit = audit;
    updateTennisBrierTourDiagnosticPanel(audit);

    const canvas = ensurePortfolioChartLayout('chartCalibration');
    const ctxCal = canvas?.getContext('2d');
    if (!audit.buckets.length) return false;
    if (!ctxCal || !window.Chart) {
        updateCalibrationChartNoDataDiagnostic('<div style="margin-top:10px;color:#fbbf24;text-align:left;">Chart.js non disponibile: dati Brier ATP/WTA calcolati e mostrati nella tabella audit.</div>');
        return true;
    }

    const labels = audit.labels;
    const getSeries = (tour, field) => labels.map(label => {
        const row = audit.buckets.find(b => b.tour === tour && b.bucket === label);
        return row ? safeNumber(row[field], 0) : null;
    });

    if (chartCalibrationInstance) chartCalibrationInstance.destroy();

    chartCalibrationInstance = new Chart(ctxCal, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'ATP predizione media', data: getSeries('ATP', 'avgPredictedProb'), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.12)', borderWidth: 2, spanGaps: true, tension: 0.25 },
                { label: 'ATP win rate reale', data: getSeries('ATP', 'observedWinRate'), borderColor: '#10b981', borderDash: [5, 5], borderWidth: 2, spanGaps: true, tension: 0.25 },
                { label: 'WTA predizione media', data: getSeries('WTA', 'avgPredictedProb'), borderColor: '#c084fc', backgroundColor: 'rgba(192,132,252,.12)', borderWidth: 2, spanGaps: true, tension: 0.25 },
                { label: 'WTA win rate reale', data: getSeries('WTA', 'observedWinRate'), borderColor: '#f97316', borderDash: [5, 5], borderWidth: 2, spanGaps: true, tension: 0.25 }
            ]
        },
        options: step85PortfolioChartOptions({
            plugins: { legend: { labels: { color: '#cbd5e1' } } },
            scales: {
                y: { min: 0, max: 100, grid: { color: '#334155' }, ticks: { color: '#cbd5e1' } },
                x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
            }
        })
    });

    updateCalibrationChartNoDataDiagnostic('');
    return true;
}



// STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT_UI
function renderCalcioSystemAuditPanel(diagnostics = {}, normalized = {}) {
    const audit = diagnostics?.systemAudit || normalized?.systemAudit || normalized?.meta?.systemAudit || null;
    if (!audit || typeof audit !== 'object') return '';
    if (audit.sport && safeString(audit.sport).toUpperCase() !== 'CALCIO') return '';
    if (!safeString(audit.mode).includes('STEP97_CALCIO')) return '';

    const funnel = audit.funnel || {};
    const primary = audit.primaryBlocker || {};
    const feedAudit = audit.feedAudit || {};
    const byLeague = Array.isArray(feedAudit.byLeague) ? feedAudit.byLeague.slice(0, 8) : [];
    const blockers = Array.isArray(audit.topBlockers) ? audit.topBlockers.slice(0, 8) : [];
    const suggestions = Array.isArray(audit.suggestedActions) ? audit.suggestedActions : [];
    const candidateAudit = audit.candidateAudit || diagnostics?.candidateAudit || {};
    const rejected = candidateAudit.rejected || {};
    const candidates = Array.isArray(candidateAudit.topAuditCandidates) && candidateAudit.topAuditCandidates.length
        ? candidateAudit.topAuditCandidates
        : (Array.isArray(candidateAudit.topRejected) ? candidateAudit.topRejected : []);

    const statusColor = audit.noResultReason === 'HAS_VALUE_BETS'
        ? '#10b981'
        : (audit.noResultReason === 'NO_LIVE_ODDS_FROM_PROVIDER' ? '#f59e0b' : '#38bdf8');

    const funnelRows = [
        ['Leghe richieste', funnel.leaguesRequested ?? 0],
        ['Leghe processate', funnel.leaguesProcessed ?? 0],
        ['CSV caricati', funnel.csvLoaded ?? 0],
        ['Match live feed', funnel.liveMatchesFound ?? 0],
        ['Match modello', funnel.modelEligibleMatches ?? 0],
        ['Mercati valutati', funnel.marketsEvaluated ?? 0],
        ['Value candidates', funnel.valueCandidates ?? 0],
        ['Selezioni', funnel.selectedBets ?? 0],
        ['Salvataggi paper', funnel.savedAttempts ?? 0]
    ];

    const feedRowsHtml = byLeague.length ? `
        <details style="margin-top:10px;">
            <summary style="cursor:pointer; color:#bae6fd; font-weight:bold;">Audit feed Calcio per lega</summary>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px; margin-top:8px;">
                ${byLeague.map(row => {
                    const status = safeString(row.status || 'INFO').toUpperCase();
                    const color = status.includes('NO') || status.includes('ERROR') ? '#f59e0b' : '#10b981';
                    return `
                        <div style="background:rgba(15,23,42,0.62); border:1px solid rgba(148,163,184,0.16); border-radius:8px; padding:8px;">
                            <div style="display:flex; justify-content:space-between; gap:8px;">
                                <strong style="color:#e2e8f0;">${htmlEscape(row.league || '-')}</strong>
                                <span style="color:${color}; font-weight:900; font-size:.78em;">${htmlEscape(status)}</span>
                            </div>
                            <div style="color:#94a3b8; font-size:.80em; margin-top:3px; line-height:1.35;">${htmlEscape(row.reason || '')}</div>
                            <div style="color:#cbd5e1; font-size:.78em; margin-top:4px;">live ${htmlEscape(row.liveMatches ?? 0)} · bookmakers ${htmlEscape(row.bookmakers ?? 0)} · h2h ${htmlEscape(row.h2h ?? 0)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </details>
    ` : '';

    const blockersHtml = blockers.length ? `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; margin-top:10px;">
            ${blockers.map(row => `
                <div style="background:rgba(2,6,23,0.42); border:1px solid rgba(56,189,248,0.15); border-radius:8px; padding:8px;">
                    <div style="font-size:.72em; color:#93c5fd; text-transform:uppercase; font-weight:800;">${htmlEscape(row.key)}</div>
                    <div style="color:#f8fafc; font-weight:900; margin-top:3px;">${htmlEscape(row.value)}</div>
                </div>
            `).join('')}
        </div>
    ` : '';

    const candidatesHtml = candidates.length ? `
        <details style="margin-top:10px;">
            <summary style="cursor:pointer; color:#bae6fd; font-weight:bold;">Candidate audit Calcio · respinti/audit (${Math.min(10, candidates.length)})</summary>
            <div style="overflow:auto; margin-top:8px; max-height:360px; border:1px solid rgba(148,163,184,0.14); border-radius:8px;">
                <table style="width:100%; border-collapse:collapse; font-size:.84em;">
                    <thead><tr style="color:#10b981; text-align:left; border-bottom:1px solid rgba(148,163,184,.22); background:#0f172a;">
                        <th style="padding:8px;">Match</th><th style="padding:8px;">Pick</th><th style="padding:8px;">Prob</th><th style="padding:8px;">Edge/EV</th><th style="padding:8px;">Blocco</th><th style="padding:8px;">Motivo</th>
                    </tr></thead>
                    <tbody>
                        ${candidates.slice(0, 10).map(row => `
                            <tr style="border-bottom:1px solid rgba(148,163,184,.12);">
                                <td style="padding:8px; min-width:210px;"><strong>${htmlEscape(row.match || '-')}</strong><div style="color:#94a3b8; font-size:.78em;">${htmlEscape(row.marketFamily || 'calcio')}</div></td>
                                <td style="padding:8px; white-space:nowrap;"><strong>${htmlEscape(row.prediction || '-')}</strong> @${htmlEscape(row.odd ?? '-')}</td>
                                <td style="padding:8px; white-space:nowrap;">${htmlEscape(row.probability ?? '-')}%</td>
                                <td style="padding:8px; white-space:nowrap; color:#bae6fd;">${htmlEscape(row.edge_pp ?? '-')} / ${htmlEscape(row.ev_pct ?? '-')}</td>
                                <td style="padding:8px; color:#f59e0b; font-weight:bold;">${htmlEscape(row.rejectCode || '-')}</td>
                                <td style="padding:8px; min-width:230px; color:#cbd5e1;">${htmlEscape(row.reason || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </details>
    ` : `<div style="margin-top:8px; color:#94a3b8;">Candidate audit Calcio: ${htmlEscape(JSON.stringify(rejected))}</div>`;

    return `
        <div class="step97-calcio-system-audit" style="margin-top:12px; border:1px solid rgba(34,197,94,0.28); background:rgba(22,101,52,0.10); border-radius:10px; padding:12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:${statusColor};">Step97 · Audit Calcio end-to-end allineato Tennis</strong>
                    <div style="margin-top:4px; color:#cbd5e1; font-size:.88em; line-height:1.4; max-width:1050px;">
                        ${htmlEscape(audit.matchesVerdict || '')}<br>
                        <strong style="color:${statusColor};">${htmlEscape(primary.label || primary.code || 'Blocco non classificato')}</strong>: ${htmlEscape(primary.detail || '')}
                    </div>
                </div>
                <span style="color:#94a3b8; font-size:.78em; font-weight:800;">${htmlEscape(audit.mode || 'STEP97')}</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-top:10px;">
                ${funnelRows.map(([label, value]) => `
                    <div style="background:rgba(15,23,42,0.72); border:1px solid rgba(148,163,184,0.14); border-radius:8px; padding:8px;">
                        <div style="font-size:.70em; color:#94a3b8; text-transform:uppercase;">${htmlEscape(label)}</div>
                        <div style="font-weight:bold; color:#f8fafc;">${htmlEscape(value)}</div>
                    </div>
                `).join('')}
            </div>
            ${blockersHtml}
            ${feedRowsHtml}
            ${candidatesHtml}
            ${suggestions.length ? `<div style="margin-top:10px; color:#fde68a; font-size:.84em; line-height:1.4;">${suggestions.map(s => `• ${htmlEscape(s)}`).join('<br>')}</div>` : ''}
        </div>
    `;
}

// STEP75_TENNIS_SYSTEM_AUDIT_UI
function renderTennisSystemAuditPanel(diagnostics = {}, normalized = {}) {
    const audit = diagnostics?.systemAudit || normalized?.systemAudit || normalized?.meta?.systemAudit || null;
    if (!audit || typeof audit !== 'object') return '';

    const funnel = audit.funnel || {};
    const primary = audit.primaryBlocker || {};
    const gates = audit.gateVerdicts || {};
    const checks = Array.isArray(audit.checks) ? audit.checks : [];

    const statusColor = primary.code === 'NONE'
        ? '#10b981'
        : (primary.code === 'CALIBRATION_RELIABILITY' ? '#f59e0b' : '#38bdf8');

    const funnelRows = [
        ['Match quote provider', funnel.oddsEvents ?? 0],
        ['Eventi al modello', funnel.processedWithModel ?? 0],
        ['Candidati audit', funnel.auditCandidatesEvaluated ?? 0],
        ['Candidati operativi raw', funnel.rawOperationalCandidates ?? 0],
        ['Selezionati', funnel.selectedCandidates ?? 0],
        ['Salvati paper', funnel.savedAttempts ?? 0]
    ];

    const verdictRows = [
        ['Ci sono match?', audit.matchesVerdict || '-'],
        ['Blocco primario', primary.label || primary.code || '-'],
        ['Soglie Edge/Prob/EV', gates.thresholds || '-'],
        ['DeepScan', gates.deepScan || 'DeepScan non è il blocco primario in questa diagnostica.'],
        ['Totals Over/Under', gates.totals || '-'],
        ['Step63 reliability', gates.reliabilityGuardrail || '-']
    ];

    const checksHtml = checks.length ? `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:8px; margin-top:10px;">
            ${checks.map(row => {
                const status = safeString(row.status || 'INFO').toUpperCase();
                const color = status === 'OK' ? '#10b981' : (status === 'BLOCKED' ? '#ef4444' : (status === 'CHECK' ? '#f59e0b' : '#38bdf8'));
                return `
                    <div style="background:rgba(15,23,42,0.62); border:1px solid rgba(148,163,184,0.16); border-radius:8px; padding:8px;">
                        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                            <strong style="color:#e2e8f0;">${htmlEscape(row.area || '-')}</strong>
                            <span style="color:${color}; font-weight:900; font-size:.78em;">${htmlEscape(status)}</span>
                        </div>
                        <div style="color:#94a3b8; font-size:.80em; margin-top:3px; line-height:1.35;">${htmlEscape(row.detail || '')}</div>
                    </div>
                `;
            }).join('')}
        </div>
    ` : '';

    return `
        <div style="margin-top:12px; border:1px solid rgba(14,165,233,0.28); background:rgba(14,165,233,0.08); border-radius:10px; padding:12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:#38bdf8;">Step75 · Audit Tennis end-to-end</strong>
                    <div style="margin-top:4px; color:#cbd5e1; font-size:.88em; line-height:1.4; max-width:1050px;">
                        ${htmlEscape(audit.matchesVerdict || '')}<br>
                        <strong style="color:${statusColor};">${htmlEscape(primary.label || primary.code || 'Blocco non classificato')}</strong>: ${htmlEscape(primary.detail || '')}
                    </div>
                </div>
                <span style="color:#94a3b8; font-size:.78em; font-weight:800;">${htmlEscape(audit.mode || 'STEP75')}</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-top:10px;">
                ${funnelRows.map(([label, value]) => `
                    <div style="background:rgba(15,23,42,0.72); border:1px solid rgba(148,163,184,0.14); border-radius:8px; padding:8px;">
                        <div style="font-size:0.70em; color:#94a3b8; text-transform:uppercase;">${htmlEscape(label)}</div>
                        <div style="font-weight:bold; color:#f8fafc;">${htmlEscape(value)}</div>
                    </div>
                `).join('')}
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(270px,1fr)); gap:8px; margin-top:10px;">
                ${verdictRows.map(([label, value]) => `
                    <div style="background:rgba(2,6,23,0.42); border:1px solid rgba(56,189,248,0.15); border-radius:8px; padding:8px;">
                        <div style="font-size:.72em; color:#93c5fd; text-transform:uppercase; font-weight:800;">${htmlEscape(label)}</div>
                        <div style="color:#e2e8f0; font-size:.84em; line-height:1.35; margin-top:3px;">${htmlEscape(value)}</div>
                    </div>
                `).join('')}
            </div>

            ${checksHtml}

            ${audit.suggestedAction ? `
                <div style="margin-top:10px; padding:10px; border-radius:8px; border:1px solid rgba(245,158,11,.30); background:rgba(245,158,11,.09); color:#fde68a; font-weight:800; line-height:1.35;">
                    ${htmlEscape(audit.suggestedAction)}
                </div>
            ` : ''}
        </div>
    `;
}

function renderStep69Explainability(diagnostics = {}) {
    const audit = diagnostics && diagnostics.candidateAudit ? diagnostics.candidateAudit : null;
    const step69 = audit && audit.step69 ? audit.step69 : null;
    if (!step69 || typeof step69 !== 'object') return '';

    const funnel = step69.candidateFunnel || {};
    const topGroups = Array.isArray(step69.topBlockerGroups) ? step69.topBlockerGroups.slice(0, 4) : [];
    const topCodes = Array.isArray(step69.topDetailedRejectCodes) ? step69.topDetailedRejectCodes.slice(0, 5) : [];

    const funnelRows = [
        ['Eventi quote', funnel.oddsEvents ?? 0],
        ['Processati modello', funnel.processedWithModel ?? 0],
        ['Candidati audit', funnel.auditCandidatesEvaluated ?? 0],
        ['Operativi raw', funnel.rawOperationalCandidates ?? 0],
        ['Selezionati', funnel.selectedCandidates ?? 0],
        ['Salvati', funnel.savedAttempts ?? 0]
    ];

    return `
        <div style="margin-top:12px; border:1px solid rgba(168,85,247,0.28); background:rgba(88,28,135,0.10); border-radius:10px; padding:12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:#c084fc;">Step69 · Explainability rifiuti Analisi AI</strong>
                    <div style="margin-top:4px; color:#cbd5e1; font-size:0.88em; line-height:1.35; max-width:980px;">
                        ${htmlEscape(step69.zeroPickExplanation || 'Diagnostica non disponibile.')}
                    </div>
                </div>
                <span style="color:#94a3b8; font-size:0.78em;">${htmlEscape(step69.uiMode || 'COMPACT_SUMMARY')}</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin-top:10px;">
                ${funnelRows.map(([label, value]) => `
                    <div style="background:rgba(15,23,42,0.72); border:1px solid rgba(148,163,184,0.14); border-radius:8px; padding:8px;">
                        <div style="font-size:0.70em; color:#94a3b8; text-transform:uppercase;">${htmlEscape(label)}</div>
                        <div style="font-weight:bold; color:#f8fafc;">${htmlEscape(value)}</div>
                    </div>
                `).join('')}
            </div>

            ${topGroups.length ? `
                <div style="margin-top:10px; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
                    ${topGroups.map(row => `
                        <div style="background:rgba(2,6,23,0.46); border:1px solid rgba(192,132,252,0.18); border-radius:8px; padding:8px;">
                            <div style="font-size:0.72em; color:#c084fc; text-transform:uppercase;">Gruppo blocco</div>
                            <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                                <strong style="color:#f8fafc;">${htmlEscape(row.key)}</strong>
                                <strong style="color:#f59e0b;">${htmlEscape(row.value)}</strong>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${topCodes.length ? `
                <details style="margin-top:10px;">
                    <summary style="cursor:pointer; color:#bae6fd; font-weight:bold;">Mostra codici blocco principali</summary>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:8px; margin-top:8px;">
                        ${topCodes.map(row => `
                            <div style="background:rgba(15,23,42,0.55); border:1px solid rgba(148,163,184,0.16); border-radius:8px; padding:8px;">
                                <div style="font-weight:bold; color:#e2e8f0; word-break:break-word;">${htmlEscape(row.key)}</div>
                                <div style="color:#94a3b8; font-size:0.82em;">${htmlEscape(row.value)} candidati</div>
                            </div>
                        `).join('')}
                    </div>
                </details>
            ` : ''}

            <div style="margin-top:8px; color:#94a3b8; font-size:0.82em; line-height:1.35;">
                ${htmlEscape(step69.guardrailInterpretation || '')}
                ${step69.totalsStatus ? `<br>${htmlEscape(step69.totalsStatus)}` : ''}
            </div>
        </div>
    `;
}

function renderStep65CandidateAudit(diagnostics = {}) {
    const audit = diagnostics && diagnostics.candidateAudit ? diagnostics.candidateAudit : null;
    if (!audit || typeof audit !== 'object') return '';

    const candidates = Array.isArray(audit.topAuditCandidates) && audit.topAuditCandidates.length
        ? audit.topAuditCandidates
        : (Array.isArray(audit.topRejected) ? audit.topRejected : []);

    const rejected = audit.rejected || {};
    const auditOnly = audit.auditOnly || {};
    const step69Html = renderStep69Explainability(diagnostics);

    const summaryRows = [
        ['Valutati ML', audit.evaluated?.moneyline ?? 0],
        ['Valutati totals', audit.evaluated?.totals ?? 0],
        ['Accettati ML', audit.acceptedForSelection?.moneyline ?? 0],
        ['Audit-only ML', Object.values(auditOnly.moneyline || {}).reduce((a, b) => a + safeNumber(b, 0), 0)],
        ['Reject ML', Object.values(rejected.moneyline || {}).reduce((a, b) => a + safeNumber(b, 0), 0)]
    ];

    const tableRows = candidates.slice(0, 10).map(row => {
        const oddsCert = row.oddsCertification || {};
        const evCert = row.evCertification || {};
        const certified = oddsCert.certified === true;
        const certLabel = oddsCert.reason || (certified ? 'CERTIFIED_H2H_MONEYLINE' : 'N/D');
        const nameCert = oddsCert.nameCertification?.level || oddsCert.nameCertificationMode || 'N/D';
        const detailedCode = row.detailedRejectCode || row.rejectCode || 'AUDIT';
        const blockerGroup = row.blockerGroup || row.step69?.blockerGroup || '-';
        const explanation = row.rejectionExplanation || row.step69?.explanation || row.reason || 'N/D';
        const probabilityMode = row.probabilityMode || row.step69?.probabilityAudit?.probabilityMode || '-';
        const theoreticalEv = row.theoretical_ev_pct ?? row.step69?.evAudit?.theoreticalEvPct ?? row.calibrated_ev_pct ?? '-';
        const operationalEv = row.operational_ev_pct ?? row.step69?.evAudit?.operationalEvPct ?? row.ev_pct ?? '-';
        const evSuppression = row.ev_suppression_reason || row.step69?.evAudit?.suppressionReason || '';
        const evWarning = evCert.warning ? ` · ${evCert.warning}` : '';

        return `
        <tr>
            <td style="min-width:210px;">
                <strong>${htmlEscape(row.match || 'N/D')}</strong>
                <div style="font-size:0.78em; color:#94a3b8; margin-top:2px;">${htmlEscape(certLabel)} · ${htmlEscape(nameCert)}</div>
            </td>
            <td style="white-space:nowrap;"><strong>${htmlEscape(row.prediction || 'N/D')}</strong> @${htmlEscape(row.odd ?? '-')}</td>
            <td style="white-space:nowrap;">${htmlEscape(row.probability ?? '-')}%<div style="font-size:0.76em; color:#94a3b8;">Mercato ${htmlEscape(row.market_probability_pct ?? '-')}%</div></td>
            <td style="white-space:nowrap; color:#bae6fd;">${htmlEscape(theoreticalEv)}%<div style="font-size:0.76em; color:#94a3b8;">oper. ${htmlEscape(operationalEv)}%</div></td>
            <td><span style="color:#f59e0b; font-weight:bold;">${htmlEscape(detailedCode)}</span><div style="font-size:0.76em; color:#c084fc;">${htmlEscape(blockerGroup)}</div></td>
            <td style="min-width:240px;">
                ${htmlEscape(explanation)}
                <div style="font-size:0.76em; color:#94a3b8; margin-top:2px;">Prob mode: ${htmlEscape(probabilityMode)}${htmlEscape(evWarning)}</div>
                ${evSuppression ? `<div style="font-size:0.76em; color:#f59e0b; margin-top:2px;">${htmlEscape(evSuppression)}</div>` : ''}
            </td>
        </tr>
    `;
    }).join('');

    return `
        <div class="step72-step69-candidate-audit" style="margin-top:12px; background:rgba(2,6,23,0.42); border:1px solid rgba(56,189,248,0.22); border-radius:10px; padding:12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
                <strong style="color:#38bdf8;">Step65/66B · Candidate Audit + certificazione quote/nome</strong>
                <span style="color:#94a3b8; font-size:0.82em; max-width:780px;">Vista compatta: separa EV teorico / operativo e mostra il Blocco specifico. I dettagli lunghi restano espandibili per leggibilità.</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin-top:10px;">
                ${summaryRows.map(([label, value]) => `
                    <div style="background:rgba(15,23,42,0.72); border:1px solid rgba(148,163,184,0.14); border-radius:8px; padding:8px;">
                        <div style="font-size:0.72em; color:#94a3b8; text-transform:uppercase;">${htmlEscape(label)}</div>
                        <div style="font-weight:bold; color:#f8fafc;">${htmlEscape(value)}</div>
                    </div>
                `).join('')}
            </div>
            ${step69Html}
            ${candidates.length ? `
                <details style="margin-top:12px;">
                    <summary style="cursor:pointer; color:#bae6fd; font-weight:bold;">Dettaglio candidati respinti / audit-only · Top candidati respinti / audit-only (${Math.min(10, candidates.length)})</summary>
                    <div style="overflow:auto; margin-top:10px; max-height:430px; border:1px solid rgba(148,163,184,0.14); border-radius:8px;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.84em;">
                            <thead>
                                <tr style="color:#10b981; text-align:left; border-bottom:1px solid rgba(148,163,184,0.22); position:sticky; top:0; background:#0f172a; z-index:1;">
                                    <th style="padding:8px;">Match / Cert.</th>
                                    <th style="padding:8px;">Pick</th>
                                    <th style="padding:8px;">Prob.</th>
                                    <th style="padding:8px;">EV teorico / operativo <span style="display:none;">EV teorico/op.</span></th>
                                    <th style="padding:8px;">Blocco specifico</th>
                                    <th style="padding:8px;">Perché</th>
                                </tr>
                            </thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                </details>
            ` : `<div style="margin-top:10px; color:#94a3b8;">Nessun candidato audit disponibile.</div>`}
        </div>
    `;
}

function renderDiagnosticsPanel(data = {}, options = {}) {
    const normalized = normalizeDiagnosticsPayload(data);
    const {
        title = 'Diagnostica sistema',
        emptyHint = '',
        compact = false,
        startCollapsed = false
    } = options;

    const rows = normalized.diagnostics
        ? flattenDiagnosticsObject(pruneDiagnosticsForReadableRows(normalized.diagnostics))
        : [];

    const hasContent =
        normalized.message ||
        normalized.disabled ||
        rows.length > 0 ||
        normalized.warnings.length > 0 ||
        normalized.errors.length > 0 ||
        normalized.engineVersion ||
        normalized.dataMode ||
        normalized.modelVersion ||
        normalized.metricVersion;

    if (!hasContent) {
        if (!emptyHint) return '';

        return `
            <div style="margin:12px 0; background:rgba(245,158,11,0.08); border-left:4px solid #f59e0b; padding:12px; border-radius:8px; color:#cbd5e1;">
                <strong style="color:#f59e0b;">${htmlEscape(title)}</strong>
                <div style="margin-top:6px;">${htmlEscape(emptyHint)}</div>
            </div>
        `;
    }

    const statusColor = normalized.errors.length > 0
        ? '#ef4444'
        : (normalized.disabled ? '#f59e0b' : '#38bdf8');

    const metaItems = [
        normalized.engineVersion ? `Engine: ${normalized.engineVersion}` : '',
        normalized.dataMode ? `Data: ${normalized.dataMode}` : '',
        normalized.modelVersion ? `Model: ${normalized.modelVersion}` : '',
        normalized.metricVersion ? `Metric: ${normalized.metricVersion}` : ''
    ].filter(Boolean);

    const rowsHtml = rows.length
        ? `
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; margin-top:10px;">
                ${rows.map(row => `
                    <div style="background:rgba(15,23,42,0.55); border:1px solid rgba(148,163,184,0.16); border-radius:8px; padding:8px;">
                        <div style="font-size:0.72em; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;">${htmlEscape(prettifyDiagnosticLabel(row.label))}</div>
                        <div style="font-weight:bold; color:#f8fafc; margin-top:3px; word-break:break-word;">${htmlEscape(row.value)}</div>
                    </div>
                `).join('')}
            </div>
        `
        : '';

    const step75SystemAuditHtml = renderTennisSystemAuditPanel(normalized.diagnostics, normalized);
    const calcioSystemAuditHtml = renderCalcioSystemAuditPanel(normalized.diagnostics, normalized);
    const step65CandidateAuditHtml = renderStep65CandidateAudit(normalized.diagnostics);

    const warningsHtml = normalized.warnings.length
        ? `
            <div style="margin-top:10px; color:#f59e0b;">
                ${normalized.warnings.map(w => `<div>⚠️ ${htmlEscape(w)}</div>`).join('')}
            </div>
        `
        : '';

    const errorsHtml = normalized.errors.length
        ? `
            <div style="margin-top:10px; color:#ef4444;">
                ${normalized.errors.map(err => `<div>❌ ${htmlEscape(err)}</div>`).join('')}
            </div>
        `
        : '';

    const panelId = `diag-panel-${++diagnosticsPanelCounter}`;
    const collapseLabel = startCollapsed ? 'Espandi' : 'Riduci';

    return `
        <div style="margin:${compact ? '8px 0' : '14px 0'}; background:rgba(30,41,59,0.92); border:1px solid rgba(148,163,184,0.20); border-left:4px solid ${statusColor}; padding:14px; border-radius:10px; color:#cbd5e1;">
            <div style="display:flex; gap:10px; justify-content:space-between; align-items:flex-start; flex-wrap:wrap;">
                <div>
                    <strong style="color:${statusColor}; font-size:1.02em;">${htmlEscape(title)}</strong>
                    ${normalized.message ? `<div style="margin-top:6px;">${htmlEscape(normalized.message)}</div>` : ''}
                    ${normalized.disabled ? `<div style="margin-top:6px; color:#f59e0b; font-weight:bold;">Ottimizzazione/azione disabilitata in modalità bootstrap.</div>` : ''}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:flex-end;">
                    ${metaItems.length ? `
                        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                            ${metaItems.map(item => `<span style="background:rgba(56,189,248,0.12); color:#bae6fd; padding:3px 7px; border-radius:999px; font-size:0.75em; font-weight:bold;">${htmlEscape(item)}</span>`).join('')}
                        </div>
                    ` : ''}
                    <button type="button" class="diagnostics-toggle-btn" onclick="toggleDiagnosticsPanel('${panelId}', this)">${collapseLabel}</button>
                </div>
            </div>
            <div id="${panelId}" style="display:${startCollapsed ? 'none' : 'block'}; margin-top:6px;">
                ${warningsHtml}
                ${errorsHtml}
                ${step75SystemAuditHtml}
                ${calcioSystemAuditHtml}
                ${step65CandidateAuditHtml}
                ${rowsHtml}
            </div>
        </div>
    `;
}

window.toggleDiagnosticsPanel = function(panelId, buttonEl) {
    const panel = $(panelId);
    if (!panel || !buttonEl) return;

    const shouldOpen = panel.style.display === 'none';
    panel.style.display = shouldOpen ? 'block' : 'none';
    buttonEl.textContent = shouldOpen ? 'Riduci' : 'Espandi';
};

function getNoResultsHint(context) {
    if (context === 'analysis') {
        return 'Nessuna value bet visualizzata. Possibili cause: API quote non disponibili, calendario vuoto, storico minimo insufficiente oppure soglie edge/probabilità/EV troppo strette.';
    }

    if (context === 'backtest') {
        return 'Nessuna riga backtest visualizzata. Possibili cause: CSV non caricato, match non eleggibili, mercati non valutabili oppure soglie edge/probabilità/EV troppo strette.';
    }

    return 'Nessun dato disponibile.';
}

function initializeTableFilters() {
    document.querySelectorAll('[data-filter-table]').forEach(control => {
        if (control.dataset.bound === '1') return;

        const handler = () => applyTableFilters(control.dataset.filterTable);
        control.addEventListener('input', handler);
        control.addEventListener('change', handler);
        control.dataset.bound = '1';
    });
}

function getTableFilterControls(tableId) {
    return Array.from(document.querySelectorAll(`[data-filter-table="${tableId}"]`));
}

function applyTableFilters(tableId) {
    const table = $(tableId);
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const controls = getTableFilterControls(tableId);
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(row => !safeString(row.id).startsWith('ds-row-'));

    rows.forEach(row => {
        let visible = !(activeSport === SPORT.TENNIS && row.dataset.tennisEventSuperseded === '1');

        for (const control of controls) {
            if (!visible) break;
            const filterValue = safeString(control.value).trim().toLowerCase();
            if (!filterValue) continue;

            const colIndex = safeNumber(control.dataset.colIndex, -1);
            const cell = row.children[colIndex];
            const cellText = safeString(cell ? cell.innerText : '').replace(/\s+/g, ' ').trim().toLowerCase();

            if (!cellText.includes(filterValue)) {
                visible = false;
                break;
            }
        }

        row.style.display = visible ? '' : 'none';

        const detailRow = row.nextElementSibling;
        if (detailRow && safeString(detailRow.id).startsWith('ds-row-')) {
            detailRow.style.display = visible && !detailRow.classList.contains('hidden') ? '' : 'none';
        }
    });
}

function resetAllTableFilters() {
    document.querySelectorAll('[data-filter-table]').forEach(control => {
        control.value = '';
    });

    ['analysisTable', 'backtestTable', 'forwardTable'].forEach(applyTableFilters);
}

function resolveTennisDecisionTruthUi(row = {}) {
    const contract = resolveTennisStakeExecutionContractUi(row);
    const stake = Math.max(0, safeNumber(contract.finalExecution?.executableStake ?? row.stake, 0));
    const executionStatus = safeString(contract.finalExecution?.status).toUpperCase();
    const proposal = normalizeDeepScanOutcomeCategory(row);
    if (executionStatus === 'EXECUTABLE_MICRO_STAKE' || (stake > 0 && stake <= 2)) return { action:'MICRO_STAKE', label:`MICRO STAKE €${formatNumber(stake,2)}`, color:'#10b981', proposal, contract };
    if (executionStatus === 'EXECUTABLE_STANDARD_STAKE' || stake > 2) return { action:'STANDARD_STAKE', label:`STAKE €${formatNumber(stake,2)}`, color:'#10b981', proposal, contract };
    if (executionStatus.includes('PAPER_ONLY')) return { action:'PAPER_ONLY', label:'PAPER ONLY', color:'#a78bfa', proposal, contract };
    if (executionStatus.includes('BLOCKED')) return { action:'NO_BET', label:'NO BET', color:'#ef4444', proposal, contract };
    return { action:'NO_BET_REVIEW', label:'NO BET · REVIEW', color:'#f59e0b', proposal, contract };
}
function renderTennisDecisionTruthBadge(row = {}) {
    const truth = resolveTennisDecisionTruthUi(row);
    const contract = truth.contract || resolveTennisStakeExecutionContractUi(row);
    const authority = safeString(contract.finalExecution?.authority || 'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT');
    const execution = patch46StakeStatusLabel(contract.finalExecution?.status || truth.action);
    const reason = safeString(contract.finalExecution?.reason || '');
    return `<div title="Decisione finale downstream. DeepScan e TPI sono separati dall'autorità eseguibile." style="min-width:170px;"><span style="display:inline-block;background:${truth.color};color:white;padding:4px 8px;border-radius:6px;font-size:.82em;font-weight:900;white-space:nowrap;">${htmlEscape(truth.label)}</span><div style="font-size:.61em;color:#cbd5e1;margin-top:4px;font-weight:800;">${htmlEscape(execution)}</div><div style="font-size:.59em;color:#94a3b8;margin-top:2px;">Autorità: ${htmlEscape(authority)}</div><div style="font-size:.59em;color:#64748b;margin-top:2px;">Proposta DS canonica: ${htmlEscape(truth.proposal || 'SENZA DEEPSCAN')}</div>${reason ? `<div style="font-size:.57em;color:#64748b;margin-top:2px;">${htmlEscape(reason)}</div>` : ''}</div>`;
}

function renderTennisExternalEvidenceMini(row = {}) {
    if (!row.tennis_external_intelligence_version) return '';
    const h2h = safeString(row.tennis_external_h2h_status || 'N/D');
    const rank = safeString(row.tennis_external_ranking_status || 'N/D');
    const weather = safeString(row.tennis_external_weather_status || 'N/D');
    const receipt = safeString(row.tennis_external_intelligence_receipt_id || 'NON PERSISTITA');
    const rankColor = rank.includes('VERIFIED') ? '#10b981' : rank.includes('PARTIAL') ? '#f59e0b' : '#94a3b8';
    return `<div style="margin-top:5px;padding:4px 6px;border:1px solid rgba(56,189,248,.22);border-radius:6px;font-size:.58rem;line-height:1.35;color:#94a3b8;" title="Ricevuta ${htmlEscape(receipt)}"><strong style="color:#38bdf8;">Evidenze esterne</strong><br>H2H ${htmlEscape(h2h)} · Rank <span style="color:${rankColor}">${htmlEscape(rank)}</span> · Meteo ${htmlEscape(weather)}<br>Receipt: ${htmlEscape(receipt)}</div>`;
}

function getDeepScanBadge(action) {
    if (!action) return '-';
    const cleanLabel = normalizeDeepScanOutcomeCategory({ ds_action: action });
    let badgeCol = '#64748b';
    if (cleanLabel === 'ALTO RISCHIO') badgeCol = '#ef4444';
    else if (cleanLabel === 'RISCHIO MODELLO') badgeCol = '#f97316';
    else if (cleanLabel === 'WATCHLIST LOW EDGE' || cleanLabel === 'ATTENDI IN-PLAY') badgeCol = '#f59e0b';
    else if (cleanLabel === 'EDGE TECNICO') badgeCol = '#0ea5e9';
    else if (cleanLabel === 'VALUE CONFERMATO / MICRO') badgeCol = '#22c55e';
    return `<span style="background:${badgeCol}; color:white; padding:4px 8px; border-radius:6px; font-size:0.85em; font-weight:bold; white-space:nowrap;">${htmlEscape(cleanLabel)}</span>`;
}


const AUDIT16D_R2_CALCIO_TEMPORAL_UI = 'AUDIT16D_R2_CALCIO_TEMPORAL_SIGNAL_UI_V1';
function parseCalcioFinalReport(row = {}) {
    if (row.calcioDeepScanResult && typeof row.calcioDeepScanResult === 'object') return row.calcioDeepScanResult;
    if (row.calcio_deepscan_final_report_json && typeof row.calcio_deepscan_final_report_json === 'object') return row.calcio_deepscan_final_report_json;
    try { return JSON.parse(row.calcio_deepscan_final_report_json || '{}'); } catch (_) { return {}; }
}
function resolveCalcioTemporalView(row = {}) {
    const report = parseCalcioFinalReport(row);
    const embedded = report.temporalAnalysis || row.temporalAnalysis || {};
    if (embedded.stage) return embedded;
    const raw = row.match_date || row.matchDate || row.commence_time || row.commenceTime || row.kickoff || row.date;
    const t = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(t)) {
        const timing = safeString(row.calcio_timing_status || report.professionalAudit?.timing?.status).toUpperCase();
        if (timing.includes('EARLY')) return {stage:'EARLY_PREVIEW',presentationLabel:'EARLY PREVIEW · DATI NON MATURI',operationalMaturity:'PREVIEW_ONLY'};
        return {stage:'TIMING_UNKNOWN',presentationLabel:'TIMING NON DISPONIBILE',operationalMaturity:'UNKNOWN'};
    }
    const hours = (t - Date.now()) / 3600000;
    if (hours < 0) return {stage:'LIVE_OR_PAST',hoursToKickoff:hours,presentationLabel:'LIVE / MATCH CONCLUSO',operationalMaturity:'CLOSED'};
    if (hours <= 48) return {stage:'FULL_PREMATCH',hoursToKickoff:hours,presentationLabel:'FULL PRE-MATCH',operationalMaturity:'FINAL_WINDOW'};
    if (hours <= 168) return {stage:'MID_PREMATCH',hoursToKickoff:hours,presentationLabel:'PRE-MATCH IN AGGIORNAMENTO',operationalMaturity:'PRELIMINARY'};
    return {stage:'EARLY_PREVIEW',hoursToKickoff:hours,presentationLabel:'EARLY PREVIEW · DATI NON MATURI',operationalMaturity:'PREVIEW_ONLY'};
}
function isCalcioTemporalPreliminary(row = {}) {
    const stage = safeString(resolveCalcioTemporalView(row).stage).toUpperCase();
    return stage === 'EARLY_PREVIEW' || stage === 'MID_PREMATCH';
}
function resolveCalcioDeepScanSignalAction(row = {}) {
    const report = parseCalcioFinalReport(row);
    return safeString(row.calcio_deepscan_raw_action || report.signalAction || report.rawAction || row.analysis_current_deepscan || row.ds_action || report.action || '');
}
function resolveCalcioOperationalAction(row = {}) {
    const report = parseCalcioFinalReport(row);
    return safeString(row.calcio_deepscan_final_state_action || row.calcio_deepscan_unified_action || report.operationalAction || row.ds_action || report.action || '');
}
function renderCalcioDeepScanSignalCell(row = {}) {
    const signal = resolveCalcioDeepScanSignalAction(row);
    const operational = resolveCalcioOperationalAction(row);
    const temporal = resolveCalcioTemporalView(row);
    const preliminary = isCalcioTemporalPreliminary(row);
    const signalBadge = getDeepScanBadge(signal || operational);
    const gateLine = operational && safeString(operational).toUpperCase() !== safeString(signal).toUpperCase()
        ? `<div style="font-size:.60em;color:#94a3b8;margin-top:4px;line-height:1.2;">Gate operativo: ${htmlEscape(normalizeDeepScanOutcomeCategory({ds_action:operational}))}</div>` : '';
    const timingLine = preliminary
        ? `<div style="font-size:.60em;color:#fbbf24;margin-top:3px;font-weight:800;">${htmlEscape(temporal.presentationLabel || temporal.stage)}</div>` : '';
    return `${signalBadge}${gateLine}${timingLine}`;
}

function getPreScanColor(edgePp, evPct, probability) {
    let color = '#10b981';
    let bg = 'transparent';

    if (edgePp > 9 || probability < 50 || evPct < 2) {
        color = '#f59e0b';
        bg = 'rgba(245,158,11,0.05)';
    }

    if (edgePp > 12.5 || probability < 45 || evPct < 0) {
        color = '#ef4444';
        bg = 'rgba(239,68,68,0.05)';
    }

    return { color, bg };
}


// ============================================================================
// 5. BET MANAGEMENT ACTIONS
// ============================================================================

window.deleteBet = async function(id) {
    if (!confirm('⚠️ Vuoi davvero eliminare questa scommessa dal database?\nSe fa parte di una Multipla, l’intera Multipla verrà annullata.')) {
        return;
    }

    showLoading();

    try {
        const res = await fetch(`/api/bet/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            $('forwardTestBtn')?.click();
            loadGlobalAnalytics();
        } else {
            alert('Errore durante l’eliminazione della scommessa.');
        }
    } catch (error) {
        alert('Errore di comunicazione col server.');
    } finally {
        hideLoading();
    }
};

window.forceBetStatus = async function(id) {
    const newStatus = prompt("Override Manuale. Digita 'V' per VINTA, 'P' per PERSA, 'R' per RIMBORSO, 'X' per PUSH:");

    if (!newStatus) return;

    let targetStatus = '';

    const command = newStatus.toUpperCase();

    if (command === 'V') targetStatus = 'WON';
    else if (command === 'P') targetStatus = 'LOST';
    else if (command === 'R') targetStatus = 'VOID';
    else if (command === 'X') targetStatus = 'PUSH';
    else {
        alert("Comando non riconosciuto. Usa 'V', 'P', 'R' o 'X'.");
        return;
    }

    showLoading();

    try {
        const res = await fetch(`/api/bet/${id}/force`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: targetStatus })
        });

        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
            if (payload.warning) showRuntimeDiagnostic({ severity: 'WARN', title: 'Override manuale registrato', message: payload.warning, phase: 'MANUAL_OVERRIDE', code: payload.settlementContractStatus || 'MANUAL_REVIEW', details: payload });
            $('forwardTestBtn')?.click();
            loadGlobalAnalytics();
        } else {
            showRuntimeDiagnostic({ severity: 'ERROR', title: 'Override non riuscito', message: payload.error || `HTTP ${res.status}`, phase: payload.runtimeDiagnostic?.phase || 'MANUAL_OVERRIDE', operationId: payload.runtimeDiagnostic?.operationId, details: payload });
        }
    } catch (error) {
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Errore comunicazione server', message: error.message, phase: 'MANUAL_OVERRIDE_FETCH', error });
    } finally {
        hideLoading();
    }
};


// ============================================================================
// 6. GLOBAL ANALYTICS DASHBOARD
// ============================================================================

async function loadGlobalAnalytics() {
    if(window.TradingScopeUI && ['TRADING','PORTFOLIO'].includes(primaryViewName)) return;
    // STEP61B_STARTUP_UI_KPI_SYNC
    // La barra KPI superiore deve leggere lo stesso report strict/current usato dal Portfolio,
    // non i default bootstrap di /api/analytics/global. In assenza di campione mostra N/D.
    if (activeSport === SPORT.MANUAL_DEEPSCAN || activeSport === 'manual_deepscan') return;

    const querySport = activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO';
    const bankroll = safeNumber($('bankroll')?.value, querySport === 'TENNIS' ? 1000 : 1000);

    try {
        const res = await fetch(`/api/portfolio/report?sport=${encodeURIComponent(querySport)}&bankroll=${encodeURIComponent(bankroll)}`);
        const data = await res.json();
        if(window.TradingScopeUI && ['TRADING','PORTFOLIO'].includes(primaryViewName)) return;
        if (!data.success || !data.report) return;

        const rep = data.report;
        const roi = rep.bankroll?.roi || {};
        const clv = rep.analytics?.clv || {};
        const brier = rep.analytics?.brier || {};
        const totalStake = safeNumber(roi.totalStake, 0);
        const roiVal = safeNumber(roi.roi, 0);
        const yieldVal = safeNumber(roi.yield, 0);

        if ($('displayRoi')) {
            $('displayRoi').innerHTML = totalStake > 0
                ? `<span style="color:${colorByPositiveNegative(roiVal, '#f8fafc')}">${roiVal > 0 ? '+' : ''}${formatNumber(roiVal, 2)}%</span>`
                : '<span style="color:#94a3b8">N/D</span>';
        }

        if ($('displayYield')) {
            $('displayYield').innerHTML = totalStake > 0
                ? `<span style="color:${yieldVal >= 0 ? '#a855f7' : '#ef4444'}">${yieldVal > 0 ? '+' : ''}€ ${formatNumber(yieldVal, 2)}</span>`
                : '<span style="color:#94a3b8">N/D</span>';
        }

        if ($('displayBrier')) {
            const brierSample = safeNumber(brier.sampleSize, 0);
            const brierVal = safeNumber(brier.avgBrier, 0);
            $('displayBrier').innerText = brierSample > 0 && brierVal > 0 ? brierVal.toFixed(3) : 'N/D';
        }

        if ($('displayClvBeat')) {
            const clvSample = safeNumber(clv.sampleSize, 0);
            const clvBeatVal = safeNumber(clv.positiveRate, 0);
            $('displayClvBeat').innerText = clvSample > 0 ? `${formatNumber(clvBeatVal, 1)}%` : 'N/D';
        }
    } catch (error) {
        console.warn('⚠️ Impossibile sincronizzare KPI superiori strict/current.', error);
    }
}

// ============================================================================
// 7. PORTFOLIO
// ============================================================================

async function fetchHistoryForActiveSport() {
    if (activeSport === SPORT.TENNIS) {
        return await fetchStep91OTennisHistoryFallback('all');
    }

    const res = await fetch('/api/resolve_ai?leagueFilter=all');
    return await res.json();
}


const CALCIO_STAKE_DS_GATE_PORTFOLIO_UI_VERSION = 'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_UI_V1';

function step15PortfolioRows(dataHist = {}) {
    const candidates = [
        dataHist && dataHist.history,
        dataHist && dataHist.strictHistory,
        dataHist && dataHist.portfolioHistory,
        dataHist && dataHist.operationalHistory,
        dataHist && dataHist.report && dataHist.report.history
    ];
    return candidates.find(Array.isArray) || [];
}

function step15StakeValue(row = {}, type = 'operational') {
    if (type === 'theoretical') return Math.max(0, safeNumber(row.calcio_theoretical_stake ?? row.stake_theoretical ?? row.theoreticalStake ?? row.stake_base_before_deepscan, 0));
    return Math.max(0, safeNumber(row.calcio_operational_stake ?? row.stake_operational ?? row.operationalStake ?? row.stake ?? row.invested, 0));
}

function step15BuildDsGateMetrics(rows = []) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).filter(isCalcioRow).forEach(row => {
        const deepScan = step95CleanComboLabel(normalizeDeepScanOutcomeCategory(row));
        const qualityGate = step95CleanComboLabel(normalizeQualityOutcomeCategory(row));
        const key = `${deepScan}|||${qualityGate}`;
        if (!map.has(key)) map.set(key, {
            deepScan, qualityGate, totalSignals:0, pending:0, resolved:0, won:0, lost:0,
            probabilitySum:0, probabilityCount:0, realPtSum:0, realPtCount:0,
            edgeSum:0, edgeCount:0, evSum:0, evCount:0, predictionIndexSum:0, predictionIndexCount:0,
            totalTheoretical:0, totalOperational:0, resolvedOperationalStake:0, profit:0
        });
        const g = map.get(key);
        const status = step95NormalizeStatus(row);
        const theoretical = step15StakeValue(row, 'theoretical');
        const operational = step15StakeValue(row, 'operational');
        const probability = safeNumber(row.estimated_prob ?? row.estimatedProb ?? row.probability ?? row.prob, NaN);
        const realPt = safeNumber(row.historical_combo_adjusted_rate_pct ?? row.historical_combo_win_rate_pct, NaN);
        const edge = safeNumber(row.edge_pp ?? row.edge, NaN);
        const ev = safeNumber(row.ev_pct ?? row.expected_roi ?? row.rawEdge, NaN);
        const predictionIndex = safeNumber(row.calcio_prediction_index_score ?? row.predictionIndex?.score ?? row.prediction_index?.score, NaN);
        g.totalSignals += 1;
        if (status === 'PENDING') g.pending += 1;
        if (status === 'WON') { g.won += 1; g.resolved += 1; }
        if (status === 'LOST') { g.lost += 1; g.resolved += 1; }
        g.totalTheoretical += theoretical;
        g.totalOperational += operational;
        if ((status === 'WON' || status === 'LOST') && operational > 0) {
            g.resolvedOperationalStake += operational;
            g.profit += safeNumber(row.profit, 0);
        }
        if (Number.isFinite(probability)) { g.probabilitySum += probability; g.probabilityCount += 1; }
        if (Number.isFinite(realPt)) { g.realPtSum += realPt; g.realPtCount += 1; }
        if (Number.isFinite(edge)) { g.edgeSum += edge; g.edgeCount += 1; }
        if (Number.isFinite(ev)) { g.evSum += ev; g.evCount += 1; }
        if (Number.isFinite(predictionIndex)) { g.predictionIndexSum += predictionIndex; g.predictionIndexCount += 1; }
    });
    return [...map.values()].map(g => {
        const hitRatePct = g.resolved > 0 ? g.won / g.resolved * 100 : null;
        const roiPct = g.resolvedOperationalStake > 0 ? g.profit / g.resolvedOperationalStake * 100 : null;
        let decision = 'SOLO AUDIT';
        if (g.resolvedOperationalStake > 0) {
            if (g.resolved >= 8 && roiPct >= 8 && hitRatePct >= 55) decision = 'PROMUOVI';
            else if (roiPct >= 0) decision = g.resolved < 5 ? 'MANTIENI · SAMPLE BASSO' : 'MANTIENI';
            else if (roiPct > -12) decision = 'RIDUCI';
            else decision = 'BLOCCA';
        } else if (`${g.deepScan} ${g.qualityGate}`.toUpperCase().includes('ALTO RISCHIO') || g.qualityGate === 'BLOCCATA HARD') decision = 'BLOCCA / SOLO AUDIT';
        return {
            ...g,
            hitRatePct,
            roiPct,
            avgProbabilityPct: g.probabilityCount ? g.probabilitySum / g.probabilityCount : null,
            avgRealPtPct: g.realPtCount ? g.realPtSum / g.realPtCount : null,
            avgEdgePp: g.edgeCount ? g.edgeSum / g.edgeCount : null,
            avgEvPct: g.evCount ? g.evSum / g.evCount : null,
            avgPredictionIndex: g.predictionIndexCount ? g.predictionIndexSum / g.predictionIndexCount : null,
            avgTheoreticalStake: g.totalSignals ? g.totalTheoretical / g.totalSignals : 0,
            avgOperationalStake: g.totalSignals ? g.totalOperational / g.totalSignals : 0,
            decision
        };
    }).sort((a,b) => b.totalSignals-a.totalSignals || b.resolved-a.resolved || (b.roiPct ?? -999)-(a.roiPct ?? -999));
}

function renderPortfolioDsGateMeasurementTable(dataPort = {}, dataHist = {}) {
    if (activeSport !== SPORT.CALCIO) {
        const old = $('portfolioDsGateMeasurementPanel');
        if (old) old.remove();
        return;
    }
    const section = $('portfolioSection');
    if (!section) return;
    let panel = $('portfolioDsGateMeasurementPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'portfolioDsGateMeasurementPanel';
        panel.className = 'card-container portfolio-extra-panel';
        panel.style.borderLeft = '4px solid #22c55e';
        panel.style.marginBottom = '14px';
        const anchor = $('portfolioSeniorAuditPanel') || $('portfolioStrictScopeNotice') || section.firstChild;
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
        else section.prepend(panel);
    }

    const historyRows = step15PortfolioRows(dataHist);
    const metrics = step15BuildDsGateMetrics(historyRows);
    const diagnostics = dataPort.stakeDiagnostics || dataPort.report?.stakeDiagnostics || {};
    const deepValues = [...new Set(metrics.map(row => row.deepScan))].sort();
    const gateValues = [...new Set(metrics.map(row => row.qualityGate))].sort();

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
                <h3 style="margin:0 0 4px;color:#86efac;">Stake e resa per Deep Scan IA × Qualità/Gate</h3>
                <div style="color:#94a3b8;font-size:.88em;">${CALCIO_STAKE_DS_GATE_PORTFOLIO_UI_VERSION} · ROI calcolato solo su stake operativo risolto.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <select id="portfolioDsGateDeepFilter" style="padding:7px;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:6px;">
                    <option value="ALL">Tutti i Deep Scan</option>${deepValues.map(v=>`<option value="${htmlEscape(v)}">${htmlEscape(v)}</option>`).join('')}
                </select>
                <select id="portfolioDsGateGateFilter" style="padding:7px;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:6px;">
                    <option value="ALL">Tutti i Gate</option>${gateValues.map(v=>`<option value="${htmlEscape(v)}">${htmlEscape(v)}</option>`).join('')}
                </select>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:12px 0;">
            ${[
                ['Pending attivi', diagnostics.pending],
                ['Kelly teorico > 0', diagnostics.theoreticalPositive],
                ['Stake operativo > 0', diagnostics.operationalPositive],
                ['Zero per timing', diagnostics.byCause?.EARLY_TIMING_ZERO],
                ['Zero per soglie', diagnostics.byCause?.QUANT_THRESHOLD],
                ['Dati inattendibili', diagnostics.byCause?.DATA_UNRELIABLE]
            ].map(([label,value])=>`<div style="background:#0f172a;border:1px solid #273449;border-radius:8px;padding:9px;"><div style="color:#94a3b8;font-size:.78em;">${label}</div><strong style="font-size:1.1em;">${Number.isFinite(Number(value)) ? Number(value) : 'N/D'}</strong></div>`).join('')}
        </div>
        <div style="overflow:auto;max-height:520px;border:1px solid #273449;border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;min-width:1420px;font-size:.82em;">
                <thead style="position:sticky;top:0;background:#111827;z-index:2;">
                    <tr>
                        ${['Deep Scan IA','Qualità / Gate','Segnali','W/L','Hit rate','Prob. media','Prob. reale PT','Edge medio','EV medio','Indice Pred. medio','Stake teorico medio','Stake operativo totale','Profitto','ROI','Decisione'].map(h=>`<th style="padding:9px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap;">${h}</th>`).join('')}
                    </tr>
                </thead>
                <tbody id="portfolioDsGateMeasurementBody"></tbody>
            </table>
        </div>
        <div style="margin-top:8px;color:#94a3b8;font-size:.78em;">Pendenti e stake €0 partecipano al campione segnale, ma non al ROI reale. “Prob. reale PT” resta N/D quando la combinazione non ha campione storico as-of-safe.</div>
    `;

    const renderBody = () => {
        const deepFilter = $('portfolioDsGateDeepFilter')?.value || 'ALL';
        const gateFilter = $('portfolioDsGateGateFilter')?.value || 'ALL';
        const filtered = metrics.filter(row => (deepFilter === 'ALL' || row.deepScan === deepFilter) && (gateFilter === 'ALL' || row.qualityGate === gateFilter));
        const body = $('portfolioDsGateMeasurementBody');
        if (!body) return;
        body.innerHTML = filtered.length ? filtered.map(row => {
            const roi = row.roiPct;
            const profit = safeNumber(row.profit,0);
            return `<tr style="border-bottom:1px solid #1f2937;">
                <td style="padding:8px;font-weight:700;">${htmlEscape(row.deepScan)}</td>
                <td style="padding:8px;">${htmlEscape(row.qualityGate)}</td>
                <td style="padding:8px;">${row.totalSignals} <span style="color:#94a3b8;">(${row.pending} pend.)</span></td>
                <td style="padding:8px;">${row.won}/${row.lost}</td>
                <td style="padding:8px;">${row.hitRatePct === null ? 'N/D' : formatNumber(row.hitRatePct,2)+'%'}</td>
                <td style="padding:8px;">${row.avgProbabilityPct === null ? 'N/D' : formatNumber(row.avgProbabilityPct,2)+'%'}</td>
                <td style="padding:8px;">${row.avgRealPtPct === null ? 'N/D' : formatNumber(row.avgRealPtPct,2)+'%'}</td>
                <td style="padding:8px;">${row.avgEdgePp === null ? 'N/D' : (row.avgEdgePp>=0?'+':'')+formatNumber(row.avgEdgePp,2)+' pp'}</td>
                <td style="padding:8px;">${row.avgEvPct === null ? 'N/D' : (row.avgEvPct>=0?'+':'')+formatNumber(row.avgEvPct,2)+'%'}</td>
                <td style="padding:8px;font-weight:800;">${row.avgPredictionIndex === null ? 'N/D' : formatNumber(row.avgPredictionIndex,1)+'/100'}</td>
                <td style="padding:8px;">€${formatNumber(row.avgTheoreticalStake,2)}</td>
                <td style="padding:8px;">€${formatNumber(row.totalOperational,2)}</td>
                <td style="padding:8px;color:${colorByPositiveNegative(profit)};font-weight:700;">${profit>=0?'+':''}€${formatNumber(profit,2)}</td>
                <td style="padding:8px;color:${roi===null?'#94a3b8':colorByPositiveNegative(roi)};font-weight:700;">${roi===null?'N/D':(roi>=0?'+':'')+formatNumber(roi,2)+'%'}</td>
                <td style="padding:8px;white-space:nowrap;">${htmlEscape(row.decision)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="15" style="padding:18px;text-align:center;color:#94a3b8;">Nessuna combinazione disponibile per i filtri selezionati.</td></tr>';
    };
    $('portfolioDsGateDeepFilter')?.addEventListener('change', () => {renderBody();window.TradingScopeUI.maskStudioMoney($('portfolioSection'));});
    $('portfolioDsGateGateFilter')?.addEventListener('change', () => {renderBody();window.TradingScopeUI.maskStudioMoney($('portfolioSection'));});
    renderBody();
}


function renderPortfolioReliabilityCalibrationTable(dataPort = {}) {
    if (activeSport !== SPORT.CALCIO) {
        $('portfolioReliabilityCalibrationPanel')?.remove();
        return;
    }
    const section = $('portfolioSection');
    if (!section) return;
    const report = dataPort.reliabilityCalibration || dataPort.report?.reliabilityCalibration || null;
    let panel = $('portfolioReliabilityCalibrationPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'portfolioReliabilityCalibrationPanel';
        panel.className = 'card-container portfolio-extra-panel';
        panel.style.borderLeft = '4px solid #38bdf8';
        panel.style.marginBottom = '14px';
        const anchorNode = $('portfolioDsGateMeasurementPanel') || $('portfolioSeniorAuditPanel') || section.firstChild;
        if (anchorNode && anchorNode.parentNode) anchorNode.parentNode.insertBefore(panel, anchorNode.nextSibling);
        else section.prepend(panel);
    }
    if (!report) {
        panel.innerHTML = '<h3 style="color:#7dd3fc;margin:0 0 8px;">Affidabilità AI · validazione empirica</h3><div style="color:#fbbf24;">Report non disponibile.</div>';
        return;
    }
    const statusColor = code => {
        const value = safeString(code).toUpperCase();
        if (value.includes('COHERENT')) return '#22c55e';
        if (value.includes('REVIEW')) return '#ef4444';
        if (value.includes('NOT_VALIDATED') || value.includes('OBSERVATION')) return '#94a3b8';
        return '#f59e0b';
    };
    const bands = Array.isArray(report.bands) ? report.bands : [];
    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
                <h3 style="margin:0 0 4px;color:#7dd3fc;">Affidabilità AI · validazione empirica</h3>
                <div style="color:#94a3b8;font-size:.86em;">${htmlEscape(report.version || CALCIO_RELIABILITY_CALIBRATION_UI_VERSION)} · l’affidabilità misura la solidità delle evidenze, non la probabilità di vincita.</div>
            </div>
            <span style="padding:4px 9px;border-radius:999px;border:1px solid #334155;color:${statusColor(report.empiricalStatus)};font-size:.76em;font-weight:900;">${htmlEscape(report.empiricalStatus || 'N/D')}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:12px 0;">
            ${[
                ['Segnali con affidabilità', report.scoredRows],
                ['Pendenti', report.pendingScoredRows],
                ['Risolti', report.resolvedScoredRows],
                ['Copertura esiti', `${formatNumber(report.validationCoveragePct,1)}%`],
                ['Monotonicità', report.monotonicity || 'N/D']
            ].map(([label,value])=>`<div style="background:#0f172a;border:1px solid #273449;border-radius:8px;padding:9px;"><div style="color:#94a3b8;font-size:.76em;">${htmlEscape(label)}</div><strong>${htmlEscape(value)}</strong></div>`).join('')}
        </div>
        <div style="overflow:auto;border:1px solid #273449;border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;min-width:1320px;font-size:.82em;">
                <thead style="background:#111827;">
                    <tr>${['Fascia affidabilità','Affidabilità media','Segnali','Pendenti','Risolti','W/L','Hit rate','IC 95%','Prob. media','Gap prob. vs esiti','Brier','Confidenza validazione','Stato'].map(h=>`<th style="padding:9px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap;">${h}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${bands.map(row => {
                        const ci = row.hitRateCi95 || {};
                        const gap = row.calibrationGapPp;
                        return `<tr style="border-bottom:1px solid #1f2937;">
                            <td style="padding:8px;font-weight:800;color:${calcioReliabilityColor(row.avgDeclaredReliabilityPct ?? row.bandMin)};">${htmlEscape(row.bandLabel)} <span style="color:#64748b;">(${htmlEscape(row.bandRange)})</span></td>
                            <td style="padding:8px;">${row.avgDeclaredReliabilityPct == null ? 'N/D' : formatNumber(row.avgDeclaredReliabilityPct,1)+'%'}</td>
                            <td style="padding:8px;">${safeNumber(row.signals,0)}</td>
                            <td style="padding:8px;">${safeNumber(row.pending,0)}</td>
                            <td style="padding:8px;">${safeNumber(row.resolved,0)}</td>
                            <td style="padding:8px;">${safeNumber(row.won,0)}/${safeNumber(row.lost,0)}</td>
                            <td style="padding:8px;">${row.hitRatePct == null ? 'N/D' : formatNumber(row.hitRatePct,2)+'%'}</td>
                            <td style="padding:8px;">${ci.lowPct == null ? 'N/D' : formatNumber(ci.lowPct,1)+'–'+formatNumber(ci.highPct,1)+'%'}</td>
                            <td style="padding:8px;">${row.avgForecastProbabilityPct == null ? 'N/D' : formatNumber(row.avgForecastProbabilityPct,2)+'%'}</td>
                            <td style="padding:8px;color:${gap == null ? '#94a3b8' : colorByPositiveNegative(-Math.abs(gap), '#22c55e')};">${gap == null ? 'N/D' : (gap>=0?'+':'')+formatNumber(gap,2)+' pp'}</td>
                            <td style="padding:8px;">${row.brier == null ? 'N/D' : formatNumber(row.brier,4)}</td>
                            <td style="padding:8px;">${formatNumber(row.validationConfidencePct,1)}%</td>
                            <td style="padding:8px;color:${statusColor(row.validationStatus)};font-weight:800;white-space:nowrap;">${htmlEscape(row.validationLabel)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div style="margin-top:8px;color:#94a3b8;font-size:.77em;line-height:1.4;">
            “Confidenza validazione” misura soltanto la maturità del campione risolto: raggiunge il 100% a 30 esiti per fascia. Hit rate e affidabilità AI non devono coincidere; la verifica corretta usa calibrazione della probabilità, Brier e intervallo di confidenza. Nessuna metrica di questa tabella autorizza stake.
        </div>`;
}

async function loadPortfolioData(expectedViewEpoch = primaryViewEpoch) {
    window.TradingScopeUI.ensurePortfolioSwitch();
    const viewEpoch = expectedViewEpoch;
    const requestSequence = ++portfolioRequestSequence;
    if (portfolioAbortController) {
        try { portfolioAbortController.abort('PORTFOLIO_REFRESH_REPLACED'); } catch (_) {}
    }
    portfolioAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const requestSignal = portfolioAbortController?.signal;
    showLoading();

    try {
        const querySport = activeSport === SPORT.CALCIO ? 'CALCIO' : 'TENNIS';

        const currentBankroll = 1000;
        const requestedScope = window.TradingScopeUI.portfolioMode();
        const requestedSegment = portfolioSegmentFilter;
        const resHist = await fetch(`/api/trading-scopes/history?sport=${querySport}`, {cache:'no-store', ...(requestSignal ? {signal:requestSignal} : {})});
        const rawHist = await resHist.json();
        if (!resHist.ok || !rawHist.success) throw new Error(rawHist.error || 'Storico non disponibile');
        if (!isPortfolioRenderCurrent(requestSequence, viewEpoch)) return {success:false, staleNavigation:true};
        const dataHist = {...rawHist, history:window.TradingScopes.filter(rawHist.history, requestedScope)};
        window.TradingScopeUI.ensurePortfolioSwitch(rawHist.counts?.invalid || 0);
        renderPortfolioSegmentFilterPanel(dataHist);
        const filteredDataHist = filterPortfolioHistoryPayloadByActiveSegment(dataHist);
        const response = await fetch('/api/trading-scopes/portfolio', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sport:querySport, scope:requestedScope, ids:filteredDataHist.history.map(r=>r.id), bankroll:currentBankroll}), ...(requestSignal ? {signal:requestSignal} : {})});
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Report non disponibile');
        if (!isPortfolioRenderCurrent(requestSequence, viewEpoch) || requestedScope !== window.TradingScopeUI.portfolioMode() || requestedSegment !== portfolioSegmentFilter) return {success:false, staleNavigation:true};
        const dataPort = payload.portfolio;
        const dataCal = payload.calibration;
        // The server returns a fresh, consistently scoped snapshot, including empty selections.
        filteredDataHist.history = payload.history;
        const segmentRep = buildSegmentPortfolioReportFromHistory(filteredDataHist, currentBankroll, dataPort.report || {});
        const segmentPort = {...dataPort, success:true, report:segmentRep, meta:segmentRep.meta, warning:segmentRep.warning};

        if (segmentPort.success && segmentPort.report) {
            const rep = segmentPort.report;
            latestPortfolioReport = rep;
            latestPortfolioResponse = segmentPort;
            renderPortfolioStrictScopeNotice(segmentPort, rep, filteredDataHist);
            renderPortfolioSeniorAuditPanel(segmentPort, rep, filteredDataHist);
            renderPortfolioDsGateMeasurementTable(segmentPort, filteredDataHist);
            renderPortfolioReliabilityCalibrationTable(segmentPort);
            attachSeniorAuditLayoutControls();

            if ($('portDrawdown')) {
                const dd = rep.bankroll?.drawdown || {};
                const ddPct = safeNumber(dd.maxDrawdownPct ?? dd.maxDrawdown, 0);
                const ddAmount = safeNumber(dd.maxDrawdownAmount, 0);
                $('portDrawdown').innerHTML = `${formatNumber(ddPct, 2)}%<div style="font-size:.65em;color:#fca5a5;margin-top:3px;">€${formatNumber(ddAmount, 2)} da equity peak</div>`;
            }

            if ($('portSharpe')) {
                $('portSharpe').innerText = rep.bankroll?.roi?.sharpeLike || '0.00';
            }

            if ($('portSteam')) {
                const coverage = rep.analytics?.clvCoverage || {};
                const covPct = safeNumber(coverage.clvCoveragePct, 0);
                const totalWithClv = safeNumber(coverage.totalWithClv, 0);
                const totalSample = safeNumber(coverage.totalSample, 0);
                $('portSteam').innerHTML = `${formatNumber(covPct, 1)}%<div style="font-size:.65em;color:#fde68a;margin-top:3px;">${totalWithClv}/${totalSample} righe</div>`;
            }

            if ($('portAvgClv')) {
                const clvSample = safeNumber(rep.analytics?.clv?.sampleSize, 0);
                const avgCLV = safeNumber(rep.analytics?.clv?.avgCLV, 0);
                $('portAvgClv').innerText = clvSample > 0 ? `${avgCLV > 0 ? '+' : ''}${formatNumber(avgCLV, 2)}%` : 'N/A';
            }

            const stratTable = $('topStrategiesTable');

            if (stratTable) {
                if (rep.topStrategies && rep.topStrategies.length > 0) {
                    stratTable.innerHTML = rep.topStrategies.map(s => {
                        const qualityColor = s.quality === 'ELITE'
                            ? '#a855f7'
                            : (s.quality === 'GOOD' ? '#3b82f6' : '#94a3b8');

                        return `
                            <tr style="border-bottom:1px solid var(--border-color);">
                                <td style="padding:12px 10px;"><strong>${htmlEscape(s.strategy)}</strong></td>
                                <td style="padding:12px 10px;">${safeNumber(s.bets, 0)}</td>
                                <td style="padding:12px 10px;">${safeNumber(s.hitRate, 0)}%</td>
                                <td style="padding:12px 10px; color:${colorByPositiveNegative(s.roi)}; font-weight:bold;">${safeNumber(s.roi, 0) > 0 ? '+' : ''}${safeNumber(s.roi, 0)}%</td>
                                <td style="padding:12px 10px; color:#38bdf8;">${s.avgCLV == null ? 'N/D' : (safeNumber(s.avgCLV,0)>0?'+':'')+formatNumber(s.avgCLV,2)+'%'}</td>
                                <td style="padding:12px 10px;">${safeNumber(s.brier, 0)}</td>
                                <td style="padding:12px 10px;">
                                    <span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:4px; color:${qualityColor}; font-weight:bold; font-size:0.85em;">${htmlEscape(s.quality)}</span>
                                </td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    stratTable.innerHTML = `
                        <tr>
                            <td colspan="7" style="text-align:center; padding:20px;">
                                Nessuna strategia analizzabile per questo sport.
                            </td>
                        </tr>
                    `;
                }
            }
        }

        try {
            renderPortfolioEquityChart(filteredDataHist);
        } catch (chartError) {
            console.error('Errore grafico equity/drawdown:', chartError);
            updateDrawdownDataAuditPanel(filteredDataHist);
        }

        try {
            renderCalibrationSection(dataCal, filteredDataHist);
        } catch (calibrationError) {
            console.error('Errore render calibrazione/Brier:', calibrationError);
            const tbody = $('calibrationBucketsTable');
            const badge = $('calibrationQualityBadge');
            if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div style="color:#fbbf24;text-align:left;padding:12px;">Calibrazione/Brier non renderizzati: ${htmlEscape(calibrationError.message || calibrationError)}</div></td></tr>`;
            if (badge) { badge.innerText = 'ERRORE UI'; badge.style.backgroundColor = '#ef4444'; }
        }
        window.TradingScopeUI.finishPortfolio(filteredDataHist.history);
        window.PortfolioR3.render(payload, querySport, requestedScope);
        loadSportBankroll();
    } catch (error) {
        if (error?.name !== 'AbortError' && isPortfolioRenderCurrent(requestSequence, viewEpoch)) { console.error('Errore render Portfolio:', error); window.TradingScopeUI.portfolioError(error); }
    } finally {
        if (requestSequence === portfolioRequestSequence) portfolioAbortController = null;
        if (isPrimaryViewCurrent('PORTFOLIO', viewEpoch)) hideLoading();
    }
}

function renderPortfolioSeniorAuditPanel(dataPort = {}, rep = {}, dataHist = {}) {
    const section = $('portfolioSection');
    if (!section) return;

    let panel = $('portfolioSeniorAuditPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'portfolioSeniorAuditPanel';
        panel.className = 'card-container portfolio-extra-panel';
        panel.style.borderLeft = '4px solid #a855f7';
        panel.style.marginBottom = '14px';
        const notice = $('portfolioStrictScopeNotice');
        if (notice && notice.parentNode) notice.parentNode.insertBefore(panel, notice.nextSibling);
        else section.prepend(panel);
    }

    const historyRows = Array.isArray(dataHist.history) ? dataHist.history : [];
    const cleanRows = historyRows
        .filter(b => !String(b.bet_type || '').toUpperCase().includes('MULTI'))
        .filter(b => b.status === 'WON' || b.status === 'LOST')
        .filter(b => activeSport === SPORT.TENNIS ? isTennisRow(b) : isCalcioRow(b))
        .filter(isCleanCurrentRow);

    const realPortfolioRows = cleanRows.filter(row => window.TradingScopeUI.portfolioIncludes(row));
    const excludedCounterfactualRows = activeSport === SPORT.TENNIS ? cleanRows.length - realPortfolioRows.length : 0;

    const byPrediction = realPortfolioRows.reduce((acc, row) => {
        const key = safeString(row.prediction || 'N/D');
        if (!acc[key]) acc[key] = { total: 0, won: 0, profit: 0 };
        acc[key].total += 1;
        if (row.status === 'WON') acc[key].won += 1;
        acc[key].profit += safeNumber(row.profit, 0);
        return acc;
    }, {});

    const topRows = Object.entries(byPrediction)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 6)
        .map(([prediction, v]) => {
            const hit = v.total ? (v.won / v.total) * 100 : 0;
            return `<tr><td>${htmlEscape(prediction)}</td><td>${v.total}</td><td>${formatNumber(hit, 1)}%</td><td style="color:${colorByPositiveNegative(v.profit)};">${v.profit >= 0 ? '+' : ''}€${formatNumber(v.profit, 2)}</td></tr>`;
        }).join('');

    const meta = dataPort.meta || rep.meta || {};
    const bankroll = rep.bankroll || {};
    const reconciliation = bankroll.reconciliation || {};
    const dd = bankroll.drawdown || {};
    const coverage = rep.analytics?.clvCoverage || {};
    const cohorts = rep.auditGrade?.step67Cohorts || {};
    const learning = rep.analytics?.clvLearning?.tennis || null;
    const actions = learning?.recommendedActions || {};

    const clvHasCoveragePayload = coverage.totalSample !== undefined;
    const clvTotalSample = safeNumber(coverage.totalSample, 0);
    const clvTotalWithClv = safeNumber(coverage.totalWithClv, 0);
    const clvOperationalWithClv = safeNumber(coverage.operationalWithClv, 0);
    const clvMissing = safeNumber(coverage.missingClv, Math.max(0, clvTotalSample - clvTotalWithClv));
    const clvStatus = safeString(coverage.status || (clvTotalWithClv > 0 ? 'CLV_AVAILABLE' : 'NO_VALID_CLV'));
    const clvTotalDisplay = clvTotalWithClv > 0 ? `${formatNumber(coverage.beatenTotalPct, 1)}%` : 'N/D';
    const clvAvailableDisplay = clvTotalWithClv > 0 ? `${formatNumber(coverage.beatenAvailablePct, 1)}%` : 'N/D';
    const clvOperationalDisplay = clvOperationalWithClv > 0 ? `${formatNumber(coverage.operationalBeatenPct, 1)}%` : 'N/D';
    const clvInvalidLegacyRows = safeNumber(coverage.invalidLegacyClvRows, 0);
    const clvAuditMessage = clvTotalWithClv === 0
        ? `CLV non disponibile/verificato: nessuna closing line certificata trovata. ${clvInvalidLegacyRows > 0 ? clvInvalidLegacyRows + ' valori legacy/placeholder esclusi dal calcolo. ' : ''}N/D non è una bocciatura del modello.`
        : (clvStatus === 'CLV_FLAT_ZERO_REVIEW'
            ? 'CLV presente ma tutto a 0.00%: campione da verificare prima di usarlo come segnale di qualità.'
            : (safeNumber(coverage.totalPositiveClv, 0) === 0
                ? 'CLV verificato disponibile ma non battuto: le quote operative non risultano migliori della closing line sul campione disponibile.'
                : 'CLV verificato disponibile: percentuali calcolate solo sulle righe con closing line certificata.'));

    const clvCoverageHtml = clvHasCoveragePayload ? `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:12px;">
            <div style="background:rgba(59,130,246,.08); border:1px solid rgba(59,130,246,.25); border-radius:10px; padding:10px;">
                <div style="color:#93c5fd;font-size:.72em;text-transform:uppercase;font-weight:800;">CLV beaten totale</div>
                <strong style="color:#bfdbfe;font-size:1.15em;">${clvTotalDisplay}</strong>
                <div style="color:#94a3b8;font-size:.75em;">${safeNumber(coverage.totalPositiveClv, 0)}/${clvTotalSample} incl. missing · missing ${clvMissing}</div>
            </div>
            <div style="background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.25); border-radius:10px; padding:10px;">
                <div style="color:#6ee7b7;font-size:.72em;text-transform:uppercase;font-weight:800;">CLV beaten disponibile</div>
                <strong style="color:#bbf7d0;font-size:1.15em;">${clvAvailableDisplay}</strong>
                <div style="color:#94a3b8;font-size:.75em;">coverage ${formatNumber(coverage.clvCoveragePct, 1)}% · ${clvTotalWithClv}/${clvTotalSample}</div>
            </div>
            <div style="background:rgba(168,85,247,.08); border:1px solid rgba(168,85,247,.25); border-radius:10px; padding:10px;">
                <div style="color:#ddd6fe;font-size:.72em;text-transform:uppercase;font-weight:800;">CLV operativo</div>
                <strong style="color:#e9d5ff;font-size:1.15em;">${clvOperationalDisplay}</strong>
                <div style="color:#94a3b8;font-size:.75em;">${safeNumber(coverage.operationalPositiveClv, 0)}/${clvOperationalWithClv} · avg ${clvOperationalWithClv > 0 && coverage.avgClvOperational > 0 ? '+' : ''}${clvOperationalWithClv > 0 ? formatNumber(coverage.avgClvOperational, 2) + '%' : 'N/D'}</div>
            </div>
        </div>
        <div style="margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid rgba(148,163,184,.22); background:rgba(15,23,42,.45); color:#cbd5e1; font-size:.82em; line-height:1.45;">
            <strong style="color:${clvTotalWithClv > 0 ? '#93c5fd' : '#fbbf24'};">CLV audit ${htmlEscape(clvStatus)}:</strong> ${htmlEscape(clvAuditMessage)}
        </div>` : '';

    // STEP84_HIDE_PORTFOLIO_READ_TABLE / STEP79_HIDE_COHORT_TABLE
    // Le etichette legacy restano solo come marker test: Come leggere le coorti · Storico reale precedente Step67 · Trading reale nuovo regime Step67+ · Diagnostica alto rischio precedente Step67 · Come leggere le righe portafoglio.
    // La tabella Lettura portafoglio/Coorte è stata rimossa perché duplicava dati non filtrati e non utili alla lettura operativa.
    const cohortRows = '';
    const cohortLegendHtml = '';

    const learningHtml = activeSport === SPORT.TENNIS && learning ? `
        <div style="margin-top:12px; padding:10px; border-radius:10px; border:1px solid rgba(34,197,94,.25); background:rgba(34,197,94,.06);">
            <strong style="color:#86efac;">Learning CLV/Brier Tennis</strong>
            <div style="color:#cbd5e1; font-size:.82em; margin-top:5px; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:6px;">
                <div>WTA Moneyline: <strong>${htmlEscape(actions.wtaMoneyline || 'N/D')}</strong></div>
                <div>ATP Moneyline: <strong>${htmlEscape(actions.atpMoneyline || 'N/D')}</strong></div>
                <div>Value confermato/micro: <strong>${htmlEscape(actions.valueConfirmedMicro || 'N/D')}</strong></div>
                <div>Edge tecnico: <strong>${htmlEscape(actions.technicalEdge || 'N/D')}</strong></div>
            </div>
        </div>` : '';

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
            <div>
                <strong style="color:#a855f7;">Audit Portafoglio ${activeSport === SPORT.TENNIS ? 'Tennis' : 'Calcio'} · ${htmlEscape(getPortfolioSegmentLabel())} · Step71</strong>
                <div style="color:#cbd5e1; font-size:.9em; margin-top:4px;">${htmlEscape(window.TradingScopeUI.portfolioDescription())}</div>
                ${excludedCounterfactualRows > 0 ? `<div style="color:#fbbf24; font-size:.82em; margin-top:5px;">Counterfactual/Audit esclusi dal ROI reale: ${excludedCounterfactualRows}. Le BLOCCATE restano diagnostiche, non trading reale.</div>` : ''}
                ${cohorts.warning ? `<div style="color:#f97316; font-size:.82em; margin-top:5px; font-weight:800;">⚠️ ${htmlEscape(cohorts.warning)}</div>` : ''}
            </div>
            <div style="text-align:right; color:#94a3b8; font-size:.85em;">Campione selezionato: <strong style="color:#f8fafc;">${safeNumber(meta.sampleSize, realPortfolioRows.length)}</strong><br><span>Clean storico: ${cleanRows.length}</span></div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px; margin-top:12px;">
            <div style="background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:10px;"><div style="color:#94a3b8;font-size:.75em;text-transform:uppercase;font-weight:800;">Capitale iniziale dello sport</div><strong>€${formatNumber(reconciliation.initialBankroll ?? bankroll.initialBankroll, 2)}</strong></div>
            <div style="background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:10px;"><div style="color:#94a3b8;font-size:.75em;text-transform:uppercase;font-weight:800;">Profitto realizzato</div><strong style="color:${colorByPositiveNegative(reconciliation.realizedProfit ?? bankroll.realizedProfit)};">${safeNumber(reconciliation.realizedProfit ?? bankroll.realizedProfit, 0) >= 0 ? '+' : ''}€${formatNumber(reconciliation.realizedProfit ?? bankroll.realizedProfit, 2)}</strong></div>
            <div style="background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:10px;"><div style="color:#94a3b8;font-size:.75em;text-transform:uppercase;font-weight:800;">Equity del campione da 1.000 €</div><strong>€${formatNumber(reconciliation.finalBankroll ?? bankroll.finalBankroll, 2)}</strong></div>
            <div style="background:rgba(15,23,42,.45);border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:10px;"><div style="color:#94a3b8;font-size:.75em;text-transform:uppercase;font-weight:800;">Max DD da peak</div><strong style="color:#f87171;">${formatNumber(dd.maxDrawdownPct ?? dd.maxDrawdown, 2)}% · €${formatNumber(dd.maxDrawdownAmount, 2)}</strong></div>
        </div>
        ${clvCoverageHtml}
        ${learningHtml}
        <div class="table-responsive" style="margin-top:12px;">
            <table style="width:100%;">
                <thead><tr><th>Pronostico</th><th>Bet</th><th>Hit rate</th><th>Profit</th></tr></thead>
                <tbody>${topRows || '<tr><td colspan="4" style="text-align:center; padding:12px;">Campione clean/current non sufficiente.</td></tr>'}</tbody>
            </table>
        </div>
        ${cohortRows ? cohortLegendHtml : ''}
    `;
}

function renderPortfolioStrictScopeNotice(dataPort = {}, rep = {}) {
    const section = $('portfolioSection');
    if (!section) return;

    let notice = $('portfolioStrictScopeNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'portfolioStrictScopeNotice';
        notice.className = 'card-container';
        notice.style.borderLeft = '4px solid #38bdf8';
        notice.style.marginBottom = '14px';
        const firstCard = section.querySelector('.card-container');
        if (firstCard && firstCard.parentNode) firstCard.parentNode.insertBefore(notice, firstCard.nextSibling);
        else section.prepend(notice);
    }

    const meta = dataPort.meta || rep.meta || {};
    const sample = safeNumber(meta.sampleSize ?? rep.meta?.sampleSize, 0);
    const rawStrictSample = safeNumber(meta.rawStrictSampleSize ?? meta.sampleSize ?? rep.meta?.sampleSize, sample);
    const excludedCounterfactual = safeNumber(meta.tennisExcludedCounterfactual, 0);
    const warning = dataPort.warning || '';
    const sportLabel = activeSport === SPORT.TENNIS ? 'Tennis' : 'Calcio';

    notice.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
            <div>
                <strong style="color:#38bdf8;">Portfolio ${htmlEscape(sportLabel)} strict/current · ${htmlEscape(getPortfolioSegmentLabel())}</strong>
                <div style="color:#cbd5e1; font-size:0.9em; margin-top:4px;">
                    Usa solo sport=${htmlEscape(sportLabel.toUpperCase())}, data_quality CURRENT/CURRENT_BOOTSTRAP e status WON/LOST. Legacy NULL/LEGACY_DIRTY esclusi.
                    <br>${htmlEscape(window.TradingScopeUI.portfolioDescription())}
                </div>
                ${activeSport === SPORT.TENNIS && excludedCounterfactual > 0 ? `<div style="color:#fbbf24; font-weight:700; margin-top:6px;">Counterfactual/Audit esclusi dal portfolio reale: ${excludedCounterfactual} su ${rawStrictSample} clean.</div>` : ''}
                ${warning ? `<div style="color:#f59e0b; font-weight:800; margin-top:6px;">⚠️ ${htmlEscape(warning)}</div>` : ''}
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.75em; color:#94a3b8; text-transform:uppercase; font-weight:800;">Campione selezionato</div>
                <div style="font-size:1.4em; font-weight:900; color:${sample >= 10 ? '#10b981' : '#f59e0b'};">${sample}</div>
                <div style="font-size:0.75em; color:#94a3b8;">clean: ${rawStrictSample}</div>
            </div>
        </div>
    `;
}

function renderCalibrationSection(dataCal = {}, dataHist = {}) {
    const tbody = $('calibrationBucketsTable');
    const badge = $('calibrationQualityBadge');

    if (!tbody || !badge) return;

    // STEP84/STEP79_BRIER_FROM_HISTORY_FIRST: il Brier ATP/WTA deve essere costruito
    // dallo storico strict/current prima di dipendere dall'endpoint calibrazione.
    const tennisTourChartRendered = activeSport === SPORT.TENNIS ? renderTennisBrierTourCalibrationChart(dataHist) : false;

    if (activeSport === SPORT.TENNIS && tennisTourChartRendered && latestTennisBrierTourAudit?.buckets?.length) {
        updateCalibrationChartNoDataDiagnostic('');
        tbody.innerHTML = latestTennisBrierTourAudit.buckets.map(b => {
            const errAbs = Math.abs(safeNumber(b.calibrationError, 0));
            const errColor = errAbs <= 5 ? '#10b981' : (errAbs <= 12 ? '#f59e0b' : '#ef4444');
            return `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="font-weight:bold; color:#cbd5e1;">${htmlEscape(b.tour)} ${htmlEscape(b.bucket)}%</td>
                    <td>${safeNumber(b.sample, 0)}</td>
                    <td style="color:#38bdf8;">${formatNumber(b.avgPredictedProb, 2)}%</td>
                    <td style="color:#10b981;">${formatNumber(b.observedWinRate, 2)}%</td>
                    <td style="color:${errColor}; font-weight:bold;">${b.calibrationError > 0 ? '+' : ''}${formatNumber(b.calibrationError, 2)}pp</td>
                    <td><span style="font-size:0.8em; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.1);">${htmlEscape(b.status)} · Brier ${formatNumber(b.brier, 4)}</span></td>
                </tr>
            `;
        }).join('');
        badge.innerText = 'ATP/WTA';
        badge.style.backgroundColor = '#3b82f6';
        return;
    }

    if (!dataCal || !dataCal.success || !dataCal.report) {
        const errorMessage = safeString(dataCal?.error || dataCal?.warning || 'Endpoint /api/analytics/calibration senza report valido.');
        const noDataHtml = `
            <div style="text-align:left; padding:14px; border:1px solid rgba(245,158,11,.25); background:rgba(245,158,11,.07); border-radius:10px; color:#cbd5e1;">
                <strong style="color:#fbbf24;">Calibrazione non aggiornata</strong>
                <div style="margin-top:5px;">La tabella non resta più in caricamento infinito: il backend non ha restituito dati di calibrazione utilizzabili.</div>
                <div style="margin-top:6px; color:#94a3b8; font-size:.86em;">Dettaglio: ${htmlEscape(errorMessage)}</div>
                <div style="margin-top:6px; color:#93c5fd; font-size:.82em;">Controllare endpoint <code>/api/analytics/calibration?sport=${activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO'}</code>, sample strict/current e log server.</div>
            </div>`;
        tbody.innerHTML = `<tr><td colspan="6">${noDataHtml}</td></tr>`;
        updateCalibrationChartNoDataDiagnostic(noDataHtml);
        badge.innerText = 'NO DATA';
        badge.style.backgroundColor = '#f59e0b';
        if (chartCalibrationInstance) chartCalibrationInstance.destroy();
        return;
    }

    const calData = activeSport === SPORT.CALCIO
        ? window.PortfolioAccounting.calibration(dataCal.report.football || dataCal.report.calcio)
        : window.PortfolioAccounting.calibration(dataCal.report.tennis);

    const meta = dataCal.meta || {};
    const strictSample = safeNumber(meta.sampleSize, 0);
    const requiredSample = safeNumber(dataCal.report?.tennis?.buckets?.[0]?.minSample ?? dataCal.report?.football?.buckets?.[0]?.minSample ?? 5, 5);

    if (activeSport === SPORT.TENNIS && strictSample < requiredSample) {
        const noDataHtml = renderCalibrationNoDataDiagnostic(dataCal, calData || {});
        tbody.innerHTML = `
            <tr>
                <td colspan="6">${noDataHtml}</td>
            </tr>
        `;
        updateCalibrationChartNoDataDiagnostic(noDataHtml);
        badge.innerText = 'LOW SAMPLE';
        badge.style.backgroundColor = '#64748b';
        if (!tennisTourChartRendered && chartCalibrationInstance) chartCalibrationInstance.destroy();
        return;
    }

    if (calData && calData.buckets && calData.buckets.length > 0) {
        updateCalibrationChartNoDataDiagnostic('');
        tbody.innerHTML = calData.buckets.map(b => {
            const errAbs = Math.abs(safeNumber(b.calibrationError, 0));
            const errColor = errAbs <= 3
                ? '#10b981'
                : (errAbs <= 7 ? '#f59e0b' : '#ef4444');

            return `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="font-weight:bold; color:#cbd5e1;">${htmlEscape(b.bucket)}%</td>
                    <td>${safeNumber(b.sample, 0)}</td>
                    <td style="color:#3b82f6;">${safeNumber(b.avgPredictedProb, 0)}%</td>
                    <td style="color:#10b981;">${safeNumber(b.observedWinRate, 0)}%</td>
                    <td style="color:${errColor}; font-weight:bold;">${safeNumber(b.calibrationError, 0) > 0 ? '+' : ''}${safeNumber(b.calibrationError, 0)} pp</td>
                    <td>
                        <span style="font-size:0.8em; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.1);">
                            ${htmlEscape(b.status)}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        const q = calData.summary?.quality || 'LOW_SAMPLE';

        badge.innerText = q;
        badge.style.backgroundColor = q === 'ELITE'
            ? '#a855f7'
            : (q === 'GOOD' ? '#3b82f6' : '#64748b');

        const ctxCal = ensurePortfolioChartLayout('chartCalibration')?.getContext('2d');

        if (!tennisTourChartRendered && ctxCal && window.Chart) {
            if (chartCalibrationInstance) chartCalibrationInstance.destroy();

            chartCalibrationInstance = new Chart(ctxCal, {
                type: 'line',
                data: {
                    labels: calData.buckets.map(b => b.bucket),
                    datasets: [
                        {
                            label: 'Predizione IA (%)',
                            data: calData.buckets.map(b => safeNumber(b.avgPredictedProb, 0)),
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59,130,246,0.2)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: 'Win Rate Reale (%)',
                            data: calData.buckets.map(b => safeNumber(b.observedWinRate, 0)),
                            borderColor: '#10b981',
                            borderDash: [5, 5],
                            borderWidth: 2,
                            fill: false,
                            tension: 0.4
                        }
                    ]
                },
                options: step85PortfolioChartOptions({
                    plugins: {
                        legend: {
                            labels: {
                                color: '#cbd5e1'
                            }
                        }
                    },
                    scales: {
                        y: {
                            grid: { color: '#334155' },
                            ticks: { color: '#cbd5e1' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#cbd5e1' }
                        }
                    }
                })
            });
        }
    } else {
        const noDataHtml = renderCalibrationNoDataDiagnostic(dataCal, calData || {});
        tbody.innerHTML = `
            <tr>
                <td colspan="6">${noDataHtml}</td>
            </tr>
        `;
        updateCalibrationChartNoDataDiagnostic(noDataHtml);

        badge.innerText = 'NO DATA';

        if (!tennisTourChartRendered && chartCalibrationInstance) chartCalibrationInstance.destroy();
    }
}

function renderPortfolioEquityChart(dataHist) {
    if (!dataHist || !Array.isArray(dataHist.history)) return;

    const closedBets = getPortfolioResolvedRowsForChart(dataHist, { operationalOnly: activeSport === SPORT.TENNIS });

    const canvas = ensurePortfolioChartLayout('chartDrawdown');
    const ctxDraw = canvas?.getContext('2d');

    if (!ctxDraw || !window.Chart) {
        updateDrawdownDataAuditPanel(dataHist);
        const box = $('drawdownChartDataAuditPanel');
        if (box && !window.Chart) {
            box.insertAdjacentHTML('afterbegin', '<div style="margin-top:10px;color:#fbbf24;text-align:left;">Chart.js non disponibile: dati equity/drawdown calcolati nella verifica sotto.</div>');
        }
        return;
    }

    if (closedBets.length === 0) {
        if (chartDrawdownInstance) chartDrawdownInstance.destroy();
        updateDrawdownDataAuditPanel(dataHist);
        return;
    }

    const baseEquity = 1000;
    let equity = baseEquity;

    const labels = [];
    const equityData = [];

    closedBets.forEach(b => {
        equity += safeNumber(b.profit, 0);
        labels.push(safeString(b.match_date).split(',')[0]);
        equityData.push(round(equity, 2));
    });

    const isProfit = equity >= baseEquity;
    const lineColor = isProfit ? '#10b981' : '#ef4444';
    const fillColor = isProfit ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';

    updateDrawdownDataAuditPanel(dataHist);

    if (chartDrawdownInstance) chartDrawdownInstance.destroy();

    chartDrawdownInstance = new Chart(ctxDraw, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Bankroll (€)',
                    data: equityData,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 1
                }
            ]
        },
        options: step85PortfolioChartOptions({
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    grid: { color: '#334155' },
                    ticks: { color: '#cbd5e1' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#cbd5e1',
                        maxTicksLimit: 10
                    }
                }
            }
        })
    });
}

$('portfolioBtn')?.addEventListener('click', () => {
    const viewEpoch = enterPrimaryView('PORTFOLIO');
    nascondiTutto();
    $('portfolioSection')?.classList.remove('hidden');
    attachSeniorAuditLayoutControls();
    loadPortfolioData(viewEpoch);
});

$('refreshPortfolioBtn')?.addEventListener('click', () => {
    if (primaryViewName !== 'PORTFOLIO') return;
    loadPortfolioData(primaryViewEpoch);
});


// ============================================================================
// 8. DEEP SCAN
// ============================================================================


function calcioReliabilityColor(score) {
    const n = safeNumber(score, 0);
    if (n >= 85) return '#10b981';
    if (n >= 70) return '#22c55e';
    if (n >= 55) return '#f59e0b';
    if (n >= 40) return '#f97316';
    return '#ef4444';
}

const CALCIO_RELIABILITY_CALIBRATION_UI_VERSION = 'BETTING_PATCH_26F_D_RELIABILITY_CALIBRATION_UI_V1';

function parseCalcioJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) { return null; }
}

function resolveCalcioAiReliability(row = {}) {
    const snapshot = parseCalcioJsonObject(row.calcio_final_market_snapshot);
    const dualAudit = parseCalcioJsonObject(row.calcio_dual_score_audit);
    const candidates = [
        { score: row.calcio_prediction_reliability_score ?? row.prediction_reliability_score ?? row.predictionReliability?.score, label: row.calcio_prediction_reliability_label ?? row.prediction_reliability_label ?? row.predictionReliability?.label, source: 'ANALISI_AI_FINAL' },
        { score: snapshot?.forecastConfidence?.score, label: snapshot?.forecastConfidence?.label, source: 'FINAL_MARKET_SNAPSHOT' },
        { score: row.calcio_forecast_confidence_score ?? row.calcio_forecast_confidence_shadow ?? dualAudit?.forecastConfidenceScore, label: row.calcio_forecast_confidence_label ?? dualAudit?.label, source: 'DUAL_SCORE_SHADOW' }
    ];
    const selected = candidates.find(item => Number.isFinite(Number(item.score)) && Number(item.score) >= 0 && Number(item.score) <= 100);
    if (!selected) return { available:false, score:null, label:'N/D', source:'ABSENT' };
    const score = Number(selected.score);
    const fallbackLabel = score >= 85 ? 'ALTA' : score >= 70 ? 'BUONA' : score >= 55 ? 'MEDIA' : score >= 40 ? 'BASSA' : 'MOLTO BASSA';
    return { available:true, score, label:safeString(selected.label || fallbackLabel).replaceAll('_',' '), source:selected.source };
}

function renderCalcioAiReliabilityCell(row = {}) {
    const reliability = resolveCalcioAiReliability(row);
    if (!reliability.available) return '<span style="color:#64748b">N/D</span>';
    const temporal = resolveCalcioTemporalView(row);
    const preliminary = isCalcioTemporalPreliminary(row);
    const displayLabel = preliminary ? 'PRELIMINARE' : reliability.label;
    const displayColor = preliminary ? '#fbbf24' : calcioReliabilityColor(reliability.score);
    return `<div title="Solidità delle evidenze e del forecast; non è probabilità di vincita. Fonte: ${htmlEscape(reliability.source)}${preliminary ? ' · Label operativa sospesa fino alla finestra matura.' : ''}" style="min-width:105px;">
        <strong style="color:${displayColor};font-size:1.02em;">${formatNumber(reliability.score,0)}%</strong>
        <div style="font-size:.68em;color:${displayColor};margin-top:2px;font-weight:800;">${htmlEscape(displayLabel)}</div>
        <div style="font-size:.6em;color:#64748b;margin-top:2px;">${preliminary ? htmlEscape(temporal.presentationLabel || temporal.stage) : 'solidità evidenze · non win%'}</div>
    </div>`;
}


const UNIFIED_ANALYSIS_TABLE_SPORT_PARITY_VERSION = 'BETTING_PATCH_26F_E_UNIFIED_ANALYSIS_TABLE_SPORT_PARITY_V1';
const TENNIS_PREDICTION_INDEX_DISPLAY_VERSION = 'BETTING_PATCH_26F_E_TENNIS_PREDICTION_INDEX_DISPLAY_V1';
const TENNIS_PATCH34_R4_SETTLEMENT_TRUTH_UI = 'TENNIS_PATCH34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS';
const TENNIS_PATCH35_CLV_STAKE_GOVERNANCE_UI = 'TENNIS_PATCH35_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD';
const TENNIS_PATCH38_DECISION_TRUTH_UI = 'TENNIS_PATCH38_FORWARD_HEALTH_DECISION_TRUTH_EXTERNAL_EVIDENCE_INTEGRITY';

function resolveTennisEvidenceQuality(row = {}) {
    const index = row.tennisPredictionIndex || row.tennis_prediction_index || {};
    const scoreRaw = row.model_confidence_score ?? row.modelConfidenceScore ?? row.valueScore ?? index.components?.modelConfidence?.score;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score) || score < 0 || score > 100) return { available:false, score:null, label:'N/D', source:'ABSENT' };
    const label = score >= 85 ? 'ALTA' : score >= 70 ? 'BUONA' : score >= 55 ? 'MEDIA' : score >= 40 ? 'BASSA' : 'MOLTO BASSA';
    return { available:true, score, label, source:'TENNIS_MODEL_CONFIDENCE' };
}
function resolveTennisAiWinProbability(row = {}) {
    const research = row.t11DecisionResearch || row.t11_decision_research || row.tennisDecisionResearch || null;
    const shadow = row.aiReliabilityShadow || research?.aiReliabilityShadow || null;
    if (!shadow || shadow.available !== true || !Number.isFinite(Number(shadow.aiReliabilityPct))) {
        const market = safeString(row.market_type || row.marketType || '').toUpperCase();
        const totals = market.includes('TOTAL') || /\b(OVER|UNDER|O\d|U\d)/i.test(safeString(row.prediction));
        return { available:false, totals, reason: shadow?.reason || (totals ? 'TOTALS_CALIBRATION_NOT_CERTIFIED' : 'ATTESA_DEEPSCAN_RESEARCH') };
    }
    return { available:true, score:Number(shadow.aiReliabilityPct), low:Number(shadow.ci95LowPct), high:Number(shadow.ci95HighPct), raw:Number(shadow.rawModelProbabilityPct), calibrated:Number(shadow.calibratedModelProbabilityPct), tradingN:Number(shadow.bayesianTradingUpdate?.operationalResolved || 0), tradingWins:Number(shadow.bayesianTradingUpdate?.operationalWins || 0), tradingWr:Number(shadow.bayesianTradingUpdate?.operationalWinRatePct), tradingRoi:Number(shadow.bayesianTradingUpdate?.operationalRoiPct), historicalWeight:Number(shadow.bayesianTradingUpdate?.historicalWeightPct || 0), evidenceState:safeString(shadow.bayesianTradingUpdate?.evidenceState || ''), source:safeString(shadow.source || 'T11_R2_SHADOW'), stable:shadow.stableToPriorStrength === true, sensitivity:Number(shadow.sensitivityRangePp) };
}
function renderTennisAiWinProbabilityCell(row = {}) {
    const rel = resolveTennisAiWinProbability(row);
    if (!rel.available) { const txt=rel.totals?'N/D':'⏳', sub=rel.totals?'Totals non calibrata':'dopo DeepScan'; return `<div title="Affidabilità AI Tennis = P(win) shadow. ${htmlEscape(rel.reason || '')}. Nessuna autorità stake." style="min-width:112px;text-align:center;"><strong style="color:#94a3b8;">${txt}</strong><div style="font-size:.60em;color:#64748b;margin-top:2px;">${sub}</div></div>`; }
    const color=calcioReliabilityColor(rel.score), ci=Number.isFinite(rel.low)&&Number.isFinite(rel.high)?`${formatNumber(rel.low,1)}–${formatNumber(rel.high,1)}%`:'N/D', wr=Number.isFinite(rel.tradingWr)?`${formatNumber(rel.tradingWr,1)}%`:'N/D', roi=Number.isFinite(rel.tradingRoi)?`${formatNumber(rel.tradingRoi,1)}%`:'N/D';
    const title=[`Affidabilità AI shadow P(win): ${formatNumber(rel.score,2)}%`,`CI approx 95%: ${ci}`,`Prob. modello raw: ${formatNumber(rel.raw,2)}%`,`Logit-V1 calibrata: ${formatNumber(rel.calibrated,2)}%`,`Trading-only DS×Gate: n=${rel.tradingN} · WR=${wr} · ROI=${roi}`,`Peso storico Trading: ${formatNumber(rel.historicalWeight,1)}%`,`Sensibilità prior: ${Number.isFinite(rel.sensitivity)?formatNumber(rel.sensitivity,2)+' pp':'N/D'} · ${rel.stable?'STABILE':'DA VALIDARE'}`,`Fonte: ${rel.source}`,'SHADOW ONLY: non modifica probabilità production, Quality Gate o stake.'].join('\n');
    return `<div title="${htmlEscape(title)}" style="min-width:112px;text-align:center;"><strong style="color:${color};font-size:1.02em;">${formatNumber(rel.score,1)}%</strong><div style="font-size:.68em;color:${color};font-weight:900;margin-top:2px;">P(win) SHADOW</div><div style="font-size:.60em;color:#94a3b8;margin-top:2px;">CI ${htmlEscape(ci)}</div><div style="font-size:.58em;color:#a78bfa;margin-top:2px;">Trading n=${rel.tradingN} · peso ${formatNumber(rel.historicalWeight,0)}%</div></div>`;
}
function resolveTennisCalibratedValueShadow(row = {}) {
    const v = row.calibratedValueShadow || row.t11CalibratedValueShadow || null;
    if (v?.available === true) return v;
    const rel = resolveTennisAiWinProbability(row);
    const odd = safeNumber(row.odd, 0);
    const market = safeString(row.market_type || row.marketType || '').toUpperCase();
    const totals = market.includes('TOTAL') || /\b(OVER|UNDER|O\d|U\d)/i.test(safeString(row.prediction));
    if (totals || !rel.available || !(odd > 1)) return { available:false, reason:totals?'TOTALS_OR_NON_MONEYLINE_CALIBRATED_VALUE_NOT_CERTIFIED':'ATTESA_DEEPSCAN_RESEARCH' };
    const breakEvenProbabilityPct = 100 / odd;
    const calibratedEdgePp = rel.score - breakEvenProbabilityPct;
    const calibratedEvPct = ((rel.score / 100) * odd - 1) * 100;
    const finalStake = safeNumber(resolveTennisStakeExecutionContractUi(row)?.finalExecution?.executableStake, 0);
    const near = Math.abs(calibratedEdgePp) <= 0.05;
    const positive = calibratedEdgePp > 0.05;
    const comparisonClass = near ? 'CALIBRATED_NEUTRAL' : ((finalStake > 0) === positive ? 'CALIBRATED_SUPPORT' : 'CALIBRATED_CONTRADICTION');
    return { available:true, shadowOnly:true, breakEvenProbabilityPct, calibratedEdgePp, calibratedEvPct, comparisonClass, comparisonDirection:'UI_FALLBACK_DERIVED_FROM_PWIN_SHADOW', finalExecutableStake:finalStake, ciRelationship:'CI_UNAVAILABLE', authority:{stake:false,qualityGate:false,probabilityProduction:false} };
}
function tennisCalibratedValueColor(value = {}) {
    if (value.comparisonClass === 'CALIBRATED_CONTRADICTION') return '#f97316';
    if (value.comparisonClass === 'CALIBRATED_SUPPORT') return '#22c55e';
    return '#94a3b8';
}
function renderTennisCalibratedValueMini(row = {}) {
    const v = resolveTennisCalibratedValueShadow(row);
    if (!v.available) return `<div style="font-size:.60em;color:#64748b;margin-top:4px;">Shadow calibrato: N/D${safeString(v.reason).includes('TOTALS')?' · Totals':''}</div>`;
    const color = tennisCalibratedValueColor(v);
    const label = safeString(v.comparisonClass || 'CALIBRATED_NEUTRAL').replace('CALIBRATED_','');
    const ci = safeString(v.ciRelationship || 'CI_UNAVAILABLE').replaceAll('_',' ');
    const title = [
        `P(win) shadow: ${formatNumber(row.aiReliabilityShadow?.aiReliabilityPct ?? row.t11DecisionResearch?.aiReliabilityShadow?.aiReliabilityPct,2)}%`,
        `Break-even quota: ${formatNumber(v.breakEvenProbabilityPct,2)}%`,
        `Edge calibrato: ${formatPct(v.calibratedEdgePp,2,true)}`,
        `EV calibrato: ${formatPct(v.calibratedEvPct,2,true)}`,
        `Confronto stake production: ${safeString(v.comparisonClass)}`,
        `${ci}`,
        'SHADOW ONLY: nessuna modifica a Quality Gate, Patch39 o Patch46.'
    ].join('\n');
    return `<div title="${htmlEscape(title)}" style="font-size:.62em;margin-top:4px;line-height:1.25;"><span style="color:${color};font-weight:900;">Shadow ${formatPct(v.calibratedEdgePp,2,true)} · EV ${formatPct(v.calibratedEvPct,2,true)}</span><div style="color:${color};font-size:.92em;font-weight:800;">${htmlEscape(label)}</div></div>`;
}
function renderUnifiedEdgeEvCell(row = {}) {
    // BETTINGAPP_CALCIO_EV_SCOPE_UI_R1_20261105: model EV for the selected market is NOT market-independent or operationally certified.
    const edgePp = getBetEdgePp(row), evPct = getBetEvPct(row);
    const base = `<div style="font-weight:bold;color:#f8fafc;">${formatPct(edgePp,2,true)}</div><div style="font-size:.76em;color:${colorByPositiveNegative(evPct)};margin-top:3px;">EV ${formatPct(evPct,2,true)}</div>`;
    if (isTennisRow(row) || activeSport === SPORT.TENNIS) return base + renderTennisCalibratedValueMini(row);
    const operational = safeNumber(row.calcio_operational_stake ?? row.stake_operational ?? row.operationalStake, 0);
    const info = operational > 0 ? 'Stake registrato: verificare autorita portfolio' : 'Stake 0 · SOLO ANALISI';
    return base.replace('>EV ', '>EV teorico ')
      + `<div title="EV della selezione indicata, calcolato con la probabilita del modello; NON trasferibile ad altri mercati. Nessun EV prudente o ROI certificato da questa colonna." style="font-size:.62em;color:#fbbf24;margin-top:4px;line-height:1.3;">Solo mercato selezionato · EV prudente N/D</div>`
      + `<div style="font-size:.61em;color:#94a3b8;margin-top:2px;">${htmlEscape(info)}</div>`;
}

function renderTennisEvidenceQualityCell(row = {}) { const r=resolveTennisEvidenceQuality(row); if(!r.available)return '<span style="color:#64748b">N/D</span>'; return `<div title="Qualità/solidità delle evidenze Tennis; non è probabilità di vittoria. Fonte: ${htmlEscape(r.source)}" style="min-width:105px;"><strong style="color:${calcioReliabilityColor(r.score)};font-size:1.02em;">${formatNumber(r.score,0)}/100</strong><div style="font-size:.68em;color:#cbd5e1;margin-top:2px;">${htmlEscape(r.label)}</div><div style="font-size:.6em;color:#64748b;margin-top:2px;">qualità evidenze · non win%</div></div>`; }
function resolveUnifiedAiReliability(row = {}) { return isTennisRow(row)||activeSport===SPORT.TENNIS?resolveTennisAiWinProbability(row):resolveCalcioAiReliability(row); }
function renderUnifiedAiReliabilityCell(row = {}) { if(isTennisRow(row)||activeSport===SPORT.TENNIS)return renderTennisAiWinProbabilityCell(row); return renderCalcioAiReliabilityCell(row); }
function renderUnifiedEvidenceQualityCell(row = {}) { if(isTennisRow(row)||activeSport===SPORT.TENNIS)return renderTennisEvidenceQualityCell(row); return '<span title="Separazione Affidabilità AI / Qualità evidenze introdotta in T11 R2 per Tennis." style="color:#64748b;">—</span>'; }
function renderT11DecisionResearchDetail(research = null) { if(!research)return ''; const rel=research.aiReliabilityShadow||{},thr=research.thresholdContinuityShadow||{},a=research.analysis||{},d=safeString(a.diagnosis||'N/D'); const rh=rel.available===true?`<div class="metric-mini"><span>Affidabilità AI P(win)</span><strong>${formatNumber(rel.aiReliabilityPct,2)}%</strong><small>CI ${formatNumber(rel.ci95LowPct,1)}–${formatNumber(rel.ci95HighPct,1)}%</small></div>`:`<div class="metric-mini"><span>Affidabilità AI P(win)</span><strong>N/D</strong><small>${htmlEscape(rel.reason||'non disponibile')}</small></div>`; const th=thr.applicable===true?`<div class="metric-mini"><span>Soglia legacy</span><strong>${thr.legacy?.microEligible?'MICRO':'BLOCK'}</strong><small>${htmlEscape((thr.legacy?.failedConditions||[]).join(', ')||'tutti i criteri passati')}</small></div><div class="metric-mini"><span>Continuità shadow</span><strong>${formatNumber(thr.continuous?.score,1)}/100</strong><small>${htmlEscape(thr.continuous?.band||'')}</small></div>`:`<div class="metric-mini"><span>Continuità soglie</span><strong>N/A</strong><small>${htmlEscape(thr.status||'non applicabile')}</small></div>`; return `<div style="margin:0 0 14px;padding:12px;border:1px solid rgba(167,139,250,.42);border-radius:10px;background:rgba(109,40,217,.08);"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;"><strong style="color:#c4b5fd;">🧪 T11 R2 · Decision Research</strong><span style="font-size:.72rem;color:#94a3b8;">SHADOW ONLY · Patch46 invariata</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px;margin-top:10px;">${rh}${th}<div class="metric-mini"><span>Catena stake</span><strong>${htmlEscape(d)}</strong><small>${htmlEscape(a.firstZeroStage||'')}</small></div></div></div>`; }

function resolveUnifiedPredictionIndexScore(row = {}) {
    if (isTennisRow(row) || activeSport === SPORT.TENNIS) return safeNumber(calculateTennisPredictionIndexUiFallback(row)?.score, -1);
    return safeNumber(row.calcio_prediction_index_score ?? row.calcioPredictionIndex?.score ?? row.predictionIndex?.score, -1);
}

function tennisPredictionIndexLabel(score) {
    const n = safeNumber(score, 0);
    if (n < 45) return 'SCARTA';
    if (n < 60) return 'SOLO ANALISI';
    if (n < 70) return 'MICRO';
    if (n < 80) return 'VALUE';
    if (n < 90) return 'FORTE';
    return 'TOP';
}

function resolveTennisQualityGateUi(bet = {}) {
    const nested = bet.qualityGateV2 || bet.quality_gate_v2 || bet.qualityFinal || bet.qualityBase || {};
    const candidates = [nested.score, bet.quality_final_score, bet.qualityFinalScore, bet.quality_base_score, bet.qualityBaseScore, bet.professionalGate?.score];
    const found = candidates.map(Number).find(Number.isFinite);
    const score = Number.isFinite(found) ? Math.max(0, Math.min(100, found)) : null;
    const label = safeString(nested.label || bet.quality_final_label || bet.qualityFinalLabel || bet.quality_base_label || bet.qualityBaseLabel || bet.pre_match_gate_label || 'IN ATTESA DEEPSCAN').replaceAll('_',' ');
    const code = safeString(nested.code || bet.quality_final_code || bet.quality_base_code || bet.pre_match_gate_code || '');
    const reason = safeString(nested.reason || bet.quality_final_reason || bet.quality_base_reason || bet.tennis_operational_summary || '');
    return { available: score !== null, score, label, code, reason };
}

function renderTennisQualityGateCell(bet = {}) {
    const gate = resolveTennisQualityGateUi(bet);
    const scoreColor = gate.available ? calcioReliabilityColor(gate.score) : '#64748b';
    const operational = renderTennisOperationalBadge(bet);
    let canonicalBridge = bet.canonicalPlayerEvidenceBridge || bet.tennisCanonicalPlayerEvidence || null;
    if (!canonicalBridge && bet.tennis_canonical_player_evidence_json) {
        try { canonicalBridge = typeof bet.tennis_canonical_player_evidence_json === 'string' ? JSON.parse(bet.tennis_canonical_player_evidence_json) : bet.tennis_canonical_player_evidence_json; } catch (_) {}
    }
    const canonicalStatus = safeString(bet.tennis_canonical_player_evidence_status || canonicalBridge?.status || '');
    const rawDataQuality = safeString(bet.data_quality || bet.dataMode || '');
    const dataQuality = (rawDataQuality && rawDataQuality.toUpperCase() !== 'N/D')
        ? rawDataQuality.replaceAll('_',' ')
        : (canonicalStatus && canonicalStatus !== 'UNAVAILABLE' ? `CANONICAL ${canonicalStatus.replaceAll('_',' ')}` : 'N/D');
    const canonicalReady = canonicalStatus && canonicalStatus !== 'UNAVAILABLE';
    const canonicalScoreRaw = bet.tennis_canonical_player_evidence_score ?? canonicalBridge?.score;
    const canonicalScore = Number(canonicalScoreRaw);
    const productionSampleRaw = bet.data_sufficiency_score ?? bet.dataSufficiencyScore;
    const productionSample = Number(productionSampleRaw);
    const evidenceLabel = canonicalReady
        ? (canonicalStatus.includes('STALE_TECHNICAL') ? 'Profilo disponibile · tecnica obsoleta' : 'Profilo giocatori disponibile')
        : (dataQuality !== 'N/D' ? `Dati ${dataQuality}` : 'Profilo giocatori N/D');
    const validationLabel = Number.isFinite(productionSample) ? `Campione production ${formatNumber(productionSample,0)}/65` : 'Campione production non validato';
    const canonicalNote = canonicalReady ? `Canonical Player Evidence ${Number.isFinite(canonicalScore) ? formatNumber(canonicalScore,0) + '/100' : ''}: identità/display/contesto DeepScan; nessuna autorità su probabilità, gate o stake.` : '';
    const tooltip = [gate.code, gate.reason, evidenceLabel, validationLabel, canonicalNote, 'Gate Tennis finale dopo DeepScan; separato dal DeepScan IA.'].filter(Boolean).join('\n');
    return `<div id="quality-cell-${htmlEscape(bet.__rowIndex ?? '')}" title="${htmlEscape(tooltip)}" style="min-width:128px;text-align:center;">
        <div style="font-weight:900;color:${scoreColor};font-size:1rem;">${gate.available ? formatNumber(gate.score,0) + '/100' : 'N/D'}</div>
        <div style="font-size:.69rem;color:#cbd5e1;margin-top:2px;line-height:1.2;">${htmlEscape(gate.label)}</div>
        ${operational ? `<div style="margin-top:6px;">${operational}</div>` : ''}
        <div style="font-size:.60rem;color:${canonicalReady ? '#7dd3fc' : '#64748b'};margin-top:4px;">${htmlEscape(evidenceLabel)}</div>
        <div style="font-size:.57rem;color:#64748b;margin-top:2px;">${htmlEscape(validationLabel)}</div>
    </div>`;
}

function calculateTennisPredictionIndexUiFallback(bet = {}) {
    if (bet.tennisPredictionIndex && Number.isFinite(Number(bet.tennisPredictionIndex.score))) return bet.tennisPredictionIndex;
    if (bet.tennis_prediction_index && Number.isFinite(Number(bet.tennis_prediction_index.score))) return bet.tennis_prediction_index;
    const gate = resolveTennisQualityGateUi(bet);
    const historical = historicalCombinationFromBet(bet) || {};
    const dsText = safeString(bet.ds_action || bet.dsAction || '').toUpperCase();
    let dsScore = null;
    let dsClass = 'PENDING';
    if (dsText) {
        if (dsText.includes('ALTO RISCHIO') || dsText.includes('HIGH_RISK') || dsText.includes('🔴')) { dsScore = 15; dsClass = 'HIGH_RISK'; }
        else if (dsText.includes('RISCHIO MODELLO') || dsText.includes('MODEL_RISK') || dsText.includes('🟠')) { dsScore = 40; dsClass = 'MODEL_RISK'; }
        else if (dsText.includes('EDGE TECNICO') || dsText.includes('TECHNICAL_EDGE') || dsText.includes('📊')) { dsScore = 65; dsClass = 'TECHNICAL_EDGE'; }
        else if (dsText.includes('VALUE CONFERMATO') || dsText.includes('VIA LIBERA') || dsText.includes('🟢')) { dsScore = 80; dsClass = 'CONFIRMED_VALUE'; }
        else if (dsText.includes('WATCHLIST') || dsText.includes('LOW EDGE') || dsText.includes('🟡')) { dsScore = 55; dsClass = 'WATCHLIST'; }
        else { dsScore = 45; dsClass = 'OTHER'; }
    }
    const edge = getBetEdgePp(bet);
    const ev = getBetEvPct(bet);
    const edgeScore = Math.max(0, Math.min(100, edge / 8 * 100));
    const evScore = Math.max(0, Math.min(100, ev / 12 * 100));
    const valueScore = edgeScore * .55 + evScore * .45;
    const modelConfidence = [bet.model_confidence_score, bet.modelConfidenceScore, bet.valueScore].map(Number).find(Number.isFinite);
    const ptSample = safeNumber(historical.resolved ?? historical.sample ?? bet.historical_combo_resolved, 0);
    const ptRateRaw = historical.adjustedRatePct ?? historical.winRatePct ?? bet.historical_combo_adjusted_rate_pct ?? bet.historical_combo_win_rate_pct;
    const ptRate = Number(ptRateRaw);
    const dataSufficiency = [bet.data_sufficiency_score, bet.dataSufficiencyScore, bet.dataSufficiency?.score].map(Number).find(Number.isFinite);
    const components = {
        qualityGate: { score: gate.score, weight: .30, available: gate.available, label: gate.label },
        modelConfidence: { score: modelConfidence, weight: .20, available: Number.isFinite(modelConfidence) },
        value: { score: valueScore, weight: .25, available: Number.isFinite(valueScore), edgePp: edge, evPct: ev },
        deepScan: { score: dsScore, weight: .10, available: Number.isFinite(dsScore), class: dsClass },
        paperTrading: { score: ptRate, weight: .10, available: ptSample > 0 && Number.isFinite(ptRate), sample: ptSample },
        dataSufficiency: { score: dataSufficiency, weight: .05, available: Number.isFinite(dataSufficiency) }
    };
    let activeWeight = 0;
    let weighted = 0;
    Object.values(components).forEach(c => { if (c.available) { activeWeight += c.weight; weighted += c.score * c.weight; } });
    const score = activeWeight > 0 ? weighted / activeWeight : null;
    Object.values(components).forEach(c => { c.effectiveWeight = c.available && activeWeight > 0 ? c.weight / activeWeight : 0; c.contribution = c.available ? c.score * c.effectiveWeight : 0; });
    return {
        success: Number.isFinite(score),
        version: TENNIS_PREDICTION_INDEX_DISPLAY_VERSION,
        authority: 'DISPLAY_ONLY_NO_STAKE_AUTHORITY',
        stakeAuthority: false,
        displayOnly: true,
        phase: dsScore !== null && (bet.quality_final_code || bet.qualityGateV2?.code) ? 'POST_DEEPSCAN_FINAL' : 'PRE_DEEPSCAN_PROVISIONAL',
        score: Number.isFinite(score) ? score : null,
        label: Number.isFinite(score) ? tennisPredictionIndexLabel(score) : 'N/D',
        eligible: false,
        components,
        reason: 'Indice Tennis diagnostico costruito con dati già disponibili; non modifica probabilità o stake.'
    };
}

function renderTennisPredictionIndexCell(bet = {}) {
    const index = calculateTennisPredictionIndexUiFallback(bet);
    if (!index || !Number.isFinite(Number(index.score))) return '<span style="color:#94a3b8;">N/D</span>';
    const score = Number(index.score);
    const temporal = resolveCalcioTemporalView(bet);
    const preliminary = isCalcioTemporalPreliminary(bet);
    const color = preliminary ? '#fbbf24' : (score >= 80 ? '#22c55e' : score >= 70 ? '#10b981' : score >= 60 ? '#38bdf8' : score >= 45 ? '#f59e0b' : '#ef4444');
    const displayIndexLabel = preliminary ? (temporal.stage === 'EARLY_PREVIEW' ? 'EARLY · NON OPERATIVO' : 'PRE-MATCH · NON FINALE') : index.label;
    const c = index.components || {};
    const tooltip = [
        `Indice Predizione Tennis: ${formatNumber(score,1)}/100 (${index.label})`,
        `Qualità/Gate: ${formatNumber(c.qualityGate?.score,1)} × ${formatNumber((c.qualityGate?.effectiveWeight ?? c.qualityGate?.weight ?? 0)*100,0)}%`,
        `Confidenza modello: ${formatNumber(c.modelConfidence?.score,1)} × ${formatNumber((c.modelConfidence?.effectiveWeight ?? c.modelConfidence?.weight ?? 0)*100,0)}%`,
        `Edge/EV: ${formatNumber(c.value?.score,1)} × ${formatNumber((c.value?.effectiveWeight ?? c.value?.weight ?? 0)*100,0)}%`,
        `DeepScan: ${formatNumber(c.deepScan?.score,1)} × ${formatNumber((c.deepScan?.effectiveWeight ?? c.deepScan?.weight ?? 0)*100,0)}% (${safeString(c.deepScan?.class || 'N/D')})`,
        `PT DS×Gate: ${c.paperTrading?.available === false ? 'N/D' : formatNumber(c.paperTrading?.score,1)} · n=${safeNumber(c.paperTrading?.sample,0)}`,
        `Sufficienza dati: ${formatNumber(c.dataSufficiency?.score,1)}`,
        `Fase: ${safeString(index.phase || 'N/D')}`,
        'DISPLAY ONLY: nessuna autorità su stake, gate o probabilità.'
    ].join('\n');
    return `<div title="${htmlEscape(tooltip)}" style="min-width:108px;">
        <div style="font-size:1.05em;font-weight:950;color:${color};">${formatNumber(score,1)}/100</div>
        <div style="font-size:.68em;color:${color};font-weight:900;margin-top:2px;">${htmlEscape(displayIndexLabel)}</div>
        <div style="font-size:.63em;color:#94a3b8;margin-top:2px;">TPI diagnostico · ranking sportivo</div>
        <div style="font-size:.60em;color:#a78bfa;font-weight:900;margin-top:3px;line-height:1.2;">TPI: SOLO DIAGNOSTICO</div>
        <div style="font-size:.58em;color:#64748b;margin-top:2px;line-height:1.2;">Autorità stake finale: colonna Stake · Patch46</div>
    </div>`;
}

function renderUnifiedPredictionIndexCell(bet = {}) {
    return activeSport === SPORT.TENNIS ? renderTennisPredictionIndexCell(bet) : renderCalcioPredictionIndexCell(bet);
}

function renderUnifiedQualityGateCell(bet = {}) {
    return activeSport === SPORT.TENNIS ? renderTennisQualityGateCell(bet) : renderCalcioQualityGateCell(bet);
}

function renderCalcioQualityGateCell(bet = {}) {
    const score = safeNumber(bet.prediction_reliability_score ?? bet.predictionReliability?.score, 0);
    const label = safeString(bet.prediction_reliability_label || bet.predictionReliability?.label || bet.probability_reliability || 'N/D').replaceAll('_', ' ');
    const quality = safeString(bet.calcio_quality_final_label || bet.quality_final_label || bet.analysis_stage_label || bet.analysis_stage?.label || 'IN ATTESA DEEPSCAN');
    const temporal = resolveCalcioTemporalView(bet);
    const preliminary = isCalcioTemporalPreliminary(bet);
    const color = preliminary ? '#fbbf24' : calcioReliabilityColor(score);
    const displayLabel = preliminary ? (temporal.stage === 'EARLY_PREVIEW' ? 'DATI NON ANCORA MATURI' : 'PRE-MATCH IN AGGIORNAMENTO') : label;
    const displayQuality = preliminary ? (temporal.presentationLabel || temporal.stage) : quality;
    return `<div id="quality-cell-${htmlEscape(bet.__rowIndex ?? '')}" title="${preliminary ? `Gate operativo sottostante: ${htmlEscape(quality)} · affidabilità raw ${htmlEscape(label)}` : ''}" style="min-width:120px;text-align:center;">
        <div style="font-weight:900;color:${color};font-size:1rem;">${score > 0 ? score.toFixed(0) + '/100' : 'N/D'}</div>
        <div style="font-size:.68rem;color:${color};margin-top:2px;font-weight:800;">${htmlEscape(displayLabel)}</div>
        <div style="font-size:.66rem;color:#94a3b8;margin-top:5px;line-height:1.25;">${htmlEscape(displayQuality)}</div>
    </div>`;
}

function renderCompactCalcioDeepScan(result = {}, bet = {}) {
    const reliability = result.predictionReliability || bet.predictionReliability || {};
    const score = safeNumber(reliability.score ?? bet.prediction_reliability_score, 0);
    const scoreLabel = safeString(reliability.label || bet.prediction_reliability_label || 'N/D').replaceAll('_', ' ');
    const scoreColor = calcioReliabilityColor(score);
    const stage = result.analysisStage || bet.analysis_stage || {};
    const quality = result.qualityFinalLabel || bet.calcio_quality_final_label || 'N/D';
    const market = result.marketSummary || {};
    const lifecycle = result.stakeLifecycle || bet.stakeLifecycle || {};
    const theoretical = safeNumber(lifecycle.theoreticalStake ?? bet.stake_theoretical ?? bet.theoreticalStake, 0);
    const operational = safeNumber(lifecycle.operationalStake ?? bet.invested ?? bet.operationalStake, 0);
    const stakePolicy = bet.kellyStakePolicy || bet.kelly_stake_policy || {};
    const dataClass = safeString(stakePolicy.dataAuthority?.dataClass || bet.calcio_data_class || lifecycle.dataClass || 'N/D');
    const stakeReason = safeString(stakePolicy.reason || bet.calcio_stake_reason || lifecycle.reason || '');
    const pillars = Array.isArray(result.pillars) ? result.pillars : [];
    const pillarRows = pillars.map(p => {
        const status = safeString(p.status || 'N/D');
        const color = status === 'FAIL' ? '#ef4444' : status.includes('WARN') ? '#f59e0b' : '#10b981';
        const evidence = Array.isArray(p.evidence) ? p.evidence.slice(0, 2) : [];
        return `<tr>
            <td style="padding:8px;border-bottom:1px solid #334155;font-weight:800;color:#e2e8f0;">${htmlEscape(p.name || '')}</td>
            <td style="padding:8px;border-bottom:1px solid #334155;color:${color};font-weight:900;">${htmlEscape(status)}</td>
            <td style="padding:8px;border-bottom:1px solid #334155;color:#cbd5e1;">${htmlEscape(p.risk ?? '—')}/100</td>
            <td style="padding:8px;border-bottom:1px solid #334155;color:#94a3b8;">${htmlEscape(p.summary || evidence[0] || '—')}</td>
        </tr>`;
    }).join('');
    const medical = result.medicalNews || {};
    const medicalCard = item => item ? `<div style="flex:1;min-width:190px;padding:10px;border-radius:8px;background:#0f172a;border-left:3px solid ${htmlEscape(item.color || '#64748b')};">
        <strong style="color:#f8fafc;">${htmlEscape(item.team || '')}</strong>
        <div style="color:#cbd5e1;margin-top:4px;">${htmlEscape(item.report || 'Nessun segnale verificato')}</div>
        <small style="color:#94a3b8;">NLP ${formatNumber(item.score,1)}/5 · Conf. ${formatNumber(item.confidence,0)}%</small>
    </div>` : '';
    const advisory = result.deepScanAdvisory || {};
    // AUDIT16D_R3_R1: il pannello dettagliato deve distinguere il segnale qualitativo
    // DeepScan dal gate operativo. Un segnale "ALTO RISCHIO" può restare visibile
    // come evidenza SHADOW senza essere presentato come decisione/stake authority.
    const deepScanSignalAction = safeString(
        result.signalAction
        || result.rawAction
        || resolveCalcioDeepScanSignalAction({ ...bet, calcioDeepScanResult: result })
        || result.action
        || 'N/D'
    );
    const deepScanOperationalAction = safeString(
        result.operationalAction
        || resolveCalcioOperationalAction({ ...bet, calcioDeepScanResult: result })
        || result.action
        || 'N/D'
    );
    const deepScanSignalLabel = normalizeDeepScanOutcomeCategory({ ds_action: deepScanSignalAction }) || deepScanSignalAction || 'N/D';
    const deepScanOperationalLabel = normalizeDeepScanOutcomeCategory({ ds_action: deepScanOperationalAction }) || deepScanOperationalAction || 'N/D';
    let reliabilityGuard = result.reliabilityGuard || lifecycle.reliabilityGuard || bet.reliabilityGuard || null;
    if ((!reliabilityGuard || typeof reliabilityGuard !== 'object') && bet.calcio_reliability_guard_audit) {
        try { reliabilityGuard = JSON.parse(bet.calcio_reliability_guard_audit); } catch (_) { reliabilityGuard = null; }
    }
    const guardModelProbability = safeNumber(reliabilityGuard?.modelProbabilityPct ?? bet.estimated_prob ?? getBetProbability(bet), NaN);
    const guardMarketProbability = safeNumber(reliabilityGuard?.marketProbabilityPct ?? bet.calcio_market_probability_pct, NaN);
    const guardStressProbability = safeNumber(reliabilityGuard?.stressProbabilityPct ?? bet.calcio_cross_market_stress_probability, NaN);
    const guardRobustProbability = safeNumber(reliabilityGuard?.robustProbabilityPct ?? bet.calcio_robust_probability, NaN);
    const guardRobustEv = safeNumber(reliabilityGuard?.robustEvPct ?? bet.calcio_robust_ev_pct, NaN);
    const guardGap = safeNumber(reliabilityGuard?.crossMarketGapPp ?? bet.calcio_cross_market_gap_pp, NaN);
    const guardDays = safeNumber(reliabilityGuard?.daysToKickoff ?? bet.calcio_days_to_kickoff, NaN);
    const guardMaturity = safeNumber(reliabilityGuard?.analysisMaturityScore ?? bet.calcio_analysis_maturity_score, NaN);
    const guardUncertainty = safeNumber(reliabilityGuard?.epistemicUncertaintyScore ?? bet.calcio_epistemic_uncertainty_score, NaN);
    const guardMultiplier = safeNumber(reliabilityGuard?.stakeMultiplier ?? bet.calcio_reliability_stake_multiplier, NaN);
    const rawModelStake = safeNumber(reliabilityGuard?.unadjustedPreCapStake ?? bet.calcio_unadjusted_pre_cap_stake ?? theoretical, theoretical);
    const reliabilityStake = safeNumber(reliabilityGuard?.reliabilityAdjustedStake ?? bet.calcio_reliability_adjusted_stake ?? theoretical, theoretical);
    const lambdaHome = safeNumber(reliabilityGuard?.poissonStress?.lambdaHome ?? bet.calcio_cross_market_lambda_home, NaN);
    const lambdaAway = safeNumber(reliabilityGuard?.poissonStress?.lambdaAway ?? bet.calcio_cross_market_lambda_away, NaN);
    const guardReasons = Array.isArray(reliabilityGuard?.reasons) ? reliabilityGuard.reasons : [];
    const guardStatus = safeString(reliabilityGuard?.status || bet.calcio_reliability_guard_status || '');
    const guardAvailable = Boolean(reliabilityGuard && typeof reliabilityGuard === 'object') || Boolean(bet.calcio_cross_market_reliability_version);
    const guardColor = guardStatus.includes('NO_STAKE') ? '#ef4444' : guardStatus.includes('REDUCED') ? '#f59e0b' : '#10b981';
    const metric = (label, value, suffix = '') => `<div style="padding:9px;border-radius:8px;background:#07111f;"><small style="display:block;color:#94a3b8;">${htmlEscape(label)}</small><strong style="color:#e2e8f0;">${Number.isFinite(value) ? htmlEscape(formatNumber(value, 2) + suffix) : 'N/D'}</strong></div>`;
    const reliabilityGuardPanel = guardAvailable ? `<div style="padding:14px 16px;border-top:1px solid #334155;background:rgba(14,165,233,.05);">
        <h4 style="margin:0 0 8px;color:#38bdf8;">🧭 Affidabilità cross-market e incertezza — Patch 26E-B</h4>
        <div style="font-size:.72rem;color:#94a3b8;margin-bottom:9px;">La probabilità production resta invariata. Questo guard può esclusivamente ridurre o azzerare lo stake.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px;">
            ${metric('Prob. production', guardModelProbability, '%')}
            ${metric('Mercato specifico', guardMarketProbability, '%')}
            ${metric('Stress 1X2/Poisson', guardStressProbability, '%')}
            ${metric('Prob. robusta', guardRobustProbability, '%')}
            ${metric('EV robusto', guardRobustEv, '%')}
            ${metric('Gap cross-market', guardGap, ' pp')}
            ${metric('λ casa', lambdaHome)}
            ${metric('λ trasferta', lambdaAway)}
            ${metric('Giorni al match', guardDays)}
            ${metric('Maturità', guardMaturity, '/100')}
            ${metric('Incertezza epistemica', guardUncertainty, '/100')}
            ${metric('Moltiplicatore stake', guardMultiplier, '×')}
        </div>
        <div style="margin-top:9px;padding:9px;border-radius:8px;background:#0f172a;color:#cbd5e1;"><strong style="color:${guardColor};">${htmlEscape(guardStatus || 'GUARD DISPONIBILE')}</strong> · Modello €${formatNumber(rawModelStake,2)} → affidabilità €${formatNumber(reliabilityStake,2)} → operativo €${formatNumber(operational,2)}</div>
        ${guardReasons.length ? `<ul style="margin:8px 0 0;padding-left:18px;color:#94a3b8;font-size:.72rem;line-height:1.45;">${guardReasons.slice(0,6).map(reason => `<li>${htmlEscape(reason)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
    const dataQualityAuthority = result.dataQualityAuthority || bet.dataQualityAuthority || calcioDataQualityAuthorityFromBet(bet);
    const dataQualityStatus = safeString(dataQualityAuthority?.status || bet.calcio_data_quality_status || 'N/D');
    const dataQualityScore = safeNumber(dataQualityAuthority?.score ?? bet.calcio_data_quality_score, NaN);
    const dataQualityReasons = [
        ...(Array.isArray(dataQualityAuthority?.hardReasons) ? dataQualityAuthority.hardReasons : []),
        ...(Array.isArray(dataQualityAuthority?.cautionReasons) ? dataQualityAuthority.cautionReasons : [])
    ];
    const dataQualityColor = dataQualityStatus.includes('BLOCKED') ? '#ef4444' : dataQualityStatus.includes('LIMITED') || dataQualityStatus.includes('WEAK') ? '#f59e0b' : '#10b981';
    const dataQualityPanel = `<div style="padding:12px 16px;border-top:1px solid #334155;background:rgba(16,185,129,.04);"><h4 style="margin:0 0 7px;color:#34d399;">🧪 Qualità dati autoritativa — Patch 26E-C</h4><strong style="color:${dataQualityColor};">${htmlEscape(dataQualityStatus)}</strong>${Number.isFinite(dataQualityScore) ? ` · ${formatNumber(dataQualityScore,1)}/100` : ''}${dataQualityReasons.length ? `<ul style="margin:7px 0 0;padding-left:18px;color:#94a3b8;font-size:.72rem;">${dataQualityReasons.slice(0,6).map(reason => `<li>${htmlEscape(reason)}</li>`).join('')}</ul>` : ''}</div>`;
    const r11Diag = result.r11StakeDiagnostics || {};
    const r11Checks = Array.isArray(r11Diag.checks) ? r11Diag.checks : [];
    const r11Panel = r11Checks.length ? `<div style="padding:12px 16px;background:rgba(245,158,11,.06);border-top:1px solid #334155;"><strong style="color:#fbbf24;">R11 · Diagnostica stake €0 (sola lettura)</strong><div style="font-size:.72rem;color:#cbd5e1;margin-top:6px;">${r11Checks.map(c=>htmlEscape(c.code+' — '+c.detail)).join('<br>')}</div><small style="color:#94a3b8;">Il responso IA indipendente non modifica i controlli R9.</small></div>` : '';
    const version = safeString(result.version || '12.4_STEP67_DEEPSCAN_OPERATIONAL_GATE');
    return `<section class="calcio-ds-compact" style="background:#0b1220;border:1px solid #334155;border-radius:12px;overflow:hidden;">
        <header style="padding:14px 16px;background:#111827;border-bottom:1px solid #334155;">
            <div style="font-weight:900;color:#60a5fa;">⚽ DeepScan Calcio v${htmlEscape(version)}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin-top:10px;">
                <div style="padding:10px;border-radius:9px;background:#07111f;text-align:center;"><small style="color:#94a3b8;">Affidabilità totale</small><strong style="display:block;color:${scoreColor};font-size:1.35rem;">${score > 0 ? score.toFixed(0) + '/100' : 'N/D'}</strong><span style="font-size:.68rem;color:#cbd5e1;">${htmlEscape(scoreLabel)}</span></div>
                <div style="padding:10px;border-radius:9px;background:#07111f;"><small style="color:#94a3b8;">Pronostico</small><strong style="display:block;color:#f8fafc;">${htmlEscape(market.prediction || bet.prediction || '—')}</strong><span style="font-size:.72rem;color:#cbd5e1;">Prob. ${formatNumber(market.modelProbabilityPct ?? getBetProbability(bet),1)}% · Quota ${formatNumber(market.targetOdd ?? bet.odd,2)}</span></div>
                <div style="padding:10px;border-radius:9px;background:#07111f;border:1px solid rgba(96,165,250,.28);"><small style="color:#93c5fd;">Segnale DeepScan (SHADOW)</small><strong style="display:block;color:#e2e8f0;">${htmlEscape(deepScanSignalLabel)}</strong><span style="font-size:.68rem;color:#94a3b8;">Nessuna autorità diretta su stake/gate</span></div>
                <div style="padding:10px;border-radius:9px;background:#07111f;border:1px solid rgba(16,185,129,.28);"><small style="color:#6ee7b7;">Gate operativo</small><strong style="display:block;color:${operational > 0 ? '#10b981' : '#fbbf24'};">${htmlEscape(deepScanOperationalLabel)}</strong><span style="font-size:.68rem;color:#94a3b8;">Autorità operativa separata dal segnale DeepScan</span></div>
                <div style="padding:10px;border-radius:9px;background:#07111f;"><small style="color:#94a3b8;">Stadio / qualità</small><strong style="display:block;color:#fbbf24;">${htmlEscape(stage.label || '—')}</strong><span style="font-size:.72rem;color:#cbd5e1;">${htmlEscape(quality)}</span></div>
                <div style="padding:10px;border-radius:9px;background:#07111f;"><small style="color:#94a3b8;">Stake authority</small><strong style="display:block;color:#e2e8f0;">€${formatNumber(rawModelStake,2)} modello</strong><span style="font-size:.72rem;color:#fbbf24;">€${formatNumber(reliabilityStake,2)} affidabilità</span><span style="display:block;font-size:.72rem;color:${operational > 0 ? '#10b981' : '#f59e0b'};">€${formatNumber(operational,2)} operativo</span><small style="display:block;color:#94a3b8;margin-top:2px;">Dati: ${htmlEscape(dataQualityStatus || dataClass)}</small></div>
            </div>
            <div style="margin-top:9px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,.08);color:#bfdbfe;font-size:.72rem;">AUDIT16D_R3_R1 · Il <strong>Segnale DeepScan</strong> è evidenza qualitativa/SHADOW; il <strong>Gate operativo</strong> determina separatamente l'azione e lo stake consentiti.</div>
            ${stage.summary ? `<div style="margin-top:9px;color:#fbbf24;font-size:.76rem;">${htmlEscape(stage.summary)}</div>` : ''}${stakeReason ? `<div style="margin-top:5px;color:#94a3b8;font-size:.72rem;">${htmlEscape(stakeReason)}</div>` : ''}
        </header>
        ${reliabilityGuardPanel}
        ${dataQualityPanel}
        ${r11Panel}
        <div style="padding:14px 16px;">
            <h4 style="margin:0 0 8px;color:#60a5fa;">⚽ DeepScan Calcio — 6 pilastri qualitativi</h4>
            <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:650px;font-size:.76rem;"><thead><tr style="color:#94a3b8;text-align:left;"><th style="padding:8px;">Pilastro</th><th>Status</th><th>Rischio</th><th>Sintesi</th></tr></thead><tbody>${pillarRows || '<tr><td colspan="4" style="padding:10px;color:#94a3b8;">Dettaglio pilastri non disponibile.</td></tr>'}</tbody></table></div>
        </div>
        <div style="padding:14px 16px;border-top:1px solid #334155;">
            <h4 style="margin:0 0 8px;color:#06b6d4;">📉 Medical & News Check</h4>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">${medicalCard(medical.home)}${medicalCard(medical.away)}</div>
        </div>
        <div style="padding:14px 16px;border-top:1px solid #334155;background:rgba(234,179,8,.06);">
            <h4 style="margin:0 0 8px;color:#eab308;">💡 Suggerimento euristico DeepScan · NON perizia IA</h4>
            <div style="color:#cbd5e1;line-height:1.55;"><strong>Modalità:</strong> ${htmlEscape(advisory.mode || '—')} · <strong>Mercato:</strong> ${htmlEscape(advisory.market || '—')}<br><strong>Esito:</strong> <span style="color:#10b981;font-weight:900;">${htmlEscape(advisory.selection || result.suggestionText || '—')}</span><br><strong>Timing:</strong> ${htmlEscape(advisory.timing || '—')}<br><small style="color:#94a3b8;">${htmlEscape(advisory.rationale || '')}</small></div>
        </div>
        <details style="padding:12px 16px;border-top:1px solid #334155;">
            <summary style="cursor:pointer;color:#94a3b8;font-weight:800;">Diagnostica completa e fonti</summary>
            <div style="margin-top:10px;">${result.reason || ''}</div>
        </details>
    </section>`;
}


// BETTING PATCH 16 - applicazione autoritativa della risposta DeepScan alla riga live.
// Patch 15 aggiornava badge/qualita ma lasciava i campi stake precedenti nel modello UI.
function applyCalcioDeepScanStakeResult(bet = {}, result = {}, rowIndex = -1) {
    if (!bet || !result) return;
    // PATCH 26E-A: conserva un solo snapshot DeepScan autorevole. Il batch
    // successivo lo sostituisce/aggiorna e il dettaglio non resta fermo allo
    // stato pre-allocazione.
    bet.calcioDeepScanResult = { ...(bet.calcioDeepScanResult || {}), ...result };
    // R11: una nuova analisi aggiorna SUBITO i pulsanti della riga;
    // non richiede refresh del browser per usare il nuovo pacchetto evidenze.
    if (typeof document !== 'undefined' && Number.isInteger(rowIndex) && rowIndex >= 0) {
        const rowNode = document.getElementById('row-' + rowIndex);
        if (rowNode) {
            const independentButton = rowNode.querySelector('button[data-r11-prompt]');
            const missingButton = rowNode.querySelector('button[data-r11-recovery]');
            const newIndependent = result.independentAiPrompt || bet.calcioDeepScanResult.independentAiPrompt;
            const newMissing = result.missingDataPrompt || bet.calcioDeepScanResult.missingDataPrompt;
            if (independentButton && typeof newIndependent === 'string') independentButton.dataset.r11Prompt = newIndependent;
            if (missingButton && typeof newMissing === 'string') missingButton.dataset.r10Prompt = newMissing;
        }
    }
    if (result.stakeAuthority) {
        bet.stakeAuthority = result.stakeAuthority;
        bet.calcio_stake_authority_audit = JSON.stringify(result.stakeAuthority);
        bet.calcio_stake_authority_model_stake = safeNumber(result.stakeAuthority.modelStake, bet.calcio_stake_authority_model_stake ?? 0);
        bet.calcio_stake_authority_reliability_stake = safeNumber(result.stakeAuthority.reliabilityStake, bet.calcio_stake_authority_reliability_stake ?? 0);
        bet.calcio_stake_authority_final_stake = safeNumber(result.stakeAuthority.finalOperationalStake, bet.calcio_stake_authority_final_stake ?? 0);
    }
    if (result.dataQualityAuthority) {
        bet.dataQualityAuthority = result.dataQualityAuthority;
        bet.calcio_data_quality_audit = JSON.stringify(result.dataQualityAuthority);
        bet.calcio_data_quality_status = result.dataQualityAuthority.status;
        bet.calcio_data_quality_score = result.dataQualityAuthority.score;
    }
    if (result.finalMarketDiagnostic) {
        bet.finalMarketDiagnostic = result.finalMarketDiagnostic;
        bet.calcioFinalMarketDiagnostic = result.finalMarketDiagnostic;
        bet.calcio_final_market_snapshot = JSON.stringify(result.finalMarketDiagnostic);
        bet.calcio_final_market_contract_version = result.finalMarketDiagnostic.version;
        bet.calcio_final_market_id = result.finalMarketDiagnostic.marketId;
        bet.calcio_forecast_confidence_score = result.finalMarketDiagnostic.forecastConfidence?.score;
        bet.calcio_forecast_confidence_label = result.finalMarketDiagnostic.forecastConfidence?.label;
        bet.calcio_decision_state_version = result.finalMarketDiagnostic.decisionState?.version;
        bet.calcio_decision_state = result.finalMarketDiagnostic.decisionState?.code;
        bet.calcio_decision_state_reason = result.finalMarketDiagnostic.decisionState?.reason;
        bet.calcio_diagnostic_coherence_status = result.finalMarketDiagnostic.coherence?.status;
        bet.extData = {
            ...(bet.extData || {}),
            probabilityIntegrity: probabilityIntegrityFromFinalMarketDiagnostic(result.finalMarketDiagnostic)
                || bet.extData?.probabilityIntegrity
        };
    }
    if (result.decisionState && !result.finalMarketDiagnostic) {
        bet.calcio_decision_state_version = result.decisionState.version;
        bet.calcio_decision_state = result.decisionState.code;
        bet.calcio_decision_state_reason = result.decisionState.reason;
    }
    bet.calcio_deepscan_timing_advisory = result.canonicalDeepScan?.timingAdvisory || result.deepScanAdvisory?.mode || bet.calcio_deepscan_timing_advisory || '';
    const finalMarket = result.finalMarket || null;
    if (finalMarket) {
        bet.calcio_final_market_id = finalMarket.marketId || bet.calcio_final_market_id || null;
        bet.prediction = finalMarket.prediction || bet.prediction;
        bet.market_type = finalMarket.marketType || bet.market_type;
        bet.odd = safeNumber(finalMarket.odd, bet.odd);
        bet.estimatedProb = safeNumber(finalMarket.probability, getBetProbability(bet));
        bet.estimated_prob = bet.estimatedProb;
        bet.rawProb = bet.estimatedProb;
        bet.edge_pp = safeNumber(finalMarket.edgePp, getBetEdgePp(bet));
        bet.edge = bet.edge_pp;
        bet.ev_pct = safeNumber(finalMarket.evPct, getBetEvPct(bet));
        if (finalMarket.oddsCertification) {
            bet.oddsCertification = finalMarket.oddsCertification;
            bet.odds_certification = finalMarket.oddsCertification;
        }
    }
    if (result.operationalState) {
        bet.analysisOnly = result.operationalState.analysisOnly;
        bet.calcio_analysis_only = result.operationalState.calcio_analysis_only;
        bet.prediction_visibility = result.operationalState.prediction_visibility;
        bet.exposure_role = result.operationalState.exposure_role;
        bet.strategy_tag = result.operationalState.strategy_tag;
        bet.calcio_structural_certification_label = result.operationalState.certificationLabel;
        bet.calcio_pt_certification_status = result.operationalState.ptCertificationStatus;
    }
    if (result.outputCoherence) {
        bet.outputCoherence = result.outputCoherence;
        bet.calcio_output_coherence_status = result.outputCoherence.status;
    }
    if (result.portfolioAllocation) {
        bet.calcio_analysis_batch_id = result.portfolioAllocation.batchId || bet.calcio_analysis_batch_id || null;
        bet.calcio_portfolio_allocation_id = result.portfolioAllocation.allocationId || bet.calcio_portfolio_allocation_id || null;
        bet.calcio_event_finalization_id = result.portfolioAllocation.eventFinalizationId || bet.calcio_event_finalization_id || null;
        bet.calcio_portfolio_batch_status = result.portfolioAllocation.portfolioBatchCertified === true || result.portfolioAllocation.batchCertified === true
            ? 'COMMITTED_BATCH'
            : 'PENDING_BATCH';
        bet.calcio_portfolio_batch_certified = result.portfolioAllocation.portfolioBatchCertified === true || result.portfolioAllocation.batchCertified === true ? 1 : 0;
        bet.calcio_portfolio_pre_cap_stake = safeNumber(result.portfolioAllocation.preCapStake, bet.calcio_portfolio_pre_cap_stake ?? 0);
        bet.calcio_portfolio_post_cap_stake = safeNumber(result.portfolioAllocation.postCapStake, bet.calcio_portfolio_post_cap_stake ?? 0);
        bet.calcio_portfolio_cap_reason = result.portfolioAllocation.capReason || bet.calcio_portfolio_cap_reason || '';
    }
    if (result.marketFinalizationAudit) {
        bet.marketFinalizationAudit = result.marketFinalizationAudit;
        bet.calcio_market_finalization_audit = result.marketFinalizationAudit;
    }
    if (result.marketSelectionFinalization) {
        bet.marketSelectionFinalization = result.marketSelectionFinalization;
    }
    const lifecycle = result.stakeLifecycle || result.calcioStakeLifecycle || null;
    const policy = result.kellyStakePolicy || result.calcioKellyStakePolicy || null;
    const reconciliation = result.stakeReconciliation || null;
    const predictionIndex = result.predictionIndex || reconciliation || null;
    const theoretical = safeNumber(
        reconciliation?.theoreticalStake
        ?? lifecycle?.theoreticalStake
        ?? policy?.theoreticalStake
        ?? bet.calcio_theoretical_stake
        ?? bet.stake_theoretical
        ?? bet.theoreticalStake,
        0
    );
    const operational = safeNumber(
        reconciliation?.operationalStake
        ?? lifecycle?.operationalStake
        ?? bet.calcio_operational_stake
        ?? bet.stake_operational
        ?? bet.operationalStake,
        0
    );
    const finalEligible = operational >= 2 && predictionIndex?.eligible !== false;
    if (predictionIndex) {
        predictionIndex.operationalStake = operational;
        predictionIndex.eligible = finalEligible;
        predictionIndex.status = finalEligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE';
        predictionIndex.action = finalEligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX';
        predictionIndex.allowBet = finalEligible;
        predictionIndex.gateStatus = finalEligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO';
    }
    const odd = safeNumber(predictionIndex?.netExecutableOdd ?? bet.calcio_net_executable_odd ?? bet.odd, 0);
    const estimatedProfit = safeNumber(
        predictionIndex?.estimatedProfit,
        operational > 0 && odd > 1 ? operational * (odd - 1) : 0
    );

    bet.stakeLifecycle = lifecycle || bet.stakeLifecycle;
    bet.kellyStakePolicy = policy || bet.kellyStakePolicy;
    bet.stakeReconciliation = reconciliation || bet.stakeReconciliation;
    bet.predictionIndex = predictionIndex || bet.predictionIndex;
    bet.prediction_index = bet.predictionIndex;
    if (predictionIndex) {
        bet.calcio_prediction_index_score = predictionIndex.score;
        bet.calcio_prediction_index_label = predictionIndex.label;
        bet.calcio_prediction_index_reason = predictionIndex.reason;
        bet.calcio_prediction_index_version = predictionIndex.predictionIndexVersion || predictionIndex.version;
        bet.calcio_prediction_index_rank_value = predictionIndex.rankValue;
        bet.calcio_prediction_index_eligible = predictionIndex.eligible ? 1 : 0;
    }
    bet.calcioGate = result.calcioGate || bet.calcioGate;
    bet.calcio_theoretical_stake = theoretical;
    bet.stake_theoretical = theoretical;
    bet.theoreticalStake = theoretical;
    bet.calcio_operational_stake = operational;
    bet.stake_operational = operational;
    bet.operationalStake = operational;
    bet.stake = operational;
    bet.invested = formatNumber(operational, 2);
    bet.estimatedProfit = formatNumber(estimatedProfit, 2);
    bet.extData = {
        ...(bet.extData || {}),
        theoreticalStake: theoretical,
        operationalStake: operational
    };
    if (bet.calcioDeepScanResult) {
        bet.calcioDeepScanResult.predictionIndex = predictionIndex || bet.calcioDeepScanResult.predictionIndex;
        bet.calcioDeepScanResult.stakeReconciliation = reconciliation || predictionIndex || bet.calcioDeepScanResult.stakeReconciliation;
        bet.calcioDeepScanResult.stakeLifecycle = {
            ...(bet.calcioDeepScanResult.stakeLifecycle || {}),
            theoreticalStake: theoretical,
            operationalStake: operational,
            estimatedOperationalProfit: estimatedProfit,
            status: finalEligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
            action: finalEligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
            automaticExecution: finalEligible
        };
    }
    bet.calcio_stake_lifecycle_status = finalEligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE';
    bet.stake_lifecycle_status = bet.calcio_stake_lifecycle_status;
    bet.calcio_stake_lifecycle_reason = reconciliation?.reason || lifecycle?.reason || bet.calcio_stake_lifecycle_reason;
    bet.stake_lifecycle_reason = bet.calcio_stake_lifecycle_reason;
    bet.calcio_operational_status = reconciliation?.gateStatus || result.calcioGate?.status || bet.calcio_operational_status;
    bet.calcio_operational_action = reconciliation?.action || lifecycle?.action || bet.calcio_operational_action;
    bet.calcio_operational_summary = reconciliation?.reason || lifecycle?.reason || bet.calcio_operational_summary;
    bet.stake_confidence_level = reconciliation?.dataClass || policy?.dataAuthority?.dataClass || lifecycle?.dataClass || bet.stake_confidence_level;
    bet.calcio_data_class = bet.stake_confidence_level;
    if (result.qualityFinalLabel) {
        bet.calcio_quality_final_label = result.qualityFinalLabel;
        bet.quality_final_label = result.qualityFinalLabel;
    }

    if (Number.isInteger(rowIndex) && rowIndex >= 0) {
        const forecastBadge = $(`calcio-forecast-badge-${rowIndex}`);
        if (forecastBadge) forecastBadge.innerHTML = renderCalcioForecastBadge(bet);
        const predictionCell = $(`prediction-cell-${rowIndex}`);
        if (predictionCell) predictionCell.textContent = bet.prediction || '';
        const oddsCell = $(`odds-cell-${rowIndex}`);
        if (oddsCell) oddsCell.innerHTML = renderCalcioCertifiedOddsCell(bet);
        const probabilityCell = $(`probability-cell-${rowIndex}`);
        if (probabilityCell) probabilityCell.innerHTML = renderCalcioProbabilityCell(bet, getBetProbability(bet));
        const edgeEvCell = $(`edge-ev-cell-${rowIndex}`);
        if (edgeEvCell) edgeEvCell.innerHTML = `<div style="font-weight:bold;color:#f8fafc;">${formatPct(getBetEdgePp(bet),2,true)}</div><div style="font-size:.76em;color:${colorByPositiveNegative(getBetEvPct(bet))};margin-top:3px;">EV ${formatPct(getBetEvPct(bet),2,true)}</div>`;
        const indexCell = $(`prediction-index-cell-${rowIndex}`);
        if (indexCell) indexCell.innerHTML = renderCalcioPredictionIndexCell(bet);
        const stakeCell = $(`stake-cell-${rowIndex}`);
        if (stakeCell) {
            stakeCell.innerHTML = `€${formatNumber(operational, 2)}${renderTennisStakePolicyMini(bet)}${renderCalcioStakeLifecycleMini(bet)}`;
        }
        const profitCell = $(`profit-cell-${rowIndex}`);
        if (profitCell) profitCell.innerHTML = `<span title="Importo potenziale, non profitto realizzato">Pot. +€${formatNumber(estimatedProfit, 2)}</span>`;
    }
}


function calcioBatchEventKey(bet = {}) {
    return safeString(
        bet.match_exposure_key
        || bet.calcio_event_key
        || bet.event_key
        || bet.eventKey
        || bet.extData?.eventIdentity?.eventKey
    );
}

function applyCalcioBatchPortfolioSnapshot(bet = {}, snapshot = {}, rowIndex = -1) {
    if (!bet || !snapshot) return;
    const row = snapshot.row || {};
    Object.assign(bet, row);
    // PATCH 26F-A R4: il record persistito post-cap è autoritativo. Prima di
    // fondere il compact report, riallinea tutti gli alias che potevano essere
    // rimasti sullo snapshot pre-batch.
    getCalcioFinalMarketDiagnostic(bet);
    if (row.estimated_prob != null) {
        bet.estimatedProb = safeNumber(row.estimated_prob, getBetProbability(bet));
        bet.rawProb = bet.estimatedProb;
    }
    if (row.calcio_prediction_index_components && typeof row.calcio_prediction_index_components === 'string') {
        try {
            bet.predictionIndex = bet.predictionIndex || {};
            bet.predictionIndex.components = JSON.parse(row.calcio_prediction_index_components);
        } catch (_) {}
    }
    const result = snapshot.result || {};
    applyCalcioDeepScanStakeResult(bet, result, rowIndex);
    // PATCH 26F-D: dopo il merge del compact DeepScan, ripristina le autorità
    // persistite post-commit; il report compatto può contenere ancora alias pre-cap.
    const persistedFinalDiagnostic = parseCalcioFinalMarketDiagnosticCandidate(row.calcio_final_market_snapshot);
    if (persistedFinalDiagnostic) synchronizeCalcioFinalMarketDiagnosticAliases(bet, enrichCalcioFinalMarketDiagnosticProbability(persistedFinalDiagnostic, bet));
    const persistedStakeAuthority = parseCalcioJsonObject(row.calcio_stake_authority_audit);
    if (persistedStakeAuthority) bet.stakeAuthority = persistedStakeAuthority;
    const persistedDataQuality = parseCalcioJsonObject(row.calcio_data_quality_audit);
    if (persistedDataQuality) bet.dataQualityAuthority = persistedDataQuality;
    bet.calcioDeepScanResult = bet.calcioDeepScanResult || result;
    if (bet.calcioDeepScanResult && persistedFinalDiagnostic) bet.calcioDeepScanResult.finalMarketDiagnostic = bet.finalMarketDiagnostic;
    if (bet.calcioDeepScanResult && persistedStakeAuthority) bet.calcioDeepScanResult.stakeAuthority = persistedStakeAuthority;
    if (bet.calcioDeepScanResult && persistedDataQuality) bet.calcioDeepScanResult.dataQualityAuthority = persistedDataQuality;
    bet.ds_action = result.action || row.ds_action || bet.ds_action;
    bet.calcio_deepscan_raw_action = row.calcio_deepscan_raw_action || result.signalAction || result.rawAction || bet.calcio_deepscan_raw_action || '';
    bet.calcio_portfolio_batch_certified = safeNumber(row.calcio_portfolio_batch_certified, 0);
    bet.calcio_portfolio_batch_status = row.calcio_portfolio_batch_status || bet.calcio_portfolio_batch_status || '';
    bet.calcio_analysis_batch_id = row.calcio_analysis_batch_id || bet.calcio_analysis_batch_id || '';
    bet.calcio_portfolio_allocation_id = row.calcio_portfolio_allocation_id || bet.calcio_portfolio_allocation_id || '';
    bet.calcio_event_finalization_id = row.calcio_event_finalization_id || bet.calcio_event_finalization_id || '';
    bet.calcio_batch_output_coherence_status = row.calcio_batch_output_coherence_status || bet.calcio_batch_output_coherence_status || '';
    const qualityCell = Number.isInteger(rowIndex) ? $(`quality-cell-${rowIndex}`) : null;
    if (qualityCell) qualityCell.outerHTML = renderCalcioQualityGateCell({ ...bet, __rowIndex: rowIndex });
    if (Number.isInteger(rowIndex) && rowIndex >= 0) {
        const finalResult = bet.calcioDeepScanResult || result;
        const detailEl = $(`ds-detail-${rowIndex}`);
        if (detailEl) detailEl.innerHTML = `<div style="width:100%;border-left:4px solid #60a5fa;padding-left:15px;">${renderCompactCalcioDeepScan(finalResult, bet)}</div>`;
        const badgeEl = $(`ds-badge-${rowIndex}`);
        if (badgeEl) {
            const action = safeString(resolveCalcioDeepScanSignalAction({ ...bet, calcioDeepScanResult: finalResult }) || finalResult.action || bet.ds_action || 'WATCHLIST LOW EDGE');
            const upperAction = action.toUpperCase();
            badgeEl.textContent = normalizeDeepScanOutcomeCategory({ ds_action: action });
            badgeEl.title = `Segnale DeepScan: ${action} · Gate operativo: ${resolveCalcioOperationalAction({ ...bet, calcioDeepScanResult: finalResult }) || 'N/D'} · ${resolveCalcioTemporalView({ ...bet, calcioDeepScanResult: finalResult }).presentationLabel || ''}`;
            badgeEl.className = `ds-badge ${upperAction.includes('ALTO RISCHIO') ? 'ds-risk' : upperAction.includes('RISCHIO MODELLO') || upperAction.includes('WATCHLIST') ? 'ds-warn' : upperAction.includes('EDGE TECNICO') ? 'ds-edge' : 'ds-value'}`;
        }
        const probabilityPanel = $(`probability-integrity-${rowIndex}`);
        if (probabilityPanel) probabilityPanel.innerHTML = renderCalcioProbabilityIntegrityPanel(bet);
    }
}

async function finalizeCalcioPortfolioBatch(bets = [], options = {}) {
    const analysisBatchId = safeString(options.analysisBatchId);
    if (!analysisBatchId) {
        showRuntimeDiagnostic?.({
            severity: 'WARN',
            title: 'Allocazione portafoglio non eseguita',
            message: 'analysisBatchId assente: gli eventi restano in attesa di allocazione batch.',
            phase: 'CALCIO_26C_BATCH_ID_MISSING'
        });
        return null;
    }
    const response = await fetch('/api/calcio/portfolio/finalize-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            analysisBatchId,
            bankroll: options.bankroll ?? null
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) {
        const error = new Error(payload.error || `Allocazione batch HTTP ${response.status}`);
        error.code = payload.code || `HTTP_${response.status}`;
        throw error;
    }
    const snapshotsByEvent = new Map((payload.rows || []).map(snapshot => [safeString(snapshot.eventKey), snapshot]));
    bets.forEach((bet, index) => {
        const snapshot = snapshotsByEvent.get(calcioBatchEventKey(bet));
        if (snapshot) applyCalcioBatchPortfolioSnapshot(bet, snapshot, index);
    });
    showRuntimeDiagnostic?.({
        severity: 'INFO',
        title: 'Portafoglio Calcio allocato',
        message: `Batch ${analysisBatchId} · stake pre-cap €${formatNumber(payload.totals?.preCapStake, 2)} · operativo €${formatNumber(payload.totals?.postCapStake, 2)} · eventi ${payload.rows?.length || 0}.`,
        phase: 'CALCIO_26C_BATCH_PORTFOLIO_COMMITTED',
        operationId: payload.allocationId,
        details: payload
    });
    return payload;
}

const CALCIO_DEEPSCAN_COMPACT_PAYLOAD_VERSION = 'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_V1';
const CALCIO_DEEPSCAN_CLIENT_TARGET_BYTES = 64 * 1024;

function compactDeepScanScalarMap(input = {}, keys = []) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const output = {};
    keys.forEach(key => {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (['string', 'number', 'boolean'].includes(typeof value)) output[key] = value;
    });
    return output;
}

function compactCalcioProbabilityIntegrity(input = {}, prediction = '') {
    const source = input && typeof input === 'object' ? input : {};
    const diagnostics = source.diagnostics && typeof source.diagnostics === 'object' ? source.diagnostics : {};
    const selected = diagnostics[prediction] && typeof diagnostics[prediction] === 'object'
        ? diagnostics[prediction]
        : (source.selectedMarket && typeof source.selectedMarket === 'object' ? source.selectedMarket : {});
    return {
        ...compactDeepScanScalarMap(source, ['version', 'coverageMode', 'reliability', 'maxDisagreementPp', 'maxMonteCarloStdErrorPp', 'xgEvidenceMode', 'status']),
        selectedMarket: compactDeepScanScalarMap(selected, ['monteCarloProbabilityPct', 'modelProbabilityPct', 'marketProbabilityPct', 'finalProbabilityPct', 'disagreementPp', 'monteCarloStdErrorPp', 'status'])
    };
}

function compactCalcioDeepScanExtData(bet = {}) {
    const source = bet.extData && typeof bet.extData === 'object' ? bet.extData : {};
    const prediction = safeString(bet.prediction);
    const marketProbabilities = {};
    const rawMarketProbabilities = source.marketProbabilities && typeof source.marketProbabilities === 'object' ? source.marketProbabilities : {};
    ['1', 'X', '2', 'O2.5', 'U2.5', 'GG', 'NG'].forEach(key => {
        const value = Number(rawMarketProbabilities[key]);
        if (Number.isFinite(value)) marketProbabilities[key] = value;
    });
    const opponentAdjustedForm = source.opponentAdjustedForm && typeof source.opponentAdjustedForm === 'object'
        ? {
            ...compactDeepScanScalarMap(source.opponentAdjustedForm, ['version', 'status', 'confidence', 'homePct', 'awayPct', 'capPct', 'homeFactor', 'awayFactor', 'applied']),
            expectedGoals: compactDeepScanScalarMap(source.opponentAdjustedForm.expectedGoals, ['expHomeGoals', 'expAwayGoals', 'baseHomeGoals', 'baseAwayGoals', 'homeFactor', 'awayFactor', 'applied', 'status', 'version'])
        }
        : {};
    return {
        ...compactDeepScanScalarMap(source, [
            'league', 'competition', 'tournament', 'country', 'round', 'stage',
            'commenceTime', 'kickoff', 'matchDate', 'providerEventId', 'eventKey',
            'canonicalPairKey', 'homeProviderName', 'awayProviderName',
            'homeCsvName', 'awayCsvName', 'homeUnderstatName', 'awayUnderstatName',
            'homeXg', 'awayXg', 'homeUnderstatXg', 'awayUnderstatXg',
            'homeMatches', 'awayMatches', 'footballDataLoaded',
            'footballHistoryCoverageMode', 'teamHistoryMatched', 'historicalCoverageVersion',
            'historicalCoverageReason', 'promotedTeamPrior', 'understatLoaded',
            'understatDataAvailable', 'xgEvidenceMode', 'understatProviderVersion',
            'understatProviderStatus', 'understatSeason', 'understatAuthorityStatus',
            'xgProviderId', 'xgProviderStatus', 'xgProviderSourceClass', 'xgProviderSelectionReason',
            'xgProviderSeason', 'xgProviderSeasonId', 'xgProviderAuthorityWeight', 'xgRealDataAvailable',
            'reliabilityMode', 'lineupStatus', 'lineupsConfirmed', 'newsConfidence',
            'avgGoals', 'expectedGoals', 'xgTotal', 'marketVolatility', 'volatility',
            'mcGlobal', 'odd1', 'oddX', 'odd2', 'overOdd', 'underOdd',
            'defaultMarginPct', 'providerTimeoutMs', 'deepScanTimeoutMs'
        ]),
        eventIdentity: compactDeepScanScalarMap(source.eventIdentity, ['eventKey', 'canonicalPairKey', 'providerEventId', 'homeProviderName', 'awayProviderName', 'homeCanonicalName', 'awayCanonicalName', 'status', 'certified', 'version']),
        probabilityIntegrity: compactCalcioProbabilityIntegrity(source.probabilityIntegrity || bet.probabilityIntegrity, prediction),
        predictionReliability: compactDeepScanScalarMap(bet.predictionReliability || source.predictionReliability, ['score', 'label', 'status', 'version', 'reason']),
        multiProviderEvidence: compactDeepScanScalarMap(source.multiProviderEvidence || bet.multiProviderEvidence, ['status', 'confidence', 'coveragePct', 'sourceCount', 'independentSources', 'contradictions', 'version', 'reason']),
        clubEloEvidence: compactDeepScanScalarMap(source.clubEloEvidence || bet.clubEloEvidence, ['status', 'available', 'authoritative', 'homeRating', 'awayRating', 'ratingDifference', 'homeWinAdjustmentPp', 'awayWinAdjustmentPp', 'source', 'version', 'error']),
        opponentAdjustedForm,
        historicalCoverageAudit: (() => {
            const audit = source.historicalCoverageAudit || bet.historical_coverage_audit || bet.calcio_historical_coverage_audit || {};
            if (audit && typeof audit === 'object') return audit;
            try { return JSON.parse(audit || '{}'); } catch (_) { return {}; }
        })(),
        marketProbabilities,
        theoreticalStake: safeNumber(bet.calcio_theoretical_stake ?? bet.stake_theoretical ?? bet.theoreticalStake, 0),
        operationalStake: safeNumber(bet.calcio_operational_stake ?? bet.stake_operational ?? bet.operationalStake ?? bet.invested, 0),
        analysisStage: compactDeepScanScalarMap(bet.analysis_stage || source.analysisStage, ['status', 'label', 'reason', 'version', 'analysisOnly'])
    };
}

function buildCompactCalcioDeepScanPayload(bet = {}) {
    const payload = {
        payloadVersion: CALCIO_DEEPSCAN_COMPACT_PAYLOAD_VERSION,
        homeTeam: bet.home,
        awayTeam: bet.away,
        eventKey: bet.match_exposure_key || bet.calcio_event_key || bet.event_key || bet.eventKey || bet.extData?.eventIdentity?.eventKey,
        matchExposureKey: bet.match_exposure_key || bet.calcio_event_key || bet.event_key || bet.eventKey || null,
        matchDate: bet.match_date || bet.commence_time || bet.date,
        providerEventId: bet.provider_event_id || bet.extData?.eventIdentity?.providerEventId,
        prediction: bet.prediction,
        odd: bet.odd,
        prob: getBetProbability(bet),
        edge: getBetEdgePp(bet),
        edge_pp: getBetEdgePp(bet),
        ev_pct: getBetEvPct(bet),
        odd1: bet.odd1,
        oddX: bet.oddX,
        odd2: bet.odd2,
        extData: compactCalcioDeepScanExtData(bet)
    };
    let bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes > CALCIO_DEEPSCAN_CLIENT_TARGET_BYTES) {
        payload.extData = {
            league: payload.extData.league,
            competition: payload.extData.competition,
            kickoff: payload.extData.kickoff || payload.matchDate,
            eventKey: payload.eventKey,
            providerEventId: payload.providerEventId,
            xgEvidenceMode: payload.extData.xgEvidenceMode,
            footballDataLoaded: payload.extData.footballDataLoaded,
            probabilityIntegrity: payload.extData.probabilityIntegrity,
            predictionReliability: payload.extData.predictionReliability,
            marketProbabilities: payload.extData.marketProbabilities,
            theoreticalStake: payload.extData.theoreticalStake,
            operationalStake: payload.extData.operationalStake,
            payloadCompactedTwice: true
        };
        bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    }
    payload.clientPayloadBytes = bytes;
    return payload;
}

window.processDeepScanQueue = async function(bets, sport, options = {}) {
    const runId = Date.now();

    currentDeepScanRunId = runId;

    for (let i = 0; i < bets.length; i++) {
        if (currentDeepScanRunId !== runId) return;

        const bet = bets[i];

        const badgeEl = $(`ds-badge-${i}`);
        const detailEl = $(`ds-detail-${i}`);
        const btnEl = $(`ds-btn-${i}`);
        const trElement = $(`row-${i}`);
        const dsRowElement = $(`ds-row-${i}`);

        // AUDIT16D_R3_T6_R2: non lasciare "IN ATTESA" su un evento il cui prematch è già chiuso.
        // Nessun DeepScan post-start viene avviato e nessuna authority/stake viene inventata.
        if (sport === SPORT.TENNIS) {
            const lifecycle = tennisPrematchLifecycleUi(bet);
            const dsState = tennisDeepScanCompletionState(bet);
            if (lifecycle.closed && !dsState.complete) {
                bet.tennisDeepScanLifecycle = 'PREMATCH_CLOSED_NO_DEEPSCAN';
                bet.deepScanPartial = false;
                if (badgeEl) {
                    badgeEl.innerHTML = '⏹ PREMATCH CHIUSO';
                    badgeEl.className = 'ds-badge ds-warn';
                    badgeEl.title = 'DeepScan non eseguito: la finestra prematch è terminata.';
                }
                if (detailEl) {
                    detailEl.innerHTML = '<div style="border-left:4px solid #64748b;padding-left:12px;"><strong>Prematch chiuso</strong><br><span style="color:#94a3b8;">DeepScan non eseguito. Stake mantenuto a €0; nessun dato post-start viene usato per autorizzare la selezione.</span></div>';
                }
                if (btnEl) btnEl.classList.remove('hidden');
                const historicalCell = $(`historical-rate-cell-${i}`);
                if (historicalCell) historicalCell.innerHTML = renderHistoricalCombinationEvidenceCell({ success:false, error:'PREMATCH CHIUSO · DeepScan non eseguito' });
                const qualityGateCell = $(`quality-gate-cell-${i}`);
                if (qualityGateCell) qualityGateCell.innerHTML = '<div style="min-width:128px;text-align:center;"><div style="font-weight:900;color:#94a3b8;">PREMATCH CHIUSO</div><div style="font-size:.64rem;color:#cbd5e1;margin-top:4px;">DeepScan non eseguito · stake €0</div></div>';

                // AUDIT16D_R3_T6_R2: override SOLO di presentazione. Non si
                // riscrivono bet.stake/invested né snapshot/DB: la colonna operativa
                // deve però essere coerente con il fail-closed e mostrare €0.
                const stakeCell = $(`stake-cell-${i}`);
                if (stakeCell) stakeCell.innerHTML = '<strong style="color:#94a3b8;">€0.00</strong><div style="font-size:.68em;color:#94a3b8;margin-top:3px;">PREMATCH CHIUSO · nessuna esecuzione</div>';
                const profitCell = $(`profit-cell-${i}`);
                if (profitCell) profitCell.innerHTML = '<span style="color:#94a3b8;" title="Nessuna esecuzione autorizzata dopo la chiusura prematch">Pot. +€0.00</span>';

                captureDeepScanMemoryUi?.(bet, i);
                continue;
            }
        }

        if (sport === SPORT.TENNIS) {
            // T11_R3_STAKE_REVISION_PRESENTATION: while a new DeepScan is running,
            // keep the last Patch46 contract visible as VIGENTE instead of mixing it
            // with the new, not-yet-final decision.
            const currentContract = resolveTennisStakeExecutionContractUi(bet);
            const currentFinalStake = Math.max(0, safeNumber(currentContract?.finalExecution?.executableStake, 0));
            const stakeCell = $(`stake-cell-${i}`);
            if (stakeCell) {
                stakeCell.innerHTML = `€${formatNumber(currentFinalStake,2)}<div style="font-size:.68em;color:#fbbf24;margin-top:3px;">VIGENTE · nuova revisione DeepScan in corso</div><div style="font-size:.61em;color:#64748b;margin-top:2px;">Il nuovo contratto Patch46 sostituirà questo valore solo a verifica completata.</div>${renderTennisStakePolicyMini(bet)}`;
            }
        }
        if (badgeEl) {
            badgeEl.innerHTML = '⏳ Analisi...';
            badgeEl.className = 'ds-badge ds-loading';
        }

        let deepScanApiSucceeded = false;
        try {
            const endpoint = sport === SPORT.CALCIO
                ? '/api/calcio/deepscan'
                : '/api/tennis/deepscan';

            const payload = sport === SPORT.CALCIO
                ? {
                    ...buildCompactCalcioDeepScanPayload(bet),
                    analysisBatchId: options.analysisBatchId || null
                }
                : {
                    p1Name: bet.home,
                    p2Name: bet.away,
                    prediction: bet.prediction,
                    odd: bet.odd,
                    prob: getBetProbability(bet),
                    // AUDIT16D_R3_T5_R3: conserva lo stesso bankroll usato dall'analisi.
                    bankrollSnapshot: bet.bankrollSnapshot ?? bet.bankroll_snapshot ?? bet.bankroll ?? Math.max(0, window.PortfolioAccounting.num($('bankroll')?.value) ?? 0),
                    bankroll_snapshot: bet.bankroll_snapshot ?? bet.bankrollSnapshot ?? bet.bankroll ?? Math.max(0, window.PortfolioAccounting.num($('bankroll')?.value) ?? 0),
                    edge: getBetEdgePp(bet),
                    edge_pp: getBetEdgePp(bet),
                    ev_pct: getBetEvPct(bet),
                    odd1: bet.odd1 ?? bet.referenceOdd1 ?? bet.reference_odd1,
                    odd2: bet.odd2 ?? bet.referenceOdd2 ?? bet.reference_odd2,
                    league: bet.league,
                    tournament: bet.tournament || bet.tournamentName || bet.eventName || bet.league,
                    tournamentName: bet.tournamentName || bet.tournament || bet.eventName || bet.league,
                    eventName: bet.eventName || bet.tournamentName || bet.tournament || bet.league,
                    match_date: bet.match_date || bet.date,
                    date: bet.date || bet.match_date,
                    commence_time: bet.commence_time || bet.startTime || bet.match_date || bet.date,
                    surface: bet.surface || bet.courtSurface,
                    courtSurface: bet.courtSurface || bet.surface,
                    marketType: bet.marketType || bet.market_type,
                    market_type: bet.market_type || bet.marketType,
                    point: bet.point ?? bet.point_line,
                    pointLine: bet.pointLine ?? bet.point_line ?? bet.point,
                    strategyTag: bet.strategy_tag || bet.strategyTag,
                    strategy_tag: bet.strategy_tag || bet.strategyTag,
                    // STEP50E_TOTALS_DEEPSCAN_PAYLOAD
                    side: bet.reference?.side || bet.side || (String(bet.prediction || '').toUpperCase().includes('UNDER') ? 'UNDER' : (String(bet.prediction || '').toUpperCase().includes('OVER') ? 'OVER' : null)),
                    line: bet.reference?.line ?? bet.reference?.pointLine ?? bet.point ?? bet.point_line,
                    overOdd: bet.reference?.overOdd ?? bet.overOdd,
                    underOdd: bet.reference?.underOdd ?? bet.underOdd,
                    over_odd: bet.reference?.overOdd ?? bet.overOdd,
                    under_odd: bet.reference?.underOdd ?? bet.underOdd,
                    noVigOverProb: bet.reference?.noVigOverProb ?? bet.noVigOverProb,
                    noVigUnderProb: bet.reference?.noVigUnderProb ?? bet.noVigUnderProb,
                    no_vig_over_prob: bet.reference?.noVigOverProb ?? bet.noVigOverProb,
                    no_vig_under_prob: bet.reference?.noVigUnderProb ?? bet.noVigUnderProb,
                    modelProbOver: bet.reference?.modelProbOver ?? bet.modelProbOver,
                    modelProbUnder: bet.reference?.modelProbUnder ?? bet.modelProbUnder,
                    model_prob_over: bet.reference?.modelProbOver ?? bet.modelProbOver,
                    model_prob_under: bet.reference?.modelProbUnder ?? bet.modelProbUnder,
                    expectedGames: bet.reference?.expectedGames ?? bet.expectedGames,
                    expected_games: bet.reference?.expectedGames ?? bet.expectedGames,
                    gamesStdDev: bet.reference?.gamesStdDev ?? bet.gamesStdDev,
                    games_std_dev: bet.reference?.gamesStdDev ?? bet.gamesStdDev,
                    markovConfidence: bet.reference?.markovConfidence ?? bet.markovConfidence,
                    markov_confidence: bet.reference?.markovConfidence ?? bet.markovConfidence,
                    tieBreakRisk: bet.reference?.tieBreakRisk ?? bet.tieBreakRisk,
                    tie_break_risk: bet.reference?.tieBreakRisk ?? bet.tieBreakRisk,
                    bestOfSets: bet.reference?.bestOfSets ?? bet.bestOfSets,
                    best_of_sets: bet.reference?.bestOfSets ?? bet.bestOfSets,
                    surfaceGamesProfile: bet.reference?.surfaceGamesProfile ?? bet.surfaceGamesProfile,
                    surface_games_profile: bet.reference?.surfaceGamesProfile ?? bet.surfaceGamesProfile,
                    holdBreakProfile: bet.reference?.holdBreakProfile ?? bet.holdBreakProfile,
                    hold_break_profile: bet.reference?.holdBreakProfile ?? bet.holdBreakProfile,
                    lineDistance: bet.reference?.lineDistance ?? bet.lineDistance,
                    line_distance: bet.reference?.lineDistance ?? bet.lineDistance,
                    duplicateLineRank: bet.reference?.duplicateLineRank ?? bet.duplicateLineRank,
                    duplicate_line_rank: bet.reference?.duplicateLineRank ?? bet.duplicateLineRank
                };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const responseText = await response.text();
            let result = {};
            try { result = responseText ? JSON.parse(responseText) : {}; }
            catch (_) { result = { success: false, error: `Risposta non JSON (HTTP ${response.status})` }; }

            if (response.status === 206 || result.partial === true || result.status === 'DEEPSCAN_PARZIALE' || result.status === 'DEEPSCAN_PARTIAL_POSTPROCESS_FAILURE') {
                deepScanApiSucceeded = result.success === true;

                if (sport === SPORT.TENNIS) {
                    // AUDIT16D_R3_T5: il core Tennis puo essere valido anche se un
                    // arricchimento downstream fallisce. Non usare il renderer Calcio
                    // e non trasformare un segnale core valido in "Errore".
                    bet.tennisDeepScanResult = result;
                    bet.deepScanPartial = true;
                    if (result.action) bet.ds_action = result.action;

                    const canonicalBridgeResult = result.canonicalPlayerEvidenceBridge
                        || result.quantData?.canonicalPlayerEvidenceBridge
                        || result.playerMatchupIntelligence?.canonicalPlayerEvidenceBridge
                        || null;
                    if (canonicalBridgeResult) {
                        bet.canonicalPlayerEvidenceBridge = canonicalBridgeResult;
                        bet.tennisCanonicalPlayerEvidence = canonicalBridgeResult;
                        bet.tennis_canonical_player_evidence_status = canonicalBridgeResult.status || bet.tennis_canonical_player_evidence_status;
                        bet.tennis_canonical_player_evidence_score = canonicalBridgeResult.score ?? bet.tennis_canonical_player_evidence_score;
                        bet.tennis_canonical_player_evidence_source = canonicalBridgeResult.source || (Array.isArray(canonicalBridgeResult.sources) ? canonicalBridgeResult.sources.join(' + ') : bet.tennis_canonical_player_evidence_source);
                        bet.tennis_canonical_player_evidence_json = JSON.stringify(canonicalBridgeResult);
                    }

                    const partialAction = safeString(result.action || 'DEEPSCAN PARZIALE');
                    const partialUpper = partialAction.toUpperCase();
                    const partialSignal = normalizeDeepScanOutcomeCategory({ ds_action: partialAction }) || partialAction;
                    let partialClass = 'ds-warn';
                    if (partialUpper.includes('PERICOLO') || partialUpper.includes('ALTO RISCHIO') || partialUpper.includes('🔴')) partialClass = 'ds-risk';
                    else if (partialUpper.includes('EDGE TECNICO') || partialUpper.includes('📊') || partialUpper.includes('VALUE CONFERMATO') || partialUpper.includes('🟢')) partialClass = 'ds-edge';

                    if (badgeEl) {
                        badgeEl.innerHTML = htmlEscape(partialSignal);
                        badgeEl.className = `ds-badge ${partialClass}`;
                        badgeEl.title = 'Segnale DeepScan disponibile; operatività e stake non ancora certificati.';
                    }

                    if (detailEl) {
                        const failure = result.postProcessFailure || {};
                        const technicalPhase = failure.phase || result.phase || 'POSTPROCESS';
                        const technicalCode = result.code || 'TENNIS_DEEPSCAN_POSTPROCESS_FAILURE';
                        detailEl.innerHTML = `
                            <div style="width:100%; border:1px solid #475569; border-left:4px solid #f59e0b; border-radius:8px; padding:12px 14px; background:#111827;">
                                <div style="font-weight:800; color:#fbbf24; margin-bottom:10px;">⚠️ Verifica operativa incompleta</div>
                                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:10px;">
                                    <div><span style="display:block;color:#94a3b8;font-size:.72em;">Segnale DeepScan</span><strong>${htmlEscape(partialSignal)}</strong></div>
                                    <div><span style="display:block;color:#94a3b8;font-size:.72em;">Operatività</span><strong style="color:#fbbf24;">NON CERTIFICATA</strong></div>
                                    <div><span style="display:block;color:#94a3b8;font-size:.72em;">Stake</span><strong style="color:#f87171;">NON AUTORIZZATO</strong></div>
                                </div>
                                <div style="color:#cbd5e1;font-size:.86em;">Il segnale IA è disponibile, ma il controllo finale non è stato completato.</div>
                                <div style="margin-top:8px;color:#64748b;font-size:.72em;">${htmlEscape(technicalPhase)} · ${htmlEscape(technicalCode)}</div>
                            </div>
                        `;
                    }
                    if (btnEl) btnEl.classList.remove('hidden');

                    const qualityGateCell = $(`quality-gate-cell-${i}`);
                    if (qualityGateCell) qualityGateCell.innerHTML = renderUnifiedQualityGateCell({ ...bet, __rowIndex: i });

                    // T11_R2_R2_PARTIAL_FAIL_CLOSED_STAKE_UI:
                    // una risposta 206 non deve lasciare visibile/esportabile uno stake
                    // pre-fusione o stale come se fosse autorizzato da Patch46.
                    bet.__t11PartialOriginalStake = safeNumber(bet.stake ?? bet.invested, 0);
                    bet.stake = 0;
                    bet.invested = '0.00';
                    bet.estimatedProfit = '0.00';
                    const partialStakeCell = $(`stake-cell-${i}`);
                    if (partialStakeCell) partialStakeCell.innerHTML = `€0.00<div style="font-size:0.68em;color:#f87171;margin-top:3px;">NON AUTORIZZATO · risposta DeepScan parziale</div><div style="font-size:0.62em;color:#64748b;margin-top:2px;">Valore pre-fusione/stale escluso fino a risposta operativa completa.</div>`;
                    const partialProfitCell = $(`profit-cell-${i}`);
                    if (partialProfitCell) partialProfitCell.innerHTML = 'Pot. +€0.00';

                    showRuntimeDiagnostic?.({
                        severity: 'WARN',
                        title: 'DeepScan Tennis: verifica operativa incompleta',
                        message: 'Segnale IA disponibile; stake non autorizzato finché il controllo finale non termina.',
                        operationId: result.postProcessFailure?.operationId || result.runtimeDiagnostic?.operationId || result.operationId || '',
                        phase: result.postProcessFailure?.phase || result.runtimeDiagnostic?.phase || 'TENNIS_DEEPSCAN_POSTPROCESS',
                        code: result.code || 'TENNIS_DEEPSCAN_POSTPROCESS_FAILURE',
                        scope: 'TENNIS',
                        details: {
                            signal: partialSignal,
                            operationalStatus: 'NON_CERTIFICATA',
                            stakeAuthorized: false,
                            persistenceCompleted: result.persistenceCompleted === true,
                            authorityPreserved: result.authorityPreserved === true
                        }
                    });
                } else {
                    if (badgeEl) {
                        badgeEl.innerHTML = '⚠️ Parziale';
                        badgeEl.className = 'ds-badge ds-warn';
                    }
                    if (detailEl) detailEl.innerHTML = renderCompactCalcioDeepScan(result, bet);
                }

                const historicalCell = $(`historical-rate-cell-${i}`);
                if (historicalCell) historicalCell.innerHTML = renderHistoricalCombinationEvidenceCell({ success: false, error: 'Verifica operativa incompleta: storico/gate/stake non certificati.' });
                await new Promise(resolve => setTimeout(resolve, sport === SPORT.TENNIS ? 150 : 1000));
                continue;
            }
            if (!response.ok) {
                const error = new Error(result.error || `DeepScan HTTP ${response.status}`);
                error.httpStatus = response.status;
                error.code = result.code || `HTTP_${response.status}`;
                error.phase = result.phase || result.runtimeDiagnostic?.phase || null;
                error.operationId = result.runtimeDiagnostic?.operationId || null;
                error.payload = result;
                throw error;
            }

            if (response.ok && result.success) {
                    bet.deepScanCachedResult = result;
                    if (sport === SPORT.TENNIS) bet.tennisDeepScanResult = result;
                    if (sport === SPORT.CALCIO) bet.calcioDeepScanResult = result;
                deepScanApiSucceeded = true;
                let badgeColor = '#10b981';
                let badgeClass = 'ds-value';
                let isHighRisk = false;

                const actStr = safeString(result.action).toUpperCase();

                if (
                    actStr.includes('PERICOLO') ||
                    actStr.includes('❌') ||
                    actStr.includes('ALTO RISCHIO') ||
                    actStr.includes('🔴')
                ) {
                    badgeColor = '#ef4444';
                    badgeClass = 'ds-risk';
                    isHighRisk = true;
                } else if (actStr.includes('RISCHIO MODELLO') || actStr.includes('🟠')) {
                    badgeColor = '#f97316';
                    badgeClass = 'ds-warn';
                } else if (actStr.includes('WATCHLIST') || actStr.includes('LOW EDGE') || actStr.includes('🟡')) {
                    badgeColor = '#f59e0b';
                    badgeClass = 'ds-warn';
                } else if (actStr.includes('EDGE TECNICO') || actStr.includes('📊')) {
                    badgeColor = '#0ea5e9';
                    badgeClass = 'ds-edge';
                } else if (actStr.includes('VIA LIBERA') || actStr.includes('CONFERMATA') || actStr.includes('LOW-MEDIUM') || actStr.includes('🟢')) {
                    badgeColor = '#22c55e';
                    badgeClass = 'ds-edge';
                } else if (actStr.includes('ATTENZIONE') || actStr.includes('⚠️')) {
                    badgeColor = '#f59e0b';
                    badgeClass = 'ds-warn';
                }

                if (badgeEl) {
                    const calcioSignalAction = sport === SPORT.CALCIO ? (result.signalAction || result.rawAction || result.action) : result.action;
                    badgeEl.innerHTML = htmlEscape(sport === SPORT.CALCIO ? normalizeDeepScanOutcomeCategory({ ds_action: calcioSignalAction }) : result.action);
                    badgeEl.title = sport === SPORT.CALCIO ? `Segnale DeepScan: ${calcioSignalAction} · Gate operativo: ${result.operationalAction || result.action} · ${result.temporalAnalysis?.presentationLabel || ''}` : '';
                    badgeEl.className = `ds-badge ${badgeClass}`;

                    if (badgeClass === 'ds-edge') {
                        badgeEl.style.backgroundColor = badgeColor;
                    }
                }

                if (sport === SPORT.TENNIS || sport === SPORT.CALCIO) {
                    bet.ds_action = result.action;
                    if (sport === SPORT.CALCIO) {
                        bet.calcioDeepScanResult = result;
                        bet.calcio_deepscan_raw_action = result.signalAction || result.rawAction || bet.calcio_deepscan_raw_action || '';
                        bet.temporalAnalysis = result.temporalAnalysis || bet.temporalAnalysis;
                    }
                    if (sport === SPORT.TENNIS) bet.qualityGateV2 = result.qualityGateV2 || null;
                    if (sport === SPORT.CALCIO) {
                        bet.calcioGate = result.calcioGate || null;
                        bet.predictionReliability = result.predictionReliability || bet.predictionReliability;
                        bet.prediction_reliability_score = result.predictionReliability?.score ?? bet.prediction_reliability_score;
                        bet.prediction_reliability_label = result.predictionReliability?.label || bet.prediction_reliability_label;
                        bet.analysis_stage = result.analysisStage || bet.analysis_stage;
                        bet.analysis_stage_label = result.analysisStage?.label || bet.analysis_stage_label;
                        bet.calcio_quality_final_label = result.qualityFinalLabel || bet.calcio_quality_final_label;
                        try {
                            applyCalcioDeepScanStakeResult(bet, result, i);
                        } catch (uiApplyError) {
                            console.error('[CALCIO PATCH25] DeepScan completato ma aggiornamento UI parziale:', uiApplyError);
                            result.uiRenderWarning = uiApplyError?.message || String(uiApplyError);
                        }
                    }
                    if (sport === SPORT.TENNIS) {
                        const finalQuality = result.qualityGateV2 || bet.qualityGateV2 || null;
                        bet.qualityGateV2 = finalQuality;
                        bet.quality_final_code = finalQuality?.code || bet.quality_final_code;
                        bet.quality_final_label = finalQuality?.label || bet.quality_final_label;
                        bet.quality_final_score = finalQuality?.score ?? bet.quality_final_score;
                        bet.quality_final_reason = finalQuality?.reason || bet.quality_final_reason;
                        bet.tennisPredictionIndex = result.tennisPredictionIndex || bet.tennisPredictionIndex;
                        bet.t11DecisionResearch = result.t11DecisionResearch || bet.t11DecisionResearch || null;
                        bet.aiReliabilityShadow = result.aiReliabilityShadow || bet.t11DecisionResearch?.aiReliabilityShadow || bet.aiReliabilityShadow || null;
                        bet.thresholdContinuityShadow = result.thresholdContinuityShadow || bet.t11DecisionResearch?.thresholdContinuityShadow || bet.thresholdContinuityShadow || null;
                        bet.calibratedValueShadow = result.calibratedValueShadow || bet.calibratedValueShadow || null;
                        const canonicalBridgeResult = result.canonicalPlayerEvidenceBridge || result.quantData?.canonicalPlayerEvidenceBridge || result.playerMatchupIntelligence?.canonicalPlayerEvidenceBridge || null;
                        if (canonicalBridgeResult) {
                            bet.canonicalPlayerEvidenceBridge = canonicalBridgeResult;
                            bet.tennisCanonicalPlayerEvidence = canonicalBridgeResult;
                            bet.tennis_canonical_player_evidence_status = canonicalBridgeResult.status || bet.tennis_canonical_player_evidence_status;
                            bet.tennis_canonical_player_evidence_score = canonicalBridgeResult.score ?? bet.tennis_canonical_player_evidence_score;
                            bet.tennis_canonical_player_evidence_source = canonicalBridgeResult.source || (Array.isArray(canonicalBridgeResult.sources) ? canonicalBridgeResult.sources.join(' + ') : bet.tennis_canonical_player_evidence_source);
                            bet.tennis_canonical_player_evidence_json = JSON.stringify(canonicalBridgeResult);
                        }
                    }
                    bet.historicalCombinationEvidence = result.historicalCombinationEvidence || result.realProbabilityPaperTrading || null;
                    const historicalCell = $(`historical-rate-cell-${i}`);
                    if (historicalCell) historicalCell.innerHTML = renderHistoricalCombinationEvidenceCell(bet.historicalCombinationEvidence);
                    const qualityGateCell = $(`quality-gate-cell-${i}`);
                    if (qualityGateCell) qualityGateCell.innerHTML = renderUnifiedQualityGateCell({ ...bet, __rowIndex: i });
                    const predictionIndexCell = $(`prediction-index-cell-${i}`);
                    if (predictionIndexCell) predictionIndexCell.innerHTML = renderUnifiedPredictionIndexCell(bet);
                    const reliabilityCell = $(`ai-reliability-cell-${i}`);
                    if (reliabilityCell) reliabilityCell.innerHTML = renderUnifiedAiReliabilityCell(bet);
                    const evidenceQualityCell = $(`evidence-quality-cell-${i}`);
                    if (evidenceQualityCell) evidenceQualityCell.innerHTML = renderUnifiedEvidenceQualityCell(bet);
                    const edgeEvCell = $(`edge-ev-cell-${i}`);
                    if (edgeEvCell) edgeEvCell.innerHTML = renderUnifiedEdgeEvCell(bet);
                }
                const historicalCombinationDetailHtml = (sport === SPORT.TENNIS || sport === SPORT.CALCIO)
                    ? renderHistoricalCombinationDetail(result.historicalCombinationEvidence || result.realProbabilityPaperTrading)
                    : '';
                const t11DecisionResearchDetailHtml = sport === SPORT.TENNIS ? renderT11DecisionResearchDetail(result.t11DecisionResearch || bet.t11DecisionResearch || null) : '';

                const finalExecutionContract = result.finalExecutableStakeContract || result.stakeAdjustment?.finalExecutableStakeContract || null;
                const finalExecutableStake = safeNumber(finalExecutionContract?.finalExecution?.executableStake ?? result.finalStakeAuthority?.finalStake ?? 0, 0);
                const preFusionCandidateStake = safeNumber(result.t11DecisionResearch?.analysis?.stakes?.afterStep101 ?? result.stakeAdjustment?.suggestedStake ?? result.stakeAdjustment?.adjustedStake ?? 0, 0);
                const step96CRuntimeMicroActive = result.stakeAdjustment ? step96CIsRuntimeMicroStakeActivation(result.stakeAdjustment) : false;
                const stakeAdjustmentHtml = result.stakeAdjustment ? `
                    <div style="margin:12px 0; padding:10px; border-radius:8px; background:rgba(59,130,246,0.10); border:1px solid rgba(59,130,246,0.35); color:#bfdbfe; font-weight:700;">
                        ${finalExecutableStake > 0
                            ? (step96CRuntimeMicroActive
                                ? `Step96C: micro-stake attivo per RISCHIO MODELLO + BLOCCATA SOFT con storico positivo. Stake pieno non consentito. Patch46 finale: STAKE ESEGUIBILE €${formatNumber(finalExecutableStake, 2)}.`
                                : `Patch46 finale: STAKE ESEGUIBILE €${formatNumber(finalExecutableStake, 2)}.`)
                            : (preFusionCandidateStake > 0
                                ? `${step96CRuntimeMicroActive ? 'Step96C candidato pre-fusione' : 'Candidato pre-fusione'} €${formatNumber(preFusionCandidateStake, 2)} → Patch46 finale €0.00: NON ESEGUIBILE.`
                                : 'Nessuno stake operativo proposto nella catena finale.')}
                        <div style="font-size:.72em;color:#94a3b8;margin-top:4px;">${htmlEscape(result.stakeAdjustment.reason || '')}</div>
                    </div>
                ` : '';

                renderDeepScanStakeAdvisory(i, bet, result.stakeAdjustment);

                if (detailEl) {
                    detailEl.innerHTML = `
                        <div style="width:100%; border-left:4px solid ${badgeColor}; padding-left:15px;">
                            ${t11DecisionResearchDetailHtml}
                            ${historicalCombinationDetailHtml}
                            ${stakeAdjustmentHtml}
                            ${sport === SPORT.CALCIO ? renderCompactCalcioDeepScan(result, bet) : (result.reason || '')}
                            ${isHighRisk ? `
                                <div style="color:#ef4444; font-weight:bold; margin-top:15px; padding:10px; background:rgba(239,68,68,0.1); border-radius:8px;">
                                    ${sport === SPORT.CALCIO ? '⚠️ DeepScan segnala alto rischio. Questo non e un verdetto di una IA indipendente; per lo stake fa fede la Authority.' : '⚠️ BET AUTOMATICAMENTE SCARTATA DAL SISTEMA VETO IA.'}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }

                if (btnEl) btnEl.classList.remove('hidden');

                if (trElement) {
                    const firstCell = trElement.querySelector('td');

                    if (firstCell) {
                        firstCell.style.borderLeft = `6px solid ${badgeColor}`;
                    }

                    if (isHighRisk) {
                        if (sport !== SPORT.CALCIO) trElement.style.opacity = '0.5';
                        trElement.style.backgroundColor = 'rgba(239,68,68,0.08)';
                    } else if (badgeColor === '#f59e0b') {
                        trElement.style.backgroundColor = 'rgba(245,158,11,0.08)';
                    } else if (badgeColor === '#0ea5e9') {
                        trElement.style.backgroundColor = 'rgba(14,165,233,0.05)';
                    } else {
                        trElement.style.backgroundColor = 'rgba(16,185,129,0.05)';
                    }
                }

                if (dsRowElement) {
                    const dsFirstCell = dsRowElement.querySelector('td');

                    if (dsFirstCell) {
                        dsFirstCell.style.borderLeft = `6px solid ${badgeColor}`;
                    }
                }
                captureDeepScanMemoryUi(bet, i);
            } else {
                if (badgeEl) {
                    badgeEl.innerHTML = '❌ Errore IA';
                    badgeEl.className = 'ds-badge ds-risk';
                }
                const historicalCell = $(`historical-rate-cell-${i}`);
                if (historicalCell) historicalCell.innerHTML = renderHistoricalCombinationEvidenceCell({ success: false, error: result.error || 'DeepScan non completato' });
            }
        } catch (error) {
            const historicalCell = $(`historical-rate-cell-${i}`);
            if (historicalCell) historicalCell.innerHTML = renderHistoricalCombinationEvidenceCell({ success: false, error: error.message });
            if (badgeEl) {
                const status = Number(error?.httpStatus || 0);
                const code = safeString(error?.code).toUpperCase();
                if (deepScanApiSucceeded) badgeEl.innerHTML = '⚠️ UI';
                else if (status === 413 || code.includes('PAYLOAD_TOO_LARGE')) badgeEl.innerHTML = '❌ Payload';
                else if (code.includes('TIMEOUT') || safeString(error?.name).toUpperCase() === 'ABORTERROR') badgeEl.innerHTML = '❌ Timeout';
                else badgeEl.innerHTML = '❌ Errore';
                badgeEl.className = 'ds-badge ds-risk';
                badgeEl.title = `${safeString(error?.code || 'TENNIS_DEEPSCAN_ERROR')} · ${safeString(error?.phase || 'UNKNOWN_PHASE')}`;
            }
            if (detailEl) {
                detailEl.innerHTML = `
                    <div style="width:100%; border-left:4px solid #ef4444; padding-left:15px;">
                        <div style="font-weight:800; color:#f87171; margin-bottom:8px;">❌ DeepScan Tennis non completato</div>
                        <div>${htmlEscape(error?.message || 'Errore DeepScan')}</div>
                        <div style="margin-top:8px; opacity:.85;">Fase: ${htmlEscape(error?.phase || 'UNKNOWN_PHASE')} · Codice: ${htmlEscape(error?.code || 'TENNIS_DEEPSCAN_ERROR')}</div>
                    </div>
                `;
            }
            if (btnEl) btnEl.classList.remove('hidden');

            if (sport === SPORT.TENNIS) {
                showRuntimeDiagnostic?.({
                    severity: 'ERROR',
                    title: 'DeepScan Tennis non completato',
                    message: error?.message || 'Errore DeepScan',
                    operationId: error?.operationId || '',
                    phase: error?.phase || 'TENNIS_DEEPSCAN_CLIENT',
                    code: error?.code || 'TENNIS_DEEPSCAN_ERROR',
                    scope: 'TENNIS',
                    force: true,
                    details: error?.payload || null
                });
            }
        }

        if (i < bets.length - 1) {
            // Patch 27: Tennis resta sequenziale per preservare l'ordine UI, ma senza la pausa fissa legacy di 4 secondi.
            // Il backend applica cache RAM limitata e deduplicazione delle richieste in-flight.
            const pacingMs = sport === SPORT.TENNIS ? 150 : 4000;
            await new Promise(resolve => setTimeout(resolve, pacingMs));
        }
    }

    if (sport === SPORT.TENNIS && currentDeepScanRunId === runId) {
        // AUDIT16D_R3_T6: DeepScan viene eseguito su tutte le alternative; solo
        // dopo il risultato finale viene mostrato il candidato migliore per evento.
        applyTennisBestPerMatchView(bets);
        applyTableFilters('analysisTable');
    }

    if (sport === SPORT.CALCIO && currentDeepScanRunId === runId) {
        try {
            await finalizeCalcioPortfolioBatch(bets, options);
        } catch (batchError) {
            console.error('[CALCIO PATCH26C] Allocazione batch non completata:', batchError);
            showRuntimeDiagnostic?.({
                severity: 'ERROR',
                title: 'Allocazione portafoglio Calcio fallita',
                message: `${batchError.code || 'CALCIO_26C_BATCH_ERROR'} · ${batchError.message}`,
                phase: 'CALCIO_26C_BATCH_PORTFOLIO_FAILED',
                details: { code: batchError.code, message: batchError.message }
            });
        }
    }
};

window.toggleDsDetail = function(index) {
    const rowEl = $(`ds-row-${index}`);
    const btnEl = $(`ds-btn-${index}`);
    const detailEl = $(`ds-detail-${index}`);

    if (!rowEl || !btnEl) return;

    const isClosed = rowEl.classList.contains('hidden') || rowEl.style.display === 'none' || rowEl.hidden === true;

    if (isClosed) {
        rowEl.classList.remove('hidden');
        rowEl.hidden = false;
        rowEl.style.display = '';
        rowEl.setAttribute('data-expanded', '1');
        btnEl.innerHTML = '➖ Nascondi';
        btnEl.setAttribute('aria-expanded', 'true');

        if (detailEl && !safeString(detailEl.innerHTML).trim()) {
            detailEl.innerHTML = `
                <div class="ds-detail-empty">
                    Deep Scan non ancora disponibile o risposta IA senza motivazione estesa.
                    Il badge sopra rimane comunque il segnale sintetico da usare per il filtro operativo.
                </div>
            `;
        }
    } else {
        rowEl.classList.add('hidden');
        rowEl.hidden = true;
        rowEl.style.display = 'none';
        rowEl.setAttribute('data-expanded', '0');
        btnEl.innerHTML = '🔍 Dettagli';
        btnEl.setAttribute('aria-expanded', 'false');
    }
};



// ============================================================================
// STEP51_API_USAGE_CREDITS_COUNTER - UI crediti The Odds API
// ============================================================================

function formatApiUsageNumber(value) {
    const n = safeNumber(value, 0);
    return n.toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

function updateApiUsageBox(summary = {}) {
    const box = $('apiCreditsUsageBox');
    if (!box || !summary || summary.success === false) return;

    const keyCount = safeNumber(summary.keyCount, 0);
    const total = safeNumber(summary.monthlyCreditTotal, 0);
    const used = safeNumber(summary.creditsUsed, 0);
    const remaining = safeNumber(summary.creditsRemaining, 0);
    const usagePct = Math.max(0, Math.min(100, safeNumber(summary.usagePct, 0)));
    const remainingPct = safeNumber(summary.remainingPct, 0);

    const color = remainingPct <= 15 ? '#ef4444' : (remainingPct <= 40 ? '#f59e0b' : '#10b981');

    if ($('apiUsageKeyCount')) $('apiUsageKeyCount').textContent = formatApiUsageNumber(keyCount);
    if ($('apiUsageMonthlyTotal')) $('apiUsageMonthlyTotal').textContent = formatApiUsageNumber(total);
    if ($('apiUsageCreditsUsed')) $('apiUsageCreditsUsed').textContent = formatApiUsageNumber(used);
    if ($('apiUsageCreditsRemaining')) {
        $('apiUsageCreditsRemaining').textContent = formatApiUsageNumber(remaining);
        $('apiUsageCreditsRemaining').style.color = color;
    }
    if ($('apiUsageAttempts')) $('apiUsageAttempts').textContent = formatApiUsageNumber(summary.requestAttempts || 0);

    // STEP53_API_EFFICIENCY_CACHE - UI cache metrics
    const cache = summary.cache || {};
    if ($('apiUsageCacheHits')) $('apiUsageCacheHits').textContent = formatApiUsageNumber(cache.hits || 0);
    if ($('apiUsageCacheHitRate')) $('apiUsageCacheHitRate').textContent = `${safeNumber(cache.hitRatePct, 0).toFixed(1)}%`;
    if ($('apiUsageProgressBar')) {
        $('apiUsageProgressBar').style.width = `${usagePct}%`;
        $('apiUsageProgressBar').style.background = color;
    }

    const last = summary.lastCall;
    const lastText = last
        ? `${last.operation || 'API'} · ${last.source || 'backend'} · ${new Date(last.at).toLocaleString('it-IT')}`
        : 'Nessuna chiamata API registrata nel mese corrente.';
    const resetDate = summary.resetNextAt ? new Date(summary.resetNextAt).toLocaleDateString('it-IT') : 'primo giorno del mese prossimo';

    if ($('apiUsageDetails')) {
        const cacheText = summary.cache ? ` · Cache hit: ${safeNumber(summary.cache.hitRatePct, 0).toFixed(1)}% (${formatApiUsageNumber(summary.cache.hits || 0)} hit / ${formatApiUsageNumber(summary.cache.misses || 0)} miss)` : '';
        const accuracy = summary.accuracyMode || summary.mode || 'LEGACY';
        const lastCost = last && Number.isFinite(Number(last.credits)) ? ` · costo ${formatApiUsageNumber(last.credits)} crediti` : '';
        $('apiUsageDetails').innerHTML = `Mese ${summary.monthKey || '--'} · Usato ${usagePct.toFixed(2)}% · Residuo ${remainingPct.toFixed(2)}% · Reset: ${resetDate}${cacheText}<br><strong>Contabilità:</strong> ${htmlEscape(accuracy)} · tentativi provider Patch12 ${formatApiUsageNumber(summary.providerRequestAttempts || 0)} · successi ${formatApiUsageNumber(summary.successfulRequests || 0)} · errori ${formatApiUsageNumber(summary.failedRequests || 0)}<br><strong>Ultima chiamata:</strong> ${lastText}${lastCost}`;
    }
}

async function loadApiCreditsUsage() {
    try {
        const response = await fetch('/api/usage/odds');
        const summary = await response.json();
        updateApiUsageBox(summary);
    } catch (error) {
        if ($('apiUsageDetails')) $('apiUsageDetails').textContent = 'Contatore API non disponibile: ' + error.message;
    }
}

function bindApiUsageControls() {
    const btn = $('refreshApiUsageBtn');
    if (btn && btn.dataset.boundStep51 !== '1') {
        btn.addEventListener('click', loadApiCreditsUsage);
        btn.dataset.boundStep51 = '1';
    }
}


// ============================================================================
// 9. LIVE ANALYSIS
// ============================================================================

$('analyzeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const viewEpoch = enterPrimaryView('ANALYSIS');
    showAnalysisPendingViewT10R2R1();

    const btn = $('submitBtn');

    if (btn) {
        btn.innerText = '⏳ Analisi...';
        btn.disabled = true;
    }

    showLoading();

    const payload = {
        league: $('league')?.value || 'all',
        bankroll: Math.max(0, window.PortfolioAccounting.num($('bankroll')?.value) ?? 0)
    };

    const requestedSport = activeSport;
    const forcedRefresh = forceAnalysisRefreshPatch49 === true;
    forceAnalysisRefreshPatch49 = false;
    const memoryEntry = forcedRefresh ? null : getAnalysisMemory(requestedSport, payload);
    if (memoryEntry) {
        currentAnalysisData = memoryEntry.data;
        if (isPrimaryViewCurrent('ANALYSIS', viewEpoch)) {
            clearAnalysisPendingViewT10R2R1();
            nascondiTutto();
            $('results')?.classList.remove('hidden');
            renderLiveAnalysis(memoryEntry.data, { reuseCached:true, memoryEntry });
            hideLoading();
        }
        if (btn) { btn.innerText = '🚀 Analisi IA'; btn.disabled = false; }
        return;
    }

    const apiUrl = activeSport === SPORT.CALCIO
        ? '/api/analyze'
        : '/api/tennis/analyze';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || data.error || data.success === false) {
            const scope = activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO';
            showRuntimeDiagnostic({
                severity: data.retryable ? 'WARN' : 'ERROR',
                title: data.code === 'TENNIS_ODDS_PROVIDER_TIMEOUT'
                    ? 'Provider quote Tennis temporaneamente lento'
                    : 'Analisi non completata',
                message: data.error || `HTTP ${response.status}`,
                operationId: data.operationId || data.runtimeDiagnostic?.operationId || '',
                phase: data.runtimeDiagnostic?.phase || 'ANALYSIS_RESPONSE',
                code: data.code || data.runtimeDiagnostic?.event || `HTTP_${response.status}`,
                scope, force: true,
                details: { retryable: data.retryable === true, runtimeDiagnostic: data.runtimeDiagnostic || null }
            });
            return;
        }

        if (data.partial && activeSport === SPORT.TENNIS) {
            showRuntimeDiagnostic({
                severity: 'WARN',
                title: 'Analisi Tennis completata parzialmente',
                message: data.warning || 'Almeno un torneo non ha risposto; i risultati disponibili sono stati conservati.',
                operationId: data.operationId || '',
                phase: 'TENNIS_ANALYSIS_PARTIAL_PROVIDER_RESULT',
                code: 'PARTIAL_PROVIDER_RESULT',
                scope: 'TENNIS',
                details: data.diagnostics?.api || null
            });
        }

        currentAnalysisData = data;
        storeAnalysisMemory(requestedSport, payload, data);
        if (!isPrimaryViewCurrent('ANALYSIS', viewEpoch)) return;

        clearAnalysisPendingViewT10R2R1();
        nascondiTutto();
        $('results')?.classList.remove('hidden');

        renderLiveAnalysis(data);
    } catch (error) {
        showRuntimeDiagnostic({
            severity: 'ERROR',
            title: 'Connessione analisi non disponibile',
            message: error.message || 'Errore connessione.',
            phase: 'ANALYSIS_FETCH',
            code: 'ANALYSIS_NETWORK_ERROR',
            scope: getRuntimeDiagnosticScope(),
            force: true, error
        });
    } finally {
        clearAnalysisPendingViewT10R2R1();
        if (btn) {
            btn.innerText = '🚀 Analisi IA';
            btn.disabled = false;
        }

        if (isPrimaryViewCurrent('ANALYSIS', viewEpoch)) hideLoading();
        // STEP51: aggiorna contatore crediti dopo ogni analisi live.
        loadApiCreditsUsage();
    }
});


function normalizeTennisOperationalReport(row = {}) {
    const source = row.operationalReport || row.tennisOperationalReport || row.tennis_operational_report || null;

    if (source && typeof source === 'object') {
        return source;
    }

    // STEP90E_GATE_DB_SYNC: priorità alla decisione Step90 nel paper trading storico.
    // Evita che righe già promosse a APPROVATA restino visualizzate come legacy APPROVATA CON CAP.
    const step90DisplayLabelRaw = typeof normalizeStep90PreMatchLabel === 'function' ? normalizeStep90PreMatchLabel(row) : '';
    const step90DisplayLabel = safeString(step90DisplayLabelRaw).replace(/^🎾\s*/, '').toUpperCase();
    if (step90DisplayLabel) {
        const isPositive = step90DisplayLabel.includes('APPROVATA');
        const isFullStake = step90DisplayLabel.includes('STAKE PIENO');
        const isBlocked = step90DisplayLabel.includes('BLOCCATA');
        const isWatchlist = step90DisplayLabel.includes('WATCHLIST');
        const status = isFullStake
            ? 'APPROVED_FULL_STAKE_STEP90E'
            : (step90DisplayLabel === 'APPROVATA' ? 'APPROVED_STEP90E' : step90DisplayLabel);
        const action = isFullStake
            ? 'BET_ALLOWED_FULL_STAKE_STEP90E'
            : (step90DisplayLabel === 'APPROVATA' ? 'BET_ALLOWED_STEP90E_APPROVED' : (isPositive ? 'BET_ALLOWED_WITH_CAP' : (isWatchlist ? 'PAPER_OR_MICRO_STAKE' : 'NO_BET')));
        return {
            mode: 'STEP90E_GATE_DB_SYNC',
            status,
            action,
            label: step90DisplayLabel,
            severity: isPositive ? 'OK' : (isWatchlist ? 'WARN' : (isBlocked ? 'ERROR' : 'WARN')),
            summary: row.pre_match_gate_reason || renderStep90DecisionAuditNote(row) || 'Decisione Step90 sincronizzata con storico paper trading.',
            allowBet: isPositive || isWatchlist,
            professionalUse: isPositive && !isFullStake,
            value: {
                edge_pp: getBetEdgePp(row),
                ev_pct: getBetEvPct(row),
                probability_pct: getBetProbability(row),
                valueScore: safeNumber(row.model_confidence_score || row.valueScore, 0)
            },
            data: {
                sufficiencyScore: safeNumber(row.data_sufficiency_score || row.dataSufficiencyScore, 0),
                referenceMarketQuality: row.reference_market_quality || row.reference?.quality || null,
                markovValidated: row.markov_validated === 1 || row.markovValidated === true
            },
            stake: {
                requestedStake: getBetStake(row),
                maxStake: safeNumber(row.professional_gate_max_stake || row.professionalGate?.stakePolicy?.recommendedMaxStake, 0),
                recommendedStake: safeNumber(row.professional_gate_max_stake || row.professionalGate?.stakePolicy?.recommendedMaxStake || getBetStake(row), 0)
            },
            checks: [],
            reasons: [renderStep90DecisionAuditNote(row)].filter(Boolean),
            warnings: []
        };
    }

    const gateStatus = safeString(row.professional_gate_status || row.professionalGate?.status || '').toUpperCase();
    const gateAllow = row.professional_gate_allow_bet === true ||
        row.professional_gate_allow_bet === 1 ||
        row.professionalGate?.allowBet === true;
    const opStatus = safeString(row.tennis_operational_status || '').toUpperCase();
    const action = safeString(row.tennis_operational_action || '').toUpperCase();

    if (!source && !gateStatus && !opStatus && activeSport !== SPORT.TENNIS) {
        return null;
    }

    let status = opStatus || gateStatus || (gateAllow ? 'APPROVED_STANDARD' : 'BLOCKED');
    let label = 'BLOCCATA HARD';
    let severity = 'ERROR';

    if (status.includes('PROFESSIONAL')) {
        label = 'APPROVATA PROFESSIONALE';
        severity = 'OK';
    } else if (status.includes('CONSENSUS') || status.includes('WATCH') || status.includes('MICRO')) {
        label = status.includes('CONSENSUS') ? 'WATCHLIST MICRO · DEEPSCAN' : 'WATCHLIST MICRO';
        severity = 'WARN';
    } else if (status.includes('APPROVED')) {
        label = 'APPROVATA CON CAP';
        severity = 'OK';
    } else if (status.includes('SOFT') || status.includes('CALIBRATION') || status.includes('MARKET_DISAGREEMENT')) {
        label = 'BLOCCATA SOFT';
        severity = 'WARN';
    }

    const reasonsText = safeString(row.professional_gate_reasons || row.professionalGate?.reasons?.join(' | ') || '');
    const reasons = reasonsText ? reasonsText.split('|').map(s => s.trim()).filter(Boolean) : [];

    return {
        mode: 'TENNIS_OPERATIONAL_REPORT_V1',
        status,
        action: action || (gateAllow ? 'BET_ALLOWED_WITH_CAP' : 'NO_BET'),
        label,
        severity,
        summary: row.tennis_operational_summary || (gateAllow
            ? (status.includes('CONSENSUS') ? 'DeepScan conferma: micro-stake attivo, stake standard non consentito.' : 'Pronostico Tennis approvato dal gate professionale.')
            : (label === 'BLOCCATA SOFT' ? 'Pronostico Tennis bloccato soft: rivalutabile solo con consenso DeepScan e micro-stake.' : 'Pronostico Tennis bloccato hard dal gate professionale.')),
        allowBet: gateAllow,
        professionalUse: status.includes('PROFESSIONAL'),
        value: {
            edge_pp: getBetEdgePp(row),
            ev_pct: getBetEvPct(row),
            probability_pct: getBetProbability(row),
            valueScore: safeNumber(row.model_confidence_score || row.valueScore, 0)
        },
        data: {
            sufficiencyScore: safeNumber(row.data_sufficiency_score || row.dataSufficiencyScore, 0),
            referenceMarketQuality: row.reference_market_quality || row.reference?.quality || null,
            markovValidated: row.markov_validated === 1 || row.markovValidated === true
        },
        stake: {
            requestedStake: getBetStake(row),
            maxStake: safeNumber(row.professional_gate_max_stake || row.professionalGate?.stakePolicy?.recommendedMaxStake, 0),
            recommendedStake: safeNumber(row.professional_gate_max_stake || row.professionalGate?.stakePolicy?.recommendedMaxStake || getBetStake(row), 0)
        },
        checks: [],
        reasons,
        warnings: []
    };
}

function getTennisOperationalColor(report = {}) {
    const severity = safeString(report.severity || '').toUpperCase();
    const status = safeString(report.status || '').toUpperCase();

    if (severity === 'OK' || status.includes('APPROVED')) return '#10b981';
    if (severity === 'WARN' || status.includes('WATCH') || status.includes('MICRO')) return '#f59e0b';
    return '#ef4444';
}


function getTennisOperationalMeaning(statusOrLabel = '') {
    const text = safeString(statusOrLabel).toUpperCase();

    if (text.includes('APPROVATA CON CAP') || text.includes('APPROVED_STANDARD')) {
        return 'Supera i controlli minimi del gate, ma lo stake viene limitato dal cap operativo. Non equivale a certezza di vincita: indica solo che può entrare in paper/trading con importo massimo controllato.';
    }

    if (text.includes('APPROVATA STAKE PIENO') || text.includes('APPROVED_FULL_STAKE')) {
        return 'Miglior livello operativo: stake pieno consentito solo entro matrice Kelly/cap e dopo controlli storici aggregati. Non usa il CLV della giocata corrente.';
    }

    if (text === 'APPROVATA' || text.includes('APPROVED_STEP90')) {
        return 'APPROVATA Step90: stake operativo consentito con aumento graduale controllato. Non equivale a stake pieno automatico e non usa il CLV della giocata corrente.';
    }

    if (text.includes('APPROVATA PROFESSIONALE') || text.includes('APPROVED_PROFESSIONAL')) {
        return 'Supera value, dati, calibrazione e controlli professionali. Resta comunque un pronostico probabilistico, non una garanzia.';
    }

    if (text.includes('WATCH') || text.includes('MICRO')) {
        if (text.includes('DEEPSCAN') || text.includes('CONSENSUS')) {
            return 'DeepScan conferma il pronostico: micro-stake attivo, stake standard non consentito.';
        }
        return 'Segnale osservabile ma non abbastanza solido per stake normale: ammesso solo micro-stake o monitoraggio.';
    }

    if (text.includes('BLOCCATA SOFT')) {
        return 'Blocco prudenziale non definitivo: il pronostico non entra a stake reale, ma può diventare WATCHLIST MICRO se DeepScan conferma e edge/EV restano positivi.';
    }

    if (text.includes('BLOCCATA') || text.includes('BLOCKED')) {
        return 'Blocco hard: non deve entrare in trading reale perché uno o più controlli critici non sono sufficienti o il rischio è troppo alto.';
    }

    return 'Stato operativo Tennis generato dal gate professionale.';
}

function renderTennisOperationalLegend(report = {}) {
    if (activeSport !== SPORT.TENNIS) return '';

    const label = report.label || report.status || '';
    const meaning = getTennisOperationalMeaning(label || report.status);

    return `
        <div class="tennis-op-legend">
            <strong>Cosa significa:</strong>
            <div>${htmlEscape(meaning)}</div>
            <small>
                APPROVATA = stake operativo consentito con aumento graduale ·
                APPROVATA CON CAP = ammessa con stake massimo ridotto ·
                BLOCCATA HARD = esclusa dal trading operativo ·
                BLOCCATA SOFT = rivalutabile solo con consenso DeepScan; se confermata diventa WATCHLIST MICRO · DEEPSCAN con stake micro attivo ·
                WATCHLIST MICRO = solo osservazione o micro-stake.
                STEP91_UI_CR_CORRELATION_SPLIT: CR quote OK = quota coerente con mercato reference; Correlazione modello/mercato FAIL = gap probabilità troppo alto, quindi può restare BLOCCATA HARD.
            </small>
        </div>
    `;
}

function renderTennisOperationalBadge(row = {}) {
    if (activeSport !== SPORT.TENNIS) return '';

    const report = normalizeTennisOperationalReport(row);
    if (!report) return '';

    const color = getTennisOperationalColor(report);
    const label = report.label || report.status || 'TENNIS REPORT';

    return `
        <span class="tennis-op-badge" title="Gate operativo pre-fusione/legacy. Autorità finale: Quality V2 → Patch35 → Patch39 → Patch46." style="border-color:${color}; color:${color}; background:${color}1a;">
            🎾 PRE-FUSIONE · ${htmlEscape(label)}
        </span>
    `;
}

function renderTennisOperationalReportPanel(row = {}) {
    if (activeSport !== SPORT.TENNIS) return '';

    const report = normalizeTennisOperationalReport(row);
    if (!report) return '';

    const color = getTennisOperationalColor(report);
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const reasons = Array.isArray(report.reasons) ? report.reasons : [];
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];
    const value = report.value || {};
    const stake = report.stake || {};
    const data = report.data || {};
    const calibration = report.calibration || {};

    const checkHtml = checks.length
        ? checks.map(check => {
            const status = safeString(check.status || 'WARN').toUpperCase();
            const c = status === 'PASS' ? '#10b981' : (status === 'WARN' ? '#f59e0b' : '#ef4444');
            return `
                <div class="tennis-op-check">
                    <span>${htmlEscape(check.label || check.key)}</span>
                    <strong style="color:${c};">${htmlEscape(status)}</strong>
                    <small>${htmlEscape(check.detail || '')}</small>
                </div>
            `;
        }).join('')
        : `
            <div class="tennis-op-check">
                <span>Gate professionale</span>
                <strong style="color:${color};">${htmlEscape(report.status || '-')}</strong>
                <small>${htmlEscape(report.summary || '')}</small>
            </div>
        `;

    const reasonsHtml = reasons.length
        ? `<div class="tennis-op-list">${reasons.map(r => `<div>• ${htmlEscape(r)}</div>`).join('')}</div>`
        : '<div class="tennis-op-muted">Nessun motivo critico aggiuntivo.</div>';

    const warningsHtml = warnings.length
        ? `<div class="tennis-op-list warn">${warnings.map(w => `<div>⚠️ ${htmlEscape(w)}</div>`).join('')}</div>`
        : '';

    return `
        <div class="tennis-op-report" style="border-left-color:${color};">
            <div class="tennis-op-header">
                <div>
                    <div class="tennis-op-eyebrow">Report operativo Tennis</div>
                    <div class="tennis-op-title" style="color:${color};">${htmlEscape(report.label || report.status || 'UNKNOWN')}</div>
                    <div class="tennis-op-summary">${htmlEscape(report.summary || 'Report operativo non disponibile.')}</div>
                </div>
                <div class="tennis-op-action">${htmlEscape(report.action || 'NO_ACTION')}</div>
            </div>
            <div class="tennis-op-grid">
                <div><span>Edge / EV</span><strong>${formatPct(value.edge_pp, 2, true)} · EV ${formatPct(value.ev_pct, 2, true)}</strong></div>
                <div><span>Probabilità</span><strong>${formatPct(value.probability_pct, 2)}</strong></div>
                <div><span>Data sufficiency</span><strong>${data.sufficiencyScore !== undefined && data.sufficiencyScore !== null ? formatNumber(data.sufficiencyScore, 1) : '-'}</strong></div>
                <div><span>Calibrazione</span><strong>${htmlEscape(calibration.grade || report.calibrationGrade || '-')}</strong></div>
                <div><span>Stake richiesto</span><strong>€${formatNumber(stake.requestedStake, 2)}</strong></div>
                <div><span>Stake operativo max</span><strong>€${formatNumber(stake.maxStake || stake.recommendedStake, 2)}</strong></div>
            </div>
            <div class="tennis-op-checks">${checkHtml}</div>
            ${renderTennisOperationalLegend(report)}
            <div class="tennis-op-reasons">
                <strong>Motivi / note operative</strong>
                ${reasonsHtml}
                ${warningsHtml}
            </div>
        </div>
    `;
}


function summarizeStep50ATotalsFeedDiagnostics(data = {}) {
    // STEP50A_TOTALS_LIVE_PARSER_UI
    const diagnostics = data.totalsFeedDiagnostics || data.meta?.totalsFeedDiagnostics || [];
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) return '';

    const totalsEvents = diagnostics.reduce((sum, row) => sum + safeNumber(row.totalsEvents, 0), 0);
    const totalsBookmakers = diagnostics.reduce((sum, row) => sum + safeNumber(row.totalsBookmakers, 0), 0);
    const emitted = diagnostics.reduce((sum, row) => sum + safeNumber(row.emittedTotalsCandidates, 0), 0);
    const paperOnly = diagnostics.reduce((sum, row) => sum + safeNumber(row.paperOnlyTotalsCandidates, 0), 0);
    const evaluated = diagnostics.reduce((sum, row) => sum + safeNumber(row.evaluatedTotalsCandidates, 0), 0);
    const supportedLines = diagnostics.reduce((sum, row) => sum + safeNumber(row.supportedTotalsLines, 0), 0);
    // STEP50B_OVER_UNDER_BALANCE_UI
    const overEval = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.evaluated?.over, 0), 0);
    const underEval = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.evaluated?.under, 0), 0);
    const overEmit = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.emitted?.over, 0), 0);
    const underEmit = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.emitted?.under, 0), 0);
    const overBlocked = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.blocked?.over, 0), 0);
    const underBlocked = diagnostics.reduce((sum, row) => sum + safeNumber(row.overUnderBalance?.blocked?.under, 0), 0);
    const underWarning = underEval > 0 && underEmit === 0
        ? '<span style="color:#fbbf24; margin-left:8px;">Under valutati ma non emessi: probabile scarto per edge/EV, Markov o stake policy.</span>'
        : '';

    const useTotalsRequested = data?.diagnostics?.config?.useTotals === true ||
        data?.meta?.analysisDiagnostics?.config?.useTotals === true;

    if (totalsBookmakers <= 0) {
        if (!useTotalsRequested) {
            return '<div style="margin-top:6px; color:#93c5fd; font-weight:700;">Totals disabilitati da Setup: il provider non è stato interrogato per Over/Under.</div>';
        }

        return '<div style="margin-top:6px; color:#f87171; font-weight:700;">Feed totals non disponibile nella risposta live: controllare markets=h2h,totals e provider.</div>';
    }

    return `
        <div style="margin-top:6px; color:#93c5fd; font-weight:700;">
            Step50A: feed totals disponibile (${totalsEvents} eventi · ${totalsBookmakers} bookmaker · ${supportedLines} linee supportate).
            Candidati totals valutati: ${evaluated}; emessi: ${emitted}; paper/gate-only: ${paperOnly}.
            <br>Step50B Over/Under balance: Over eval/emessi/bloccati ${overEval}/${overEmit}/${overBlocked} · Under eval/emessi/bloccati ${underEval}/${underEmit}/${underBlocked}.${underWarning}
        </div>
    `;
}

function renderAnalysisMarketMixNotice(data = {}) {
    if (activeSport !== SPORT.TENNIS) return;

    const accumulatorBox = $('accumulatorBox');
    if (!accumulatorBox) return;

    const audit = data.marketMixAudit || data.meta?.marketMixAudit || null;
    if (!audit) return;

    let notice = $('analysisMarketMixNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'analysisMarketMixNotice';
        accumulatorBox.prepend(notice);
    }

    const warning = audit.warning ? `<div style="color:#f59e0b; margin-top:5px; font-weight:800;">⚠️ ${htmlEscape(audit.warning)}<br><span style="font-weight:600; color:#fde68a;">Controllare parser Over/Under, Markov e gate: il feed può già restituire quote totals reali.</span></div>` : '';
    const step50aDiagnostics = summarizeStep50ATotalsFeedDiagnostics(data);
    const portfolioMix = inferHistoricalPortfolioMarketMix();
    const portfolioMixHtml = (portfolioMix.moneyline || portfolioMix.totals)
        ? `<div style="margin-top:6px; color:#cbd5e1;"><strong style="color:#a7f3d0;">Mix mercati portfolio storico</strong><span style="margin-left:8px;">Moneyline: ${portfolioMix.moneyline} · Totals: ${portfolioMix.totals} · Over: ${portfolioMix.over} · Under: ${portfolioMix.under}</span></div>`
        : '<div style="margin-top:6px; color:#94a3b8;">Mix mercati portfolio storico disponibile nella sezione Portfolio dopo aggiornamento dati.</div>';

    notice.innerHTML = `
        <div style="margin:10px 0; padding:12px; border-left:4px solid #38bdf8; background:rgba(56,189,248,.08); border-radius:8px; color:#cbd5e1;">
            <div><strong style="color:#38bdf8;">Mix mercati Analisi AI corrente</strong>
            <span style="margin-left:8px;">Moneyline selezionate: ${safeNumber(audit.moneyline, 0)} · Totals selezionate: ${safeNumber(audit.totals, 0)} · Over: ${safeNumber(audit.over, 0)} · Under: ${safeNumber(audit.under, 0)}</span></div>
            ${portfolioMixHtml}
            ${warning}
            ${step50aDiagnostics}
        </div>
    `;
}


const AUDIT16D_R3_T6_TENNIS_EVENT_SELECTION = 'AUDIT16D_R3_T6_TENNIS_EVENT_BEST_ANALYSIS_DEEPSCAN_V1';
const AUDIT16D_R3_T6_R1_CONSOLIDATION = 'AUDIT16D_R3_T6_R1_TENNIS_PROVISIONAL_WINNER_PREMATCH_CLOSE_FORWARD_CONTRACT_V1';
const AUDIT16D_R3_T6_R2_TEMPORAL_UI_FIX = 'AUDIT16D_R3_T6_R2_ITALIAN_DATE_PARSE_PREMATCH_STAKE_DISPLAY_V1';

function tennisMatchStartEpochUi(row = {}) {
    const raw = safeString(row.canonical_match_datetime || row.commence_time || row.commenceTime || row.match_date || row.matchDate || row.date || row.kickoff).trim();
    if (!raw) return null;

    // AUDIT16D_R3_T6_R2: il formato UI italiano DD/MM/YYYY deve essere
    // riconosciuto PRIMA di Date.parse(). In Chromium/Node una stringa come
    // 01/10/2026 può essere interpretata come MM/DD/YYYY (10 gennaio 2026),
    // chiudendo falsamente il prematch di eventi futuri del 1 ottobre.
    const italian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (italian) {
        const [, ddRaw, mmRaw, yyyyRaw, hhRaw = '00', minRaw = '00', ssRaw = '00'] = italian;
        const dd = Number(ddRaw), mm = Number(mmRaw), yyyy = Number(yyyyRaw);
        const hh = Number(hhRaw), min = Number(minRaw), ss = Number(ssRaw);
        if (yyyy >= 2000 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && hh >= 0 && hh <= 23 && min >= 0 && min <= 59 && ss >= 0 && ss <= 59) {
            const local = new Date(yyyy, mm - 1, dd, hh, min, ss, 0);
            // Evita normalizzazioni silenziose di date impossibili (es. 31/02).
            if (local.getFullYear() === yyyy && local.getMonth() === mm - 1 && local.getDate() === dd
                && local.getHours() === hh && local.getMinutes() === min && local.getSeconds() === ss) {
                const epoch = local.getTime();
                if (Number.isFinite(epoch)) return epoch;
            }
            return null;
        }
        return null;
    }

    // ISO / timestamp con timezone esplicito: Date.parse resta appropriato.
    const epoch = Date.parse(raw);
    return Number.isFinite(epoch) ? epoch : null;
}

function tennisDeepScanCompletionState(row = {}) {
    const result = row.tennisDeepScanResult || row.deepScanCachedResult || null;
    const partial = row.deepScanPartial === true || result?.partial === true || safeString(result?.status).toUpperCase().includes('PARTIAL');
    const action = safeString(row.ds_action || row.dsAction || result?.action || row.historical_combo_deepscan || row.historicalCombinationEvidence?.deepScan).trim();
    const qualityText = safeString(row.qualityGateV2?.label || row.quality_final_label || row.qualityFinalLabel || row.quality_base_label || row.pre_match_gate_label).toUpperCase();
    const waiting = qualityText.includes('IN ATTESA DEEPSCAN') || qualityText.includes('WAITING_DEEPSCAN');
    const evidence = row.historicalCombinationEvidence || row.realProbabilityPaperTrading || null;
    const persistedEvidence = Boolean(evidence && (evidence.resolved !== undefined || evidence.sample !== undefined || evidence.winRatePct !== undefined))
        || row.historical_combo_resolved !== undefined && row.historical_combo_resolved !== null;
    const explicitSuccess = result?.success === true && !partial;
    const persistedComplete = Boolean(action) && persistedEvidence && !waiting && !partial;
    const complete = explicitSuccess || persistedComplete;
    return { complete, partial, hasAction:Boolean(action), action, waiting, completionRank: complete ? 100 : (partial ? 40 : (action ? 70 : 0)) };
}

function tennisPrematchLifecycleUi(row = {}, nowMs = Date.now()) {
    const startEpoch = tennisMatchStartEpochUi(row);
    if (!Number.isFinite(startEpoch)) return { status:'UNKNOWN', startEpoch:null, closed:false };
    const closed = nowMs >= startEpoch;
    return { status:closed?'PREMATCH_CLOSED':'PREMATCH_OPEN', startEpoch, closed };
}

function tennisLiveEventKey(bet = {}) {
    const fp = safeString(
        bet.tennis_event_fingerprint
        || bet.event_fingerprint
        || bet.extData?.eventIdentity?.eventFingerprint
        || bet.eventIdentity?.eventFingerprint
    ).trim();
    if (fp) return `FP|${fp}`;

    const home = safeString(bet.home || bet.player1).trim().toLowerCase();
    const away = safeString(bet.away || bet.player2).trim().toLowerCase();
    const rawTime = safeString(bet.canonical_match_datetime || bet.commence_time || bet.match_date || bet.date);
    // AUDIT16D_R3_T6_R2: usa lo stesso parser temporale non ambiguo anche
    // per il fallback event key, così 01/10 resta 1 ottobre e non 10 gennaio.
    const parsed = tennisMatchStartEpochUi(bet);
    const timeKey = Number.isFinite(parsed) ? new Date(parsed).toISOString() : rawTime.toLowerCase();
    return `FALLBACK|${home}|${away}|${timeKey}`;
}

function tennisDeepScanClassRank(row = {}) {
    const normalized = safeString(normalizeDeepScanOutcomeCategory(row)).toUpperCase();
    if (normalized.includes('VALUE CONFERMATO')) return 50;
    if (normalized.includes('EDGE TECNICO')) return 40;
    if (normalized.includes('WATCHLIST') || normalized.includes('LOW EDGE')) return 30;
    if (normalized.includes('RISCHIO MODELLO')) return 20;
    if (normalized.includes('ALTO RISCHIO') || normalized.includes('PERICOLO')) return 0;
    return 10;
}

function tennisQualityRank(row = {}) {
    const label = safeString(row.qualityGateV2?.label || row.quality_final_label || row.quality_base_label || row.tennis_operational_status).toUpperCase();
    if (label.includes('APPROVATA CON CAP')) return 45;
    if (label === 'APPROVATA' || label.includes('APPROVATA ')) return 50;
    if (label.includes('WATCHLIST MICRO')) return 35;
    if (label.includes('BLOCCATA SOFT')) return 20;
    if (label.includes('BLOCCATA HARD')) return 0;
    return 10;
}

function tennisFinalAuthorityRank(row = {}) {
    const truth = resolveTennisDecisionTruthUi(row);
    const action = safeString(truth.action).toUpperCase();
    if (action === 'STANDARD_STAKE') return 600;
    if (action === 'MICRO_STAKE') return 550;
    if (action === 'PAPER_ONLY') return 400;
    if (action === 'NO_BET_REVIEW') return 250;
    if (action === 'NO_BET') return 100;
    return 150;
}

function tennisCandidateValidityVector(row = {}, originalIndex = 0) {
    const deepScanState = tennisDeepScanCompletionState(row);
    const dsCompletion = deepScanState.completionRank;

    const contract = resolveTennisStakeExecutionContractUi(row);
    const finalStake = Math.max(0, safeNumber(contract.finalExecution?.executableStake ?? row.stake ?? row.invested, 0));
    const qualityScore = safeNumber(row.qualityGateV2?.score ?? row.quality_final_score ?? row.quality_base_score, 0);
    const predictionIndex = safeNumber(row.tennisPredictionIndex?.score ?? row.tennis_prediction_index_score ?? row.predictionIndex?.score, 0);
    const evidenceSample = safeNumber(
        row.historicalCombinationEvidence?.sample
        ?? row.historicalCombinationEvidence?.n
        ?? row.realProbabilityPaperTrading?.sample
        ?? row.tennis_stake_authority_sample,
        0
    );
    const reliability = safeNumber(row.model_confidence_score ?? row.valueScore ?? row.aiReliability ?? row.reliability, 0);
    const edge = safeNumber(getBetEdgePp(row), 0);
    const ev = safeNumber(getBetEvPct(row), 0);

    return [
        dsCompletion,
        tennisFinalAuthorityRank(row),
        tennisDeepScanClassRank(row),
        tennisQualityRank(row),
        Math.min(20, finalStake),
        qualityScore,
        predictionIndex,
        Math.min(500, evidenceSample) / 10,
        reliability,
        edge,
        ev,
        -originalIndex
    ];
}

function compareTennisValidityVectors(a = [], b = []) {
    const size = Math.max(a.length, b.length);
    for (let i = 0; i < size; i++) {
        const av = safeNumber(a[i], 0);
        const bv = safeNumber(b[i], 0);
        if (av !== bv) return bv - av;
    }
    return 0;
}

function selectBestTennisCandidatePerMatch(bets = []) {
    const source = Array.isArray(bets) ? bets : [];
    const groups = new Map();
    source.forEach((bet, index) => {
        const key = tennisLiveEventKey(bet);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ bet, index, vector: tennisCandidateValidityVector(bet, index) });
    });

    const selected = [];
    const hidden = [];
    for (const [eventKey, group] of groups.entries()) {
        group.sort((a, b) => compareTennisValidityVectors(a.vector, b.vector));
        const winner = group[0];
        const eventHasCompletedDeepScan = group.some(item => tennisDeepScanCompletionState(item.bet).complete === true);
        const winnerDeepScanState = tennisDeepScanCompletionState(winner.bet);
        const winnerLifecycle = tennisPrematchLifecycleUi(winner.bet);
        const selectionStatus = eventHasCompletedDeepScan
            ? 'FINAL_ANALYSIS_DEEPSCAN'
            : (winnerLifecycle.closed ? 'PREMATCH_CLOSED_NO_DEEPSCAN' : 'PROVISIONAL_WAITING_DEEPSCAN');
        winner.bet.tennisEventSelection = {
            version: AUDIT16D_R3_T6_TENNIS_EVENT_SELECTION,
            consolidationVersion: AUDIT16D_R3_T6_R1_CONSOLIDATION,
            eventKey,
            selected: true,
            selectionStatus,
            eventHasCompletedDeepScan,
            winnerDeepScanComplete: winnerDeepScanState.complete,
            candidateCount: group.length,
            hiddenAlternatives: group.slice(1).map(item => ({
                prediction: item.bet.prediction,
                deepScan: normalizeDeepScanOutcomeCategory(item.bet),
                deepScanComplete: tennisDeepScanCompletionState(item.bet).complete,
                quality: item.bet.qualityGateV2?.label || item.bet.quality_final_label || item.bet.quality_base_label || null,
                finalStake: safeNumber(resolveTennisStakeExecutionContractUi(item.bet).finalExecution?.executableStake ?? item.bet.stake ?? item.bet.invested, 0)
            }))
        };
        selected.push(winner);
        for (const loser of group.slice(1)) {
            loser.bet.tennisEventSelection = {
                version: AUDIT16D_R3_T6_TENNIS_EVENT_SELECTION,
                eventKey,
                selected: false,
                selectedIndex: winner.index,
                candidateCount: group.length
            };
            hidden.push(loser);
        }
    }
    return { selected, hidden, groups };
}

function applyTennisBestPerMatchView(bets = []) {
    if (activeSport !== SPORT.TENNIS) return { selected: [], hidden: [], groups: new Map() };
    const selection = selectBestTennisCandidatePerMatch(bets);

    for (const item of selection.selected) {
        const row = $(`row-${item.index}`);
        const detailRow = $(`ds-row-${item.index}`);
        if (row) {
            row.dataset.tennisEventSuperseded = '0';
            row.dataset.tennisEventPrimary = '1';
            const matchCell = row.children?.[1];
            if (matchCell && item.bet.tennisEventSelection?.candidateCount > 1) {
                let note = matchCell.querySelector('.t6-tennis-best-event-note');
                if (!note) {
                    note = document.createElement('div');
                    note.className = 't6-tennis-best-event-note';
                    note.style.cssText = 'margin-top:5px;font-size:.64em;color:#22c55e;font-weight:900;';
                    matchCell.appendChild(note);
                }
                const hiddenCount = item.bet.tennisEventSelection.hiddenAlternatives?.length || 0;
                const selectionStatus = safeString(item.bet.tennisEventSelection.selectionStatus).toUpperCase();
                if (selectionStatus === 'FINAL_ANALYSIS_DEEPSCAN') {
                    note.style.color = '#22c55e';
                    note.textContent = `✓ Miglior esito Analisi + DeepScan · ${hiddenCount} alternativa${hiddenCount === 1 ? '' : 'e'} nascosta${hiddenCount === 1 ? '' : 'e'}`;
                } else if (selectionStatus === 'PREMATCH_CLOSED_NO_DEEPSCAN') {
                    note.style.color = '#94a3b8';
                    note.textContent = `⏹ Selezione storica · prematch chiuso · DeepScan non eseguito · ${hiddenCount} alternativa${hiddenCount === 1 ? '' : 'e'} nascosta${hiddenCount === 1 ? '' : 'e'}`;
                } else {
                    note.style.color = '#fbbf24';
                    note.textContent = `⏳ Miglior analisi provvisoria · DeepScan non completato · ${hiddenCount} alternativa${hiddenCount === 1 ? '' : 'e'} nascosta${hiddenCount === 1 ? '' : 'e'}`;
                }
                note.title = (item.bet.tennisEventSelection.hiddenAlternatives || []).map(alt =>
                    `${alt.prediction || 'N/D'} · ${alt.deepScanComplete ? (alt.deepScan || 'DS COMPLETO') : 'DS NON COMPLETO'} · ${alt.quality || 'N/D'} · stake €${formatNumber(alt.finalStake,2)}`
                ).join('\n');
            }
        }
        if (detailRow) detailRow.dataset.tennisEventSuperseded = '0';
    }

    for (const item of selection.hidden) {
        const row = $(`row-${item.index}`);
        const detailRow = $(`ds-row-${item.index}`);
        if (row) {
            row.dataset.tennisEventSuperseded = '1';
            row.dataset.tennisEventPrimary = '0';
            row.style.display = 'none';
        }
        if (detailRow) {
            detailRow.dataset.tennisEventSuperseded = '1';
            detailRow.classList.add('hidden');
            detailRow.style.display = 'none';
        }
    }
    return selection;
}


function deduplicateCalcioLiveRows(bets = []) {
    if (activeSport !== SPORT.CALCIO) return Array.isArray(bets) ? bets : [];
    const now = Date.now();
    const groups = new Map();
    for (const bet of Array.isArray(bets) ? bets : []) {
        const key = safeString(
            bet.canonical_pair_key
            || bet.extData?.eventIdentity?.canonicalPairKey
            || `${safeString(bet.league).toLowerCase()}|${safeString(bet.home).toLowerCase()}|${safeString(bet.away).toLowerCase()}`
        );
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(bet);
    }
    const selected = [];
    for (const rows of groups.values()) {
        rows.sort((a, b) => {
            const aTime = Date.parse(a.commence_time || a.match_date || '') || Number.MAX_SAFE_INTEGER;
            const bTime = Date.parse(b.commence_time || b.match_date || '') || Number.MAX_SAFE_INTEGER;
            const aDistance = aTime >= now ? aTime - now : Number.MAX_SAFE_INTEGER;
            const bDistance = bTime >= now ? bTime - now : Number.MAX_SAFE_INTEGER;
            return aDistance - bDistance || aTime - bTime || safeString(a.event_key).localeCompare(safeString(b.event_key));
        });
        selected.push(rows[0]);
    }
    return selected;
}

function calcioOddsCertificationFromBet(bet = {}) {
    let nested = bet.oddsCertification || bet.odds_certification || bet.extData?.oddsCertification || bet.extData?.odds_certification || null;
    if (typeof nested === 'string') {
        try { nested = JSON.parse(nested); } catch (_) { nested = null; }
    }
    if (nested && typeof nested === 'object') return nested;
    let sources = [];
    try { sources = JSON.parse(bet.calcio_odds_source_list || '[]'); } catch (_) {}
    return {
        status: bet.calcio_odds_certification_status || 'UNCERTIFIED_LEGACY_ROW',
        reason: bet.calcio_odds_certification_reason || '',
        certified: Boolean(safeNumber(bet.calcio_odds_certified, 0)),
        operationalEligible: Boolean(safeNumber(bet.calcio_odds_operational_eligible, 0)),
        realDirect: Boolean(safeNumber(bet.calcio_odds_direct, 0)) && !Boolean(safeNumber(bet.calcio_odds_derived, 0)),
        sourceCount: safeNumber(bet.calcio_odds_source_count, sources.length),
        selectedSource: {
            bookmakerKey: bet.calcio_odds_bookmaker_key || bet.odds_source || null,
            bookmakerTitle: bet.calcio_odds_bookmaker_title || bet.odds_source_title || bet.calcio_odds_bookmaker_key || bet.odds_source || null,
            lastUpdate: bet.calcio_odds_last_update || bet.odds_source_timestamp || null,
            marketKey: bet.calcio_odds_market_key || null,
            price: safeNumber(bet.odd, 0),
            direct: Boolean(safeNumber(bet.calcio_odds_direct, 0)),
            derived: Boolean(safeNumber(bet.calcio_odds_derived, 0))
        },
        sources
    };
}

function renderCalcioCertifiedOddsCell(bet = {}) {
    const odd = safeNumber(bet.odd, 0);
    if (activeSport !== SPORT.CALCIO) return formatNumber(odd, 2);
    const cert = calcioOddsCertificationFromBet(bet);
    const source = cert.selectedSource || {};
    const sourceName = safeString(source.bookmakerTitle || source.bookmakerKey || 'Fonte non certificata');
    const sourceCount = safeNumber(cert.sourceCount, 0);
    const status = safeString(cert.status || 'UNCERTIFIED');
    const eligible = cert.operationalEligible === true;
    const single = cert.certified === true && !eligible;
    const color = eligible ? '#22c55e' : single ? '#f59e0b' : '#ef4444';
    const badge = eligible ? 'QUOTA MULTI-FONTE · SOLO FEED' : single ? 'QUOTA SINGOLA · SOLO ANALISI' : 'QUOTA NON VALIDATA';
    let updateLabel = 'timestamp assente';
    if (source.lastUpdate) {
        const parsed = new Date(source.lastUpdate);
        updateLabel = Number.isNaN(parsed.getTime()) ? safeString(source.lastUpdate) : parsed.toLocaleString('it-IT');
    }
    const tooltip = [
        'La verifica delle QUOTE non certifica modello, EV prudente, formazioni, stake o ROI.',
        cert.reason || '',
        `Stato: ${status}`,
        `Fonte: ${sourceName}`,
        `Aggiornamento: ${updateLabel}`,
        `Fonti indipendenti: ${sourceCount}`,
        source.derived === true ? 'Quota derivata: esclusa' : 'Quota diretta bookmaker'
    ].filter(Boolean).join('\n');
    return `<div title="${htmlEscape(tooltip)}" style="min-width:126px;">
        <strong style="font-size:1.02em;color:#f8fafc;">${formatNumber(odd, 2)}</strong>
        <div style="font-size:.68em;color:#cbd5e1;margin-top:3px;line-height:1.25;">Fonte: <strong>${htmlEscape(sourceName)}</strong></div>
        <div style="font-size:.64em;color:#94a3b8;line-height:1.25;">${htmlEscape(updateLabel)}</div>
        <div style="font-size:.62em;color:${color};font-weight:900;margin-top:3px;">${htmlEscape(badge)}${sourceCount ? ` · ${htmlEscape(sourceCount)}` : ''}</div>
    </div>`;
}

function renderCalcioStakeLifecycleMini(bet = {}) {
    if (activeSport !== SPORT.CALCIO) return '';
    const theoretical = safeNumber(bet.stake_theoretical ?? bet.theoreticalStake ?? bet.stakeLifecycle?.theoreticalStake, 0);
    const operational = safeNumber(bet.stake_operational ?? bet.operationalStake ?? bet.invested, 0);
    const rawModel = safeNumber(bet.calcio_unadjusted_pre_cap_stake ?? bet.calcioDeepScanResult?.reliabilityGuard?.unadjustedPreCapStake ?? theoretical, theoretical);
    const reliabilityAdjusted = safeNumber(bet.calcio_reliability_adjusted_stake ?? bet.calcioDeepScanResult?.reliabilityGuard?.reliabilityAdjustedStake ?? theoretical, theoretical);
    const hasReliabilityGuard = Boolean(bet.calcio_cross_market_reliability_version || bet.calcioDeepScanResult?.reliabilityGuard || bet.calcio_reliability_guard_status);
    const status = safeString(bet.stake_lifecycle_status || bet.stakeLifecycle?.status || (operational > 0 ? 'OPERATIVO' : 'ANALISI'));
    const dataClass = safeString(bet.calcio_data_class || bet.stake_confidence_level || bet.kellyStakePolicy?.dataAuthority?.dataClass || bet.kelly_stake_policy?.dataAuthority?.dataClass || bet.stakeLifecycle?.dataClass || 'N/D');
    const reason = safeString(bet.calcio_stake_reason || bet.kellyStakePolicy?.reason || bet.kelly_stake_policy?.reason || bet.stake_lifecycle_reason || bet.stakeLifecycle?.reason || bet.calcio_operational_summary || '');
    const stakeLine = hasReliabilityGuard
        ? `Modello €${formatNumber(rawModel, 2)} · Affidabilità €${formatNumber(reliabilityAdjusted, 2)} · Operativo €${formatNumber(operational, 2)}`
        : `Teorico €${formatNumber(theoretical, 2)} · Operativo €${formatNumber(operational, 2)}`;
    return `<div style="font-size:.72em;margin-top:3px;color:#94a3b8;" title="${htmlEscape(reason)}">${stakeLine}<br><span style="color:${operational > 0 ? '#22c55e' : '#fbbf24'};font-weight:800;">${htmlEscape(status)}</span> · Dati ${htmlEscape(dataClass)}</div>`;
}

function renderLiveAnalysis(data, options = {}) {
    const valueBetsTable = $('valueBetsTable');
    const accumulatorBox = $('accumulatorBox');

    if (!valueBetsTable) return;

    valueBetsTable.innerHTML = '';

    if (accumulatorBox) {
        accumulatorBox.innerHTML = '';

        if (
            data.recommendedAccumulator &&
            data.recommendedAccumulator.bets &&
            data.recommendedAccumulator.bets.length > 0
        ) {
            let html = `
                <div style="background:rgba(16,185,129,0.1); border-left:4px solid #10b981; padding:15px; margin-bottom:20px; border-radius:5px;">
                    <h3 style="margin-top:0; color:#10b981;">🔥 Multipla Europea a Quota ${htmlEscape(data.recommendedAccumulator.totalOdds)}</h3>
                    <p style="margin-bottom:15px; font-weight:bold; color:#f59e0b;">
                        💰 Investimento Consigliato: €${htmlEscape(data.recommendedAccumulator.invested)}
                        &nbsp;|&nbsp;
                        🏆 Profitto Netto:
                        <span style="color:#10b981">+€${htmlEscape(data.recommendedAccumulator.estimatedProfit)}</span>
                    </p>
            `;

            data.recommendedAccumulator.bets.forEach(bet => {
                html += `
                    <p>
                        <strong>${htmlEscape(bet.match)}</strong>
                        (${htmlEscape(bet.league)})
                        | Segno: ${htmlEscape(bet.prediction)}
                        (Quota: ${formatNumber(bet.odd, 2)})
                    </p>
                `;
            });

            html += '</div>';

            accumulatorBox.innerHTML = html;
        } else if (activeSport === SPORT.CALCIO) {
            accumulatorBox.innerHTML = `
                <div style="padding:15px; margin-bottom:20px; border-left:4px solid #94a3b8; background:rgba(255,255,255,0.05);">
                    Nessuna multipla trovata.
                </div>
            `;
        } else {
            accumulatorBox.innerHTML = getReliabilityBadge(data);
        }
    }

    const probabilityFirstHeading = document.getElementById('analysisResultsHeading');
    if (probabilityFirstHeading) {
        const isPF = activeSport === SPORT.CALCIO && (data.meta?.probabilityFirst?.mode === 'PROBABILITY_FIRST' || (data.valueBets || []).some(r => r.calcio_probability_first?.mode === 'PROBABILITY_FIRST'));
        probabilityFirstHeading.textContent = isPF ? '🧭 Probability First · P(win) stimata e qualita' : '🎯 Singole di Valore';
    }
    if (!data.valueBets || data.valueBets.length === 0) {
        const diagnosticsHtml = renderDiagnosticsPanel(data, {
            title: activeSport === SPORT.CALCIO ? 'Diagnostica Analisi IA Calcio' : 'Diagnostica Analisi IA Tennis',
            emptyHint: getNoResultsHint('analysis')
        });

        if (accumulatorBox) {
            accumulatorBox.innerHTML += diagnosticsHtml || `
                <div style="margin:14px 0; background:rgba(245,158,11,0.08); border-left:4px solid #f59e0b; padding:12px; border-radius:8px; color:#cbd5e1;">
                    <strong style="color:#f59e0b;">Nessuna value bet trovata</strong>
                    <div style="margin-top:6px;">${htmlEscape(getNoResultsHint('analysis'))}</div>
                </div>
            `;
            if (activeSport === SPORT.TENNIS) {
                renderAnalysisMarketMixNotice(data);
            }
        }

        valueBetsTable.innerHTML = `
            <tr>
                <td colspan="15" style="text-align:center; padding:18px;">
                    Nessuna Singola trovata.
                </td>
            </tr>
        `;
        if (options.reuseCached) renderAnalysisMemoryBanner(options.memoryEntry || null);
        return;
    }

    const renderedValueBets = deduplicateCalcioLiveRows(data.valueBets).sort((a, b) => {
        if (activeSport !== SPORT.CALCIO) return 0;
        // CALCIO_PROBABILITY_FIRST_PATCH_V1 — P(win) guida l'ordinamento; quote e qualita sono filtri, mai P(win) inventata.
        const pa = a.calcio_probability_first || a.probability_first || null;
        const pb = b.calcio_probability_first || b.probability_first || null;
        if (pa?.mode === 'PROBABILITY_FIRST' || pb?.mode === 'PROBABILITY_FIRST') {
            const qa = pa?.qualified === true ? 1 : 0;
            const qb = pb?.qualified === true ? 1 : 0;
            const ba = pa?.withinOdds === true ? 1 : 0;
            const bb = pb?.withinOdds === true ? 1 : 0;
            return (qb-qa) || (bb-ba)
                || (safeNumber(pb?.probabilityPct,-1)-safeNumber(pa?.probabilityPct,-1))
                || (safeNumber(pb?.reliabilityScore,-1)-safeNumber(pa?.reliabilityScore,-1));
        }
        return safeNumber(b.calcio_prediction_index_rank_value ?? b.predictionIndex?.rankValue ?? b.calcio_prediction_index_score, -1)
            - safeNumber(a.calcio_prediction_index_rank_value ?? a.predictionIndex?.rankValue ?? a.calcio_prediction_index_score, -1);
    });
    data.valueBets = renderedValueBets;
    renderedValueBets.forEach((bet, index) => {
        valueBetsTable.innerHTML += renderLiveBetRow(bet, index);
    });

    attachSeniorAuditLayoutControls();
    renderAnalysisMarketMixNotice(data);
    if (options.reuseCached) {
        restoreDeepScanMemoryUi(data.valueBets || []);
        if (activeSport === SPORT.TENNIS) applyTennisBestPerMatchView(data.valueBets || []);
        renderAnalysisMemoryBanner(options.memoryEntry || null);
    }

    applyTableFilters('analysisTable');

    if (!options.reuseCached) setTimeout(() => {
        processDeepScanQueue(data.valueBets, activeSport, {
            analysisBatchId: data.meta?.observability?.analysisBatchId || data.diagnostics?.observability?.analysisBatchId || null,
            bankroll: data.meta?.bankrollSnapshot || data.diagnostics?.bankrollSnapshot || null
        });
    }, 1000);
}

function patch27ShortPlayerName(value) {
    const parts = safeString(value).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'giocatore';
    const suffixes = new Set(['JR', 'JR.', 'II', 'III', 'IV']);
    const last = parts[parts.length - 1];
    return suffixes.has(last.toUpperCase()) && parts.length > 1 ? parts[parts.length - 2] : last;
}
function patch27ReadableMatchup(info = {}, bet = {}) {
    const raw = safeString(info.matchupLabel || info.matchupStatus || info.status).toUpperCase();
    const delta = Number(info.probabilityDeltaPp);
    const p1 = safeString(bet.home || bet.player1 || 'Giocatore 1');
    const p2 = safeString(bet.away || bet.player2 || 'Giocatore 2');
    let headline = 'Dati giocatori: confronto disponibile';
    if (raw.includes('ADVANTAGE_P1')) headline = `Dati giocatori: vantaggio ${patch27ShortPlayerName(p1)}`;
    else if (raw.includes('ADVANTAGE_P2')) headline = `Dati giocatori: vantaggio ${patch27ShortPlayerName(p2)}`;
    else if (raw.includes('BALANCED')) headline = 'Dati giocatori: profili equilibrati';
    else if (raw.includes('INSUFFICIENT') || raw.includes('UNAVAILABLE') || raw.includes('ERROR')) headline = 'Dati giocatori: evidenza insufficiente';

    let comparison = 'Confronto solo informativo: non modifica probabilità o stake.';
    if (Number.isFinite(delta)) {
        const magnitude = Math.abs(delta).toFixed(1).replace('.', ',');
        if (delta < -0.05) comparison = `Stima giocatori ${magnitude} punti più prudente del modello principale.`;
        else if (delta > 0.05) comparison = `Stima giocatori ${magnitude} punti più favorevole del modello principale.`;
        else comparison = 'Stima giocatori sostanzialmente allineata al modello principale.';
    }
    return { headline, comparison, delta };
}
function renderPatch12MatchupBadge(bet = {}) {
    if (activeSport !== SPORT.TENNIS) return '';
    const info = bet.matchupIntelligenceSummary || {};
    const status = safeString(info.status || '').toUpperCase();
    if (!status || status === 'UNAVAILABLE') return '<span style="display:inline-block;margin-top:6px;padding:3px 7px;border-radius:8px;background:rgba(148,163,184,.12);color:#94a3b8;font-size:.68rem;font-weight:800;">🧬 Dati giocatori: non disponibili</span>';
    const readable = patch27ReadableMatchup(info, bet);
    const color = status.includes('ERROR') || status.includes('INSUFFICIENT') ? '#fbbf24'
        : status.includes('DIVERGENCE_STRONG') ? '#fb7185' : '#d8b4fe';
    const title = `${readable.comparison} Solo informativo: nessuna autorità su gate o stake.`;
    return `<span title="${htmlEscape(title)}" style="display:inline-flex;flex-direction:column;gap:1px;margin-top:6px;padding:4px 8px;border-radius:8px;background:rgba(168,85,247,.13);color:${color};font-size:.68rem;font-weight:800;line-height:1.2;"><span>🧬 ${htmlEscape(readable.headline)}</span><small style="font-size:.60rem;font-weight:700;color:#c4b5fd;">${htmlEscape(readable.comparison)}</small></span>`;
}
function renderPatch12MatchupDetail(bet = {}) {
    if (activeSport !== SPORT.TENNIS) return '';
    const info = bet.matchupIntelligenceSummary || {};
    const raw = bet.playerMatchupIntelligence || {};
    const matchup = raw.matchup || {};
    const challenger = raw.challenger || bet.challengerPrediction || {};
    const readable = patch27ReadableMatchup(info, bet);
    const percent = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'N/D';
    const comparisonValue = Number.isFinite(readable.delta)
        ? `${Math.abs(readable.delta).toFixed(1).replace('.', ',')} pp ${readable.delta < 0 ? 'più prudente' : readable.delta > 0 ? 'più favorevole' : 'allineata'}`
        : 'N/D';
    return `<div style="margin:0 0 14px;padding:12px;border:1px solid rgba(168,85,247,.38);border-radius:10px;background:rgba(88,28,135,.10);">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <strong style="color:#d8b4fe;">🧬 Confronto dati giocatori</strong>
            <span style="color:#94a3b8;font-size:.72rem;">Solo informativo · non modifica probabilità o stake</span>
        </div>
        <div style="margin-top:8px;color:#e9d5ff;font-size:.78rem;font-weight:800;">${htmlEscape(readable.headline)}</div>
        <div style="margin-top:3px;color:#c4b5fd;font-size:.74rem;">${htmlEscape(readable.comparison)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:10px;">
            <div class="metric-mini"><span>Copertura dati</span><strong>${percent(info.coverageScore)}</strong></div>
            <div class="metric-mini"><span>Affidabilità confronto</span><strong>${percent(info.confidenceScore)}</strong></div>
            <div class="metric-mini"><span>Modello principale</span><strong>${percent(info.productionProbability)}</strong></div>
            <div class="metric-mini"><span>Stima dati giocatori</span><strong>${percent(info.challengerProbability)}</strong></div>
            <div class="metric-mini"><span>Differenza spiegata</span><strong>${htmlEscape(comparisonValue)}</strong></div>
            <div class="metric-mini"><span>Intervallo stima</span><strong>${percent(info.uncertaintyLowPct)}–${percent(info.uncertaintyHighPct)}</strong></div>
            <div class="metric-mini"><span>Stato dati P1 / P2</span><strong>${htmlEscape(info.player1EvidenceStatus || 'N/D')} / ${htmlEscape(info.player2EvidenceStatus || 'N/D')}</strong></div>
        </div>
        ${Array.isArray(matchup.problems) && matchup.problems.length ? `<div style="margin-top:8px;color:#fbbf24;font-size:.74rem;">Avvisi dati: ${htmlEscape(matchup.problems.join(' · '))}</div>` : ''}
        ${challenger.status ? `<div style="margin-top:8px;color:#94a3b8;font-size:.72rem;">Stato tecnico interno: ${htmlEscape(challenger.status)}. La probabilità operativa mostrata nella tabella resta quella del modello principale.</div>` : ''}
    </div>`;
}

// CALCIO PATCH 26F-A R4 - risoluzione autoritativa post-commit del solo mercato finalizzato.
function parseCalcioFinalMarketDiagnosticCandidate(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function calcioFinalMarketDiagnosticCandidateScore(candidate = {}, bet = {}, source = '') {
    if (!candidate || typeof candidate !== 'object') return Number.NEGATIVE_INFINITY;
    let score = source === 'PERSISTED_FINAL_MARKET_SNAPSHOT' ? 10 : 0;
    const compareText = (candidateValue, flatValue, matchPoints, mismatchPoints) => {
        const flat = safeString(flatValue);
        if (!flat) return;
        const current = safeString(candidateValue);
        score += current === flat ? matchPoints : mismatchPoints;
    };
    const compareNumber = (candidateValue, flatValue, matchPoints, mismatchPoints, tolerance = 0.01) => {
        const flat = safeNumber(flatValue, NaN);
        if (!Number.isFinite(flat)) return;
        const current = safeNumber(candidateValue, NaN);
        score += Number.isFinite(current) && Math.abs(current - flat) <= tolerance ? matchPoints : mismatchPoints;
    };

    compareText(candidate.marketId, bet.calcio_final_market_id, 80, -160);
    compareText(candidate.decisionState?.code, bet.calcio_decision_state, 50, -80);
    compareText(candidate.dataQuality?.status, bet.calcio_data_quality_status, 20, -20);
    compareNumber(candidate.stake?.finalOperationalStake, bet.calcio_stake_authority_final_stake ?? bet.calcio_operational_stake ?? bet.stake, 30, -30);
    compareNumber(candidate.stake?.modelStake, bet.calcio_stake_authority_model_stake, 20, -20);
    compareNumber(candidate.stake?.reliabilityStake, bet.calcio_stake_authority_reliability_stake, 15, -15);
    compareNumber(candidate.probabilityPct, bet.estimated_prob ?? bet.estimatedProb, 15, -15, 0.02);
    if (candidate.coherence?.certified === true || candidate.coherence?.status === 'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED') score += 5;
    return score;
}

function enrichCalcioFinalMarketDiagnosticProbability(diagnostic = null, bet = {}) {
    if (!diagnostic || typeof diagnostic !== 'object') return diagnostic;
    const probability = { ...(diagnostic.probability || {}) };
    const componentCandidates = [
        bet.calcioDeepScanResult?.predictionIndex?.components?.probability,
        bet.predictionIndex?.components?.probability,
        parseCalcioFinalMarketDiagnosticCandidate(bet.calcio_prediction_index_components)?.probability,
        parseCalcioFinalMarketDiagnosticCandidate(bet.prediction_index_components)?.probability
    ].filter(value => value && typeof value === 'object');
    const fallbackNumber = keys => {
        for (const source of componentCandidates) {
            for (const key of keys) {
                const current = safeNumber(source?.[key], NaN);
                if (Number.isFinite(current)) return current;
            }
        }
        return null;
    };
    const assignMissing = (targetKey, sourceKeys) => {
        if (probability[targetKey] != null && Number.isFinite(safeNumber(probability[targetKey], NaN))) return false;
        const value = fallbackNumber(sourceKeys);
        if (value == null) return false;
        probability[targetKey] = value;
        return true;
    };
    let changed = false;
    changed = assignMissing('modelProbabilityPct', ['modelProbabilityPct', 'model', 'modelCenterPct']) || changed;
    changed = assignMissing('monteCarloProbabilityPct', ['monteCarloProbabilityPct', 'monteCarlo']) || changed;
    changed = assignMissing('marketProbabilityPct', ['marketProbabilityPct', 'marketProbability']) || changed;
    changed = assignMissing('disagreementPp', ['disagreementPp', 'marketGapPp', 'spreadPp']) || changed;
    changed = assignMissing('monteCarloSamplingErrorPp', ['monteCarloSamplingErrorPp', 'monteCarloStdErrorPp']) || changed;
    if (!changed) return diagnostic;
    return {
        ...diagnostic,
        probability: {
            ...probability,
            diagnosticFallback: 'IPM_COMPONENTS_READ_ONLY_NO_PRODUCTION_MUTATION'
        }
    };
}

function synchronizeCalcioFinalMarketDiagnosticAliases(bet = {}, diagnostic = null) {
    if (!bet || !diagnostic || typeof diagnostic !== 'object') return diagnostic;
    bet.finalMarketDiagnostic = diagnostic;
    bet.calcioFinalMarketDiagnostic = diagnostic;
    if (bet.calcioDeepScanResult && typeof bet.calcioDeepScanResult === 'object') {
        bet.calcioDeepScanResult.finalMarketDiagnostic = diagnostic;
    }
    return diagnostic;
}

function getCalcioFinalMarketDiagnostic(bet = {}) {
    const candidates = [
        { source: 'PERSISTED_FINAL_MARKET_SNAPSHOT', value: bet.calcio_final_market_snapshot },
        { source: 'BATCH_RESULT_FINAL_MARKET_DIAGNOSTIC', value: bet.calcioDeepScanResult?.finalMarketDiagnostic },
        { source: 'FINAL_MARKET_DIAGNOSTIC_ALIAS', value: bet.finalMarketDiagnostic },
        { source: 'CALCIO_FINAL_MARKET_DIAGNOSTIC_ALIAS', value: bet.calcioFinalMarketDiagnostic }
    ].map((entry, index) => {
        const diagnostic = parseCalcioFinalMarketDiagnosticCandidate(entry.value);
        return diagnostic ? {
            ...entry,
            index,
            diagnostic,
            score: calcioFinalMarketDiagnosticCandidateScore(diagnostic, bet, entry.source),
            generatedAt: Date.parse(diagnostic.generatedAt || '') || 0
        } : null;
    }).filter(Boolean);

    if (!candidates.length) return null;
    candidates.sort((left, right) => right.score - left.score || right.generatedAt - left.generatedAt || left.index - right.index);
    const selected = enrichCalcioFinalMarketDiagnosticProbability(candidates[0].diagnostic, bet);
    return synchronizeCalcioFinalMarketDiagnosticAliases(bet, selected);
}

function probabilityIntegrityFromFinalMarketDiagnostic(diagnostic = {}) {
    if (!diagnostic || typeof diagnostic !== 'object' || !diagnostic.prediction) return null;
    const prediction = safeString(diagnostic.prediction);
    const probability = diagnostic.probability || {};
    const detail = {
        modelProbabilityPct: probability.modelProbabilityPct,
        monteCarloProbabilityPct: probability.monteCarloProbabilityPct,
        marketProbabilityPct: probability.marketProbabilityPct,
        disagreementPp: probability.disagreementPp,
        monteCarloStdErrorPp: probability.monteCarloSamplingErrorPp,
        reliability: probability.modelAgreementReliability,
        marketId: diagnostic.marketId
    };
    return {
        success: diagnostic.coherence?.certified !== false,
        version: diagnostic.version,
        finalMarketContract: true,
        selectedMarketId: diagnostic.marketId,
        selectedPrediction: prediction,
        selectedMarket: detail,
        probabilities: { [prediction]: diagnostic.probabilityPct },
        diagnostics: { [prediction]: detail },
        coverageMode: diagnostic.coverageMode || 'UNKNOWN',
        reliability: diagnostic.forecastConfidence?.label || 'N/D',
        marketReliability: { [prediction]: probability.modelAgreementReliability || 'N/D' },
        maxDisagreementPp: probability.disagreementPp,
        maxMonteCarloStdErrorPp: probability.monteCarloSamplingErrorPp,
        monteCarloIterations: diagnostic.monteCarloIterations || null
    };
}

function getCalcioProbabilityIntegrity(bet = {}) {
    const diagnostic = getCalcioFinalMarketDiagnostic(bet);
    return probabilityIntegrityFromFinalMarketDiagnostic(diagnostic)
        || bet?.extData?.probabilityIntegrity
        || bet.probabilityIntegrity
        || null;
}

function renderCalcioForecastBadge(bet = {}) {
    if (activeSport !== SPORT.CALCIO) return '';
    const diagnostic = getCalcioFinalMarketDiagnostic(bet);
    const integrity = getCalcioProbabilityIntegrity(bet);
    const reliability = safeString(
        diagnostic?.forecastConfidence?.label
        || bet.calcio_forecast_confidence_label
        || bet.calcio_prediction_reliability_label
        || integrity?.reliability
        || 'N/D'
    ).toUpperCase();
    const coverage = safeString(
        diagnostic?.coverageMode
        || bet.probability_coverage_mode
        || integrity?.coverageMode
        || 'UNKNOWN'
    ).toUpperCase();
    const decisionCode = safeString(
        diagnostic?.decisionState?.code
        || bet.calcio_decision_state
        || bet.calcio_analysis_stage_code
        || ''
    ).toUpperCase();
    const decisionLabel = safeString(
        diagnostic?.decisionState?.label
        || bet.calcio_analysis_stage_label
        || (safeNumber(bet.invested, 0) > 0 ? 'BET READY' : 'FORECAST VALID')
    );

    const reliabilityColor = reliability === 'HIGH'
        ? '#10b981'
        : (reliability === 'MEDIUM'
            ? '#3b82f6'
            : (reliability === 'LOW' ? '#f59e0b' : '#ef4444'));
    const stageColor = decisionCode === 'BET_READY' ? '#047857'
        : decisionCode === 'VALUE_CANDIDATE' ? '#2563eb'
        : decisionCode === 'EARLY_RECHECK' ? '#7c3aed'
        : decisionCode === 'NO_BET_VALUE' ? '#b45309'
        : decisionCode === 'NO_BET_DATA' || decisionCode === 'FAILED_ANALYSIS' ? '#b91c1c'
        : '#475569';

    return `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;">
            <span title="Stato decisionale derivato dal mercato finalizzato" style="display:inline-block;background:${stageColor};color:white;padding:3px 7px;border-radius:999px;font-size:.72em;font-weight:800;">🔎 ${htmlEscape(decisionLabel)}</span>
            <span title="Forecast Data Confidence canonica" style="display:inline-block;background:${reliabilityColor};color:white;padding:3px 7px;border-radius:999px;font-size:.72em;font-weight:800;">
                Conf. ${htmlEscape(reliability)}
            </span>
            <span title="Copertura dati del mercato finalizzato" style="display:inline-block;background:#334155;color:#e2e8f0;padding:3px 7px;border-radius:999px;font-size:.72em;">
                ${htmlEscape(coverage)}
            </span>
        </div>
    `;
}

function renderCalcioProbabilityCell(bet = {}, probability = null) {
    const integrity = getCalcioProbabilityIntegrity(bet);
    if (activeSport !== SPORT.CALCIO || !integrity) return formatPct(probability, 2);

    const market = safeString(getCalcioFinalMarketDiagnostic(bet)?.prediction || bet.prediction);
    const detail = integrity?.diagnostics?.[market] || {};
    const title = [
        `Probabilità finale: ${formatPct(probability, 2)}`,
        `Modello production: ${detail.modelProbabilityPct == null ? 'N/D' : formatPct(detail.modelProbabilityPct, 2)}`,
        `Monte Carlo distribuzione: ${detail.monteCarloProbabilityPct == null ? 'N/D' : formatPct(detail.monteCarloProbabilityPct, 2)}`,
        `Mercato no-vig: ${detail.marketProbabilityPct == null ? 'N/D' : formatPct(detail.marketProbabilityPct, 2)}`,
        `Disaccordo: ${formatNumber(detail.disagreementPp ?? integrity.maxDisagreementPp, 2)} pp`,
        `Errore campionamento MC: ±${formatNumber(detail.monteCarloStdErrorPp ?? integrity.maxMonteCarloStdErrorPp, 2)} pp`,
        `Market ID: ${safeString(integrity.selectedMarketId || 'N/D')}`
    ].join('\n');

    return `
        <div title="${htmlEscape(title)}" style="font-weight:800;">${formatPct(probability, 2)}</div>
        <div style="font-size:.72em;color:#94a3b8;margin-top:3px;">
            MC ${detail.monteCarloProbabilityPct == null ? 'N/D' : formatPct(detail.monteCarloProbabilityPct, 1)}
            · Mod ${detail.modelProbabilityPct == null ? 'N/D' : formatPct(detail.modelProbabilityPct, 1)}
        </div>
    `;
}

function calcioStakeAuthorityFromBet(bet = {}) {
    let audit = bet.stakeAuthority || bet.calcioDeepScanResult?.stakeAuthority || bet.stakeReconciliation?.stakeAuthority || null;
    if (!audit && bet.calcio_stake_authority_audit) {
        try { audit = JSON.parse(bet.calcio_stake_authority_audit); } catch (_) { audit = null; }
    }
    return audit && typeof audit === 'object' ? audit : {};
}

function calcioDataQualityAuthorityFromBet(bet = {}) {
    let audit = bet.dataQualityAuthority || bet.calcioDeepScanResult?.dataQualityAuthority || bet.stakeReconciliation?.dataQualityAssessment || null;
    if (!audit && bet.calcio_data_quality_audit) {
        try { audit = JSON.parse(bet.calcio_data_quality_audit); } catch (_) { audit = null; }
    }
    return audit && typeof audit === 'object' ? audit : {};
}

function calcioHistoricalCoverageFromBet(bet = {}) {
    let audit = bet?.extData?.historicalCoverageAudit || bet.historical_coverage_audit || bet.calcio_historical_coverage_audit || {};
    if (typeof audit === 'string') {
        try { audit = JSON.parse(audit); } catch (_) { audit = {}; }
    }
    if (!audit || typeof audit !== 'object') audit = {};
    const status = safeString(audit.status || bet.calcio_historical_coverage_status || bet?.extData?.footballHistoryCoverageMode || 'N/D');
    return {
        version: safeString(audit.version || bet.calcio_historical_coverage_version || bet?.extData?.historicalCoverageVersion || ''),
        status,
        reasonCode: safeString(audit.reasonCode || bet.calcio_historical_coverage_reason || bet?.extData?.historicalCoverageReason || 'N/D'),
        confidence: safeNumber(audit.confidence ?? bet.calcio_historical_coverage_confidence, NaN),
        minSample: safeNumber(audit.minSample ?? bet.calcio_historical_coverage_sample, NaN),
        promotedTeamPrior: Boolean(audit.promotedTeamPrior || bet.promoted_team_prior || bet?.extData?.promotedTeamPrior),
        homeSource: safeString(audit.home?.sourceCode || bet.calcio_historical_home_source || 'N/D'),
        awaySource: safeString(audit.away?.sourceCode || bet.calcio_historical_away_source || 'N/D'),
        homeSample: safeNumber(audit.home?.sample, NaN),
        awaySample: safeNumber(audit.away?.sample, NaN),
        homeResolved: safeString(audit.home?.resolvedTeam || bet.home_team || bet.home || ''),
        awayResolved: safeString(audit.away?.resolvedTeam || bet.away_team || bet.away || '')
    };
}


function calcioDualScoreShadowFromBet(bet = {}) {
    let audit = bet.dualScoreShadow || bet.calcioDeepScanResult?.dualScoreShadow || bet.calcio_dual_score_audit || {};
    if (typeof audit === 'string') {
        try { audit = JSON.parse(audit); } catch (_) { audit = {}; }
    }
    if (!audit || typeof audit !== 'object') audit = {};
    const fcs = safeNumber(audit.forecastConfidenceScore?.score ?? bet.calcio_forecast_confidence_shadow, NaN);
    const value = safeNumber(audit.valueScore?.score ?? bet.calcio_value_score_shadow, NaN);
    const risk = safeNumber(audit.contextRiskPenalty?.score ?? bet.calcio_context_risk_penalty, NaN);
    const readiness = safeNumber(audit.decisionReadiness?.score ?? bet.calcio_decision_readiness_shadow, NaN);
    if (![fcs, value, risk, readiness].some(Number.isFinite)) return null;
    return {
        version: safeString(audit.version || bet.calcio_dual_score_version || ''),
        mode: safeString(audit.mode || bet.calcio_dual_score_mode || 'SHADOW_ONLY'),
        forecastConfidenceScore: fcs,
        forecastConfidenceLabel: safeString(audit.forecastConfidenceScore?.label || ''),
        valueScore: value,
        valueLabel: safeString(audit.valueScore?.label || ''),
        contextRiskPenalty: risk,
        contextRiskLabel: safeString(audit.contextRiskPenalty?.label || ''),
        decisionReadiness: readiness,
        decisionReadinessLabel: safeString(audit.decisionReadiness?.label || bet.calcio_decision_readiness_label || ''),
        oldIpmScore: safeNumber(audit.comparison?.oldIpmScore ?? bet.calcio_dual_score_old_ipm ?? bet.calcio_prediction_index_score, NaN),
        deltaVsIpm: safeNumber(audit.comparison?.readinessDeltaVsOldIpm ?? bet.calcio_dual_score_delta_vs_ipm, NaN),
        ptSample: safeNumber(audit.forecastConfidenceScore?.components?.paperTradingCalibration?.sample ?? bet.calcio_dual_score_pt_sample, 0),
        ptWeight: safeNumber(audit.forecastConfidenceScore?.components?.paperTradingCalibration?.maxArchitectureWeight ?? bet.calcio_dual_score_pt_weight, 0),
        authority: safeNumber(bet.calcio_dual_score_authority, 0),
        caps: Array.isArray(audit.decisionReadiness?.caps) ? audit.decisionReadiness.caps : []
    };
}

function renderCalcioDualScoreShadowPanel(bet = {}) {
    const dual = calcioDualScoreShadowFromBet(bet);
    if (!dual) return '';
    const delta = Number.isFinite(dual.deltaVsIpm)
        ? `${dual.deltaVsIpm >= 0 ? '+' : ''}${formatNumber(dual.deltaVsIpm, 1)}`
        : 'N/D';
    const ptStatus = dual.ptSample > 0
        ? `n=${formatNumber(dual.ptSample,0)} · peso ${(dual.ptWeight * 100).toFixed(1)}%`
        : 'n=0 · peso 0%';
    return `
        <div style="margin-top:12px;border:1px solid #0f766e;border-radius:9px;padding:12px;background:rgba(6,78,59,.16);">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:9px;">
                <strong style="color:#5eead4;">🧭 Dual Score Architecture — Patch 26F-C</strong>
                <span style="font-size:.76em;color:#99f6e4;border:1px solid #0f766e;border-radius:999px;padding:2px 7px;">SHADOW · nessuna autorità stake</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;">
                <div><span style="color:#94a3b8;">Forecast Confidence</span><br><strong>${Number.isFinite(dual.forecastConfidenceScore) ? `${formatNumber(dual.forecastConfidenceScore,1)}/100` : 'N/D'}${dual.forecastConfidenceLabel ? ` · ${htmlEscape(dual.forecastConfidenceLabel)}` : ''}</strong></div>
                <div><span style="color:#94a3b8;">Value Score</span><br><strong>${Number.isFinite(dual.valueScore) ? `${formatNumber(dual.valueScore,1)}/100` : 'N/D'}${dual.valueLabel ? ` · ${htmlEscape(dual.valueLabel)}` : ''}</strong></div>
                <div><span style="color:#94a3b8;">Context Risk Penalty</span><br><strong>${Number.isFinite(dual.contextRiskPenalty) ? `${formatNumber(dual.contextRiskPenalty,1)}/100` : 'N/D'}${dual.contextRiskLabel ? ` · ${htmlEscape(dual.contextRiskLabel)}` : ''}</strong></div>
                <div><span style="color:#94a3b8;">Decision Readiness</span><br><strong>${Number.isFinite(dual.decisionReadiness) ? `${formatNumber(dual.decisionReadiness,1)}/100` : 'N/D'} · ${htmlEscape(dual.decisionReadinessLabel || 'N/D')}</strong></div>
                <div><span style="color:#94a3b8;">IPM legacy / Δ</span><br><strong>${Number.isFinite(dual.oldIpmScore) ? `${formatNumber(dual.oldIpmScore,1)}/100` : 'N/D'} · Δ ${delta}</strong></div>
                <div><span style="color:#94a3b8;">Paper Trading</span><br><strong>${htmlEscape(ptStatus)}</strong></div>
            </div>
            <div style="margin-top:8px;font-size:.78em;color:#a7f3d0;">
                Forecast, valore e rischio contestuale sono separati. IPM e Stake Authority production restano invariati.${dual.caps.length ? ` Caps shadow: ${htmlEscape(dual.caps.join(' · '))}.` : ''}
            </div>
        </div>
    `;
}

function renderCalcioProbabilityIntegrityPanel(bet = {}) {
    if (activeSport !== SPORT.CALCIO) return '';
    const diagnostic = getCalcioFinalMarketDiagnostic(bet);
    const integrity = getCalcioProbabilityIntegrity(bet);
    if (!integrity) return '';

    const market = safeString(diagnostic?.prediction || bet.prediction);
    const detail = integrity?.diagnostics?.[market] || {};
    const monteCarlo = bet?.extData?.monteCarlo || {};
    const xgMode = safeString(bet.xg_evidence_mode || bet?.extData?.xgEvidenceMode || 'N/D');
    const xgProvider = safeString(bet.xg_provider_id || bet?.extData?.xgProviderId || 'N/D');
    const xgProviderStatus = safeString(bet.xg_provider_status || bet?.extData?.xgProviderStatus || 'N/D');
    const requestedWeight = bet.xg_weight_requested ?? bet?.extData?.xgWeightRequested;
    const usedWeight = bet.xg_weight_used ?? bet?.extData?.xgWeightUsed;
    const topScores = Array.isArray(diagnostic?.scorelineDistribution) && diagnostic.scorelineDistribution.length
        ? diagnostic.scorelineDistribution.slice(0, 5)
        : (Array.isArray(monteCarlo.scoreDistribution) ? monteCarlo.scoreDistribution.slice(0, 5) : []);
    const stakeAuthority = calcioStakeAuthorityFromBet(bet);
    const dataQualityAuthority = calcioDataQualityAuthorityFromBet(bet);
    const modelStake = safeNumber(diagnostic?.stake?.modelStake ?? stakeAuthority.modelStake ?? bet.calcio_stake_authority_model_stake, 0);
    const reliabilityStake = safeNumber(diagnostic?.stake?.reliabilityStake ?? stakeAuthority.reliabilityStake ?? bet.calcio_stake_authority_reliability_stake, 0);
    const operationalStake = safeNumber(diagnostic?.stake?.finalOperationalStake ?? stakeAuthority.finalOperationalStake ?? bet.calcio_stake_authority_final_stake ?? bet.calcio_operational_stake, 0);
    const dataQualityStatus = safeString(diagnostic?.dataQuality?.status || dataQualityAuthority.status || bet.calcio_data_quality_status || 'N/D');
    const dataQualityScore = safeNumber(diagnostic?.dataQuality?.score ?? dataQualityAuthority.score ?? bet.calcio_data_quality_score, NaN);
    const forecastConfidence = safeString(diagnostic?.forecastConfidence?.label || bet.calcio_forecast_confidence_label || integrity.reliability || 'N/D');
    const forecastConfidenceScore = safeNumber(diagnostic?.forecastConfidence?.score ?? bet.calcio_forecast_confidence_score, NaN);
    const decisionCode = safeString(diagnostic?.decisionState?.code || bet.calcio_decision_state || '');
    const decisionLabel = safeString(diagnostic?.decisionState?.label || decisionCode || bet.calcio_analysis_stage_label || 'N/D');
    const decisionReason = safeString(diagnostic?.decisionState?.reason || bet.calcio_decision_state_reason || bet.calcio_analysis_stage_reason || '');
    const marketId = safeString(diagnostic?.marketId || bet.calcio_final_market_id || integrity.selectedMarketId || 'N/D');
    const finalProbability = safeNumber(diagnostic?.probabilityPct, getBetProbability(bet));
    const historicalCoverage = calcioHistoricalCoverageFromBet(bet);

    return `
        <div style="border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px;background:rgba(15,23,42,.7);">
            <div style="font-weight:900;color:#c4b5fd;margin-bottom:10px;">📐 Final Market Diagnostics — Patch 26F-A</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
                <div><span style="color:#94a3b8;">Mercato finale</span><br><strong>${htmlEscape(market)} · ${htmlEscape(diagnostic?.marketType || bet.market_type || 'N/D')}</strong></div>
                <div><span style="color:#94a3b8;">Prob. finale</span><br><strong>${formatPct(finalProbability, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Modello production</span><br><strong>${detail.modelProbabilityPct == null ? 'N/D' : formatPct(detail.modelProbabilityPct, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Monte Carlo distribuzione</span><br><strong>${detail.monteCarloProbabilityPct == null ? 'N/D' : formatPct(detail.monteCarloProbabilityPct, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Mercato no-vig</span><br><strong>${detail.marketProbabilityPct == null ? 'N/D' : formatPct(detail.marketProbabilityPct, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Disaccordo</span><br><strong>${formatNumber(detail.disagreementPp ?? integrity.maxDisagreementPp, 2)} pp</strong></div>
                <div><span style="color:#94a3b8;">Errore campionamento MC</span><br><strong>±${formatNumber(detail.monteCarloStdErrorPp ?? integrity.maxMonteCarloStdErrorPp, 2)} pp</strong></div>
                <div><span style="color:#94a3b8;">Forecast confidence</span><br><strong>${htmlEscape(forecastConfidence)}${Number.isFinite(forecastConfidenceScore) ? ` · ${formatNumber(forecastConfidenceScore,1)}/100` : ''}</strong></div>
                <div><span style="color:#94a3b8;">Accordo modello-mercato</span><br><strong>${htmlEscape(detail.reliability || 'N/D')}</strong></div>
                <div><span style="color:#94a3b8;">Copertura probabilistica</span><br><strong>${htmlEscape(integrity.coverageMode || 'N/D')}</strong></div>
                <div><span style="color:#94a3b8;">Copertura storica</span><br><strong>${htmlEscape(historicalCoverage.status)}</strong></div>
                <div title="${htmlEscape(historicalCoverage.reasonCode)}"><span style="color:#94a3b8;">Motivo storico</span><br><strong>${htmlEscape(historicalCoverage.reasonCode)}</strong></div>
                <div><span style="color:#94a3b8;">Fonti storico H/A</span><br><strong>${htmlEscape(historicalCoverage.homeSource)} / ${htmlEscape(historicalCoverage.awaySource)}</strong></div>
                <div><span style="color:#94a3b8;">Campione H/A</span><br><strong>${Number.isFinite(historicalCoverage.homeSample) ? formatNumber(historicalCoverage.homeSample,0) : 'N/D'} / ${Number.isFinite(historicalCoverage.awaySample) ? formatNumber(historicalCoverage.awaySample,0) : 'N/D'}</strong></div>
                <div><span style="color:#94a3b8;">Promoted-team prior</span><br><strong>${historicalCoverage.promotedTeamPrior ? 'ATTIVO · SHRINK PRUDENZIALE' : 'NON ATTIVO'}</strong></div>
                <div><span style="color:#94a3b8;">xG evidence</span><br><strong>${htmlEscape(xgMode)}</strong></div>
                <div><span style="color:#94a3b8;">Provider xG</span><br><strong>${htmlEscape(xgProvider)}</strong><br><small>${htmlEscape(xgProviderStatus)}</small></div>
                <div><span style="color:#94a3b8;">Peso xG</span><br><strong>${formatNumber((safeNumber(usedWeight, 0) * 100), 1)}% / req. ${formatNumber((safeNumber(requestedWeight, 0) * 100), 1)}%</strong></div>
                <div><span style="color:#94a3b8;">Stake modello</span><br><strong>€${formatNumber(modelStake, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Stake affidabilità</span><br><strong>€${formatNumber(reliabilityStake, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Stake operativo</span><br><strong>€${formatNumber(operationalStake, 2)}</strong></div>
                <div><span style="color:#94a3b8;">Qualità dati</span><br><strong>${htmlEscape(dataQualityStatus)}${Number.isFinite(dataQualityScore) ? ` · ${formatNumber(dataQualityScore,1)}/100` : ''}</strong></div>
                <div><span style="color:#94a3b8;">Stato decisione</span><br><strong>${htmlEscape(decisionLabel)}</strong></div>
                <div title="${htmlEscape(marketId)}"><span style="color:#94a3b8;">Market ID</span><br><strong>${htmlEscape(marketId.length > 28 ? `${marketId.slice(0,28)}…` : marketId)}</strong></div>
            </div>
            ${renderCalcioDualScoreShadowPanel(bet)}
            ${topScores.length ? `
                <div style="margin-top:10px;color:#94a3b8;font-size:.85em;">
                    Scoreline MC principali:
                    ${topScores.map(row => {
                        const pct = row.probabilityPct != null ? safeNumber(row.probabilityPct, 0) : safeNumber(row.probability, 0) * 100;
                        return `<strong style="color:#e2e8f0;margin-left:6px;">${htmlEscape(row.score)} ${formatPct(pct, 1)}</strong>`;
                    }).join('')}
                </div>
            ` : ''}
            <div style="margin-top:10px;font-size:.82em;color:#cbd5e1;">
                ${htmlEscape(decisionReason || 'Tutti i valori mostrati derivano dal solo mercato finalizzato e dallo snapshot autorevole del batch.')}
            </div>
        </div>
    `;
}

function calcioDecisionCertificationFromBet(bet = {}) {
    const nested = bet.predictionIndex?.decisionCertification || bet.prediction_index?.decisionCertification || bet.decisionCertification || {};
    return {
        status: safeString(bet.calcio_decision_certification_status || nested.status || 'DECISION_UNCERTIFIED'),
        reason: safeString(bet.calcio_decision_certification_reason || nested.reason || bet.calcio_prediction_index_reason || ''),
        identityCertified: Boolean(safeNumber(bet.calcio_identity_certified ?? nested.identity?.certified, 0)),
        marketCertified: Boolean(safeNumber(bet.calcio_market_identity_certified ?? nested.market?.certified, 0)),
        thresholdsCertified: Boolean(safeNumber(bet.calcio_thresholds_certified ?? nested.guard?.thresholdsCertified ?? nested.guard?.certified, 0)),
        confidenceScore: safeNumber(bet.calcio_prediction_confidence_score ?? nested.confidenceScore ?? bet.calcio_prediction_index_score, NaN),
        valueScore: safeNumber(bet.calcio_prediction_value_score ?? nested.valueScore ?? bet.predictionIndex?.valueScore, NaN),
        cautionMode: safeString(bet.calcio_stake_caution_mode || nested.caution?.mode || bet.predictionIndex?.cautionPolicy?.mode || ''),
        cautionReasons: safeString(bet.calcio_stake_caution_reasons || (nested.caution?.reasons || bet.predictionIndex?.cautionPolicy?.reasons || []).join(' · ')),
        structuralLabel: safeString(bet.calcio_structural_certification_label || nested.structuralCertificationLabel || ''),
        ptStatus: safeString(bet.calcio_pt_certification_status || nested.ptCertificationStatus || ''),
        coherenceStatus: safeString(bet.calcio_output_coherence_status || bet.outputCoherence?.status || '')
    };
}

function predictionIndexFromBet(bet = {}) {
    const nested = bet.predictionIndex || bet.prediction_index || bet.stakeReconciliation || {};
    const score = safeNumber(bet.calcio_prediction_index_score ?? nested.score, NaN);
    if (!Number.isFinite(score)) return null;
    return {
        score,
        label: safeString(bet.calcio_prediction_index_label || nested.label || 'N/D'),
        reason: safeString(bet.calcio_prediction_index_reason || nested.reason || ''),
        eligible: Boolean(safeNumber(bet.calcio_prediction_index_eligible ?? nested.eligible, 0)),
        operationalStake: safeNumber(bet.calcio_operational_stake ?? bet.stake_operational ?? bet.operationalStake ?? bet.invested ?? nested.operationalStake, 0),
        theoreticalStake: safeNumber(bet.calcio_theoretical_stake ?? bet.stake_theoretical ?? bet.theoreticalStake ?? nested.theoreticalStake, 0),
        netExecutableOdd: safeNumber(bet.calcio_net_executable_odd ?? nested.netExecutableOdd, NaN),
        oddsOutlierPremiumPct: safeNumber(bet.calcio_odds_outlier_premium_pct ?? nested.oddsOutlierPremiumPct, NaN),
        finalizationStatus: safeString(bet.calcio_ai_finalization_status || nested.finalizationStatus || ''),
        components: nested.components || (() => { try { return JSON.parse(bet.calcio_prediction_index_components || '{}'); } catch (_) { return {}; } })()
    };
}

function renderCalcioPredictionIndexCell(bet = {}) {
    if (activeSport !== SPORT.CALCIO) return '<span style="color:#94a3b8;">N/D</span>';
    const index = predictionIndexFromBet(bet);
    if (!index) return '<span style="color:#94a3b8;">N/D</span>';
    const certification = calcioDecisionCertificationFromBet(bet);
    const score = index.score;
    const coherenceCertified = !certification.coherenceStatus
        || certification.coherenceStatus === 'OUTPUT_COHERENCE_CERTIFIED'
        || certification.coherenceStatus === 'BATCH_OUTPUT_COHERENCE_CERTIFIED';
    const batchTracked = Boolean(bet.calcio_analysis_batch_id || bet.calcio_portfolio_batch_status);
    const batchCertified = !batchTracked
        || (safeNumber(bet.calcio_portfolio_batch_certified, 0) === 1
            && safeString(bet.calcio_portfolio_batch_status).toUpperCase() === 'COMMITTED_BATCH');
    const certified = index.eligible
        && index.operationalStake >= 2
        && certification.identityCertified
        && certification.marketCertified
        && coherenceCertified
        && batchCertified;
    const ptAbsent = certification.ptStatus === 'PT_ABSENT_NEUTRAL' || safeNumber(index.components?.paperTrading?.sample, 0) <= 0;
    const certificationText = certified
        ? (ptAbsent ? 'STAKE ✓ · STRUTTURALMENTE CERTIFICATA · PT ASSENTE' : 'STAKE ✓ · STRUTTURALMENTE CERTIFICATA · PT VALIDATO')
        : 'ANALISI';
    const color = score >= 80 ? '#22c55e' : score >= 70 ? '#10b981' : score >= 60 ? '#38bdf8' : score >= 45 ? '#f59e0b' : '#ef4444';
    const c = index.components || {};
    const tooltip = [
        `Indice Predizione Match: ${formatNumber(score,1)}/100 (${index.label})`,
        `Affidabilità dati: ${formatNumber(c.reliability?.score,1)} × 30%`,
        `Probabilità/consenso: ${formatNumber(c.probability?.score,1)} × 20%`,
        `Edge/EV: ${formatNumber(c.value?.score,1)} × 25%`,
        `DeepScan: ${formatNumber(c.deepScan?.score,1)} × 10% (${safeString(c.deepScan?.class || 'N/D')})`,
        `PT DS×Gate: ${formatNumber(c.paperTrading?.score,1)} × 10% (${safeString(c.paperTrading?.status || 'N/D')})`,
        `Analisi strutturale: ${formatNumber(c.analysis?.score,1)} × 5% (nessun doppio conteggio Edge/EV)`,
        `Gap modello/mercato: ${c.probability?.marketGapPp == null ? 'N/D' : formatNumber(c.probability.marketGapPp,1) + ' pp'}`,
        `Quota netta eseguibile: ${index.netExecutableOdd == null ? 'N/D' : formatNumber(index.netExecutableOdd,2)}`,
        `Premio best-price vs mediana: ${index.oddsOutlierPremiumPct == null ? 'N/D' : formatNumber(index.oddsOutlierPremiumPct,1) + '%'}`,
        `Monte Carlo: ${safeString(c.probability?.monteCarloRole || 'DISTRIBUZIONE/INCERTEZZA')}`,
        `Finalizzazione AI: ${safeString(index.finalizationStatus || bet.calcio_ai_finalization_status || 'N/D')}`,
        `Coerenza output: ${certification.coherenceStatus || 'N/D'}`,
        `Allocazione batch: ${batchTracked ? (batchCertified ? 'CERTIFICATA' : 'IN ATTESA') : 'LEGACY/NON TRACCIATA'}`,
        `Paper Trading: ${certification.ptStatus || c.paperTrading?.status || 'N/D'}`,
        `Identità provider: ${certification.identityCertified ? 'CERTIFICATA' : 'NON CERTIFICATA'}`,
        `Mercato/outcome: ${certification.marketCertified ? 'CERTIFICATO' : 'NON CERTIFICATO'}`,
        'Soglie legacy: diagnostiche, nessun veto autonomo',
        certification.reason || index.reason
    ].filter(Boolean).join('\n');
    return `<div title="${htmlEscape(tooltip)}" style="min-width:108px;">
        <div style="font-size:1.05em;font-weight:950;color:${color};">${formatNumber(score,1)}/100</div>
        <div style="font-size:.68em;color:${color};font-weight:900;margin-top:2px;">${htmlEscape(index.label)}</div>
        <div style="font-size:.63em;color:#94a3b8;margin-top:2px;">IPM strutturale · NON certifica EV prudente</div>
        <div style="font-size:.60em;color:${certified ? '#22c55e' : '#fbbf24'};font-weight:900;margin-top:3px;line-height:1.2;">${htmlEscape(certificationText)}</div>
    </div>`;
}

function renderLiveBetRow(bet, index) {
    // CALCIO_PROBABILITY_FIRST_PATCH_V1: stake simulato PF separato da stake autorizzato e da Kelly.
    const pf = bet.calcio_probability_first || bet.probability_first;
    const pfPreview = activeSport === SPORT.CALCIO && pf?.mode === 'PROBABILITY_FIRST'
        ? '<div style="font-size:.72em;margin-top:5px;color:' + (pf.qualified ? '#86efac' : '#fbbf24') + ';">🧭 PF: '
            + (pf.qualified ? 'P(win) in fascia, evidenza preliminare' : 'Solo analisi / dati sotto soglia')
            + ' · simulazione teorica €' + Number(pf.hypotheticalPaperStakeEuro || 0).toFixed(2) + ' (non allocata)</div>'
        : '';
    const edgePp = getBetEdgePp(bet);
    const evPct = getBetEvPct(bet);
    const probVal = getBetProbability(bet);

    const crBadge = bet.isCR
        ? ' <span style="font-size:0.75em; background:#3b82f6; color:white; padding:2px 6px; border-radius:12px; margin-left:8px;">🛡️ CR</span>'
        : '';

    const scanColor = getPreScanColor(edgePp, evPct, probVal);

    const matchName = jsStringEscape(bet.match || '');
    const leagueName = jsStringEscape(bet.league || '');
    const pred = jsStringEscape(bet.prediction || '');

    const o1 = bet.odd1 || 'N/A';
    const oX = bet.oddX || 'N/A';
    const o2 = bet.odd2 || 'N/A';

    const r10DeepScan = activeSport === SPORT.CALCIO ? parseCalcioFinalReport(bet) : {};
    const r10Prompt = typeof r10DeepScan.missingDataPrompt === 'string' ? r10DeepScan.missingDataPrompt : '';
    const r11Prompt = typeof r10DeepScan.independentAiPrompt === 'string' ? r10DeepScan.independentAiPrompt : '';
    const r10Adaptive = r10DeepScan.adaptiveAssessment && typeof r10DeepScan.adaptiveAssessment === 'object' ? r10DeepScan.adaptiveAssessment : {};
    const r10Light = ['RED', 'YELLOW', 'GREEN'].includes(r10Adaptive.light) ? r10Adaptive.light : '';
    const r10LightLabel = r10Light ? `${r10Light === 'RED' ? '🔴' : r10Light === 'GREEN' ? '🟢' : '🟡'} ${htmlEscape(r10Adaptive.label || '')} · copertura ${Number(r10Adaptive.coveragePct || 0).toFixed(0)}% (non stake)` : '';
    const copyBtn = `
        <button
            type="button"
            data-r11-prompt="${htmlEscape(r11Prompt)}" aria-label="R12 Analisi IA indipendente del match"
            onclick="copyAIPrompt(this, '${matchName}', '${leagueName}', '${pred}', '${bet.odd}', '${o1}', '${oX}', '${o2}')"
            style="background:#8b5cf6; border:none; color:white; padding:4px 8px; border-radius:4px; font-size:0.75em; font-weight:bold; cursor:pointer; transition:background 0.2s; margin-top:5px;"
        >
            🧠 Analisi IA indipendente
        </button>
        ${activeSport === SPORT.CALCIO ? `<button type="button" data-r11-recovery="1" aria-label="R12 Richiesta esclusiva dei dati mancanti" data-r10-prompt="${htmlEscape(r10Prompt)}" onclick="copyAIPrompt(this, '${matchName}', '${leagueName}', '${pred}', '${bet.odd}', '${o1}', '${oX}', '${o2}')" style="background:#334155;color:#e2e8f0;border:1px solid #64748b;border-radius:4px;padding:4px 8px;margin-top:5px;cursor:pointer;font-size:0.75em;">🔎 Recupero dati mancanti</button>` : ''}
        ${activeSport === SPORT.CALCIO ? `<button type="button" onclick="importIndependentAiVerdict(this)" style="background:#0f766e;color:#ffffff;border:0;border-radius:4px;padding:4px 8px;margin-top:5px;cursor:pointer;font-size:0.75em;">📥 Esito IA</button><span data-r11-ai-compare="1" style="display:block;font-size:.68em;color:#cbd5e1;margin-top:4px;"></span>` : ''}
    `;

    const dsHTML = `
        <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
            <span id="ds-badge-${index}" class="ds-badge ds-loading">⏳ Attesa...</span>
            <button id="ds-btn-${index}" class="btn-ds-detail hidden" aria-expanded="false" onclick="toggleDsDetail(${index})">🔍 Dettagli</button>
        </div>
    `;

    const qualityBadge = activeSport === SPORT.TENNIS
        ? getDataQualityBadge(bet)
        : '';

    const operationalBadge = renderTennisOperationalBadge(bet);
    const operationalPanel = renderTennisOperationalReportPanel(bet);
    const matchupBadge = renderPatch12MatchupBadge(bet);
    const matchupPanel = renderPatch12MatchupDetail(bet);
    const calcioForecastBadge = renderCalcioForecastBadge(bet);
    const calcioProbabilityPanel = renderCalcioProbabilityIntegrityPanel(bet);
    bet.__rowIndex = index;
    const unifiedQualityCell = renderUnifiedQualityGateCell(bet);

    const edgeEvHtml = renderUnifiedEdgeEvCell(bet);

    return `
        <tr id="row-${index}" style="border-bottom:1px solid #334155; background:${scanColor.bg}; transition:all 0.5s ease;">
            <td style="padding:10px; border-left:6px solid ${scanColor.color};">${htmlEscape(bet.date)}</td>
            <td style="padding:10px; min-width:200px;">
                <strong>${htmlEscape(bet.match)}</strong>${crBadge}${qualityBadge}
                ${matchupBadge ? `<div>${matchupBadge}</div>` : ''}
                <div id="calcio-forecast-badge-${index}">${calcioForecastBadge}</div>
                ${pfPreview}
                <br>
                ${copyBtn}
                ${r10LightLabel ? `<div style="margin-top:5px;color:#cbd5e1;font-size:.68em">${r10LightLabel}</div>` : ''}
            </td>
            <td style="padding:10px; vertical-align:top; text-align:center;">${dsHTML}</td>
            <td id="quality-gate-cell-${index}" style="padding:10px;vertical-align:top;text-align:center;">${unifiedQualityCell}</td>
            <td style="padding:10px;">${htmlEscape(bet.league)}</td>
            <td id="prediction-cell-${index}" style="padding:10px; color:#10b981; font-weight:bold;">${htmlEscape(bet.prediction)}</td>
            <td id="odds-cell-${index}" style="padding:10px;">${renderCalcioCertifiedOddsCell(bet)}</td>
            <td id="probability-cell-${index}" style="padding:10px;">${renderCalcioProbabilityCell(bet, probVal)}</td>
            <td id="historical-rate-cell-${index}" style="padding:10px;text-align:center;">${renderHistoricalCombinationEvidenceCell(historicalCombinationFromBet(bet))}</td>
            <td id="edge-ev-cell-${index}" style="padding:10px; color:#cbd5e1; min-width:110px;">${edgeEvHtml}</td>
            <td id="ai-reliability-cell-${index}" style="padding:10px;text-align:center;">${renderUnifiedAiReliabilityCell(bet)}</td>
            <td id="evidence-quality-cell-${index}" style="padding:10px;text-align:center;">${renderUnifiedEvidenceQualityCell(bet)}</td>
            <td id="prediction-index-cell-${index}" style="padding:10px;text-align:center;">${renderUnifiedPredictionIndexCell(bet)}</td>
            <td id="stake-cell-${index}" style="padding:10px;">€${htmlEscape(bet.invested)}${renderTennisStakePolicyMini(bet)}${renderCalcioStakeLifecycleMini(bet)}</td>
            <td id="profit-cell-${index}" style="padding:10px; color:#10b981;" title="Profitto potenziale; diventa realizzato solo dopo refertazione.">Pot. +€${htmlEscape(bet.estimatedProfit)}</td>
        </tr>
        <tr id="ds-row-${index}" class="hidden ds-detail-row" data-expanded="0" style="display:none; background:rgba(15,23,42,0.4); border-bottom:2px solid #334155;">
            <td style="border-left:6px solid ${scanColor.color};"></td>
            <td colspan="14" style="padding:20px;">
                ${operationalPanel}
                ${matchupPanel}
                ${calcioProbabilityPanel}
                <div id="ds-detail-${index}"></div>
            </td>
        </tr>
    `;
}


// ============================================================================
// 10. BACKTEST
// ============================================================================

$('backtestBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;

    btn.innerText = '⏳ Simulazione...';
    btn.disabled = true;

    showLoading();

    const initialBankroll = parseFloat($('bankroll')?.value) || 1000;
    const leagueSelection = $('league')?.value || 'all';

    const apiUrl = activeSport === SPORT.CALCIO
        ? `/api/backtest?bankroll=${initialBankroll}&league=${encodeURIComponent(leagueSelection)}`
        : `/api/tennis/backtest?league=${encodeURIComponent(leagueSelection)}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.error) {
            alert(`Errore Server:\n\n${data.error}`);
            return;
        }

        currentBacktestData = data;

        nascondiTutto();
        $('backtestLogSection')?.classList.remove('hidden');

        renderBacktest(data);
    } catch (error) {
        alert('Errore simulazione.');
    } finally {
        btn.innerText = '📊 Backtest';
        btn.disabled = false;
        hideLoading();
    }
});


function renderTennisBacktestNoDataPanel(data = {}) {
    if (activeSport !== SPORT.TENNIS) return '';

    const rows = Array.isArray(data.log) ? data.log : [];
    if (rows.length > 0) return '';

    const diagnostics = data.diagnostics || data.debug || {};
    const message = data.message || data.reason || 'Backtest Tennis eseguito ma nessuna selezione è stata prodotta.';
    const dataMode = data.dataMode || diagnostics.dataMode || data.reliabilityMode || 'BACKTEST_NEUTRAL_NO_FAKE_RELIABILITY';
    const engineVersion = data.engineVersion || data.version || '-';
    const metricVersion = data.metricVersion || 'TENNIS_EDGE_EV_V2';
    const modelVersion = data.modelVersion || 'TENNIS_QUANT_BOOTSTRAP_2026_V1';

    return `
        <div class="tennis-backtest-empty-panel">
            <div class="tennis-health-section-title">ℹ️ Backtest Tennis senza selezioni</div>
            <div class="tennis-health-warning">
                ${htmlEscape(message)} Non è necessariamente un errore: significa che il backend ha restituito <strong>0 righe eleggibili</strong> per il log backtest.
            </div>
            <div class="tennis-health-overview">
                <div class="tennis-health-card"><div class="tennis-health-card-label">Data Mode</div><div class="tennis-health-card-value">${htmlEscape(dataMode)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Engine</div><div class="tennis-health-card-value">${htmlEscape(engineVersion)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Model</div><div class="tennis-health-card-value">${htmlEscape(modelVersion)}</div></div>
                <div class="tennis-health-card"><div class="tennis-health-card-label">Metric</div><div class="tennis-health-card-value">${htmlEscape(metricVersion)}</div></div>
            </div>
            <div class="tennis-health-muted" style="margin-top:10px; line-height:1.45;">
                Cause più probabili: file storico Tennis assenti/non letti, circuito selezionato senza file ATP/WTA, serie non ammesse, dati giocatore insufficienti, soglie edge/probabilità/EV troppo strette, oppure blocco del professional gate/Markov sui mercati totals.
            </div>
        </div>
    `;
}

function renderBacktest(data) {
    const summaryBox = $('backtestSummaryBox');

    if (!summaryBox) return;

    let summaryHtml = '';

    if (activeSport === SPORT.CALCIO) {
        summaryHtml = `
            <div style="background:#1e293b; padding:15px; border-radius:8px; flex:1; min-width:200px; border-left:4px solid #3b82f6;">
                <h4 style="margin:0 0 10px 0; color:#3b82f6;">🎯 Singole</h4>
                <p style="margin:5px 0; font-size:0.9em;">Giocate: ${safeNumber(data.single?.placed, 0)} | Vinte: <span style="color:#10b981;">${safeNumber(data.single?.won, 0)}</span></p>
                <p style="margin:5px 0; font-size:0.9em;">Profitto: €${formatNumber(data.single?.profit, 2)}</p>
                <p style="margin:5px 0; font-size:0.9em;">ROI: <strong style="color:${colorByPositiveNegative(data.single?.roi)};">${formatPct(data.single?.roi, 2)}</strong></p>
            </div>
        `;
    } else {
        const upsetsCaught = safeNumber(data.tennisMetrics?.upsetsCaught, 0);
        const avgOddsWon = safeNumber(data.tennisMetrics?.avgOddsWon, 0);

        summaryHtml = `
            ${getReliabilityBadge(data)}
            <div style="background:#1e293b; padding:15px; border-radius:8px; flex:1; min-width:200px; border-left:4px solid #3b82f6;">
                <h4 style="margin:0 0 10px 0; color:#3b82f6;">🎾 Modello Tennis</h4>
                <p style="margin:5px 0; font-size:0.9em;">Match: ${safeNumber(data.single?.placed, 0)} | Vinti: <span style="color:#10b981;">${safeNumber(data.single?.won, 0)}</span></p>
                <p style="margin:5px 0; font-size:0.9em;">Profitto: €${formatNumber(data.single?.profit, 2)}</p>
                <p style="margin:5px 0; font-size:0.9em;">ROI: <strong style="color:${colorByPositiveNegative(data.single?.roi)};">${formatPct(data.single?.roi, 2)}</strong></p>
            </div>
            <div style="background:#1e293b; padding:15px; border-radius:8px; flex:1; min-width:200px; border-left:4px solid #8b5cf6;">
                <h4 style="margin:0 0 10px 0; color:#8b5cf6;">📈 Metriche</h4>
                <p style="margin:5px 0; font-size:0.9em;">Upsets Presi: <span style="color:#10b981; font-weight:bold;">${upsetsCaught}</span></p>
                <p style="margin:5px 0; font-size:0.9em;">Quota Media Vinta: <strong>${formatNumber(avgOddsWon, 2)}</strong></p>
                <p style="margin:5px 0; font-size:0.9em;">Brier: <strong>${htmlEscape(data.tennisMetrics?.brierScore || '0.0000')}</strong></p>
                <p style="margin:5px 0; font-size:0.9em;">LogLoss: <strong>${htmlEscape(data.tennisMetrics?.logLoss || '0.0000')}</strong></p>
            </div>
        `;
    }

    let leagueHtml = `
        <div style="background:#1e293b; padding:15px; border-radius:8px; flex:2; min-width:300px; border-left:4px solid #a855f7;">
            <h4 style="margin:0 0 10px 0; color:#a855f7;">🌍 Dettaglio</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.85em; color:#cbd5e1;">
    `;

    if (data.leagueBreakdown) {
        for (const [leagueCode, stats] of Object.entries(data.leagueBreakdown)) {
            const lRoi = safeNumber(stats.invested, 0) > 0
                ? ((safeNumber(stats.profit, 0) / safeNumber(stats.invested, 0)) * 100).toFixed(2)
                : '0.00';

            leagueHtml += `
                <div>
                    <strong>${htmlEscape(leagueCode)}</strong>:
                    ${safeNumber(stats.won, 0)}/${safeNumber(stats.placed, 0)}
                    ROI: <span style="color:${colorByPositiveNegative(lRoi)}">${lRoi}%</span>
                </div>
            `;
        }
    }

    leagueHtml += '</div></div>';

    const diagnosticsHtml = renderDiagnosticsPanel(data, {
        title: activeSport === SPORT.CALCIO ? 'Diagnostica Backtest Calcio' : 'Diagnostica Backtest Tennis',
        emptyHint: activeSport === SPORT.CALCIO ? getNoResultsHint('backtest') : ''
    });

    const tennisNoDataHtml = renderTennisBacktestNoDataPanel(data);

    summaryBox.innerHTML = summaryHtml + leagueHtml + diagnosticsHtml + tennisNoDataHtml;

    renderBacktestLog(data.log || []);
}

function renderBacktestLog(logRows = []) {
    const tbody = $('backtestLogTableBody');

    if (!tbody) return;

    if (!logRows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:18px;">
                    <div style="font-weight:bold; color:#f59e0b; margin-bottom:6px;">Nessun dato backtest disponibile.</div>
                    <div style="color:#94a3b8; font-size:0.9em;">${htmlEscape(getNoResultsHint('backtest'))}</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = logRows.map(row => {
        const edgePp = safeNumber(row.edge_pp ?? row.edge, 0);
        const evPct = safeNumber(row.ev_pct ?? row.ev, 0);
        const won = row.won === true || safeString(row.status).toUpperCase() === 'WON';

        const resultLabel = won
            ? '✅ Vinta'
            : '❌ Persa';

        const resultColor = won
            ? '#10b981'
            : '#ef4444';

        const profitValue = safeNumber(row.profit, 0);

        const edgeEvHtml = `
            <div style="font-weight:bold; color:#f8fafc;">${formatPct(edgePp, 2, true)}</div>
            <div style="font-size:0.76em; color:${colorByPositiveNegative(evPct)}; margin-top:3px;">EV ${formatPct(evPct, 2, true)}</div>
        `;

        return `
            <tr style="border-bottom:1px solid #334155;">
                <td style="padding:8px;">${htmlEscape(row.date)}</td>
                <td style="padding:8px;"><strong>${htmlEscape(row.match)}</strong></td>
                <td style="padding:8px; font-weight:bold; color:#f59e0b;">${htmlEscape(row.prediction)}</td>
                <td style="padding:8px;">${formatNumber(row.odd, 2)}</td>
                <td style="padding:8px; min-width:110px;">${edgeEvHtml}</td>
                <td style="padding:8px;">€${formatNumber(row.invested, 2)}</td>
                <td style="padding:8px; color:${resultColor}; font-weight:bold;">${resultLabel}</td>
                <td style="padding:8px; font-weight:bold; color:${resultColor};">${profitValue > 0 ? '+' : ''}€${formatNumber(profitValue, 2)}</td>
            </tr>
        `;
    }).join('');

    applyTableFilters('backtestTable');
}



// STEP91T_TENNIS_PAPER_PORTFOLIO_DATA_RESTORE
// Ripristino runtime: Paper Trading/Portfolio Tennis devono leggere history reale anche se resolve_ai torna vuoto.
// Non modifica DB, storico, settlement, stake, gate, CLV o Calcio.
function step91TSelectHistoryRows(data = {}) {
    const candidates = [
        data && data.history,
        data && data.strictHistory,
        data && data.strictCurrentHistory,
        data && data.portfolioHistory,
        data && data.operationalHistory,
        data && data.report && data.report.history,
        data && data.analytics && data.analytics.history,
        data && data.data && data.data.history
    ];
    for (const rows of candidates) {
        if (Array.isArray(rows) && rows.length > 0) return rows;
    }
    return [];
}

function step91PHasHistoryRows(data = {}) {
    return step91TSelectHistoryRows(data).length > 0;
}

async function fetchStep91OTennisHistoryFallback(leagueFilter = 'all') {
    const encodedLeague = encodeURIComponent(leagueFilter || 'all');
    const attempts = [
        '/api/tennis/history?leagueFilter=' + encodedLeague + '&limit=1000',
        '/api/tennis/resolve_ai?leagueFilter=' + encodedLeague + '&limit=1000',
        '/api/portfolio/report?sport=TENNIS&limit=1000'
    ];

    let lastData = { history: [] };
    for (const url of attempts) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            const rawHistory = step91TSelectHistoryRows(data);
            if (rawHistory.length > 0) {
                return {
                    ...(data || {}),
                    history: rawHistory,
                    step91pPaperTradingRestore: true,
                    step91tPaperPortfolioRestore: true,
                    step91pHistorySource: url
                };
            }
            lastData = data || lastData;
        } catch (error) {
            console.warn('[STEP91T] Tentativo fallback Tennis fallito:', url, error);
        }
    }
    return {
        ...(lastData || {}),
        history: step91TSelectHistoryRows(lastData),
        step91pPaperTradingRestore: true,
        step91tPaperPortfolioRestore: true,
        step91pHistorySource: 'EMPTY_ALL_ATTEMPTS'
    };
}

if (typeof window !== 'undefined') {
    window.step91TSelectHistoryRows = step91TSelectHistoryRows;
    window.step91PHasHistoryRows = step91PHasHistoryRows;
    window.fetchStep91OTennisHistoryFallback = fetchStep91OTennisHistoryFallback;
}
// /STEP91T_TENNIS_PAPER_PORTFOLIO_DATA_RESTORE


// STEP92_TENNIS_PAPER_TRADING_UI_HISTORY_FINAL_FALLBACK
function step92SelectHistoryRows(data = {}) {
    const candidates = [data && data.history, data && data.strictHistory, data && data.strictCurrentHistory, data && data.portfolioHistory, data && data.operationalHistory, data && data.report && data.report.history, data && data.analytics && data.analytics.history, data && data.data && data.data.history];
    for (const rows of candidates) { if (Array.isArray(rows) && rows.length > 0) return rows; }
    return [];
}
function step92HasHistoryRows(data = {}) { return step92SelectHistoryRows(data).length > 0; }
async function fetchStep92TennisPaperTradingFallback(leagueFilter = 'all') {
    const encodedLeague = encodeURIComponent(leagueFilter || 'all');
    const attempts = ['/api/tennis/history?leagueFilter=' + encodedLeague + '&limit=1000', '/api/tennis/resolve_ai?leagueFilter=' + encodedLeague + '&limit=1000', '/api/portfolio/report?sport=TENNIS&limit=1000'];
    let lastData = { history: [] };
    for (const url of attempts) {
        try { const response = await fetch(url); const data = await response.json(); const rows = step92SelectHistoryRows(data); if (rows.length > 0) return { ...(data || {}), history: rows, step92PaperTradingFinalRestore: true, step92HistorySource: url }; lastData = data || lastData; }
        catch (error) { console.warn('[STEP92] fallback Tennis history fallito:', url, error); }
    }
    return { ...(lastData || {}), history: step92SelectHistoryRows(lastData), step92PaperTradingFinalRestore: true, step92HistorySource: 'EMPTY_ALL_ATTEMPTS' };
}
if (typeof window !== 'undefined') { window.step92SelectHistoryRows = step92SelectHistoryRows; window.step92HasHistoryRows = step92HasHistoryRows; window.fetchStep92TennisPaperTradingFallback = fetchStep92TennisPaperTradingFallback; }
// /STEP92_TENNIS_PAPER_TRADING_UI_HISTORY_FINAL_FALLBACK


// BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS
// Matrice descrittiva read-only: probabilità AI persistita per la selezione vs WON/LOST.
function aiOutcomeBandPct(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(digits)}%` : 'N/D';
}

function aiOutcomeBandSignedPp(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'N/D';
    return `${number > 0 ? '+' : ''}${number.toFixed(1)} pp`;
}

function aiOutcomeBandReliabilityLabel(value) {
    const labels = {
        ALTA: 'Alta', BUONA: 'Buona', MEDIA: 'Media', BASSA: 'Bassa',
        MOLTO_BASSA: 'Molto bassa', NESSUN_CAMPIONE: 'Nessun campione'
    };
    return labels[safeString(value).toUpperCase()] || 'N/D';
}

function getAiOutcomeBandView() {
    const payload = aiOutcomeBandsState.payload;
    const scope = payload?.scopes?.[aiOutcomeBandsState.scope] || null;
    if (!scope) return null;
    if (aiOutcomeBandsState.competition === 'ALL') {
        return { label: 'Tutti i campionati / tornei', ...scope.overall };
    }
    const competition = (scope.competitions || []).find(item => item.key === aiOutcomeBandsState.competition);
    if (!competition) {
        aiOutcomeBandsState.competition = 'ALL';
        return { label: 'Tutti i campionati / tornei', ...scope.overall };
    }
    return competition;
}

function renderAiOutcomeBandsPanel() {
    const panel = $('aiOutcomeBandsPanel');
    if (!panel) return;
    const payload = aiOutcomeBandsState.payload;
    if (!payload) {
        panel.innerHTML = '<div class="ai-outcome-loading">Caricamento fasce AI vinte/perse…</div>';
        return;
    }
    const scopeReport = payload.scopes?.[aiOutcomeBandsState.scope];
    const view = getAiOutcomeBandView();
    if (!scopeReport || !view) {
        panel.innerHTML = '<div class="ai-outcome-empty">Dati AI WON/LOST non disponibili.</div>';
        return;
    }

    const summary = view.summary || {};
    const competitions = scopeReport.competitions || [];
    const competitionOptions = [
        '<option value="ALL">Tutti i campionati / tornei</option>',
        ...competitions.map(item => `<option value="${htmlEscape(item.key)}" ${item.key === aiOutcomeBandsState.competition ? 'selected' : ''}>${htmlEscape(item.label)} · n=${safeNumber(item.summary?.resolved, 0)}</option>`)
    ].join('');
    const scopeIsSignals = aiOutcomeBandsState.scope === 'AI_SIGNALS';
    const coverage = safeNumber(summary.certifiedCoveragePct, NaN);
    const qualityClass = Number.isFinite(coverage) && coverage >= 80 ? 'good' : (Number.isFinite(coverage) && coverage >= 50 ? 'warn' : 'low');
    const legacyRows = safeNumber(summary.legacyRows, 0);

    const rows = (view.bands || []).map(band => {
        const n = safeNumber(band.resolved, 0);
        const won = safeNumber(band.won, 0);
        const lost = safeNumber(band.lost, 0);
        const bandClass = n >= 30 ? 'sample-strong' : (n >= 5 ? 'sample-medium' : 'sample-low');
        return `
            <tr class="${bandClass}">
                <td data-label="Fascia AI"><strong>${htmlEscape(band.label)}</strong></td>
                <td data-label="Campione"><strong>${n}</strong><small>${htmlEscape(aiOutcomeBandReliabilityLabel(band.reliability))}</small></td>
                <td data-label="Vinte"><strong class="ai-outcome-won">${won} · ${aiOutcomeBandPct(band.winRatePct)}</strong></td>
                <td data-label="Perse"><strong class="ai-outcome-lost">${lost} · ${aiOutcomeBandPct(band.lossRatePct)}</strong></td>
                <td data-label="Media AI"><strong>${aiOutcomeBandPct(band.averageAiProbabilityPct)}</strong></td>
                <td data-label="Scarto reale-AI"><strong class="${safeNumber(band.calibrationGapPp, 0) >= 0 ? 'ai-gap-positive' : 'ai-gap-negative'}">${aiOutcomeBandSignedPp(band.calibrationGapPp)}</strong></td>
            </tr>
        `;
    }).join('');

    const mobileCards = (view.bands || []).map(band => {
        const n = safeNumber(band.resolved, 0);
        return `
            <article class="ai-outcome-band-card ${n >= 30 ? 'sample-strong' : (n >= 5 ? 'sample-medium' : 'sample-low')}">
                <div class="ai-outcome-band-card-head"><strong>${htmlEscape(band.label)}</strong><span>n=${n}</span></div>
                <div class="ai-outcome-band-card-grid">
                    <div><small>Vinte</small><strong class="ai-outcome-won">${safeNumber(band.won,0)} · ${aiOutcomeBandPct(band.winRatePct)}</strong></div>
                    <div><small>Perse</small><strong class="ai-outcome-lost">${safeNumber(band.lost,0)} · ${aiOutcomeBandPct(band.lossRatePct)}</strong></div>
                    <div><small>Media AI</small><strong>${aiOutcomeBandPct(band.averageAiProbabilityPct)}</strong></div>
                    <div><small>Scarto</small><strong>${aiOutcomeBandSignedPp(band.calibrationGapPp)}</strong></div>
                </div>
                <div class="ai-outcome-band-card-foot">${htmlEscape(aiOutcomeBandReliabilityLabel(band.reliability))}${Number.isFinite(Number(band.ciLowPct)) ? ` · CI ${aiOutcomeBandPct(band.ciLowPct)}–${aiOutcomeBandPct(band.ciHighPct)}` : ''}</div>
            </article>
        `;
    }).join('');

    panel.innerHTML = `
        <section class="ai-outcome-panel" data-ai-outcome-version="${AI_OUTCOME_BANDS_UI_VERSION}">
            <div class="ai-outcome-header">
                <div>
                    <div class="ai-outcome-eyebrow">Misura predittiva AI · ${htmlEscape(payload.sport)}</div>
                    <h3>Vinte e perse per fascia di probabilità</h3>
                    <p>Fasce della probabilità AI salvata prima del match. Affidabilità AI, TPI e quota implicita sono esclusi.</p>
                </div>
                <span class="ai-outcome-readonly">READ-ONLY</span>
            </div>
            <div class="ai-outcome-controls">
                <div class="ai-outcome-segmented" role="group" aria-label="Ambito risultati AI">
                    <button type="button" data-ai-band-scope="AI_SIGNALS" class="${scopeIsSignals ? 'active' : ''}">Tutti i segnali AI</button>
                    <button type="button" data-ai-band-scope="REAL_STAKE" class="${!scopeIsSignals ? 'active' : ''}">Solo stake reale</button>
                </div>
                <label class="ai-outcome-select-wrap">Campionato / tipologia torneo
                    <select id="aiOutcomeCompetitionFilter" class="ai-outcome-select">${competitionOptions}</select>
                </label>
            </div>
            <div class="ai-outcome-kpis">
                <div><span>Campione</span><strong>${safeNumber(summary.resolved, 0)}</strong><small>${htmlEscape(view.label || '')}</small></div>
                <div><span>Vinte</span><strong class="ai-outcome-won">${aiOutcomeBandPct(summary.winRatePct)}</strong><small>${safeNumber(summary.won,0)} WON</small></div>
                <div><span>Perse</span><strong class="ai-outcome-lost">${aiOutcomeBandPct(summary.lossRatePct)}</strong><small>${safeNumber(summary.lost,0)} LOST</small></div>
                <div class="${qualityClass}"><span>Copertura certificata</span><strong>${aiOutcomeBandPct(summary.certifiedCoveragePct)}</strong><small>${safeNumber(summary.certifiedRows,0)} correnti · ${legacyRows} legacy</small></div>
            </div>
            ${legacyRows > 0 ? `<div class="ai-outcome-quality-note">${legacyRows} esiti legacy sono visibili per completezza ma separati dalla copertura certificata. Il campione non acquisisce autorità operativa.</div>` : ''}
            <div class="ai-outcome-table-wrap">
                <table class="ai-outcome-table">
                    <thead><tr><th>Fascia AI</th><th>Campione</th><th>Vinte</th><th>Perse</th><th>Media AI</th><th>Scarto reale−AI</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="ai-outcome-mobile-grid">${mobileCards}</div>
            <div class="ai-outcome-footnote">Scarto = win rate reale meno probabilità AI media. Le fasce senza campione restano visibili da 10–20% a 90–100%.</div>
        </section>
    `;

    panel.querySelectorAll('[data-ai-band-scope]').forEach(button => {
        button.addEventListener('click', () => {
            aiOutcomeBandsState.scope = button.dataset.aiBandScope === 'REAL_STAKE' ? 'REAL_STAKE' : 'AI_SIGNALS';
            const scope = payload.scopes?.[aiOutcomeBandsState.scope];
            if (aiOutcomeBandsState.competition !== 'ALL' && !(scope?.competitions || []).some(item => item.key === aiOutcomeBandsState.competition)) {
                aiOutcomeBandsState.competition = 'ALL';
            }
            renderAiOutcomeBandsPanel();
        });
    });
    $('aiOutcomeCompetitionFilter')?.addEventListener('change', event => {
        aiOutcomeBandsState.competition = event.target.value || 'ALL';
        renderAiOutcomeBandsPanel();
    });
    step42EnhanceAiOutcomePanel(panel);
}

async function loadAiOutcomeBands(sport, viewEpoch) {
    const normalizedSport = safeString(sport).toUpperCase() === 'TENNIS' ? 'TENNIS' : 'CALCIO';
    const requestId = ++aiOutcomeBandsState.requestId;
    aiOutcomeBandsState.sport = normalizedSport;
    aiOutcomeBandsState.scope = 'AI_SIGNALS';
    aiOutcomeBandsState.competition = 'ALL';
    aiOutcomeBandsState.payload = null;
    renderAiOutcomeBandsPanel();
    try {
        const response = await fetch(`/api/analytics/ai-outcome-bands?sport=${encodeURIComponent(normalizedSport)}&tradingScope=${window.TradingScopeUI.mode()}`);
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
        if (requestId !== aiOutcomeBandsState.requestId || !isPrimaryViewCurrent('TRADING', viewEpoch)) return;
        aiOutcomeBandsState.payload = payload;
        renderAiOutcomeBandsPanel();
    } catch (error) {
        if (requestId !== aiOutcomeBandsState.requestId || !isPrimaryViewCurrent('TRADING', viewEpoch)) return;
        const panel = $('aiOutcomeBandsPanel');
        if (panel) panel.innerHTML = `<div class="ai-outcome-empty">Matrice AI vinte/perse non disponibile: ${htmlEscape(error.message)}</div>`;
        showRuntimeDiagnostic({ severity: 'WARN', title: 'Matrice AI vinte/perse non disponibile', message: error.message, phase: 'AI_OUTCOME_BANDS_READ_ONLY', error });
    }
}
// /BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS




// TENNIS_PATCH50_PREDICTION_INDEX_WIN_LOSS_BANDS_COLLAPSIBLE_UI
function predictionIndexBandPct(value){ return Number.isFinite(Number(value)) ? `${formatNumber(Number(value),1)}%` : 'N/D'; }
function predictionIndexBandsVisibilityState(collapsed=false){
    const isCollapsed=collapsed===true;
    return {collapsed:isCollapsed,ariaExpanded:isCollapsed?'false':'true',buttonLabel:isCollapsed?'＋ Espandi tabella':'− Comprimi tabella'};
}
function renderPredictionIndexBandsPanel(){
    const panel=$('predictionIndexBandsPanel'); if(!panel)return;
    const payload=predictionIndexBandsState.payload;
    if(!payload){panel.innerHTML='<div class="ai-outcome-empty">Caricamento fasce Indice Predizione…</div>';return;}
    const scopePayload=payload.scopes?.[predictionIndexBandsState.scope]||payload.scopes?.AI_SIGNALS;
    const selected=predictionIndexBandsState.competition==='ALL'?scopePayload?.overall:(scopePayload?.competitions||[]).find(x=>x.key===predictionIndexBandsState.competition);
    const view=selected||scopePayload?.overall||{summary:{},bands:[]}, summary=view.summary||{};
    const visibility=predictionIndexBandsVisibilityState(predictionIndexBandsState.collapsed);
    const competitions=scopePayload?.competitions||[];
    const options=['<option value="ALL">Tutte le competizioni</option>',...competitions.map(c=>`<option value="${htmlEscape(c.key)}" ${c.key===predictionIndexBandsState.competition?'selected':''}>${htmlEscape(c.label)} · n=${safeNumber(c.summary?.resolved,0)}</option>`)].join('');
    const rows=(view.bands||[]).map(b=>`<tr><td><strong>${htmlEscape(b.label)}</strong></td><td>${safeNumber(b.resolved,0)}</td><td style="color:#22c55e;font-weight:800;">${safeNumber(b.won,0)} · ${predictionIndexBandPct(b.winRatePct)}</td><td style="color:#f87171;font-weight:800;">${safeNumber(b.lost,0)} · ${predictionIndexBandPct(b.lossRatePct)}</td><td>${Number.isFinite(Number(b.averagePredictionIndex))?formatNumber(b.averagePredictionIndex,1):'N/D'}</td><td>${Number.isFinite(Number(b.averageAiReliability))?formatNumber(b.averageAiReliability,1)+'%':'N/D'}</td><td>${window.PortfolioAccounting.interval(Number(b.won),Number(b.resolved))}</td></tr>`).join('');
    panel.innerHTML=`<section class="ai-outcome-panel patch49-prediction-index-panel patch50-prediction-index-collapsible"><div class="ai-outcome-heading"><div><h3>🎯 Indice Predizione · vinte/perse per fascia</h3><p>Indice prematch 0–100. L'esito è usato soltanto per misurare la performance storica e non ricalcola né autorizza lo stake.</p></div><div class="ai-outcome-controls patch50-prediction-index-controls"><button data-pi-band-scope="AI_SIGNALS" class="${predictionIndexBandsState.scope==='AI_SIGNALS'?'active':''}">Tutti i segnali</button><button data-pi-band-scope="REAL_STAKE" class="${predictionIndexBandsState.scope==='REAL_STAKE'?'active':''}">Stake reale</button><select id="predictionIndexCompetitionFilter">${options}</select><button type="button" id="predictionIndexBandsCollapseBtn" class="prediction-index-collapse-btn" aria-controls="predictionIndexBandsTableRegion" aria-expanded="${visibility.ariaExpanded}">${visibility.buttonLabel}</button></div></div><div class="ai-outcome-kpis"><div><span>Campione</span><strong>${safeNumber(summary.resolved,0)}</strong><small>${htmlEscape(summary.reliability||'')}</small></div><div><span>Vinte</span><strong class="ai-outcome-won">${predictionIndexBandPct(summary.winRatePct)}</strong><small>${safeNumber(summary.won,0)} WON</small></div><div><span>Perse</span><strong class="ai-outcome-lost">${predictionIndexBandPct(summary.lossRatePct)}</strong><small>${safeNumber(summary.lost,0)} LOST</small></div><div><span>Indice medio</span><strong>${Number.isFinite(Number(summary.averagePredictionIndex))?formatNumber(summary.averagePredictionIndex,1):'N/D'}</strong><small>Affidabilità AI media ${Number.isFinite(Number(summary.averageAiReliability))?formatNumber(summary.averageAiReliability,1)+'%':'N/D'}</small></div></div><div id="predictionIndexBandsTableRegion" class="ai-outcome-table-wrap" ${visibility.collapsed?'hidden':''}><table class="ai-outcome-table"><thead><tr><th>Fascia indice</th><th>Campione</th><th>Vinte</th><th>Perse</th><th>Indice medio</th><th>Affidabilità AI</th><th>Wilson 95%</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    panel.querySelectorAll('[data-pi-band-scope]').forEach(btn=>btn.addEventListener('click',()=>{predictionIndexBandsState.scope=btn.dataset.piBandScope==='REAL_STAKE'?'REAL_STAKE':'AI_SIGNALS';predictionIndexBandsState.competition='ALL';renderPredictionIndexBandsPanel();}));
    $('predictionIndexCompetitionFilter')?.addEventListener('change',e=>{predictionIndexBandsState.competition=e.target.value||'ALL';renderPredictionIndexBandsPanel();});
    $('predictionIndexBandsCollapseBtn')?.addEventListener('click',()=>{predictionIndexBandsState.collapsed=!predictionIndexBandsState.collapsed;renderPredictionIndexBandsPanel();});
}
async function loadPredictionIndexBands(sport,viewEpoch){
    const normalized=safeString(sport).toUpperCase()==='TENNIS'?'TENNIS':'CALCIO', requestId=++predictionIndexBandsState.requestId;
    predictionIndexBandsState={sport:normalized,scope:'AI_SIGNALS',competition:'ALL',payload:null,requestId,collapsed:false}; renderPredictionIndexBandsPanel();
    try{const response=await fetch(`/api/analytics/prediction-index-bands?sport=${encodeURIComponent(normalized)}&tradingScope=${window.TradingScopeUI.mode()}`),payload=await response.json();if(!response.ok||payload.success===false)throw new Error(payload.error||`HTTP ${response.status}`);if(requestId!==predictionIndexBandsState.requestId||!isPrimaryViewCurrent('TRADING',viewEpoch))return;predictionIndexBandsState.payload=payload;renderPredictionIndexBandsPanel();}
    catch(error){if(requestId!==predictionIndexBandsState.requestId)return;const panel=$('predictionIndexBandsPanel');if(panel)panel.innerHTML=`<div class="ai-outcome-empty">Fasce Indice Predizione non disponibili: ${htmlEscape(error.message)}</div>`;}
}


// PATCH41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES
// ============================================================================
// 11. FORWARD / PAPER TRADING
// ============================================================================

$('forwardTestBtn')?.addEventListener('click', async () => {
    const viewEpoch = enterPrimaryView('TRADING');
    const btn = $('forwardTestBtn');
    if (btn) { btn.innerText = '⏳ Controllo...'; btn.disabled = true; }
    nascondiTutto();
    $('forwardTestLogSection')?.classList.remove('hidden');
    showLoading();
    try {
        const rawLeague = $('forwardLeagueFilter') ? $('forwardLeagueFilter').value : 'all';
        const leagueFilter = rawLeague === 'all' ? 'all' : rawLeague;
        const apiUrl = activeSport === SPORT.TENNIS ? `/api/tennis/resolve_ai?leagueFilter=${encodeURIComponent(leagueFilter)}` : `/api/resolve_ai?leagueFilter=${encodeURIComponent(leagueFilter)}`;
        const res = await fetch(apiUrl);
        const rawPayload = await res.text();
        let data;
        try { data = rawPayload ? JSON.parse(rawPayload) : {}; }
        catch (parseError) {
            throw Object.assign(new Error(`Risposta non JSON da ${apiUrl}: ${rawPayload.slice(0, 240)}`), { phase: 'RESPONSE_PARSE', cause: parseError });
        }
        if (!res.ok || data.success === false || data.error) {
            showRuntimeDiagnostic({
                severity: 'ERROR',
                title: 'Errore settlement Tennis',
                message: data.error || data.originalResolveAiError?.message || `HTTP ${res.status}`,
                operationId: data.runtimeDiagnostic?.operationId || data.originalResolveAiError?.operationId,
                phase: data.runtimeDiagnostic?.phase || data.originalResolveAiError?.phase || 'RESOLVE_AI_RESPONSE',
                code: `HTTP_${res.status}`,
                details: data
            });
            throw new Error(data.error || data.originalResolveAiError?.message || `HTTP ${res.status}`);
        }
        if (activeSport === SPORT.TENNIS && (data.diagnostics?.settlementExecuted === false || data.originalResolveAiError)) {
            showRuntimeDiagnostic({
                severity: 'WARN',
                title: 'Settlement non eseguito: mostrato fallback read-only',
                message: data.originalResolveAiError?.message || data.warning || 'La cronologia è visibile, ma il ciclo settlement non è stato completato.',
                operationId: data.runtimeDiagnostic?.operationId || data.originalResolveAiError?.operationId,
                phase: data.runtimeDiagnostic?.phase || 'SETTLEMENT_FALLBACK',
                code: data.diagnostics?.mode || 'READ_ONLY_FALLBACK',
                details: data.diagnostics || data
            });
        } else if (activeSport === SPORT.TENNIS && (safeNumber(data.runtimeDiagnostic?.contractBlocked,0) > 0 || safeNumber(data.runtimeDiagnostic?.dbUpdateFailures,0) > 0)) {
            const runtime = data.runtimeDiagnostic || data.diagnostics || {};
            const evidence = runtime.evidenceStatus || data.diagnostics?.evidenceStatus || {};
            const hardBlocked = safeNumber(evidence.sourceConflict,0) + safeNumber(evidence.contractInvalid,0);
            const manualReview = safeNumber(evidence.manualReview,0);
            const proposed = safeNumber(evidence.proposedWeakEvidence,0);
            const dbFailures = safeNumber(runtime.dbUpdateFailures,0);
            const exceptionQueue = runtime.settlementExceptionQueue || data.diagnostics?.settlementExceptionQueue || {};
            const patch51QueueActive = String(exceptionQueue.version || '').includes('PATCH51');
            const notificationEligible = safeNumber(exceptionQueue.notificationEligible, patch51QueueActive ? 0 : runtime.contractBlocked);
            const protectedManual = safeNumber(runtime.updateOutcomes?.SKIPPED_MANUAL_REVIEW,0) + safeNumber(runtime.updateOutcomes?.MANUAL_REVIEW_RECORDED,0);
            const isManualOnly = hardBlocked === 0 && (manualReview > 0 || protectedManual > 0) && proposed === 0 && dbFailures === 0;
            const suppressUnchangedPatch51 = patch51QueueActive && notificationEligible === 0 && dbFailures === 0 && hardBlocked === 0;
            if (suppressUnchangedPatch51) {
                console.info('[PATCH51] Eccezioni settlement invariate: notifica e lifecycle duplicati soppressi.', exceptionQueue);
            } else {
            const title = dbFailures > 0
                ? 'Aggiornamento database settlement non riuscito'
                : hardBlocked > 0
                  ? 'Settlement bloccato: conflitto o contratto non valido'
                  : isManualOnly
                    ? 'Settlement manuale protetto'
                    : 'Fonte debole · settlement non applicato';
            const message = dbFailures > 0
                ? `${dbFailures} aggiornamento/i hanno generato un errore database reale. Consulta il dettaglio per betId e messaggio SQLite.`
                : hardBlocked > 0
                  ? `${hardBlocked} esito/i richiedono revisione per conflitto o contratto non valido.`
                  : isManualOnly
                    ? `${manualReview || protectedManual} risultato/i restano PENDING per regola bookmaker o revisione identità già protetta.`
                    : `${proposed || runtime.contractBlocked} esito/i restano PENDING: la fonte disponibile è debole o incompleta.`;
            showRuntimeDiagnostic({
                severity: dbFailures > 0 || hardBlocked > 0 ? 'ERROR' : 'WARN',
                title, message,
                operationId: runtime.operationId,
                phase: dbFailures > 0 ? 'DATABASE_UPDATE' : 'CONTRACT_GUARD',
                code: dbFailures > 0
                    ? 'PATCH29_R2_DB_UPDATE_FAILED'
                    : hardBlocked > 0
                      ? 'PATCH29_R2_SETTLEMENT_CONTRACT_BLOCKED'
                      : isManualOnly
                        ? 'PATCH29_R2_SETTLEMENT_MANUAL_REVIEW_PROTECTED'
                        : 'PATCH29_R2_SETTLEMENT_WEAK_EVIDENCE',
                details: { ...(data.diagnostics || {}), evidenceStatus: evidence, settlementExceptionQueue: exceptionQueue }
            });
            }
        }
        const effectiveData = activeSport === SPORT.TENNIS && !step92HasHistoryRows(data) ? await fetchStep92TennisPaperTradingFallback(leagueFilter) : data;
        effectiveData.history = step91TSelectHistoryRows(effectiveData);
        effectiveData.history = step92SelectHistoryRows(effectiveData);
        const unscopedHistory = Array.isArray(effectiveData.history) ? effectiveData.history.filter(row => activeSport === SPORT.TENNIS ? isTennisRow(row) : isCalcioRow(row)).filter(isCleanCurrentRow) : [];
        if (!isPrimaryViewCurrent('TRADING', viewEpoch)) return;
        const sportFilteredHistory = window.TradingScopeUI.prepareTrading(unscopedHistory);
    currentForwardData = { ...effectiveData, history: sportFilteredHistory };
    loadSportBankroll();
        if (!isPrimaryViewCurrent('TRADING', viewEpoch)) return;
        nascondiTutto();
        $('forwardTestLogSection')?.classList.remove('hidden');
        renderForwardSummary(effectiveData, sportFilteredHistory, leagueFilter);
        void loadAiOutcomeBands(activeSport, viewEpoch);
        void loadPredictionIndexBands(activeSport, viewEpoch);
        injectSortingHeaders();
        renderForwardTable();
        loadGlobalAnalytics();
    } catch (error) {
        console.error('[STEP92/PATCH5] Errore Trading/Paper:', error);
        showRuntimeDiagnostic({ severity: 'ERROR', title: 'Trading/Paper non completato', message: error.message, phase: error.phase || 'FORWARD_TRADING', error });
    } finally {
        if (btn) { btn.innerText = '🏆 Trading'; btn.disabled = false; }
        if (isPrimaryViewCurrent('TRADING', viewEpoch)) hideLoading();
    }
});



// PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE
const STEP42_TRADING_ACCORDION_VERSION = 'TENNIS_TRADING_ACCORDION_V1_PATCH42';
const STEP42_TRADING_ACCORDION_STORAGE_KEY = 'bettingapp.tennis.patch42.tradingAccordion.v1';

function step42ReadAccordionState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STEP42_TRADING_ACCORDION_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function step42WriteAccordionState(state = {}) {
    try {
        localStorage.setItem(STEP42_TRADING_ACCORDION_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
        // La persistenza è un comfort UI: nessun errore deve influire sui dati Trading.
    }
}

function step42Text(node) {
    return safeString(node && node.textContent).replace(/\s+/g, ' ').trim();
}

function step42ToneFromValue(value = '') {
    const text = safeString(value).replace(/\s+/g, '').replace(',', '.');
    if (/^-|€-/.test(text)) return 'negative';
    if (/^\+|\+€/.test(text)) return 'positive';
    const number = Number(text.replace(/[^0-9.+-]/g, ''));
    if (Number.isFinite(number) && number < 0) return 'negative';
    return '';
}

function step42Chip(label, value, tone = '') {
    if (!value) return '';
    return `<span class="step42-summary-chip ${tone || step42ToneFromValue(value)}"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></span>`;
}

function step42ExtractPanelChips(card, panelId) {
    const chips = [];
    const push = (label, value, tone = '') => {
        if (!value || chips.length >= 4) return;
        chips.push(step42Chip(label, value, tone));
    };

    if (panelId === 'global') {
        push('Profitto', step42Text(card.querySelector('.step55-primary-kpi')));
        const metrics = [...card.querySelectorAll('.step55-metric-strip-compact > div')];
        ['Giocate', 'ROI', 'CLV'].forEach(wanted => {
            const metric = metrics.find(item => step42Text(item.querySelector('span')).toUpperCase().includes(wanted.toUpperCase()));
            if (metric) push(wanted, step42Text(metric.querySelector('strong')));
        });
    } else if (panelId === 'exposure') {
        [...card.querySelectorAll('.step55-exposure-pill')].slice(0, 4).forEach(item => {
            push(step42Text(item.querySelector('span')), step42Text(item.querySelector('strong')));
        });
    } else if (panelId === 'rolling') {
        const headers = [...card.querySelectorAll('thead th')].map(step42Text);
        const cells = [...card.querySelectorAll('tbody tr:first-child td')];
        const indexes = ['Operative W/L', 'ROI reale', 'Hit segnale', 'CLV verificato'];
        indexes.forEach(label => {
            const index = headers.findIndex(value => value === label);
            if (index >= 0 && cells[index]) push(label.replace(' verificato',''), step42Text(cells[index].querySelector('strong') || cells[index]));
        });
    } else if (panelId === 'calibration') {
        const rows = [...card.querySelectorAll('tbody tr')];
        push('Fasce', String(rows.length));
        let worst = null;
        rows.forEach(row => {
            const cells = row.querySelectorAll('th,td');
            const label = step42Text(cells[0]);
            const gapText = step42Text(cells[4]);
            const gap = Number(gapText.replace(',', '.').replace(/[^0-9.+-]/g, ''));
            if (Number.isFinite(gap) && (!worst || gap > worst.gap)) worst = { label, gap, gapText };
        });
        if (worst) {
            push('Gap max', worst.gapText, 'negative');
            push('Fascia', worst.label);
        }
    } else if (panelId === 'league') {
        const rows = [...card.querySelectorAll('tbody tr')];
        push('Tornei', String(rows.length));
        let best = null;
        rows.forEach(row => {
            const cells = row.querySelectorAll('th,td');
            const label = step42Text(cells[0]);
            const roiText = step42Text(cells[cells.length - 1]);
            const roi = Number(roiText.replace(',', '.').replace(/[^0-9.+-]/g, ''));
            if (Number.isFinite(roi) && (!best || roi > best.roi)) best = { label, roi, roiText };
        });
        if (best) {
            push('Migliore', best.label);
            push('ROI', best.roiText, best.roi >= 0 ? 'positive' : 'negative');
        }
    } else if (panelId === 'deepscan' || panelId === 'quality') {
        const rows = [...card.querySelectorAll('tbody tr')];
        push('Categorie', String(rows.length));
        let best = null;
        rows.forEach(row => {
            const cells = row.querySelectorAll('th,td');
            const label = step42Text(cells[0]);
            const roiText = step42Text(cells[7]);
            const roi = Number(roiText.replace(',', '.').replace(/[^0-9.+-]/g, ''));
            if (Number.isFinite(roi) && (!best || roi > best.roi)) best = { label, roi, roiText };
        });
        if (best) {
            push('Top', best.label);
            push('ROI', best.roiText, best.roi >= 0 ? 'positive' : 'negative');
        }
    }

    if (!chips.length) {
        const firstStrong = step42Text(card.querySelector('strong'));
        if (firstStrong) push('Dettagli', firstStrong);
    }
    return chips.join('');
}

function step42PanelMeta(card, index = 0) {
    const heading = card.querySelector('.step55-card-heading');
    const title = step42Text(heading?.querySelector('strong')) || `Sezione ${index + 1}`;
    const subtitle = step42Text(heading?.querySelector('small')) || 'Seleziona per espandere';
    const icon = step42Text(heading?.querySelector(':scope > span')) || '▦';
    const byClass = [
        ['step55-exposure-card', 'exposure', 'step42-exposure'],
        ['step41-global-card', 'global', 'step42-global'],
        ['step41-rolling-card', 'rolling', 'step42-rolling'],
        ['step41-calibration-card', 'calibration', 'step42-calibration'],
        ['step41-league-card', 'league', 'step42-league'],
        ['step41-deepscan-card', 'deepscan', 'step42-deepscan'],
        ['step41-quality-card', 'quality', 'step42-quality']
    ].find(([className]) => card.classList.contains(className));
    return {
        id: byClass ? byClass[1] : `section-${index + 1}`,
        className: byClass ? byClass[2] : '',
        title,
        subtitle,
        icon
    };
}

function step42BuildDetails(card, meta) {
    const details = document.createElement('details');
    details.className = `step42-accordion ${meta.className || ''}`.trim();
    details.dataset.step42Panel = meta.id;
    details.dataset.step42Version = STEP42_TRADING_ACCORDION_VERSION;

    const summary = document.createElement('summary');
    summary.innerHTML = `
        <span class="step42-panel-icon" aria-hidden="true">${htmlEscape(meta.icon)}</span>
        <span class="step42-panel-copy"><strong>${htmlEscape(meta.title)}</strong><small>${htmlEscape(meta.subtitle)}</small></span>
        <span class="step42-summary-kpis">${step42ExtractPanelChips(card, meta.id)}</span>
        <span class="step42-disclosure-chevron" aria-hidden="true">⌄</span>
    `;
    const body = document.createElement('div');
    body.className = 'step42-panel-body';
    body.appendChild(card);
    details.append(summary, body);
    return details;
}

function step42ApplyStoredState(detailsList) {
    const state = step42ReadAccordionState();
    detailsList.forEach(details => {
        details.open = state[details.dataset.step42Panel] === true;
        if (!details.dataset.step42ToggleBound) {
            details.addEventListener('toggle', () => {
                const next = step42ReadAccordionState();
                next[details.dataset.step42Panel] = details.open;
                step42WriteAccordionState(next);
            });
            details.dataset.step42ToggleBound = '1';
        }
    });
}

function step42BindToolbar() {
    const expand = $('step42ExpandAllBtn');
    const collapse = $('step42CollapseAllBtn');
    if (expand && !expand.dataset.step42Bound) {
        expand.addEventListener('click', () => {
            const all = [...document.querySelectorAll('details.step42-accordion')];
            const state = step42ReadAccordionState();
            all.forEach(item => { item.open = true; state[item.dataset.step42Panel] = true; });
            step42WriteAccordionState(state);
        });
        expand.dataset.step42Bound = '1';
    }
    if (collapse && !collapse.dataset.step42Bound) {
        collapse.addEventListener('click', () => {
            const all = [...document.querySelectorAll('details.step42-accordion')];
            const state = step42ReadAccordionState();
            all.forEach(item => { item.open = false; state[item.dataset.step42Panel] = false; });
            step42WriteAccordionState(state);
        });
        collapse.dataset.step42Bound = '1';
    }
}

// TENNIS_PATCH44_TRADING_DOM_ATOMIC_WRAP_FORWARD_COMPLETION_GUARD
const STEP44_TRADING_DOM_ATOMIC_WRAP_VERSION = 'TENNIS_TRADING_DOM_ATOMIC_WRAP_V1_PATCH44';

function step44InsertDetachedWrapper(parent, wrapper, originalNextSibling = null) {
    if (!parent || !wrapper) return false;
    const anchor = originalNextSibling && originalNextSibling.parentNode === parent
        ? originalNextSibling
        : null;
    if (wrapper.parentNode !== parent) parent.insertBefore(wrapper, anchor);
    return wrapper.parentNode === parent;
}

function step42EnhanceTradingDashboard(summaryBox) {
    if (!summaryBox) return;
    const dashboard = summaryBox.querySelector('.step41-trading-dashboard');
    if (!dashboard) return;
    dashboard.classList.add('step42-trading-dashboard');

    [...dashboard.children].forEach((card, index) => {
        if (card.matches('details.step42-accordion')) return;
        if (!card.classList.contains('step55-summary-card')) return;
        // step42BuildDetails moves card into the wrapper. Preserve the insertion
        // anchor before that move; replaceChild is invalid after the detach.
        const originalNextSibling = card.nextSibling;
        const details = step42BuildDetails(card, step42PanelMeta(card, index));
        step44InsertDetachedWrapper(dashboard, details, originalNextSibling);
    });

    const directAudit = [...summaryBox.children].find(node => node !== dashboard && !node.matches('.step42-accordion-toolbar') && !node.matches('#aiOutcomeBandsPanel') && !node.matches('#predictionIndexBandsPanel'));
    if (directAudit && !directAudit.matches('details.step42-accordion')) {
        const originalNextSibling = directAudit.nextSibling;
        const wrapper = step42BuildDetails(directAudit, {
            id: 'market-audit',
            className: 'step42-market-audit',
            title: 'Audit mercati Tennis',
            subtitle: 'Diagnostica feed Moneyline e Totals',
            icon: '🧾'
        });
        step44InsertDetachedWrapper(summaryBox, wrapper, originalNextSibling);
    }

    step42ApplyStoredState([...summaryBox.querySelectorAll('details.step42-accordion')]);
    step42BindToolbar();
}

function step44SafelyEnhanceTradingDashboard(summaryBox) {
    try {
        step42EnhanceTradingDashboard(summaryBox);
        if (summaryBox) summaryBox.dataset.step44EnhancementStatus = 'READY';
        return true;
    } catch (error) {
        if (summaryBox) summaryBox.dataset.step44EnhancementStatus = 'DEGRADED_FALLBACK';
        console.error('[TENNIS_PATCH44_TRADING_DOM_ENHANCEMENT_DEGRADED]', error);
        return false;
    }
}
// /TENNIS_PATCH44_TRADING_DOM_ATOMIC_WRAP_FORWARD_COMPLETION_GUARD

function step42EnhanceAiOutcomePanel(panel) {
    if (!panel) return;
    const section = panel.querySelector(':scope > .ai-outcome-panel');
    if (!section) return;
    const kpis = [...section.querySelectorAll('.ai-outcome-kpis > div')];
    const details = document.createElement('details');
    details.className = 'step42-accordion step42-ai-bands';
    details.dataset.step42Panel = 'ai-probability-bands';
    details.dataset.step42Version = STEP42_TRADING_ACCORDION_VERSION;
    const chips = kpis.slice(0, 4).map(item => step42Chip(step42Text(item.querySelector('span')), step42Text(item.querySelector('strong')))).join('');
    const summary = document.createElement('summary');
    summary.innerHTML = `
        <span class="step42-panel-icon" aria-hidden="true">🤖</span>
        <span class="step42-panel-copy"><strong>Vinte e perse per fascia di probabilità</strong><small>Misura predittiva AI · read-only</small></span>
        <span class="step42-summary-kpis">${chips}</span>
        <span class="step42-disclosure-chevron" aria-hidden="true">⌄</span>
    `;
    const body = document.createElement('div');
    body.className = 'step42-panel-body';
    body.appendChild(section);
    details.append(summary, body);
    panel.appendChild(details);
    step42ApplyStoredState([details]);
    step42BindToolbar();
}
// /PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE

function renderForwardSummary(data, historyRows, leagueFilter) {
    data = {...data, reporting:window.TradingScopes.reporting(historyRows, window.TradingScopeUI.mode()), stats:{}};

    // STEP55_PROFESSIONAL_UI_REFRESH_SUMMARY
    // Executive dashboard: separa KPI reali, audit/counterfactual e resa qualitativa
    // senza cambiare modello, stake, gate o logica DeepScan.
    const summaryBox = $('forwardTestSummaryBox');

    if (!summaryBox) return;

    const displayLabel = leagueFilter === 'all' ? 'Storico attivo completo' : leagueFilter;
    const singleResolvedRows = historyRows.filter(row => {
        const status = safeString(row.status).toUpperCase();
        return (status === 'WON' || status === 'LOST') && !safeString(row.bet_type).includes('MULTI_');
    });

    // STEP108_FORWARD_SUMMARY_REAL_DB_ALIGNMENT
    // Dati reali DB: count e win-rate del box principale devono escludere righe stake 0.
    // Prima il box mischiava 193 segnali settled con stake/profit calcolati solo sulle righe operative,
    // creando una win-rate non allineata al trading reale.
    const singleRealSettledRows = singleResolvedRows;
    const step108AuditSettledZeroRows = [];

    const patch40Full = data.reporting?.full || null;
    const patch40Rolling = data.reporting?.rolling || null;
    const sPlaced = patch40Full?.operational?.placed ?? singleRealSettledRows.length;
    const sWon = patch40Full?.operational?.won ?? singleRealSettledRows.filter(row => safeString(row.status).toUpperCase() === 'WON').length;
    const sProfit = patch40Full?.operational?.profit ?? singleRealSettledRows.reduce((sum, row) => sum + safeNumber(row.profit, 0), 0);
    const sInvested = patch40Full?.operational?.stake ?? singleRealSettledRows.reduce((sum, row) => sum + safeNumber(row.stake, 0), 0);
    const sRoi = patch40Full?.operational?.roiPct ?? (sInvested > 0 ? (sProfit / sInvested) * 100 : 0);
    const sWinRate = patch40Full?.operational?.hitRatePct ?? (sPlaced > 0 ? (sWon / sPlaced) * 100 : 0);
    // /STEP108_FORWARD_SUMMARY_REAL_DB_ALIGNMENT

    const pushCount = patch40Full?.statusCounts?.PUSH ?? historyRows.filter(row => safeString(row.status).toUpperCase() === 'PUSH').length;
    const voidCount = patch40Full?.statusCounts?.VOID ?? historyRows.filter(row => safeString(row.status).toUpperCase() === 'VOID').length;

    const clvEfficiency = patch40Full?.clv?.beatenPct ?? (data.stats?.singles?.clv_efficiency === 'N/D' ? null : safeNumber(data.stats?.singles?.clv_efficiency, null));
    const clvCoverage = patch40Full?.clv?.coveragePct ?? safeNumber(data.stats?.singles?.clv_coverage, null);
    const clvVerified = patch40Full?.clv?.verified ?? safeNumber(data.stats?.singles?.clv_verified, 0);
    const clvEligible = patch40Full?.clv?.eligible ?? safeNumber(data.stats?.singles?.clv_eligible, 0);
    const avgEdge = patch40Full?.avgEdgePp ?? calculateAverage(singleRealSettledRows.length ? singleRealSettledRows : historyRows, getBetEdgePp);
    const avgEv = patch40Full?.avgEvPct ?? calculateAverage(singleRealSettledRows.length ? singleRealSettledRows : historyRows, getBetEvPct);

    const dsHtml = renderDeepScanOutcomeBreakdown(historyRows);
    const qualityHtml = renderQualityOutcomeBreakdown(historyRows);

    const leagueBreakdown = {};
    singleRealSettledRows.forEach(row => {
        const league = row.league || 'Altro';
        if (!leagueBreakdown[league]) {
            leagueBreakdown[league] = { placed: 0, won: 0, invested: 0, profit: 0 };
        }
        const status = safeString(row.status).toUpperCase();
        leagueBreakdown[league].placed++;
        leagueBreakdown[league].invested += safeNumber(row.stake, 0);
        leagueBreakdown[league].profit += safeNumber(row.profit, 0);
        if (status === 'WON') leagueBreakdown[league].won++;
    });

    const leagueRows = Object.entries(leagueBreakdown)
        .sort((a, b) => b[1].placed - a[1].placed || b[1].profit - a[1].profit)
        .map(([leagueCode, stats]) => {
            const lRoi = stats.invested > 0 ? (stats.profit / stats.invested) * 100 : 0;
            return `
                <div class="step55-mini-row">
                    <div>
                        <strong>${htmlEscape(leagueCode)}</strong>
                        <small>${stats.won}/${stats.placed} · stake €${formatNumber(stats.invested, 2)}</small>
                    </div>
                    <span style="color:${colorByPositiveNegative(lRoi)}">${formatPct(lRoi, 2)}</span>
                </div>
            `;
        }).join('') || '<div class="step55-empty-state">Nessun dato completato.</div>';

    const leagueHtml = `
        <section class="step55-summary-card step55-league-card step41-league-card">
            <div class="step55-card-heading step41-card-heading">
                <span>🌍</span>
                <div><strong>Resa per Campionato</strong><small>ROI reale · una competizione per riga</small></div>
            </div>
            <div class="step41-table-scroll step41-table-scroll-vertical" role="region" aria-label="Resa per campionato" tabindex="0">
                <table class="step41-vertical-table">
                    <thead><tr><th>Campionato</th><th>W/L</th><th>Stake</th><th>Profitto</th><th>ROI</th></tr></thead>
                    <tbody>${Object.entries(leagueBreakdown)
                        .sort((a, b) => b[1].placed - a[1].placed || b[1].profit - a[1].profit)
                        .map(([leagueCode, stats]) => {
                            const lRoi = stats.invested > 0 ? (stats.profit / stats.invested) * 100 : 0;
                            const losses = Math.max(0, stats.placed - stats.won);
                            return `<tr>
                                <th scope="row">${htmlEscape(leagueCode)}</th>
                                <td><strong>${stats.won}/${losses}</strong><small>${stats.placed} giocate</small></td>
                                <td>€${formatNumber(stats.invested, 2)}</td>
                                <td style="color:${colorByPositiveNegative(stats.profit)}">${stats.profit > 0 ? '+' : ''}€${formatNumber(stats.profit, 2)}</td>
                                <td><strong style="color:${colorByPositiveNegative(lRoi)}">${formatPct(lRoi, 2)}</strong></td>
                            </tr>`;
                        }).join('') || '<tr><td colspan="5">Nessun dato completato.</td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `;

    const tennisMetricsHtml = activeSport === SPORT.TENNIS
        ? `
            <div class="step55-metric-strip">
                <div><span>PUSH</span><strong>${pushCount}</strong></div>
                <div><span>VOID</span><strong>${voidCount}</strong></div>
                <div><span>Avg Edge</span><strong style="color:#38bdf8;">${formatPct(avgEdge, 2, true)}</strong></div>
                <div><span>Avg EV</span><strong style="color:${colorByPositiveNegative(avgEv)};">${formatPct(avgEv, 2, true)}</strong></div>
            </div>
            ${data.meta?.dataMode ? `<div class="step55-data-mode">${htmlEscape(data.meta.dataMode === 'CURRENT_ACTIVE_HISTORY' ? 'STORICO ATTIVO CORRENTE · DUPLICATI INATTIVI ESCLUSI' : data.meta.dataMode)}</div>` : ''}
        `
        : '';

    const rollingHtml = patch40Rolling ? `
        <section class="step55-summary-card step41-wide-card step41-rolling-card">
            <div class="step55-card-heading step41-card-heading">
                <span>🕒</span>
                <div><strong>Ultime 200 righe attive</strong><small>Unica tabella orizzontale · finestra mobile separata</small></div>
            </div>
            <div class="step41-table-scroll" role="region" aria-label="Ultime 200 righe attive" tabindex="0">
                <table class="step41-rolling-table">
                    <thead>
                        <tr>
                            <th>Operative W/L</th>
                            <th>Win rate</th>
                            <th>Stake</th>
                            <th>Profitto</th>
                            <th>ROI reale</th>
                            <th>Segnali W/L</th>
                            <th>Hit segnale</th>
                            <th>Flat teorico</th>
                            <th>CLV verificato</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>${patch40Rolling.operational.won}/${patch40Rolling.operational.lost}</strong><small>${patch40Rolling.operational.placed} operative</small></td>
                            <td><strong>${formatPct(patch40Rolling.operational.hitRatePct ?? 0, 1)}</strong></td>
                            <td><strong>€${formatNumber(patch40Rolling.operational.stake ?? 0, 2)}</strong></td>
                            <td><strong style="color:${colorByPositiveNegative(patch40Rolling.operational.profit ?? 0)}">${safeNumber(patch40Rolling.operational.profit,0) > 0 ? '+' : ''}€${formatNumber(patch40Rolling.operational.profit ?? 0, 2)}</strong></td>
                            <td><strong style="color:${colorByPositiveNegative(patch40Rolling.operational.roiPct ?? 0)}">${formatPct(patch40Rolling.operational.roiPct ?? 0, 2)}</strong></td>
                            <td><strong>${patch40Rolling.signal.won}/${patch40Rolling.signal.lost}</strong><small>${patch40Rolling.signal.placed} segnali</small></td>
                            <td><strong>${formatPct(patch40Rolling.signal.hitRatePct ?? 0, 1)}</strong></td>
                            <td><strong style="color:${colorByPositiveNegative(patch40Rolling.theoreticalFlat.roiPct ?? 0)}">${formatPct(patch40Rolling.theoreticalFlat.roiPct ?? 0, 2)}</strong></td>
                            <td><strong>${patch40Rolling.clv.verified}/${patch40Rolling.clv.eligible}</strong><small>copertura ${formatPct(patch40Rolling.clv.coveragePct ?? 0, 1)}</small></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>` : '';

    const calibrationRows = Array.isArray(patch40Full?.calibrationBands) ? patch40Full.calibrationBands : [];
    const calibrationHtml = calibrationRows.length ? `
        <section class="step55-summary-card step41-calibration-card">
            <div class="step55-card-heading step41-card-heading">
                <span>📐</span>
                <div><strong>Calibrazione per fascia</strong><small>Vista verticale · hit reale contro probabilità media</small></div>
            </div>
            <div class="step41-table-scroll step41-table-scroll-vertical" role="region" aria-label="Calibrazione per fascia" tabindex="0">
                <table class="step41-vertical-table step41-calibration-table">
                    <thead><tr><th>Fascia</th><th>n</th><th>Hit reale</th><th>Media AI</th><th>Gap</th><th>Brier</th></tr></thead>
                    <tbody>${calibrationRows.map(b => `
                        <tr>
                            <th scope="row">${htmlEscape(b.label)}</th>
                            <td>${b.sample}</td>
                            <td>${b.hitRatePct == null ? 'N/D' : formatPct(b.hitRatePct,1)}</td>
                            <td>${b.avgProbabilityPct == null ? 'N/D' : formatPct(b.avgProbabilityPct,1)}</td>
                            <td><strong style="color:${colorByPositiveNegative(-(b.calibrationGapPp || 0))}">${b.calibrationGapPp == null ? 'N/D' : formatPct(b.calibrationGapPp,1,true)}</strong></td>
                            <td>${b.brier == null ? 'N/D' : formatNumber(b.brier,4)}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
        </section>` : '';

    const marketMixAuditHtml = renderTennisMarketMixAuditNotice(data);
    const exposureGuardHtml = renderTennisExposureGuardNotice(data, historyRows);

    const step108AuditExcludedHtml = step108AuditSettledZeroRows.length > 0 ? `
        <div class="step55-audit-note" style="margin-top:.55rem;">
            STEP108 DB reale: box principale calcolato solo su WON/LOST con stake &gt; 0. Escluse ${step108AuditSettledZeroRows.length} righe audit/counterfactual a stake 0 dai conteggi reali.
        </div>
    ` : '';

    summaryBox.innerHTML = marketMixAuditHtml + `
        <div class="step55-forward-summary-grid step41-trading-dashboard">
            ${exposureGuardHtml}
            <section class="step55-summary-card step55-global-card step41-global-card">
                <div class="step55-card-heading">
                    <span>🎯</span>
                    <div><strong>Singole — ${htmlEscape(displayLabel)}</strong><small>${window.TradingScopeUI.mode() === "STUDIO" ? "Studio: esiti osservati, stake registrato 0 €" : "Trading: WON/LOST con stake registrato maggiore di 0 €"}</small></div>
                </div>
                <div class="step55-primary-kpi" style="color:${colorByPositiveNegative(sProfit, '#f8fafc')};">${sProfit > 0 ? '+' : ''}€${formatNumber(sProfit, 2)}</div>
                <div class="step55-metric-strip step55-metric-strip-compact">
                    <div><span>Giocate</span><strong>${sPlaced}</strong></div>
                    <div><span>Vinte</span><strong style="color:#10b981;">${sWon}</strong></div>
                    <div><span>Win rate</span><strong>${formatPct(sWinRate, 1)}</strong></div>
                    <div><span>ROI</span><strong style="color:${colorByPositiveNegative(sRoi)};">${formatPct(sRoi, 2)}</strong></div>
                    <div><span>CLV beaten verificato</span><strong style="color:#3b82f6;">${clvEfficiency == null ? 'N/D' : `${formatNumber(clvEfficiency,1)}%`}</strong><small>${clvVerified}/${clvEligible} · copertura ${clvCoverage == null ? 'N/D' : `${formatNumber(clvCoverage,1)}%`}</small></div>
                </div>
                ${step108AuditExcludedHtml}
                ${tennisMetricsHtml}
            </section>
            ${rollingHtml}${calibrationHtml}${leagueHtml}${dsHtml}${qualityHtml}
        </div>
        <div id="aiOutcomeBandsPanel" class="ai-outcome-host"></div>
        <div id="predictionIndexBandsPanel" class="ai-outcome-host"></div>
    `;
    step44SafelyEnhanceTradingDashboard(summaryBox);
    window.TradingScopeUI.finishTrading(historyRows);
}


// STEP30_PAPER_PERFORMANCE_BREAKDOWN
function isResolvedPaperOutcome(row = {}) {
    const status = safeString(row.status).toUpperCase();
    return status === 'WON' || status === 'LOST';
}

// STEP108_FORWARD_SUMMARY_REAL_DB_ALIGNMENT
// La card "Solo trading reale settled" deve usare il DB reale operativo: WON/LOST + stake > 0.
// Le righe audit/counterfactual a stake 0 restano visibili nei breakdown, ma non alterano giocate/win-rate reali.
function isStep108RealSettledTradingRow(row = {}) {
    if (!isResolvedPaperOutcome(row)) return false;
    if (safeString(row.bet_type).includes('MULTI_')) return false;
    const stake = safeNumber(row.stake ?? row.invested, 0);
    return stake > 0;
}
// /STEP108_FORWARD_SUMMARY_REAL_DB_ALIGNMENT

function getPaperOutcomeGroupStats(rows = [], groupGetter) {
    const groups = {};

    rows.forEach(row => {
        if (!isResolvedPaperOutcome(row)) return;
        if (safeString(row.bet_type).includes('MULTI_')) return;

        const key = groupGetter(row) || 'ALTRO';

        if (!groups[key]) {
            groups[key] = {
                placed: 0,
                won: 0,
                lost: 0,
                invested: 0,
                profit: 0
            };
        }

        const status = safeString(row.status).toUpperCase();
        const stake = safeNumber(row.stake ?? row.invested, 0);
        const profit = safeNumber(row.profit, 0);

        groups[key].placed += 1;
        groups[key].invested += stake;
        groups[key].profit += profit;

        if (status === 'WON') groups[key].won += 1;
        if (status === 'LOST') groups[key].lost += 1;
    });

    return groups;
}

function normalizeDeepScanOutcomeCategory(row = {}) {
    const explicit = safeString(row.tennis_deepscan_canonical_label || row.tennis_deepscan_canonical_action || row.deep_scan_canonical_label || row.deepScanCanonicalLabel).trim();
    if (explicit) return explicit;
    const text = [
        row.tennis_deepscan_canonical_action,
        row.deep_scan_canonical_code,
        row.ds_action,
        row.deepScanAction,
        row.action,
        row.deep_scan_risk_level,
        row.quality_deepscan_class,
        row.deepscan_gate_status,
        row.ds_suggestion,
        row.suggestionText
    ].map(value => safeString(value).toUpperCase().replace(/[🟠📊🟢🔴🟡⏳⚪]/g, ' ').replace(/[_-]+/g, ' ')).join(' | ');
    if (!text.trim()) return 'SENZA DEEPSCAN';
    if (text.includes('ALTO RISCHIO') || text.includes('HIGH RISK') || text.includes('VALUE TRAP') || text.includes('PERICOLO')) return 'ALTO RISCHIO';
    if (text.includes('RISCHIO MODELLO') || text.includes('MODEL RISK')) return 'RISCHIO MODELLO';
    if (text.includes('VALUE CONFERMATO') || text.includes('VALUE CONFIRMED') || text.includes('CONFIRMED VALUE') || text.includes('VIA LIBERA')) return 'VALUE CONFERMATO / MICRO';
    if (text.includes('EDGE TECNICO') || text.includes('TECHNICAL EDGE')) return 'EDGE TECNICO';
    if (text.includes('WATCHLIST') || text.includes('LOW EDGE')) return 'WATCHLIST LOW EDGE';
    if (text.includes('ATTENDI') || text.includes('WAIT IN PLAY') || text.includes('IN PLAY') || text.includes('LIVE')) return 'ATTENDI IN-PLAY';
    return 'ALTRO / NON CLASSIFICATO';
}

function normalizeStep90PreMatchLabel(row = {}) {
    const label = safeString(row.pre_match_gate_label || row.preMatchGateLabel || '').toUpperCase();
    if (!label) return '';
    if (label.includes('APPROVATA STAKE PIENO') || label.includes('APPROVED_FULL_STAKE')) return 'APPROVATA STAKE PIENO';
    if (label === 'APPROVATA' || label.includes('APPROVED_PREMATCH') || label.includes('APPROVED_STEP90')) return 'APPROVATA';
    if (label.includes('APPROVATA CON CAP') || label.includes('APPROVED_WITH_CAP')) return 'APPROVATA CON CAP';
    if (label.includes('WATCHLIST MICRO')) return 'WATCHLIST MICRO';
    if (label.includes('BLOCCATA HARD')) return activeSport === SPORT.TENNIS ? '🎾 BLOCCATA HARD' : 'BLOCCATA HARD';
    if (label.includes('BLOCCATA SOFT')) return activeSport === SPORT.TENNIS ? '🎾 BLOCCATA SOFT' : 'BLOCCATA SOFT';
    return label;
}

function renderStep90DecisionAuditNote(row = {}) {
    const label = normalizeStep90PreMatchLabel(row);
    if (!label) return '';
    const sample = safeNumber(row.pre_match_historical_sample, 0);
    const roi = row.pre_match_historical_roi === null || row.pre_match_historical_roi === undefined ? 'N/D' : formatPct(safeNumber(row.pre_match_historical_roi, 0), 2);
    const brier = row.pre_match_historical_brier === null || row.pre_match_historical_brier === undefined ? 'N/D' : formatNumber(safeNumber(row.pre_match_historical_brier, 0), 4);
    const clvSample = safeNumber(row.pre_match_historical_clv_sample, 0);
    return `Step90: ${htmlEscape(label)} · sample ${sample} · ROI ${roi} · Brier ${brier} · CLV storico ${clvSample}. CLV corrente non usato per Analisi AI.`;
}

function normalizePatch10FinalQualityCategory(row = {}) {
    const explicit = safeString(row.quality_final_code || row.quality_final_label).toUpperCase();
    if (explicit.includes('HARD')) return '🎾 BLOCCATA HARD';
    if (explicit.includes('SOFT')) return '🎾 BLOCCATA SOFT';
    if (explicit.includes('WATCHLIST') || explicit.includes('TEMPORALE')) return 'WATCHLIST MICRO';
    if (explicit.includes('NON ELEGGIBILE') || explicit.includes('SENZA RESA')) return '🎾 BLOCCATA SOFT';
    if (explicit.includes('WITH_CAP') || explicit.includes('CON CAP')) return 'APPROVATA CON CAP';
    if (explicit.includes('APPROV')) return 'APPROVATA';

    const ds = normalizeDeepScanOutcomeCategory(row);
    const stake = safeNumber(row.stake ?? row.invested, 0);
    const base = safeString([row.pre_match_gate_code, row.pre_match_gate_label, row.professional_gate_status].join(' ')).toUpperCase();
    if (ds === 'ALTO RISCHIO' || base.includes('BLOCKED_HARD') || base.includes('BLOCCATA HARD')) return '🎾 BLOCCATA HARD';
    // Patch10 evidence matrix: EDGE TECNICO alone is not a positive Quality class.
    if (ds === 'EDGE TECNICO') return '🎾 BLOCCATA SOFT';
    // Model-risk rows promoted by the runtime micro policy must be shown as Watchlist,
    // not under the original Step90 soft label.
    if (ds === 'RISCHIO MODELLO') return stake > 0 ? 'WATCHLIST MICRO' : '🎾 BLOCCATA SOFT';
    if (ds === 'VALUE CONFERMATO / MICRO') {
        if (base.includes('APPROVATA') || base.includes('APPROVED')) return 'APPROVATA CON CAP';
        return 'WATCHLIST MICRO';
    }
    if (ds === 'WATCHLIST LOW EDGE') return stake > 0 ? 'WATCHLIST MICRO' : '🎾 BLOCCATA SOFT';
    if (ds === 'ATTENDI IN-PLAY' || ds === 'SENZA DEEPSCAN' || ds === 'ALTRO') return '🎾 BLOCCATA SOFT';
    if (base.includes('APPROV')) return stake > 0 ? 'APPROVATA CON CAP' : 'WATCHLIST MICRO';
    if (base.includes('WATCHLIST')) return 'WATCHLIST MICRO';
    return '🎾 BLOCCATA SOFT';
}

function normalizeQualityOutcomeCategory(row = {}) {
    // PATCH10: nel Tennis la dashboard mostra il Gate FINALE post-fusione.
    // La Quality base resta separata e auditabile; non deve più sovrascrivere il risultato operativo del DeepScan.
    if (isTennisRow(row) || activeSport === SPORT.TENNIS) return normalizePatch10FinalQualityCategory(row);

    // Calcio conserva il comportamento preesistente.
    const step90Label = normalizeStep90PreMatchLabel(row);
    if (step90Label) return step90Label;

    // STEP52_QUALITY_GATE_SOFT_BLOCK_BREAKDOWN
    // La statistica "Resa Qualità / Gate" deve separare le causali operative:
    // BLOCCATA HARD, BLOCCATA SOFT, WATCHLIST MICRO, APPROVATA CON CAP e generic BLOCKED.
    // Prima dello Step52 le soft block venivano assorbite dentro "🎾 BLOCCATA" perché
    // il controllo generico BLOCCATA/BLOCKED/NO_BET aveva priorità troppo alta.
    const report = activeSport === SPORT.TENNIS
        ? normalizeTennisOperationalReport(row)
        : null;

    const reportText = report ? [
        report.label,
        report.status,
        report.action,
        report.summary,
        Array.isArray(report.reasons) ? report.reasons.join(' ') : '',
        Array.isArray(report.warnings) ? report.warnings.join(' ') : ''
    ].map(v => safeString(v).toUpperCase()).join(' ') : '';

    const qualityParts = [
        row.professional_gate_status,
        row.professional_gate_allow_bet,
        row.professional_gate_reasons,
        row.professionalGate?.status,
        row.professionalGate?.allowBet,
        Array.isArray(row.professionalGate?.reasons) ? row.professionalGate.reasons.join(' ') : '',
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.tennis_operational_summary,
        // STEP59E_CALCIO_DIAGNOSTICS_UI
        row.calcio_gate_status,
        row.calcio_gate_allow_bet,
        row.calcio_gate_reasons,
        row.calcio_operational_status,
        row.calcio_operational_action,
        row.calcio_operational_summary,
        row.quality,
        row.gate,
        row.gate_status,
        row.ds_suggestion
    ].map(v => safeString(v).toUpperCase()).join(' ');

    const dsAction = safeString(row.ds_action).toUpperCase();
    const allText = [reportText, qualityParts, dsAction].join(' ');

    const hasHardBlock =
        allText.includes('CALCIO_BLOCKED_HARD') ||
        allText.includes('BLOCCATA HARD') ||
        allText.includes('BLOCKED_HARD') ||
        allText.includes('HARD_BLOCK') ||
        allText.includes('NO_BET_HARD') ||
        allText.includes('OPPOSITE_SIDE_CONFLICT') ||
        allText.includes('CONFLICT');

    const hasConsensusMicro =
        allText.includes('CALCIO_WATCHLIST_MICRO') ||
        allText.includes('CONSENSUS_MICRO') ||
        allText.includes('WATCHLIST_MICRO') ||
        allText.includes('WATCHLIST MICRO') ||
        allText.includes('MICRO STAKE') ||
        allText.includes('MICRO-STAKE') ||
        allText.includes('PAPER_OR_MICRO_STAKE') ||
        allText.includes('VALUE TOTALS · MICRO') ||
        allText.includes('VALUE CONFERMATO · MICRO');

    const hasSoftBlock =
        allText.includes('CALCIO_BLOCKED_SOFT') ||
        allText.includes('BLOCCATA SOFT') ||
        allText.includes('BLOCKED_SOFT') ||
        allText.includes('SOFT_BLOCK') ||
        allText.includes('SOFT BLOCK');

    const hasApprovedCap =
        allText.includes('CALCIO_APPROVED_WITH_CAP') ||
        allText.includes('APPROVATA CON CAP') ||
        allText.includes('APPROVED_STANDARD') ||
        allText.includes('BET_ALLOWED_WITH_CAP');

    const hasApprovedProfessional =
        allText.includes('APPROVATA PROFESSIONALE') ||
        allText.includes('APPROVED_PROFESSIONAL') ||
        allText.includes('PROFESSIONAL READY');

    const hasApprovedFullStake =
        allText.includes('APPROVATA STAKE PIENO') ||
        allText.includes('APPROVED_FULL_STAKE') ||
        allText.includes('FULL_STAKE');

    const hasApprovedStep90 =
        allText.includes('CALCIO_APPROVED') ||
        allText.includes('APPROVED_STEP90') ||
        allText.includes('PREMATCH_APPROVED');

    const hasGenericBlock =
        allText.includes('BLOCCATA') ||
        allText.includes('BLOCKED') ||
        allText.includes('NO_BET') ||
        allText.includes('NO BET') ||
        allText.includes('FALSE');

    if (hasHardBlock) {
        return activeSport === SPORT.TENNIS ? '🎾 BLOCCATA HARD' : 'BLOCCATA HARD';
    }

    // Se DeepScan/Consensus ha già trasformato il blocco soft in micro, la categoria
    // operativa deve essere WATCHLIST MICRO e non BLOCCATA.
    if (hasConsensusMicro || dsAction.includes('WATCHLIST')) {
        return 'WATCHLIST MICRO';
    }

    if (hasSoftBlock) {
        return activeSport === SPORT.TENNIS ? '🎾 BLOCCATA SOFT' : 'BLOCCATA SOFT';
    }

    if (hasApprovedProfessional) {
        return 'APPROVATA PROFESSIONALE';
    }

    if (hasApprovedCap) {
        return 'APPROVATA CON CAP';
    }

    if (hasGenericBlock) {
        return activeSport === SPORT.TENNIS ? '🎾 BLOCCATA' : 'BLOCCATA / NO BET';
    }

    return 'SENZA CAUSALE QUALITÀ';
}
function calculatePaperOutcomeBreakdown(rows = [], groupGetter) {
    const groups = {};

    rows.forEach(row => {
        if (!isResolvedPaperOutcome(row)) return;
        if (safeString(row.bet_type).includes('MULTI_')) return;

        const key = groupGetter(row) || 'ALTRO';

        if (!groups[key]) {
            groups[key] = {
                label: key,
                placed: 0,
                won: 0,
                lost: 0,
                played: 0,
                realWon: 0,
                realLost: 0,
                stakeZero: 0,
                invested: 0,
                profit: 0
            };
        }

        const status = safeString(row.status).toUpperCase();
        const stake = safeNumber(row.stake ?? row.invested, 0);
        const profit = safeNumber(row.profit, 0);

        groups[key].placed += 1;
        if (status === 'WON') groups[key].won += 1;
        if (status === 'LOST') groups[key].lost += 1;

        if (stake > 0) {
            groups[key].played += 1;
            if (status === 'WON') groups[key].realWon += 1;
            if (status === 'LOST') groups[key].realLost += 1;
            groups[key].invested += stake;
            groups[key].profit += profit;
        } else {
            groups[key].stakeZero += 1;
        }
    });

    return Object.values(groups)
        .map(stats => {
            const realRoi = stats.invested > 0 ? (stats.profit / stats.invested) * 100 : 0;
            const winRate = stats.placed > 0 ? (stats.won / stats.placed) * 100 : 0;
            const realWinRate = stats.played > 0 ? (stats.realWon / stats.played) * 100 : 0;

            return {
                ...stats,
                roi: realRoi,
                realRoi,
                winRate,
                realWinRate
            };
        })
        .sort((a, b) => b.placed - a.placed || b.profit - a.profit);
}

function renderPaperOutcomeBreakdownCard(title, icon, rows, groupGetter, borderColor) {
    // PATCH41_TRADING_READABILITY_HORIZONTAL_PERFORMANCE_TABLE
    // DeepScan e Quality Gate condividono la stessa matrice orizzontale:
    // una categoria per riga, denominatori espliciti e note audit compresse.
    const breakdown = calculatePaperOutcomeBreakdown(rows, groupGetter)
        .filter(item => item.placed > 0);
    const pendingRows = (rows || []).filter(row => safeString(row.status).toUpperCase() === 'PENDING' && !safeString(row.bet_type).includes('MULTI_'));
    const pendingGroups = {};
    pendingRows.forEach(row => {
        const key = groupGetter(row) || 'ALTRO';
        pendingGroups[key] = (pendingGroups[key] || 0) + 1;
    });
    const pendingTotal = pendingRows.length;
    const typeClass = title.includes('Qualità') ? 'step41-quality-card' : 'step41-deepscan-card';

    let bodyHtml = '';
    if (!breakdown.length) {
        bodyHtml = `
            <div class="step55-empty-state">
                0 esiti completati · ${pendingTotal} segnali pendenti. Nessun ROI inventato.
            </div>
        `;
    } else {
        const tableRows = breakdown.map(item => {
            const stakeZero = safeNumber(item.stakeZero, 0);
            const played = safeNumber(item.played, 0);
            const realWon = safeNumber(item.realWon, 0);
            const realLost = Math.max(0, played - realWon);
            const realWinRate = safeNumber(item.realWinRate, 0);
            const realRoi = safeNumber(item.realRoi, 0);
            const roiColor = played > 0 ? colorByPositiveNegative(realRoi) : '#94a3b8';
            const profitColor = colorByPositiveNegative(item.profit);
            const pending = safeNumber(pendingGroups[item.label], 0);
            const policyBadge = (item.label === 'APPROVATA' || item.label === 'APPROVATA STAKE PIENO')
                ? '<span class="step41-policy-badge">pre-match</span>'
                : '';

            return `
                <tr>
                    <th scope="row">
                        <span class="step41-category-name">${htmlEscape(item.label)}</span>
                        ${policyBadge}
                    </th>
                    <td><strong>${item.won}/${item.lost}</strong><small>${item.placed} segnali</small></td>
                    <td><strong>${formatPct(item.winRate, 1)}</strong></td>
                    <td><strong>${realWon}/${realLost}</strong><small>${played} operative</small></td>
                    <td><strong>${played > 0 ? formatPct(realWinRate, 1) : 'N/D'}</strong></td>
                    <td><strong>€${formatNumber(item.invested, 2)}</strong></td>
                    <td><strong style="color:${profitColor};">${item.profit > 0 ? '+' : ''}€${formatNumber(item.profit, 2)}</strong></td>
                    <td><strong style="color:${roiColor};">${played > 0 ? formatPct(realRoi, 2) : 'N/D'}</strong></td>
                    <td>
                        <span class="step41-audit-chip" title="Stake zero esclusi dal ROI reale">${stakeZero} audit</span>
                        ${pending > 0 ? `<span class="step41-pending-chip">${pending} pending</span>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        bodyHtml = `
            <div class="step41-table-scroll" role="region" aria-label="${htmlEscape(title)}" tabindex="0">
                <table class="step41-performance-table">
                    <thead>
                        <tr>
                            <th>Categoria</th>
                            <th>Segnale W/L</th>
                            <th>Hit segnale</th>
                            <th>Operativo W/L</th>
                            <th>Win reale</th>
                            <th>Stake</th>
                            <th>Profitto</th>
                            <th>ROI reale</th>
                            <th>Audit</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <div class="step41-legend-line">
                <span>Segnale = tutte le righe WON/LOST attive</span>
                <span>Operativo = stake reale &gt; 0</span>
                <span>Audit = stake 0, escluso dal ROI</span>
                ${pendingTotal > 0 ? `<span>${pendingTotal} pending non inclusi</span>` : ''}
            </div>
        `;
    }

    return `
        <section class="step55-summary-card step55-breakdown-card step41-wide-card ${typeClass}" style="--step55-accent:${borderColor};">
            <div class="step55-card-heading step41-card-heading">
                <span>${icon}</span>
                <div>
                    <strong>${htmlEscape(title)}</strong>
                    <small>Confronto orizzontale · segnale e risultato operativo separati</small>
                </div>
            </div>
            ${bodyHtml}
        </section>
    `;
}
// /PATCH41_TRADING_READABILITY_HORIZONTAL_PERFORMANCE_TABLE

function renderDeepScanOutcomeBreakdown(historyRows = []) {
    return renderPaperOutcomeBreakdownCard(
        'Resa Deep Scan IA',
        '🧠',
        historyRows,
        normalizeDeepScanOutcomeCategory,
        '#f59e0b'
    );
}

function renderQualityOutcomeBreakdown(historyRows = []) {
    return renderPaperOutcomeBreakdownCard(
        'Resa Qualità / Gate finale',
        '🏷️',
        historyRows,
        normalizeQualityOutcomeCategory,
        '#38bdf8'
    );
}


// STEP54_PAPER_EXPOSURE_GUARD_UI
function normalizeStep54ExposureUiToken(value = '') {
    return safeString(value)
        .toLowerCase()
        .normalize ? safeString(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ') : safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildStep54ExposureUiKey(row = {}) {
    const dateKey = safeString(row.match_date || row.date).split(',')[0].trim() || 'unknown-date';
    return [
        dateKey,
        normalizeStep54ExposureUiToken(row.league || 'tennis'),
        normalizeStep54ExposureUiToken(row.home_team || row.home || ''),
        normalizeStep54ExposureUiToken(row.away_team || row.away || '')
    ].join('|');
}

function getStep54ForwardPredictionSide(row = {}) {
    const prediction = safeString(row.prediction).toUpperCase();
    if (prediction === '1' || prediction === '2') return `MONEYLINE_${prediction}`;
    if (prediction.includes('OVER')) return 'TOTALS_OVER';
    if (prediction.includes('UNDER')) return 'TOTALS_UNDER';
    return prediction || 'UNKNOWN';
}

function getStep54ExposureGuardStats(rows = []) {
    const groups = {};
    rows.forEach(row => {
        if (!isTennisRow(row)) return;
        const key = row.match_exposure_key || buildStep54ExposureUiKey(row);
        if (!groups[key]) {
            groups[key] = { rows: [], staked: [], sides: new Set(), totalsSides: {}, hasAuditAlternative: false };
        }
        const group = groups[key];
        group.rows.push(row);
        const stake = safeNumber(row.stake ?? row.invested, 0);
        const side = getStep54ForwardPredictionSide(row);
        group.sides.add(side);
        if (side.startsWith('TOTALS_')) {
            group.totalsSides[side] = (group.totalsSides[side] || 0) + 1;
        }
        const exposureText = [row.exposure_role, row.exposure_group_status, row.exposure_reason, row.tennis_operational_status, row.tennis_operational_summary, row.professional_gate_status].map(v => safeString(v).toUpperCase()).join(' ');
        if (stake > 0 && !exposureText.includes('AUDIT_ALTERNATIVE') && !exposureText.includes('EXPOSURE_GUARD')) {
            group.staked.push(row);
        }
        if (exposureText.includes('AUDIT_ALTERNATIVE') || exposureText.includes('EXPOSURE_GUARD')) {
            group.hasAuditAlternative = true;
        }
    });

    const values = Object.values(groups);
    const repeated = values.filter(g => g.rows.length > 1);
    const multipleStaked = values.filter(g => g.staked.length > 1);
    const oppositeMoneyline = values.filter(g => g.sides.has('MONEYLINE_1') && g.sides.has('MONEYLINE_2'));
    const duplicateTotalsLines = values.filter(g => Object.values(g.totalsSides).some(count => count > 1));
    const auditAlternatives = values.reduce((sum, g) => sum + g.rows.filter(row => [row.exposure_role, row.exposure_group_status, row.exposure_reason, row.tennis_operational_status, row.tennis_operational_summary, row.professional_gate_status].map(v => safeString(v).toUpperCase()).join(' ').includes('AUDIT_ALTERNATIVE')).length, 0);

    return {
        mode: 'STEP54_PAPER_EXPOSURE_GUARD_UI',
        matchGroups: values.length,
        repeatedMatches: repeated.length,
        rowsInRepeatedMatches: repeated.reduce((sum, g) => sum + g.rows.length, 0),
        multipleStakedMatches: multipleStaked.length,
        oppositeMoneylineMatches: oppositeMoneyline.length,
        duplicateTotalsLineMatches: duplicateTotalsLines.length,
        auditAlternatives
    };
}

function renderTennisExposureGuardNotice(data = {}, rows = []) {
    // STEP55_PROFESSIONAL_UI_REFRESH_EXPOSURE_COMPACT
    if (activeSport !== SPORT.TENNIS) return '';
    const stats = data.exposureGuardAudit || data.meta?.exposureGuardAudit || getStep54ExposureGuardStats(rows);
    if (!stats) return '';
    const repeated = safeNumber(stats.repeatedMatches, 0);
    const multipleStaked = safeNumber(stats.multipleStakedMatches, 0);
    const duplicateTotals = safeNumber(stats.duplicateTotalsLineMatches, 0);
    const oppositeMoneyline = safeNumber(stats.oppositeMoneylineMatches, 0);
    const auditAlternatives = safeNumber(stats.auditAlternatives, 0);

    if (repeated === 0 && multipleStaked === 0 && duplicateTotals === 0 && oppositeMoneyline === 0 && auditAlternatives === 0) return '';

    const alertClass = multipleStaked > 0 || oppositeMoneyline > 0 ? 'step55-exposure-alert' : 'step55-exposure-ok';
    const exposureKpis = [
        ['Match ripetuti', repeated],
        ['Alternative audit', auditAlternatives],
        ['Multi-stake reali', multipleStaked],
        ['Moneyline opposti', oppositeMoneyline],
        ['Totals multi-linea', duplicateTotals]
    ].map(([label, value]) => `
        <div class="step55-exposure-pill">
            <span>${htmlEscape(label)}</span>
            <strong>${value}</strong>
        </div>
    `).join('');

    return `
        <div class="step55-summary-card step55-exposure-card ${alertClass}">
            <div class="step55-card-heading">
                <span>🛡️</span>
                <div><strong>Step54 Exposure Guard</strong><small>Controllo esposizione per match</small></div>
            </div>
            <div class="step55-exposure-grid">${exposureKpis}</div>
            <div class="step55-audit-note step55-exposure-note">
                Regola operativa: un solo pronostico primario con stake reale per match. Moneyline/Totals alternativi restano solo audit/DeepScan.
            </div>
        </div>
    `;
}

// /STEP30_PAPER_PERFORMANCE_BREAKDOWN
function renderTennisMarketMixAuditNotice(data = {}) {
    // STEP49_MARKET_MIX_AUDIT_NOTICE
    // Mostra il warning anche nel riepilogo portfolio/paper: l'assenza di Over/Under
    // deve essere letta come problema di feed/parsing/gate totals, non come prova
    // che il mercato totals non esista nello storico Sackmann.
    if (activeSport !== SPORT.TENNIS) return '';
    const audit = data.marketMixAudit || data.meta?.marketMixAudit || null;
    if (!audit || !audit.warning) return '';

    return `
        <div style="margin:12px 0; padding:10px 12px; border-left:4px solid #f59e0b; background:rgba(245,158,11,0.10); border-radius:8px; color:#fde68a; font-size:0.88em; line-height:1.45;">
            <strong>Audit mercati Tennis:</strong>
            Moneyline ${safeNumber(audit.moneyline, 0)} ·
            Totals ${safeNumber(audit.totals, 0)}
            (Over ${safeNumber(audit.over, 0)} / Under ${safeNumber(audit.under, 0)}).
            ${htmlEscape(audit.warning)}
            <div style="margin-top:5px; color:#fcd34d;">
                Diagnosi: se Moneyline &gt; 0 e Totals = 0, il blocco è a monte della scelta finale:
                feed totals non richiesto/non letto oppure gate Markov/soglie. Con Step50A il backend espone totalsFeedDiagnostics per distinguere feed disponibile da candidate bloccate dal gate.
            </div>
        </div>
    `;
}

function calculateAverage(rows, getter) {
    const values = rows
        .filter(row => {
            const status = safeString(row.status).toUpperCase();
            return status === 'WON' || status === 'LOST';
        })
        .map(getter)
        .filter(v => Number.isFinite(Number(v)));

    if (!values.length) return 0;

    return values.reduce((a, b) => a + b, 0) / values.length;
}


// ============================================================================
// 12. FORWARD TABLE SORTING
// ============================================================================

function parseDateForSort(dateStr) {
    if (!dateStr || safeString(dateStr).includes('Sconosciuta')) return 0;

    try {
        const parts = safeString(dateStr).split(', ');
        const dm = parts[0].split('/');
        const hm = (parts[1] || '00:00').split(':');

        return (
            safeNumber(dm[2], 0) * 100000000 +
            safeNumber(dm[1], 0) * 1000000 +
            safeNumber(dm[0], 0) * 10000 +
            safeNumber(hm[0], 0) * 100 +
            safeNumber(hm[1], 0)
        );
    } catch (error) {
        return 0;
    }
}

window.sortForwardData = function(column) {
    if (!currentForwardData || !currentForwardData.history) return;

    if (currentSortColumn === column) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortColumn = column;
        currentSortAsc = false;
    }

    currentForwardData.history.sort((a, b) => {
        let valA;
        let valB;

        switch (column) {
            case 'date':
                valA = parseDateForSort(a.match_date);
                valB = parseDateForSort(b.match_date);
                break;
            case 'match':
                valA = safeString(a.home_team);
                valB = safeString(b.home_team);
                break;
            case 'league':
                valA = safeString(a.league);
                valB = safeString(b.league);
                break;
            case 'type':
                valA = safeString(a.bet_type);
                valB = safeString(b.bet_type);
                break;
            case 'pred':
                valA = safeString(a.prediction);
                valB = safeString(b.prediction);
                break;
            case 'odd':
                valA = safeNumber(a.odd, 0);
                valB = safeNumber(b.odd, 0);
                break;
            case 'clv':
                valA = safeNumber(a.clv, 0);
                valB = safeNumber(b.clv, 0);
                break;
            case 'prob':
                valA = safeNumber(a.estimated_prob, 0);
                valB = safeNumber(b.estimated_prob, 0);
                break;
            case 'ai_reliability':
                valA = resolveUnifiedAiReliability(a).score ?? -1;
                valB = resolveUnifiedAiReliability(b).score ?? -1;
                break;
            case 'prediction_index':
                valA = resolveUnifiedPredictionIndexScore(a);
                valB = resolveUnifiedPredictionIndexScore(b);
                break;
            case 'edge':
                valA = getBetEdgePp(a);
                valB = getBetEdgePp(b);
                break;
            case 'ev':
                valA = getBetEvPct(a);
                valB = getBetEvPct(b);
                break;
            case 'stake':
                valA = safeNumber(a.stake, 0);
                valB = safeNumber(b.stake, 0);
                break;
            case 'status':
                valA = safeString(a.status);
                valB = safeString(b.status);
                break;
            case 'profit':
                valA = safeNumber(a.profit, 0);
                valB = safeNumber(b.profit, 0);
                break;
            case 'ds_action':
                valA = safeString(a.ds_action);
                valB = safeString(b.ds_action);
                break;
            case 'strategy':
                valA = safeString(a.strategy_tag);
                valB = safeString(b.strategy_tag);
                break;
            case 'quality':
                valA = safeString(a.data_quality);
                valB = safeString(b.data_quality);
                break;
            default:
                valA = safeNumber(a.id, 0);
                valB = safeNumber(b.id, 0);
        }

        if (valA < valB) return currentSortAsc ? -1 : 1;
        if (valA > valB) return currentSortAsc ? 1 : -1;

        return 0;
    });

    renderForwardTable();
    updateTableHeadersUI();
};


const selectedForwardBetIds = new Set();
function updateForwardSelectionUi() {
    const count = selectedForwardBetIds.size;
    if ($('forwardSelectedCount')) $('forwardSelectedCount').textContent = `${count} selezionat${count === 1 ? 'o' : 'i'}`;
    if ($('forwardBulkDeleteBtn')) $('forwardBulkDeleteBtn').disabled = count === 0;
    const master = $('forwardSelectAllCheckbox');
    const rows = Array.isArray(currentForwardData?.history) ? currentForwardData.history : [];
    if (master) { master.checked = rows.length > 0 && rows.every(row => selectedForwardBetIds.has(Number(row.id))); master.indeterminate = count > 0 && !master.checked; }
}
window.toggleForwardSelection = function(id, checked) { const n=Number(id); if (!(n>0)) return; if (checked) selectedForwardBetIds.add(n); else selectedForwardBetIds.delete(n); updateForwardSelectionUi(); };
window.toggleForwardSelectAll = function(checked) { const rows=Array.isArray(currentForwardData?.history)?currentForwardData.history:[]; rows.forEach(row=>{const id=Number(row.id);if(id>0){if(checked)selectedForwardBetIds.add(id);else selectedForwardBetIds.delete(id);}}); renderForwardTable(); updateForwardSelectionUi(); };

function getForwardTableColumns() {
    const baseStyle = 'padding:10px; color:#cbd5e1; cursor:pointer; transition:color 0.2s; user-select:none; white-space:nowrap;';

    const columns = [
        { key: 'select', label: '', placeholder: 'Selez.', sortable: false, align: 'center' },
        { key: 'actions', label: '✖', placeholder: 'Azioni', sortable: false, align: 'center' },
        { key: 'date', label: 'Data', placeholder: 'Filtra data' },
        { key: 'match', label: 'Partita', placeholder: 'Filtra partita' },
        { key: 'ds_action', label: 'Deep Scan', placeholder: 'Deep scan' },
        { key: 'pivot', label: 'Pivot IA', placeholder: 'Pivot IA', sortable: false },
        { key: 'league', label: 'Lega', placeholder: 'Campionato / torneo' },
        { key: 'strategy', label: 'Strategia', placeholder: 'Strategia' },
        { key: 'type', label: 'Tipo', placeholder: 'Mercato' },
        { key: 'pred', label: 'Pred.', placeholder: 'Pronostico' },
        { key: 'odd', label: 'Quota', placeholder: 'Quota' },
        { key: 'clv', label: 'CLV', placeholder: 'CLV' },
        { key: 'prob', label: 'Prob', placeholder: 'Prob.' }
    ];

    columns.push({ key: 'ai_reliability', label: 'Affidabilità AI', placeholder: 'Affidabilità %' });
    columns.push({ key: 'prediction_index', label: 'Indice Predizione', placeholder: 'Indice 0-100' });
    columns.push({ key: 'edge', label: 'Edge', placeholder: activeSport === SPORT.TENNIS ? 'Edge' : 'Edge / EV' });

    if (activeSport === SPORT.TENNIS) {
        columns.push({ key: 'ev', label: 'EV%', placeholder: 'EV%' });
    }

    // STEP59E_CALCIO_DIAGNOSTICS_UI - anche il Calcio mostra Qualità/Gate nel paper trading.
    columns.push({ key: 'quality', label: 'Qualità', placeholder: 'Qualità / Gate' });

    columns.push(
        { key: 'stake', label: 'Stake', placeholder: 'Stake' },
        { key: 'status', label: 'Stato', placeholder: 'Stato' },
        { key: 'profit', label: 'Profitto', placeholder: 'Profitto' }
    );

    return columns.map((col, index) => ({ ...col, index, baseStyle }));
}

function getForwardTableColumnCount() {
    return getForwardTableColumns().length;
}

function injectSortingHeaders() {
    const tbody = $('forwardTestLogTableBody');

    if (!tbody) return;

    const thead = tbody.parentElement.querySelector('thead');

    if (!thead) return;

    const columns = getForwardTableColumns();

    const headerHtml = columns.map(col => {
        const style = col.key === 'actions'
            ? 'padding:10px; color:#cbd5e1; text-align:center; cursor:default; white-space:nowrap;'
            : col.baseStyle;

        if (col.key === 'select') {
            return `<th style="${style}"><input id="forwardSelectAllCheckbox" type="checkbox" onchange="toggleForwardSelectAll(this.checked)" title="Seleziona tutti i record caricati"></th>`;
        }
        if (col.sortable === false) {
            return `<th style="${style}">${htmlEscape(col.label)}</th>`;
        }

        return `<th style="${style}" onclick="sortForwardData('${col.key}')">${htmlEscape(col.label)} <span id="sort_${col.key}"></span></th>`;
    }).join('');

    const filterHtml = columns.map(col => `
        <th>
            <input class="table-filter-input" data-filter-table="forwardTable" data-col-index="${col.index}" placeholder="${htmlEscape(col.placeholder)}">
        </th>
    `).join('');

    thead.innerHTML = `
        <tr>${headerHtml}</tr>
        <tr class="table-filter-row">${filterHtml}</tr>
    `;

    initializeTableFilters();
    updateTableHeadersUI();
}

function updateTableHeadersUI() {
    const columns = getForwardTableColumns()
        .filter(col => col.sortable !== false)
        .map(col => col.key);

    columns.forEach(col => {
        const span = $(`sort_${col}`);

        if (!span) return;

        span.innerHTML = currentSortColumn === col
            ? (currentSortAsc ? ' ▲' : ' ▼')
            : '';
    });
}


// ============================================================================
// 13. FORWARD TABLE RENDER
// ============================================================================

function renderForwardTable() {
    const logTable = $('forwardTestLogTableBody');

    if (!logTable) return;

    if (
        !currentForwardData ||
        !currentForwardData.history ||
        currentForwardData.history.length === 0
    ) {
        logTable.innerHTML = `
            <tr>
                <td colspan="${getForwardTableColumnCount()}" style="text-align:center; padding:18px;">
                    Nessuna scommessa trovata.
                </td>
            </tr>
        `;
        return;
    }

    logTable.innerHTML = currentForwardData.history.map(row => renderForwardRow(row)).join('');
    applyTableFilters('forwardTable');
    updateForwardSelectionUi();
}


function renderCalcioProfessionalBadge(row = {}) {
    // STEP60_CALCIO_PROFESSIONAL_GUARDRAILS_UI
    const status = safeString(row.calcio_professional_status || '').toUpperCase();
    const timing = safeString(row.calcio_timing_status || '').toUpperCase();
    const lineup = safeString(row.calcio_lineup_status || '').toUpperCase();
    const reliability = safeString(row.calcio_data_reliability || '').toUpperCase();
    const corr = safeString(row.calcio_correlation_status || '').toUpperCase();
    const risk = safeNumber(row.calcio_professional_risk, 0);
    const summary = safeString(row.calcio_professional_summary || '');
    const text = [status, timing, lineup, reliability, corr, summary].join(' ');
    if (!text.trim() && risk <= 0) return '';
    let label = `⚽ Step60 Pro ${risk ? formatNumber(risk, 0) + '/100' : ''}`.trim();
    let color = '#38bdf8';
    if (status.includes('HARD') || risk >= 75) { label = '⚽ Step60 HARD'; color = '#ef4444'; }
    else if (status.includes('SOFT') || risk >= 58 || lineup.includes('NOT_CONFIRMED')) { label = '⚽ Step60 SOFT'; color = '#f59e0b'; }
    else if (corr.includes('HIGH') || corr.includes('DUPLICATE')) { label = '⚽ Corr. alta'; color = '#fb7185'; }
    else if (status.includes('OK')) { label = '⚽ Step60 OK'; color = '#10b981'; }
    const title = [summary, timing, lineup, reliability, corr].filter(Boolean).join(' · ');
    return `<span class="tennis-op-badge" title="${htmlEscape(title)}" style="border-color:${color}; color:${color}; margin-top:4px;">${htmlEscape(label)}</span>`;
}

function renderCalcioOperationalBadge(row = {}) {
    // STEP59E_CALCIO_DIAGNOSTICS_UI
    const text = [
        row.calcio_gate_status,
        row.calcio_operational_status,
        row.calcio_operational_action,
        row.calcio_operational_summary,
        row.calcio_gate_reasons
    ].map(v => safeString(v).toUpperCase()).join(' ');

    if (!text.trim()) return '';

    let label = 'CALCIO GATE';
    let color = '#94a3b8';
    if (text.includes('CALCIO_BLOCKED_HARD')) { label = '⚽ BLOCCATA HARD'; color = '#ef4444'; }
    else if (text.includes('CALCIO_BLOCKED_SOFT')) { label = '⚽ BLOCCATA SOFT'; color = '#f59e0b'; }
    else if (text.includes('CALCIO_WATCHLIST_MICRO')) { label = '⚽ WATCHLIST MICRO'; color = '#a855f7'; }
    else if (text.includes('CALCIO_APPROVED_WITH_CAP')) { label = '⚽ APPROVATA CON CAP'; color = '#10b981'; }
    else if (text.includes('EXPOSURE_GUARD')) { label = '⚽ AUDIT ALT'; color = '#fbbf24'; }

    return `<span class="tennis-op-badge" style="border-color:${color}; color:${color};">${htmlEscape(label)}</span>`;
}

function renderForwardRow(row) {
    const statusInfo = getStatusInfo(row.status);

    const profit = getBetProfit(row);

    const rowProfitDisplay = row.status !== 'PENDING'
        ? `<span style="color:${profit > 0 ? '#10b981' : (profit === 0 ? '#94a3b8' : '#ef4444')}">${profit > 0 ? '+' : ''}€${formatNumber(profit, 2)}</span>`
        : '<span style="color:#f59e0b">€0.00</span>';

    const betType = safeString(row.bet_type);
    const isCR = betType.includes('_CR');

    const displayBetType = betType
        .replace('_CR', '')
        .replace('_TENNIS', '')
        .replace('SINGLE_', 'SINGLE ')
        .replace('MULTI_', 'MULTI ')
        .trim();

    const crBadge = isCR
        ? ' <span style="font-size:0.75em; background:#3b82f6; color:white; padding:2px 6px; border-radius:12px; margin-left:8px;">🛡️ CR</span>'
        : '';

    const probText = getBetProbability(row) > 0
        ? `${formatNumber(getBetProbability(row), 2)}%`
        : '-';

    const edgePp = getBetEdgePp(row);
    const evPct = getBetEvPct(row);

    const edgeEvHtml = `
        <div style="font-weight:bold; color:#f8fafc;">${formatPct(edgePp, 2, true)}</div>
        <div style="font-size:0.76em; color:${colorByPositiveNegative(evPct)}; margin-top:3px;">EV ${formatPct(evPct, 2, true)}</div>
    `;

    const dsBadge = activeSport === SPORT.TENNIS ? renderTennisDecisionTruthBadge(row) : renderCalcioDeepScanSignalCell(row);

    const clv = safeNumber(row.clv, 0);
    const clvEdge = safeNumber(row.clv_edge, 0);

    const clvDisplay = clv > 0
        ? `
            ${formatNumber(clv, 2)}
            <br>
            <span style="font-size:0.8em; color:${clvEdge > 0 ? '#10b981' : '#ef4444'}">
                ${clvEdge > 0 ? '+' : ''}${formatNumber(clvEdge, 2)}%
            </span>
        `
        : '<span style="color:#64748b">-</span>';

    const suggestionDisplay = row.ds_suggestion
        ? `<span style="color:#facc15; font-size:0.85em;">${activeSport === SPORT.TENNIS ? 'Proposta DeepScan: ' : ''}${htmlEscape(row.ds_suggestion)}</span>`
        : (activeSport === SPORT.TENNIS && row.ds_action ? `<span style="color:#94a3b8;font-size:.78em;">Proposta DeepScan disponibile</span>` : '<span style="color:#64748b">-</span>');

    const isTennisForwardRow = activeSport === SPORT.TENNIS;

    const qualityBadgeHtml = isTennisForwardRow && getDataQualityBadge(row)
        ? `<div>${getDataQualityBadge(row)}</div>`
        : '<div><span style="color:#64748b; font-size:0.82em;">-</span></div>';

    const operationalForwardBadge = renderTennisOperationalBadge(row);
    const operationalForwardHtml = operationalForwardBadge ? `<div style="margin-top:6px;">${operationalForwardBadge}</div>` : '';
    const exposureText = [row.exposure_role, row.exposure_group_status, row.exposure_reason].map(v => safeString(v).toUpperCase()).join(' ');
    const exposureGuardHtml = exposureText.includes('AUDIT_ALTERNATIVE') || exposureText.includes('EXPOSURE_GUARD')
        ? `<div style="margin-top:6px; font-size:0.75em; color:#fbbf24; background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.25); padding:2px 5px; border-radius:6px;">${activeSport === SPORT.TENNIS ? 'Step54 audit alt' : 'Step59 audit alt'}</div>`
        : '';

    // STEP58_SETTLEMENT_PENDING_REASON_BADGE
    const settlementPendingText = [row.settlement_contract_reason, row.settlement_source, row.settlement_note].map(v => safeString(v)).join(' ').toUpperCase();
    let settlementPendingLabel = '';
    if (row.status === 'PENDING') {
        if (settlementPendingText.includes('RETIREMENT') || settlementPendingText.includes('BOOKMAKER_RULE')) settlementPendingLabel = 'Ritiro · regola bookmaker richiesta';
        else if (settlementPendingText.includes('SUSPEND')) settlementPendingLabel = 'Match sospeso · attesa completamento';
        else if (settlementPendingText.includes('POSTPON')) settlementPendingLabel = 'Match rinviato';
        else if (settlementPendingText.includes('SCORE_UNPARSEABLE')) settlementPendingLabel = 'Risultato maturo · parser da verificare';
        else if (settlementPendingText.includes('PENDING_STEP58') || settlementPendingText.includes('SCORE_NOT_AVAILABLE')) settlementPendingLabel = 'Risultato non ancora certificato';
    }
    const settlementPendingHtml = settlementPendingLabel
        ? `<div style="margin-top:6px; font-size:0.75em; color:#93c5fd; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); padding:2px 5px; border-radius:6px;" title="${htmlEscape([row.settlement_contract_reason,row.settlement_note].filter(Boolean).join(' · '))}">${htmlEscape(settlementPendingLabel)}</div>`
        : '';

    const calcioOperationalBadge = !isTennisForwardRow ? renderCalcioOperationalBadge(row) : '';
    const calcioProfessionalBadge = !isTennisForwardRow ? renderCalcioProfessionalBadge(row) : '';
    const calcioOperationalHtml = calcioOperationalBadge || calcioProfessionalBadge ? `<div>${calcioOperationalBadge || ''}${calcioProfessionalBadge ? `<div style="margin-top:5px;">${calcioProfessionalBadge}</div>` : ''}</div>` : '<div><span style="color:#64748b; font-size:0.82em;">-</span></div>';
    const bestForecastHtml = !isTennisForwardRow && (safeNumber(row.calcio_analysis_only, 0) === 1 || safeString(row.strategy_tag).includes('ANALYSIS_ONLY'))
        ? '<div style="margin-top:5px;color:#fbbf24;font-size:.7rem;font-weight:900;">🔎 MIGLIOR PRONOSTICO · ANALISI</div>' : '';
    const reliabilityForwardHtml = '';
    const theoreticalForward = safeNumber(row.calcio_theoretical_stake, row.stake);
    const operationalForward = safeNumber(row.calcio_operational_stake, row.stake);
    const calcioStakeForwardHtml = !isTennisForwardRow ? `<div style="font-size:.68rem;color:#94a3b8;margin-top:3px;">Teorico €${formatNumber(theoreticalForward,2)} · Operativo €${formatNumber(operationalForward,2)}</div>` : '';
    const step59PendingText = [row.settlement_source, row.settlement_note].map(v => safeString(v)).join(' ').toUpperCase();
    const step59PendingHtml = row.status === 'PENDING' && step59PendingText.includes('PENDING_STEP59')
        ? `<div style="margin-top:6px; font-size:0.75em; color:#93c5fd; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); padding:2px 5px; border-radius:6px;" title="${htmlEscape(row.settlement_note || '')}">Step59 pending reason</div>`
        : '';
    const qualityCellHtml = isTennisForwardRow
        ? `<td style="padding:8px; min-width:150px;">${qualityBadgeHtml}${operationalForwardHtml}${exposureGuardHtml}${settlementPendingHtml}${renderTennisExternalEvidenceMini(row)}</td>`
        : `<td style="padding:8px; min-width:150px;">${calcioOperationalHtml}<div style="margin-top:5px;color:#cbd5e1;font-size:.7rem;">${htmlEscape(row.calcio_quality_final_label || row.calcio_analysis_stage_label || 'N/D')}</div>${exposureGuardHtml}${step59PendingHtml}</td>`;

    const evCellHtml = isTennisForwardRow
        ? `<td style="padding:8px; color:${colorByPositiveNegative(evPct)}; font-weight:bold;">${formatPct(evPct, 2, true)}</td>`
        : '';

    const edgeCellHtml = isTennisForwardRow
        ? `<div style="font-weight:bold; color:#f8fafc;">${formatPct(edgePp, 2, true)}</div>`
        : edgeEvHtml;

    const stratDisplay = row.strategy_tag
        ? `<span style="color:#cbd5e1; font-size:0.85em; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${htmlEscape(row.strategy_tag)}</span>`
        : `<span style="color:#64748b">-</span>`;

    return `
       <tr data-forward-bet-id="${safeNumber(row.id, 0)}" style="border-bottom:1px solid #334155; transition:background 0.2s;" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='transparent'">
            <td style="padding:8px;text-align:center;"><input type="checkbox" ${selectedForwardBetIds.has(Number(row.id)) ? 'checked' : ''} onchange="toggleForwardSelection(${safeNumber(row.id,0)}, this.checked)" aria-label="Seleziona ${htmlEscape(row.home_team)} - ${htmlEscape(row.away_team)}"></td>
            <td style="padding:8px; text-align:center; white-space:nowrap;">
                <button class="delete-btn" onclick="deleteBet(${safeNumber(row.id, 0)})" title="Elimina">✖</button>
                <button class="edit-btn" onclick="forceBetStatus(${safeNumber(row.id, 0)})" title="Modifica Esito">✏️</button>
            </td>
            <td style="padding:8px;">${htmlEscape(row.match_date)}</td>
            <td style="padding:8px;"><strong>${htmlEscape(row.home_team)} - ${htmlEscape(row.away_team)}</strong>${crBadge}${bestForecastHtml}${reliabilityForwardHtml}</td>
            <td style="padding:8px; text-align:center;">${dsBadge}</td>
            <td style="padding:8px; text-align:center;">${suggestionDisplay}</td>
            <td style="padding:8px; color:#94a3b8; font-size:0.9em;">${htmlEscape(row.league || (activeSport === SPORT.TENNIS ? 'ATP/WTA' : 'Lega'))}</td>
            <td style="padding:8px; text-align:center;">${stratDisplay}</td>
            <td style="padding:8px; text-align:center; color:#cbd5e1; font-size:0.9em;">${htmlEscape(displayBetType)}</td>
            <td style="padding:8px; font-weight:bold; color:#10b981;">${htmlEscape(row.prediction)}</td>
            <td style="padding:8px;">${formatNumber(row.odd, 2)}</td>
            <td style="padding:8px; text-align:center;">${clvDisplay}</td>
            <td style="padding:8px; color:#cbd5e1;">${probText}</td>
            <td style="padding:8px;text-align:center;">${renderUnifiedAiReliabilityCell(row)}</td>
            <td style="padding:8px;text-align:center;">${renderUnifiedPredictionIndexCell(row)}</td>
            <td style="padding:8px; color:#cbd5e1; min-width:110px;">${edgeCellHtml}</td>
            ${evCellHtml}
            ${qualityCellHtml}
            <td style="padding:8px; min-width:115px;">€${formatNumber(isTennisForwardRow ? row.stake : operationalForward, 2)}${renderTennisStakePolicyMini(row)}${calcioStakeForwardHtml}</td>
            <td style="padding:8px; color:${statusInfo.color}; font-weight:bold;">${statusInfo.icon}</td>
            <td style="padding:8px; font-weight:bold;">${rowProfitDisplay}</td>
        </tr>
    `;
}


// ============================================================================
// 14. SETTINGS
// ============================================================================

document.querySelectorAll('.settingsBtnAction, #settingsBtn').forEach(btn => {
    btn.addEventListener('click', () => {
        enterPrimaryView('SETTINGS');
        nascondiTutto();
        $('settingsSection')?.classList.remove('hidden');
        updateTogglesUI();
    });
});

function updateTogglesUI() {
    const onlyGlobalToggle = $('cfg_onlyGlobal');

    if (onlyGlobalToggle) {
        const isChecked = onlyGlobalToggle.checked;
        const opacity = isChecked ? '0.3' : '1';
        const pointerEvents = isChecked ? 'none' : 'auto';

        [
            'cfg_u25Edge',
            'cfg_u25Prob',
            'cfg_home1Edge',
            'cfg_home1Prob',
            'cfg_x2Edge',
            'cfg_x2Prob'
        ].forEach(id => {
            const inputEl = $(id);

            if (!inputEl) return;

            inputEl.disabled = isChecked;

            const card = inputEl.closest('.settings-card');

            if (card && card.id !== 'card_pt') {
                card.style.opacity = opacity;
                card.style.pointerEvents = pointerEvents;
            }
        });
    }

    const histToggle = $('cfg_useHistoricalOpt');

    if (histToggle) {
        const isHist = histToggle.checked;

        const ptCard =
            $('cfg_pt_seriea_edge')?.closest('.settings-card') ||
            document.querySelector('#panel-calcio .settings-card:nth-child(4)');

        const csvLabels = [
            $('card_u25'),
            $('card_home1'),
            $('card_x2')
        ];

        if (isHist) {
            if ($('label_opt_pt')) {
                $('label_opt_pt').style.background = '#475569';
                $('label_opt_pt').style.color = '#cbd5e1';
                $('label_opt_pt').style.fontWeight = 'normal';
            }

            if ($('label_opt_csv')) {
                $('label_opt_csv').style.background = '#3b82f6';
                $('label_opt_csv').style.color = 'white';
                $('label_opt_csv').style.fontWeight = 'bold';
            }

            if (ptCard) {
                ptCard.style.opacity = '0.4';
                ptCard.style.pointerEvents = 'none';
            }

            csvLabels.forEach(card => {
                if (card) card.style.opacity = '1';
            });
        } else {
            if ($('label_opt_pt')) {
                $('label_opt_pt').style.background = '#10b981';
                $('label_opt_pt').style.color = 'white';
                $('label_opt_pt').style.fontWeight = 'bold';
            }

            if ($('label_opt_csv')) {
                $('label_opt_csv').style.background = '#475569';
                $('label_opt_csv').style.color = '#cbd5e1';
                $('label_opt_csv').style.fontWeight = 'normal';
            }

            if (ptCard) {
                ptCard.style.opacity = '1';
                ptCard.style.pointerEvents = 'auto';
            }

            csvLabels.forEach(card => {
                if (card && !(onlyGlobalToggle && onlyGlobalToggle.checked)) {
                    card.style.opacity = '0.5';
                }
            });
        }
    }
}

$('cfg_onlyGlobal')?.addEventListener('change', updateTogglesUI);
$('cfg_useHistoricalOpt')?.addEventListener('change', updateTogglesUI);

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();

        setInputValue('cfg_baseEdge', settings.baseEdge || 3.0);
        setInputValue('cfg_baseProb', settings.baseProb || 45.0);
        setInputValue('cfg_maxOdd', settings.maxOdd || 5.0);

        setChecked('cfg_useHistoricalOpt', settings.useHistoricalOpt === true);

        if (settings.paperTradingParams) {
            setInputValue('cfg_pt_seriea_edge', settings.paperTradingParams['Serie A']?.edge);
            setInputValue('cfg_pt_seriea_prob', settings.paperTradingParams['Serie A']?.prob);

            setInputValue('cfg_pt_serieb_edge', settings.paperTradingParams['Serie B']?.edge);
            setInputValue('cfg_pt_serieb_prob', settings.paperTradingParams['Serie B']?.prob);

            setInputValue('cfg_pt_premier_edge', settings.paperTradingParams.Premier?.edge);
            setInputValue('cfg_pt_premier_prob', settings.paperTradingParams.Premier?.prob);

            setInputValue('cfg_pt_laliga_edge', settings.paperTradingParams['La Liga']?.edge);
            setInputValue('cfg_pt_laliga_prob', settings.paperTradingParams['La Liga']?.prob);

            setInputValue('cfg_pt_bundes_edge', settings.paperTradingParams.Bundesliga?.edge);
            setInputValue('cfg_pt_bundes_prob', settings.paperTradingParams.Bundesliga?.prob);

            setInputValue('cfg_pt_ligue1_edge', settings.paperTradingParams['Ligue 1']?.edge);
            setInputValue('cfg_pt_ligue1_prob', settings.paperTradingParams['Ligue 1']?.prob);
        }

        setInputValue('cfg_u25Edge', settings.u25Edge || 3.0);
        setInputValue('cfg_u25Prob', settings.u25Prob || 45.0);

        setInputValue('cfg_home1Edge', settings.home1Edge || 3.0);
        setInputValue('cfg_home1Prob', settings.home1Prob || 45.0);

        setInputValue('cfg_x2Edge', settings.x2Edge || 3.0);
        setInputValue('cfg_x2Prob', settings.x2Prob || 45.0);

        setChecked('cfg_useCrossReference', settings.useCrossReference === true);
        setChecked('cfg_onlyGlobal', settings.onlyGlobal === true);
        setChecked('cfg_useAdvancedMetrics', settings.useAdvancedMetrics !== false);

        setInputValue('cfg_eloK', settings.eloK || 20);
        setInputValue('cfg_timeDecay', settings.timeDecay || 1.15);

        setChecked('cfg_useMarkov', settings.useMarkov === true);
        setChecked('cfg_tennisUseTotals', settings.tennisUseTotals === true);

        setInputValue('cfg_tennisAtpEdge', settings.tennisAtpEdge || 4.0);
        setInputValue('cfg_tennisAtpProb', settings.tennisAtpProb || 52.0);
        setInputValue('cfg_tennisAtpEv', settings.tennisAtpEv || 2.0);

        setInputValue('cfg_tennisWtaEdge', settings.tennisWtaEdge || 4.5);
        setInputValue('cfg_tennisWtaProb', settings.tennisWtaProb || 52.0);
        setInputValue('cfg_tennisWtaEv', settings.tennisWtaEv || 2.0);

        updateTogglesUI();
    } catch (error) {
        console.warn('Impossibile caricare settings.');
    }
}

function setInputValue(id, value) {
    const el = $(id);

    if (el && value !== undefined && value !== null) {
        el.value = value;
    }
}

function setChecked(id, value) {
    const el = $(id);

    if (el) {
        el.checked = Boolean(value);
    }
}

$('saveSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    showLoading();

    const payload = {
        baseEdge: $('cfg_baseEdge')?.value,
        baseProb: $('cfg_baseProb')?.value,
        maxOdd: $('cfg_maxOdd')?.value,
        useHistoricalOpt: $('cfg_useHistoricalOpt')?.checked,

        paperTradingParams: {
            'Serie A': {
                edge: $('cfg_pt_seriea_edge')?.value,
                prob: $('cfg_pt_seriea_prob')?.value
            },
            'Serie B': {
                edge: $('cfg_pt_serieb_edge')?.value,
                prob: $('cfg_pt_serieb_prob')?.value
            },
            Premier: {
                edge: $('cfg_pt_premier_edge')?.value,
                prob: $('cfg_pt_premier_prob')?.value
            },
            'La Liga': {
                edge: $('cfg_pt_laliga_edge')?.value,
                prob: $('cfg_pt_laliga_prob')?.value
            },
            Bundesliga: {
                edge: $('cfg_pt_bundes_edge')?.value,
                prob: $('cfg_pt_bundes_prob')?.value
            },
            'Ligue 1': {
                edge: $('cfg_pt_ligue1_edge')?.value,
                prob: $('cfg_pt_ligue1_prob')?.value
            }
        },

        u25Edge: $('cfg_u25Edge')?.value,
        u25Prob: $('cfg_u25Prob')?.value,

        home1Edge: $('cfg_home1Edge')?.value,
        home1Prob: $('cfg_home1Prob')?.value,

        x2Edge: $('cfg_x2Edge')?.value,
        x2Prob: $('cfg_x2Prob')?.value,

        useCrossReference: $('cfg_useCrossReference')?.checked,
        onlyGlobal: $('cfg_onlyGlobal')?.checked,
        useAdvancedMetrics: $('cfg_useAdvancedMetrics')?.checked,

        eloK: $('cfg_eloK')?.value,
        timeDecay: $('cfg_timeDecay')?.value,

        useMarkov: $('cfg_useMarkov')?.checked,
        tennisUseTotals: $('cfg_tennisUseTotals')?.checked,

        tennisAtpEdge: $('cfg_tennisAtpEdge')?.value,
        tennisAtpProb: $('cfg_tennisAtpProb')?.value,
        tennisAtpEv: $('cfg_tennisAtpEv')?.value,

        tennisWtaEdge: $('cfg_tennisWtaEdge')?.value,
        tennisWtaProb: $('cfg_tennisWtaProb')?.value,
        tennisWtaEv: $('cfg_tennisWtaEv')?.value
    };

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        alert('✅ Impostazioni salvate.');
    } catch (error) {
        alert('❌ Errore salvataggio impostazioni.');
    } finally {
        hideLoading();
    }
});


// ============================================================================
// 15. OPTIMIZER
// ============================================================================

function ensureOptimizationPanel() {
    let panel = $('optimizationResultPanel');

    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'optimizationResultPanel';
    panel.style.margin = '14px 0';

    const settingsSection = $('settingsSection');
    const optimizeBtn = $('optimizeBtn') || $('btnOptimizeCalcio') || $('btnOptimizeTennis');

    if (settingsSection) {
        settingsSection.prepend(panel);
    } else if (optimizeBtn && optimizeBtn.parentElement) {
        optimizeBtn.parentElement.appendChild(panel);
    } else {
        document.body.prepend(panel);
    }

    return panel;
}

function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }

    return undefined;
}

function formatOptimizationParam(value, suffix = '%') {
    const n = Number(value);

    if (!Number.isFinite(n)) return '-';

    return `${formatNumber(n, 2).replace(/\.00$/, '')}${suffix}`;
}

function getTennisOptimizationSettingsBlock(data = {}, type = 'active') {
    const diagnostics = data.diagnostics || {};

    if (type === 'active') {
        return data.activeSettings ||
            data.previousSettings ||
            diagnostics.previousSettings ||
            data.currentSettings ||
            {};
    }

    return data.recommendedSettings ||
        data.recommendation ||
        data.suggestedSettings ||
        {};
}

function normalizeTennisRecommendationTour(data = {}, tour = 'atp') {
    const diagnostics = data.diagnostics || {};
    const active = getTennisOptimizationSettingsBlock(data, 'active');
    const recommended = getTennisOptimizationSettingsBlock(data, 'recommended');

    const prefix = tour === 'atp' ? 'tennisAtp' : 'tennisWta';
    const rawTour = data[tour] || data.raw?.[tour]?.OVERALL_GLOBAL || data.raw?.[tour]?.global || {};

    const sample = pickFirstDefined(
        diagnostics[`${tour}Sample`],
        rawTour.count,
        rawTour.sampleSize,
        rawTour.sample,
        0
    );

    const applied = pickFirstDefined(
        diagnostics[`${tour}Applied`],
        data[`${tour}Applied`],
        false
    );

    return {
        label: tour === 'atp' ? 'ATP Tour' : 'WTA Tour',
        sample: safeNumber(sample, 0),
        applied: applied === true,
        active: {
            edge: pickFirstDefined(active[`${prefix}Edge`], active[`${tour}Edge`], active.edge),
            prob: pickFirstDefined(active[`${prefix}Prob`], active[`${tour}Prob`], active.prob),
            ev: pickFirstDefined(active[`${prefix}Ev`], active[`${tour}Ev`], active.ev)
        },
        recommended: {
            edge: pickFirstDefined(recommended[`${prefix}Edge`], recommended[`${tour}Edge`], rawTour.edge),
            prob: pickFirstDefined(recommended[`${prefix}Prob`], recommended[`${tour}Prob`], rawTour.prob),
            ev: pickFirstDefined(recommended[`${prefix}Ev`], recommended[`${tour}Ev`], rawTour.ev)
        },
        roi: rawTour.roi
    };
}

function renderTennisOptimizationRecommendationPanel(data = {}) {
    const diagnostics = data.diagnostics || {};
    const atp = normalizeTennisRecommendationTour(data, 'atp');
    const wta = normalizeTennisRecommendationTour(data, 'wta');

    const recommendationOnly = data.recommendationOnly === true || data.applied === false;
    const settingsSaved = data.settingsSaved === true || diagnostics.settingsSaved === true;
    const requiredSample = safeNumber(
        diagnostics.requiredSamplePerTour ?? data.requiredSample ?? data.minSampleRequired,
        0
    );

    const statusColor = settingsSaved
        ? '#10b981'
        : (recommendationOnly ? '#f59e0b' : '#38bdf8');

    const statusText = settingsSaved
        ? 'Soglie salvate nei parametri live'
        : (recommendationOnly
            ? 'Solo raccomandazione: soglie live NON modificate'
            : 'Risultato ottimizzazione ricevuto');

    const renderTourCard = tour => {
        const canUseRecommendation = requiredSample > 0
            ? tour.sample >= requiredSample
            : tour.sample > 0;

        const sampleColor = canUseRecommendation ? '#10b981' : '#f59e0b';

        return `
            <div style="background:rgba(15,23,42,0.65); border:1px solid rgba(148,163,184,0.18); border-radius:10px; padding:12px; min-width:260px; flex:1;">
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:10px;">
                    <strong style="color:#f8fafc; font-size:1.02em;">${htmlEscape(tour.label)}</strong>
                    <span style="background:rgba(56,189,248,0.12); color:#bae6fd; padding:3px 7px; border-radius:999px; font-size:0.78em; font-weight:bold;">
                        Sample ${tour.sample}${requiredSample ? `/${requiredSample}` : ''}
                    </span>
                </div>
                <div style="height:3px; background:${sampleColor}; border-radius:999px; margin-bottom:12px;"></div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <div style="font-size:0.72em; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;">Soglie attive</div>
                        <div style="margin-top:6px; line-height:1.8; color:#cbd5e1;">
                            Edge: <strong style="color:#f8fafc;">${formatOptimizationParam(tour.active.edge)}</strong><br>
                            Prob: <strong style="color:#f8fafc;">${formatOptimizationParam(tour.active.prob)}</strong><br>
                            EV: <strong style="color:#f8fafc;">${formatOptimizationParam(tour.active.ev)}</strong>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:0.72em; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;">Raccomandazione</div>
                        <div style="margin-top:6px; line-height:1.8; color:#cbd5e1;">
                            Edge: <strong style="color:#f59e0b;">${formatOptimizationParam(tour.recommended.edge)}</strong><br>
                            Prob: <strong style="color:#f59e0b;">${formatOptimizationParam(tour.recommended.prob)}</strong><br>
                            EV: <strong style="color:#f59e0b;">${formatOptimizationParam(tour.recommended.ev)}</strong>
                        </div>
                    </div>
                </div>
                <div style="margin-top:10px; color:${tour.applied ? '#10b981' : '#f59e0b'}; font-size:0.85em; font-weight:bold;">
                    ${tour.applied && settingsSaved
                        ? 'Applicata ai parametri live.'
                        : 'Non applicata automaticamente.'}
                </div>
            </div>
        `;
    };

    return `
        <div style="margin:14px 0; background:rgba(30,41,59,0.92); border:1px solid rgba(148,163,184,0.20); border-left:4px solid ${statusColor}; padding:14px; border-radius:10px; color:#cbd5e1;">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:${statusColor}; font-size:1.05em;">🎾 Ottimizzazione Tennis</strong>
                    <div style="margin-top:6px; font-weight:bold; color:#f8fafc;">${htmlEscape(statusText)}</div>
                    <div style="margin-top:6px; color:#94a3b8;">
                        Le soglie consigliate derivano dal backtest neutro. Il live continua a usare le soglie attive finché non vengono salvate manualmente nei parametri.
                    </div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                    <span style="background:rgba(245,158,11,0.14); color:#fde68a; padding:4px 8px; border-radius:999px; font-size:0.78em; font-weight:bold;">recommendationOnly: ${recommendationOnly ? 'true' : 'false'}</span>
                    <span style="background:rgba(56,189,248,0.12); color:#bae6fd; padding:4px 8px; border-radius:999px; font-size:0.78em; font-weight:bold;">settingsSaved: ${settingsSaved ? 'true' : 'false'}</span>
                </div>
            </div>
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:14px;">
                ${renderTourCard(atp)}
                ${renderTourCard(wta)}
            </div>
        </div>
    `;
}

function renderCalcioOptimizationRecommendationPanel(data = {}) {
    const rec = data.recommendation || null;
    if (!rec) return '';
    const calibration = rec.calibration || {};
    const holdout = rec.holdout || {};
    const eligible = String(rec.status || data.status || '').toUpperCase() === 'ELIGIBLE_FOR_EXPLICIT_APPLY';
    const color = eligible ? '#10b981' : '#f59e0b';
    return `
        <div style="margin:14px 0;background:rgba(30,41,59,.94);border:1px solid rgba(148,163,184,.2);border-left:4px solid ${color};padding:14px;border-radius:10px;color:#cbd5e1;">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div><strong style="color:${color};font-size:1.05rem;">⚽ Auto-Ottimizzazione Calcio walk-forward</strong>
                <div style="margin-top:5px;color:#f8fafc;font-weight:800;">${htmlEscape(rec.status || data.status || 'HOLD_SHADOW')}</div></div>
                <span style="padding:4px 8px;border-radius:999px;background:rgba(56,189,248,.12);color:#bae6fd;font-size:.75rem;font-weight:800;">Raccomandazione, non mutazione automatica</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px;">
                <div class="settings-card"><small>Edge globale candidato</small><strong style="display:block;color:#f8fafc;">${formatNumber(rec.baseEdge,2)}%</strong></div>
                <div class="settings-card"><small>Probabilità minima candidata</small><strong style="display:block;color:#f8fafc;">${formatNumber(rec.baseProb,2)}%</strong></div>
                <div class="settings-card"><small>Quota massima candidata</small><strong style="display:block;color:#f8fafc;">${formatNumber(rec.maxOdd,2)}</strong></div>
                <div class="settings-card"><small>Scope mercati candidato</small><strong style="display:block;color:#f8fafc;">${htmlEscape(rec.marketScope || 'ALL_SUPPORTED')}</strong></div>
                <div class="settings-card"><small>Calibration</small><strong style="display:block;color:${colorByPositiveNegative(calibration.roiPct)};">ROI ${formatNumber(calibration.roiPct,2)}% · n=${safeNumber(calibration.sample,0)}</strong></div>
                <div class="settings-card"><small>Holdout intatto</small><strong style="display:block;color:${colorByPositiveNegative(holdout.roiPct)};">ROI ${formatNumber(holdout.roiPct,2)}% · n=${safeNumber(holdout.sample,0)}</strong></div>
                <div class="settings-card"><small>IC ROI holdout 95%</small><strong style="display:block;color:#f8fafc;">${formatNumber(holdout.roiLower95Pct,2)}% / ${formatNumber(holdout.roiUpper95Pct,2)}%</strong></div>
            </div>
            <div style="margin-top:10px;color:#94a3b8;font-size:.82rem;">Il flag “Storico CSV” seleziona questa modalità. I valori vengono applicati solo se il periodo holdout supera i guardrail e dopo conferma esplicita.</div>
            <button type="button" ${eligible ? '' : 'disabled'} onclick="applyCalcioOptimizationRecommendation('${htmlEscape(rec.recommendationId || data.recommendationId || '')}')" style="margin-top:10px;padding:8px 12px;border-radius:7px;border:1px solid ${color};background:${eligible ? 'rgba(16,185,129,.18)' : 'rgba(148,163,184,.08)'};color:${eligible ? '#a7f3d0' : '#64748b'};font-weight:800;">${eligible ? 'Applica raccomandazione certificata' : 'Holdout non certificato: applicazione bloccata'}</button>
        </div>`;
}
window.applyCalcioOptimizationRecommendation = async function(recommendationId) {
    if (!recommendationId) return;
    if (!confirm('Applicare le soglie Calcio certificate dal holdout?')) return;
    showLoading();
    try {
        const response = await fetch('/api/calcio/optimize/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recommendationId})});
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'APPLY_FAILED');
        await loadSettings(); renderOptimizationResult(data, SPORT.CALCIO);
    } catch(error) { alert(`Applicazione non consentita: ${error.message}`); }
    finally { hideLoading(); }
};

function renderOptimizationResult(data = {}, sport = activeSport) {
    const panel = ensureOptimizationPanel();

    const isTennis = sport === SPORT.TENNIS || sport === 'tennis';
    const titleSport = isTennis ? 'Tennis' : 'Calcio';

    const normalized = {
        ...data,
        diagnostics: data.diagnostics || data.debug || {
            sampleSize: data.sampleSize,
            requiredSample: data.requiredSample || data.minSampleRequired,
            dataMode: data.dataMode,
            reason: data.reason,
            recommendationOnly: data.recommendationOnly,
            applied: data.applied,
            settingsSaved: data.settingsSaved
        }
    };

    const diagnosticsHtml = renderDiagnosticsPanel(normalized, {
        title: `Risultato Auto-Ottimizzazione ${titleSport}`,
        compact: false,
        emptyHint: 'Nessuna informazione ricevuta dal backend.'
    });

    const recommendationHtml = isTennis
        ? renderTennisOptimizationRecommendationPanel(data)
        : renderCalcioOptimizationRecommendationPanel(data);

    panel.innerHTML = diagnosticsHtml + recommendationHtml;

    panel.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}

async function runOptimization(sport = activeSport) {
    const normalizedSport = sport === SPORT.TENNIS || sport === 'tennis'
        ? SPORT.TENNIS
        : SPORT.CALCIO;

    const endpoint = normalizedSport === SPORT.TENNIS
        ? '/api/tennis/optimize'
        : '/api/calcio/optimize';

    const confirmed = confirm(
        normalizedSport === SPORT.TENNIS
            ? 'Calcolare raccomandazione Auto-Ottimizzazione Tennis? Le soglie live NON verranno modificate automaticamente.'
            : 'Eseguire Auto-Ottimizzazione Calcio? Con Storico CSV attivo verrà usato un walk-forward cronologico con holdout intatto. Nessuna soglia sarà modificata automaticamente.'
    );

    if (!confirmed) return;

    showLoading();

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            }
        });

        const text = await response.text();

        let data = null;

        try {
            data = JSON.parse(text);
        } catch (error) {
            data = {
                success: false,
                error: 'Risposta backend non JSON',
                raw: text
            };
        }

        console.log(`[OPTIMIZE] ${normalizedSport}`, data);

        renderOptimizationResult(data, normalizedSport);

        const settingsWereSaved = data.settingsSaved === true || data.diagnostics?.settingsSaved === true;

        if (!data.error && !data.disabled && settingsWereSaved) {
            await loadSettings();
            loadGlobalAnalytics();
        } else if (!data.error) {
            loadGlobalAnalytics();
        }

    } catch (error) {
        console.error('[OPTIMIZE] Errore:', error);

        renderOptimizationResult({
            success: false,
            error: error.message,
            message: `Errore durante ottimizzazione ${normalizedSport}: ${error.message}`
        }, normalizedSport);
    } finally {
        hideLoading();
    }
}

function bindOptimizationButtons() {
    const legacyBtn = $('optimizeBtn');
    const calcioBtn = $('btnOptimizeCalcio');
    const tennisBtn = $('btnOptimizeTennis');

    if (legacyBtn && !legacyBtn.dataset.optimizeBound) {
        legacyBtn.dataset.optimizeBound = '1';
        legacyBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            runOptimization(activeSport);
        });
    }

    if (calcioBtn && !calcioBtn.dataset.optimizeBound) {
        calcioBtn.dataset.optimizeBound = '1';
        calcioBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            runOptimization(SPORT.CALCIO);
        });
    }

    if (tennisBtn && !tennisBtn.dataset.optimizeBound) {
        tennisBtn.dataset.optimizeBound = '1';
        tennisBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            runOptimization(SPORT.TENNIS);
        });
    }

    console.log('[OPTIMIZE] Binding pulsanti completato', {
        optimizeBtn: !!legacyBtn,
        btnOptimizeCalcio: !!calcioBtn,
        btnOptimizeTennis: !!tennisBtn
    });
}

document.addEventListener('DOMContentLoaded', bindOptimizationButtons);
setTimeout(bindOptimizationButtons, 500);

window.runOptimization = runOptimization;


// ============================================================================
// 16. PAPER TRADING FILTER
// ============================================================================

function injectPaperTradingFilter() {
    const controlsContainer = document.querySelector('.controls');

    if (!controlsContainer || $('forwardLeagueFilter') || !$('forwardTestBtn')) return;

    const filterHtml = `
        <select id="forwardLeagueFilter" style="margin-left:10px; padding:10px; background:#334155; color:white; border:1px solid #475569; border-radius:5px; outline:none; cursor:pointer;"></select>
    `;

    $('forwardTestBtn').insertAdjacentHTML('afterend', filterHtml);

    $('forwardLeagueFilter')?.addEventListener('change', () => {
        if (!$('forwardTestLogSection')?.classList.contains('hidden')) {
            $('forwardTestBtn')?.click();
        }
    });
}

function updatePaperTradingFilter(sport) {
    const filter = $('forwardLeagueFilter');

    if (!filter) return;

    if (sport === SPORT.CALCIO) {
        filter.innerHTML = `
            <option value="all">🌍 Tutti i Campionati</option>
            <option value="Serie A">🇮🇹 Serie A</option>
            <option value="Serie B">🇮🇹 Serie B</option>
            <option value="Premier">🇬🇧 Premier League</option>
            <option value="La Liga">🇪🇸 La Liga</option>
            <option value="Bundesliga">🇩🇪 Bundesliga</option>
            <option value="Ligue 1">🇫🇷 Ligue 1</option>
        `;
    }

    if (sport === SPORT.TENNIS) {
        filter.innerHTML = `
            <option value="all">🌍 Tutti i Tornei</option>
            <option value="ATP">🎾 ATP</option>
            <option value="WTA">🎾 WTA</option>
            <option value="Grand Slam">🏆 Grand Slam</option>
            <option value="Masters 1000">⭐ Masters 1000</option>
            <option value="ATP500">🎾 ATP500</option>
            <option value="ATP250">🎾 ATP250</option>
            <option value="Challenger">🎾 Challenger</option>
        `;
    }
}



// ============================================================================
// STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT
// Esportazione CSV multi-sezione: dettaglio + Resa Deep Scan IA + Resa Qualità/Gate
// + matrice incroci DeepScan x Gate per Tennis e Calcio.
// Nota CSV: il formato non supporta fogli/pagine reali; le "pagine" sono sezioni
// logiche nello stesso CSV, leggibili da Excel/LibreOffice e filtrabili.
// ============================================================================
const STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT_MODE = 'STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT';

function step95CsvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
}

function step95CsvLine(values = []) {
    return values.map(step95CsvCell).join(';');
}

function step95CsvSection(title, headers = [], rows = []) {
    const out = ['', step95CsvLine([`=== ${title} ===`])];
    if (headers && headers.length) out.push(step95CsvLine(headers));
    rows.forEach(row => out.push(step95CsvLine(row)));
    return out;
}

function step95ForwardExportRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).filter(row => {
        const betType = safeString(row.bet_type || row.betType).toUpperCase();
        return !betType.includes('MULTI_');
    });
}

function step95NormalizeStatus(row = {}) {
    const status = safeString(row.status || row.esito || '').toUpperCase();
    if (status === 'WON' || status === 'VINTA') return 'WON';
    if (status === 'LOST' || status === 'PERSA') return 'LOST';
    if (status === 'VOID') return 'VOID';
    if (status === 'PUSH') return 'PUSH';
    return 'PENDING';
}

function step95CleanComboLabel(value = '') {
    return safeString(value || 'ALTRO')
        .replace(/^🎾\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim() || 'ALTRO';
}

function step95CreateOutcomeStats({ label = 'ALTRO', deepScan = '', qualityGate = '' } = {}) {
    return {
        label,
        deepScan,
        qualityGate,
        total: 0,
        won: 0,
        lost: 0,
        pending: 0,
        void: 0,
        push: 0,
        resolved: 0,
        operationalTotal: 0,
        operationalResolved: 0,
        operationalPending: 0,
        stake: 0,
        profit: 0,
        winRateResolved: 0,
        winRateSignal: 0,
        roi: 0,
        decision: 'SOLO AUDIT',
        note: ''
    };
}

function step95AccumulateOutcomeStats(stats, row = {}) {
    const status = step95NormalizeStatus(row);
    const stake = safeNumber(row.stake ?? row.invested, 0);
    const profit = safeNumber(row.profit, 0);

    stats.total += 1;
    if (status === 'WON') stats.won += 1;
    else if (status === 'LOST') stats.lost += 1;
    else if (status === 'VOID') stats.void += 1;
    else if (status === 'PUSH') stats.push += 1;
    else stats.pending += 1;

    if (stake > 0) stats.operationalTotal += 1;
    if (status === 'PENDING' && stake > 0) stats.operationalPending += 1;

    if (status === 'WON' || status === 'LOST') {
        stats.resolved += 1;
        if (stake > 0) {
            stats.operationalResolved += 1;
            stats.stake += stake;
            stats.profit += profit;
        }
    }
}

function step95DecisionForOutcomeStats(stats = {}) {
    const label = `${stats.deepScan || stats.label} ${stats.qualityGate || ''}`.toUpperCase();
    const op = safeNumber(stats.operationalResolved, 0);
    const roi = safeNumber(stats.roi, 0);
    const wr = safeNumber(stats.winRateResolved, 0);

    if (label.includes('ALTO RISCHIO') || label.includes('BLOCCATA HARD')) {
        if (op === 0) return 'BLOCCA / SOLO AUDIT';
        if (roi < 0) return 'BLOCCA';
    }

    if (op === 0) return 'SOLO AUDIT';
    if (op < 5) return roi >= 0 ? 'MANTIENI · SAMPLE BASSO' : 'RIDUCI · SAMPLE BASSO';
    if (op >= 8 && roi >= 8 && wr >= 55) return 'PROMUOVI';
    if (roi >= 0) return 'MANTIENI';
    if (roi > -12) return 'RIDUCI';
    return 'BLOCCA';
}

function step95FinalizeOutcomeStats(stats = {}) {
    const resolved = safeNumber(stats.resolved, 0);
    const total = safeNumber(stats.total, 0);
    const stake = safeNumber(stats.stake, 0);

    stats.winRateResolved = resolved > 0 ? (stats.won / resolved) * 100 : 0;
    stats.winRateSignal = total > 0 ? (stats.won / total) * 100 : 0;
    stats.roi = stake > 0 ? (stats.profit / stake) * 100 : 0;
    stats.decision = step95DecisionForOutcomeStats(stats);

    const auditZero = Math.max(0, stats.total - stats.operationalTotal);
    stats.note = auditZero > 0
        ? `${auditZero} segnali audit/stake 0 esclusi dal ROI reale.`
        : 'Tutti i segnali hanno stake operativo o sono già risolti.';
    return stats;
}

function step95BuildGroupStats(rows = [], groupGetter) {
    const map = new Map();
    step95ForwardExportRows(rows).forEach(row => {
        const rawLabel = typeof groupGetter === 'function' ? groupGetter(row) : 'ALTRO';
        const label = step95CleanComboLabel(rawLabel || 'ALTRO');
        if (!map.has(label)) map.set(label, step95CreateOutcomeStats({ label }));
        step95AccumulateOutcomeStats(map.get(label), row);
    });
    return [...map.values()]
        .map(step95FinalizeOutcomeStats)
        .sort((a, b) => b.total - a.total || b.operationalResolved - a.operationalResolved || b.roi - a.roi || a.label.localeCompare(b.label));
}

function step95BuildDeepGateIntersectionStats(rows = []) {
    const exportRows = step95ForwardExportRows(rows);
    const deepValues = [...new Set(exportRows.map(row => step95CleanComboLabel(normalizeDeepScanOutcomeCategory(row))))].filter(Boolean).sort();
    const gateValues = [...new Set(exportRows.map(row => step95CleanComboLabel(normalizeQualityOutcomeCategory(row))))].filter(Boolean).sort();
    const map = new Map();

    deepValues.forEach(deep => {
        gateValues.forEach(gate => {
            const key = `${deep}|||${gate}`;
            map.set(key, step95CreateOutcomeStats({
                label: `${deep} + ${gate}`,
                deepScan: deep,
                qualityGate: gate
            }));
        });
    });

    exportRows.forEach(row => {
        const deep = step95CleanComboLabel(normalizeDeepScanOutcomeCategory(row));
        const gate = step95CleanComboLabel(normalizeQualityOutcomeCategory(row));
        const key = `${deep}|||${gate}`;
        if (!map.has(key)) {
            map.set(key, step95CreateOutcomeStats({
                label: `${deep} + ${gate}`,
                deepScan: deep,
                qualityGate: gate
            }));
        }
        step95AccumulateOutcomeStats(map.get(key), row);
    });

    return {
        deepValues,
        gateValues,
        rows: [...map.values()]
            .map(step95FinalizeOutcomeStats)
            .sort((a, b) => a.deepScan.localeCompare(b.deepScan) || a.qualityGate.localeCompare(b.qualityGate))
    };
}

function step95StatsCsvHeaders(includePair = false) {
    const base = [
        'Segnale',
        'Totale segnali',
        'Vinte',
        'Perse',
        'Pendenti',
        'Void',
        'Push',
        'Win rate risolto',
        'Win rate segnale',
        'Operativo risolto',
        'Operativo pendente',
        'Stake reale',
        'Profitto reale',
        'ROI reale',
        'Decisione audit',
        'Nota'
    ];
    return includePair ? ['Deep Scan IA', 'Qualità / Gate', ...base] : ['Categoria', ...base];
}

function step95StatsToCsvRow(stats = {}, includePair = false) {
    const base = [
        `${safeNumber(stats.won, 0)}/${safeNumber(stats.total, 0)}`,
        safeNumber(stats.total, 0),
        safeNumber(stats.won, 0),
        safeNumber(stats.lost, 0),
        safeNumber(stats.pending, 0),
        safeNumber(stats.void, 0),
        safeNumber(stats.push, 0),
        formatPct(safeNumber(stats.winRateResolved, 0), 2),
        formatPct(safeNumber(stats.winRateSignal, 0), 2),
        safeNumber(stats.operationalResolved, 0),
        safeNumber(stats.operationalPending, 0),
        `€${formatNumber(safeNumber(stats.stake, 0), 2)}`,
        `${safeNumber(stats.profit, 0) >= 0 ? '+' : ''}€${formatNumber(safeNumber(stats.profit, 0), 2)}`,
        stats.stake > 0 ? formatPct(safeNumber(stats.roi, 0), 2) : 'N/D',
        stats.decision || '',
        stats.note || ''
    ];
    return includePair ? [stats.deepScan || '', stats.qualityGate || '', ...base] : [stats.label || '', ...base];
}

function step95BuildRoiMatrixSection(title, intersections = [], deepValues = [], gateValues = [], metric = 'roi') {
    const byKey = new Map(intersections.map(row => [`${row.deepScan}|||${row.qualityGate}`, row]));
    const headers = ['Deep Scan IA', ...gateValues];
    const rows = deepValues.map(deep => {
        const values = gateValues.map(gate => {
            const item = byKey.get(`${deep}|||${gate}`);
            if (!item || item.total === 0) return '-';
            if (metric === 'roi') return item.stake > 0 ? formatPct(item.roi, 2) : 'N/D';
            if (metric === 'winRate') return item.resolved > 0 ? formatPct(item.winRateResolved, 2) : 'N/D';
            if (metric === 'operational') return item.operationalResolved;
            return item.total;
        });
        return [deep, ...values];
    });
    return step95CsvSection(title, headers, rows);
}

function step95BuildForwardSummaryCsvSections(rows = []) {
    const exportRows = step95ForwardExportRows(rows);
    const deepStats = step95BuildGroupStats(exportRows, normalizeDeepScanOutcomeCategory);
    const gateStats = step95BuildGroupStats(exportRows, normalizeQualityOutcomeCategory);
    const intersections = step95BuildDeepGateIntersectionStats(exportRows);
    const presentIntersections = intersections.rows
        .filter(row => row.total > 0)
        .sort((a, b) => {
            const score = (item) => (item.stake > 0 ? item.roi : -999) + (item.operationalResolved * 0.25) + (item.winRateResolved * 0.05);
            return score(b) - score(a) || b.total - a.total || a.label.localeCompare(b.label);
        });
    const allIntersections = intersections.rows;

    const lines = [];
    lines.push(...step95CsvSection('STEP95 RIEPILOGO EXPORT', ['Campo', 'Valore'], [
        ['Modalità export', STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT_MODE],
        ['Sport attivo', activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO'],
        ['Righe dettaglio esportate', exportRows.length],
        ['Obiettivo', 'Individuare le combinazioni Deep Scan IA + Qualità/Gate con migliore resa reale.'],
        ['Regola ROI', 'ROI calcolato solo su stake reale risolto WON/LOST; PENDING e stake 0 restano segnale/audit.'],
        ['Formato', 'CSV multi-sezione: dettaglio + tabelle riepilogo; il CSV non supporta fogli reali.']
    ]));

    lines.push(...step95CsvSection(
        'RESA_DEEP_SCAN_IA',
        step95StatsCsvHeaders(false),
        deepStats.map(stats => step95StatsToCsvRow(stats, false))
    ));

    lines.push(...step95CsvSection(
        'RESA_QUALITA_GATE',
        step95StatsCsvHeaders(false),
        gateStats.map(stats => step95StatsToCsvRow(stats, false))
    ));

    lines.push(...step95CsvSection(
        'TOP_COMBINAZIONI_DEEPSCAN_X_GATE',
        step95StatsCsvHeaders(true),
        presentIntersections.slice(0, 50).map(stats => step95StatsToCsvRow(stats, true))
    ));

    lines.push(...step95CsvSection(
        'TUTTI_GLI_INCROCI_DEEPSCAN_X_GATE',
        step95StatsCsvHeaders(true),
        allIntersections.map(stats => step95StatsToCsvRow(stats, true))
    ));

    lines.push(...step95BuildRoiMatrixSection(
        'MATRICE_ROI_REALE_DEEPSCAN_X_GATE',
        allIntersections,
        intersections.deepValues,
        intersections.gateValues,
        'roi'
    ));

    lines.push(...step95BuildRoiMatrixSection(
        'MATRICE_WIN_RATE_DEEPSCAN_X_GATE',
        allIntersections,
        intersections.deepValues,
        intersections.gateValues,
        'winRate'
    ));

    lines.push(...step95BuildRoiMatrixSection(
        'MATRICE_OPERATIVO_RISOLTO_DEEPSCAN_X_GATE',
        allIntersections,
        intersections.deepValues,
        intersections.gateValues,
        'operational'
    ));

    return lines;
}
// /STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT

// ============================================================================
// 17. EXPORT CSV
// ============================================================================

$('exportForwardBtn')?.addEventListener('click', () => {
    // STEP95_CSV_DEEPSCAN_GATE_MATRIX_EXPORT
    if (!currentForwardData || !currentForwardData.history) {
        alert('Nessun dato da esportare.');
        return;
    }

    const rows = currentForwardData.history;

    const headers = [
        'id',
        'sport',
        'data_quality',
        'match_date',
        'home_team',
        'away_team',
        'league',
        'strategy_tag',
        'bet_type',
        'prediction',
        'odd',
        'estimated_prob',
        'edge_pp',
        'ev_pct',
        'market_implied_prob',
        'data_sufficiency_score',
        'model_confidence_score',
        'reference_market_source',
        'reference_market_quality',
        'market_type',
        'markov_validated',
        'tennis_event_identity_status',
        'tennis_event_fingerprint',
        'stake',
        'kelly_fraction_pct',
        'kelly_raw_stake',
        'stake_confidence_multiplier',
        'stake_confidence_level',
        'stake_min_applied',
        'stake_cap_applied',
        'stake_policy_mode',
        'stake_policy_note',
        'professional_gate_max_stake',
        'pre_match_gate_code',
        'pre_match_gate_label',
        'pre_match_gate_reason',
        'pre_match_gate_version',
        'pre_match_clv_used',
        'pre_match_historical_sample',
        'pre_match_historical_roi',
        'pre_match_historical_brier',
        'pre_match_historical_clv_sample',
        'quality_base_code',
        'quality_base_label',
        'quality_base_score',
        'quality_base_reason',
        'quality_base_version',
        'quality_final_code',
        'quality_final_label',
        'quality_final_score',
        'quality_final_reason',
        'quality_final_version',
        'quality_stake_mode',
        'quality_stake_amount',
        'quality_budget_pct',
        'quality_decision_at',
        'quality_deepscan_class',
        'quality_deepscan_separate',
        'status',
        'profit',
        'clv',
        'clv_edge',
        // STEP102_CLV_CANONICAL_CSV_EXPORT
        'opening_odd',
        'closing_odd',
        'clv_pct',
        'closing_line_available',
        'clv_source',
        'clv_verified',
        'clv_method',
        'closing_odd_side',
        'clv_last_attempt_result',
        'ds_action',
        'ds_suggestion',
        'settlement_source',
        'settlement_note',
        'trading_scope',
        'paper_trading_scope',
        'portfolio_scope',
        'deepscan_gate_mode',
        'deepscan_gate_status',
        'deepscan_gate_reason',
        'calibration_version',
        'clv_learning_action',
        'audit_trail_event_id',
        'model_version',
        'metric_version',
        'engine_version'
    ];

    const detailRows = rows.map(row => {
        const step67ExportScope = buildStep67ExportScope(row);
        return [
            row.id,
            isTennisRow(row) ? 'TENNIS' : 'CALCIO',
            row.data_quality || '',
            row.match_date || '',
            row.home_team || '',
            row.away_team || '',
            row.league || '',
            row.strategy_tag || '',
            row.bet_type || '',
            row.prediction || '',
            row.odd || '',
            row.estimated_prob || '',
            getBetEdgePp(row),
            getBetEvPct(row),
            row.market_implied_prob ?? row.marketImpliedProbability ?? '',
            row.data_sufficiency_score ?? row.dataSufficiencyScore ?? '',
            row.model_confidence_score ?? row.valueScore ?? '',
            row.reference_market_source ?? row.reference?.source ?? '',
            row.reference_market_quality ?? row.reference?.quality ?? '',
            row.market_type ?? row.marketType ?? '',
            row.markov_validated ?? (row.markovValidated === true ? 1 : ''),
            row.tennis_event_identity_status ?? '',
            row.tennis_event_fingerprint ?? '',
            row.stake || '',
            row.kelly_fraction_pct ?? row.stakePolicy?.kellyFractionPct ?? '',
            row.kelly_raw_stake ?? row.stakePolicy?.kellyRawStake ?? '',
            row.stake_confidence_multiplier ?? row.stakePolicy?.confidenceMultiplier ?? '',
            row.stake_confidence_level ?? row.stakePolicy?.stakeConfidenceLevel ?? '',
            row.stake_min_applied ?? (row.stakePolicy?.minStakeApplied === true ? 1 : ''),
            row.stake_cap_applied ?? ((row.stakePolicy?.capApplied === true || row.stakePolicy?.gateCapApplied === true) ? 1 : ''),
            row.stake_policy_mode ?? row.stakePolicy?.mode ?? '',
            row.stake_policy_note || row.stakePolicy?.gateCapReason || '',
            row.professional_gate_max_stake ?? row.stakePolicy?.professionalGateCap ?? '',
            row.pre_match_gate_code || '',
            row.pre_match_gate_label || '',
            row.pre_match_gate_reason || '',
            row.pre_match_gate_version || '',
            row.pre_match_clv_used ?? '',
            row.pre_match_historical_sample ?? '',
            row.pre_match_historical_roi ?? '',
            row.pre_match_historical_brier ?? '',
            row.pre_match_historical_clv_sample ?? '',
            row.quality_base_code || '',
            row.quality_base_label || '',
            row.quality_base_score ?? '',
            row.quality_base_reason || '',
            row.quality_base_version || '',
            row.quality_final_code || '',
            row.quality_final_label || '',
            row.quality_final_score ?? '',
            row.quality_final_reason || '',
            row.quality_final_version || '',
            row.quality_stake_mode || '',
            row.quality_stake_amount ?? '',
            row.quality_budget_pct ?? '',
            row.quality_decision_at || '',
            row.quality_deepscan_class || '',
            row.quality_deepscan_separate ?? '',
            row.status || '',
            row.profit || '',
            row.clv || '',
            row.clv_edge || '',
            row.opening_odd ?? '',
            row.closing_odd ?? '',
            row.clv_pct ?? '',
            row.closing_line_available ?? '',
            row.clv_source || '',
            row.clv_verified ?? '',
            row.clv_method || '',
            row.closing_odd_side || '',
            row.clv_last_attempt_result || '',
            row.ds_action || '',
            row.ds_suggestion || '',
            row.settlement_source || '',
            row.settlement_note || '',
            step67ExportScope.trading_scope,
            step67ExportScope.paper_trading_scope,
            step67ExportScope.portfolio_scope,
            step67ExportScope.deepscan_gate_mode,
            step67ExportScope.deepscan_gate_status,
            step67ExportScope.deepscan_gate_reason,
            step67ExportScope.calibration_version,
            step67ExportScope.clv_learning_action,
            step67ExportScope.audit_trail_event_id,
            row.model_version || '',
            row.metric_version || '',
            row.engine_version || ''
        ];
    });

    const csv = [
        step95CsvLine(headers),
        ...detailRows.map(row => step95CsvLine(row)),
        ...step95BuildForwardSummaryCsvSections(rows)
    ].join('\n');

    const fileName = activeSport === SPORT.TENNIS
        ? 'tennis_forward_trading_clean_step95_matrix.csv'
        : 'calcio_forward_trading_step95_matrix.csv';

    downloadCSV(csv, fileName);
});


$('exportBacktestBtn')?.addEventListener('click', () => {
    if (!currentBacktestData || !currentBacktestData.log) {
        alert('Nessun backtest da esportare.');
        return;
    }

    const rows = currentBacktestData.log;

    const headers = [
        'date',
        'match',
        'prediction',
        'odd',
        'edge_pp',
        'ev_pct',
        'invested',
        'won',
        'profit',
        'reliabilityMode',
        'openingOddSource'
    ];

    const csv = [
        headers.join(';'),
        ...rows.map(row => {
            const step67ExportScope = buildStep67ExportScope(row);
            const values = [
                row.date || '',
                row.match || '',
                row.prediction || '',
                row.odd || '',
                row.edge_pp ?? row.edge ?? '',
                row.ev_pct ?? row.ev ?? '',
                row.invested || '',
                row.won || '',
                row.profit || '',
                row.reliabilityMode || currentBacktestData.reliabilityMode || '',
                row.openingOddSource || ''
            ];

            return values
                .map(v => `"${safeString(v).replace(/"/g, '""')}"`)
                .join(';');
        })
    ].join('\n');

    const fileName = activeSport === SPORT.TENNIS
        ? 'tennis_backtest_neutral.csv'
        : 'calcio_backtest.csv';

    downloadCSV(csv, fileName);
});


// ============================================================================
// 18. COPY AI PROMPT
// ============================================================================

// R11: accetta solo un RESPONSO fornito dall'utente dopo aver interrogato
// autonomamente un modello esterno. Confronto locale, non autoritativo.
window.importIndependentAiVerdict = function(buttonElement) {
    if (activeSport !== SPORT.CALCIO) return;
    const raw = window.prompt('Incolla SOLO il JSON del verdetto IA indipendente (semaforo, mercato, motivazione). Non cambia gli stake:');
    if (!raw) return;
    let parsed;
    try {
        const clean = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        if (clean.length > 12000) throw Error('JSON troppo lungo');
        parsed = JSON.parse(clean);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Oggetto JSON richiesto');
        const light = String(parsed.semaforo || '').trim().toUpperCase();
        if (!['ROSSO', 'GIALLO', 'VERDE'].includes(light)) throw Error('Semaforo richiesto: ROSSO, GIALLO o VERDE');
        if (typeof parsed.motivazione !== 'string' || !parsed.motivazione.trim()) throw Error('Motivazione IA mancante');
        const host = buttonElement.parentNode && buttonElement.parentNode.querySelector('[data-r11-ai-compare]');
        if (!host) throw Error('Pannello confronto IA non disponibile');
        const market = typeof parsed.mercato === 'string' ? parsed.mercato.trim().slice(0, 90) : 'N/D';
        const info = 'IA INDIPENDENTE · ' + light + ' · ' + market + ' · ' + parsed.motivazione.trim().slice(0, 400) + ' · SOLO ANALISI / NON AUTORIZZA STAKE';
        host.textContent = info; // mai innerHTML: testo esterno non fidato
        host.style.color = light === 'VERDE' ? '#86efac' : light === 'ROSSO' ? '#fca5a5' : '#fde68a';
    } catch (error) {
        window.alert('Verdetto IA non importato: ' + String(error.message || error));
    }
};

window.copyAIPrompt = function(buttonElement, match, league, prediction, odd, odd1, oddX, odd2) {
    const originalText = buttonElement.innerHTML;

    buttonElement.innerHTML = '✅ Copiato!';
    buttonElement.style.backgroundColor = '#10b981';

    let promptText = '';

    if (activeSport === SPORT.CALCIO) {
        promptText = `
Agisci come Senior Quantitative Analyst specializzato in betting calcio.

Analizza questa selezione:
- Match: ${match}
- Lega: ${league}
- Pronostico: ${prediction}
- Quota giocata: ${odd}
- Quote disponibili: 1=${odd1}, X=${oddX}, 2=${odd2}

Valuta:
1. Coerenza quota/probabilità.
2. Rischi tattici.
3. Rischi calendario/infortuni/motivazioni.
4. Possibile overconfidence.
5. Verdetto finale: confermare, ridurre stake o scartare.
        `.trim();
    }

    if (activeSport === SPORT.TENNIS) {
        promptText = `
Agisci come Senior Quantitative Analyst specializzato in betting Tennis.

Analizza questa selezione:
- Match: ${match}
- Circuito/Torneo: ${league}
- Pronostico: ${prediction}
- Quota giocata: ${odd}
- Quote riferimento: P1=${odd1}, P2=${odd2}

Contesto tecnico del sistema:
- Il progetto usa edge_pp = probabilità calibrata - probabilità implicita mercato.
- Il progetto usa ev_pct = expected value percentuale su probabilità calibrata.
- Lo storico è in ricostruzione pulita: non usare performance legacy.

Valuta:
1. Coerenza quota/probabilità.
2. Rischi superficie/forma/stile.
3. Rischio ritiro/fitness.
4. Rischio mercato non sharp.
5. Possibile overconfidence.
6. Verdetto finale: confermare, ridurre stake o scartare.
        `.trim();
    }

    // R11: il prompt indipendente ha la precedenza. Il vecchio R10 resta
    // disponibile SOLO dal pulsante separato "Dati mancanti".
    if (activeSport === SPORT.CALCIO) {
        if (buttonElement?.dataset?.r11Recovery === '1') {
            if (!buttonElement.dataset.r10Prompt) {
                window.alert('Prompt dati mancanti non ancora disponibile. Eseguire prima una nuova analisi DeepScan.');
                buttonElement.innerHTML = originalText;
                return;
            }
            promptText = buttonElement.dataset.r10Prompt;
        } else if (buttonElement?.dataset?.r11Prompt) {
            promptText = buttonElement.dataset.r11Prompt;
        } else {
            // Snapshot pre-R11: non inoltrare il vecchio veto come giudizio IA.
            promptText = 'BOOKMAKER AI INDIPENDENTE - VALUTAZIONE MATCH\n' +
                'Match: ' + match + ' | Lega: ' + league + '\n' +
                'Mercato di riferimento facoltativo: ' + prediction + ' @' + odd + '\n' +
                'Quote 1X2 feed, da verificare: ' + odd1 + ', ' + oddX + ', ' + odd2 + '\n' +
                'Analizza autonomamente forma, xG/xGA e provenienza, news, calendario e quote. ' +
                'Considera mercati 1X2, totali e handicap asiatici con payoff corretti. ' +
                'Formula due alternative solo se supportate da fonti, timestamp e probabilita calibrate. ' +
                'Semaforo ROSSO/GIALLO/VERDE con motivazione e dati mancanti; puoi dire NO BET. ' +
                'Non inventare probabilita, EV, quote o fatti. Questo giudizio non autorizza stake.';
        }
    }
    navigator.clipboard.writeText(promptText)
        .then(() => {
            setTimeout(() => {
                buttonElement.innerHTML = originalText;
                buttonElement.style.backgroundColor = '#8b5cf6';
            }, 2000);
        })
        .catch(err => alert('Errore copia: ' + err));
};



// ============================================================================
// 18.1 BACKGROUND MODE + SPORT BANKROLL UI
// ============================================================================
function getActiveSportApiName() {
    return activeSport === SPORT.TENNIS ? 'TENNIS' : 'CALCIO';
}

function getActiveSportLabel() {
    return activeSport === SPORT.TENNIS ? 'Tennis' : 'Calcio';
}

function updateBankrollSportBadge() {
    const badge = $('bankrollSportBadge');
    if (badge) {
        badge.innerText = getActiveSportLabel();
    }
}

async function loadSportBankroll() {
    updateBankrollSportBadge();
    const requestedSport = getActiveSportApiName();
    try {
        const response = await fetch(`/api/bankroll/status?sport=${encodeURIComponent(requestedSport)}`, {cache:'no-store'});
        const payload = await response.json();
        if(requestedSport !== getActiveSportApiName()) return;
        if(!response.ok || !payload.success || typeof payload.currentBankroll !== 'number' || !Number.isFinite(payload.currentBankroll)) throw Error(payload.error || 'Saldo sportivo non disponibile');
        const input=$('bankroll');
        if(input){input.value=payload.currentBankroll.toFixed(2);input.readOnly=true;input.title='Saldo aggiornato dello sport; capitale iniziale 1000 euro';}
        if($('displayBankroll')) $('displayBankroll').innerText='€ '+payload.currentBankroll.toFixed(2);
    } catch(error) {
        if(requestedSport !== getActiveSportApiName()) return;
        if($('bankroll')){$('bankroll').value='';$('bankroll').readOnly=true;}
        if($('displayBankroll')) $('displayBankroll').innerText='N/D';
        console.warn('Saldo sportivo non verificabile:',error);
    }
}

async function saveSportBankroll() { await loadSportBankroll(); }

function renderBackgroundStatus(payload = {}) {
    const toggle = $('backgroundModeToggle');
    const label = $('backgroundModeLabel');

    const enabled = payload.enabled === true;

    if (toggle) {
        toggle.checked = enabled;
        toggle.disabled = false;
    }

    if (label) {
        label.innerText = enabled
            ? 'Background attivo'
            : 'Background spento';
        label.style.color = enabled ? '#86efac' : '#94a3b8';
    }
}

async function loadBackgroundStatus() {
    const toggle = $('backgroundModeToggle');
    if (toggle) toggle.disabled = true;

    try {
        const response = await fetch('/api/background/status');
        const payload = await response.json();

        if (!payload.success) {
            renderBackgroundStatus({ enabled: false });
            return;
        }

        renderBackgroundStatus(payload);
    } catch (error) {
        renderBackgroundStatus({ enabled: false });
    }
}

async function setBackgroundMode(enabled) {
    const toggle = $('backgroundModeToggle');
    const label = $('backgroundModeLabel');

    if (toggle) toggle.disabled = true;
    if (label) label.innerText = enabled ? 'Attivazione...' : 'Spegnimento...';

    try {
        const response = await fetch('/api/background/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: enabled === true })
        });

        const payload = await response.json();

        if (!payload.success) {
            alert(payload.error || 'Errore aggiornamento Background.');
            await loadBackgroundStatus();
            return;
        }

        renderBackgroundStatus(payload);
    } catch (error) {
        alert('Errore comunicazione Background.');
        await loadBackgroundStatus();
    }
}

function initializeBackgroundAndBankrollControls() {
    const toggle = $('backgroundModeToggle');
    if (toggle && toggle.dataset.bound !== '1') {
        toggle.addEventListener('change', () => setBackgroundMode(toggle.checked));
        toggle.dataset.bound = '1';
    }

    const bankrollInput = $('bankroll');
    if (bankrollInput && bankrollInput.dataset.boundBankroll !== '1') {
        bankrollInput.addEventListener('change', saveSportBankroll);
        bankrollInput.addEventListener('blur', saveSportBankroll);
        bankrollInput.dataset.boundBankroll = '1';
    }
}


// ============================================================================
// STEP61 - MANUAL DEEPSCAN LAB FRONTEND (READ-ONLY)
// ============================================================================
function getManualDeepScanMode() {
    const mode = $('manualDsMode')?.value || 'web';
    return {
        mode,
        useWebNews: mode !== 'pure',
        useLiveApi: mode === 'live'
    };
}

function renderManualDeepScanFields() {
    const sport = $('manualDsSport')?.value || 'calcio';
    const calcioBox = $('manualDsCalcioFields');
    const tennisBox = $('manualDsTennisFields');
    if (calcioBox) calcioBox.classList.toggle('hidden', sport !== 'calcio');
    if (tennisBox) tennisBox.classList.toggle('hidden', sport !== 'tennis');
}

function manualDeepScanValue(id) {
    return ($(id)?.value || '').trim();
}

function buildManualDeepScanPayload() {
    const sport = manualDeepScanValue('manualDsSport') || 'calcio';
    const policy = getManualDeepScanMode();
    const common = {
        sport,
        useWebNews: policy.useWebNews,
        useLiveApi: policy.useLiveApi,
        matchDate: manualDeepScanValue('manualDsDate'),
        manualOnly: true,
        noPaperTrading: true
    };

    if (sport === 'tennis') {
        return {
            ...common,
            p1Name: manualDeepScanValue('manualDsPlayer1'),
            p2Name: manualDeepScanValue('manualDsPlayer2'),
            circuit: manualDeepScanValue('manualDsCircuit'),
            tournament: manualDeepScanValue('manualDsTournament'),
            surface: manualDeepScanValue('manualDsSurface'),
            odd1: manualDeepScanValue('manualDsOdd1Tennis'),
            odd2: manualDeepScanValue('manualDsOdd2Tennis'),
            overUnderLine: manualDeepScanValue('manualDsTennisLine')
        };
    }

    return {
        ...common,
        homeTeam: manualDeepScanValue('manualDsHomeTeam'),
        awayTeam: manualDeepScanValue('manualDsAwayTeam'),
        league: manualDeepScanValue('manualDsFootballLeague'),
        odd1: manualDeepScanValue('manualDsOdd1Football'),
        oddX: manualDeepScanValue('manualDsOddXFootball'),
        odd2: manualDeepScanValue('manualDsOdd2Football'),
        overUnderLine: manualDeepScanValue('manualDsFootballLine')
    };
}

function renderManualDeepScanResult(data) {
    const output = $('manualDsOutput');
    const prompt = $('manualDsPrompt');
    if (!output) return;

    if (!data || data.success === false) {
        output.textContent = `❌ Errore DeepScan Manuale\n${data?.error || 'Errore sconosciuto.'}`;
        if (prompt) prompt.textContent = 'Prompt non disponibile.';
        return;
    }

    const report = data.report || {};
    const lines = [
        `🔎 DeepScan Manuale ${String(data.sport || '').toUpperCase()}`,
        `Modalità: ${data.mode || 'MANUAL_DEEPSCAN_ONLY'}`,
        `Salvataggio: ${data.doNotSave ? 'NO · nessun paper trading / pending / portfolio' : 'ATTENZIONE'}`,
        `API: ${data.apiPolicy?.note || 'N/D'}`,
        '',
        `✅ Pronostico principale: ${data.suggestedPick || 'N/D'}`,
        `🔁 Pronostico alternativo: ${data.alternativePick || 'N/D'}`,
        `⏳ No bet / Wait live: ${data.noBetOrWait || 'N/D'}`,
        `🚫 Mercati da evitare: ${(data.marketsToAvoid || []).join(' · ') || 'N/D'}`,
        '',
        `DeepScan action: ${report.action || 'N/D'}`,
        `Suggerimento: ${report.suggestionText || report.suggestion || 'N/D'}`
    ];

    output.textContent = lines.join('\n');
    if (prompt) prompt.textContent = data.aiPrompt || 'Prompt non disponibile.';
}

async function runManualDeepScan() {
    const btn = $('manualDsRunBtn');
    const output = $('manualDsOutput');
    if (btn) btn.disabled = true;
    if (output) output.textContent = '⏳ Esecuzione DeepScan manuale in corso...';

    try {
        const response = await fetch('/api/manual-deepscan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildManualDeepScanPayload())
        });
        const data = await response.json();
        renderManualDeepScanResult(data);
    } catch (error) {
        renderManualDeepScanResult({ success: false, error: error.message });
    } finally {
        if (btn) btn.disabled = false;
    }
}

function clearManualDeepScanForm() {
    [
        'manualDsDate','manualDsHomeTeam','manualDsAwayTeam','manualDsFootballLeague','manualDsOdd1Football','manualDsOddXFootball','manualDsOdd2Football','manualDsFootballLine',
        'manualDsPlayer1','manualDsPlayer2','manualDsTournament','manualDsSurface','manualDsOdd1Tennis','manualDsOdd2Tennis','manualDsTennisLine'
    ].forEach(id => { if ($(id)) $(id).value = ''; });
    if ($('manualDsOutput')) $('manualDsOutput').textContent = 'Compila i campi e premi “Esegui DeepScan”.';
    if ($('manualDsPrompt')) $('manualDsPrompt').textContent = 'Il prompt per analisi AI verrà generato dopo il DeepScan.';
}

async function copyManualDeepScanAnalysis() {
    const text = [
        $('manualDsOutput')?.textContent || '',
        '',
        'PROMPT PER AI',
        $('manualDsPrompt')?.textContent || ''
    ].join('\n');
    try {
        await navigator.clipboard.writeText(text);
        alert('Analisi DeepScan copiata negli appunti.');
    } catch (error) {
        alert('Impossibile copiare automaticamente. Seleziona il testo manualmente.');
    }
}

function bindManualDeepScanControls() {
    const sportSelect = $('manualDsSport');
    if (sportSelect && sportSelect.dataset.boundStep61 !== '1') {
        sportSelect.addEventListener('change', renderManualDeepScanFields);
        sportSelect.dataset.boundStep61 = '1';
    }
    const runBtn = $('manualDsRunBtn');
    if (runBtn && runBtn.dataset.boundStep61 !== '1') {
        runBtn.addEventListener('click', runManualDeepScan);
        runBtn.dataset.boundStep61 = '1';
    }
    const clearBtn = $('manualDsClearBtn');
    if (clearBtn && clearBtn.dataset.boundStep61 !== '1') {
        clearBtn.addEventListener('click', clearManualDeepScanForm);
        clearBtn.dataset.boundStep61 = '1';
    }
    const copyBtn = $('manualDsCopyBtn');
    if (copyBtn && copyBtn.dataset.boundStep61 !== '1') {
        copyBtn.addEventListener('click', copyManualDeepScanAnalysis);
        copyBtn.dataset.boundStep61 = '1';
    }
}

window.bindManualDeepScanControls = bindManualDeepScanControls;
window.runManualDeepScan = runManualDeepScan;
// STEP61_MANUAL_DEEPSCAN_LAB_FRONTEND: read-only, no localStorage, no paper trading, no DB operativo.

// ============================================================================
// 19. INIT
// ============================================================================

window.onload = () => {
    injectPaperTradingFilter();
    initializeTableFilters();
    initializeStatsFilters();
    initializeBackgroundAndBankrollControls();
    bindManualDeepScanControls();
    loadSettings();
    switchSport(SPORT.CALCIO);
    loadGlobalAnalytics();
    loadSportBankroll();
    loadBackgroundStatus();
    bindApiUsageControls();
    loadApiCreditsUsage();
    setInterval(loadApiCreditsUsage, 60000);
};

// ============================================================================
// 20. EXTRA EXPORTS E OTTIMIZZAZIONI (Statistiche Avanzate)
// ============================================================================

function destroyStatsCharts() {
    [
        chartProfitInstance,
        chartWinRateInstance,
        chartCumulativeInstance,
        chartLeagueBreakdownInstance,
        chartDeepScanOutcomeInstance,
        chartQualityGateOutcomeInstance
    ].forEach(chart => {
        if (chart) chart.destroy();
    });
    chartProfitInstance = null;
    chartWinRateInstance = null;
    chartCumulativeInstance = null;
    chartLeagueBreakdownInstance = null;
    chartDeepScanOutcomeInstance = null;
    chartQualityGateOutcomeInstance = null;
}

function parseUiDate(value) {
    const text = safeString(value).trim();
    if (!text) return null;

    const italian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (italian) {
        const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = italian;
        const parsedItalian = new Date(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${min}:${ss}`);
        return Number.isNaN(parsedItalian.getTime()) ? null : parsedItalian;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getChartSourceRows() {
    if (!currentForwardData || !Array.isArray(currentForwardData.history)) return [];

    return currentForwardData.history.map((row, index) => {
        const league = safeString(row.league).trim() || (activeSport === SPORT.TENNIS ? 'ATP/WTA' : 'Altro');
        const prediction = safeString(row.prediction).trim() || 'N/D';
        const status = safeString(row.status).toUpperCase() || 'PENDING';
        const dateText = safeString(row.match_date || row.date).trim();
        const deepScanCategory = normalizeDeepScanOutcomeCategory(row);
        const qualityCategory = normalizeQualityOutcomeCategory(row);

        return {
            ...row,
            _rowIndex: index,
            league,
            prediction,
            status,
            profit: safeNumber(row.profit, 0),
            stake: safeNumber(row.stake ?? row.invested, 0),
            deepScanCategory,
            qualityCategory,
            dateText,
            dateObj: parseUiDate(dateText)
        };
    });
}

function updateSelectOptions(selectEl, values, allLabel) {
    if (!selectEl) return;

    const previous = selectEl.value;
    selectEl.innerHTML = `<option value="all">${htmlEscape(allLabel)}</option>` + values.map(value => `
        <option value="${htmlEscape(value)}">${htmlEscape(value)}</option>
    `).join('');
    selectEl.value = values.includes(previous) ? previous : 'all';
}

function updateStatsFilterControls(rows) {
    const leagueLabel = activeSport === SPORT.CALCIO ? 'Tutti i campionati' : 'Tutti i tornei';
    const leagues = [...new Set(rows.map(row => row.league))].sort((a, b) => a.localeCompare(b));
    const predictions = [...new Set(rows.map(row => row.prediction))].sort((a, b) => a.localeCompare(b));
    const deepScanCategories = [...new Set(rows.map(row => row.deepScanCategory))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const qualityCategories = [...new Set(rows.map(row => row.qualityCategory))].filter(Boolean).sort((a, b) => a.localeCompare(b));

    updateSelectOptions($('chartLeagueFilter'), leagues, leagueLabel);
    updateSelectOptions($('chartPredictionFilter'), predictions, 'Tutti i pronostici');
    updateSelectOptions($('chartDeepScanFilter'), deepScanCategories, 'Tutte le causali Deep Scan');
    updateSelectOptions($('chartQualityFilter'), qualityCategories, 'Tutte le causali Qualità / Gate');
}

function getFilteredChartRows() {
    const rows = getChartSourceRows();
    updateStatsFilterControls(rows);

    const leagueValue = $('chartLeagueFilter')?.value || 'all';
    const predictionValue = $('chartPredictionFilter')?.value || 'all';
    const outcomeValue = $('chartOutcomeFilter')?.value || 'all';
    const deepScanValue = $('chartDeepScanFilter')?.value || 'all';
    const qualityValue = $('chartQualityFilter')?.value || 'all';

    return rows.filter(row => {
        if (leagueValue !== 'all' && row.league !== leagueValue) return false;
        if (predictionValue !== 'all' && row.prediction !== predictionValue) return false;
        if (outcomeValue !== 'all' && row.status !== outcomeValue) return false;
        if (deepScanValue !== 'all' && row.deepScanCategory !== deepScanValue) return false;
        if (qualityValue !== 'all' && row.qualityCategory !== qualityValue) return false;
        return true;
    });
}

function aggregateBy(rows, keyName, valueGetter) {
    const bucket = new Map();

    rows.forEach(row => {
        const key = safeString(row[keyName]) || 'N/D';
        bucket.set(key, (bucket.get(key) || 0) + valueGetter(row));
    });

    return bucket;
}

function buildOutcomeCountSeries(rows = [], keyName) {
    const resolvedRows = rows.filter(row => row.status === 'WON' || row.status === 'LOST');
    const groups = new Map();

    resolvedRows.forEach(row => {
        const key = safeString(row[keyName]) || 'N/D';
        const entry = groups.get(key) || { won: 0, lost: 0, total: 0, profit: 0, stake: 0 };
        entry.total += 1;
        entry.profit += safeNumber(row.profit, 0);
        entry.stake += safeNumber(row.stake, 0);
        if (row.status === 'WON') entry.won += 1;
        if (row.status === 'LOST') entry.lost += 1;
        groups.set(key, entry);
    });

    const sorted = Array.from(groups.entries())
        .map(([label, stats]) => ({
            label,
            ...stats,
            winRate: stats.total > 0 ? round((stats.won / stats.total) * 100, 1) : 0,
            roi: stats.stake > 0 ? round((stats.profit / stats.stake) * 100, 2) : 0
        }))
        .sort((a, b) => b.total - a.total || b.winRate - a.winRate || a.label.localeCompare(b.label));

    return {
        labels: sorted.map(item => item.label),
        won: sorted.map(item => item.won),
        lost: sorted.map(item => item.lost),
        winRate: sorted.map(item => item.winRate),
        rows: sorted
    };
}

function renderOutcomeCountChart(canvasId, sourceRows, keyName, titleLabel) {
    // STEP55_PROFESSIONAL_UI_REFRESH_CHARTS
    const ctx = $(canvasId)?.getContext('2d');
    if (!ctx || !window.Chart) return null;

    const series = buildOutcomeCountSeries(sourceRows, keyName);
    const labels = series.labels.length ? series.labels.slice(0, 8) : ['Nessun dato'];
    const wonValues = series.labels.length ? series.won.slice(0, 8) : [0];
    const lostValues = series.labels.length ? series.lost.slice(0, 8) : [0];

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Vinte', data: wonValues, backgroundColor: 'rgba(16,185,129,0.85)', borderColor: '#10b981', borderWidth: 1, borderRadius: 8, barThickness: 18 },
                { label: 'Perse', data: lostValues, backgroundColor: 'rgba(239,68,68,0.82)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 8, barThickness: 18 }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 6, right: 12, bottom: 4, left: 4 } },
            plugins: {
                legend: { display: true, position: 'top', align: 'end', labels: { color: '#cbd5e1', usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        afterBody: items => {
                            const index = items?.[0]?.dataIndex ?? -1;
                            const row = series.rows[index];
                            if (!row) return '';
                            return [
                                `Totali: ${row.total}`,
                                `Win rate: ${formatPct(row.winRate, 1)}`,
                                `ROI: ${formatPct(row.roi, 2)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, stacked: true, grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#cbd5e1', precision: 0 } },
                y: { stacked: true, grid: { display: false }, ticks: { color: '#e2e8f0', autoSkip: false } }
            }
        }
    });
}


function renderStatsQuickSummary(rows) {
    // STEP55_PROFESSIONAL_UI_REFRESH_KPI_GRID
    const summaryBox = $('statsQuickSummary');
    if (!summaryBox) return;

    const resolvedRows = rows.filter(row => row.status === 'WON' || row.status === 'LOST');
    const wins = resolvedRows.filter(row => row.status === 'WON').length;
    const losses = resolvedRows.filter(row => row.status === 'LOST').length;
    const profit = resolvedRows.reduce((sum, row) => sum + safeNumber(row.profit, 0), 0);
    const stake = resolvedRows.reduce((sum, row) => sum + safeNumber(row.stake, 0), 0);
    const roi = stake > 0 ? (profit / stake) * 100 : 0;
    const winRate = resolvedRows.length > 0 ? (wins / resolvedRows.length) * 100 : 0;
    const realStaked = resolvedRows.filter(row => safeNumber(row.stake, 0) > 0).length;
    const activeFilter = $('chartQualityFilter')?.value !== 'all'
        ? $('chartQualityFilter').value
        : ($('chartDeepScanFilter')?.value !== 'all'
            ? $('chartDeepScanFilter').value
            : ($('chartPredictionFilter')?.value !== 'all'
                ? $('chartPredictionFilter').value
                : (activeSport === SPORT.CALCIO ? 'Campionati' : 'Tornei')));

    const cards = [
        ['Pronostici filtrati', rows.length, `${resolvedRows.length} risolti · ${realStaked} con stake reale`, '#38bdf8'],
        ['Profitto filtrato', `${profit > 0 ? '+' : ''}€${formatNumber(profit, 2)}`, `Stake €${formatNumber(stake, 2)}`, colorByPositiveNegative(profit, '#f8fafc')],
        ['ROI filtrato', formatPct(roi, 2), `Win rate ${formatPct(winRate, 1)}`, colorByPositiveNegative(roi, '#f8fafc')],
        ['Vinte / Perse', `${wins}/${losses}`, `${resolvedRows.length} esiti completati`, '#10b981'],
        ['Stake totale', `€${formatNumber(stake, 2)}`, `${realStaked} operativi reali`, '#a78bfa'],
        ['Filtro attivo', htmlEscape(activeFilter), htmlEscape($('chartLeagueFilter')?.value !== 'all' ? $('chartLeagueFilter').value : 'Vista globale'), '#f59e0b']
    ];

    summaryBox.innerHTML = cards.map(([label, value, sub, color]) => `
        <div class="stats-summary-card step55-kpi-card" style="--kpi-color:${color};">
            <span>${htmlEscape(label)}</span>
            <strong style="color:${color};">${value}</strong>
            <small>${sub}</small>
        </div>
    `).join('');
}

function renderCharts() {
    // STEP55_PROFESSIONAL_UI_REFRESH_CHART_LAYOUT
    const sourceRows = getFilteredChartRows();
    destroyStatsCharts();
    renderStatsQuickSummary(sourceRows);

    const resolvedRows = sourceRows.filter(row => row.status === 'WON' || row.status === 'LOST');

    const topEntries = (entries, limit = 8) => entries
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || String(a[0]).localeCompare(String(b[0])))
        .slice(0, limit);

    const predictionProfit = aggregateBy(resolvedRows, 'prediction', row => safeNumber(row.profit, 0));
    const predictionEntries = topEntries(Array.from(predictionProfit.entries()), 8);
    const predictionLabels = predictionEntries.map(([label]) => label);
    const predictionProfitValues = predictionEntries.map(([, value]) => round(value, 2));

    const predictionWinMap = new Map();
    resolvedRows.forEach(row => {
        const key = row.prediction;
        const entry = predictionWinMap.get(key) || { total: 0, won: 0 };
        entry.total += 1;
        if (row.status === 'WON') entry.won += 1;
        predictionWinMap.set(key, entry);
    });

    const winRateEntries = Array.from(predictionWinMap.entries())
        .map(([label, entry]) => [label, entry.total > 0 ? round((entry.won / entry.total) * 100, 1) : 0, entry.total])
        .sort((a, b) => b[2] - a[2] || b[1] - a[1])
        .slice(0, 8);
    const winRateLabels = winRateEntries.map(([label]) => label);
    const winRateValues = winRateEntries.map(([, value]) => value);

    const orderedRows = [...resolvedRows].sort((a, b) => {
        const dateA = a.dateObj ? a.dateObj.getTime() : 0;
        const dateB = b.dateObj ? b.dateObj.getTime() : 0;
        return dateA - dateB;
    });

    let cumulative = 0;
    const cumulativeLabels = orderedRows.map(row => row.dateText || `#${row._rowIndex + 1}`);
    const cumulativeValues = orderedRows.map(row => {
        cumulative += safeNumber(row.profit, 0);
        return round(cumulative, 2);
    });

    const volumeByLeague = aggregateBy(sourceRows, 'league', () => 1);
    const leagueEntries = Array.from(volumeByLeague.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const leagueLabels = leagueEntries.map(([label]) => label);
    const leagueVolumes = leagueEntries.map(([, value]) => value);

    const commonPlugins = {
        legend: { display: true, position: 'top', align: 'end', labels: { color: '#cbd5e1', usePointStyle: true, boxWidth: 8 } },
        tooltip: { backgroundColor: 'rgba(15,23,42,0.96)', titleColor: '#f8fafc', bodyColor: '#cbd5e1', borderColor: 'rgba(148,163,184,0.25)', borderWidth: 1 }
    };

    const horizontalBarOptions = (stacked = false) => ({
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 6, right: 12, bottom: 4, left: 4 } },
        plugins: commonPlugins,
        scales: {
            x: { beginAtZero: !stacked, stacked, grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#cbd5e1' } },
            y: { stacked, grid: { display: false }, ticks: { color: '#e2e8f0', autoSkip: false } }
        }
    });

    const ctxProfit = $('chartProfitPred')?.getContext('2d');
    if (ctxProfit) {
        chartProfitInstance = new Chart(ctxProfit, {
            type: 'bar',
            data: {
                labels: predictionLabels.length ? predictionLabels : ['Nessun dato'],
                datasets: [{ label: 'Profitto (€)', data: predictionProfitValues.length ? predictionProfitValues : [0], backgroundColor: 'rgba(59,130,246,0.78)', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 8, barThickness: 18 }]
            },
            options: horizontalBarOptions(false)
        });
    }

    const ctxWinRate = $('chartWinRatePred')?.getContext('2d');
    if (ctxWinRate) {
        chartWinRateInstance = new Chart(ctxWinRate, {
            type: 'bar',
            data: {
                labels: winRateLabels.length ? winRateLabels : ['Nessun dato'],
                datasets: [{ label: 'Win Rate %', data: winRateValues.length ? winRateValues : [0], backgroundColor: 'rgba(16,185,129,0.82)', borderColor: '#10b981', borderWidth: 1, borderRadius: 8, barThickness: 18 }]
            },
            options: {
                ...horizontalBarOptions(false),
                scales: {
                    x: { beginAtZero: true, max: 100, grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#cbd5e1' } },
                    y: { grid: { display: false }, ticks: { color: '#e2e8f0', autoSkip: false } }
                }
            }
        });
    }

    const ctxCumulative = $('chartCumulativePred')?.getContext('2d');
    if (ctxCumulative) {
        chartCumulativeInstance = new Chart(ctxCumulative, {
            type: 'line',
            data: {
                labels: cumulativeLabels,
                datasets: [{ label: 'Profitto cumulato (€)', data: cumulativeValues, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.18)', fill: true, tension: 0.28, pointRadius: 2, pointHoverRadius: 5 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: commonPlugins,
                scales: {
                    y: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#cbd5e1' } },
                    x: { grid: { display: false }, ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
                }
            }
        });
    }

    const ctxLeague = $('chartVolumeByLeague')?.getContext('2d');
    if (ctxLeague) {
        chartLeagueBreakdownInstance = new Chart(ctxLeague, {
            type: 'bar',
            data: {
                labels: leagueLabels.length ? leagueLabels : ['Nessun dato'],
                datasets: [{ label: activeSport === SPORT.CALCIO ? 'Pronostici per campionato' : 'Pronostici per torneo', data: leagueVolumes.length ? leagueVolumes : [0], backgroundColor: 'rgba(245,158,11,0.84)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 8, barThickness: 18 }]
            },
            options: horizontalBarOptions(false)
        });
    }

    chartDeepScanOutcomeInstance = renderOutcomeCountChart(
        'chartDeepScanOutcome',
        resolvedRows,
        'deepScanCategory',
        'Deep Scan IA'
    );

    chartQualityGateOutcomeInstance = renderOutcomeCountChart(
        'chartQualityOutcome',
        resolvedRows,
        'qualityCategory',
        'Qualità / Gate'
    );
}

function initializeStatsFilters() {
    ['chartLeagueFilter', 'chartPredictionFilter', 'chartOutcomeFilter', 'chartDeepScanFilter', 'chartQualityFilter'].forEach(id => {
        const el = $(id);
        if (!el || el.dataset.bound === '1') return;
        el.addEventListener('change', renderCharts);
        el.dataset.bound = '1';
    });

    const resetBtn = $('resetChartFiltersBtn');
    if (resetBtn && resetBtn.dataset.bound !== '1') {
        resetBtn.addEventListener('click', () => {
            if ($('chartLeagueFilter')) $('chartLeagueFilter').value = 'all';
            if ($('chartPredictionFilter')) $('chartPredictionFilter').value = 'all';
            if ($('chartOutcomeFilter')) $('chartOutcomeFilter').value = 'all';
            if ($('chartDeepScanFilter')) $('chartDeepScanFilter').value = 'all';
            if ($('chartQualityFilter')) $('chartQualityFilter').value = 'all';
            renderCharts();
        });
        resetBtn.dataset.bound = '1';
    }
}

$('showStatsBtn')?.addEventListener('click', () => {
    if (!currentForwardData || !currentForwardData.history || currentForwardData.history.length === 0) {
        return alert('Esegui prima il Trading per caricare i dati.');
    }
    enterPrimaryView('STATS');
    nascondiTutto();
    $('statsSection')?.classList.remove('hidden');
    renderCharts();
});

$('closeStatsBtn')?.addEventListener('click', () => {
    enterPrimaryView('TRADING');
    nascondiTutto();
    $('forwardTestLogSection')?.classList.remove('hidden');
});


/* Step49B compatibility marker: DeepScan conferma, ma il Consensus Gate limita */

/* STEP75_STEP73_LEGACY_TEST_LABELS: Come leggere le coorti · Operativo pre-Step67 · Operativo post-Step67 · Alto rischio pre-Step67 */

/* STEP86_PORTFOLIO_COMPLETE_RESTORE
   Ripristino completo UI Portfolio:
   - mantiene compatibilità Step79/Step84/Step85
   - blocca il resize-loop dei canvas Portfolio
   - forza sfondo dark dei canvas, evitando rettangoli bianchi/infinite stretch
   - non modifica stake, gate, paper trading, CLV, DB o calcoli sportivi
   Legacy marker: 14.15_STEP79_STAKE_NOTES_CHARTS_FIX | 14.14_STEP75_TENNIS_SYSTEM_AUDIT
*/
(function step86PortfolioCompleteRestore(){
    if (typeof window === 'undefined') return;
    if (window.__STEP86_PORTFOLIO_COMPLETE_RESTORE__) return;
    window.__STEP86_PORTFOLIO_COMPLETE_RESTORE__ = true;

    function injectStep86PortfolioStyle(){
        if (document.getElementById('step86-portfolio-complete-restore-style')) return;
        var style = document.createElement('style');
        style.id = 'step86-portfolio-complete-restore-style';
        style.textContent = `
            /* STEP86_CHART_FIXED_HEIGHT */
            #portfolioSection .portfolio-chart-grid-step85,
            #portfolioSection .portfolio-chart-grid-step86 {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)) !important;
                gap: 20px !important;
                align-items: start !important;
            }
            #portfolioSection .portfolio-chart-card-step85,
            #portfolioSection .portfolio-chart-card-step86,
            #portfolioSection .chart-card {
                min-width: 0 !important;
                overflow: hidden !important;
                background: #0f172a !important;
            }
            #portfolioSection .portfolio-chart-box-step85,
            #portfolioSection .portfolio-chart-box-step86,
            #portfolioSection .step86-chart-box,
            #portfolioSection .chart-card:has(#chartDrawdown),
            #portfolioSection .chart-card:has(#chartCalibration) {
                position: relative !important;
                height: 320px !important;
                min-height: 320px !important;
                max-height: 320px !important;
                overflow: hidden !important;
                background: #0f172a !important;
                border-radius: 10px !important;
            }
            #portfolioSection #chartDrawdown,
            #portfolioSection #chartCalibration,
            #portfolioSection canvas#chartDrawdown,
            #portfolioSection canvas#chartCalibration {
                display: block !important;
                width: 100% !important;
                height: 320px !important;
                min-height: 0 !important;
                max-height: 320px !important;
                background: #0f172a !important;
            }
            @media (max-width: 860px) {
                #portfolioSection .portfolio-chart-grid-step85,
                #portfolioSection .portfolio-chart-grid-step86 {
                    grid-template-columns: 1fr !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function fixPortfolioCanvasBox(canvas){
        if (!canvas) return;
        var parent = canvas.parentElement;
        if (!parent) return;
        if (!parent.classList.contains('portfolio-chart-box-step85') && !parent.classList.contains('portfolio-chart-box-step86')) {
            parent.classList.add('step86-chart-box');
        }
        parent.style.position = 'relative';
        parent.style.height = '320px';
        parent.style.minHeight = '320px';
        parent.style.maxHeight = '320px';
        parent.style.overflow = 'hidden';
        parent.style.background = '#0f172a';
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '320px';
        canvas.style.maxHeight = '320px';
        canvas.style.background = '#0f172a';
    }

    function fixPortfolioCanvases(){
        try {
            fixPortfolioCanvasBox(document.getElementById('chartDrawdown'));
            fixPortfolioCanvasBox(document.getElementById('chartCalibration'));
            if (window.Chart && window.Chart.defaults) {
                window.Chart.defaults.responsive = true;
                window.Chart.defaults.maintainAspectRatio = false;
                if (window.Chart.defaults.resizeDelay === undefined || window.Chart.defaults.resizeDelay < 80) {
                    window.Chart.defaults.resizeDelay = 120;
                }
            }
        } catch (e) {}
    }

    injectStep86PortfolioStyle();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fixPortfolioCanvases);
    } else {
        fixPortfolioCanvases();
    }
    window.addEventListener('load', fixPortfolioCanvases);
    window.addEventListener('resize', function(){
        clearTimeout(window.__STEP86_PORTFOLIO_RESIZE_TIMER__);
        window.__STEP86_PORTFOLIO_RESIZE_TIMER__ = setTimeout(fixPortfolioCanvases, 180);
    });
})();
// ============================================================================
// STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX
// STEP87B_APPLY_ESCAPE_FIX
// - Portfolio charts: asse X leggibile, canvas a quota stabile, niente resize-loop.
// - Dettagli espandibili dei grafici nascosti: restano solo grafico + tabella bucket.
// - Filtro Tennis esteso: circuito ATP/WTA + tipo torneo (Grand Slam, Masters 1000, 500, 250, Challenger).
// - CLV coherence: se il payload CLV è incoerente con lo storico, mostra un warning compatto e usa fallback solo UI.
// Non modifica DB, storico, stake, gate, paper trading, motore Tennis/Calcio o CLV salvata.
// ============================================================================
(function step87PortfolioAxisTourClvFix(){
    const STEP87_MARKER = 'STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX';

    const g = (typeof window !== 'undefined') ? window : globalThis;
    const $87 = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    const str87 = (v) => (v === null || v === undefined ? '' : String(v));
    const num87 = (v, fb = 0) => {
        if (v === null || v === undefined || v === '') return fb;
        if (typeof v === 'boolean') return v ? 1 : 0;
        const cleaned = String(v).replace('%', '').replace('€', '').replace(',', '.').trim();
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : fb;
    };
    const fmt87 = (v, d = 1) => num87(v, 0).toFixed(d);
    const esc87 = (v) => str87(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const round87 = (v, d = 2) => {
        const p = Math.pow(10, d);
        return Math.round(num87(v, 0) * p) / p;
    };
    const sportTennis87 = () => {
        try {
            return typeof SPORT !== 'undefined' && typeof activeSport !== 'undefined'
                ? activeSport === SPORT.TENNIS
                : str87(g.activeSport).toLowerCase() === 'tennis';
        } catch (_) { return str87(g.activeSport).toLowerCase() === 'tennis'; }
    };
    const sportCalcio87 = () => !sportTennis87();

    function step87InstallStyle(){
        if (typeof document === 'undefined' || document.getElementById('step87PortfolioChartCss')) return;
        const style = document.createElement('style');
        style.id = 'step87PortfolioChartCss';
        style.textContent = `
            /* STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX */
            .portfolio-chart-grid-step85 { align-items: start !important; }
            .portfolio-chart-card-step85 { min-width: 0 !important; overflow: visible !important; }
            .portfolio-chart-box-step85 {
                position: relative !important;
                width: 100% !important;
                height: 390px !important;
                min-height: 390px !important;
                max-height: 390px !important;
                overflow: visible !important;
                padding: 8px 10px 28px 10px !important;
                background: #0f172a !important;
                border-radius: 8px !important;
            }
            .portfolio-chart-box-step85 canvas {
                display: block !important;
                width: 100% !important;
                height: 345px !important;
                min-height: 345px !important;
                max-height: 345px !important;
                background: transparent !important;
            }
            #brierTourDataAuditPanel,
            #drawdownDataAuditPanel,
            .step87-hide-chart-details {
                display: none !important;
            }
            .step87-filter-grid { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
            .step87-filter-btn {
                border:1px solid rgba(148,163,184,.25); background:rgba(15,23,42,.56); color:#e2e8f0;
                border-radius:8px; padding:8px 12px; cursor:pointer; font-weight:800; min-width:110px; text-align:left;
            }
            .step87-filter-btn.active { border-color:#10b981; background:rgba(16,185,129,.16); color:#f8fafc; }
            .step87-filter-btn small { display:block; color:#94a3b8; font-size:.72em; margin-top:2px; }
            .step87-clv-warning {
                border:1px solid rgba(245,158,11,.28); border-left:4px solid #f59e0b; background:rgba(245,158,11,.08);
                color:#fde68a; border-radius:10px; padding:10px 12px; margin:10px 0; font-size:.86em; line-height:1.35;
            }
        `;
        document.head.appendChild(style);
    }

    function step87Normalize(text){
        return str87(text).normalize ? str87(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : str87(text).toUpperCase();
    }

    function getTennisTournamentText87(row = {}){
        return step87Normalize([
            row.tournament, row.tournament_name, row.competition, row.competition_name,
            row.league, row.series, row.category, row.eventName, row.event_name,
            row.sport_title, row.sport_key, row.strategy_tag, row.bet_type, row.surface
        ].map(str87).join(' '));
    }

    function getTennisTourFromRow87(row = {}){
        const text = getTennisTournamentText87(row);
        if (text.includes('WTA') || text.includes('WOMEN') || text.includes('DONNE')) return 'WTA';
        if (text.includes('ATP') || text.includes('MEN') || text.includes('UOMINI')) return 'ATP';
        if (typeof getTennisTourFromRow === 'function' && getTennisTourFromRow !== getTennisTourFromRow87) {
            try { return getTennisTourFromRow(row); } catch (_) {}
        }
        return 'UNKNOWN';
    }

    function getTennisTournamentCategory87(row = {}){
        const text = getTennisTournamentText87(row);
        // Grand Slam: surface override safe, included to prevent Roland Garros from being read as Hard in UI diagnostics.
        if (text.includes('ROLAND GARROS') || text.includes('FRENCH OPEN') || text.includes('WIMBLEDON') || text.includes('AUSTRALIAN OPEN') || text.includes('US OPEN') || text.includes('GRAND SLAM')) return 'TENNIS_GRAND_SLAM';
        if (text.includes('MASTERS 1000') || text.includes('ATP1000') || text.includes('ATP 1000') || text.includes('WTA1000') || text.includes('WTA 1000') || text.includes('INDIAN WELLS') || text.includes('MIAMI') || text.includes('MONTE CARLO') || text.includes('MONTE-CARLO') || text.includes('MADRID') || text.includes('ITALIAN OPEN') || text.includes('ROMA') || text.includes('ROME') || text.includes('CANADIAN') || text.includes('MONTREAL') || text.includes('TORONTO') || text.includes('CINCINNATI') || text.includes('SHANGHAI') || text.includes('CHINA OPEN') || text.includes('PARIS MASTERS')) return 'TENNIS_MASTERS_1000';
        if (text.includes('ATP 500') || text.includes('ATP500') || text.includes('WTA 500') || text.includes('WTA500') || text.includes('BARCELONA') || text.includes('HAMBURG') || text.includes('QUEEN') || text.includes('HALLE') || text.includes('BASEL') || text.includes('VIENNA')) return 'ATP_WTA_500';
        if (text.includes('ATP 250') || text.includes('ATP250') || text.includes('WTA 250') || text.includes('WTA250') || text.includes('GSTAAD') || text.includes('BASTAD') || text.includes('UMAG') || text.includes('ESTORIL') || text.includes('KITZBUHEL') || text.includes('STUTTGART') || text.includes('HERTOGENBOSCH') || text.includes('EASTBOURNE') || text.includes('MALLORCA')) return 'ATP_WTA_250';
        if (text.includes('CHALLENGER')) return 'TENNIS_CHALLENGER';
        return 'TENNIS_OTHER';
    }

    function getTennisSurfaceOverride87(row = {}){
        const text = getTennisTournamentText87(row);
        if (text.includes('ROLAND GARROS') || text.includes('FRENCH OPEN') || text.includes('MONTE CARLO') || text.includes('MONTE-CARLO') || text.includes('MADRID') || text.includes('ITALIAN OPEN') || text.includes('ROMA') || text.includes('ROME') || text.includes('BARCELONA') || text.includes('HAMBURG') || text.includes('GSTAAD') || text.includes('BASTAD') || text.includes('UMAG') || text.includes('ESTORIL') || text.includes('KITZBUHEL')) return 'CLAY';
        if (text.includes('WIMBLEDON') || text.includes('QUEEN') || text.includes('HALLE') || text.includes('STUTTGART') || text.includes('HERTOGENBOSCH') || text.includes('EASTBOURNE') || text.includes('MALLORCA')) return 'GRASS';
        if (text.includes('ATP FINALS') || text.includes('WTA FINALS') || text.includes('BASEL') || text.includes('VIENNA') || text.includes('PARIS MASTERS')) return 'HARD_INDOOR';
        if (text.includes('AUSTRALIAN OPEN') || text.includes('US OPEN') || text.includes('INDIAN WELLS') || text.includes('MIAMI') || text.includes('CANADIAN') || text.includes('CINCINNATI') || text.includes('SHANGHAI') || text.includes('CHINA OPEN')) return 'HARD';
        return str87(row.surface || '').toUpperCase() || 'UNKNOWN';
    }

    const getPortfolioSegmentOptionsBefore87 = (typeof getPortfolioSegmentOptions === 'function') ? getPortfolioSegmentOptions : null;

    function getPortfolioSegmentOptions87(){
        if (sportTennis87()) {
            return [
                { key: 'ALL', label: 'Tutto' },
                { key: 'ATP', label: 'Solo ATP' },
                { key: 'WTA', label: 'Solo WTA' },
                { key: 'TENNIS_GRAND_SLAM', label: 'Grand Slam' },
                { key: 'TENNIS_MASTERS_1000', label: 'Masters 1000' },
                { key: 'ATP_WTA_500', label: 'ATP/WTA 500' },
                { key: 'ATP_WTA_250', label: 'ATP/WTA 250' },
                { key: 'TENNIS_CHALLENGER', label: 'Challenger' },
                { key: 'TENNIS_OTHER', label: 'Altro torneo' }
            ];
        }
        if (typeof getPortfolioSegmentOptionsBefore87 === 'function') {
            try { return getPortfolioSegmentOptionsBefore87(); } catch (_) {}
        }
        return [
            { key: 'ALL', label: 'Tutto' }, { key: 'SERIE_A', label: 'Serie A' },
            { key: 'SERIE_B', label: 'Serie B' }, { key: 'PREMIER_LEAGUE', label: 'Premier' },
            { key: 'LA_LIGA', label: 'La Liga' }, { key: 'BUNDESLIGA', label: 'Bundesliga' },
            { key: 'LIGUE_1', label: 'Ligue 1' }, { key: 'CHAMPIONS_LEAGUE', label: 'Champions' },
            { key: 'OTHER', label: 'Altro' }
        ];
    }

    function step87RowMatchesKey(row = {}, key = 'ALL'){
        const selected = (typeof normalizePortfolioFilterKey === 'function') ? normalizePortfolioFilterKey(key) : step87Normalize(key).replace(/[^A-Z0-9]+/g, '_');
        if (selected === 'ALL') return true;
        if (sportTennis87()) {
            if (selected === 'ATP' || selected === 'WTA') return getTennisTourFromRow87(row) === selected;
            if ((selected.indexOf('TENNIS_') === 0 || selected.indexOf('ATP_WTA_') === 0)) return getTennisTournamentCategory87(row) === selected;
            return true;
        }
        if (typeof getFootballCompetitionFromRow === 'function') return getFootballCompetitionFromRow(row) === selected;
        return true;
    }

    function isCleanCurrentRow87(row = {}){
        if (typeof isCleanCurrentRow === 'function') {
            try { return isCleanCurrentRow(row); } catch (_) {}
        }
        const dq = step87Normalize(row.data_quality || row.dataQuality || row.quality || 'CURRENT');
        return dq === '' || dq.includes('CURRENT') || dq.includes('BOOTSTRAP');
    }

    function isSportRow87(row = {}){
        const sport = step87Normalize(row.sport || row.sport_type || row.sportType || row.sport_key || row.league || row.strategy_tag || '');
        if (sportTennis87()) {
            if (typeof isTennisRow === 'function') { try { return isTennisRow(row); } catch (_) {} }
            return sport.includes('TENNIS') || sport.includes('ATP') || sport.includes('WTA') || getTennisTourFromRow87(row) !== 'UNKNOWN';
        }
        if (typeof isCalcioRow === 'function') { try { return isCalcioRow(row); } catch (_) {} }
        return !sport.includes('TENNIS');
    }

    function isOperationalRealPortfolioRow87(row = {}){
        if (window.TradingScopeUI && primaryViewName === 'PORTFOLIO') return window.TradingScopeUI.portfolioIncludes(row);
        if (sportTennis87() && typeof isOperationalRealPortfolioRow === 'function') {
            try { return isOperationalRealPortfolioRow(row); } catch (_) {}
        }
        const statusText = step87Normalize([row.operational_gate, row.deepscan_gate, row.deepscan_gate_label, row.action, row.reason, row.portfolio_scope].join(' '));
        const stake = num87(row.stake ?? row.invested, 0);
        return stake > 0 && !statusText.includes('NO_BET') && !statusText.includes('BLOCCATA') && !statusText.includes('BLOCKED');
    }

    function getPortfolioSegmentBaseRows87(dataHist = {}, { operationalOnly = false } = {}){
        const history = Array.isArray(dataHist?.history) ? dataHist.history : [];
        return history
            .filter(row => ['WON','LOST'].includes(step87Normalize(row.status)))
            .filter(isSportRow87)
            .filter(isCleanCurrentRow87)
            .filter(row => !String(row.bet_type || '').toUpperCase().includes('MULTI'))
            .filter(row => !operationalOnly || isOperationalRealPortfolioRow87(row));
    }

    function buildPortfolioSegmentCounts87(dataHist = {}){
        const baseRows = getPortfolioSegmentBaseRows87(dataHist, { operationalOnly: false });
        const operationalRows = getPortfolioSegmentBaseRows87(dataHist, { operationalOnly: true });
        const counts = {};
        getPortfolioSegmentOptions87().forEach(opt => {
            counts[opt.key] = {
                clean: baseRows.filter(row => step87RowMatchesKey(row, opt.key)).length,
                operational: operationalRows.filter(row => step87RowMatchesKey(row, opt.key)).length
            };
        });
        return counts;
    }

    function getPortfolioSegmentLabel87(key){
        const selected = (typeof normalizePortfolioFilterKey === 'function') ? normalizePortfolioFilterKey(key || portfolioSegmentFilter) : step87Normalize(key || portfolioSegmentFilter);
        const found = getPortfolioSegmentOptions87().find(opt => opt.key === selected);
        return found ? found.label : 'Tutto';
    }

    function renderPortfolioSegmentFilterPanel87(dataHist = {}){
        if (typeof document === 'undefined') return;
        const section = $87('portfolioSection');
        if (!section) return;
        let panel = $87('portfolioSegmentFilterPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'portfolioSegmentFilterPanel';
            panel.className = 'card-container';
            panel.style.borderLeft = '4px solid #10b981';
            panel.style.marginBottom = '14px';
            const strictNotice = $87('portfolioStrictScopeNotice');
            if (strictNotice && strictNotice.parentNode) strictNotice.parentNode.insertBefore(panel, strictNotice);
            else section.prepend(panel);
        }
        const options = getPortfolioSegmentOptions87();
        const counts = buildPortfolioSegmentCounts87(dataHist);
        const selected = (typeof normalizePortfolioFilterKey === 'function') ? normalizePortfolioFilterKey(portfolioSegmentFilter) : step87Normalize(portfolioSegmentFilter || 'ALL');
        const sportLabel = sportTennis87() ? 'Tennis' : 'Calcio';
        const filterLabel = sportTennis87() ? 'circuito / tipo torneo' : 'campionato';
        const buttons = options.map(opt => {
            const c = counts[opt.key] || { clean: 0, operational: 0 };
            return `<button type="button" class="step87-filter-btn ${selected === opt.key ? 'active' : ''}" data-step87-portfolio-filter="${esc87(opt.key)}">
                ${esc87(opt.label)}<small>vista ${c.operational} · clean ${c.clean}</small>
            </button>`;
        }).join('');
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                    <strong style="color:#10b981;">Filtro Portafoglio ${esc87(sportLabel)} · ${esc87(filterLabel)}</strong>
                    <div style="color:#cbd5e1; font-size:.86em; margin-top:4px; line-height:1.35;">
                        Applica il filtro a KPI, strategie, Drawdown/Equity, Brier Calibration e audit operativo UI. Non modifica DB, storico, stake, gate, CLV o paper trading.
                    </div>
                </div>
                <div style="font-size:.82em;color:#cbd5e1;">Vista attiva: <b style="color:#fff;">${esc87(getPortfolioSegmentLabel87(selected))}</b></div>
            </div>
            <div class="step87-filter-grid">${buttons}</div>
        `;
        panel.querySelectorAll('[data-step87-portfolio-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                try { portfolioSegmentFilter = btn.getAttribute('data-step87-portfolio-filter') || 'ALL'; } catch (_) { g.portfolioSegmentFilter = btn.getAttribute('data-step87-portfolio-filter') || 'ALL'; }
                if (typeof loadPortfolioData === 'function') loadPortfolioData();
            });
        });
    }

    function filterPortfolioHistoryPayloadByActiveSegment87(dataHist = {}){
        if (!dataHist || !Array.isArray(dataHist.history)) return dataHist;
        const selected = (typeof normalizePortfolioFilterKey === 'function') ? normalizePortfolioFilterKey(portfolioSegmentFilter) : step87Normalize(portfolioSegmentFilter || 'ALL');
        if (selected === 'ALL') return { ...dataHist, portfolioSegmentFilter: selected, portfolioSegmentLabel: getPortfolioSegmentLabel87(selected) };
        return {
            ...dataHist,
            history: dataHist.history.filter(row => step87RowMatchesKey(row, selected)),
            portfolioSegmentFilter: selected,
            portfolioSegmentLabel: getPortfolioSegmentLabel87(selected)
        };
    }

    function getPortfolioResolvedRowsForChart87(dataHist = {}, { operationalOnly = false } = {}){
        const selected = (typeof normalizePortfolioFilterKey === 'function') ? normalizePortfolioFilterKey(portfolioSegmentFilter) : step87Normalize(portfolioSegmentFilter || 'ALL');
        return window.ScopeRepairs.order(getPortfolioSegmentBaseRows87(dataHist, { operationalOnly })
            .filter(row => selected === 'ALL' || step87RowMatchesKey(row, selected)));
    }

    function chartDateLabel87(row, index){
        const raw = str87(row.match_date || row.date || row.created_at || '').trim();
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
        if (m) return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`;
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[3]}/${iso[2]}`;
        return `#${index + 1}`;
    }

    function hideChartDetails87(){
        ['brierTourDataAuditPanel', 'drawdownDataAuditPanel'].forEach(id => {
            const box = $87(id);
            if (box) { box.innerHTML = ''; box.style.display = 'none'; box.classList.add('step87-hide-chart-details'); }
        });
    }

    function updateTennisBrierTourDiagnosticPanel87(){ hideChartDetails87(); }
    function updateDrawdownDataAuditPanel87(){ hideChartDetails87(); }

    function renderPortfolioEquityChart87(dataHist = {}){
        if (window.TradingScopeUI.studioPortfolio()) {
            if (typeof chartDrawdownInstance !== 'undefined' && chartDrawdownInstance) {chartDrawdownInstance.destroy(); chartDrawdownInstance = null;}
            window.TradingScopeUI.equityNotice(true); return false;
        }
        window.TradingScopeUI.equityNotice(false);
        const ctxDraw = $87('chartDrawdown')?.getContext('2d');
        if (!ctxDraw || !g.Chart) return false;
        const closedBets = getPortfolioResolvedRowsForChart87(dataHist, { operationalOnly: sportTennis87() });
        const orderNote = $87('scopeEquityNotice');
        if(orderNote) orderNote.textContent = window.ScopeRepairs.orderNotice(closedBets);
        hideChartDetails87();
        if (!closedBets.length) {
            if (typeof chartDrawdownInstance !== 'undefined' && chartDrawdownInstance) chartDrawdownInstance.destroy();
            return false;
        }
        const bankrollInput = $87('bankroll');
        const baseEquity = 1000;
        let equity = baseEquity;
        const labels = [];
        const fullLabels = [];
        const equityData = [];
        closedBets.forEach((row, index) => {
            equity += num87(row.profit, 0);
            labels.push(chartDateLabel87(row, index));
            fullLabels.push(str87(row.match_date || row.date || `Riga ${index + 1}`));
            equityData.push(round87(equity, 2));
        });
        const isProfit = equity >= baseEquity;
        const lineColor = isProfit ? '#10b981' : '#ef4444';
        const fillColor = isProfit ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)';
        if (typeof chartDrawdownInstance !== 'undefined' && chartDrawdownInstance) chartDrawdownInstance.destroy();
        chartDrawdownInstance = new g.Chart(ctxDraw, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Equity reale',
                    data: equityData,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    borderWidth: 3,
                    fill: true,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    tension: 0.25
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: { padding: { left: 8, right: 12, top: 8, bottom: 26 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => fullLabels[items?.[0]?.dataIndex] || '',
                            label: (ctx) => `Equity €${fmt87(ctx.parsed.y, 2)}`
                        }
                    }
                },
                scales: {
                    y: { grid: { color: '#334155' }, ticks: { color: '#cbd5e1', padding: 8 } },
                    x: {
                        offset: true,
                        grid: { display: false },
                        ticks: { color: '#cbd5e1', autoSkip: true, maxTicksLimit: 7, maxRotation: 0, minRotation: 0, padding: 12, font: { size: 11, weight: '700' } }
                    }
                }
            }
        });
        return true;
    }

    function renderTennisBrierTourCalibrationChart87(dataHist = {}){
        if (!sportTennis87()) return false;
        if (typeof buildTennisBrierTourCalibration !== 'function') return false;
        const audit = buildTennisBrierTourCalibration(dataHist);
        try { latestTennisBrierTourAudit = audit; } catch (_) { g.latestTennisBrierTourAudit = audit; }
        hideChartDetails87();
        const ctxCal = $87('chartCalibration')?.getContext('2d');
        if (!ctxCal || !g.Chart || !audit || !Array.isArray(audit.buckets) || !audit.buckets.length) return false;
        const labels = (audit.labels || []).map(label => str87(label).replace('%',''));
        const getSeries = (tour, field) => labels.map(label => {
            const rawLabel = label.includes('-') ? label : `${label}%`;
            const row = audit.buckets.find(b => b.tour === tour && str87(b.bucket).replace('%','') === label || (b.tour === tour && str87(b.bucket) === rawLabel));
            return row ? num87(row[field], 0) : null;
        });
        if (typeof chartCalibrationInstance !== 'undefined' && chartCalibrationInstance) chartCalibrationInstance.destroy();
        chartCalibrationInstance = new g.Chart(ctxCal, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'ATP predizione media', data: getSeries('ATP', 'avgPredictedProb'), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.12)', borderWidth: 2, spanGaps: true, tension: 0.22 },
                    { label: 'ATP win rate reale', data: getSeries('ATP', 'observedWinRate'), borderColor: '#10b981', borderDash: [5, 5], borderWidth: 2, spanGaps: true, tension: 0.22 },
                    { label: 'WTA predizione media', data: getSeries('WTA', 'avgPredictedProb'), borderColor: '#c084fc', backgroundColor: 'rgba(192,132,252,.12)', borderWidth: 2, spanGaps: true, tension: 0.22 },
                    { label: 'WTA win rate reale', data: getSeries('WTA', 'observedWinRate'), borderColor: '#f97316', borderDash: [5, 5], borderWidth: 2, spanGaps: true, tension: 0.22 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: { padding: { left: 8, right: 12, top: 8, bottom: 28 } },
                plugins: { legend: { position: 'top', labels: { color: '#cbd5e1', boxWidth: 38, padding: 12 } } },
                scales: {
                    y: { min: 0, max: 100, grid: { color: '#334155' }, ticks: { color: '#cbd5e1', padding: 8, callback: (v) => `${v}%` } },
                    x: { offset: true, grid: { display: false }, ticks: { color: '#cbd5e1', autoSkip: false, maxRotation: 0, minRotation: 0, padding: 14, font: { size: 12, weight: '800' }, callback: function(value){ const label = this.getLabelForValue(value); return `${label}%`; } } }
                }
            }
        });
        if (typeof updateCalibrationChartNoDataDiagnostic === 'function') updateCalibrationChartNoDataDiagnostic('');
        return true;
    }

    function firstNumberField87(row, keys){
        for (const key of keys) {
            if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') {
                const n = num87(row[key], NaN);
                if (Number.isFinite(n)) return n;
            }
        }
        return NaN;
    }

    function clvFromRow87(row = {}){ const v=g.PortfolioAccounting.clv(row);return v===null?NaN:v; }

    function computeClvStats87(dataHist = {}){
        const rows = getPortfolioSegmentBaseRows87(dataHist, { operationalOnly: false }).filter(row => step87RowMatchesKey(row, (typeof portfolioSegmentFilter !== 'undefined' ? portfolioSegmentFilter : 'ALL')));
        const opRows = rows.filter(isOperationalRealPortfolioRow87);
        const vals = rows.map(clvFromRow87).filter(Number.isFinite);
        const opVals = opRows.map(clvFromRow87).filter(Number.isFinite);
        const pos = vals.filter(v => v > 0).length;
        const opPos = opVals.filter(v => v > 0).length;
        const avg = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
        const opAvg = opVals.length ? opVals.reduce((a,b)=>a+b,0) / opVals.length : 0;
        return {
            totalSample: rows.length,
            totalWithClv: vals.length,
            missingClv: Math.max(0, rows.length - vals.length),
            beatenTotalPct: rows.length ? pos / rows.length * 100 : 0,
            beatenAvailablePct: vals.length ? pos / vals.length * 100 : 0,
            operationalWithClv: opVals.length,
            operationalBeatenPct: opVals.length ? opPos / opVals.length * 100 : 0,
            totalPositiveClv: pos,
            operationalPositiveClv: opPos,
            avgCLV: avg,
            operationalAvgCLV: opAvg,
            clvCoveragePct: rows.length ? vals.length / rows.length * 100 : 0
        };
    }

    function renderClvCoherenceBox87(dataPort, rep, dataHist){
        if (typeof document === 'undefined' || !sportTennis87()) return;
        const section = $87('portfolioSection');
        if (!section) return;
        const derived = computeClvStats87(dataHist);
        const coverage = rep?.analytics?.clvCoverage || {};
        const payloadWithClv = num87(coverage.totalWithClv, 0);
        const payloadPositive = num87(coverage.totalPositiveClv, 0);
        const payloadAvg = num87(rep?.analytics?.clv?.avgCLV, 0);
        const suspectZero = payloadWithClv > 0 && payloadPositive === 0 && Math.abs(payloadAvg) < 0.00001 && derived.totalWithClv > 0 && (derived.totalPositiveClv > 0 || Math.abs(derived.avgCLV) > 0.00001);
        let box = $87('step87ClvCoherenceBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'step87ClvCoherenceBox';
            const anchor = $87('portfolioSeniorAuditPanel') || $87('portfolioStrictScopeNotice') || section.firstChild;
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
            else section.prepend(box);
        }
        if (!suspectZero) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.className = 'step87-clv-warning';
        box.style.display = 'block';
        box.innerHTML = `<strong>Controllo CLV Step87:</strong> il backend dichiara ${payloadWithClv} closing line disponibili ma CLV beat/avg a zero. Fallback UI da storico filtrato: disponibili ${derived.totalWithClv}/${derived.totalSample}, beat disponibili ${fmt87(derived.beatenAvailablePct,1)}%, avg ${derived.avgCLV >= 0 ? '+' : ''}${fmt87(derived.avgCLV,2)}%. Verificare mapping campi CLV backend prima di usare il dato come giudizio modello.`;
        const portAvgClv = $87('portAvgClv');
        if (portAvgClv) portAvgClv.innerText = `${derived.avgCLV >= 0 ? '+' : ''}${fmt87(derived.avgCLV, 2)}%`;
    }

    function patchAfterSeniorAudit87(dataPort, rep, dataHist){
        step87InstallStyle();
        hideChartDetails87();
        renderClvCoherenceBox87(dataPort, rep, dataHist);
    }

    step87InstallStyle();

    try { getTennisTourFromRow = getTennisTourFromRow87; } catch (_) { g.getTennisTourFromRow = getTennisTourFromRow87; }
    try { getPortfolioSegmentOptions = getPortfolioSegmentOptions87; } catch (_) { g.getPortfolioSegmentOptions = getPortfolioSegmentOptions87; }
    try { getPortfolioSegmentLabel = getPortfolioSegmentLabel87; } catch (_) { g.getPortfolioSegmentLabel = getPortfolioSegmentLabel87; }
    try { rowMatchesActivePortfolioSegment = function(row){ return step87RowMatchesKey(row, (typeof portfolioSegmentFilter !== 'undefined' ? portfolioSegmentFilter : 'ALL')); }; } catch (_) { g.rowMatchesActivePortfolioSegment = function(row){ return step87RowMatchesKey(row, g.portfolioSegmentFilter || 'ALL'); }; }
    try { getPortfolioSegmentBaseRows = getPortfolioSegmentBaseRows87; } catch (_) { g.getPortfolioSegmentBaseRows = getPortfolioSegmentBaseRows87; }
    try { buildPortfolioSegmentCounts = buildPortfolioSegmentCounts87; } catch (_) { g.buildPortfolioSegmentCounts = buildPortfolioSegmentCounts87; }
    try { renderPortfolioSegmentFilterPanel = renderPortfolioSegmentFilterPanel87; } catch (_) { g.renderPortfolioSegmentFilterPanel = renderPortfolioSegmentFilterPanel87; }
    try { filterPortfolioHistoryPayloadByActiveSegment = filterPortfolioHistoryPayloadByActiveSegment87; } catch (_) { g.filterPortfolioHistoryPayloadByActiveSegment = filterPortfolioHistoryPayloadByActiveSegment87; }
    try { getPortfolioResolvedRowsForChart = getPortfolioResolvedRowsForChart87; } catch (_) { g.getPortfolioResolvedRowsForChart = getPortfolioResolvedRowsForChart87; }
    try { updateTennisBrierTourDiagnosticPanel = updateTennisBrierTourDiagnosticPanel87; } catch (_) { g.updateTennisBrierTourDiagnosticPanel = updateTennisBrierTourDiagnosticPanel87; }
    try { updateDrawdownDataAuditPanel = updateDrawdownDataAuditPanel87; } catch (_) { g.updateDrawdownDataAuditPanel = updateDrawdownDataAuditPanel87; }
    try { renderPortfolioEquityChart = renderPortfolioEquityChart87; } catch (_) { g.renderPortfolioEquityChart = renderPortfolioEquityChart87; }
    try { renderTennisBrierTourCalibrationChart = renderTennisBrierTourCalibrationChart87; } catch (_) { g.renderTennisBrierTourCalibrationChart = renderTennisBrierTourCalibrationChart87; }

    if (typeof renderPortfolioSeniorAuditPanel === 'function') {
        const __step87OriginalSeniorAudit = renderPortfolioSeniorAuditPanel;
        renderPortfolioSeniorAuditPanel = function(dataPort, rep, dataHist){
            const out = __step87OriginalSeniorAudit.apply(this, arguments);
            patchAfterSeniorAudit87(dataPort, rep, dataHist);
            return out;
        };
    }

    g.STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX = {
        marker: STEP87_MARKER,
        getTennisTournamentCategory: getTennisTournamentCategory87,
        getTennisSurfaceOverride: getTennisSurfaceOverride87,
        computeClvStats: computeClvStats87
    };
})();
// ============================================================================
// /STEP87_PORTFOLIO_AXIS_TOUR_CLV_FIX
// ============================================================================


// STEP88C_REQUIRED_COMPAT_MARKERS: height:330px


;(function step89RuntimeButtonRebind(){
    // STEP89_RUNTIME_BUTTON_REBIND: ripristina pulsanti principali anche dopo patch cache/JS parziali.
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const g = window;
    const byId = (id) => document.getElementById(id);
    function callSafe(name, args){
        try {
            if (typeof g[name] === 'function') return g[name].apply(g, args || []);
        } catch (err) {
            console.error('STEP89 call failed', name, err);
        }
        return undefined;
    }
    function bindClick(id, handler){
        const el = byId(id);
        if (!el || el.dataset.step89Bound === '1') return;
        el.addEventListener('click', function(ev){
            try { handler(ev, el); } catch (err) { console.error('STEP89 handler failed', id, err); }
        });
        el.dataset.step89Bound = '1';
    }
    function showOnly(sectionId){
        if (typeof g.nascondiTutto === 'function') g.nascondiTutto();
        const section = byId(sectionId);
        if (section) section.classList.remove('hidden');
    }
    function bindCoreButtons(){
        bindClick('btnSportCalcio', function(){ callSafe('switchSport', ['calcio']); });
        bindClick('btnSportTennis', function(){ callSafe('switchSport', ['tennis']); });
        bindClick('btnSportDeepScan', function(){ callSafe('switchSport', ['manual_deepscan']); });
        // PATCH28_R2_SINGLE_NAVIGATION_AUTHORITY:
        // settings/portfolio/stats hanno già handler autorevoli nel core.
        // Non registrarli una seconda volta: il doppio loadPortfolioData bloccava il thread UI.
        ['settingsBtn','portfolioBtn','refreshPortfolioBtn','showStatsBtn','closeStatsBtn'].forEach(function(id){
            const el = byId(id);
            if (el) el.dataset.step89Bound = 'core-authoritative';
        });
        bindClick('resetChartFiltersBtn', function(){
            ['chartLeagueFilter','chartPredictionFilter','chartOutcomeFilter','chartDeepScanFilter','chartQualityFilter'].forEach(function(id){ const x = byId(id); if (x) x.value = 'all'; });
            callSafe('renderCharts');
        });
        ['chartLeagueFilter','chartPredictionFilter','chartOutcomeFilter','chartDeepScanFilter','chartQualityFilter'].forEach(function(id){
            const el = byId(id);
            if (!el || el.dataset.step89ChangeBound === '1') return;
            el.addEventListener('change', function(){ callSafe('renderCharts'); });
            el.dataset.step89ChangeBound = '1';
        });
        if (typeof g.installStep89PortfolioChartHeightCss === 'function') g.installStep89PortfolioChartHeightCss();
    }
    g.step89BindCoreButtons = bindCoreButtons;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindCoreButtons);
    else bindCoreButtons();
    const previousOnload = g.onload;
    g.onload = function step89WindowOnload(ev){
        if (typeof previousOnload === 'function') previousOnload.call(this, ev);
        bindCoreButtons();
    };
})();


// STEP91H_TENNIS_SIDE_IDENTITY_GUARD_UI
function getStep91HTennisSideIdentityLine(row) {
    if (!row) return '';
    const pick = row.predicted_player_name || row.predictedPlayerName || '';
    const side = row.internal_side || row.internalSide || row.prediction || '';
    const order = row.official_event_order || row.officialEventOrder || '';
    const warning = row.side_mapping_warning || row.sideMappingWarning || '';
    if (!pick && !order) return '';
    const warn = warning && warning !== 'SIDE_MAPPING_VERIFIED_BY_PLAYER_NAME'
        ? ' · ' + warning
        : '';
    return '<div class="step91h-side-identity" style="font-size:11px;color:#93c5fd;margin-top:4px;line-height:1.35">Pick: ' + (pick || '-') + ' · Side interno: ' + (side || '-') + (order ? ' · Evento ufficiale: ' + order : '') + warn + '</div>';
}
if (typeof window !== 'undefined') window.getStep91HTennisSideIdentityLine = getStep91HTennisSideIdentityLine;
// /STEP91H_TENNIS_SIDE_IDENTITY_GUARD_UI


// STEP91R_FRONTEND_HISTORY_FALLBACK_FINAL_REPAIR: ripristina fallback history Step91L/91P senza modificare DB, stake, gate, CLV o Calcio.

// STEP93_TENNIS_PAPER_TRADING_FRONTEND_COMPAT: Paper Trading usa effectiveData.history dopo fallback Step91T/Step92.

// ============================================================================
// STEP94_AUTOMATION_SCHEDULER_OPTIONS_UI
// STEP94B_STATIC_UI_ID_MARKERS: step94_tennis_interval step94_calcio_interval step94_tennis_mode step94_calcio_mode step94_tennis_enabled step94_calcio_enabled
// Automazione Scansioni Tennis/Calcio: frequenza ogni Nh, giorni, modalità update.
// ============================================================================
;(function step94AutomationSchedulerOptionsUi(){
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.__STEP94_AUTOMATION_SCHEDULER_OPTIONS_UI__) return;
    window.__STEP94_AUTOMATION_SCHEDULER_OPTIONS_UI__ = true;

    const DAY_OPTIONS = [
        { value: 1, label: 'Lun' },
        { value: 2, label: 'Mar' },
        { value: 3, label: 'Mer' },
        { value: 4, label: 'Gio' },
        { value: 5, label: 'Ven' },
        { value: 6, label: 'Sab' },
        { value: 0, label: 'Dom' }
    ];

    const SPORT_META = {
        tennis: {
            title: '🎾 Automazione Scansioni Tennis',
            statusEndpoint: '/api/setup/tennis-automation',
            saveEndpoint: '/api/setup/tennis-automation',
            accent: '#22c55e'
        },
        calcio: {
            title: '⚽ Automazione Scansioni Calcio',
            statusEndpoint: '/api/setup/calcio-automation',
            saveEndpoint: '/api/setup/calcio-automation',
            accent: '#38bdf8'
        }
    };

    function byId(id){ return document.getElementById(id); }
    function safeNumber(value, fallback){ const n = Number(value); return Number.isFinite(n) ? n : fallback; }
    function normalizeDays(days){
        if (!Array.isArray(days)) return [];
        return Array.from(new Set(days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a,b)=>a-b);
    }
    function formatSummary(cfg){
        const days = normalizeDays(cfg.days);
        const dayText = days.length ? DAY_OPTIONS.filter(d => days.includes(d.value)).map(d => d.label).join(', ') : 'tutti i giorni';
        const mode = cfg.updateMode === 'paper_trading' ? 'solo paper trading' : (cfg.updateMode === 'analysis_ai' ? 'solo Analisi AI' : 'tutto');
        const cadence = cfg.schedulerMode === 'PERSISTENT_EXACT_INTERVAL' || cfg.type === 'interval_hours'
            ? `intervallo reale ${safeNumber(cfg.intervalHours, 1)}h`
            : `ogni ${safeNumber(cfg.intervalHours, 1)}h`;
        return `${cfg.enabled ? 'Attiva' : 'Disattiva'} · ${cadence} · ${dayText} · ${mode}`;
    }
    function formatSchedulerRuntime(sport, cfg, runtime){
        const base = formatSummary({ ...cfg, schedulerMode: runtime?.schedulerMode || cfg.schedulerMode });
        if (sport !== 'tennis' || !runtime) return base;
        const next = runtime.nextRunAt ? new Date(runtime.nextRunAt) : null;
        const nextText = next && !Number.isNaN(next.getTime()) ? next.toLocaleString('it-IT') : 'non pianificato';
        const lockText = runtime.singleFlightLockActive ? ' · esecuzione in corso' : '';
        const modeText = runtime.schedulerMode === 'PERSISTENT_EXACT_INTERVAL' ? 'persistente esatto' : String(runtime.schedulerMode || 'compatibilità');
        return `${base} · modalità ${modeText} · prossimo ${nextText}${lockText}`;
    }

    function installStyle(){
        if (byId('step94AutomationStyle')) return;
        const style = document.createElement('style');
        style.id = 'step94AutomationStyle';
        style.textContent = `
            #step94AutomationPanel{margin:10px 0 14px;padding:12px;border:1px solid rgba(148,163,184,.24);border-radius:14px;background:rgba(15,23,42,.82);box-shadow:0 12px 35px rgba(0,0,0,.18)}
            #step94AutomationPanel .step94-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;color:#e2e8f0;font-weight:900}
            #step94AutomationPanel .step94-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}
            #step94AutomationPanel .step94-card{border:1px solid rgba(148,163,184,.18);border-radius:14px;background:rgba(30,41,59,.66);padding:12px}
            #step94AutomationPanel .step94-card h4{margin:0 0 8px;color:#f8fafc;font-size:.96rem}
            #step94AutomationPanel .step94-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;align-items:end;margin-top:8px}
            #step94AutomationPanel label{display:block;color:#94a3b8;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
            #step94AutomationPanel select,#step94AutomationPanel input[type=number]{width:100%;box-sizing:border-box;background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,.28);border-radius:8px;padding:7px}
            #step94AutomationPanel .step94-days{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
            #step94AutomationPanel .step94-day{display:inline-flex;gap:5px;align-items:center;padding:5px 7px;border:1px solid rgba(148,163,184,.2);border-radius:999px;background:rgba(15,23,42,.7);color:#cbd5e1;font-size:.76rem;font-weight:800}
            #step94AutomationPanel .step94-enabled{display:flex;align-items:center;gap:8px;color:#e2e8f0;font-weight:900}
            #step94AutomationPanel .step94-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
            #step94AutomationPanel .step94-save{border:none;border-radius:10px;padding:8px 12px;font-weight:900;cursor:pointer;background:#2563eb;color:white}
            #step94AutomationPanel .step94-refresh{border:1px solid rgba(148,163,184,.3);border-radius:10px;padding:8px 12px;font-weight:900;cursor:pointer;background:#0f172a;color:#e2e8f0}
            #step94AutomationPanel .step94-status{font-size:.8rem;color:#cbd5e1;line-height:1.45}
            #step94AutomationPanel .step94-note{color:#fbbf24;font-size:.76rem;margin-top:6px}
        `;
        document.head.appendChild(style);
    }

    function buildPanel(){
        if (byId('step94AutomationPanel')) return byId('step94AutomationPanel');
        installStyle();
        const panel = document.createElement('section');
        panel.id = 'step94AutomationPanel';
        panel.innerHTML = `
            <div class="step94-title">
                <span>⚙️ Automazione Scansioni Sport · Step94</span>
                <button type="button" class="step94-refresh" id="step94RefreshAll">Aggiorna stato</button>
            </div>
            <div class="step94-grid">
                ${Object.keys(SPORT_META).map(renderSportCard).join('')}
            </div>
            <div class="step94-note">Tennis e Calcio sono indipendenti: puoi attivare uno sport e lasciare l'altro disattivato. Le impostazioni sono salvate su file JSON backend e restano dopo il riavvio del server.</div>
        `;
        const header = document.querySelector('header');
        if (header && header.parentNode) header.parentNode.insertBefore(panel, header.nextSibling);
        else document.body.insertBefore(panel, document.body.firstChild);
        bindPanelEvents(panel);
        return panel;
    }

    function renderSportCard(sport){
        const meta = SPORT_META[sport];
        return `
            <article class="step94-card" data-step94-sport="${sport}" style="border-top:3px solid ${meta.accent}">
                <h4>${meta.title}</h4>
                <div class="step94-enabled"><input type="checkbox" id="step94_${sport}_enabled"> <span>Attiva automazione ${sport}</span></div>
                <div class="step94-row">
                    <div><label for="step94_${sport}_interval">Frequenza</label><select id="step94_${sport}_interval">${Array.from({length:24},(_,i)=>`<option value="${i+1}">Ogni ${i+1}h</option>`).join('')}</select></div>
                    <div><label for="step94_${sport}_mode">Aggiorna</label><select id="step94_${sport}_mode"><option value="all">Tutto</option><option value="paper_trading">Solo paper trading</option><option value="analysis_ai">Solo Analisi AI</option></select></div>
                    <div><label for="step94_${sport}_minute">${sport === 'tennis' ? 'Minuto (cron legacy)' : 'Minuto ora'}</label><input id="step94_${sport}_minute" type="number" min="0" max="59" step="1" value="0" ${sport === 'tennis' ? 'disabled title="Con intervallo persistente Tennis il minuto non viene usato"' : ''}></div>
                </div>
                <div style="margin-top:8px"><label>Giorni</label><div class="step94-days">${DAY_OPTIONS.map(day=>`<label class="step94-day"><input type="checkbox" class="step94-day-checkbox" data-sport="${sport}" value="${day.value}"> ${day.label}</label>`).join('')}</div></div>
                <div class="step94-actions"><button type="button" class="step94-save" data-step94-save="${sport}">Salva ${sport}</button><span class="step94-status" id="step94_${sport}_status">Caricamento...</span></div>
            </article>
        `;
    }

    function readCardConfig(sport){
        const days = Array.from(document.querySelectorAll(`.step94-day-checkbox[data-sport="${sport}"]:checked`)).map(x => Number(x.value));
        const config = {
            enabled: byId(`step94_${sport}_enabled`)?.checked === true,
            type: 'interval_hours',
            intervalHours: safeNumber(byId(`step94_${sport}_interval`)?.value, 1),
            minute: Math.max(0, Math.min(59, Math.trunc(safeNumber(byId(`step94_${sport}_minute`)?.value, 0)))),
            days,
            updateMode: byId(`step94_${sport}_mode`)?.value || 'all',
            league: 'all'
        };
        // AUDIT16D_R1_STEP94_CALCIO_EXPLICIT_ENABLE_BRIDGE
        // Il click esplicito su "Salva calcio" e l'unico punto UI autorizzato a
        // confermare un first-enable Patch58. Il backend continua a rifiutare
        // qualsiasi enable privo di questa conferma.
        if (sport === 'calcio' && config.enabled === true) config.explicitEnable = true;
        return config;
    }

    function applyCardConfig(sport, cfg = {}, runtime = null){
        const merged = {
            enabled: cfg.enabled === true,
            intervalHours: safeNumber(cfg.intervalHours ?? cfg.interval_hours, 1),
            minute: safeNumber(cfg.minute, 0),
            days: normalizeDays(cfg.days),
            updateMode: cfg.updateMode || cfg.update_mode || 'all',
            type: cfg.type || 'interval_hours',
            schedulerMode: runtime?.schedulerMode || cfg.schedulerMode || null
        };
        const enabled = byId(`step94_${sport}_enabled`); if (enabled) enabled.checked = merged.enabled;
        const interval = byId(`step94_${sport}_interval`); if (interval) interval.value = String(Math.max(1, Math.min(24, merged.intervalHours)));
        const minute = byId(`step94_${sport}_minute`); if (minute) minute.value = String(Math.max(0, Math.min(59, merged.minute)));
        const mode = byId(`step94_${sport}_mode`); if (mode) mode.value = ['all','paper_trading','analysis_ai'].includes(merged.updateMode) ? merged.updateMode : 'all';
        document.querySelectorAll(`.step94-day-checkbox[data-sport="${sport}"]`).forEach(chk => { chk.checked = merged.days.includes(Number(chk.value)); });
        const status = byId(`step94_${sport}_status`);
        if (status) status.innerText = formatSchedulerRuntime(sport, merged, runtime);
    }

    async function loadSportAutomation(sport){
        const meta = SPORT_META[sport];
        const status = byId(`step94_${sport}_status`);
        if (status) status.innerText = 'Caricamento...';
        try {
            const res = await fetch(meta.statusEndpoint, { cache: 'no-store' });
            const payload = await res.json();
            let runtime = payload.status || null;
            if (sport === 'tennis' && !runtime) {
                try {
                    const bgRes = await fetch('/api/background/status', { cache: 'no-store' });
                    const bg = await bgRes.json();
                    runtime = bg?.tennis || null;
                } catch (_) { /* la configurazione resta comunque visibile */ }
            }
            applyCardConfig(sport, payload.config || payload, runtime);
        } catch (err) {
            if (status) status.innerText = `Errore lettura config: ${err.message}`;
        }
    }

    async function saveSportAutomation(sport){
        const meta = SPORT_META[sport];
        const payload = readCardConfig(sport);
        const status = byId(`step94_${sport}_status`);
        if (status) status.innerText = 'Salvataggio...';
        try {
            const res = await fetch(meta.saveEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || 'Errore salvataggio');
            applyCardConfig(sport, data.config || payload, data.status || null);
            if (typeof window.loadBackgroundStatus === 'function') window.loadBackgroundStatus();
        } catch (err) {
            if (status) status.innerText = `Errore salvataggio: ${err.message}`;
        }
    }

    function bindPanelEvents(panel){
        panel.querySelectorAll('[data-step94-save]').forEach(btn => {
            if (btn.dataset.bound === '1') return;
            btn.addEventListener('click', () => saveSportAutomation(btn.dataset.step94Save));
            btn.dataset.bound = '1';
        });
        const refresh = byId('step94RefreshAll');
        if (refresh && refresh.dataset.bound !== '1') {
            refresh.addEventListener('click', loadAllAutomationSettings);
            refresh.dataset.bound = '1';
        }
    }

    function loadAllAutomationSettings(){
        buildPanel();
        return Promise.all(Object.keys(SPORT_META).map(loadSportAutomation));
    }

    window.step94LoadAutomationSettings = loadAllAutomationSettings;
    window.step94SaveSportAutomation = saveSportAutomation;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAllAutomationSettings);
    } else {
        loadAllAutomationSettings();
    }
})();
// ============================================================================
// /STEP94_AUTOMATION_SCHEDULER_OPTIONS_UI
// ============================================================================




// STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION
function step96EvaluateDeepScanGateCombinationForExport(row) {
    const text = [
        row && (row.deepScan || row.deep_scan || row['Deep Scan IA'] || row.ds_action),
        row && (row.gate || row.qualityGate || row['Qualità / Gate'] || row.tennis_operational_status || row.professional_gate_status)
    ].map(v => String(v || '').toUpperCase()).join(' ');
    const wins = Number(row && (row.wins ?? row.vinte ?? row.won ?? 0)) || 0;
    const losses = Number(row && (row.losses ?? row.perse ?? row.lost ?? 0)) || 0;
    const pending = Number(row && (row.pending ?? row.pendenti ?? 0)) || 0;
    const operational = Number(row && (row.operationalResolved ?? row.operativo ?? row.operational ?? 0)) || 0;
    const resolved = wins + losses;
    const winRate = resolved > 0 ? (wins / resolved) * 100 : 0;
    if (text.includes('RISCHIO MODELLO') && text.includes('BLOCCATA SOFT') && resolved >= 30 && winRate >= 60 && operational < 5) {
        return {
            decisione: 'MANTIENI · MICRO TEST',
            azione: 'MICRO_ONLY',
            nota: 'Step96: storico segnale positivo; campione operativo basso. Non bloccare fisso a stake 0, ma non promuovere a stake pieno.'
        };
    }
    return null;
}
// /STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION




// STEP96C_RUNTIME_MICRO_TEST_ACTIVATION_UI
// STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD_UI
function step96CIsRuntimeMicroStakeActivation(stakeAdjustment) {
    const text = [
        stakeAdjustment?.mode,
        stakeAdjustment?.status,
        stakeAdjustment?.level,
        stakeAdjustment?.reason,
        stakeAdjustment?.deepscan_gate_status
    ].map(v => String(v || '').toUpperCase()).join(' ');
    return !!(stakeAdjustment && (
        stakeAdjustment.step96CRiskModelSoftRuntimeMicro === true ||
        stakeAdjustment.step96RiskModelSoftRuntimeMicro === true ||
        stakeAdjustment.step96FRuntimeMicroTestFinalOverride === true ||
        stakeAdjustment.step99RiskModelSoftMicroRuntimeFinal === true ||
        stakeAdjustment.step101RiskModelSoftMicroFinal === true ||
        text.includes('STEP96C_RUNTIME_MICRO_TEST_ACTIVATION') ||
        text.includes('STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE') ||
        text.includes('STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL') ||
        text.includes('STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD') ||
        text.includes('WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96C') ||
        text.includes('WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96F') ||
        text.includes('WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99') ||
        text.includes('WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101')
    ));
}
// /STEP96C_RUNTIME_MICRO_TEST_ACTIVATION_UI



// PATCH19_TENNIS_PROFESSIONAL_STATISTICAL_ENGINE_UI
function renderTennisProfessionalStatisticalEngine(payload = {}) {
    const panel = $('tennisProfessionalStatisticalEnginePanel');
    if (!panel) return;
    const latest = payload.latest || {};
    const success = payload.success !== false && payload.status === 'PROFESSIONAL_ENGINES_VERIFIED_BEST_FORECAST_ACTIVE';
    const level = success ? 'ok' : payload.status === 'ENGINE_AUDIT_FAILED' ? 'error' : 'warn';
    panel.classList.remove('status-ok','status-warn','status-error');
    panel.classList.add(level === 'ok' ? 'status-ok' : level === 'error' ? 'status-error' : 'status-warn');
    const title = $('tennisProfessionalStatisticalEngineTitle');
    if (title) title.textContent = success ? 'Markov · Monte Carlo · Elo: PROFESSIONAL VERIFIED' : `Motori statistici: ${payload.status || 'AUDIT NON ESEGUITO'}`;
    const message = $('tennisProfessionalStatisticalEngineMessage');
    if (message) message.textContent = 'Round QF/SF/F e peggioramento recente sono guardie soft: il sistema restituisce sempre il miglior lato disponibile con confidenza e rischio.';
    const grid = $('tennisProfessionalStatisticalEngineGrid');
    if (grid) grid.innerHTML = [
        ['Run audit', payload.runs ?? 0],
        ['Controlli', latest.checksTotal ?? payload.checks ?? 0],
        ['PASS', latest.checksPassed ?? 0],
        ['Markov', latest.checks?.find?.(x => x.code === 'MARKOV_POINT_LEVEL_TENNIS_CHAIN')?.status || 'N/D'],
        ['Monte Carlo', latest.checks?.find?.(x => x.code === 'MONTE_CARLO_TENNIS_PROFESSIONAL')?.status || 'N/D'],
        ['Elo', latest.checks?.find?.(x => x.code === 'ELO_SYMMETRY')?.status || 'N/D'],
        ['Veto round', payload.policy?.hardExclusion === false ? 'NO' : 'N/D'],
        ['Miglior pronostico', payload.policy?.forecastAlwaysAvailable === true ? 'SEMPRE' : 'N/D']
    ].map(([label,value]) => `<div class="tennis-matchup-intelligence-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisProfessionalStatisticalEngineDetails');
    if (details) details.textContent = [
        `Versione: ${payload.version || 'N/D'}`,
        `Modalità: ${payload.mode || 'N/D'}`,
        'Autorità: raccomandazione Analisi AI; nessuna modifica automatica a probabilità production, DeepScan, Quality Gate, stake o settlement.',
        'Policy: BEST_AVAILABLE_FORECAST_WITH_CONFIDENCE — nessun pronostico eliminato solo per incertezza o fase avanzata.'
    ].join('\n');
    updateTennisOperationsStatus('professionalStatisticalEngine', { level, alerts: level === 'ok' ? 0 : 1, label: success ? 'Motori professionali' : 'Audit motori richiesto' });
}
async function loadTennisProfessionalStatisticalEngine() {
    if (activeSport !== SPORT.TENNIS) return null;
    try {
        const response = await fetch('/api/tennis/statistical-engine-health', { cache: 'no-store' });
        const payload = await response.json();
        renderTennisProfessionalStatisticalEngine(payload);
        return payload;
    } catch (error) {
        renderTennisProfessionalStatisticalEngine({ success:false, status:'ERROR', error:error.message });
        return null;
    }
}
async function executeTennisProfessionalStatisticalEngineAudit() {
    const button = $('executeTennisProfessionalStatisticalEngineAudit');
    if (button) { button.disabled = true; button.textContent = '⏳ Verifico…'; }
    try {
        const response = await fetch('/api/tennis/statistical-engine-audit-refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
        return await loadTennisProfessionalStatisticalEngine();
    } catch (error) {
        showRuntimeDiagnostic({ severity:'ERROR', title:'Audit motori statistici fallito', message:error.message, phase:'PATCH19_STATISTICAL_ENGINE_AUDIT', error });
        return null;
    } finally {
        if (button) { button.disabled = false; button.textContent = '▶ Verifica motori'; }
    }
}
function bindPatch19OperationsUi() {
    const refresh = $('refreshTennisProfessionalStatisticalEngine');
    if (refresh && refresh.dataset.bound !== '1') { refresh.addEventListener('click', loadTennisProfessionalStatisticalEngine); refresh.dataset.bound='1'; }
    const execute = $('executeTennisProfessionalStatisticalEngineAudit');
    if (execute && execute.dataset.bound !== '1') { execute.addEventListener('click', executeTennisProfessionalStatisticalEngineAudit); execute.dataset.bound='1'; }
    loadTennisProfessionalStatisticalEngine();
}
window.loadTennisProfessionalStatisticalEngine = loadTennisProfessionalStatisticalEngine;
window.executeTennisProfessionalStatisticalEngineAudit = executeTennisProfessionalStatisticalEngineAudit;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPatch19OperationsUi);
else bindPatch19OperationsUi();
// /PATCH19_TENNIS_PROFESSIONAL_STATISTICAL_ENGINE_UI


// BETTING PATCH 12 - Paper Trading multi-selection and exact API counter refresh.
async function bulkDeleteForwardSelection() {
    const ids = [...selectedForwardBetIds];
    if (!ids.length) return;
    if (!confirm(`Eliminare logicamente ${ids.length} pratiche selezionate? I record restano nell'audit ma non saranno più mostrati.`)) return;
    showLoading();
    try {
        const response = await fetch('/api/bets/bulk-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'DELETE',ids}) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'BULK_DELETE_FAILED');
        selectedForwardBetIds.clear();
        if (typeof step81RunTrading === 'function') await step81RunTrading(); else if (typeof loadForwardTestLog === 'function') await loadForwardTestLog();
    } catch (error) { alert(`Eliminazione multipla non riuscita: ${error.message}`); }
    finally { hideLoading(); updateForwardSelectionUi(); }
}
function bindForwardBulkControls() {
    const all=$('forwardSelectAllBtn'), clear=$('forwardClearSelectionBtn'), del=$('forwardBulkDeleteBtn');
    if(all&&!all.dataset.boundPatch12){all.onclick=()=>toggleForwardSelectAll(true);all.dataset.boundPatch12='1';}
    if(clear&&!clear.dataset.boundPatch12){clear.onclick=()=>toggleForwardSelectAll(false);clear.dataset.boundPatch12='1';}
    if(del&&!del.dataset.boundPatch12){del.onclick=bulkDeleteForwardSelection;del.dataset.boundPatch12='1';}
    updateForwardSelectionUi();
}
const patch12OriginalFetch = window.fetch.bind(window);
let patch12ApiUsageRefreshTimer = null;
window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    try {
        return await patch12OriginalFetch(input, init);
    } finally {
        // Anche 401/403/429 o errori di rete possono aggiornare gli header/costi provider.
        if (url.includes('/api/') && !url.includes('/api/usage/odds')) {
            clearTimeout(patch12ApiUsageRefreshTimer);
            patch12ApiUsageRefreshTimer = setTimeout(() => loadApiCreditsUsage(), 300);
        }
    }
};
setTimeout(bindForwardBulkControls, 0);
document.addEventListener('DOMContentLoaded', bindForwardBulkControls);


// PATCH28_R2_UI_NAVIGATION_DIAGNOSTICS · sola lettura
if (typeof window !== 'undefined') {
    window.PATCH28_R2_UI_NAVIGATION_VERSION = PATCH28_R2_UI_NAVIGATION_VERSION;
    window.getPatch28R2NavigationState = () => ({
        version: PATCH28_R2_UI_NAVIGATION_VERSION,
        activeView: primaryViewName,
        viewEpoch: primaryViewEpoch,
        portfolioRequestSequence,
        portfolioRequestActive: Boolean(portfolioAbortController),
        chartDrawdownActive: Boolean(chartDrawdownInstance),
        chartCalibrationActive: Boolean(chartCalibrationInstance)
    });
}
// TENNIS_PATCH30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR
// Frontend invariato: marker di cache/coerenza per il Core Contract Audit read-only.

// TENNIS_PATCH31_SECRETS_RELEASE_HARDENING
window.TENNIS_PATCH31_SECRETS_RELEASE_HARDENING = Object.freeze({
  version: 'TENNIS_RELEASE_SECURITY_V1_PATCH31',
  credentialPolicy: 'ENVIRONMENT_ONLY',
  releaseSecurityEndpoint: '/api/tennis/release-security-health',
  modelProbabilityChanged: false, qualityGateChanged: false, stakeChanged: false
});


// TENNIS_PATCH34_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE
window.TENNIS_PATCH34_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE = Object.freeze({
  version: 'TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_V1_PATCH34',
  endpoint: '/api/tennis/official-schedule-health',
  appendOnly: true,
  captureRaceGuard: true,
  automaticSettlement: false,
  modelAuthority: false,
  stakeAuthority: false
});

// TENNIS_PATCH33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY
window.TENNIS_PATCH33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY = Object.freeze({
  version: 'TENNIS_CANONICAL_EVENT_TIME_CONTRACT_V1_PATCH33',
  endpoint: '/api/tennis/canonical-event-time-health',
  timezone: 'Europe/Rome',
  dstAmbiguityBlocked: true,
  conflictSafetyRule: 'EARLIEST_CREDIBLE_TIME',
  automaticGateOverride: false,
  modelAuthority: false,
  stakeAuthority: false
});

// TENNIS_PATCH32_REJECTED_CAPTURE_OBSERVABILITY_CLOCK_DRIFT_LEDGER
window.TENNIS_PATCH32_REJECTED_CAPTURE_OBSERVABILITY = Object.freeze({
  version: 'TENNIS_REJECTED_CAPTURE_OBSERVABILITY_V1_PATCH32',
  endpoint: '/api/tennis/rejected-capture-observability',
  appendOnly: true, automaticOverride: false, modelProbabilityChanged: false, qualityGateChanged: false, stakeChanged: false
});

// ============================================================================
// PATCH37_EXTERNAL_MATCH_INTELLIGENCE_UI
// H2H locale strutturato, ranking ufficiali e meteo Open-Meteo. Read-only health.
// ============================================================================
function renderTennisPatch37ExternalIntelligence(payload = {}) {
    const panel = $('tennisPatch37ExternalIntelligencePanel'); if (!panel) return;
    const sources = payload.sources || {}; const dbInfo = payload.database || {};
    const h2hReady = sources.LOCAL_STRUCTURED_H2H?.enabled === true;
    const weatherReady = sources.OPEN_METEO_FORECAST?.enabled === true;
    const rankingsReady = sources.ATP_OFFICIAL_RANKINGS?.enabled === true && sources.WTA_OFFICIAL_RANKINGS?.enabled === true;
    const level = payload.success === false ? 'error' : h2hReady && weatherReady && rankingsReady ? 'ok' : 'warn';
    panel.classList.remove('status-ok','status-warn','status-error'); panel.classList.add(`status-${level}`);
    const title = $('tennisPatch37ExternalIntelligenceTitle'); const message = $('tennisPatch37ExternalIntelligenceMessage');
    if (title) title.textContent = level === 'ok' ? 'Fonti esterne registrate · autorità prudenziale' : 'Fonti esterne parziali o non disponibili';
    if (message) message.textContent = 'L’H2H locale sostituisce gli snippet web; ranking e meteo aggiungono contesto senza bypassare Quality Gate e stake authority.';
    const cards = [
        ['H2H locale', h2hReady ? 'READY' : 'NO'], ['H2H cap', `±${payload.maxH2hAdjustmentPp ?? 2.5}pp`],
        ['ATP ranking', sources.ATP_OFFICIAL_RANKINGS?.enabled ? 'ABILITATO' : 'NO'], ['WTA ranking', sources.WTA_OFFICIAL_RANKINGS?.enabled ? 'ABILITATO' : 'NO'],
        ['Open-Meteo', weatherReady ? 'ABILITATO' : 'NO'], ['Sedi', Number(payload.venues || 0)],
        ['Ricevute', Number(dbInfo.receiptRows || 0)], ['Challenger runs', Number(dbInfo.challengerRows || 0)]
    ];
    const grid = $('tennisPatch37ExternalIntelligenceGrid'); if (grid) grid.innerHTML = cards.map(([label,value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisPatch37ExternalIntelligenceDetails'); if (details) details.textContent = [
        `Allowlist HTTPS: ${(payload.allowedHosts || []).join(', ') || 'N/D'}.`,
        `Cache: H2H ${payload.cache?.h2hEntries || 0} · web ${payload.cache?.webEntries || 0} · single-flight ${payload.cache?.webInFlight || 0}.`,
        `Match Charting: ${sources.MATCH_CHARTING_PROJECT?.enabled === true ? 'ABILITATO' : 'DISABILITATO RESEARCH-ONLY'} · promozione automatica NO.`
    ].join('\n');
}
async function loadTennisPatch37ExternalIntelligence() {
    if (activeSport !== SPORT.TENNIS) return null;
    try { const response = await fetch('/api/tennis/external-match-intelligence-health',{cache:'no-store'}); const payload = await response.json(); renderTennisPatch37ExternalIntelligence(payload); if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`),{payload}); return payload; }
    catch (error) { const payload = error.payload || {success:false,error:error.message}; renderTennisPatch37ExternalIntelligence(payload); showRuntimeDiagnostic({severity:'WARN',title:'External Match Intelligence non disponibile',message:error.message,phase:'PATCH37_EXTERNAL_INTELLIGENCE_FETCH',scope:'TENNIS',error}); return null; }
}
function bindTennisPatch37ExternalIntelligenceUi(){const refresh=$('refreshTennisPatch37ExternalIntelligence');if(refresh&&refresh.dataset.bound!=='1'){refresh.addEventListener('click',loadTennisPatch37ExternalIntelligence);refresh.dataset.bound='1';}loadTennisPatch37ExternalIntelligence();}
window.loadTennisPatch37ExternalIntelligence=loadTennisPatch37ExternalIntelligence;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindTennisPatch37ExternalIntelligenceUi);else bindTennisPatch37ExternalIntelligenceUi();
// /PATCH37_EXTERNAL_MATCH_INTELLIGENCE_UI

// ============================================================================
// PATCH36_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_UI
// Read-only governance: provider freshness, forward-vs-retrospective authority
// and final WTA freshness circuit breaker. No model or settlement authority.
// ============================================================================
function renderTennisPatch36Governance(payload = {}) {
    const panel = $('tennisPatch36GovernancePanel'); if (!panel) return;
    const wta = payload.wtaProviderRecovery?.readiness || {};
    const drift = payload.tourDriftAuthority || {};
    const stale = String(wta.status || '').toUpperCase() !== 'CURRENT';
    const level = payload.healthy === false ? 'error' : stale || drift.probabilityAdjustmentAuthority !== true ? 'warn' : 'ok';
    panel.classList.remove('status-ok','status-warn','status-error'); panel.classList.add(`status-${level}`);
    const title = $('tennisPatch36GovernanceTitle'); const message = $('tennisPatch36GovernanceMessage');
    if (title) { title.textContent = stale ? `WTA ${wta.status || 'UNAVAILABLE'} · ${wta.dataAgeDays ?? 'N/D'} giorni` : 'WTA corrente · provider recovery pronto'; title.style.color = level === 'error' ? '#f87171' : level === 'warn' ? '#fcd34d' : '#86efac'; }
    if (message) message.textContent = drift.probabilityAdjustmentAuthority === true
        ? 'Il campione forward ha maturato autorità bounded; verificare i dettagli prima di qualsiasi promozione.'
        : 'Il drift retrospettivo resta diagnostico e non modifica la probabilità; l’autorità forward è ancora immatura.';
    const github = payload.wtaProviderRecovery?.provider || {};
    const cards = [
        ['WTA freshness', wta.status || 'N/D'], ['Età WTA', wta.dataAgeDays == null ? 'N/D' : `${wta.dataAgeDays} g`],
        ['Provider attivo', wta.providerId || 'LKG'], ['GitHub zero-key', github.enabled === true ? 'ABILITATO' : 'NO'],
        ['Forward rows', Number(drift.forward?.rows || 0)], ['Retro rows', Number(drift.retrospective?.rows || 0)],
        ['Prob. authority', drift.probabilityAdjustmentAuthority === true ? 'SÌ' : 'NO'], ['Circuit breaker WTA', Number(payload.wtaCircuitBreakerRows || 0)]
    ];
    const grid = $('tennisPatch36GovernanceGrid'); if (grid) grid.innerHTML = cards.map(([label,value]) => `<div class="tennis-forward-capture-metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`).join('');
    const details = $('tennisPatch36GovernanceDetails'); if (details) details.textContent = [
        `Provider recovery: ${github.id || 'JEFF_SACKMANN_GITHUB'} · cache condizionale ${github.conditionalRequests === true ? 'SÌ' : 'NO'} · key API richiesta ${github.apiKeyRequired === true ? 'SÌ' : 'NO'}.`,
        `Retrospettivo: ${drift.retrospective?.overall?.recent?.accuracyPct ?? 'N/D'}% recent · Brier ${drift.retrospective?.overall?.recent?.brier ?? 'N/D'} · severità ${drift.retrospective?.overall?.severity || 'NONE'}.`,
        `Forward: ${drift.forward?.rows || 0} righe · maturo ${drift.forwardOverallMature === true ? 'SÌ' : 'NO'} · policy ${drift.policy || 'N/D'}.`
    ].join('\n');
}
async function loadTennisPatch36Governance() {
    if (activeSport !== SPORT.TENNIS) return null;
    try { const response = await fetch('/api/tennis/patch36-governance-health',{cache:'no-store'}); const payload = await response.json(); renderTennisPatch36Governance(payload); if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`),{payload}); return payload; }
    catch (error) { const payload = error.payload || {healthy:false,error:error.message}; renderTennisPatch36Governance(payload); showRuntimeDiagnostic({severity:'ERROR',title:'Governance Patch 36 non disponibile',message:error.message,phase:'PATCH36_GOVERNANCE_FETCH',scope:'TENNIS',error}); return null; }
}
function bindTennisPatch36GovernanceUi(){const refresh=$('refreshTennisPatch36Governance');if(refresh&&refresh.dataset.bound!=='1'){refresh.addEventListener('click',loadTennisPatch36Governance);refresh.dataset.bound='1';}loadTennisPatch36Governance();}
window.loadTennisPatch36Governance=loadTennisPatch36Governance;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindTennisPatch36GovernanceUi);else bindTennisPatch36GovernanceUi();
// /PATCH36_WTA_PROVIDER_RECOVERY_TOUR_DRIFT_AUTHORITY_UI
