'use strict';

const VERSION = 'AUDIT16B_CALCIO_HISTORICAL_STATS_CACHE_V1';

function finiteInt(value) { const n = parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
function emptyTeam() { return { hp:0,hs:0,hc:0,hsot:0,hcot:0,ap:0,as:0,ac:0,asot:0,acot:0,recS:[],recC:[],elo:1500,matches:[] }; }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

function createBuilder(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const idx = options.indexes || {};
  const parseDate = options.parseDate;
  const updateElo = options.updateElo;
  const useAdvancedMetrics = options.useAdvancedMetrics === true;
  const eloK = Number(options.eloK || 0);
  if (typeof parseDate !== 'function') throw new Error('AUDIT16B_PARSE_DATE_REQUIRED');
  if (useAdvancedMetrics && typeof updateElo !== 'function') throw new Error('AUDIT16B_UPDATE_ELO_REQUIRED');

  let dateParseCount = 0, buildCount = 0, cacheHits = 0, rowsScanned = 0;
  const prepared = rows.map(cols => {
    dateParseCount++;
    return { cols, rowDate: idx.d > -1 ? parseDate(cols[idx.d]) : null };
  });
  const cache = new Map();

  function build(candidateDate) {
    const validDate = candidateDate instanceof Date && !Number.isNaN(candidateDate.getTime());
    const key = validDate ? String(candidateDate.getTime()) : null;
    if (key && cache.has(key)) {
      cacheHits++;
      const cached = cache.get(key);
      return { teamStats: clone(cached.teamStats), historicalRowsCount: cached.historicalRowsCount, cacheHit: true };
    }

    buildCount++;
    const historical = prepared.filter(entry => entry.rowDate && validDate && entry.rowDate < candidateDate);
    rowsScanned += prepared.length;
    const teamStats = {};
    for (const entry of historical) {
      const cols = entry.cols;
      const h = String(cols[idx.h] || '').trim(), a = String(cols[idx.a] || '').trim();
      if (!h || !a) continue;
      const hg = finiteInt(cols[idx.hg]), ag = finiteInt(cols[idx.ag]);
      const hst = idx.hst > -1 ? finiteInt(cols[idx.hst]) : 0;
      const ast = idx.ast > -1 ? finiteInt(cols[idx.ast]) : 0;
      const hs = idx.hs > -1 ? finiteInt(cols[idx.hs]) : 0;
      const ass = idx.as > -1 ? finiteInt(cols[idx.as]) : 0;
      if (!teamStats[h]) teamStats[h] = emptyTeam();
      if (!teamStats[a]) teamStats[a] = emptyTeam();
      if (useAdvancedMetrics) {
        const e = updateElo(teamStats[h].elo, teamStats[a].elo, hg, ag, eloK);
        teamStats[h].elo = e.newHome; teamStats[a].elo = e.newAway;
      }
      teamStats[h].hp++; teamStats[h].hs += hg; teamStats[h].hc += ag; teamStats[h].hsot += hst; teamStats[h].hcot += ast;
      teamStats[a].ap++; teamStats[a].as += ag; teamStats[a].ac += hg; teamStats[a].asot += ast; teamStats[a].acot += hst;
      teamStats[h].recS.push(hg); teamStats[h].recC.push(ag); teamStats[a].recS.push(ag); teamStats[a].recC.push(hg);
      teamStats[h].matches.push({goalsFor:hg,goalsAgainst:ag,shots:hs,shotsOnTarget:hst,shotsAgainst:ass,shotsOnTargetAgainst:ast});
      teamStats[a].matches.push({goalsFor:ag,goalsAgainst:hg,shots:ass,shotsOnTarget:ast,shotsAgainst:hs,shotsOnTargetAgainst:hst});
      if (teamStats[h].recS.length > 10) { teamStats[h].recS.shift(); teamStats[h].recC.shift(); teamStats[h].matches.shift(); }
      if (teamStats[a].recS.length > 10) { teamStats[a].recS.shift(); teamStats[a].recC.shift(); teamStats[a].matches.shift(); }
    }
    const result = { teamStats, historicalRowsCount: historical.length };
    if (key) cache.set(key, { teamStats: clone(teamStats), historicalRowsCount: historical.length });
    return { ...result, cacheHit: false };
  }

  function diagnostics() {
    return { version:VERSION, preparedRows:prepared.length, dateParseCount, buildCount, cacheHits, uniqueCutoffs:cache.size, rowsScanned };
  }
  return { version:VERSION, build, diagnostics };
}

module.exports = { VERSION, createBuilder };
