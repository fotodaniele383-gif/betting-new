// ============================================================================
// AI BETTING QUANT PRO - TENNIS PAPER TRADING ENGINE
// Versione: 11.4 (Integrazione API Key Dinamica per The Odds API)
// ============================================================================
//
// CHANGELOG 11.0
// - Compatibile con server.tennis.js v15+.
// - Compatibile con tennisValueEvaluator.js v4.1+.
// - Gestione nuovo storico pulito dopo eliminazione DB sporco.
// - Settlement Tennis più prudente.
// - Migliorata gestione VOID / RETIRED / WALKOVER / CANCELED / SUSPENDED.
// - Gestione PUSH per mercati totals con linea intera.
// - Filtri Tennis più robusti su sport_type, bet_type e strategy_tag.
// - Aggiornamento campi:
//      sport_type
//      edge_pp
//      ev_pct
//      model_version
//      metric_version
//      engine_version
//      data_quality
// - Nessuna reliability fittizia.
// - Nessun uso del vecchio storico come performance affidabile.
// - Statistiche frontend calcolate solo su dati CURRENT / CURRENT_BOOTSTRAP.
// - CLV letto in modo più difensivo e non forzato.
//
// CHANGELOG 11.1
// - Allineato a server.tennis.js v15.2 recommendation-only.
// - Query Tennis rese più strette: solo data_quality CURRENT/CURRENT_BOOTSTRAP esplicita.
// - Le righe senza data_quality non vengono più considerate pulite per statistiche/settlement automatico.
// - Settlement preserva e normalizza edge_pp, ev_pct, versioni e metadata.
// - Aggiunti diagnostics runtime per pending/resolved/skipped/unresolved.
// - Migliorata protezione contro contaminazione legacy dopo reset DB.
//
// CHANGELOG 11.2
// - Aggiunta strutturazione a Fasi Logiche (FASE 1-9) con log visivi nel processTennisPaperTrading
//   per tracciare esattamente quale task il programma sta eseguendo in tempo reale.
//
// CHANGELOG 11.3
// - Ottimizzazione Fase 5 (Web Fallback): elaborazione in batch paralleli (concurrency limit = 5) 
//   per abbattere i tempi di risoluzione senza incappare in blocchi anti-scraping.
// - Riduzione timeout e ritentativi massimi (fail-fast) per DuckDuckGo.
//
// CHANGELOG 11.4
// - Integrazione dinamica della API Key per The Odds API tramite process.env.ODDS_API_KEY.
// - Rimozione dei placeholder hardcoded nelle chiamate HTTP verso the-odds-api.com.
// ============================================================================


// ============================================================================
// 1. IMPORTAZIONI
// ============================================================================

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const apiUsageTracker = require('./apiUsageTracker');
const sideIdentity = require('./tennisSideIdentityGuard');
const tennisScope = require('./tennisOperationalScope');
const auditTrail = require('./auditTrail');
const settlementContract = require('./tennisSettlementContract');
const runtimeDiagnostics = require('./runtimeDiagnostics');
const tennisPredictionSnapshots = require('./tennisPredictionSnapshots');
const tennisCalibrationEligibility = require('./tennisCalibrationEligibility');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');
const tennisInformationRetrieval = require('./tennisInformationRetrievalCertification');
const tennisOfficialSettlementResolver = require('./tennisOfficialSettlementResolver');
const tennisSettlementUpdateAudit = require('./tennisSettlementUpdateAudit');
const tennisSettlementTruthR4 = require('./tennisSettlementTruthPatch34R4');
const tennisDeepScanTaxonomyPatch40 = require('./tennisDeepScanTaxonomyPatch40');
const tennisTradingReportingPatch40 = require('./tennisTradingReportingPatch40');
const tennisSettlementExceptionQueuePatch51 = require('./tennisSettlementExceptionQueuePatch51');
const audit13OutcomeSearch = require('./certifiedTradingOutcomeSearchAudit13');
const audit15SourceFusion = require('./certifiedOutcomeSourceFusionAudit15');


// ============================================================================
// 2. CONFIGURAZIONE ENGINE
// ============================================================================

const TENNIS_PAPER_ENGINE_VERSION = '11.9_PATCH51_SETTLEMENT_EXCEPTION_QUEUE_IDEMPOTENT_NOTIFICATIONS';
const TENNIS_MODEL_VERSION = 'TENNIS_QUANT_BOOTSTRAP_2026_V1';
const TENNIS_METRIC_VERSION = 'TENNIS_EDGE_EV_V2';

const DATA_QUALITY_CURRENT = 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_ALLOWED = ['CURRENT_BOOTSTRAP', 'CURRENT'];
const DATA_QUALITY_LEGACY_DIRTY = 'LEGACY_DIRTY';

const CACHE_DIR = path.resolve(__dirname, 'cache_results_tennis_v11');

const MAX_RETRIES = 4;
const RETRY_DELAYS = [300, 700, 1500, 3000];

const CACHE_TTL_MS = 48 * 3600 * 1000;

const DEFAULT_LOOKBACK_DAYS = 3;

// API KEY: The Odds API
// Può essere fornita all'avvio del server es: ODDS_API_KEY="la_tua_chiave" node server.js
const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || 'API_KEY_PLACEHOLDER';

// STEP58_TENNIS_RESULT_SETTLEMENT_GUARD
// Settlement risultati: prima DB/vault/cache/web affidabile, poi API solo se necessario.
const STEP58_SETTLEMENT_GUARD_MODE = 'STEP58_TENNIS_RESULT_SETTLEMENT_GUARD';
const STEP58_WEB_SCORE_FALLBACK_ENABLED = String(process.env.TENNIS_SETTLEMENT_WEB_FALLBACK || 'true').toLowerCase() !== 'false';
const STEP58_WEB_SCORE_MIN_CONFIDENCE = 0.86;

// STEP64_SETTLEMENT_API_BUDGET_GUARD
// Budget hard per settlement scores: evita che una run di chiusura risultati consumi
// molte chiamate API quando cache/vault/web non risolvono i match.
const STEP64_SETTLEMENT_API_BUDGET_MODE = 'STEP64_SETTLEMENT_API_BUDGET_GUARD';
const STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN = Math.max(0, Number(process.env.SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN || 3));
const STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS = Math.max(0, Number(process.env.SETTLEMENT_MIN_RESIDUAL_CREDITS || 500));

// STEP105_TENNIS_SETTLEMENT_TARGETED_RESULTS
// Usa sport key mirate per /scores quando il pending appartiene a uno Slam noto.
const STEP105_TENNIS_SETTLEMENT_TARGETED_RESULTS = 'STEP105_TENNIS_SETTLEMENT_TARGETED_RESULTS';
const STEP105_SETTLEMENT_TARGETED_KEYS_ENABLED = String(process.env.SETTLEMENT_TARGETED_SCORE_KEYS || '1') !== '0';
// STEP105C_TENNIS_SETTLEMENT_TARGETED_RESULTS_FINAL_REPAIR
// Marker espliciti richiesti dal test statico e dalla certificazione audit: le sport key
// Slam non devono essere solo generate per concatenazione, ma dichiarate in modo leggibile.
const STEP105C_TENNIS_SETTLEMENT_TARGETED_RESULTS_FINAL_REPAIR = 'STEP105C_TENNIS_SETTLEMENT_TARGETED_RESULTS_FINAL_REPAIR';
const STEP105_SLAM_SCORE_KEYS = Object.freeze({
    ATP: Object.freeze({
        australian_open: 'tennis_atp_australian_open',
        french_open: 'tennis_atp_french_open',
        wimbledon: 'tennis_atp_wimbledon',
        us_open: 'tennis_atp_us_open'
    }),
    WTA: Object.freeze({
        australian_open: 'tennis_wta_australian_open',
        french_open: 'tennis_wta_french_open',
        wimbledon: 'tennis_wta_wimbledon',
        us_open: 'tennis_wta_us_open'
    })
});


const MIN_MATCH_READY_HOURS = {
    GRAND_SLAM: 6.5,
    ATP_WTA_MAIN: 5,
    CHALLENGER: 3.5,
    ITF: 2.5,
    DEFAULT: 5
};

if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch (error) {
        console.warn('⚠️ Impossibile creare cache Tennis:', error.message);
    }
}


// ============================================================================
// 3. HELPERS NUMERICI E STRINGHE
// ============================================================================

function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeName(value) {
    return normalizeText(value)
        .replace(/\bmr\b|\bms\b|\bmiss\b|\bmrs\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function safeUpper(value) {
    return String(value || '').toUpperCase();
}

function isTennisBetRow(row = {}) {
    const sportType = safeUpper(row.sport_type);
    const betType = safeUpper(row.bet_type);
    const strategyTag = safeUpper(row.strategy_tag);

    return sportType === 'TENNIS' ||
        betType.includes('TENNIS') ||
        strategyTag.includes('TENNIS');
}

function isCurrentCleanRow(row = {}) {
    const dataQuality = safeUpper(row.data_quality);

    // Dopo la ricostruzione dello storico pulito, le righe senza data_quality
    // non devono più essere considerate affidabili/current.
    if (!dataQuality) return false;

    return DATA_QUALITY_ALLOWED.includes(dataQuality) &&
        dataQuality !== DATA_QUALITY_LEGACY_DIRTY &&
        dataQuality !== 'DIRTY' &&
        dataQuality !== 'OLD_METRICS';
}

function isExplicitCurrentDataQualitySql() {
    return `UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')`;
}

function isPendingStatus(status) {
    return safeUpper(status) === 'PENDING';
}

function isSettledStatus(status) {
    const s = safeUpper(status);
    return ['WON', 'LOST', 'PUSH', 'VOID'].includes(s);
}

function isResolvedForStats(status) {
    const s = safeUpper(status);
    return s === 'WON' || s === 'LOST';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================================
// 4. CACHE RISULTATI
// ============================================================================

function sanitizeFileNamePart(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

function getLastName(fullName) {
    if (!fullName) return '';

    const parts = normalizeName(fullName)
        .split(' ')
        .filter(Boolean);

    if (parts.length === 0) return '';

    return parts[parts.length - 1];
}

function getCacheFile(p1, p2, matchDate = '') {
    const p1Key = sanitizeFileNamePart(getLastName(p1) || p1);
    const p2Key = sanitizeFileNamePart(getLastName(p2) || p2);
    const dateKey = sanitizeFileNamePart(matchDate || 'unknown_date');

    return path.join(CACHE_DIR, `${p1Key}_${p2Key}_${dateKey}.json`);
}

function loadCache(p1, p2, matchDate = '') {
    const file = getCacheFile(p1, p2, matchDate);

    if (!fs.existsSync(file)) return null;

    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const age = Date.now() - Number(data.timestamp || 0);

        // AUDIT13: un risultato finale ufficiale con evidence hash non scade semanticamente.
        // Le cache web/provider non certificate mantengono invece il TTL storico.
        if (age > CACHE_TTL_MS && !audit13OutcomeSearch.isReusableCertifiedTennisCache(data)) return null;

        return data;
    } catch (error) {
        return null;
    }
}

function saveCache(p1, p2, matchDate, result) {
    try {
        const file = getCacheFile(p1, p2, matchDate);

        const payload = {
            timestamp: Date.now(),
            engineVersion: TENNIS_PAPER_ENGINE_VERSION,
            ...result
        };

        fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    } catch (error) {
        // Cache non bloccante.
    }
}


// ============================================================================
// STEP58 - RESULT VAULT / MATCH GROUPING HELPERS
// ============================================================================

function isResolvedVaultResult(result = {}) {
    if (!result || typeof result !== 'object') return false;
    if (result.isVoid === true) return true;
    if (result.winner === 'VOID' || result.totalGames === 'VOID') return true;
    if (result.winner === 1 || result.winner === 2) return true;
    if (typeof result.totalGames === 'number' && Number.isFinite(result.totalGames)) return true;
    return false;
}

function getMarketNeedForRows(rows = []) {
    return {
        needsWinner: rows.some(row => !safeUpper(row.prediction).includes('OVER') && !safeUpper(row.prediction).includes('UNDER')),
        needsTotals: rows.some(row => safeUpper(row.prediction).includes('OVER') || safeUpper(row.prediction).includes('UNDER'))
    };
}

function getMatchExposureKey(row = {}) {
    const dateKey = getDateOnlyKey(row.match_date) || sanitizeFileNamePart(row.match_date || 'unknown_date');
    return [
        dateKey,
        sanitizeFileNamePart(row.league || 'tennis'),
        sanitizeFileNamePart(normalizeName(row.home_team || 'p1')),
        sanitizeFileNamePart(normalizeName(row.away_team || 'p2'))
    ].join('|');
}

function groupPendingTennisBetsByMatch(rows = []) {
    const map = new Map();
    for (const row of rows) {
        const key = getMatchExposureKey(row);
        if (!map.has(key)) {
            map.set(key, {
                key,
                representative: row,
                rows: [],
                ready: false,
                reason: null,
                resolution: null,
                source: null
            });
        }
        map.get(key).rows.push(row);
    }
    return [...map.values()];
}

function createSettlementApiUsageSnapshot() {
    try {
        const summary = apiUsageTracker.getApiUsageSummary();
        const scoreStats = summary.byOperation?.scores_settlement || {};
        const cacheScoreStats = summary.cache?.byOperation?.scores_settlement || {};
        return {
            creditsUsed: toNumber(summary.creditsUsed, 0),
            requests: toNumber(scoreStats.requests, 0),
            operationCredits: toNumber(scoreStats.creditsUsed, 0),
            cacheHits: toNumber(cacheScoreStats.hits, 0),
            cacheMisses: toNumber(cacheScoreStats.misses, 0),
            cacheWrites: toNumber(cacheScoreStats.writes, 0),
            cacheBypasses: toNumber(cacheScoreStats.bypasses, 0)
        };
    } catch (error) {
        return { creditsUsed: 0, requests: 0, operationCredits: 0, cacheHits: 0, cacheMisses: 0, cacheWrites: 0, cacheBypasses: 0 };
    }
}

function diffSettlementApiUsage(before = {}, after = {}) {
    return {
        apiCreditsUsed: round(toNumber(after.operationCredits, 0) - toNumber(before.operationCredits, 0), 4),
        apiRequestsUsed: Math.max(0, Math.trunc(toNumber(after.requests, 0) - toNumber(before.requests, 0))),
        apiCacheHits: Math.max(0, Math.trunc(toNumber(after.cacheHits, 0) - toNumber(before.cacheHits, 0))),
        apiCacheMisses: Math.max(0, Math.trunc(toNumber(after.cacheMisses, 0) - toNumber(before.cacheMisses, 0))),
        apiCacheWrites: Math.max(0, Math.trunc(toNumber(after.cacheWrites, 0) - toNumber(before.cacheWrites, 0))),
        apiCacheBypasses: Math.max(0, Math.trunc(toNumber(after.cacheBypasses, 0) - toNumber(before.cacheBypasses, 0)))
    };
}

function inferRequiredTennisToursFromRows(rows = []) {
    const tours = new Set();
    for (const row of rows) {
        const text = [row.league, row.strategy_tag, row.bet_type, row.tour_type].map(v => safeUpper(v)).join(' ');
        if (text.includes('WTA')) tours.add('wta');
        if (text.includes('ATP')) tours.add('atp');
    }
    return tours;
}

// ============================================================================
// STEP105 - TARGETED SCORE SPORT KEYS
// ============================================================================
function normalizeStep105SportKey(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function getStep105TargetedScoreKey(tour = '', slug = '') {
    const normalizedTour = safeUpper(tour);
    const normalizedSlug = normalizeStep105SportKey(slug);
    if (!normalizedSlug) return null;
    if (normalizedTour === 'ATP') return STEP105_SLAM_SCORE_KEYS.ATP[normalizedSlug] || null;
    if (normalizedTour === 'WTA') return STEP105_SLAM_SCORE_KEYS.WTA[normalizedSlug] || null;
    return null;
}
function inferStep105SlamSlugFromDate(dateStr = '') {
    const d = parseItalianDateTime(dateStr);
    if (!d) return null;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    if (month === 1) return 'australian_open';
    if ((month === 5 && day >= 20) || (month === 6 && day <= 12)) return 'french_open';
    if ((month === 6 && day >= 20) || (month === 7 && day <= 15)) return 'wimbledon';
    if ((month === 8 && day >= 20) || (month === 9 && day <= 15)) return 'us_open';
    return null;
}

function inferStep105SlamSlugFromText(row = {}) {
    const text = safeUpper([row.tournament, row.tournament_name, row.event_name, row.league, row.series, row.strategy_tag, row.notes].filter(Boolean).join(' '));
    if (text.includes('ROLAND') || text.includes('FRENCH')) return 'french_open';
    if (text.includes('AUSTRALIAN')) return 'australian_open';
    if (text.includes('WIMBLEDON')) return 'wimbledon';
    if (text.includes('US OPEN') || text.includes('U.S. OPEN')) return 'us_open';
    if (text.includes('GRAND SLAM')) return inferStep105SlamSlugFromDate(row.match_date || row.date || row.created_at);
    return null;
}

function inferStep105SettlementSportKeysForRows(rows = []) {
    if (STEP105_SETTLEMENT_TARGETED_KEYS_ENABLED !== true) return [];
    const keys = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const explicit = normalizeStep105SportKey(row.api_sport_key || row.provider_sport_key || row.odds_sport_key || row.sport_key || row.the_odds_sport_key || '');
        if (explicit) {
            keys.add(explicit);
            continue;
        }
        const text = safeUpper([row.league, row.strategy_tag, row.bet_type, row.tour_type, row.sport_type].filter(Boolean).join(' '));
        const slug = inferStep105SlamSlugFromText(row);
        if (!slug) continue;
        if (text.includes('ATP')) {
            const atpKey = getStep105TargetedScoreKey('ATP', slug);
            if (atpKey) keys.add(atpKey);
        }
        if (text.includes('WTA')) {
            const wtaKey = getStep105TargetedScoreKey('WTA', slug);
            if (wtaKey) keys.add(wtaKey);
        }
    }
    return Array.from(keys);
}



function tennisSportKeyMatchesPendingTours(sportKey = '', tours = new Set()) {
    if (!tours || tours.size === 0) return true;
    const key = String(sportKey || '').toLowerCase();
    if (tours.has('atp') && key.includes('atp')) return true;
    if (tours.has('wta') && key.includes('wta')) return true;
    return false;
}

function updatePendingSettlementReason(db, match, reason, source = 'PENDING_STEP58') {
    if (!match || !match.id) return false;
    const fields = {
        settlement_source: source,
        settlement_note: reason,
        settlement_contract_status: settlementContract.SETTLEMENT_STATES.PENDING,
        settlement_contract_reason: reason,
        settlement_contract_version: settlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
        engine_version: TENNIS_PAPER_ENGINE_VERSION,
        data_quality: isCurrentCleanRow(match) ? match.data_quality : DATA_QUALITY_CURRENT
    };

    // AUDIT16D_R3_T7_R1: a settlement reason changes fields consumed by the forward
    // eligibility record. For an anchored forward bet the source row, eligibility
    // ledger and cohort maturity therefore have to move in one transaction.
    let lifecycleInspection = null;
    try {
        lifecycleInspection = tennisForwardLifecycle.inspectForwardLifecycleBet(db, match.id);
    } catch (inspectionError) {
        runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_LIFECYCLE', operation: 'SETTLEMENT_PENDING_REASON',
            operationId: runtimeDiagnostics.createOperationId('TENNIS_T7_PENDING_REASON_INSPECTION'),
            phase: 'T7_LIFECYCLE_INSPECTION_FAILED', error: inspectionError, context: { betId: match.id, source }
        });
        return false;
    }

    // Legacy/non-forward rows retain the historical direct update behavior. This
    // avoids creating a forward ledger or cohort for records that never had an
    // immutable calibration anchor.
    if (!lifecycleInspection.forwardTracked) {
        return safeUpdateRow(db, match.id, fields);
    }

    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T7_PENDING_REASON');
    try {
        const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, {
            betId: match.id,
            transition: tennisForwardLifecycle.TRANSITIONS.SETTLEMENT_PENDING_REASON,
            operationId
        }, () => {
            const updated = safeUpdateRow(db, match.id, fields);
            if (!updated) return { success: false, updated: false };
            return { success: true, updated: true };
        });
        return Boolean(lifecycleResult?.success);
    } catch (error) {
        runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_LIFECYCLE', operation: 'SETTLEMENT_PENDING_REASON',
            operationId, phase: 'T7_PENDING_REASON_ATOMIC_ROLLBACK', error,
            context: { betId: match.id, source, lifecycleAtomic: true }
        });
        return false;
    }
}


