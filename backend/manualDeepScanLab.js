// ============================================================================
// STEP61 - Manual DeepScan Lab
// Read-only manual analysis for Calcio/Tennis. It never writes to DB, paper
// trading, portfolio or stake fields. It can build a prompt for an external AI.
// ============================================================================

const deepScanCalcio = require('./deepScanCalcio');
const deepScanTennis = require('./deepScanTennis');

const STEP61_MANUAL_DEEPSCAN_VERSION = 'STEP61_MANUAL_DEEPSCAN_LAB_READ_ONLY';

const STEP61_OUTPUT_LABELS = {
    primary: 'Pronostico principale',
    alternative: 'Pronostico alternativo',
    noBetWait: 'No bet / Wait live'
};


function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function safeNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSport(value) {
    const raw = safeString(value).toLowerCase();
    if (raw === 'football' || raw === 'soccer') return 'calcio';
    if (raw === 'tennis') return 'tennis';
    return raw === 'calcio' ? 'calcio' : '';
}

function formatOdd(value) {
    const n = safeNumber(value, null);
    return n && n > 1 ? n.toFixed(2) : 'N/D';
}

function pickLowestOdd(candidates) {
    const valid = candidates
        .map(item => ({ ...item, odd: safeNumber(item.odd, null) }))
        .filter(item => item.odd && item.odd > 1);
    if (!valid.length) return null;
    valid.sort((a, b) => a.odd - b.odd);
    return valid[0];
}

function inferFootballPrediction(input) {
    const explicit = safeString(input.prediction || input.market || input.pronostico);
    if (explicit && explicit.toUpperCase() !== 'ANALISI GENERALE') return explicit.toUpperCase();

    const line = safeString(input.overUnderLine || input.line || input.totalLine);
    if (line) return `OVER ${line}`;

    const fav = pickLowestOdd([
        { prediction: '1', odd: input.odd1 },
        { prediction: 'X', odd: input.oddX },
        { prediction: '2', odd: input.odd2 }
    ]);
    return fav ? fav.prediction : 'ANALISI GENERALE';
}

function inferTennisPrediction(input) {
    const explicit = safeString(input.prediction || input.market || input.pronostico);
    if (explicit && explicit.toUpperCase() !== 'ANALISI GENERALE') return explicit.toUpperCase();

    const line = safeString(input.overUnderLine || input.line || input.totalLine);
    if (line) return `OVER ${line} GAME`;

    const fav = pickLowestOdd([
        { prediction: '1', odd: input.odd1 },
        { prediction: '2', odd: input.odd2 }
    ]);
    return fav ? fav.prediction : 'ANALISI GENERALE';
}

function inferOddForPrediction(sport, prediction, input) {
    const p = safeString(prediction).toUpperCase();
    if (sport === 'calcio') {
        if (p === '1') return safeNumber(input.odd1, null) || safeNumber(input.odd, 2.0);
        if (p === 'X') return safeNumber(input.oddX, null) || safeNumber(input.odd, 3.2);
        if (p === '2') return safeNumber(input.odd2, null) || safeNumber(input.odd, 2.0);
        return safeNumber(input.odd, null) || safeNumber(input.overOdd, null) || 2.0;
    }
    if (p === '1') return safeNumber(input.odd1, null) || safeNumber(input.odd, 2.0);
    if (p === '2') return safeNumber(input.odd2, null) || safeNumber(input.odd, 2.0);
    return safeNumber(input.odd, null) || safeNumber(input.overOdd, null) || 2.0;
}

function estimateManualProbability(odd) {
    const n = safeNumber(odd, null);
    if (!n || n <= 1) return 50;
    const implied = Math.max(1, Math.min(99, 100 / n));
    // Manual mode: neutral-advisory, not a calibrated model probability.
    return Math.round(Math.max(45, Math.min(74, implied + 4)) * 100) / 100;
}

function buildFootballPrompt(input, analysis) {
    const home = safeString(input.homeTeam || input.team1 || input.squadra1);
    const away = safeString(input.awayTeam || input.team2 || input.squadra2);
    return [
        'Analizza questo match di CALCIO come senior betting analyst.',
        `Match: ${home} - ${away}`,
        `Campionato: ${safeString(input.league || input.competition || input.campionato) || 'N/D'}`,
        `Data/Ora: ${safeString(input.matchDate || input.date || input.dataOra) || 'N/D'}`,
        `Quote 1/X/2: ${formatOdd(input.odd1)} / ${formatOdd(input.oddX)} / ${formatOdd(input.odd2)}`,
        `Linea Over/Under: ${safeString(input.overUnderLine || input.line || input.totalLine) || 'N/D'}`,
        '',
        'Richiesta:',
        '- valuta forma, motivazioni, lineup/news, affidabilita dati xG/Understat/football-data;',
        '- valuta timing operativo: troppo presto, finestra lineup, final gate o wait live;',
        '- valuta correlazioni tra mercati: 1+Over2.5, favorito-1+Over, X+Under, Goal+Over, NoGoal+Under, 1X+favorito;',
        '- restituisci pronostico principale, alternativa, no bet/wait live e mercati da evitare;',
        '- non proporre stake pieno se lineup/news o dati sono fragili.',
        '',
        `Sintesi sistema: ${analysis.suggestedPick || 'N/D'} · ${analysis.noBetOrWait || 'N/D'}`
    ].join('\n');
}

