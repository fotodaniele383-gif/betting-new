'use strict';

const crypto = require('crypto');

const DEEPSCAN_RUNTIME_RESILIENCE_VERSION = 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE_V1';

const DEFAULTS = Object.freeze({
    maxConcurrent: 2,
    deepScanTimeoutMs: 18000,
    providerTimeoutMs: 5000,
    providerFailureThreshold: 3,
    providerCooldownMs: 5 * 60 * 1000,
    newsCacheTtlMs: 3 * 60 * 60 * 1000
});

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeToken(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function buildEventKey(input = {}) {
    const explicit = input.eventKey || input.event_key || input.matchExposureKey || input.match_exposure_key;
    if (explicit) return String(explicit);
    const date = input.matchDate || input.match_date || input.date || input.kickoff || 'unknown-date';
    const parts = [
        input.sport || input.sportType || 'CALCIO',
        input.league || input.competition || '',
        input.homeTeam || input.home_team || input.home || '',
        input.awayTeam || input.away_team || input.away || '',
        date,
        input.prediction || input.market || ''
    ].map(normalizeToken).filter(Boolean);
    return `derived:${parts.join(':')}`;
}

class ConcurrencyQueue {
    constructor(maxConcurrent = DEFAULTS.maxConcurrent) {
        this.maxConcurrent = Math.max(1, Math.floor(finite(maxConcurrent, DEFAULTS.maxConcurrent)));
        this.active = 0;
        this.pending = [];
        this.maxObserved = 0;
    }

    add(task) {
        if (typeof task !== 'function') return Promise.reject(new TypeError('QUEUE_TASK_REQUIRED'));
        return new Promise((resolve, reject) => {
            this.pending.push({ task, resolve, reject });
            this.#drain();
        });
    }

    #drain() {
        while (this.active < this.maxConcurrent && this.pending.length) {
            const entry = this.pending.shift();
            this.active += 1;
            this.maxObserved = Math.max(this.maxObserved, this.active);
            Promise.resolve()
                .then(entry.task)
                .then(entry.resolve, entry.reject)
                .finally(() => {
                    this.active -= 1;
                    this.#drain();
                });
        }
    }

    snapshot() {
        return {
            maxConcurrent: this.maxConcurrent,
            active: this.active,
            queued: this.pending.length,
            maxObserved: this.maxObserved
        };
    }
}

function createTimeoutError(code, timeoutMs, details = {}) {
    const error = new Error(`${code}:${timeoutMs}`);
    error.code = code;
    error.timeoutMs = timeoutMs;
    Object.assign(error, details);
    return error;
}

function withTimeout(promise, timeoutMs, code = 'RUNTIME_TIMEOUT', details = {}) {
    const ms = Math.max(1, finite(timeoutMs, 1));
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(code, ms, details)), ms);
        timer.unref?.();
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

const deepScanQueue = new ConcurrencyQueue(DEFAULTS.maxConcurrent);
const deepScanInFlight = new Map();
const providerCircuits = new Map();
const newsCache = new Map();
const newsInFlight = new Map();

function defaultPartialResult(context = {}, error = null) {
    return {
        success: true,
        partial: true,
        status: 'DEEPSCAN_PARZIALE',
        action: 'RISCHIO MODELLO',
        displayAction: 'RISCHIO MODELLO',
        qualityFinalLabel: 'WATCHLIST MICRO',
        suggestionText: 'DeepScan parziale: uno o più provider non hanno completato entro il tempo massimo. Nessuno stake operativo viene promosso; riprovare più vicino al kickoff.',
        eventKey: context.eventKey || null,
        homeTeam: context.homeTeam || null,
        awayTeam: context.awayTeam || null,
        prediction: context.prediction || null,
        timeout: true,
        timeoutMs: error?.timeoutMs || context.timeoutMs || DEFAULTS.deepScanTimeoutMs,
        runtimeCode: error?.code || 'DEEPSCAN_TIMEOUT',
        runtimeVersion: DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
        providerDiagnostics: context.providerDiagnostics || [],
        persistence: { attempted: false, persisted: false, idempotent: true, reason: 'PARTIAL_RESPONSE_NO_DB_MUTATION' }
    };
}