// ============================================================================
// 5. MATCHING NOMI TENNIS
// ============================================================================

function levenshtein(a, b) {
    const aa = normalizeName(a);
    const bb = normalizeName(b);

    if (!aa || !bb) return 999;

    const matrix = [];

    for (let i = 0; i <= bb.length; i++) matrix[i] = [i];
    for (let j = 0; j <= aa.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= bb.length; i++) {
        for (let j = 1; j <= aa.length; j++) {
            if (bb.charAt(i - 1) === aa.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[bb.length][aa.length];
}

function getNameTokens(fullName) {
    return normalizeName(fullName)
        .split(' ')
        .filter(Boolean);
}

function getFirstInitial(fullName) {
    const tokens = getNameTokens(fullName);
    if (!tokens.length) return '';
    return tokens[0][0] || '';
}

function isSamePlayer(a, b) {
    if (!a || !b) return false;

    const na = normalizeName(a);
    const nb = normalizeName(b);

    if (!na || !nb) return false;
    if (na === nb) return true;

    const la = getLastName(na);
    const lb = getLastName(nb);

    if (!la || !lb) return false;

    if (la === lb) {
        const ia = getFirstInitial(na);
        const ib = getFirstInitial(nb);

        if (!ia || !ib || ia === ib) return true;
    }

    if (la.length >= 4 && lb.length >= 4 && (la.includes(lb) || lb.includes(la))) {
        return true;
    }

    if (Math.max(la.length, lb.length) >= 6) {
        return levenshtein(la, lb) <= 1;
    }

    return false;
}

function matchPlayersPair(p1Db, p2Db, candidateA, candidateB) {
    const direct = isSamePlayer(p1Db, candidateA) && isSamePlayer(p2Db, candidateB);
    const reverse = isSamePlayer(p1Db, candidateB) && isSamePlayer(p2Db, candidateA);

    if (direct) {
        return {
            matched: true,
            orientation: 'DIRECT',
            p1Candidate: candidateA,
            p2Candidate: candidateB
        };
    }

    if (reverse) {
        return {
            matched: true,
            orientation: 'REVERSE',
            p1Candidate: candidateB,
            p2Candidate: candidateA
        };
    }

    return {
        matched: false,
        orientation: null,
        p1Candidate: null,
        p2Candidate: null
    };
}


// ============================================================================
// 6. PARSING DATE
// ============================================================================

function parseItalianDateTime(dateStr) {
    if (!dateStr || String(dateStr).includes('Sconosciuta')) return null;

    try {
        const raw = String(dateStr).trim();

        // Formato atteso dal server:
        // "18/05/2026, 14:30:00" oppure "18/05/2026, 14:30"
        if (raw.includes(',')) {
            const parts = raw.split(',').map(p => p.trim());
            const [day, month, year] = parts[0].split('/').map(Number);
            const timeParts = parts[1].split(':').map(Number);

            const hour = timeParts[0] || 0;
            const minute = timeParts[1] || 0;
            const second = timeParts[2] || 0;

            if (day && month && year) {
                return new Date(year, month - 1, day, hour, minute, second);
            }
        }

        // Fallback ISO o Date.parse.
        const parsed = new Date(raw);

        if (!isNaN(parsed.getTime())) return parsed;

        return null;
    } catch (error) {
        return null;
    }
}

function getMatchReadyHours(league = '') {
    const l = safeUpper(league);

    if (l.includes('GRAND SLAM')) return MIN_MATCH_READY_HOURS.GRAND_SLAM;
    if (l.includes('CHALLENGER')) return MIN_MATCH_READY_HOURS.CHALLENGER;
    if (l.includes('ITF') || l.includes('FUTURES')) return MIN_MATCH_READY_HOURS.ITF;

    return MIN_MATCH_READY_HOURS.ATP_WTA_MAIN;
}

function isTennisMatchReady(dateStr, league = '') {
    const matchDate = parseItalianDateTime(dateStr);

    if (!matchDate) return false;

    const now = new Date();
    const durationHours = getMatchReadyHours(league);
    const finishTime = new Date(matchDate.getTime() + (durationHours * 60 * 60 * 1000));

    return now.getTime() > finishTime.getTime();
}

function getDateOnlyKey(dateStr) {
    const parsed = parseItalianDateTime(dateStr);

    if (!parsed) return '';

    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
}


// ============================================================================
// 7. SCORE PARSER TENNIS
// ============================================================================

function isRetirementOrVoidText(raw) {
    const text = normalizeText(raw);
    if (!text) return false;
    // PATCH34 R4: sospensione/rinvio non equivalgono a VOID e non possono chiudere il mercato.
    const retirementRegex = /\b(ret|retired|ritiro|walkover|w\/o|wo|withdrawn|withdrawal)\b/i;
    return retirementRegex.test(text);
}

function isSuspendedOrPostponedText(raw) {
    const text = normalizeText(raw);
    if (!text) return false;
    return /\b(suspended|sospesa|postponed|rinviata|rain delay|interrupted|paused)\b/i.test(text);
}

function parseSetScores(raw) {
    if (!raw) {
        return {
            sets: [],
            totalGames: null,
            isVoid: false,
            reason: 'EMPTY_SCORE'
        };
    }

    if (isRetirementOrVoidText(raw)) {
        return {
            sets: [],
            totalGames: 'VOID',
            isVoid: true,
            reason: 'RETIREMENT_OR_VOID_TEXT'
        };
    }

    const text = String(raw);

    // Supporta:
    // 6-4 7-6(5)
    // 6:4 7:6
    // 6/4 7/6
    const regex = /(\d{1,2})\s*[-:/]\s*(\d{1,2})(?:\s*\(\d+\))?/g;

    let match;
    let totalGames = 0;
    let validSets = 0;
    let p1SetsWon = 0;
    let p2SetsWon = 0;

    const sets = [];

    while ((match = regex.exec(text)) !== null) {
        const g1 = parseInt(match[1], 10);
        const g2 = parseInt(match[2], 10);

        if (!Number.isFinite(g1) || !Number.isFinite(g2)) continue;

        const diff = Math.abs(g1 - g2);
        const maxG = Math.max(g1, g2);
        const minG = Math.min(g1, g2);

        const isStandard = maxG >= 6 && diff >= 2 && minG <= 4;
        const isTiebreak = maxG === 7 && (minG === 5 || minG === 6);
        const isShortSet = maxG === 4 && diff >= 2;
        const isSuperTB = maxG >= 10 && diff >= 2;

        if (isStandard || isTiebreak || isShortSet || isSuperTB) {
            sets.push({
                games1: g1,
                games2: g2,
                type: isSuperTB ? 'SUPER_TIEBREAK' : (isTiebreak ? 'TIEBREAK_SET' : 'STANDARD_SET')
            });

            // Per i totals "games", il super tiebreak di solito non dovrebbe
            // essere contato come 10+ games di set classico. Qui lo contiamo
            // in modo prudente come 1 game-equivalent solo se necessario.
            if (isSuperTB) {
                totalGames += 1;
            } else {
                totalGames += g1 + g2;
            }

            validSets++;

            if (g1 > g2) p1SetsWon++;
            else if (g2 > g1) p2SetsWon++;
        }
    }

    if (validSets === 0) {
        return {
            sets: [],
            totalGames: null,
            isVoid: false,
            reason: 'NO_VALID_SETS'
        };
    }

    const hasMatchWinner = p1SetsWon >= 2 || p2SetsWon >= 2 || p1SetsWon >= 3 || p2SetsWon >= 3;

    return {
        sets,
        totalGames: hasMatchWinner ? totalGames : null,
        isVoid: false,
        p1SetsWon,
        p2SetsWon,
        winner: p1SetsWon > p2SetsWon ? 1 : 2,
        reason: hasMatchWinner ? 'MATCH_COMPLETE' : 'MATCH_NOT_COMPLETE'
    };
}

function calculateGamesFromScore(raw) {
    const parsed = parseSetScores(raw);

    if (parsed.isVoid) return 'VOID';

    return parsed.totalGames;
}

function inferWinnerFromScore(raw) {
    const parsed = parseSetScores(raw);

    if (parsed.isVoid) return 'VOID';

    if (parsed.winner === 1 || parsed.winner === 2) {
        return parsed.winner;
    }

    return null;
}


// ============================================================================
// 8. HTTP FETCH CON RETRY
// ============================================================================

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const jitter = Math.floor(Math.random() * 400) + 200;

            await sleep(jitter);

            return await axios(url, options);
        } catch (error) {
            if (i === retries - 1) return null;

            await sleep(RETRY_DELAYS[i] || 2000);
        }
    }

    return null;
}


// ============================================================================
// 9. FALLBACK WEB SCORE
// ============================================================================
//
// È un fallback debole: lo usiamo solo se API e TennisMyLife non bastano.
// Non forza risultati dubbi.
// ============================================================================