function buildTennisPrompt(input, analysis) {
    const p1 = safeString(input.p1Name || input.player1 || input.giocatore1);
    const p2 = safeString(input.p2Name || input.player2 || input.giocatore2);
    return [
        'Analizza questo match di TENNIS come senior betting analyst.',
        `Match: ${p1} - ${p2}`,
        `Circuito: ${safeString(input.circuit || input.league || input.atpWta) || 'N/D'}`,
        `Torneo: ${safeString(input.tournament || input.torneo) || 'N/D'}`,
        `Superficie: ${safeString(input.surface || input.superficie) || 'N/D'}`,
        `Data/Ora: ${safeString(input.matchDate || input.date || input.dataOra) || 'N/D'}`,
        `Quote 1/2: ${formatOdd(input.odd1)} / ${formatOdd(input.odd2)}`,
        `Linea Over/Under games: ${safeString(input.overUnderLine || input.line || input.totalLine) || 'N/D'}`,
        '',
        'Richiesta:',
        '- valuta matchup tecnico, superficie, H2H, servizio/risposta, forma e news;',
        '- valuta Moneyline, Over/Under, handicap, tie-break e set betting solo come alternative advisory;',
        '- restituisci pronostico principale, alternativa, no bet/wait live e mercati da evitare;',
        '- specifica se attendere 1 game, 3 game o 1 set prima di entrare;',
        '- non proporre stake reale: analisi manuale read-only.',
        '',
        `Sintesi sistema: ${analysis.suggestedPick || 'N/D'} · ${analysis.noBetOrWait || 'N/D'}`
    ].join('\n');
}

function buildManualSuggestion(sport, prediction, input, report) {
    const p = safeString(prediction).toUpperCase();
    const action = safeString(report?.action || '').toUpperCase();
    const line = safeString(input.overUnderLine || input.line || input.totalLine);
    const hasOdds = sport === 'calcio'
        ? [input.odd1, input.oddX, input.odd2, input.odd].some(v => safeNumber(v, null) > 1)
        : [input.odd1, input.odd2, input.odd].some(v => safeNumber(v, null) > 1);

    let suggestedPick = p && p !== 'ANALISI GENERALE' ? p : 'WAIT / ANALISI QUALITATIVA';
    let alternativePick = 'Attesa live o mercato alternativo a rischio inferiore';
    let noBetOrWait = 'WAIT: analisi manuale non operativa, confermare con mercato e informazioni finali';
    const marketsToAvoid = [];

    if (!hasOdds) {
        marketsToAvoid.push('Valore/edge non calcolabile senza quote');
    }
    if (action.includes('ALTO') || action.includes('NO_BET') || action.includes('RISCHIO')) {
        noBetOrWait = 'NO BET / WAIT: DeepScan segnala rischio o informazioni insufficienti';
    }

    if (sport === 'calcio') {
        if (line) alternativePick = `Valutare Over/Under ${line} solo se coerente con lineup e xG`;
        marketsToAvoid.push('multiple esposizioni correlate sullo stesso match');
        marketsToAvoid.push('1 + Over 2.5 se quota non compensa la correlazione');
        marketsToAvoid.push('Goal + Over e No Goal + Under come doppia esposizione non controllata');
    } else {
        if (line) alternativePick = `Valutare totals ${line} solo con ritmo confermato nei primi game`;
        marketsToAvoid.push('totals pre-match senza coppia quote Over/Under reale');
        marketsToAvoid.push('handicap/tie-break come stake reale senza conferma live');
    }

    return {
        suggestedPick,
        alternativePick,
        noBetOrWait,
        marketsToAvoid
    };
}