function runDeepScan(options = {}) {
    const task = options.task;
    if (typeof task !== 'function') return Promise.reject(new TypeError('DEEPSCAN_TASK_REQUIRED'));
    const eventKey = buildEventKey(options);
    const timeoutMs = Math.max(1, finite(options.timeoutMs, DEFAULTS.deepScanTimeoutMs));
    const existing = deepScanInFlight.get(eventKey);
    if (existing) {
        existing.deduplicatedRequests += 1;
        return existing.responsePromise;
    }

    const startedAt = Date.now();
    const entry = { eventKey, startedAt, deduplicatedRequests: 0, responsePromise: null, taskPromise: null };
    const taskPromise = deepScanQueue.add(async () => {
        const result = await task();
        return {
            ...result,
            runtime: {
                ...(result?.runtime || {}),
                version: DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
                eventKey,
                queue: deepScanQueue.snapshot(),
                durationMs: Date.now() - startedAt,
                deduplicatedRequests: entry.deduplicatedRequests,
                partial: false
            }
        };
    });
    entry.taskPromise = taskPromise;

    const timeoutPromise = new Promise(resolve => {
        const timer = setTimeout(() => {
            const error = createTimeoutError('DEEPSCAN_TIMEOUT', timeoutMs, { eventKey });
            const factory = typeof options.partialFactory === 'function' ? options.partialFactory : defaultPartialResult;
            resolve(factory({ ...options, eventKey, timeoutMs }, error));
        }, timeoutMs);
        timer.unref?.();
        taskPromise.finally(() => clearTimeout(timer)).catch(() => {});
    });

    const responsePromise = Promise.race([
        taskPromise,
        timeoutPromise
    ]).catch(error => {
        if (error?.code === 'DEEPSCAN_TIMEOUT') {
            const factory = typeof options.partialFactory === 'function' ? options.partialFactory : defaultPartialResult;
            return factory({ ...options, eventKey, timeoutMs }, error);
        }
        throw error;
    });

    entry.responsePromise = responsePromise;
    deepScanInFlight.set(eventKey, entry);
    taskPromise.catch(() => {}).finally(() => {
        if (deepScanInFlight.get(eventKey) === entry) deepScanInFlight.delete(eventKey);
    });
    return responsePromise;
}

function getCircuit(providerId) {
    const key = String(providerId || 'UNKNOWN_PROVIDER');
    if (!providerCircuits.has(key)) {
        providerCircuits.set(key, {
            providerId: key,
            failures: 0,
            successes: 0,
            openUntil: 0,
            lastError: null,
            lastStatus: 'CLOSED',
            lastDurationMs: null
        });
    }
    return providerCircuits.get(key);
}

