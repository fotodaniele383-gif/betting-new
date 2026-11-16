// ============================================================================
// STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG
// Canonical tournament/surface catalog for Tennis live, DeepScan, Paper Trading
// and Portfolio audit. Source of truth: user supplied ATP/WTA 1000/500 map.
// ============================================================================
'use strict';

const STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION = 'STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG_V1';

function normalizeTournamentText(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’'`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function uniq(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function buildEntry({ id, tour, category, tier, seriesLabel, name, surface, surfaceDetail, indoor = false, period, country, aliases = [] }) {
    const modelSurface = surface === 'Cemento' || surface === 'Cemento indoor'
        ? 'Hard'
        : (surface === 'Terra' || surface === 'Terra verde' || surface === 'Terra indoor' ? 'Clay' : (surface === 'Erba' ? 'Grass' : surface));
    const normalizedAliases = uniq([id, name, ...aliases].map(normalizeTournamentText));
    return Object.freeze({
        id,
        tour,
        category,
        tier,
        seriesLabel,
        name,
        canonicalName: name,
        surface,
        surfaceDetail: surfaceDetail || surface,
        modelSurface,
        indoor: indoor === true || String(surface || '').toLowerCase().includes('indoor'),
        period,
        country,
        aliases: normalizedAliases,
        version: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
    });
}

