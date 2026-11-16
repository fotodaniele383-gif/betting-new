'use strict';

const fs = require('fs');
const path = require('path');
const { fetchUnderstatText } = require('./audit07sR5UnderstatHttp');
const { sanitizeUnderstatData } = require('./calcioUnderstatContract');

const CALCIO_UNDERSTAT_PROVIDER_VERSION = 'CALCIO_PATCH_11_UNDERSTAT_PROVIDER_V3';
const CALCIO_UNDERSTAT_AJAX_CONTRACT_VERSION = 'UNDERSTAT_GET_LEAGUE_DATA_V1';
const AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION = 'AUDIT16D_R3_UNDERSTAT_SESSION_JSON_RESILIENCE_V1';
const AUDIT16D_R3_R3A_UNDERSTAT_VERSION = 'AUDIT16D_R3_R3A_UNDERSTAT_API_DATE_BROWSER_RESILIENCE_V1';
const AUDIT16D_R3_R3A_R2_PROVENANCE_VERSION = 'AUDIT16D_R3_R3A_R2_UNDERSTAT_PROVENANCE_LOCK_V1';
const AUDIT16D_R3_R3A_R4_WIRE_VERSION = 'AUDIT16D_R3_R3A_R4_UNDERSTAT_GZIP_AND_ENDPOINT_ALIAS_V1';
const CACHE_SCHEMA_VERSION = 'CALCIO_PATCH_10_UNDERSTAT_LKG_V1';
const CIRCUIT_BREAKER_MS = 60 * 60 * 1000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

const understatLeagueMap = Object.freeze({
    'Serie A': 'Serie_A',
    'Premier': 'EPL',
    'La Liga': 'La_liga',
    'Ligue 1': 'Ligue_1',
    'Bundesliga': 'Bundesliga'
});

// Browser forensic capture (R3_R3A_R3) showed that the public page may call
// getLeagueData with a display-name segment (for example `Serie A`) while
// historical clients use the page slug (`Serie_A`). Try the stable slug first
// and only then the browser-observed alias. No extra request is made when the
// first candidate returns valid JSON.
const understatApiLeagueAliases = Object.freeze({
    'Serie A': Object.freeze(['Serie_A', 'Serie A']),
    'Premier': Object.freeze(['EPL', 'Premier League']),
    'La Liga': Object.freeze(['La_liga', 'La liga', 'La Liga']),
    'Ligue 1': Object.freeze(['Ligue_1', 'Ligue 1']),
    'Bundesliga': Object.freeze(['Bundesliga'])
});

function apiLeagueSegments(leagueName, leagueSlug) {
    const values = [leagueSlug, ...(understatApiLeagueAliases[leagueName] || [])]
        .map(value => String(value || '').trim())
        .filter(Boolean);
    return [...new Set(values)];
}

function buildLeagueDataUrl(apiLeagueSegment, seasonStart) {
    return `https://understat.com/getLeagueData/${encodeURIComponent(apiLeagueSegment)}/${seasonStart}`;
}

const runtimeState = new Map();
const memoryCache = new Map();

function safeNumber(value) {
    if (value && typeof value === 'object' && value.value !== undefined) value = value.value;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** decimals;
    return Math.round((n + Number.EPSILON) * factor) / factor;
}

function decodeJsStringLiteral(input = '') {
    let out = '';
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch !== '\\') {
            out += ch;
            continue;
        }
        const next = input[++i];
        if (next === undefined) break;
        if (next === 'x') {
            const hex = input.slice(i + 1, i + 3);
            if (/^[0-9a-f]{2}$/i.test(hex)) {
                out += String.fromCharCode(parseInt(hex, 16));
                i += 2;
                continue;
            }
        }
        if (next === 'u') {
            const hex = input.slice(i + 1, i + 5);
            if (/^[0-9a-f]{4}$/i.test(hex)) {
                out += String.fromCharCode(parseInt(hex, 16));
                i += 4;
                continue;
            }
        }
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\', '/': '/' };
        out += Object.prototype.hasOwnProperty.call(map, next) ? map[next] : next;
    }
    return out;
}

