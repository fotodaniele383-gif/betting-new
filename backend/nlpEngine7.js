// ======================================================
//  AI BETTING QUANT PRO - NLP ENGINE CALCIO 7.5 (Enterprise)
//  - Fix: Fetching Config, O(n²) Hash Duplication
//  - Fix: Weak/Strong Context Scoring
// ======================================================

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const calcioSourceIntelligence = require('./calcioSourceIntelligence');
const deepScanRuntimeResilience = require('./deepScanRuntimeResilience');

// ======================================================
// CONFIG & CACHING
// ======================================================
const CACHE_DIR = path.join(__dirname, 'cache_nlp_calcio');
if (!fs.existsSync(CACHE_DIR)) {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch(e) {}
}

const MAX_ARTICLES_PER_SOURCE = 15;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const NLP_SOURCE_VERSION = calcioSourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION; 

function getCacheFile(teamName,opponent='') {
    const safeName = [teamName,opponent].join('_vs_').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return path.join(CACHE_DIR, `${safeName}.json`);
}

function loadCache(teamName,opponent='') {
    const file = getCacheFile(teamName,opponent);
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Date.now() - data.timestamp > CACHE_TTL_MS) return null;
        if (data.cacheSchemaVersion !== calcioSourceIntelligence.SOURCE_CACHE_SCHEMA_VERSION) return null;
        return data.profile;
    } catch (e) { return null; }
}

function saveCache(teamName, profile,opponent='') {
    try {
        const file = getCacheFile(teamName,opponent);
        fs.writeFileSync(file, JSON.stringify({ timestamp: Date.now(), cacheSchemaVersion: calcioSourceIntelligence.SOURCE_CACHE_SCHEMA_VERSION, profile }, null, 2), 'utf8');
    } catch (e) {}
}

// ⚡ FIX: Hash MD5 per O(1) Lookup Deduplication
function hashTitle(title) {
    return crypto.createHash('md5').update(title.replace(/\s+/g, ' ').trim()).digest('hex');
}

// ======================================================
// DIZIONARI LINGUISTICI E CONTESTUALI
// ======================================================
function detectLanguage(text) {
    const t = text.toLowerCase();
    if (/( el | la | los | las | pero | porque | partido | equipo )/.test(t)) return "es";
    if (/( le | la | les | mais | pourquoi | équipe | match )/.test(t)) return "fr";
    if (/( der | die | das | aber | warum | mannschaft | spiel )/.test(t)) return "de";
    if (/( o | a | os | as | porque | lesão | equipa | jogo )/.test(t)) return "pt";
    if (/( il | lo | la | gli | le | perché | squadra | partita )/.test(t)) return "it";
    return "en";
}

const INJURY_PATTERNS = {
    en: [/\binjury\b/, /\binjured\b/, /ruled out/, /\bmisses\b/, /\bdoubt\b/, /\bsidelined\b/],
    it: [/\binfortunio\b/, /\bstop\b/, /\bassente\b/, /\bsalta\b/, /\bsqualificato\b/, /\bko\b/, /\bindisponibile\b/],
    fr: [/\bblessure\b/, /\bforfait\b/, /\babsent\b/, /\btouché\b/, /\bincertain\b/],
    es: [/\blesión\b/, /\bbaja\b/, /\bausente\b/, /\bduda\b/, /\bdescartado\b/],
    de: [/\bverletzung\b/, /\bausfall\b/, /\bfehlt\b/, /\bgesperrt\b/, /\bfraglich\b/],
    pt: [/\blesão\b/, /\bbaixa\b/, /\bausente\b/, /\bdúvida\b/, /\bdesfalque\b/]
};

const FAKE_INJURY = [
    /\bprecaution\b/i, /\bprecauzione\b/i, /minor issue/i, /leggero problema/i,
    /light discomfort/i, /small knock/i, /expected to play/i, /allenamento regolare/i, /should be available/i
];

// ⚡ FIX: Contextual Scoring
const MOMENTUM = {
    strong_positive: [/dominates/i, /convincing win/i, /straight sets/i, /trionfo netto/i, /vittoria schiacciante/i],
    weak_positive: [/survives/i, /edges past/i, /lucky win/i, /vittoria di misura/i, /si salva/i],
    negative: [/slump/i, /crisis/i, /\bcrisi\b/i, /collapse/i, /crollo/i, /poor run/i, /winless/i, /negative streak/i]
};

const PSYCHO = {
    positive: [/motivated/i, /determinato/i, /hungry/i, /fame di vittoria/i, /focus/i, /concentrato/i, /spogliatoio unito/i],
    negative: [/under pressure/i, /pressione/i, /tensione/i, /spogliatoio spaccato/i, /criticism/i, /contestazione/i, /fans unhappy/i]
};

