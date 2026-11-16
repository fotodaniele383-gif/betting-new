'use strict';

const crypto = require('crypto');

const CALCIO_REQUEST_IDENTITY_VERSION = 'CALCIO_PATCH_2_REQUEST_IDENTITY_V1';
const DEFAULT_CACHE_MAX_ENTRIES = 64;

const RELEVANT_SETTING_KEYS = Object.freeze([
    'useCrossReference',
    'onlyGlobal',
    'useAdvancedMetrics',
    'eloK',
    'baseEdge',
    'baseProb',
    'u25Edge',
    'u25Prob',
    'home1Edge',
    'home1Prob',
    'x2Edge',
    'x2Prob',
    'useHistoricalOpt',
    'leagueParams',
    'paperTradingParams'
]);

function normalizeFiniteNumber(value, fallback = null, decimals = 4) {
    if (value === undefined || value === null || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const factor = 10 ** decimals;
    return Math.round(numeric * factor) / factor;
}

function normalizeLeague(value) {
    const league = String(value || 'all').trim().toLowerCase();
    return league || 'all';
}

function normalizePlainValue(value) {
    if (Array.isArray(value)) return value.map(normalizePlainValue);
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                const normalized = normalizePlainValue(value[key]);
                if (normalized !== undefined) acc[key] = normalized;
                return acc;
            }, {});
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || typeof value === 'string' || value === null) return value;
    if (value === undefined) return undefined;
    return String(value);
}

function stableStringify(value) {
    return JSON.stringify(normalizePlainValue(value));
}

function selectRelevantCalcioSettings(settings = {}) {
    return RELEVANT_SETTING_KEYS.reduce((acc, key) => {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
            acc[key] = normalizePlainValue(settings[key]);
        }
        return acc;
    }, {});
}

function buildCalcioAnalysisRequestIdentity(options = {}) {
    const league = normalizeLeague(options.league);
    const availableLeagues = Array.isArray(options.availableLeagues)
        ? [...new Set(options.availableLeagues.map(normalizeLeague))].sort()
        : [];
    const resolvedLeagues = league === 'all' ? availableLeagues : [league];

    const payload = {
        schemaVersion: CALCIO_REQUEST_IDENTITY_VERSION,
        route: String(options.route || '/api/analyze'),
        league,
        resolvedLeagues,
        bankroll: normalizeFiniteNumber(options.bankroll, 1000, 2),
        targetOdds: normalizeFiniteNumber(options.targetOdds, null, 4),
        settings: selectRelevantCalcioSettings(options.settings || {}),
        versions: normalizePlainValue(options.versions || {}),
        oddsQueryProfile: normalizePlainValue(options.oddsQueryProfile || {
            regions: ['eu'],
            markets: ['h2h', 'totals']
        })
    };

    const canonical = stableStringify(payload);
    const digest = crypto.createHash('sha256').update(canonical).digest('hex');

    return {
        version: CALCIO_REQUEST_IDENTITY_VERSION,
        cacheKey: `calcio:analysis:${digest}`,
        digest,
        digestPrefix: digest.slice(0, 16),
        payload,
        canonical
    };
}

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function pruneCalcioAnalysisCache(cache = {}, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const ttlMs = Math.max(1, Number(options.ttlMs) || 1);
    const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_CACHE_MAX_ENTRIES);
    const entries = Object.entries(cache);

    for (const [key, entry] of entries) {
        const timestamp = Number(entry?.timestamp);
        if (!Number.isFinite(timestamp) || now - timestamp >= ttlMs) delete cache[key];
    }

    const survivors = Object.entries(cache)
        .sort((a, b) => Number(b[1]?.timestamp || 0) - Number(a[1]?.timestamp || 0));

    for (const [key] of survivors.slice(maxEntries)) delete cache[key];

    return {
        size: Object.keys(cache).length,
        maxEntries,
        ttlMs
    };
}

function getCalcioAnalysisCache(cache = {}, identity, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const ttlMs = Math.max(1, Number(options.ttlMs) || 1);
    const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_CACHE_MAX_ENTRIES);

    pruneCalcioAnalysisCache(cache, { now, ttlMs, maxEntries });
    const entry = identity?.cacheKey ? cache[identity.cacheKey] : null;

    if (!entry) {
        return {
            hit: false,
            ageMs: null,
            data: null,
            size: Object.keys(cache).length
        };
    }

    const ageMs = Math.max(0, now - Number(entry.timestamp));
    return {
        hit: true,
        ageMs,
        data: cloneJson(entry.data),
        storedAt: new Date(Number(entry.timestamp)).toISOString(),
        size: Object.keys(cache).length
    };
}

function setCalcioAnalysisCache(cache = {}, identity, data, options = {}) {
    if (!identity?.cacheKey) throw new Error('Calcio request identity missing cacheKey');
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const ttlMs = Math.max(1, Number(options.ttlMs) || 1);
    const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_CACHE_MAX_ENTRIES);

    cache[identity.cacheKey] = {
        timestamp: now,
        identityDigest: identity.digest,
        data: cloneJson(data)
    };
    pruneCalcioAnalysisCache(cache, { now, ttlMs, maxEntries });

    return {
        stored: true,
        size: Object.keys(cache).length,
        timestamp: now
    };
}

function attachCalcioCacheMetadata(payload = {}, identity, cacheInfo = {}) {
    const result = cloneJson(payload) || {};
    const metadata = {
        version: CALCIO_REQUEST_IDENTITY_VERSION,
        hit: cacheInfo.hit === true,
        ageMs: cacheInfo.hit === true ? Math.max(0, Number(cacheInfo.ageMs) || 0) : 0,
        ttlMs: Math.max(1, Number(cacheInfo.ttlMs) || 1),
        keyDigest: identity?.digestPrefix || null,
        cacheSize: Math.max(0, Number(cacheInfo.size) || 0)
    };

    result.meta = { ...(result.meta || {}), calcioAnalysisCache: metadata };
    result.calcioAnalysisCache = metadata;
    if (result.diagnostics && typeof result.diagnostics === 'object') {
        result.diagnostics.requestIdentity = {
            version: CALCIO_REQUEST_IDENTITY_VERSION,
            digest: identity?.digestPrefix || null,
            league: identity?.payload?.league || null,
            resolvedLeagues: identity?.payload?.resolvedLeagues || [],
            cacheHit: metadata.hit
        };
    }

    return result;
}

module.exports = {
    CALCIO_REQUEST_IDENTITY_VERSION,
    DEFAULT_CACHE_MAX_ENTRIES,
    RELEVANT_SETTING_KEYS,
    normalizeFiniteNumber,
    normalizeLeague,
    normalizePlainValue,
    stableStringify,
    selectRelevantCalcioSettings,
    buildCalcioAnalysisRequestIdentity,
    pruneCalcioAnalysisCache,
    getCalcioAnalysisCache,
    setCalcioAnalysisCache,
    attachCalcioCacheMetadata
};