function extractJsonParseVariable(html = '', variableName = 'teamsData') {
    const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`(?:var|let|const)\\s+${escaped}\\s*=\\s*JSON\\.parse\\(\\s*'((?:\\\\.|[^'])*)'\\s*\\)`, 's'),
        new RegExp(`(?:var|let|const)\\s+${escaped}\\s*=\\s*JSON\\.parse\\(\\s*"((?:\\\\.|[^"])*)"\\s*\\)`, 's'),
        new RegExp(`${escaped}\\s*=\\s*JSON\\.parse\\(\\s*'((?:\\\\.|[^'])*)'\\s*\\)`, 's')
    ];
    for (const pattern of patterns) {
        const match = String(html || '').match(pattern);
        if (!match) continue;
        const decoded = decodeJsStringLiteral(match[1]);
        try {
            return JSON.parse(decoded);
        } catch (error) {
            const wrapped = new Error(`UNDERSTAT_TEAMS_JSON_INVALID:${error.message}`);
            wrapped.code = 'UNDERSTAT_TEAMS_JSON_INVALID';
            throw wrapped;
        }
    }
    const error = new Error('UNDERSTAT_TEAMS_DATA_NOT_FOUND');
    error.code = 'UNDERSTAT_TEAMS_DATA_NOT_FOUND';
    throw error;
}

function parseTeamsData(rawTeams = {}) {
    const parsed = {};
    const rows = Array.isArray(rawTeams) ? rawTeams : Object.values(rawTeams || {});
    for (const team of rows) {
        if (!team || typeof team !== 'object') continue;
        const teamName = String(team.title || team.name || team.team || '').trim();
        if (!teamName) continue;
        const history = Array.isArray(team.history) ? team.history : [];
        let games = 0;
        let xgTotal = 0;
        let xgaTotal = 0;
        for (const match of history) {
            const xg = safeNumber(match?.xG ?? match?.xg);
            const xga = safeNumber(match?.xGA ?? match?.xga);
            if (xg === null || xga === null) continue;
            games++;
            xgTotal += xg;
            xgaTotal += xga;
        }
        if (!games) {
            const wins = safeNumber(team.W ?? team.wins) || 0;
            const draws = safeNumber(team.D ?? team.draws) || 0;
            const losses = safeNumber(team.L ?? team.losses) || 0;
            games = wins + draws + losses;
            const aggregateXg = safeNumber(team.xG ?? team.xg);
            const aggregateXga = safeNumber(team.xGA ?? team.xga);
            if (games > 0 && aggregateXg !== null && aggregateXga !== null) {
                xgTotal = aggregateXg;
                xgaTotal = aggregateXga;
            }
        }
        if (games <= 0 || !Number.isFinite(xgTotal) || !Number.isFinite(xgaTotal)) continue;
        parsed[teamName] = {
            xG_for: round(xgTotal / games, 3),
            xG_against: round(xgaTotal / games, 3),
            games,
            source: 'UNDERSTAT_TEAMS_DATA'
        };
    }
    return parsed;
}


function parseTeamsFromDates(rawDates = []) {
    const acc = new Map();
    for (const match of Array.isArray(rawDates) ? rawDates : []) {
        if (!match || typeof match !== 'object') continue;
        const h = match.h || {};
        const a = match.a || {};
        const homeName = String(h.title || h.name || '').trim();
        const awayName = String(a.title || a.name || '').trim();
        const hxg = safeNumber(match?.xG?.h ?? match?.xg?.h ?? match?.home_xg);
        const axg = safeNumber(match?.xG?.a ?? match?.xg?.a ?? match?.away_xg);
        const isResult = match.isResult === true || match.isResult === 1 || match.isResult === '1' || match.is_result === true;
        if (!homeName || !awayName || hxg === null || axg === null) continue;
        if (match.isResult !== undefined && !isResult) continue;
        for (const [name, xgf, xga] of [[homeName, hxg, axg], [awayName, axg, hxg]]) {
            if (!acc.has(name)) acc.set(name, { games: 0, xg: 0, xga: 0 });
            const row = acc.get(name);
            row.games += 1;
            row.xg += xgf;
            row.xga += xga;
        }
    }
    const out = {};
    for (const [name, row] of acc.entries()) {
        if (!row.games) continue;
        out[name] = {
            xG_for: round(row.xg / row.games, 3),
            xG_against: round(row.xga / row.games, 3),
            games: row.games,
            source: 'UNDERSTAT_DATES_XG_AGGREGATE'
        };
    }
    return out;
}


function enforceUnderstatEvidenceSource(teams = {}, source = 'UNDERSTAT_TEAMS_DATA') {
    const out = {};
    for (const [name, row] of Object.entries(teams || {})) {
        if (!row || typeof row !== 'object') continue;
        out[name] = {
            ...row,
            source,
            providerId: 'UNDERSTAT',
            evidenceClass: 'REAL_XG'
        };
    }
    return out;
}