async function runManualDeepScan(payload = {}) {
    const sport = normalizeSport(payload.sport);
    if (!sport) {
        const error = new Error('Sport manuale non valido. Usa calcio o tennis.');
        error.statusCode = 400;
        throw error;
    }

    const useLiveApi = payload.useLiveApi === true;
    const useWebNews = payload.useWebNews !== false;

    if (sport === 'calcio') {
        const homeTeam = safeString(payload.homeTeam || payload.team1 || payload.squadra1);
        const awayTeam = safeString(payload.awayTeam || payload.team2 || payload.squadra2);
        if (!homeTeam || !awayTeam) {
            const error = new Error('Inserisci Squadra 1 e Squadra 2.');
            error.statusCode = 400;
            throw error;
        }

        const prediction = inferFootballPrediction(payload);
        const odd = inferOddForPrediction('calcio', prediction, payload);
        const prob = safeNumber(payload.prob, null) || estimateManualProbability(odd);
        const edge = safeNumber(payload.edge_pp ?? payload.edge, 0) || 0;
        const report = await deepScanCalcio.scanMatchup(
            homeTeam,
            awayTeam,
            prediction,
            odd,
            prob,
            edge,
            payload.odd1,
            payload.oddX,
            payload.odd2,
            {
                manualOnly: true,
                manualDeepScanStep61: true,
                useWebNews,
                useLiveApi,
                league: payload.league || payload.competition || payload.campionato,
                competition: payload.league || payload.competition || payload.campionato,
                matchDate: payload.matchDate || payload.date || payload.dataOra,
                line: payload.overUnderLine || payload.line || payload.totalLine,
                sport: 'CALCIO'
            }
        );

        const suggestion = buildManualSuggestion('calcio', prediction, payload, report);
        const aiPrompt = buildFootballPrompt(payload, suggestion);
        return {
            success: true,
            mode: STEP61_MANUAL_DEEPSCAN_VERSION,
            sport: 'calcio',
            doNotSave: true,
            savedToPaperTrading: false,
            pendingCreated: false,
            portfolioMutated: false,
            stakeMutated: false,
            apiPolicy: {
                oddsApiDefault: 'OFF',
                useLiveApiRequested: useLiveApi,
                liveApiUsed: false,
                oddsApiCreditsUsed: 0,
                webNewsEnabled: useWebNews,
                note: useLiveApi ? 'Toggle ricevuto: Step61 resta read-only; quote live/API non salvate e non usate per creare pending.' : 'API live OFF: nessun consumo The Odds API.'
            },
            input: { homeTeam, awayTeam, prediction, odd, prob, league: payload.league || payload.competition || payload.campionato || '' },
            ...suggestion,
            aiPrompt,
            report
        };
    }

    const p1Name = safeString(payload.p1Name || payload.player1 || payload.giocatore1);
    const p2Name = safeString(payload.p2Name || payload.player2 || payload.giocatore2);
    if (!p1Name || !p2Name) {
        const error = new Error('Inserisci Giocatore 1 e Giocatore 2.');
        error.statusCode = 400;
        throw error;
    }

    const prediction = inferTennisPrediction(payload);
    const odd = inferOddForPrediction('tennis', prediction, payload);
    const prob = safeNumber(payload.prob, null) || estimateManualProbability(odd);
    const edge = safeNumber(payload.edge_pp ?? payload.edge, 0) || 0;
    const matchContext = {
        manualOnly: true,
        manualDeepScanStep61: true,
        useWebNews,
        useLiveApi,
        league: payload.league || payload.circuit || payload.atpWta || payload.tournament || payload.torneo || '',
        tournament: payload.tournament || payload.torneo || '',
        tournamentName: payload.tournament || payload.torneo || '',
        surface: payload.surface || payload.superficie || '',
        courtSurface: payload.surface || payload.superficie || '',
        match_date: payload.matchDate || payload.date || payload.dataOra || '',
        marketType: payload.overUnderLine || payload.line || payload.totalLine ? 'totals' : 'h2h',
        market_type: payload.overUnderLine || payload.line || payload.totalLine ? 'totals' : 'h2h',
        point: payload.overUnderLine || payload.line || payload.totalLine || null,
        pointLine: payload.overUnderLine || payload.line || payload.totalLine || null,
        line: payload.overUnderLine || payload.line || payload.totalLine || null,
        sport: 'tennis'
    };

    const report = await deepScanTennis.scanMatchup(
        p1Name,
        p2Name,
        prediction,
        odd,
        prob,
        edge,
        payload.odd1,
        payload.odd2,
        matchContext
    );

    const suggestion = buildManualSuggestion('tennis', prediction, payload, report);
    const aiPrompt = buildTennisPrompt(payload, suggestion);
    return {
        success: true,
        mode: STEP61_MANUAL_DEEPSCAN_VERSION,
        sport: 'tennis',
        doNotSave: true,
        savedToPaperTrading: false,
        pendingCreated: false,
        portfolioMutated: false,
        stakeMutated: false,
        apiPolicy: {
            oddsApiDefault: 'OFF',
            useLiveApiRequested: useLiveApi,
            liveApiUsed: false,
            oddsApiCreditsUsed: 0,
            webNewsEnabled: useWebNews,
            note: useLiveApi ? 'Toggle ricevuto: Step61 resta read-only; quote live/API non salvate e non usate per creare pending.' : 'API live OFF: nessun consumo The Odds API.'
        },
        input: { p1Name, p2Name, prediction, odd, prob, league: matchContext.league, tournament: matchContext.tournament, surface: matchContext.surface },
        ...suggestion,
        aiPrompt,
        report
    };
}

module.exports = {
    STEP61_MANUAL_DEEPSCAN_VERSION,
    runManualDeepScan,
    buildFootballPrompt,
    buildTennisPrompt,
    inferFootballPrediction,
    inferTennisPrediction
};