async function runProvider(providerId, task, options = {}) {
    if (typeof task !== 'function') throw new TypeError('PROVIDER_TASK_REQUIRED');
    const circuit = getCircuit(providerId);
    const now = Date.now();
    const failureThreshold = Math.max(1, Math.floor(finite(options.failureThreshold, DEFAULTS.providerFailureThreshold)));
    const cooldownMs = Math.max(1000, finite(options.cooldownMs, DEFAULTS.providerCooldownMs));
    const timeoutMs = Math.max(1, finite(options.timeoutMs, DEFAULTS.providerTimeoutMs));

    if (circuit.openUntil > now) {
        circuit.lastStatus = 'OPEN';
        const error = new Error(`PROVIDER_CIRCUIT_OPEN:${providerId}`);
        error.code = 'PROVIDER_CIRCUIT_OPEN';
        error.providerId = providerId;
        error.retryAfterMs = circuit.openUntil - now;
        throw error;
    }

    const startedAt = Date.now();
    circuit.lastStatus = circuit.failures > 0 ? 'HALF_OPEN' : 'CLOSED';
    try {
        const result = await withTimeout(
            Promise.resolve().then(task),
            timeoutMs,
            'PROVIDER_TIMEOUT',
            { providerId }
        );
        circuit.successes += 1;
        circuit.failures = 0;
        circuit.openUntil = 0;
        circuit.lastError = null;
        circuit.lastStatus = 'CLOSED';
        circuit.lastDurationMs = Date.now() - startedAt;
        return result;
    } catch (error) {
        circuit.failures += 1;
        circuit.lastError = error?.message || String(error);
        circuit.lastDurationMs = Date.now() - startedAt;
        if (circuit.failures >= failureThreshold) {
            circuit.openUntil = Date.now() + cooldownMs;
            circuit.lastStatus = 'OPEN';
        } else {
            circuit.lastStatus = 'CLOSED_WITH_FAILURES';
        }
        if (!error.code) error.code = 'PROVIDER_FAILURE';
        error.providerId = providerId;
        throw error;
    }
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

async function getSharedNews(cacheKey, producer, options = {}) {
    if (typeof producer !== 'function') throw new TypeError('NEWS_PRODUCER_REQUIRED');
    const key = String(cacheKey || 'UNKNOWN_NEWS_KEY');
    const ttlMs = Math.max(1000, finite(options.ttlMs, DEFAULTS.newsCacheTtlMs));
    const forceRefresh = options.forceRefresh === true;
    const cached = newsCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
        return clonePlain(cached.value);
    }
    if (!forceRefresh && newsInFlight.has(key)) return newsInFlight.get(key);

    const promise = Promise.resolve()
        .then(producer)
        .then(value => {
            newsCache.set(key, { value: clonePlain(value), expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
            return value;
        })
        .finally(() => {
            if (newsInFlight.get(key) === promise) newsInFlight.delete(key);
        });
    newsInFlight.set(key, promise);
    return promise;
}

function scalarEqual(a, b) {
    if (a === b) return true;
    if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
    if (typeof a === 'number' || typeof b === 'number') {
        const na = Number(a), nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
    }
    return String(a ?? '') === String(b ?? '');
}

function changedFields(current = {}, next = {}) {
    const changed = {};
    for (const [key, value] of Object.entries(next)) {
        if (!scalarEqual(current?.[key], value)) changed[key] = value;
    }
    return changed;
}

function persistIfChanged({ current = {}, next = {}, write, eventKey = null, rowId = null } = {}) {
    if (typeof write !== 'function') throw new TypeError('PERSIST_WRITE_REQUIRED');
    const changed = changedFields(current, next);
    const keys = Object.keys(changed);
    const fingerprint = hashPayload({ eventKey, rowId, changed });
    if (!keys.length) {
        return { attempted: true, persisted: false, idempotent: true, changedFields: [], fingerprint };
    }
    write(changed);
    return { attempted: true, persisted: true, idempotent: false, changedFields: keys, fingerprint };
}

function diagnostics() {
    return {
        version: DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
        defaults: { ...DEFAULTS },
        deepScanQueue: deepScanQueue.snapshot(),
        inFlightEventKeys: [...deepScanInFlight.keys()],
        providerCircuits: [...providerCircuits.values()].map(row => ({ ...row })),
        newsCacheEntries: newsCache.size,
        newsInFlightEntries: newsInFlight.size
    };
}

function resetForTests() {
    deepScanInFlight.clear();
    providerCircuits.clear();
    newsCache.clear();
    newsInFlight.clear();
    deepScanQueue.pending.splice(0, deepScanQueue.pending.length);
    deepScanQueue.active = 0;
    deepScanQueue.maxObserved = 0;
}

module.exports = {
    DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
    DEFAULTS,
    ConcurrencyQueue,
    normalizeToken,
    stableStringify,
    hashPayload,
    buildEventKey,
    withTimeout,
    runDeepScan,
    runProvider,
    getSharedNews,
    changedFields,
    persistIfChanged,
    diagnostics,
    resetForTests
};