async function fallbackAiTennisScore(p1, p2, matchDate = '', options = {}) {
    // STEP58_GUARDED_WEB_SCORE_FALLBACK_BEFORE_API
    // Ricerca web ammessa solo come fallback affidabile prima dell'API scores:
    // accetta il risultato solo se snippet contiene entrambi i giocatori e score tennis completo.
    if (STEP58_WEB_SCORE_FALLBACK_ENABLED !== true) return null;

    const allowCache = options.allowCache !== false;
    if (allowCache) {
        const cachedResult = loadCache(p1, p2, matchDate);
        if (isResolvedVaultResult(cachedResult)) {
            return {
                ...cachedResult,
                source: cachedResult.source || 'STEP58_LOCAL_RESULT_VAULT'
            };
        }
    }

    try {
        const p1Last = getLastName(p1);
        const p2Last = getLastName(p2);
        const query = `${p1Last} ${p2Last} tennis score ${matchDate || ''} result`;

        // FAIL-FAST OTIMIZATION (v11.3): Abbassiamo i ritentativi massimi a 2 e riduciamo 
        // il timeout a 5s per evitare che la ricerca web blocchi il flusso a lungo
        const res = await fetchWithRetry('https://lite.duckduckgo.com/lite/', {
            method: 'POST',
            data: `q=${encodeURIComponent(query)}&kl=&df=`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 5000 // Rallentamento massimo 5 secondi per il fallback
        }, 2); // Massimo 2 tentativi al posto di 4

        if (!res || !res.data) return null;

        const $ = cheerio.load(res.data);
        let text = '';

        $('.result-snippet, .result-link, a.result-link').each((i, el) => {
            text += ` ${$(el).text()} `;
        });

        const normalizedText = normalizeText(text);
        if (!normalizedText.trim()) return null;

        const hasP1 = normalizeName(p1).split(' ').filter(Boolean).some(t => t.length >= 4 && normalizedText.includes(t)) || normalizedText.includes(normalizeName(p1Last));
        const hasP2 = normalizeName(p2).split(' ').filter(Boolean).some(t => t.length >= 4 && normalizedText.includes(t)) || normalizedText.includes(normalizeName(p2Last));
        if (!hasP1 || !hasP2) return null;

        if (isSuspendedOrPostponedText(normalizedText)) {
            return {
                winner: null,
                totalGames: null,
                isVoid: false,
                nonFinal: true,
                lifecycleStatus: 'SUSPENDED_REVIEW',
                lifecycleReason: 'SUSPENDED_OR_POSTPONED_TEXT_PENDING_COMPLETION',
                automaticSettlement: false,
                source: 'STEP58_WEB_FALLBACK_SUSPENSION_REVIEW_PATCH34_R4',
                confidence: 0.55,
                observedAt: new Date().toISOString(),
                sourceEventId: `WEB:${settlementContract.hashEvidence({ query, matchDate, text: normalizedText.slice(0, 1200) }).slice(0, 20)}`,
                rawEvidence: { query, matchDate, excerpt: normalizedText.slice(0, 1200) },
                score: null,
                note: 'Patch 34 R4: testo di sospensione/rinvio; il match resta PENDING e non viene trasformato in VOID.'
            };
        }

        if (isRetirementOrVoidText(normalizedText)) {
            const voidResult = {
                winner: null,
                totalGames: 'VOID',
                isVoid: true,
                source: 'STEP58_WEB_FALLBACK_VOID_GUARDED',
                confidence: 0.9,
                observedAt: new Date().toISOString(),
                sourceEventId: `WEB:${settlementContract.hashEvidence({ query, matchDate, text: normalizedText.slice(0, 1200) }).slice(0, 20)}`,
                rawEvidence: { query, matchDate, excerpt: normalizedText.slice(0, 1200) },
                score: 'VOID',
                note: 'Web fallback affidabile: testo ritiro/void con entrambi i giocatori presenti.'
            };
            saveCache(p1, p2, matchDate, voidResult);
            return voidResult;
        }

        const parsed = parseSetScores(normalizedText);
        const confidence = (parsed.totalGames !== null && parsed.winner !== null && hasP1 && hasP2) ? 0.9 : 0;

        if (confidence >= STEP58_WEB_SCORE_MIN_CONFIDENCE) {
            const finalResult = {
                winner: parsed.winner,
                totalGames: parsed.totalGames,
                isVoid: false,
                source: 'STEP58_WEB_FALLBACK_SCORE_GUARDED',
                confidence,
                step107WeakWinnerSide: true,
                observedAt: new Date().toISOString(),
                sourceEventId: `WEB:${settlementContract.hashEvidence({ query, matchDate, text: normalizedText.slice(0, 1200) }).slice(0, 20)}`,
                rawEvidence: { query, matchDate, excerpt: normalizedText.slice(0, 1200) },
                score: parsed.sets ? parsed.sets.map(set => `${set.games1}-${set.games2}`).join(' ') : null,
                note: 'Risultato da web fallback: classificato PROPOSED da Patch 5; non chiude automaticamente senza fonte strutturata/certificata.'
            };

            saveCache(p1, p2, matchDate, finalResult);

            console.log(
                `✅ [STEP58 WEB SCORE] ${p1} vs ${p2} risolto senza API. Vincitore: ${parsed.winner} | Tot. Game: ${parsed.totalGames}`
            );

            return finalResult;
        }

        return null;
    } catch (error) {
        return null;
    }
}

// ============================================================================
// 10. EVALUATION BET TENNIS
// ============================================================================

function extractTotalsLine(prediction) {
    const match = String(prediction || '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;

    const line = parseFloat(match[1]);

    return Number.isFinite(line) ? line : null;
}

function evaluateTennisBet(prediction, winner, totalGames) {
    const pred = safeUpper(prediction);

    if (totalGames === 'VOID' || winner === 'VOID') {
        return 'VOID';
    }

    if (pred === '1' && winner !== null) {
        return winner === 1;
    }

    if (pred === '2' && winner !== null) {
        return winner === 2;
    }

    if (pred.includes('OVER') && totalGames !== null && typeof totalGames === 'number') {
        const line = extractTotalsLine(prediction);

        if (line === null) return null;

        if (totalGames > line) return true;
        if (totalGames < line) return false;

        return 'PUSH';
    }

    if (pred.includes('UNDER') && totalGames !== null && typeof totalGames === 'number') {
        const line = extractTotalsLine(prediction);

        if (line === null) return null;

        if (totalGames < line) return true;
        if (totalGames > line) return false;

        return 'PUSH';
    }

    return null;
}

function calculateBetProfit(match, evaluationResult) {
    const stake = toNumber(match.stake, 0);
    const odd = toNumber(match.odd, 0);

    if (evaluationResult === 'VOID' || evaluationResult === 'PUSH') {
        return 0;
    }

    if (evaluationResult === true) {
        return round(stake * (odd - 1), 2);
    }

    if (evaluationResult === false) {
        return round(-stake, 2);
    }

    return null;
}

function evaluationToStatus(evaluationResult) {
    if (evaluationResult === true) return 'WON';
    if (evaluationResult === false) return 'LOST';
    if (evaluationResult === 'VOID') return 'VOID';
    if (evaluationResult === 'PUSH') return 'PUSH';

    return null;
}


// ============================================================================
// 11. DB SCHEMA HELPERS
// ============================================================================

function columnExists(db, tableName, columnName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return rows.some(r => r.name === columnName);
    } catch (error) {
        return false;
    }
}

function safeAlterTableAddColumn(db, tableName, columnDefinition) {
    const columnName = String(columnDefinition).split(/\s+/)[0];

    if (columnExists(db, tableName, columnName)) return;

    try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`).run();
    } catch (error) {
        console.warn(`⚠️ Colonna ${columnName} non aggiunta a ${tableName}:`, error.message);
    }
}

function ensureTennisPaperTradingColumns(db) {
    safeAlterTableAddColumn(db, 'ai_forward_test', 'sport_type TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'edge_pp REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'ev_pct REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'model_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'metric_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'engine_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'data_quality TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'settlement_source TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'settlement_note TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'settled_at TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'total_games REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'winner_side INTEGER');
    // STEP91H_TENNIS_SIDE_IDENTITY_GUARD - settlement per nome giocatore, non solo side 1/2.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'predicted_player_name TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'opponent_player_name TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'internal_side TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'official_event_order TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'provider_event_id TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'provider_home_team TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'provider_away_team TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'winner_player_name TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'side_mapping_warning TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'side_mapping_verified INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'side_identity_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'market_implied_prob REAL');

    // PATCH5_TENNIS_SETTLEMENT_EVIDENCE_CONTRACT
    for (const [columnName, columnType] of settlementContract.SETTLEMENT_SCHEMA_COLUMNS) {
        safeAlterTableAddColumn(db, 'ai_forward_test', `${columnName} ${columnType}`);
    }

    // STEP67A/D - separazione portfolio audit-grade + audit trail immutabile.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'trading_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'paper_trading_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'portfolio_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_scope_reason TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_trail_id TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_frozen_at TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_snapshot_json TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_mode TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_multiplier REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_reason TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_signal TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_multiplier REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_probability_adjustment REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_bucket TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_grade TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_action TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_trail_event_id TEXT');

    try { auditTrail.ensureAuditTrailTable(db); } catch (error) { console.warn('⚠️ Audit trail Tennis non inizializzato:', error.message); }
}

// ============================================================================
// STEP106 - TENNIS SETTLEMENT SQLITE BIND REPAIR
// ============================================================================
const STEP106_TENNIS_SETTLEMENT_SQLITE_BIND_REPAIR = 'STEP106_TENNIS_SETTLEMENT_SQLITE_BIND_REPAIR';

function normalizeStep106SqliteBindValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (Array.isArray(value) || typeof value === 'object') {
        try { return JSON.stringify(value); }
        catch (error) { return String(value); }
    }
    return String(value);
}

function safeUpdateRow(db, id, fields = {}) {
    const entries = Object.entries(fields)
        .filter(([key]) => columnExists(db, 'ai_forward_test', key));

    if (!entries.length) return false;

    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => normalizeStep106SqliteBindValue(value));

    values.push(id);

    try {
        db.prepare(`
            UPDATE ai_forward_test
            SET ${setClause}
            WHERE id = ?
        `).run(...values);
    } catch (error) {
        console.error(`❌ [STEP106 SQLITE BIND] safeUpdateRow fallito su ai_forward_test id=${id}: ${error.message}`);
        throw error;
    }

    return true;
}

function normalizePendingTennisRowMetadata(db, match) {
    const sideIdentityFields = sideIdentity.annotateBetSideIdentity(match);
    const edgePp = toNumber(
        match.edge_pp ??
        match.adjusted_edge_pp ??
        match.edge,
        null
    );

    const evPct = toNumber(
        match.ev_pct ??
        match.adjusted_ev_pct ??
        match.expectedValue ??
        match.ev,
        null
    );

    const fields = {
        sport_type: 'TENNIS',
        model_version: match.model_version || TENNIS_MODEL_VERSION,
        metric_version: match.metric_version || TENNIS_METRIC_VERSION,
        engine_version: match.engine_version || TENNIS_PAPER_ENGINE_VERSION,
        data_quality: isCurrentCleanRow(match) ? match.data_quality : DATA_QUALITY_CURRENT,
        predicted_player_name: sideIdentityFields.predicted_player_name,
        opponent_player_name: sideIdentityFields.opponent_player_name,
        internal_side: sideIdentityFields.internal_side,
        official_event_order: sideIdentityFields.official_event_order,
        provider_event_id: sideIdentityFields.provider_event_id,
        provider_home_team: sideIdentityFields.provider_home_team,
        provider_away_team: sideIdentityFields.provider_away_team,
        side_mapping_warning: sideIdentityFields.side_mapping_warning,
        side_mapping_verified: sideIdentityFields.side_mapping_verified,
        side_identity_version: sideIdentityFields.side_identity_version
    };

    if (match.edge_pp === undefined || match.edge_pp === null) {
        fields.edge_pp = edgePp;
    }

    if (match.ev_pct === undefined || match.ev_pct === null) {
        fields.ev_pct = evPct;
    }

    safeUpdateRow(db, match.id, fields);

    return fields;
}


// ============================================================================
// 12. RISULTATI DA ODDS API SCORES
// ============================================================================

function normalizeApiScoreItem(game) {
    if (!game) return null;

    // STEP110_PROVIDER_EVENT_ID_SCORE_MATCH
    // The Odds API scores può restituire nomi abbreviati o ordine non identico; conserviamo id/event id e winner esplicito.
    const step110EventId = game.id || game.event_id || game.eventId || game.key || null;
    const step110CommenceTime = game.commence_time || game.commenceTime || game.start_time || null;
    const step110ExplicitWinnerName = game.winner || game.winner_name || game.winnerName || game.completed_winner || null;

    const homeTeam = game.home_team || game.homeTeam || '';
    const awayTeam = game.away_team || game.awayTeam || '';

    if (!homeTeam || !awayTeam) return null;

    let homeScore = null;
    let awayScore = null;

    if (Array.isArray(game.scores)) {
        const homeRow = game.scores.find(s => isSamePlayer(s.name, homeTeam));
        const awayRow = game.scores.find(s => isSamePlayer(s.name, awayTeam));

        homeScore = toNumber(homeRow?.score, null);
        awayScore = toNumber(awayRow?.score, null);
    }

    if (homeScore === null && game.home_score !== undefined) {
        homeScore = toNumber(game.home_score, null);
    }

    if (awayScore === null && game.away_score !== undefined) {
        awayScore = toNumber(game.away_score, null);
    }

    let winnerName = null;

    if (homeScore !== null && awayScore !== null) {
        if (homeScore > awayScore) winnerName = homeTeam;
        else if (awayScore > homeScore) winnerName = awayTeam;
    }

    if (!winnerName && step110ExplicitWinnerName) winnerName = step110ExplicitWinnerName;

    return {
        id: step110EventId,
        eventId: step110EventId,
        commenceTime: step110CommenceTime,
        completed: Boolean(game.completed),
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        winnerName,
        explicitWinnerName: step110ExplicitWinnerName,
        raw: game
    };
}

function resolveFromApiScores(match, apiScores = []) {
    const p1Db = match.home_team;
    const p2Db = match.away_team;

    for (const game of apiScores) {
        const normalized = normalizeApiScoreItem(game);

        if (!normalized || !normalized.completed) continue;

        const pair = matchPlayersPair(
            p1Db,
            p2Db,
            normalized.homeTeam,
            normalized.awayTeam
        );

        const step110ProviderIdMatched = Boolean(match.provider_event_id && normalized.id && String(match.provider_event_id) === String(normalized.id));

        if (!pair.matched && !step110ProviderIdMatched) continue;

        if (!normalized.winnerName) continue;

        let winner = null;

        if (isSamePlayer(p1Db, normalized.winnerName)) winner = 1;
        else if (isSamePlayer(p2Db, normalized.winnerName)) winner = 2;

        if (!winner) continue;

        return {
            winner,
            totalGames: null,
            isVoid: false,
            source: 'ODDS_API_SCORES',
            sourceEventId: normalized.id || normalized.eventId || null,
            observedAt: new Date().toISOString(),
            providerCompleted: normalized.completed === true,
            winnerName: normalized.winnerName,
            winner_player_name: normalized.winnerName,
            resultHomeTeam: normalized.homeTeam,
            resultAwayTeam: normalized.awayTeam,
            pairOrientation: step110ProviderIdMatched && !pair.matched ? 'PROVIDER_EVENT_ID' : pair.orientation,
            rawEvidence: normalized.raw || game,
            // The Odds API espone normalmente il punteggio aggregato dell'evento, non i set Tennis.
            // Non trasformarlo in uno score set-by-set: il contratto Patch 5 usa providerCompleted
            // e conserva l'evidenza grezza per l'audit senza generare falsi SCORE_UNPARSEABLE.
            score: null,
            confidence: 0.97,
            note: 'Winner rilevato da The Odds API scores; evidenza provider associata al contratto settlement Patch 5.'
        };
    }

    return null;
}


// ============================================================================
// 13. RISULTATI DA TENNISMYLIFE
// ============================================================================

async function fetchTennisMyLifeResults() {
    const tmlData = [];

    try {
        const tmlRes = await fetchWithRetry('https://stats.tennismylife.org/', {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!tmlRes || !tmlRes.data) return tmlData;

        const $tml = cheerio.load(tmlRes.data);

        $tml('table tbody tr').each((i, el) => {
            const cols = $tml(el).find('td');

            if (cols.length >= 7) {
                tmlData.push({
                    date: $tml(cols[0]).text().trim(),
                    winner: $tml(cols[4]).text().trim(),
                    loser: $tml(cols[5]).text().trim(),
                    score: $tml(cols[6]).text().trim(),
                    source: 'TENNISMYLIFE'
                });
            }
        });

        return tmlData;
    } catch (error) {
        return tmlData;
    }
}

function resolveFromTennisMyLife(match, tmlData = []) {
    const p1Db = match.home_team;
    const p2Db = match.away_team;

    if (!Array.isArray(tmlData) || tmlData.length === 0) return null;

    for (const item of tmlData) {
        const p1IsWinner = isSamePlayer(p1Db, item.winner) && isSamePlayer(p2Db, item.loser);
        const p2IsWinner = isSamePlayer(p2Db, item.winner) && isSamePlayer(p1Db, item.loser);

        if (!p1IsWinner && !p2IsWinner) continue;

        const parsed = parseSetScores(item.score);

        if (parsed.isVoid) {
            return {
                winner: null,
                totalGames: 'VOID',
                isVoid: true,
                source: 'TENNISMYLIFE_VOID',
                sourceEventId: `TML:${settlementContract.hashEvidence(item).slice(0, 20)}`,
                observedAt: new Date().toISOString(),
                rawEvidence: item,
                score: item.score,
            scoreOrientation: 'WINNER_FIRST',
                confidence: 0.9,
                note: `Score TennisMyLife indica void/ritiro: ${item.score}`
            };
        }

        return {
            winner: p1IsWinner ? 1 : 2,
            winnerName: item.winner,
            winner_player_name: item.winner,
            totalGames: parsed.totalGames,
            isVoid: false,
            source: 'TENNISMYLIFE',
            sourceEventId: `TML:${settlementContract.hashEvidence(item).slice(0, 20)}`,
            observedAt: new Date().toISOString(),
            rawEvidence: item,
            score: item.score,
            scoreOrientation: 'WINNER_FIRST',
            confidence: 0.9,
            providerCompleted: true,
            note: `Risultato TennisMyLife: ${item.score}`
        };
    }

    return null;
}


// ============================================================================
// 14. FETCH SCORES ODDS API
// ============================================================================

async function fetchOddsApiTennisScores(fetchOddsApiFunc, pendingRows = [], diagnostics = null) {
    // STEP58: API scores solo per match unici realmente irrisolti dopo vault/web.
    const apiScores = [];

    if (typeof fetchOddsApiFunc !== 'function') {
        if (diagnostics) diagnostics.settlementPendingReason = 'FETCH_ODDS_API_FUNC_NOT_AVAILABLE';
        return apiScores;
    }

    const rows = Array.isArray(pendingRows) ? pendingRows : [];
    if (rows.length === 0) {
        if (diagnostics) diagnostics.apiSkippedNoPendingToResolve = true;
        return apiScores;
    }

    const wantedTours = inferRequiredTennisToursFromRows(rows);

    // STEP64_SETTLEMENT_API_BUDGET_GUARD
    // Il catalogo sports conta come 1 chiamata pianificata; le chiamate scores per sport
    // vengono limitate dal budget residuo della run.
    const usage = apiUsageTracker.getApiUsageSummary?.() || {};
    const creditsRemaining = toNumber(usage.creditsRemaining, 0);
    const budgetBlocked = creditsRemaining <= STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS;
    if (diagnostics) {
        diagnostics.settlementApiBudgetMode = STEP64_SETTLEMENT_API_BUDGET_MODE;
        diagnostics.settlementApiMaxCallsPerRun = STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN;
        diagnostics.settlementApiMinResidualCredits = STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS;
        diagnostics.settlementApiCreditsRemainingBefore = creditsRemaining;
        diagnostics.settlementApiBudgetBlocked = budgetBlocked;
    }

    if (budgetBlocked || STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN <= 0) {
        if (diagnostics) {
            diagnostics.apiSkippedByStep64Budget = true;
            diagnostics.settlementPendingReason = 'PENDING_STEP64_API_BUDGET_GUARD';
            diagnostics.pendingReasons.PENDING_STEP64_API_BUDGET_GUARD = (diagnostics.pendingReasons.PENDING_STEP64_API_BUDGET_GUARD || 0) + rows.length;
        }
        return apiScores;
    }

    let remainingApiCalls = STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN;

    const step105TargetedKeys = inferStep105SettlementSportKeysForRows(rows);
    if (diagnostics) {
        diagnostics.step105TargetedSettlementMode = STEP105_TENNIS_SETTLEMENT_TARGETED_RESULTS;
        diagnostics.step105TargetedKeys = step105TargetedKeys;
    }
    if (step105TargetedKeys.length > 0 && remainingApiCalls > 0) {
        const targetedToFetch = step105TargetedKeys.slice(0, remainingApiCalls);
        if (diagnostics) {
            diagnostics.apiScoresCatalogRequested = false;
            diagnostics.apiSportsEligibleBeforeBudget = step105TargetedKeys.length;
            diagnostics.apiSportsRequested = targetedToFetch.length;
            diagnostics.apiSportsRequestedKeys = targetedToFetch.slice(0, 12);
            diagnostics.apiSportsSkippedByBudget = Math.max(0, step105TargetedKeys.length - targetedToFetch.length);
            diagnostics.step105TargetedKeysUsed = targetedToFetch.slice();
        }
        for (const tKey of targetedToFetch) {
            if (remainingApiCalls <= 0) break;
            remainingApiCalls -= 1;
            try {
                console.log('🎯 [SETTLEMENT STEP105] Scores API mirata: ' + tKey);
                const scores = await fetchOddsApiFunc('https://api.the-odds-api.com/v4/sports/' + tKey + '/scores/?apiKey=' + ODDS_API_KEY + '&daysFrom=' + DEFAULT_LOOKBACK_DAYS);
                if (Array.isArray(scores)) {
                    apiScores.push(...scores);
                    if (diagnostics) diagnostics.step105TargetedScoresLoaded = Number(diagnostics.step105TargetedScoresLoaded || 0) + scores.length;
                }
            } catch (error) {
                if (diagnostics) {
                    diagnostics.apiErrors.push({ sport: tKey, message: error.message || String(error), step105Targeted: true });
                    if (/401|403|429|chiavi|key|limit|esaur/i.test(error.message || '')) diagnostics.apiUnavailableOrExhausted = true;
                }
            }
        }
        if (apiScores.length > 0 || remainingApiCalls <= 0) return apiScores;
    }

    try {
        if (diagnostics) diagnostics.apiScoresCatalogRequested = true;
        remainingApiCalls -= 1;
        const activeSports = await fetchOddsApiFunc(
            'https://api.the-odds-api.com/v4/sports/?apiKey=' + ODDS_API_KEY
        );

        if (!Array.isArray(activeSports)) {
            if (diagnostics) diagnostics.apiScoresCatalogInvalid = true;
            return apiScores;
        }

        const tennisSportsAll = activeSports
            .filter(s => s.group === 'Tennis')
            .map(s => s.key)
            .filter(Boolean)
            .filter(key => tennisSportKeyMatchesPendingTours(key, wantedTours));

        const tennisSports = tennisSportsAll.slice(0, Math.max(0, remainingApiCalls));

        if (diagnostics) {
            diagnostics.apiSportsAvailable = activeSports.filter(s => s.group === 'Tennis').length;
            diagnostics.apiSportsEligibleBeforeBudget = tennisSportsAll.length;
            diagnostics.apiSportsRequested = tennisSports.length;
            diagnostics.apiSportsSkippedByBudget = Math.max(0, tennisSportsAll.length - tennisSports.length);
            diagnostics.apiSportsRequestedKeys = tennisSports.slice(0, 12);
        }

        if (tennisSports.length === 0) {
            if (diagnostics) diagnostics.apiSkippedNoMatchingSport = true;
            return apiScores;
        }

        for (const tKey of tennisSports) {
            if (remainingApiCalls <= 0) {
                if (diagnostics) diagnostics.apiSkippedByStep64Budget = true;
                break;
            }
            remainingApiCalls -= 1;
            try {
                const scores = await fetchOddsApiFunc(
                    `https://api.the-odds-api.com/v4/sports/${tKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=${DEFAULT_LOOKBACK_DAYS}`
                );

                if (Array.isArray(scores)) {
                    apiScores.push(...scores);
                }
            } catch (error) {
                if (diagnostics) {
                    diagnostics.apiErrors.push({ sport: tKey, message: error.message || String(error) });
                    if (/401|403|429|chiavi|key|limit|esaur/i.test(error.message || '')) {
                        diagnostics.apiUnavailableOrExhausted = true;
                    }
                }
            }
        }

        return apiScores;
    } catch (error) {
        if (diagnostics) {
            diagnostics.apiErrors.push({ sport: 'sports_catalog', message: error.message || String(error) });
            if (/401|403|429|chiavi|key|limit|esaur/i.test(error.message || '')) {
                diagnostics.apiUnavailableOrExhausted = true;
            }
        }
        return apiScores;
    }
}

