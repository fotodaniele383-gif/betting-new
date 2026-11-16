// ============================================================================
//  AI BETTING QUANT PRO - DEEP SCAN TENNIS 
//  Versione: 15.2 (DeepScan Operational Gate)
// ============================================================================

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sackmann = require('./sackmann');
const quantEngine = require('./tennisQuantEngine');
const { resolveTennisTournamentSurface } = require('./tennisTournamentSurfaceResolver');
const { assertPreMatchOnlyContext } = require('./preMatchLeakageGuard');
const tennisExternalMatchIntelligencePatch37 = require('./tennisExternalMatchIntelligencePatch37');

const CACHE_DIR = path.join(__dirname, 'cache_news');
if (!fs.existsSync(CACHE_DIR)) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {} }

const DEEP_SCAN_TENNIS_VERSION = '15.4_PATCH37_EXTERNAL_MATCH_INTELLIGENCE';
const NEWS_TTL_MS = 3 * 60 * 60 * 1000;
const PATCH27_NEGATIVE_CACHE_TTL_MS = 15 * 60 * 1000;
const PATCH27_H2H_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PATCH27_MEMORY_CACHE_MAX = 256;
const patch27NewsResultCache = new Map();
const patch27NewsInFlight = new Map();
const patch27H2hResultCache = new Map();
const patch27H2hInFlight = new Map();
const patch27PerformanceCounters = { newsMemoryHits: 0, newsInFlightHits: 0, newsMisses: 0, h2hMemoryHits: 0, h2hInFlightHits: 0, h2hMisses: 0 };

function patch27CacheKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function patch27CacheGet(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) { cache.delete(key); return null; }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
}
function patch27CacheSet(cache, key, value, ttlMs) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { value, expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || 1000) });
    while (cache.size > PATCH27_MEMORY_CACHE_MAX) cache.delete(cache.keys().next().value);
}
function patch27WithRetrievalMarker(value, marker = {}) {
    if (!value || typeof value !== 'object') return value;
    return { ...value, retrieval: { ...(value.retrieval || {}), ...marker } };
}


// CHANGELOG 14.3
// - Non classifica più ogni veto come ALTO RISCHIO: introdotta tassonomia
//   OK / WATCHLIST / RISCHIO MODELLO / ALTO RISCHIO.
// - Surface fallback corretto: un torneo Grand Slam senza superficie esplicita
//   non viene più etichettato automaticamente come Hard; se il calendario
//   indica Roland Garros / maggio-giugno viene inferita Clay con confidenza media.
// - Quote riferimento P1/P2 assenti diventano warning di qualità mercato, non
//   prova automatica di rischio hard.
// - Disaccordo modello/mercato viene graduato e spiegato nel report.
//
// CHANGELOG 14.4
// - Fix critico: se P1/P2 sono assenti, il sistema NON interpreta più
//   l'edge rispetto alla quota giocata come vero disaccordo modello/mercato.
// - Separati: marketDisagreement two-way, playedOddEdge e no-reference uncertainty.
// - Ridotto peso del veto legacy: non deve colorare tutti i match come ALTO RISCHIO.
// - Aggiunto profilo rischio più coerente con analisi manuale: model risk, low edge, blocked.
//
// CHANGELOG 14.5
// - Step 18: DeepScan bilanciato; missing reference/fallback non generano più automaticamente WATCHLIST/RISCHIO.
// - Il backend può usare il DeepScan per ridurre stake pending e non solo colorare la UI.
//
// CHANGELOG 14.7
// - Step 19: Mashup qualitativo a 6 pilastri: market traps, style/surface, fitness,
//   motivazione torneo, overconfidence modello e ranking/trajectory.
// - Correzione over-shoot Step 18: DeepScan non classifica più tutto come verde;
//   il verde richiede rischio totale basso e nessun pilastro critico.
// - Edge elevato senza quote reference resta un alert qualitativo, non un veto automatico.
//
// CHANGELOG 14.8
// - Step 20: aggiunto modulo Ranking Attuale vs Ranking Reale nel DeepScan.
// - Il sesto pilastro ora usa una tabella leggibile con ranking ufficiale, best/recent
//   rank, ranking reale stimato, fit superficie, dominance/service-return e confidenza.
// - Esempio logico: profilo top 70-90 reale su clay può giustificare favorito forte,
//   ma non eleva automaticamente oltre 80% senza conferma mercato/superficie.
//
// CHANGELOG 15.0
// - Step 22: hardening runtime completo del DeepScan avanzato.
// - getAdvancedMatchup Sackmann viene isolato in safe wrapper: errori interni
//   come "sackData is not defined" non mandano più in anomalia l'intero DeepScan.
// - Aggiunto escapeHtml globale usato anche dalla tabella Ranking Reale.
// - La tabella Ranking Reale è isolata con fallback: se mancano dati avanzati,
//   il DeepScan prosegue e segnala il ranking reale come non disponibile.
// - calculateAdvancedMetrics è protetto: eventuali errori avanzati generano warning,
//   non ERRORE INTERNO.
//
// CHANGELOG 15.1
// - DeepScan diventa perizia operational-gate completa: conferma pronostico,
//   attesa In-Play con timing, oppure alternativa motivata.
// - L'esito consigliato non modifica stake/gate/ROI: valida o smentisce il pronostico
// - Step 38: parsing data UI italiana per inferire correttamente superficie Grand Slam maggio/giugno.
//   usando i pilastri qualitativi e le statistiche disponibili.
//
// CHANGELOG Step50E
// - DeepScan Totals Calibration: Over/Under valutati con line, side, coppia quote, no-vig,
//   Markov confidence, expected games, varianza, tie-break, best-of-set e profili serve/return.
// - Moneyline 1/2 isolato: nessuna modifica ai criteri core del pronostico vincente.
// - L'esito consigliato mostra sempre conferma, bocciatura, attesa live o alternativa anche per mercati non usati.


function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeClamp(value, min, max) {
    if (quantEngine && typeof quantEngine.clamp === 'function') {
        return quantEngine.clamp(value, min, max);
    }

    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeProbabilityPct(value, fallback = 50) {
    return safeClamp(toNumber(value, fallback), 1, 99);
}

function normalizeOdd(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n;
}

function calculateMarketImpliedProbabilityPct(odd) {
    const o = normalizeOdd(odd);
    if (!o) return 0;
    return 100 / o;
}

function calculateEdgePp(probabilityPct, marketImpliedProbabilityPct) {
    return normalizeProbabilityPct(probabilityPct) - safeClamp(toNumber(marketImpliedProbabilityPct, 0), 0, 100);
}

function calculateEvPct(probabilityPct, odd) {
    const o = normalizeOdd(odd);
    if (!o) return 0;
    return ((normalizeProbabilityPct(probabilityPct) / 100) * o - 1) * 100;
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function normalizeScanArguments(p1Name, p2Name, prediction, odd, prob, edge, odd1, odd2, matchContext = {}) {
    if (p1Name && typeof p1Name === 'object') {
        const input = p1Name;
        return {
            p1Name: input.p1Name || input.player1 || input.home || input.home_team || '',
            p2Name: input.p2Name || input.player2 || input.away || input.away_team || '',
            prediction: input.prediction || input.pick || '',
            odd: input.odd ?? input.price ?? input.quota,
            prob: input.prob ?? input.probability ?? input.estimatedProb ?? input.estimated_prob ?? input.calibrated_probability_pct,
            edge_pp: firstFiniteNumber(input.edge_pp, input.adjusted_edge_pp, input.edge),
            ev_pct: firstFiniteNumber(input.ev_pct, input.adjusted_ev_pct, input.expectedValue, input.ev),
            odd1: input.odd1,
            odd2: input.odd2,
            matchContext: input.matchContext || input.context || input
        };
    }

    return {
        p1Name,
        p2Name,
        prediction,
        odd,
        prob,
        edge_pp: firstFiniteNumber(matchContext.edge_pp, matchContext.adjusted_edge_pp, edge),
        ev_pct: firstFiniteNumber(matchContext.ev_pct, matchContext.adjusted_ev_pct, matchContext.expectedValue, matchContext.ev),
        odd1,
        odd2,
        matchContext: matchContext || {}
    };
}


function getCachePathForPlayer(playerName) { return path.join(CACHE_DIR, `${playerName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.json`); }

function loadNewsCache(playerName) {
    try {
        const file = getCachePathForPlayer(playerName);
        if (!fs.existsSync(file)) return null;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Date.now() - data.timestamp > NEWS_TTL_MS) return null; 
        return data.articles;
    } catch (e) { return null; }
}

function saveNewsCache(playerName, articles) {
    try { fs.writeFileSync(getCachePathForPlayer(playerName), JSON.stringify({ timestamp: Date.now(), articles }), 'utf8'); } catch (e) {}
}

async function fetchWithRetry(url, options = {}, retries = 1) {
    const retryCount = Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 3) : 1;
    for (let i = 0; i <= retryCount; i++) {
        try {
            // Patch 27: nessuna pausa artificiale sul primo tentativo; backoff solo sui retry.
            if (i > 0) await new Promise(r => setTimeout(r, 250 * i));
            return await axios(url, options && typeof options === 'object' ? options : {});
        } catch (error) { if (i === retryCount) throw error; }
    }
}

// ======================================================
// 🎾 FASE 1: SURFACE DETECTION ENGINE
// ======================================================
function normalizeSurface(surface) {
    if (!surface) return null;
    const s = String(surface).toLowerCase().trim();

    if (s.includes('clay') || s.includes('terra') || s.includes('red clay')) return 'Clay';
    if (s.includes('grass') || s.includes('erba')) return 'Grass';
    // Fix di compatibilità con tennisSurfaceEngine.js
    if (s.includes('indoor')) return 'Indoor_Hard';
    if (s.includes('hard') || s.includes('cemento') || s.includes('outdoor')) return 'Hard';

    return null;
}

function inferSurfaceFromTournament(tournamentName = '') {
    const resolved = resolveTennisTournamentSurface({ tournament: tournamentName, title: tournamentName });
    if (resolved && resolved.isFallback !== true && resolved.modelSurface) {
        if (resolved.indoor === true && resolved.modelSurface === 'Hard') return 'Indoor_Hard';
        return resolved.modelSurface;
    }

    const t = String(tournamentName).toLowerCase();

    const clayEvents = [
        'roland garros', 'french open', "porte d'auteuil", 'monte carlo', 'madrid', 'rome', 'roma',
        'barcelona', 'hamburg', 'bastad', 'gstaad', 'kitzbuhel',
        'bucharest', 'marrakech', 'munich', 'geneva', 'estoril',
        'palermo', 'stuttgart clay'
    ];

    const grassEvents = [
        'wimbledon', 'halle', 'queens', 'queen', 'eastbourne',
        's-hertogenbosch', 'nottingham', 'mallorca', 'newport'
    ];

    const indoorEvents = [
        'paris masters', 'basel', 'vienna', 'rotterdam',
        'stockholm', 'metz', 'antwerp', 'sofia', 'turin',
        'atp finals', 'wta finals'
    ];

    if (clayEvents.some(e => t.includes(e))) return 'Clay';
    if (grassEvents.some(e => t.includes(e))) return 'Grass';
    if (indoorEvents.some(e => t.includes(e))) return 'Indoor_Hard';

    return null;
}

function getContextDate(matchContext = {}) {
    const raw = matchContext.commence_time || matchContext.match_date || matchContext.date || matchContext.startTime || matchContext.start_time;
    if (!raw) return null;

    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw;
    }

    if (typeof raw === 'number') {
        // YYYYMMDD numerico.
        if (raw > 19000000 && raw < 21000000) {
            const text = String(raw);
            const d = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
            return Number.isNaN(d.getTime()) ? null : d;
        }

        // Excel serial date.
        if (raw > 25000 && raw < 70000) {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const d = new Date(excelEpoch.getTime() + raw * 86400000);
            return Number.isNaN(d.getTime()) ? null : d;
        }
    }

    const text = String(raw).trim();
    if (!text) return null;

    // Formati UI italiani: 22/05/2026, 11:00:00 oppure 22/05/2026 11:00.
    const italian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (italian) {
        const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = italian;
        const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)));
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // YYYYMMDD in stringa.
    if (/^\d{8}$/.test(text)) {
        const d = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
}

function detectMatchSurface(matchContext = {}) {
    const resolved = resolveTennisTournamentSurface({
        tournament: matchContext.tournament,
        tournamentName: matchContext.tournamentName,
        eventName: matchContext.eventName,
        league: matchContext.league,
        competition: matchContext.competition,
        circuit: matchContext.circuit,
        title: matchContext.title,
        sportKey: matchContext.sportKey,
        date: matchContext.match_date || matchContext.commence_time || matchContext.date || matchContext.startTime,
        providerSurface: matchContext.surface || matchContext.courtSurface
    });

    return {
        surface: resolved.surface,
        modelSurface: resolved.modelSurface || resolved.surface,
        confidence: resolved.confidence,
        source: resolved.source,
        ruleId: resolved.ruleId,
        indoor: resolved.indoor === true,
        isFallback: resolved.isFallback === true,
        providerSurface: resolved.providerSurface || null,
        overriddenProviderSurface: resolved.overriddenProviderSurface || null,
        surfaceLabel: resolved.surfaceLabel || resolved.surfaceDetail || resolved.surface || null,
        surfaceDetail: resolved.surfaceDetail || resolved.surfaceLabel || null,
        surfaceRegimeKey: resolved.surfaceRegimeKey || null,
        tournamentCatalogId: resolved.tournamentCatalogId || null,
        tournamentName: resolved.tournamentName || null,
        tournamentCanonicalName: resolved.tournamentCanonicalName || null,
        tournamentCategory: resolved.tournamentCategory || null,
        tournamentLevel: resolved.tournamentLevel || null,
        tournamentCountry: resolved.tournamentCountry || null,
        tournamentPeriod: resolved.tournamentPeriod || null,
        catalogVersion: resolved.catalogVersion || null
    };
}