function parseSeasonLabel(html = '') {
    const titleMatch = String(html).match(/for\s+the\s+(\d{4}\/\d{4})\s+season/i);
    if (titleMatch) return titleMatch[1];
    const selectedMatch = String(html).match(/(?:selected|active)[^>]*>\s*(\d{4}\/\d{4})\s*</i);
    if (selectedMatch) return selectedMatch[1];
    const firstSeason = String(html).match(/\b(20\d{2}\/20\d{2})\b/);
    return firstSeason ? firstSeason[1] : null;
}

function validateHtmlEnvelope(html = '', finalUrl = '') {
    const text = String(html || '');
    const lower = text.toLowerCase();
    if (!text || text.length < 500) {
        const error = new Error('UNDERSTAT_EMPTY_OR_TOO_SMALL_HTML');
        error.code = 'UNDERSTAT_EMPTY_OR_TOO_SMALL_HTML';
        error.structural = true;
        throw error;
    }
    const challengeSignals = ['cf-chl-', 'captcha', 'checking your browser', 'access denied', 'attention required'];
    if (challengeSignals.some(signal => lower.includes(signal))) {
        const error = new Error('UNDERSTAT_CHALLENGE_OR_ACCESS_DENIED');
        error.code = 'UNDERSTAT_CHALLENGE_OR_ACCESS_DENIED';
        error.structural = true;
        throw error;
    }
    if (finalUrl && !/^https:\/\/understat\.com\/league\//i.test(finalUrl)) {
        const error = new Error('UNDERSTAT_UNEXPECTED_REDIRECT');
        error.code = 'UNDERSTAT_UNEXPECTED_REDIRECT';
        error.structural = true;
        throw error;
    }
    if (!lower.includes('understat') || !lower.includes('teamsdata')) {
        const error = new Error('UNDERSTAT_PAGE_SCHEMA_NOT_RECOGNIZED');
        error.code = 'UNDERSTAT_PAGE_SCHEMA_NOT_RECOGNIZED';
        error.structural = true;
        throw error;
    }
}

function parseUnderstatLeagueHtml(html = '', options = {}) {
    validateHtmlEnvelope(html, options.finalUrl || '');
    const teamsData = extractJsonParseVariable(html, 'teamsData');
    const rawTeams = parseTeamsData(teamsData);
    const sanitized = sanitizeUnderstatData(rawTeams);
    const teamCount = Object.keys(sanitized.valid).length;
    if (teamCount < 8) {
        const error = new Error(`UNDERSTAT_INSUFFICIENT_VALID_TEAMS:${teamCount}`);
        error.code = 'UNDERSTAT_INSUFFICIENT_VALID_TEAMS';
        error.structural = true;
        throw error;
    }
    const certifiedTeams = enforceUnderstatEvidenceSource(sanitized.valid, 'UNDERSTAT_TEAMS_DATA');
    return {
        teams: certifiedTeams,
        metadata: {
            version: CALCIO_UNDERSTAT_PROVIDER_VERSION,
            parser: 'EMBEDDED_TEAMS_DATA_JSON',
            season: parseSeasonLabel(html),
            teamCount,
            rejectedCount: Object.keys(sanitized.rejected || {}).length,
            fetchedAt: new Date().toISOString(),
            source: options.source || 'DIRECT_HTTPS'
        }
    };
}

async function fetchLeagueHtml(url, options = {}) {
    const envelope = await fetchUnderstatText(url, {
        timeoutMs: options.timeoutMs,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'it-IT,it;q=0.9,en;q=0.8'
        }
    });
    return { html: envelope.text, finalUrl: envelope.finalUrl, statusCode: envelope.statusCode, headers: envelope.headers || {} };
}

async function fetchWithBrowser(url, options = {}) {
    let browser;
    try {
        let puppeteer;
        try { puppeteer = require('puppeteer'); }
        catch (_) {
            try { puppeteer = require('puppeteer-extra'); }
            catch (error) {
                const e = new Error('UNDERSTAT_BROWSER_RUNTIME_NOT_AVAILABLE');
                e.code = 'UNDERSTAT_BROWSER_RUNTIME_NOT_AVAILABLE';
                e.transient = true;
                throw e;
            }
        }
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) request.abort();
            else request.continue();
        });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(12000, Number(options.browserTimeoutMs) || 30000) });
        const html = await page.content();
        return { html, finalUrl: page.url(), statusCode: response?.status() || 200 };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}


