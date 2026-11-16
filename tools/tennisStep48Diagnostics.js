#!/usr/bin/env node
/**
 * BettingApp Tennis Step48 Diagnostics
 * Verifica market mix, gate, BLOCCATA con stake/profit e separazione trading reale/counterfactual.
 *
 * Esecuzione dalla root:
 *   node tools/tennisStep48Diagnostics.js
 */
const fs = require('fs');
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('better-sqlite3 non disponibile. Esegui npm install nella root del progetto.');
  process.exit(1);
}

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'audit_out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
if (!fs.existsSync(dbPath)) {
  console.error(`DB non trovato: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

function hasCol(cols, name) { return cols.includes(name); }

function q(value) { return String(value || '').replace(/'/g, "''"); }

function inferMarket(row) {
  const s = `${row.market_type || ''} ${row.prediction || ''} ${row.strategy_tag || ''} ${row.bet_type || ''}`.toUpperCase();
  if (s.includes('OVER')) return 'OVER';
  if (s.includes('UNDER')) return 'UNDER';
  if (s.includes('TOTAL')) return 'TOTALS';
  return 'MONEYLINE';
}

function inferGate(row) {
  const s = `${row.tennis_operational_status || ''} ${row.professional_gate_status || ''} ${row.ds_action || ''}`.toUpperCase();
  if (s.includes('BLOCCATA VERA')) return 'BLOCCATA_VERA';
  if (s.includes('BLOCCATA') || s.includes('NO_BET') || row.professional_gate_allow_bet === 0) return 'BLOCCATA';
  if (s.includes('WATCHLIST') || s.includes('MICRO')) return 'WATCHLIST_MICRO';
  if (s.includes('APPROVATA')) return 'APPROVATA_CON_CAP';
  return 'UNKNOWN';
}

function hasOperationalGate(row) {
  return Boolean(
    row.professional_gate_status ||
    row.tennis_operational_status ||
    row.tennis_operational_action ||
    row.professional_gate_allow_bet !== undefined && row.professional_gate_allow_bet !== null
  );
}

function isOperationalRealTrading(row) {
  const stake = Number(row.stake || 0);
  const gate = inferGate(row);
  if (!hasOperationalGate(row)) return false;
  if (gate === 'BLOCCATA' || gate === 'BLOCCATA_VERA') return false;
  return Number.isFinite(stake) && stake > 0;
}

if (!tableExists('ai_forward_test')) {
  console.error('Tabella ai_forward_test non trovata.');
  process.exit(1);
}

const cols = columns('ai_forward_test');
const selectCols = [
  'id','sport_type','bet_type','strategy_tag','prediction','status','stake','profit',
  'data_quality','market_type','point_line','professional_gate_status',
  'professional_gate_allow_bet','tennis_operational_status','tennis_operational_action',
  'estimated_prob','edge_pp','ev_pct','odd','home_team','away_team','match_date'
].filter(c => hasCol(cols, c));

const rows = db.prepare(`
  SELECT ${selectCols.join(', ')}
  FROM ai_forward_test
  WHERE (
    UPPER(COALESCE(sport_type,''))='TENNIS'
    OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
    OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
    OR UPPER(COALESCE(prediction,'')) LIKE '%UNDER%'
    OR UPPER(COALESCE(prediction,'')) LIKE '%OVER%'
  )
`).all();

const clean = rows.filter(r => ['CURRENT','CURRENT_BOOTSTRAP'].includes(String(r.data_quality || '').toUpperCase()));
const currentSettled = clean.filter(r => ['WON','LOST'].includes(String(r.status || '').toUpperCase()));
const pending = clean.filter(r => String(r.status || '').toUpperCase() === 'PENDING');

function summarize(list) {
  const out = {
    rows: list.length,
    markets: {},
    gates: {},
    statuses: {},
    stakeTotal: 0,
    profitTotal: 0,
    realTradingRows: 0,
    realTradingStake: 0,
    realTradingProfit: 0,
    counterfactualRows: 0,
    legacyNoGateRows: [],
    anomalies: []
  };
  for (const r of list) {
    const market = inferMarket(r);
    const gate = inferGate(r);
    const status = String(r.status || 'UNKNOWN').toUpperCase();
    const stake = Number(r.stake || 0);
    const profit = Number(r.profit || 0);
    out.markets[market] = (out.markets[market] || 0) + 1;
    out.gates[gate] = (out.gates[gate] || 0) + 1;
    out.statuses[status] = (out.statuses[status] || 0) + 1;
    out.stakeTotal += Number.isFinite(stake) ? stake : 0;
    out.profitTotal += Number.isFinite(profit) ? profit : 0;

    if (isOperationalRealTrading(r)) {
      out.realTradingRows += 1;
      out.realTradingStake += Number.isFinite(stake) ? stake : 0;
      out.realTradingProfit += Number.isFinite(profit) ? profit : 0;
    } else {
      out.counterfactualRows += 1;
    }

    if (!hasOperationalGate(r) && (stake > 0 || Math.abs(profit) > 0.0001)) {
      out.legacyNoGateRows.push({
        id: r.id,
        match: `${r.home_team || ''} - ${r.away_team || ''}`.trim(),
        prediction: r.prediction,
        status,
        market,
        stake,
        profit,
        reason: 'CURRENT_BOOTSTRAP con stake/profit ma senza gate operativo: escludere dal trading reale, usare solo audit/counterfactual.'
      });
    }

    if ((gate === 'BLOCCATA' || gate === 'BLOCCATA_VERA') && (stake > 0 || Math.abs(profit) > 0.0001)) {
      out.anomalies.push({
        id: r.id,
        match: `${r.home_team || ''} - ${r.away_team || ''}`.trim(),
        prediction: r.prediction,
        status,
        gate,
        market,
        stake,
        profit,
        reason: 'BLOCCATA con stake/profit: deve essere counterfactual o legacy, non trading reale.'
      });
    }
  }
  out.stakeTotal = Number(out.stakeTotal.toFixed(2));
  out.profitTotal = Number(out.profitTotal.toFixed(2));
  out.realTradingStake = Number(out.realTradingStake.toFixed(2));
  out.realTradingProfit = Number(out.realTradingProfit.toFixed(2));
  out.realTradingRoi = out.realTradingStake > 0 ? Number(((out.realTradingProfit / out.realTradingStake) * 100).toFixed(2)) : null;
  return out;
}

const result = {
  generatedAt: new Date().toISOString(),
  dbPath,
  totalTennisRows: rows.length,
  cleanRows: clean.length,
  pending: summarize(pending),
  currentSettled: summarize(currentSettled),
  allClean: summarize(clean),
  recommendations: []
};

if ((result.pending.markets.OVER || 0) + (result.pending.markets.UNDER || 0) + (result.pending.markets.TOTALS || 0) === 0) {
  result.recommendations.push('P0: nessun totals pending. Verificare raw feed bookmaker, parsing totals, Markov gate e soglie market_type.');
}
if (result.currentSettled.anomalies.length > 0 || result.allClean.anomalies.length > 0) {
  result.recommendations.push('P0: esistono BLOCCATE con stake/profit. Separare Trading Reale da Counterfactual/Legacy e correggere aggregati ROI.');
}
if (result.currentSettled.legacyNoGateRows.length > 0 || result.allClean.legacyNoGateRows.length > 0) {
  result.recommendations.push('P0: esistono righe CURRENT_BOOTSTRAP con stake/profit ma senza gate operativo. Escluderle dal ROI reale Tennis e mostrarle come counterfactual/audit.');
}
if (currentSettled.length < 50) {
  result.recommendations.push(`P1: sample settled clean ${currentSettled.length}/50, calibrazione ancora debole.`);
}

const jsonPath = path.join(OUT_DIR, 'tennis_step48_diagnostics.json');
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');

const csvPath = path.join(OUT_DIR, 'tennis_step48_blocked_anomalies.csv');
const anomalies = [...result.pending.anomalies, ...result.currentSettled.anomalies, ...result.allClean.anomalies];
const csv = ['scope,id,match,prediction,status,gate,market,stake,profit,reason']
  .concat(anomalies.map(a => ['all',a.id,JSON.stringify(a.match),JSON.stringify(a.prediction),a.status,a.gate,a.market,a.stake,a.profit,JSON.stringify(a.reason)].join(',')))
  .join('\n');
fs.writeFileSync(csvPath, csv, 'utf8');

console.log(JSON.stringify(result, null, 2));
console.log(`\nOutput salvato:\n- ${jsonPath}\n- ${csvPath}`);
