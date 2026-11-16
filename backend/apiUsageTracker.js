// ============================================================================
// STEP51_API_USAGE_CREDITS_COUNTER
// Contatore locale crediti The Odds API: nessuna chiave viene mai esposta al frontend.
// Crediti mensili stimati = numero chiavi disponibili * 500, reset automatico al cambio mese.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const oddsApiUsageLedger = require('./oddsApiUsageLedger');

const DEFAULT_PROVIDER = 'the_odds_api';
const DEFAULT_MONTHLY_CREDITS_PER_KEY = Number(process.env.ODDS_API_MONTHLY_CREDITS_PER_KEY || 500);
const DEFAULT_STATE_FILE = process.env.API_USAGE_TRACKER_FILE || path.resolve(__dirname, 'api_usage_monthly.json');
const DEFAULT_CACHE_FILE = process.env.API_USAGE_CACHE_FILE || path.resolve(__dirname, 'api_usage_cache.json');

// STEP53_API_EFFICIENCY_CACHE
// Cache locale prudenziale per evitare doppie chiamate The Odds API su dati già freschi.
// Non modifica il modello di pronostico: evita solo fetch duplicati entro TTL brevi.
const API_CACHE_TTL_MS = Object.freeze({
    sports_catalog: 6 * 60 * 60 * 1000,
    tennis_live_odds: 120 * 1000,
    calcio_live_odds: 120 * 1000,
    live_odds: 120 * 1000,
    scores_settlement: 30 * 60 * 1000,
    odds_api_request: 120 * 1000
});

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = safeNumber(value, 0);
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function monthKeyFromDate(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function nextResetDateFromMonthKey(monthKey) {
    const [yearRaw, monthRaw] = String(monthKey || monthKeyFromDate()).split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    const next = new Date(year, month, 1, 0, 0, 0, 0);
    return next.toISOString();
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2));
        return true;
    } catch (error) {
        console.warn('[STEP51] Impossibile salvare api usage:', error.message);
        return false;
    }
}