async function recoverUnderstatSeasonWithSession(leagueName, leagueSlug, seasonStart, options = {}) {
    const seasonUrl = `https://understat.com/league/${leagueSlug}/${seasonStart}`;
    const htmlEnvelope = options.fetchSessionHtml
        ? await options.fetchSessionHtml(seasonUrl, { seasonStart, leagueName, leagueSlug })
        : await fetchLeagueHtml(seasonUrl, options);
    const cookie = cookieHeaderFromHeaders(htmlEnvelope.headers || {});

    if (cookie) {
        let lastAjaxError = null;
        for (const apiLeagueSegment of apiLeagueSegments(leagueName, leagueSlug)) {
            const ajaxUrl = buildLeagueDataUrl(apiLeagueSegment, seasonStart);
            try {
                const payload = options.fetchJsonWithCookie
                    ? await options.fetchJsonWithCookie(ajaxUrl, { seasonStart, leagueName, leagueSlug, apiLeagueSegment, cookie })
                    : await fetchLeagueJson(ajaxUrl, { ...options, cookie, referer: seasonUrl });
                const parsed = parseUnderstatLeagueJson(payload, { seasonStart, source: 'SESSION_AJAX_JSON' });
                parsed.metadata.recoveryVersion = AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION;
                parsed.metadata.sessionCookieBootstrap = true;
                parsed.metadata.apiLeagueSegment = apiLeagueSegment;
                parsed.metadata.wireRevision = AUDIT16D_R3_R3A_R4_WIRE_VERSION;
                return parsed;
            } catch (error) {
                lastAjaxError = error;
            }
        }
        if (lastAjaxError && options.disableHtmlAfterAjaxFailure === true) throw lastAjaxError;
    }

    const parsed = parseUnderstatLeagueHtml(htmlEnvelope.html, { finalUrl: htmlEnvelope.finalUrl || seasonUrl, source: 'SESSION_HTML_FALLBACK' });
    parsed.metadata.season = parsed.metadata.season || `${seasonStart}/${seasonStart + 1}`;
    parsed.metadata.recoveryVersion = AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION;
    parsed.metadata.sessionCookieBootstrap = Boolean(cookie);
    parsed.metadata.wireRevision = AUDIT16D_R3_R3A_R4_WIRE_VERSION;
    return parsed;
}

function seasonCandidatesForNow(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    const currentStart = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    return [currentStart, currentStart - 1];
}

function parseUnderstatLeagueJson(payload = {}, options = {}) {
    if (!payload || typeof payload !== 'object') {
        const error = new Error('UNDERSTAT_AJAX_OBJECT_REQUIRED');
        error.code = 'UNDERSTAT_AJAX_OBJECT_REQUIRED';
        error.structural = true;
        throw error;
    }
    const rawTeams = payload.teams || payload.team || null;
    const parsedFromTeams = rawTeams && typeof rawTeams === 'object' ? parseTeamsData(rawTeams) : {};
    let sanitized = sanitizeUnderstatData(parsedFromTeams);
    let parser = 'AJAX_GET_LEAGUE_DATA_JSON_TEAMS';
    let evidenceSource = 'UNDERSTAT_TEAMS_DATA';
    if (Object.keys(sanitized.valid).length < 8) {
        const parsedFromDates = parseTeamsFromDates(payload.dates || payload.matches || []);
        const fromDates = sanitizeUnderstatData(parsedFromDates);
        if (Object.keys(fromDates.valid).length > Object.keys(sanitized.valid).length) {
            sanitized = fromDates;
            parser = 'AJAX_GET_LEAGUE_DATA_JSON_DATES_AGGREGATE';
            evidenceSource = 'UNDERSTAT_DATES_XG_AGGREGATE';
        }
    }
    const teamCount = Object.keys(sanitized.valid).length;
    if (teamCount < 8) {
        const error = new Error(`UNDERSTAT_INSUFFICIENT_VALID_TEAMS:${teamCount}`);
        error.code = 'UNDERSTAT_INSUFFICIENT_VALID_TEAMS';
        error.structural = true;
        throw error;
    }
    const start = Number(options.seasonStart);
    const certifiedTeams = enforceUnderstatEvidenceSource(sanitized.valid, evidenceSource);
    return {
        teams: certifiedTeams,
        metadata: {
            version: CALCIO_UNDERSTAT_PROVIDER_VERSION,
            resilienceRevision: AUDIT16D_R3_R3A_UNDERSTAT_VERSION,
            provenanceRevision: AUDIT16D_R3_R3A_R2_PROVENANCE_VERSION,
            evidenceSource,
            evidenceClass: 'REAL_XG',
            ajaxContract: CALCIO_UNDERSTAT_AJAX_CONTRACT_VERSION,
            parser,
            season: Number.isFinite(start) ? `${start}/${start + 1}` : null,
            teamCount,
            rejectedCount: Object.keys(sanitized.rejected || {}).length,
            fetchedAt: new Date().toISOString(),
            source: options.source || 'DIRECT_AJAX_JSON'
        }
    };
}

