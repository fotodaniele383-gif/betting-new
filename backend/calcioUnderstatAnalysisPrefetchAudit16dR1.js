'use strict';

const VERSION = 'AUDIT16D_R1_CALCIO_UNDERSTAT_PREFETCH_V1';
const POLICY_VERSION = 'AUDIT16D_R1_BOUNDED_PROVIDER_PREFETCH_POLICY_V1';

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
}

function resolveOptions(env = process.env) {
    return {
        timeoutMs: clampInt(env.CALCIO_UNDERSTAT_ANALYSIS_TIMEOUT_MS, 4500, 1500, 8000),
        concurrency: clampInt(env.CALCIO_UNDERSTAT_PREFETCH_CONCURRENCY, 3, 1, 4)
    };
}

async function prefetch(options = {}) {
    const leagueKeys = Array.isArray(options.leagueKeys) ? options.leagueKeys.filter(Boolean) : [];
    const leagueConfig = options.leagueConfig || {};
    const getUnderstatxG = options.getUnderstatxG;
    const getUnderstatState = options.getUnderstatState;
    if (typeof getUnderstatxG !== 'function' || typeof getUnderstatState !== 'function') {
        throw new Error('AUDIT16D_R1_UNDERSTAT_PREFETCH_DEPENDENCY_MISSING');
    }

    const runtime = {
        timeoutMs: clampInt(options.timeoutMs, 4500, 1500, 8000),
        concurrency: clampInt(options.concurrency, 3, 1, 4)
    };
    const startedAt = Date.now();
    const byLeague = {};
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= leagueKeys.length) return;
            const leagueKey = leagueKeys[index];
            const config = leagueConfig[leagueKey];
            const leagueName = config?.name || leagueKey;
            const started = Date.now();
            let teams = {};
            let error = null;
            try {
                teams = await getUnderstatxG(leagueName, { timeoutMs: runtime.timeoutMs });
                if (!teams || typeof teams !== 'object' || Array.isArray(teams)) teams = {};
            } catch (err) {
                error = err?.code || err?.message || 'UNDERSTAT_PREFETCH_ERROR';
            }
            const state = getUnderstatState(leagueName) || {};
            byLeague[leagueKey] = {
                leagueKey,
                league: leagueName,
                teams,
                state,
                error,
                durationMs: Date.now() - started
            };
        }
    }

    const workerCount = Math.max(1, Math.min(runtime.concurrency, leagueKeys.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const rows = leagueKeys.map(key => byLeague[key]).filter(Boolean);
    return {
        version: VERSION,
        policyVersion: POLICY_VERSION,
        timeoutMs: runtime.timeoutMs,
        concurrency: runtime.concurrency,
        durationMs: Date.now() - startedAt,
        byLeague,
        diagnostics: {
            version: VERSION,
            policyVersion: POLICY_VERSION,
            timeoutMs: runtime.timeoutMs,
            concurrency: runtime.concurrency,
            durationMs: Date.now() - startedAt,
            requested: leagueKeys.length,
            completed: rows.length,
            withTeams: rows.filter(row => Object.keys(row.teams || {}).length > 0).length,
            unavailable: rows.filter(row => Object.keys(row.teams || {}).length === 0).length,
            errors: rows.filter(row => row.error).map(row => ({ league: row.league, error: row.error })),
            leagues: rows.map(row => ({
                league: row.league,
                durationMs: row.durationMs,
                status: row.state?.status || 'UNKNOWN',
                teams: Object.keys(row.teams || {}).length,
                error: row.error
            }))
        }
    };
}

module.exports = {
    VERSION,
    POLICY_VERSION,
    resolveOptions,
    prefetch
};