// ============================================================================
// STEP107 - TENNIS SIDE IDENTITY CERTIFIED RESULTS REPAIR
// ============================================================================
// Motivo audit: evitare settlement moneyline basato solo su winner_side 1/2 quando
// provider/web/cache può restituire l'ordine giocatori invertito. Per i match
// verificati Roland Garros 2026 sotto, il risultato certificato ha priorità su
// cache/fallback deboli e consente anche il backfill delle righe già contaminate.
const STEP107_TENNIS_SIDE_IDENTITY_CERTIFIED_RESULTS_REPAIR = 'STEP107_TENNIS_SIDE_IDENTITY_CERTIFIED_RESULTS_REPAIR';
const STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR = 'STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR';

const STEP107_CERTIFIED_TENNIS_RESULTS = [
    { date: '2026-06-04', home: 'Diana Shnaider', away: 'Maja Chwalinska', winner: 'Maja Chwalinska', winnerSide: 2, totalGames: 23, score: '7-6(4) 6-4', source: 'STEP110_CERTIFIED_REUTERS_WTA_RG2026' },
    { date: '2026-06-02', home: 'Elina Svitolina', away: 'Marta Kostyuk', winner: 'Marta Kostyuk', winnerSide: 2, totalGames: 25, score: '6-3 2-6 6-2', source: 'STEP107_CERTIFIED_REUTERS_WTA_RG2026' },
    { date: '2026-06-02', home: 'Mirra Andreeva', away: 'Sorana Cirstea', winner: 'Mirra Andreeva', winnerSide: 1, totalGames: 15, score: '6-0 6-3', source: 'STEP107_CERTIFIED_REUTERS_WTA_RG2026' },
    { date: '2026-06-02', home: 'Jakub Mensik', away: 'Joao Fonseca', winner: 'Jakub Mensik', winnerSide: 1, totalGames: 32, score: '6-4 6-3 7-6(3)', source: 'STEP107_CERTIFIED_ATP_RG2026' },
    { date: '2026-06-02', home: 'Alexander Zverev', away: 'Rafael Jodar', winner: 'Alexander Zverev', winnerSide: 1, totalGames: 29, score: '7-6(3) 6-1 6-3', source: 'STEP107_CERTIFIED_REUTERS_ATP_RG2026' },
    { date: '2026-06-03', home: 'Anna Kalinskaya', away: 'Maja Chwalinska', winner: 'Maja Chwalinska', winnerSide: 2, totalGames: 22, score: '7-6(3) 6-3', source: 'STEP107_CERTIFIED_REUTERS_WTA_RG2026' },
    { date: '2026-06-01', home: 'Diana Shnaider', away: 'Madison Keys', winner: 'Diana Shnaider', winnerSide: 1, totalGames: null, score: null, source: 'STEP107_CERTIFIED_WTA_RG2026' },
    { date: '2026-06-01', home: 'Anastasia Potapova', away: 'Anna Kalinskaya', winner: 'Anna Kalinskaya', winnerSide: 2, totalGames: 31, score: '6-4 2-6 7-6(7)', source: 'STEP107_CERTIFIED_AP_WTA_RG2026' },
    { date: '2026-06-01', home: 'Juan Manuel Cerundolo', away: 'Matteo Berrettini', winner: 'Matteo Berrettini', winnerSide: 2, totalGames: 35, score: '6-3 7-6(2) 7-6(6)', source: 'STEP107_CERTIFIED_REUTERS_ATP_RG2026' },
    { date: '2026-06-01', home: 'Frances Tiafoe', away: 'Matteo Arnaldi', winner: 'Matteo Arnaldi', winnerSide: 2, totalGames: null, score: null, source: 'STEP107_CERTIFIED_ATP_RG2026' },
    { date: '2026-06-01', home: 'Alejandro Tabilo', away: 'Felix Auger-Aliassime', winner: 'Felix Auger-Aliassime', winnerSide: 2, totalGames: 28, score: '6-3 7-5 6-1', source: 'STEP107_CERTIFIED_ATP_RG2026' }
];

function step107DateKeyFromAny(value) {
    const parsed = parseItalianDateTime(value);
    if (parsed) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
}

function step107FindCertifiedResult(row = {}) {
    const rowDate = step107DateKeyFromAny(row.match_date || row.date || row.created_at);
    const home = row.home_team || row.home || row.player1 || '';
    const away = row.away_team || row.away || row.player2 || '';
    return STEP107_CERTIFIED_TENNIS_RESULTS.find(item => {
        if (item.date !== rowDate) return false;
        const direct = isSamePlayer(home, item.home) && isSamePlayer(away, item.away);
        const reverse = isSamePlayer(home, item.away) && isSamePlayer(away, item.home);
        return direct || reverse;
    }) || null;
}

function step107BuildCertifiedResolution(row = {}, certified = null) {
    const c = certified || step107FindCertifiedResult(row);
    if (!c) return null;
    let winnerSide = null;
    if (isSamePlayer(row.home_team || row.home, c.winner)) winnerSide = 1;
    else if (isSamePlayer(row.away_team || row.away, c.winner)) winnerSide = 2;
    else winnerSide = c.winnerSide || null;
    if (!winnerSide) return null;
    return {
        winner: winnerSide,
        winnerName: c.winner,
        winner_player_name: c.winner,
        totalGames: c.totalGames ?? null,
        isVoid: false,
        source: c.source || STEP107_TENNIS_SIDE_IDENTITY_CERTIFIED_RESULTS_REPAIR,
        sourceEventId: `CERT:${settlementContract.hashEvidence(c).slice(0, 20)}`,
        observedAt: new Date().toISOString(),
        providerCompleted: true,
        rawEvidence: c,
        confidence: 0.99,
        score: c.score || null,
        scoreOrientation: 'WINNER_FIRST',
        note: 'STEP107 risultato certificato per audit side-identity; settlement basato sul nome vincente, non solo sul lato numerico. Score: ' + (c.score || 'N/D')
    };
}

// ============================================================================
// 15. RESOLUTION PIPELINE
// ============================================================================

