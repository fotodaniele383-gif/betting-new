'use strict';

const taxonomy = require('./tennisDeepScanTaxonomyPatch40');
const VERSION = 'TENNIS_TRADING_REPORTING_TRUTH_V1_PATCH40';
const DATA_MODE = 'CURRENT_ACTIVE_HISTORY';
const FULL_SCOPE = 'FULL_ACTIVE_CURRENT_HISTORY';
const ROLLING_SCOPE = 'ROLLING_LAST_200_ACTIVE_CURRENT';

function strictNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * p) / p;
}
function upper(value) { return String(value || '').toUpperCase(); }
function isTennis(row = {}) {
  return upper(row.sport_type) === 'TENNIS' || upper(row.bet_type).includes('TENNIS') || upper(row.strategy_tag).includes('TENNIS');
}
function isCurrent(row = {}) { return ['CURRENT', 'CURRENT_BOOTSTRAP'].includes(upper(row.data_quality)); }
function isActive(row = {}) { return Number(row.paper_result_active == null ? 1 : row.paper_result_active) === 1 && Number(row.paper_result_conflict || 0) !== 1; }
function isSingle(row = {}) { return !upper(row.bet_type).includes('MULTI_'); }
function isResolved(row = {}) { return ['WON', 'LOST'].includes(upper(row.status)); }
function validOdd(row = {}) { const n = strictNumber(row.odd); return n !== null && n > 1 ? n : null; }
function rowProfit(row = {}) { return strictNumber(row.profit) ?? 0; }
function rowStake(row = {}) { return Math.max(0, strictNumber(row.stake ?? row.invested) ?? 0); }
function pct(num, den) { return den > 0 ? round((num / den) * 100, 2) : null; }

function filterRows(rows = []) {
  return rows.filter(row => isTennis(row) && isCurrent(row) && isActive(row) && isSingle(row));
}

function calibrationBands(rows = []) {
  const definitions = [
    { code: 'LE_55', label: '≤55%', min: -Infinity, max: 55 },
    { code: '55_65', label: '55–65%', min: 55, max: 65 },
    { code: '65_75', label: '65–75%', min: 65, max: 75 },
    { code: '75_85', label: '75–85%', min: 75, max: 85 },
    { code: 'GT_85', label: '>85%', min: 85, max: Infinity }
  ];
  return definitions.map(def => {
    const selected = rows.filter(row => {
      const p = strictNumber(row.estimated_prob);
      return p !== null && p > def.min && p <= def.max;
    });
    const n = selected.length;
    const wins = selected.filter(row => upper(row.status) === 'WON').length;
    const avgProbability = n ? selected.reduce((sum, row) => sum + strictNumber(row.estimated_prob), 0) / n : null;
    const hitRate = n ? wins / n * 100 : null;
    const brier = n ? selected.reduce((sum, row) => {
      const p = strictNumber(row.estimated_prob) / 100;
      const y = upper(row.status) === 'WON' ? 1 : 0;
      return sum + ((p - y) ** 2);
    }, 0) / n : null;
    return {
      ...def,
      sample: n,
      wins,
      losses: n - wins,
      hitRatePct: hitRate === null ? null : round(hitRate, 2),
      avgProbabilityPct: avgProbability === null ? null : round(avgProbability, 2),
      calibrationGapPp: avgProbability === null || hitRate === null ? null : round(avgProbability - hitRate, 2),
      brier: brier === null ? null : round(brier, 4)
    };
  });
}

function clvMetrics(settled = []) {
  const eligible = settled.filter(row => validOdd(row) !== null);
  const verified = eligible.filter(row => {
    const close = strictNumber(row.closing_odd);
    return Number(row.clv_verified || 0) === 1 && Number(row.closing_line_available || 0) === 1 && close !== null && close > 1;
  });
  const beaten = verified.filter(row => {
    const edge = strictNumber(row.clv_edge ?? row.clv_pct);
    if (edge !== null) return edge > 0;
    const open = validOdd(row);
    const close = strictNumber(row.closing_odd);
    return open !== null && close !== null && open > close;
  });
  return {
    eligible: eligible.length,
    verified: verified.length,
    missing: Math.max(0, eligible.length - verified.length),
    beaten: beaten.length,
    coveragePct: pct(verified.length, eligible.length),
    beatenPct: pct(beaten.length, verified.length),
    denominatorPolicy: 'verified=clv_verified+closing_line_available+valid opening/closing odds',
    noRetroactiveReconstruction: true
  };
}