const TOURNAMENT_CATALOG = Object.freeze([
    // ATP Masters 1000
    buildEntry({ id:'atp_m1000_indian_wells', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Indian Wells', surface:'Cemento', period:'Marzo', country:'USA', aliases:['BNP Paribas Open','Indian Wells Masters','ATP Indian Wells','tennis_atp_indian_wells'] }),
    buildEntry({ id:'atp_m1000_miami_open', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Miami Open', surface:'Cemento', period:'Marzo', country:'USA', aliases:['Miami Masters','ATP Miami','tennis_atp_miami_open','tennis_atp_miami'] }),
    buildEntry({ id:'atp_m1000_monte_carlo', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Monte-Carlo', surface:'Terra', period:'Aprile', country:'Monaco', aliases:['Monte Carlo','Montecarlo','Rolex Monte-Carlo Masters','ATP Monte Carlo','tennis_atp_monte_carlo'] }),
    buildEntry({ id:'atp_m1000_madrid_open', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Madrid Open', surface:'Terra', period:'Aprile/Maggio', country:'Spagna', aliases:['Mutua Madrid Open','Madrid Masters','ATP Madrid','tennis_atp_madrid_open','tennis_atp_madrid'] }),
    buildEntry({ id:'atp_m1000_roma', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Internazionali d’Italia – Roma', surface:'Terra', period:'Maggio', country:'Italia', aliases:['Internazionali d Italia Roma','Internazionali BNL d Italia','Italian Open','Rome Masters','Roma','Rome','ATP Rome','ATP Roma','tennis_atp_rome','tennis_atp_roma'] }),
    buildEntry({ id:'atp_m1000_canada', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Canada Masters (Toronto/Montreal)', surface:'Cemento', period:'Agosto', country:'Canada', aliases:['Canada Masters','Canadian Open','National Bank Open','Rogers Cup','Toronto','Montreal','ATP Canada','ATP Toronto','ATP Montreal','tennis_atp_canadian_open','tennis_atp_toronto','tennis_atp_montreal'] }),
    buildEntry({ id:'atp_m1000_cincinnati', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Cincinnati Masters', surface:'Cemento', period:'Agosto', country:'USA', aliases:['Cincinnati','Western Southern Open','Cincinnati Open','ATP Cincinnati','tennis_atp_cincinnati_open','tennis_atp_cincinnati'] }),
    buildEntry({ id:'atp_m1000_shanghai', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Shanghai Masters', surface:'Cemento', period:'Ottobre', country:'Cina', aliases:['Shanghai','Rolex Shanghai Masters','ATP Shanghai','tennis_atp_shanghai_masters','tennis_atp_shanghai'] }),
    buildEntry({ id:'atp_m1000_paris_bercy', tour:'ATP', category:'MASTERS_1000', tier:'ATP Masters 1000', seriesLabel:'Masters 1000', name:'Paris-Bercy', surface:'Cemento indoor', surfaceDetail:'Cemento indoor', indoor:true, period:'Novembre', country:'Francia', aliases:['Paris Bercy','Paris Masters','Rolex Paris Masters','Paris Indoor','Bercy','ATP Paris','tennis_atp_paris_masters','tennis_atp_paris'] }),

    // WTA 1000
    buildEntry({ id:'wta_1000_doha', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Doha', surface:'Cemento', period:'Febbraio', country:'Qatar', aliases:['Qatar Open','Qatar TotalEnergies Open','WTA Doha','tennis_wta_doha'] }),
    buildEntry({ id:'wta_1000_dubai', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Dubai', surface:'Cemento', period:'Febbraio', country:'UAE', aliases:['Dubai Duty Free Tennis Championships','WTA Dubai','tennis_wta_dubai'] }),
    buildEntry({ id:'wta_1000_indian_wells', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Indian Wells', surface:'Cemento', period:'Marzo', country:'USA', aliases:['BNP Paribas Open','WTA Indian Wells','tennis_wta_indian_wells'] }),
    buildEntry({ id:'wta_1000_miami_open', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Miami Open', surface:'Cemento', period:'Marzo', country:'USA', aliases:['WTA Miami','tennis_wta_miami_open','tennis_wta_miami'] }),
    buildEntry({ id:'wta_1000_madrid_open', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Madrid Open', surface:'Terra', period:'Aprile/Maggio', country:'Spagna', aliases:['Mutua Madrid Open','WTA Madrid','tennis_wta_madrid_open','tennis_wta_madrid'] }),
    buildEntry({ id:'wta_1000_roma', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Roma', surface:'Terra', period:'Maggio', country:'Italia', aliases:['Internazionali d Italia Roma','Internazionali BNL d Italia','Italian Open','Rome','WTA Rome','WTA Roma','tennis_wta_rome','tennis_wta_roma'] }),
    buildEntry({ id:'wta_1000_pechino', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Pechino', surface:'Cemento', period:'Settembre/Ottobre', country:'Cina', aliases:['Beijing','China Open','WTA Beijing','WTA Pechino','tennis_wta_beijing','tennis_wta_china_open'] }),
    buildEntry({ id:'wta_1000_guadalajara', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Guadalajara (rotazione)', surface:'Cemento', period:'Settembre', country:'Messico', aliases:['Guadalajara','WTA Guadalajara','Guadalajara Open','tennis_wta_guadalajara'] }),
    buildEntry({ id:'wta_1000_cincinnati', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Cincinnati', surface:'Cemento', period:'Agosto', country:'USA', aliases:['Western Southern Open','Cincinnati Open','WTA Cincinnati','tennis_wta_cincinnati_open','tennis_wta_cincinnati'] }),
    buildEntry({ id:'wta_1000_canada', tour:'WTA', category:'WTA_1000', tier:'WTA 1000', seriesLabel:'WTA 1000', name:'Canada (Toronto/Montreal)', surface:'Cemento', period:'Agosto', country:'Canada', aliases:['Canadian Open','National Bank Open','Rogers Cup','Toronto','Montreal','WTA Canada','WTA Toronto','WTA Montreal','tennis_wta_canadian_open','tennis_wta_toronto','tennis_wta_montreal'] }),

    // ATP 500
    buildEntry({ id:'atp_500_rotterdam', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Rotterdam', surface:'Cemento indoor', surfaceDetail:'Cemento indoor', indoor:true, period:'Febbraio', country:'Paesi Bassi', aliases:['ABN AMRO Open','Rotterdam Open','ATP Rotterdam','tennis_atp_rotterdam'] }),
    buildEntry({ id:'atp_500_rio_de_janeiro', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Rio de Janeiro', surface:'Terra', period:'Febbraio', country:'Brasile', aliases:['Rio Open','ATP Rio','ATP Rio de Janeiro','tennis_atp_rio_open','tennis_atp_rio_de_janeiro'] }),
    buildEntry({ id:'atp_500_acapulco', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Acapulco', surface:'Cemento', period:'Febbraio', country:'Messico', aliases:['Mexican Open','Abierto Mexicano','ATP Acapulco','tennis_atp_acapulco'] }),
    buildEntry({ id:'atp_500_dubai', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Dubai', surface:'Cemento', period:'Febbraio', country:'UAE', aliases:['Dubai Duty Free Tennis Championships','ATP Dubai','tennis_atp_dubai'] }),
    buildEntry({ id:'atp_500_barcelona', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Barcelona', surface:'Terra', period:'Aprile', country:'Spagna', aliases:['Barcelona Open','Conde de Godo','ATP Barcelona','tennis_atp_barcelona'] }),
    buildEntry({ id:'atp_500_halle', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Halle', surface:'Erba', period:'Giugno', country:'Germania', aliases:['Terra Wortmann Open','ATP Halle','tennis_atp_halle'] }),
    buildEntry({ id:'atp_500_queens', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Queen’s', surface:'Erba', period:'Giugno', country:'Regno Unito', aliases:['Queens','Queen s','Queen Club','Queens Club','Cinch Championships','ATP Queens','tennis_atp_queens_club','tennis_atp_queens'] }),
    buildEntry({ id:'atp_500_washington', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Washington (Citi Open)', surface:'Cemento', period:'Luglio/Agosto', country:'USA', aliases:['Washington','Citi Open','ATP Washington','tennis_atp_washington','tennis_atp_citi_open'] }),
    buildEntry({ id:'atp_500_hamburg', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Hamburg', surface:'Terra', period:'Luglio', country:'Germania', aliases:['Hamburg Open','Hamburg European Open','ATP Hamburg','tennis_atp_hamburg'] }),
    buildEntry({ id:'atp_500_beijing', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Beijing', surface:'Cemento', period:'Settembre', country:'Cina', aliases:['China Open','ATP Beijing','ATP Pechino','tennis_atp_beijing','tennis_atp_china_open'] }),
    buildEntry({ id:'atp_500_tokyo', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Tokyo', surface:'Cemento', period:'Ottobre', country:'Giappone', aliases:['Japan Open','ATP Tokyo','tennis_atp_tokyo','tennis_atp_japan_open'] }),
    buildEntry({ id:'atp_500_basel', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Basel', surface:'Cemento indoor', surfaceDetail:'Cemento indoor', indoor:true, period:'Ottobre', country:'Svizzera', aliases:['Swiss Indoors','ATP Basel','tennis_atp_basel'] }),
    buildEntry({ id:'atp_500_vienna', tour:'ATP', category:'ATP_500', tier:'ATP 500', seriesLabel:'ATP500', name:'Vienna', surface:'Cemento indoor', surfaceDetail:'Cemento indoor', indoor:true, period:'Ottobre', country:'Austria', aliases:['Erste Bank Open','ATP Vienna','tennis_atp_vienna'] }),

    // WTA 500
    buildEntry({ id:'wta_500_brisbane', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Brisbane', surface:'Cemento', period:'Gennaio', country:'Australia', aliases:['Brisbane International','WTA Brisbane','tennis_wta_brisbane'] }),
    buildEntry({ id:'wta_500_adelaide', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Adelaide', surface:'Cemento', period:'Gennaio', country:'Australia', aliases:['Adelaide International','WTA Adelaide','tennis_wta_adelaide'] }),
    buildEntry({ id:'wta_500_abu_dhabi', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Abu Dhabi', surface:'Cemento', period:'Febbraio', country:'UAE', aliases:['Abu Dhabi Open','Mubadala Abu Dhabi Open','WTA Abu Dhabi','tennis_wta_abu_dhabi'] }),
    buildEntry({ id:'wta_500_san_diego', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'San Diego', surface:'Cemento', period:'Marzo', country:'USA', aliases:['San Diego Open','WTA San Diego','tennis_wta_san_diego'] }),
    buildEntry({ id:'wta_500_charleston', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Charleston', surface:'Terra verde', surfaceDetail:'Terra verde', period:'Aprile', country:'USA', aliases:['Credit One Charleston Open','Charleston Open','WTA Charleston','green clay','tennis_wta_charleston'] }),
    buildEntry({ id:'wta_500_stoccarda', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Stoccarda', surface:'Terra indoor', surfaceDetail:'Terra indoor', indoor:true, period:'Aprile', country:'Germania', aliases:['Stuttgart','Porsche Tennis Grand Prix','WTA Stuttgart','WTA Stoccarda','tennis_wta_stuttgart'] }),
    buildEntry({ id:'wta_500_berlino', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Berlino', surface:'Erba', period:'Giugno', country:'Germania', aliases:['Berlin','Berlin Open','Bett1 Open','WTA Berlin','WTA Berlino','tennis_wta_berlin'] }),
    buildEntry({ id:'wta_500_eastbourne', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Eastbourne', surface:'Erba', period:'Giugno', country:'Regno Unito', aliases:['Eastbourne International','WTA Eastbourne','tennis_wta_eastbourne'] }),
    buildEntry({ id:'wta_500_washington', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Washington', surface:'Cemento', period:'Luglio/Agosto', country:'USA', aliases:['Citi Open','WTA Washington','tennis_wta_washington','tennis_wta_citi_open'] }),
    buildEntry({ id:'wta_500_zhengzhou', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Zhengzhou', surface:'Cemento', period:'Ottobre', country:'Cina', aliases:['Zhengzhou Open','WTA Zhengzhou','tennis_wta_zhengzhou'] }),
    buildEntry({ id:'wta_500_tokyo', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Tokyo', surface:'Cemento', period:'Settembre', country:'Giappone', aliases:['Japan Open','Toray Pan Pacific Open','WTA Tokyo','tennis_wta_tokyo','tennis_wta_japan_open'] }),
    buildEntry({ id:'wta_500_ostrava_rotazione', tour:'WTA', category:'WTA_500', tier:'WTA 500', seriesLabel:'WTA500', name:'Ostrava / Rotazione', surface:'Cemento indoor', surfaceDetail:'Cemento indoor', indoor:true, period:'Ottobre', country:'Rep. Ceca', aliases:['Ostrava','Ostrava Open','WTA Ostrava','tennis_wta_ostrava'] })
]);

function inferTennisTourFromContext(context = {}) {
    const text = normalizeTournamentText([
        context.tour,
        context.tourType,
        context.league,
        context.series,
        context.sportKey,
        context.key,
        context.title,
        context.tournament,
        context.tournamentName,
        context.eventName,
        context.competition,
        context.circuit,
        context.strategy_tag,
        context.bet_type
    ].filter(Boolean).join(' '));
    if (/(^| )wta( |$|_)/.test(text) || text.includes(' tennis wta ')) return 'WTA';
    if (/(^| )atp( |$|_)/.test(text) || text.includes(' tennis atp ')) return 'ATP';
    return null;
}

function aliasMatches(normalizedText, alias) {
    if (!normalizedText || !alias) return false;
    if (normalizedText === alias) return true;
    return (` ${normalizedText} `).includes(` ${alias} `);
}

function findTournamentCatalogEntry(context = {}) {
    const rawText = [
        context.tournament,
        context.tournamentName,
        context.eventName,
        context.league,
        context.series,
        context.competition,
        context.circuit,
        context.title,
        context.sportKey,
        context.key
    ].filter(Boolean).join(' ');
    const normalizedText = normalizeTournamentText(rawText);
    if (!normalizedText) return null;

    const wantedTour = inferTennisTourFromContext(context);
    const candidates = [];
    for (const entry of TOURNAMENT_CATALOG) {
        const matchedAlias = entry.aliases.find(alias => aliasMatches(normalizedText, alias));
        if (!matchedAlias) continue;
        const tourScore = wantedTour && entry.tour === wantedTour ? 100 : 0;
        const aliasScore = matchedAlias.length;
        const exactScore = normalizedText === matchedAlias ? 25 : 0;
        candidates.push({ entry, score: tourScore + aliasScore + exactScore, matchedAlias });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || b.matchedAlias.length - a.matchedAlias.length);
    return candidates[0].entry;
}

function surfaceRegimeKeyFor(entryOrSurface = {}, indoor = false) {
    const surface = typeof entryOrSurface === 'string' ? entryOrSurface : (entryOrSurface.modelSurface || entryOrSurface.surface || 'Hard');
    const isIndoor = indoor === true || (typeof entryOrSurface === 'object' && entryOrSurface.indoor === true);
    if (String(surface).toLowerCase() === 'clay') return 'clay';
    if (String(surface).toLowerCase() === 'grass') return 'grass';
    if (isIndoor) return 'indoor_hard';
    return 'hard';
}

function resolveTournamentCatalogContext(context = {}) {
    const entry = findTournamentCatalogEntry(context);
    if (!entry) return {
        isCatalogMatch: false,
        version: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
    };
    return {
        isCatalogMatch: true,
        catalogId: entry.id,
        canonicalName: entry.canonicalName,
        tournamentName: entry.name,
        tournamentCanonicalName: entry.canonicalName,
        tournamentCategory: entry.category,
        tournamentLevel: entry.tier,
        seriesLabel: entry.seriesLabel,
        tour: entry.tour,
        modelSurface: entry.modelSurface,
        surface: entry.modelSurface,
        surfaceLabel: entry.surface,
        surfaceDetail: entry.surfaceDetail,
        surfaceRegimeKey: surfaceRegimeKeyFor(entry),
        indoor: entry.indoor === true,
        country: entry.country,
        period: entry.period,
        confidence: 0.995,
        source: 'step111_tournament_catalog_lock',
        ruleId: `STEP111_CATALOG_${entry.category}_${entry.id}`.toUpperCase(),
        version: STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION
    };
}

function getAllowedSeriesKeys() {
    return ['Grand Slam', 'Masters 1000', 'WTA 1000', 'ATP500', 'WTA500', 'ATP250', 'WTA250', 'Challenger', 'Masters Cup'];
}

module.exports = {
    STEP111_TENNIS_TOURNAMENT_CATALOG_VERSION,
    TOURNAMENT_CATALOG,
    normalizeTournamentText,
    inferTennisTourFromContext,
    findTournamentCatalogEntry,
    resolveTournamentCatalogContext,
    surfaceRegimeKeyFor,
    getAllowedSeriesKeys
};