const ROLES = {
    attack: [/attaccante/i, /bomber/i, /goleador/i, /punta/i, /centravanti/i, /tridente/i, /striker/i, /forward/i, /winger/i, /buteur/i],
    defense: [/difensore/i, /centrale/i, /terzino/i, /difesa/i, /defender/i, /center[- ]back/i, /full[- ]back/i, /defenseur/i],
    goalie: [/portiere/i, /saracinesca/i, /goalkeeper/i, /keeper/i, /gardien de but/i],
    key: [/titolare/i, /stella/i, /capitano/i, /fuoriclasse/i, /leader/i, /chiave/i, /key player/i, /star/i, /captain/i, /titulaire/i]
};

const NOISE = [/intervista/i, /sponsor/i, /partnership/i, /fashion/i, /instagram/i, /programma/i, /schedule/i, /preview/i, /draw/i, /podcast/i, /documentary/i];
const COMPILATION = [/risultati/i, /results/i, /roundup/i, /recap/i, /day \d/i, /highlights/i, /programma/i, /schedule/i, /avanzano/i, /sorprese/i];
const BOILERPLATE = [/terms & conditions/i, /market will resolve/i, /forfeiture/i, /betting/i, /bookmaker/i, /quote/i, /scommesse/i, /regolamento/i, /void/i];

// ======================================================
// HELPER FUNZIONI RETE E PULIZIA
// ======================================================
// ⚡ FIX: Fetching corretto con Config object e Limite Rate (simulato col jitter)
async function fetchWithRetry(config, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const jitter = Math.floor(Math.random() * 500) + 300;
            await new Promise(resolve => setTimeout(resolve, jitter));
            return await axios(config);
        } catch (error) {
            if (i === retries) throw error;
        }
    }
}

function extractArticlesFromRss(response, maxItems = MAX_ARTICLES_PER_SOURCE, source = {}) {
    const articles = [];
    if (!response || !response.data) return articles;

    const $ = cheerio.load(response.data, { xmlMode: true });
    $('item').each((i, el) => {
        if (i >= maxItems) return;
        const titleRaw = $(el).find('title').first().text().trim();
        const descRaw = $(el).find('description').first().text().trim();
        const pubDateStr = $(el).find('pubDate').first().text().trim();
        const link = $(el).find('link').first().text().trim();
        const sourceElement = $(el).children().toArray().find(node => {
            const name = String(node?.name || node?.tagName || '').toLowerCase();
            return name === 'source' || name.endsWith(':source');
        });
        const sourceNode = sourceElement ? $(sourceElement) : null;
        const sourceName = sourceNode ? sourceNode.text().trim() : '';
        const sourceUrl = sourceNode ? (sourceNode.attr('url') || '') : '';
        const title = titleRaw.toLowerCase();
        const desc = descRaw.toLowerCase();
        articles.push({
            title,
            originalTitle: titleRaw,
            fullText: `${title} ${desc}`,
            pubDate: pubDateStr,
            link,
            sourceName,
            sourceUrl,
            providerId: source.id || 'RSS_UNKNOWN'
        });
    });
    return articles;
}

function deduplicateArticles(rawArticles) {
    const unique = [];
    const seen = new Set();
    
    // ⚡ FIX: Prevenzione Memory Leak e O(N^2)
    const limitedArticles = rawArticles.slice(0, 100); 

    for (let article of limitedArticles) {
        const txt = article.fullText;
        if (BOILERPLATE.some(r => r.test(txt)) || NOISE.some(r => r.test(txt)) || COMPILATION.some(r => r.test(article.title))) continue;

        const key = hashTitle(article.title);
        if (seen.has(key)) continue;

        seen.add(key);
        unique.push(article);
    }
    return unique;
}