function groupMetrics(rows, getter) {
  const groups = new Map();
  for (const row of rows) {
    const key = getter(row);
    if (!groups.has(key)) groups.set(key, { category: key, signalPlaced: 0, signalWon: 0, signalLost: 0, operationalPlaced: 0, operationalWon: 0, operationalLost: 0, stake: 0, profit: 0, counterfactualAudit: 0 });
    const g = groups.get(key);
    g.signalPlaced += 1;
    if (upper(row.status) === 'WON') g.signalWon += 1; else g.signalLost += 1;
    const stake = rowStake(row);
    if (stake > 0) {
      g.operationalPlaced += 1;
      g.stake += stake;
      g.profit += rowProfit(row);
      if (upper(row.status) === 'WON') g.operationalWon += 1; else g.operationalLost += 1;
    } else g.counterfactualAudit += 1;
  }
  return Array.from(groups.values()).map(g => ({
    ...g,
    stake: round(g.stake, 2),
    profit: round(g.profit, 2),
    signalHitRatePct: pct(g.signalWon, g.signalPlaced),
    operationalHitRatePct: pct(g.operationalWon, g.operationalPlaced),
    operationalRoiPct: pct(g.profit, g.stake)
  })).sort((a, b) => b.signalPlaced - a.signalPlaced || a.category.localeCompare(b.category));
}

function qualityLabel(row = {}) {
  const text = upper(row.quality_final_label || row.quality_final_code || row.pre_match_gate_label || row.professional_gate_status);
  if (text.includes('HARD')) return 'BLOCCATA HARD';
  if (text.includes('SOFT')) return 'BLOCCATA SOFT';
  if (text.includes('WATCHLIST')) return 'WATCHLIST MICRO';
  if (text.includes('WITH_CAP') || text.includes('CON CAP')) return 'APPROVATA CON CAP';
  if (text.includes('APPROV')) return 'APPROVATA';
  return 'NON CLASSIFICATA';
}

function calculateScope(rows = [], scopeCode = FULL_SCOPE) {
  const clean = filterRows(rows);
  const settled = clean.filter(isResolved);
  const operational = settled.filter(row => rowStake(row) > 0);
  const paperAudit = settled.filter(row => rowStake(row) <= 0);
  const wins = settled.filter(row => upper(row.status) === 'WON').length;
  const opWins = operational.filter(row => upper(row.status) === 'WON').length;
  const invested = operational.reduce((sum, row) => sum + rowStake(row), 0);
  const profit = operational.reduce((sum, row) => sum + rowProfit(row), 0);
  const flatEligible = settled.filter(row => validOdd(row) !== null);
  const flatProfit = flatEligible.reduce((sum, row) => sum + (upper(row.status) === 'WON' ? validOdd(row) - 1 : -1), 0);
  const edgeValues = operational.map(row => strictNumber(row.edge_pp ?? row.edge)).filter(v => v !== null);
  const evValues = operational.map(row => strictNumber(row.ev_pct)).filter(v => v !== null);
  return {
    version: VERSION,
    dataMode: DATA_MODE,
    scope: scopeCode,
    rowCount: clean.length,
    statusCounts: clean.reduce((acc, row) => { const s = upper(row.status) || 'UNKNOWN'; acc[s] = (acc[s] || 0) + 1; return acc; }, {}),
    signal: {
      placed: settled.length,
      won: wins,
      lost: settled.length - wins,
      hitRatePct: pct(wins, settled.length),
      description: 'Tutti i segnali WON/LOST attivi; non è ROI monetario.'
    },
    operational: {
      placed: operational.length,
      won: opWins,
      lost: operational.length - opWins,
      hitRatePct: pct(opWins, operational.length),
      stake: round(invested, 2),
      profit: round(profit, 2),
      roiPct: pct(profit, invested),
      description: 'Solo WON/LOST con stake reale > 0.'
    },
    paperAudit: { rows: paperAudit.length, description: 'Stake 0: segnale/counterfactual, escluso dal ROI reale.' },
    theoreticalFlat: {
      placed: flatEligible.length,
      won: flatEligible.filter(row => upper(row.status) === 'WON').length,
      unitsInvested: flatEligible.length,
      unitsProfit: round(flatProfit, 2),
      roiPct: pct(flatProfit, flatEligible.length),
      description: 'Una unità teorica su ogni segnale con quota valida; non rappresenta denaro realmente giocato.'
    },
    clv: clvMetrics(settled),
    avgEdgePp: edgeValues.length ? round(edgeValues.reduce((a, b) => a + b, 0) / edgeValues.length, 2) : null,
    avgEvPct: evValues.length ? round(evValues.reduce((a, b) => a + b, 0) / evValues.length, 2) : null,
    calibrationBands: calibrationBands(settled),
    deepScan: groupMetrics(settled, row => taxonomy.normalize(row).label),
    quality: groupMetrics(settled, qualityLabel)
  };
}