function parseUnderstatAjaxText(text = '') {
    let clean = String(text || '').replace(/^\uFEFF/, '').trim();
    const prefixes = [")]}',", ")]}'", 'while(1);', 'for(;;);'];
    for (const prefix of prefixes) {
        if (clean.startsWith(prefix)) clean = clean.slice(prefix.length).trim();
    }
    let parsed;
    try {
        parsed = JSON.parse(clean);
    } catch (firstError) {
        const wrapped = clean.match(/^JSON\.parse\(\s*(['"])([\s\S]*)\1\s*\);?$/);
        if (!wrapped) {
            const error = new Error(`UNDERSTAT_AJAX_JSON_INVALID:${firstError.message}`);
            error.code = 'UNDERSTAT_AJAX_JSON_INVALID';
            error.structural = true;
            throw error;
        }
        try {
            parsed = JSON.parse(decodeJsStringLiteral(wrapped[2]));
        } catch (secondError) {
            const error = new Error(`UNDERSTAT_AJAX_JSON_INVALID:${secondError.message}`);
            error.code = 'UNDERSTAT_AJAX_JSON_INVALID';
            error.structural = true;
            throw error;
        }
    }
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); }
        catch (error) {
            const wrapped = new Error(`UNDERSTAT_AJAX_JSON_INVALID:${error.message}`);
            wrapped.code = 'UNDERSTAT_AJAX_JSON_INVALID';
            wrapped.structural = true;
            throw wrapped;
        }
    }
    if (!parsed || typeof parsed !== 'object') {
        const error = new Error('UNDERSTAT_AJAX_JSON_OBJECT_REQUIRED');
        error.code = 'UNDERSTAT_AJAX_JSON_OBJECT_REQUIRED';
        error.structural = true;
        throw error;
    }
    return parsed;
}

function cookieHeaderFromHeaders(headers = {}) {
    const raw = headers['set-cookie'] || headers['Set-Cookie'] || [];
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.map(value => String(value).split(';')[0].trim()).filter(Boolean).join('; ');
}

async function fetchLeagueJson(url, options = {}) {
    const envelope = await fetchUnderstatText(url, {
        json: true,
        timeoutMs: options.timeoutMs,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            accept: 'application/json,text/plain,*/*',
            'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
            'x-requested-with': 'XMLHttpRequest',
            referer: options.referer || 'https://understat.com/',
            ...(options.cookie ? { cookie: options.cookie } : {})
        }
    });
    const text = envelope.text.trim();
    if (!text || /^[<!]/.test(text)) {
        const error = new Error('UNDERSTAT_AJAX_NON_JSON_RESPONSE');
        error.code = 'UNDERSTAT_AJAX_NON_JSON_RESPONSE';
        error.structural = true;
        throw error;
    }
    return parseUnderstatAjaxText(text);
}

function getCacheDir(options = {}) {
    return options.cacheDir || path.join(__dirname, 'data', 'calcio_understat_v2');
}

function cacheFile(leagueName, options = {}) {
    const slug = String(leagueName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return path.join(getCacheDir(options), `${slug}.json`);
}

function writeLkg(leagueName, payload, options = {}) {
    const dir = getCacheDir(options);
    fs.mkdirSync(dir, { recursive: true });
    const file = cacheFile(leagueName, options);
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, leagueName, ...payload }, null, 2));
    fs.renameSync(temp, file);
}

function readLkg(leagueName, options = {}) {
    try {
        const raw = JSON.parse(fs.readFileSync(cacheFile(leagueName, options), 'utf8'));
        if (raw.schemaVersion !== CACHE_SCHEMA_VERSION || !raw.teams || Object.keys(raw.teams).length < 8) return null;
        return raw;
    } catch (_) {
        return null;
    }
}

function setState(leagueName, state = {}) {
    runtimeState.set(leagueName, { version: CALCIO_UNDERSTAT_PROVIDER_VERSION, leagueName, checkedAt: new Date().toISOString(), ...state });
}

function getUnderstatState(leagueName) {
    return runtimeState.get(leagueName) || {
        version: CALCIO_UNDERSTAT_PROVIDER_VERSION,
        leagueName,
        status: 'NOT_CHECKED',
        checkedAt: null
    };
}