async function resolveTennisMatchResult(match, context = {}) {
    // STEP58_TENNIS_RESULT_SETTLEMENT_GUARD
    const { apiScores = [], tmlData = [], officialResults = null, allowOfficialNetwork = false, allowApi = true, allowWebFallback = true } = context;

    const p1Db = match.home_team;
    const p2Db = match.away_team;
    const matchDateKey = getDateOnlyKey(match.match_date);

    const needsTotals = safeUpper(match.prediction).includes('OVER') ||
        safeUpper(match.prediction).includes('UNDER');

    // PATCH34 R4: verità firmata e lifecycle non finale prima di qualunque cache/web/API.
    const patch34R4Resolution = tennisSettlementTruthR4.resolve(match);
    if (patch34R4Resolution) {
        saveCache(p1Db, p2Db, matchDateKey, patch34R4Resolution);
        return patch34R4Resolution;
    }

    // PATCH29: evidenza ufficiale ATP/WTA prima di cache e fallback legacy.
    // La seed firmata consente il backfill offline; il fetch live è zero-key e non usa The Odds API.
    let officialResolution = officialResults && typeof officialResults === 'object'
        ? tennisOfficialSettlementResolver.resolveFromSeed(match, officialResults)
        : null;
    if (!officialResolution && allowOfficialNetwork === true && tennisOfficialSettlementResolver.supportsOfficialNetwork(match)) {
        officialResolution = await tennisOfficialSettlementResolver.resolveOfficialSettlement(match, {
            allowNetwork: true,
            seed: officialResults && typeof officialResults === 'object' ? officialResults : undefined
        });
    }
    if (officialResolution) {
        saveCache(p1Db, p2Db, matchDateKey, officialResolution);
        return officialResolution;
    }

    // STEP107: risultati certificati prima della cache locale, per correggere cache/web legacy con ordine giocatori invertito.
    const step107CertifiedResolution = step107BuildCertifiedResolution(match);
    if (step107CertifiedResolution) {
        saveCache(p1Db, p2Db, matchDateKey, step107CertifiedResolution);
        return step107CertifiedResolution;
    }

    // 1. DB/Vault locale prima di qualsiasi API.
    const cachedVault = loadCache(p1Db, p2Db, matchDateKey);
    if (isResolvedVaultResult(cachedVault)) {
        return {
            winner: cachedVault.winner ?? null,
            totalGames: cachedVault.totalGames ?? null,
            isVoid: cachedVault.isVoid === true || cachedVault.totalGames === 'VOID' || cachedVault.winner === 'VOID',
            source: cachedVault.source || 'STEP58_LOCAL_RESULT_VAULT',
            sourceEventId: cachedVault.sourceEventId || cachedVault.source_event_id || null,
            observedAt: cachedVault.observedAt || cachedVault.observed_at || new Date(cachedVault.timestamp || Date.now()).toISOString(),
            winnerName: cachedVault.winnerName || cachedVault.winner_player_name || null,
            winner_player_name: cachedVault.winner_player_name || cachedVault.winnerName || null,
            score: cachedVault.score || null,
            scoreOrientation: cachedVault.scoreOrientation || 'UNKNOWN',
            confidence: cachedVault.confidence || null,
            rawEvidence: cachedVault.rawEvidence || cachedVault.raw || null,
            settlementContractStatus: cachedVault.settlementContractStatus || cachedVault.settlement_contract_status || null,
            evidenceHash: cachedVault.evidenceHash || cachedVault.settlement_evidence_hash || null,
            providerCompleted: cachedVault.providerCompleted === true,
            note: cachedVault.note || 'Risultato letto da vault/cache locale; Patch 5 richiede evidenza verificata per chiusura automatica.'
        };
    }

    let winner = null;
    let totalGames = null;
    let source = null;
    let note = '';

    // 2. Fonte web strutturata già usata dal progetto: TennisMyLife.
    const tmlResult = resolveFromTennisMyLife(match, tmlData);

    if (tmlResult) {
        if (tmlResult.isVoid) {
            saveCache(p1Db, p2Db, matchDateKey, tmlResult);
            return tmlResult;
        }

        winner = tmlResult.winner ?? winner;
        totalGames = tmlResult.totalGames ?? totalGames;
        source = tmlResult.source;
        note = tmlResult.note;

        if (winner !== null && (!needsTotals || totalGames !== null)) {
            // PATCH29: non perdere winnerName, score, sourceEventId, observedAt,
            // providerCompleted, rawEvidence e confidence prima del contratto Patch 5.
            const final = { ...tmlResult, winner, totalGames, isVoid: false, source, note };
            saveCache(p1Db, p2Db, matchDateKey, final);
            return final;
        }
    }

    // AUDIT15: fallback strutturato indipendente ESPN prima del web search generico.
    // Richiede match giocatori univoco, evento completato e score set-by-set parseabile.
    if (allowOfficialNetwork === true && (winner === null || (needsTotals && totalGames === null))) {
        const structured = await audit15SourceFusion.resolveTennisStructured(match, { allowNetwork: true });
        if (structured.resolution) {
            const final = { ...structured.resolution, isVoid: false };
            saveCache(p1Db, p2Db, matchDateKey, final);
            return final;
        }
    }

    // 3. Web search controllata PRIMA della API, ma accettata solo se affidabile.
    if (allowWebFallback && (winner === null || (needsTotals && totalGames === null))) {
        const webResult = await fallbackAiTennisScore(p1Db, p2Db, matchDateKey, { allowCache: false });

        if (webResult) {
            if (webResult.isVoid) return webResult;
            const webSide = sideIdentity.normalizeInternalSide(match.prediction);
            if ((webSide === '1' || webSide === '2') && webResult.step107WeakWinnerSide === true && !(webResult.winnerName || webResult.winner_player_name)) {
                console.warn('⚠️ [STEP107 SIDE IDENTITY] STEP107 weak web fallback ignored for moneyline: ' + p1Db + ' - ' + p2Db);
                return null;
            }
            winner = winner ?? webResult.winner;
            totalGames = totalGames ?? webResult.totalGames;
            source = source || webResult.source || 'STEP58_WEB_FALLBACK_SCORE_GUARDED';
            note = note || webResult.note || 'Risultato da web fallback controllato.';

            if (winner !== null && (!needsTotals || totalGames !== null)) {
                const final = { ...webResult, winner, totalGames, isVoid: false, source, note };
                saveCache(p1Db, p2Db, matchDateKey, final);
                return final;
            }
        }
    }

    // 4. API scores solo se necessaria e già caricata dal batch unico.
    if (allowApi && Array.isArray(apiScores) && apiScores.length > 0) {
        const apiResult = resolveFromApiScores(match, apiScores);
        if (apiResult) {
            winner = winner ?? apiResult.winner;
            totalGames = totalGames ?? apiResult.totalGames;
            source = source || apiResult.source;
            note = note || apiResult.note;
            if (winner !== null && (!needsTotals || totalGames !== null)) {
                const final = { ...apiResult, winner, totalGames, isVoid: false, source, note };
                saveCache(p1Db, p2Db, matchDateKey, final);
                return final;
            }
        }
    }

    if (winner === null && !needsTotals) {
        return null;
    }

    if (needsTotals && totalGames === null) {
        return null;
    }

    const final = {
        winner,
        totalGames,
        isVoid: totalGames === 'VOID' || winner === 'VOID',
        source: source || 'STEP58_MIXED_SOURCES',
        note: note || 'Risultato risolto da fonti multiple con priorità vault/web/API.'
    };

    saveCache(p1Db, p2Db, matchDateKey, final);
    return final;
}

// ============================================================================
// 16. UPDATE SETTLEMENT
// ============================================================================

function isPatch8ExplicitTestOnlyNonAtomicAdapter(db, context = {}) {
    return process.env.NODE_ENV === 'test'
        && context.patch8TestOnlyNonAtomicAdapter === true
        && (!db || typeof db.transaction !== 'function');
}

function refreshPatch7EligibilityAfterSettlement(db, betId, context = {}) {
    if (!db || typeof db.exec !== 'function' || typeof db.transaction !== 'function') {
        return { updated: false, reason: 'DB_ADAPTER_NO_PATCH7_REFRESH' };
    }
    try {
        const result = tennisPredictionSnapshots.refreshCalibrationEligibilityForBet(db, betId, {
            operationId: context.operationId || null
        });
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO',
            component: 'TENNIS_SETTLEMENT',
            operation: 'TENNIS_PAPER_SETTLEMENT',
            operationId: context.operationId || null,
            phase: 'ELIGIBILITY_INCREMENTAL_REFRESH',
            event: 'ELIGIBILITY_INCREMENTAL_REFRESH',
            message: `Ledger calibrazione aggiornato dopo settlement bet ${betId}.`,
            context: { betId, eligibilityStatus: result.record?.eligibility_status || result.reason || null }
        });
        return result;
    } catch (error) {
        runtimeDiagnostics.captureError({
            component: 'TENNIS_SETTLEMENT',
            operation: 'TENNIS_PAPER_SETTLEMENT',
            operationId: context.operationId || null,
            phase: 'ELIGIBILITY_INCREMENTAL_REFRESH_FAILED',
            error,
            context: { betId, settlementPersisted: true }
        });
        return { updated: false, reason: error.message };
    }
}

function buildPatch34R4SnapshotAuthorityRow(db, row = {}) {
    if (!db || typeof db.prepare !== 'function' || !(Number(row.id) > 0)) {
        return { row: { ...row }, anchor: null, repaired: false, reason: 'SNAPSHOT_DB_UNAVAILABLE' };
    }
    let anchor = null;
    try { anchor = tennisPredictionSnapshots.getCalibrationAnchor(db, row.id); } catch (_) { anchor = null; }
    if (!anchor) return { row: { ...row }, anchor: null, repaired: false, reason: 'CALIBRATION_ANCHOR_MISSING' };
    const immutable = tennisCalibrationEligibility.applyPredictionSnapshotToRow(row, anchor);
    let payload = {};
    try { payload = JSON.parse(anchor.payload_json || '{}') || {}; } catch (_) { payload = {}; }
    const predictedSide = String(payload.predicted_side ?? immutable.prediction ?? '').trim();
    const predictedPlayerName = String(payload.predicted_player_name || (predictedSide === '1' ? row.home_team : predictedSide === '2' ? row.away_team : '') || '').trim();
    immutable.prediction = predictedSide || immutable.prediction;
    immutable.internal_side = predictedSide || immutable.internal_side;
    immutable.predicted_player_name = predictedPlayerName || immutable.predicted_player_name;
    immutable.tennis_event_fingerprint = payload.event_fingerprint || immutable.tennis_event_fingerprint;
    immutable.tennis_market_fingerprint = payload.market_fingerprint || immutable.tennis_market_fingerprint;
    immutable._patch34_r4_snapshot_truth = true;
    immutable._patch34_r4_current_prediction_before = row.prediction ?? null;
    immutable._patch34_r4_current_predicted_player_before = row.predicted_player_name ?? null;
    const repaired = String(row.prediction || '') !== String(immutable.prediction || '') ||
        String(row.predicted_player_name || '') !== String(immutable.predicted_player_name || '') ||
        String(row.tennis_market_fingerprint || '') !== String(immutable.tennis_market_fingerprint || '');
    return { row: immutable, anchor, repaired, reason: repaired ? 'MUTABLE_ROW_DRIFT_FROM_ANCHOR' : 'ROW_MATCHES_ANCHOR' };
}