function hashCacheKey(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeUrlTemplateForCache(urlTemplate = '') {
    return String(urlTemplate || '')
        .replace(/apiKey=([^&]+)/i, 'apiKey=API_KEY_PLACEHOLDER')
        .replace(/api_key=([^&]+)/i, 'api_key=API_KEY_PLACEHOLDER')
        .replace(/[?&]t=\d+/i, '')
        .trim();
}

function getCacheTtlMsForOperation(operation = 'odds_api_request', overrideTtlMs = null) {
    if (overrideTtlMs !== null && overrideTtlMs !== undefined) {
        const override = Number(overrideTtlMs);
        if (Number.isFinite(override) && override >= 0) return override;
    }
    const op = String(operation || 'odds_api_request');
    return API_CACHE_TTL_MS[op] ?? API_CACHE_TTL_MS.odds_api_request;
}

function readCacheFile(cacheFile) {
    const cache = readJson(cacheFile, null);
    if (!cache || typeof cache !== 'object') {
        return { version: 'STEP53_API_EFFICIENCY_CACHE', entries: {} };
    }
    if (!cache.entries || typeof cache.entries !== 'object') cache.entries = {};
    cache.version = 'STEP53_API_EFFICIENCY_CACHE';
    return cache;
}

function writeCacheFile(cacheFile, cache) {
    cache.version = 'STEP53_API_EFFICIENCY_CACHE';
    return writeJson(cacheFile, cache);
}

function createEmptyState(monthKey, previous = {}) {
    return {
        version: 'STEP51_API_USAGE_CREDITS_COUNTER',
        provider: DEFAULT_PROVIDER,
        monthKey,
        monthlyCreditsPerKey: safeNumber(previous.monthlyCreditsPerKey, DEFAULT_MONTHLY_CREDITS_PER_KEY),
        keyInventory: previous.keyInventory && typeof previous.keyInventory === 'object'
            ? previous.keyInventory
            : { sources: {}, effectiveKeyCount: 0 },
        creditsUsed: 0,
        requestAttempts: 0,
        bySource: {},
        byOperation: {},
        lastCall: null,
        cacheStats: {
            mode: 'STEP53_API_EFFICIENCY_CACHE',
            enabled: true,
            hits: 0,
            misses: 0,
            writes: 0,
            bypasses: 0,
            byOperation: {},
            lastCacheEvent: null
        },
        resetAt: new Date().toISOString()
    };
}

function createApiUsageTracker({ stateFile = DEFAULT_STATE_FILE, cacheFile = DEFAULT_CACHE_FILE, nowFn = () => new Date() } = {}) {
    function ensureState() {
        const currentMonth = monthKeyFromDate(nowFn());
        const raw = readJson(stateFile, null);
        if (!raw || raw.monthKey !== currentMonth) {
            const reset = createEmptyState(currentMonth, raw || {});
            writeJson(stateFile, reset);
            return reset;
        }
        if (!raw.keyInventory || typeof raw.keyInventory !== 'object') raw.keyInventory = { sources: {}, effectiveKeyCount: 0 };
        if (!raw.keyInventory.sources) raw.keyInventory.sources = {};
        raw.monthlyCreditsPerKey = safeNumber(raw.monthlyCreditsPerKey, DEFAULT_MONTHLY_CREDITS_PER_KEY);
        if (!raw.cacheStats || typeof raw.cacheStats !== 'object') {
            raw.cacheStats = { mode: 'STEP53_API_EFFICIENCY_CACHE', enabled: true, hits: 0, misses: 0, writes: 0, bypasses: 0, byOperation: {}, lastCacheEvent: null };
        }
        if (!raw.cacheStats.byOperation || typeof raw.cacheStats.byOperation !== 'object') raw.cacheStats.byOperation = {};
        raw.cacheStats.mode = 'STEP53_API_EFFICIENCY_CACHE';
        raw.cacheStats.enabled = true;
        return raw;
    }

    function persist(state) {
        state.version = 'STEP51_API_USAGE_CREDITS_COUNTER';
        writeJson(stateFile, state);
        return state;
    }

    function computeEffectiveKeyCount(state) {
        const sources = state?.keyInventory?.sources || {};
        const counts = Object.values(sources)
            .map(row => safeNumber(row?.keyCount, 0))
            .filter(n => n > 0);
        const maxFromSources = counts.length ? Math.max(...counts) : 0;
        return Math.max(safeNumber(state?.keyInventory?.effectiveKeyCount, 0), maxFromSources);
    }

    function registerApiKeyInventory({ source = 'unknown', keyCount = 0, monthlyCreditsPerKey = DEFAULT_MONTHLY_CREDITS_PER_KEY } = {}) {
        const state = ensureState();
        const count = Math.max(0, Math.trunc(safeNumber(keyCount, 0)));
        const src = String(source || 'unknown');
        state.monthlyCreditsPerKey = safeNumber(monthlyCreditsPerKey, DEFAULT_MONTHLY_CREDITS_PER_KEY);
        state.keyInventory.sources[src] = {
            source: src,
            keyCount: count,
            updatedAt: new Date().toISOString()
        };
        state.keyInventory.effectiveKeyCount = computeEffectiveKeyCount(state);
        persist(state);
        return getApiUsageSummary();
    }

    function recordOddsApiUsage({
        source = 'unknown',
        operation = 'odds_api_request',
        route = 'fetchOddsApi',
        provider = DEFAULT_PROVIDER,
        credits = 1,
        keyCount = null
    } = {}) {
        const state = ensureState();
        if (keyCount !== null && keyCount !== undefined) {
            const count = Math.max(0, Math.trunc(safeNumber(keyCount, 0)));
            state.keyInventory.sources[String(source || 'unknown')] = {
                source: String(source || 'unknown'),
                keyCount: count,
                updatedAt: new Date().toISOString()
            };
        }
        state.keyInventory.effectiveKeyCount = computeEffectiveKeyCount(state);

        const cost = Math.max(0, safeNumber(credits, 1));
        const op = String(operation || 'odds_api_request');
        const src = String(source || 'unknown');
        const now = new Date().toISOString();

        state.creditsUsed = round(safeNumber(state.creditsUsed, 0) + cost, 4);
        state.requestAttempts = Math.trunc(safeNumber(state.requestAttempts, 0) + 1);

        if (!state.bySource[src]) state.bySource[src] = { requests: 0, creditsUsed: 0 };
        state.bySource[src].requests += 1;
        state.bySource[src].creditsUsed = round(safeNumber(state.bySource[src].creditsUsed, 0) + cost, 4);

        if (!state.byOperation[op]) state.byOperation[op] = { requests: 0, creditsUsed: 0 };
        state.byOperation[op].requests += 1;
        state.byOperation[op].creditsUsed = round(safeNumber(state.byOperation[op].creditsUsed, 0) + cost, 4);

        state.lastCall = {
            provider,
            source: src,
            operation: op,
            route: String(route || 'fetchOddsApi'),
            credits: cost,
            at: now
        };

        persist(state);
        return getApiUsageSummary();
    }

    function recordApiCacheEvent({ operation = 'odds_api_request', source = 'unknown', route = 'fetchOddsApi', hit = false, bypass = false, write = false, cacheKey = null, ttlMs = null } = {}) {
        const state = ensureState();
        const op = String(operation || 'odds_api_request');
        if (!state.cacheStats || typeof state.cacheStats !== 'object') {
            state.cacheStats = { mode: 'STEP53_API_EFFICIENCY_CACHE', enabled: true, hits: 0, misses: 0, writes: 0, bypasses: 0, byOperation: {}, lastCacheEvent: null };
        }
        if (!state.cacheStats.byOperation[op]) {
            state.cacheStats.byOperation[op] = { hits: 0, misses: 0, writes: 0, bypasses: 0 };
        }
        if (write) {
            state.cacheStats.writes = Math.trunc(safeNumber(state.cacheStats.writes, 0) + 1);
            state.cacheStats.byOperation[op].writes += 1;
        } else if (bypass) {
            state.cacheStats.bypasses = Math.trunc(safeNumber(state.cacheStats.bypasses, 0) + 1);
            state.cacheStats.byOperation[op].bypasses += 1;
        } else if (hit) {
            state.cacheStats.hits = Math.trunc(safeNumber(state.cacheStats.hits, 0) + 1);
            state.cacheStats.byOperation[op].hits += 1;
        } else {
            state.cacheStats.misses = Math.trunc(safeNumber(state.cacheStats.misses, 0) + 1);
            state.cacheStats.byOperation[op].misses += 1;
        }
        state.cacheStats.lastCacheEvent = {
            operation: op,
            source: String(source || 'unknown'),
            route: String(route || 'fetchOddsApi'),
            hit: Boolean(hit),
            bypass: Boolean(bypass),
            write: Boolean(write),
            cacheKey,
            ttlMs,
            at: new Date().toISOString()
        };
        persist(state);
        return state.cacheStats.lastCacheEvent;
    }

    function getCachedOddsApiResponse(urlTemplate, { source = 'unknown', route = 'fetchOddsApi', forceRefresh = false, ttlMs = null } = {}) {
        const operation = classifyOddsApiOperation(urlTemplate);
        const ttl = getCacheTtlMsForOperation(operation, ttlMs);
        const cacheKey = hashCacheKey(normalizeUrlTemplateForCache(urlTemplate));

        if (forceRefresh || ttl <= 0) {
            recordApiCacheEvent({ operation, source, route, bypass: true, cacheKey, ttlMs: ttl });
            return { hit: false, bypass: true, cacheKey, operation, ttlMs: ttl, reason: forceRefresh ? 'FORCE_REFRESH' : 'CACHE_DISABLED' };
        }

        const cache = readCacheFile(cacheFile);
        const now = nowFn().getTime();
        const entry = cache.entries[cacheKey];

        if (entry && Number(entry.expiresAtMs) > now) {
            recordApiCacheEvent({ operation, source, route, hit: true, cacheKey, ttlMs: ttl });
            return {
                hit: true,
                cacheKey,
                operation,
                ttlMs: ttl,
                cachedAt: entry.cachedAt,
                expiresAt: entry.expiresAt,
                ageMs: Math.max(0, now - Number(entry.cachedAtMs || now)),
                data: entry.data
            };
        }

        if (entry) {
            delete cache.entries[cacheKey];
            writeCacheFile(cacheFile, cache);
        }
        recordApiCacheEvent({ operation, source, route, hit: false, cacheKey, ttlMs: ttl });
        return { hit: false, cacheKey, operation, ttlMs: ttl, reason: entry ? 'EXPIRED' : 'MISS' };
    }

    function setCachedOddsApiResponse(urlTemplate, data, { source = 'unknown', route = 'fetchOddsApi', ttlMs = null } = {}) {
        const operation = classifyOddsApiOperation(urlTemplate);
        const ttl = getCacheTtlMsForOperation(operation, ttlMs);
        const cacheKey = hashCacheKey(normalizeUrlTemplateForCache(urlTemplate));

        if (ttl <= 0) {
            recordApiCacheEvent({ operation, source, route, bypass: true, cacheKey, ttlMs: ttl });
            return { stored: false, cacheKey, operation, ttlMs: ttl, reason: 'CACHE_DISABLED' };
        }

        const nowDate = nowFn();
        const nowMs = nowDate.getTime();
        const expires = new Date(nowMs + ttl);
        const cache = readCacheFile(cacheFile);
        cache.entries[cacheKey] = {
            operation,
            cacheKey,
            cachedAt: nowDate.toISOString(),
            cachedAtMs: nowMs,
            expiresAt: expires.toISOString(),
            expiresAtMs: expires.getTime(),
            source: String(source || 'unknown'),
            route: String(route || 'fetchOddsApi'),
            data
        };
        writeCacheFile(cacheFile, cache);
        recordApiCacheEvent({ operation, source, route, write: true, cacheKey, ttlMs: ttl });
        return { stored: true, cacheKey, operation, ttlMs: ttl, expiresAt: expires.toISOString() };
    }

    function getApiUsageSummary() {
        const state = ensureState();
        const effectiveKeyCount = computeEffectiveKeyCount(state);
        const monthlyCreditsPerKey = safeNumber(state.monthlyCreditsPerKey, DEFAULT_MONTHLY_CREDITS_PER_KEY);
        const monthlyCreditTotal = effectiveKeyCount * monthlyCreditsPerKey;
        const creditsUsed = safeNumber(state.creditsUsed, 0);
        const creditsRemaining = Math.max(0, monthlyCreditTotal - creditsUsed);
        const usagePct = monthlyCreditTotal > 0 ? (creditsUsed / monthlyCreditTotal) * 100 : 0;
        const remainingPct = monthlyCreditTotal > 0 ? (creditsRemaining / monthlyCreditTotal) * 100 : 0;
        const status = remainingPct <= 15 ? 'CRITICAL' : (remainingPct <= 40 ? 'WARN' : 'OK');
        const cacheStats = state.cacheStats || { hits: 0, misses: 0, writes: 0, bypasses: 0, byOperation: {} };
        const cacheHits = Math.trunc(safeNumber(cacheStats.hits, 0));
        const cacheMisses = Math.trunc(safeNumber(cacheStats.misses, 0));
        const cacheTotal = cacheHits + cacheMisses;
        const cacheHitRatePct = cacheTotal > 0 ? (cacheHits / cacheTotal) * 100 : 0;

        return {
            success: true,
            mode: 'STEP51_API_USAGE_CREDITS_COUNTER',
            provider: state.provider || DEFAULT_PROVIDER,
            monthKey: state.monthKey,
            resetNextAt: nextResetDateFromMonthKey(state.monthKey),
            keyCount: effectiveKeyCount,
            monthlyCreditsPerKey,
            monthlyCreditTotal,
            creditsUsed: round(creditsUsed, 4),
            creditsRemaining: round(creditsRemaining, 4),
            usagePct: round(usagePct, 2),
            remainingPct: round(remainingPct, 2),
            requestAttempts: Math.trunc(safeNumber(state.requestAttempts, 0)),
            bySource: state.bySource || {},
            byOperation: state.byOperation || {},
            lastCall: state.lastCall || null,
            keyInventory: {
                sources: state.keyInventory?.sources || {},
                effectiveKeyCount
            },
            cache: {
                mode: 'STEP53_API_EFFICIENCY_CACHE',
                enabled: true,
                ttlPolicyMs: API_CACHE_TTL_MS,
                hits: cacheHits,
                misses: cacheMisses,
                writes: Math.trunc(safeNumber(cacheStats.writes, 0)),
                bypasses: Math.trunc(safeNumber(cacheStats.bypasses, 0)),
                hitRatePct: round(cacheHitRatePct, 2),
                byOperation: cacheStats.byOperation || {},
                lastCacheEvent: cacheStats.lastCacheEvent || null
            },
            status,
            privacy: 'API keys are never returned by this endpoint.'
        };
    }

    function resetCurrentMonthForTestsOnly() {
        const state = createEmptyState(monthKeyFromDate(nowFn()), ensureState());
        persist(state);
        writeCacheFile(cacheFile, { version: 'STEP53_API_EFFICIENCY_CACHE', entries: {} });
        return getApiUsageSummary();
    }

    return {
        registerApiKeyInventory,
        recordOddsApiUsage,
        getCachedOddsApiResponse,
        setCachedOddsApiResponse,
        getApiUsageSummary,
        resetCurrentMonthForTestsOnly,
        _stateFile: stateFile
    };
}

function classifyOddsApiOperation(urlTemplate = '') {
    const url = String(urlTemplate || '').toLowerCase();
    if (url.includes('/scores/')) return 'scores_settlement';
    if (url.includes('/sports/') && url.includes('/odds/')) {
        if (url.includes('tennis')) return 'tennis_live_odds';
        if (url.includes('soccer') || url.includes('football')) return 'calcio_live_odds';
        return 'live_odds';
    }
    if (url.includes('/sports/?') || url.endsWith('/sports')) return 'sports_catalog';
    return 'odds_api_request';
}

const defaultTracker = createApiUsageTracker();

module.exports = {
    STEP51_API_USAGE_CREDITS_COUNTER: true,
    createApiUsageTracker,
    classifyOddsApiOperation,
    getCacheTtlMsForOperation,
    normalizeUrlTemplateForCache,
    API_CACHE_TTL_MS,
    registerApiKeyInventory: defaultTracker.registerApiKeyInventory,
    recordOddsApiUsage: defaultTracker.recordOddsApiUsage,
    getCachedOddsApiResponse: defaultTracker.getCachedOddsApiResponse,
    setCachedOddsApiResponse: defaultTracker.setCachedOddsApiResponse,
    getApiUsageSummary: () => oddsApiUsageLedger.reconcileSummary(defaultTracker.getApiUsageSummary()),
    recordOddsApiNetworkAttempt: oddsApiUsageLedger.recordAttempt,
    recordOddsApiResponse: oddsApiUsageLedger.recordResponse,
    recordOddsApiFailure: oddsApiUsageLedger.recordFailure,
    estimateOddsApiCost: oddsApiUsageLedger.estimateCost,
    ODDS_API_LEDGER_VERSION: oddsApiUsageLedger.ODDS_API_LEDGER_VERSION,
    resetCurrentMonthForTestsOnly: defaultTracker.resetCurrentMonthForTestsOnly,
    DEFAULT_MONTHLY_CREDITS_PER_KEY
};
