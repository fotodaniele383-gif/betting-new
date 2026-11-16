'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const entityResolution = require('./calcioEntityResolution');

const CALCIO_CLUB_ELO_PROVIDER_VERSION = 'BETTING_PATCH_14_CLUB_ELO_ZERO_KEY_LKG_V1';
const CACHE_SCHEMA_VERSION = 'BETTING_PATCH_14_CLUB_ELO_CACHE_V1';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 7000;
let memory = null;
let inFlight = null;

function finite(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 2) {
    const n = finite(value, null);
    return n === null ? null : Number(n.toFixed(decimals));
}
function formatDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
}
function parseCsvLine(line = '') {
    const out = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { value += '"'; i++; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) { out.push(value.trim()); value = ''; }
        else value += ch;
    }
    out.push(value.trim());
    return out;
}
function parseClubEloCsv(csv = '', options = {}) {
    const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw Object.assign(new Error('CLUB_ELO_EMPTY_CSV'), { code: 'CLUB_ELO_EMPTY_CSV' });
    const headers = parseCsvLine(lines.shift()).map(h => h.toLowerCase());
    const idx = name => headers.indexOf(name.toLowerCase());
    const clubIndex = idx('club');
    const eloIndex = idx('elo');
    if (clubIndex < 0 || eloIndex < 0) throw Object.assign(new Error('CLUB_ELO_SCHEMA_INVALID'), { code: 'CLUB_ELO_SCHEMA_INVALID' });
    const ratings = {};
    for (const line of lines) {
        const cols = parseCsvLine(line);
        const club = String(cols[clubIndex] || '').trim();
        const elo = finite(cols[eloIndex], null);
        if (!club || elo === null || elo < 800 || elo > 2600) continue;
        ratings[club] = {
            club,
            elo: round(elo, 2),
            country: idx('country') >= 0 ? String(cols[idx('country')] || '').trim() : null,
            rank: idx('rank') >= 0 ? finite(cols[idx('rank')], null) : null,
            from: idx('from') >= 0 ? String(cols[idx('from')] || '').trim() : null,
            to: idx('to') >= 0 ? String(cols[idx('to')] || '').trim() : null
        };
    }
    if (Object.keys(ratings).length < (options.minimumRows || 50)) {
        throw Object.assign(new Error(`CLUB_ELO_INSUFFICIENT_ROWS:${Object.keys(ratings).length}`), { code: 'CLUB_ELO_INSUFFICIENT_ROWS' });
    }
    return ratings;
}
function cachePath(options = {}) {
    return options.cacheFile || path.join(__dirname, 'data', 'calcio_club_elo_lkg.json');
}
function readLkg(options = {}) {
    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath(options), 'utf8'));
        if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !parsed.ratings || Object.keys(parsed.ratings).length < 50) return null;
        return parsed;
    } catch (_) { return null; }
}
function writeLkg(payload, options = {}) {
    const file = cachePath(options);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, ...payload }, null, 2));
    fs.renameSync(temp, file);
}
function fetchText(url, options = {}) {
    if (typeof options.fetchText === 'function') return options.fetchText(url);
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, {
            timeout: options.timeoutMs || TIMEOUT_MS,
            headers: { 'user-agent': 'BettingApp/14 ClubElo zero-key cache', accept: 'text/csv,text/plain,*/*' }
        }, response => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                return fetchText(new URL(response.headers.location, url).toString(), options).then(resolve, reject);
            }
            if (status !== 200) {
                response.resume();
                return reject(Object.assign(new Error(`CLUB_ELO_HTTP_${status}`), { code: `CLUB_ELO_HTTP_${status}` }));
            }
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > 5 * 1024 * 1024) {
                    req.destroy();
                    reject(Object.assign(new Error('CLUB_ELO_RESPONSE_TOO_LARGE'), { code: 'CLUB_ELO_RESPONSE_TOO_LARGE' }));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('CLUB_ELO_TIMEOUT'), { code: 'CLUB_ELO_TIMEOUT' })); });
        req.on('error', error => reject(error));
    });
}
async function loadClubEloSnapshot(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (!options.force && memory && now.getTime() - Date.parse(memory.fetchedAt) < TTL_MS) return { ...memory, source: 'MEMORY_CACHE' };
    if (!options.force && inFlight) return inFlight;
    inFlight = (async () => {
        const date = formatDate(now);
        const urls = options.urls || [`https://api.clubelo.com/${date}`, `http://api.clubelo.com/${date}`];
        let lastError = null;
        for (const url of urls) {
            try {
                const csv = await fetchText(url, options);
                const ratings = parseClubEloCsv(csv, options);
                const payload = {
                    version: CALCIO_CLUB_ELO_PROVIDER_VERSION,
                    status: 'AVAILABLE',
                    source: 'DIRECT_ZERO_KEY_CSV',
                    sourceUrl: url,
                    snapshotDate: date,
                    fetchedAt: now.toISOString(),
                    ratingCount: Object.keys(ratings).length,
                    ratings
                };
                writeLkg(payload, options);
                memory = payload;
                return payload;
            } catch (error) { lastError = error; }
        }
        const lkg = readLkg(options);
        if (lkg) {
            memory = { ...lkg, status: 'AVAILABLE_LKG', source: 'LKG', warning: lastError?.code || lastError?.message || 'NETWORK_UNAVAILABLE' };
            return memory;
        }
        return {
            version: CALCIO_CLUB_ELO_PROVIDER_VERSION,
            status: 'UNAVAILABLE',
            source: 'NONE',
            sourceUrl: null,
            snapshotDate: date,
            fetchedAt: now.toISOString(),
            ratingCount: 0,
            ratings: {},
            error: lastError?.code || lastError?.message || 'CLUB_ELO_UNAVAILABLE'
        };
    })();
    try { return await inFlight; } finally { inFlight = null; }
}
function buildMatchEvidence(snapshot = {}, homeTeam = '', awayTeam = '', options = {}) {
    const candidates = Object.keys(snapshot.ratings || {});
    const homeResolution = entityResolution.resolveTeamName(homeTeam, candidates, { threshold: options.threshold || 0.80 });
    const awayResolution = entityResolution.resolveTeamName(awayTeam, candidates, { threshold: options.threshold || 0.80 });
    const homeRating = homeResolution.matched ? snapshot.ratings[homeResolution.resolved] : null;
    const awayRating = awayResolution.matched ? snapshot.ratings[awayResolution.resolved] : null;
    const bothMatched = Boolean(homeRating && awayRating);
    const fetchedMs = Date.parse(snapshot.fetchedAt || '');
    const ageHours = Number.isFinite(fetchedMs) ? Math.max(0, (Date.now() - fetchedMs) / 3600000) : null;
    const fresh = ageHours !== null && ageHours <= 72;
    return {
        version: CALCIO_CLUB_ELO_PROVIDER_VERSION,
        status: bothMatched ? (fresh ? 'AVAILABLE' : 'AVAILABLE_LKG') : snapshot.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PARTIAL',
        available: bothMatched,
        authoritative: bothMatched && fresh,
        source: snapshot.source || 'NONE',
        snapshotDate: snapshot.snapshotDate || null,
        fetchedAt: snapshot.fetchedAt || null,
        ageHours: round(ageHours, 1),
        home: homeRating ? { ...homeRating, resolution: homeResolution } : { resolution: homeResolution },
        away: awayRating ? { ...awayRating, resolution: awayResolution } : { resolution: awayResolution },
        eloDifference: bothMatched ? round(homeRating.elo - awayRating.elo, 2) : null,
        matchConfidence: bothMatched ? round(Math.min(homeResolution.confidence, awayResolution.confidence) * 100, 1) : 0,
        detail: bothMatched
            ? `Rating ClubElo riconciliati ${homeResolution.resolved} ${homeRating.elo} / ${awayResolution.resolved} ${awayRating.elo}; snapshot ${snapshot.snapshotDate || 'N/D'}.`
            : `ClubElo non riconciliato 2/2: home ${homeResolution.method}, away ${awayResolution.method}.`
    };
}
function resetForTests() { memory = null; inFlight = null; }

module.exports = {
    CALCIO_CLUB_ELO_PROVIDER_VERSION,
    CACHE_SCHEMA_VERSION,
    TTL_MS,
    parseClubEloCsv,
    loadClubEloSnapshot,
    buildMatchEvidence,
    readLkg,
    resetForTests
};
