'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CALCIO_FOOTBALL_DATA_PROVIDER_VERSION = 'CALCIO_PATCH_3_FOOTBALL_DATA_PROVIDER_V1';
const CALCIO_FOOTBALL_DATA_MANIFEST_VERSION = 'CALCIO_PATCH_3_FOOTBALL_DATA_MANIFEST_V1';
const CALCIO_FOOTBALL_DATA_FRESHNESS_VERSION = 'CALCIO_PATCH_3_FRESHNESS_GUARD_V1';
const FOOTBALL_DATA_BASE_URL = 'https://www.football-data.co.uk/mmz4281';
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_SEASON_DEPTH = 3;

const DEFAULT_LEAGUES = Object.freeze([
    Object.freeze({ key: 'serie_a', code: 'I1', name: 'Serie A' }),
    Object.freeze({ key: 'serie_b', code: 'I2', name: 'Serie B' }),
    Object.freeze({ key: 'premier_league', code: 'E0', name: 'Premier' }),
    Object.freeze({ key: 'la_liga', code: 'SP1', name: 'La Liga' }),
    Object.freeze({ key: 'ligue_1', code: 'F1', name: 'Ligue 1' }),
    Object.freeze({ key: 'bundesliga', code: 'D1', name: 'Bundesliga' })
]);

const inFlightByCode = new Map();
let scheduledRefreshState = null;