// ======================================================
// ANALISI NLP SINGOLO ARTICOLO E AGGREGAZIONE
// ======================================================
function analyzeArticleNlp(article) {
    const text = article.fullText.toLowerCase();
    const lang = detectLanguage(text);

    let nlp = { injury: 0, form: 0, momentum: 0, psychology: 0, injuredAttackers: 0, injuredDefenders: 0, injuredGoalies: 0, keyPlayersOut: 0, fakeInjuryCount: 0, language: lang };

    const injuryPatterns = INJURY_PATTERNS[lang] || INJURY_PATTERNS.en;
    let hasInjury = false;
    for (const r of injuryPatterns) {
        if (r.test(text)) { nlp.injury -= 1.0; hasInjury = true; }
    }

    for (const r of FAKE_INJURY) {
        if (r.test(text)) { nlp.injury += 0.5; nlp.fakeInjuryCount += 1; }
    }

    if (hasInjury) {
        if (ROLES.attack.some(r => r.test(text))) { nlp.injury -= 1.0; nlp.injuredAttackers += 1; }
        if (ROLES.defense.some(r => r.test(text))) { nlp.injury -= 0.8; nlp.injuredDefenders += 1; }
        if (ROLES.goalie.some(r => r.test(text))) { nlp.injury -= 1.5; nlp.injuredGoalies += 1; }
        if (ROLES.key.some(r => r.test(text))) { nlp.injury -= 1.0; nlp.keyPlayersOut += 1; }
    }

    // ⚡ FIX: Scoring Multi-livello
    MOMENTUM.strong_positive.forEach(r => { if (r.test(text)) nlp.momentum += 1.2; });
    MOMENTUM.weak_positive.forEach(r => { if (r.test(text)) nlp.momentum += 0.4; });
    MOMENTUM.negative.forEach(r => { if (r.test(text)) nlp.momentum -= 0.8; });
    
    PSYCHO.positive.forEach(r => { if (r.test(text)) nlp.psychology += 0.5; });
    PSYCHO.negative.forEach(r => { if (r.test(text)) nlp.psychology -= 0.5; });

    return nlp;
}

function aggregateNlpScores(nlpList) {
    const emptyAgg = { injury: 0, form: 0, momentum: 0, psychology: 0, injuredAttackers: 0, injuredDefenders: 0, injuredGoalies: 0, keyPlayersOut: 0, fakeInjuryCount: 0, confidence: 0, globalScore: 0, report: 'Neutro ⚖️', color: '#94a3b8', isEmergency: false, attackOut: false, defenseOut: false, keyPlayerOut: false };
    if (!nlpList.length) return emptyAgg;

    const agg = { ...emptyAgg };

    for (const n of nlpList) {
        agg.injury += n.injury; agg.momentum += n.momentum; agg.psychology += n.psychology;
        agg.injuredAttackers += n.injuredAttackers; agg.injuredDefenders += n.injuredDefenders;
        agg.injuredGoalies += n.injuredGoalies; agg.keyPlayersOut += n.keyPlayersOut; agg.fakeInjuryCount += n.fakeInjuryCount;
    }

    agg.form = agg.momentum * 0.6;
    const isEmergencyDefense = agg.injuredDefenders >= 2 || agg.injuredGoalies >= 1;
    const isEmergencyAttack = agg.injuredAttackers >= 2;
    agg.isEmergency = isEmergencyDefense || isEmergencyAttack || agg.keyPlayersOut >= 2;

    agg.globalScore = agg.injury * 4 + agg.form * 1.5 + agg.momentum * 1.2 + agg.psychology * 0.8;

    let confidence = 40 + (nlpList.length * 5) - (agg.fakeInjuryCount * 3);
    agg.confidence = Math.max(0, Math.min(100, confidence));

    if (agg.globalScore >= 2) { agg.report = 'Positivo 🔥'; agg.color = '#10b981'; }
    else if (agg.globalScore <= -2) { agg.report = 'Negativo 📉'; agg.color = '#ef4444'; }

    agg.attackOut = agg.injuredAttackers > 0;
    agg.defenseOut = agg.injuredDefenders > 0 || agg.injuredGoalies > 0;
    agg.keyPlayerOut = agg.keyPlayersOut > 0;

    return agg;
}