// ======================================================
// 🧠 FASE 2: AGENTE NLP GLOBALE
// ======================================================
async function getSentimentAnalysisUncached(playerName) {
    const surname = playerName.split(' ').pop().toLowerCase();
    const fullName = playerName.toLowerCase();

    let score = 0;
    let tacticalIssues = { mentions: 0, isEmergency: false, injuryOut: false, fatigue: false };
    let injuryScore = 0; let fatigueScore = 0; let momentumScore = 0; let psychologyScore = 0;

    const POSITIVE = [/\b(win|won|victory|triumph|qualifies|through|back on track)\b/i, /ottima vittoria|trionfo|straight sets|dominates/i];
    const NEGATIVE = [/\b(loss|lost|defeat|slump|crisis|collapse|meltdown|choke)\b/i, /disastro|crollo|knocked out|upset by/i];
    const INJURY = [/\b(injury|injured|mto|medical timeout|retires|retired|withdraws|withdrawal|walkover|forfait)\b/i, /infortunio|ritiro|medical issue/i];
    const STRONG_INJURY = [/\b(surgery|fracture|torn ligament|acl|mcl|season-ending|serious injury)\b/i, /operazione|frattura/i];
    const FATIGUE = [/\b(fatigue|exhausted|tired|drained|cramps)\b/i, /tired legs|heavy legs|marathon match|crampi|stanchezza/i];
    const RECOVERY = [/\b(recovered|healed|cleared to play|fully fit|rehab)\b/i, /back to fitness|back in training|guarito|recuperato|superato l'infortunio/i];
    
    const PAST_TEXT = [/\b(last year|months ago|last season|previous injury|history of)\b/i, /in passato|mesi fa|scorso anno/i];
    const FALSE_POSITIVE = [/avversari|opponent|recovers|returns from|ritiro di|retires against|supera|despite|withdraws from|beats|defeats|walkover against|advances after|benefited from/i];
    const BOILERPLATE = [/terms & conditions|betting|bookmaker|odds|stake|scommesse|quote|privacy policy|cookie policy/i];
    const NON_TENNIS = [/\b(football|nba|basketball|rugby|cricket|soccer|f1|motogp)\b/i, /calcio/i];
    const NOISE = [/\b(interview|fashion|instagram|social|gossip|sponsor|partnership)\b/i, /off court|preview|draw|entry list|programma|schedule|preview match/i];

    let rawArticles = loadNewsCache(playerName);
    const retrieval = {
        version: 'TENNIS_DEEPSCAN_RETRIEVAL_RECEIPT_V1_PATCH15',
        cacheHit: Array.isArray(rawArticles),
        cacheTtlHours: NEWS_TTL_MS / 3600000,
        googleNewsStatus: 'NOT_TESTED',
        bingNewsStatus: 'NOT_TESTED',
        rawArticleCount: Array.isArray(rawArticles) ? rawArticles.length : 0,
        relevantArticleCount: 0,
        modelAuthority: false,
        settlementAuthority: false
    };
    if (!rawArticles) {
        rawArticles = [];
        const baseQuery = `"${fullName}" tennis (injury OR infortunio OR retired OR withdraws OR fatigue OR win OR loss)`;
        const [gRes, bRes] = await Promise.allSettled([
            fetchWithRetry(`https://news.google.com/rss/search?q=${encodeURIComponent(baseQuery + " when:6m")}`, { timeout: 7000 }),
            fetchWithRetry(`https://www.bing.com/news/search?q=${encodeURIComponent(baseQuery)}&format=rss`, { timeout: 7000 })
        ]);
        retrieval.googleNewsStatus = gRes.status === 'fulfilled' ? 'PASS' : 'FAIL';
        retrieval.bingNewsStatus = bRes.status === 'fulfilled' ? 'PASS' : 'FAIL';

        const extract = (response) => {
            if (response.status === 'fulfilled' && response.value && response.value.data) {
                const $ = cheerio.load(response.value.data, { xmlMode: true });
                $('item').each((i, el) => {
                    if (i < 30) { 
                        const title = $(el).find('title').text().toLowerCase();
                        const desc = $(el).find('description').text().toLowerCase();
                        const pubDateStr = $(el).find('pubDate').text() || $(el).find('dc\\:date').text();
                        rawArticles.push({ title, fullText: `${title} ${desc}`, pubDate: pubDateStr });
                    }
                });
            }
        };
        extract(gRes); extract(bRes);
        retrieval.rawArticleCount = rawArticles.length;
        saveNewsCache(playerName, rawArticles);
    }

    let unique = [];
    for (let a of rawArticles) {
        const t = a.fullText;
        if (BOILERPLATE.some(r => r.test(t)) || NON_TENNIS.some(r => r.test(t)) || NOISE.some(r => r.test(t))) continue;
        if (!unique.some(u => u.title === a.title || (a.title.length > 25 && u.title.includes(a.title.slice(0, 25))))) unique.push(a);
    }

    if (unique.length === 0) return { score: 0, tactics: tacticalIssues, report: 'Neutro ⚖️', color: '#94a3b8', nlpConfidence: 0, injuryScore, fatigueScore, momentumScore, psychologyScore, retrieval: { ...retrieval, filteredArticleCount: 0, relevantArticleCount: 0, status: retrieval.cacheHit ? 'WARN_EMPTY_CACHE' : 'WARN_NO_RELEVANT_ARTICLES' } };

    let relevant = 0; let perScores = []; const now = Date.now();

    for (let a of unique) {
        const text = a.fullText; const title = a.title;
        const hasSurname = text.includes(surname); const hasFull = text.includes(fullName);
        if (FALSE_POSITIVE.some(r => r.test(title)) && !hasFull) continue;

        let daysOld = a.pubDate ? (now - new Date(a.pubDate).getTime()) / 86400000 : 0;
        let timeMultiplier = daysOld > 120 ? 0.2 : daysOld > 60 ? 0.4 : daysOld > 14 ? 0.6 : 1.0;
        if (PAST_TEXT.some(r => r.test(text)) && timeMultiplier > 0.4) timeMultiplier = 0.4; 

        const relBoost = (hasFull ? 1.0 : hasSurname ? 0.7 : 0.4) * timeMultiplier;
        let articleScore = 0; let localInjury = false; let isRelevant = false;
        const isRecovery = RECOVERY.some(r => r.test(text));

        if (POSITIVE.some(r => r.test(text))) { articleScore += 1.0 * relBoost; momentumScore += 0.5 * relBoost; isRelevant = true; }
        if (NEGATIVE.some(r => r.test(text))) { articleScore -= 1.0 * relBoost; momentumScore -= 0.5 * relBoost; isRelevant = true; }

        if (INJURY.some(r => r.test(text))) {
            if (isRecovery || timeMultiplier <= 0.4) { injuryScore -= 0.2 * relBoost; articleScore -= 0.1 * relBoost; } 
            else { tacticalIssues.mentions += 1; localInjury = true; injuryScore -= 1.2 * relBoost; articleScore -= 1.0 * relBoost; isRelevant = true; }
        }

        if (STRONG_INJURY.some(r => r.test(text)) && timeMultiplier > 0.4 && !isRecovery) {
            tacticalIssues.mentions += 1; localInjury = true; injuryScore -= 2.0 * relBoost; articleScore -= 1.5 * relBoost; isRelevant = true;
        }

        if (FATIGUE.some(r => r.test(text)) && !isRecovery && timeMultiplier > 0.6) {
            tacticalIssues.fatigue = true; fatigueScore -= 1.0 * relBoost; articleScore -= 0.8 * relBoost; isRelevant = true;
        }

        if (localInjury && hasFull && /\b(withdraws|retires|ritiro|walkover|forfait)\b/i.test(text) && timeMultiplier > 0.6 && !isRecovery) {
            tacticalIssues.isEmergency = true;
        }

        if (isRelevant) { relevant++; perScores.push(articleScore); score += articleScore; }
    }

    const mean = perScores.reduce((a, b) => a + b, 0) / (perScores.length || 1);
    const variance = perScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (perScores.length || 1);
    const nlpConfidence = Math.min(1, Math.max(0, (relevant / unique.length) * (1 - Math.min(1, variance / 4.0)))) * 100;

    tacticalIssues.injuryOut = (tacticalIssues.isEmergency && nlpConfidence >= 55 && injuryScore <= -1.5) || 
                               (tacticalIssues.mentions >= 4 && injuryScore <= -2.5 && nlpConfidence >= 65);
    if ((injuryScore < 0 && momentumScore > 0) || nlpConfidence < 40) tacticalIssues.injuryOut = false;

    return { 
        score: Math.max(-6, Math.min(4, score)), tactics: tacticalIssues, 
        report: tacticalIssues.injuryOut ? 'Allarme Ritiro 🚨' : score > 1.0 ? 'Positivo 🔥' : score < -1.0 ? 'Negativo 📉' : 'Neutro ⚖️', 
        color: tacticalIssues.injuryOut ? '#ef4444' : score > 0 ? '#10b981' : score < 0 ? '#ef4444' : '#94a3b8', 
        nlpConfidence, injuryScore, fatigueScore, momentumScore, psychologyScore,
        retrieval: {
            ...retrieval,
            filteredArticleCount: unique.length,
            relevantArticleCount: relevant,
            status: relevant > 0 ? 'PASS_RELEVANT_CONTEXT' : 'WARN_NO_RELEVANT_CONTEXT'
        }
    };
}

async function getSentimentAnalysis(playerName) {
    const key = patch27CacheKey(playerName);
    const cached = patch27CacheGet(patch27NewsResultCache, key);
    if (cached) {
        patch27PerformanceCounters.newsMemoryHits += 1;
        return patch27WithRetrievalMarker(cached, { memoryCacheHit: true, cacheLayer: 'RAM_RESULT_CACHE_PATCH27' });
    }
    if (patch27NewsInFlight.has(key)) {
        patch27PerformanceCounters.newsInFlightHits += 1;
        const value = await patch27NewsInFlight.get(key);
        return patch27WithRetrievalMarker(value, { inFlightDeduplicated: true, cacheLayer: 'RAM_INFLIGHT_PATCH27' });
    }
    patch27PerformanceCounters.newsMisses += 1;
    const startedAt = Date.now();
    const task = getSentimentAnalysisUncached(playerName)
        .then(value => {
            const relevant = Number(value?.retrieval?.relevantArticleCount || 0);
            patch27CacheSet(patch27NewsResultCache, key, value, relevant > 0 ? NEWS_TTL_MS : PATCH27_NEGATIVE_CACHE_TTL_MS);
            return patch27WithRetrievalMarker(value, { memoryCacheHit: false, elapsedMs: Date.now() - startedAt, cacheLayer: 'SOURCE_OR_DISK_PATCH27' });
        })
        .finally(() => patch27NewsInFlight.delete(key));
    patch27NewsInFlight.set(key, task);
    return task;
}

// ======================================================
// 📊 FASE 3: TENNISMYLIFE
// ======================================================
async function getTMLStatsUncached(p1, p2) {
    let stats = { success: false, p1Wins: 0, p2Wins: 0, matchesFound: 0, p1Clay: 0, p2Clay: 0, retrieval: { version: 'TENNIS_DEEPSCAN_H2H_RETRIEVAL_V1_PATCH15', source: 'DUCKDUCKGO_LITE', status: 'NOT_TESTED', contextOnly: true, settlementAuthority: false } };
    try {
        const query = `${p1.split(' ').pop()} vs ${p2.split(' ').pop()} h2h tennis`;
        const res = await fetchWithRetry(`https://lite.duckduckgo.com/lite/`, {
            method: 'POST',
            data: `q=${encodeURIComponent(query)}&kl=&df=`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
        }, 1);
        let text = ""; cheerio.load(res.data)('.result-snippet').each((i, el) => { text += cheerio.load(res.data)(el).text().toLowerCase() + " "; });
        stats.retrieval = { ...stats.retrieval, status: text.trim() ? 'PASS_RESPONSE' : 'WARN_EMPTY_RESPONSE', responseChars: text.length };
        let m1 = text.match(new RegExp(`${p1.split(' ').pop().toLowerCase()}\\s*(?:leads|leads h2h|wins|won)\\s*(\\d+)\\s*-\\s*(\\d+)`, 'i'));
        if (m1) { stats.p1Wins = parseInt(m1[1]); stats.p2Wins = parseInt(m1[2]); stats.matchesFound = stats.p1Wins + stats.p2Wins; stats.success = true; }
        
        let clay1 = text.match(new RegExp(`${p1.split(' ').pop().toLowerCase()}\\s*clay.*?(\\d+)%`, 'i'));
        if (clay1) stats.p1Clay = parseInt(clay1[1]);
        let clay2 = text.match(new RegExp(`${p2.split(' ').pop().toLowerCase()}\\s*clay.*?(\\d+)%`, 'i'));
        if (clay2) stats.p2Clay = parseInt(clay2[1]);
    } catch(e) {
        stats.retrieval = { ...stats.retrieval, status: 'FAIL', error: e.message || String(e) };
    }
    return stats;
}

async function getTMLStats(p1, p2) {
    const key = [patch27CacheKey(p1), patch27CacheKey(p2)].sort().join('::');
    const cached = patch27CacheGet(patch27H2hResultCache, key);
    if (cached) {
        patch27PerformanceCounters.h2hMemoryHits += 1;
        return { ...cached, retrieval: { ...(cached.retrieval || {}), memoryCacheHit: true, cacheLayer: 'RAM_H2H_CACHE_PATCH27' } };
    }
    if (patch27H2hInFlight.has(key)) {
        patch27PerformanceCounters.h2hInFlightHits += 1;
        const value = await patch27H2hInFlight.get(key);
        return { ...value, retrieval: { ...(value.retrieval || {}), inFlightDeduplicated: true, cacheLayer: 'RAM_H2H_INFLIGHT_PATCH27' } };
    }
    patch27PerformanceCounters.h2hMisses += 1;
    const startedAt = Date.now();
    const task = getTMLStatsUncached(p1, p2)
        .then(value => {
            patch27CacheSet(patch27H2hResultCache, key, value, value?.success ? PATCH27_H2H_CACHE_TTL_MS : PATCH27_NEGATIVE_CACHE_TTL_MS);
            return { ...value, retrieval: { ...(value.retrieval || {}), memoryCacheHit: false, elapsedMs: Date.now() - startedAt, cacheLayer: 'NETWORK_PATCH27' } };
        })
        .finally(() => patch27H2hInFlight.delete(key));
    patch27H2hInFlight.set(key, task);
    return task;
}

function getPatch27PerformanceHealth() {
    return {
        version: 'TENNIS_DEEPSCAN_RAM_CACHE_V1_PATCH27',
        mode: 'BOUNDED_RAM_RESULT_CACHE_AND_INFLIGHT_DEDUPLICATION',
        cacheLimits: { maxEntriesPerCache: PATCH27_MEMORY_CACHE_MAX, newsTtlMs: NEWS_TTL_MS, h2hTtlMs: PATCH27_H2H_CACHE_TTL_MS, negativeTtlMs: PATCH27_NEGATIVE_CACHE_TTL_MS },
        sizes: { news: patch27NewsResultCache.size, newsInFlight: patch27NewsInFlight.size, h2h: patch27H2hResultCache.size, h2hInFlight: patch27H2hInFlight.size },
        counters: { ...patch27PerformanceCounters },
        probabilityAuthority: false,
        stakeAuthority: false,
        newOddsApiCalls: 0
    };
}
function resetPatch27PerformanceCache() {
    patch27NewsResultCache.clear(); patch27NewsInFlight.clear(); patch27H2hResultCache.clear(); patch27H2hInFlight.clear();
    Object.keys(patch27PerformanceCounters).forEach(key => { patch27PerformanceCounters[key] = 0; });
}

function computeStructuralRisk(p1ServePctRaw, p2ServePctRaw, dr1_num, dr2_num, p1Data, p2Data, surface, tmlData) {
    const serveDiff = Math.abs(p1ServePctRaw - p2ServePctRaw) / 100;
    const drDiff = Math.abs(dr1_num - dr2_num);
    const injuryFactor = (p1Data.tactics.injuryOut || p2Data.tactics.injuryOut) ? 0.6 : 0.0;
    let surfaceFactor = 0.0;
    if (surface === 'Clay' && tmlData && tmlData.success) surfaceFactor = Math.abs((tmlData.p1Clay || 0) - (tmlData.p2Clay || 0)) / 100 * 0.4;
    return safeClamp(0.4 * serveDiff + 0.3 * drDiff + 0.2 * injuryFactor + 0.1 * surfaceFactor, 0, 1);
}

// ======================================================
// 🧭 FASE 4: RISK TAXONOMY & MARKET REFERENCE GUARDRAILS
// ======================================================
function hasTwoWayReferenceOdds(odd1, odd2) {
    return !!(normalizeOdd(odd1) && normalizeOdd(odd2));
}

function calculateNoVigSideProbabilityPct(prediction, odd1, odd2) {
    const o1 = normalizeOdd(odd1);
    const o2 = normalizeOdd(odd2);

    if (!o1 || !o2) return null;

    const p1 = 1 / o1;
    const p2 = 1 / o2;
    const total = p1 + p2;

    if (total <= 0) return null;

    const cleanPred = String(prediction || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    return cleanPred === '2' ? (p2 / total) * 100 : (p1 / total) * 100;
}

function getPillarStatus(riskScore) {
    const r = safeClamp(toNumber(riskScore, 0), 0, 100);
    if (r >= 75) return 'FAIL';
    if (r >= 50) return 'WARN_HIGH';
    if (r >= 30) return 'WARN';
    return 'PASS';
}

function buildPillar(name, risk, weight, summary, evidence = []) {
    const normalizedRisk = round(safeClamp(toNumber(risk, 0), 0, 100), 1);
    return {
        name,
        risk: normalizedRisk,
        weight,
        status: getPillarStatus(normalizedRisk),
        summary,
        evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : []
    };
}

function weightedRisk(pillars = []) {
    let totalWeight = 0;
    let weighted = 0;

    for (const pillar of pillars) {
        const w = Math.max(0, toNumber(pillar.weight, 0));
        weighted += safeClamp(toNumber(pillar.risk, 0), 0, 100) * w;
        totalWeight += w;
    }

    if (totalWeight <= 0) return 0;
    return safeClamp(weighted / totalWeight, 0, 100);
}


// ======================================================
// 🎚️ STEP 40 / v15.0 - DEEPSCAN WEIGHTED CALIBRATION LAYER
// Obiettivo: separare Value Score e Risk Score con impatto operativo esplicito su gate/stake.
// DeepScan resta operational-gate: lo stake reale continua a essere deciso da Kelly/Gate.
// ======================================================

// STEP50C_DEEPSCAN_CALIBRATION_REBALANCE
// - Ribilancia la tassonomia DeepScan Tennis per evitare distribuzione troppo pessimistica.
// - Introduce una fascia verde bootstrap prudente: VALUE_CONFERMATO solo come validazione qualitativa/micro, non stake pieno.
// - Mantiene hard veto per medical, market trap grave, totals senza Markov e alto rischio reale.
const TENNIS_DEEPSCAN_CALIBRATION_STEP50C = Object.freeze({
    version: 'STEP50C_DEEPSCAN_CALIBRATION_REBALANCE',
    greenBootstrapEnabled: true,
    minValueForGreenBootstrap: 72,
    maxRiskForGreenBootstrap: 34,
    maxMarketRiskForGreenBootstrap: 62,
    maxOverconfidenceRiskForGreenBootstrap: 58,
    maxFitnessRiskForGreenBootstrap: 35,
    maxMarketDisagreementPpGreen: 12,
    minEdgePpGreen: 7,
    minEvPctGreen: 10,
    modelRiskThreshold: 58,
    highRiskThreshold: 78
});



// STEP50E_TOTALS_DEEPSCAN_CALIBRATION
// DeepScan deve valutare Over/Under con una tassonomia propria, senza compromettere il modello 1/2.
// Campi supportati: market_type, side, line, over_odd, under_odd, no_vig_over_prob,
// no_vig_under_prob, model_prob_over, model_prob_under, expected_games, games_std_dev,
// markov_confidence, tie_break_risk, best_of_sets, surface_games_profile,
// hold_break_profile, line_distance e duplicate_line_rank.
const TENNIS_TOTALS_DEEPSCAN_STEP50E = Object.freeze({
    version: 'STEP50E_TOTALS_DEEPSCAN_CALIBRATION',
    minMarkovConfidenceForTotalsGreen: 0.58,
    minLineDistanceForTotalsGreen: 1.15,
    minLineDistanceForTotalsEdge: 0.65,
    maxDuplicateLineRankGreen: 2,
    maxGamesStdDevGreen: 6.25,
    highRiskMarkovConfidence: 0.35,
    extremeEvPctWarning: 42,
    cappedProbabilityWarningPct: 74,
    totalsGreenAction: '🟢 VALUE TOTALS · MICRO',
    totalsTechnicalAction: '📊 EDGE TOTALS',
    totalsWaitAction: '🟡 WAIT IN PLAY TOTALS',
    totalsModelRiskAction: '🟠 RISCHIO MODELLO TOTALS'
});

function parseTotalsPrediction(prediction = '') {
    const text = String(prediction || '').toUpperCase();
    const side = text.includes('UNDER') ? 'UNDER' : (text.includes('OVER') ? 'OVER' : null);
    const lineMatch = text.match(/(\d+(?:\.5)?)/);
    const line = lineMatch ? toNumber(lineMatch[1], null) : null;
    return { isTotals: Boolean(side), side, line };
}

function pickContextValue(input = {}, keys = [], fallback = null) {
    for (const key of keys) {
        if (input[key] !== undefined && input[key] !== null && input[key] !== '') return input[key];
        if (input.matchContext && input.matchContext[key] !== undefined && input.matchContext[key] !== null && input.matchContext[key] !== '') return input.matchContext[key];
    }
    return fallback;
}

function pickContextNumberAny(input = {}, keys = [], fallback = null) {
    const value = pickContextValue(input, keys, null);
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeTotalsProbabilityPct(value, fallback = null) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n <= 1 ? safeClamp(n * 100, 0, 100) : safeClamp(n, 0, 100);
}

function buildTotalsDeepScanContext(input = {}) {
    const parsed = parseTotalsPrediction(input.cleanPred || input.prediction || input.bet_type || '');
    const marketType = String(pickContextValue(input, ['market_type', 'marketType'], '') || '').toLowerCase();
    const strategy = String(pickContextValue(input, ['strategy_tag', 'strategyTag'], '') || '').toUpperCase();
    const side = String(pickContextValue(input, ['side', 'totalsSide'], parsed.side || '') || '').toUpperCase() || parsed.side;
    const line = pickContextNumberAny(input, ['line', 'point', 'pointLine', 'point_line', 'totalsLine'], parsed.line);
    const isTotals = Boolean(side === 'OVER' || side === 'UNDER' || marketType === 'totals' || strategy.includes('OVER') || strategy.includes('UNDER'));

    const overOdd = pickContextNumberAny(input, ['over_odd', 'overOdd', 'totalsOverOdd'], null);
    const underOdd = pickContextNumberAny(input, ['under_odd', 'underOdd', 'totalsUnderOdd'], null);
    const noVigOverProb = normalizeTotalsProbabilityPct(pickContextValue(input, ['no_vig_over_prob', 'noVigOverProb', 'noVigOverProbability'], null), null);
    const noVigUnderProb = normalizeTotalsProbabilityPct(pickContextValue(input, ['no_vig_under_prob', 'noVigUnderProb', 'noVigUnderProbability'], null), null);
    const modelProbOver = normalizeTotalsProbabilityPct(pickContextValue(input, ['model_prob_over', 'modelProbOver', 'modelProbabilityOver'], null), null);
    const modelProbUnder = normalizeTotalsProbabilityPct(pickContextValue(input, ['model_prob_under', 'modelProbUnder', 'modelProbabilityUnder'], null), null);
    const expectedGames = pickContextNumberAny(input, ['expected_games', 'expectedGames', 'markovExpectedGames'], null);
    const gamesStdDev = pickContextNumberAny(input, ['games_std_dev', 'gamesStdDev', 'markovGamesStdDev'], null);
    const markovConfidence = safeClamp(pickContextNumberAny(input, ['markov_confidence', 'markovConfidence'], input.markovValidated ? 0.68 : 0), 0, 1);
    const bestOfSets = pickContextNumberAny(input, ['best_of_sets', 'bestOfSets', 'bestOf'], null);
    const duplicateLineRank = pickContextNumberAny(input, ['duplicate_line_rank', 'duplicateLineRank'], 1);
    const tieBreakRisk = String(pickContextValue(input, ['tie_break_risk', 'tieBreakRisk', 'tbRisk'], '') || '');
    const surfaceGamesProfile = pickContextValue(input, ['surface_games_profile', 'surfaceGamesProfile'], null);
    const holdBreakProfile = pickContextValue(input, ['hold_break_profile', 'holdBreakProfile'], null);

    const sideModelProb = side === 'UNDER' ? modelProbUnder : modelProbOver;
    const oppositeModelProb = side === 'UNDER' ? modelProbOver : modelProbUnder;
    const sideNoVigProb = side === 'UNDER' ? noVigUnderProb : noVigOverProb;
    const oppositeNoVigProb = side === 'UNDER' ? noVigOverProb : noVigUnderProb;
    const lineDistanceRaw = pickContextNumberAny(input, ['line_distance', 'lineDistance'], null);
    const lineDistance = Number.isFinite(lineDistanceRaw)
        ? Math.abs(lineDistanceRaw)
        : (Number.isFinite(expectedGames) && Number.isFinite(line) ? Math.abs(expectedGames - line) : null);

    const probabilityCapped = isTotals && Number.isFinite(sideModelProb) && Math.abs(sideModelProb - TENNIS_TOTALS_DEEPSCAN_STEP50E.cappedProbabilityWarningPct) <= 0.15;
    const hasRealTotalsOddsPair = Number.isFinite(overOdd) && Number.isFinite(underOdd) && overOdd > 1 && underOdd > 1;
    const hasNoVigPair = Number.isFinite(noVigOverProb) && Number.isFinite(noVigUnderProb);

    return {
        version: TENNIS_TOTALS_DEEPSCAN_STEP50E.version,
        isTotals,
        side,
        line,
        overOdd,
        underOdd,
        noVigOverProb,
        noVigUnderProb,
        modelProbOver,
        modelProbUnder,
        sideModelProb,
        oppositeModelProb,
        sideNoVigProb,
        oppositeNoVigProb,
        expectedGames,
        gamesStdDev,
        markovConfidence,
        tieBreakRisk,
        bestOfSets,
        surfaceGamesProfile,
        holdBreakProfile,
        lineDistance,
        duplicateLineRank,
        hasRealTotalsOddsPair,
        hasNoVigPair,
        probabilityCapped
    };
}

const TENNIS_DEEPSCAN_WEIGHTS_V15 = Object.freeze({
    EDGE_EV: 16,
    PROBABILITY: 8,
    MARKET_CLV: 14,
    CALIBRATION: 8,
    DATA_QUALITY: 8,
    STYLE_SURFACE: 12,
    FITNESS_NEWS: 12,
    OVERCONFIDENCE: 8,
    REAL_RANKING: 6,
    TOURNAMENT_MOTIVATION: 5,
    MARKET_SPECIFIC: 3
});

const TENNIS_DEEPSCAN_LEVELS_V15 = Object.freeze({
    VALUE_CONFIRMED: 'VALUE_CONFERMATO',
    TECHNICAL_EDGE: 'EDGE_TECNICO',
    WATCHLIST: 'WATCHLIST_LOW_EDGE',
    MODEL_RISK: 'RISCHIO_MODELLO',
    HIGH_RISK: 'ALTO_RISCHIO',
    INSUFFICIENT_DATA: 'DATI_INSUFFICIENTI'
});

function getTennisDeepScanWeightTotal() {
    return Object.values(TENNIS_DEEPSCAN_WEIGHTS_V15).reduce((sum, value) => sum + toNumber(value, 0), 0);
}

function buildWeightedDeepScanComponent(key, label, weight, valueScore, riskScore, summary, evidence = []) {
    const normalizedWeight = Math.max(0, toNumber(weight, 0));
    const v = round(safeClamp(toNumber(valueScore, 0), 0, 100), 1);
    const r = round(safeClamp(toNumber(riskScore, 0), 0, 100), 1);
    return {
        key,
        label,
        weight: normalizedWeight,
        weightPct: normalizedWeight,
        valueScore: v,
        riskScore: r,
        status: getPillarStatus(r),
        contribution: round((r * normalizedWeight) / 100, 2),
        summary: summary || '',
        evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : []
    };
}

function findSixPillarRisk(sixPillar = {}, prefix = '') {
    const p = Array.isArray(sixPillar.pillars)
        ? sixPillar.pillars.find(item => String(item.name || '').toLowerCase().startsWith(String(prefix || '').toLowerCase()))
        : null;
    return p ? safeClamp(toNumber(p.risk, 0), 0, 100) : 0;
}

function scoreDeepScanEdgeValue(edgePp, evPct) {
    const edge = toNumber(edgePp, 0);
    const ev = toNumber(evPct, 0);
    let score = 20;

    if (edge >= 15 || ev >= 25) score = 92;
    else if (edge >= 10 || ev >= 12) score = 82;
    else if (edge >= 6 || ev >= 6) score = 68;
    else if (edge >= 3 || ev >= 2) score = 52;
    else score = 25;

    return safeClamp(score, 0, 100);
}

function scoreDeepScanEdgeRisk(edgePp, evPct, marketReferenceAvailable) {
    const edge = Math.abs(toNumber(edgePp, 0));
    const ev = Math.abs(toNumber(evPct, 0));
    let risk = 8;

    // Step50C: edge/EV elevati non sono automaticamente value trap se esiste reference market.
    // Restano più rischiosi senza reference, ma non devono spingere tutto in ALTO_RISCHIO.
    if (edge > 15 || ev > 25) risk += marketReferenceAvailable ? 12 : 28;
    else if (edge >= 10 || ev >= 18) risk += marketReferenceAvailable ? 7 : 18;
    else if (edge >= 6 || ev >= 8) risk += marketReferenceAvailable ? 3 : 8;

    return safeClamp(risk, 0, 100);
}

function scoreDeepScanProbabilityValue(probabilityPct) {
    const p = normalizeProbabilityPct(probabilityPct, 50);
    if (p >= 60 && p <= 72) return 78;
    if (p > 72 && p <= 80) return 72;
    if (p > 80) return 62;
    if (p >= 52) return 55;
    return 32;
}

function scoreDeepScanProbabilityRisk(probabilityPct, marketReferenceAvailable, calibrationGrade) {
    const p = normalizeProbabilityPct(probabilityPct, 50);
    const grade = String(calibrationGrade || '').toUpperCase();
    let risk = 10;

    // Step50C: in bootstrap non trattare ogni favorito 80%+ come veto.
    // Penalizziamo forte solo probabilità estreme o non supportate dal mercato.
    if (p > 90) risk += 44;
    else if (p > 84) risk += 30;
    else if (p > 80) risk += 20;
    else if (p > 74) risk += 10;
    else if (p < 52) risk += 14;

    if (p > 82 && !marketReferenceAvailable) risk += 14;
    if (p > 84 && (!grade || grade === 'UNKNOWN' || grade === 'LOW_SAMPLE')) risk += 8;

    return safeClamp(risk, 0, 100);
}

function normalizeDeepScanCalibrationGrade(input = {}) {
    const raw = input.calibrationGrade || input.predictiveCalibrationGrade || input.segmentCalibrationGrade || input.professionalCalibrationGrade || input.calibration_status || input.calibrationStatus || '';
    const text = String(raw || '').toUpperCase();
    if (!text) return 'UNKNOWN';
    if (text.includes('ELITE')) return 'ELITE';
    if (text.includes('GOOD') || text.includes('OK')) return 'GOOD';
    if (text.includes('WARN') || text.includes('LOW_SAMPLE') || text.includes('UNKNOWN')) return 'UNKNOWN';
    if (text.includes('BAD') || text.includes('FAIL')) return 'BAD';
    return text;
}

function buildTennisDeepScanWeightedAssessment(input = {}, sixPillar = null) {
    const weights = TENNIS_DEEPSCAN_WEIGHTS_V15;
    const totalsContext = buildTotalsDeepScanContext(input);
    const sp = sixPillar || buildTennisSixPillarAssessment(input);
    const marketReferenceAvailable = !!input.marketReferenceAvailable || (totalsContext.isTotals && totalsContext.hasRealTotalsOddsPair);
    const edge = toNumber(input.edgePp ?? input.realEdge ?? input.edge_pp, 0);
    const ev = toNumber(input.evPct ?? input.realEvPct ?? input.ev_pct, 0);
    const probability = totalsContext.isTotals && Number.isFinite(totalsContext.sideModelProb)
        ? totalsContext.sideModelProb
        : normalizeProbabilityPct(input.probabilityPct ?? input.adjustedProbabilityPct ?? input.modelProbabilityPct, 50);
    const marketDisagreement = totalsContext.isTotals && Number.isFinite(totalsContext.sideNoVigProb)
        ? Math.abs(probability - totalsContext.sideNoVigProb)
        : Math.abs(toNumber(input.marketDisagreementPp, 0));
    const sackmannSample = Math.max(0, toNumber(input.sackmannSample, 0));
    const surfaceDetection = input.surfaceDetection || {};
    const surfaceConfidence = safeClamp(toNumber(surfaceDetection.confidence, 0), 0, 1);
    const calibrationGrade = normalizeDeepScanCalibrationGrade(input);
    const isTotals = totalsContext.isTotals || /OVER|UNDER|TOTAL/i.test(String(input.cleanPred || input.prediction || input.bet_type || ''));
    const markovValidated = input.markovValidated === true || input.markov_validated === true || input.markov_validated === 1 || (isTotals && totalsContext.markovConfidence >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minMarkovConfidenceForTotalsGreen);

    const marketRisk = findSixPillarRisk(sp, 'Market');
    const styleRisk = findSixPillarRisk(sp, 'Style');
    const fitnessRisk = findSixPillarRisk(sp, 'Fitness');
    const motivationRisk = findSixPillarRisk(sp, 'Motivazione');
    const overconfidenceRisk = findSixPillarRisk(sp, 'Overconfidence');
    const rankingRisk = findSixPillarRisk(sp, 'Ranking');

    const edgeValue = scoreDeepScanEdgeValue(edge, ev);
    const edgeRisk = scoreDeepScanEdgeRisk(edge, ev, marketReferenceAvailable);
    const probabilityValue = scoreDeepScanProbabilityValue(probability);
    const probabilityRisk = scoreDeepScanProbabilityRisk(probability, marketReferenceAvailable, calibrationGrade);

    let marketValue = marketReferenceAvailable ? safeClamp(80 - marketDisagreement * 2.2, 15, 90) : 36;
    // STEP91: nessun CLV della giocata corrente nel pre-match. Il punteggio mercato usa solo reference/fair odds.
    if (isTotals && totalsContext.hasRealTotalsOddsPair && Number.isFinite(totalsContext.sideNoVigProb)) {
        marketValue = safeClamp(82 - marketDisagreement * 2.0, 20, 92);
    }
    marketValue = safeClamp(marketValue, 0, 100);

    let calibrationValue = 42;
    let calibrationRisk = 36;
    if (calibrationGrade === 'ELITE') { calibrationValue = 90; calibrationRisk = 10; }
    else if (calibrationGrade === 'GOOD') { calibrationValue = 78; calibrationRisk = 18; }
    else if (calibrationGrade === 'BAD') { calibrationValue = 24; calibrationRisk = 72; }
    else if (sackmannSample >= 50) { calibrationValue = 58; calibrationRisk = 28; }
    // Step50C: UNKNOWN resta limite allo stake pieno, non veto automatico DeepScan.
    if (calibrationGrade === 'UNKNOWN' && probability >= 84) calibrationRisk += 8;

    let dataQualityValue = 35;
    let dataQualityRisk = 50;
    if (sackmannSample >= 60 && !surfaceDetection.isFallback && surfaceConfidence >= 0.70) {
        dataQualityValue = 82; dataQualityRisk = 16;
    } else if (sackmannSample >= 30 && surfaceConfidence >= 0.50) {
        dataQualityValue = 66; dataQualityRisk = 28;
    } else if (sackmannSample >= 10) {
        dataQualityValue = 52; dataQualityRisk = 42;
    }
    if (surfaceDetection.isFallback) dataQualityRisk += 14;

    let marketSpecificRisk = isTotals && !markovValidated ? 72 : 12;
    let marketSpecificValue = isTotals && markovValidated ? 72 : (isTotals ? 28 : 60);
    if (isTotals) {
        if (!totalsContext.hasRealTotalsOddsPair) {
            marketSpecificRisk += 18;
            marketSpecificValue -= 18;
        }
        if (totalsContext.markovConfidence < TENNIS_TOTALS_DEEPSCAN_STEP50E.highRiskMarkovConfidence) {
            marketSpecificRisk += 16;
        } else if (totalsContext.markovConfidence >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minMarkovConfidenceForTotalsGreen) {
            marketSpecificRisk -= 8;
            marketSpecificValue += 8;
        }
        if (Number.isFinite(totalsContext.lineDistance)) {
            if (totalsContext.lineDistance >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minLineDistanceForTotalsGreen) {
                marketSpecificRisk -= 8;
                marketSpecificValue += 10;
            } else if (totalsContext.lineDistance < 0.45) {
                marketSpecificRisk += 12;
                marketSpecificValue -= 8;
            }
        }
        if (Number.isFinite(totalsContext.gamesStdDev) && totalsContext.gamesStdDev > 7.25) {
            marketSpecificRisk += 8;
        }
        if (totalsContext.duplicateLineRank > 2) {
            marketSpecificRisk += 8;
            marketSpecificValue -= 6;
        }
        if (totalsContext.probabilityCapped && ev >= TENNIS_TOTALS_DEEPSCAN_STEP50E.extremeEvPctWarning) {
            marketSpecificRisk += 10;
        }
        marketSpecificRisk = safeClamp(marketSpecificRisk, 0, 100);
        marketSpecificValue = safeClamp(marketSpecificValue, 0, 100);
    }

    const components = [
        buildWeightedDeepScanComponent('edge_ev', 'Edge / EV', weights.EDGE_EV, edgeValue, edgeRisk, `Edge ${round(edge, 2)}pp · EV ${round(ev, 2)}%.`, [
            edge > 15 || ev > 25 ? 'Valore molto alto: richiede conferma mercato reference/fair odds per evitare value trap.' : '',
            !marketReferenceAvailable && (edge >= 10 || ev >= 18) ? 'Edge elevato senza quote P1/P2: rischio overconfidence.' : ''
        ]),
        buildWeightedDeepScanComponent('probability', 'Probabilità calibrata', weights.PROBABILITY, probabilityValue, probabilityRisk, `Probabilità modello ${round(probability, 2)}%.`, [
            probability > 80 ? 'Probabilità >80%: serve conferma esterna per value pieno.' : ''
        ]),
        buildWeightedDeepScanComponent('market_clv', 'Mercato reference / Fair odds', weights.MARKET_CLV, marketValue, marketRisk, marketReferenceAvailable ? `Mercato two-way disponibile; disaccordo ${round(marketDisagreement, 1)}pp.` : 'Mercato reference assente o incompleto.', [
            input.marketReferenceSource ? `Fonte: ${input.marketReferenceSource}` : ''
        ]),
        buildWeightedDeepScanComponent('calibration', 'Calibrazione storica', weights.CALIBRATION, calibrationValue, calibrationRisk, `Calibrazione segmento: ${calibrationGrade}.`, [
            calibrationGrade === 'UNKNOWN' ? 'Campione/segmento non ancora sufficiente: non promuovere automaticamente.' : ''
        ]),
        buildWeightedDeepScanComponent('data_quality', 'Qualità dati', weights.DATA_QUALITY, dataQualityValue, dataQualityRisk, `Sample tecnico ${sackmannSample}; surface confidence ${round(surfaceConfidence * 100, 0)}%.`, [
            surfaceDetection.isFallback ? 'Surface fallback tecnico: richiede conferma live.' : ''
        ]),
        buildWeightedDeepScanComponent('style_surface', 'Superficie / stile', weights.STYLE_SURFACE, safeClamp(100 - styleRisk, 0, 100), styleRisk, 'Matchup tecnico e coerenza superficie.', []),
        buildWeightedDeepScanComponent('fitness_news', 'Fitness / news', weights.FITNESS_NEWS, safeClamp(100 - fitnessRisk, 0, 100), fitnessRisk, 'Rischio fisico, MTO, ritiro o fatica.', []),
        buildWeightedDeepScanComponent('overconfidence', 'Overconfidence modello', weights.OVERCONFIDENCE, safeClamp(100 - overconfidenceRisk, 0, 100), overconfidenceRisk, 'Probabilità alta, edge elevato e assenza conferma mercato.', []),
        buildWeightedDeepScanComponent('real_ranking', 'Ranking reale / trajectory', weights.REAL_RANKING, safeClamp(100 - rankingRisk, 0, 100), rankingRisk, 'Ranking ufficiale vs ranking reale stimato.', []),
        buildWeightedDeepScanComponent('tournament_motivation', 'Motivazione torneo', weights.TOURNAMENT_MOTIVATION, safeClamp(100 - motivationRisk, 0, 100), motivationRisk, 'Importanza torneo e rischio calendario/tanking.', []),
        buildWeightedDeepScanComponent('market_specific', 'Check mercato specifico', weights.MARKET_SPECIFIC, marketSpecificValue, marketSpecificRisk, isTotals ? `Totals ${totalsContext.side || ''} ${totalsContext.line || ''}: Markov ${round(totalsContext.markovConfidence * 100, 0)}%, distanza linea ${Number.isFinite(totalsContext.lineDistance) ? round(totalsContext.lineDistance, 2) : 'n/d'} game.` : 'Moneyline: check Markov totals non richiesto.', [
            isTotals && totalsContext.hasRealTotalsOddsPair ? `Quote coppia O/U: Over ${totalsContext.overOdd} · Under ${totalsContext.underOdd}` : '',
            isTotals && totalsContext.hasNoVigPair ? `No-vig O/U: Over ${round(totalsContext.noVigOverProb, 1)}% · Under ${round(totalsContext.noVigUnderProb, 1)}%` : '',
            isTotals && Number.isFinite(totalsContext.expectedGames) ? `Expected games ${round(totalsContext.expectedGames, 2)} vs linea ${totalsContext.line}` : ''
        ])
    ];

    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0) || 100;
    const riskScore = safeClamp(components.reduce((sum, c) => sum + c.riskScore * c.weight, 0) / totalWeight, 0, 100);
    const valueScore = safeClamp(components.reduce((sum, c) => sum + c.valueScore * c.weight, 0) / totalWeight, 0, 100);
    const confidenceScore = safeClamp((valueScore * 0.62) + ((100 - riskScore) * 0.38), 0, 100);

    const hardVetoReasons = [];
    if (input.hardMedicalVeto || fitnessRisk >= 95) hardVetoReasons.push('Fitness/news hard veto o rischio fisico >=95.');
    if (marketRisk >= 90 && overconfidenceRisk >= 70) hardVetoReasons.push('Market trap grave combinato con overconfidence elevata.');
    if (isTotals && !markovValidated) hardVetoReasons.push('Mercato totals senza validazione Markov.');
    if (isTotals && !totalsContext.hasRealTotalsOddsPair) hardVetoReasons.push('Mercato totals senza coppia quote Over/Under reale.');
    if (isTotals && totalsContext.markovConfidence > 0 && totalsContext.markovConfidence < TENNIS_TOTALS_DEEPSCAN_STEP50E.highRiskMarkovConfidence) hardVetoReasons.push('Markov confidence totals troppo bassa.');
    if (calibrationGrade === 'UNKNOWN' && probability > 80 && !marketReferenceAvailable) hardVetoReasons.push('Calibrazione UNKNOWN + probabilità >80% + mercato reference assente.');

    let level = TENNIS_DEEPSCAN_LEVELS_V15.WATCHLIST;
    let action = '🟡 WATCHLIST / LOW EDGE';

    const step50c = TENNIS_DEEPSCAN_CALIBRATION_STEP50C;
    const hasEliteConfirmedValue = valueScore >= 72 && riskScore <= 26 && (calibrationGrade === 'GOOD' || calibrationGrade === 'ELITE');
    const hasBootstrapGreenValue = step50c.greenBootstrapEnabled &&
        marketReferenceAvailable &&
        valueScore >= step50c.minValueForGreenBootstrap &&
        riskScore <= step50c.maxRiskForGreenBootstrap &&
        Math.abs(marketDisagreement) <= step50c.maxMarketDisagreementPpGreen &&
        marketRisk <= step50c.maxMarketRiskForGreenBootstrap &&
        overconfidenceRisk <= step50c.maxOverconfidenceRiskForGreenBootstrap &&
        fitnessRisk <= step50c.maxFitnessRiskForGreenBootstrap &&
        edge >= step50c.minEdgePpGreen &&
        ev >= step50c.minEvPctGreen &&
        !hardVetoReasons.length;

    const hasTotalsGreenValue = isTotals &&
        marketReferenceAvailable &&
        markovValidated &&
        totalsContext.hasRealTotalsOddsPair &&
        valueScore >= 66 &&
        riskScore <= 54 &&
        edge >= 5.5 &&
        ev >= 7.5 &&
        totalsContext.markovConfidence >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minMarkovConfidenceForTotalsGreen &&
        (!Number.isFinite(totalsContext.lineDistance) || totalsContext.lineDistance >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minLineDistanceForTotalsGreen) &&
        (!Number.isFinite(totalsContext.gamesStdDev) || totalsContext.gamesStdDev <= TENNIS_TOTALS_DEEPSCAN_STEP50E.maxGamesStdDevGreen) &&
        totalsContext.duplicateLineRank <= TENNIS_TOTALS_DEEPSCAN_STEP50E.maxDuplicateLineRankGreen &&
        !hardVetoReasons.length;

    const hasTotalsTechnicalEdge = isTotals &&
        marketReferenceAvailable &&
        markovValidated &&
        totalsContext.hasRealTotalsOddsPair &&
        valueScore >= 58 &&
        riskScore <= 64 &&
        edge >= 4 &&
        ev >= 5 &&
        (!Number.isFinite(totalsContext.lineDistance) || totalsContext.lineDistance >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minLineDistanceForTotalsEdge) &&
        !hardVetoReasons.length;

    if (hardVetoReasons.length || riskScore >= step50c.highRiskThreshold) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.HIGH_RISK;
        action = '🔴 ALTO RISCHIO';
    } else if (hasTotalsGreenValue) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.VALUE_CONFIRMED;
        action = TENNIS_TOTALS_DEEPSCAN_STEP50E.totalsGreenAction;
    } else if (hasTotalsTechnicalEdge) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.TECHNICAL_EDGE;
        action = TENNIS_TOTALS_DEEPSCAN_STEP50E.totalsTechnicalAction;
    } else if (hasEliteConfirmedValue || hasBootstrapGreenValue) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.VALUE_CONFIRMED;
        action = hasEliteConfirmedValue ? '🟢 VALUE CONFERMATO' : '🟢 VALUE CONFERMATO · MICRO';
    } else if (isTotals && (riskScore >= 58 || totalsContext.probabilityCapped || totalsContext.duplicateLineRank > 2)) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.MODEL_RISK;
        action = TENNIS_TOTALS_DEEPSCAN_STEP50E.totalsModelRiskAction;
    } else if (riskScore >= step50c.modelRiskThreshold || (riskScore - valueScore) >= 14 || (marketRisk >= 78 && overconfidenceRisk >= 70)) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.MODEL_RISK;
        action = '🟠 RISCHIO MODELLO';
    } else if (valueScore >= 68 && riskScore <= 40 && marketReferenceAvailable) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.TECHNICAL_EDGE;
        action = '📊 EDGE TECNICO';
    } else if (isTotals && markovValidated && marketReferenceAvailable) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.WATCHLIST;
        action = TENNIS_TOTALS_DEEPSCAN_STEP50E.totalsWaitAction;
    } else if (riskScore >= 42 || valueScore < 55 || !marketReferenceAvailable) {
        level = TENNIS_DEEPSCAN_LEVELS_V15.WATCHLIST;
        action = '🟡 WATCHLIST / LOW EDGE';
    } else {
        level = TENNIS_DEEPSCAN_LEVELS_V15.TECHNICAL_EDGE;
        action = '📊 EDGE TECNICO';
    }

    const sortedDrivers = [...components]
        .sort((a, b) => (b.riskScore * b.weight) - (a.riskScore * a.weight))
        .slice(0, 4);

    return {
        version: 'TENNIS_DEEPSCAN_WEIGHTED_V15',
        weights,
        totalWeight: getTennisDeepScanWeightTotal(),
        valueScore: round(valueScore, 1),
        riskScore: round(riskScore, 1),
        confidenceScore: round(confidenceScore, 1),
        level,
        action,
        components,
        hardVetoReasons,
        totalsContext: isTotals ? totalsContext : null,
        mainDrivers: sortedDrivers.map(c => ({
            key: c.key,
            label: c.label,
            weight: c.weight,
            riskScore: c.riskScore,
            valueScore: c.valueScore,
            summary: c.summary
        })),
        thresholds: {
            valueConfirmed: 'Step50C: risk<=34 + value>=72 + mercato reference + edge/EV + nessun hard veto; GOOD/ELITE abilita conferma piena',
            technicalEdge: 'Step50C: risk<=40 + value>=68 + mercato reference disponibile',
            watchlist: 'Step50C: risk 42-57 oppure value fragile oppure mercato incompleto',
            modelRisk: 'Step50C: risk>=58 oppure overconfidence/market trap severo',
            highRisk: 'Step50C: risk>=78 oppure hard veto',
            totalsStep50E: 'Step50E: totals usa line, side, odds pair, no-vig, Markov confidence, expected games, varianza, tie-break e duplicate line rank'
        }
    };
}