function seasonStartYear(label) {
    const match = String(label || '').match(/(20\d{2})(?:\/(20\d{2}))?/);
    return match ? Number(match[1]) : null;
}

function expectedSeasonStartYear(kickoff) {
    const date = kickoff instanceof Date ? kickoff : new Date(kickoff);
    if (Number.isNaN(date.getTime())) return null;
    return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

function classifySeasonForKickoff(seasonLabel, kickoff) {
    const sourceStart = seasonStartYear(seasonLabel);
    const expectedStart = expectedSeasonStartYear(kickoff);
    if (sourceStart === null || expectedStart === null) return { status: 'UNKNOWN_SEASON', authorityWeight: 0.20, sourceStart, expectedStart };
    if (sourceStart === expectedStart) return { status: 'CURRENT_SEASON_XG', authorityWeight: 0.75, sourceStart, expectedStart };
    if (sourceStart === expectedStart - 1) return { status: 'PREVIOUS_SEASON_XG_PRIOR', authorityWeight: 0.25, sourceStart, expectedStart };
    return { status: 'STALE_XG', authorityWeight: 0.10, sourceStart, expectedStart };
}

function isCircuitOpen(leagueName) {
    const state = runtimeState.get(leagueName);
    return Boolean(state?.circuitOpenUntil && Date.parse(state.circuitOpenUntil) > Date.now());
}

async function getUnderstatxGInternal(leagueName, options = {}) {
    const leagueSlug = understatLeagueMap[leagueName];
    if (!leagueSlug) {
        setState(leagueName, { status: 'UNSUPPORTED_LEAGUE', teams: 0 });
        return {};
    }

    const memory = memoryCache.get(leagueName);
    if (!options.force && memory && Date.now() - memory.savedAt < MEMORY_TTL_MS) {
        setState(leagueName, { ...memory.metadata, status: 'READY_MEMORY_CACHE', source: 'MEMORY_CACHE' });
        return memory.teams;
    }

    if (!options.force && isCircuitOpen(leagueName)) {
        const prior = getUnderstatState(leagueName);
        const lkg = readLkg(leagueName, options);
        if (lkg) {
            setState(leagueName, { ...prior, ...lkg.metadata, circuitOpenUntil: prior.circuitOpenUntil, status: 'READY_LKG_CIRCUIT_OPEN', source: 'LKG', warning: 'Circuit breaker aperto dopo errore strutturale.' });
            return lkg.teams;
        }
        setState(leagueName, { ...prior, status: 'CIRCUIT_OPEN_NO_LKG', teams: 0 });
        return {};
    }

    const leagueUrl = `https://understat.com/league/${leagueSlug}`;
    const seasonCandidates = Array.isArray(options.seasonCandidates) && options.seasonCandidates.length
        ? options.seasonCandidates.map(Number).filter(Number.isFinite)
        : seasonCandidatesForNow(options.now || new Date());
    console.log(`🕵️ Understat V3: ${leagueName} · AJAX JSON ufficiale + fallback HTML/LKG.`);
    let lastError = null;
    let structuralFailure = false;

    for (const seasonStart of seasonCandidates) {
        try {
            let parsed = null;
            let lastAliasError = null;
            for (const apiLeagueSegment of apiLeagueSegments(leagueName, leagueSlug)) {
                const ajaxUrl = buildLeagueDataUrl(apiLeagueSegment, seasonStart);
                try {
                    const payload = options.fetchJson
                        ? await options.fetchJson(ajaxUrl, { seasonStart, leagueName, leagueSlug, apiLeagueSegment })
                        : await fetchLeagueJson(ajaxUrl, { ...options, referer: leagueUrl });
                    parsed = parseUnderstatLeagueJson(payload, { seasonStart, source: 'DIRECT_AJAX_JSON' });
                    parsed.metadata.apiLeagueSegment = apiLeagueSegment;
                    parsed.metadata.wireRevision = AUDIT16D_R3_R3A_R4_WIRE_VERSION;
                    break;
                } catch (aliasError) {
                    lastAliasError = aliasError;
                }
            }
            if (!parsed) throw lastAliasError || Object.assign(new Error('UNDERSTAT_AJAX_NO_VALID_ALIAS'), { code: 'UNDERSTAT_AJAX_NO_VALID_ALIAS', structural: true });
            const stored = { teams: parsed.teams, metadata: parsed.metadata };
            writeLkg(leagueName, stored, options);
            memoryCache.set(leagueName, { ...stored, savedAt: Date.now() });
            setState(leagueName, { ...parsed.metadata, resilienceRevision: AUDIT16D_R3_R3A_UNDERSTAT_VERSION, wireRevision: AUDIT16D_R3_R3A_R4_WIRE_VERSION, status: 'READY', source: parsed.metadata.source, teams: Object.keys(parsed.teams).length, circuitOpenUntil: null, seasonCandidates });
            console.log(`✅ Understat V3 ${leagueName}: ${Object.keys(parsed.teams).length} squadre · stagione ${parsed.metadata.season || 'N/D'} · AJAX JSON (${parsed.metadata.apiLeagueSegment}).`);
            return parsed.teams;
        } catch (error) {
            lastError = error;
            structuralFailure = structuralFailure || error.structural === true;
            const unavailableSeason = error.notFound || ['UNDERSTAT_AJAX_HTTP_404', 'UNDERSTAT_INSUFFICIENT_VALID_TEAMS'].includes(error.code);
            console.warn(`⚠️ Understat V3 ${leagueName} stagione ${seasonStart}/${seasonStart + 1}: ${error.code || error.message}${unavailableSeason ? ' · provo stagione precedente' : ''}.`);

            const sessionRecoverable = !unavailableSeason && [
                'UNDERSTAT_AJAX_NON_JSON_RESPONSE',
                'UNDERSTAT_AJAX_JSON_INVALID',
                'UNDERSTAT_AJAX_JSON_OBJECT_REQUIRED',
                'UNDERSTAT_AJAX_HTTP_403'
            ].includes(error.code);
            if (sessionRecoverable && options.disableSessionRecovery !== true) {
                try {
                    const recovered = await recoverUnderstatSeasonWithSession(leagueName, leagueSlug, seasonStart, options);
                    const stored = { teams: recovered.teams, metadata: recovered.metadata };
                    writeLkg(leagueName, stored, options);
                    memoryCache.set(leagueName, { ...stored, savedAt: Date.now() });
                    setState(leagueName, { ...recovered.metadata, resilienceRevision: AUDIT16D_R3_R3A_UNDERSTAT_VERSION, status: 'READY_SESSION_RECOVERY', source: recovered.metadata.source, teams: Object.keys(recovered.teams).length, circuitOpenUntil: null, seasonCandidates });
                    console.log(`✅ Understat V3 ${leagueName}: recupero sessione riuscito · ${Object.keys(recovered.teams).length} squadre · ${recovered.metadata.source}.`);
                    return recovered.teams;
                } catch (recoveryError) {
                    lastError = recoveryError;
                    structuralFailure = structuralFailure || recoveryError.structural === true;
                    console.warn(`⚠️ Understat V3 ${leagueName}: recovery sessione non risolutiva (${recoveryError.code || recoveryError.message}).`);
                }
            }
            if (!unavailableSeason && error.structural && !sessionRecoverable) break;
        }
    }

    // Compatibility fallback: useful if Understat restores embedded teamsData.
    try {
        const envelope = options.fetchHtml
            ? await options.fetchHtml(leagueUrl, { leagueName, leagueSlug, seasonCandidates })
            : await fetchLeagueHtml(leagueUrl, options);
        const parsed = parseUnderstatLeagueHtml(envelope.html, { finalUrl: envelope.finalUrl, source: 'DIRECT_HTML_FALLBACK' });
        const stored = { teams: parsed.teams, metadata: parsed.metadata };
        writeLkg(leagueName, stored, options);
        memoryCache.set(leagueName, { ...stored, savedAt: Date.now() });
        setState(leagueName, { ...parsed.metadata, resilienceRevision: AUDIT16D_R3_R3A_UNDERSTAT_VERSION, status: 'READY_HTML_FALLBACK', teams: Object.keys(parsed.teams).length, circuitOpenUntil: null, seasonCandidates });
        return parsed.teams;
    } catch (error) {
        lastError = error;
    }

    // Slow public-page fallback. No anti-bot bypass: it only renders the same public league page
    // when direct JSON/session/HTML parsing did not yield certified xG.
    if (options.disableBrowserFallback !== true && String(process.env.CALCIO_UNDERSTAT_BROWSER_FALLBACK || '1') !== '0') {
        try {
            const browserEnvelope = options.fetchBrowserHtml
                ? await options.fetchBrowserHtml(leagueUrl, { leagueName, leagueSlug, seasonCandidates })
                : await fetchWithBrowser(leagueUrl, options);
            const parsed = parseUnderstatLeagueHtml(browserEnvelope.html, {
                finalUrl: browserEnvelope.finalUrl || leagueUrl,
                source: 'BROWSER_PUBLIC_HTML_FALLBACK'
            });
            parsed.metadata.resilienceRevision = AUDIT16D_R3_R3A_UNDERSTAT_VERSION;
            const stored = { teams: parsed.teams, metadata: parsed.metadata };
            writeLkg(leagueName, stored, options);
            memoryCache.set(leagueName, { ...stored, savedAt: Date.now() });
            setState(leagueName, {
                ...parsed.metadata,
                status: 'READY_BROWSER_SCRAPE',
                teams: Object.keys(parsed.teams).length,
                circuitOpenUntil: null,
                seasonCandidates
            });
            console.log(`✅ Understat R3_R3A ${leagueName}: browser pubblico fallback · ${Object.keys(parsed.teams).length} squadre.`);
            return parsed.teams;
        } catch (browserError) {
            lastError = browserError;
            console.warn(`⚠️ Understat R3_R3A ${leagueName}: browser fallback non disponibile (${browserError.code || browserError.message}).`);
        }
    }

    const lkg = readLkg(leagueName, options);
    const structural = structuralFailure || lastError?.structural === true || [
        'UNDERSTAT_TEAMS_DATA_NOT_FOUND', 'UNDERSTAT_INSUFFICIENT_VALID_TEAMS',
        'UNDERSTAT_PAGE_SCHEMA_NOT_RECOGNIZED', 'UNDERSTAT_CHALLENGE_OR_ACCESS_DENIED',
        'UNDERSTAT_AJAX_NON_JSON_RESPONSE', 'UNDERSTAT_AJAX_JSON_INVALID'
    ].includes(lastError?.code);
    const circuitOpenUntil = structural ? new Date(Date.now() + CIRCUIT_BREAKER_MS).toISOString() : null;
    if (lkg) {
        setState(leagueName, {
            ...lkg.metadata,
            status: 'READY_LKG_AFTER_ERROR',
            source: 'LKG',
            teams: Object.keys(lkg.teams).length,
            error: lastError?.code || lastError?.message || 'UNKNOWN',
            circuitOpenUntil,
            seasonCandidates
        });
        console.warn(`⚠️ Understat V3 ${leagueName}: uso Last-Known-Good dopo errore ${lastError?.code || lastError?.message}.`);
        return lkg.teams;
    }

    setState(leagueName, {
        status: 'UNAVAILABLE_FALLBACK_PROXY',
        source: 'NONE',
        teams: 0,
        error: lastError?.code || lastError?.message || 'UNKNOWN',
        circuitOpenUntil,
        seasonCandidates
    });
    console.warn(`⚠️ Understat V3 ${leagueName}: nessun dato valido; GOAL_SHOT_PROXY resta separato.`);
    return {};
}

async function getUnderstatxG(leagueName, options = {}) {
    const started = process.hrtime.bigint();
    try { return await getUnderstatxGInternal(leagueName, options); }
    finally {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        console.log('[CALCIO R5 UNDERSTAT] ' + JSON.stringify({
            league: leagueName, durationMs: Math.round(durationMs),
            status: getUnderstatState(leagueName).status,
            circuitOpenUntil: getUnderstatState(leagueName).circuitOpenUntil || null
        }));
    }
}

function resetUnderstatRuntimeForTests() {
    runtimeState.clear();
    memoryCache.clear();
}

module.exports = {
    CALCIO_UNDERSTAT_PROVIDER_VERSION,
    AUDIT16D_R3_UNDERSTAT_RECOVERY_VERSION,
    AUDIT16D_R3_R3A_UNDERSTAT_VERSION,
    AUDIT16D_R3_R3A_R2_PROVENANCE_VERSION,
    AUDIT16D_R3_R3A_R4_WIRE_VERSION,
    CACHE_SCHEMA_VERSION,
    understatLeagueMap,
    understatApiLeagueAliases,
    apiLeagueSegments,
    buildLeagueDataUrl,
    decodeJsStringLiteral,
    extractJsonParseVariable,
    parseTeamsData,
    parseTeamsFromDates,
    enforceUnderstatEvidenceSource,
    parseSeasonLabel,
    parseUnderstatLeagueHtml,
    parseUnderstatLeagueJson,
    parseUnderstatAjaxText,
    cookieHeaderFromHeaders,
    recoverUnderstatSeasonWithSession,
    fetchWithBrowser,
    fetchLeagueJson,
    seasonCandidatesForNow,
    classifySeasonForKickoff,
    getUnderstatxG,
    getUnderstatState,
    resetUnderstatRuntimeForTests
};