function sha256Text(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function nowIso(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function finite(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function safeLeagueCode(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(code)) throw new Error(`CALCIO_PATCH3_INVALID_LEAGUE_CODE:${value}`);
    return code;
}

function safeLeagueKey(value, fallbackCode = '') {
    const normalized = String(value || fallbackCode || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    if (!normalized) throw new Error('CALCIO_PATCH3_INVALID_LEAGUE_KEY');
    return normalized.slice(0, 80);
}

function parseFootballDataDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const parts = raw.split(/[\/\-.]/).map(part => part.trim());
    if (parts.length === 3) {
        let [day, month, year] = parts;
        if (year.length === 2) year = Number(year) >= 70 ? `19${year}` : `20${year}`;
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
        if (!Number.isNaN(date.getTime()) && date.getUTCDate() === Number(day) && date.getUTCMonth() === Number(month) - 1) return date;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSeasonKey(startYear) {
    const year = Number(startYear);
    if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new Error(`CALCIO_PATCH3_INVALID_SEASON_START:${startYear}`);
    return `${String(year).slice(-2)}${String(year + 1).slice(-2)}`;
}

function inferEuropeanSeasonStartYear(now = new Date(), options = {}) {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) throw new Error('CALCIO_PATCH3_INVALID_NOW');
    const rolloverMonthUtc = Math.max(0, Math.min(11, Number(options.rolloverMonthUtc ?? 6)));
    return date.getUTCFullYear() - (date.getUTCMonth() < rolloverMonthUtc ? 1 : 0);
}

function buildSeasonCandidates(now = new Date(), options = {}) {
    const explicit = Array.isArray(options.seasons) ? options.seasons : null;
    if (explicit && explicit.length) {
        return [...new Set(explicit.map(value => String(value || '').trim()).filter(value => /^\d{4}$/.test(value)))];
    }
    const depth = Math.max(1, Math.min(6, Number(options.depth || DEFAULT_SEASON_DEPTH)));
    const startYear = inferEuropeanSeasonStartYear(now, options);
    return Array.from({ length: depth }, (_, index) => formatSeasonKey(startYear - index));
}

function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

function inspectFootballDataCsv(text, options = {}) {
    const raw = String(text ?? '').replace(/^\uFEFF/, '');
    const code = safeLeagueCode(options.code || 'TEST');
    const minValidRows = Math.max(1, Number(options.minValidRows || 1));
    const errors = [];
    if (!raw.trim()) errors.push('EMPTY_BODY');
    if (/<!doctype\s+html|<html[\s>]/i.test(raw.slice(0, 2048))) errors.push('HTML_BODY');

    const lines = raw.split(/\r?\n/).filter((line, index) => index === 0 || line.trim().length > 0);
    const headers = lines.length ? splitCsvLine(lines[0]).map(value => String(value || '').trim()) : [];
    const required = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'];
    const indexes = Object.fromEntries(required.map(name => [name, headers.indexOf(name)]));
    for (const name of required) if (indexes[name] < 0) errors.push(`MISSING_HEADER_${name.toUpperCase()}`);

    let validRows = 0;
    let rejectedRows = 0;
    let earliest = null;
    let latest = null;
    if (errors.length === 0) {
        for (const line of lines.slice(1)) {
            const cols = splitCsvLine(line);
            const home = String(cols[indexes.HomeTeam] || '').trim();
            const away = String(cols[indexes.AwayTeam] || '').trim();
            const matchDate = parseFootballDataDate(cols[indexes.Date]);
            const homeGoalsRaw = String(cols[indexes.FTHG] ?? '').trim();
            const awayGoalsRaw = String(cols[indexes.FTAG] ?? '').trim();
            const homeGoals = homeGoalsRaw === '' ? null : finite(homeGoalsRaw, null);
            const awayGoals = awayGoalsRaw === '' ? null : finite(awayGoalsRaw, null);
            if (!home || !away || !matchDate || homeGoals === null || awayGoals === null) {
                rejectedRows += 1;
                continue;
            }
            validRows += 1;
            if (!earliest || matchDate < earliest) earliest = matchDate;
            if (!latest || matchDate > latest) latest = matchDate;
        }
        if (validRows < minValidRows) errors.push(`INSUFFICIENT_VALID_ROWS_${validRows}_${minValidRows}`);
    }

    const valid = errors.length === 0;
    return {
        valid,
        code,
        headers,
        headerCount: headers.length,
        validRows,
        rejectedRows,
        earliestMatchAt: earliest ? earliest.toISOString() : null,
        latestMatchAt: latest ? latest.toISOString() : null,
        sha256: sha256Text(raw),
        sizeBytes: Buffer.byteLength(raw, 'utf8'),
        errors
    };
}

function classifyFetchFreshness(fetchedAt, now = new Date(), options = {}) {
    const fetched = fetchedAt ? new Date(fetchedAt) : null;
    const current = now instanceof Date ? now : new Date(now);
    if (!fetched || Number.isNaN(fetched.getTime()) || Number.isNaN(current.getTime())) return { status: 'UNKNOWN', ageMs: null, ageHours: null };
    const ageMs = Math.max(0, current.getTime() - fetched.getTime());
    const refreshIntervalMs = Math.max(60_000, Number(options.refreshIntervalMs || DEFAULT_REFRESH_INTERVAL_MS));
    const status = ageMs <= refreshIntervalMs ? 'CURRENT' : ageMs <= refreshIntervalMs * 3 ? 'AGING' : 'STALE';
    return { status, ageMs, ageHours: Number((ageMs / 3_600_000).toFixed(2)) };
}

function classifyMatchRecency(latestMatchAt, now = new Date()) {
    const latest = latestMatchAt ? new Date(latestMatchAt) : null;
    const current = now instanceof Date ? now : new Date(now);
    if (!latest || Number.isNaN(latest.getTime()) || Number.isNaN(current.getTime())) return { status: 'UNKNOWN', ageDays: null };
    const ageDays = Math.max(0, (current.getTime() - latest.getTime()) / 86_400_000);
    let status = ageDays <= 14 ? 'CURRENT' : ageDays <= 45 ? 'AGING' : 'STALE';
    const month = current.getUTCMonth();
    if ((month === 5 || month === 6) && ageDays <= 120) status = 'OFFSEASON_LAST_COMPLETE';
    return { status, ageDays: Number(ageDays.toFixed(1)) };
}

function getCacheDir(options = {}) {
    return path.resolve(options.cacheDir || process.env.CALCIO_FOOTBALL_DATA_DIR || path.join(__dirname, 'data', 'calcio_football_data'));
}

function leaguePaths(options = {}) {
    const code = safeLeagueCode(options.code);
    const cacheDir = getCacheDir(options);
    return {
        cacheDir,
        csvPath: path.join(cacheDir, `${code}.csv`),
        metaPath: path.join(cacheDir, `${code}.meta.json`),
        failurePath: path.join(cacheDir, `${code}.failure.json`),
        manifestPath: path.join(cacheDir, 'manifest.json')
    };
}

function readJson(file, fallback = null) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readLocalLeagueSnapshot(options = {}) {
    const paths = leaguePaths(options);
    if (!fs.existsSync(paths.csvPath)) return null;
    const csvData = fs.readFileSync(paths.csvPath, 'utf8');
    const inspection = inspectFootballDataCsv(csvData, { code: options.code, minValidRows: options.minValidRows || 1 });
    if (!inspection.valid) return { valid: false, csvData, inspection, metadata: readJson(paths.metaPath, null), paths };
    const metadata = readJson(paths.metaPath, {}) || {};
    const fetchedAt = metadata.fetchedAt || metadata.lastSuccessAt || fs.statSync(paths.csvPath).mtime.toISOString();
    return {
        valid: true,
        csvData,
        inspection,
        metadata: {
            ...metadata,
            code: safeLeagueCode(options.code),
            fetchedAt,
            sha256: inspection.sha256,
            validRows: inspection.validRows,
            latestMatchAt: inspection.latestMatchAt
        },
        paths
    };
}

function updateManifest(cacheDir, entry) {
    const manifestPath = path.join(cacheDir, 'manifest.json');
    const current = readJson(manifestPath, {}) || {};
    const leagues = { ...(current.leagues || {}), [entry.code]: entry };
    const payload = {
        version: CALCIO_FOOTBALL_DATA_MANIFEST_VERSION,
        providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        updatedAt: entry.fetchedAt || nowIso(),
        leagues
    };
    payload.revisionToken = sha256Text(stableStringify(Object.values(leagues).map(item => ({
        code: item.code,
        season: item.season,
        sha256: item.sha256,
        fetchedAt: item.fetchedAt
    })).sort((a, b) => a.code.localeCompare(b.code)))).slice(0, 24);
    writeJson(manifestPath, payload);
    return payload;
}

function activateLeagueSnapshot(csvData, metadata, options = {}) {
    const paths = leaguePaths(options);
    const inspection = inspectFootballDataCsv(csvData, { code: options.code, minValidRows: options.minValidRows || 1 });
    if (!inspection.valid) throw new Error(`CALCIO_PATCH3_REFUSE_INVALID_ACTIVATION:${inspection.errors.join('|')}`);
    fs.mkdirSync(paths.cacheDir, { recursive: true });
    const operationId = String(metadata.operationId || `CALCIO_FD_${Date.now()}`);
    const backupDir = path.join(paths.cacheDir, 'last_known_good', operationId.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const tempCsv = `${paths.csvPath}.${process.pid}.${Date.now()}.tmp`;
    const tempMeta = `${paths.metaPath}.${process.pid}.${Date.now()}.tmp`;
    const oldCsvExists = fs.existsSync(paths.csvPath);
    const oldMetaExists = fs.existsSync(paths.metaPath);

    try {
        if (oldCsvExists || oldMetaExists) {
            fs.mkdirSync(backupDir, { recursive: true });
            if (oldCsvExists) fs.copyFileSync(paths.csvPath, path.join(backupDir, path.basename(paths.csvPath)));
            if (oldMetaExists) fs.copyFileSync(paths.metaPath, path.join(backupDir, path.basename(paths.metaPath)));
        }
        fs.writeFileSync(tempCsv, String(csvData), 'utf8');
        fs.writeFileSync(tempMeta, JSON.stringify({
            ...metadata,
            version: CALCIO_FOOTBALL_DATA_MANIFEST_VERSION,
            providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
            code: safeLeagueCode(options.code),
            sha256: inspection.sha256,
            validRows: inspection.validRows,
            rejectedRows: inspection.rejectedRows,
            earliestMatchAt: inspection.earliestMatchAt,
            latestMatchAt: inspection.latestMatchAt,
            sizeBytes: inspection.sizeBytes,
            lastKnownGoodBackup: oldCsvExists || oldMetaExists ? backupDir : null
        }, null, 2));
        fs.copyFileSync(tempCsv, paths.csvPath);
        fs.copyFileSync(tempMeta, paths.metaPath);
        const active = readLocalLeagueSnapshot(options);
        if (!active?.valid || active.inspection.sha256 !== inspection.sha256) throw new Error('CALCIO_PATCH3_POST_ACTIVATION_VERIFY_FAILED');
        fs.rmSync(paths.failurePath, { force: true });
        const manifest = updateManifest(paths.cacheDir, active.metadata);
        return { active, manifest, backupDir: oldCsvExists || oldMetaExists ? backupDir : null };
    } catch (error) {
        if (fs.existsSync(backupDir)) {
            const backupCsv = path.join(backupDir, path.basename(paths.csvPath));
            const backupMeta = path.join(backupDir, path.basename(paths.metaPath));
            if (fs.existsSync(backupCsv)) fs.copyFileSync(backupCsv, paths.csvPath);
            else if (!oldCsvExists) fs.rmSync(paths.csvPath, { force: true });
            if (fs.existsSync(backupMeta)) fs.copyFileSync(backupMeta, paths.metaPath);
            else if (!oldMetaExists) fs.rmSync(paths.metaPath, { force: true });
        } else {
            if (!oldCsvExists) fs.rmSync(paths.csvPath, { force: true });
            if (!oldMetaExists) fs.rmSync(paths.metaPath, { force: true });
        }
        throw error;
    } finally {
        fs.rmSync(tempCsv, { force: true });
        fs.rmSync(tempMeta, { force: true });
    }
}

function buildFootballDataUrl(season, code) {
    const safeSeason = String(season || '').trim();
    if (!/^\d{4}$/.test(safeSeason)) throw new Error(`CALCIO_PATCH3_INVALID_SEASON_KEY:${season}`);
    return `${FOOTBALL_DATA_BASE_URL}/${safeSeason}/${safeLeagueCode(code)}.csv`;
}

async function defaultFetchText(url, options = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.football-data.co.uk' || !parsed.pathname.startsWith('/mmz4281/')) {
        throw new Error('CALCIO_PATCH3_URL_NOT_ALLOWLISTED');
    }
    const axios = require('axios');
    const response = await axios.get(url, {
        timeout: Math.max(1000, Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)),
        responseType: 'text',
        transformResponse: [data => data],
        headers: { 'User-Agent': 'BettingApp-CalcioPatch3/1.0' },
        validateStatus: status => status >= 200 && status < 300
    });
    return String(response.data ?? '');
}

function buildResult(snapshot, context = {}) {
    const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
    const fetchFreshness = classifyFetchFreshness(snapshot.metadata.fetchedAt, now, context);
    const matchRecency = classifyMatchRecency(snapshot.inspection.latestMatchAt, now);
    return {
        success: true,
        providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        freshnessVersion: CALCIO_FOOTBALL_DATA_FRESHNESS_VERSION,
        leagueKey: context.leagueKey,
        leagueName: context.leagueName,
        code: context.code,
        csvData: snapshot.csvData,
        source: context.source,
        degraded: Boolean(context.degraded),
        season: snapshot.metadata.season || context.season || null,
        url: snapshot.metadata.url || context.url || null,
        fetchedAt: snapshot.metadata.fetchedAt || null,
        validRows: snapshot.inspection.validRows,
        rejectedRows: snapshot.inspection.rejectedRows,
        earliestMatchAt: snapshot.inspection.earliestMatchAt,
        latestMatchAt: snapshot.inspection.latestMatchAt,
        sha256: snapshot.inspection.sha256,
        fetchFreshness,
        matchRecency,
        attemptedSeasons: context.attemptedSeasons || [],
        errors: context.errors || [],
        operationId: snapshot.metadata.operationId || context.operationId || null,
        cacheDir: snapshot.paths.cacheDir
    };
}

async function getLeagueCsv(options = {}) {
    const code = safeLeagueCode(options.code);
    const leagueKey = safeLeagueKey(options.leagueKey || options.key, code);
    const leagueName = String(options.leagueName || options.name || leagueKey);
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const refreshIntervalMs = Math.max(60_000, Number(options.refreshIntervalMs || DEFAULT_REFRESH_INTERVAL_MS));
    const failureCooldownMs = Math.max(60_000, Number(options.failureCooldownMs || DEFAULT_FAILURE_COOLDOWN_MS));
    const operationId = String(options.operationId || `CALCIO_FD_${code}_${Date.now()}`);
    const cacheOptions = { ...options, code, leagueKey, leagueName };

    if (inFlightByCode.has(code)) return inFlightByCode.get(code);

    const task = (async () => {
        const local = readLocalLeagueSnapshot(cacheOptions);
        if (local?.valid && options.forceRefresh !== true) {
            const freshness = classifyFetchFreshness(local.metadata.fetchedAt, now, { refreshIntervalMs });
            if (freshness.status === 'CURRENT') {
                return buildResult(local, { ...cacheOptions, now, refreshIntervalMs, source: 'CACHE_FRESH', degraded: false, attemptedSeasons: [] });
            }
            const failure = readJson(local.paths.failurePath, null);
            if (failure?.lastAttemptAt) {
                const lastFailureAt = new Date(failure.lastAttemptAt);
                if (!Number.isNaN(lastFailureAt.getTime()) && now.getTime() - lastFailureAt.getTime() < failureCooldownMs) {
                    return buildResult(local, {
                        ...cacheOptions,
                        now,
                        refreshIntervalMs,
                        source: 'LAST_KNOWN_GOOD_COOLDOWN',
                        degraded: true,
                        attemptedSeasons: failure.attemptedSeasons || [],
                        errors: failure.errors || []
                    });
                }
            }
        }

        const seasons = buildSeasonCandidates(now, options);
        const errors = [];
        const fetchText = options.fetchText || defaultFetchText;
        for (const season of seasons) {
            const url = buildFootballDataUrl(season, code);
            try {
                const csvData = await fetchText(url, { timeoutMs: options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS, code, season, leagueKey, leagueName });
                const inspection = inspectFootballDataCsv(csvData, { code, minValidRows: options.minValidRows || 1 });
                if (!inspection.valid) throw new Error(`INVALID_CSV:${inspection.errors.join('|')}`);
                const activated = activateLeagueSnapshot(csvData, {
                    operationId,
                    fetchedAt: nowIso(now),
                    lastSuccessAt: nowIso(now),
                    source: 'NETWORK',
                    season,
                    url,
                    leagueKey,
                    leagueName,
                    code,
                    attemptedSeasons: seasons.slice(0, seasons.indexOf(season) + 1)
                }, cacheOptions);
                return buildResult(activated.active, {
                    ...cacheOptions,
                    now,
                    refreshIntervalMs,
                    source: 'NETWORK',
                    degraded: false,
                    season,
                    url,
                    attemptedSeasons: seasons.slice(0, seasons.indexOf(season) + 1),
                    errors
                });
            } catch (error) {
                errors.push({ season, url, error: error.message });
            }
        }

        const paths = leaguePaths(cacheOptions);
        const failure = {
            version: CALCIO_FOOTBALL_DATA_MANIFEST_VERSION,
            providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
            operationId,
            code,
            leagueKey,
            leagueName,
            lastAttemptAt: nowIso(now),
            status: local?.valid ? 'FAILED_USING_LAST_KNOWN_GOOD' : 'FAILED_NO_LAST_KNOWN_GOOD',
            attemptedSeasons: seasons,
            errors,
            localPreserved: Boolean(local?.valid)
        };
        writeJson(paths.failurePath, failure);
        if (local?.valid) {
            return buildResult(local, {
                ...cacheOptions,
                now,
                refreshIntervalMs,
                source: 'LAST_KNOWN_GOOD',
                degraded: true,
                attemptedSeasons: seasons,
                errors
            });
        }
        const unavailable = new Error(`CALCIO_PATCH3_NO_VALID_FOOTBALL_DATA:${leagueName}:${errors.map(item => `${item.season}:${item.error}`).join(';')}`);
        unavailable.code = 'CALCIO_PATCH3_NO_VALID_FOOTBALL_DATA';
        unavailable.diagnostics = failure;
        throw unavailable;
    })();

    inFlightByCode.set(code, task);
    try {
        return await task;
    } finally {
        inFlightByCode.delete(code);
    }
}

function normalizeLeagues(leagues = DEFAULT_LEAGUES) {
    const list = Array.isArray(leagues) ? leagues : Object.entries(leagues || {}).map(([key, value]) => ({ key, ...value }));
    return list.map(item => ({
        key: safeLeagueKey(item.key || item.leagueKey, item.code),
        code: safeLeagueCode(item.code),
        name: String(item.name || item.leagueName || item.key || item.code)
    }));
}

async function refreshAll(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const leagues = normalizeLeagues(options.leagues || DEFAULT_LEAGUES);
    const results = [];
    const errors = [];
    for (const league of leagues) {
        try {
            const result = await getLeagueCsv({ ...options, ...league, leagueKey: league.key, leagueName: league.name, now, forceRefresh: true });
            results.push({ ...result, csvData: undefined });
        } catch (error) {
            errors.push({ leagueKey: league.key, leagueName: league.name, code: league.code, error: error.message, diagnostics: error.diagnostics || null });
        }
    }
    const degradedResults = results.filter(item => item.degraded === true);
    return {
        success: errors.length === 0 && degradedResults.length === 0,
        partial: results.length > 0 && (errors.length > 0 || degradedResults.length > 0),
        providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        freshnessVersion: CALCIO_FOOTBALL_DATA_FRESHNESS_VERSION,
        refreshedAt: nowIso(now),
        results,
        errors,
        degradedResults: degradedResults.map(item => ({ leagueKey: item.leagueKey, code: item.code, source: item.source })),
        health: getFootballDataHealth({ ...options, leagues, now })
    };
}

function getFootballDataHealth(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const leagues = normalizeLeagues(options.leagues || DEFAULT_LEAGUES);
    const entries = leagues.map(league => {
        const snapshot = readLocalLeagueSnapshot({ ...options, code: league.code });
        const failure = readJson(leaguePaths({ ...options, code: league.code }).failurePath, null);
        if (!snapshot?.valid) {
            return {
                leagueKey: league.key,
                leagueName: league.name,
                code: league.code,
                available: false,
                status: 'MISSING',
                source: null,
                season: null,
                validRows: 0,
                latestMatchAt: null,
                fetchFreshness: { status: 'UNKNOWN', ageMs: null, ageHours: null },
                matchRecency: { status: 'UNKNOWN', ageDays: null },
                lastFailure: failure
            };
        }
        const result = buildResult(snapshot, {
            ...options,
            now,
            code: league.code,
            leagueKey: league.key,
            leagueName: league.name,
            source: failure ? 'LAST_KNOWN_GOOD' : 'LOCAL_ACTIVE',
            degraded: Boolean(failure),
            errors: failure?.errors || []
        });
        return {
            leagueKey: league.key,
            leagueName: league.name,
            code: league.code,
            available: true,
            status: result.degraded ? 'DEGRADED_USING_LAST_KNOWN_GOOD' : 'READY',
            source: result.source,
            season: result.season,
            fetchedAt: result.fetchedAt,
            validRows: result.validRows,
            rejectedRows: result.rejectedRows,
            earliestMatchAt: result.earliestMatchAt,
            latestMatchAt: result.latestMatchAt,
            sha256: result.sha256,
            fetchFreshness: result.fetchFreshness,
            matchRecency: result.matchRecency,
            lastFailure: failure
        };
    });
    const available = entries.filter(entry => entry.available).length;
    const degraded = entries.filter(entry => entry.status === 'DEGRADED_USING_LAST_KNOWN_GOOD').length;
    const manifest = readJson(path.join(getCacheDir(options), 'manifest.json'), null);
    const overallStatus = available === 0 ? 'NOT_YET_REFRESHED' : available < entries.length ? 'PARTIAL' : degraded > 0 ? 'DEGRADED_USING_LAST_KNOWN_GOOD' : 'READY';
    return {
        success: available > 0,
        providerVersion: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        manifestVersion: CALCIO_FOOTBALL_DATA_MANIFEST_VERSION,
        freshnessVersion: CALCIO_FOOTBALL_DATA_FRESHNESS_VERSION,
        status: overallStatus,
        checkedAt: nowIso(now),
        cacheDir: getCacheDir(options),
        revisionToken: manifest?.revisionToken || getRevisionToken(options),
        aggregate: {
            leagueCount: entries.length,
            availableLeagues: available,
            missingLeagues: entries.length - available,
            degradedLeagues: degraded,
            validRows: entries.reduce((sum, entry) => sum + Number(entry.validRows || 0), 0)
        },
        entries,
        schedule: {
            initialDelayMs: 15000,
            refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
            failureCooldownMs: DEFAULT_FAILURE_COOLDOWN_MS
        },
        invariants: {
            networkFailureBlocksServer: false,
            invalidDownloadActivates: false,
            previousValidDataDeletedOnFailure: false,
            databaseMutation: false,
            tennisAuthorityChanged: false
        }
    };
}

function getRevisionToken(options = {}) {
    const manifest = readJson(path.join(getCacheDir(options), 'manifest.json'), null);
    if (manifest?.revisionToken) return manifest.revisionToken;
    const leagues = normalizeLeagues(options.leagues || DEFAULT_LEAGUES);
    const state = leagues.map(league => {
        const snapshot = readLocalLeagueSnapshot({ ...options, code: league.code });
        return snapshot?.valid ? { code: league.code, sha256: snapshot.inspection.sha256, season: snapshot.metadata.season || null, fetchedAt: snapshot.metadata.fetchedAt || null } : { code: league.code, missing: true };
    });
    return sha256Text(stableStringify(state)).slice(0, 24);
}

function createProviderDiagnostics() {
    return {
        version: CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
        requests: 0,
        network: 0,
        cacheFresh: 0,
        lastKnownGood: 0,
        degraded: 0,
        failures: 0,
        byLeague: []
    };
}

function recordProviderDiagnostics(target, resultOrError, context = {}) {
    if (!target || typeof target !== 'object') return target;
    target.requests = Number(target.requests || 0) + 1;
    if (resultOrError?.success) {
        const source = String(resultOrError.source || 'UNKNOWN');
        if (source === 'NETWORK') target.network = Number(target.network || 0) + 1;
        if (source === 'CACHE_FRESH') target.cacheFresh = Number(target.cacheFresh || 0) + 1;
        if (source.startsWith('LAST_KNOWN_GOOD')) target.lastKnownGood = Number(target.lastKnownGood || 0) + 1;
        if (resultOrError.degraded) target.degraded = Number(target.degraded || 0) + 1;
        target.byLeague.push({
            league: resultOrError.leagueName || context.leagueName || 'UNKNOWN',
            code: resultOrError.code || context.code || null,
            source,
            season: resultOrError.season || null,
            validRows: resultOrError.validRows || 0,
            latestMatchAt: resultOrError.latestMatchAt || null,
            fetchFreshness: resultOrError.fetchFreshness?.status || 'UNKNOWN',
            matchRecency: resultOrError.matchRecency?.status || 'UNKNOWN',
            degraded: Boolean(resultOrError.degraded)
        });
    } else {
        target.failures = Number(target.failures || 0) + 1;
        target.byLeague.push({
            league: context.leagueName || 'UNKNOWN',
            code: context.code || null,
            source: 'UNAVAILABLE',
            error: resultOrError?.message || String(resultOrError || 'UNKNOWN_ERROR')
        });
    }
    return target;
}

function scheduleBestEffortRefresh(options = {}) {
    if (scheduledRefreshState) return scheduledRefreshState;
    const enabled = !['0', 'false', 'no', 'off'].includes(String(process.env.CALCIO_FOOTBALL_DATA_AUTO_REFRESH ?? '1').trim().toLowerCase());
    const initialDelayMs = Math.max(0, Math.min(10 * 60 * 1000, Number(options.initialDelayMs ?? process.env.CALCIO_FOOTBALL_DATA_INITIAL_DELAY_MS ?? 15000)));
    const intervalMs = Math.max(60 * 60 * 1000, Number(options.intervalMs ?? process.env.CALCIO_FOOTBALL_DATA_REFRESH_INTERVAL_MS ?? DEFAULT_REFRESH_INTERVAL_MS));
    const leagues = normalizeLeagues(options.leagues || DEFAULT_LEAGUES);
    const logger = options.logger || console;
    const state = {
        enabled,
        initialDelayMs,
        intervalMs,
        running: false,
        lastRunAt: null,
        lastResult: null,
        timeout: null,
        interval: null
    };
    scheduledRefreshState = state;
    if (!enabled) {
        logger.log?.('⏸️ [CALCIO PATCH 3] Refresh Football-Data automatico disattivato. Comando manuale: npm run refresh:calcio:football-data');
        return state;
    }

    const run = async source => {
        if (state.running) return;
        state.running = true;
        state.lastRunAt = nowIso();
        try {
            const result = await refreshAll({ ...options, leagues, forceRefresh: true });
            state.lastResult = { success: result.success, partial: result.partial, refreshedAt: result.refreshedAt, errors: result.errors };
            logger.log?.(`[CALCIO PATCH 3] Refresh Football-Data ${source}: success=${result.success} partial=${result.partial} ready=${result.health.aggregate.availableLeagues}/${result.health.aggregate.leagueCount}.`);
        } catch (error) {
            state.lastResult = { success: false, error: error.message, at: nowIso() };
            logger.warn?.(`[CALCIO PATCH 3] Refresh Football-Data ${source} non bloccante: ${error.message}`);
        } finally {
            state.running = false;
        }
    };

    state.timeout = setTimeout(() => run('startup-delay'), initialDelayMs);
    state.interval = setInterval(() => run('interval'), intervalMs);
    state.timeout.unref?.();
    state.interval.unref?.();
    logger.log?.(`[CALCIO PATCH 3] Refresh Football-Data programmato: primo tentativo ${Math.round(initialDelayMs / 1000)}s, frequenza ${Math.round(intervalMs / 3_600_000)}h.`);
    return state;
}

function getScheduledRefreshState() {
    if (!scheduledRefreshState) return null;
    return {
        enabled: scheduledRefreshState.enabled,
        initialDelayMs: scheduledRefreshState.initialDelayMs,
        intervalMs: scheduledRefreshState.intervalMs,
        running: scheduledRefreshState.running,
        lastRunAt: scheduledRefreshState.lastRunAt,
        lastResult: scheduledRefreshState.lastResult
    };
}

module.exports = {
    CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
    CALCIO_FOOTBALL_DATA_MANIFEST_VERSION,
    CALCIO_FOOTBALL_DATA_FRESHNESS_VERSION,
    FOOTBALL_DATA_BASE_URL,
    DEFAULT_REFRESH_INTERVAL_MS,
    DEFAULT_FAILURE_COOLDOWN_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_LEAGUES,
    parseFootballDataDate,
    formatSeasonKey,
    inferEuropeanSeasonStartYear,
    buildSeasonCandidates,
    inspectFootballDataCsv,
    classifyFetchFreshness,
    classifyMatchRecency,
    getCacheDir,
    readLocalLeagueSnapshot,
    activateLeagueSnapshot,
    buildFootballDataUrl,
    getLeagueCsv,
    refreshAll,
    getFootballDataHealth,
    getRevisionToken,
    createProviderDiagnostics,
    recordProviderDiagnostics,
    scheduleBestEffortRefresh,
    getScheduledRefreshState,
    normalizeLeagues,
    _private: {
        splitCsvLine,
        stableStringify,
        sha256Text,
        leaguePaths,
        readJson,
        writeJson,
        updateManifest,
        defaultFetchText
    }
};
