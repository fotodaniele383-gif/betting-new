#!/usr/bin/env node
/*
 * Step49C/Step50A diagnostic - The Odds API Tennis totals probe.
 * Non modifica DB o settings. Salva un JSON in audit_out/tennis_totals_feed_probe.json.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SERVER_TENNIS = path.resolve(ROOT, 'backend', 'server.tennis.js');
const AUDIT_DIR = path.resolve(ROOT, 'audit_out');
const OUT = path.resolve(AUDIT_DIR, 'tennis_totals_feed_probe.json');

function readApiKeys() {
  const envKeys = String(process.env.ODDS_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (envKeys.length) return { source: 'ODDS_API_KEYS', keys: envKeys };

  // Fallback: usa le chiavi legacy già presenti nel progetto locale, senza stamparle.
  try {
    const src = fs.readFileSync(SERVER_TENNIS, 'utf8');
    const match = src.match(/const\s+LEGACY_API_KEYS\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return { source: 'NONE', keys: [] };
    const keys = Array.from(match[1].matchAll(/'([a-f0-9]{32,})'/gi)).map(m => m[1]);
    return { source: 'LEGACY_API_KEYS_FROM_SERVER_TENNIS', keys };
  } catch (_) {
    return { source: 'NONE', keys: [] };
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = { parseError: e.message, raw: data.slice(0, 500) }; }
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.payload = parsed;
          reject(err);
          return;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
      });
    }).on('error', reject);
  });
}

function marketSummary(events = []) {
  const summary = {
    events: events.length,
    bookmakers: 0,
    h2hEvents: 0,
    totalsEvents: 0,
    totalsBookmakers: 0,
    marketsFound: {},
    totalsLines: {},
    examples: []
  };

  for (const event of events) {
    let hasH2h = false;
    let hasTotals = false;
    for (const bookmaker of event.bookmakers || []) {
      summary.bookmakers += 1;
      for (const market of bookmaker.markets || []) {
        const key = String(market.key || 'unknown');
        summary.marketsFound[key] = (summary.marketsFound[key] || 0) + 1;
        if (key === 'h2h') hasH2h = true;
        if (key === 'totals') {
          hasTotals = true;
          summary.totalsBookmakers += 1;
          for (const outcome of market.outcomes || []) {
            if (outcome.point !== undefined && outcome.point !== null) {
              const line = String(outcome.point);
              summary.totalsLines[line] = (summary.totalsLines[line] || 0) + 1;
            }
          }
          if (summary.examples.length < 5) {
            summary.examples.push({
              event: `${event.home_team || event.away_team || event.id || 'unknown'}${event.home_team && event.away_team ? ' - ' + event.away_team : ''}`,
              commence_time: event.commence_time,
              bookmaker: bookmaker.key || bookmaker.title || bookmaker.name,
              outcomes: (market.outcomes || []).slice(0, 6).map(o => ({ name: o.name, point: o.point, price: o.price }))
            });
          }
        }
      }
    }
    if (hasH2h) summary.h2hEvents += 1;
    if (hasTotals) summary.totalsEvents += 1;
  }
  return summary;
}

async function main() {
  const { source, keys } = readApiKeys();
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    source,
    apiKeyConfigured: keys.length > 0,
    requestPlan: {
      sportsEndpoint: '/v4/sports',
      oddsMarkets: 'h2h,totals',
      regionsTried: ['eu,uk', 'eu,uk,us,au'],
      oddsFormat: 'decimal'
    },
    sports: [],
    conclusion: null,
    errors: []
  };

  if (!keys.length) {
    result.conclusion = 'NO_API_KEY: configura ODDS_API_KEYS o mantieni LEGACY_API_KEYS in backend/server.tennis.js.';
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  let keyIndex = 0;
  async function fetchWithKeys(urlTemplate) {
    let lastErr = null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[keyIndex];
      try {
        const url = urlTemplate.replace('API_KEY_PLACEHOLDER', encodeURIComponent(key));
        return await getJson(url);
      } catch (err) {
        lastErr = err;
        if ([401, 403, 429].includes(err.statusCode)) {
          keyIndex = (keyIndex + 1) % keys.length;
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error('Nessuna chiave valida');
  }

  const sportsResp = await fetchWithKeys('https://api.the-odds-api.com/v4/sports/?apiKey=API_KEY_PLACEHOLDER');
  const tennisSports = (sportsResp.data || []).filter(s => s.group === 'Tennis' && (String(s.key).includes('atp') || String(s.key).includes('wta')));

  for (const sport of tennisSports) {
    const entry = { key: sport.key, title: sport.title, active: sport.active, attempts: [] };
    for (const regions of ['eu,uk', 'eu,uk,us,au']) {
      try {
        const oddsResp = await fetchWithKeys(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport.key)}/odds/?apiKey=API_KEY_PLACEHOLDER&regions=${regions}&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`);
        entry.attempts.push({ regions, ok: true, remaining: oddsResp.headers['x-requests-remaining'] || null, used: oddsResp.headers['x-requests-used'] || null, summary: marketSummary(Array.isArray(oddsResp.data) ? oddsResp.data : []) });
      } catch (err) {
        entry.attempts.push({ regions, ok: false, error: err.message, statusCode: err.statusCode || null, payload: err.payload || null });
      }
    }
    result.sports.push(entry);
  }

  const totalsEvents = result.sports.flatMap(s => s.attempts || []).filter(a => a.ok).reduce((sum, a) => sum + (a.summary?.totalsEvents || 0), 0);
  const h2hEvents = result.sports.flatMap(s => s.attempts || []).filter(a => a.ok).reduce((sum, a) => sum + (a.summary?.h2hEvents || 0), 0);
  if (totalsEvents > 0) {
    result.conclusion = `TOTALS_AVAILABLE: il provider attuale restituisce totals su ${totalsEvents} eventi Tennis. Se in UI non compaiono, il problema è parser/gate/selezione.`;
  } else if (h2hEvents > 0) {
    result.conclusion = `TOTALS_NOT_RETURNED: il provider ha restituito h2h (${h2hEvents} eventi) ma nessun totals. Verificare piano/region/bookmakers oppure provider secondario.`;
  } else {
    result.conclusion = 'NO_TENNIS_EVENTS_OR_ODDS: nessun evento Tennis con quote nel momento del probe.';
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nOutput salvato: ${OUT}`);
}

main().catch(err => {
  const payload = { generatedAt: new Date().toISOString(), error: err.message, statusCode: err.statusCode || null, payload: err.payload || null };
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