function updateBetSettlement(db, match, resolution, evaluationResult, context = {}) {
    const operationId = context.operationId || runtimeDiagnostics.createOperationId('TENNIS_SETTLEMENT_LIFECYCLE');
    const snapshotAuthority = buildPatch34R4SnapshotAuthorityRow(db, match);
    const settlementMatch = snapshotAuthority.row;
    if (resolution?.patch34R4Truth && !resolution.nonFinal) {
        evaluationResult = sideIdentity.evaluateTennisBetWithSideIdentity(settlementMatch, resolution, evaluateTennisBet);
    }
    const before = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match?.id) || match || null;

    if (before && String(before.status || '').toUpperCase() !== 'PENDING') {
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
            match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.SKIPPED_ALREADY_RESOLVED,
            reason: 'SOURCE_ROW_ALREADY_RESOLVED', rowsMatched: 1, rowsChanged: 0
        });
        return { updated: false, blocked: false, skipped: true, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
    }

    if (resolution?.nonFinal === true) {
        const retirement = resolution.lifecycleStatus === 'RETIREMENT_REVIEW' || resolution.requiresBookmakerRule === true;
        const pendingFields = {
            status: 'PENDING',
            settlement_contract_status: retirement ? settlementContract.SETTLEMENT_STATES.MANUAL_REVIEW : settlementContract.SETTLEMENT_STATES.PENDING,
            settlement_contract_reason: resolution.lifecycleReason || 'NON_FINAL_EVENT_PENDING_COMPLETION',
            settlement_contract_version: settlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
            settlement_source: resolution.source || 'PATCH34_R4_NON_FINAL_EVIDENCE',
            settlement_source_tier: retirement ? 'MANUAL' : 'CERTIFIED',
            settlement_source_event_id: resolution.sourceEventId || null,
            settlement_winner_name: resolution.winnerName || null,
            settlement_score: resolution.score || null,
            settlement_observed_at: resolution.observedAt || new Date().toISOString(),
            settlement_confidence: resolution.confidence || 0.99,
            settlement_evidence_hash: resolution.evidenceHash || settlementContract.hashEvidence(resolution.rawEvidence || resolution),
            settlement_event_fingerprint: match.tennis_event_fingerprint || null,
            settlement_market_fingerprint: match.tennis_market_fingerprint || null,
            settlement_operation_id: operationId,
            settlement_note: resolution.note || 'Patch 34 R4: evento non finale; settlement non applicato.',
            engine_version: TENNIS_PAPER_ENGINE_VERSION
        };
        const nonFinalContract = {
            status: pendingFields.settlement_contract_status,
            reason: pendingFields.settlement_contract_reason,
            sourceTier: pendingFields.settlement_source_tier,
            sourceEventId: pendingFields.settlement_source_event_id,
            winnerName: pendingFields.settlement_winner_name,
            score: pendingFields.settlement_score,
            eventFingerprint: pendingFields.settlement_event_fingerprint,
            marketFingerprint: pendingFields.settlement_market_fingerprint
        };
        const exceptionInspection = tennisSettlementExceptionQueuePatch51.inspectException(db, { match, resolution, contract: nonFinalContract, operationId });
        if (exceptionInspection.action === tennisSettlementExceptionQueuePatch51.ACTIONS.NOOP_UNCHANGED_EVIDENCE) {
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
                match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.NOOP_UNCHANGED_EVIDENCE,
                contractStatus: nonFinalContract.status, reason: 'UNCHANGED_SETTLEMENT_EXCEPTION_EVIDENCE', rowsMatched: 1, rowsChanged: 0
            });
            return { updated: false, blocked: true, nonFinal: true, contract: nonFinalContract, settlementException: exceptionInspection, notificationSuppressed: true, lifecycleSuppressed: true, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
        }
        try {
            let settlementException = null;
            const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, {
                betId: match.id, transition: tennisForwardLifecycle.TRANSITIONS.SETTLEMENT_BLOCKED, operationId
            }, () => {
                if (!safeUpdateRow(db, match.id, pendingFields)) throw new Error(`PATCH34_R4_NON_FINAL_EVIDENCE_PERSIST_FAILED:${match.id}`);
                settlementException = tennisSettlementExceptionQueuePatch51.commitException(db, exceptionInspection);
                return { success: true, updated: true, blocked: true, nonFinal: true };
            });
            const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
                match, before, after, outcome: retirement ? tennisSettlementUpdateAudit.OUTCOMES.SKIPPED_MANUAL_REVIEW : tennisSettlementUpdateAudit.OUTCOMES.BLOCKED_CONTRACT,
                contractStatus: pendingFields.settlement_contract_status, reason: pendingFields.settlement_contract_reason,
                rowsMatched: 1, rowsChanged: 1
            });
            runtimeDiagnostics.writeDiagnostic({
                level: 'INFO', component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId,
                phase: 'PATCH34_R4_NON_FINAL_EVIDENCE', event: 'SETTLEMENT_NON_FINAL_PROTECTED',
                message: `Match ${match.id} classificato ${resolution.lifecycleStatus}; resta PENDING.`,
                context: { betId: match.id, lifecycleStatus: resolution.lifecycleStatus, reason: resolution.lifecycleReason, automaticSettlement: false }
            });
            return { updated: false, blocked: true, nonFinal: true, contract: nonFinalContract, settlementException, lifecycle: lifecycleResult.inspection, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
        } catch (error) {
            runtimeDiagnostics.captureError({ component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId, phase: 'PATCH34_R4_NON_FINAL_ROLLBACK', error, context: { betId: match.id } });
            return { updated: false, blocked: true, nonFinal: true, error: error.message, operationId };
        }
    }

    if (tennisSettlementUpdateAudit.isProtectedManualReview(before || match) && context.overrideProtectedManualReview !== true && !tennisSettlementTruthR4.canRecoverProtectedManualReview(before || match, resolution)) {
        const protectedContract = {
            status: settlementContract.SETTLEMENT_STATES.MANUAL_REVIEW,
            autoSettleAllowed: false,
            reason: before.settlement_contract_reason,
            source: before.settlement_source,
            sourceTier: before.settlement_source_tier || 'MANUAL'
        };
        const manualInspection = tennisSettlementExceptionQueuePatch51.inspectException(db, { match: before || match, resolution: {}, contract: protectedContract, operationId });
        if (manualInspection.action === tennisSettlementExceptionQueuePatch51.ACTIONS.NOOP_UNCHANGED_EVIDENCE) {
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
                match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.NOOP_UNCHANGED_EVIDENCE,
                contractStatus: protectedContract.status, reason: 'UNCHANGED_MANUAL_REVIEW_EVIDENCE', rowsMatched: 1, rowsChanged: 0
            });
            return { updated: false, blocked: true, protectedManualReview: true, contract: protectedContract, settlementException: manualInspection, notificationSuppressed: true, lifecycleSuppressed: true, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
        }
        const manualException = tennisSettlementExceptionQueuePatch51.commitException(db, manualInspection);
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO', component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId,
            phase: 'MANUAL_REVIEW_PROTECTION', event: 'SETTLEMENT_MANUAL_REVIEW_PROTECTED',
            message: `Revisione manuale protetta per bet ${match.id}; nessuna fonte automatica può sovrascriverla.`,
            context: { betId: match.id, reason: before.settlement_contract_reason, incomingSource: resolution?.source || null }
        });
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
            match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.SKIPPED_MANUAL_REVIEW,
            contractStatus: protectedContract.status, reason: protectedContract.reason, rowsMatched: 1, rowsChanged: 0
        });
        return { updated: false, blocked: true, protectedManualReview: true, contract: protectedContract, settlementException: manualException, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
    }

    const contractResult = settlementContract.evaluateTennisSettlementContract(settlementMatch, resolution, context);
    const contractFields = settlementContract.buildSettlementContractFields(settlementMatch, resolution, context);

    // PATCH29 R2: la stessa verifica fingerprint usata dalla migrazione R1 diventa una guardia runtime.
    if (contractResult.autoSettleAllowed && db && typeof db.prepare === 'function') {
        let cohort = null;
        try { cohort = db.prepare('SELECT event_fingerprint,market_fingerprint FROM tennis_forward_cohort_members WHERE bet_id=?').get(match.id) || null; } catch (_) {}
        const eventMismatch = Boolean(cohort?.event_fingerprint && contractFields.settlement_event_fingerprint && cohort.event_fingerprint !== contractFields.settlement_event_fingerprint);
        const marketMismatch = Boolean(cohort?.market_fingerprint && contractFields.settlement_market_fingerprint && cohort.market_fingerprint !== contractFields.settlement_market_fingerprint);
        const patch34R4IdentityOverride = (eventMismatch || marketMismatch) && tennisSettlementTruthR4.canBypassFingerprintMismatch(settlementMatch, resolution);
        if ((eventMismatch || marketMismatch) && !patch34R4IdentityOverride) {
            const reason = marketMismatch ? 'OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH' : 'OFFICIAL_EVENT_FINGERPRINT_MISMATCH';
            const manualFields = {
                ...contractFields,
                settlement_source: resolution.source || 'UNKNOWN',
                settlement_note: `${resolution.note || ''} Patch 29 R2: revisione manuale protetta per fingerprint non coerente con la coorte prematch.`.trim(),
                settlement_contract_status: settlementContract.SETTLEMENT_STATES.MANUAL_REVIEW,
                settlement_contract_reason: reason,
                settlement_source_tier: 'MANUAL',
                engine_version: TENNIS_PAPER_ENGINE_VERSION
            };
            try {
                const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, {
                    betId: match.id, transition: tennisForwardLifecycle.TRANSITIONS.SETTLEMENT_BLOCKED, operationId
                }, () => {
                    if (!safeUpdateRow(db, match.id, manualFields)) throw new Error(`PATCH29_R2_MANUAL_REVIEW_PERSIST_FAILED:${match.id}`);
                    return { success: true, updated: true, blocked: true, manualReview: true };
                });
                const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
                const manualContract = { ...contractResult, status: settlementContract.SETTLEMENT_STATES.MANUAL_REVIEW, autoSettleAllowed: false, reason, reasons: [reason], sourceTier: 'MANUAL' };
                const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({
                    match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.MANUAL_REVIEW_RECORDED,
                    contractStatus: manualContract.status, reason, rowsMatched: 1, rowsChanged: 1
                });
                return { updated: false, blocked: true, manualReviewRecorded: true, contract: manualContract, lifecycle: lifecycleResult.inspection, eligibilityRefresh: lifecycleResult.eligibilityResult, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
            } catch (error) {
                runtimeDiagnostics.captureError({ component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId, phase: 'PATCH29_R2_MANUAL_REVIEW_ROLLBACK', error, context: { betId: match.id, reason } });
                const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
                const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED, contractStatus: 'MANUAL_REVIEW', reason, error, rowsMatched: before ? 1 : 0, rowsChanged: 0 });
                return { updated: false, blocked: false, error: error.message, lifecycleAtomicFailure: true, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
            }
        }
    }

    if (contractResult.autoSettleAllowed && tennisSettlementTruthR4.canBypassFingerprintMismatch(settlementMatch, resolution)) {
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO', component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId,
            phase: 'PATCH34_R4_IDENTITY_AUTHORITY', event: 'OFFICIAL_PLAYER_PAIR_IDENTITY_ACCEPTED',
            message: `Identità ufficiale giocatori accettata per bet ${match.id}; alias fingerprint legacy non blocca il settlement.`,
            context: { betId: match.id, identityVersion: tennisSettlementTruthR4.IDENTITY_VERSION, sourceEventId: resolution.sourceEventId }
        });
    }

    if (!contractResult.autoSettleAllowed) {
        const exceptionInspection = tennisSettlementExceptionQueuePatch51.inspectException(db, { match: settlementMatch, resolution, contract: contractResult, operationId });
        if (exceptionInspection.action === tennisSettlementExceptionQueuePatch51.ACTIONS.NOOP_UNCHANGED_EVIDENCE) {
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after: before,
                outcome: tennisSettlementUpdateAudit.OUTCOMES.NOOP_UNCHANGED_EVIDENCE,
                contractStatus: contractResult.status, reason: 'UNCHANGED_SETTLEMENT_EXCEPTION_EVIDENCE', rowsMatched: before ? 1 : 0, rowsChanged: 0 });
            return { updated: false, blocked: true, contract: contractResult, settlementException: exceptionInspection,
                notificationSuppressed: true, lifecycleSuppressed: true, operationId, updateOutcome: updateAudit.updateOutcome, updateAudit };
        }
        runtimeDiagnostics.writeDiagnostic({
            level: contractResult.status === settlementContract.SETTLEMENT_STATES.REJECTED ? 'ERROR' : 'WARN',
            component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId,
            phase: 'CONTRACT_GUARD', event: 'SETTLEMENT_BLOCKED',
            message: `Settlement automatico bloccato per bet ${match.id}: ${contractResult.status}.`,
            context: { betId: match.id, match: `${match.home_team} - ${match.away_team}`, source: resolution.source, reason: contractResult.reason }
        });
        if (isPatch8ExplicitTestOnlyNonAtomicAdapter(db, context)) {
            const mutationApplied = safeUpdateRow(db, match.id, { ...contractFields, settlement_source: resolution.source || 'UNKNOWN', settlement_note: `Patch 5: settlement non certificato (${contractResult.status}) · ${contractResult.reason}`, engine_version: TENNIS_PAPER_ENGINE_VERSION });
            const settlementException = mutationApplied ? tennisSettlementExceptionQueuePatch51.commitException(db, exceptionInspection) : null;
            const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.BLOCKED_CONTRACT, contractStatus: contractResult.status, reason: contractResult.reason, rowsMatched: before ? 1 : 0, rowsChanged: mutationApplied ? 1 : 0 });
            return { updated: false, blocked: true, contract: contractResult, settlementException, eligibilityRefresh: refreshPatch7EligibilityAfterSettlement(db, match.id, context), lifecycle: null, operationId, patch8TestOnlyNonAtomicAdapter: true, testMutationApplied: Boolean(mutationApplied), updateOutcome: updateAudit.updateOutcome, updateAudit };
        }
        try {
            let settlementException = null;
            const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, { betId: match.id, transition: tennisForwardLifecycle.TRANSITIONS.SETTLEMENT_BLOCKED, operationId }, () => {
                const mutationApplied = safeUpdateRow(db, match.id, { ...contractFields, settlement_source: resolution.source || 'UNKNOWN', settlement_note: `Patch 5: settlement non certificato (${contractResult.status}) · ${contractResult.reason}`, engine_version: TENNIS_PAPER_ENGINE_VERSION });
                if (!mutationApplied) throw new Error(`PATCH8_BLOCKED_SETTLEMENT_AUDIT_PERSIST_FAILED:${match.id}`);
                settlementException = tennisSettlementExceptionQueuePatch51.commitException(db, exceptionInspection);
                return { success: true, updated: true, blocked: true };
            });
            const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.BLOCKED_CONTRACT, contractStatus: contractResult.status, reason: contractResult.reason, rowsMatched: before ? 1 : 0, rowsChanged: 1 });
            return { updated: false, blocked: true, contract: contractResult, settlementException, eligibilityRefresh: lifecycleResult.eligibilityResult, lifecycle: lifecycleResult.inspection, operationId, updateOutcome: updateAudit.updateOutcome, updateAudit };
        } catch (error) {
            runtimeDiagnostics.captureError({ component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId, phase: 'PATCH8_BLOCKED_SETTLEMENT_ROLLBACK', error, context: { betId: match.id, contractStatus: contractResult.status, lifecycleAtomic: true } });
            const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
            const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED, contractStatus: contractResult.status, reason: contractResult.reason, error, rowsMatched: before ? 1 : 0, rowsChanged: 0 });
            return { updated: false, blocked: true, contract: contractResult, error: error.message, lifecycleAtomicFailure: true, operationId, updateOutcome: updateAudit.updateOutcome, updateAudit };
        }
    }

    const status = evaluationToStatus(evaluationResult);
    if (!status) {
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.NOOP_ALREADY_CURRENT, reason: 'EVALUATION_STATUS_EMPTY', rowsMatched: before ? 1 : 0, rowsChanged: 0 });
        return { updated: false, blocked: false, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
    }
    const profit = calculateBetProfit(settlementMatch, evaluationResult);
    if (profit === null) {
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after: before, outcome: tennisSettlementUpdateAudit.OUTCOMES.NOOP_ALREADY_CURRENT, intendedStatus: status, reason: 'PROFIT_NOT_EVALUABLE', rowsMatched: before ? 1 : 0, rowsChanged: 0 });
        return { updated: false, blocked: false, updateOutcome: updateAudit.updateOutcome, updateAudit, operationId };
    }

    const totalGames = resolution.totalGames === 'VOID' ? null : toNumber(resolution.totalGames, null);
    const winnerSide = resolution.winner === 'VOID' ? null : toNumber(resolution.winner, null);
    const edgePp = toNumber(settlementMatch.edge_pp ?? settlementMatch.adjusted_edge_pp ?? settlementMatch.edge, null);
    const evPct = toNumber(settlementMatch.ev_pct ?? settlementMatch.adjusted_ev_pct ?? settlementMatch.expectedValue ?? settlementMatch.ev, null);
    const settlementFields = {
        ...contractFields, status, profit, sport_type: 'TENNIS', data_quality: isCurrentCleanRow(settlementMatch) ? settlementMatch.data_quality : DATA_QUALITY_CURRENT,
        model_version: settlementMatch.model_version || TENNIS_MODEL_VERSION, metric_version: settlementMatch.metric_version || TENNIS_METRIC_VERSION,
        engine_version: TENNIS_PAPER_ENGINE_VERSION, settlement_source: resolution.source || 'UNKNOWN', settlement_note: `${resolution.note || ''} Patch 34 R4: pronostico valutato dallo snapshot immutabile ${snapshotAuthority.anchor?.snapshot_id || 'N/D'} (${snapshotAuthority.reason}).`.trim(),
        settled_at: new Date().toISOString(), total_games: totalGames, winner_side: winnerSide,
        winner_player_name: resolution.winnerName || resolution.winner_player_name || null,
        side_mapping_verified: contractResult.autoSettleAllowed ? 1 : 0, side_identity_version: tennisSettlementTruthR4.IDENTITY_VERSION,
        prediction: settlementMatch.prediction, internal_side: settlementMatch.internal_side,
        predicted_player_name: settlementMatch.predicted_player_name,
        tennis_event_fingerprint: settlementMatch.tennis_event_fingerprint, tennis_market_fingerprint: settlementMatch.tennis_market_fingerprint,
        settlement_event_fingerprint: settlementMatch.tennis_event_fingerprint, settlement_market_fingerprint: settlementMatch.tennis_market_fingerprint,
        prediction_snapshot_authority_id: snapshotAuthority.anchor?.snapshot_id || null,
        prediction_snapshot_authority_hash: snapshotAuthority.anchor?.snapshot_hash || null
    };
    const settledScope = tennisScope.classifyTennisTradingScope({ ...settlementMatch, ...settlementFields, status, profit, sport_type: 'TENNIS', data_quality: settlementFields.data_quality });
    settlementFields.trading_scope = settledScope.scope;
    settlementFields.paper_trading_scope = settledScope.paperOperational ? 'PAPER_OPERATIONAL' : 'AUDIT_ONLY';
    settlementFields.portfolio_scope = settledScope.portfolioEligible ? 'PORTFOLIO_REAL' : 'EXCLUDED_FROM_REAL_PORTFOLIO';
    settlementFields.audit_scope_reason = settledScope.reason;
    if (edgePp !== null) settlementFields.edge_pp = edgePp;
    if (evPct !== null) settlementFields.ev_pct = evPct;

    if (isPatch8ExplicitTestOnlyNonAtomicAdapter(db, context)) {
        let updated = safeUpdateRow(db, match.id, settlementFields);
        if (!updated) { const fallback = db.prepare('UPDATE ai_forward_test SET status = ?, profit = ? WHERE id = ?').run(status, profit, match.id); updated = Number(fallback.changes || 0) > 0; }
        const settlementExceptionResolution = updated ? tennisSettlementExceptionQueuePatch51.resolveException(db, match.id, { operationId, reason: 'SETTLEMENT_CERTIFIED' }) : null;
        const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: updated ? tennisSettlementUpdateAudit.OUTCOMES.UPDATED : tennisSettlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED, intendedStatus: status, contractStatus: contractResult.status, reason: updated ? 'SETTLEMENT_PERSISTED' : 'TEST_ADAPTER_UPDATE_FAILED', rowsMatched: before ? 1 : 0, rowsChanged: updated ? 1 : 0 });
        return { updated: Boolean(updated), blocked: false, contract: contractResult, settlementExceptionResolution, eligibilityRefresh: refreshPatch7EligibilityAfterSettlement(db, match.id, context), lifecycle: null, operationId, patch8TestOnlyNonAtomicAdapter: true, updateOutcome: updateAudit.updateOutcome, updateAudit };
    }

    try {
        const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, { betId: match.id, transition: tennisForwardLifecycle.TRANSITIONS.SETTLEMENT_VERIFIED, operationId }, () => {
            let mutationApplied = safeUpdateRow(db, match.id, settlementFields);
            if (!mutationApplied) { const fallback = db.prepare('UPDATE ai_forward_test SET status = ?, profit = ? WHERE id = ?').run(status, profit, match.id); mutationApplied = Number(fallback.changes || 0) > 0; }
            if (!mutationApplied) throw new Error(`PATCH8_SETTLEMENT_PERSIST_FAILED:${match.id}`);
            const settlementExceptionResolution = tennisSettlementExceptionQueuePatch51.resolveException(db, match.id, { operationId, reason: 'SETTLEMENT_CERTIFIED' });
            if (settlementExceptionResolution?.action === tennisSettlementExceptionQueuePatch51.ACTIONS.RESOLUTION_BLOCKED) {
                const gateReason = settlementExceptionResolution?.resolutionGate?.reasons?.join(',') || settlementExceptionResolution?.resolutionGate?.reason || 'UNKNOWN';
                throw new Error(`AUDIT12_SETTLEMENT_EXCEPTION_RESOLUTION_BLOCKED:${match.id}:${gateReason}`);
            }
            return { success: true, updated: true, blocked: false, status, profit, settlementExceptionResolution };
        });
        const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.UPDATED, intendedStatus: status, contractStatus: contractResult.status, reason: 'SETTLEMENT_PERSISTED', rowsMatched: 1, rowsChanged: 1 });
        return { updated: true, blocked: false, contract: contractResult, eligibilityRefresh: lifecycleResult.eligibilityResult, lifecycle: lifecycleResult.inspection, operationId, updateOutcome: updateAudit.updateOutcome, updateAudit };
    } catch (error) {
        runtimeDiagnostics.captureError({ component: 'TENNIS_SETTLEMENT', operation: 'TENNIS_PAPER_SETTLEMENT', operationId, phase: 'PATCH8_ATOMIC_SETTLEMENT_ROLLBACK', error, context: { betId: match.id, intendedStatus: status, lifecycleAtomic: true } });
        const after = tennisSettlementUpdateAudit.readSettlementSnapshot(db, match.id);
        const updateAudit = tennisSettlementUpdateAudit.buildAttemptAudit({ match, before, after, outcome: tennisSettlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED, intendedStatus: status, contractStatus: contractResult.status, reason: 'ATOMIC_SETTLEMENT_ROLLBACK', error, rowsMatched: before ? 1 : 0, rowsChanged: 0 });
        return { updated: false, blocked: false, contract: contractResult, error: error.message, lifecycleAtomicFailure: true, operationId, updateOutcome: updateAudit.updateOutcome, updateAudit };
    }
}