// ======================================================
// FUNZIONE PRINCIPALE ESPORTATA
// ======================================================
async function buildTeamNlpProfile(teamName, options = {}) {
    const sourcePlan = calcioSourceIntelligence.buildTeamSourcePlan(teamName);
    const providerResults = await Promise.all(sourcePlan.sources.map(async source => {
        const startedAt = Date.now();
        try {
            const response = await deepScanRuntimeResilience.runProvider(
                source.id,
                () => fetchWithRetry({
                    method: 'GET',
                    url: source.url,
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: Math.max(500, Number(options.axiosTimeoutMs || options.timeoutMs) || 4200)
                }, Number.isFinite(Number(options.retries)) ? Number(options.retries) : 1),
                {
                    timeoutMs: Math.max(750, Number(options.providerTimeoutMs || options.timeoutMs) || 5000),
                    failureThreshold: Number(options.failureThreshold) || 3,
                    cooldownMs: Number(options.cooldownMs) || (5 * 60 * 1000)
                }
            );
            return {
                ...source,
                status: 'OK',
                httpStatus: response.status,
                durationMs: Date.now() - startedAt,
                fetchedAt: new Date().toISOString(),
                articles: extractArticlesFromRss(response, MAX_ARTICLES_PER_SOURCE, source),
                runtimeVersion: deepScanRuntimeResilience.DEEPSCAN_RUNTIME_RESILIENCE_VERSION
            };
        } catch (error) {
            const status = error?.code === 'PROVIDER_TIMEOUT'
                ? 'TIMEOUT'
                : error?.code === 'PROVIDER_CIRCUIT_OPEN'
                    ? 'CIRCUIT_OPEN'
                    : 'ERROR';
            return {
                ...source,
                status,
                httpStatus: error?.response?.status || null,
                durationMs: Date.now() - startedAt,
                fetchedAt: new Date().toISOString(),
                articles: [],
                error: error?.message || 'SOURCE_FETCH_FAILED',
                errorCode: error?.code || 'SOURCE_FETCH_FAILED',
                retryAfterMs: error?.retryAfterMs || 0,
                runtimeVersion: deepScanRuntimeResilience.DEEPSCAN_RUNTIME_RESILIENCE_VERSION
            };
        }
    }));

    const sourceIntelligence = calcioSourceIntelligence.summarizeTeamSourceResults(
        teamName,
        providerResults,
        { now: options.now || new Date(), kickoff: options.kickoff || null, opponent:options.opponent||'',officialDomain: sourcePlan.officialDomain }
    );
    sourceIntelligence.runtimeResilience = {
        version: deepScanRuntimeResilience.DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
        providerTimeoutMs: Math.max(750, Number(options.providerTimeoutMs || options.timeoutMs) || 5000),
        circuitBreaker: true,
        sharedNewsCache: true
    };
    const evidenceArticles = deduplicateArticles(
        (sourceIntelligence.articles || []).map(article => ({
            ...article,
            title: String(article.title || article.originalTitle || '').toLowerCase(),
            fullText: article.fullText || article.title || ''
        }))
    );
    const nlpList = evidenceArticles.filter(article=>article.matchSpecificEvidence===true).map(article => analyzeArticleNlp(article));
    const agg = aggregateNlpScores(nlpList);
    const trueInjuryMentions = nlpList.filter(n => n.injury < 0).length;

    const hasEvidence = sourceIntelligence.r25MatchCandidateCount > 0;
    const allSourcesFailed = sourceIntelligence.status === 'UNAVAILABLE';
    const profile = {
        score: hasEvidence ? Math.max(-5, Math.min(5, agg.globalScore / 4)) : 0,
        tactics: {
            mentions: trueInjuryMentions,
            isEmergency: hasEvidence ? agg.isEmergency : false,
            attackOut: hasEvidence ? agg.attackOut : false,
            defenseOut: hasEvidence ? agg.defenseOut : false,
            keyPlayerOut: hasEvidence ? agg.keyPlayerOut : false
        },
        report: hasEvidence ? agg.report : (allSourcesFailed ? 'Fonti news non disponibili ⚠️' : 'Nessun segnale verificato ⚪'),
        color: hasEvidence ? agg.color : (allSourcesFailed ? '#f59e0b' : '#94a3b8'),
        confidence: sourceIntelligence.matchImpactConfidence ?? sourceIntelligence.confidence,
        sourceCoverageConfidence: sourceIntelligence.coverageConfidence ?? 0,
        matchImpactConfidence: sourceIntelligence.matchImpactConfidence ?? sourceIntelligence.confidence ?? 0,
        raw: { ...agg, evidenceArticles: evidenceArticles.length },
        sourceIntelligence,
        sourceError: allSourcesFailed ? 'ALL_NEWS_SOURCES_FAILED' : null,
        sourceVersion: NLP_SOURCE_VERSION,
        runtimeVersion: deepScanRuntimeResilience.DEEPSCAN_RUNTIME_RESILIENCE_VERSION
    };

    saveCache(teamName, profile,options.opponent||'');
    return profile;
}

async function getTeamNlpProfile(teamName, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const cachedProfile = forceRefresh ? null : loadCache(teamName,options.opponent||'');
    if (cachedProfile) return cachedProfile;

    const cacheKey = [
        'calcio-news',
        String(teamName || '').trim().toLowerCase(),
        String(options.opponent||'').trim().toLowerCase(),
        String(options.kickoff || options.matchDate || '').slice(0, 10),
        calcioSourceIntelligence.SOURCE_CACHE_SCHEMA_VERSION
    ].join('|');

    return deepScanRuntimeResilience.getSharedNews(
        cacheKey,
        () => buildTeamNlpProfile(teamName, options),
        { ttlMs: CACHE_TTL_MS, forceRefresh }
    );
}

module.exports = { getTeamNlpProfile, buildTeamNlpProfile, extractArticlesFromRss, NLP_SOURCE_VERSION };