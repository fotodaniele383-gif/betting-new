// STEP64_NO_HARDCODED_API_FALLBACK
// Non inserire chiavi reali in questo file. Usa .env / variabili ambiente.
module.exports = {
    ODDS_API_KEY: process.env.ODDS_API_KEY || '',
    API_FOOTBALL_KEY: process.env.API_FOOTBALL_KEY || '',
    ODDS_API_KEYS: String(process.env.ODDS_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
};