// ============================================================================
// 17. QUERY DB
// ============================================================================

function getPendingTennisBets(db, leagueFilter = 'all') {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE status = 'PENDING'
          AND (
                UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
          )
          AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
          AND COALESCE(paper_result_active,1) = 1
          AND COALESCE(paper_result_conflict,0) = 0
    `;

    const params = [];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league LIKE ?`;
        params.push(`%${leagueFilter}%`);
    }

    query += ` ORDER BY id ASC`;

    return db.prepare(query).all(...params).map(tennisDeepScanTaxonomyPatch40.decorateRow);
}

function getHistoryTennisBets(db, leagueFilter = 'all', limit = 2000) {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE (
                UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
              )
          AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
          AND COALESCE(paper_result_active,1) = 1
          AND COALESCE(paper_result_conflict,0) = 0
    `;

    const params = [];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league LIKE ?`;
        params.push(`%${leagueFilter}%`);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(query).all(...params).map(tennisDeepScanTaxonomyPatch40.decorateRow);
}

function getResolvedTennisBetsForStats(db, leagueFilter = 'all') {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE (
                UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
              )
          AND status IN ('WON', 'LOST', 'PUSH', 'VOID')
          AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
          AND COALESCE(paper_result_active,1) = 1
          AND COALESCE(paper_result_conflict,0) = 0
    `;

    const params = [];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league LIKE ?`;
        params.push(`%${leagueFilter}%`);
    }

    query += ` ORDER BY id DESC`;

    return db.prepare(query).all(...params).map(tennisDeepScanTaxonomyPatch40.decorateRow);
}


// ============================================================================
// 18. STATISTICHE FRONTEND
// ============================================================================

function calculateStats(allResolved = []) {
    const scope = tennisTradingReportingPatch40.calculateScope(allResolved, tennisTradingReportingPatch40.FULL_SCOPE);
    return {
        singles: tennisTradingReportingPatch40.legacySingles(scope),
        multis: { placed: 0, won: 0, lost: 0, push: 0, void: 0, profit: 0, invested: 0, roi: '0.00', hit_rate: '0.00' },
        reportingScope: scope.scope,
        reportingVersion: tennisTradingReportingPatch40.VERSION
    };
}

// ============================================================================
// 19. MAIN ENGINE CON TASK TRACKING PROGRESSIVO (FASE 1-9)
// ============================================================================