function buildReporting(rows = [], options = {}) {
  const clean = filterRows(rows).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  const rollingLimit = Math.max(1, Math.trunc(Number(options.rollingLimit || 200)));
  return {
    version: VERSION,
    dataMode: DATA_MODE,
    generatedAt: options.generatedAt || new Date().toISOString(),
    full: calculateScope(clean, FULL_SCOPE),
    rolling: calculateScope(clean.slice(0, rollingLimit), ROLLING_SCOPE),
    rollingLimit,
    safeguards: {
      activeRowsOnly: true,
      currentDataOnly: true,
      inactiveDuplicatesExcluded: true,
      operationalRoiStakePositiveOnly: true,
      paperSignalSeparated: true,
      clvDenominatorExplicit: true
    }
  };
}

function queryRows(db, leagueFilter = 'all') {
  let sql = `SELECT * FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%') AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')`;
  const params = [];
  if (leagueFilter && String(leagueFilter).toLowerCase() !== 'all') { sql += ' AND LOWER(COALESCE(league,\'\')) LIKE ?'; params.push(`%${String(leagueFilter).toLowerCase()}%`); }
  sql += ' ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

function buildDbReporting(db, leagueFilter = 'all', options = {}) {
  const rows = queryRows(db, leagueFilter).map(taxonomy.decorateRow);
  const inactiveDuplicates = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=0 AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`).get().n || 0);
  return { ...buildReporting(rows, options), inactiveDuplicates, rows };
}

function legacySingles(scope) {
  return {
    placed: scope.operational.placed,
    won: scope.operational.won,
    lost: scope.operational.lost,
    push: Number(scope.statusCounts.PUSH || 0),
    void: Number(scope.statusCounts.VOID || 0),
    invested: scope.operational.stake,
    profit: scope.operational.profit,
    roi: scope.operational.roiPct == null ? '0.00' : scope.operational.roiPct.toFixed(2),
    hit_rate: scope.operational.hitRatePct == null ? '0.00' : scope.operational.hitRatePct.toFixed(2),
    clv_efficiency: scope.clv.beatenPct == null ? 'N/D' : scope.clv.beatenPct.toFixed(1),
    clv_coverage: scope.clv.coveragePct == null ? '0.0' : scope.clv.coveragePct.toFixed(1),
    clv_verified: scope.clv.verified,
    clv_eligible: scope.clv.eligible,
    clv_missing: scope.clv.missing,
    avg_edge_pp: scope.avgEdgePp,
    avg_ev_pct: scope.avgEvPct
  };
}

module.exports = {
  VERSION, DATA_MODE, FULL_SCOPE, ROLLING_SCOPE,
  strictNumber, isTennis, isCurrent, isActive, isResolved, filterRows,
  calibrationBands, calculateScope, buildReporting, buildDbReporting, queryRows, legacySingles
};
