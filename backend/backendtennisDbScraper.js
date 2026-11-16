/**
 * TENNIS-DB DEDICATED SCRAPER & AUDIT LOGGER
 * Estrae direttamente i risultati dalla tabella ufficiale di tennis-db.com
 * bypassando motori di ricerca e proxy instabili.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Ignora errori di certificati SSL su proxy o siti mal configurati [cite: 1, 2]
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function normalizeNameForUrl(name) {
    return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ============================================================================
// CLASSE AUDIT NODE (Per telemetria avanzata)
// ============================================================================
class AuditNode {
    constructor(processName) {
        this.processName = processName;
        this.steps = [];
        this.stepCounter = 1;
        console.log(`\n🚀 [START] ${processName}\n===================================`);
    }

    node(name, data = {}) {
        const stepNum = String(this.stepCounter++).padStart(2, '0');
        console.log(`\n[STEP${stepNum}] ${name}`);
        
        if (Object.keys(data).length > 0) {
            for (const [k, v] of Object.entries(data)) {
                console.log(`${k} :\n${v}`);
            }
        }
        console.log('-----------------------------------');
        
        this.steps.push({ time: new Date(), step: `STEP${stepNum}`, node: name, ...data });
    }

    end() {
        console.log(`✅ [END] ${this.processName}\n===================================\n`);
        return this.steps;
    }
}

// ============================================================================
// CORE SCRAPER FUNCTIONS
// ============================================================================

async function fetchWithRetry(url, audit, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const ua = getRandomUserAgent();
            const res = await axios.get(url, {
                headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
                httpsAgent,
                timeout: 10000
            });
            if (res.status === 200) return res.data;
        } catch (error) {
            const errCode = error.response ? error.response.status : error.code;
            if (i === retries - 1) throw new Error(`Fallito dopo ${retries} tentativi. Errore: ${errCode}`);
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
        }
    }
}

async function findPlayerPage(playerName, audit) {
    audit.node('Ricerca Player ID', { player: playerName });
    // Usiamo una ricerca mirata per trovare il link di Tennis-DB
    const query = `site:tennis-db.com "${playerName}"`;
    try {
        const ddgRes = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}&kl=&df=`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': getRandomUserAgent() },
            httpsAgent
        });
        const $ = cheerio.load(ddgRes.data);
        let playerUrl = null;
        $('a.result-link').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('tennis-db.com/player') && !href.includes('matches')) {
                playerUrl = href.replace('http://', 'https://');
                return false; 
            }
        });
        if (playerUrl) {
            // Assicuriamoci di puntare alla pagina dei match
            if (!playerUrl.endsWith('/matches')) playerUrl += '/matches';
            audit.node('Player ID Trovato', { url: playerUrl });
            return playerUrl;
        }
    } catch (e) {
        audit.node('Errore Ricerca', { error: e.message });
    }
    return null;
}

async function scrapePlayerMatches(playerUrl, season, audit) {
    audit.node('Opening', { url: `${playerUrl}?season=${season}` });
    try {
        // Aggiungiamo season via query parameter, che è il comportamento standard dei DB
        const html = await fetchWithRetry(`${playerUrl}?season=${season}`, audit);
        audit.node('Page Loaded', { status: 'OK' });

        const $ = cheerio.load(html);
        const matches = [];

        // Parsing della Tabella Ufficiale
        $('table tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 7) { 
                // Assumendo la struttura tipica: Date | Tournament | Category | Round | Surface | Score | Winner | Loser
                matches.push({
                    date: $(cols[0]).text().trim(),
                    tournament: $(cols[1]).text().trim(),
                    category: $(cols[2]).text().trim(),
                    round: $(cols[3]).text().trim(),
                    surface: $(cols[4]).text().trim(),
                    winner: $(cols[5]).text().trim(),
                    score: $(cols[6]).text().trim(),
                    loser: $(cols[7] ? cols[7] : cols[5]).text().trim() // Fallback dinamico a seconda di come espone il loser
                });
            }
        });

        audit.node('Table Read', { rows_found: matches.length });
        return matches;
    } catch (error) {
        audit.node('Error Parsing Table', { error: error.message });
        return [];
    }
}

// ============================================================================
// GESTIONE CACHE E RICERCA
// ============================================================================

function getPlayerCacheDir(playerName, season) {
    const slug = normalizeNameForUrl(playerName);
    const dir = path.join(__dirname, '..', 'cache', 'tennis_db', slug, String(season));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function getOrFetchPlayerSeason(playerName, season, audit) {
    const cacheDir = getPlayerCacheDir(playerName, season);
    const cacheFile = path.join(cacheDir, 'season_data.json');

    if (fs.existsSync(cacheFile)) {
        const stats = fs.statSync(cacheFile);
        const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        if (ageHours < 24) {
            audit.node('Cache Local Loaded', { file: cacheFile });
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }
    }

    const playerUrl = await findPlayerPage(playerName, audit);
    if (!playerUrl) return [];

    const matches = await scrapePlayerMatches(playerUrl, season, audit);
    if (matches.length > 0) {
        fs.writeFileSync(cacheFile, JSON.stringify(matches, null, 2));
        audit.node('Saved to Cache', { file: cacheFile, status: 'OK' });
    }
    return matches;
}

async function findMatchInTennisDb(p1, p2, dateStr) {
    const audit = new AuditNode('Tennis-DB Dedicated Scraper');
    
    // Identifica la season (es. 2026)
    let season = new Date().getFullYear();
    if (dateStr) {
        const match = dateStr.match(/\d{4}/);
        if (match) season = match[0];
    }

    audit.node('Prediction Received', {
        'Player A': p1,
        'Player B': p2,
        'Season': season,
        'Date Target': dateStr
    });

    const matches = await getOrFetchPlayerSeason(p1, season, audit);

    if (matches.length === 0) {
        audit.node('No Matches Found', { action: 'Abort' });
        audit.end();
        return null;
    }

    audit.node('Searching Opponent', { target: p2 });
    
    // Cerca l'avversario nella lista dei match
    const p2Slug = normalizeNameForUrl(p2).split('-')[0]; // Prendi almeno un pezzo del cognome
    const foundMatch = matches.find(m => 
        m.winner.toLowerCase().includes(p2Slug) || m.loser.toLowerCase().includes(p2Slug) ||
        m.score.toLowerCase().includes(p2Slug) // a volte il nome è nel text
    );

    if (foundMatch) {
        audit.node('Match Found', {
            Winner: foundMatch.winner,
            Loser: foundMatch.loser,
            Score: foundMatch.score,
            Tournament: foundMatch.tournament
        });
        
        let finalWinner = null;
        if (foundMatch.winner.toLowerCase().includes(normalizeNameForUrl(p1).split('-')[0])) finalWinner = 1;
        if (foundMatch.winner.toLowerCase().includes(p2Slug)) finalWinner = 2;

        audit.end();
        return {
            winner: finalWinner,
            winnerName: foundMatch.winner,
            totalGames: null, // Si può estrarre parsando lo score se necessario
            isVoid: /ret|w\/o|walkover|canc/i.test(foundMatch.score),
            score: foundMatch.score,
            source: 'SCRAPER_TENNIS_DB',
            note: `Risolto da Tennis-DB Cache: ${foundMatch.score}`
        };
    }

    audit.node('Match NOT Found', { reason: 'Opponent not in table' });
    audit.end();
    return null;
}

module.exports = {
    findMatchInTennisDb
};