async function processTennisPaperTrading(db, leagueFilter = 'all', fetchOddsApiFunc = null) {
    const runtimeOp = runtimeDiagnostics.startOperation('TENNIS_PAPER_SETTLEMENT', { leagueFilter, engineVersion: TENNIS_PAPER_ENGINE_VERSION }, { component: 'TENNIS_SETTLEMENT' });
    const operationId = runtimeOp.operationId;
    try {
    runtimeOp.phase('INITIALIZATION', 'Avvio pipeline settlement Tennis.', { leagueFilter });
    console.log(`\n🎾 =========================================================================`);
    console.log(`🎾 [PAPER TRADING TENNIS] Avvio Motore v${TENNIS_PAPER_ENGINE_VERSION}. Filtro: ${leagueFilter} · Operation ID: ${operationId}`);
    console.log(`🎾 =========================================================================`);

    // FASE 1: INIZIALIZZAZIONE E LETTURA PENDING
    console.log(`⏳ [FASE 1/9] Inizializzazione colonne DB e lettura scommesse PENDING...`);
    ensureTennisPaperTradingColumns(db);
    tennisSettlementExceptionQueuePatch51.ensureSchema(db);
    const patch51Onboarding = tennisSettlementExceptionQueuePatch51.seedCurrentExceptions(db, { operationId });

    let resolvedCount = 0;
    let skippedNotReady = 0;
    let unresolvedCount = 0;
    let voidCount = 0;
    let pushCount = 0;

    const diagnostics = {
        mode: STEP58_SETTLEMENT_GUARD_MODE,
        engineVersion: TENNIS_PAPER_ENGINE_VERSION,
        dataMode: 'CURRENT_BOOTSTRAP_ONLY',
        leagueFilter,
        operationId,
        settlementContractVersion: settlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
        contractBlocked: 0,
        contractVerified: 0,
        contractVoid: 0,
        evidenceStatus: { pendingEvidence: 0, proposedWeakEvidence: 0, sourceConflict: 0, contractInvalid: 0, manualReview: 0 },
        pendingTennisRows: 0,
        pendingBefore: 0,
        pendingAfter: 0,
        resolvedThisRun: 0,
        manualReviewAfter: 0,
        weakEvidenceAfter: 0,
        dbUpdateFailures: 0,
        updateOutcomes: {},
        settlementAttemptAudit: [],
        settlementExceptionQueueVersion: tennisSettlementExceptionQueuePatch51.VERSION,
        settlementExceptionOnboarding: patch51Onboarding,
        settlementExceptionActions: { new: 0, changed: 0, unchanged: 0, resolved: 0 },
        uniquePendingMatches: 0,
        uniqueReadyMatches: 0,
        uniqueResolvedBeforeApi: 0,
        uniqueNeedApi: 0,
        uniqueResolvedAfterApi: 0,
        auditRowsResolved: 0,
        realStakeRowsResolved: 0,
        apiScoresLoaded: 0,
        step105TargetedSettlementMode: STEP105_TENNIS_SETTLEMENT_TARGETED_RESULTS,
        step105TargetedKeys: [],
        step105TargetedKeysUsed: [],
        step105TargetedScoresLoaded: 0,
        apiScoresCatalogRequested: false,
        apiSportsAvailable: 0,
        apiSportsRequested: 0,
        apiSportsRequestedKeys: [],
        apiSkippedNoPendingToResolve: false,
        apiSkippedNoMatchingSport: false,
        apiUnavailableOrExhausted: false,
        apiErrors: [],
        settlementApiBudgetMode: STEP64_SETTLEMENT_API_BUDGET_MODE,
        settlementApiMaxCallsPerRun: STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN,
        settlementApiMinResidualCredits: STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS,
        settlementApiCreditsRemainingBefore: null,
        settlementApiBudgetBlocked: false,
        apiSkippedByStep64Budget: false,
        apiSportsEligibleBeforeBudget: 0,
        apiSportsSkippedByBudget: 0,
        tennisMyLifeRowsLoaded: 0,
        skippedNotReady: 0,
        unresolvedNoResolution: 0,
        unresolvedNoEvaluation: 0,
        settlementUpdated: 0,
        voidCount: 0,
        pushCount: 0,
        pendingReasons: {},
        apiCreditsUsed: 0,
        apiRequestsUsed: 0,
        apiCacheHits: 0,
        apiCacheMisses: 0,
        apiCacheWrites: 0,
        notes: [
            'Patch29: resolver ufficiale ATP/WTA e seed firmata prima di cache/web/API.',
            'Step58: settlement risultati usa vault/cache/web affidabile prima della API.',
            'La API scores viene usata solo per match unici ancora irrisolti e già pronti.',
            'Step64: budget settlement scores attivo; max chiamate per run e guardia residuo crediti.'
        ]
    };

    const pendingBets = getPendingTennisBets(db, leagueFilter);
    diagnostics.pendingTennisRows = pendingBets.length;
    diagnostics.pendingBefore = pendingBets.length;
    runtimeOp.phase('PENDING_READ', 'Lette righe Tennis PENDING.', { pendingRows: pendingBets.length });
    console.log(`   ➜ Trovate ${pendingBets.length} bet(s) in stato PENDING.`);

    // FASE 2: RAGGRUPPAMENTO
    console.log(`⏳ [FASE 2/9] Raggruppamento delle bet per minimizzare calcoli/chiamate...`);
    const groups = groupPendingTennisBetsByMatch(pendingBets);
    diagnostics.uniquePendingMatches = groups.length;
    console.log(`   ➜ Identificati ${groups.length} match(es) unico/i.`);

    // FASE 3: DATI ESTERNI (TENNIS MY LIFE)
    let tmlData = [];
    if (pendingBets.length > 0) {
        console.log(`⏳ [FASE 3/9] Recupero risultati da fonte Web strutturata (TennisMyLife)...`);
        tmlData = await fetchTennisMyLifeResults();
        runtimeOp.phase('STRUCTURED_SOURCE', 'Fonte TennisMyLife interrogata.', { rowsLoaded: Array.isArray(tmlData) ? tmlData.length : 0 });
        diagnostics.tennisMyLifeRowsLoaded = Array.isArray(tmlData) ? tmlData.length : 0;
        console.log(`   ➜ Caricati ${diagnostics.tennisMyLifeRowsLoaded} risultati da TennisMyLife.`);
    } else {
        console.log(`⏳ [FASE 3/9] Recupero web saltato (Nessuna bet PENDING).`);
    }

    // PATCH29: seed ufficiale firmata caricata una sola volta per run.
    const officialResults = tennisOfficialSettlementResolver.loadSeed();
    diagnostics.officialSettlementResolverVersion = tennisOfficialSettlementResolver.VERSION;
    diagnostics.officialSeedRecords = officialResults.records.length;
    diagnostics.officialOddsApiCalls = 0;
    diagnostics.audit13OutcomeSearchVersion = audit13OutcomeSearch.VERSION;
    diagnostics.audit13ArchiveEligible = 0;
    diagnostics.audit13OfficialNetworkEligible = 0;
    diagnostics.audit13OfficialNetworkResolved = 0;
    diagnostics.audit13ApiSkippedOutsideProviderWindow = 0;

    // FASE 4: FILTRAGGIO ORARIO MATCH
    console.log(`⏳ [FASE 4/9] Filtro temporale: verifica match pronti per la refertazione...`);
    const readyGroups = [];
    for (const group of groups) {
        const representative = group.representative;
        group.ready = isTennisMatchReady(representative.match_date, representative.league);

        for (const row of group.rows) {
            normalizePendingTennisRowMetadata(db, row);
        }

        if (!group.ready) {
            skippedNotReady += group.rows.length;
            diagnostics.skippedNotReady += group.rows.length;
            diagnostics.pendingReasons.NOT_READY_MATCH_WINDOW = (diagnostics.pendingReasons.NOT_READY_MATCH_WINDOW || 0) + group.rows.length;
            for (const row of group.rows) {
                updatePendingSettlementReason(db, row, 'Step58: match non ancora pronto per settlement in base a orario/torneo.', 'PENDING_STEP58_NOT_READY');
            }
            continue;
        }
        readyGroups.push(group);
    }
    diagnostics.uniqueReadyMatches = readyGroups.length;
    console.log(`   ➜ ${readyGroups.length} match(es) pronto/i. (${groups.length - readyGroups.length} esclusi perché troppo recenti)`);

    // FASE 5: PASS 1 (NO API)
    // OTTIMIZZAZIONE FASE 5 (v11.3): Concurrency per il Fallback Web per smaltire decine di match pendenti 
    // in tempi rapidi senza impattare troppo con ritentativi ed errori HTTP.
    console.log(`⏳ [FASE 5/9] Pass 1: Tentativo di refertazione tramite Vault, Cache e Web Fallback (No API)...`);
    const unresolvedGroupsForApi = [];
    const unresolvedArchiveGroups = [];
    const CONCURRENCY_LIMIT = 5; // Evita rate-limiting elaborando 5 match contemporaneamente

    for (let i = 0; i < readyGroups.length; i += CONCURRENCY_LIMIT) {
        const batch = readyGroups.slice(i, i + CONCURRENCY_LIMIT);
        
        // Elabora il blocco corrente in parallelo
        const batchPromises = batch.map(async (group) => {
            const searchPlan = audit13OutcomeSearch.buildSearchPlan(group.representative, 'TENNIS');
            const officialNetworkEligible = searchPlan.archiveRecoveryRequired && tennisOfficialSettlementResolver.supportsOfficialNetwork(group.representative);
            if (searchPlan.archiveRecoveryRequired) diagnostics.audit13ArchiveEligible++;
            if (officialNetworkEligible) diagnostics.audit13OfficialNetworkEligible++;
            const resolution = await resolveTennisMatchResult(group.representative, {
                apiScores: [],
                tmlData,
                officialResults,
                allowOfficialNetwork: officialNetworkEligible,
                allowApi: false,
                allowWebFallback: true,
                operationId
            });
            return { group, resolution, searchPlan, officialNetworkEligible };
        });

        // Attende che il blocco da 5 sia completato prima di passare ai successivi 5
        const batchResults = await Promise.all(batchPromises);

        for (const { group, resolution, searchPlan, officialNetworkEligible } of batchResults) {
            group.audit13SearchPlan = searchPlan;
            if (resolution) {
                group.resolution = resolution;
                group.source = resolution.source;
                diagnostics.uniqueResolvedBeforeApi++;
                if (officialNetworkEligible && /OFFICIAL/i.test(String(resolution.source || ''))) diagnostics.audit13OfficialNetworkResolved++;
            } else if (searchPlan.archiveRecoveryRequired) {
                group.audit13ArchiveRequired = true;
                unresolvedArchiveGroups.push(group);
                diagnostics.audit13ApiSkippedOutsideProviderWindow++;
            } else {
                unresolvedGroupsForApi.push(group);
            }
        }
    }
    
    diagnostics.uniqueNeedApi = unresolvedGroupsForApi.length;
    diagnostics.uniqueArchiveUnresolved = unresolvedArchiveGroups.length;
    console.log(`   ➜ Risolti ${diagnostics.uniqueResolvedBeforeApi} match(es) in locale/web/officiale. Rimangono ${diagnostics.uniqueNeedApi} match(es) recenti per The Odds API; ${diagnostics.uniqueArchiveUnresolved} storici restano nel percorso archive AUDIT13.`);

    // FASE 6: PREPARAZIONE API
    const apiUsageBefore = createSettlementApiUsageSnapshot();
    let apiScores = [];

    if (unresolvedGroupsForApi.length > 0) {
        console.log(`⏳ [FASE 6/9] Pass 2: Connessione a The Odds API per scaricare gli score necessari...`);
        const rowsNeedingApi = unresolvedGroupsForApi.flatMap(group => group.rows);
        apiScores = await fetchOddsApiTennisScores(fetchOddsApiFunc, rowsNeedingApi, diagnostics);
        diagnostics.apiScoresLoaded = Array.isArray(apiScores) ? apiScores.length : 0;
        console.log(`   ➜ Scaricati ${diagnostics.apiScoresLoaded} risultati da The Odds API.`);
    } else {
        console.log(`⏳ [FASE 6/9] Nessuna chiamata The Odds API necessaria. Passaggio saltato.`);
        diagnostics.apiSkippedNoPendingToResolve = true;
    }

    const apiUsageAfter = createSettlementApiUsageSnapshot();
    Object.assign(diagnostics, diffSettlementApiUsage(apiUsageBefore, apiUsageAfter));

    // FASE 7: PASS 2 (CON API)
    if (apiScores.length > 0) {
        console.log(`⏳ [FASE 7/9] Pass 2: Refertazione tramite i dati di The Odds API appena scaricati...`);
        for (const group of unresolvedGroupsForApi) {
            const resolution = await resolveTennisMatchResult(group.representative, {
                apiScores,
                tmlData: [],
                officialResults,
                allowOfficialNetwork: false,
                allowApi: true,
                allowWebFallback: false,
                operationId
            });

            if (resolution) {
                group.resolution = resolution;
                group.source = resolution.source;
                diagnostics.uniqueResolvedAfterApi++;
            }
        }
        console.log(`   ➜ Risolti altri ${diagnostics.uniqueResolvedAfterApi} match(es) tramite API.`);
    } else if (unresolvedGroupsForApi.length > 0) {
         console.log(`⏳ [FASE 7/9] Pass 2 saltato: I dati The Odds API non sono stati ottenuti/disponibili.`);
    } else {
         console.log(`⏳ [FASE 7/9] Pass 2 saltato: Nessun match irrisolto.`);
    }

    // FASE 8: AGGIORNAMENTO DB (SETTLEMENT)
    console.log(`⏳ [FASE 8/9] Valutazione esiti sulle bet individuali e aggiornamento Database...`);
    for (const group of readyGroups) {
        const resolution = group.resolution;

        if (!resolution) {
            const archivePending = group.audit13ArchiveRequired === true;
            const reason = archivePending
                ? 'AUDIT13: evento oltre la finestra score provider (3 giorni); ricerca ufficiale/archive completata senza esito certificabile.'
                : diagnostics.apiUnavailableOrExhausted
                    ? 'Step58: risultato non disponibile; API scores esaurita/non valida o non ha restituito il match.'
                    : 'Step58: score non disponibile da vault/web/cache/API; resta pending senza consumare altre chiamate per righe duplicate.';
            const code = archivePending ? 'PENDING_AUDIT13_OFFICIAL_ARCHIVE_RESULT_NOT_FOUND' : diagnostics.apiUnavailableOrExhausted ? 'PENDING_STEP58_API_EXHAUSTED' : 'PENDING_STEP58_SCORE_NOT_AVAILABLE';
            const key = archivePending ? 'AUDIT13_OFFICIAL_ARCHIVE_RESULT_NOT_FOUND' : diagnostics.apiUnavailableOrExhausted ? 'API_EXHAUSTED_OR_SCORE_NOT_FOUND' : 'SCORE_NOT_AVAILABLE';
            for (const row of group.rows) {
                unresolvedCount++;
                diagnostics.unresolvedNoResolution++;
                diagnostics.pendingReasons[key] = (diagnostics.pendingReasons[key] || 0) + 1;
                updatePendingSettlementReason(db, row, reason, code);
            }
            continue;
        }

        // Applica lo stesso risultato a tutte le righe dello stesso match, incluse audit/stake 0.
        for (const match of group.rows) {
            const p1Db = match.home_team;
            const p2Db = match.away_team;

            const patch34R4SnapshotAuthority = buildPatch34R4SnapshotAuthorityRow(db, match);
            const evaluationRow = resolution?.patch34R4Truth ? patch34R4SnapshotAuthority.row : match;
            const evaluationResult = sideIdentity.evaluateTennisBetWithSideIdentity(
                    evaluationRow,
                    resolution,
                    evaluateTennisBet
                );

            if (evaluationResult === null) {
                unresolvedCount++;
                diagnostics.unresolvedNoEvaluation++;
                diagnostics.pendingReasons.NO_EVALUATION_FOR_MARKET = (diagnostics.pendingReasons.NO_EVALUATION_FOR_MARKET || 0) + 1;
                updatePendingSettlementReason(db, match, 'Step58: risultato trovato ma non sufficiente per valutare questo mercato/pronostico.', 'PENDING_STEP58_NO_EVALUATION');
                continue;
            }

            const settlementOutcome = updateBetSettlement(
                db,
                match,
                resolution,
                evaluationResult,
                { operationId }
            );

            const updateOutcome = String(settlementOutcome?.updateOutcome || (settlementOutcome?.updated ? 'UPDATED' : 'DB_UPDATE_FAILED'));
            diagnostics.updateOutcomes[updateOutcome] = (diagnostics.updateOutcomes[updateOutcome] || 0) + 1;
            if (settlementOutcome?.updateAudit) diagnostics.settlementAttemptAudit.push(settlementOutcome.updateAudit);
            const exceptionAction = settlementOutcome?.settlementException?.action || settlementOutcome?.settlementExceptionResolution?.action || null;
            if (exceptionAction === tennisSettlementExceptionQueuePatch51.ACTIONS.NEW_EXCEPTION) diagnostics.settlementExceptionActions.new++;
            else if (exceptionAction === tennisSettlementExceptionQueuePatch51.ACTIONS.EVIDENCE_CHANGED) diagnostics.settlementExceptionActions.changed++;
            else if (exceptionAction === tennisSettlementExceptionQueuePatch51.ACTIONS.NOOP_UNCHANGED_EVIDENCE) diagnostics.settlementExceptionActions.unchanged++;
            else if (exceptionAction === tennisSettlementExceptionQueuePatch51.ACTIONS.RESOLVED) diagnostics.settlementExceptionActions.resolved++;

            if (!settlementOutcome.updated) {
                if (settlementOutcome.blocked) {
                    diagnostics.contractBlocked++;
                    const contractStatus = String(settlementOutcome.contract?.status || 'PENDING').toUpperCase();
                    const contractReason = String(settlementOutcome.contract?.reason || '').toUpperCase();
                    const reasonKey = settlementOutcome.protectedManualReview ? 'MANUAL_REVIEW_PROTECTED' : `CONTRACT_${contractStatus}`;
                    diagnostics.pendingReasons[reasonKey] = (diagnostics.pendingReasons[reasonKey] || 0) + 1;
                    if (contractStatus === 'PROPOSED') diagnostics.evidenceStatus.proposedWeakEvidence++;
                    else if (contractStatus === 'CONFLICT') diagnostics.evidenceStatus.sourceConflict++;
                    else if (contractStatus === 'REJECTED' || contractReason.includes('INVALID')) diagnostics.evidenceStatus.contractInvalid++;
                    else if (contractStatus === 'MANUAL_REVIEW') diagnostics.evidenceStatus.manualReview++;
                    else diagnostics.evidenceStatus.pendingEvidence++;
                }
                unresolvedCount++;
                diagnostics.unresolvedNoEvaluation++;
                if (updateOutcome === tennisSettlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED || settlementOutcome.lifecycleAtomicFailure || settlementOutcome.error) {
                    diagnostics.dbUpdateFailures++;
                    diagnostics.pendingReasons.DB_UPDATE_FAILED = (diagnostics.pendingReasons.DB_UPDATE_FAILED || 0) + 1;
                }
                continue;
            }

            resolvedCount++;
            diagnostics.settlementUpdated++;
            diagnostics.resolvedThisRun = diagnostics.settlementUpdated;
            if (settlementOutcome.contract.status === settlementContract.SETTLEMENT_STATES.VERIFIED) diagnostics.contractVerified++;
            if (settlementOutcome.contract.status === settlementContract.SETTLEMENT_STATES.VOID) diagnostics.contractVoid++;
            if (toNumber(match.stake, 0) > 0) diagnostics.realStakeRowsResolved++;
            else diagnostics.auditRowsResolved++;

            const status = evaluationToStatus(evaluationResult);

            if (status === 'VOID') {
                voidCount++;
                diagnostics.voidCount++;
            }
            if (status === 'PUSH') {
                pushCount++;
                diagnostics.pushCount++;
            }

            if (status === 'VOID') {
                console.log(
                    `   🛡️ [VOID/RITIRO] ${p1Db}-${p2Db} -> Rimborsata | Pred: ${match.prediction} | Fonte: ${resolution.source}`
                );
            } else if (status === 'PUSH') {
                console.log(
                    `   ↔️ [PUSH] ${p1Db}-${p2Db} -> Rimborso | Pred: ${match.prediction} | Fonte: ${resolution.source}`
                );
            } else {
                console.log(
                    `   ✅ [RISOLTA] ${p1Db}-${p2Db} -> ${status} | Pred: ${match.prediction} | Fonte: ${resolution.source}`
                );
            }
        }
    }

    const pendingAfterRows = getPendingTennisBets(db, leagueFilter);
    diagnostics.pendingAfter = pendingAfterRows.length;
    diagnostics.manualReviewAfter = pendingAfterRows.filter(row => String(row.settlement_contract_status || '').toUpperCase() === 'MANUAL_REVIEW').length;
    diagnostics.weakEvidenceAfter = pendingAfterRows.filter(row => String(row.settlement_contract_status || '').toUpperCase() === 'PROPOSED').length;

    if (pendingBets.length === 0) {
        diagnostics.notes.push('Nessuna bet Tennis PENDING con data_quality CURRENT/CURRENT_BOOTSTRAP esplicita. API scores non chiamata.');
    } else if (resolvedCount === 0) {
        diagnostics.notes.push('Nessuna bet Tennis risolta in questo ciclo: controllare pendingReasons, fonti risultati o API esaurita.');
    }

    console.log(
        `   📊 Riepilogo API: Crediti spesi: ${diagnostics.apiCreditsUsed} · cache hit ${diagnostics.apiCacheHits} · cache miss ${diagnostics.apiCacheMisses} · match unici risolti ${diagnostics.uniqueResolvedBeforeApi + diagnostics.uniqueResolvedAfterApi}`
    );

    if (Array.isArray(diagnostics.step105TargetedKeys) && diagnostics.step105TargetedKeys.length > 0) {
        console.log('   🎯 [STEP105] Target keys=' + diagnostics.step105TargetedKeys.join(',') + ' · used=' + (diagnostics.step105TargetedKeysUsed || []).join(',') + ' · scores=' + diagnostics.step105TargetedScoresLoaded);
    }

    // FASE 9: STATISTICHE E CHIUSURA
    console.log(`⏳ [FASE 9/9] Calcolo statistiche finali sul portafoglio aggiornato...`);
    const history = getHistoryTennisBets(db, leagueFilter, 2000);
    const allResolved = getResolvedTennisBetsForStats(db, leagueFilter);
    const reporting = tennisTradingReportingPatch40.buildDbReporting(db, leagueFilter, { rollingLimit: 200 });
    const stats = { singles: tennisTradingReportingPatch40.legacySingles(reporting.full), multis: { placed: 0, won: 0, lost: 0, push: 0, void: 0, profit: 0, invested: 0, roi: '0.00', hit_rate: '0.00' }, reportingScope: reporting.full.scope, reportingVersion: reporting.version };

    console.log(`✅ [PAPER TRADING TENNIS] Elaborazione Motore Completata con Successo.`);
    console.log(`=========================================================================\n`);

    let informationRetrievalCertification = null;
    diagnostics.settlementExceptionQueue = {
        ...tennisSettlementExceptionQueuePatch51.getSummary(db),
        recoveryPlan: tennisSettlementExceptionQueuePatch51.buildTargetedRecoveryPlan(db),
        notificationEligible: diagnostics.settlementExceptionActions.new + diagnostics.settlementExceptionActions.changed,
        unchangedEvidence: diagnostics.settlementExceptionActions.unchanged,
        lifecycleEventsSuppressed: diagnostics.settlementExceptionActions.unchanged,
        repeatedNotificationsSuppressed: diagnostics.settlementExceptionActions.unchanged
    };

    try {
        informationRetrievalCertification = tennisInformationRetrieval.buildPaperTradingExecutionCertification(diagnostics);
        diagnostics.informationRetrievalCertification = informationRetrievalCertification;
    } catch (retrievalError) {
        diagnostics.informationRetrievalCertification = {
            success: false,
            status: 'FAIL',
            error: retrievalError.message,
            resultCertification: 'PATCH5_SETTLEMENT_CONTRACT_REQUIRED'
        };
    }

    const finalResult = {
        resolvedCount,
        skippedNotReady,
        unresolvedCount,
        voidCount,
        pushCount,
        operationId,
        diagnostics,
        informationRetrievalCertification,
        stats,
        reporting: { ...reporting, rows: undefined },
        history,
        meta: {
            engineVersion: TENNIS_PAPER_ENGINE_VERSION,
            modelVersion: TENNIS_MODEL_VERSION,
            metricVersion: TENNIS_METRIC_VERSION,
            dataMode: tennisTradingReportingPatch40.DATA_MODE,
            reportingScope: tennisTradingReportingPatch40.FULL_SCOPE,
            rollingScope: tennisTradingReportingPatch40.ROLLING_SCOPE,
            settlementMode: STEP58_SETTLEMENT_GUARD_MODE,
            settlementContractVersion: settlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
            operationId,
            note: 'Statistiche calcolate solo sul nuovo storico pulito/current. Settlement automatico consentito solo con evidenza Patch 5 verificata.'
        }
    };
    runtimeOp.complete({ success: true, resolvedCount, unresolvedCount, contractBlocked: diagnostics.contractBlocked, evidenceStatus: diagnostics.evidenceStatus, message: 'Pipeline settlement Tennis completata.' });
    return finalResult;
    } catch (error) {
        error.runtimeOperationId = error.runtimeOperationId || operationId;
        runtimeOp.error('PIPELINE_CRASH', error, { leagueFilter });
        throw error;
    }
}

// ============================================================================
// STEP91Y_SETTLEMENT_RULES_AUDIT
// Regole preservate: settlement idempotente, cache/vault/web prima API, budget API Step64,
// scope ricalcolato a settlement, profit standard win/loss/void, Tennis clean/current only.
// ============================================================================

// ============================================================================
// 20. EXPORTS
// ============================================================================

module.exports = {
    processTennisPaperTrading,
    getHistoryTennisBets,
    getPendingTennisBets,

    // Helpers esportati per test unitari
    isSamePlayer,
    getLastName,
    parseSetScores,
    calculateGamesFromScore,
    inferWinnerFromScore,
    evaluateTennisBet,
    extractTotalsLine,
    isTennisMatchReady,
    isRetirementOrVoidText,
    calculateStats,
    normalizeStep106SqliteBindValue,
    STEP106_TENNIS_SETTLEMENT_SQLITE_BIND_REPAIR,
    STEP107_TENNIS_SIDE_IDENTITY_CERTIFIED_RESULTS_REPAIR,
    STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR,
    STEP107_CERTIFIED_TENNIS_RESULTS,
    step107FindCertifiedResult,
    step107BuildCertifiedResolution,
    isCurrentCleanRow,
    isTennisBetRow,
    getMatchExposureKey,
    groupPendingTennisBetsByMatch,
    resolveTennisMatchResult,
    resolveOfficialTennisSettlement: tennisOfficialSettlementResolver.resolveOfficialSettlement,
    officialSettlementHealth: tennisOfficialSettlementResolver.health,
    buildOutcomeSearchPlanAudit13: audit13OutcomeSearch.buildSearchPlan,
    audit13OfficialProviderMetadata: tennisOfficialSettlementResolver.getOfficialProviderMetadata,
    audit15StructuredTennisResolver: audit15SourceFusion.resolveTennisStructured,
    fetchOddsApiTennisScores,
    resolveFromApiScores,
    updateBetSettlement,
    updatePendingSettlementReason,
    evaluateTennisSettlementContract: settlementContract.evaluateTennisSettlementContract,
    TENNIS_SETTLEMENT_CONTRACT_VERSION: settlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
    classifyTennisTradingScope: tennisScope.classifyTennisTradingScope,
    buildTennisPortfolioAuditBreakdown: tennisScope.buildTennisPortfolioAuditBreakdown,

    // Metadata
    TENNIS_PAPER_ENGINE_VERSION,
    TENNIS_MODEL_VERSION,
    TENNIS_METRIC_VERSION,
    TENNIS_PATCH29_R2_SETTLEMENT_UPDATE_AUDIT_TRUTH: tennisSettlementUpdateAudit.VERSION,
    TENNIS_PATCH51_SETTLEMENT_EXCEPTION_QUEUE: tennisSettlementExceptionQueuePatch51.VERSION
};