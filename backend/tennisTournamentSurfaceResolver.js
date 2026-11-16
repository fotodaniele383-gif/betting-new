// ============================================================================
// STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG
// Tennis tournament surface resolver: tournament catalog/date lock wins over
// provider/default. Preserves Step83 public contract and adds audit metadata.
// ============================================================================
'use strict';

const {
    STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION,
    resolveTournamentCatalogContext,
    surfaceRegimeKeyFor,
    normalizeTournamentText
} = require('./tennisTournamentCatalog');

function norm(value = '') {
    return normalizeTournamentText(value);
}

function parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    const text = String(raw).trim();
    const italian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (italian) {
        const [, dd, mm, yyyy] = italian;
        const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeProviderSurface(surface) {
    const s = norm(surface);
    if (!s) return null;
    if (s.includes('clay') || s.includes('terra')) return 'Clay';
    if (s.includes('grass') || s.includes('erba')) return 'Grass';
    if (s.includes('indoor') && (s.includes('hard') || s.includes('cemento'))) return 'Hard';
    if (s.includes('hard') || s.includes('cemento')) return 'Hard';
    if (['hard', 'clay', 'grass'].includes(s)) return s.charAt(0).toUpperCase() + s.slice(1);
    return null;
}

function isProviderIndoor(surface) {
    const s = norm(surface);
    return !!s && s.includes('indoor');
}

function includesAny(text, patterns) {
    return patterns.some(pattern => text.includes(pattern));
}

// Legacy Step83 lists retained as fallback for tournaments outside Step111.
const CLAY = [
    'roland garros', 'french open', 'internationaux de france',
    'monte carlo', 'montecarlo',
    'madrid open', 'mutua madrid', 'madrid masters',
    'italian open', 'internazionali bnl', 'rome', 'roma',
    'barcelona open', 'barcelona', 'conde de godo',
    'hamburg open', 'hamburg',
    'gstaad', 'bastad', 'baastad', 'umag', 'estoril', 'kitzbuhel', 'kitzbuehel',
    'geneva', 'lyon', 'munich', 'muenchen', 'buenos aires', 'rio open', 'marrakech',
    'houston', 'charleston', 'palermo', 'porsche tennis grand prix'
];

const GRASS = [
    'wimbledon',
    'queens club', 'queen s club', 'queen club', 'cinch championships',
    'halle', 'terra wortmann',
    's hertogenbosch', 'hertogenbosch', 'libema open',
    'eastbourne', 'mallorca', 'nottingham', 'newport', 'berlin open', 'bett1 open'
];

const HARD_OUTDOOR = [
    'australian open', 'us open', 'indian wells', 'bnp paribas open',
    'miami open', 'canadian open', 'montreal', 'toronto', 'rogers cup', 'national bank open',
    'cincinnati', 'china open', 'beijing', 'shanghai masters', 'shanghai', 'doha', 'dubai',
    'guadalajara', 'washington', 'citi open', 'tokyo', 'brisbane', 'adelaide', 'abu dhabi',
    'san diego', 'zhengzhou', 'acapulco'
];

const HARD_INDOOR = [
    'atp finals', 'wta finals', 'tour finals', 'basel', 'swiss indoors',
    'vienna', 'erste bank open', 'paris masters', 'rolex paris masters', 'bercy',
    'rotterdam', 'abn amro open', 'ostrava'
];

function resolveByName(text) {
    const t = norm(text);
    if (!t) return null;

    // Paris Masters/Bercy must not be confused with Roland Garros.
    if (includesAny(t, HARD_INDOOR)) return { surface: 'Hard', indoor: true, surfaceDetail: 'Cemento indoor', surfaceRegimeKey: 'indoor_hard', ruleId: 'HARD_INDOOR_TOURNAMENT_LOCK' };
    if (includesAny(t, CLAY)) return { surface: 'Clay', indoor: t.includes('indoor'), surfaceDetail: t.includes('charleston') ? 'Terra verde' : (t.includes('stuttgart') || t.includes('porsche tennis grand prix') ? 'Terra indoor' : 'Terra'), surfaceRegimeKey: 'clay', ruleId: 'CLAY_TOURNAMENT_LOCK' };
    if (includesAny(t, GRASS)) return { surface: 'Grass', indoor: false, surfaceDetail: 'Erba', surfaceRegimeKey: 'grass', ruleId: 'GRASS_TOURNAMENT_LOCK' };
    if (includesAny(t, HARD_OUTDOOR)) return { surface: 'Hard', indoor: false, surfaceDetail: 'Cemento', surfaceRegimeKey: 'hard', ruleId: 'HARD_OUTDOOR_TOURNAMENT_LOCK' };
    return null;
}

function resolveGrandSlamByCalendar(text, date) {
    const t = norm(text);
    if (!t.includes('grand slam')) return null;
    const d = parseDate(date);
    if (!d) return null;
    const month = d.getUTCMonth() + 1;
    if (month === 1 || month === 2) return { surface: 'Hard', indoor: false, surfaceDetail: 'Cemento', surfaceRegimeKey: 'hard', ruleId: 'GRAND_SLAM_CALENDAR_AUSTRALIAN_OPEN_HARD' };
    if (month === 5 || month === 6) return { surface: 'Clay', indoor: false, surfaceDetail: 'Terra', surfaceRegimeKey: 'clay', ruleId: 'GRAND_SLAM_CALENDAR_ROLAND_GARROS_CLAY' };
    if (month === 6 || month === 7) return { surface: 'Grass', indoor: false, surfaceDetail: 'Erba', surfaceRegimeKey: 'grass', ruleId: 'GRAND_SLAM_CALENDAR_WIMBLEDON_GRASS' };
    if (month === 8 || month === 9) return { surface: 'Hard', indoor: false, surfaceDetail: 'Cemento', surfaceRegimeKey: 'hard', ruleId: 'GRAND_SLAM_CALENDAR_US_OPEN_HARD' };
    return null;
}

function buildLockedResponse(locked, providerSurface, source) {
    const indoor = locked.indoor === true;
    return {
        surface: locked.surface,
        modelSurface: locked.surface,
        surfaceLabel: locked.surfaceDetail || locked.surface,
        surfaceDetail: locked.surfaceDetail || locked.surface,
        surfaceRegimeKey: locked.surfaceRegimeKey || surfaceRegimeKeyFor(locked.surface, indoor),
        confidence: source === 'step111_tournament_catalog_lock' ? 0.995 : (source === 'tournament_surface_lock' ? 0.99 : 0.88),
        source,
        ruleId: locked.ruleId,
        indoor,
        isFallback: false,
        providerSurface,
        overriddenProviderSurface: providerSurface && providerSurface !== locked.surface ? providerSurface : null,
        catalogVersion: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION,
        ...(locked.catalogId ? {
            tournamentCatalogId: locked.catalogId,
            tournamentCanonicalName: locked.tournamentCanonicalName || locked.canonicalName,
            tournamentName: locked.tournamentName || locked.canonicalName,
            tournamentCategory: locked.tournamentCategory,
            tournamentLevel: locked.tournamentLevel,
            tournamentCountry: locked.country,
            tournamentPeriod: locked.period,
            tour: locked.tour,
            seriesLabel: locked.seriesLabel
        } : {})
    };
}

function resolveTennisTournamentSurface(context = {}) {
    const tournamentText = [
        context.tournament,
        context.tournamentName,
        context.eventName,
        context.league,
        context.competition,
        context.circuit,
        context.title,
        context.sportKey,
        context.key,
        context.series
    ].filter(Boolean).join(' ');

    const rawProviderSurface = context.providerSurface ?? context.surface ?? context.courtSurface ?? context.directSurface;
    const providerSurface = normalizeProviderSurface(rawProviderSurface);
    const providerIndoor = isProviderIndoor(rawProviderSurface);
    const date = context.date ?? context.match_date ?? context.commence_time ?? context.startTime;

    const catalog = resolveTournamentCatalogContext({ ...context, tournament: context.tournament || tournamentText });
    if (catalog && catalog.isCatalogMatch) {
        return buildLockedResponse({
            ...catalog,
            surface: catalog.modelSurface,
            surfaceDetail: catalog.surfaceDetail,
            indoor: catalog.indoor,
            ruleId: catalog.ruleId,
            catalogId: catalog.catalogId
        }, providerSurface, 'tournament_surface_lock');
    }

    const byName = resolveByName(tournamentText);
    const byCalendar = resolveGrandSlamByCalendar(tournamentText, date);
    const locked = byName || byCalendar;

    if (locked) {
        return buildLockedResponse(locked, providerSurface, byName ? 'tournament_surface_lock' : 'calendar_grand_slam_surface_lock');
    }

    if (providerSurface) {
        return {
            surface: providerSurface,
            modelSurface: providerSurface,
            surfaceLabel: providerIndoor && providerSurface === 'Hard' ? 'Cemento indoor' : providerSurface,
            surfaceDetail: providerIndoor && providerSurface === 'Hard' ? 'Cemento indoor' : providerSurface,
            surfaceRegimeKey: surfaceRegimeKeyFor(providerSurface, providerIndoor),
            confidence: 0.82,
            source: 'provider_surface',
            ruleId: providerIndoor ? 'PROVIDER_SURFACE_INDOOR_NO_TOURNAMENT_LOCK' : 'PROVIDER_SURFACE_NO_TOURNAMENT_LOCK',
            indoor: providerIndoor,
            isFallback: false,
            providerSurface,
            overriddenProviderSurface: null,
            catalogVersion: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
        };
    }

    return {
        surface: 'Unknown',
        modelSurface: 'Hard',
        surfaceLabel: 'Unknown',
        surfaceDetail: 'Unknown',
        surfaceRegimeKey: 'hard',
        confidence: 0.25,
        source: 'unknown_no_surface',
        ruleId: 'TECHNICAL_FALLBACK_HARD_LOW_CONFIDENCE',
        indoor: false,
        isFallback: true,
        providerSurface: null,
        overriddenProviderSurface: null,
        catalogVersion: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
    };
}

module.exports = {
    resolveTennisTournamentSurface,
    normalizeProviderSurface,
    parseDate,
    norm,
    STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
};