function pickContextNumber(context = {}, keys = [], fallback = null) {
    for (const key of keys) {
        const n = Number(context?.[key]);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
}

function classifySurfaceFit(surface, dr, opponentDr, sample, isSelectedSide) {
    const s = String(surface || '').toLowerCase();
    const d = toNumber(dr, 1);
    const od = toNumber(opponentDr, 1);
    const delta = d - od;
    let score = 50;

    if (Number.isFinite(delta)) score += safeClamp(delta * 120, -18, 18);
    if (sample >= 30) score += 6;
    else if (sample < 10) score -= 8;

    if (s.includes('clay') || s.includes('terra')) score += d >= 1.03 ? 6 : -3;
    if (isSelectedSide) score += 2;

    score = safeClamp(score, 1, 99);
    if (score >= 68) return { score: round(score, 1), label: 'Forte fit superficie', status: 'PASS' };
    if (score >= 55) return { score: round(score, 1), label: 'Fit positivo', status: 'PASS' };
    if (score >= 45) return { score: round(score, 1), label: 'Fit neutro', status: 'WARN' };
    return { score: round(score, 1), label: 'Fit da verificare', status: 'WARN_HIGH' };
}

function estimateRealRankingForPlayer({ officialRank, bestRecentRank, dr, opponentDr, sample, surface, isSelectedSide }) {
    const official = Math.max(1, toNumber(officialRank, 500));
    const best = Math.max(1, toNumber(bestRecentRank, official));
    const d = toNumber(dr, 1);
    const od = toNumber(opponentDr, 1);
    const surfaceFit = classifySurfaceFit(surface, d, od, sample, isSelectedSide);

    let estimated = official;
    const bestIsBetter = best < official;
    if (bestIsBetter) estimated = (official * 0.62) + (best * 0.38);

    const drDelta = d - od;
    if (Number.isFinite(drDelta)) {
        if (drDelta >= 0.12) estimated *= 0.80;
        else if (drDelta >= 0.08) estimated *= 0.86;
        else if (drDelta >= 0.04) estimated *= 0.92;
        else if (drDelta <= -0.12) estimated *= 1.22;
        else if (drDelta <= -0.08) estimated *= 1.14;
        else if (drDelta <= -0.04) estimated *= 1.08;
    }

    if (surfaceFit.score >= 68) estimated *= 0.90;
    else if (surfaceFit.score < 45) estimated *= 1.10;

    if (sample < 10) estimated = (estimated * 0.55) + (official * 0.45);
    estimated = Math.max(1, Math.round(estimated));

    let confidence = 35;
    if (sample >= 50) confidence += 28;
    else if (sample >= 25) confidence += 20;
    else if (sample >= 10) confidence += 10;
    if (bestIsBetter) confidence += 8;
    if (surfaceFit.score >= 60) confidence += 8;
    if (Math.abs(drDelta || 0) >= 0.06) confidence += 8;
    confidence = safeClamp(confidence, 15, 92);

    return {
        officialRank: official,
        bestRecentRank: best,
        estimatedRealRank: estimated,
        surfaceFit,
        dominanceRatio: round(d, 2),
        drDelta: round(drDelta, 3),
        confidence: round(confidence, 0),
        note: bestIsBetter
            ? 'Best/recent ranking migliore del ranking attuale: profilo potenzialmente sottostimato.'
            : 'Ranking reale vicino al ranking ufficiale: nessuna prova forte di sottostima.'
    };
}

function buildRealRankingAssessment({ p1Name, p2Name, prediction, p1Rank, p2Rank, dr1, dr2, sackmannSample, surface, matchContext = {} }) {
    const p1Best = pickContextNumber(matchContext, ['p1_best_recent_rank', 'p1BestRecentRank', 'p1_best_rank_recent', 'p1_best_rank', 'home_best_rank', 'player1_best_rank'], p1Rank);
    const p2Best = pickContextNumber(matchContext, ['p2_best_recent_rank', 'p2BestRecentRank', 'p2_best_rank_recent', 'p2_best_rank', 'away_best_rank', 'player2_best_rank'], p2Rank);
    const cleanPred = String(prediction || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');

    const p1 = estimateRealRankingForPlayer({ officialRank: p1Rank, bestRecentRank: p1Best, dr: dr1, opponentDr: dr2, sample: sackmannSample, surface, isSelectedSide: cleanPred === '1' });
    const p2 = estimateRealRankingForPlayer({ officialRank: p2Rank, bestRecentRank: p2Best, dr: dr2, opponentDr: dr1, sample: sackmannSample, surface, isSelectedSide: cleanPred === '2' });

    const officialGap = Math.abs(p1.officialRank - p2.officialRank);
    const realGap = Math.abs(p1.estimatedRealRank - p2.estimatedRealRank);
    const selected = cleanPred === '2' ? p2 : p1;
    const opponent = cleanPred === '2' ? p1 : p2;
    const selectedName = cleanPred === '2' ? p2Name : p1Name;

    let verdict = 'Gap reale neutro: non aumentare fiducia oltre la probabilità di mercato.';
    let riskAdjustment = 0;
    if (selected.estimatedRealRank + 25 < opponent.estimatedRealRank) {
        verdict = `${selectedName} appare più forte del ranking ufficiale nel matchup: favorito supportato, ma senza spingere oltre 80% se manca conferma mercato/superficie.`;
        riskAdjustment = -8;
    } else if (selected.estimatedRealRank > opponent.estimatedRealRank + 25) {
        verdict = `${selectedName} ha ranking reale stimato peggiore dell'avversario: attenzione a overconfidence.`;
        riskAdjustment = 16;
    } else if (realGap < 25) {
        verdict = 'Ranking reale ravvicinato: match più equilibrato di quanto possa sembrare dal solo favorito.';
        riskAdjustment = 8;
    }

    const confidence = round((p1.confidence + p2.confidence) / 2, 0);
    return {
        version: 'REAL_RANKING_V1',
        players: [{ name: p1Name, ...p1 }, { name: p2Name, ...p2 }],
        officialGap,
        realGap,
        confidence,
        verdict,
        riskAdjustment,
        summary: `Gap ufficiale ${officialGap || 'n/d'} · gap reale stimato ${realGap || 'n/d'} · confidenza ${confidence}%.`
    };
}

function renderRealRankingTableHtml(assessment) {
    if (!assessment || !Array.isArray(assessment.players)) return '';
    const rows = assessment.players.map(player => `
        <tr>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#f8fafc; font-weight:700;">${escapeHtml(player.name)}</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(player.officialRank)}</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(player.bestRecentRank)}</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#38bdf8; font-weight:800;">${escapeHtml(player.estimatedRealRank)}</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(player.surfaceFit?.label || '-')} <span style="color:#94a3b8;">(${escapeHtml(player.surfaceFit?.score || 0)}/100)</span></td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">DR ${escapeHtml(player.dominanceRatio)} · Δ ${escapeHtml(player.drDelta)}</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(player.confidence)}%</td>
            <td style="padding:8px; border-bottom:1px solid #334155; color:#94a3b8;">${escapeHtml(player.note)}</td>
        </tr>
    `).join('');

    return `
        <div style="margin: 15px 20px; padding: 12px; border-radius: 8px; background:#07111f; border:1px solid #2563eb;">
            <div style="color:#60a5fa; font-weight:800; font-size:0.9rem; margin-bottom:6px; text-transform:uppercase;">🏷️ Ranking attuale vs ranking reale</div>
            <div style="color:#cbd5e1; font-size:0.82rem; line-height:1.5; margin-bottom:10px;">
                ${escapeHtml(assessment.verdict)}<br>
                <span style="color:#94a3b8;">${escapeHtml(assessment.summary)}</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:760px; font-size:0.78rem;">
                    <thead>
                        <tr style="background:#0f172a; color:#10b981; text-transform:uppercase; letter-spacing:0.04em;">
                            <th style="padding:8px; text-align:left;">Giocatore</th>
                            <th style="padding:8px; text-align:left;">Rank ATP/WTA</th>
                            <th style="padding:8px; text-align:left;">Best/recent</th>
                            <th style="padding:8px; text-align:left;">Rank reale stim.</th>
                            <th style="padding:8px; text-align:left;">Fit superficie</th>
                            <th style="padding:8px; text-align:left;">Servizio/Risposta</th>
                            <th style="padding:8px; text-align:left;">Conf.</th>
                            <th style="padding:8px; text-align:left;">Nota</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function canonicalDisplay(value, formatter = null) {
    if (value === null || value === undefined || value === '') return 'N/D';
    return formatter ? formatter(value) : String(value);
}

function renderCanonicalPlayerEvidenceHtml(bridge, p1Name, p2Name) {
    if (!bridge || bridge.status === 'UNAVAILABLE') {
        return `<div style="margin:15px 20px;padding:10px;border-radius:8px;background:#111827;border:1px solid #475569;color:#94a3b8;font-size:.8rem;">🧩 Evidenza giocatori canonica: non disponibile. Nessun Rank 500 o DR 1,00 sostitutivo applicato.</div>`;
    }
    const row = (player, name) => {
        const rank = canonicalDisplay(player?.currentRank);
        const elo = canonicalDisplay(player?.overallElo);
        const dr = canonicalDisplay(player?.dominanceRatio, v => Number(v).toFixed(3));
        const sample = canonicalDisplay(player?.sample);
        const identity = canonicalDisplay(player?.identityResolution);
        const source = (player?.sources || []).map(item => item.id).join(' + ') || 'N/D';
        return `<tr>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#f8fafc;font-weight:700;">${escapeHtml(name)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#38bdf8;">${escapeHtml(rank)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#cbd5e1;">${escapeHtml(elo)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#cbd5e1;">${escapeHtml(dr)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#cbd5e1;">${escapeHtml(sample)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#cbd5e1;">${escapeHtml(identity)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#94a3b8;">${escapeHtml(source)}</td>
        </tr>`;
    };
    return `<div style="margin:15px 20px;padding:12px;border-radius:8px;background:#07151a;border:1px solid #0f766e;">
        <div style="color:#2dd4bf;font-weight:800;font-size:.9rem;margin-bottom:6px;text-transform:uppercase;">🧩 Canonical Player Evidence · Patch 26</div>
        <div style="color:#cbd5e1;font-size:.78rem;line-height:1.45;margin-bottom:8px;">Stato ${escapeHtml(bridge.status)} · score ${escapeHtml(bridge.score)}/100 · contesto DeepScan soltanto. Probabilità, Quality Gate e stake non vengono modificati.</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:720px;font-size:.75rem;"><thead><tr style="background:#0f172a;color:#5eead4;text-transform:uppercase;"><th style="padding:7px;text-align:left">Giocatore</th><th style="padding:7px;text-align:left">Rank</th><th style="padding:7px;text-align:left">Elo</th><th style="padding:7px;text-align:left">DR</th><th style="padding:7px;text-align:left">Sample</th><th style="padding:7px;text-align:left">Identità</th><th style="padding:7px;text-align:left">Fonti</th></tr></thead><tbody>${row(bridge.p1,p1Name)}${row(bridge.p2,p2Name)}</tbody></table></div>
    </div>`;
}

function buildTennisSixPillarAssessment(input = {}) {
    const totalsContext = buildTotalsDeepScanContext(input);
    const marketReferenceAvailable = !!input.marketReferenceAvailable || (totalsContext.isTotals && totalsContext.hasRealTotalsOddsPair);
    const playedOddEdgePp = Math.abs(toNumber(input.edgePp, 0));
    const playedOddEvPct = Math.abs(toNumber(input.evPct, 0));
    const probabilityPct = totalsContext.isTotals && Number.isFinite(totalsContext.sideModelProb)
        ? totalsContext.sideModelProb
        : normalizeProbabilityPct(input.probabilityPct ?? input.adjustedProbabilityPct ?? input.modelProbabilityPct, 50);
    const marketDisagreementPp = totalsContext.isTotals && Number.isFinite(totalsContext.sideNoVigProb)
        ? Math.abs(probabilityPct - totalsContext.sideNoVigProb)
        : (marketReferenceAvailable ? Math.abs(toNumber(input.marketDisagreementPp, 0)) : 0);
    const marketImpliedProbabilityPct = safeClamp(toNumber(input.marketImpliedProbabilityPct, 0), 0, 100);
    const modelConviction = safeClamp(toNumber(input.modelConviction, 50), 0, 100);
    const structuralRiskPct = safeClamp(toNumber(input.structuralRisk, 0) * 100, 0, 100);
    const sackmannSample = Math.max(0, toNumber(input.sackmannSample, 0));
    const rankDelta = Math.abs(toNumber(input.rankDelta, 0));
    const drDelta = Math.abs(toNumber(input.drDelta, 0));
    const surfaceDetection = input.surfaceDetection || {};
    const surfaceConfidence = safeClamp(toNumber(surfaceDetection.confidence, 0), 0, 1);
    const tournamentText = String(input.tournament || input.league || '').toLowerCase();
    const isGrandSlam = tournamentText.includes('grand slam') || tournamentText.includes('slam') || tournamentText.includes('roland') || tournamentText.includes('french open');
    const isMinorPreSlam = /atp\s*250|wta\s*250|challenger|itf/.test(tournamentText) && !isGrandSlam;

    let marketTrapRisk = 10;
    const marketEvidence = [];

    if (marketReferenceAvailable) {
        marketEvidence.push(`Mercato two-way disponibile; disaccordo ${round(marketDisagreementPp, 1)}pp.`);
        if (marketDisagreementPp >= 22) marketTrapRisk = 95;
        else if (marketDisagreementPp >= 16) marketTrapRisk = 75;
        else if (marketDisagreementPp >= 12) marketTrapRisk = 58;
        else if (marketDisagreementPp >= 8) marketTrapRisk = 38;
        else marketTrapRisk = 12;
    } else {
        marketEvidence.push('Quote P1/P2 assenti: edge stimato sulla quota giocata, non validato da mercato two-way.');
        if (playedOddEdgePp >= 18 || playedOddEvPct >= 35) marketTrapRisk = 78;
        else if (playedOddEdgePp >= 14 || playedOddEvPct >= 25) marketTrapRisk = 64;
        else if (playedOddEdgePp >= 10 || playedOddEvPct >= 18) marketTrapRisk = 46;
        else if (playedOddEdgePp >= 6 || playedOddEvPct >= 8) marketTrapRisk = 26;
        else marketTrapRisk = 16;
    }

    if (marketImpliedProbabilityPct > 0) {
        marketEvidence.push(`Prob. modello ${round(probabilityPct, 1)}% vs implicita quota ${round(marketImpliedProbabilityPct, 1)}%.`);
    }
    marketEvidence.push(`Edge ${round(playedOddEdgePp, 1)}pp · EV ${round(playedOddEvPct, 1)}%.`);
    if (totalsContext.isTotals) {
        marketEvidence.push(`Step50E totals: ${totalsContext.side || 'TOTALS'} ${totalsContext.line || 'n/d'} · O ${totalsContext.overOdd || 'n/d'} / U ${totalsContext.underOdd || 'n/d'} · Markov conf. ${round(totalsContext.markovConfidence * 100, 0)}%.`);
        if (totalsContext.hasRealTotalsOddsPair && totalsContext.hasNoVigPair) {
            marketTrapRisk = safeClamp(12 + (marketDisagreementPp * 2.1), 8, 82);
        }
        if (!totalsContext.hasRealTotalsOddsPair) marketTrapRisk += 18;
        if (totalsContext.markovConfidence < TENNIS_TOTALS_DEEPSCAN_STEP50E.highRiskMarkovConfidence) marketTrapRisk += 18;
    }

    let styleSurfaceRisk = structuralRiskPct * 0.65;
    const surfaceEvidence = [];
    if (surfaceDetection.isFallback) {
        styleSurfaceRisk += 30;
        surfaceEvidence.push(`Surface fallback tecnico (${surfaceDetection.modelSurface || input.modelSurface || 'unknown'}) a bassa confidenza.`);
    } else if (surfaceConfidence < 0.70) {
        styleSurfaceRisk += 18;
        surfaceEvidence.push(`Surface stimata con confidenza media/bassa: ${round(surfaceConfidence * 100, 0)}%.`);
    } else {
        surfaceEvidence.push(`Surface coerente: ${input.modelSurface || surfaceDetection.surface || 'n/d'} (${round(surfaceConfidence * 100, 0)}%).`);
    }
    if (drDelta < 0.04 && probabilityPct >= 75) {
        styleSurfaceRisk += 16;
        surfaceEvidence.push('Differenziale dominance ridotto rispetto a probabilità alta: matchup meno netto.');
    }
    if (String(input.tbRisk || totalsContext.tieBreakRisk || '').toLowerCase().includes('alto')) {
        styleSurfaceRisk += totalsContext.isTotals ? 4 : 10;
        surfaceEvidence.push(totalsContext.isTotals ? 'Rischio tie-break alto: impatta la distribuzione giochi, non è veto automatico sui totals.' : 'Rischio tie-break alto: volatilità del favorito maggiore.');
    }
    if (totalsContext.isTotals) {
        if (Number.isFinite(totalsContext.lineDistance) && totalsContext.lineDistance >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minLineDistanceForTotalsGreen) {
            styleSurfaceRisk -= 8;
            surfaceEvidence.push(`Distanza expected-games/linea favorevole: ${round(totalsContext.lineDistance, 2)} game.`);
        } else if (Number.isFinite(totalsContext.lineDistance) && totalsContext.lineDistance < 0.45) {
            styleSurfaceRisk += 14;
            surfaceEvidence.push('Expected games troppo vicino alla linea: alta varianza sui totals.');
        }
        if (Number.isFinite(totalsContext.gamesStdDev) && totalsContext.gamesStdDev > 7.25) {
            styleSurfaceRisk += 8;
            surfaceEvidence.push(`Varianza giochi elevata (${round(totalsContext.gamesStdDev, 2)}): preferire conferma live.`);
        }
    }

    let fitnessRisk = 8;
    const fitnessEvidence = [];
    if (input.hardMedicalVeto) {
        fitnessRisk = 100;
        fitnessEvidence.push('Medical/news hard veto attivo.');
    } else if (input.softMedicalWarning) {
        fitnessRisk = 55;
        fitnessEvidence.push('Warning fatica/fitness rilevato.');
    } else {
        fitnessEvidence.push('Nessun alert medical/fatigue forte rilevato dal feed disponibile.');
    }

    let motivationRisk = isGrandSlam ? 8 : (isMinorPreSlam ? 45 : 25);
    const motivationEvidence = [];
    if (isGrandSlam) {
        motivationEvidence.push('Contesto Grand Slam: motivazione media attesa alta, rischio tanking ridotto.');
    } else if (isMinorPreSlam) {
        motivationEvidence.push('Torneo minore/Challenger: motivazione e gestione calendario più variabili.');
    } else {
        motivationEvidence.push('Motivazione torneo non pienamente classificata.');
    }

    let overconfidenceRisk = 12;
    const overconfidenceEvidence = [];
    if (probabilityPct >= 86) overconfidenceRisk = 72;
    else if (probabilityPct >= 82) overconfidenceRisk = 52;
    else if (probabilityPct >= 78) overconfidenceRisk = 38;
    else if (probabilityPct >= 74) overconfidenceRisk = 26;
    if (playedOddEdgePp >= 14 || playedOddEvPct >= 25) overconfidenceRisk += 18;
    else if (playedOddEdgePp >= 10 || playedOddEvPct >= 18) overconfidenceRisk += 10;
    if (!marketReferenceAvailable) overconfidenceRisk += 8;
    if (sackmannSample < 10) overconfidenceRisk += 10;
    else if (sackmannSample < 20) overconfidenceRisk += 5;
    if (modelConviction < 40) overconfidenceRisk += 10;
    else if (modelConviction >= 65) overconfidenceRisk -= 8;
    overconfidenceEvidence.push(`Prob. ${round(probabilityPct, 1)}%, edge ${round(playedOddEdgePp, 1)}pp, conviction ${round(modelConviction, 1)}/100.`);
    if (!marketReferenceAvailable) overconfidenceEvidence.push('Manca verifica reference/two-way: non elevare a edge professionale pieno.');
    if (sackmannSample < 20) overconfidenceEvidence.push(`Sample tecnico limitato: ${sackmannSample}.`);
    if (totalsContext.isTotals) {
        if (totalsContext.hasRealTotalsOddsPair && totalsContext.markovConfidence >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minMarkovConfidenceForTotalsGreen) {
            overconfidenceRisk -= 10;
            overconfidenceEvidence.push('Totals con coppia quote reale e Markov confidence sufficiente: non degradare automaticamente ad alto rischio.');
        }
        if (totalsContext.probabilityCapped && playedOddEvPct >= TENNIS_TOTALS_DEEPSCAN_STEP50E.extremeEvPctWarning) {
            overconfidenceRisk += 14;
            overconfidenceEvidence.push('Probabilità totals al cap tecnico con EV estremo: rischio modello, non value pieno.');
        }
        if (totalsContext.duplicateLineRank > 2) {
            overconfidenceRisk += 10;
            overconfidenceEvidence.push(`Linea totals non primaria (rank ${totalsContext.duplicateLineRank}): evitare duplicati di più linee stesso match.`);
        }
        overconfidenceRisk = safeClamp(overconfidenceRisk, 0, 100);
    }

    let rankingRisk = 12;
    const rankingEvidence = [];
    const realRanking = input.realRankingAssessment || null;
    if (sackmannSample < 10) rankingRisk += 18;
    if (rankDelta > 0 && rankDelta < 40 && probabilityPct >= 75) rankingRisk += 22;
    else if (rankDelta > 0 && rankDelta < 80 && probabilityPct >= 78) rankingRisk += 15;
    else if (rankDelta >= 150 && probabilityPct >= 70) rankingRisk -= 5;
    if (drDelta < 0.05 && probabilityPct >= 78) rankingRisk += 14;
    if (realRanking) {
        rankingRisk += toNumber(realRanking.riskAdjustment, 0);
        rankingEvidence.push(`Ranking reale: ${realRanking.summary}`);
        rankingEvidence.push(realRanking.verdict);
        if (toNumber(realRanking.confidence, 0) < 45) {
            rankingRisk += 8;
            rankingEvidence.push('Confidenza ranking reale bassa: usare come contesto, non come conferma forte.');
        }
    } else {
        rankingEvidence.push(`Rank delta ${rankDelta || 'n/d'} · DR delta ${round(drDelta, 3)} · sample ${sackmannSample}.`);
    }
    if (sackmannSample < 10) rankingEvidence.push('Ranking reale/forza servizio-risposta poco coperti dal sample tecnico.');

    const pillars = [
        buildPillar('Market traps / sharp reference', marketTrapRisk, 0.30, marketReferenceAvailable ? 'Confronto con quote two-way disponibile.' : 'Baseline mercato incompleta: edge da validare.', marketEvidence),
        buildPillar('Style vs surface', styleSurfaceRisk, 0.15, 'Matchup tecnico e coerenza superficie.', surfaceEvidence),
        buildPillar('Fitness / fatigue / retirement', fitnessRisk, 0.20, 'Rischio fisico, MTO, ritiro o fatica.', fitnessEvidence),
        buildPillar('Motivazione torneo', motivationRisk, 0.10, 'Importanza torneo e rischio tanking.', motivationEvidence),
        buildPillar('Overconfidence modello', overconfidenceRisk, 0.17, 'Probabilità alta, edge elevato e assenza conferma mercato.', overconfidenceEvidence),
        buildPillar('Ranking reale / trajectory', rankingRisk, 0.08, 'Ranking, differenza recente e forza servizio-risposta.', rankingEvidence)
    ];

    return {
        pillars,
        score: round(weightedRisk(pillars), 1),
        criticalCount: pillars.filter(p => p.status === 'FAIL').length,
        highWarnCount: pillars.filter(p => p.status === 'WARN_HIGH').length,
        warnCount: pillars.filter(p => p.status === 'WARN' || p.status === 'WARN_HIGH').length
    };
}


function buildTennisWaitInstruction({ cleanPred, riskAssessment, avgGames, tbRisk, isWTA, surfaceDetection, totalsContext }) {
    const pred = String(cleanPred || '').toUpperCase();
    const level = String(riskAssessment?.level || '').toUpperCase();
    const avg = toNumber(avgGames, 21);
    const tb = String(tbRisk || '').toLowerCase();
    const tour = isWTA ? 'WTA' : 'ATP';

    if (pred.includes('OVER') || pred.includes('UNDER')) {
        const tc = totalsContext || riskAssessment?.totalsContext || {};
        const side = tc.side || (pred.includes('UNDER') ? 'UNDER' : 'OVER');
        const line = tc.line || (pred.match(/(\d+(?:\.5)?)/)?.[1] || 'n/d');
        if (riskAssessment?.level === 'VALUE_CONFERMATO' || String(riskAssessment?.action || '').includes('VALUE TOTALS')) {
            return `Pre-match solo micro/paper: ${side} ${line} confermato qualitativamente, ma verifica il primo turno di servizio se disponibile.`;
        }
        if (riskAssessment?.level === 'RISCHIO_MODELLO') {
            return `Attendi 1 set o almeno 3 game: ${side} ${line} ha edge numerico ma richiede conferma ritmo, hold/break e direzione mercato live.`;
        }
        return `Attendi i primi 3 game: conferma ritmo al servizio, break point concessi e lunghezza media degli scambi prima di validare il totale ${side} ${line}.`;
    }

    if (level === 'ALTO_RISCHIO' || level === 'RISCHIO_MODELLO') {
        return 'Attendi almeno i primi 3 game o il primo turno di servizio completo per entrambi: conferma mobilità, tenuta al servizio e direzione mercato live.';
    }

    if (avg >= 22.5 || tb.includes('alto')) {
        return 'Attendi i primi 3 game: verifica hold iniziali, pressione in risposta e rischio tie-break prima di confermare il moneyline.';
    }

    if (surfaceDetection?.isFallback) {
        return 'Attendi i primi 3 game: la superficie è in fallback tecnico, serve conferma live su scambi e adattamento al campo.';
    }

    return `Attendi i primi 3 game: se il favorito conferma ritmo, servizio e risposta, il pronostico ${tour} può restare valido in live.`;
}

function buildTennisAlternative({ cleanPred, p1Name, p2Name, avgGames, tbRisk, adjustedProb, realEdge, realEvPct, riskAssessment, totalsContext }) {
    const pred = String(cleanPred || '').toUpperCase();
    const avg = toNumber(avgGames, 21);
    const tb = String(tbRisk || totalsContext?.tieBreakRisk || '').toLowerCase();
    const level = String(riskAssessment?.level || '').toUpperCase();
    const isMoneyline = pred === '1' || pred === '2';
    const isTotals = pred.includes('OVER') || pred.includes('UNDER') || totalsContext?.isTotals;
    const pickedName = pred === '2' ? p2Name : p1Name;
    const favoriteName = pickedName || p1Name;

    // Step50E: DeepScan deve sempre proporre un'alternativa leggibile, anche su mercati non operativi
    // come tie-break, handicap -3.5, set betting o ingresso live.
    if (isTotals) {
        const side = totalsContext?.side || (pred.includes('UNDER') ? 'UNDER' : 'OVER');
        const line = totalsContext?.line || (pred.match(/(\d+(?:\.5)?)/)?.[1] || 'linea');
        const opposite = side === 'UNDER' ? 'OVER' : 'UNDER';
        const strongDistance = Number.isFinite(totalsContext?.lineDistance) && totalsContext.lineDistance >= TENNIS_TOTALS_DEEPSCAN_STEP50E.minLineDistanceForTotalsGreen;
        const highTb = tb.includes('alto');

        if (level === 'VALUE_CONFERMATO' || String(riskAssessment?.action || '').includes('VALUE TOTALS')) {
            return {
                market: 'Conferma Totals + alternativa live',
                selection: `${side} ${line} micro/paper; alternativa ${opposite} live solo se i primi 3 game smentiscono ritmo/hold atteso`,
                confidence: strongDistance ? 'MEDIA/ALTA' : 'MEDIA',
                rationale: `La linea ${line} è supportata da coppia quote reale, Markov e distanza expected-games${Number.isFinite(totalsContext?.lineDistance) ? ` (${round(totalsContext.lineDistance, 2)} game)` : ''}. Alternativa: attendere 3 game o primo turno servizio completo per conferma.`
            };
        }

        if (level === 'ALTO_RISCHIO') {
            return {
                market: 'Bocciatura totals pre-match / alternativa live',
                selection: `Boccia ${side} ${line} pre-match; rivaluta live dopo 1 set oppure valuta Tie-break ${highTb ? 'SÌ' : 'NO'} / handicap -3.5 solo se il favorito domina al servizio`,
                confidence: 'BASSA/MEDIA',
                rationale: 'Il totale è fragile o non abbastanza validato: DeepScan preferisce contesto live su hold, break point e lunghezza scambi.'
            };
        }

        return {
            market: 'Attesa Totals Live',
            selection: `${side} ${line} solo dopo 3 game; alternativa ${opposite} o handicap -3.5 se il pattern iniziale va contro il totale pre-match`,
            confidence: 'MEDIA/BASSA',
            rationale: 'Edge numerico interessante ma non sufficiente per via libera pieno: serve conferma di ritmo, tenuta al servizio e direzione mercato live.'
        };
    }

    if ((avg >= 22.5 || tb.includes('alto')) && ['RISCHIO_MODELLO', 'ALTO_RISCHIO', 'WATCHLIST_LOW_EDGE'].includes(level)) {
        return {
            market: 'Alternativa Totals Live',
            selection: 'OVER giochi live dopo conferma hold iniziali; possibile Tie-break SÌ se entrambi tengono il servizio',
            confidence: 'MEDIA',
            rationale: `Il moneyline non è pienamente confermato, ma il profilo games/set (${round(avg, 1)}) e il rischio tie-break suggeriscono più valore sul totale se i primi game tengono il servizio.`
        };
    }

    if (isMoneyline && avg <= 20.5 && adjustedProb >= 74 && realEdge >= 4.5 && ['RISCHIO_MODELLO', 'WATCHLIST_LOW_EDGE'].includes(level)) {
        return {
            market: 'Alternativa Live / Set betting',
            selection: `${favoriteName} live dopo break o conferma primo set; alternativa handicap -3.5 solo se dominio netto`,
            confidence: 'MEDIA/BASSA',
            rationale: 'Il favorito è coerente ma il prezzo pre-match non è abbastanza pulito: meglio conferma live o set market invece di moneyline immediata.'
        };
    }

    if (realEvPct >= 18 && !riskAssessment?.marketReferenceAvailable) {
        return {
            market: 'Alternativa Live protetta',
            selection: `${favoriteName} live solo se il mercato conferma il lato nei primi 3 game; alternativa set betting 1° set`,
            confidence: 'BASSA/MEDIA',
            rationale: 'EV elevato senza quote reference P1/P2: possibile value trap; l’alternativa è attendere conferma del mercato live prima di entrare.'
        };
    }

    return {
        market: 'Alternativa prudente DeepScan',
        selection: isMoneyline
            ? `${favoriteName} live dopo 3 game o primo turno di servizio completo; alternativa handicap -3.5 solo con break/pressione confermata`
            : 'Attesa live dopo 3 game; alternativa mercato set/handicap se il pattern iniziale è più chiaro del pre-match',
        confidence: 'MEDIA/BASSA',
        rationale: 'Nessuna alternativa superiore netta pre-match: DeepScan mantiene una via live prudente invece di lasciare il pronostico senza piano B.'
    };
}

function buildTennisDeepScanAdvisory(input = {}) {
    const riskAssessment = input.riskAssessment || {};
    const level = String(riskAssessment.level || '').toUpperCase();
    const cleanPred = String(input.cleanPred || '').toUpperCase();
    const originalSelection = cleanPred || input.legacySuggestion?.selection || 'Pronostico originale';
    const totalsContext = input.totalsContext || input.riskAssessment?.totalsContext || buildTotalsDeepScanContext(input);
    const waitInstruction = buildTennisWaitInstruction({ ...input, totalsContext });
    const alternative = buildTennisAlternative({ ...input, totalsContext });
    const alternatives = alternative ? [alternative] : [];
    const hasHardRisk = level === 'ALTO_RISCHIO' || level === 'RISCHIO_MODELLO';
    const edge = toNumber(input.realEdge, 0);
    const ev = toNumber(input.realEvPct, 0);
    const conviction = toNumber(input.modelConviction, 0);
    const srPct = toNumber(input.structuralRisk, 0) * 100;

    if (!hasHardRisk && edge >= 4.5 && ev >= 5 && conviction >= 45 && srPct <= 35) {
        return {
            mode: 'CONFIRM_PRONOSTICO',
            market: 'Conferma pronostico Tennis',
            selection: originalSelection,
            timing: 'Pre-match ammesso come segnale qualitativo, con controllo live dei primi 3 game se possibile',
            confidence: level === 'OK' ? 'MEDIA/ALTA' : 'MEDIA',
            rationale: `Il DeepScan conferma il pronostico: edge ${round(edge, 1)}pp, EV ${round(ev, 1)}%, rischio strutturale ${round(srPct, 1)}% e nessun pilastro critico dominante.`,
            alternatives
        };
    }

    if (totalsContext.isTotals && level === 'VALUE_CONFERMATO') {
        return {
            mode: 'CONFIRM_PRONOSTICO',
            market: 'Conferma Totals Tennis',
            selection: `${totalsContext.side || originalSelection} ${totalsContext.line || ''}`.trim(),
            timing: 'Pre-match solo micro/paper; se possibile confermare dopo 1 game o primo turno di servizio completo.',
            confidence: 'MEDIA',
            rationale: `DeepScan conferma qualitativamente il totals: edge ${round(edge, 1)}pp, EV ${round(ev, 1)}%, Markov confidence ${round((totalsContext.markovConfidence || 0) * 100, 0)}%.`,
            alternatives
        };
    }

    if (totalsContext.isTotals && level === 'ALTO_RISCHIO') {
        return {
            mode: 'REJECT_PRONOSTICO',
            market: 'Bocciatura Totals pre-match',
            selection: originalSelection,
            timing: 'Non entrare pre-match; rivalutare dopo 1 set o forte evidenza live.',
            confidence: 'BASSA/MEDIA',
            rationale: `DeepScan boccia il totals pre-match: rischio ${riskAssessment.riskScore || riskAssessment.score}/100, edge ${round(edge, 1)}pp, EV ${round(ev, 1)}%.`,
            alternatives
        };
    }

    if (alternative && hasHardRisk) {
        return {
            mode: 'ALTERNATIVE_PRONOSTICO',
            market: alternative.market,
            selection: alternative.selection,
            timing: 'Solo dopo conferma live del pattern indicato',
            confidence: alternative.confidence || 'MEDIA',
            rationale: `${alternative.rationale} Il pronostico originale viene smentito o degradato dalla perizia qualitativa.`,
            alternatives
        };
    }

    if (alternative && level === 'WATCHLIST_LOW_EDGE' && edge < 7) {
        return {
            mode: 'ALTERNATIVE_PRONOSTICO',
            market: alternative.market,
            selection: alternative.selection,
            timing: 'Solo se i primi 3 game confermano il pattern statistico',
            confidence: alternative.confidence || 'MEDIA/BASSA',
            rationale: `${alternative.rationale} Il pronostico iniziale resta osservabile, ma l’alternativa può essere più efficiente.`,
            alternatives
        };
    }

    return {
        mode: 'WAIT_IN_PLAY',
        market: 'Attesa In-Play Tennis',
        selection: waitInstruction,
        timing: waitInstruction,
        confidence: hasHardRisk ? 'BASSA/MEDIA' : 'MEDIA/BASSA',
        rationale: `Il DeepScan non conferma pienamente il pronostico ${originalSelection}: livello ${riskAssessment.action || level}, edge ${round(edge, 1)}pp, EV ${round(ev, 1)}%.`,
        alternatives
    };
}

function buildTennisDeepScanRiskAssessment(input = {}) {
    const sixPillar = buildTennisSixPillarAssessment(input);
    const reasons = [];
    const marketReferenceAvailable = !!input.marketReferenceAvailable;
    const playedOddEdgePp = Math.abs(toNumber(input.edgePp, 0));
    const marketDisagreementPp = marketReferenceAvailable
        ? Math.abs(toNumber(input.marketDisagreementPp, 0))
        : 0;

    for (const pillar of sixPillar.pillars) {
        if (pillar.status !== 'PASS') {
            reasons.push(`${pillar.name}: ${pillar.status} (${pillar.risk}/100) - ${pillar.summary}`);
        }
    }

    if (!marketReferenceAvailable) {
        reasons.push('Quote riferimento P1/P2 assenti: DeepScan non valida edge come sharp money, ma non blocca automaticamente.');
    }

    if (input.verdictIsHighRisk) {
        reasons.push('Risk committee legacy richiede cautela: usato come fattore del mashup, non come veto automatico.');
    }

    const weightedAssessment = buildTennisDeepScanWeightedAssessment(input, sixPillar);
    let score = weightedAssessment.riskScore;
    let level = weightedAssessment.level;
    let action = weightedAssessment.action;
    let isHighRisk = level === 'ALTO_RISCHIO';

    const marketPillar = sixPillar.pillars.find(p => p.name.startsWith('Market'));
    const overconfidencePillar = sixPillar.pillars.find(p => p.name.startsWith('Overconfidence'));
    const fitnessPillar = sixPillar.pillars.find(p => p.name.startsWith('Fitness'));

    // Compatibilità con i vecchi guardrail: i pesi v15 possono migliorare la lettura,
    // ma non devono abbassare un hard veto tecnico/medical già evidente.
    if (input.hardMedicalVeto || fitnessPillar?.risk >= 95 || (!weightedAssessment.totalsContext && score >= 72) || (marketPillar?.risk >= 90 && overconfidencePillar?.risk >= 70)) {
        level = 'ALTO_RISCHIO';
        action = '🔴 ALTO RISCHIO';
        isHighRisk = true;
    } else if (level !== 'VALUE_CONFERMATO' && level !== 'RISCHIO_MODELLO' && level !== 'ALTO_RISCHIO' && (sixPillar.highWarnCount >= 2 || marketPillar?.risk >= 82 || overconfidencePillar?.risk >= 82)) {
        level = 'RISCHIO_MODELLO';
        action = '🟠 RISCHIO MODELLO';
    } else if (level !== 'VALUE_CONFERMATO' && level !== 'WATCHLIST_LOW_EDGE' && level !== 'RISCHIO_MODELLO' && level !== 'ALTO_RISCHIO' && (!marketReferenceAvailable && playedOddEdgePp >= 10)) {
        level = 'WATCHLIST_LOW_EDGE';
        action = '🟡 WATCHLIST / LOW EDGE';
    }

    let stakePolicy = {
        multiplier: 1,
        action: 'UNCHANGED',
        reason: 'Nessuna riduzione stake richiesta dal DeepScan.'
    };

    if (level === 'ALTO_RISCHIO') {
        stakePolicy = { multiplier: 0.25, action: 'OPERATIONAL_GATE_HIGH_RISK', reason: 'Alto rischio DeepScan: suggerisce micro-stake teorico, con impatto operativo esplicito su gate/stake.' };
    } else if (level === 'RISCHIO_MODELLO') {
        stakePolicy = { multiplier: 0.50, action: 'OPERATIONAL_GATE_MODEL_RISK', reason: 'Rischio modello DeepScan: suggerisce riduzione teorica al 50%.' };
    } else if (level === 'WATCHLIST_LOW_EDGE') {
        stakePolicy = { multiplier: 0.75, action: 'OPERATIONAL_GATE_LOW_EDGE', reason: 'Watchlist/low edge DeepScan: suggerisce riduzione teorica al 75%.' };
    }

    return {
        level,
        action,
        isHighRisk,
        score: round(score, 1),
        stakePolicy,
        reasons: reasons.length ? reasons : ['Sei pilastri qualitativi senza criticità rilevanti.'],
        marketReferenceAvailable,
        totalsContext: weightedAssessment.totalsContext || null,
        marketReferenceSource: input.marketReferenceSource || 'unknown',
        surfaceSource: input.surfaceDetection?.source || 'unknown',
        playedOddEdgePp: round(playedOddEdgePp, 1),
        marketDisagreementPp: round(marketDisagreementPp, 1),
        valueScore: weightedAssessment.valueScore,
        riskScore: weightedAssessment.riskScore,
        confidenceScore: weightedAssessment.confidenceScore,
        weightedAssessment,
        sixPillar,
        taxonomyVersion: DEEP_SCAN_TENNIS_VERSION
    };
}

function buildTennisDeepScanOperationalGate(riskAssessment = {}, input = {}) {
    const level = String(riskAssessment.level || '').toUpperCase();
    const basePolicy = riskAssessment.stakePolicy || {};
    let allowBet = true;
    let status = 'TENNIS_DEEPSCAN_APPROVED';
    let action = 'APPROVE';
    let multiplier = Number.isFinite(Number(basePolicy.multiplier)) ? Number(basePolicy.multiplier) : 1;

    if (level === 'ALTO_RISCHIO') {
        allowBet = false;
        status = 'TENNIS_DEEPSCAN_BLOCKED_HIGH_RISK';
        action = 'BLOCK';
        multiplier = 0;
    } else if (level === 'RISCHIO_MODELLO') {
        status = 'TENNIS_DEEPSCAN_WATCHLIST_MODEL_RISK';
        action = 'WATCHLIST_REDUCE';
        multiplier = Math.min(multiplier, 0.5);
    } else if (level === 'WATCHLIST_LOW_EDGE') {
        status = 'TENNIS_DEEPSCAN_WATCHLIST_LOW_EDGE';
        action = 'WATCHLIST_CAP';
        multiplier = Math.min(multiplier, 0.75);
    } else if (level === 'VALUE_CONFERMATO') {
        status = 'TENNIS_DEEPSCAN_CONFIRMED_VALUE';
        action = 'APPROVE';
        multiplier = Math.min(Math.max(multiplier, 0.75), 1);
    }

    const reasons = Array.isArray(riskAssessment.reasons) ? riskAssessment.reasons : [];

    return {
        mode: 'OPERATIONAL_GATE',
        allowBet,
        status,
        action,
        stakeMultiplier: Number(multiplier.toFixed(2)),
        reason: reasons[0] || riskAssessment.action || 'DeepScan Tennis gate operativo applicato.',
        reasons,
        level: riskAssessment.level || 'UNKNOWN',
        riskScore: riskAssessment.riskScore ?? riskAssessment.score ?? 0,
        valueScore: riskAssessment.valueScore ?? 0,
        confidenceScore: riskAssessment.confidenceScore ?? 0,
        auditImpact: allowBet ? 'PORTFOLIO_ELIGIBLE_IF_STAKE_POSITIVE' : 'AUDIT_ONLY_BLOCKED_BY_DEEPSCAN',
        version: DEEP_SCAN_TENNIS_VERSION,
        originalSelection: input.prediction || input.selection || null
    };
}
// ======================================================
// 🚀 FASE 5: MOTORE QUANTITATIVO & GIUDICE IA
// ======================================================

function normalizeSackmannMatchupData(raw = {}, error = null) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const hasData = Boolean(data.hasData);
    const p1Rank = Number(data.p1_rank);
    const p2Rank = Number(data.p2_rank);
    const p1Point = Number(data.p1_point);
    const p2Point = Number(data.p2_point);
    return {
        ...data,
        hasData,
        p1_rank: Number.isFinite(p1Rank) && p1Rank > 0 ? p1Rank : null,
        p2_rank: Number.isFinite(p2Rank) && p2Rank > 0 ? p2Rank : null,
        p1_point: Number.isFinite(p1Point) ? safeClamp(p1Point, 0.35, 0.85) : null,
        p2_point: Number.isFinite(p2Point) ? safeClamp(p2Point, 0.35, 0.85) : null,
        sample: Math.max(0, toNumber(data.sample, 0) || 0),
        canonicalBridge: data.canonicalBridge || null,
        canonicalDataAvailable: data.canonicalDataAvailable === true || (data.canonicalBridge && data.canonicalBridge.status !== 'UNAVAILABLE'),
        runtimeError: error ? String(error.message || error) : null
    };
}

function getSafeSackmannMatchup(p1Name, p2Name, modelSurface, asOfDate, options = {}) {
    try {
        if (!sackmann || typeof sackmann.getAdvancedMatchup !== 'function') {
            return normalizeSackmannMatchupData({ hasData: false }, 'Sackmann getAdvancedMatchup non disponibile');
        }
        return normalizeSackmannMatchupData(
            sackmann.getAdvancedMatchup(p1Name, p2Name, modelSurface, asOfDate, options) || { hasData: false }
        );
    } catch (error) {
        return normalizeSackmannMatchupData({ hasData: false }, error);
    }
}

function getSafeAdvancedMetrics(p1Name, p2Name, modelSurface, asOfDate) {
    try {
        if (!quantEngine || typeof quantEngine.calculateAdvancedMetrics !== 'function') {
            return { hasAdvancedData: false, runtimeError: 'calculateAdvancedMetrics non disponibile' };
        }
        return quantEngine.calculateAdvancedMetrics(p1Name, p2Name, modelSurface, asOfDate) || { hasAdvancedData: false };
    } catch (error) {
        return { hasAdvancedData: false, runtimeError: String(error.message || error) };
    }
}

async function scanMatchup(p1Name, p2Name, prediction, odd, prob, edge, odd1, odd2, matchContext = {}) {
    const normalizedInput = normalizeScanArguments(p1Name, p2Name, prediction, odd, prob, edge, odd1, odd2, matchContext);

    p1Name = normalizedInput.p1Name;
    p2Name = normalizedInput.p2Name;
    prediction = normalizedInput.prediction;
    odd = normalizedInput.odd;
    prob = normalizedInput.prob;
    odd1 = normalizedInput.odd1;
    odd2 = normalizedInput.odd2;
    matchContext = normalizedInput.matchContext;
    // STEP91_PREMATCH_LEAKAGE_GUARD: DeepScan non può ricevere CLV/closing/result/profit correnti.
    assertPreMatchOnlyContext(matchContext);

    const inputEdgePp = normalizedInput.edge_pp;
    const inputEvPct = normalizedInput.ev_pct;

    try {
        // PATCH37_EXTERNAL_MATCH_INTELLIGENCE: la superficie viene risolta prima delle fonti
        // per consentire H2H locale surface-aware e meteo venue-aware.
        const surfaceDetection = detectMatchSurface(matchContext);
        const surface = surfaceDetection.surface;
        const modelSurface = surfaceDetection.modelSurface || surface;
        const externalIntelligence = await tennisExternalMatchIntelligencePatch37.buildExternalMatchIntelligence({
            p1Name, p2Name, prediction,
            tour: matchContext.tour || matchContext.tourType || matchContext.league,
            surface: modelSurface,
            context: { ...matchContext, surface: modelSurface }
        }, { dataDir: path.join(__dirname, 'sackmann_data'), skipNetwork: matchContext.externalIntelligenceSkipNetwork === true });
        const [p1Data, p2Data] = await Promise.all([ getSentimentAnalysis(p1Name), getSentimentAnalysis(p2Name) ]);
        const h2hLocal = externalIntelligence.h2h || {};
        const tmlData = {
            success: h2hLocal.success === true,
            p1Wins: h2hLocal.overall?.p1Wins || 0,
            p2Wins: h2hLocal.overall?.p2Wins || 0,
            matchesFound: h2hLocal.overall?.matches || 0,
            p1Clay: h2hLocal.surface === 'Clay' && h2hLocal.onSurface?.matches ? Math.round((h2hLocal.onSurface.p1Wins / h2hLocal.onSurface.matches) * 100) : 0,
            p2Clay: h2hLocal.surface === 'Clay' && h2hLocal.onSurface?.matches ? Math.round((h2hLocal.onSurface.p2Wins / h2hLocal.onSurface.matches) * 100) : 0,
            retrieval: { version: tennisExternalMatchIntelligencePatch37.H2H_VERSION, source: 'LOCAL_STRUCTURED_CSV', status: h2hLocal.status, contextOnly: false, maxProbabilityAdjustmentPp: 2.5, settlementAuthority: false, stakeAuthority: false }
        };

        let penaltyReason = []; 

        if (surfaceDetection.isFallback) {
            penaltyReason.push(`Surface non rilevata dai dati: modello usa fallback tecnico ${modelSurface} con confidenza bassa, senza dichiararlo come superficie reale.`);
        } else if (surfaceDetection.source === 'calendar_grand_slam_clay_inference') {
            penaltyReason.push(`Surface inferita da calendario Grand Slam maggio/giugno: Clay con confidenza media.`);
        }

        const analysisDate = new Date().toISOString().split('T')[0];
        const tourText = [matchContext.tour, matchContext.tourType, matchContext.league, matchContext.tournament, matchContext.tournamentName].filter(Boolean).join(' ').toUpperCase();
        const tourHint = tourText.includes('WTA') ? 'WTA' : (tourText.includes('ATP') ? 'ATP' : null);
        const sackmannData = getSafeSackmannMatchup(p1Name, p2Name, modelSurface, analysisDate, {
            tour: tourHint,
            tourType: tourHint,
            league: matchContext.league,
            tournamentName: matchContext.tournamentName || matchContext.tournament,
            tournamentLevel: matchContext.tournamentLevel || matchContext.category,
            historicalDatasetPath: matchContext.historicalDatasetPath
        });
        if (sackmannData.runtimeError) {
            penaltyReason.push(`Sackmann advanced matchup non disponibile: ${sackmannData.runtimeError}. DeepScan prosegue con fallback neutro.`);
        }
        const sackData = sackmannData; // alias difensivo per compatibilità con vecchie patch/test
        const canonicalBridge = sackmannData.canonicalBridge || null;

        const r1 = Number.isFinite(Number(sackmannData.p1_rank)) ? Number(sackmannData.p1_rank) : null;
        const r2 = Number.isFinite(Number(sackmannData.p2_rank)) ? Number(sackmannData.p2_rank) : null;
        const rankDelta = r1 !== null && r2 !== null ? Math.abs(r1 - r2) : null;
        const isWTA = tourHint === 'WTA';
        externalIntelligence.rankingComparison = tennisExternalMatchIntelligencePatch37.rankingConflict({
            p1: { name: p1Name, rank: r1 },
            p2: { name: p2Name, rank: r2 }
        }, externalIntelligence.officialRankings || {});
        externalIntelligence.challenger = tennisExternalMatchIntelligencePatch37.buildChallenger({
            h2h: externalIntelligence.h2h,
            h2hDecision: externalIntelligence.h2hDecision,
            officialRankings: externalIntelligence.officialRankings,
            weather: externalIntelligence.weather,
            rankingComparison: externalIntelligence.rankingComparison,
            sourceReceiptComplete: externalIntelligence.sourceCoverage?.complete === true
        });

        let adjustedProb = normalizeProbabilityPct(prob, 50.0);
        const cleanPred = String(prediction).toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
        const lineMatch = cleanPred.match(/(\d+\.5)/);
        const totalsLine = lineMatch ? parseFloat(lineMatch[1]) : 21.5;

        // PATCH37_H2H_TRUTH: sostituisce snippet DuckDuckGo e regole estreme -5/+6.5.
        // L'unico impatto consentito è Bayes-shrink, minimo n=2 e cap assoluto ±2.5pp.
        if (cleanPred === '1' || cleanPred === '2') {
            const h2hDecision = externalIntelligence.h2hDecision || { adjustmentPp: 0, status: 'UNAVAILABLE', sample: 0 };
            if (Number.isFinite(Number(h2hDecision.adjustmentPp)) && Number(h2hDecision.adjustmentPp) !== 0) {
                adjustedProb += Number(h2hDecision.adjustmentPp);
                penaltyReason.push(`H2H locale strutturato: ${h2hDecision.wins}-${h2hDecision.losses} su n=${h2hDecision.sample}; aggiustamento Bayes-shrink ${Number(h2hDecision.adjustmentPp) >= 0 ? '+' : ''}${h2hDecision.adjustmentPp}pp (cap campione ±${Number(h2hDecision.maxAbsPp || 0).toFixed(2)}pp · ${h2hDecision.samplePolicyStatus || 'POLICY_PATCH40'}).`);
            } else if (h2hDecision.sample > 0) {
                penaltyReason.push(`H2H locale disponibile su n=${h2hDecision.sample}, ma campione insufficiente o segnale neutro: nessun aggiustamento.`);
            }
        }

        const p1ServePctRaw = sackmannData.hasData ? (sackmannData.p1_point * 100) : 0;
        const p2ServePctRaw = sackmannData.hasData ? (sackmannData.p2_point * 100) : 0;
        let baselineServe = isWTA ? 57.5 : 64.0;
        let dr1_num = sackmannData.hasData ? Math.max(0.7, 1.0 + (p1ServePctRaw - baselineServe) * 0.05) : 1.0;
        let dr2_num = sackmannData.hasData ? Math.max(0.7, 1.0 + (p2ServePctRaw - baselineServe) * 0.05) : 1.0;
        let drDelta = Math.abs(dr1_num - dr2_num);
        const displayDr1 = Number.isFinite(Number(canonicalBridge?.p1?.dominanceRatio)) ? Number(canonicalBridge.p1.dominanceRatio) : (sackmannData.hasData ? dr1_num : null);
        const displayDr2 = Number.isFinite(Number(canonicalBridge?.p2?.dominanceRatio)) ? Number(canonicalBridge.p2.dominanceRatio) : (sackmannData.hasData ? dr2_num : null);

        // Step 21 runtime fix: sackmannSample must be initialized before the
        // Real Ranking module uses it. In Step 20 it was declared below this
        // block, causing: Cannot access 'sackmannSample' before initialization.
        const sackmannSample = sackmannData && sackmannData.sample ? sackmannData.sample : 0;

        let realRankingAssessment = null;
        try {
            if (!sackmannData.hasData || r1 === null || r2 === null) {
                realRankingAssessment = {
                    version: 'REAL_RANKING_V2_PATCH26_UNAVAILABLE',
                    players: [], officialGap: rankDelta, realGap: null, confidence: 0, riskAdjustment: 0,
                    verdict: 'Ranking reale production non calcolato: evidenza match-level insufficiente. I dati canonici restano solo contestuali.',
                    summary: 'Nessun placeholder di ranking applicato.'
                };
            } else {
                realRankingAssessment = buildRealRankingAssessment({
                    p1Name,
                    p2Name,
                    prediction: cleanPred,
                    p1Rank: r1,
                    p2Rank: r2,
                    dr1: dr1_num,
                    dr2: dr2_num,
                    sackmannSample,
                    surface: modelSurface,
                    matchContext
                });
            }
        } catch (realRankingError) {
            penaltyReason.push(`Ranking reale non disponibile: ${realRankingError.message || realRankingError}. DeepScan prosegue senza bloccare il match.`);
            realRankingAssessment = {
                version: 'REAL_RANKING_V1_FALLBACK',
                players: [],
                officialGap: rankDelta,
                realGap: rankDelta,
                confidence: 0,
                riskAdjustment: 0,
                verdict: 'Ranking reale non disponibile per errore runtime; usare ranking ufficiale come fallback.',
                summary: `Ranking ufficiale disponibile: ${r1 ?? 'N/D'} vs ${r2 ?? 'N/D'}. Nessun valore 500 applicato.`
            };
        }

        const advMetrics = getSafeAdvancedMetrics(p1Name, p2Name, modelSurface, analysisDate);
        if (advMetrics.runtimeError) {
            penaltyReason.push(`Metriche avanzate non disponibili: ${advMetrics.runtimeError}. DeepScan prosegue con metrica base.`);
        }
        let avgGames = advMetrics.hasAdvancedData && advMetrics.matchDynamics ? advMetrics.matchDynamics.avgGamesPerSet : 9.0;
        let tbRisk = advMetrics.hasAdvancedData && advMetrics.matchDynamics ? advMetrics.matchDynamics.tieBreakRisk : "Sconosciuto";

        let advHtml = "";
        if (advMetrics.hasAdvancedData && advMetrics.matchDynamics) {
            advHtml = `
                <div style="background: rgba(139, 92, 246, 0.1); padding: 10px; border-radius: 6px; border: 1px solid #8b5cf6; margin-top: 10px;">
                    <strong style="color: #c4b5fd; font-size: 0.9rem;">🔬 Advanced Quant Metrics (Games/Set & Tie-Break):</strong><br>
                    <div style="display: flex; justify-content: space-between; margin-top: 5px; color: #cbd5e1; font-size: 0.85rem;">
                        <div>
                            <span style="color: #9ca3af;">Avg Games/Set:</span> <strong style="color: #f8fafc;">${avgGames.toFixed(2)}</strong><br>
                            <span style="color: #9ca3af;">Exp. Games (2 Sets):</span> <strong style="color: #f8fafc;">${advMetrics.matchDynamics.expectedGames2Sets.toFixed(1)}</strong>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: #9ca3af;">Tie-Break Risk:</span> <strong style="color: ${tbRisk.includes('Alto') ? '#ef4444' : '#10b981'};">${tbRisk}</strong><br>
                            <span style="color: #9ca3af;">Profilo:</span> ${advMetrics.matchDynamics.profile || 'N/A'}
                        </div>
                    </div>
                </div>
            `;
        }

        let weightDR = sackmannSample >= 20 ? 0.6 : (sackmannSample >= 10 ? 0.4 : 0.1);
        if (!sackmannData.hasData) weightDR = 0;

        const projRank1 = Math.round(70 - (dr1_num - 1.0) * 400);
        const projRank2 = Math.round(70 - (dr2_num - 1.0) * 400);
        const calcRank1 = r1 ?? 500;
        const calcRank2 = r2 ?? 500;
        let p1EstRank = Math.max(1, Math.round(calcRank1 * (1 - weightDR) + projRank1 * weightDR));
        let p2EstRank = Math.max(1, Math.round(calcRank2 * (1 - weightDR) + projRank2 * weightDR));

        if (p1Data.momentumScore > 1) p1EstRank = Math.max(1, p1EstRank - 5); if (p1Data.momentumScore < -1) p1EstRank += 5;
        if (p2Data.momentumScore > 1) p2EstRank = Math.max(1, p2EstRank - 5); if (p2Data.momentumScore < -1) p2EstRank += 5;
        let p1Trend = r1 === null ? "N/D" : (p1EstRank < r1 - 3 ? "📈 In Salita" : (p1EstRank > r1 + 3 ? "📉 In Discesa" : "➖ Stabile"));
        let p2Trend = r2 === null ? "N/D" : (p2EstRank < r2 - 3 ? "📈 In Salita" : (p2EstRank > r2 + 3 ? "📉 In Discesa" : "➖ Stabile"));
        if (r1 !== null && r1 <= 10 && Math.abs(p1EstRank - r1) <= 3) p1Trend = "👑 Top Tier"; if (r2 !== null && r2 <= 10 && Math.abs(p2EstRank - r2) <= 3) p2Trend = "👑 Top Tier";

        // ===================================================
        // ⚡ THE SIGMOID PHYSICS ENGINE 
        // ===================================================
        if (cleanPred.includes('O') || cleanPred.includes('U')) {
            const isO = cleanPred.includes('O');
            
            const gamesSigmoid = 15.0 * Math.tanh((avgGames - 9.5) / 0.6); 
            const blowoutSigmoid = 12.0 * Math.tanh(drDelta / 0.15);

            if (isO) {
                adjustedProb += gamesSigmoid; adjustedProb -= blowoutSigmoid;
                penaltyReason.push(`Neural Tanh (Games Dynamics): ${gamesSigmoid > 0 ? '+' : ''}${gamesSigmoid.toFixed(1)}%`);
                if (blowoutSigmoid > 2) penaltyReason.push(`Neural Tanh (Blowout Risk): -${blowoutSigmoid.toFixed(1)}%`);
            } else {
                adjustedProb -= gamesSigmoid; adjustedProb += blowoutSigmoid;
                penaltyReason.push(`Neural Tanh (Games Dynamics): ${-gamesSigmoid > 0 ? '+' : ''}${-gamesSigmoid.toFixed(1)}%`);
                if (blowoutSigmoid > 2) penaltyReason.push(`Neural Tanh (Blowout Risk): +${blowoutSigmoid.toFixed(1)}%`);
            }

            if (advMetrics.hasAdvancedData && advMetrics.p1 && advMetrics.p2) {
                const mc = quantEngine.estimateTotalsProbabilitiesMonteCarlo(advMetrics.p1, advMetrics.p2, totalsLine, { iterations: 10000 });
                const mcProb = isO ? (mc.probOver * 100) : (mc.probUnder * 100);
                adjustedProb = (adjustedProb * 0.4) + (mcProb * 0.6); 
                penaltyReason.push(`Ensemble Monte Carlo: Probabilità finale fusa con 10.000 simulazioni (${mcProb.toFixed(1)}%).`);
            }
        } 
        else if (cleanPred === '1' || cleanPred === '2') {
            let isP1 = cleanPred === '1';
            let myDrDelta = (isP1 ? dr1_num : dr2_num) - (isP1 ? dr2_num : dr1_num); 
            
            const drSigmoid = 12.0 * Math.tanh(myDrDelta / 0.15); 
            adjustedProb += drSigmoid; 
            if (Math.abs(drSigmoid) > 1.5) penaltyReason.push(`Neural Tanh (Dominance Delta): ${drSigmoid > 0 ? '+' : ''}${drSigmoid.toFixed(1)}%`);

            if ((isP1 ? p1Data.tactics.fatigue : p2Data.tactics.fatigue)) { adjustedProb -= 3.0; penaltyReason.push(`Fatigue Penalty applicata (-3.0%).`); }
            
            const targetOddLocal = parseFloat(odd) || 0; 
            if (targetOddLocal > 0 && targetOddLocal < 1.65 && (isP1 ? r1 : r2) > 10 && myDrDelta < 0.05) {
                if (adjustedProb > 63.0) {
                    penaltyReason.push(`Late Money Trap: mercato schiacciato rilevato; da Step83 non modifica la probabilità canonica, agisce solo come warning/rischio.`);
                }
            }
        }

        if (sackmannData && sackmannData.sample && sackmannData.sample < 20) {
            adjustedProb = 50 + (adjustedProb - 50) * 0.7; penaltyReason.push(`Sample Size Basso (Sackmann < 20 match). Regressione media applicata.`);
        }

        adjustedProb = safeClamp(adjustedProb, 5.0, 95.0);

        const SR = computeStructuralRisk(p1ServePctRaw, p2ServePctRaw, dr1_num, dr2_num, p1Data, p2Data, modelSurface, tmlData);
        const targetOdd = normalizeOdd(odd) || 0;
        const marketImpliedProb = targetOdd > 0 ? calculateMarketImpliedProbabilityPct(targetOdd) : 0;
        const marketReferenceAvailable = hasTwoWayReferenceOdds(odd1, odd2);
        const noVigReferenceProb = calculateNoVigSideProbabilityPct(cleanPred, odd1, odd2);
        const marketReferenceProb = noVigReferenceProb ?? marketImpliedProb;
        const marketReferenceSource = marketReferenceAvailable ? 'two_way_no_vig_reference' : 'played_odd_fallback';
        let bookieFairProb = marketReferenceProb;

        if (!marketReferenceAvailable) {
            penaltyReason.push("Quote riferimento P1/P2 non disponibili: il confronto mercato usa la quota giocata come fallback e non valida l'edge come sharp.");
        }

        // ======================================================
        // ⚡ FIX QUANT: Disagreement Matrix & Uncertainty Shrinkage
        // ======================================================
        const computedEdgePp = calculateEdgePp(adjustedProb, marketReferenceProb);
        const computedEvPct = calculateEvPct(adjustedProb, targetOdd);
        const disagreement = Math.abs(adjustedProb - marketReferenceProb);
        
        let uncertainty = 0.10 + (disagreement / 100);
        uncertainty = safeClamp(uncertainty, 0.10, 0.40);
        let shrunkEdgePp = computedEdgePp * (1 - uncertainty);
        let shrunkEvPct = computedEvPct * (1 - uncertainty);

        // ======================================================
        // ⚡ FIX QUANT: NLP Capping
        // ======================================================
        let nlpBoost = 1.0;

        if (cleanPred === '1') {
            if (p1Data.score > 0) nlpBoost += safeClamp(p1Data.score * 0.02, 0, 0.08);
            if (p1Data.score < 0) nlpBoost -= safeClamp(Math.abs(p1Data.score) * 0.02, 0, 0.08);
            if (p2Data.score < 0) nlpBoost += safeClamp(Math.abs(p2Data.score) * 0.02, 0, 0.08);
        } else if (cleanPred === '2') {
            if (p2Data.score > 0) nlpBoost += safeClamp(p2Data.score * 0.02, 0, 0.08);
            if (p2Data.score < 0) nlpBoost -= safeClamp(Math.abs(p2Data.score) * 0.02, 0, 0.08);
            if (p1Data.score < 0) nlpBoost += safeClamp(Math.abs(p1Data.score) * 0.02, 0, 0.08);
        }

        let realEdge = Number.isFinite(inputEdgePp) ? inputEdgePp : (shrunkEdgePp * nlpBoost);
        let realEvPct = Number.isFinite(inputEvPct) ? inputEvPct : (shrunkEvPct * nlpBoost);

        // Compatibilità: il giudice storico riceve un valore edge-like.
        // Da v14.2 passiamo edge_pp standardizzato, non EV mascherato da edge.
        const decisionEdgePp = realEdge;

        // ======================================================
        // ⚡ FIX QUANT: Model Conviction
        // ======================================================
        const baseConviction = (p1Data.nlpConfidence + p2Data.nlpConfidence) / 2;
        const sampleFactor = Math.max(0, Math.min(1, sackmannSample / 50));
        
        let modelConviction = (baseConviction * 0.3) + ((1 - SR) * 100 * 0.4) + (sampleFactor * 100 * 0.3);
        // Step 18: se mancano quote reference two-way, il disaccordo contro la sola quota giocata
        // non deve abbattere la conviction come se fosse un consenso mercato sharp.
        const disagreementPenalty = marketReferenceAvailable
            ? (disagreement * 0.8)
            : (Math.max(0, disagreement - 10) * 0.25);
        modelConviction -= disagreementPenalty;
        const externalConfidencePenalty = safeClamp(toNumber(externalIntelligence.challenger?.confidencePenalty, 0), 0, 12);
        if (externalConfidencePenalty > 0) {
            modelConviction -= externalConfidencePenalty;
            const weatherReasons = externalIntelligence.weather?.risk?.reasons || [];
            const rankingConflict = externalIntelligence.rankingComparison?.conflict === true;
            penaltyReason.push(`Contesto esterno Patch37: conviction ridotta di ${round(externalConfidencePenalty, 1)} punti${weatherReasons.length ? ` · meteo ${weatherReasons.join(', ')}` : ''}${rankingConflict ? ' · conflitto ranking ufficiale/locale' : ''}. Nessun aumento stake.`);
        }
        modelConviction = safeClamp(modelConviction, 0, 100);

        const underdogClay = r1 > r2 ? tmlData.p1Clay : tmlData.p2Clay;

        // CHIAMATA AI MOTORI DECISIONALI
        const verdict = quantEngine.generateVerdict(cleanPred, decisionEdgePp, modelConviction, SR, p1Data, p2Data, totalsLine, rankDelta, underdogClay, isWTA, sackmannSample);
        const legacySuggestion = quantEngine.generateBetSuggestion(p1Name, p2Name, dr1_num, dr2_num, p1Data, p2Data, avgGames, tbRisk, isWTA, cleanPred, decisionEdgePp, verdict.action);

        const hardMedicalVeto = p1Data.tactics.injuryOut || p2Data.tactics.injuryOut;
        const softMedicalWarning = p1Data.tactics.fatigue || p2Data.tactics.fatigue;

        // escapeHtml è globale da v15.0 perché usato anche da helper top-level.

        const riskAssessment = buildTennisDeepScanRiskAssessment({
            verdictIsHighRisk: verdict.isHighRisk,
            hardMedicalVeto,
            softMedicalWarning,
            modelConviction,
            structuralRisk: SR,
            marketDisagreementPp: disagreement,
            edgePp: realEdge,
            evPct: realEvPct,
            surfaceDetection,
            marketReferenceAvailable,
            marketReferenceSource,
            sackmannSample,
            cleanPred,
            odd: targetOdd,
            probabilityPct: adjustedProb,
            marketImpliedProbabilityPct: marketImpliedProb,
            rankDelta,
            drDelta,
            realRankingAssessment,
            isWTA,
            tournament: matchContext.tournament || matchContext.league || '',
            modelSurface,
            tbRisk
        });

        const suggestion = buildTennisDeepScanAdvisory({
            cleanPred,
            p1Name,
            p2Name,
            avgGames,
            tbRisk,
            isWTA,
            adjustedProb,
            realEdge,
            realEvPct,
            modelConviction,
            structuralRisk: SR,
            surfaceDetection,
            riskAssessment,
            legacySuggestion
        });

        let finalHtml = `
        <div style="margin-top: 15px; font-family: 'Segoe UI', Roboto, sans-serif; background: #111827; border-radius: 12px; overflow: hidden; border: 1px solid #374151; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <div style="background: #1f2937; padding: 15px 20px; border-bottom: 1px solid #374151;">
                <div style="color: #60a5fa; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2z"/></svg>
                    Motore Quantitativo & Monte Carlo Ensemble
                </div>
                <p style="margin: 0 0 8px 0; color: #d1d5db; font-size: 0.9rem; line-height: 1.5;">
                    <strong>Probabilità Fair Bookmaker:</strong> <span style="color: #f8fafc; font-weight: bold;">${bookieFairProb.toFixed(1)}%</span><br>
                    <strong>Probabilità Implicita Quota:</strong> <span style="color: #f8fafc; font-weight: bold;">${marketImpliedProb.toFixed(1)}%</span><br>
                    <strong>Model Conviction:</strong> <span style="color: #fbbf24; font-weight: bold;">${modelConviction.toFixed(1)} / 100</span><br>
                    <strong>Structural Risk (SR):</strong> <span style="color: #f97316; font-weight: bold;">${(SR*100).toFixed(1)}%</span><br>
                    <strong>Surface:</strong> <span style="color: #38bdf8; font-weight: bold;">${surface} (${surfaceDetection.source}${surfaceDetection.ruleId ? ' · ' + surfaceDetection.ruleId : ''}, conf. ${(surfaceDetection.confidence * 100).toFixed(0)}%)${surfaceDetection.overriddenProviderSurface ? ' · provider override ' + surfaceDetection.overriddenProviderSurface : ''}${surfaceDetection.isFallback ? ' · model fallback ' + modelSurface : ''}</span>
                </p>
                <div style="background: ${realEdge > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border-left: 3px solid ${realEdge > 0 ? '#3b82f6' : '#ef4444'}; padding: 8px 12px; border-radius: 0 4px 4px 0;">
                    <strong style="color: ${realEdge > 0 ? '#10b981' : '#ef4444'}; font-size: 1.05rem;">EDGE_PP: ${realEdge > 0 ? '+' : ''}${realEdge.toFixed(2)} pp</strong><br>
                    <strong style="color: ${realEvPct > 0 ? '#10b981' : '#ef4444'}; font-size: 0.95rem;">EV_PCT: ${realEvPct > 0 ? '+' : ''}${realEvPct.toFixed(2)}%</strong> 
                </div>
            </div>

            <div style="padding: 15px 20px; border-bottom: 1px solid #374151;">
                <div style="color: #8b5cf6; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-bottom: 10px;">💎 Premium Data Insights</div>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <div style="background: rgba(17, 24, 39, 0.4); padding: 10px; border-radius: 6px; border: 1px solid #374151;">
                        <div style="display: flex; justify-content: space-between; color: #cbd5e1; font-size: 0.85rem;">
                            <div><span style="color: #9ca3af;">${p1Name}</span><br>DR Est.: ${displayDr1 === null ? 'N/D' : displayDr1.toFixed(2)}</div>
                            <div style="text-align: right;"><span style="color: #9ca3af;">${p2Name}</span><br>DR Est.: ${displayDr2 === null ? 'N/D' : displayDr2.toFixed(2)}</div>
                        </div>
                    </div>
                    ${advHtml}
                </div>
            </div>
            ${renderCanonicalPlayerEvidenceHtml(canonicalBridge, p1Name, p2Name)}
            ${renderRealRankingTableHtml(realRankingAssessment)}

            <div style="padding: 15px 20px; border-bottom: 1px solid #374151;">
                <div style="color: #06b6d4; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-bottom: 10px;">📉 Medical & News Check</div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="background: rgba(17, 24, 39, 0.5); padding: 8px 12px; border-radius: 6px; border-left: 2px solid ${p1Data.color}; flex: 1;">
                        <div style="color: #9ca3af; font-size: 0.7rem;">${p1Name.split(' ').pop()}</div><div style="color: #f8fafc; font-size: 0.85rem; font-weight: bold;">${p1Data.report}</div>
                    </div>
                    <div style="background: rgba(17, 24, 39, 0.5); padding: 8px 12px; border-radius: 6px; border-left: 2px solid ${p2Data.color}; flex: 1;">
                        <div style="color: #9ca3af; font-size: 0.7rem;">${p2Name.split(' ').pop()}</div><div style="color: #f8fafc; font-size: 0.85rem; font-weight: bold;">${p2Data.report}</div>
                    </div>
                </div>
            </div>

            <div style="margin: 15px 20px; padding: 12px; border-radius: 8px; background: #020617; border: 1px solid #1e293b;">
                <div style="color:#38bdf8; font-weight:600; font-size:0.9rem; margin-bottom:8px;">Model Explainability</div>
                <div style="color:#cbd5e1; font-size:0.85rem; line-height:1.6;">
                    <strong>Verdetto Risk-Committee:</strong> <span style="color:#f8fafc;">${escapeHtml(verdict.reason)}</span><br>
                    <strong>Risk Taxonomy 15.0 / Weighted Calibration:</strong> <span style="color:#fbbf24;">${escapeHtml(riskAssessment.level)} · Risk ${riskAssessment.riskScore}/100 · Value ${riskAssessment.valueScore}/100</span><br>
                    <strong>Market Reference:</strong> <span style="color:#cbd5e1;">${escapeHtml(riskAssessment.marketReferenceSource)}</span><br>
                    <div style="margin-top:8px; display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:6px;">
                        ${riskAssessment.weightedAssessment?.components?.map(p => {
                            const c = p.status === 'PASS' ? '#10b981' : (p.status === 'WARN' ? '#f59e0b' : (p.status === 'WARN_HIGH' ? '#f97316' : '#ef4444'));
                            return `<div style="background:#0f172a; border:1px solid #334155; border-left:3px solid ${c}; border-radius:6px; padding:7px;"><strong style="color:${c}; font-size:0.75rem;">${escapeHtml(p.label)}</strong><br><span style="color:#cbd5e1; font-size:0.72rem;">peso ${p.weight}% · rischio ${p.riskScore}/100 · value ${p.valueScore}/100</span><br><span style="color:#94a3b8; font-size:0.68rem;">${escapeHtml(p.summary || '')}</span></div>`;
                        }).join('') || ''}
                    </div>
                    <div style="margin-top:8px; color:#94a3b8; font-size:0.78rem;">
                        Driver principali: ${riskAssessment.weightedAssessment?.mainDrivers?.map(d => escapeHtml(`${d.label} (${d.riskScore}/100)`)).join(' · ') || 'n/d'}
                    </div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #334155;">
                        <strong>Motivi rischio:</strong><br>
                        • ${riskAssessment.reasons.map(escapeHtml).join('<br>• ')}<br><br>
                        <strong>Filtri applicati:</strong><br> 
                        ${penaltyReason.length > 0 ? '• ' + penaltyReason.map(escapeHtml).join('<br>• ') : '<span style="color:#94a3b8;">Nessuna regolazione algoritmica applicata.</span>'}
                    </div>
                </div>
            </div>

            <div style="margin: 0 20px 15px 20px; padding: 12px; border-radius: 8px; background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.4);">
                <div style="color:#eab308; font-weight:700; font-size:0.9rem; margin-bottom:8px;">Esito Consigliato dall'IA</div>
                <div style="color:#cbd5e1; font-size:0.85rem;">
                    <strong>Modalità DeepScan:</strong> <span style="color:#fbbf24; font-weight:800;">${escapeHtml(suggestion.mode || 'WAIT_IN_PLAY')}</span><br>
                    <strong>Mercato Target:</strong> <span style="color: #f8fafc;">${escapeHtml(suggestion.market)}</span><br>
                    <strong>Esito:</strong> <strong style="color: #10b981; font-size:1rem;">${escapeHtml(suggestion.selection)}</strong><br>
                    <strong>Timing:</strong> <span style="color:#cbd5e1;">${escapeHtml(suggestion.timing || '-')}</span><br>
                    <div style="margin-top: 6px; font-style: italic; color:#9ca3af;">"${escapeHtml(suggestion.rationale)}"</div>
                    ${Array.isArray(suggestion.alternatives) && suggestion.alternatives.length ? `
                        <div style="margin-top:10px; padding:8px; border-radius:6px; background:rgba(15,23,42,0.75); border:1px dashed #64748b;">
                            <strong style="color:#93c5fd;">Alternative DeepScan sempre mostrate:</strong><br>
                            ${suggestion.alternatives.map(a => `<span style="color:#cbd5e1;">• <strong>${escapeHtml(a.market || 'Alternativa')}</strong>: ${escapeHtml(a.selection || '')} <em style="color:#94a3b8;">(${escapeHtml(a.confidence || 'n/d')})</em></span>`).join('<br>')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
        `;

        return { 
            success: true, 
            action: riskAssessment.action, 
            suggestionText: suggestion.selection,
            reason: finalHtml, 
            isHighRisk: riskAssessment.isHighRisk,
            riskAssessment,
            deepScanOperationalGate: buildTennisDeepScanOperationalGate(riskAssessment, normalizedInput),
            deepScanGateMode: 'OPERATIONAL_GATE',
            confidence: modelConviction,
            structuralRisk: SR,
            edge_pp: round(realEdge, 2),
            ev_pct: round(realEvPct, 2),
            adjustedProbability: round(adjustedProb, 2),
            marketImpliedProbability: round(marketImpliedProb, 2),
            metricVersion: 'TENNIS_EDGE_EV_V2',
            engineVersion: DEEP_SCAN_TENNIS_VERSION,
            data_quality: canonicalBridge?.status && canonicalBridge.status !== 'UNAVAILABLE' ? `CANONICAL_${canonicalBridge.status}` : 'CURRENT_BOOTSTRAP',
            canonicalPlayerEvidenceBridge: canonicalBridge,
            canonicalPlayerEvidenceAuthority: 'DEEPSCAN_CONTEXT_ONLY',
            externalMatchIntelligence: externalIntelligence,
            externalIntelligenceAuthority: externalIntelligence.authority,
            externalIntelligenceChallenger: externalIntelligence.challenger,
            totalsDeepScanContext: riskAssessment.totalsContext || null,
            informationRetrieval: {
                version: 'TENNIS_DEEPSCAN_RETRIEVAL_RECEIPT_V1_PATCH15',
                player1: p1Data.retrieval || null,
                player2: p2Data.retrieval || null,
                h2h: tmlData.retrieval || null,
                externalIntelligence: {
                    version: externalIntelligence.version,
                    sourceIds: externalIntelligence.sourceIds,
                    officialRankingsStatus: externalIntelligence.officialRankings?.status || null,
                    weatherStatus: externalIntelligence.weather?.status || null,
                    receiptHash: externalIntelligence.receiptHash || null
                },
                deepScanSeparate: true,
                modelAuthority: false,
                settlementAuthority: false
            },
            quantData: { canonicalPlayerEvidenceBridge: canonicalBridge, adjustedProb, edge_pp: round(realEdge, 2), ev_pct: round(realEvPct, 2), marketImpliedProb: round(marketImpliedProb, 2), bookieFairProb: round(bookieFairProb, 2), marketReferenceProb: round(marketReferenceProb, 2), marketReferenceSource, riskAssessment, deepScanAdvisory: suggestion, totalsDeepScanContext: riskAssessment.totalsContext || null, realRankingAssessment, p1Data, p2Data, externalMatchIntelligence: externalIntelligence, penaltyReason, metricVersion: 'TENNIS_EDGE_EV_V2', engineVersion: DEEP_SCAN_TENNIS_VERSION }
        };

    } catch (e) {
        // FALLBACK DI PROTEZIONE ANTI-CRASH
        const errorHtml = `
            <div style="padding: 15px; background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; color: #f8fafc; font-family: 'Segoe UI', sans-serif;">
                <h3 style="color: #ef4444; margin-top: 0;">⚠️ Anomalia Deep Scan</h3>
                <p style="font-size: 0.9rem;">Il motore quantitativo ha riscontrato un errore nel calcolo avanzato delle metriche per questo match. L'Edge di base rimane valido.</p>
                <code style="display: block; background: #111827; padding: 10px; font-size: 0.8rem; color: #f87171; border-radius: 4px;">Error: ${e.message}</code>
            </div>
        `;
        return { 
            success: true, 
            action: '⚠️ ERRORE INTERNO', 
            suggestionText: 'Mancanza Dati',
            reason: errorHtml, 
            isHighRisk: true,
            confidence: 0,
            structuralRisk: 1,
            edge_pp: firstFiniteNumber(inputEdgePp, 0),
            ev_pct: firstFiniteNumber(inputEvPct, 0),
            metricVersion: 'TENNIS_EDGE_EV_V2',
            engineVersion: DEEP_SCAN_TENNIS_VERSION,
            data_quality: 'CURRENT_BOOTSTRAP'
        };
    }
}

module.exports = {
    DEEP_SCAN_TENNIS_VERSION,
    scanMatchup,
    detectMatchSurface,
    normalizeSurface,
    inferSurfaceFromTournament,
    normalizeScanArguments,
    calculateEdgePp,
    calculateEvPct,
    hasTwoWayReferenceOdds,
    calculateNoVigSideProbabilityPct,
    TENNIS_DEEPSCAN_WEIGHTS_V15,
    TENNIS_TOTALS_DEEPSCAN_STEP50E,
    buildTotalsDeepScanContext,
    parseTotalsPrediction,
    TENNIS_DEEPSCAN_LEVELS_V15,
    buildTennisDeepScanWeightedAssessment,
    buildTennisDeepScanRiskAssessment,
    buildTennisDeepScanOperationalGate,
    buildTennisDeepScanAdvisory,
    buildTennisWaitInstruction,
    buildTennisAlternative,
    buildTennisSixPillarAssessment,
    buildRealRankingAssessment,
    renderRealRankingTableHtml,
    getPatch27PerformanceHealth,
    resetPatch27PerformanceCache,
    _patch27GetSentimentAnalysis: getSentimentAnalysis,
    _patch27GetTMLStats: getTMLStats,
    _patch27FetchWithRetry: fetchWithRetry
};