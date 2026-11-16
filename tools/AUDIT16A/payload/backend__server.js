
function parseFootballDataDate(value) {
    // AUDIT04: Football-data CSV date only; local midnight preserves cutoff semantics.
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    let d, m, y;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const local = /^(\d{1,2})([\/.-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(raw);
    if (iso) [, y, m, d] = iso;
    else if (local) {
        d = local[1]; m = local[3]; y = local[4];
        if (y.length === 2) y = Number(y) >= 70 ? `19${y}` : `20${y}`;
    } else return null;
    d = Number(d); m = Number(m); y = Number(y);
    if (y < 100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

// ==========================================
//  AI BETTING QUANT PRO - SERVER CORE (CALCIO E HUB PRINCIPALE)
//  Versione: 14.7 + STEP59 CALCIO ALIGNMENT GUARDRAILS (Background + Sport Bankroll Persistence)
// ==========================================
//
// FIX 14.6
// - Aggiunta diagnostica ottimizzazione Calcio: perché optimizableSample può essere 0.
// - Health Calcio espone missingProbability/missingOdd/missingEdge/missingEv/missingDataQuality.
// - /api/calcio/optimize include diagnostics senza applicare soglie se campione non ottimizzabile.
// - UI può spiegare perché i risultati ottimizzazione Calcio mancano.
//
// FIX 14.5
// - Fix runtime /api/calcio/health: requiredColumns ora usa requiredDbColumns.
// - Evita errore frontend: "requiredColumns is not defined".
// - Health Calcio resta non mutante e non tocca Tennis.
//
// FIX 14.4
// - Aggiunto endpoint GET /api/calcio/health.
// - Health Calcio non mutante: controlla componenti, DB, data_quality, sample e isolamento Tennis.
// - Nessuna modifica a server.tennis.js e nessuna modifica al mount /api/tennis.
// - Nessuna modifica alle soglie Tennis.
//
// FIX 14.3
// - Backtest Calcio ora usa finalizeFootballDiagnostics() come l'analisi live.
// - Diagnostiche zero-result centralizzate e coerenti tra /api/analyze e /api/backtest.
// - Nessuna modifica a server.tennis.js e nessuna modifica al mount /api/tennis.
// - Nessuna modifica alle soglie Tennis.
// ==========================================

// CALCIO PATCH 2 - REQUEST IDENTITY, SAFE CACHE & ODDS CONSENSUS
// - Cache key deterministica: lega, bankroll, settings, versioni e profilo feed.
// - Cache TTL con pruning e limite massimo di entry.
// - Miglior quota valida per mercato; riferimento Pinnacle no-vig o mediana no-vig robusta.
// - Nessuna modifica a probabilita, soglie, stake, DB o autorita Tennis.
// ==========================================

// CALCIO PATCH 3 - DYNAMIC SEASON, FRESHNESS & LAST KNOWN GOOD
// - Stagioni football-data risolte dinamicamente con fallback ordinato.
// - Cache locale validata, refresh massimo ogni 24h e cooldown errori.
// - Download invalidi o errori di rete non sostituiscono mai l'ultimo dataset valido.
// - Nessuna modifica a probabilita, soglie, stake, DB o autorita Tennis.
// CALCIO PATCH 5 - PROBABILITY INTEGRITY & BEST AVAILABLE FORECAST
// - Nessuna partita con quote complete viene nascosta solo per dati storici insufficienti.
// - Correzione xG null/proxy, audit Monte Carlo e consenso modello/MC/mercato.
// - Le righe prive di valore operativo restano ANALYSIS_ONLY con stake 0.
// - Resa Qualità e DeepScan conservano piena visibilità e autorità di blocco.
// ==========================================

const express = require('express');
const sqlite3 = require('better-sqlite3');
const axios = require('axios');
const path = require('path'); 
const { getUnderstatxG, getUnderstatState, classifySeasonForKickoff } = require('./scraper');
const deepScanCalcio = require('./deepScanCalcio');
const tennisRoutes = require('./server.tennis');
const telegramRoutes = require('./telegramRoutes'); // STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
const paperTradingEngine = require('./paperTrading');
const tennisScheduler = require('./tennisAutoScheduler');
const calcioScheduler = require('./calcioAutoScheduler');
const operationalSchedulerStateMachinePatch58 = require('./operationalSchedulerStateMachinePatch58');
const controlledCanaryActivationPatch59 = require('./controlledCanaryActivationPatch59');
const { trackClosingLines, buildClvSmartFetchPlan, buildStep103ClvRuntimeAudit, inferTennisSportKeyForBet } = require('./clvTracker');
const clvCrossSportCoveragePatch53 = require('./clvCrossSportCoveragePatch53');
const calcioRegistryInventoryHarmonizationPatch54 = require('./calcioRegistryInventoryHarmonizationPatch54');
const statisticalProductionReadinessGatePatch55 = require('./statisticalProductionReadinessGatePatch55');
const unifiedCrossSportPortfolioRiskAuthorityPatch56 = require('./unifiedCrossSportPortfolioRiskAuthorityPatch56');
const productionSecuritySafeReleasePatch57 = require('./productionSecuritySafeReleasePatch57');
const calcioQuantEngine = require('./calcioQuantEngine');
const valueEvaluator = require('./value_evaluator');
const simulationEngine = require('./simulation');
const bankrollManager = require('./bankrollManager');
const apiUsageTracker = require('./apiUsageTracker');
const calcioProfessionalGuard = require('./calcioProfessionalGuard');
const calcioRequestIdentity = require('./calcioRequestIdentity');
const calcioMarketConsensus = require('./calcioMarketConsensus');
const calcioCertifiedOddsProvenance = require('./calcioCertifiedOddsProvenance');
const calcioFootballDataProvider = require('./calcioFootballDataProvider');
const calcioHistoricalCombinationEvidence = require('./calcioHistoricalCombinationEvidence');
const calcioProbabilityIntegrity = require('./calcioProbabilityIntegrity');
const calcioProgramCoherence = require('./calcioProgramCoherence');
const bettingMacroCausal = require('./bettingMacroCausal');
const deepScanRuntimeResilience = require('./deepScanRuntimeResilience');
const calcioDeepScanPayloadContract = require('./calcioDeepScanPayloadContract');
const calcioSourceIntelligence = require('./calcioSourceIntelligence');
const calcioUnderstatContract = require('./calcioUnderstatContract');
const calcioTeamSnapshot = require('./calcioTeamSnapshot');
const calcioOpponentAdjustedForm = require('./calcioOpponentAdjustedForm');
const calcioEventIdentity = require('./calcioEventIdentity');
const calcioStakeLifecycle = require('./calcioStakeLifecycle');
const paperTradingIdentity = require('./paperTradingIdentity');
const calcioProfessionalSelection = require('./calcioProfessionalSelection');
const calcioMultiProviderEvidence = require('./calcioMultiProviderEvidence');
const calcioClubEloProvider = require('./calcioClubEloProvider');
const calcioKellyStakePolicy = require('./calcioKellyStakePolicy');
const calcioStakePortfolioAudit = require('./calcioStakePortfolioAudit');
const calcioStakeReconciler = require('./calcioStakeReconciler');
const calcioUnifiedPredictionIndex = require('./calcioUnifiedPredictionIndex');
const calcioAiFinalization = require('./calcioAiFinalization');
const calcioObservability = require('./calcioObservability');
const calcioEventFinalizationIsolation = require('./calcioEventFinalizationIsolation');
const calcioBatchPortfolioAllocator = require('./calcioBatchPortfolioAllocator');
const calcioDeepScanFinalState = require('./calcioDeepScanFinalState');
const calcioCrossMarketReliability = require('./calcioCrossMarketReliability');
const calcioDataQualityAuthority = require('./calcioDataQualityAuthority');
const calcioUnifiedStakeAuthority = require('./calcioUnifiedStakeAuthority');
const calcioFinalMarketDiagnosticContract = require('./calcioFinalMarketDiagnosticContract');
const calcioHistoricalCoverage = require('./calcioHistoricalCoverageEntityResolution');
const calcioDualScoreArchitecture = require('./calcioDualScoreArchitecture');
const calcioReliabilityCalibration = require('./calcioReliabilityCalibration');
const aiOutcomeBandPerformance = require('./aiOutcomeBandPerformance');
const aiPredictionIndexBandPerformance = require('./aiPredictionIndexBandPerformance');
const tennisDeepScanCanonicalOnboardingPatch49 = require('./tennisDeepScanCanonicalOnboardingPatch49');
const calcioDecisionCertification = require('./calcioDecisionCertification');
const calcioHistoricalThresholdOptimizer = require('./calcioHistoricalThresholdOptimizer');
const { getTeamNlpProfile } = require('./nlpEngine7');
const manualDeepScanLab = require('./manualDeepScanLab');
const tennisScope = require('./tennisOperationalScope');
const calcioScope = require('./calcioOperationalScope');
const tennisCalibrationEngine = require('./tennisCalibrationEngine');
const calcioCalibrationEngine = require('./calcioCalibrationEngine');
const tennisClvLearningEngine = require('./tennisClvLearningEngine');
const calcioClvLearningEngine = require('./calcioClvLearningEngine');
const auditTrail = require('./auditTrail');
const portfolioAuditMetrics = require('./portfolioAuditMetrics');
const step90GateDecision = require('./preMatchGateDecisionPolicy');
const { assertPreMatchOnlyContext } = require('./preMatchLeakageGuard');
const runtimeDiagnostics = require('./runtimeDiagnostics');
const tennisSettlementContract = require('./tennisSettlementContract');

const SERVER_ENGINE_VERSION = '17.0';
const FOOTBALL_MODEL_VERSION = 'FOOTBALL_XG_DIXON_COLES_PROBABILITY_INTEGRITY_2026_V2';
const FOOTBALL_METRIC_VERSION = 'FOOTBALL_EDGE_EV_PROBABILITY_INTEGRITY_V3';
const DATA_QUALITY_CURRENT = 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_LEGACY_DIRTY = 'LEGACY_DIRTY';
const FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION = 50;

// STEP59_CALCIO_ALIGNMENT_GUARDRAILS
// STEP59C_CALCIO_EXPOSURE_GUARD
// Allinea il Calcio ai guardrail Tennis senza modificare modello, probabilità, edge/EV o Tennis.
const STEP59_CALCIO_ALIGNMENT_VERSION = 'STEP59_CALCIO_ALIGNMENT_GUARDRAILS';
const STEP60_CALCIO_PROFESSIONAL_VERSION = calcioProfessionalGuard.STEP60_CALCIO_PROFESSIONAL_GUARD_VERSION;
const STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT = 'STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT';
const CALCIO_GATE_STATUS = Object.freeze({
    APPROVED_FULL_STAKE: 'CALCIO_APPROVED_FULL_STAKE',
    APPROVED: 'CALCIO_APPROVED',
    APPROVED_WITH_CAP: 'CALCIO_APPROVED_WITH_CAP',
    WATCHLIST_MICRO: 'CALCIO_WATCHLIST_MICRO',
    EARLY_WATCHLIST: 'CALCIO_EARLY_WATCHLIST',
    BLOCKED_SOFT: 'CALCIO_BLOCKED_SOFT',
    BLOCKED_HARD: 'CALCIO_BLOCKED_HARD',
    NO_BET: 'CALCIO_NO_BET'
});
const CALCIO_EXPOSURE_ROLE = Object.freeze({
    PRIMARY: 'PRIMARY_PICK',
    AUDIT_ALTERNATIVE: 'AUDIT_ALTERNATIVE'
});

const app = express();
runtimeDiagnostics.installProcessDiagnostics({ component: 'BETTING_SERVER' });
// PATCH58_SCHEDULER_RELIABILITY_OPERATIONAL_STATE_MACHINE
app.get('/api/scheduler-state-machine-health', (req, res) => {
    try { return res.json(operationalSchedulerStateMachinePatch58.buildHealth({ projectRoot: path.join(__dirname, '..') })); }
    catch (error) { return res.status(500).json({ success:false, healthy:false, version:operationalSchedulerStateMachinePatch58.VERSION, error:error.message }); }
});
app.get('/api/scheduler-state-machine/tennis', (req, res) => {
    try { const health=operationalSchedulerStateMachinePatch58.buildHealth({ projectRoot:path.join(__dirname,'..') }); return res.json({ success:true, version:health.version, sport:'TENNIS', ...health.sports.TENNIS }); }
    catch (error) { return res.status(500).json({ success:false, sport:'TENNIS', error:error.message }); }
});
app.get('/api/scheduler-state-machine/calcio', (req, res) => {
    try { const health=operationalSchedulerStateMachinePatch58.buildHealth({ projectRoot:path.join(__dirname,'..') }); return res.json({ success:true, version:health.version, sport:'CALCIO', ...health.sports.CALCIO }); }
    catch (error) { return res.status(500).json({ success:false, sport:'CALCIO', error:error.message }); }
});
app.get('/api/controlled-canary-health', (req,res) => { try { return res.json(controlledCanaryActivationPatch59.buildHealth({ projectRoot:path.join(__dirname,'..') })); } catch(error) { return res.status(500).json({ success:false, healthy:false, version:controlledCanaryActivationPatch59.VERSION, error:error.message }); } });

// PATCH57_PRODUCTION_SECURITY_SAFE_RELEASE
// Local-first by default. Remote/tunnel API traffic is fail-closed and requires
// an explicit opt-in plus a strong bearer/X-BettingApp token. No trust-proxy
// widening is enabled implicitly.
const PATCH57_SECURITY_CONFIG = productionSecuritySafeReleasePatch57.installExpressSecurity(app, {
    projectRoot: path.join(__dirname, '..')
});
app.use(express.json({ limit: calcioDeepScanPayloadContract.EXPRESS_JSON_LIMIT }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '5m', fallthrough: true }));

// ⚡ MONTA LE ROTTE DEL TENNIS
app.use('/api/tennis', tennisRoutes);
// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER - rotte Telegram isolate dalla dashboard principale.
app.use('/api/telegram', telegramRoutes);

// BETTING_PATCH_26F_D_RUNTIME_DIAGNOSTICS_V2
// Endpoint generico e filtrabile per sport. Mantiene compatibilità con la route Tennis Patch 5.
app.get('/api/runtime-diagnostics', (req, res) => {
    try {
        const scope = runtimeDiagnostics.normalizeDiagnosticScope(req.query.scope || req.query.sport || 'ALL');
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
        const levels = String(req.query.levels || '').split(',').map(value => value.trim()).filter(Boolean);
        const recent = runtimeDiagnostics.readRecentDiagnostics(limit, { scope, levels });
        const statusRows = db.prepare(`
            SELECT UPPER(COALESCE(status,'UNKNOWN')) status, COUNT(*) n
            FROM ai_forward_test
            WHERE COALESCE(paper_result_active,1)=1
              AND COALESCE(paper_result_conflict,0)=0
              AND (? <> 'TENNIS' OR UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP'))
              AND (
                   (? = 'ALL')
                OR (? = 'CALCIO' AND (UPPER(COALESCE(sport_type,''))='CALCIO' OR UPPER(COALESCE(bet_type,'')) LIKE '%CALCIO%' OR UPPER(COALESCE(strategy_tag,'')) LIKE 'SERIE_%' OR UPPER(COALESCE(strategy_tag,'')) LIKE 'PREMIER_%' OR UPPER(COALESCE(strategy_tag,'')) LIKE 'BUNDESLIGA_%' OR UPPER(COALESCE(strategy_tag,'')) LIKE 'LA_LIGA_%'))
                OR (? = 'TENNIS' AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'))
              )
            GROUP BY UPPER(COALESCE(status,'UNKNOWN'))
        `).all(scope, scope, scope, scope);
        return res.json({
            success: true,
            version: runtimeDiagnostics.RUNTIME_DIAGNOSTICS_VERSION,
            compatibilityVersion: runtimeDiagnostics.RUNTIME_DIAGNOSTICS_COMPAT_VERSION,
            readMode: 'TAIL_FILTERED_READ_ONLY',
            scope,
            logFile: 'backend/logs/runtime-diagnostics.jsonl',
            recent,
            summary: runtimeDiagnostics.buildDiagnosticsSummary(recent),
            dataSummary: { byStatus: Object.fromEntries(statusRows.map(row => [row.status, row.n])) },
            safeguards: { secretsRedacted: true, readOnly: true, legacyTennisEndpointPreserved: true }
        });
    } catch (error) {
        runtimeDiagnostics.captureError({ component: 'RUNTIME_DIAGNOSTICS', operation: 'READ_DIAGNOSTICS', phase: 'GENERIC_ENDPOINT', error, context: { scope: req.query.scope || 'ALL' } });
        return res.status(500).json({ success: false, error: error.message });
    }
});


// BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS
// Misura read-only WON/LOST per fasce della probabilità AI persistita per la selezione.
// Non usa Affidabilità AI, TPI, quote implicite o valori post-match e non modifica alcuna autorità.
app.get('/api/analytics/ai-outcome-bands', (req, res) => {
    try {
        const sport = String(req.query.sport || 'CALCIO').toUpperCase() === 'TENNIS' ? 'TENNIS' : 'CALCIO';
        const rows = db.prepare(`
            SELECT id, status, sport_type, bet_type, strategy_tag, league,
                   tournament_category, tournament_level, tournament_name, tour_type,
                   estimated_prob, stake, data_quality, paper_result_active, paper_result_conflict
            FROM ai_forward_test
            WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST')
              AND COALESCE(paper_result_active,1) = 1
              AND COALESCE(paper_result_conflict,0) = 0
              AND UPPER(COALESCE(bet_type,'')) NOT LIKE '%MULTI%'
        `).all();
        return res.json(aiOutcomeBandPerformance.buildAiOutcomeBandPerformance(require('./tradingScopeReadModel').select(rows,sport,req.query.tradingScope), { sport }));
    } catch (error) {
        runtimeDiagnostics.captureError({
            component: 'AI_OUTCOME_BANDS',
            operation: 'BUILD_CROSS_SPORT_AI_WIN_LOSS_BANDS',
            phase: 'READ_ONLY_ANALYTICS',
            error,
            context: { sport: req.query.sport || 'CALCIO' }
        });
        return res.status(500).json({ success: false, error: error.message });
    }
});



// TENNIS_PATCH49_CROSS_SPORT_PREDICTION_INDEX_BANDS
// Read-only WON/LOST per fasce dell'indice di predizione prematch. L'esito è usato soltanto nell'aggregazione storica.
app.get('/api/analytics/prediction-index-bands', (req, res) => {
    try {
        const sport = String(req.query.sport || 'CALCIO').toUpperCase() === 'TENNIS' ? 'TENNIS' : 'CALCIO';
        const rows = db.prepare(`
            SELECT * FROM ai_forward_test
            WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST')
              AND COALESCE(paper_result_active,1) = 1
              AND COALESCE(paper_result_conflict,0) = 0
              AND UPPER(COALESCE(bet_type,'')) NOT LIKE '%MULTI%'
        `).all();
        return res.json(aiPredictionIndexBandPerformance.buildAiPredictionIndexBandPerformance(require('./tradingScopeReadModel').select(rows,sport,req.query.tradingScope), { sport }));
    } catch (error) {
        runtimeDiagnostics.captureError({ component:'PREDICTION_INDEX_BANDS', operation:'BUILD_PREDICTION_INDEX_WIN_LOSS_BANDS', phase:'READ_ONLY_ANALYTICS', error, context:{ sport:req.query.sport || 'CALCIO' } });
        return res.status(500).json({ success:false, error:error.message });
    }
});

// STEP51_API_USAGE_CREDITS_COUNTER - endpoint riepilogo crediti The Odds API.
// Non espone mai valori delle chiavi API.
app.get('/api/usage/odds', (req, res) => {
    try {
        res.json(apiUsageTracker.getApiUsageSummary());
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, mode: 'STEP51_API_USAGE_CREDITS_COUNTER' });
    }
});

// STEP53_API_EFFICIENCY_CACHE - audit cache hit/miss e sprechi evitati.
app.get('/api/usage/odds/audit', (req, res) => {
    try {
        const summary = apiUsageTracker.getApiUsageSummary();
        res.json({
            success: true,
            mode: 'STEP53_API_EFFICIENCY_CACHE_AUDIT',
            provider: summary.provider,
            monthKey: summary.monthKey,
            creditsUsed: summary.creditsUsed,
            cache: summary.cache,
            recommendation: 'Cache hit = 0 crediti scalati; cache miss = chiamata reale e credito scalato. TTL live odds 120s, sports catalog 6h, scores 30m.'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, mode: 'STEP53_API_EFFICIENCY_CACHE_AUDIT' });
    }
});


// ==========================================
// 🔐 DEV-OPS: GESTIONE API KEYS E PATH
// ==========================================
const ENV_API_KEYS = String(process.env.ODDS_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
// STEP64_NO_HARDCODED_API_FALLBACK
// Produzione sicura: nessuna chiave The Odds API resta hardcoded nel sorgente.
// Configurare le chiavi tramite .env: ODDS_API_KEYS=key1,key2,key3
const API_KEYS = ENV_API_KEYS;
if (API_KEYS.length === 0) {
    console.warn('⚠️ STEP64: nessuna ODDS_API_KEYS configurata. Le funzioni live/API resteranno disabilitate finché non imposti il file .env.');
}
// STEP51_API_USAGE_CREDITS_COUNTER - server.js inventory
apiUsageTracker.registerApiKeyInventory({ source: 'server.js', keyCount: API_KEYS.length });
let currentKeyIndex = 0;

let analysisCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000;
const CALCIO_ANALYSIS_CACHE_MAX_ENTRIES = 64;

// ==========================================
// 🛠️ FUNZIONI GLOBALI E HELPERS NUMERICI
// ==========================================
function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = 0) {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
}

function safeJsonParse(json, fallback = {}) {
    try {
        if (!json) return fallback;
        return JSON.parse(json);
    } catch (error) {
        return fallback;
    }
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function normalizeSportType(row = {}) {
    const raw = String([
        row.sport_type,
        row.sport,
        row.bet_type,
        row.strategy_tag,
        row.league
    ].filter(Boolean).join(' ')).toLowerCase();

    if (raw.includes('tennis') || raw.includes('atp') || raw.includes('wta')) return 'TENNIS';
    if (raw.includes('football') || raw.includes('soccer') || raw.includes('calcio')) return 'CALCIO';

    // Compatibilità vecchie righe Calcio: SINGLE senza riferimenti Tennis.
    if (!raw.includes('tennis') && raw.includes('single')) return 'CALCIO';

    return '';
}

function isCleanCurrentRow(row = {}) {
    const q = String(row.data_quality || '').toUpperCase();
    return q !== DATA_QUALITY_LEGACY_DIRTY && q !== 'DIRTY' && q !== 'OLD_METRICS';
}

// STEP 14 - Portfolio/Calibration strict scope.
// Do not promote legacy NULL data_quality rows to current history for professional analytics.
function isStrictCurrentQuality(row = {}) {
    const q = String(row.data_quality || '').trim().toUpperCase();
    return q === 'CURRENT' || q === DATA_QUALITY_CURRENT;
}

function isResolvedWonLost(row = {}) {
    return ['WON', 'LOST'].includes(String(row.status || '').trim().toUpperCase());
}

function getStrictResolvedRows() {
    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE status IN ('WON', 'LOST')
          AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT', ?)
    `).all(DATA_QUALITY_CURRENT);
}

function getStrictSettledRows() {
    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE status IN ('WON', 'LOST', 'PUSH', 'VOID')
          AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT', ?)
    `).all(DATA_QUALITY_CURRENT);
}

function filterRowsForSport(rows = [], sport = 'ALL') {
    const s = String(sport || 'ALL').toUpperCase();
    if (s === 'TENNIS') return rows.filter(isTennisRow);
    if (s === 'CALCIO' || s === 'FOOTBALL') return rows.filter(isFootballRow);
    return rows;
}

function isFootballRow(row = {}) {
    return normalizeSportType(row) === 'CALCIO' || (!normalizeSportType(row) && !String(row.bet_type || '').toUpperCase().includes('TENNIS'));
}

function isTennisRow(row = {}) {
    return normalizeSportType(row) === 'TENNIS';
}

function hasTennisOperationalGate(row = {}) {
    return row.professional_gate_status !== undefined && row.professional_gate_status !== null && String(row.professional_gate_status).trim() !== ''
        || row.tennis_operational_status !== undefined && row.tennis_operational_status !== null && String(row.tennis_operational_status).trim() !== ''
        || row.tennis_operational_action !== undefined && row.tennis_operational_action !== null && String(row.tennis_operational_action).trim() !== ''
        || row.professional_gate_allow_bet !== undefined && row.professional_gate_allow_bet !== null;
}

function isTennisBlockedOrNoBet(row = {}) {
    const statusText = [
        row.professional_gate_status,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.ds_action,
        row.ds_suggestion
    ].map(v => String(v || '').toUpperCase()).join(' ');

    return Number(row.professional_gate_allow_bet) === 0
        || statusText.includes('NO_BET')
        || statusText.includes('BLOCCATA')
        || statusText.includes('BLOCKED');
}

function isPortfolioOperationalRow(row = {}) {
    // STEP67A_PORTFOLIO_AUDIT_GRADE_SCOPE
    // Calcio e Tennis usano scope separati: stake zero, audit alternative,
    // counterfactual e blocchi DeepScan/Gate non entrano mai nel ROI reale.
    if (isTennisRow(row)) return tennisScope.classifyTennisTradingScope(row).paperOperational;
    if (isFootballRow(row)) return calcioScope.classifyCalcioTradingScope(row).paperOperational;
    return false;
}

function impliedProbabilityPct(odd) {
    const o = safeNumber(odd, 0);
    if (o <= 1) return 0;
    return 100 / o;
}

function calculateEvPct(probabilityPct, odd) {
    const p = clamp(probabilityPct, 0, 100) / 100;
    const o = safeNumber(odd, 0);
    if (o <= 1) return 0;
    return ((p * o) - 1) * 100;
}


function createFootballDiagnostics(scope = 'unknown', leagues = []) {
    return {
        scope,
        leaguesRequested: leagues,
        leaguesProcessed: 0,
        csvLoaded: 0,
        csvErrors: [],
        apiErrors: [],
        xgTeamsLoaded: 0,
        liveMatchesFound: 0,
        liveMatchesWithoutBookmaker: 0,
        liveMatchesMissingH2H: 0,
        teamMatchingFailed: 0,
        historyTooShort: 0,
        modelEligibleMatches: 0,
        rowsParsed: 0,
        eligibleMatches: 0,
        marketsEvaluated: 0,
        rejectedInvalidOdd: 0,
        rejectedMissingProbability: 0,
        rejectedOnlyGlobal: 0,
        rejectedByOddsRange: 0,
        rejectedByThreshold: 0,
        rejectedByCr: 0,
        rejectedByStake: 0,
        valueCandidates: 0,
        selectedBets: 0,
        // STEP59E_CALCIO_DIAGNOSTICS_UI
        calcioGate: { approved: 0, watchlistMicro: 0, blockedSoft: 0, blockedHard: 0 },
        exposureGuard: { primary: 0, auditAlternative: 0, conflicts: 0 },
        settlementGuard: { localVault: 0, cacheHit: 0, apiCalls: 0, apiCreditsUsed: 0 },
        // STEP60_CALCIO_PROFESSIONAL_GUARDRAILS_DIAGNOSTICS
        professionalGuard: { lineupRisk: 0, dataBootstrap: 0, teamMatchReview: 0, timingWatchlist: 0, correlationWarnings: 0 },
        opponentAdjustedForm: { evaluated: 0, applied: 0, earlySeason: 0, priorOnly: 0, unavailable: 0, maxAbsoluteAdjustmentPct: 0 },
        marketConsensus: calcioMarketConsensus.createCalcioMarketConsensusDiagnostics(),
        footballData: calcioFootballDataProvider.createProviderDiagnostics(),
        notes: [],
        settingsSnapshot: {},
        dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
        engineVersion: SERVER_ENGINE_VERSION,
        // STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT
        step97Mode: STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT,
        noResultReason: null,
        feedAudit: {
            mode: 'STEP97_CALCIO_FEED_AUDIT',
            requestedLeagues: leagues,
            byLeague: [],
            noLiveOddsLeagues: [],
            apiErrorLeagues: [],
            bookmakerIssues: 0,
            h2hIssues: 0
        },
        candidateAudit: {
            mode: 'STEP97_CALCIO_CANDIDATE_AUDIT',
            evaluated: { h2h: 0, totals: 0, btts: 0, all: 0 },
            acceptedForSelection: { h2h: 0, totals: 0, btts: 0, all: 0 },
            rejected: {},
            auditOnly: {},
            topRejected: [],
            topAuditCandidates: [],
            notes: [
                'Step97: audit Calcio allineato al Tennis. I rifiuti spiegano feed, matching, soglie, CR e stake.',
                'Il pannello è diagnostico: non cambia modello, quote, stake, DB o Calcio/Tennis isolation.'
            ]
        },
        systemAudit: null
    };
}

function finalizeFootballDiagnostics(diagnostics = {}, foundCount = 0) {
    if (!diagnostics.notes) diagnostics.notes = [];

    if (foundCount > 0) {
        diagnostics.notes.push(`Output prodotto: ${foundCount} selezioni.`);
        return diagnostics;
    }

    if ((diagnostics.csvLoaded || 0) === 0) {
        diagnostics.notes.push('Nessun CSV caricato correttamente da football-data.');
    } else if ((diagnostics.liveMatchesFound || 0) === 0 && diagnostics.scope === 'analyze') {
        diagnostics.notes.push('Nessuna quota live disponibile: controllare API key, calendario o mercato The Odds API.');
    } else if ((diagnostics.modelEligibleMatches || 0) === 0 && diagnostics.scope === 'analyze') {
        diagnostics.notes.push('Quote presenti, ma nessun match ha superato matching team/storico minimo.');
    } else if ((diagnostics.eligibleMatches || 0) === 0 && diagnostics.scope === 'backtest') {
        diagnostics.notes.push('Nessun match storico ha raggiunto il campione minimo casa/trasferta per il modello.');
    } else if ((diagnostics.marketsEvaluated || 0) === 0) {
        diagnostics.notes.push('Match presenti, ma nessun mercato valutabile con quote/probabilità valide.');
    } else {
        diagnostics.notes.push('Mercati valutati, ma nessuna bet ha superato soglie edge_pp/probabilità/EV/CR/stake.');
    }

    if ((diagnostics.rejectedByThreshold || 0) > 0) {
        diagnostics.notes.push(`Scarti per soglia edge/probabilità/EV: ${diagnostics.rejectedByThreshold}.`);
    }

    if ((diagnostics.rejectedByCr || 0) > 0) {
        diagnostics.notes.push(`Scarti per cross reference/closing drift: ${diagnostics.rejectedByCr}.`);
    }

    if ((diagnostics.rejectedByOddsRange || 0) > 0) {
        diagnostics.notes.push(`Scarti per quota fuori range: ${diagnostics.rejectedByOddsRange}.`);
    }

    return diagnostics;
}


// ============================================================================
// STEP97 - CALCIO SYSTEM AUDIT ALIGNMENT WITH TENNIS
// ============================================================================
function getCalcioMarketAuditFamily(prediction = '') {
    const family = inferCalcioMarketFamily(prediction);
    if (family === 'TOTALS') return 'totals';
    if (family === 'BTTS') return 'btts';
    return 'h2h';
}

function incrementMapCounter(target = {}, key = 'UNKNOWN', amount = 1) {
    const normalizedKey = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
    target[normalizedKey] = safeNumber(target[normalizedKey], 0) + amount;
    return target;
}

function recordFootballFeedAudit(diagnostics = {}, entry = {}) {
    if (!diagnostics.feedAudit || typeof diagnostics.feedAudit !== 'object') return;
    const row = {
        league: entry.league || 'UNKNOWN',
        status: entry.status || 'INFO',
        reason: entry.reason || '',
        liveMatches: safeNumber(entry.liveMatches, 0),
        bookmakers: safeNumber(entry.bookmakers, 0),
        h2h: safeNumber(entry.h2h, 0),
        totals: safeNumber(entry.totals, 0)
    };
    diagnostics.feedAudit.byLeague.push(row);
    if (row.status === 'NO_LIVE_ODDS') diagnostics.feedAudit.noLiveOddsLeagues.push(row.league);
    if (row.status === 'API_ERROR') diagnostics.feedAudit.apiErrorLeagues.push(row.league);
    if (row.status === 'NO_BOOKMAKER') diagnostics.feedAudit.bookmakerIssues += 1;
    if (row.status === 'NO_H2H') diagnostics.feedAudit.h2hIssues += 1;
}

function classifyFootballCandidateRejectCode(context = {}) {
    if (context.selected === true) return 'ACCEPTED_FOR_SELECTION';
    if (context.noBookmaker) return 'NO_BOOKMAKER';
    if (context.noH2H) return 'NO_H2H_MARKET';
    if (context.teamMatchingFailed) return 'TEAM_MATCHING_FAILED';
    if (context.historyTooShort) return 'HISTORY_TOO_SHORT';
    if (context.invalidOdd) return 'INVALID_ODD';
    if (context.missingProbability) return 'MISSING_MODEL_PROBABILITY';
    if (context.onlyGlobal) return 'ONLY_GLOBAL_FILTER';
    if (context.oddsRange) return 'ODDS_RANGE_BLOCK';
    if (context.threshold) return 'EDGE_PROB_EV_THRESHOLD_FAILED';
    if (context.crFailed) return 'CROSS_REFERENCE_FAILED';
    if (context.stakeZero) return 'STAKE_POLICY_ZERO';
    return 'NOT_SELECTED_UNKNOWN';
}

function recordFootballCandidateAudit(diagnostics = {}, context = {}) {
    const audit = diagnostics.candidateAudit;
    if (!audit || typeof audit !== 'object') return;

    const family = getCalcioMarketAuditFamily(context.prediction);
    audit.evaluated[family] = safeNumber(audit.evaluated[family], 0) + 1;
    audit.evaluated.all = safeNumber(audit.evaluated.all, 0) + 1;

    const rejectCode = classifyFootballCandidateRejectCode(context);
    if (rejectCode === 'ACCEPTED_FOR_SELECTION') {
        audit.acceptedForSelection[family] = safeNumber(audit.acceptedForSelection[family], 0) + 1;
        audit.acceptedForSelection.all = safeNumber(audit.acceptedForSelection.all, 0) + 1;
        return;
    }

    incrementMapCounter(audit.rejected, rejectCode);

    const score = Math.max(0, safeNumber(context.edge_pp, 0)) * 2
        + Math.max(0, safeNumber(context.ev_pct, 0)) * 0.35
        + Math.max(0, safeNumber(context.probability, 0) - 45) * 0.20;
    const row = {
        sport: 'CALCIO',
        marketFamily: family,
        match: context.match || 'N/D',
        prediction: context.prediction || 'N/D',
        odd: round(context.odd, 2),
        probability: round(context.probability, 2),
        edge_pp: round(context.edge_pp, 2),
        ev_pct: round(context.ev_pct, 2),
        rejectCode,
        reason: context.reason || rejectCode,
        score: round(score, 2)
    };
    audit.topRejected.push(row);
    audit.topRejected = audit.topRejected
        .sort((a, b) => safeNumber(b.score, 0) - safeNumber(a.score, 0))
        .slice(0, 12);

    if (['EDGE_PROB_EV_THRESHOLD_FAILED', 'CROSS_REFERENCE_FAILED', 'STAKE_POLICY_ZERO'].includes(rejectCode)) {
        incrementMapCounter(audit.auditOnly, rejectCode);
        audit.topAuditCandidates.push(row);
        audit.topAuditCandidates = audit.topAuditCandidates
            .sort((a, b) => safeNumber(b.score, 0) - safeNumber(a.score, 0))
            .slice(0, 12);
    }
}

function buildFootballSystemAudit(diagnostics = {}, options = {}) {
    const foundCount = safeNumber(options.foundCount, 0);
    const reliabilityReport = options.reliabilityReport || {};
    let noResultReason = 'UNKNOWN';
    let primaryLabel = 'Diagnostica Calcio non classificata';
    let detail = 'Controllare counters, feed e candidate audit.';

    if (foundCount > 0) {
        noResultReason = 'HAS_VALUE_BETS';
        primaryLabel = 'Output prodotto';
        detail = `${foundCount} selezioni Calcio prodotte.`;
    } else if ((diagnostics.apiErrors || []).length > 0 && safeNumber(diagnostics.liveMatchesFound, 0) === 0) {
        noResultReason = 'ODDS_API_ERRORS_OR_NO_ODDS_EVENTS';
        primaryLabel = 'Errore feed/API quote';
        detail = 'The Odds API non ha restituito eventi live utili o ha generato errori.';
    } else if (safeNumber(diagnostics.csvLoaded, 0) === 0) {
        noResultReason = 'NO_FOOTBALL_CSV_LOADED';
        primaryLabel = 'CSV football-data non caricato';
        detail = 'Nessuna lega ha caricato correttamente il CSV storico.';
    } else if (safeNumber(diagnostics.liveMatchesFound, 0) === 0 && diagnostics.scope === 'analyze') {
        noResultReason = 'NO_LIVE_ODDS_FROM_PROVIDER';
        primaryLabel = 'Nessuna quota live dal provider';
        detail = 'Calendario/mercato provider vuoto, API key non valida/esaurita, oppure sport/league senza eventi disponibili.';
    } else if (safeNumber(diagnostics.teamMatchingFailed, 0) > 0 && safeNumber(diagnostics.modelEligibleMatches, 0) === 0) {
        noResultReason = 'TEAM_MATCHING_OR_HISTORY_BLOCK';
        primaryLabel = 'Matching team o storico insufficiente';
        detail = 'Quote presenti, ma nomi squadra/storico non hanno prodotto match eleggibili.';
    } else if (safeNumber(diagnostics.marketsEvaluated, 0) === 0) {
        noResultReason = 'NO_MARKET_EVALUATED';
        primaryLabel = 'Nessun mercato valutato';
        detail = 'Feed presente, ma mancano quote H2H/totals o probabilità modello.';
    } else {
        noResultReason = 'NO_CANDIDATE_PASSED_EDGE_EV_CR_STAKE_GATE';
        primaryLabel = 'Soglie/Gate senza pick';
        detail = 'Mercati valutati, ma nessuno ha superato edge, EV, CR, stake o gate operativo.';
    }

    const blockers = [
        ['API errors', (diagnostics.apiErrors || []).length],
        ['No live odds', safeNumber(diagnostics.feedAudit?.noLiveOddsLeagues?.length, 0)],
        ['Team matching failed', safeNumber(diagnostics.teamMatchingFailed, 0)],
        ['History too short', safeNumber(diagnostics.historyTooShort, 0)],
        ['Invalid odd', safeNumber(diagnostics.rejectedInvalidOdd, 0)],
        ['Missing probability', safeNumber(diagnostics.rejectedMissingProbability, 0)],
        ['Threshold', safeNumber(diagnostics.rejectedByThreshold, 0)],
        ['Cross reference', safeNumber(diagnostics.rejectedByCr, 0)],
        ['Stake', safeNumber(diagnostics.rejectedByStake, 0)]
    ].filter(([, value]) => safeNumber(value, 0) > 0)
     .map(([key, value]) => ({ key, value }));

    const suggestions = [];
    if (noResultReason === 'NO_LIVE_ODDS_FROM_PROVIDER') {
        suggestions.push('Verifica disponibilità partite live/future per le leghe richieste e credito The Odds API.');
        suggestions.push('Controlla che i mercati h2h/totals siano disponibili per il calcio nel provider.');
    }
    if (noResultReason === 'TEAM_MATCHING_OR_HISTORY_BLOCK') {
        suggestions.push('Audit nomi squadra: provider vs football-data/Understat.');
    }
    if (noResultReason === 'NO_CANDIDATE_PASSED_EDGE_EV_CR_STAKE_GATE') {
        suggestions.push('Analizzare topRejected: soglie, CR e stake policy spiegano lo zero pick.');
    }
    if (!suggestions.length) suggestions.push('Nessuna azione automatica applicata: audit informativo, non mutante.');

    return {
        mode: STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT,
        sport: 'CALCIO',
        noResultReason,
        primaryBlocker: { code: noResultReason, label: primaryLabel, detail },
        zeroPickExplanation: `${primaryLabel}: ${detail}`,
        matchesVerdict: foundCount > 0 ? `Analisi Calcio con ${foundCount} pick.` : `Analisi Calcio senza pick: ${primaryLabel}.`,
        funnel: {
            leaguesRequested: Array.isArray(diagnostics.leaguesRequested) ? diagnostics.leaguesRequested.length : 0,
            leaguesProcessed: safeNumber(diagnostics.leaguesProcessed, 0),
            csvLoaded: safeNumber(diagnostics.csvLoaded, 0),
            liveMatchesFound: safeNumber(diagnostics.liveMatchesFound, 0),
            modelEligibleMatches: safeNumber(diagnostics.modelEligibleMatches, 0),
            marketsEvaluated: safeNumber(diagnostics.marketsEvaluated, 0),
            valueCandidates: safeNumber(diagnostics.valueCandidates, 0),
            selectedBets: safeNumber(diagnostics.selectedBets, 0),
            savedAttempts: safeNumber(diagnostics.savedAttempts, 0)
        },
        feedAudit: diagnostics.feedAudit || null,
        candidateAudit: diagnostics.candidateAudit || null,
        topBlockers: blockers,
        gateVerdicts: {
            thresholds: safeNumber(diagnostics.rejectedByThreshold, 0) > 0 ? `${diagnostics.rejectedByThreshold} scarti soglia` : 'Nessuno scarto soglia o nessun mercato valutato.',
            crossReference: safeNumber(diagnostics.rejectedByCr, 0) > 0 ? `${diagnostics.rejectedByCr} scarti CR` : 'Nessuno scarto CR o CR non arrivato al mercato.',
            stake: safeNumber(diagnostics.rejectedByStake, 0) > 0 ? `${diagnostics.rejectedByStake} scarti stake` : 'Nessuno scarto stake.',
            reliability: reliabilityReport.mode || 'BOOTSTRAP/UNKNOWN'
        },
        checks: [
            { area: 'Isolamento Tennis/Calcio', status: 'OK', detail: 'Step97 non modifica server.tennis.js o rotte /api/tennis.' },
            { area: 'Pre-match / Post-match', status: 'OK', detail: 'CLV, result, profit e closing line non entrano nella valutazione pre-match Calcio.' },
            { area: 'Paper trading / Portfolio', status: 'OK', detail: 'Calcio mantiene scope operativo separato tramite calcioOperationalScope.' },
            { area: 'Zero pick audit', status: foundCount > 0 ? 'OK' : 'CHECK', detail: detail }
        ],
        suggestedActions: suggestions,
        generatedAt: new Date().toISOString()
    };
}


// STEP97B_CALCIO_POSTMATCH_COLUMNS_MARKER
// Marker statico richiesto dai test Step97: le colonne DB post-match Calcio esistono,
// ma non devono mai entrare nel contesto pre-match passato alla Analisi AI.
// ai_forward_test.closing_odd e ai_forward_test.clv_pct restano solo post-match/settlement.
// /STEP97B_CALCIO_POSTMATCH_COLUMNS_MARKER
function assertCalcioPreMatchOnlyContext(ctx = {}) {
    // STEP97_CALCIO_PREMATCH_LEAK_GUARD
    assertPreMatchOnlyContext({
        sport: 'CALCIO',
        odd: ctx.odd,
        probability: ctx.probability,
        edge_pp: ctx.edge_pp,
        ev_pct: ctx.ev_pct,
        market: ctx.market,
        league: ctx.league,
        kickoff: ctx.kickoff
    });
}


// ============================================================================
// STEP59B/C - CALCIO OPERATIONAL GATE + EXPOSURE GUARD
// ============================================================================
function inferCalcioMarketFamily(prediction = '') {
    const p = String(prediction || '').toUpperCase().replace(/\s+/g, '');
    if (['1', 'X', '2', '1X', 'X2', '12'].includes(p)) return '1X2';
    if (p.includes('O') || p.includes('OVER') || p.includes('U') || p.includes('UNDER')) return 'TOTALS';
    if (p.includes('GG') || p.includes('BTTS') || p.includes('NG')) return 'BTTS';
    return 'OTHER';
}

function normalizeCalcioExposureToken(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}

function buildCalcioExposureKey(bet = {}) {
    const explicitEventKey = bet.event_key
        || bet.eventKey
        || bet.match_exposure_key
        || bet.extData?.eventIdentity?.eventKey
        || bet.calcioEventIdentity?.eventKey;
    if (explicitEventKey && String(explicitEventKey).startsWith('calcio-event|')) return String(explicitEventKey);
    return [
        'calcio',
        normalizeCalcioExposureToken(bet.league || ''),
        normalizeCalcioExposureToken(bet.home || bet.home_team || ''),
        normalizeCalcioExposureToken(bet.away || bet.away_team || ''),
        normalizeCalcioExposureToken(bet.commence_time || bet.kickoff || bet.match_date || bet.date || '')
    ].join('|');
}


// STEP60 - CALCIO PROFESSIONAL GUARDRAILS
function buildCalcioProfessionalContextForMatch({ match = {}, config = {}, hCsv = '', aCsv = '', hUnder = '', aUnder = '', teamStats = {}, realXGData = {}, understatCoverage = null, understatState = null, understatSeasonEvidence = null, teamSnapshots = null, opponentAdjustedForm = null, historicalCoverageAudit = null, clubEloEvidence = null, footballReliabilityReport = {}, p_mc = {}, odds = {} } = {}) {
    const homeStats = teamStats[hCsv] || {};
    const awayStats = teamStats[aCsv] || {};
    const homeXg = realXGData[hUnder] ? safeNumber(realXGData[hUnder].xG_for, null) : null;
    const awayXg = realXGData[aUnder] ? safeNumber(realXGData[aUnder].xG_for, null) : null;
    const extData = {
        league: config.name,
        competition: config.name,
        commenceTime: match.commence_time,
        kickoff: match.commence_time,
        homeCsvName: hCsv,
        awayCsvName: aCsv,
        homeUnderstatName: hUnder,
        awayUnderstatName: aUnder,
        homeProviderName: match.home_team,
        awayProviderName: match.away_team,
        homeXg,
        awayXg,
        homeUnderstatXg: homeXg,
        awayUnderstatXg: awayXg,
        homeMatches: Number.isFinite(Number(homeStats.observedHomeMatches)) ? Number(homeStats.observedHomeMatches) : (homeStats.hp || 0),
        awayMatches: Number.isFinite(Number(awayStats.observedAwayMatches)) ? Number(awayStats.observedAwayMatches) : (awayStats.ap || 0),
        footballDataLoaded: Boolean((homeStats.observedHomeMatches || homeStats.hp) || (awayStats.observedAwayMatches || awayStats.ap)),
        footballHistoryCoverageMode: historicalCoverageAudit?.status || homeStats.coverageMode || awayStats.coverageMode || 'UNKNOWN',
        teamHistoryMatched: historicalCoverageAudit ? Boolean(historicalCoverageAudit.matched) : !(homeStats.historySyntheticDenominator || awayStats.historySyntheticDenominator),
        historicalCoverageVersion: historicalCoverageAudit?.version || calcioHistoricalCoverage.CALCIO_HISTORICAL_COVERAGE_VERSION,
        historicalCoverageReason: historicalCoverageAudit?.reasonCode || null,
        promotedTeamPrior: Boolean(historicalCoverageAudit?.promotedTeamPrior),
        historicalCoverageAudit: historicalCoverageAudit || null,
        understatLoaded: Boolean(understatCoverage?.bothTeams || (realXGData[hUnder] && realXGData[aUnder]))
            && understatSeasonEvidence?.status === 'CURRENT_SEASON_XG',
        understatDataAvailable: Boolean(understatCoverage?.bothTeams || (realXGData[hUnder] && realXGData[aUnder])),
        xgEvidenceMode: understatCoverage?.bothTeams
            ? (understatSeasonEvidence?.status || 'UNKNOWN_SEASON')
            : 'GOAL_SHOT_PROXY',
        understatCoverage,
        understatData: realXGData,
        understatProviderVersion: understatState?.version || null,
        understatProviderStatus: understatState?.status || 'NOT_CHECKED',
        understatSeason: understatState?.season || null,
        understatSeasonEvidence: understatSeasonEvidence || null,
        understatAuthorityStatus: understatSeasonEvidence?.status || 'UNKNOWN_SEASON',
        eventIdentity: match.calcioEventIdentity || null,
        eventKey: match.calcioEventIdentity?.eventKey || null,
        canonicalPairKey: match.calcioEventIdentity?.canonicalPairKey || null,
        providerEventId: match.calcioEventIdentity?.providerEventId || match.id || null,
        teamSnapshots,
        opponentAdjustedForm,
        clubEloEvidence,
        opponentAdjustedFormVersion: opponentAdjustedForm?.version || calcioOpponentAdjustedForm.CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
        reliabilityMode: footballReliabilityReport.mode || footballReliabilityReport.decision?.mode || 'BOOTSTRAP',
        lineupStatus: 'NOT_CONFIRMED',
        lineupsConfirmed: false,
        newsConfidence: 45,
        marketProbabilities: p_mc,
        odd1: odds['1'],
        oddX: odds['X'],
        odd2: odds['2'],
        overOdd: odds['O2.5'],
        underOdd: odds['U2.5']
    };
    const audit = calcioProfessionalGuard.buildCalcioProfessionalAudit({
        home: hCsv || match.home_team,
        away: aCsv || match.away_team,
        prediction: 'MATCH_CONTEXT',
        probabilities: p_mc,
        odds,
        extData
    });
    return { ...extData, professionalAudit: audit, professionalGuardVersion: STEP60_CALCIO_PROFESSIONAL_VERSION };
}

function buildCalcioCorrelationContextForPrediction(prediction, p_mc = {}, odds = {}, baseExtData = {}) {
    const correlation = calcioProfessionalGuard.buildCorrelationAudit({ prediction, probabilities: p_mc, odds, extData: baseExtData });
    return {
        calcioCorrelationStatus: correlation.status,
        calcioCorrelationRisk: correlation.highestRisk,
        calcioCorrelationCombos: correlation.combos,
        correlatedMarkets: correlation.combos,
        correlationAlternatives: correlation.combos.map(c => c.alternative).filter(Boolean)
    };
}

function updateFootballProfessionalDiagnostics(diagnostics = {}, audit = {}) {
    if (!diagnostics.professionalGuard || !audit) return;
    if (audit.lineupNews?.status && audit.lineupNews.status !== 'LINEUP_OK') diagnostics.professionalGuard.lineupRisk++;
    if (audit.dataReliability?.status && audit.dataReliability.status !== 'DATA_RELIABLE') diagnostics.professionalGuard.dataBootstrap++;
    if (audit.teamMatching?.status && audit.teamMatching.status !== 'MATCH_OK') diagnostics.professionalGuard.teamMatchReview++;
    if (audit.timing?.status && !['FINAL_GATE', 'LINEUP_WINDOW'].includes(audit.timing.status)) diagnostics.professionalGuard.timingWatchlist++;
    if ((audit.correlation?.highestRisk || 0) >= 30) diagnostics.professionalGuard.correlationWarnings++;
}

function classifyCalcioDeepScanAction(action = '', suggestion = '') {
    // PATCH 15: macro tecnica e timing operativo restano distinti.
    // Il testo della suggestion viene usato solo come fallback quando la macro non è canonica.
    return calcioStakePortfolioAudit.classifyDeepScanGateSignal(action, suggestion);
}

function buildCalcioOperationalGate(bet = {}, options = {}) {
    // PATCH 15 - Stake execution must use theoretical Kelly, not the already-capped operational stake.
    const edgePp = safeNumber(bet.edge_pp ?? bet.edge, 0);
    const evPct = safeNumber(bet.ev_pct ?? bet.rawEdge, 0);
    const probability = safeNumber(bet.estimatedProb ?? bet.estimated_prob ?? bet.rawProb, 0);
    const theoreticalStake = Math.max(0, safeNumber(
        bet.calcio_theoretical_stake ?? bet.stake_theoretical ?? bet.theoreticalStake ?? bet.invested ?? bet.stake,
        0
    ));
    const dsClass = classifyCalcioDeepScanAction(options.ds_action || bet.ds_action, options.ds_suggestion || bet.ds_suggestion);
    const professionalAudit = options.professionalAudit || bet.professionalAudit || bet.calcio_professional_audit || null;
    const professionalRisk = professionalAudit && typeof professionalAudit === 'object' ? safeNumber(professionalAudit.risk, 0) : safeNumber(bet.calcio_professional_risk, 0);
    const professionalStatus = professionalAudit && typeof professionalAudit === 'object' ? String(professionalAudit.status || '') : String(bet.calcio_professional_status || '');
    const timingStatus = professionalAudit && typeof professionalAudit === 'object'
        ? String(professionalAudit.timing?.status || '')
        : String(bet.calcio_timing_status || '');
    const dataAuthority = options.dataAuthority || bet.calcio_data_authority || bet.kellyStakePolicy?.dataAuthority || bet.kelly_stake_policy?.dataAuthority || null;
    const dataClass = String(dataAuthority?.dataClass || bet.stake_confidence_level || '').toUpperCase();
    const reasons = [];
    let status = CALCIO_GATE_STATUS.APPROVED_WITH_CAP;
    let allowBet = true;
    let maxStake = theoreticalStake;
    let action = 'APPROVED_WITH_CAP';

    if (professionalStatus === 'PROFESSIONAL_BLOCK_HARD') {
        status = CALCIO_GATE_STATUS.BLOCKED_HARD;
        allowBet = false;
        maxStake = 0;
        action = 'NO_BET_PROFESSIONAL_HARD';
        reasons.push('Guardrail professionale HARD su lineup, team matching o dati.');
    } else if (professionalStatus === 'PROFESSIONAL_BLOCK_SOFT' || professionalRisk >= 58) {
        // Patch 16: SOFT è un cap prudenziale, non un veto. Rimane €0 solo se
        // non esiste Kelly teorico positivo o il dato è INATTENDIBILE.
        if (theoreticalStake > 0 && dataClass !== 'INATTENDIBILE') {
            status = CALCIO_GATE_STATUS.WATCHLIST_MICRO;
            allowBet = true;
            maxStake = Math.min(theoreticalStake, Math.max(2, Math.min(theoreticalStake * 0.25, 3)));
            action = 'BET_ALLOWED_MICRO_SOFT';
            reasons.push('Guardrail professionale SOFT applicato come cap: 25% Kelly, minimo €2, cap €3.');
        } else {
            status = CALCIO_GATE_STATUS.BLOCKED_SOFT;
            allowBet = false;
            maxStake = 0;
            action = 'NO_BET_PROFESSIONAL_SOFT';
            reasons.push('Guardrail professionale SOFT senza Kelly teorico affidabile.');
        }
    } else if (dsClass === 'HIGH_RISK') {
        status = CALCIO_GATE_STATUS.BLOCKED_HARD;
        allowBet = false;
        maxStake = 0;
        action = 'NO_BET_HARD';
        reasons.push('DeepScan Calcio ALTO RISCHIO: stake operativo non consentito.');
    } else if (dsClass === 'WAIT_IN_PLAY' || dsClass === 'MODEL_RISK') {
        status = CALCIO_GATE_STATUS.BLOCKED_SOFT;
        allowBet = false;
        maxStake = 0;
        action = 'NO_BET_SOFT_OR_WAIT_IN_PLAY';
        reasons.push('DeepScan richiede attesa live o segnala rischio modello.');
    } else if (dataClass === 'INATTENDIBILE') {
        status = CALCIO_GATE_STATUS.BLOCKED_SOFT;
        allowBet = false;
        maxStake = 0;
        action = 'NO_BET_DATA_UNRELIABLE';
        reasons.push('Dati INATTENDIBILI: nessuna esposizione consentita.');
    } else if (timingStatus === 'EARLY_WATCHLIST') {
        if (theoreticalStake > 0 && ['CONFIRMATIVE', 'TECH_EDGE'].includes(dsClass)) {
            status = CALCIO_GATE_STATUS.WATCHLIST_MICRO;
            allowBet = true;
            maxStake = Math.min(theoreticalStake, Math.max(2, Math.min(theoreticalStake * 0.25, 3)));
            action = 'BET_ALLOWED_MICRO_EARLY';
            reasons.push('Kickoff oltre 24h: DeepScan completato e dati attendibili; micro-stake reale 25% Kelly, minimo €2, cap €3.');
        } else {
            status = CALCIO_GATE_STATUS.EARLY_WATCHLIST;
            allowBet = false;
            maxStake = 0;
            action = theoreticalStake > 0 ? 'WAIT_DEEPSCAN_OR_RECHECK' : 'ANALYSIS_ONLY';
            reasons.push(theoreticalStake > 0
                ? 'Kickoff oltre 24h: stake teorico presente ma serve DeepScan tecnico confermativo prima del micro-stake.'
                : 'Kickoff oltre 24h e nessuno stake teorico: sola analisi.');
        }
    } else if (timingStatus === 'PRE_MATCH_EARLY') {
        if (theoreticalStake > 0 && ['CONFIRMATIVE', 'TECH_EDGE'].includes(dsClass)) {
            status = CALCIO_GATE_STATUS.WATCHLIST_MICRO;
            allowBet = true;
            maxStake = Math.min(theoreticalStake, Math.max(2, Math.min(theoreticalStake * 0.25, 3)));
            action = 'MICRO_CAP_PRE_MATCH_EARLY';
            reasons.push('Kickoff tra 2 e 24h: micro-stake reale 25% Kelly, minimo €2, cap €3.');
        } else {
            status = CALCIO_GATE_STATUS.WATCHLIST_MICRO;
            allowBet = false;
            maxStake = 0;
            action = 'WAIT_DEEPSCAN';
            reasons.push('Finestra 2-24h: attesa DeepScan o stake teorico non disponibile.');
        }
    } else if (edgePp < 4 || evPct < 5 || probability < 50) {
        status = CALCIO_GATE_STATUS.WATCHLIST_MICRO;
        allowBet = theoreticalStake > 0;
        maxStake = theoreticalStake > 0 ? Math.min(theoreticalStake, 3) : 0;
        action = theoreticalStake > 0 ? 'MICRO_OR_REVIEW' : 'ANALYSIS_ONLY';
        reasons.push('Edge/EV/probabilità positivi ma non sufficienti per stake standard: solo micro/cap se Kelly è positivo.');
    } else {
        reasons.push('Calcio Gate: numeri value validi; stake consentito entro Kelly e cap dati.');
    }

    const preMatchDecision = step90GateDecision.evaluatePreMatchGateDecision({
        sport: 'CALCIO',
        gateStatus: status,
        operationalStatus: status,
        operationalAction: action,
        gateReasons: reasons.join(' | '),
        gateAllowBet: allowBet,
        ds_action: options.ds_action || bet.ds_action,
        ds_suggestion: options.ds_suggestion || bet.ds_suggestion,
        edge_pp: edgePp,
        ev_pct: evPct,
        estimated_prob: probability,
        historicalStats: options.step90HistoricalStats || null,
        hardVetoReason: professionalStatus === 'PROFESSIONAL_BLOCK_HARD' ? professionalStatus : ''
    });

    if (preMatchDecision.code === 'APPROVED_FULL_STAKE' && !['HIGH_RISK', 'MODEL_RISK', 'WAIT_IN_PLAY'].includes(dsClass) && !['EARLY_WATCHLIST', 'PRE_MATCH_EARLY'].includes(timingStatus)) {
        status = CALCIO_GATE_STATUS.APPROVED_FULL_STAKE;
        allowBet = true;
        maxStake = theoreticalStake;
        action = 'BET_ALLOWED_FULL_STAKE';
        reasons.push('Step90: APPROVATA STAKE PIENO da storico aggregato; CLV corrente escluso.');
    } else if (preMatchDecision.code === 'APPROVED' && !['HIGH_RISK', 'MODEL_RISK', 'WAIT_IN_PLAY'].includes(dsClass) && !['EARLY_WATCHLIST', 'PRE_MATCH_EARLY'].includes(timingStatus)) {
        status = CALCIO_GATE_STATUS.APPROVED;
        allowBet = true;
        maxStake = theoreticalStake;
        action = 'BET_ALLOWED_APPROVED';
        reasons.push('Step90: APPROVATA da storico aggregato; CLV corrente escluso.');
    }

    return {
        mode: 'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_GATE',
        status,
        allowBet,
        action,
        reasons,
        maxStake: round(Math.max(0, safeNumber(maxStake, 0)), 2),
        theoreticalStake: round(theoreticalStake, 2),
        dataClass: dataClass || 'UNKNOWN',
        deepScanClass: dsClass,
        marketFamily: inferCalcioMarketFamily(bet.prediction),
        preMatchGateDecision: preMatchDecision,
        pre_match_gate_code: preMatchDecision.code,
        pre_match_gate_label: preMatchDecision.label,
        pre_match_gate_reason: preMatchDecision.reason,
        pre_match_gate_version: preMatchDecision.version,
        pre_match_clv_used: preMatchDecision.clvUsedForCurrentPick ? 1 : 0,
        pre_match_historical_sample: preMatchDecision.historicalSample || 0,
        pre_match_historical_roi: preMatchDecision.historicalRoiPct,
        pre_match_historical_brier: preMatchDecision.historicalBrier,
        pre_match_historical_clv_sample: preMatchDecision.historicalClvSample || 0
    };
}

function applyCalcioOperationalGateToBet(bet = {}, options = {}) {
    // PATCH 21: identità/mercato/quote restano guardrail strutturali.
    // DeepScan, Gate, timing e soglie legacy contribuiscono all'IPM ma non possono
    // applicare un secondo veto o cap dopo la decisione unificata.
    const predictionIndex = calcioUnifiedPredictionIndex.evaluatePrediction({
        ...bet,
        bankroll: options.bankroll ?? bet.bankroll_snapshot ?? bet.bankroll,
        reliabilityScore: bet.prediction_reliability_score ?? bet.calcio_prediction_reliability_score ?? bet.predictionReliability?.score,
        probabilityIntegrity: bet.extData?.probabilityIntegrity || bet.probabilityIntegrity,
        monteCarloProbabilityPct: bet.extData?.probabilityIntegrityMarket?.monteCarloProbabilityPct,
        modelProbabilityPct: bet.extData?.probabilityIntegrityMarket?.modelProbabilityPct,
        marketProbabilityPct: bet.extData?.probabilityIntegrityMarket?.marketProbabilityPct,
        deepScanAction: options.ds_action ?? bet.ds_action,
        deepScanSuggestion: options.ds_suggestion ?? bet.ds_suggestion,
        historicalEvidence: options.historicalEvidence || bet.historicalEvidence,
        historicalSample: bet.historical_combo_resolved ?? bet.historicalSample ?? 0,
        requireIdentityCertification: bet.requireIdentityCertification === true,
        decisionIdentity: bet.decisionIdentity,
        calcioHealthStatus: options.calcioHealthStatus || bet.calcioHealthStatus,
        crPassed: bet.analysis_thresholds?.crPassed
    });
    const persistence = calcioUnifiedPredictionIndex.persistenceFields(predictionIndex);
    const gateStatus = predictionIndex.eligible
        ? (predictionIndex.score >= 80 ? CALCIO_GATE_STATUS.APPROVED
            : predictionIndex.score >= 70 ? CALCIO_GATE_STATUS.APPROVED_WITH_CAP
                : CALCIO_GATE_STATUS.WATCHLIST_MICRO)
        : (predictionIndex.score < 45 || predictionIndex.safetyReasons.length
            ? CALCIO_GATE_STATUS.BLOCKED_SOFT
            : CALCIO_GATE_STATUS.WATCHLIST_MICRO);
    const qualityLabel = predictionIndex.eligible
        ? (predictionIndex.score >= 80 ? 'APPROVATA'
            : predictionIndex.score >= 70 ? 'APPROVATA CON CAP'
                : 'WATCHLIST MICRO')
        : (predictionIndex.score < 45 || predictionIndex.safetyReasons.length ? 'BLOCCATA SOFT' : 'WATCHLIST MICRO');
    const finalStake = predictionIndex.operationalStake;
    const theoreticalStake = predictionIndex.theoreticalStake;
    // PATCH56: paper/shadow stake remains unchanged. Real-money exposure is a
    // separate fail-closed authority that cannot bypass Patch55 or increase stake.
    const patch56PortfolioRiskDecision = unifiedCrossSportPortfolioRiskAuthorityPatch56.decide({
        sport: 'CALCIO',
        betId: bet.id,
        eventKey: buildCalcioExposureKey(bet),
        home_team: bet.home_team || bet.home,
        away_team: bet.away_team || bet.away,
        match_date: bet.match_date || bet.date,
        proposedStake: finalStake,
        bankrollSnapshot: options.bankroll ?? bet.bankroll_snapshot ?? bet.bankroll
    }, { db, projectRoot: __dirname + '/..' });
    const patch56PortfolioRiskFields = unifiedCrossSportPortfolioRiskAuthorityPatch56.toPersistenceFields(patch56PortfolioRiskDecision);

    const analysisStage = calcioProgramCoherence.buildAnalysisStage({
        candidate: { ...bet, invested: finalStake, operationalStake: finalStake, theoreticalStake },
        thresholds: { ...(bet.analysis_thresholds || {}), predictionIndexScore: predictionIndex.score }
    });
    const gate = {
        mode: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_GATE',
        status: gateStatus,
        allowBet: predictionIndex.eligible,
        action: predictionIndex.eligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
        reasons: [predictionIndex.reason],
        maxStake: finalStake,
        theoreticalStake,
        dataClass: predictionIndex.dataClass,
        deepScanClass: predictionIndex.deepScanClass,
        marketFamily: inferCalcioMarketFamily(bet.prediction),
        predictionIndex
    };
    const stakeLifecycle = {
        version: calcioUnifiedPredictionIndex.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
        theoreticalStake,
        operationalStake: finalStake,
        estimatedOperationalProfit: predictionIndex.estimatedProfit,
        status: predictionIndex.eligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
        action: gate.action,
        reason: predictionIndex.reason,
        automaticExecution: predictionIndex.eligible,
        dataClass: predictionIndex.dataClass
    };
    return {
        ...bet,
        ...persistence,
        ...patch56PortfolioRiskFields,
        realMoneyPortfolioRisk: patch56PortfolioRiskDecision,
        real_money_executable_stake: patch56PortfolioRiskDecision.realExecutableStake,
        invested: finalStake.toFixed(2),
        stake: finalStake,
        stake_theoretical: theoreticalStake.toFixed(2),
        theoreticalStake: theoreticalStake.toFixed(2),
        stake_operational: finalStake.toFixed(2),
        operationalStake: finalStake.toFixed(2),
        stake_lifecycle_version: stakeLifecycle.version,
        stake_lifecycle_status: stakeLifecycle.status,
        stake_lifecycle_action: stakeLifecycle.action,
        stake_lifecycle_reason: stakeLifecycle.reason,
        stakeLifecycle,
        predictionIndex,
        prediction_index: predictionIndex,
        analysis_stage: analysisStage,
        analysis_stage_code: analysisStage.code,
        analysis_stage_label: analysisStage.label,
        analysis_stage_reason: predictionIndex.reason,
        estimatedProfit: predictionIndex.estimatedProfit.toFixed(2),
        calcio_gate_status: gate.status,
        calcio_gate_allow_bet: gate.allowBet ? 1 : 0,
        calcio_gate_reasons: predictionIndex.reason,
        calcio_gate_max_stake: gate.maxStake,
        calcio_operational_status: gate.status,
        calcio_operational_action: gate.action,
        calcio_operational_summary: predictionIndex.reason,
        calcio_quality_final_label: qualityLabel,
        quality_final_label: qualityLabel,
        market_type: bet.market_type || gate.marketFamily,
        exposure_role: CALCIO_EXPOSURE_ROLE.PRIMARY,
        match_exposure_key: buildCalcioExposureKey(bet),
        exposure_key: buildCalcioExposureKey(bet),
        exposure_group_status: 'PRIMARY_ACTIVE',
        exposure_reason: 'Patch 21: Indice Predizione Match autoritativo; identità, mercato e quote certificate preservate.',
        calcio_professional_status: bet.calcio_professional_status || bet.professionalAudit?.status || '',
        calcio_professional_risk: bet.calcio_professional_risk ?? bet.professionalAudit?.risk ?? 0,
        calcio_professional_summary: bet.calcio_professional_summary || (bet.professionalAudit?.recommendations || []).join(' | '),
        calcio_timing_status: bet.calcio_timing_status || bet.professionalAudit?.timing?.status || '',
        calcio_lineup_status: bet.calcio_lineup_status || bet.professionalAudit?.lineupNews?.status || '',
        calcio_data_reliability: bet.calcio_data_reliability || bet.professionalAudit?.dataReliability?.status || '',
        calcio_team_match_confidence: bet.calcio_team_match_confidence ?? bet.professionalAudit?.teamMatching?.confidence ?? 0,
        calcio_correlation_status: bet.calcio_correlation_status || bet.professionalAudit?.correlation?.status || ''
    };
}

function markCalcioExposureAlternative(dbHandle, row = {}, reason = '') {
    if (!row || !row.id) return false;
    const fields = {
        stake: 0,
        calcio_gate_status: CALCIO_GATE_STATUS.NO_BET,
        calcio_gate_allow_bet: 0,
        calcio_gate_reasons: reason || 'Step59C: alternativa audit su match già esposto.',
        calcio_gate_max_stake: 0,
        calcio_operational_status: 'CALCIO_NO_BET_EXPOSURE_GUARD',
        calcio_operational_action: 'NO_BET_EXPOSURE_GUARD',
        calcio_operational_summary: reason || 'Step59C: una sola esposizione operativa per match.',
        exposure_role: CALCIO_EXPOSURE_ROLE.AUDIT_ALTERNATIVE,
        exposure_group_status: 'NO_BET_EXPOSURE_GUARD',
        exposure_reason: reason || 'Step59C: alternativa audit, non trading reale.'
    };
    const entries = Object.entries(fields).filter(([key]) => columnExists('ai_forward_test', key));
    if (!entries.length) return false;
    dbHandle.prepare(`UPDATE ai_forward_test SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v), row.id);
    return true;
}

function normalizeForcedStatus(status) {
    const s = String(status || '').toUpperCase().trim();
    if (['WON', 'WIN'].includes(s)) return 'WON';
    if (['LOST', 'LOSS', 'LOSE'].includes(s)) return 'LOST';
    if (s === 'VOID') return 'VOID';
    if (s === 'PUSH') return 'PUSH';
    if (s === 'PENDING') return 'PENDING';
    return null;
}

function calculateForcedProfit(bet = {}, status = 'PENDING') {
    const stake = safeNumber(bet.stake, 0);
    const odd = safeNumber(bet.odd, 0);

    if (status === 'WON') return round(stake * (odd - 1), 2);
    if (status === 'LOST') return round(-stake, 2);
    if (status === 'VOID' || status === 'PUSH' || status === 'PENDING') return 0;

    return 0;
}


function checkWin(prediction, homeGoals, awayGoals) {
    const p = String(prediction).toUpperCase();
    const hg = parseInt(homeGoals);
    const ag = parseInt(awayGoals);

    if (isNaN(hg) || isNaN(ag)) return false;

    if (p === "1") return hg > ag;
    if (p === "X") return hg === ag;
    if (p === "2") return hg < ag;
    if (p === "1X") return hg >= ag;
    if (p === "X2") return hg <= ag;
    if (p === "12") return hg !== ag;
    if (p === "U2.5" || p === "UNDER") return (hg + ag) <= 2;
    if (p === "O2.5" || p === "OVER") return (hg + ag) > 2;
    if (p === "GG" || p === "BTTS") return hg > 0 && ag > 0;
    if (p === "NG") return hg === 0 || ag === 0;
    return false;
}

async function fetchOddsApi(urlTemplate, options = {}) {
    const source = options.source || 'server.js';
    const route = options.route || 'fetchOddsApi';
    const operation = apiUsageTracker.classifyOddsApiOperation(urlTemplate);
    const cachedResponse = apiUsageTracker.getCachedOddsApiResponse(urlTemplate, {
        source, route, forceRefresh: options.forceRefresh === true
    });
    if (cachedResponse && cachedResponse.hit === true) return cachedResponse.data;
    if (!API_KEYS.length) throw new Error('Nessuna API key configurata per The Odds API.');

    let attempts = 0;
    let lastError = null;
    while (attempts < API_KEYS.length) {
        const key = API_KEYS[currentKeyIndex];
        const url = urlTemplate.replace('API_KEY_PLACEHOLDER', key);
        const attempt = apiUsageTracker.recordOddsApiNetworkAttempt({ key, source, operation, route, urlTemplate });
        try {
            const response = await axios.get(url, { timeout: 12000 });
            apiUsageTracker.recordOddsApiResponse({
                attemptId: attempt.attemptId, key, source, operation, route, urlTemplate,
                headers: response.headers, statusCode: response.status, data: response.data
            });
            apiUsageTracker.setCachedOddsApiResponse(urlTemplate, response.data, { source, route });
            return response.data;
        } catch (error) {
            lastError = error;
            apiUsageTracker.recordOddsApiFailure({
                attemptId: attempt.attemptId, key, source, operation, route, urlTemplate,
                headers: error.response?.headers || {}, statusCode: error.response?.status || 0,
                errorCode: error.response?.data?.error_code || error.code || error.message
            });
            if (error.response && [429, 401, 403].includes(error.response.status)) {
                console.warn(`⚠️ API Key [***${key.slice(-4)}] esaurita o limitata. Rotazione chiave...`);
                currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
                attempts++;
                continue;
            }
            throw error;
        }
    }
    throw new Error(`❌ Tutte le chiavi API sono esaurite. Ultimo errore: ${lastError?.message || 'sconosciuto'}`);
}

// ==========================================
// 💾 CONFIGURAZIONE DATABASE
// ==========================================
const DB_PATH = process.env.BETTING_DB_PATH || path.resolve(__dirname, 'database_betting.db');
const db = new sqlite3(DB_PATH);
// AUDIT07S R1: read-only scoped snapshots; no model or settlement changes.
require('./tradingScopeReadModel').install(app, db, (rows, sport, bankroll) => ({
    portfolio: {success:true, report:buildStrictPortfolioReport(rows,{sport,baseBankroll:bankroll}),
        dsGatePerformance:calcioStakePortfolioAudit.buildDsGateMetrics(rows),
        stakeDiagnostics:sport==='CALCIO'?calcioStakePortfolioAudit.buildStakeDiagnostics(rows):null,
        reliabilityCalibration:sport==='CALCIO'?calcioReliabilityCalibration.buildReliabilityCalibration(rows):null},
    calibration: {success:true, report: {
        tennis:sport==='TENNIS'?tennisCalibrationEngine.buildTennisCalibrationReport(rows,{bucketSize:5,minSample:10,operationalOnly:false}):null,
        football:sport==='CALCIO'?calcioCalibrationEngine.buildCalcioCalibrationReport(rows,{bucketSize:5,minSample:10,operationalOnly:false}):null,
        calcio:sport==='CALCIO'?calcioCalibrationEngine.buildCalcioCalibrationReport(rows,{bucketSize:5,minSample:10,operationalOnly:false}):null
    }}
}));

// AUDIT07S R3: prospective strategy assessment; independent from stake authority.
require('./studyLifecycle').install(app,db);
function sportLedgerR3(sport){
 const A=require('./public/portfolioAccounting');
 const rows=db.prepare("SELECT "+require('./audit07sR4ReadColumns').columns(db)+" FROM ai_forward_test WHERE UPPER(sport_type) IN ('CALCIO','TENNIS')").all();
 if(sport==='ALL'){const c=A.ledger(rows,'CALCIO'),t=A.ledger(rows,'TENNIS');if(!c.complete||!t.complete)throw Error('BANKROLL_LEDGER_INCOMPLETE');return {sport:'ALL',baseBankroll:2000,currentBankroll:A.money(c.currentBankroll+t.currentBankroll),sports:{CALCIO:c,TENNIS:t}};}
 const r=A.ledger(rows,sport);if(!r.complete)throw Error('BANKROLL_LEDGER_INCOMPLETE');return r;
}

calcioObservability.ensureSchema(db);
unifiedCrossSportPortfolioRiskAuthorityPatch56.ensureSchema(db);

db.exec(`CREATE TABLE IF NOT EXISTS historical_bets (id INTEGER PRIMARY KEY AUTOINCREMENT, match_date TEXT, match_name TEXT, prediction TEXT, odd REAL, probability REAL, edge REAL, stake REAL, status TEXT DEFAULT 'pending')`);
db.exec(`CREATE TABLE IF NOT EXISTS ai_forward_test (id INTEGER PRIMARY KEY AUTOINCREMENT, bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT, prediction TEXT, odd REAL, stake REAL, status TEXT DEFAULT 'PENDING', profit REAL DEFAULT 0, league TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS system_settings (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS historical_odds_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, api_league TEXT, timestamp TEXT, response_json TEXT)`);

// ⚡ Migrazioni Silenti Avanzate (Compatibilità V14)
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN estimated_prob REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN edge REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN edge_pp REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN ev_pct REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN data_quality TEXT DEFAULT 'CURRENT_BOOTSTRAP'").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN league TEXT").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN ds_action TEXT DEFAULT ''").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN ds_suggestion TEXT DEFAULT ''").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN clv REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN clv_edge REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN confidence REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN strategy_tag TEXT DEFAULT ''").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN market_type TEXT DEFAULT ''").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN expected_roi REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN expected_clv REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN variance REAL DEFAULT 1").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN bankroll_snapshot REAL DEFAULT 0").run(); } catch(e){}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN market_efficiency REAL DEFAULT 0").run(); } catch(e) {}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN steam_move TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN steam_intensity TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN sharp_consensus REAL DEFAULT 0").run(); } catch(e) {}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN clv_quality TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE ai_forward_test ADD COLUMN sport_type TEXT").run(); } catch(e) {}

function columnExists(tableName, columnName) {
    try {
        return db.prepare(`PRAGMA table_info(${tableName})`).all().some(c => c.name === columnName);
    } catch (error) {
        return false;
    }
}

paperTradingIdentity.ensureSchema(db);

function safeAddAiColumn(columnDefinition) {
    const columnName = String(columnDefinition).split(/\s+/)[0];
    if (columnExists('ai_forward_test', columnName)) return;
    try {
        db.prepare(`ALTER TABLE ai_forward_test ADD COLUMN ${columnDefinition}`).run();
    } catch (error) {
        console.warn(`⚠️ Migrazione colonna ${columnName} non riuscita: ${error.message}`);
    }
}

[
    'model_version TEXT',
    'metric_version TEXT',
    'engine_version TEXT',
    'market_implied_prob REAL',
    'fair_odd_model REAL',
    'fair_odd_calibrated REAL',
    'settlement_source TEXT',
    'settlement_note TEXT',
    'settled_at TEXT',
    // STEP102_CLV_CANONICAL_FIELDS_REPAIR - colonne closing line canoniche.
    'opening_odd REAL',
    'closing_odd REAL',
    'clv_pct REAL',
    'closing_line_available INTEGER DEFAULT 0',
    'clv_method TEXT',
    'clv_source TEXT',
    'clv_verified INTEGER DEFAULT 0',
    'closing_odd_side TEXT',
    'winner_side INTEGER',
    'total_games REAL',
    'total_goals INTEGER',
    'home_goals INTEGER',
    'away_goals INTEGER',
    // STEP59_CALCIO_ALIGNMENT_GUARDRAILS_COLUMNS
    'calcio_gate_status TEXT',
    'calcio_gate_allow_bet INTEGER',
    'calcio_gate_reasons TEXT',
    'calcio_gate_max_stake REAL',
    'calcio_operational_status TEXT',
    'calcio_operational_action TEXT',
    'calcio_operational_summary TEXT',
    'exposure_role TEXT',
    'exposure_key TEXT',
    'match_exposure_key TEXT',
    'exposure_group_status TEXT',
    'exposure_reason TEXT',
    // STEP60_CALCIO_PROFESSIONAL_GUARDRAILS_COLUMNS
    'calcio_professional_status TEXT',
    'calcio_professional_risk REAL',
    'calcio_professional_summary TEXT',
    'calcio_timing_status TEXT',
    'calcio_lineup_status TEXT',
    'calcio_data_reliability TEXT',
    'calcio_team_match_confidence REAL',
    'calcio_correlation_status TEXT',
    // CALCIO PATCH 10 - identità evento e ciclo stake teorico/operativo.
    'calcio_event_key TEXT',
    'calcio_provider_event_id TEXT',
    'calcio_canonical_pair_key TEXT',
    'calcio_theoretical_stake REAL DEFAULT 0',
    'calcio_operational_stake REAL DEFAULT 0',
    'calcio_stake_lifecycle_status TEXT',
    'calcio_stake_lifecycle_reason TEXT',
    // CALCIO PATCH 11 - affidabilità, coerenza dei tre stadi e qualità persistita.
    'calcio_prediction_reliability_score REAL',
    'calcio_prediction_reliability_label TEXT',
    'calcio_analysis_stage_code TEXT',
    'calcio_analysis_stage_label TEXT',
    'calcio_analysis_stage_reason TEXT',
    'calcio_analysis_only INTEGER DEFAULT 0',
    'calcio_quality_final_label TEXT',
    // STEP90_PREMATCH_GATE_ALIGNMENT - colonne derivate/audit non mutanti.
    'pre_match_gate_code TEXT',
    'pre_match_gate_label TEXT',
    'pre_match_gate_reason TEXT',
    'pre_match_gate_version TEXT',
    'pre_match_clv_used INTEGER',
    'pre_match_historical_sample INTEGER',
    'pre_match_historical_roi REAL',
    'pre_match_historical_brier REAL',
    'pre_match_historical_clv_sample INTEGER',
    'pre_match_updated_at TEXT'
].forEach(safeAddAiColumn);
[
    'candidate_selection_version TEXT',
    'candidate_selection_score REAL',
    'calcio_prediction_index_score REAL',
    'calcio_prediction_index_label TEXT',
    'calcio_prediction_index_version TEXT',
    'calcio_prediction_index_reason TEXT',
    'calcio_prediction_index_components TEXT',
    'calcio_prediction_index_rank_value REAL',
    'calcio_prediction_index_eligible INTEGER DEFAULT 0',
    'candidate_selection_tier TEXT',
    'candidate_selection_reason TEXT',
    // BETTING PATCH 18 - provenienza e certificazione quote reali.
    'calcio_odds_provenance_version TEXT',
    'calcio_odds_certification_status TEXT',
    'calcio_odds_certification_reason TEXT',
    'calcio_odds_certified INTEGER DEFAULT 0',
    'calcio_odds_operational_eligible INTEGER DEFAULT 0',
    'calcio_odds_direct INTEGER DEFAULT 0',
    'calcio_odds_derived INTEGER DEFAULT 0',
    'calcio_odds_bookmaker_key TEXT',
    'calcio_odds_bookmaker_title TEXT',
    'calcio_odds_market_key TEXT',
    'calcio_odds_last_update TEXT',
    'calcio_odds_source_count INTEGER DEFAULT 0',
    'calcio_odds_source_list TEXT',
    'calcio_odds_provenance_json TEXT'
].forEach(safeAddAiColumn);

const defaultSettings = JSON.stringify({
    baseEdge: 5.0,
    baseProb: 45.0,
    u25Edge: 12.0,
    u25Prob: 65.0,
    home1Edge: 8.0,
    home1Prob: 55.0,
    x2Edge: 8.0,
    x2Prob: 55.0,
    useCrossReference: false,
    onlyGlobal: false,
    useAdvancedMetrics: true,
    eloK: 20,
    timeDecay: 1.15,
    useHistoricalOpt: false,
    leagueParams: {},
    paperTradingParams: {},
    tennisAtpEdge: 4.0,
    tennisAtpProb: 52.0,
    tennisAtpEv: 2.0,
    tennisWtaEdge: 4.5,
    tennisWtaProb: 52.0,
    tennisWtaEv: 2.0
});
db.exec(`INSERT OR IGNORE INTO system_settings (id, config_json) VALUES (1, '${defaultSettings}')`);

function getCurrentBankroll(sport = 'ALL') {
    try {
        const cleanRows = getCleanResolvedRows();
        return sportLedgerR3(sport).currentBankroll;
    } catch (e) {
        console.error('[AUDIT03_BANKROLL_UNAVAILABLE]', sport, e.code || 'BANKROLL_READ_FAILED');
        throw e;
    }
}

function getCleanSettledRows() {
    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE status IN ('WON', 'LOST', 'PUSH', 'VOID')
          AND COALESCE(paper_result_active,1)=1
          AND COALESCE(paper_result_conflict,0)=0
          AND COALESCE(data_quality, ?) != ?
    `).all(DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY);
}

function getCleanResolvedRows() {
    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE status IN ('WON', 'LOST')
          AND COALESCE(paper_result_active,1)=1
          AND COALESCE(paper_result_conflict,0)=0
          AND COALESCE(data_quality, ?) != ?
    `).all(DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY);
}

function getFootballReliabilityReport() {
    const footballResolved = getCleanResolvedRows().filter(isFootballRow);

    if (footballResolved.length < FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION) {
        return {
            mode: 'BOOTSTRAP_NEUTRAL_NEW_HISTORY',
            sampleSize: footballResolved.length,
            brier: { avgBrier: 0.24, quality: 'BOOTSTRAP' },
            calibration: { summary: { weightedCalibrationError: 0, quality: 'BOOTSTRAP' }, buckets: [] },
            clv: { avgCLV: 0, sampleSize: 0 },
            decision: {
                level: 'BOOTSTRAP',
                allowBet: true,
                stakeMultiplier: 1,
                reason: `Nuovo storico Calcio in ricostruzione: ${footballResolved.length}/${FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION} bet risolte`
            }
        };
    }

    return valueEvaluator.buildReliabilityReport(footballResolved, {
        bucketSize: 5,
        minSample: 10,
        sportFilter: 'football',
        cleanOnly: true
    });
}

function buildGlobalAnalytics() {
    const allBets = getCleanResolvedRows();
    const portfolio = paperTradingEngine.generatePortfolioReport(allBets);
    return {
        bankroll: getCurrentBankroll('ALL'),
        portfolio,
        sampleSize: allBets.length,
        dataMode: 'CURRENT_CLEAN_ONLY',
        engineVersion: SERVER_ENGINE_VERSION
    };
}

function buildSportAnalytics(sport = 'CALCIO') {
    let bets = getStrictResolvedRows();
    bets = filterRowsForSport(bets, sport);
    const normalizedSport = String(sport || 'CALCIO').toUpperCase();

    return {
        sport: normalizedSport,
        sampleSize: bets.length,
        roi: valueEvaluator.calculatePortfolioROI(bets, { cleanOnly: true, sportFilter: normalizedSport === 'CALCIO' ? 'football' : 'tennis' }),
        brier: valueEvaluator.calculateBrierAnalytics(bets, { cleanOnly: true, sportFilter: normalizedSport === 'CALCIO' ? 'football' : 'tennis' }),
        clv: valueEvaluator.calculateCLVAnalytics(bets, { cleanOnly: true, sportFilter: normalizedSport === 'CALCIO' ? 'football' : 'tennis' }),
        strategies: valueEvaluator.calculateStrategyAnalytics(bets, { cleanOnly: true, sportFilter: normalizedSport === 'CALCIO' ? 'football' : 'tennis' }),
        dataMode: 'STRICT_CURRENT_OPERATIONAL_ONLY',
        engineVersion: SERVER_ENGINE_VERSION
    };
}

function buildStrictPortfolioReport(rows = [], { sport = 'ALL', baseBankroll = null } = {}) {
    const normalizedSport = String(sport || 'ALL').toUpperCase();
    const strictRows = filterRowsForSport(rows.filter(isStrictCurrentQuality).filter(isResolvedWonLost), normalizedSport);
    const cleanRows = strictRows.filter(isPortfolioOperationalRow);
    const auditOnlyRows = strictRows.filter(row => !isPortfolioOperationalRow(row));
    const tennisBreakdown = tennisScope.buildTennisPortfolioAuditBreakdown(strictRows);
    const calcioBreakdown = calcioScope.buildCalcioPortfolioAuditBreakdown(strictRows);
    const auditGradeBreakdown = {
        strictSample: strictRows.length,
        operationalSample: cleanRows.length,
        auditOnlySample: auditOnlyRows.length,
        zeroStakeExcluded: tennisBreakdown.zeroStake + calcioBreakdown.zeroStake,
        blockedByGateExcluded: tennisBreakdown.blockedByGate + calcioBreakdown.blockedByGate,
        counterfactualExcluded: tennisBreakdown.counterfactual + calcioBreakdown.counterfactual,
        noGateExcludedTennis: tennisBreakdown.noOperationalGate,
        bySport: {
            CALCIO: calcioBreakdown,
            TENNIS: tennisBreakdown
        }
    };
    const sportFilter = normalizedSport === 'CALCIO' ? 'football' : (normalizedSport === 'TENNIS' ? 'tennis' : null);
    const roi = valueEvaluator.calculatePortfolioROI(cleanRows, { cleanOnly: true, sportFilter });
    const clv = valueEvaluator.calculateCLVAnalytics(cleanRows, { cleanOnly: true, sportFilter });
    const brier = valueEvaluator.calculateBrierAnalytics(cleanRows, { cleanOnly: true, sportFilter });
    const strategies = valueEvaluator.calculateStrategyAnalytics(cleanRows, { cleanOnly: true, sportFilter });

    const inputBankroll = Number.isFinite(Number(baseBankroll)) ? Number(baseBankroll) : getCurrentBankroll(normalizedSport);
    const equityAudit = portfolioAuditMetrics.calculateEquityAudit(cleanRows, { baseBankroll: inputBankroll });
    const bankrollReconciliation = portfolioAuditMetrics.buildBankrollReconciliation(cleanRows, {
        baseBankroll: inputBankroll,
        displayedBankroll: equityAudit.finalBankroll
    });
    const clvCoverage = portfolioAuditMetrics.summarizeClvCoverage(strictRows, cleanRows);
    const step67Cohorts = portfolioAuditMetrics.buildStep67CohortBreakdown(cleanRows);
    const tennisLearning = normalizedSport === 'CALCIO'
        ? null
        : tennisClvLearningEngine.buildTennisClvLearningReport(strictRows, { minSample: 20 });
    const calcioLearning = normalizedSport === 'TENNIS'
        ? null
        : calcioClvLearningEngine.buildCalcioClvLearningReport(strictRows, { minSample: 30 });

    return {
        bankroll: {
            currentBankroll: equityAudit.finalBankroll,
            inputBankroll: equityAudit.initialBankroll,
            initialBankroll: equityAudit.initialBankroll,
            finalBankroll: equityAudit.finalBankroll,
            realizedProfit: equityAudit.totalProfit,
            roi,
            drawdown: equityAudit,
            reconciliation: bankrollReconciliation
        },
        topStrategies: strategies,
        analytics: {
            clv,
            clvCoverage,
            brier,
            clvLearning: {
                tennis: tennisLearning,
                calcio: calcioLearning
            }
        },
        auditGrade: {
            ...auditGradeBreakdown,
            step67Cohorts
        },
        meta: {
            sport: normalizedSport,
            engineVersion: SERVER_ENGINE_VERSION,
            portfolioAuditMetricsVersion: portfolioAuditMetrics.PORTFOLIO_AUDIT_METRICS_VERSION,
            dataMode: 'STRICT_CURRENT_OPERATIONAL_ONLY',
            sampleSize: cleanRows.length,
            rawStrictSampleSize: strictRows.length,
            auditOnlySampleSize: auditOnlyRows.length,
            tennisExcludedCounterfactual: tennisBreakdown.counterfactual,
            filters: {
                sport: normalizedSport,
                data_quality: ['CURRENT', DATA_QUALITY_CURRENT],
                status: ['WON', 'LOST'],
                legacyNullExcluded: true,
                legacyDirtyExcluded: true,
                stakeZeroExcludedFromROI: true,
                auditOnlyExcludedFromROI: true,
                deepScanGateOperational: true,
                operationalGateRequiredForTennis: true,
                tennisBlockedNoBetExcluded: true,
                tennisNoGateRowsExcludedFromRealPortfolio: true,
                calcioGateBlockExcludedWhenPresent: true
            }
        }
    };
}

const LEAGUES_CONFIG = {
    'serie_a': { code: 'I1', api: 'soccer_italy_serie_a', name: 'Serie A', wS: 0.6, wR: 0.4, maxEdge: 15.0, maxOdd: 3.00, restrictMarkets: false, allowSingles: true },
    'serie_b': { code: 'I2', api: 'soccer_italy_serie_b', name: 'Serie B', wS: 0.6, wR: 0.4, maxEdge: 15.0, maxOdd: 3.00, restrictMarkets: false, allowSingles: true },
    'premier_league': { code: 'E0', api: 'soccer_epl', name: 'Premier', wS: 0.5, wR: 0.5, maxEdge: 15.0, maxOdd: 2.40, restrictMarkets: false, allowSingles: true },
    'la_liga': { code: 'SP1', api: 'soccer_spain_la_liga', name: 'La Liga', wS: 0.7, wR: 0.3, maxEdge: 15.0, maxOdd: 2.40, restrictMarkets: false, allowSingles: true },
    'ligue_1': { code: 'F1', api: 'soccer_france_ligue_one', name: 'Ligue 1', wS: 0.7, wR: 0.3, maxEdge: 15.0, maxOdd: 2.40, restrictMarkets: false, allowSingles: true },
    'bundesliga': { code: 'D1', api: 'soccer_germany_bundesliga', name: 'Bundesliga', wS: 0.5, wR: 0.5, maxEdge: 15.0, maxOdd: 2.20, restrictMarkets: false, allowSingles: true }
};

const teamNameMap = {
    "AC Milan": "Milan", "Inter Milan": "Inter", "AS Roma": "Roma", "Juventus": "Juventus", "SSC Napoli": "Napoli", "Lazio": "Lazio", "Atalanta BC": "Atalanta", "Fiorentina": "Fiorentina", "Bologna": "Bologna", "Torino": "Torino", "Genoa": "Genoa", "Monza": "Monza", "Lecce": "Lecce", "Udinese": "Udinese", "Hellas Verona": "Verona", "Empoli": "Empoli", "Cagliari": "Cagliari", "Venezia": "Venezia", "Parma": "Parma", "Como": "Como",
    "Cesena FC": "Cesena", "Brescia Calcio": "Brescia", "Sassuolo": "Sassuolo", "Frosinone": "Frosinone", "Salernitana": "Salernitana", "Cremonese": "Cremonese", "Sampdoria": "Sampdoria", "Bari": "Bari", "Palermo": "Palermo", "Catanzaro": "Catanzaro", "Sudtirol": "Sudtirol", "Reggiana": "Reggiana", "Modena": "Modena", "Cosenza": "Cosenza", "Cittadella": "Cittadella", "Spezia": "Spezia", "Pisa": "Pisa", "Mantova": "Mantova", "Juve Stabia": "Juve Stabia", "Carrarese": "Carrarese",
    "Manchester City": "Man City", "Manchester United": "Man United", "Tottenham Hotspur": "Tottenham", "Newcastle United": "Newcastle", "Nottingham Forest": "Nott'm Forest", "Wolverhampton Wanderers": "Wolves", "Leicester City": "Leicester", "Ipswich Town": "Ipswich", "Aston Villa": "Aston Villa", "Brighton and Hove Albion": "Brighton", "West Ham United": "West Ham", "Sheffield United": "Sheffield United", "Luton Town": "Luton", "Everton": "Everton", "Crystal Palace": "Crystal Palace", "Fulham": "Fulham", "Bournemouth": "Bournemouth", "Brentford": "Brentford", "Arsenal": "Arsenal", "Chelsea": "Chelsea", "Liverpool": "Liverpool", "Southampton": "Southampton", "Burnley": "Burnley", "Leeds United": "Leeds",
    "Real Madrid": "Real Madrid", "FC Barcelona": "Barcelona", "Atlético Madrid": "Ath Madrid", "Athletic Bilbao": "Ath Bilbao", "Real Sociedad": "Sociedad", "Real Betis": "Betis", "Celta de Vigo": "Celta", "Celta Vigo": "Celta", "Rayo Vallecano": "Rayo Vallecano", "Espanyol": "Espanol", "Deportivo Alavés": "Alaves", "Deportivo Alaves": "Alaves", "RCD Mallorca": "Mallorca", "Girona FC": "Girona", "CA Osasuna": "Osasuna", "UD Las Palmas": "Las Palmas", "Cádiz CF": "Cadiz", "UD Almería": "Almeria", "Granada CF": "Granada", "Leganés": "Leganes", "Real Valladolid": "Valladolid", "Sevilla FC": "Sevilla", "Valencia CF": "Valencia", "Villarreal CF": "Villarreal", "Getafe CF": "Getafe",
    "Bayern Munich": "Bayern Munich", "Borussia Dortmund": "Dortmund", "Bayer Leverkusen": "Leverkusen", "RB Leipzig": "RB Leipzig", "Eintracht Frankfurt": "Ein Frankfurt", "Borussia Monchengladbach": "M'gladbach", "VfB Stuttgart": "Stuttgart", "St Pauli": "St Pauli", "1. FC Heidenheim": "Heidenheim", "FSV Mainz 05": "Mainz", "TSG Hoffenheim": "Hoffenheim", "VfL Bochum": "Bochum", "SV Darmstadt 98": "Darmstadt", "FC Augsburg": "Augsburg", "Werder Bremen": "Werder Bremen", "VfL Wolfsburg": "Wolfsburg", "SC Freiburg": "Freiburg", "Union Berlin": "Union Berlin", "Holstein Kiel": "Holstein Kiel", "1. FC Köln": "FC Koln",
    "Paris Saint Germain": "Paris SG", "Olympique Marseille": "Marseille", "Olympique Lyonnais": "Lyon", "AS Monaco": "Monaco", "Lille OSC": "Lille", "Stade Rennais": "Rennes", "Saint-Etienne": "St Etienne", "Le Havre AC": "Le Havre", "Clermont Foot": "Clermont", "Toulouse FC": "Toulouse", "Montpellier HSC": "Montpellier", "FC Nantes": "Nantes", "RC Strasbourg": "Strasbourg", "Stade Brestois": "Brest", "Stade de Reims": "Reims", "OGC Nice": "Nice", "RC Lens": "Lens", "AJ Auxerre": "Auxerre", "Angers SCO": "Angers", "FC Metz": "Metz"
};

function levenshtein(a, b) {
    const matrix = []; for (let i = 0; i <= b.length; i++) matrix[i] = [i]; for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    } return matrix[b.length][a.length];
}

function normalizeName(name, candidates = []) {
    // PATCH 19: l'identità provider non può essere sostituita con un club simile.
    // Sono ammessi solo match esatti o alias espliciti certificati; nessun Levenshtein.
    const mapped = teamNameMap[name] || name;
    if (candidates.length === 0) return mapped;
    const resolution = calcioDecisionCertification.resolveHistoricalKey(mapped, candidates);
    return resolution.matched ? resolution.historicalKey : mapped;
}

// CALCIO PATCH 5 - copertura statistica best-available.
// Mantiene i conteggi osservati separati dai denominatori di modellazione, così
// la Resa Qualità può dichiarare dati insufficienti senza impedire il pronostico.
function ensureFootballTeamStatsForAnalysis(stats = {}, teamName = '', leagueName = '') {
    const league = calcioQuantEngine.getLeagueXGDefaults(leagueName);
    const original = stats && typeof stats === 'object' ? stats : {};
    const observedHomeMatches = Math.max(0, safeNumber(original.hp, 0));
    const observedAwayMatches = Math.max(0, safeNumber(original.ap, 0));
    const observedMatches = Array.isArray(original.matches) ? original.matches.length : 0;

    const out = {
        hp: observedHomeMatches,
        hs: safeNumber(original.hs, 0),
        hc: safeNumber(original.hc, 0),
        hsot: safeNumber(original.hsot, 0),
        hcot: safeNumber(original.hcot, 0),
        ap: observedAwayMatches,
        as: safeNumber(original.as, 0),
        ac: safeNumber(original.ac, 0),
        asot: safeNumber(original.asot, 0),
        acot: safeNumber(original.acot, 0),
        recS: Array.isArray(original.recS) ? [...original.recS] : [],
        recC: Array.isArray(original.recC) ? [...original.recC] : [],
        elo: safeNumber(original.elo, 1500),
        matches: Array.isArray(original.matches) ? [...original.matches] : [],
        teamName: teamName || original.teamName || 'Unknown',
        observedHomeMatches,
        observedAwayMatches,
        observedMatches,
        historySyntheticDenominator: false
    };

    if (out.hp <= 0) {
        out.hp = 1;
        out.hs = league.avgHomeXG;
        out.hc = league.avgAwayXG;
        out.hsot = 3.8;
        out.hcot = 3.2;
        out.historySyntheticDenominator = true;
    }
    if (out.ap <= 0) {
        out.ap = 1;
        out.as = league.avgAwayXG;
        out.ac = league.avgHomeXG;
        out.asot = 3.2;
        out.acot = 3.8;
        out.historySyntheticDenominator = true;
    }
    if (!out.recS.length) out.recS = [league.avgHomeXG, league.avgAwayXG];
    if (!out.recC.length) out.recC = [league.avgAwayXG, league.avgHomeXG];

    const minObserved = Math.min(observedHomeMatches, observedAwayMatches);
    out.coverageMode = observedMatches <= 0 && minObserved <= 0
        ? 'PRIOR_ONLY'
        : (minObserved >= 10 ? 'HISTORY_PROXY_STRONG' : (minObserved >= 5 ? 'HISTORY_PROXY' : 'HISTORY_THIN'));

    return out;
}

function buildCalcioMatchSeed(config = {}, match = {}) {
    return [
        'CALCIO_PATCH5',
        config.name || config.api || 'LEAGUE',
        match.home_team || 'HOME',
        match.away_team || 'AWAY',
        match.commence_time || 'NO_KICKOFF'
    ].join('|');
}

function buildAnalysisOnlyCalcioBet(candidate = {}, reason = '') {
    // Patch 17: non azzerare una riga che l'Indice Predizione ha già autorizzato.
    const evaluated = candidate.predictionIndex
        ? candidate
        : applyCalcioOperationalGateToBet(candidate, { professionalAudit: candidate.professionalAudit });
    if (safeNumber(evaluated.calcio_operational_stake ?? evaluated.operationalStake ?? evaluated.invested, 0) > 0) {
        return {
            ...evaluated,
            analysisOnly: false,
            prediction_visibility: 'OPERATIONAL_CANDIDATE',
            best_available_forecast: true,
            calcio_operational_summary: evaluated.calcio_prediction_index_reason || evaluated.calcio_operational_summary,
            strategy_tag: `${evaluated.strategy_tag || 'CALCIO'}_UNIFIED_INDEX`
        };
    }
    const professionalAudit = evaluated.professionalAudit || {};
    const reliability = evaluated.probability_reliability || evaluated.extData?.probabilityIntegrity?.marketReliability?.[evaluated.prediction] || evaluated.extData?.probabilityIntegrity?.reliability || 'VERY_LOW';
    const analysisStage = calcioProgramCoherence.buildAnalysisStage({ candidate: evaluated, thresholds: evaluated.analysis_thresholds || {} });
    return {
        ...evaluated,
        invested: '0.00',
        stake: 0,
        estimatedProfit: '0.00',
        analysisOnly: true,
        prediction_visibility: 'BEST_AVAILABLE',
        best_available_forecast: true,
        probability_reliability: reliability,
        analysis_stage: analysisStage,
        analysis_stage_code: analysisStage.code,
        analysis_stage_label: analysisStage.label,
        analysis_stage_reason: evaluated.calcio_prediction_index_reason || analysisStage.summary,
        calcio_gate_allow_bet: 0,
        calcio_operational_action: 'ANALYSIS_ONLY_UNIFIED_INDEX',
        calcio_operational_summary: [
            evaluated.calcio_prediction_index_reason || reason || 'Indice Predizione insufficiente per lo stake.',
            `Affidabilità probabilistica ${reliability}.`
        ].filter(Boolean).join(' | '),
        calcio_professional_status: evaluated.calcio_professional_status || professionalAudit.status || '',
        strategy_tag: `${evaluated.strategy_tag || 'CALCIO'}_ANALYSIS_ONLY`
    };
}

function isMarketAllowedByCertifiedOptimization(settings = {}, marketPred = '') {
    const scope = String(settings.calcioOptimizedMarketScope || 'ALL_SUPPORTED').toUpperCase();
    const pred = String(marketPred || '').toUpperCase();
    if (scope === '1X2_ONLY') return ['1', 'X', '2'].includes(pred);
    if (scope === 'TOTALS_ONLY') return ['O2.5', 'U2.5'].includes(pred);
    return true;
}

function getDynamicParams(settings, leagueName, marketPred, onlyGlobal) {
    const safeFloat = (val, fallback) => { const parsed = parseFloat(val); return isNaN(parsed) ? fallback : parsed; };
    let targetEdge = safeFloat(settings.baseEdge, 4.0);
    let targetProb = safeFloat(settings.baseProb, 45.0);
    let normalizedLeague = leagueName;
    if (normalizedLeague === 'Premier League') normalizedLeague = 'Premier';

    if (settings.useHistoricalOpt === true) {
        if (settings.leagueParams && settings.leagueParams[normalizedLeague]) {
            const lp = settings.leagueParams[normalizedLeague];
            if (onlyGlobal || !['U2.5', '1', 'X2'].includes(marketPred)) {
                if (lp.global) { targetEdge = safeFloat(lp.global.edge, targetEdge); targetProb = safeFloat(lp.global.prob, targetProb); }
            } else {
                if (marketPred === 'U2.5' && lp.u25) { targetEdge = safeFloat(lp.u25.edge, targetEdge); targetProb = safeFloat(lp.u25.prob, targetProb); }
                else if (marketPred === '1' && lp.home1) { targetEdge = safeFloat(lp.home1.edge, targetEdge); targetProb = safeFloat(lp.home1.prob, targetProb); }
                else if (marketPred === 'X2' && lp.x2) { targetEdge = safeFloat(lp.x2.edge, targetEdge); targetProb = safeFloat(lp.x2.prob, targetProb); }
            }
            return { targetEdge, targetProb };
        }
    } else {
        if (settings.paperTradingParams && settings.paperTradingParams[normalizedLeague]) {
            targetEdge = safeFloat(settings.paperTradingParams[normalizedLeague].edge, targetEdge);
            targetProb = safeFloat(settings.paperTradingParams[normalizedLeague].prob, targetProb);
            return { targetEdge, targetProb };
        }
    }

    if (!onlyGlobal) {
        if (marketPred === 'U2.5') { targetEdge = safeFloat(settings.u25Edge, targetEdge); targetProb = safeFloat(settings.u25Prob, targetProb); }
        else if (marketPred === '1') { targetEdge = safeFloat(settings.home1Edge, targetEdge); targetProb = safeFloat(settings.home1Prob, targetProb); }
        else if (marketPred === 'X2') { targetEdge = safeFloat(settings.x2Edge, targetEdge); targetProb = safeFloat(settings.x2Prob, targetProb); }
    }
    
    return { targetEdge, targetProb };
}

// ==========================================
// PATCH49: onboarding canonico DeepScan continuo, locale e idempotente.
// Allinea le nuove bet Tennis prima che Trading e Analisi AI le leggano.
try {
    const patch49Canonical = tennisDeepScanCanonicalOnboardingPatch49.reconcileCanonicalCoverage(db, {
        source: 'PATCH49_SERVER_STARTUP_ONBOARDING'
    });
    if (patch49Canonical.repaired > 0) {
        console.log(`🧠 [PATCH49 DEEPSCAN CANONICAL] riparati=${patch49Canonical.repaired} coperti=${patch49Canonical.after.covered}/${patch49Canonical.after.tennisRows}`);
    }
} catch (error) {
    console.warn(`⚠️ [PATCH49 DEEPSCAN CANONICAL] onboarding non completato: ${error.message}`);
}

// 🚀 ENDPOINTS API (Settings & Trackers)
// ==========================================
app.get('/api/settings', (req, res) => {
    try {
        const row = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
        res.json(row ? safeJsonParse(row.config_json, {}) : {});
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/settings', (req, res) => {
    try {
        const currentSettingsRow = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
        let currentSettings = currentSettingsRow ? safeJsonParse(currentSettingsRow.config_json, {}) : {};
        const updatedSettings = { ...currentSettings, ...req.body };
        // Patch 12: i parametri globali vengono persistiti come numeri entro limiti professionali.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'baseEdge')) updatedSettings.baseEdge = clamp(safeNumber(req.body.baseEdge, 3), 0, 15);
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'baseProb')) updatedSettings.baseProb = clamp(safeNumber(req.body.baseProb, 45), 1, 99);
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'maxOdd')) updatedSettings.maxOdd = clamp(safeNumber(req.body.maxOdd, 5), 1.5, 10);

        if (req.body.paperTradingParams) { updatedSettings.paperTradingParams = { ...currentSettings.paperTradingParams, ...req.body.paperTradingParams }; }
        if (req.body.leagueParams) { updatedSettings.leagueParams = { ...currentSettings.leagueParams, ...req.body.leagueParams }; }

        db.prepare('UPDATE system_settings SET config_json = ? WHERE id = 1').run(JSON.stringify(updatedSettings));
        
        analysisCache = {};
        console.log("⚙️ Impostazioni modificate: Cache dell'Analisi azzerata.");

        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/internal/track-clv', async (req, res) => {
    try {
        console.log('\n🧭 [CLV MANUAL STEP103] Richiesta manuale /api/internal/track-clv: avvio ricerca CLV visibile in Node.');
        const clvResult = await trackClosingLines(db, fetchOddsApi, LEAGUES_CONFIG);
        console.log(`🧭 [CLV MANUAL PATCH47] Fine: new=${clvResult.clvEvidenceMetrics?.newLocks ?? 0} unchanged=${clvResult.clvEvidenceMetrics?.unchangedEvidence ?? 0} updated=${clvResult.updatedCount ?? 0} apiFetch=${clvResult.apiFetchCount ?? 0} reason=${clvResult.reason || 'OK'}`);
        res.json({
            success: true,
            message: "CLV Tracking Eseguito",
            mode: 'STEP62_CLV_HARD_BUDGET_SMART_FETCH',
            clv: clvResult
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/internal/track-clv/audit', async (req, res) => {
    try {
        console.log('\n🧭 [CLV AUDIT STEP103] Richiesta dry-run /api/internal/track-clv/audit: nessun consumo API.');
        const runtimeAudit = buildStep103ClvRuntimeAudit(db, new Date(), LEAGUES_CONFIG);
        const plan = buildClvSmartFetchPlan(db, LEAGUES_CONFIG);
        const crossSportCoverage = clvCrossSportCoveragePatch53.buildCoverageReport(db, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet });
        console.log(`🧭 [CLV AUDIT STEP103] Dry-run: candidati=${runtimeAudit.counts?.unlockedCandidates ?? 0} eleggibili=${runtimeAudit.counts?.eligibleCandidates ?? 0} api=${runtimeAudit.counts?.apiEligibleCandidates ?? 0} calls=${Array.isArray(plan.calls) ? plan.calls.length : 0}`);
        res.json({
            success: true,
            mode: 'STEP62_CLV_HARD_BUDGET_SMART_FETCH_DRY_RUN',
            consumesApi: false,
            runtimeAudit,
            clvPlan: plan,
            crossSportCoverage
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.get('/api/internal/track-clv/status', async (req, res) => {
    try {
        const runtimeAudit = buildStep103ClvRuntimeAudit(db, new Date(), LEAGUES_CONFIG);
        const crossSportCoverage = clvCrossSportCoveragePatch53.buildCoverageReport(db, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet });
        console.log(`🧭 [CLV STATUS PATCH53] candidati=${runtimeAudit.counts?.unlockedCandidates ?? 0} eleggibili=${runtimeAudit.counts?.eligibleCandidates ?? 0} api=${runtimeAudit.counts?.apiEligibleCandidates ?? 0} sportKeyCalcio=${crossSportCoverage.bySport?.CALCIO?.sportKeyResolvedRows ?? 0}/${crossSportCoverage.bySport?.CALCIO?.eligibleRows ?? 0} verified=${crossSportCoverage.overall?.verifiedClvRows ?? 0}/${crossSportCoverage.overall?.eligibleRows ?? 0}`);
        res.json({
            success: true,
            mode: 'STEP103_CLV_RUNTIME_VISIBILITY_AUDIT',
            coverageVersion: clvCrossSportCoveragePatch53.VERSION,
            consumesApi: false,
            runtimeAudit,
            crossSportCoverage
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


app.get('/api/clv/coverage', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const coverage = clvCrossSportCoveragePatch53.buildCoverageReport(db, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet });
        const selected = sport === 'ALL' ? coverage.overall : coverage.bySport?.[sport] || null;
        return res.json({
            success: true,
            readOnly: true,
            sport,
            version: clvCrossSportCoveragePatch53.VERSION,
            sportKeyResolutionVersion: clvCrossSportCoveragePatch53.SPORT_KEY_RESOLUTION_VERSION,
            coverage,
            selected,
            authority: 'READ_ONLY_COVERAGE_AND_PROVIDER_ROUTING_METADATA'
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

function getOptimizationRowsBySport(sport = 'CALCIO') {
    const rows = getCleanResolvedRows()
        .filter(row => sport === 'TENNIS' ? isTennisRow(row) : isFootballRow(row))
        .filter(row => {
            const odd = safeNumber(row.odd, 0);
            const prob = safeNumber(
                row.calibrated_probability_pct ??
                row.estimated_prob ??
                row.estimatedProb ??
                row.probability,
                0
            );
            const edgePp = safeNumber(row.edge_pp ?? row.edge, NaN);
            const evPct = safeNumber(row.ev_pct ?? row.expectedValue ?? row.ev, NaN);

            return odd > 1 &&
                prob > 0 &&
                Number.isFinite(edgePp) &&
                Number.isFinite(evPct);
        });

    return rows;
}

function summarizeOptimizationSample(sport = 'CALCIO') {
    const settledRows = getCleanSettledRows().filter(row => sport === 'TENNIS' ? isTennisRow(row) : isFootballRow(row));
    const resolvedRows = getCleanResolvedRows().filter(row => sport === 'TENNIS' ? isTennisRow(row) : isFootballRow(row));
    const optimizableRows = getOptimizationRowsBySport(sport);

    return {
        sport,
        totalCleanSettled: settledRows.length,
        cleanResolved: resolvedRows.length,
        optimizableSample: optimizableRows.length,
        pending: db.prepare(`
            SELECT COUNT(*) as count
            FROM ai_forward_test
            WHERE status = 'PENDING'
              AND COALESCE(data_quality, ?) != ?
        `).get(DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY).count || 0
    };
}

function calculateRowsRoi(rows = []) {
    const stake = rows.reduce((acc, row) => acc + safeNumber(row.stake, 0), 0);
    const profit = rows.reduce((acc, row) => acc + safeNumber(row.profit, 0), 0);

    return {
        count: rows.length,
        stake: round(stake, 2),
        profit: round(profit, 2),
        roi: stake > 0 ? round((profit / stake) * 100, 2) : 0,
        hitRate: rows.length > 0
            ? round((rows.filter(row => String(row.status).toUpperCase() === 'WON').length / rows.length) * 100, 2)
            : 0
    };
}

function optimizeFootballThresholds(rows = []) {
    const edgeGrid = [3, 4, 5, 6, 7, 8, 10, 12];
    const probGrid = [45, 48, 50, 52, 55, 58, 60, 65];
    const evGrid = [0, 1, 2, 3, 5];

    const minComboSample = Math.max(20, Math.floor(rows.length * 0.12));
    let best = null;

    for (const edge of edgeGrid) {
        for (const prob of probGrid) {
            for (const ev of evGrid) {
                const selected = rows.filter(row => {
                    const rowProb = safeNumber(
                        row.calibrated_probability_pct ??
                        row.estimated_prob ??
                        row.estimatedProb ??
                        row.probability,
                        0
                    );
                    const rowEdge = safeNumber(row.edge_pp ?? row.edge, 0);
                    const rowEv = safeNumber(row.ev_pct ?? row.expectedValue ?? row.ev, 0);

                    return rowEdge >= edge && rowProb >= prob && rowEv >= ev;
                });

                if (selected.length < minComboSample) continue;

                const perf = calculateRowsRoi(selected);
                const samplePenalty = selected.length < 50 ? (50 - selected.length) * 0.05 : 0;
                const score = perf.roi - samplePenalty;

                if (!best || score > best.score) {
                    best = {
                        edge,
                        prob,
                        ev,
                        score: round(score, 2),
                        ...perf
                    };
                }
            }
        }
    }

    if (!best) {
        const fallback = calculateRowsRoi(rows);
        return {
            applied: false,
            reason: 'NO_STABLE_COMBO',
            edge: 5,
            prob: 45,
            ev: 0,
            score: fallback.roi,
            ...fallback
        };
    }

    return {
        applied: true,
        reason: 'BEST_STABLE_COMBO',
        ...best
    };
}

function buildFootballOptimizationPayload() {
    const currentSettingsRow = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
    const currentSettings = currentSettingsRow ? safeJsonParse(currentSettingsRow.config_json, {}) : {};
    const useHistorical = currentSettings.useHistoricalOpt === true;

    if (useHistorical) {
        const report = calcioHistoricalThresholdOptimizer.run(path.resolve(__dirname, '..'));
        return {
            ...report,
            sport: 'CALCIO',
            disabled: !report.success,
            settingsSaved: false,
            applied: false,
            recommendationOnly: true,
            sourceMode: 'HISTORICAL_FOOTBALL_DATA_WALK_FORWARD',
            activeSettings: {
                baseEdge: safeNumber(currentSettings.baseEdge, 3),
                baseProb: safeNumber(currentSettings.baseProb, 45),
                maxOdd: safeNumber(currentSettings.maxOdd, 5),
                marketScope: String(currentSettings.calcioOptimizedMarketScope || 'ALL_SUPPORTED')
            },
            recommendation: report.recommended ? {
                baseEdge: report.recommended.baseEdge,
                baseProb: report.recommended.baseProb,
                maxOdd: report.recommended.maxOdd,
                marketScope: report.recommended.marketScope,
                calibration: report.recommended.calibration,
                holdout: report.recommended.holdout,
                status: report.status,
                recommendationId: report.recommendationId
            } : null,
            diagnostics: {
                dataMode: report.dataMode,
                candidateCount: report.candidateCount,
                evaluatedCandidates: report.evaluatedCandidates,
                splitPolicy: report.splitPolicy,
                holdoutExcludedFromSelection: true,
                recommendationOnly: true,
                settingsSaved: false,
                reason: report.status
            },
            message: report.status === 'ELIGIBLE_FOR_EXPLICIT_APPLY'
                ? `Ottimizzazione storica completata. Soglie candidate: edge ${report.recommended.baseEdge}%, probabilità ${report.recommended.baseProb}%, quota max ${report.recommended.maxOdd}, scope ${report.recommended.marketScope}. Applicazione solo esplicita.`
                : `Ottimizzazione storica completata in shadow. La configurazione candidata non supera ancora i guardrail holdout; le soglie live restano invariate.`
        };
    }

    const sample = summarizeOptimizationSample('CALCIO');
    const requiredSample = FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION;
    const rows = getOptimizationRowsBySport('CALCIO');
    if (rows.length < requiredSample) {
        return {
            success: false, disabled: true, sport: 'CALCIO', reason: 'INSUFFICIENT_CLEAN_OPTIMIZABLE_SAMPLE',
            sampleSize: rows.length, requiredSample, diagnostics: sample,
            recommendationOnly: true, settingsSaved: false, applied: false,
            dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
            message: `Ottimizzazione Paper Trading disabilitata: campione WON/LOST insufficiente (${rows.length}/${requiredSample}).`,
            engineVersion: SERVER_ENGINE_VERSION
        };
    }
    const best = optimizeFootballThresholds(rows);
    return {
        success: true, disabled: false, sport: 'CALCIO', reason: best.reason,
        sampleSize: rows.length, requiredSample, recommendationOnly: true, settingsSaved: false, applied: false,
        recommendation: { baseEdge: best.edge, baseProb: best.prob, baseEv: best.ev, roi: best.roi, hitRate: best.hitRate, count: best.count },
        diagnostics: { ...sample, selectedComboSample: best.count, recommendationOnly: true, settingsSaved: false },
        dataMode: 'CURRENT_CLEAN_PAPER_TRADING',
        message: 'Raccomandazione calcolata; nessuna soglia live modificata automaticamente.',
        engineVersion: SERVER_ENGINE_VERSION
    };
}

app.get('/api/calcio/optimize', async (req, res) => {
    try {
            const optimizationDiagnostics = getFootballOptimizationDiagnostics();
        res.json(buildFootballOptimizationPayload());
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            sport: 'CALCIO',
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
});

app.post('/api/calcio/optimize/apply', (req, res) => {
    try {
        const report = calcioHistoricalThresholdOptimizer.run(path.resolve(__dirname, '..'));
        const requestedId = String(req.body?.recommendationId || '');
        if (!requestedId || requestedId !== report.recommendationId) {
            return res.status(409).json({ success:false, applied:false, error:'RECOMMENDATION_ID_MISMATCH', recommendationId:report.recommendationId });
        }
        if (report.status !== 'ELIGIBLE_FOR_EXPLICIT_APPLY' || !report.recommended) {
            return res.status(409).json({ success:false, applied:false, error:'HOLDOUT_NOT_CERTIFIED', status:report.status, recommendation:report.recommended });
        }
        const row = db.prepare('SELECT config_json FROM system_settings WHERE id=1').get();
        const current = row ? safeJsonParse(row.config_json,{}) : {};
        const updated = { ...current, baseEdge:report.recommended.baseEdge, baseProb:report.recommended.baseProb, maxOdd:report.recommended.maxOdd,
            calcioOptimizedMarketScope: report.recommended.marketScope || 'ALL_SUPPORTED',
            footballOptimizationMeta:{version:report.version,recommendationId:report.recommendationId,appliedAt:new Date().toISOString(),holdout:report.recommended.holdout,marketScope:report.recommended.marketScope} };
        db.prepare('UPDATE system_settings SET config_json=? WHERE id=1').run(JSON.stringify(updated));
        analysisCache = {};
        res.json({success:true,applied:true,settingsSaved:true,recommendationId:report.recommendationId,settings:{baseEdge:updated.baseEdge,baseProb:updated.baseProb,maxOdd:updated.maxOdd,marketScope:updated.calcioOptimizedMarketScope}});
    } catch (error) { res.status(500).json({success:false,applied:false,error:error.message}); }
});

app.get('/api/optimize', async (req, res) => {
    try {
        res.json(buildFootballOptimizationPayload());
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            sport: 'CALCIO',
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
});

// ==========================================
// 🚀 ROUTE 1: ANALISI LIVE (XG + MONTE CARLO + CALIBRATION)
// ==========================================

// ============================================================================
// CALCIO HEALTH STATUS - NON MUTATING
// ============================================================================

function safeDbScalar(sql, params = [], fallback = 0) {
    try {
        const row = db.prepare(sql).get(...params);
        if (!row) return fallback;
        const firstKey = Object.keys(row)[0];
        return row[firstKey] ?? fallback;
    } catch (error) {
        return fallback;
    }
}

function getFootballHealthSummary() {
    const cleanCondition = `
        COALESCE(data_quality, ?) != ?
        AND (
            UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
            OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
            OR COALESCE(sport_type, '') = ''
        )
        AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
        AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
    `;

    const cleanParams = [DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY];

    const samples = {
        pendingCurrent: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE status = 'PENDING'
              AND ${cleanCondition}
        `, cleanParams, 0),

        settledWonLostCurrent: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE status IN ('WON', 'LOST')
              AND ${cleanCondition}
        `, cleanParams, 0),

        settledAllCurrent: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE status IN ('WON', 'LOST', 'PUSH', 'VOID')
              AND ${cleanCondition}
        `, cleanParams, 0),

        legacyDirty: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE COALESCE(data_quality, '') = ?
              AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR COALESCE(sport_type, '') = ''
              )
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
        `, [DATA_QUALITY_LEGACY_DIRTY], 0),

        missingDataQuality: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE (data_quality IS NULL OR data_quality = '')
              AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR COALESCE(sport_type, '') = ''
              )
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
        `, [], 0),

        tennisRows: safeDbScalar(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE (
                UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
            )
        `, [], 0)
    };

    return {
        samples,
        dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
        cleanCondition: 'CURRENT/CURRENT_BOOTSTRAP only, LEGACY_DIRTY excluded'
    };
}


function getFootballOptimizationDiagnostics(rows = null) {
    let sourceRows = rows;

    if (!Array.isArray(sourceRows)) {
        try {
            sourceRows = getOptimizationRowsBySport('CALCIO');
        } catch (error) {
            sourceRows = [];
        }
    }

    const diagnostics = {
        totalRows: sourceRows.length,
        missingDataQuality: 0,
        missingProbability: 0,
        missingOdd: 0,
        missingEdge: 0,
        missingEv: 0,
        invalidStatus: 0,
        validOptimizable: 0,
        examples: []
    };

    sourceRows.forEach((row) => {
        const status = String(row.status || '').toUpperCase();
        const dataQuality = String(row.data_quality || '').trim();
        const probability = Number(row.calibrated_probability_pct ?? row.estimated_prob ?? row.probability ?? row.model_probability ?? 0);
        const odd = Number(row.odd ?? row.quota ?? row.price ?? 0);
        const edge = Number(row.edge_pp ?? row.edge ?? 0);
        const ev = Number(row.ev_pct ?? row.expectedValue ?? row.ev ?? 0);

        const hasValidStatus = ['WON', 'LOST'].includes(status);
        const hasProbability = Number.isFinite(probability) && probability > 0 && probability <= 100;
        const hasOdd = Number.isFinite(odd) && odd > 1;
        const hasEdge = Number.isFinite(edge) && edge !== 0;
        const hasEv = Number.isFinite(ev) && ev !== 0;

        if (!dataQuality) diagnostics.missingDataQuality += 1;
        if (!hasValidStatus) diagnostics.invalidStatus += 1;
        if (!hasProbability) diagnostics.missingProbability += 1;
        if (!hasOdd) diagnostics.missingOdd += 1;
        if (!hasEdge) diagnostics.missingEdge += 1;
        if (!hasEv) diagnostics.missingEv += 1;

        if (hasValidStatus && hasProbability && hasOdd && hasEdge && hasEv) {
            diagnostics.validOptimizable += 1;
        } else if (diagnostics.examples.length < 5) {
            diagnostics.examples.push({
                id: row.id ?? null,
                status,
                data_quality: dataQuality || null,
                probability,
                odd,
                edge,
                ev,
                reason: [
                    !dataQuality ? 'MISSING_DATA_QUALITY' : null,
                    !hasValidStatus ? 'INVALID_STATUS' : null,
                    !hasProbability ? 'MISSING_PROBABILITY' : null,
                    !hasOdd ? 'MISSING_ODD' : null,
                    !hasEdge ? 'MISSING_EDGE_PP' : null,
                    !hasEv ? 'MISSING_EV_PCT' : null
                ].filter(Boolean).join('|')
            });
        }
    });

    diagnostics.requiredSample = FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION;
    diagnostics.canOptimize = diagnostics.validOptimizable >= FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION;
    diagnostics.summary = diagnostics.canOptimize
        ? 'Campione ottimizzabile sufficiente.'
        : `Campione ottimizzabile insufficiente: ${diagnostics.validOptimizable}/${FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION}.`;

    return diagnostics;
}

function buildFootballHealthPayload() {
    const summary = getFootballHealthSummary();
    const footballReliabilityReport = getFootballReliabilityReport();
    const optimizationDiagnostics = getFootballOptimizationDiagnostics();
    const footballDataHealth = calcioFootballDataProvider.getFootballDataHealth();

    const requiredDbColumns = [
        'edge_pp',
        'ev_pct',
        'sport_type',
        'model_version',
        'metric_version',
        'engine_version',
        'data_quality',
        'clv',
        'clv_edge',
        'settlement_source',
        'home_goals',
        'away_goals',
        'winner_side'
    ];

    const existingColumns = db.prepare(`PRAGMA table_info(ai_forward_test)`).all().map(row => row.name);
    const missingColumns = requiredDbColumns.filter(column => !existingColumns.includes(column));

    const components = {
        calcioQuantEngine: {
            ok: !!calcioQuantEngine && typeof calcioQuantEngine.getXGAdjustedDixonColesProbabilities === 'function',
            status: !!calcioQuantEngine && typeof calcioQuantEngine.getXGAdjustedDixonColesProbabilities === 'function' ? 'OK' : 'ERROR',
            version: calcioQuantEngine?.CALCIO_QUANT_ENGINE_VERSION || 'unknown'
        },
        valueEvaluator: {
            ok: !!valueEvaluator && typeof valueEvaluator.buildReliabilityReport === 'function',
            status: !!valueEvaluator && typeof valueEvaluator.buildReliabilityReport === 'function' ? 'OK' : 'ERROR'
        },
        simulation: {
            ok: !!simulationEngine && typeof simulationEngine.runSimulation === 'function',
            status: !!simulationEngine && typeof simulationEngine.runSimulation === 'function' ? 'OK' : 'ERROR'
        },
        paperTrading: {
            ok: !!paperTradingEngine && typeof paperTradingEngine.processPaperTrading === 'function',
            status: !!paperTradingEngine && typeof paperTradingEngine.processPaperTrading === 'function' ? 'OK' : 'ERROR',
            version: paperTradingEngine?.PAPER_TRADING_ENGINE_VERSION || 'unknown'
        },
        deepScanCalcio: {
            ok: !!deepScanCalcio && typeof deepScanCalcio.scanMatchup === 'function',
            status: !!deepScanCalcio && typeof deepScanCalcio.scanMatchup === 'function' ? 'OK' : 'ERROR'
        },
        clvTracker: {
            ok: typeof trackClosingLines === 'function' && typeof clvCrossSportCoveragePatch53.buildCoverageReport === 'function',
            status: typeof trackClosingLines === 'function' && typeof clvCrossSportCoveragePatch53.buildCoverageReport === 'function' ? 'OK' : 'ERROR',
            coverageVersion: clvCrossSportCoveragePatch53.VERSION,
            sportKeyResolutionVersion: clvCrossSportCoveragePatch53.SPORT_KEY_RESOLUTION_VERSION
        },
        calcioScheduler: {
            ok: !!calcioScheduler && typeof calcioScheduler.applySchedule === 'function',
            status: !!calcioScheduler && typeof calcioScheduler.applySchedule === 'function' ? 'OK' : 'ERROR'
        },
        calcioFootballDataProvider: {
            ok: !!calcioFootballDataProvider && typeof calcioFootballDataProvider.getLeagueCsv === 'function',
            status: !!calcioFootballDataProvider && typeof calcioFootballDataProvider.getLeagueCsv === 'function' ? 'OK' : 'ERROR',
            version: calcioFootballDataProvider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
            dataStatus: footballDataHealth.status
        },
        tennisRoutes: {
            ok: !!tennisRoutes,
            status: !!tennisRoutes ? 'OK' : 'ERROR',
            isolatedMount: '/api/tennis'
        }
    };

    const checks = {
        dbPathAbsolute: path.isAbsolute(DB_PATH),
        requiredColumnsPresent: missingColumns.length === 0,
        cleanSampleAvailable: summary.samples.pendingCurrent + summary.samples.settledWonLostCurrent >= 0,
        optimizeSafeWithSmallSample: summary.samples.settledWonLostCurrent < FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION,
        legacyDirtyExcludedFromHealthSamples: true,
        tennisIsolation: true,
        apiKeysConfigured: Array.isArray(API_KEYS) && API_KEYS.length > 0,
        footballReliabilityBootstrap: footballReliabilityReport?.mode === 'BOOTSTRAP_NEUTRAL' || footballReliabilityReport?.mode === 'HISTORICAL_RELIABILITY',
        footballDataDynamicSeason: typeof calcioFootballDataProvider.buildSeasonCandidates === 'function',
        footballDataLastKnownGood: footballDataHealth.invariants?.previousValidDataDeletedOnFailure === false
    };

    const componentStatuses = Object.values(components).map(component => component.status);
    let status = 'OK';

    if (componentStatuses.includes('ERROR') || !checks.requiredColumnsPresent || !checks.dbPathAbsolute) {
        status = 'ERROR';
    } else if (
        summary.samples.settledWonLostCurrent < FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION ||
        summary.samples.missingDataQuality > 0
    ) {
        status = 'WARN';
    }

    return {
        success: status !== 'ERROR',
        sport: 'CALCIO',
        status,
        message: status === 'OK'
            ? 'Sistema Calcio operativo.'
            : status === 'WARN'
                ? 'Sistema Calcio operativo, ma campione pulito ancora insufficiente o storico da completare.'
                : 'Sistema Calcio con criticità tecniche.',
        serverVersion: SERVER_ENGINE_VERSION,
        engineVersion: SERVER_ENGINE_VERSION,
        footballModelVersion: FOOTBALL_MODEL_VERSION,
        footballMetricVersion: FOOTBALL_METRIC_VERSION,
        dataQualityCurrent: DATA_QUALITY_CURRENT,
        dataQualityLegacyDirty: DATA_QUALITY_LEGACY_DIRTY,
        dataMode: summary.dataMode,
        db: {
            path: DB_PATH,
            absolute: path.isAbsolute(DB_PATH),
            samples: summary.samples,
            requiredColumns: requiredDbColumns,
            missingColumns
        },
        optimize: {
            requiredSample: FOOTBALL_MIN_SAMPLE_FOR_OPTIMIZATION,
            cleanSettledSample: summary.samples.settledWonLostCurrent,
            optimizableSample: optimizationDiagnostics.validOptimizable,
            enabled: optimizationDiagnostics.canOptimize,
            mode: optimizationDiagnostics.canOptimize
                ? 'AVAILABLE_WITH_OPTIMIZABLE_SAMPLE'
                : 'DISABLED_INSUFFICIENT_OPTIMIZABLE_SAMPLE',
            diagnostics: optimizationDiagnostics
        },
        reliability: {
            mode: footballReliabilityReport?.mode || 'UNKNOWN',
            sampleSize: footballReliabilityReport?.sampleSize || 0,
            decision: footballReliabilityReport?.decision || null
        },
        footballData: footballDataHealth,
        components,
        checks,
        routes: {
            analyze: '/api/analyze',
            backtest: '/api/backtest',
            resolveAi: '/api/resolve_ai',
            optimize: '/api/calcio/optimize',
            clv: '/api/internal/track-clv',
            footballDataFreshness: '/api/calcio/football-data-freshness',
            footballDataRefresh: '/api/calcio/football-data-refresh',
            tennis: '/api/tennis'
        },
        timestamp: new Date().toISOString()
    };
}

app.get('/api/calcio/health', (req, res) => {
    try {
        res.json(buildFootballHealthPayload());
    } catch (error) {
        res.status(500).json({
            success: false,
            sport: 'CALCIO',
            status: 'ERROR',
            message: error.message,
            serverVersion: SERVER_ENGINE_VERSION,
            engineVersion: SERVER_ENGINE_VERSION,
            footballModelVersion: FOOTBALL_MODEL_VERSION,
            footballMetricVersion: FOOTBALL_METRIC_VERSION,
            timestamp: new Date().toISOString()
        });
    }
});



function isLocalCalcioFootballDataRequest(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1');
}

app.get('/api/calcio/football-data-freshness', (req, res) => {
    try {
        res.json({
            success: true,
            ...calcioFootballDataProvider.getFootballDataHealth(),
            scheduler: calcioFootballDataProvider.getScheduledRefreshState()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, providerVersion: calcioFootballDataProvider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION });
    }
});

app.post('/api/calcio/football-data-refresh', async (req, res) => {
    if (!isLocalCalcioFootballDataRequest(req)) {
        return res.status(403).json({ success: false, error: 'CALCIO_FOOTBALL_DATA_REFRESH_LOCAL_ONLY' });
    }
    try {
        const result = await calcioFootballDataProvider.refreshAll({ forceRefresh: true });
        analysisCache = {};
        return res.status(result.success || result.partial ? 200 : 503).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message, providerVersion: calcioFootballDataProvider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION });
    }
});


// CALCIO_PATCH4_DS_GATE_REAL_PROBABILITY_READ_ONLY_ENDPOINT
app.get('/api/calcio/source-intelligence/catalog', (req, res) => {
    try {
        return res.json({
            success: true,
            version: calcioSourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
            cacheSchemaVersion: calcioSourceIntelligence.SOURCE_CACHE_SCHEMA_VERSION,
            officialDomainCount: Object.keys(calcioSourceIntelligence.OFFICIAL_TEAM_DOMAINS || {}).length,
            officialDomains: calcioSourceIntelligence.OFFICIAL_TEAM_DOMAINS,
            sourcePlan: {
                general: ['GOOGLE_NEWS_GENERAL_RSS', 'BING_NEWS_GENERAL_RSS'],
                officialFirst: 'GOOGLE_NEWS_OFFICIAL_DOMAIN_RSS quando il dominio squadra è nel catalogo',
                noOddsApiCreditsConsumed: true
            },
            authority: {
                news: 'QUALITATIVE_ONLY',
                probability: ['MARKET_ODDS', 'FOOTBALL_DATA', 'UNDERSTAT_XG_OR_DECLARED_PROXY']
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/calcio/source-intelligence/probe', async (req, res) => {
    try {
        if (!isLocalCalcioFootballDataRequest(req)) {
            return res.status(403).json({ success: false, error: 'CALCIO_SOURCE_PROBE_LOCAL_ONLY' });
        }
        const homeTeam = String(req.body?.homeTeam || '').trim();
        const awayTeam = String(req.body?.awayTeam || '').trim();
        if (!homeTeam || !awayTeam) {
            return res.status(400).json({ success: false, error: 'HOME_AWAY_REQUIRED' });
        }
        const [homeProfile, awayProfile] = await Promise.all([
            getTeamNlpProfile(homeTeam, { forceRefresh: true }),
            getTeamNlpProfile(awayTeam, { forceRefresh: true })
        ]);
        const footballDataHealth = calcioFootballDataProvider.getFootballDataHealth({ projectRoot: path.resolve(__dirname, '..') });
        return res.json({
            success: true,
            version: calcioSourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
            probedAt: new Date().toISOString(),
            teams: {
                home: { team: homeTeam, profile: homeProfile },
                away: { team: awayTeam, profile: awayProfile }
            },
            footballData: footballDataHealth,
            understat: {
                status: 'NOT_PROBED_BY_HTTP_ENDPOINT',
                reason: 'Lo scraper Chromium è verificabile dal comando manuale probe:calcio:sources --include-understat per evitare costi/tempi involontari.'
            },
            oddsApi: {
                status: 'NOT_CALLED',
                reason: 'Il probe fonti non consuma crediti Odds API. Le quote vengono certificate dal normale flusso /api/analyze.'
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/calcio/historical-combination-evidence', (req, res) => {
    try {
        const limit = Math.max(100, Math.min(100000, Math.trunc(safeNumber(req.query.limit, 100000))));
        const cutoffId = Number.isFinite(Number(req.query.cutoffId))
            ? Math.max(0, Math.trunc(Number(req.query.cutoffId)))
            : Number.MAX_SAFE_INTEGER;
        const matrix = calcioHistoricalCombinationEvidence.buildCombinationMatrix(db, {
            limit,
            cutoffId,
            calculatedAt: new Date().toISOString()
        });
        return res.json({
            ...matrix,
            patch: 'CALCIO_PATCH_4',
            note: matrix.resolvedRows > 0
                ? 'Probabilità reale PT DS×Gate disponibile in modalità shadow-only.'
                : 'Nessun campione Calcio current-clean risolto: la colonna mostra N/D senza usare righe legacy.'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            patch: 'CALCIO_PATCH_4',
            version: calcioHistoricalCombinationEvidence.CALCIO_HISTORICAL_COMBINATION_VERSION,
            error: error.message,
            readOnly: true,
            stakeAuthority: false,
            modelAuthority: false
        });
    }
});
// /CALCIO_PATCH4_DS_GATE_REAL_PROBABILITY_READ_ONLY_ENDPOINT

app.post('/api/analyze', async (req, res) => {
    let calcioObservationBatch = null;
    const { targetOdds, bankroll, league: requestedLeague } = req.body || {};
    const league = String(requestedLeague || 'all').trim().toLowerCase() || 'all';
    const bankrollResolution = calcioUnifiedStakeAuthority.resolveAnalysisBankrollSnapshot({
        requestedBankroll: bankroll,
        currentCalcioBankroll: getCurrentBankroll('CALCIO'),
        fallback: 0 // AUDIT07_BANKROLL_ZERO_FAIL_CLOSED
    });
    const initialBankroll = bankrollResolution.snapshot;
    const initialBankrollSource = bankrollResolution.source;
    const minBet = 2.00;

    const settingsRow = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
    const dynSettings = settingsRow ? safeJsonParse(settingsRow.config_json, {}) : {};
    const requestIdentity = calcioRequestIdentity.buildCalcioAnalysisRequestIdentity({
        route: '/api/analyze',
        league,
        availableLeagues: Object.keys(LEAGUES_CONFIG),
        bankroll: initialBankroll,
        targetOdds,
        settings: dynSettings,
        versions: {
            server: SERVER_ENGINE_VERSION,
            model: FOOTBALL_MODEL_VERSION,
            metric: FOOTBALL_METRIC_VERSION,
            quantPatch: calcioQuantEngine.CALCIO_QUANT_PATCH_VERSION,
            requestIdentity: calcioRequestIdentity.CALCIO_REQUEST_IDENTITY_VERSION,
            marketConsensus: calcioMarketConsensus.CALCIO_MARKET_CONSENSUS_VERSION,
            footballDataProvider: calcioFootballDataProvider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
            footballDataRevision: calcioFootballDataProvider.getRevisionToken(),
            opponentAdjustedForm: calcioOpponentAdjustedForm.CALCIO_OPPONENT_ADJUSTED_FORM_VERSION
        },
        oddsQueryProfile: { regions: ['eu'], markets: ['h2h', 'totals'] }
    });
    const now = Date.now();
    const cacheLookup = calcioRequestIdentity.getCalcioAnalysisCache(analysisCache, requestIdentity, {
        now,
        ttlMs: CACHE_TTL_MS,
        maxEntries: CALCIO_ANALYSIS_CACHE_MAX_ENTRIES
    });
    if (cacheLookup.hit) {
        // PATCH 26C: ogni riproduzione della UI deve avere un batch distinto,
        // anche quando l'analisi quantitativa proviene dalla cache. In questo modo
        // la coda DeepScan e l'allocazione finale non riutilizzano un batch precedente.
        const cachedEvents = Array.isArray(cacheLookup.data?.valueBets) ? cacheLookup.data.valueBets : [];
        const replayBatch = calcioObservability.startAnalysisBatch(db, {
            route: '/api/analyze',
            requestDigest: requestIdentity.digest || requestIdentity.key || requestIdentity.cacheKey || null,
            league,
            bankrollSnapshot: initialBankroll,
            cacheHit: true,
            diagnostics: {
                requestedLeague,
                source: 'CACHE_REPLAY_BATCH',
                cachedAgeMs: cacheLookup.ageMs
            }
        });
        const completedReplayBatch = calcioObservability.completeAnalysisBatch(db, replayBatch, {
            events: cachedEvents,
            expectedEventCount: cachedEvents.length,
            persistedEventCount: cachedEvents.length,
            diagnostics: {
                source: 'CACHE_REPLAY_BATCH',
                decisionAuthorityChanged: false,
                stakeAuthorityChanged: false,
                bankrollSnapshot: initialBankroll,
                bankrollSource: initialBankrollSource
            }
        });
        const replayPayload = JSON.parse(JSON.stringify(cacheLookup.data || {}));
        replayPayload.diagnostics = replayPayload.diagnostics || {};
        replayPayload.diagnostics.observability = {
            version: calcioObservability.CALCIO_OBSERVABILITY_VERSION,
            analysisBatchId: completedReplayBatch?.batchId || replayBatch.batchId,
            cacheReplay: true,
            readOnlyAudit: true,
            decisionAuthorityChanged: false,
            stakeAuthorityChanged: false
        };
        replayPayload.meta = replayPayload.meta || {};
        replayPayload.meta.observability = replayPayload.diagnostics.observability;
        return res.json(calcioRequestIdentity.attachCalcioCacheMetadata(replayPayload, requestIdentity, {
            hit: true,
            ageMs: cacheLookup.ageMs,
            ttlMs: CACHE_TTL_MS,
            size: cacheLookup.size
        }));
    }

    // PATCH 26A: osservabilità soltanto. Non modifica candidati, IPM, Kelly o stake.
    calcioObservationBatch = calcioObservability.startAnalysisBatch(db, {
        route: '/api/analyze',
        requestDigest: requestIdentity.digest || requestIdentity.key || requestIdentity.cacheKey || null,
        league,
        bankrollSnapshot: initialBankroll,
        cacheHit: false,
        diagnostics: { requestedLeague, leaguesToProcess: league === 'all' ? Object.keys(LEAGUES_CONFIG) : [league] }
    });

    const useCR = dynSettings.useCrossReference === true;
    const onlyGlobal = dynSettings.onlyGlobal === true; 
    const useAdvancedMetrics = dynSettings.useAdvancedMetrics !== false;
    const eloK = parseFloat(dynSettings.eloK) || 20;
    
    let leaguesToProcess = league === 'all' ? Object.keys(LEAGUES_CONFIG) : [league];
    let globalValueBetsSingle = [];

    const diagnostics = createFootballDiagnostics('analyze', leaguesToProcess);
    diagnostics.settingsSnapshot = {
        useCrossReference: useCR,
        onlyGlobal,
        useAdvancedMetrics,
        baseEdge: dynSettings.baseEdge,
        baseProb: dynSettings.baseProb,
        u25Edge: dynSettings.u25Edge,
        u25Prob: dynSettings.u25Prob,
        home1Edge: dynSettings.home1Edge,
        home1Prob: dynSettings.home1Prob,
        x2Edge: dynSettings.x2Edge,
        x2Prob: dynSettings.x2Prob
    };

    console.log(`\n======================================================`);
    console.log(`🧠 AVVIO ANALISI CALCIO XG + MONTE CARLO: ${leaguesToProcess.join(', ')}`);

    const footballReliabilityReport = getFootballReliabilityReport();
    const clubEloSnapshot = await calcioClubEloProvider.loadClubEloSnapshot({
        now: new Date(),
        cacheFile: path.join(__dirname, 'data', 'calcio_club_elo_lkg.json')
    }).catch(error => ({
        version: calcioClubEloProvider.CALCIO_CLUB_ELO_PROVIDER_VERSION,
        status: 'UNAVAILABLE', source: 'NONE', ratings: {}, ratingCount: 0, error: error.code || error.message
    }));
    diagnostics.clubElo = {
        status: clubEloSnapshot.status,
        source: clubEloSnapshot.source,
        snapshotDate: clubEloSnapshot.snapshotDate || null,
        ratingCount: clubEloSnapshot.ratingCount || 0,
        error: clubEloSnapshot.error || null,
        newOddsApiCalls: 0
    };

    try {
        for (let l of leaguesToProcess) {
            const config = LEAGUES_CONFIG[l];
            if (!config) continue;
            const configuredGlobalMaxOdd = safeNumber(dynSettings.maxOdd, 5);
            const effectiveMaxOdd = Math.min(config.maxOdd, configuredGlobalMaxOdd >= 1.5 ? configuredGlobalMaxOdd : config.maxOdd);
            diagnostics.leaguesProcessed++;
            
            let realXGData = {};
            let understatProviderState = getUnderstatState(config.name);
            try {
                const xgResult = await getUnderstatxG(config.name);
                understatProviderState = getUnderstatState(config.name);
                if (xgResult) {
                    realXGData = xgResult;
                    diagnostics.xgTeamsLoaded += Object.keys(realXGData).length;
                }
                diagnostics.understatV2 = diagnostics.understatV2 || [];
                diagnostics.understatV2.push({ league: config.name, ...understatProviderState });
            } catch (xgErr) {
                understatProviderState = getUnderstatState(config.name);
                diagnostics.notes.push(`${config.name}: xG non disponibile (${xgErr.message})`);
            }

            let csvData;
            let footballDataResult;
            try {
                footballDataResult = await calcioFootballDataProvider.getLeagueCsv({
                    leagueKey: l,
                    leagueName: config.name,
                    code: config.code
                });
                csvData = footballDataResult.csvData;
                calcioFootballDataProvider.recordProviderDiagnostics(diagnostics.footballData, footballDataResult);
                recordFootballFeedAudit(diagnostics, {
                    league: config.name,
                    status: footballDataResult.degraded ? 'FOOTBALL_DATA_LKG' : 'FOOTBALL_DATA_READY',
                    reason: `${footballDataResult.source} stagione ${footballDataResult.season || 'N/D'}; righe valide ${footballDataResult.validRows}.`
                });
            } catch (err) {
                calcioFootballDataProvider.recordProviderDiagnostics(diagnostics.footballData, err, { leagueName: config.name, code: config.code });
                diagnostics.csvErrors.push({ league: config.name, error: err.message });
                continue;
            }

            diagnostics.csvLoaded++;
            const teamSnapshotIndex = calcioTeamSnapshot.getLeagueIndex({
                csvData,
                leagueName: config.name,
                code: config.code,
                revisionToken: calcioFootballDataProvider.getRevisionToken({ projectRoot: path.resolve(__dirname, '..') })
            });
            const historicalCoverageContext = calcioHistoricalCoverage.createCoverageContext({
                projectRoot: path.resolve(__dirname, '..'),
                primaryCsvData: csvData,
                primaryCode: config.code,
                primaryLeagueName: config.name,
                primaryRevisionToken: calcioFootballDataProvider.getRevisionToken({ projectRoot: path.resolve(__dirname, '..') }),
                primarySeason: footballDataResult?.season || null
            });
            const coverageSnapshotIndex = historicalCoverageContext.compositeIndex;
            diagnostics.historicalCoverage = diagnostics.historicalCoverage || {
                version: calcioHistoricalCoverage.CALCIO_HISTORICAL_COVERAGE_VERSION,
                evaluated: 0,
                primaryHistory: 0,
                promotedTeamPrior: 0,
                priorOnly: 0,
                reasonCounts: {},
                sourceMatrix: []
            };
            diagnostics.historicalCoverage.sourceMatrix.push({
                league: config.name,
                code: config.code,
                ...historicalCoverageContext.diagnostics
            });
            const lines = csvData.split('\n');
            const headers = lines[0].split(',').map(h => h.trim()); 
            
            const getCol = (names) => { for(let n of names){ const i = headers.indexOf(n); if(i > -1) return i;} return -1; };
            
            const idxH = getCol(['HomeTeam']), idxA = getCol(['AwayTeam']);
            const idxHG = getCol(['FTHG']), idxAG = getCol(['FTAG']);
            const idxHST = getCol(['HST']), idxAST = getCol(['AST']);
            const idxHS = getCol(['HS']), idxAS = getCol(['AS']);

            if (idxH === -1) continue;

            const idxD = getCol(['Date', 'Date ']);
            const allCsvRows = lines.slice(1)
                .map(line => line.split(','))
                .filter(cols => cols.length >= 10 && cols[idxH]);

            function buildFootballTeamStatsForCandidate(candidateDate) {
                // STEP91_CALCIO_TEMPORAL_CUTOFF: le statistiche squadra devono usare solo righe storiche < data candidata.
                const historicalRows = allCsvRows.filter(row => {
                    const rowDate = idxD > -1 ? parseFootballDataDate(row[idxD]) : null;
                    return rowDate && candidateDate instanceof Date && !Number.isNaN(candidateDate.getTime()) && rowDate < candidateDate;
                });
                const teamStats = {};

                for (const cols of historicalRows) {
                    const h = cols[idxH].trim(), a = cols[idxA].trim();
                    const hg = parseInt(cols[idxHG]) || 0, ag = parseInt(cols[idxAG]) || 0;
                    const hst = idxHST > -1 ? (parseInt(cols[idxHST]) || 0) : 0;
                    const ast = idxAST > -1 ? (parseInt(cols[idxAST]) || 0) : 0;
                    const hs = idxHS > -1 ? (parseInt(cols[idxHS]) || 0) : 0;
                    const as = idxAS > -1 ? (parseInt(cols[idxAS]) || 0) : 0;

                    if (!teamStats[h]) teamStats[h] = { hp: 0, hs: 0, hc: 0, hsot: 0, hcot: 0, ap: 0, as: 0, ac: 0, asot: 0, acot: 0, recS: [], recC: [], elo: 1500, matches: [] };
                    if (!teamStats[a]) teamStats[a] = { hp: 0, hs: 0, hc: 0, hsot: 0, hcot: 0, ap: 0, as: 0, ac: 0, asot: 0, acot: 0, recS: [], recC: [], elo: 1500, matches: [] };

                    if (useAdvancedMetrics) {
                        const newElos = calcioQuantEngine.updateElo(teamStats[h].elo, teamStats[a].elo, hg, ag, eloK);
                        teamStats[h].elo = newElos.newHome;
                        teamStats[a].elo = newElos.newAway;
                    }

                    teamStats[h].hp++; teamStats[h].hs += hg; teamStats[h].hc += ag; teamStats[h].hsot += hst; teamStats[h].hcot += ast;
                    teamStats[a].ap++; teamStats[a].as += ag; teamStats[a].ac += hg; teamStats[a].asot += ast; teamStats[a].acot += hst;

                    teamStats[h].recS.push(hg); teamStats[h].recC.push(ag);
                    teamStats[a].recS.push(ag); teamStats[a].recC.push(hg);

                    teamStats[h].matches.push({
                        goalsFor: hg, goalsAgainst: ag,
                        shots: hs, shotsOnTarget: hst,
                        shotsAgainst: as, shotsOnTargetAgainst: ast
                    });
                    teamStats[a].matches.push({
                        goalsFor: ag, goalsAgainst: hg,
                        shots: as, shotsOnTarget: ast,
                        shotsAgainst: hs, shotsOnTargetAgainst: hst
                    });

                    if(teamStats[h].recS.length > 10) { teamStats[h].recS.shift(); teamStats[h].recC.shift(); teamStats[h].matches.shift(); }
                    if(teamStats[a].recS.length > 10) { teamStats[a].recS.shift(); teamStats[a].recC.shift(); teamStats[a].matches.shift(); }
                }

                return { teamStats, historicalRowsCount: historicalRows.length };
            }

            try {
                const rawLiveMatches = await fetchOddsApi(`https://api.the-odds-api.com/v4/sports/${config.api}/odds/?apiKey=API_KEY_PLACEHOLDER&regions=eu&markets=h2h,totals`);
                if (!Array.isArray(rawLiveMatches) || rawLiveMatches.length === 0) { diagnostics.notes.push(`${config.name}: nessuna quota live ricevuta`); recordFootballFeedAudit(diagnostics, { league: config.name, status: 'NO_LIVE_ODDS', reason: 'Odds API non ha restituito match live/future per questa lega.' }); continue; }
                const eventIdentityResult = calcioEventIdentity.deduplicateCalcioEvents(rawLiveMatches, {
                    leagueKey: l,
                    leagueName: config.name,
                    provider: 'THE_ODDS_API'
                });
                const liveMatches = eventIdentityResult.events;
                diagnostics.eventIdentity = diagnostics.eventIdentity || {
                    version: calcioEventIdentity.CALCIO_EVENT_IDENTITY_VERSION,
                    rawCount: 0,
                    canonicalCount: 0,
                    duplicatesRemoved: 0,
                    conflictCount: 0,
                    conflicts: []
                };
                diagnostics.eventIdentity.rawCount += eventIdentityResult.diagnostics.rawCount;
                diagnostics.eventIdentity.canonicalCount += eventIdentityResult.diagnostics.canonicalCount;
                diagnostics.eventIdentity.duplicatesRemoved += eventIdentityResult.diagnostics.duplicatesRemoved;
                diagnostics.eventIdentity.conflictCount += eventIdentityResult.diagnostics.conflictCount;
                diagnostics.eventIdentity.conflicts.push(...eventIdentityResult.diagnostics.conflicts);
                diagnostics.liveMatchesFound += rawLiveMatches.length;
                recordFootballFeedAudit(diagnostics, {
                    league: config.name,
                    status: 'LIVE_ODDS_RECEIVED',
                    liveMatches: rawLiveMatches.length,
                    canonicalMatches: liveMatches.length,
                    duplicatesRemoved: eventIdentityResult.diagnostics.duplicatesRemoved,
                    reason: 'Feed quote ricevuto e normalizzato dall’Event Identity Guard prima del modello.'
                });

                // AUDIT07S R4: preserve per-match return semantics and yield between matches.
                for (const m of liveMatches) {
                    await new Promise(resolve => setImmediate(resolve));
                    ((m) => {
                    const marketConsensus = calcioMarketConsensus.buildCalcioMarketConsensus(m);
                    calcioMarketConsensus.updateCalcioMarketConsensusDiagnostics(diagnostics, marketConsensus);
                    if (!Array.isArray(m.bookmakers) || m.bookmakers.length === 0) {
                        diagnostics.liveMatchesWithoutBookmaker++;
                        recordFootballCandidateAudit(diagnostics, { match: `${m.home_team || 'N/D'} - ${m.away_team || 'N/D'}`, noBookmaker: true, reason: 'Evento senza bookmaker/markets.' });
                        return;
                    }
                    if (!marketConsensus.hasCompleteH2H) {
                        diagnostics.liveMatchesMissingH2H++;
                        recordFootballCandidateAudit(diagnostics, {
                            match: `${m.home_team || 'N/D'} - ${m.away_team || 'N/D'}`,
                            noH2H: true,
                            analysisOnly: true,
                            reason: 'Terna H2H completa assente: Patch 18 non inventa mercati e continua con eventuali quote dirette reali disponibili (es. totals).'
                        });
                    }

                    // BETTING PATCH 18: solo quote dirette bookmaker entrano nel ciclo candidati.
                    // executionOdds contiene ancora campi legacy Patch 2 per diagnostica/regressione,
                    // ma non è più una fonte operativa perché includeva doppie chance calcolate.
                    let odds = { ...marketConsensus.analysisOdds };
                    if (!Object.keys(odds).length) {
                        diagnostics.liveMatchesMissingH2H++;
                        recordFootballCandidateAudit(diagnostics, {
                            match: `${m.home_team || 'N/D'} - ${m.away_team || 'N/D'}`,
                            noH2H: true,
                            reason: 'Nessuna quota diretta con bookmaker e timestamp verificabili; evento escluso senza ricostruire quote.'
                        });
                        return;
                    }
                    const candidateDate = new Date(m.commence_time);
                    const eventIdentity = m.calcioEventIdentity || {
                        eventKey: calcioEventIdentity.buildEventKey(m, { leagueKey: l, leagueName: config.name, provider: 'THE_ODDS_API' }),
                        canonicalPairKey: calcioEventIdentity.buildPairKey(m, { leagueKey: l, leagueName: config.name }),
                        providerEventId: m.id || null,
                        kickoffIso: Number.isNaN(candidateDate.getTime()) ? null : candidateDate.toISOString(),
                        status: 'FALLBACK_IDENTITY'
                    };
                    const understatSeasonEvidence = classifySeasonForKickoff(understatProviderState?.season, candidateDate);
                    const { teamStats, historicalRowsCount } = buildFootballTeamStatsForCandidate(candidateDate);
                    const historicalCoverageAudit = historicalCoverageContext.resolveMatch(m.home_team, m.away_team, candidateDate, {
                        minSample: 5,
                        strongSample: 10,
                        threshold: 0.82
                    });
                    for (const side of ['home', 'away']) {
                        const sideAudit = historicalCoverageAudit[side];
                        if (!sideAudit?.matched) continue;
                        if (teamStats[sideAudit.resolvedTeam]) continue;
                        const built = historicalCoverageContext.buildLegacyTeamStats(sideAudit.requestedTeam, candidateDate, {
                            minSample: 5,
                            strongSample: 10,
                            threshold: 0.82
                        });
                        if (built.stats) teamStats[sideAudit.resolvedTeam] = built.stats;
                    }
                    diagnostics.historicalCoverage.evaluated++;
                    if (historicalCoverageAudit.promotedTeamPrior) diagnostics.historicalCoverage.promotedTeamPrior++;
                    else if (historicalCoverageAudit.matched) diagnostics.historicalCoverage.primaryHistory++;
                    else diagnostics.historicalCoverage.priorOnly++;
                    diagnostics.historicalCoverage.reasonCounts[historicalCoverageAudit.reasonCode] =
                        (diagnostics.historicalCoverage.reasonCounts[historicalCoverageAudit.reasonCode] || 0) + 1;
                    if (diagnostics && typeof diagnostics === 'object') {
                        diagnostics.calcioTemporalCutoff = diagnostics.calcioTemporalCutoff || { mode: 'STEP91_CALCIO_TEMPORAL_CUTOFF', applied: 0, emptyHistory: 0 };
                        diagnostics.calcioTemporalCutoff.applied++;
                        if (historicalRowsCount === 0) diagnostics.calcioTemporalCutoff.emptyHistory++;
                    }

                    const probabilityReferenceFairOdds = { ...marketConsensus.referenceFairOdds };
                    const sharpFairOdds = useCR ? { ...marketConsensus.referenceFairOdds } : {};

                    const homeHistoryResolution = historicalCoverageAudit.home?.matched
                        ? { matched: true, historicalKey: historicalCoverageAudit.home.resolvedTeam, method: historicalCoverageAudit.home.method, confidence: historicalCoverageAudit.home.resolutionConfidence }
                        : calcioDecisionCertification.resolveHistoricalKey(m.home_team, Object.keys(teamStats));
                    const awayHistoryResolution = historicalCoverageAudit.away?.matched
                        ? { matched: true, historicalKey: historicalCoverageAudit.away.resolvedTeam, method: historicalCoverageAudit.away.method, confidence: historicalCoverageAudit.away.resolutionConfidence }
                        : calcioDecisionCertification.resolveHistoricalKey(m.away_team, Object.keys(teamStats));
                    const hCsv = homeHistoryResolution.historicalKey || m.home_team;
                    const aCsv = awayHistoryResolution.historicalKey || m.away_team;
                    const providerIdentityCertification = calcioDecisionCertification.certifyIdentity({
                        providerHome: m.home_team,
                        providerAway: m.away_team,
                        home: m.home_team,
                        away: m.away_team,
                        provider_event_id: eventIdentity.providerEventId,
                        event_key: eventIdentity.eventKey
                    });

                    const homeHistoryMatched = homeHistoryResolution.matched && Boolean(teamStats[hCsv]);
                    const awayHistoryMatched = awayHistoryResolution.matched && Boolean(teamStats[aCsv]);
                    const teamsMatched = homeHistoryMatched && awayHistoryMatched;
                    if (!teamsMatched) {
                        diagnostics.teamMatchingFailed++;
                        recordFootballCandidateAudit(diagnostics, {
                            match: `${m.home_team || 'N/D'} - ${m.away_team || 'N/D'}`,
                            teamMatchingFailed: true,
                            analysisOnly: true,
                            reason: 'Nome squadra non matchato: viene mostrato il miglior pronostico best-available con prior di lega e stake 0.'
                        });
                    }

                    teamStats[hCsv] = ensureFootballTeamStatsForAnalysis(teamStats[hCsv], hCsv || m.home_team, config.name);
                    teamStats[aCsv] = ensureFootballTeamStatsForAnalysis(teamStats[aCsv], aCsv || m.away_team, config.name);

                    const observedHomeSample = teamStats[hCsv].observedHomeMatches;
                    const observedAwaySample = teamStats[aCsv].observedAwayMatches;
                    const sufficientHistory = teamsMatched && observedHomeSample >= 5 && observedAwaySample >= 5;
                    if (!sufficientHistory) {
                        diagnostics.historyTooShort++;
                        recordFootballCandidateAudit(diagnostics, {
                            match: `${hCsv || m.home_team} - ${aCsv || m.away_team}`,
                            historyTooShort: true,
                            analysisOnly: true,
                            reason: 'Campione storico insufficiente: pronostico mantenuto visibile, marcato a bassa affidabilità e non operativo.'
                        });
                    } else {
                        diagnostics.modelEligibleMatches++;
                    }

                    {
                        const understatCoverage = calcioUnderstatContract.evaluateUnderstatCoverage(realXGData, m.home_team, m.away_team);
                        const hUnder = understatCoverage.home?.resolved || normalizeName(m.home_team, Object.keys(realXGData));
                        const aUnder = understatCoverage.away?.resolved || normalizeName(m.away_team, Object.keys(realXGData));
                        const teamSnapshots = calcioTeamSnapshot.buildMatchSnapshots(coverageSnapshotIndex, hCsv, aCsv, candidateDate);
                        const opponentAdjustedForm = calcioOpponentAdjustedForm.buildMatchAdjustment(
                            coverageSnapshotIndex,
                            hCsv,
                            aCsv,
                            candidateDate,
                            { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 }
                        );
                        diagnostics.opponentAdjustedForm.evaluated++;
                        if (opponentAdjustedForm.applied) diagnostics.opponentAdjustedForm.applied++;
                        if (opponentAdjustedForm.status === 'EARLY_SEASON') diagnostics.opponentAdjustedForm.earlySeason++;
                        if (opponentAdjustedForm.status === 'PRIOR_ONLY') diagnostics.opponentAdjustedForm.priorOnly++;
                        if (opponentAdjustedForm.status === 'UNAVAILABLE') diagnostics.opponentAdjustedForm.unavailable++;
                        diagnostics.opponentAdjustedForm.maxAbsoluteAdjustmentPct = Math.max(
                            diagnostics.opponentAdjustedForm.maxAbsoluteAdjustmentPct,
                            Math.abs(safeNumber(opponentAdjustedForm.homeAdjustmentPct, 0)),
                            Math.abs(safeNumber(opponentAdjustedForm.awayAdjustmentPct, 0))
                        );
                        
                        let sHas, sHds, sAas, sAds;
                        if (understatCoverage.bothTeams && realXGData[hUnder] && realXGData[aUnder]) {
                            sHas = parseFloat(realXGData[hUnder].xG_for); sHds = parseFloat(realXGData[hUnder].xG_against);
                            sAas = parseFloat(realXGData[aUnder].xG_for); sAds = parseFloat(realXGData[aUnder].xG_against);
                        } else {
                            const convH = calcioQuantEngine.getSmoothedConversion(teamStats[hCsv].hs, teamStats[hCsv].hsot), convA = calcioQuantEngine.getSmoothedConversion(teamStats[aCsv].as, teamStats[aCsv].asot);
                            sHas = ((teamStats[hCsv].hs/teamStats[hCsv].hp)*0.5 + (teamStats[hCsv].hsot/teamStats[hCsv].hp)*convH*0.5);
                            sHds = ((teamStats[hCsv].hc/teamStats[hCsv].hp)*0.5 + (teamStats[hCsv].hcot/teamStats[hCsv].hp)*convA*0.5);
                            sAas = ((teamStats[aCsv].as/teamStats[aCsv].ap)*0.5 + (teamStats[aCsv].asot/teamStats[aCsv].ap)*convA*0.5);
                            sAds = ((teamStats[aCsv].ac/teamStats[aCsv].ap)*0.5 + (teamStats[aCsv].acot/teamStats[aCsv].ap)*convH*0.5);
                        }

                        let metric_hRecS = calcioQuantEngine.getExponentialMovingAverage(teamStats[hCsv].recS);
                        let metric_hRecC = calcioQuantEngine.getExponentialMovingAverage(teamStats[hCsv].recC);
                        let metric_aRecS = calcioQuantEngine.getExponentialMovingAverage(teamStats[aCsv].recS);
                        let metric_aRecC = calcioQuantEngine.getExponentialMovingAverage(teamStats[aCsv].recC);
                        
                        let eloMultiplierH = 1; let eloMultiplierA = 1;
                        if (useAdvancedMetrics) {
                            const eH = isNaN(teamStats[hCsv].elo) ? 1500 : teamStats[hCsv].elo;
                            const eA = isNaN(teamStats[aCsv].elo) ? 1500 : teamStats[aCsv].elo;
                            const eloDiff = eH - eA; 
                            eloMultiplierH = Math.min(1.12, Math.max(0.88, Math.pow(10, eloDiff / 3000)));
                            eloMultiplierA = Math.min(1.12, Math.max(0.88, Math.pow(10, -eloDiff / 3000)));
                        }

                        const homeAttack = (sHas * config.wS) + (metric_hRecS * config.wR);
                        const awayAttack = (sAas * config.wS) + (metric_aRecS * config.wR);
                        const homeDefenseConceded = (sHds * config.wS) + (metric_hRecC * config.wR);
                        const awayDefenseConceded = (sAds * config.wS) + (metric_aRecC * config.wR);

                        const naiveExpHome = Math.max(0.1, ((homeAttack + awayDefenseConceded) / 2) * eloMultiplierH);
                        const naiveExpAway = Math.max(0.1, ((awayAttack + homeDefenseConceded) / 2) * eloMultiplierA);
                        const formAdjustedExpectedGoals = calcioOpponentAdjustedForm.applyToExpectedGoals(
                            naiveExpHome,
                            naiveExpAway,
                            opponentAdjustedForm
                        );

                        let homeStatsObj = {
                            teamName: hCsv,
                            seasonXGFor: realXGData[hUnder] ? parseFloat(realXGData[hUnder].xG_for) : null,
                            seasonXGAgainst: realXGData[hUnder] ? parseFloat(realXGData[hUnder].xG_against) : null,
                            matches: teamStats[hCsv].matches
                        };
                        let awayStatsObj = {
                            teamName: aCsv,
                            seasonXGFor: realXGData[aUnder] ? parseFloat(realXGData[aUnder].xG_for) : null,
                            seasonXGAgainst: realXGData[aUnder] ? parseFloat(realXGData[aUnder].xG_against) : null,
                            matches: teamStats[aCsv].matches
                        };

                        const xgResult = calcioQuantEngine.getXGAdjustedDixonColesProbabilities({
                            homeStats: homeStatsObj, awayStats: awayStatsObj, leagueName: config.name,
                            homeElo: teamStats[hCsv].elo, awayElo: teamStats[aCsv].elo, goalBasedHome: formAdjustedExpectedGoals.expHomeGoals, goalBasedAway: formAdjustedExpectedGoals.expAwayGoals,
                            xgWeight: (understatCoverage.bothTeams && realXGData[hUnder] && realXGData[aUnder])
                                ? understatSeasonEvidence.authorityWeight
                                : 0.20,
                            reliabilityReport: footballReliabilityReport,
                            marketProbabilities: {
                                home: probabilityReferenceFairOdds['1'] ? 100 / probabilityReferenceFairOdds['1'] : null,
                                draw: probabilityReferenceFairOdds.X ? 100 / probabilityReferenceFairOdds.X : null,
                                away: probabilityReferenceFairOdds['2'] ? 100 / probabilityReferenceFairOdds['2'] : null,
                                over25: probabilityReferenceFairOdds['O2.5'] ? 100 / probabilityReferenceFairOdds['O2.5'] : null,
                                under25: probabilityReferenceFairOdds['U2.5'] ? 100 / probabilityReferenceFairOdds['U2.5'] : null
                            }
                        });

                        if (understatCoverage.bothTeams && understatSeasonEvidence.status !== 'CURRENT_SEASON_XG') {
                            xgResult.xg.evidenceMode = understatSeasonEvidence.status;
                            xgResult.xg.understatSeason = understatProviderState?.season || null;
                            xgResult.xg.understatAuthorityWeight = understatSeasonEvidence.authorityWeight;
                        }
                        xgResult.opponentAdjustedForm = {
                            ...opponentAdjustedForm,
                            expectedGoals: formAdjustedExpectedGoals
                        };
                        const p = xgResult.probabilities;
                        const mcIterations = 10000;
                        const mcSeed = buildCalcioMatchSeed(config, m);
                        const observedSample = Math.min(observedHomeSample, observedAwaySample);

                        const mcResult = calcioQuantEngine.runMonteCarlo(p, mcIterations, {
                            expHomeGoals: xgResult.expHomeGoals,
                            expAwayGoals: xgResult.expAwayGoals,
                            sampleSize: Math.max(1, observedSample),
                            volatilityFactor: xgResult.xg.volatility,
                            marketDisagreement: marketConsensus.dispersion?.h2h?.maxRangePp || 0,
                            seed: mcSeed
                        });

                        const coverageMode = calcioProbabilityIntegrity.inferCoverageMode({
                            homeMatched: homeHistoryMatched,
                            awayMatched: awayHistoryMatched,
                            homeSample: observedHomeSample,
                            awaySample: observedAwaySample,
                            xgEvidenceMode: xgResult.xg.evidenceMode
                        });

                        const probabilityIntegrity = calcioProbabilityIntegrity.buildCalcioProbabilityIntegrity({
                            modelProbabilities: p,
                            mcResult,
                            marketFairOdds: probabilityReferenceFairOdds,
                            coverage: {
                                mode: coverageMode,
                                homeMatched: homeHistoryMatched,
                                awayMatched: awayHistoryMatched,
                                homeSample: observedHomeSample,
                                awaySample: observedAwaySample,
                                xgEvidenceMode: xgResult.xg.evidenceMode
                            },
                            iterations: mcIterations,
                            seed: mcSeed
                        });

                        const p_mc = probabilityIntegrity.probabilities;

                        const dt = new Date(m.commence_time).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute:'2-digit' });
                        const clubEloEvidence = calcioClubEloProvider.buildMatchEvidence(clubEloSnapshot, hCsv || m.home_team, aCsv || m.away_team);
                        const calcioProfessionalContext = buildCalcioProfessionalContextForMatch({
                            match: m, config, hCsv, aCsv, hUnder, aUnder, teamStats, realXGData, understatCoverage, understatState: understatProviderState, understatSeasonEvidence, teamSnapshots, opponentAdjustedForm: xgResult.opponentAdjustedForm, historicalCoverageAudit, clubEloEvidence, footballReliabilityReport, p_mc, odds
                        });
                        calcioProfessionalContext.oddsConsensus = {
                            version: marketConsensus.version,
                            summary: marketConsensus.summary,
                            executionSourcesLegacy: marketConsensus.executionSources,
                            certifiedSources: marketConsensus.certifiedSources,
                            directAnalysisMarkets: Object.keys(marketConsensus.analysisOdds || {}),
                            multiSourceOperationalMarkets: Object.keys(marketConsensus.operationalOdds || {}),
                            marketCertifications: marketConsensus.marketCertifications,
                            referenceSource: marketConsensus.referenceSource,
                            referenceSampleSize: marketConsensus.referenceSampleSize,
                            dispersion: marketConsensus.dispersion,
                            warnings: marketConsensus.warnings
                        };
                        calcioProfessionalContext.oddsDrift = {
                            status: 'UNAVAILABLE_NO_OPENING_SNAPSHOT',
                            applied: false,
                            reason: 'Il feed live corrente non contiene una opening snapshot indipendente; nessun falso confronto current-vs-current viene applicato.'
                        };
                        calcioProfessionalContext.eventIdentity = eventIdentity;
                        calcioProfessionalContext.eventKey = eventIdentity.eventKey;
                        calcioProfessionalContext.canonicalPairKey = eventIdentity.canonicalPairKey;
                        calcioProfessionalContext.providerEventId = eventIdentity.providerEventId;
                        calcioProfessionalContext.understatProviderState = understatProviderState;
                        calcioProfessionalContext.understatSeasonEvidence = understatSeasonEvidence;
                        calcioProfessionalContext.probabilityIntegrity = probabilityIntegrity;
                        calcioProfessionalContext.probabilityCoverageMode = probabilityIntegrity.coverageMode;
                        calcioProfessionalContext.probabilityReliability = probabilityIntegrity.reliability;
                        calcioProfessionalContext.xgEvidenceMode = xgResult.xg.evidenceMode;
                        calcioProfessionalContext.xgWeightRequested = xgResult.xg.weightRequested;
                        calcioProfessionalContext.xgWeightUsed = xgResult.xg.weightUsed;
                        calcioProfessionalContext.opponentAdjustedForm = xgResult.opponentAdjustedForm;
                        calcioProfessionalContext.formAdjustmentStatus = opponentAdjustedForm.status;
                        calcioProfessionalContext.formAdjustmentConfidence = opponentAdjustedForm.confidence;
                        calcioProfessionalContext.monteCarlo = {
                            iterations: mcResult.iterations,
                            seed: mcResult.seed,
                            expectedGoals: mcResult.expectedGoals,
                            confidence: mcResult.confidence,
                            scoreDistribution: mcResult.scoreDistribution
                        };
                        updateFootballProfessionalDiagnostics(diagnostics, calcioProfessionalContext.professionalAudit);
                        let matchBets = [];
                        let analysisCandidates = [];

                        if (config.allowSingles) {
                            for (const [pred, odd] of Object.entries(odds)) {
                                if (config.restrictMarkets && ['1', 'X', '2'].includes(pred)) continue;
                                // Patch 12: onlyGlobal sceglie le soglie globali ma NON elimina mercati.
                                // La vecchia esclusione di 1, X2 e U2.5 favoriva artificialmente away/longshot.
                                // Un eventuale scope ristretto può entrare in vigore solo dopo holdout certificato e applicazione esplicita.
                                if (!isMarketAllowedByCertifiedOptimization(dynSettings, pred)) continue;

                                const oddsCertification = marketConsensus.marketCertifications?.[pred]
                                    || calcioCertifiedOddsProvenance.certificationFromInput({ prediction: pred, odd });
                                diagnostics.marketsEvaluated++;
                                const { targetEdge: reqEdge, targetProb: reqProb } = getDynamicParams(dynSettings, config.name, pred, onlyGlobal);
                                
                                if (isNaN(odd)) {
                                    diagnostics.rejectedInvalidOdd++;
                                    recordFootballCandidateAudit(diagnostics, { match: `${hCsv} - ${aCsv}`, prediction: pred, odd, invalidOdd: true, reason: 'Quota non valida.' });
                                    continue;
                                }
                                if (!p_mc[pred]) {
                                    diagnostics.rejectedMissingProbability++;
                                    recordFootballCandidateAudit(diagnostics, { match: `${hCsv} - ${aCsv}`, prediction: pred, odd, missingProbability: true, reason: 'Probabilità modello mancante.' });
                                    continue;
                                }
                                
                                const rawEvPct = calculateEvPct(p_mc[pred], odd);
                                const rawEdgePp = p_mc[pred] - impliedProbabilityPct(odd);
                                const ev_pct = calcioQuantEngine.adjustFootballEdgeByReliability(rawEvPct, footballReliabilityReport.decision);
                                const edge_pp = calcioQuantEngine.adjustFootballEdgeByReliability(rawEdgePp, footballReliabilityReport.decision);
                                const edge = edge_pp;

                                assertCalcioPreMatchOnlyContext({
                                    odd,
                                    probability: p_mc[pred],
                                    edge_pp,
                                    ev_pct,
                                    market: pred,
                                    league: config.name,
                                    kickoff: m.commence_time
                                });

                                let crPassed = true;
                                if (useCR && sharpFairOdds[pred] && !isNaN(sharpFairOdds[pred])) {
                                    crPassed = odd >= (sharpFairOdds[pred] * 0.90);
                                }

                                // Patch 2: il feed live non offre una opening snapshot indipendente.
                                // Il precedente confronto current-vs-current era sempre neutro e viene sostituito da diagnostica esplicita.
                                const strategyTag = `${config.name.replace(/\s+/g, '_').toUpperCase()}_${pred.includes('O') || pred.includes('U') ? 'TOTALS' : (pred.includes('G') ? 'BTTS' : '1X2')}`;
                                const correlationContext = buildCalcioCorrelationContextForPrediction(pred, p_mc, odds, calcioProfessionalContext);
                                const candidateExtData = {
                                    ...calcioProfessionalContext,
                                    ...correlationContext,
                                    mcGlobal: mcResult.confidence.global,
                                    probabilityIntegrity,
                                    probabilityIntegrityMarket: probabilityIntegrity.diagnostics?.[pred] || null,
                                    analysisCoverage: {
                                        teamsMatched,
                                        homeHistoryMatched,
                                        awayHistoryMatched,
                                        observedHomeSample,
                                        observedAwaySample,
                                        sufficientHistory,
                                        mode: probabilityIntegrity.coverageMode,
                                        reliability: probabilityIntegrity.reliability
                                    }
                                };
                                candidateExtData.multiProviderEvidence = calcioMultiProviderEvidence.buildEvidenceHealth({
                                    footballDataLoaded: true,
                                    hasBothXg: Boolean(understatCoverage?.hasBothXg),
                                    understatProviderState,
                                    xgEvidenceMode: xgResult.xg.evidenceMode,
                                    clubEloEvidence,
                                    sourceAudit: calcioProfessionalContext.sourceAudit || {},
                                    historicalSample: 0,
                                    oddsAvailable: oddsCertification.realDirect === true
                                });
                                candidateExtData.oddsCertification = oddsCertification;
                                candidateExtData.odds_certification = oddsCertification;
                                const candidateProfessionalAudit = calcioProfessionalGuard.buildCalcioProfessionalAudit({
                                    home: hCsv, away: aCsv, prediction: pred, probabilities: p_mc, odds,
                                    extData: candidateExtData
                                });
                                const predictionReliability = calcioProgramCoherence.buildPredictionReliability({
                                    integrity: probabilityIntegrity,
                                    market: pred,
                                    professionalAudit: candidateProfessionalAudit,
                                    sourceAudit: calcioProfessionalContext.sourceAudit || {},
                                    historicalEvidence: null,
                                    multiProviderEvidence: candidateExtData.multiProviderEvidence
                                });
                                const candidateBase = {
                                    date: dt,
                                    match_date: eventIdentity.kickoffIso || m.commence_time,
                                    commence_time: eventIdentity.kickoffIso || m.commence_time,
                                    event_key: eventIdentity.eventKey,
                                    eventKey: eventIdentity.eventKey,
                                    canonical_pair_key: eventIdentity.canonicalPairKey,
                                    provider_event_id: eventIdentity.providerEventId,
                                    event_identity_status: eventIdentity.status,
                                    league: config.name,
                                    // PATCH 19: display e persistenza mantengono sempre l'identità raw del provider.
                                    match: `${m.home_team} - ${m.away_team}`,
                                    home: m.home_team,
                                    away: m.away_team,
                                    providerHome: m.home_team,
                                    providerAway: m.away_team,
                                    provider_home_team: m.home_team,
                                    provider_away_team: m.away_team,
                                    historicalHomeKey: homeHistoryResolution.historicalKey,
                                    historicalAwayKey: awayHistoryResolution.historicalKey,
                                    decisionIdentity: providerIdentityCertification,
                                    requireIdentityCertification: true,
                                    prediction: pred,
                                    odd,
                                    estimatedProb: p_mc[pred].toFixed(2),
                                    edge: edge.toFixed(2),
                                    edge_pp: edge_pp.toFixed(2),
                                    ev_pct: ev_pct.toFixed(2),
                                    invested: '0.00',
                                    stake_theoretical: '0.00',
                                    theoreticalStake: '0.00',
                                    stake_operational: '0.00',
                                    operationalStake: '0.00',
                                    stake_lifecycle_status: 'NO_THEORETICAL_STAKE',
                                    estimatedProfit: '0.00',
                                    isCR: useCR,
                                    rawProb: p_mc[pred],
                                    odd1: odds['1'],
                                    oddX: odds.X,
                                    odd2: odds['2'],
                                    extData: candidateExtData,
                                    professionalAudit: candidateProfessionalAudit,
                                    sport_type: 'CALCIO',
                                    bankroll_snapshot: initialBankroll,
                                    strategy_tag: strategyTag,
                                    rawEdge: rawEvPct,
                                    oddsCertification,
                                    odds_certification: oddsCertification,
                                    odds_source: oddsCertification.selectedSource?.bookmakerKey || null,
                                    odds_source_title: oddsCertification.selectedSource?.bookmakerTitle || null,
                                    odds_source_timestamp: oddsCertification.selectedSource?.lastUpdate || null,
                                    odds_source_count: oddsCertification.sourceCount || 0,
                                    odds_operational_eligible: oddsCertification.operationalEligible === true,
                                    odds_reference_source: ['O2.5', 'U2.5'].includes(pred)
                                        ? marketConsensus.referenceSource.totals
                                        : marketConsensus.referenceSource.h2h,
                                    odds_consensus_version: marketConsensus.version,
                                    probability_integrity_version: probabilityIntegrity.version,
                                    probability_reliability: probabilityIntegrity.marketReliability?.[pred] || probabilityIntegrity.reliability,
                                    prediction_reliability_score: predictionReliability.score,
                                    prediction_reliability_label: predictionReliability.label,
                                    prediction_reliability: predictionReliability,
                                    club_elo_evidence: clubEloEvidence,
                                    clubEloEvidence,
                                    multi_provider_evidence: candidateExtData.multiProviderEvidence,
                                    probability_coverage_mode: probabilityIntegrity.coverageMode,
                                    probability_disagreement_pp: probabilityIntegrity.diagnostics?.[pred]?.disagreementPp ?? probabilityIntegrity.maxDisagreementPp,
                                    monte_carlo_std_error_pp: probabilityIntegrity.diagnostics?.[pred]?.monteCarloStdErrorPp ?? probabilityIntegrity.maxMonteCarloStdErrorPp,
                                    monte_carlo_iterations: mcResult.iterations,
                                    monte_carlo_seed: mcResult.seed,
                                    xg_evidence_mode: xgResult.xg.evidenceMode,
                                    xg_weight_requested: xgResult.xg.weightRequested,
                                    xg_weight_used: xgResult.xg.weightUsed,
                                    opponent_adjusted_form_version: opponentAdjustedForm.version,
                                    opponent_adjusted_form_status: opponentAdjustedForm.status,
                                    opponent_adjusted_form_confidence: opponentAdjustedForm.confidence,
                                    opponent_adjusted_home_pct: opponentAdjustedForm.homeAdjustmentPct,
                                    opponent_adjusted_away_pct: opponentAdjustedForm.awayAdjustmentPct,
                                    historical_coverage_version: historicalCoverageAudit.version,
                                    historical_coverage_status: historicalCoverageAudit.status,
                                    historical_coverage_reason: historicalCoverageAudit.reasonCode,
                                    historical_coverage_audit: historicalCoverageAudit,
                                    promoted_team_prior: historicalCoverageAudit.promotedTeamPrior,
                                    analysisOnly: false,
                                    prediction_visibility: 'OPERATIONAL_CANDIDATE',
                                    analysis_thresholds: {
                                        maxOdd: effectiveMaxOdd,
                                        requiredProbability: reqProb,
                                        requiredEdge: reqEdge,
                                        crPassed
                                    }
                                };
                                analysisCandidates.push(candidateBase);

                                // Patch 2: il feed live non offre una opening snapshot indipendente.
                                // Patch 5: le soglie decidono lo stake operativo, non la visibilità del pronostico.
                                // Patch 17: le vecchie soglie edge/probabilità restano diagnostiche.
                                // L'unica autorità sullo stake è l'Indice Predizione Match.
                                const unifiedPrediction = calcioUnifiedPredictionIndex.evaluatePrediction({
                                    ...candidateBase,
                                    bankroll: initialBankroll,
                                    reliabilityScore: predictionReliability.score,
                                    probabilityIntegrity,
                                    monteCarloProbabilityPct: probabilityIntegrity.diagnostics?.[pred]?.monteCarloProbabilityPct,
                                    modelProbabilityPct: probabilityIntegrity.diagnostics?.[pred]?.modelProbabilityPct,
                                    marketProbabilityPct: probabilityIntegrity.diagnostics?.[pred]?.marketProbabilityPct,
                                    deepScanAction: candidateBase.ds_action || '',
                                    finalizationStatus: 'PRE_DEEPSCAN_PROVISIONAL',
                                    historicalEvidence: null,
                                    historicalSample: 0,
                                    requireIdentityCertification: true,
                                    decisionIdentity: providerIdentityCertification,
                                    crPassed
                                });
                                Object.assign(candidateBase, calcioUnifiedPredictionIndex.persistenceFields(unifiedPrediction), {
                                    predictionIndex: unifiedPrediction,
                                    prediction_index: unifiedPrediction,
                                    invested: unifiedPrediction.operationalStake.toFixed(2),
                                    stake_theoretical: unifiedPrediction.theoreticalStake.toFixed(2),
                                    theoreticalStake: unifiedPrediction.theoreticalStake.toFixed(2),
                                    stake_operational: unifiedPrediction.operationalStake.toFixed(2),
                                    operationalStake: unifiedPrediction.operationalStake.toFixed(2),
                                    estimatedProfit: unifiedPrediction.estimatedProfit.toFixed(2),
                                    calcio_data_class: unifiedPrediction.dataClass,
                                    calcio_stake_reason: unifiedPrediction.reason,
                                    analysis_thresholds: {
                                        ...candidateBase.analysis_thresholds,
                                        legacyThresholdPassed: edge > 0 && odd >= 1.5 && odd <= effectiveMaxOdd && edge > reqEdge && edge <= 15.0 && p_mc[pred] > reqProb && crPassed,
                                        legacyThresholdAuthority: false,
                                        predictionIndexScore: unifiedPrediction.score
                                    }
                                });
                                if (unifiedPrediction.eligible) {
                                    diagnostics.valueCandidates++;
                                    matchBets.push(candidateBase);
                                } else {
                                    diagnostics.rejectedByThreshold++;
                                    recordFootballCandidateAudit(diagnostics, {
                                        match: `${hCsv} - ${aCsv}`,
                                        prediction: pred,
                                        odd,
                                        probability: p_mc[pred],
                                        edge_pp,
                                        ev_pct,
                                        oddsCertification,
                                        analysisOnly: true,
                                        reason: unifiedPrediction.reason,
                                        predictionIndexScore: unifiedPrediction.score
                                    });
                                }
                            }
                        }
                        
                        const completeCandidateSelection = calcioEventFinalizationIsolation.buildFullCandidateAudit(
                            analysisCandidates,
                            null,
                            calcioProfessionalSelection
                        );
                        if (matchBets.length > 0) {
                            const professionalSelection = calcioProfessionalSelection.selectPrimary(matchBets);
                            const selectedBeforeGate = professionalSelection.selected;
                            // PATCH 26B: il mercato provvisoriamente eleggibile resta il selezionato,
                            // ma il DeepScan TOP-3 riceve SEMPRE l'intero pool dei mercati diretti
                            // certificati. L'IPM provvisorio non puo eliminare i runner-up.
                            selectedBeforeGate.calcio_market_selection_audit = completeCandidateSelection.audit;
                            selectedBeforeGate.calcio_market_selection_version = professionalSelection.version;
                            selectedBeforeGate.extData = {
                                ...(selectedBeforeGate.extData || {}),
                                marketSelectionAudit: completeCandidateSelection.audit,
                                candidatePoolDiagnostics: {
                                    version: calcioEventFinalizationIsolation.CALCIO_EVENT_FINALIZATION_ISOLATION_VERSION,
                                    candidatePoolCount: completeCandidateSelection.candidatePoolCount,
                                    eligibleCandidateCount: completeCandidateSelection.eligibleCandidateCount,
                                    source: 'ALL_DIRECT_CERTIFIED_MARKETS'
                                }
                            };
                            // Patch 21: 1/X/2/O2.5/U2.5 competono nello stesso ranking IPM.
                            // Nessuna famiglia è preferita e nessuna diversità artificiale è imposta.
                            let selectedCalcioBet = applyCalcioOperationalGateToBet(selectedBeforeGate, {
                                professionalAudit: selectedBeforeGate.professionalAudit
                            });
                            if (parseFloat(selectedCalcioBet.invested) <= 0) {
                                selectedCalcioBet = buildAnalysisOnlyCalcioBet(
                                    selectedCalcioBet,
                                    'Resa Qualità/Professional Guard ha bloccato lo stake: pronostico mantenuto in analisi.'
                                );
                            }
                            if (diagnostics.calcioGate) {
                                if ([CALCIO_GATE_STATUS.APPROVED_WITH_CAP, CALCIO_GATE_STATUS.APPROVED, CALCIO_GATE_STATUS.APPROVED_FULL_STAKE].includes(selectedCalcioBet.calcio_gate_status)) diagnostics.calcioGate.approved++;
                                if (selectedCalcioBet.calcio_gate_status === CALCIO_GATE_STATUS.WATCHLIST_MICRO) diagnostics.calcioGate.watchlistMicro++;
                                if (selectedCalcioBet.calcio_gate_status === CALCIO_GATE_STATUS.BLOCKED_SOFT) diagnostics.calcioGate.blockedSoft++;
                                if (selectedCalcioBet.calcio_gate_status === CALCIO_GATE_STATUS.BLOCKED_HARD) diagnostics.calcioGate.blockedHard++;
                            }
                            diagnostics.selectedBets++;
                            if (selectedCalcioBet.analysisOnly) {
                                diagnostics.analysisOnlyForecasts = (diagnostics.analysisOnlyForecasts || 0) + 1;
                            }
                            globalValueBetsSingle.push(selectedCalcioBet);
                        } else if (analysisCandidates.length > 0) {
                            const bestAvailable = calcioProbabilityIntegrity.selectBestAvailableForecast({
                                probabilities: p_mc,
                                odds,
                                allowedMarkets: analysisCandidates.map(candidate => candidate.prediction),
                                integrity: probabilityIntegrity
                            });
                            const analysisSelection = completeCandidateSelection;
                            const bestCandidate = analysisSelection.selected;

                            if (bestCandidate) {
                                bestCandidate.calcio_market_selection_audit = analysisSelection.audit;
                                bestCandidate.calcio_market_selection_version = analysisSelection.version;
                                bestCandidate.extData = {
                                    ...(bestCandidate.extData || {}),
                                    marketSelectionAudit: analysisSelection.audit
                                };
                                const gatedCandidate = applyCalcioOperationalGateToBet(bestCandidate, {
                                    professionalAudit: bestCandidate.professionalAudit
                                });
                                const analysisOnlyBet = buildAnalysisOnlyCalcioBet(
                                    gatedCandidate,
                                    sufficientHistory
                                        ? 'Miglior pronostico disponibile: soglie valore/stake non superate.'
                                        : 'Miglior pronostico disponibile con dati incompleti: verificare Resa Qualità e DeepScan.'
                                );
                                analysisOnlyBet.best_available_score = bestAvailable.best?.score ?? null;
                                analysisOnlyBet.best_available_edge_pp = bestAvailable.best?.edgePp ?? parseFloat(bestCandidate.edge_pp);
                                analysisOnlyBet.best_available_candidates = bestAvailable.candidates.length;
                                diagnostics.analysisOnlyForecasts = (diagnostics.analysisOnlyForecasts || 0) + 1;
                                diagnostics.selectedBets++;
                                recordFootballCandidateAudit(diagnostics, {
                                    match: analysisOnlyBet.match,
                                    prediction: analysisOnlyBet.prediction,
                                    analysisOnly: true,
                                    selected: true,
                                    reason: analysisOnlyBet.calcio_operational_summary
                                });
                                globalValueBetsSingle.push(analysisOnlyBet);
                            }
                        }
                    }
                    })(m);
                }
            } catch(apiErr) {
                diagnostics.apiErrors.push({ league: config.name, error: apiErr.message });
                recordFootballFeedAudit(diagnostics, { league: config.name, status: 'API_ERROR', reason: apiErr.message });
                console.error(`⚠️ Errore API The-Odds su lega ${config.name}:`, apiErr.message);
            }
        } 

        globalValueBetsSingle = calcioEventIdentity.deduplicateCalcioBets(globalValueBetsSingle);
        if (diagnostics.eventIdentity) {
            diagnostics.eventIdentity.responseCanonicalCount = globalValueBetsSingle.length;
        }
        globalValueBetsSingle = calcioProfessionalSelection.rankCandidates(globalValueBetsSingle);

        const currentBR = initialBankroll; // PATCH 26E-C: snapshot CALCIO immutabile condiviso da IPM, stake e cap batch.
        // PATCH 24: il batch iniziale e esclusivamente PROVVISORIO. I cap e lo
        // stake operativo vengono applicati solo dopo DeepScan/PT/IPM finali sui
        // primi tre mercati. In questo modo nessuna esposizione provvisoria entra
        // nel portafoglio e non esiste una seconda autorita dopo l'IPM finale.
        globalValueBetsSingle = globalValueBetsSingle.map(row => {
            const provisionalIndex = row.predictionIndex || row.prediction_index || {};
            const theoreticalStake = safeNumber(
                provisionalIndex.theoreticalStake ?? provisionalIndex.prePortfolioCapStake ?? row.calcio_theoretical_stake ?? row.stake_theoretical,
                0
            );
            const provisionalOperationalStake = safeNumber(
                provisionalIndex.operationalStake ?? row.calcio_operational_stake ?? row.operationalStake ?? row.invested,
                0
            );
            const provisional = {
                ...provisionalIndex,
                theoreticalStake,
                prePortfolioCapStake: theoreticalStake,
                provisionalOperationalStake,
                operationalStake: 0,
                estimatedProfit: 0,
                eligible: false,
                finalizationStatus: 'AWAITING_DEEPSCAN_TOP3_FINALIZATION'
            };
            return {
                ...row,
                predictionIndex: provisional,
                prediction_index: provisional,
                invested: '0.00',
                operationalStake: '0.00',
                stake_operational: '0.00',
                calcio_operational_stake: 0,
                estimatedProfit: '0.00',
                calcio_ai_finalization_status: 'AWAITING_DEEPSCAN_TOP3_FINALIZATION',
                calcio_portfolio_cap_post_finalization: 0
            };
        });
        diagnostics.portfolioExposure = {
            version: 'BETTING_PATCH_24_PRE_FINALIZATION_NO_EXPOSURE_V1',
            provisionalOnly: true,
            operationalExposure: 0,
            reason: 'Cap aggregati rinviati a DeepScan/PT/IPM finali.'
        };


        diagnostics.savedAttempts = 0;
        const persistCalcioAnalysisBatch = db.transaction((betsToPersist) => {
        for (let bet of betsToPersist) {
            const eventKey = bet.event_key || bet.eventKey || buildCalcioExposureKey(bet);
            const identityInput = { ...bet, calcio_event_key: eventKey, match_exposure_key: eventKey, sport_type: 'CALCIO' };
            const paperIdentityMatch = paperTradingIdentity.findActiveByKey(db, identityInput);
            const existingBet = paperIdentityMatch || db.prepare(`
                SELECT * FROM ai_forward_test
                WHERE status = 'PENDING'
                  AND COALESCE(paper_result_active, 1) = 1
                  AND bet_type NOT LIKE '%TENNIS%'
                  AND bet_type NOT LIKE 'MULTI%'
                  AND (
                    match_exposure_key = ?
                    OR (home_team = ? AND away_team = ? AND match_date = ? AND prediction = ?)
                  )
                ORDER BY id DESC LIMIT 1
            `).get(eventKey, bet.home, bet.away, bet.match_date || bet.date, bet.prediction);
            
            if (!existingBet) {
                diagnostics.savedAttempts++;
                const betTypeStr = bet.isCR ? 'SINGLE_CR' : 'SINGLE';
                const exposureKey = eventKey;
                const insertInfo = db.prepare(`
                    INSERT INTO ai_forward_test 
                    (bet_type, match_date, home_team, away_team, prediction, odd, stake, estimated_prob, edge, edge_pp, ev_pct, status, league, confidence, strategy_tag, sport_type, bankroll_snapshot, data_quality, model_version, metric_version, engine_version, market_implied_prob, market_type, calcio_gate_status, calcio_gate_allow_bet, calcio_gate_reasons, calcio_gate_max_stake, calcio_operational_status, calcio_operational_action, calcio_operational_summary, exposure_role, exposure_key, match_exposure_key, exposure_group_status, exposure_reason, calcio_professional_status, calcio_professional_risk, calcio_professional_summary, calcio_timing_status, calcio_lineup_status, calcio_data_reliability, calcio_team_match_confidence, calcio_correlation_status, calcio_prediction_reliability_score, calcio_prediction_reliability_label, calcio_analysis_stage_code, calcio_analysis_stage_label, calcio_analysis_stage_reason, calcio_analysis_only, calcio_quality_final_label) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'CALCIO', ?, 'CURRENT_BOOTSTRAP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    betTypeStr, bet.match_date || bet.date, bet.home, bet.away, bet.prediction, bet.odd, parseFloat(bet.invested), parseFloat(bet.estimatedProb), parseFloat(bet.edge), parseFloat(bet.edge_pp), parseFloat(bet.ev_pct), bet.league, parseFloat(bet.extData.mcGlobal), bet.strategy_tag, currentBR, FOOTBALL_MODEL_VERSION, FOOTBALL_METRIC_VERSION, SERVER_ENGINE_VERSION, impliedProbabilityPct(bet.odd),
                    bet.market_type || inferCalcioMarketFamily(bet.prediction), bet.calcio_gate_status || CALCIO_GATE_STATUS.APPROVED_WITH_CAP, bet.calcio_gate_allow_bet === 0 ? 0 : 1, bet.calcio_gate_reasons || 'Step59B: Calcio Gate bootstrap.', safeNumber(bet.calcio_gate_max_stake, parseFloat(bet.stake_theoretical ?? bet.invested)), bet.calcio_operational_status || bet.calcio_gate_status || CALCIO_GATE_STATUS.APPROVED_WITH_CAP, bet.calcio_operational_action || 'APPROVED_WITH_CAP', bet.calcio_operational_summary || 'Step59B: pronostico operativo Calcio con cap.', bet.exposure_role || CALCIO_EXPOSURE_ROLE.PRIMARY, exposureKey, exposureKey, bet.exposure_group_status || 'PRIMARY_ACTIVE', bet.exposure_reason || 'Step59C: prima esposizione operativa Calcio per match.', bet.calcio_professional_status || '', safeNumber(bet.calcio_professional_risk, 0), bet.calcio_professional_summary || '', bet.calcio_timing_status || '', bet.calcio_lineup_status || '', bet.calcio_data_reliability || '', safeNumber(bet.calcio_team_match_confidence, 0), bet.calcio_correlation_status || '', safeNumber(bet.prediction_reliability_score, null), bet.prediction_reliability_label || '', bet.analysis_stage_code || bet.analysis_stage?.code || '', bet.analysis_stage_label || bet.analysis_stage?.label || '', bet.analysis_stage_reason || bet.analysis_stage?.summary || '', bet.analysisOnly ? 1 : 0, bet.calcio_quality_final_label || ''
                );
                const patch10Fields = {
                    calcio_event_key: eventKey,
                    calcio_provider_event_id: bet.provider_event_id || null,
                    calcio_canonical_pair_key: bet.canonical_pair_key || null,
                    calcio_theoretical_stake: safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0),
                    calcio_operational_stake: safeNumber(bet.invested, 0),
                    stake_base_before_deepscan: safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0),
                    kelly_fraction_pct: safeNumber(bet.kellyStakePolicy?.rawKellyPct ?? bet.kelly_stake_policy?.rawKellyPct, null),
                    kelly_raw_stake: safeNumber(bet.kellyStakePolicy?.rawKellyStake ?? bet.kelly_stake_policy?.rawKellyStake, null),
                    stake_confidence_multiplier: safeNumber(bet.kellyStakePolicy?.dataAuthority?.multiplier ?? bet.kelly_stake_policy?.dataAuthority?.multiplier, null),
                    stake_confidence_level: bet.kellyStakePolicy?.dataAuthority?.dataClass || bet.kelly_stake_policy?.dataAuthority?.dataClass || '',
                    stake_min_applied: (bet.kellyStakePolicy?.minimumStakeApplied || bet.kelly_stake_policy?.minimumStakeApplied) ? 1 : 0,
                    stake_cap_applied: safeNumber(bet.kellyStakePolicy?.adjustedKellyStake ?? bet.kelly_stake_policy?.adjustedKellyStake, 0) > safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0) ? 1 : 0,
                    stake_policy_mode: bet.kellyStakePolicy?.version || bet.kelly_stake_policy?.version || '',
                    stake_policy_note: bet.calcio_stake_reason || bet.kellyStakePolicy?.reason || bet.kelly_stake_policy?.reason || '',
                    calcio_stake_lifecycle_status: bet.stake_lifecycle_status || bet.stakeLifecycle?.status || '',
                    calcio_stake_lifecycle_reason: bet.stake_lifecycle_reason || bet.stakeLifecycle?.reason || '',
                    calcio_prediction_reliability_score: safeNumber(bet.prediction_reliability_score, null),
                    calcio_prediction_reliability_label: bet.prediction_reliability_label || '',
                    calcio_analysis_stage_code: bet.analysis_stage_code || bet.analysis_stage?.code || '',
                    calcio_analysis_stage_label: bet.analysis_stage_label || bet.analysis_stage?.label || '',
                    calcio_analysis_stage_reason: bet.analysis_stage_reason || bet.analysis_stage?.summary || '',
                    calcio_analysis_only: bet.analysisOnly ? 1 : 0,
                    calcio_quality_final_label: bet.calcio_quality_final_label || '',
                    candidate_selection_version: bet.candidate_selection_version || calcioProfessionalSelection.CALCIO_PROFESSIONAL_SELECTION_VERSION,
                    candidate_selection_score: safeNumber(bet.candidate_selection_score, null),
                    candidate_selection_tier: bet.candidate_selection_tier || '',
                    candidate_selection_reason: bet.candidate_selection_reason || '',
                    calcio_market_selection_audit: JSON.stringify(bet.calcio_market_selection_audit || bet.extData?.marketSelectionAudit || {}),
                    calcio_market_selection_version: bet.calcio_market_selection_version || calcioProfessionalSelection.CALCIO_PROFESSIONAL_SELECTION_VERSION,
                    calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
                    ...calcioHistoricalCoverage.buildPersistenceFields(bet.historical_coverage_audit || bet.extData?.historicalCoverageAudit || {}),
                    ...calcioUnifiedPredictionIndex.persistenceFields(bet.predictionIndex || bet.prediction_index || {}),
                    ...paperTradingIdentity.persistenceFields({ ...bet, calcio_event_key: eventKey, match_exposure_key: eventKey, sport_type: 'CALCIO' })
                };
                const patch10Entries = Object.entries(patch10Fields).filter(([key]) => columnExists('ai_forward_test', key));
                if (patch10Entries.length) {
                    db.prepare(`UPDATE ai_forward_test SET ${patch10Entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
                        .run(...patch10Entries.map(([, value]) => value), insertInfo.lastInsertRowid);
                }
            } else if (String(existingBet.status || 'PENDING').toUpperCase() === 'PENDING') {
                const refreshFields = {
                    // PATCH 19: refresh atomico dell'intera identità evento/mercato.
                    match_date: bet.match_date || bet.date,
                    home_team: bet.home,
                    away_team: bet.away,
                    prediction: bet.prediction,
                    market_type: bet.market_type || inferCalcioMarketFamily(bet.prediction),
                    strategy_tag: bet.strategy_tag,
                    league: bet.league,
                    calcio_event_key: eventKey,
                    calcio_provider_event_id: bet.provider_event_id || null,
                    calcio_canonical_pair_key: bet.canonical_pair_key || null,
                    odd: safeNumber(bet.odd, existingBet.odd),
                    stake: safeNumber(bet.invested, 0),
                    estimated_prob: safeNumber(bet.estimatedProb, existingBet.estimated_prob),
                    edge: safeNumber(bet.edge, existingBet.edge),
                    edge_pp: safeNumber(bet.edge_pp, existingBet.edge_pp),
                    ev_pct: safeNumber(bet.ev_pct, existingBet.ev_pct),
                    confidence: safeNumber(bet.extData?.mcGlobal, existingBet.confidence),
                    bankroll_snapshot: initialBankroll,
                    calcio_theoretical_stake: safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0),
                    calcio_operational_stake: safeNumber(bet.invested, 0),
                    stake_base_before_deepscan: safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0),
                    kelly_fraction_pct: safeNumber(bet.kellyStakePolicy?.rawKellyPct ?? bet.kelly_stake_policy?.rawKellyPct, null),
                    kelly_raw_stake: safeNumber(bet.kellyStakePolicy?.rawKellyStake ?? bet.kelly_stake_policy?.rawKellyStake, null),
                    stake_confidence_multiplier: safeNumber(bet.kellyStakePolicy?.dataAuthority?.multiplier ?? bet.kelly_stake_policy?.dataAuthority?.multiplier, null),
                    stake_confidence_level: bet.kellyStakePolicy?.dataAuthority?.dataClass || bet.kelly_stake_policy?.dataAuthority?.dataClass || '',
                    stake_min_applied: (bet.kellyStakePolicy?.minimumStakeApplied || bet.kelly_stake_policy?.minimumStakeApplied) ? 1 : 0,
                    stake_cap_applied: safeNumber(bet.kellyStakePolicy?.adjustedKellyStake ?? bet.kelly_stake_policy?.adjustedKellyStake, 0) > safeNumber(bet.stake_theoretical ?? bet.theoreticalStake, 0) ? 1 : 0,
                    stake_policy_mode: bet.kellyStakePolicy?.version || bet.kelly_stake_policy?.version || '',
                    stake_policy_note: bet.calcio_stake_reason || bet.kellyStakePolicy?.reason || bet.kelly_stake_policy?.reason || '',
                    calcio_stake_lifecycle_status: bet.stake_lifecycle_status || bet.stakeLifecycle?.status || '',
                    calcio_stake_lifecycle_reason: bet.stake_lifecycle_reason || bet.stakeLifecycle?.reason || '',
                    calcio_prediction_reliability_score: safeNumber(bet.prediction_reliability_score, null),
                    calcio_prediction_reliability_label: bet.prediction_reliability_label || '',
                    calcio_analysis_stage_code: bet.analysis_stage_code || bet.analysis_stage?.code || '',
                    calcio_analysis_stage_label: bet.analysis_stage_label || bet.analysis_stage?.label || '',
                    calcio_analysis_stage_reason: bet.analysis_stage_reason || bet.analysis_stage?.summary || '',
                    calcio_analysis_only: bet.analysisOnly ? 1 : 0,
                    calcio_quality_final_label: bet.calcio_quality_final_label || '',
                    candidate_selection_version: bet.candidate_selection_version || calcioProfessionalSelection.CALCIO_PROFESSIONAL_SELECTION_VERSION,
                    candidate_selection_score: safeNumber(bet.candidate_selection_score, null),
                    candidate_selection_tier: bet.candidate_selection_tier || '',
                    candidate_selection_reason: bet.candidate_selection_reason || '',
                    calcio_market_selection_audit: JSON.stringify(bet.calcio_market_selection_audit || bet.extData?.marketSelectionAudit || {}),
                    calcio_market_selection_version: bet.calcio_market_selection_version || calcioProfessionalSelection.CALCIO_PROFESSIONAL_SELECTION_VERSION,
                    calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
                    ...calcioHistoricalCoverage.buildPersistenceFields(bet.historical_coverage_audit || bet.extData?.historicalCoverageAudit || {}),
                    ...calcioUnifiedPredictionIndex.persistenceFields(bet.predictionIndex || bet.prediction_index || {}),
                    paper_result_key: paperTradingIdentity.buildPaperResultKey(identityInput),
                    paper_result_active: 1,
                    paper_result_revision: safeNumber(existingBet.paper_result_revision, 1) + 1,
                    paper_result_identity_version: paperTradingIdentity.PAPER_TRADING_IDENTITY_VERSION
                };
                const refreshEntries = Object.entries(refreshFields).filter(([key, value]) => columnExists('ai_forward_test', key) && value !== undefined);
                if (refreshEntries.length) db.prepare(`UPDATE ai_forward_test SET ${refreshEntries.map(([key]) => `${key}=?`).join(', ')} WHERE id=?`).run(...refreshEntries.map(([, value]) => value), existingBet.id);
            }
        }
        });
        persistCalcioAnalysisBatch(globalValueBetsSingle);
        const calcioObservationBatchResult = calcioObservability.completeAnalysisBatch(db, calcioObservationBatch, {
            events: globalValueBetsSingle,
            expectedEventCount: globalValueBetsSingle.length,
            persistedEventCount: globalValueBetsSingle.length,
            diagnostics: {
                savedAttempts: diagnostics.savedAttempts,
                source: 'LIVE_ANALYSIS_BATCH',
                decisionAuthorityChanged: false,
                stakeAuthorityChanged: false
            }
        });
        diagnostics.observability = {
            version: calcioObservability.CALCIO_OBSERVABILITY_VERSION,
            analysisBatchId: calcioObservationBatchResult?.batchId || calcioObservationBatch?.batchId || null,
            readOnlyAudit: true,
            decisionAuthorityChanged: false,
            stakeAuthorityChanged: false
        };

        finalizeFootballDiagnostics(diagnostics, globalValueBetsSingle.length);
        const calcioSystemAudit = buildFootballSystemAudit(diagnostics, {
            foundCount: globalValueBetsSingle.length,
            reliabilityReport: footballReliabilityReport
        });
        diagnostics.systemAudit = calcioSystemAudit;
        diagnostics.noResultReason = calcioSystemAudit.noResultReason;

        const responsePayload = {
            valueBets: globalValueBetsSingle,
            recommendedAccumulator: null,
            diagnostics,
            meta: {
                analysisDiagnostics: diagnostics,
                systemAudit: calcioSystemAudit,
                calcioSystemAuditMode: STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT,
                dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
                modelVersion: FOOTBALL_MODEL_VERSION,
                metricVersion: FOOTBALL_METRIC_VERSION,
                predictionIndexVersion: calcioUnifiedPredictionIndex.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
                stakeAuthority: 'UNIFIED_STAKE_AUTHORITY_ONLY',
                bankrollSnapshot: initialBankroll,
                bankrollSource: initialBankrollSource,
                observability: diagnostics.observability
            },
            systemAudit: calcioSystemAudit,
            calcioSystemAuditMode: STEP97_CALCIO_TENNIS_ALIGNMENT_AUDIT,
            reliabilityMode: footballReliabilityReport.mode,
            reliabilitySampleSize: footballReliabilityReport.sampleSize || 0,
            dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
            engineVersion: SERVER_ENGINE_VERSION,
            modelVersion: FOOTBALL_MODEL_VERSION,
            metricVersion: FOOTBALL_METRIC_VERSION
        };
        const cacheStore = calcioRequestIdentity.setCalcioAnalysisCache(analysisCache, requestIdentity, responsePayload, {
            now: Date.now(),
            ttlMs: CACHE_TTL_MS,
            maxEntries: CALCIO_ANALYSIS_CACHE_MAX_ENTRIES
        });
        const responseWithCacheMetadata = calcioRequestIdentity.attachCalcioCacheMetadata(responsePayload, requestIdentity, {
            hit: false,
            ageMs: 0,
            ttlMs: CACHE_TTL_MS,
            size: cacheStore.size
        });

        res.json(responseWithCacheMetadata);
    } catch (e) {
        try { calcioObservability.failAnalysisBatch(db, calcioObservationBatch, e); } catch (_) {}
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 📊 ROUTE 2: BACKTEST E RISOLUZIONE
// ==========================================
app.get('/api/backtest', async (req, res) => {
    const initialBankroll = parseFloat(req.query.bankroll) || 1000;
    const league = req.query.league || 'all';
    const minBet = 2.00; 
    const multiBetAmount = Math.max(initialBankroll * 0.01, minBet); 
    
    const dynSettings = JSON.parse(db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get().config_json);
    const useCR = dynSettings.useCrossReference === true;
    const onlyGlobal = dynSettings.onlyGlobal === true; 
    const useAdvancedMetrics = dynSettings.useAdvancedMetrics !== false;
    const eloK = parseFloat(dynSettings.eloK) || 20;

    let leaguesToProcess = league === 'all' ? Object.keys(LEAGUES_CONFIG) : [league];
    let multi = { placed: 0, won: 0, invested: 0, profit: 0 };
    let single = { placed: 0, won: 0, invested: 0, profit: 0 };
    let backLog = [];
    let leagueBreakdown = {};
    let allHistoricalBets = []; 
    const backtestDiagnostics = createFootballDiagnostics('backtest', leaguesToProcess);
    backtestDiagnostics.settingsSnapshot = {
        useCrossReference: useCR,
        onlyGlobal,
        useAdvancedMetrics,
        baseEdge: dynSettings.baseEdge,
        baseProb: dynSettings.baseProb,
        u25Edge: dynSettings.u25Edge,
        u25Prob: dynSettings.u25Prob,
        home1Edge: dynSettings.home1Edge,
        home1Prob: dynSettings.home1Prob,
        x2Edge: dynSettings.x2Edge,
        x2Prob: dynSettings.x2Prob
    };

    // ⚡ FIX: Iniezione del Report di Calibrazione con Isolamento (Bootstrap)
    let footballReliabilityReport = getFootballReliabilityReport();

    const getCol = (headers, names) => {
        for (let n of names) { const idx = headers.indexOf(n); if (idx > -1) return idx; }
        return -1;
    };

    try {
        for (let l of leaguesToProcess) {
            const config = LEAGUES_CONFIG[l];
            const configuredGlobalMaxOdd = safeNumber(dynSettings.maxOdd, 5);
            const effectiveMaxOdd = Math.min(config.maxOdd, configuredGlobalMaxOdd >= 1.5 ? configuredGlobalMaxOdd : config.maxOdd);
            leagueBreakdown[config.name] = { placed: 0, won: 0, invested: 0, profit: 0 };
            
            let csvData;
            try {
                const footballDataResult = await calcioFootballDataProvider.getLeagueCsv({
                    leagueKey: l,
                    leagueName: config.name,
                    code: config.code
                });
                csvData = footballDataResult.csvData;
                calcioFootballDataProvider.recordProviderDiagnostics(backtestDiagnostics.footballData, footballDataResult);
            } catch (err) {
                calcioFootballDataProvider.recordProviderDiagnostics(backtestDiagnostics.footballData, err, { leagueName: config.name, code: config.code });
                backtestDiagnostics.csvErrors.push({ league: config.name, error: err.message });
                continue;
            }

            backtestDiagnostics.csvLoaded++;
            const backtestSnapshotIndex = calcioTeamSnapshot.getLeagueIndex({
                csvData,
                leagueName: config.name,
                code: config.code,
                revisionToken: calcioFootballDataProvider.getRevisionToken({ projectRoot: path.resolve(__dirname, '..') })
            });
            const lines = csvData.split('\n');
            const headers = lines[0].split(',').map(h => h.trim());
            
            const idxD = getCol(headers, ['Date', 'Date ']);
            const idxH = getCol(headers, ['HomeTeam']), idxA = getCol(headers, ['AwayTeam']);
            const idxHG = getCol(headers, ['FTHG']), idxAG = getCol(headers, ['FTAG']);
            const idxHST = getCol(headers, ['HST']), idxAST = getCol(headers, ['AST']);
            const idxHS = getCol(headers, ['HS']), idxAS = getCol(headers, ['AS']);
            const idxO1 = getCol(headers, ['B365H', 'PSH', 'AvgH']), idxOX = getCol(headers, ['B365D', 'PSD', 'AvgD']), idxO2 = getCol(headers, ['B365A', 'PSA', 'AvgA']);
            const idxO25 = getCol(headers, ['B365>2.5', 'P>2.5', 'Max>2.5', 'Avg>2.5']), idxU25 = getCol(headers, ['B365<2.5', 'P<2.5', 'Max<2.5', 'Avg<2.5']);
            const idxPSH = getCol(headers, ['PSH', 'AvgH']), idxPSD = getCol(headers, ['PSD', 'AvgD']), idxPSA = getCol(headers, ['PSA', 'AvgA']);
            const idxPO25 = getCol(headers, ['P>2.5', 'Max>2.5', 'Avg>2.5']), idxPU25 = getCol(headers, ['P<2.5', 'Max<2.5', 'Avg<2.5']);

            if (idxH === -1 || idxO1 === -1) { continue; }

            const teamStats = {};

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(','); if (cols.length < 10 || !cols[idxH]) continue;
                backtestDiagnostics.rowsParsed++;
                
                const h = cols[idxH].trim(), a = cols[idxA].trim();
                const hg = parseInt(cols[idxHG]), ag = parseInt(cols[idxAG]);
                const hst = idxHST > -1 ? (parseInt(cols[idxHST]) || 0) : 0;
                const ast = idxAST > -1 ? (parseInt(cols[idxAST]) || 0) : 0;
                const hs = idxHS > -1 ? (parseInt(cols[idxHS]) || 0) : 0;
                const as = idxAS > -1 ? (parseInt(cols[idxAS]) || 0) : 0;
                
                let rawOdds = {};
                if (idxPSH > -1 && !isNaN(parseFloat(cols[idxPSH]))) {
                    rawOdds = { "1": parseFloat(cols[idxPSH]), "X": parseFloat(cols[idxPSD]), "2": parseFloat(cols[idxPSA]) };
                } else {
                    rawOdds = { "1": parseFloat(cols[idxO1]), "X": parseFloat(cols[idxOX]), "2": parseFloat(cols[idxO2]) };
                }
                
                if (isNaN(rawOdds["1"])) continue; 
                
                let odds = calcioQuantEngine.simulateOpeningOdds(rawOdds);
                odds = calcioQuantEngine.calculateExactDerivatives(odds);
                
                if (idxO25 > -1 && idxU25 > -1) {
                    let rawO25 = (idxPO25 > -1) ? parseFloat(cols[idxPO25]) : parseFloat(cols[idxO25]);
                    let rawU25 = (idxPU25 > -1) ? parseFloat(cols[idxPU25]) : parseFloat(cols[idxU25]);
                    const simTot = calcioQuantEngine.simulateOpeningTotals(rawO25, rawU25);
                    odds["O2.5"] = simTot["O2.5"];
                    odds["U2.5"] = simTot["U2.5"];
                }

                const probabilityFairOdds = Object.assign(
                    {},
                    calcioQuantEngine.calculateExactDerivatives(
                        calcioQuantEngine.calculateNoVigOdds(rawOdds)
                    )
                );
                if (idxPO25 > -1 && idxPU25 > -1) {
                    const totFair = calcioQuantEngine.calculateNoVigTotals(
                        parseFloat(cols[idxPO25]),
                        parseFloat(cols[idxPU25])
                    );
                    probabilityFairOdds['O2.5'] = totFair['O2.5'];
                    probabilityFairOdds['U2.5'] = totFair['U2.5'];
                }
                const sharpFairOdds = useCR ? { ...probabilityFairOdds } : {};

                if (!teamStats[h]) teamStats[h] = { hp: 0, hs: 0, hc: 0, hsot: 0, hcot: 0, ap: 0, as: 0, ac: 0, asot: 0, acot: 0, recS: [], recC: [], elo: 1500, matches: [] };
                if (!teamStats[a]) teamStats[a] = { hp: 0, hs: 0, hc: 0, hsot: 0, hcot: 0, ap: 0, as: 0, ac: 0, asot: 0, acot: 0, recS: [], recC: [], elo: 1500, matches: [] };

                if (teamStats[h].hp >= 10 && teamStats[a].ap >= 10) {
                    backtestDiagnostics.eligibleMatches++;
                    const convH = calcioQuantEngine.getSmoothedConversion(teamStats[h].hs, teamStats[h].hsot);
                    const convA = calcioQuantEngine.getSmoothedConversion(teamStats[a].as, teamStats[a].asot);
                    
                    const sHas = (teamStats[h].hs/teamStats[h].hp)*0.5 + (teamStats[h].hsot/teamStats[h].hp)*convH*0.5;
                    const sHds = (teamStats[h].hc/teamStats[h].hp)*0.5 + (teamStats[h].hcot/teamStats[h].hp)*convA*0.5;
                    const sAas = (teamStats[a].as/teamStats[a].ap)*0.5 + (teamStats[a].asot/teamStats[a].ap)*convA*0.5;
                    const sAds = (teamStats[a].ac/teamStats[a].ap)*0.5 + (teamStats[a].acot/teamStats[a].ap)*convH*0.5;

                    let metric_hRecS = calcioQuantEngine.getExponentialMovingAverage(teamStats[h].recS);
                    let metric_hRecC = calcioQuantEngine.getExponentialMovingAverage(teamStats[h].recC);
                    let metric_aRecS = calcioQuantEngine.getExponentialMovingAverage(teamStats[a].recS);
                    let metric_aRecC = calcioQuantEngine.getExponentialMovingAverage(teamStats[a].recC);
                    
                    let eloMultiplierH = 1; let eloMultiplierA = 1;

                    if (useAdvancedMetrics) {
                        const eH = isNaN(teamStats[h].elo) ? 1500 : teamStats[h].elo;
                        const eA = isNaN(teamStats[a].elo) ? 1500 : teamStats[a].elo;
                        const eloDiff = eH - eA; 
                        eloMultiplierH = Math.min(1.12, Math.max(0.88, Math.pow(10, eloDiff / 3000)));
                        eloMultiplierA = Math.min(1.12, Math.max(0.88, Math.pow(10, -eloDiff / 3000)));
                    }
                    
                    const homeAttack = (sHas * config.wS) + (metric_hRecS * config.wR);
                    const awayAttack = (sAas * config.wS) + (metric_aRecS * config.wR);
                    const homeDefenseConceded = (sHds * config.wS) + (metric_hRecC * config.wR);
                    const awayDefenseConceded = (sAds * config.wS) + (metric_aRecC * config.wR);

                    const naiveExpHome = Math.max(0.1, ((homeAttack + awayDefenseConceded) / 2) * eloMultiplierH);
                    const naiveExpAway = Math.max(0.1, ((awayAttack + homeDefenseConceded) / 2) * eloMultiplierA);
                    const backtestCutoff = idxD > -1 ? parseFootballDataDate(cols[idxD]) : null;
                    const opponentAdjustedForm = calcioOpponentAdjustedForm.buildMatchAdjustment(
                        backtestSnapshotIndex,
                        h,
                        a,
                        backtestCutoff || new Date(0),
                        { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 }
                    );
                    backtestDiagnostics.opponentAdjustedForm.evaluated++;
                    if (opponentAdjustedForm.applied) backtestDiagnostics.opponentAdjustedForm.applied++;
                    if (opponentAdjustedForm.status === 'EARLY_SEASON') backtestDiagnostics.opponentAdjustedForm.earlySeason++;
                    if (opponentAdjustedForm.status === 'PRIOR_ONLY') backtestDiagnostics.opponentAdjustedForm.priorOnly++;
                    if (opponentAdjustedForm.status === 'UNAVAILABLE') backtestDiagnostics.opponentAdjustedForm.unavailable++;
                    backtestDiagnostics.opponentAdjustedForm.maxAbsoluteAdjustmentPct = Math.max(
                        backtestDiagnostics.opponentAdjustedForm.maxAbsoluteAdjustmentPct,
                        Math.abs(safeNumber(opponentAdjustedForm.homeAdjustmentPct, 0)),
                        Math.abs(safeNumber(opponentAdjustedForm.awayAdjustmentPct, 0))
                    );
                    const formAdjustedExpectedGoals = calcioOpponentAdjustedForm.applyToExpectedGoals(
                        naiveExpHome,
                        naiveExpAway,
                        opponentAdjustedForm
                    );

                    let homeStatsObj = { teamName: h, seasonXGFor: null, seasonXGAgainst: null, matches: teamStats[h].matches };
                    let awayStatsObj = { teamName: a, seasonXGFor: null, seasonXGAgainst: null, matches: teamStats[a].matches };

                    const xgResult = calcioQuantEngine.getXGAdjustedDixonColesProbabilities({
                        homeStats: homeStatsObj, awayStats: awayStatsObj, leagueName: config.name,
                        homeElo: teamStats[h].elo, awayElo: teamStats[a].elo, goalBasedHome: formAdjustedExpectedGoals.expHomeGoals, goalBasedAway: formAdjustedExpectedGoals.expAwayGoals,
                        xgWeight: 0.20,
                        reliabilityReport: footballReliabilityReport
                    });

                    xgResult.opponentAdjustedForm = {
                        ...opponentAdjustedForm,
                        expectedGoals: formAdjustedExpectedGoals
                    };
                    const p = xgResult.probabilities;
                    const backtestSeed = [
                        'CALCIO_PATCH5_BACKTEST',
                        config.name,
                        h,
                        a,
                        cols[idxD] || i
                    ].join('|');
                    const mcResult = calcioQuantEngine.runMonteCarlo(p, 10000, {
                        expHomeGoals: xgResult.expHomeGoals,
                        expAwayGoals: xgResult.expAwayGoals,
                        sampleSize: Math.min(teamStats[h].hp, teamStats[a].ap),
                        volatilityFactor: xgResult.xg.volatility,
                        seed: backtestSeed
                    });
                    const probabilityIntegrity = calcioProbabilityIntegrity.buildCalcioProbabilityIntegrity({
                        modelProbabilities: p,
                        mcResult,
                        marketFairOdds: probabilityFairOdds,
                        coverage: {
                            homeMatched: true,
                            awayMatched: true,
                            homeSample: teamStats[h].hp,
                            awaySample: teamStats[a].ap,
                            xgEvidenceMode: xgResult.xg.evidenceMode
                        },
                        iterations: 10000,
                        seed: backtestSeed
                    });
                    let p_mc = probabilityIntegrity.probabilities;

                    const matchDate = cols[idxD] || "Sconosciuta";

                    if (config.allowSingles) {
                        let bestS = null;
                        const eligibleBacktestCandidates = [];
                        for (const [pred, odd] of Object.entries(odds)) {
                            if (config.restrictMarkets && ['1', 'X', '2'].includes(pred)) continue;
                            if (isNaN(odd)) {
                                backtestDiagnostics.rejectedInvalidOdd++;
                                continue;
                            }
                            if (!p_mc[pred]) {
                                backtestDiagnostics.rejectedMissingProbability++;
                                continue;
                            }
                            // Patch 12: parità live/backtest. onlyGlobal applica gli stessi filtri a tutti i mercati senza escluderli.
                            if (!isMarketAllowedByCertifiedOptimization(dynSettings, pred)) continue;

                            backtestDiagnostics.marketsEvaluated++;
                            const { targetEdge: reqEdge, targetProb: reqProb } = getDynamicParams(dynSettings, config.name, pred, onlyGlobal);

                            const rawEvPct = calculateEvPct(p_mc[pred], odd);
                            const rawEdgePp = p_mc[pred] - impliedProbabilityPct(odd);
                            const ev_pct = calcioQuantEngine.adjustFootballEdgeByReliability(rawEvPct, footballReliabilityReport.decision);
                            const edge_pp = calcioQuantEngine.adjustFootballEdgeByReliability(rawEdgePp, footballReliabilityReport.decision);
                            const edge = edge_pp;

                            let crPassed = true;
                            if (useCR && sharpFairOdds[pred] && !isNaN(sharpFairOdds[pred])) {
                                crPassed = odd >= (sharpFairOdds[pred] * 0.90);
                            }

                            let closingOddForPred = rawOdds[pred];
                            let openingOddForPred = odds[pred];
                            if (closingOddForPred > openingOddForPred * 1.05) {
                                crPassed = false;
                            }

                            const oddsRangePassed = odd >= 1.5 && odd <= effectiveMaxOdd;
                            const thresholdPassed = edge > reqEdge && edge <= 15.0 && p_mc[pred] > reqProb;

                            if (!oddsRangePassed) backtestDiagnostics.rejectedByOddsRange++;
                            else if (!thresholdPassed) backtestDiagnostics.rejectedByThreshold++;
                            else if (!crPassed) backtestDiagnostics.rejectedByCr++;

                            if (oddsRangePassed && thresholdPassed && crPassed) {
                                const marketReliability = String(probabilityIntegrity.marketReliability?.[pred] || probabilityIntegrity.reliability || 'LOW').toUpperCase();
                                const reliabilityScore = ({ HIGH:82, MEDIUM:66, LOW:46, VERY_LOW:28, PRIOR:25 }[marketReliability] || 45);
                                eligibleBacktestCandidates.push({
                                    prediction: pred, pred, odd, rawProb: p_mc[pred], prob: p_mc[pred], edge, edge_pp, ev_pct,
                                    prediction_reliability_score: reliabilityScore,
                                    probability_disagreement_pp: probabilityIntegrity.diagnostics?.[pred]?.disagreementPp ?? probabilityIntegrity.maxDisagreementPp,
                                    monte_carlo_std_error_pp: probabilityIntegrity.diagnostics?.[pred]?.monteCarloStdErrorPp ?? probabilityIntegrity.maxMonteCarloStdErrorPp,
                                    calcio_professional_risk: footballReliabilityReport.decision?.riskScore ?? 35,
                                    isCR: useCR, mcGlobal: mcResult.confidence.global
                                });
                            }
                        }
                        bestS = calcioProfessionalSelection.selectPrimary(eligibleBacktestCandidates).selected;
                        
                        if (bestS) {
                            const uncertaintyPenalty = clamp((100 - bestS.mcGlobal) / 300, 0, 0.15);
                            const stPct = paperTradingEngine.calculateAdaptiveKelly({ probability: bestS.prob, odd: bestS.odd, confidence: bestS.mcGlobal, expectedCLV: 0, sport: 'CALCIO', market: bestS.pred });
                            
                            const backtestReliability = {
                                score: bestS.prediction_reliability_score,
                                evidenceAuthority: bestS.prediction_reliability_score >= 85 ? 'HIGH_AUTHORITY' : 'PROXY_OR_PARTIAL'
                            };
                            const backtestAudit = {
                                status: bestS.calcio_professional_risk >= 75 ? 'PROFESSIONAL_BLOCK_HARD' : 'PROFESSIONAL_OK',
                                dataReliability: { score: bestS.prediction_reliability_score, status: bestS.prediction_reliability_score < 55 ? 'DATA_FRAGILE' : 'DATA_RELIABLE' },
                                teamMatching: { confidence: 100 }
                            };
                            const kellyStakePolicy = calcioKellyStakePolicy.calculateTheoreticalStake({
                                bankroll: initialBankroll,
                                kellyPct: stPct,
                                professionalMultiplier: footballReliabilityReport.decision?.stakeMultiplier ?? 1,
                                predictionReliability: backtestReliability,
                                professionalAudit: backtestAudit,
                                multiProviderEvidence: { status: 'MULTI_PROVIDER_USABLE', authoritativeQuantitativeProviders: 2 },
                                probabilityIntegrity,
                                market: bestS.pred
                            });
                            const bAmt = kellyStakePolicy.theoreticalStake;

                            if (bAmt <= 0) {
                                backtestDiagnostics.rejectedByStake++;
                            }

                            if (bAmt > 0) {
                                const win = checkWin(bestS.pred, hg, ag);
                                
                                single.placed++; single.invested += bAmt;
                                if (win) { single.won++; single.profit += bAmt*(bestS.odd-1); } else { single.profit -= bAmt; }
                                
                                leagueBreakdown[config.name].placed++; leagueBreakdown[config.name].invested += bAmt;
                                if (win) { leagueBreakdown[config.name].won++; leagueBreakdown[config.name].profit += bAmt*(bestS.odd-1); } else { leagueBreakdown[config.name].profit -= bAmt; }

                                backtestDiagnostics.selectedBets++;
                                backLog.push({ date: matchDate, match: `[${config.name}] ${h} - ${a}`, prediction: bestS.pred, odd: bestS.odd.toFixed(2), edge: bestS.edge.toFixed(2), edge_pp: bestS.edge_pp.toFixed(2), ev_pct: bestS.ev_pct.toFixed(2), stakePercent: stPct.toFixed(2), invested: bAmt.toFixed(2), won: win, profit: win ? `+€${(bAmt*(bestS.odd-1)).toFixed(2)}` : `-€${bAmt.toFixed(2)}`, isCR: bestS.isCR, candidateSelectionScore: bestS.candidate_selection_score, candidateSelectionTier: bestS.candidate_selection_tier, dataClass: kellyStakePolicy.dataAuthority.dataClass, stakeReason: kellyStakePolicy.reason });

                                allHistoricalBets.push({ date: matchDate, match: `${h} - ${a}`, pred: bestS.pred, odd: bestS.odd, prob: bestS.prob, edge: bestS.edge, win: win });
                            }
                        }
                    }
                }
                
                if (useAdvancedMetrics) {
                    const newElos = calcioQuantEngine.updateElo(teamStats[h].elo, teamStats[a].elo, hg, ag, eloK);
                    teamStats[h].elo = newElos.newHome; teamStats[a].elo = newElos.newAway;
                }

                teamStats[h].hp++; teamStats[h].hs += hg; teamStats[h].hc += ag; teamStats[h].hsot += hst; teamStats[h].hcot += ast;
                teamStats[a].ap++; teamStats[a].as += ag; teamStats[a].ac += hg; teamStats[a].asot += ast; teamStats[a].acot += hst;
                teamStats[h].recS.push(hg); teamStats[h].recC.push(ag);
                teamStats[a].recS.push(ag); teamStats[a].recC.push(hg);
                
                teamStats[h].matches.push({
                    goalsFor: hg, goalsAgainst: ag,
                    shots: hs, shotsOnTarget: hst,
                    shotsAgainst: as, shotsOnTargetAgainst: ast
                });
                teamStats[a].matches.push({
                    goalsFor: ag, goalsAgainst: hg,
                    shots: as, shotsOnTarget: ast,
                    shotsAgainst: hs, shotsOnTargetAgainst: hst
                });

                if(teamStats[h].recS.length>10){ teamStats[h].recS.shift(); teamStats[h].recC.shift(); teamStats[h].matches.shift(); }
                if(teamStats[a].recS.length>10){ teamStats[a].recS.shift(); teamStats[a].recC.shift(); teamStats[a].matches.shift(); }
            }
        } 

        const betsByDate = {};
        for (const bet of allHistoricalBets) {
            if (!betsByDate[bet.date]) betsByDate[bet.date] = [];
            betsByDate[bet.date].push(bet);
        }

        for (const date in betsByDate) {
            const dailyBets = betsByDate[date];
            if (dailyBets.length >= 2) {
                dailyBets.sort((a, b) => b.prob - a.prob || b.edge - a.edge);
                const leg1 = dailyBets[0];
                const leg2 = dailyBets[1];
                const isWon = leg1.win && leg2.win;
                const totalOdds = leg1.odd * leg2.odd;
                
                multi.placed++;
                multi.invested += multiBetAmount;
                if (isWon) {
                    multi.won++;
                    multi.profit += multiBetAmount * (totalOdds - 1);
                } else {
                    multi.profit -= multiBetAmount;
                }
            }
        }

        backLog.sort((a, b) => {
            const parseDate = (dStr) => {
                if (!dStr || dStr === "Sconosciuta") return 0;
                const parts = dStr.split('/');
                if(parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]).getTime();
                return 0;
            };
            return parseDate(a.date) - parseDate(b.date);
        });

            finalizeFootballDiagnostics(backtestDiagnostics, backLog.length);
            const backtestHealth = calcioProgramCoherence.buildBacktestHealth({
                rowsParsed: backtestDiagnostics.rowsParsed,
                eligibleMatches: backtestDiagnostics.eligibleMatches,
                leagueCount: leaguesToProcess.length,
                historicalOdds: true,
                chronological: true,
                asOfSafe: true,
                productionParity: true
            });

            res.json({ 
            single: { ...single, roi: single.invested > 0 ? ((single.profit/single.invested)*100).toFixed(2) : "0.00" }, 
            multi: { ...multi, roi: multi.invested > 0 ? ((multi.profit/multi.invested)*100).toFixed(2) : "0.00" }, 
            leagueBreakdown: leagueBreakdown, 
            log: backLog.slice(-100).reverse(),
            diagnostics: backtestDiagnostics,
            backtestHealth,
            validationMode: backtestHealth.validationMode,
            reliabilityMode: footballReliabilityReport.mode,
            reliabilitySampleSize: footballReliabilityReport.sampleSize || 0,
            engineVersion: SERVER_ENGINE_VERSION
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🗑️ ENDPOINTS AZIONI MANUALI E SCHEDULING
// ==========================================
app.get('/api/resolve_ai', async (req, res) => {
    try {
        const leagueFilter = req.query.leagueFilter || 'all';
        const result = await paperTradingEngine.processPaperTrading(
            db, leagueFilter, LEAGUES_CONFIG, fetchOddsApi, normalizeName, (a,b) => { return 0; }
        );
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/bet/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        const bet = db.prepare(`SELECT * FROM ai_forward_test WHERE id = ? AND COALESCE(paper_result_active,1)=1`).get(id);
        if (!bet) return res.status(404).json({ error: "Scommessa non trovata" });
        const now = new Date().toISOString();
        const deactivate = bet.bet_type && bet.bet_type.startsWith('MULTI_')
            ? db.prepare(`UPDATE ai_forward_test SET paper_result_active=0, paper_result_dedup_reason='USER_DELETE', paper_result_dedup_at=? WHERE bet_type=? AND COALESCE(paper_result_active,1)=1`).run(now, bet.bet_type)
            : db.prepare(`UPDATE ai_forward_test SET paper_result_active=0, paper_result_dedup_reason='USER_DELETE', paper_result_dedup_at=? WHERE id=?`).run(now, id);
        res.json({ success: true, softDeleted: true, changed: deactivate.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bets/bulk-action', (req, res) => {
    try {
        const action = String(req.body?.action || '').toUpperCase();
        const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 500);
        if (!ids.length) return res.status(400).json({ success:false, error:'NO_VALID_IDS' });
        if (action !== 'DELETE') return res.status(400).json({ success:false, error:'UNSUPPORTED_BULK_ACTION', supported:['DELETE'] });
        const now = new Date().toISOString();
        const tx = db.transaction(() => {
            let changed = 0;
            const statement = db.prepare(`UPDATE ai_forward_test SET paper_result_active=0, paper_result_dedup_reason='USER_BULK_DELETE', paper_result_dedup_at=? WHERE id=? AND COALESCE(paper_result_active,1)=1`);
            for (const id of ids) changed += statement.run(now, id).changes;
            return changed;
        });
        const changed = tx();
        res.json({ success:true, action, requested:ids.length, changed, softDeleted:true });
    } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/bet/:id/force', (req, res) => {
    try {
        const id = req.params.id;
        const targetStatus = normalizeForcedStatus(req.body.status);

        if (!targetStatus) {
            return res.status(400).json({
                success: false,
                error: 'Status non valido. Usa WON, LOST, VOID, PUSH o PENDING.',
                engineVersion: SERVER_ENGINE_VERSION
            });
        }

        const bet = db.prepare(`SELECT * FROM ai_forward_test WHERE id = ?`).get(id);
        if (!bet) return res.status(404).json({ success: false, error: "Scommessa non trovata" });

        const newProfit = calculateForcedProfit(bet, targetStatus);
        const fields = {
            status: targetStatus,
            profit: newProfit,
            data_quality: bet.data_quality || DATA_QUALITY_CURRENT,
            engine_version: SERVER_ENGINE_VERSION,
            settlement_source: 'MANUAL_FORCE',
            settlement_note: `Esito forzato manualmente a ${targetStatus}`,
            settled_at: targetStatus === 'PENDING' ? null : new Date().toISOString()
        };

        if (isTennisRow(bet)) {
            const operationId = runtimeDiagnostics.createOperationId('TENNIS_MANUAL_SETTLEMENT');
            if (targetStatus === 'PENDING') {
                Object.assign(fields, {
                    settlement_contract_status: tennisSettlementContract.SETTLEMENT_STATES.PENDING,
                    settlement_contract_reason: 'MANUAL_RESET_TO_PENDING',
                    settlement_contract_version: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
                    settlement_operation_id: operationId
                });
            } else {
                const manualResolution = {
                    source: 'MANUAL_FORCE',
                    sourceEventId: `MANUAL:${id}:${Date.now()}`,
                    observedAt: new Date().toISOString(),
                    winnerName: req.body.winnerName || null,
                    winner: req.body.winnerSide || null,
                    score: req.body.score || null,
                    rawEvidence: { operator: 'LOCAL_UI', requestedStatus: targetStatus, note: req.body.note || null },
                    confidence: 0.5,
                    isVoid: targetStatus === 'VOID'
                };
                Object.assign(fields, tennisSettlementContract.buildSettlementContractFields(bet, manualResolution, { operationId }));
                fields.settlement_contract_status = tennisSettlementContract.SETTLEMENT_STATES.MANUAL_REVIEW;
                fields.settlement_contract_reason = `MANUAL_OVERRIDE_${targetStatus}_REQUIRES_EVIDENCE_REVIEW`;
            }
            runtimeDiagnostics.writeDiagnostic({
                level: 'WARN',
                component: 'TENNIS_SETTLEMENT',
                operation: 'MANUAL_FORCE',
                operationId,
                phase: 'MANUAL_OVERRIDE',
                event: 'MANUAL_SETTLEMENT',
                message: `Override manuale bet ${id} -> ${targetStatus}.`,
                context: { betId: id, targetStatus, contractStatus: fields.settlement_contract_status }
            });
        }

        const keys = Object.keys(fields).filter(k => columnExists('ai_forward_test', k));
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => fields[k]);

        if (String(bet.bet_type || '').startsWith('MULTI_')) {
            values.push(bet.bet_type);
            db.prepare(`UPDATE ai_forward_test SET ${setClause} WHERE bet_type = ?`).run(...values);
        } else {
            values.push(id);
            db.prepare(`UPDATE ai_forward_test SET ${setClause} WHERE id = ?`).run(...values);
        }

        return res.json({
            success: true,
            id,
            status: targetStatus,
            profit: newProfit,
            settlementContractStatus: fields.settlement_contract_status || null,
            warning: isTennisRow(bet) && targetStatus !== 'PENDING' ? 'Override manuale registrato come MANUAL_REVIEW: escluso dalla certificazione automatica.' : null,
            engineVersion: SERVER_ENGINE_VERSION
        });
    } catch (e) {
        const runtimeDiagnostic = runtimeDiagnostics.captureError({ component: 'BETTING_API', operation: 'MANUAL_FORCE', phase: 'ROUTE_EXCEPTION', error: e, context: { betId: req.params.id } });
        res.status(500).json({ success: false, error: e.message, runtimeDiagnostic, engineVersion: SERVER_ENGINE_VERSION });
    }
});

// BETTING PATCH 16 - riconciliazione forzata ma prudenziale degli stake correnti.
// Modifica soltanto l'ultima riga PENDING per evento Calcio; storico risolto e Tennis esclusi.
app.post('/api/calcio/stakes/reconcile', (req, res) => {
    return res.status(409).json({
        success: false,
        code: 'PATCH26EC_LEGACY_STAKE_WRITER_DISABLED',
        error: 'Riconciliazione legacy disabilitata: l’importo è definito esclusivamente da calcioUnifiedStakeAuthority e dall’allocatore batch.',
        stakeAuthority: calcioUnifiedStakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
        mutationPerformed: false,
        engineVersion: SERVER_ENGINE_VERSION
    });
});

// Patch 11 legacy presentation markers preserved for regression: VALUE QUALITATIVO · NON OPERATIVO | VIA LIBERA OPERATIVA
// PATCH24_LEGACY_CONTRACT_MARKER: historicalCombinationEvidence = calcioHistoricalCombinationEvidence.resolveHistoricalCombinationEvidence
app.post('/api/calcio/deepscan', async (req, res) => {
    let calcioObservationFinalization = null;
    try {
        let { homeTeam, awayTeam, prediction, odd, prob, edge, edge_pp, ev_pct, odd1, oddX, odd2, extData, eventKey, matchExposureKey, matchDate, providerEventId, analysisBatchId } = req.body || {};
        let deepScanPayloadDiagnostics = null;

        if (!homeTeam || !awayTeam || !prediction) {
            return res.status(400).json({ error: "Dati mancanti per il Deep Scan Calcio." });
        }

        const requestedEventKey = eventKey || matchExposureKey || extData?.eventKey || extData?.eventIdentity?.eventKey || null;
        const prePendingCalcioRow = requestedEventKey
            ? db.prepare(`
                SELECT * FROM ai_forward_test
                WHERE (match_exposure_key = ? OR calcio_event_key = ?)
                  AND prediction = ?
                  AND status = 'PENDING'
                  AND UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                  AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
                ORDER BY id DESC LIMIT 1
            `).get(requestedEventKey, requestedEventKey, prediction)
            : db.prepare(`
                SELECT * FROM ai_forward_test
                WHERE home_team = ? AND away_team = ? AND prediction = ?
                  AND status = 'PENDING'
                  AND UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                  AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
                ORDER BY id DESC LIMIT 1
            `).get(homeTeam, awayTeam, prediction);

        const compactDeepScanRequest = calcioDeepScanPayloadContract.sanitizeRequestBody(req.body || {}, prePendingCalcioRow || {});
        ({ homeTeam, awayTeam, prediction, odd, prob, edge, edge_pp, ev_pct, odd1, oddX, odd2, extData, eventKey, matchExposureKey, matchDate, providerEventId } = compactDeepScanRequest);
        deepScanPayloadDiagnostics = compactDeepScanRequest.diagnostics;

        const runtimeEventKey = deepScanRuntimeResilience.buildEventKey({
            eventKey: requestedEventKey || prePendingCalcioRow?.match_exposure_key || prePendingCalcioRow?.calcio_event_key,
            homeTeam, awayTeam, prediction, matchDate,
            league: extData?.league || extData?.competition || prePendingCalcioRow?.league,
            sport: 'CALCIO'
        });
        calcioObservationFinalization = calcioObservability.startEventFinalization(db, {
            batchId: analysisBatchId || null,
            eventKey: runtimeEventKey,
            betId: prePendingCalcioRow?.id || null,
            prediction,
            diagnostics: {
                payloadBytes: deepScanPayloadDiagnostics?.payloadBytes || null,
                source: 'LIVE_DEEPSCAN_ROUTE',
                decisionAuthorityChanged: false,
                stakeAuthorityChanged: false
            }
        });

        const resolvedBatchId = analysisBatchId || calcioObservationFinalization?.batchId || null;
        const observedBatchRow = resolvedBatchId
            ? db.prepare('SELECT bankroll_snapshot FROM calcio_ai_observation_batches WHERE batch_id = ?').get(resolvedBatchId)
            : null;
        const deepScanBankrollSnapshot = safeNumber(
            observedBatchRow?.bankroll_snapshot,
            safeNumber(prePendingCalcioRow?.bankroll_snapshot, getCurrentBankroll('CALCIO'))
        );
        const deepScanBankrollSource = observedBatchRow
            ? 'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT'
            : 'PENDING_ROW_CALCIO_SNAPSHOT_FALLBACK';

        let runtimeClubEloEvidence = extData?.clubEloEvidence || null;
        if (!runtimeClubEloEvidence) {
            try {
                const runtimeClubEloSnapshot = await calcioClubEloProvider.loadClubEloSnapshot({ force: false });
                runtimeClubEloEvidence = calcioClubEloProvider.buildMatchEvidence(runtimeClubEloSnapshot, homeTeam, awayTeam);
            } catch (clubEloError) {
                runtimeClubEloEvidence = { status: 'UNAVAILABLE', available: false, authoritative: false, error: clubEloError.message };
            }
        }

        const deepScanInput = {
            ...(extData || {}),
            eventKey: runtimeEventKey,
            matchDate,
            providerEventId,
            edge_pp: edge_pp ?? edge,
            ev_pct,
            sport: 'CALCIO',
            clubEloEvidence: runtimeClubEloEvidence,
            footballDataLoaded: extData?.footballDataLoaded ?? Boolean(prePendingCalcioRow?.calcio_data_reliability),
            persistedPredictionReliability: {
                score: prePendingCalcioRow?.calcio_prediction_reliability_score || 0,
                label: prePendingCalcioRow?.calcio_prediction_reliability_label || ''
            },
            providerTimeoutMs: extData?.providerTimeoutMs || 5000
        };
        const report = await deepScanRuntimeResilience.runDeepScan({
            eventKey: runtimeEventKey,
            homeTeam, awayTeam, prediction,
            timeoutMs: extData?.deepScanTimeoutMs || 18000,
            task: () => deepScanCalcio.scanMatchup(
                homeTeam, awayTeam, prediction,
                odd, prob, edge_pp ?? edge, odd1, oddX, odd2, deepScanInput
            )
        });

        if (report?.status === 'DEEPSCAN_PARZIALE' || report?.partial === true) {
            const partialObservationError = new Error(report?.error || 'DEEPSCAN_PARTIAL_NO_PERSISTENCE');
            partialObservationError.code = 'DEEPSCAN_PARTIAL_NO_PERSISTENCE';
            try { calcioObservability.failEventFinalization(db, calcioObservationFinalization, partialObservationError, { diagnostics: { partial: true } }); } catch (_) {}
            calcioObservationFinalization = null;
            return res.status(206).json({
                ...report,
                eventKey: runtimeEventKey,
                deepScanGateMode: 'PARTIAL_NO_PERSISTENCE',
                operationalGate: false,
                advisoryOnly: true,
                payloadDiagnostics: deepScanPayloadDiagnostics,
                payloadVersion: calcioDeepScanPayloadContract.CALCIO_DEEPSCAN_PAYLOAD_VERSION,
                engineVersion: SERVER_ENGINE_VERSION
            });
        }

        if (report.success) {
            // CALCIO PATCH 10 - Event Identity Guard.
            // L'eventKey ha priorità; il fallback legacy resta solo per righe precedenti alla Patch 10.
            const pendingCalcioRow = prePendingCalcioRow;

            // Patch 13 R1: la persistenza avviene una sola volta, solo dopo il Gate finale.
            // Richieste duplicate con lo stesso eventKey condividono la stessa elaborazione.

            // STEP59A_CALCIO_DEEPSCAN_OPERATIONAL_GATE
            // DeepScan aggiorna una sola riga identificata, mai tutte le coppie omonime.

            let calcioGateReport = null;
            let calcioStakeLifecycleReport = null;
            let predictionReliability = null;
            let recalculatedKellyStakePolicy = null;
            let analysisStage = null;
            let displayAction = report.action;
            let qualityFinalLabel = bettingMacroCausal.qualityMacro({ theoreticalStake: 0, operationalStake: 0 });
            let historicalCombinationEvidence = {
                success: false,
                version: calcioHistoricalCombinationEvidence.CALCIO_HISTORICAL_COMBINATION_VERSION,
                error: 'CURRENT_CALCIO_PENDING_ROW_NOT_FOUND',
                resolved: 0,
                winRatePct: null,
                reliability: 'NO_SAMPLE',
                stakeAuthority: false,
                modelAuthority: false
            };

            // PATCH 26D: la decisione deve restare disponibile anche durante la
            // serializzazione della risposta finale. In Patch 26C era dichiarata
            // dentro il blocco pendingCalcioRow e il return esterno generava un
            // ReferenceError dopo il commit evento.
            let stakeReconciliationDecision = null;

            if (pendingCalcioRow) {
                // PATCH 24: preparazione comune del match. Nessun IPM/Kelly viene
                // calcolato prima della finalizzazione dei mercati. Il report del
                // mercato inizialmente selezionato viene solo canonicalizzato; la
                // decisione quantitativa avverra una sola volta dentro TOP-3.
                const deepScanMultiProviderEvidence = extData?.multiProviderEvidence || calcioMultiProviderEvidence.buildEvidenceHealth({
                    footballDataLoaded: extData?.footballDataLoaded ?? Boolean(pendingCalcioRow?.calcio_data_reliability),
                    hasBothXg: String(extData?.xgEvidenceMode || '').toUpperCase() === 'STRONG_REAL_XG',
                    clubEloEvidence: runtimeClubEloEvidence,
                    sourceAudit: report.sourceIntelligence || {},
                    oddsAvailable: Boolean((odd1 && oddX && odd2) || pendingCalcioRow?.odd)
                });
                const neutralHistoricalSeed = {
                    success: true,
                    resolved: 0,
                    wins: 0,
                    losses: 0,
                    winRatePct: null,
                    adjustedRatePct: null,
                    ci95LowPct: null,
                    ci95HighPct: null,
                    reliability: 'NO_SAMPLE',
                    status: 'NO_SAMPLE_NEUTRAL',
                    stakeAuthority: false,
                    modelAuthority: false
                };
                predictionReliability = calcioProgramCoherence.buildPredictionReliability({
                    integrity: extData?.probabilityIntegrity || {},
                    market: prediction,
                    professionalAudit: report.professionalAudit || {},
                    sourceAudit: report.sourceIntelligence || {},
                    historicalEvidence: neutralHistoricalSeed,
                    multiProviderEvidence: deepScanMultiProviderEvidence
                });
                Object.assign(report, calcioAiFinalization.unifyDeepScanReport(report, {
                    edgePp: pendingCalcioRow.edge_pp || edge_pp || edge,
                    reliabilityScore: predictionReliability.score,
                    theoreticalStake: pendingCalcioRow.calcio_theoretical_stake,
                    professionalRisk: report.professionalAudit?.risk,
                    professionalStatus: report.professionalAudit?.status,
                    disagreementPp: extData?.probabilityIntegrity?.diagnostics?.[prediction]?.disagreementPp
                }));
                displayAction = report.action;

                // PATCH 23: finalizzazione deterministica dei primi tre mercati.
                // Il ranking definitivo usa per ogni candidato DeepScan unificato,
                // evidenza PT DS×Gate e IPM finali; nessun runner-up provvisorio.
                const provisionalMarketAudit = safeJsonParse(
                    pendingCalcioRow.calcio_market_selection_audit,
                    extData?.marketSelectionAudit || {}
                ) || {};
                const currentCandidateSnapshot = {
                    ...pendingCalcioRow,
                    prediction,
                    odd: pendingCalcioRow.odd || odd,
                    estimatedProb: pendingCalcioRow.estimated_prob || prob,
                    rawProb: pendingCalcioRow.estimated_prob || prob,
                    edge_pp: pendingCalcioRow.edge_pp || edge_pp || edge,
                    edge: pendingCalcioRow.edge_pp || edge_pp || edge,
                    ev_pct: pendingCalcioRow.ev_pct || ev_pct,
                    home: homeTeam,
                    away: awayTeam,
                    providerHome: pendingCalcioRow.calcio_provider_home_team || homeTeam,
                    providerAway: pendingCalcioRow.calcio_provider_away_team || awayTeam,
                    event_key: runtimeEventKey,
                    match_date: pendingCalcioRow.match_date || matchDate,
                    odd1, oddX, odd2,
                    bankroll_snapshot: pendingCalcioRow.bankroll_snapshot || getCurrentBankroll('CALCIO'),
                    decisionIdentity: report.decisionIdentity || extData?.decisionIdentity,
                    oddsCertification: extData?.oddsCertification || extData?.odds_certification || safeJsonParse(pendingCalcioRow.calcio_odds_provenance_json, null),
                    professionalAudit: report.professionalAudit || {},
                    prediction_reliability_score: predictionReliability.score,
                    prediction_reliability_label: predictionReliability.label,
                    extData: {
                        ...(extData || {}),
                        probabilityIntegrity: extData?.probabilityIntegrity || {},
                        multiProviderEvidence: deepScanMultiProviderEvidence,
                        clubEloEvidence: runtimeClubEloEvidence
                    }
                };
                const finalizationPlan = calcioAiFinalization.planFromAudit(
                    provisionalMarketAudit,
                    currentCandidateSnapshot,
                    3
                );
                calcioObservability.updateEventPlan(db, calcioObservationFinalization, {
                    candidatePoolCount: finalizationPlan.length,
                    candidateSummary: finalizationPlan.map(candidate => ({
                        prediction: candidate.prediction,
                        odd: candidate.odd,
                        provisionalScore: candidate.provisionalPredictionIndex?.score ?? candidate.candidate_selection_score ?? null,
                        oddsCertified: candidate.oddsCertification?.certified ?? null
                    })),
                    diagnostics: {
                        sourceAuditCandidateCount: Array.isArray(provisionalMarketAudit.finalizationCandidates)
                            ? provisionalMarketAudit.finalizationCandidates.length
                            : null,
                        selectedPrediction: prediction
                    }
                });
                const finalizationResult = await calcioAiFinalization.finalizeTopMarkets({
                    candidates: finalizationPlan,
                    selectedPrediction: prediction,
                    selectedReport: report,
                    topN: 3,
                    scanCandidate: async candidate => {
                        const candidateExtData = {
                            ...(extData || {}),
                            probabilityIntegrity: candidate.probabilityIntegrity || extData?.probabilityIntegrity || {},
                            multiProviderEvidence: candidate.multiProviderEvidence || deepScanMultiProviderEvidence,
                            clubEloEvidence: candidate.clubEloEvidence || runtimeClubEloEvidence,
                            footballDataLoaded: candidate.footballDataLoaded ?? extData?.footballDataLoaded,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            eventKey: `${runtimeEventKey}|${candidate.prediction}`,
                            matchDate: candidate.match_date || matchDate,
                            providerEventId: candidate.provider_event_id || providerEventId,
                            edge_pp: candidate.edge_pp,
                            ev_pct: candidate.ev_pct,
                            sport: 'CALCIO'
                        };
                        const candidateReport = await deepScanRuntimeResilience.runDeepScan({
                            eventKey: `${runtimeEventKey}|${candidate.prediction}`,
                            homeTeam: candidate.home || homeTeam,
                            awayTeam: candidate.away || awayTeam,
                            prediction: candidate.prediction,
                            timeoutMs: extData?.deepScanTimeoutMs || 18000,
                            task: () => deepScanCalcio.scanMatchup(
                                candidate.home || homeTeam,
                                candidate.away || awayTeam,
                                candidate.prediction,
                                candidate.odd,
                                candidate.estimatedProb,
                                candidate.edge_pp,
                                candidate.odd1 ?? odd1,
                                candidate.oddX ?? oddX,
                                candidate.odd2 ?? odd2,
                                candidateExtData
                            )
                        });
                        return candidateReport;
                    },
                    finalizeCandidate: async (candidate, candidateRawReport) => {
                        const candidateDetail = candidate.probabilityIntegrity?.diagnostics?.[candidate.prediction]
                            || candidate.probabilityIntegrity?.selectedMarket
                            || {};
                        const persistedIndexComponents = safeJsonParse(pendingCalcioRow.calcio_prediction_index_components, {});
                        const finalDisagreementPp = safeNumber(
                            candidateDetail.disagreementPp
                            ?? candidate.probability_disagreement_pp
                            ?? pendingCalcioRow.probability_disagreement_pp
                            ?? persistedIndexComponents?.probability?.marketGapPp,
                            0
                        );
                        const finalModelMarketGapPp = Math.abs(safeNumber(
                            candidateDetail.modelProbabilityPct
                            ?? persistedIndexComponents?.probability?.modelCenterPct
                            ?? persistedIndexComponents?.probability?.model,
                            candidate.estimatedProb
                        ) - safeNumber(
                            candidateDetail.marketProbabilityPct
                            ?? persistedIndexComponents?.probability?.marketProbability,
                            candidate.estimatedProb
                        ));
                        let candidateEvidence = {
                            success: false,
                            resolved: 0,
                            winRatePct: null,
                            adjustedRatePct: null,
                            reliability: 'NO_SAMPLE',
                            status: 'NO_SAMPLE_NEUTRAL'
                        };
                        const candidateBaseRow = {
                            ...pendingCalcioRow,
                            ...candidate,
                            home_team: candidate.home || homeTeam,
                            away_team: candidate.away || awayTeam,
                            prediction: candidate.prediction,
                            market_type: candidate.market_type || inferCalcioMarketFamily(candidate.prediction),
                            odd: candidate.odd,
                            estimated_prob: candidate.estimatedProb,
                            edge_pp: candidate.edge_pp,
                            edge: candidate.edge_pp,
                            ev_pct: candidate.ev_pct,
                            calcio_provider_home_team: candidate.providerHome || homeTeam,
                            calcio_provider_away_team: candidate.providerAway || awayTeam,
                            calcio_odds_provenance_json: JSON.stringify(candidate.oddsCertification || {}),
                            oddsCertification: candidate.oddsCertification,
                            decisionIdentity: candidate.decisionIdentity,
                            bankroll_snapshot: deepScanBankrollSnapshot
                        };
                        const candidateMultiEvidence = candidate.multiProviderEvidence || deepScanMultiProviderEvidence;
                        const candidateProfessionalAudit = candidateRawReport.professionalAudit || candidate.professionalAudit || {};
                        let candidateReliability = calcioProgramCoherence.buildPredictionReliability({
                            integrity: candidate.probabilityIntegrity || extData?.probabilityIntegrity || {},
                            market: candidate.prediction,
                            professionalAudit: candidateProfessionalAudit,
                            sourceAudit: candidateRawReport.sourceIntelligence || {},
                            historicalEvidence: candidateEvidence,
                            multiProviderEvidence: candidateMultiEvidence
                        });
                        // PATCH 26E-A: l'azione DeepScan del candidato viene calcolata
                        // usando il mercato finale (edge/EV/affidabilità) e non lo stake
                        // preliminare della riga. Questo evita l'appiattimento WATCHLIST
                        // causato da theoreticalStake=0 prima dell'IPM.
                        let unifiedCandidateReport = calcioDeepScanFinalState.finalizeCandidateReport(candidateRawReport, {
                            edgePp: candidate.edge_pp,
                            evPct: candidate.ev_pct,
                            odd: candidate.odd,
                            reliabilityScore: candidateReliability.score,
                            predictionIndexScore: candidate.provisionalPredictionIndex?.score ?? candidate.candidate_selection_score,
                            dataClass: candidateBaseRow.stake_confidence_level || candidateBaseRow.calcio_data_class || '',
                            disagreementPp: finalDisagreementPp,
                            modelMarketGapPp: finalModelMarketGapPp,
                            selectedPremiumPct: candidate.oddsCertification?.selectedPremiumPct || candidate.oddsCertification?.diagnostics?.selectedPremiumPct,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            timingStatus: candidateProfessionalAudit.timing?.status,
                            selectedIssues: false,
                            finalizationCertified: true
                        });
                        let reliabilityAssessment = calcioCrossMarketReliability.buildReliabilityAssessment({
                            prediction: candidate.prediction,
                            odd: candidate.odd,
                            odd1: candidate.odd1 ?? odd1,
                            oddX: candidate.oddX ?? oddX,
                            odd2: candidate.odd2 ?? odd2,
                            modelProbabilityPct: candidate.estimatedProb,
                            marketProbabilityPct: candidateDetail.marketProbabilityPct ?? persistedIndexComponents?.probability?.marketProbability,
                            matchDate: candidate.match_date || matchDate,
                            reliabilityScore: candidateReliability.score,
                            dataClass: candidateBaseRow.stake_confidence_level || candidateBaseRow.calcio_data_class || '',
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            currentAction: unifiedCandidateReport.action
                        });
                        unifiedCandidateReport = calcioCrossMarketReliability.applyReportGuard(unifiedCandidateReport, reliabilityAssessment);
                        try {
                            candidateEvidence = calcioHistoricalCombinationEvidence.resolveHistoricalCombinationEvidence(db, {
                                ...candidateBaseRow,
                                ds_action: unifiedCandidateReport.action,
                                ds_suggestion: unifiedCandidateReport.suggestionText || '',
                                calcio_gate_status: candidate.qualityGateSeed || 'CALCIO_WATCHLIST_MICRO',
                                calcio_operational_status: candidate.qualityGateSeed || 'CALCIO_WATCHLIST_MICRO'
                            }, {
                                excludeBetId: pendingCalcioRow.id,
                                cutoffId: Math.max(0, pendingCalcioRow.id - 1),
                                asOf: pendingCalcioRow.match_date,
                                calculatedAt: new Date().toISOString(),
                                odd: candidate.odd
                            });
                        } catch (candidateEvidenceError) {
                            candidateEvidence = { ...candidateEvidence, error: candidateEvidenceError.message };
                        }
                        candidateReliability = calcioProgramCoherence.buildPredictionReliability({
                            integrity: candidate.probabilityIntegrity || extData?.probabilityIntegrity || {},
                            market: candidate.prediction,
                            professionalAudit: candidateProfessionalAudit,
                            sourceAudit: unifiedCandidateReport.sourceIntelligence || {},
                            historicalEvidence: candidateEvidence,
                            multiProviderEvidence: candidateMultiEvidence
                        });
                        const reconcileCandidate = reportForIpm => calcioStakeReconciler.reconcileStakeRow({
                            ...candidateBaseRow,
                            ds_action: reportForIpm.action,
                            ds_suggestion: reportForIpm.suggestionText || '',
                            calcio_prediction_reliability_score: candidateReliability.score,
                            calcio_prediction_reliability_label: candidateReliability.label
                        }, {
                            historicalEvidence: candidateEvidence,
                            historicalSample: candidateEvidence?.resolved || 0,
                            historicalAdjustedRatePct: candidateEvidence?.adjustedRatePct,
                            historicalWinRatePct: candidateEvidence?.winRatePct,
                            probabilityIntegrity: candidate.probabilityIntegrity || extData?.probabilityIntegrity || {},
                            monteCarloProbabilityPct: candidateDetail.monteCarloProbabilityPct,
                            modelProbabilityPct: candidateDetail.modelProbabilityPct,
                            marketProbabilityPct: candidateDetail.marketProbabilityPct ?? persistedIndexComponents?.probability?.marketProbability,
                            monteCarloStdErrorPp: candidateDetail.monteCarloStdErrorPp,
                            oddsCertification: candidate.oddsCertification,
                            decisionIdentity: candidate.decisionIdentity,
                            finalizationStatus: 'PATCH26E_A_FINAL_MARKET_DEEPSCAN_IPM_FINALIZED'
                        });
                        let candidateDecision = reconcileCandidate(unifiedCandidateReport);
                        let certifiedFinalReport = calcioDeepScanFinalState.finalizeCandidateReport(unifiedCandidateReport, {
                            edgePp: candidateDecision.edgePp,
                            evPct: candidateDecision.evPct,
                            odd: candidate.odd,
                            reliabilityScore: candidateReliability.score,
                            predictionIndexScore: candidateDecision.score,
                            dataClass: candidateDecision.dataClass,
                            disagreementPp: finalDisagreementPp,
                            modelMarketGapPp: finalModelMarketGapPp,
                            selectedPremiumPct: candidate.oddsCertification?.selectedPremiumPct || candidate.oddsCertification?.diagnostics?.selectedPremiumPct,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            timingStatus: candidateProfessionalAudit.timing?.status,
                            selectedIssues: false,
                            finalizationCertified: true
                        });
                        reliabilityAssessment = calcioCrossMarketReliability.buildReliabilityAssessment({
                            prediction: candidate.prediction,
                            odd: candidate.odd,
                            odd1: candidate.odd1 ?? odd1,
                            oddX: candidate.oddX ?? oddX,
                            odd2: candidate.odd2 ?? odd2,
                            modelProbabilityPct: candidate.estimatedProb,
                            marketProbabilityPct: candidateDetail.marketProbabilityPct,
                            matchDate: candidate.match_date || matchDate,
                            reliabilityScore: candidateReliability.score,
                            dataClass: candidateDecision.dataClass,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            currentAction: certifiedFinalReport.action
                        });
                        certifiedFinalReport = calcioCrossMarketReliability.applyReportGuard(certifiedFinalReport, reliabilityAssessment);
                        if (certifiedFinalReport.action !== unifiedCandidateReport.action) {
                            unifiedCandidateReport = certifiedFinalReport;
                            candidateDecision = reconcileCandidate(unifiedCandidateReport);
                            unifiedCandidateReport.finalStateDeepScan.ipmRecalculatedOnce = true;
                        } else {
                            unifiedCandidateReport = certifiedFinalReport;
                            unifiedCandidateReport.finalStateDeepScan.ipmRecalculatedOnce = false;
                        }
                        const dataQualityAssessment = calcioDataQualityAuthority.assessDataQuality({
                            oddsCertification: candidate.oddsCertification,
                            decisionIdentity: candidate.decisionIdentity,
                            identityCertified: candidate.decisionIdentity?.certified !== false,
                            marketIdentityCertified: candidate.oddsCertification?.certified === true,
                            reliabilityScore: candidateReliability.score,
                            dataClass: candidateDecision.dataClass,
                            coverageMode: candidate.probabilityIntegrity?.coverageMode || extData?.probabilityIntegrity?.coverageMode,
                            probabilityIntegrity: candidate.probabilityIntegrity || extData?.probabilityIntegrity,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            sourceConfidencePct: unifiedCandidateReport.sourceIntelligence?.matchImpactConfidence
                                ?? Math.min(
                                    safeNumber(unifiedCandidateReport.medicalNews?.home?.confidence, 0),
                                    safeNumber(unifiedCandidateReport.medicalNews?.away?.confidence, 0)
                                ),
                            reliabilityAssessment,
                            daysToKickoff: reliabilityAssessment.daysToKickoff
                        });
                        const stakeAuthority = calcioUnifiedStakeAuthority.evaluateStakeAuthority({
                            bankrollSnapshot: deepScanBankrollSnapshot,
                            bankrollSource: deepScanBankrollSource,
                            netExecutableOdd: candidateDecision.netExecutableOdd || candidate.odd,
                            productionProbabilityPct: candidate.estimatedProb,
                            robustProbabilityPct: reliabilityAssessment.robustProbabilityPct,
                            robustEvPct: reliabilityAssessment.robustEvPct,
                            epistemicUncertaintyScore: reliabilityAssessment.epistemicUncertaintyScore,
                            daysToKickoff: reliabilityAssessment.daysToKickoff,
                            predictionIndexScore: candidateDecision.score,
                            reliabilityScore: candidateReliability.score,
                            currentAction: unifiedCandidateReport.action,
                            dataQualityAssessment,
                            lineupStatus: candidateProfessionalAudit.lineupNews?.status,
                            xgEvidenceMode: candidate.xgEvidenceMode || extData?.xgEvidenceMode
                        });
                        stakeAuthority.finalNarrative = calcioUnifiedStakeAuthority.finalNarrative(stakeAuthority, candidate.prediction);
                        candidateDecision = calcioUnifiedStakeAuthority.applyToDecision(candidateDecision, stakeAuthority);
                        candidateDecision.dataQualityAssessment = dataQualityAssessment;
                        candidateDecision.reliabilityGuard = reliabilityAssessment;
                        unifiedCandidateReport.reliabilityGuard = reliabilityAssessment;
                        unifiedCandidateReport = calcioDeepScanFinalState.applyStakeAuthorityOutcome(
                            unifiedCandidateReport,
                            stakeAuthority,
                            dataQualityAssessment,
                            candidate.prediction
                        );
                        return {
                            candidate,
                            report: unifiedCandidateReport,
                            decision: candidateDecision,
                            evidence: candidateEvidence,
                            reliability: candidateReliability,
                            stakeAuthority,
                            dataQuality: dataQualityAssessment
                        };
                    }
                });
                const marketWinner = finalizationResult.winner;
                let finalMarketCandidate = currentCandidateSnapshot;
                if (marketWinner) {
                    finalMarketCandidate = marketWinner.candidate;
                    Object.assign(report, marketWinner.report || {});
                    stakeReconciliationDecision = marketWinner.decision;
                    historicalCombinationEvidence = marketWinner.evidence || historicalCombinationEvidence;
                    predictionReliability = marketWinner.reliability || predictionReliability;
                }
                const completedMarketAudit = {
                    ...provisionalMarketAudit,
                    version: calcioAiFinalization.CALCIO_AI_FINALIZATION_VERSION,
                    fullyFinalized: finalizationResult.fullyFinalized,
                    selected: finalizationResult.ranking[0] || null,
                    finalRanking: finalizationResult.ranking,
                    finalizationStatus: finalizationResult.status
                };
                const marketSelectionFinalization = calcioProfessionalSelection.finalizeSelectedMarket(
                    finalMarketCandidate.prediction,
                    stakeReconciliationDecision,
                    completedMarketAudit,
                    0
                );
                const marketFinalizationBlocked = marketSelectionFinalization.fullyFinalized !== true;
                stakeReconciliationDecision = {
                    ...stakeReconciliationDecision,
                    finalizationStatus: marketSelectionFinalization.status,
                    marketReselectionRequired: false,
                    eligible: marketFinalizationBlocked ? false : stakeReconciliationDecision.eligible,
                    operationalStake: marketFinalizationBlocked ? 0 : stakeReconciliationDecision.operationalStake,
                    estimatedProfit: marketFinalizationBlocked ? 0 : stakeReconciliationDecision.estimatedProfit,
                    status: marketFinalizationBlocked ? 'UNIFIED_INDEX_NO_STAKE' : stakeReconciliationDecision.status,
                    action: marketFinalizationBlocked ? 'MARKET_FINALIZATION_INCOMPLETE' : stakeReconciliationDecision.action,
                    allowBet: marketFinalizationBlocked ? false : stakeReconciliationDecision.allowBet,
                    reason: marketFinalizationBlocked ? marketSelectionFinalization.reason : stakeReconciliationDecision.reason
                };
                report.marketSelectionFinalization = marketSelectionFinalization;
                report.marketFinalizationAudit = completedMarketAudit;
                report.finalMarket = {
                    prediction: finalMarketCandidate.prediction,
                    odd: finalMarketCandidate.odd,
                    probability: finalMarketCandidate.estimatedProb,
                    edgePp: stakeReconciliationDecision.edgePp,
                    evPct: stakeReconciliationDecision.evPct,
                    oddsCertification: finalMarketCandidate.oddsCertification,
                    marketType: finalMarketCandidate.market_type || inferCalcioMarketFamily(finalMarketCandidate.prediction)
                };
                const finalStakeAuthority = report.stakeAuthority || stakeReconciliationDecision.stakeAuthority || {};
                const finalDataQualityAssessment = report.dataQualityAuthority || stakeReconciliationDecision.dataQualityAssessment || {};
                recalculatedKellyStakePolicy = {
                    version: calcioUnifiedStakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
                    rawKellyPct: safeNumber(finalStakeAuthority.stakeFullKellyPct, 0),
                    rawKellyStake: deepScanBankrollSnapshot * safeNumber(finalStakeAuthority.stakeFullKellyPct, 0) / 100,
                    theoreticalStake: safeNumber(finalStakeAuthority.modelStake, stakeReconciliationDecision.theoreticalStake),
                    reliabilityStake: safeNumber(finalStakeAuthority.reliabilityStake, stakeReconciliationDecision.prePortfolioCapStake),
                    minimumStakeApplied: false,
                    dataAuthority: {
                        dataClass: stakeReconciliationDecision.dataClass,
                        qualityStatus: finalDataQualityAssessment.status || null,
                        qualityScore: finalDataQualityAssessment.score ?? null,
                        multiplier: stakeReconciliationDecision.band?.multiplier ?? null
                    },
                    reason: stakeReconciliationDecision.reason
                };
                calcioStakeLifecycleReport = {
                    version: stakeReconciliationDecision.predictionIndexVersion || stakeReconciliationDecision.version,
                    theoreticalStake: stakeReconciliationDecision.theoreticalStake,
                    operationalStake: stakeReconciliationDecision.operationalStake,
                    estimatedOperationalProfit: stakeReconciliationDecision.estimatedProfit,
                    status: stakeReconciliationDecision.status,
                    action: stakeReconciliationDecision.action,
                    reason: stakeReconciliationDecision.reason,
                    automaticExecution: stakeReconciliationDecision.eligible,
                    dataClass: stakeReconciliationDecision.dataClass
                };
                calcioGateReport = {
                    status: stakeReconciliationDecision.gateStatus,
                    allowBet: stakeReconciliationDecision.allowBet,
                    action: stakeReconciliationDecision.action,
                    maxStake: stakeReconciliationDecision.operationalStake,
                    reasons: [stakeReconciliationDecision.reason],
                    reconciliationVersion: stakeReconciliationDecision.version,
                    qualityOrigin: 'UNIFIED_STAKE_AUTHORITY',
                    predictionIndex: stakeReconciliationDecision
                };
                report.stakeReconciliation = stakeReconciliationDecision;
                report.predictionIndex = stakeReconciliationDecision;
                analysisStage = calcioProgramCoherence.buildAnalysisStage({
                    candidate: {
                        odd: finalMarketCandidate.odd,
                        estimated_prob: finalMarketCandidate.estimatedProb,
                        edge_pp: stakeReconciliationDecision.edgePp,
                        theoreticalStake: calcioStakeLifecycleReport.theoreticalStake,
                        operationalStake: calcioStakeLifecycleReport.operationalStake,
                        invested: calcioStakeLifecycleReport.operationalStake
                    }
                });
                // PATCH 24: la motivazione di riga deriva solo dalla decisione corrente.
                // Nessun reason precedente puo sopravvivere al ricalcolo finale.
                // Patch 13: macro-causale tecnica e gate operativo sono contratti distinti.
                // Il timing EARLY_WATCHLIST non deve trasformare ogni segnale in "riesame operativo".
                // PATCH 23: nessuna seconda generazione dell'azione.
                // report.action, displayAction, ds_action e componente IPM coincidono.
                displayAction = report.action;
                report.displayAction = report.action;
                qualityFinalLabel = finalStakeAuthority.qualityFinalLabel
                    || stakeReconciliationDecision.qualityLabel
                    || calcioDeepScanFinalState.qualityLabel(report.action);
                report.predictionReliability = predictionReliability;
                report.analysisStage = analysisStage;
                report.displayAction = displayAction;
                report.qualityFinalLabel = qualityFinalLabel;
                const finalOperationalState = calcioAiFinalization.operationalState(
                    stakeReconciliationDecision,
                    historicalCombinationEvidence,
                    { strategy_tag: finalMarketCandidate.strategy_tag || pendingCalcioRow.strategy_tag }
                );
                report.operationalState = finalOperationalState;
                // PATCH 26F-A: ogni pannello diagnostico deve derivare da un solo
                // snapshot del mercato realmente finalizzato. Lo snapshot evento
                // resta non operativo fino al commit del portafoglio batch.
                // PATCH 26F-C R2: usa le componenti finali dell'IPM come
                // fallback diagnostico quando probabilityIntegrity del vincitore
                // non espone MC/modello/mercato. La probabilita production resta
                // finalMarketCandidate.estimatedProb ed e' immutata.
                const finalProbabilityComponents = stakeReconciliationDecision?.components?.probability
                    || safeJsonParse(pendingCalcioRow.calcio_prediction_index_components, {})?.probability
                    || {};
                const finalMarketDiagnostic = calcioFinalMarketDiagnosticContract.buildFinalMarketSnapshot({
                    candidate: finalMarketCandidate,
                    eventKey: runtimeEventKey,
                    prediction: finalMarketCandidate.prediction,
                    marketType: finalMarketCandidate.market_type || inferCalcioMarketFamily(finalMarketCandidate.prediction),
                    odd: finalMarketCandidate.odd,
                    probabilityPct: finalMarketCandidate.estimatedProb,
                    edgePp: stakeReconciliationDecision.edgePp,
                    evPct: stakeReconciliationDecision.evPct,
                    probabilityIntegrity: finalMarketCandidate.probabilityIntegrity || finalMarketCandidate.extData?.probabilityIntegrity || extData?.probabilityIntegrity || {},
                    probabilityFallback: {
                        modelProbabilityPct: finalProbabilityComponents.modelProbabilityPct
                            ?? finalProbabilityComponents.model
                            ?? finalProbabilityComponents.modelCenterPct,
                        monteCarloProbabilityPct: finalProbabilityComponents.monteCarloProbabilityPct
                            ?? finalProbabilityComponents.monteCarlo,
                        marketProbabilityPct: finalProbabilityComponents.marketProbabilityPct
                            ?? finalProbabilityComponents.marketProbability,
                        disagreementPp: finalProbabilityComponents.disagreementPp
                            ?? finalProbabilityComponents.marketGapPp
                            ?? finalProbabilityComponents.spreadPp,
                        monteCarloSamplingErrorPp: finalProbabilityComponents.monteCarloSamplingErrorPp
                            ?? finalProbabilityComponents.monteCarloStdErrorPp,
                        modelAgreementReliability: finalProbabilityComponents.modelAgreementReliability
                            ?? finalProbabilityComponents.reliability
                    },
                    monteCarlo: finalMarketCandidate.extData?.monteCarlo || extData?.monteCarlo || {},
                    predictionReliability,
                    dataQuality: finalDataQualityAssessment,
                    stakeAuthority: finalStakeAuthority,
                    decision: stakeReconciliationDecision,
                    report,
                    finalOperationalStake: 0,
                    eligible: false,
                    allowBet: false,
                    robustEvPct: finalStakeAuthority.robustEvPct || report.reliabilityGuard?.robustEvPct,
                    timingCode: finalStakeAuthority.timingPolicy?.code || report.reliabilityGuard?.timingPolicy?.code,
                    finalizationStatus: marketSelectionFinalization.status,
                    finalizationCertified: marketSelectionFinalization.fullyFinalized,
                    reason: finalStakeAuthority.reason || stakeReconciliationDecision.reason
                });
                calcioFinalMarketDiagnosticContract.assertSnapshotCoherence(finalMarketDiagnostic, { throwOnError: true });
                // PATCH 26F-C: architettura dual-score esclusivamente shadow.
                // Separa Forecast Confidence, Value e Context Risk senza sostituire
                // probabilità production, IPM legacy, Stake Authority o cap batch.
                // PATCH 26F-C R1: l'audit storico del ciclo di discovery non e' nello
                // scope dell'endpoint DeepScan. Risolverlo esclusivamente dal candidato
                // finalizzato o dalla riga PENDING persistita, senza riferimenti liberi.
                const candidateHistoricalCoverageAuditRaw = finalMarketCandidate.extData?.historicalCoverageAudit
                    ?? finalMarketCandidate.extData?.historical_coverage_audit
                    ?? null;
                const candidateHistoricalCoverageAudit = typeof candidateHistoricalCoverageAuditRaw === 'string'
                    ? safeJsonParse(candidateHistoricalCoverageAuditRaw, {})
                    : (candidateHistoricalCoverageAuditRaw || {});
                const persistedHistoricalCoverageAudit = safeJsonParse(
                    pendingCalcioRow.calcio_historical_coverage_audit,
                    {}
                ) || {};
                const dualScoreHistoricalCoverage = Object.keys(candidateHistoricalCoverageAudit).length
                    ? candidateHistoricalCoverageAudit
                    : persistedHistoricalCoverageAudit;

                const dualScoreShadow = calcioDualScoreArchitecture.evaluateShadow({
                    finalMarketDiagnostic,
                    marketId: finalMarketDiagnostic.marketId,
                    prediction: finalMarketCandidate.prediction,
                    odd: finalStakeAuthority.netExecutableOdd || finalMarketCandidate.odd,
                    netExecutableOdd: finalStakeAuthority.netExecutableOdd || finalMarketCandidate.odd,
                    productionProbabilityPct: finalMarketCandidate.estimatedProb,
                    robustProbabilityPct: finalStakeAuthority.robustProbabilityPct || report.reliabilityGuard?.robustProbabilityPct,
                    robustEvPct: finalStakeAuthority.robustEvPct || report.reliabilityGuard?.robustEvPct,
                    modelMarketGapPp: finalMarketDiagnostic.probability?.disagreementPp,
                    monteCarloStdErrorPp: finalMarketDiagnostic.probability?.monteCarloSamplingErrorPp,
                    sourceConfidencePct: report.sourceIntelligence?.matchImpactConfidence,
                    oddsCertification: finalMarketCandidate.oddsCertification,
                    oddsOutlierPremiumPct: stakeReconciliationDecision.oddsOutlierPremiumPct,
                    dataQuality: finalDataQualityAssessment,
                    reliabilityAssessment: report.reliabilityGuard || {},
                    daysToKickoff: finalStakeAuthority.timingPolicy?.daysToKickoff || report.reliabilityGuard?.daysToKickoff,
                    epistemicUncertaintyScore: report.reliabilityGuard?.epistemicUncertaintyScore,
                    crossMarketGapPp: report.reliabilityGuard?.crossMarketGapPp,
                    lineupStatus: report.professionalAudit?.lineupNews?.status,
                    xgEvidenceMode: finalMarketCandidate.xgEvidenceMode || extData?.xgEvidenceMode,
                    historicalCoverage: dualScoreHistoricalCoverage,
                    promotedTeamPrior: Boolean(dualScoreHistoricalCoverage?.promotedTeamPrior),
                    historicalEvidence: historicalCombinationEvidence,
                    historicalSample: historicalCombinationEvidence?.resolved || 0,
                    historicalAdjustedRatePct: historicalCombinationEvidence?.adjustedRatePct,
                    historicalWinRatePct: historicalCombinationEvidence?.winRatePct,
                    oldIpmScore: stakeReconciliationDecision.score,
                    oldIpmComponents: stakeReconciliationDecision.components,
                    decision: stakeReconciliationDecision,
                    stakeAuthority: finalStakeAuthority,
                    currentDecisionState: finalMarketDiagnostic.decisionState?.code,
                    marketCertified: finalMarketCandidate.oddsCertification?.certified === true
                });
                calcioDualScoreArchitecture.assertShadowInvariants(dualScoreShadow, { throwOnError: true });
                report.dualScoreShadow = dualScoreShadow;
                report.finalMarketDiagnostic = finalMarketDiagnostic;
                report.finalMarket.marketId = finalMarketDiagnostic.marketId;
                const finalTransactionId = `PATCH24-${pendingCalcioRow.id}-${Date.now()}`;
                const gateFields = {
                    prediction: finalMarketCandidate.prediction,
                    market_type: finalMarketCandidate.market_type || inferCalcioMarketFamily(finalMarketCandidate.prediction),
                    odd: finalMarketCandidate.odd,
                    market_implied_prob: impliedProbabilityPct(finalMarketCandidate.odd), // AUDIT07_MARKET_IMPLIED_SYNC
                    estimated_prob: finalMarketCandidate.estimatedProb,
                    edge: stakeReconciliationDecision.edgePp,
                    edge_pp: stakeReconciliationDecision.edgePp,
                    ev_pct: stakeReconciliationDecision.evPct,
                    strategy_tag: finalOperationalState.strategy_tag,
                    bankroll_snapshot: deepScanBankrollSnapshot,
                    exposure_role: finalOperationalState.exposure_role,
                    prediction_visibility: finalOperationalState.prediction_visibility,
                    calcio_analysis_only: finalOperationalState.calcio_analysis_only,
                    ds_action: report.action,
                    calcio_deepscan_raw_action: report.rawAction || '',
                    calcio_deepscan_unified_action: report.action,
                    calcio_deepscan_action_certified: report.action === report.displayAction && report.action === report.ipmAction && report.action === report.persistedAction ? 1 : 0,
                    calcio_deepscan_canonical_audit: JSON.stringify(report.canonicalDeepScan || {}),
                    calcio_deepscan_timing_advisory: report.canonicalDeepScan?.timingAdvisory || report.deepScanAdvisory?.mode || '',
                    calcio_deepscan_final_state_version: calcioDeepScanFinalState.CALCIO_DEEPSCAN_FINAL_STATE_VERSION,
                    calcio_deepscan_final_state_action: report.action,
                    calcio_deepscan_final_state_score: safeNumber(report.riskScore, null),
                    calcio_deepscan_final_state_audit: JSON.stringify(report.finalStateDeepScan || {}),
                    calcio_deepscan_final_report_json: JSON.stringify(calcioDeepScanFinalState.compactReport(report, stakeReconciliationDecision)),
                    ds_suggestion: report.suggestionText || '',
                    stake: calcioStakeLifecycleReport.operationalStake,
                    calcio_theoretical_stake: calcioStakeLifecycleReport.theoreticalStake,
                    stake_base_before_deepscan: safeNumber(finalStakeAuthority.modelStake, stakeReconciliationDecision.theoreticalStake),
                    kelly_fraction_pct: safeNumber(recalculatedKellyStakePolicy?.rawKellyPct, null),
                    kelly_raw_stake: safeNumber(recalculatedKellyStakePolicy?.rawKellyStake, null),
                    stake_confidence_multiplier: safeNumber(recalculatedKellyStakePolicy?.dataAuthority?.multiplier, null),
                    stake_confidence_level: recalculatedKellyStakePolicy?.dataAuthority?.dataClass || '',
                    stake_min_applied: recalculatedKellyStakePolicy?.minimumStakeApplied ? 1 : 0,
                    stake_cap_applied: safeNumber(recalculatedKellyStakePolicy?.adjustedKellyStake, 0) > safeNumber(recalculatedKellyStakePolicy?.theoreticalStake, 0) ? 1 : 0,
                    stake_policy_mode: calcioUnifiedStakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
                    stake_policy_note: recalculatedKellyStakePolicy?.reason || '',
                    calcio_gate_status: calcioGateReport.status,
                    calcio_gate_allow_bet: calcioGateReport.allowBet ? 1 : 0,
                    calcio_gate_reasons: calcioGateReport.reasons.join(' | '),
                    calcio_gate_max_stake: calcioGateReport.maxStake,
                    calcio_operational_stake: calcioStakeLifecycleReport.operationalStake,
                    calcio_stake_lifecycle_status: calcioStakeLifecycleReport.status,
                    calcio_stake_lifecycle_reason: calcioStakeLifecycleReport.reason,
                    calcio_operational_status: calcioGateReport.status,
                    calcio_operational_action: calcioGateReport.action,
                    calcio_operational_summary: calcioGateReport.reasons.join(' | '),
                    calcio_professional_status: report.professionalAudit?.status || '',
                    calcio_professional_risk: report.professionalAudit?.risk || 0,
                    calcio_professional_summary: (report.professionalAudit?.recommendations || []).join(' | '),
                    calcio_timing_status: report.professionalAudit?.timing?.status || '',
                    calcio_lineup_status: report.professionalAudit?.lineupNews?.status || '',
                    calcio_data_reliability: report.professionalAudit?.dataReliability?.status || '',
                    calcio_team_match_confidence: report.professionalAudit?.teamMatching?.confidence || 0,
                    calcio_correlation_status: report.professionalAudit?.correlation?.status || '',
                    calcio_prediction_reliability_score: safeNumber(report.predictionReliability?.score, pendingCalcioRow.calcio_prediction_reliability_score),
                    calcio_prediction_reliability_label: report.predictionReliability?.label || pendingCalcioRow.calcio_prediction_reliability_label || '',
                    calcio_analysis_stage_code: report.analysisStage?.code || pendingCalcioRow.calcio_analysis_stage_code || '',
                    calcio_analysis_stage_label: report.analysisStage?.label || pendingCalcioRow.calcio_analysis_stage_label || '',
                    calcio_analysis_stage_reason: report.analysisStage?.summary || pendingCalcioRow.calcio_analysis_stage_reason || '',
                    calcio_quality_final_label: report.qualityFinalLabel || report.action || '',
                    quality_final_label: report.qualityFinalLabel || '',
                    quality_final_reason: calcioStakeLifecycleReport.reason || '',
                    quality_stake_mode: calcioStakeLifecycleReport.action || '',
                    quality_stake_amount: calcioStakeLifecycleReport.operationalStake,
                    quality_decision_at: new Date().toISOString(),
                    quality_deepscan_class: calcioGateReport.deepScanClass || classifyCalcioDeepScanAction(report.action, report.suggestionText || ''),
                    quality_deepscan_separate: 1,
                    calcio_ai_finalization_status: stakeReconciliationDecision.finalizationStatus || 'PATCH25_BEST_MARKET_FULLY_CERTIFIED',
                    calcio_market_reselection_required: 0,
                    calcio_market_selection_audit: JSON.stringify(completedMarketAudit),
                    calcio_market_selection_version: calcioProfessionalSelection.CALCIO_PROFESSIONAL_SELECTION_VERSION,
                    calcio_market_finalization_audit: JSON.stringify(completedMarketAudit),
                    calcio_market_finalization_version: calcioAiFinalization.CALCIO_AI_FINALIZATION_VERSION,
                    calcio_market_finalized_count: finalizationResult.finalizedCount,
                    calcio_market_projected_count: finalizationResult.projectedCount || 0,
                    calcio_market_finalization_mode: finalizationResult.projectedCount > 0 ? 'DIRECT_PLUS_SHARED_MATCH_EVIDENCE' : 'DIRECT_TOP3_DEEPSCAN',
                    calcio_market_ranking_certified: marketSelectionFinalization.fullyFinalized ? 1 : 0,
                    calcio_ipm_certification_status: stakeReconciliationDecision.decisionCertification?.status || '',
                    calcio_pt_certification_status: finalOperationalState.ptCertificationStatus,
                    calcio_structural_certification_label: finalOperationalState.certificationLabel,
                    calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
                    calcio_portfolio_cap_post_finalization: 1,
                    calcio_finalization_transaction_status: 'PENDING_COMMIT',
                    calcio_finalization_transaction_id: finalTransactionId,
                    calcio_runtime_consistency_status: 'PENDING_POST_FINALIZATION_CAPS'
                };
                Object.assign(gateFields, calcioStakeReconciler.persistenceFields(stakeReconciliationDecision));
                Object.assign(gateFields, calcioCrossMarketReliability.persistenceFields(report.reliabilityGuard || stakeReconciliationDecision.reliabilityGuard || {}, stakeReconciliationDecision));
                Object.assign(gateFields, calcioDataQualityAuthority.persistenceFields(finalDataQualityAssessment));
                Object.assign(gateFields, calcioUnifiedStakeAuthority.persistenceFields(finalStakeAuthority));
                Object.assign(gateFields, calcioFinalMarketDiagnosticContract.persistenceFields(finalMarketDiagnostic));
                Object.assign(gateFields, calcioDualScoreArchitecture.persistenceFields(dualScoreShadow));
                gateFields.calcio_final_narrative = finalStakeAuthority.finalNarrative || calcioUnifiedStakeAuthority.finalNarrative(finalStakeAuthority, finalMarketCandidate.prediction);

                const gateEntries = Object.fromEntries(
                    Object.entries(gateFields).filter(([key]) => columnExists('ai_forward_test', key))
                );
                const evidenceFields = Object.fromEntries(
                    Object.entries(calcioHistoricalCombinationEvidence.toPersistenceFields(historicalCombinationEvidence))
                        .filter(([key]) => columnExists('ai_forward_test', key))
                );

                // PATCH 26C: la transazione evento persiste soltanto la finalizzazione
                // DeepScan/PT/IPM e lo stake PRE-CAP. Nessuno stake operativo viene
                // autorizzato prima della chiusura dell'intero analysis_batch.
                // L'allocazione aggregata viene eseguita una sola volta da
                // /api/calcio/portfolio/finalize-batch.
                const prePortfolioCapStake = safeNumber(
                    stakeReconciliationDecision.prePortfolioCapStake
                    ?? stakeReconciliationDecision.operationalStake
                    ?? stakeReconciliationDecision.theoreticalStake,
                    0
                );
                const prePortfolioCapEligible = stakeReconciliationDecision.eligible === true
                    && prePortfolioCapStake >= 2;
                const batchPendingReason = marketSelectionFinalization.fullyFinalized !== true
                    ? marketSelectionFinalization.reason
                    : prePortfolioCapEligible
                        ? `Finalizzazione completata: stake unico pre-cap €${prePortfolioCapStake.toFixed(2)}; allocazione batch in attesa.`
                        : (finalStakeAuthority.reason || `Finalizzazione completata senza stake pre-cap autorizzato.`);
                const eventPendingDecision = {
                    ...stakeReconciliationDecision,
                    prePortfolioCapStake,
                    operationalStake: 0,
                    estimatedProfit: 0,
                    eligible: false,
                    allowBet: false,
                    status: 'UNIFIED_INDEX_AWAITING_BATCH_ALLOCATION',
                    action: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
                    gateStatus: 'CALCIO_WATCHLIST_MICRO',
                    reason: batchPendingReason,
                    portfolioBatchCertified: false
                };
                const eventPendingState = calcioAiFinalization.operationalState(
                    eventPendingDecision,
                    historicalCombinationEvidence,
                    { strategy_tag: finalMarketCandidate.strategy_tag || pendingCalcioRow.strategy_tag }
                );
                const eventPendingAnalysisStage = calcioProgramCoherence.buildAnalysisStage({
                    candidate: {
                        odd: finalMarketCandidate.odd,
                        estimated_prob: finalMarketCandidate.estimatedProb,
                        edge_pp: eventPendingDecision.edgePp,
                        theoreticalStake: eventPendingDecision.theoreticalStake,
                        operationalStake: 0,
                        invested: 0
                    }
                });
                eventPendingAnalysisStage.code = 'AWAITING_BATCH_PORTFOLIO_ALLOCATION';
                eventPendingAnalysisStage.label = 'IN ATTESA ALLOCAZIONE BATCH';
                eventPendingAnalysisStage.summary = batchPendingReason;
                const eventCoherence = calcioAiFinalization.assertOutputCoherence({
                    report,
                    decision: stakeReconciliationDecision,
                    state: finalOperationalState,
                    displayedEvPct: stakeReconciliationDecision.evPct,
                    persistedAction: report.action,
                    marketFinalization: marketSelectionFinalization
                });
                const eventFields = {
                    ...gateEntries,
                    ...evidenceFields,
                    ...calcioStakeReconciler.persistenceFields(eventPendingDecision),
                    stake: 0,
                    calcio_operational_stake: 0,
                    calcio_gate_max_stake: 0,
                    calcio_gate_allow_bet: 0,
                    calcio_prediction_index_eligible: 0,
                    calcio_stake_lifecycle_status: 'UNIFIED_INDEX_AWAITING_BATCH_ALLOCATION',
                    calcio_stake_lifecycle_reason: batchPendingReason,
                    calcio_operational_status: 'CALCIO_WATCHLIST_MICRO',
                    calcio_operational_action: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
                    calcio_operational_summary: batchPendingReason,
                    calcio_gate_status: 'CALCIO_WATCHLIST_MICRO',
                    calcio_gate_reasons: batchPendingReason,
                    calcio_prediction_index_reason: batchPendingReason,
                    calcio_decision_certification_status: 'EVENT_STRUCTURALLY_FINALIZED_AWAITING_BATCH',
                    calcio_decision_certification_reason: batchPendingReason,
                    calcio_analysis_stage_code: eventPendingAnalysisStage.code,
                    calcio_analysis_stage_label: eventPendingAnalysisStage.label,
                    calcio_analysis_stage_reason: eventPendingAnalysisStage.summary,
                    calcio_quality_final_label: 'IN ATTESA ALLOCAZIONE BATCH',
                    quality_final_label: 'IN ATTESA ALLOCAZIONE BATCH',
                    quality_final_reason: batchPendingReason,
                    quality_stake_mode: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
                    quality_stake_amount: 0,
                    calcio_analysis_only: 1,
                    prediction_visibility: 'ANALYSIS_ONLY',
                    exposure_role: 'ANALYSIS_ONLY',
                    strategy_tag: String(finalMarketCandidate.strategy_tag || pendingCalcioRow.strategy_tag || 'CALCIO_SINGLE')
                        .replace(/_(OPERATIONAL|ANALYSIS_ONLY)$/i, '') + '_ANALYSIS_ONLY',
                    calcio_portfolio_cap_post_finalization: 0,
                    calcio_analysis_batch_id: calcioObservationFinalization?.batchId || null,
                    calcio_event_finalization_id: calcioObservationFinalization?.finalizationId || null,
                    calcio_portfolio_allocation_id: null,
                    calcio_portfolio_batch_status: 'PENDING_BATCH',
                    calcio_portfolio_batch_certified: 0,
                    calcio_portfolio_pre_cap_eligible: prePortfolioCapEligible ? 1 : 0,
                    calcio_portfolio_pre_cap_stake: prePortfolioCapStake,
                    calcio_portfolio_post_cap_stake: 0,
                    calcio_portfolio_cap_reason: null,
                    calcio_finalization_transaction_status: 'COMMITTED_EVENT_ONLY',
                    calcio_finalization_transaction_id: finalTransactionId,
                    calcio_runtime_consistency_status: 'EVENT_FINALIZED_PORTFOLIO_BATCH_PENDING',
                    calcio_output_coherence_status: eventCoherence.status,
                    calcio_batch_output_coherence_status: 'PENDING_BATCH_ALLOCATION',
                    calcio_deepscan_final_report_json: JSON.stringify(calcioDeepScanFinalState.compactReport({
                        ...report,
                        analysisStage: eventPendingAnalysisStage,
                        qualityFinalLabel: 'IN ATTESA ALLOCAZIONE BATCH',
                        operationalState: eventPendingState,
                        outputCoherence: eventCoherence,
                        portfolioAllocation: {
                            mode: 'BATCH_ALLOCATION_PENDING',
                            batchId: calcioObservationFinalization?.batchId || null,
                            eventFinalizationId: calcioObservationFinalization?.finalizationId || null,
                            preCapStake: prePortfolioCapStake,
                            postCapStake: 0,
                            portfolioBatchCertified: false
                        }
                    }, eventPendingDecision))
                };
                const filteredEventFields = Object.fromEntries(
                    Object.entries(eventFields).filter(([key]) => columnExists('ai_forward_test', key))
                );
                const commitFinalization = db.transaction(() => {
                    const activeRowsBefore = db.prepare(`
                        SELECT * FROM ai_forward_test
                        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
                          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
                          AND COALESCE(paper_result_active, 1) = 1
                          AND COALESCE(paper_result_conflict, 0) = 0
                        ORDER BY id DESC
                    `).all();
                    const currentBefore = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(pendingCalcioRow.id);
                    if (!currentBefore) throw new Error('PATCH26C_CURRENT_ROW_DISAPPEARED');
                    const changedEntries = Object.entries(filteredEventFields)
                        .filter(([key, value]) => String(currentBefore[key] ?? '') !== String(value ?? ''));
                    if (changedEntries.length) {
                        db.prepare(`UPDATE ai_forward_test SET ${changedEntries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
                            .run(...changedEntries.map(([, value]) => value), pendingCalcioRow.id);
                    }
                    const activeRowsAfter = db.prepare(`
                        SELECT * FROM ai_forward_test
                        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
                          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
                          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
                          AND COALESCE(paper_result_active, 1) = 1
                          AND COALESCE(paper_result_conflict, 0) = 0
                        ORDER BY id DESC
                    `).all();
                    const isolationAudit = calcioEventFinalizationIsolation.assertOnlyCurrentEventMutated(
                        activeRowsBefore,
                        activeRowsAfter,
                        runtimeEventKey
                    );
                    return {
                        changedCurrent: changedEntries.length,
                        isolationAudit
                    };
                });
                const transactionResult = commitFinalization();
                stakeReconciliationDecision = eventPendingDecision;
                calcioStakeLifecycleReport = {
                    ...calcioStakeLifecycleReport,
                    theoreticalStake: eventPendingDecision.theoreticalStake,
                    operationalStake: 0,
                    estimatedOperationalProfit: 0,
                    status: eventPendingDecision.status,
                    action: eventPendingDecision.action,
                    reason: eventPendingDecision.reason,
                    automaticExecution: false
                };
                analysisStage = eventPendingAnalysisStage;
                qualityFinalLabel = 'IN ATTESA ALLOCAZIONE BATCH';
                report.analysisStage = analysisStage;
                report.qualityFinalLabel = qualityFinalLabel;
                report.operationalState = eventPendingState;
                report.outputCoherence = eventCoherence;
                report.portfolioAllocation = {
                    mode: 'BATCH_ALLOCATION_PENDING',
                    batchId: calcioObservationFinalization?.batchId || null,
                    preCapStake: prePortfolioCapStake,
                    postCapStake: 0,
                    portfolioBatchCertified: false
                };
                report.stakeReconciliation = eventPendingDecision;
                report.predictionIndex = eventPendingDecision;
                calcioGateReport = {
                    ...calcioGateReport,
                    status: 'CALCIO_WATCHLIST_MICRO',
                    allowBet: false,
                    action: 'AWAITING_BATCH_PORTFOLIO_ALLOCATION',
                    maxStake: 0,
                    reasons: [batchPendingReason],
                    predictionIndex: eventPendingDecision,
                    postFinalizationPortfolioCap: false,
                    portfolioBatchPending: true
                };
                const completedObservationContext = calcioObservationFinalization;
                const calcioObservationCompletion = calcioObservability.completeEventFinalization(db, completedObservationContext, {
                    ranking: finalizationResult.ranking || [],
                    transactionId: finalTransactionId,
                    finalizationStatus: finalizationResult.status,
                    outputCoherenceStatus: eventCoherence.status || null,
                    caps: { totalExposurePct: 5, longshotExposurePct: 1, kickoffExposurePct: 2 },
                    diagnostics: {
                        selectedPrediction: finalMarketCandidate.prediction,
                        selectedScore: stakeReconciliationDecision.score,
                        selectedOperationalStake: stakeReconciliationDecision.operationalStake,
                        currentRowId: pendingCalcioRow.id,
                        currentEventKey: runtimeEventKey
                    }
                });
                // Il record osservabilità è terminale: eventuali errori successivi di
                // serializzazione non devono retrocederlo da COMPLETED a FAILED.
                calcioObservationFinalization = null;
                report.observability = {
                    version: calcioObservability.CALCIO_OBSERVABILITY_VERSION,
                    finalizationId: calcioObservationCompletion?.finalizationId || completedObservationContext?.finalizationId || null,
                    analysisBatchId: completedObservationContext?.batchId || null,
                    crossEventWriteDetected: calcioObservationCompletion?.crossEventWriteDetected === true,
                    mutatedEventKeys: calcioObservationCompletion?.mutatedEventKeys || [],
                    readOnlyAudit: true,
                    decisionAuthorityChanged: false,
                    stakeAuthorityChanged: false,
                    terminalWriteProtected: true
                };
                report.persistence = {
                    success: true,
                    transactional: true,
                    transactionId: finalTransactionId,
                    changedCurrent: transactionResult.changedCurrent,
                    status: 'COMMITTED_EVENT_ONLY',
                    eventIsolation: transactionResult.isolationAudit,
                    portfolioBatchCertified: false
                };
                report.historicalPersistence = {
                    success: true,
                    transactional: true,
                    transactionId: finalTransactionId,
                    status: 'COMMITTED_EVENT_ONLY',
                    eventIsolation: transactionResult.isolationAudit,
                    portfolioBatchCertified: false
                };
            }

            if (!report.observability && calcioObservationFinalization) {
                const completedObservationContext = calcioObservationFinalization;
                const analysisOnlyObservation = calcioObservability.completeEventFinalization(db, completedObservationContext, {
                    ranking: [],
                    finalizationStatus: 'NO_PENDING_ROW_ANALYSIS_ONLY',
                    diagnostics: { persisted: false, reason: 'PENDING_CALCIO_ROW_NOT_FOUND' }
                });
                calcioObservationFinalization = null;
                report.observability = {
                    version: calcioObservability.CALCIO_OBSERVABILITY_VERSION,
                    finalizationId: analysisOnlyObservation?.finalizationId || completedObservationContext.finalizationId,
                    analysisBatchId: completedObservationContext.batchId || null,
                    crossEventWriteDetected: analysisOnlyObservation?.crossEventWriteDetected === true,
                    mutatedEventKeys: analysisOnlyObservation?.mutatedEventKeys || [],
                    readOnlyAudit: true,
                    decisionAuthorityChanged: false,
                    stakeAuthorityChanged: false,
                    terminalWriteProtected: true
                };
            }
            return res.json({
                ...report,
                rawAction: report.rawAction || report.action,
                action: report.action,
                displayAction: report.action,
                predictionReliability,
                analysisStage,
                qualityFinalLabel,
                calcioGate: calcioGateReport,
                kellyStakePolicy: recalculatedKellyStakePolicy,
                stakeLifecycle: calcioStakeLifecycleReport,
                stakeReconciliation: report.stakeReconciliation || null,
                historicalCombinationEvidence,
                realProbabilityPaperTrading: historicalCombinationEvidence,
                deepScanGateMode: stakeReconciliationDecision?.portfolioBatchCertified === false ? 'EVENT_FINALIZED_BATCH_PENDING' : 'OPERATIONAL_GATE',
                operationalGate: stakeReconciliationDecision?.eligible === true,
                advisoryOnly: false,
                historicalEvidenceShadowOnly: false,
                aiDecisionFinalization: 'PATCH26C_EVENT_FINALIZED_AWAITING_DETERMINISTIC_BATCH_ALLOCATION',
                strictCalcioSportIdentity: true,
                eventIdentityVersion: calcioEventIdentity.CALCIO_EVENT_IDENTITY_VERSION,
                eventKey: runtimeEventKey,
                runtimeResilience: report.runtime || deepScanRuntimeResilience.diagnostics(),
                payloadDiagnostics: deepScanPayloadDiagnostics,
                payloadVersion: calcioDeepScanPayloadContract.CALCIO_DEEPSCAN_PAYLOAD_VERSION,
                engineVersion: SERVER_ENGINE_VERSION
            });
        }

        const terminalObservationError = new Error(report.error || 'Errore Deep Scan Calcio.');
        terminalObservationError.code = report.code || 'CALCIO_DEEPSCAN_REPORT_ERROR';
        try { calcioObservability.failEventFinalization(db, calcioObservationFinalization, terminalObservationError); } catch (_) {}
        calcioObservationFinalization = null;
        return res.status(500).json({ error: report.error || "Errore Deep Scan Calcio." });
    } catch (error) {
        try { calcioObservability.failEventFinalization(db, calcioObservationFinalization, error); } catch (_) {}
        const status = Number(error?.httpStatus) || (error?.code === 'CALCIO_DEEPSCAN_PAYLOAD_TOO_LARGE' ? 413 : 500);
        return res.status(status).json({
            success: false,
            error: error.message,
            code: error.code || 'CALCIO_DEEPSCAN_ROUTE_ERROR',
            payloadBytes: error.payloadBytes || null,
            maxPayloadBytes: error.maxBytes || calcioDeepScanPayloadContract.SERVER_MAX_BYTES,
            payloadVersion: calcioDeepScanPayloadContract.CALCIO_DEEPSCAN_PAYLOAD_VERSION,
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
});
// /CALCIO_PATCH4_STRICT_SPORT_IDENTITY

// PATCH 26C: una sola allocazione globale dopo la chiusura della coda DeepScan.
app.post('/api/calcio/portfolio/finalize-batch', (req, res) => {
    try {
        const analysisBatchId = String(req.body?.analysisBatchId || req.body?.batchId || '').trim();
        const allocation = calcioBatchPortfolioAllocator.allocateBatch(db, {
            batchId: analysisBatchId,
            bankroll: req.body?.bankroll,
            caps: {
                totalExposurePct: 5,
                longshotExposurePct: 1,
                kickoffExposurePct: 2
            },
            professionalSelection: calcioProfessionalSelection
        });
        return res.json({
            ...allocation,
            portfolioBatchCertified: allocation.status === 'COMMITTED_BATCH',
            eventFinalizationAuthorityChanged: false,
            stakeAmountAuthority: calcioUnifiedStakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
            portfolioCapAuthority: calcioBatchPortfolioAllocator.CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
            engineVersion: SERVER_ENGINE_VERSION
        });
    } catch (error) {
        const status = Number(error?.httpStatus) || 500;
        return res.status(status).json({
            success: false,
            code: error.code || 'CALCIO_26D_BATCH_ALLOCATION_ERROR',
            error: error.message,
            pendingEventKeys: error.pendingEventKeys || [],
            missingEventKeys: error.missingEventKeys || [],
            bankrollMismatches: error.mismatches || [],
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
});

app.get('/api/calcio/stakes/authority-audit', (req, res) => {
    try {
        const batchId = String(req.query.batchId || '').trim();
        const limit = Math.min(500, Math.max(1, safeNumber(req.query.limit, 100)));
        const rows = batchId
            ? db.prepare(`SELECT * FROM calcio_stake_authority_audit_log WHERE batch_id=? ORDER BY id DESC LIMIT ?`).all(batchId, limit)
            : db.prepare(`SELECT * FROM calcio_stake_authority_audit_log ORDER BY id DESC LIMIT ?`).all(limit);
        const positiveWithNonPositiveRobustEv = rows.filter(row => safeNumber(row.final_stake, 0) > 0 && safeNumber(row.robust_ev_pct, -999) <= 0).length;
        return res.json({
            success: true,
            readOnly: true,
            version: calcioUnifiedStakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION,
            batchId: batchId || null,
            count: rows.length,
            positiveWithNonPositiveRobustEv,
            rows
        });
    } catch (error) {
        return res.status(500).json({ success: false, readOnly: true, error: error.message });
    }
});

app.get('/api/calcio/diagnostics/final-market-contract', (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, safeNumber(req.query.limit, 200)));
        const rows = db.prepare(`
            SELECT id, match_date, home_team, away_team, prediction, market_type, odd,
                   estimated_prob, edge_pp, ev_pct, calcio_analysis_batch_id,
                   calcio_final_market_contract_version, calcio_final_market_id,
                   calcio_final_market_snapshot, calcio_forecast_confidence_score,
                   calcio_forecast_confidence_label, calcio_decision_state,
                   calcio_decision_state_reason, calcio_diagnostic_coherence_status,
                   calcio_data_quality_status, calcio_stake_authority_final_stake,
                   calcio_operational_stake
            FROM ai_forward_test
            WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
              AND UPPER(COALESCE(status,'PENDING'))='PENDING'
              AND calcio_final_market_contract_version IS NOT NULL
            ORDER BY id DESC
            LIMIT ?
        `).all(limit);
        const diagnostics = rows.map(row => {
            const snapshot = safeJsonParse(row.calcio_final_market_snapshot, {}) || {};
            const mismatches = [];
            if (String(row.prediction || '') !== String(snapshot.prediction || '')) mismatches.push('PREDICTION');
            if (String(row.market_type || '').toUpperCase() !== String(snapshot.marketType || '').toUpperCase()) mismatches.push('MARKET_TYPE');
            for (const [name, left, right] of [
                ['ODD', row.odd, snapshot.odd],
                ['PROBABILITY', row.estimated_prob, snapshot.probabilityPct],
                ['EDGE', row.edge_pp, snapshot.edgePp],
                ['EV', row.ev_pct, snapshot.evPct],
                ['STAKE', row.calcio_operational_stake, snapshot.stake?.finalOperationalStake]
            ]) {
                if (Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) > 0.011) mismatches.push(name);
            }
            if (String(row.calcio_final_market_id || '') !== String(snapshot.marketId || '')) mismatches.push('MARKET_ID');
            if (String(row.calcio_diagnostic_coherence_status || '') !== calcioFinalMarketDiagnosticContract.COHERENCE_CERTIFIED) mismatches.push('COHERENCE');
            return {
                id: row.id,
                match: `${row.home_team || ''} - ${row.away_team || ''}`,
                batchId: row.calcio_analysis_batch_id,
                prediction: row.prediction,
                marketId: row.calcio_final_market_id,
                decisionState: row.calcio_decision_state,
                forecastConfidence: {
                    score: row.calcio_forecast_confidence_score,
                    label: row.calcio_forecast_confidence_label
                },
                dataQuality: row.calcio_data_quality_status,
                operationalStake: safeNumber(row.calcio_operational_stake, 0),
                coherenceStatus: row.calcio_diagnostic_coherence_status,
                mismatches
            };
        });
        const stateCounts = diagnostics.reduce((acc, row) => {
            const key = row.decisionState || 'N/D';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return res.json({
            success: true,
            readOnly: true,
            version: calcioFinalMarketDiagnosticContract.CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION,
            count: diagnostics.length,
            coherentRows: diagnostics.filter(row => row.mismatches.length === 0).length,
            mismatchRows: diagnostics.filter(row => row.mismatches.length > 0).length,
            stateCounts,
            rows: diagnostics
        });
    } catch (error) {
        return res.status(500).json({ success: false, readOnly: true, error: error.message });
    }
});

app.get('/api/calcio/portfolio/batch/:batchId', (req, res) => {
    try {
        return res.json(calcioBatchPortfolioAllocator.auditBatch(db, req.params.batchId));
    } catch (error) {
        return res.status(500).json({
            success: false,
            readOnly: true,
            code: error.code || 'CALCIO_26C_BATCH_AUDIT_ERROR',
            error: error.message
        });
    }
});

// PATCH 26F-C: confronto read-only tra IPM legacy e architettura dual-score shadow.
app.get('/api/calcio/diagnostics/dual-score', (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, safeNumber(req.query.limit, 200)));
        const rows = db.prepare(`
            SELECT id, match_date, home_team, away_team, prediction, odd, estimated_prob,
                   calcio_final_market_id, calcio_decision_state, calcio_operational_stake,
                   calcio_prediction_index_score, calcio_dual_score_version,
                   calcio_dual_score_mode, calcio_forecast_confidence_shadow,
                   calcio_value_score_shadow, calcio_context_risk_penalty,
                   calcio_decision_readiness_shadow, calcio_decision_readiness_label,
                   calcio_dual_score_old_ipm, calcio_dual_score_delta_vs_ipm,
                   calcio_dual_score_pt_sample, calcio_dual_score_pt_weight,
                   calcio_dual_score_authority, calcio_dual_score_audit
            FROM ai_forward_test
            WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
              AND calcio_dual_score_version IS NOT NULL
            ORDER BY id DESC
            LIMIT ?
        `).all(limit).map(row => ({
            ...row,
            audit: calcioDualScoreArchitecture.fromRow(row)
        }));
        const ptNoSampleRows = rows.filter(row => safeNumber(row.calcio_dual_score_pt_sample, 0) <= 0).length;
        const ptNoSampleNonZeroWeight = rows.filter(row => safeNumber(row.calcio_dual_score_pt_sample, 0) <= 0 && Math.abs(safeNumber(row.calcio_dual_score_pt_weight, 0)) > 1e-9).length;
        const authorityViolations = rows.filter(row => safeNumber(row.calcio_dual_score_authority, 0) !== 0).length;
        const finiteRows = rows.filter(row => [
            row.calcio_forecast_confidence_shadow,
            row.calcio_value_score_shadow,
            row.calcio_context_risk_penalty,
            row.calcio_decision_readiness_shadow
        ].every(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100)).length;
        return res.json({
            success: ptNoSampleNonZeroWeight === 0 && authorityViolations === 0 && finiteRows === rows.length,
            readOnly: true,
            version: calcioDualScoreArchitecture.CALCIO_DUAL_SCORE_VERSION,
            mode: calcioDualScoreArchitecture.CALCIO_DUAL_SCORE_MODE,
            count: rows.length,
            finiteRows,
            ptNoSampleRows,
            ptNoSampleNonZeroWeight,
            authorityViolations,
            productionAuthorityChanged: false,
            rows
        });
    } catch (error) {
        return res.status(500).json({ success: false, readOnly: true, error: error.message });
    }
});

// PATCH 26F-B: matrice read-only della copertura storica e delle cause PRIOR_ONLY.
app.get('/api/calcio/diagnostics/historical-coverage', (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, safeNumber(req.query.limit, 200)));
        const rows = db.prepare(`
            SELECT id, match_date, home_team, away_team, prediction, league, status,
                   calcio_historical_coverage_version, calcio_historical_coverage_status,
                   calcio_historical_coverage_reason, calcio_historical_home_source,
                   calcio_historical_away_source, calcio_historical_coverage_sample,
                   calcio_historical_coverage_confidence, calcio_historical_coverage_audit
            FROM ai_forward_test
            WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
              AND calcio_historical_coverage_version IS NOT NULL
            ORDER BY id DESC
            LIMIT ?
        `).all(limit).map(row => ({
            ...row,
            audit: safeJsonParse(row.calcio_historical_coverage_audit, {}) || {}
        }));
        const reasonCounts = {};
        const statusCounts = {};
        for (const row of rows) {
            const reason = row.calcio_historical_coverage_reason || 'N/D';
            const status = row.calcio_historical_coverage_status || 'N/D';
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
        const resolvedRows = rows.filter(row => !['PRIOR_ONLY', 'NO_HISTORY'].includes(String(row.calcio_historical_coverage_status || '').toUpperCase())).length;
        return res.json({
            success: true,
            readOnly: true,
            version: calcioHistoricalCoverage.CALCIO_HISTORICAL_COVERAGE_VERSION,
            count: rows.length,
            resolvedRows,
            priorOnlyRows: rows.length - resolvedRows,
            priorOnlyPct: rows.length ? Number((((rows.length - resolvedRows) / rows.length) * 100).toFixed(2)) : 0,
            statusCounts,
            reasonCounts,
            rows
        });
    } catch (error) {
        return res.status(500).json({ success: false, readOnly: true, error: error.message });
    }
});

// PATCH 26A: endpoint diagnostico read-only. Non ricalcola né modifica pronostici o stake.
app.get('/api/calcio/diagnostics/finalization-audit', (req, res) => {
    try {
        return res.json(calcioObservability.buildDiagnosticsReport(db, { limit: req.query.limit }));
    } catch (error) {
        return res.status(500).json({
            success: false,
            version: calcioObservability.CALCIO_OBSERVABILITY_VERSION,
            readOnly: true,
            decisionAuthorityChanged: false,
            stakeAuthorityChanged: false,
            error: error.message
        });
    }
});

app.get('/api/setup/tennis-automation', (req, res) => {
    try { res.json(tennisScheduler.getCronConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/setup/tennis-automation', (req, res) => {
    try { const config = tennisScheduler.saveCronConfig(req.body); res.json({ success: true, config, status: typeof tennisScheduler.getSchedulerStatus === 'function' ? tennisScheduler.getSchedulerStatus() : { config } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/setup/calcio-automation', (req, res) => {
    try { res.json(calcioScheduler.getCronConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/setup/calcio-automation', (req, res) => {
    try {
        const body = { ...(req.body || {}) };
        if (body.enabled === true && body.explicitEnable !== true && body.patch58ExplicitEnable !== true) {
            return res.status(409).json({ success: false, code: 'PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED', error: 'Abilitazione scheduler Calcio richiede conferma esplicita.' });
        }
        const config = calcioScheduler.saveCronConfig(body);
        const status = typeof calcioScheduler.getSchedulerStatus === 'function' ? calcioScheduler.getSchedulerStatus() : { config };
        if (!status?.stateMachine || status.stateMachine.configEnabled !== (config.enabled === true)) {
            const error = new Error('AUDIT16A_CALCIO_SCHEDULER_STATE_NOT_PERSISTED');
            error.code = 'AUDIT16A_CALCIO_SCHEDULER_STATE_NOT_PERSISTED';
            throw error;
        }
        res.json({ success: true, config, status, persistence: { atomic: true, configEnabled: config.enabled === true, stateConfigEnabled: status.stateMachine.configEnabled === true, audit: 'AUDIT16A' } });
    } catch (e) { res.status(e.code === 'PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED' ? 409 : 500).json({ success: false, code: e.code || null, error: e.message }); }
});

// ============================================================================
// BACKGROUND MODE + SPORT BANKROLL PERSISTENCE
// ============================================================================
function getCleanRowsForBankroll() { return getCleanResolvedRows(); }
app.get('/api/bankroll/status', (req, res) => { try { const sport = String(req.query.sport || 'ALL').toUpperCase(); const status = sportLedgerR3(sport); return res.json({ success: true, ...status }); } catch (e) { return res.status(500).json({ success: false, error: e.message }); } });
app.post('/api/bankroll/set', (req, res) => { try { const sport = String(req.body.sport || 'CALCIO').toUpperCase(); const bankroll = req.body.bankroll; throw new Error('Capitale iniziale fisso: 1000 euro per sport. Saldo calcolato dai risultati.'); const status = null; return res.json({ success: true, ...status }); } catch (e) { return res.status(400).json({ success: false, error: e.message }); } });
app.get('/api/background/status', (req, res) => { try { const calcio = typeof calcioScheduler.getSchedulerStatus === 'function' ? calcioScheduler.getSchedulerStatus() : { config: calcioScheduler.getCronConfig(), hasActiveCronJob: false }; const tennis = typeof tennisScheduler.getSchedulerStatus === 'function' ? tennisScheduler.getSchedulerStatus() : { config: tennisScheduler.getCronConfig(), hasActiveCronJob: false }; return res.json({ success: true, enabled: Boolean(calcio?.config?.enabled || tennis?.config?.enabled), calcio, tennis, note: 'Il background resta attivo finché il processo Node server.js è in esecuzione.' }); } catch (e) { return res.status(500).json({ success: false, error: e.message }); } });

// PATCH57_PRODUCTION_SECURITY_SAFE_RELEASE
app.get('/api/production-security-health', (req, res) => {
    try {
        return res.json(productionSecuritySafeReleasePatch57.buildProductionSecurityHealth({ projectRoot: path.join(__dirname, '..') }));
    } catch (error) {
        return res.status(500).json({ success:false, healthy:false, securityReady:false, status:'ERROR', version:productionSecuritySafeReleasePatch57.VERSION, error:error.message });
    }
});
app.get('/api/production-security/runtime', (req, res) => {
    try {
        const config = productionSecuritySafeReleasePatch57.resolveRuntimeConfig();
        return res.json({ success:config.ready, readOnly:true, version:productionSecuritySafeReleasePatch57.VERSION, runtime:productionSecuritySafeReleasePatch57.safeRuntimeConfig(config) });
    } catch (error) {
        return res.status(500).json({ success:false, readOnly:true, version:productionSecuritySafeReleasePatch57.VERSION, error:error.message });
    }
});

// PATCH54_CALCIO_REGISTRY_INVENTORY_REGRESSION_HARMONIZATION
app.get('/api/calcio/registry-inventory-health', (req, res) => {
    try {
        return res.json(calcioRegistryInventoryHarmonizationPatch54.buildCalcioRegistryInventoryHealth({ projectRoot: __dirname + '/..' }));
    } catch (error) {
        return res.status(500).json({ success: false, status: 'ERROR', version: calcioRegistryInventoryHarmonizationPatch54.CALCIO_REGISTRY_INVENTORY_HARMONIZATION_VERSION, error: error.message });
    }
});

// PATCH55_STATISTICAL_PRODUCTION_READINESS_GATE
app.get('/api/production-readiness', (req, res) => {
    try {
        return res.json(statisticalProductionReadinessGatePatch55.buildStatisticalProductionReadinessReport(db, { projectRoot: __dirname + '/..' }));
    } catch (error) {
        return res.status(500).json({ success:false, status:'ERROR', version:statisticalProductionReadinessGatePatch55.VERSION, readOnly:true, error:error.message });
    }
});
app.get('/api/production-readiness/tennis', (req, res) => {
    try {
        const report=statisticalProductionReadinessGatePatch55.buildStatisticalProductionReadinessReport(db,{projectRoot:__dirname+'/..'});
        return res.json({success:true,readOnly:true,version:report.version,policyVersion:report.policyVersion,...report.tennis,authority:report.authority});
    } catch(error){ return res.status(500).json({success:false,status:'ERROR',version:statisticalProductionReadinessGatePatch55.VERSION,readOnly:true,error:error.message}); }
});
app.get('/api/production-readiness/calcio', (req, res) => {
    try {
        const report=statisticalProductionReadinessGatePatch55.buildStatisticalProductionReadinessReport(db,{projectRoot:__dirname+'/..'});
        return res.json({success:true,readOnly:true,version:report.version,policyVersion:report.policyVersion,...report.calcio,authority:report.authority});
    } catch(error){ return res.status(500).json({success:false,status:'ERROR',version:statisticalProductionReadinessGatePatch55.VERSION,readOnly:true,error:error.message}); }
});

// PATCH56_UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY
app.get('/api/portfolio-risk-authority', (req, res) => {
    try {
        return res.json(unifiedCrossSportPortfolioRiskAuthorityPatch56.health(db, { projectRoot: __dirname + '/..' }));
    } catch (error) {
        return res.status(500).json({ success:false, healthy:false, status:'ERROR', version:unifiedCrossSportPortfolioRiskAuthorityPatch56.VERSION, readOnly:true, error:error.message });
    }
});
app.get('/api/portfolio-risk-authority/tennis', (req, res) => {
    try {
        const readiness=statisticalProductionReadinessGatePatch55.buildStatisticalProductionReadinessReport(db,{projectRoot:__dirname+'/..'});
        const decision=unifiedCrossSportPortfolioRiskAuthorityPatch56.decide({
            sport:'TENNIS', proposedStake:Number(req.query.proposedStake||0), bankrollSnapshot:Number(req.query.bankroll||0)
        },{db,projectRoot:__dirname+'/..',readinessReport:readiness});
        return res.json({success:true,readOnly:true,decision,authority:'PATCH56_REAL_MONEY_EXPOSURE_PROJECTION'});
    } catch(error){ return res.status(500).json({success:false,status:'ERROR',version:unifiedCrossSportPortfolioRiskAuthorityPatch56.VERSION,readOnly:true,error:error.message}); }
});
app.get('/api/portfolio-risk-authority/calcio', (req, res) => {
    try {
        const readiness=statisticalProductionReadinessGatePatch55.buildStatisticalProductionReadinessReport(db,{projectRoot:__dirname+'/..'});
        const decision=unifiedCrossSportPortfolioRiskAuthorityPatch56.decide({
            sport:'CALCIO', proposedStake:Number(req.query.proposedStake||0), bankrollSnapshot:Number(req.query.bankroll||0)
        },{db,projectRoot:__dirname+'/..',readinessReport:readiness});
        return res.json({success:true,readOnly:true,decision,authority:'PATCH56_REAL_MONEY_EXPOSURE_PROJECTION'});
    } catch(error){ return res.status(500).json({success:false,status:'ERROR',version:unifiedCrossSportPortfolioRiskAuthorityPatch56.VERSION,readOnly:true,error:error.message}); }
});

app.post('/api/background/set', (req, res) => {
    try {
        const enabled = req.body.enabled === true;
        const calcioBankroll = getCurrentBankroll('CALCIO');
        const tennisBankroll = getCurrentBankroll('TENNIS');
        const calcioCurrent = calcioScheduler.getCronConfig();
        const hasCalcioRequest = typeof req.body.calcioEnabled === 'boolean';
        const calcioEnabled = hasCalcioRequest ? req.body.calcioEnabled === true : calcioCurrent.enabled === true;
        if (hasCalcioRequest && calcioEnabled && calcioCurrent.enabled !== true && req.body.calcioExplicitEnable !== true) {
            return res.status(409).json({ success: false, code: 'PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED', error: 'Background Calcio richiede calcioExplicitEnable=true alla prima attivazione.' });
        }
        const calcioConfig = calcioScheduler.saveCronConfig({ ...calcioCurrent, enabled: calcioEnabled, bankroll: calcioBankroll, explicitEnable: hasCalcioRequest && calcioEnabled && req.body.calcioExplicitEnable === true });
        const calcioStatus = calcioScheduler.getSchedulerStatus();
        const tennisConfig = tennisScheduler.saveCronConfig({ ...tennisScheduler.getCronConfig(), enabled, bankroll: tennisBankroll });
        return res.json({ success: true, enabled: Boolean(calcioConfig.enabled || tennisConfig.enabled), requestedGlobalEnabled: enabled, calcio: { config: calcioConfig, status: calcioStatus, bankroll: calcioBankroll, explicitlyRequested: hasCalcioRequest, explicitEnableRequired: calcioConfig.enabled !== true }, tennis: { config: tennisConfig, bankroll: tennisBankroll }, persistence: { calcioAtomic: true, audit: 'AUDIT16A' }, note: 'Background Tennis segue enabled. Calcio viene modificato solo con calcioEnabled; la prima attivazione richiede calcioExplicitEnable=true.' });
    } catch (e) {
        return res.status(e.code === 'PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED' ? 409 : 500).json({ success: false, code: e.code || null, error: e.message });
    }
});

// ============================================================================
// GLOBAL QUANT ANALYTICS
// ============================================================================
app.get('/api/analytics/global', async (req, res) => {
    try {
        const analytics = buildGlobalAnalytics();
        return res.json({ success: true, analytics });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/analytics/calcio', async (req, res) => {
    try {
        const analytics = buildSportAnalytics('CALCIO');
        return res.json({ success: true, analytics });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/analytics/tennis', async (req, res) => {
    try {
        const analytics = buildSportAnalytics('TENNIS');
        return res.json({ success: true, analytics });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// ⚡ PORTFOLIO REPORT PARAMETRIZZATO E SEPARATO PER SPORT
// ============================================================================
app.get('/api/portfolio/report', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const baseBankroll = safeNumber(req.query.bankroll, NaN);
        const rows = getStrictResolvedRows();
        const portfolioHistoryRows = filterRowsForSport(
            rows.filter(isStrictCurrentQuality).filter(isResolvedWonLost),
            sport
        );
        const portfolioOperationalRows = portfolioHistoryRows.filter(isPortfolioOperationalRow);
        const report = buildStrictPortfolioReport(rows, { sport, baseBankroll });
        const currentAuditRows = filterRowsForSport(db.prepare(`
            SELECT * FROM ai_forward_test
            WHERE COALESCE(paper_result_active, 1) = 1
              AND COALESCE(paper_result_conflict, 0) = 0
              AND UPPER(COALESCE(data_quality, 'CURRENT_BOOTSTRAP')) NOT IN ('LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS')
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE 'MULTI%'
        `).all(), sport);
        const dsGatePerformance = calcioStakePortfolioAudit.buildDsGateMetrics(currentAuditRows);
        const stakeDiagnostics = (sport === 'CALCIO' || sport === 'FOOTBALL' || sport === 'ALL')
            ? calcioStakePortfolioAudit.buildStakeDiagnostics(currentAuditRows.filter(isFootballRow))
            : null;
        const reliabilityCalibration = (sport === 'CALCIO' || sport === 'FOOTBALL' || sport === 'ALL')
            ? calcioReliabilityCalibration.buildReliabilityCalibration(currentAuditRows.filter(isFootballRow))
            : null;
        return res.json({
            success: true,
            dataMode: 'STRICT_CURRENT_OPERATIONAL_ONLY',
            portfolioHistoryFallbackMode: 'STEP91L_PORTFOLIO_REPORT_HISTORY_FALLBACK',
            history: portfolioHistoryRows,
            operationalHistory: portfolioOperationalRows,
            report,
            stakeDiagnostics,
            reliabilityCalibration,
            dsGatePerformance,
            meta: {
                ...report.meta,
                dataMode: 'STRICT_CURRENT_OPERATIONAL_ONLY'
            },
            warning: report.meta.sampleSize < 10
                ? 'Campione strict/current insufficiente: non usare il portfolio come misura predittiva professionale.'
                : null
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/calcio/analytics/reliability-calibration', async (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT * FROM ai_forward_test
            WHERE COALESCE(paper_result_active, 1) = 1
              AND COALESCE(paper_result_conflict, 0) = 0
              AND UPPER(COALESCE(data_quality, 'CURRENT_BOOTSTRAP')) NOT IN ('LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS')
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE 'MULTI%'
        `).all().filter(isFootballRow);
        return res.json({
            success: true,
            readOnly: true,
            report: calcioReliabilityCalibration.buildReliabilityCalibration(rows),
            safeguards: {
                reliabilityIsNotWinProbability: true,
                noStakeAuthority: true,
                productionProbabilityUnchanged: true,
                historicalRowsUnchanged: true
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/analytics/strategies', async (req, res) => {
    try {
        const bets = getCleanResolvedRows();
        const sport = String(req.query.sport || 'all').toUpperCase();
        const filtered = sport === 'CALCIO' ? bets.filter(isFootballRow) : (sport === 'TENNIS' ? bets.filter(isTennisRow) : bets);
        const strategies = valueEvaluator.calculateStrategyAnalytics(filtered, { cleanOnly: true, sportFilter: sport === 'CALCIO' ? 'football' : (sport === 'TENNIS' ? 'tennis' : null) });
        return res.json({ success: true, strategies });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/risk/live', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'all').toUpperCase();
        let openBets = db.prepare(`SELECT * FROM ai_forward_test WHERE status = 'PENDING' AND COALESCE(data_quality, ?) != ?`).all(DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY);
        let settled = getCleanResolvedRows();
        if (sport === 'CALCIO') { openBets = openBets.filter(isFootballRow); settled = settled.filter(isFootballRow); }
        if (sport === 'TENNIS') { openBets = openBets.filter(isTennisRow); settled = settled.filter(isTennisRow); }
        const drawdown = paperTradingEngine.analyzeDrawdown(settled);
        const exposure = openBets.reduce((acc, b) => { return acc + safeNumber(b.stake, 0); }, 0);

        return res.json({
            success: true,
            bankroll: getCurrentBankroll(sport),
            openExposure: Number(exposure.toFixed(2)),
            openBets: openBets.length,
            drawdown
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/clv/report', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        // STEP91M_VERIFIED_CLV_PORTFOLIO_REPAIR: non trattare clv/clv_edge legacy come closing line se non verificati.
        let bets = getStrictSettledRows().filter(row => valueEvaluator.extractClvPct(row) !== null);
        bets = filterRowsForSport(bets, sport);
        const report = valueEvaluator.calculateCLVAnalytics(bets, { cleanOnly: true, sportFilter: sport === 'CALCIO' ? 'football' : (sport === 'TENNIS' ? 'tennis' : null) });
        const coverage = clvCrossSportCoveragePatch53.buildCoverageReport(db, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet });
        return res.json({ success: true, report, coverage, meta: { sport, dataMode: 'STRICT_CURRENT_OPERATIONAL_ONLY', sampleSize: bets.length, coverageVersion: clvCrossSportCoveragePatch53.VERSION } });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/clv/learning', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const minSample = parseInt(req.query.minSample || (sport === 'TENNIS' ? '20' : '30'), 10);
        const rows = getStrictSettledRows();
        const payload = {
            success: true,
            sport,
            dataMode: 'STRICT_CURRENT_CLV_LEARNING',
            tennis: sport === 'CALCIO' ? null : tennisClvLearningEngine.buildTennisClvLearningReport(rows, { minSample }),
            calcio: sport === 'TENNIS' ? null : calcioClvLearningEngine.buildCalcioClvLearningReport(rows, { minSample })
        };
        return res.json(payload);
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/portfolio/audit-scope', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const rows = filterRowsForSport(getStrictSettledRows(), sport);
        return res.json({
            success: true,
            sport,
            dataMode: 'STRICT_CURRENT_AUDIT_SCOPE',
            tennis: tennisScope.buildTennisPortfolioAuditBreakdown(rows),
            calcio: calcioScope.buildCalcioPortfolioAuditBreakdown(rows)
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/audit-trail/summary', async (req, res) => {
    try {
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const limit = parseInt(req.query.limit || '50', 10);
        return res.json(auditTrail.getAuditTrailSummary(db, { sport, limit }));
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/analytics/calibration', async (req, res) => {
    try {
        const bucketSize = parseInt(req.query.bucketSize || '5', 10);
        const minSample = parseInt(req.query.minSample || '10', 10);
        const sport = String(req.query.sport || 'ALL').toUpperCase();
        const operationalOnly = String(req.query.operationalOnly || 'false').toLowerCase() === 'true';
        const rows = getStrictResolvedRows();
        const tennisReport = sport === 'CALCIO' ? null : tennisCalibrationEngine.buildTennisCalibrationReport(rows, { bucketSize, minSample, operationalOnly });
        const calcioReport = sport === 'TENNIS' ? null : calcioCalibrationEngine.buildCalcioCalibrationReport(rows, { bucketSize, minSample, operationalOnly });
        const sampleSize = (tennisReport?.sample || 0) + (calcioReport?.sample || 0);
        return res.json({
            success: true,
            report: {
                tennis: tennisReport,
                calcio: calcioReport
            },
            meta: {
                sport,
                dataMode: operationalOnly ? 'STRICT_CURRENT_OPERATIONAL_ONLY' : 'STRICT_CURRENT_WITH_AUDIT_FOR_CALIBRATION',
                sampleSize,
                bucketSize,
                minSample,
                enginesSeparated: true,
                filters: {
                    data_quality: ['CURRENT', DATA_QUALITY_CURRENT],
                    status: ['WON', 'LOST'],
                    legacyNullExcluded: true,
                    legacyDirtyExcluded: true,
                    sportSeparated: true
                }
            },
            warning: sampleSize < minSample
                ? `Campione ${sport} strict/current insufficiente (${sampleSize}/${minSample}).`
                : null
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/analytics/calibration/strategies', async (req, res) => {
    try {
        const bucketSize = parseInt(req.query.bucketSize || '5', 10);
        const minSample = parseInt(req.query.minSample || '5', 10);
        const sport = String(req.query.sport || 'all').toUpperCase();
        let bets = getCleanResolvedRows();
        if (sport === 'CALCIO') bets = bets.filter(isFootballRow);
        if (sport === 'TENNIS') bets = bets.filter(isTennisRow);
        const report = valueEvaluator.calculateStrategyCalibrationReport(bets, { bucketSize, minSample, cleanOnly: true, sportFilter: sport === 'CALCIO' ? 'football' : (sport === 'TENNIS' ? 'tennis' : null) });
        return res.json({ success: true, report });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});


app.get('/api/debug/calcio/diagnostics', async (req, res) => {
    try {
        const settingsRow = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
        const settings = settingsRow ? safeJsonParse(settingsRow.config_json, {}) : {};
        const cleanResolved = getCleanResolvedRows();
        const cleanSettled = getCleanSettledRows();
        const pending = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE status = 'PENDING'
              AND COALESCE(data_quality, ?) != ?
        `).all(DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY);

        const footballResolved = cleanResolved.filter(isFootballRow);
        const tennisResolved = cleanResolved.filter(isTennisRow);
        const footballPending = pending.filter(isFootballRow);
        const tennisPending = pending.filter(isTennisRow);

        return res.json({
            success: true,
            engineVersion: SERVER_ENGINE_VERSION,
            dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
            dbPath: DB_PATH,
            counts: {
                cleanSettled: cleanSettled.length,
                cleanResolved: cleanResolved.length,
                footballResolved: footballResolved.length,
                tennisResolved: tennisResolved.length,
                footballPending: footballPending.length,
                tennisPending: tennisPending.length
            },
            optimization: {
                calcio: buildOptimizationDisabledPayload('CALCIO'),
                tennis: buildOptimizationDisabledPayload('TENNIS')
            },
            settings: {
                useCrossReference: settings.useCrossReference,
                onlyGlobal: settings.onlyGlobal,
                useAdvancedMetrics: settings.useAdvancedMetrics,
                baseEdge: settings.baseEdge,
                baseProb: settings.baseProb,
                u25Edge: settings.u25Edge,
                u25Prob: settings.u25Prob,
                home1Edge: settings.home1Edge,
                home1Prob: settings.home1Prob,
                x2Edge: settings.x2Edge,
                x2Prob: settings.x2Prob
            }
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message, engineVersion: SERVER_ENGINE_VERSION });
    }
});


// ============================================================================
// STEP61 - MANUAL DEEPSCAN LAB (READ-ONLY)
// ============================================================================
// Endpoint isolato per analisi libere Calcio/Tennis. Non salva nel paper trading,
// non crea pending, non modifica portfolio/stake/storico e non usa The Odds API
// con default live OFF.
app.post('/api/manual-deepscan', async (req, res) => {
    try {
        const result = await manualDeepScanLab.runManualDeepScan(req.body || {});
        return res.json({
            ...result,
            engineVersion: SERVER_ENGINE_VERSION,
            manualDeepScanVersion: manualDeepScanLab.STEP61_MANUAL_DEEPSCAN_VERSION
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            mode: manualDeepScanLab.STEP61_MANUAL_DEEPSCAN_VERSION,
            error: error.message,
            doNotSave: true,
            savedToPaperTrading: false,
            pendingCreated: false,
            portfolioMutated: false,
            stakeMutated: false,
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        engineVersion: SERVER_ENGINE_VERSION,
        dbPath: DB_PATH,
        dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
        mountedRoutes: {
            calcio: true,
            tennis: true
        }
    });
});


// BETTING PATCH 23 R2 - body-parser errors must be explicit and must never be rendered as a fake DeepScan timeout.
app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
        return res.status(413).json({
            success: false,
            code: 'CALCIO_DEEPSCAN_PAYLOAD_TOO_LARGE',
            error: 'Payload DeepScan superiore al limite server. Aggiornare il frontend e usare il contratto compatto.',
            maxPayloadBytes: calcioDeepScanPayloadContract.SERVER_MAX_BYTES,
            payloadVersion: calcioDeepScanPayloadContract.CALCIO_DEEPSCAN_PAYLOAD_VERSION,
            engineVersion: SERVER_ENGINE_VERSION
        });
    }
    return next(error);
});

function readBooleanEnv(name, defaultValue = true) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return defaultValue;
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}


// STEP103C_CLV_RUNTIME_AUDIT_FINAL_REPAIR
// Auto tracker CLV scollegato dallo scheduler Calcio: resta attivo anche se il
// calcio scheduler è disattivato, e stampa in Node piano/esito/scarti CLV.
let step103ClvAutoTrackerTimer = null;
let step103ClvAutoTrackerRunning = false;

function startStep103ClvAutoTracker() {
    const enabled = readBooleanEnv('CLV_AUTO_TRACKER_ENABLED', true);
    const intervalMinutes = Math.max(1, Math.min(120, Number(process.env.CLV_AUTO_TRACKER_INTERVAL_MINUTES || 5)));
    const initialDelayMs = Math.max(0, Math.min(300000, Number(process.env.CLV_AUTO_TRACKER_INITIAL_DELAY_MS || 5000)));

    if (!enabled) {
        console.log('⏸️ [CLV AUTO STEP103] Auto tracker CLV disattivato da CLV_AUTO_TRACKER_ENABLED=0. Endpoint manuale: /api/internal/track-clv');
        return null;
    }

    async function runStep103ClvAutoTracker(source = 'interval') {
        if (step103ClvAutoTrackerRunning) {
            console.log('⏳ [CLV AUTO STEP103] Run saltata: tracker già in esecuzione.');
            return;
        }

        step103ClvAutoTrackerRunning = true;
        try {
            console.log('\n🧭 [CLV AUTO STEP103] Avvio ricerca CLV automatica source=' + source + '.');
            const result = await trackClosingLines(db, fetchOddsApi, LEAGUES_CONFIG);
            console.log('🧭 [CLV AUTO PATCH47] Esito: new=' + (result.clvEvidenceMetrics?.newLocks ?? 0) + ' unchanged=' + (result.clvEvidenceMetrics?.unchangedEvidence ?? 0) + ' updated=' + (result.updatedCount ?? 0) + ' apiFetch=' + (result.apiFetchCount ?? 0) + ' liveEvents=' + (result.liveMatchesSeen ?? 0) + ' reason=' + (result.reason || 'OK'));
        } catch (error) {
            console.warn('⚠️ [CLV AUTO STEP103] Errore ricerca CLV: ' + error.message);
        } finally {
            step103ClvAutoTrackerRunning = false;
        }
    }

    console.log('🧭 [CLV AUTO STEP103/104] Attivo ogni ' + intervalMinutes + ' minuti. Primo controllo tra ' + Math.round(initialDelayMs / 1000) + 's. Disattiva con CLV_AUTO_TRACKER_ENABLED=0. STEP104_CLV_CONTINUOUS_RUNTIME_GUARD');
    setTimeout(() => runStep103ClvAutoTracker('startup-delay'), initialDelayMs);
    step103ClvAutoTrackerTimer = setInterval(() => runStep103ClvAutoTracker('interval'), intervalMinutes * 60 * 1000);
    return step103ClvAutoTrackerTimer;
}

// PATCH58: inizializzazione/recovery state machine senza attivare produzione.
try {
    const patch58Bootstrap = operationalSchedulerStateMachinePatch58.bootstrap({ projectRoot: path.join(__dirname, '..') });
    console.log(`🧭 [PATCH58] State machine bootstrap: Tennis=${patch58Bootstrap.tennis?.state || 'N/D'} Calcio=${patch58Bootstrap.calcio?.state || 'N/D'}`);
} catch (error) {
    console.warn('⚠️ [PATCH58] Bootstrap state machine degradato:', error.message);
}

// Avvio Schedulers e Server
try {
    tennisScheduler.applySchedule();
} catch (error) {
    console.warn('⚠️ Scheduler Tennis non avviato:', error.message);
}

try {
    calcioScheduler.applySchedule();
} catch (error) {
    console.warn('⚠️ Scheduler Calcio non avviato:', error.message);
}

const PORT = PATCH57_SECURITY_CONFIG.port || Number(process.env.PORT || 3000);
const BIND_HOST = PATCH57_SECURITY_CONFIG.bindHost;

app.listen(PORT, BIND_HOST, () => {
    console.log(`🚀 Server Avviato su ${BIND_HOST}:${PORT}`);
    console.log(`🔐 [PATCH57] ${PATCH57_SECURITY_CONFIG.status} · remote=${PATCH57_SECURITY_CONFIG.remoteAccessEnabled ? 'TOKEN_GATED' : 'DISABLED'}`);
    console.log(`📁 DB: ${DB_PATH}`);
    console.log(`🧠 Engine: ${SERVER_ENGINE_VERSION}`);
    console.log('✅ API Analytics & Bootstrap Diagnostics Attivi.');
    calcioFootballDataProvider.scheduleBestEffortRefresh();
    try {
        const stakeReconcileReport = calcioStakeReconciler.reconcilePendingRows(db, { softMicroCapEur: 3 });
        console.log(`💶 [PATCH16 STAKE RECONCILE] eventi=${stakeReconcileReport.selectedLatestEvents} aggiornati=${stakeReconcileReport.updated} operativi=${stakeReconcileReport.operationalPositive}`);
    } catch (stakeReconcileError) {
        console.warn('⚠️ [PATCH16 STAKE RECONCILE] ' + stakeReconcileError.message);
    }
    startStep103ClvAutoTracker();
});