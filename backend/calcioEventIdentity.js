'use strict';

const crypto = require('crypto');

const CALCIO_EVENT_IDENTITY_VERSION = 'CALCIO_PATCH_10_EVENT_IDENTITY_V1';

const TEAM_ALIASES = new Map(Object.entries({
    'man utd': 'manchester united',
    'man united': 'manchester united',
    'man city': 'manchester city',
    'inter milan': 'internazionale',
    'inter': 'internazionale',
    'ac milan': 'milan',
    'as roma': 'roma',
    'ath madrid': 'atletico madrid',
    'athletic bilbao': 'athletic club',
    'ein frankfurt': 'eintracht frankfurt',
    'm gladbach': 'borussia monchengladbach',
    'gladbach': 'borussia monchengladbach',
    'fc schalke 04': 'schalke 04'
}));

function normalizeToken(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function canonicalTeam(value = '') {
    const normalized = normalizeToken(value);
    return TEAM_ALIASES.get(normalized) || normalized;
}

function safeIso(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableDigest(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function buildPairKey(event = {}, context = {}) {
    return [
        'calcio-pair',
        normalizeToken(context.leagueKey || context.leagueName || event.sport_key || event.league || 'unknown'),
        canonicalTeam(event.home_team || event.home || ''),
        canonicalTeam(event.away_team || event.away || '')
    ].join('|');
}

function buildEventKey(event = {}, context = {}) {
    const providerId = String(event.id || event.event_id || event.provider_event_id || '').trim();
    const pairKey = buildPairKey(event, context);
    if (providerId) {
        return ['calcio-event', normalizeToken(context.provider || 'odds-api'), normalizeToken(context.leagueKey || context.leagueName || event.sport_key || 'unknown'), providerId].join('|');
    }
    const kickoff = safeIso(event.commence_time || event.kickoff || event.match_date || event.date) || 'no-kickoff';
    return `calcio-event|fallback|${stableDigest(`${pairKey}|${kickoff}`)}`;
}

function getLatestBookmakerUpdate(event = {}) {
    let latest = 0;
    for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
        const candidates = [bookmaker.last_update, bookmaker.lastUpdate];
        for (const value of candidates) {
            const time = Date.parse(value);
            if (Number.isFinite(time)) latest = Math.max(latest, time);
        }
        for (const market of Array.isArray(bookmaker.markets) ? bookmaker.markets : []) {
            const time = Date.parse(market.last_update || market.lastUpdate);
            if (Number.isFinite(time)) latest = Math.max(latest, time);
        }
    }
    return latest;
}

function marketCoverage(event = {}) {
    let completeH2H = 0;
    let completeTotals = 0;
    let marketCount = 0;
    for (const bookmaker of Array.isArray(event.bookmakers) ? event.bookmakers : []) {
        for (const market of Array.isArray(bookmaker.markets) ? bookmaker.markets : []) {
            marketCount++;
            const key = String(market.key || '').toLowerCase();
            const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
            if (key === 'h2h') {
                const names = outcomes.map(row => normalizeToken(row.name));
                const hasHome = names.includes(normalizeToken(event.home_team));
                const hasAway = names.includes(normalizeToken(event.away_team));
                const hasDraw = names.includes('draw') || names.includes('x') || names.includes('pareggio');
                if (hasHome && hasAway && hasDraw) completeH2H++;
            }
            if (key === 'totals') {
                const hasOver = outcomes.some(row => normalizeToken(row.name).includes('over') && Number.isFinite(Number(row.point)));
                const hasUnder = outcomes.some(row => normalizeToken(row.name).includes('under') && Number.isFinite(Number(row.point)));
                if (hasOver && hasUnder) completeTotals++;
            }
        }
    }
    return {
        completeH2H,
        completeTotals,
        bookmakerCount: Array.isArray(event.bookmakers) ? event.bookmakers.length : 0,
        marketCount,
        latestUpdateMs: getLatestBookmakerUpdate(event)
    };
}

function rankEvent(event = {}, now = new Date()) {
    const coverage = marketCoverage(event);
    const kickoffMs = Date.parse(event.commence_time || event.kickoff || event.match_date || event.date);
    const futureDistance = Number.isFinite(kickoffMs)
        ? Math.max(0, kickoffMs - now.getTime())
        : Number.MAX_SAFE_INTEGER;
    return {
        ...coverage,
        kickoffMs: Number.isFinite(kickoffMs) ? kickoffMs : 0,
        futureDistance
    };
}

function compareRank(a, b) {
    const fields = ['completeH2H', 'completeTotals', 'bookmakerCount', 'marketCount', 'latestUpdateMs'];
    for (const field of fields) {
        if (a.rank[field] !== b.rank[field]) return b.rank[field] - a.rank[field];
    }
    if (a.rank.futureDistance !== b.rank.futureDistance) return a.rank.futureDistance - b.rank.futureDistance;
    return String(a.event.id || '').localeCompare(String(b.event.id || ''));
}

function enrichEvent(event = {}, context = {}, group = []) {
    const kickoffIso = safeIso(event.commence_time || event.kickoff || event.match_date || event.date);
    const pairKey = buildPairKey(event, context);
    const eventKey = buildEventKey(event, context);
    const conflictKickoffs = [...new Set(group.map(row => safeIso(row.commence_time || row.kickoff || row.match_date || row.date)).filter(Boolean))];
    const providerIds = [...new Set(group.map(row => String(row.id || row.event_id || '').trim()).filter(Boolean))];
    return {
        ...event,
        calcioEventIdentity: {
            version: CALCIO_EVENT_IDENTITY_VERSION,
            eventKey,
            canonicalPairKey: pairKey,
            providerEventId: String(event.id || event.event_id || '').trim() || null,
            kickoffIso,
            status: group.length <= 1 ? 'UNIQUE' : (conflictKickoffs.length > 1 ? 'PAIR_KICKOFF_CONFLICT_RESOLVED' : 'DUPLICATE_PROVIDER_EVENT_RESOLVED'),
            duplicateCount: Math.max(0, group.length - 1),
            candidateCount: group.length,
            conflictKickoffs,
            providerIds,
            selectionReason: group.length <= 1
                ? 'Singolo evento nel feed.'
                : 'Selezione indipendente dall’edge: copertura mercati completi, aggiornamento bookmaker più recente e kickoff futuro più vicino.'
        }
    };
}

function deduplicateCalcioEvents(events = [], context = {}) {
    const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
    const groups = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        if (!event || typeof event !== 'object') continue;
        const key = buildPairKey(event, context);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
    }

    const canonicalEvents = [];
    const conflicts = [];
    for (const [pairKey, group] of groups.entries()) {
        const ranked = group.map(event => ({ event, rank: rankEvent(event, now) })).sort(compareRank);
        const selected = enrichEvent(ranked[0].event, context, group);
        canonicalEvents.push(selected);
        if (group.length > 1) {
            conflicts.push({
                pairKey,
                selectedEventKey: selected.calcioEventIdentity.eventKey,
                status: selected.calcioEventIdentity.status,
                candidates: ranked.map(row => ({
                    id: row.event.id || null,
                    kickoff: safeIso(row.event.commence_time),
                    rank: row.rank
                }))
            });
        }
    }

    canonicalEvents.sort((a, b) => {
        const ta = Date.parse(a.commence_time) || 0;
        const tb = Date.parse(b.commence_time) || 0;
        return ta - tb || String(a.home_team || '').localeCompare(String(b.home_team || ''));
    });

    return {
        version: CALCIO_EVENT_IDENTITY_VERSION,
        events: canonicalEvents,
        diagnostics: {
            rawCount: Array.isArray(events) ? events.length : 0,
            canonicalCount: canonicalEvents.length,
            duplicatesRemoved: Math.max(0, (Array.isArray(events) ? events.length : 0) - canonicalEvents.length),
            conflictCount: conflicts.length,
            conflicts,
            edgeUsedForSelection: false
        }
    };
}

function deduplicateCalcioBets(bets = []) {
    const byPair = new Map();
    for (const bet of Array.isArray(bets) ? bets : []) {
        const pairKey = bet.canonical_pair_key || bet.extData?.eventIdentity?.canonicalPairKey || buildPairKey({ home_team: bet.home, away_team: bet.away }, { leagueName: bet.league });
        const existing = byPair.get(pairKey);
        if (!existing) {
            byPair.set(pairKey, bet);
            continue;
        }
        const currentUpdate = Number(bet.event_selection_latest_update_ms || bet.extData?.eventIdentity?.latestUpdateMs || 0);
        const existingUpdate = Number(existing.event_selection_latest_update_ms || existing.extData?.eventIdentity?.latestUpdateMs || 0);
        if (currentUpdate > existingUpdate) byPair.set(pairKey, bet);
    }
    return [...byPair.values()];
}

module.exports = {
    CALCIO_EVENT_IDENTITY_VERSION,
    normalizeToken,
    canonicalTeam,
    buildPairKey,
    buildEventKey,
    marketCoverage,
    deduplicateCalcioEvents,
    deduplicateCalcioBets
};
