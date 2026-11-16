const axios = require('axios');
const { ODDS_API_KEY } = require('../config/apiKeys');
const apiUsageTracker = require('./apiUsageTracker');

// STEP53_API_EFFICIENCY_CACHE
// Legacy oddsService resta tracciato e cache-aware per evitare chiamate fuori contatore.
async function getOdds() {
    console.log("🕵️ Connessione a The-Odds-API per le quote LIVE...");
    if (!ODDS_API_KEY) return [];
    const urlTemplate = 'https://api.the-odds-api.com/v4/sports/soccer_italy_serie_a/odds/?apiKey=API_KEY_PLACEHOLDER&regions=eu&markets=h2h';
    const source = 'oddsService.js';
    const route = 'getOdds';
    const operation = apiUsageTracker.classifyOddsApiOperation(urlTemplate);
    const cached = apiUsageTracker.getCachedOddsApiResponse(urlTemplate, { source, route });
    if (cached && cached.hit === true) return cached.data;
    const url = urlTemplate.replace('API_KEY_PLACEHOLDER', ODDS_API_KEY);
    apiUsageTracker.registerApiKeyInventory({ source, keyCount: 1 });
    const attempt = apiUsageTracker.recordOddsApiNetworkAttempt({ key: ODDS_API_KEY, source, operation, route, urlTemplate });
    try {
        const response = await axios.get(url);
        apiUsageTracker.recordOddsApiResponse({ attemptId: attempt.attemptId, key: ODDS_API_KEY, source, operation, route, urlTemplate, headers: response.headers, statusCode: response.status, data: response.data });
        const upcomingMatches = [];
        response.data.forEach(match => {
            const bookmaker = match.bookmakers[0]; if (!bookmaker) return;
            const h2h = bookmaker.markets.find(m => m.key === 'h2h'); if (!h2h) return;
            const homeOdds = h2h.outcomes.find(o => o.name === match.home_team)?.price;
            const awayOdds = h2h.outcomes.find(o => o.name === match.away_team)?.price;
            const drawOdds = h2h.outcomes.find(o => o.name === 'Draw')?.price;
            if (homeOdds && awayOdds && drawOdds) upcomingMatches.push({ date: match.commence_time, home: match.home_team, away: match.away_team, home_win: homeOdds, draw: drawOdds, away_win: awayOdds });
        });
        apiUsageTracker.setCachedOddsApiResponse(urlTemplate, upcomingMatches, { source, route });
        console.log(`✅ Trovate quote live per ${upcomingMatches.length} partite imminenti!`);
        return upcomingMatches;
    } catch (error) {
        apiUsageTracker.recordOddsApiFailure({ attemptId: attempt.attemptId, key: ODDS_API_KEY, source, operation, route, urlTemplate, headers: error.response?.headers || {}, statusCode: error.response?.status || 0, errorCode: error.response?.data?.error_code || error.code || error.message });
        console.error("❌ Errore The-Odds-API:", error.message);
        return [];
    }
}
module.exports = { getOdds };
