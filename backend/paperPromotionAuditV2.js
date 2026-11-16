
'use strict';

// PAPER PROMOTION V2.1 - HISTORICAL SHADOW AUDIT
// Read-only: no changes to SQLite, server, stakes or V1 state.

const DB = require('better-sqlite3');
const path = require('node:path');

const db = new DB(
  path.join(__dirname, 'database_betting.db'),
  { readonly: true, fileMustExist: true }
);
db.pragma('query_only = ON');

const ts = x =>
  typeof x === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(x) &&
  Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;

const num = x =>
  x === null || x === undefined || x === '' ? null :
  Number.isFinite(Number(x)) ? Number(x) : null;

const state = {
  tennis: { rows: 0, valid: 0, noTime: 0, noDeep: 0, invalidOdd: 0 },
  calcio: {
    rows: 0, valid: 0, noTime: 0, invalidOdd: 0,
    badJson: 0, versions: 0, qualityBlocked: 0,
    qualityStrong: 0, operationalAuthorized: 0,
    coherenceMismatch: 0
  },
  groups: new Map()
};

function add(r) {
  const key = [r.sport, r.league, r.strategy, r.market, r.model || 'MODEL_UNKNOWN'].join(' / ');
  let g = state.groups.get(key);
  if (!g) {
    g = {
      key, development: [], holdout: [], retrospective: [],
      deep: 0, approved: 0, blocked: 0
    };
    state.groups.set(key, g);
  }
  g[r.cohort].push(r);
  g.deep += Number(r.deep);
  g.approved += Number(r.approved);
  g.blocked += Number(r.blocked);
}

// Verify the original Tennis snapshot hash chain.
const verify = require('./tennisPredictionSnapshots')
  .verifyPredictionSnapshotRows(
    db.prepare('SELECT * FROM tennis_prediction_snapshots ORDER BY bet_id,snapshot_sequence').all()
  );

if (!verify.valid) {
  throw Error('TENNIS_HASH_CHAIN_NOT_VALID');
}

// Tennis: settled Development and Holdout with sealed snapshots.
const tennisRows = db.prepare(
  "SELECT a.id,a.league,a.strategy_tag,a.status,c.cohort_role " +
  "FROM ai_forward_test a JOIN tennis_forward_cohort_members c ON c.bet_id=a.id " +
  "WHERE a.sport_type='TENNIS' AND a.stake=0 " +
  "AND a.status IN ('WON','LOST') AND a.settlement_contract_status='VERIFIED' " +
  "AND COALESCE(a.paper_result_active,1)=1 " +
  "AND COALESCE(a.paper_result_conflict,0)=0 " +
  "AND c.cohort_role IN ('DEVELOPMENT','HOLDOUT') AND c.leakage_status='CLEAR'"
).all();

const snaps = db.prepare(
  "SELECT bet_id,snapshot_sequence,is_calibration_anchor,snapshot_status," +
  "captured_at,match_start_at,market_fingerprint,predicted_side," +
  "model_probability_pct,opening_odd,model_version,deep_scan_status,gate_status " +
  "FROM tennis_prediction_snapshots ORDER BY bet_id,snapshot_sequence"
).all();

const byBet = new Map();
for (const s of snaps) {
  if (!byBet.has(s.bet_id)) byBet.set(s.bet_id, []);
  byBet.get(s.bet_id).push(s);
}

for (const r of tennisRows) {
  state.tennis.rows++;
  const ss = byBet.get(r.id) || [];

  const a = ss.find(s =>
    s.is_calibration_anchor === 1 &&
    s.snapshot_status === 'VALID_PREMATCH' &&
    ts(s.captured_at) !== null &&
    ts(s.match_start_at) !== null &&
    ts(s.captured_at) < ts(s.match_start_at)
  );

  if (!a) {
    state.tennis.noTime++;
    continue;
  }

  const odd = num(a.opening_odd);
  const prob = num(a.model_probability_pct);
  if (odd === null || odd <= 1 || prob === null || prob <= 0 || prob >= 100) {
    state.tennis.invalidOdd++;
    continue;
  }

  const ds = ss.filter(s =>
    s.snapshot_status === 'VALID_PREMATCH' &&
    s.market_fingerprint === a.market_fingerprint &&
    s.predicted_side === a.predicted_side &&
    s.deep_scan_status &&
    ts(s.captured_at) !== null &&
    ts(s.captured_at) < ts(a.match_start_at)
  ).at(-1);

  if (!ds) state.tennis.noDeep++;
  state.tennis.valid++;

  add({
    sport: 'TENNIS',
    league: r.league,
    strategy: r.strategy_tag,
    market: r.strategy_tag,
    model: a.model_version,
    cohort: r.cohort_role.toLowerCase(),
    odd,
    prob: prob / 100,
    won: r.status === 'WON' ? 1 : 0,
    deep: !!ds,
    approved: !!ds && String(ds.gate_status || '').startsWith('APPROVED'),
    blocked: !!ds && String(ds.gate_status || '').startsWith('BLOCKED')
  });
}

// Football: retain only the latest qualifying prematch contract.
const football = db.prepare(
  "SELECT a.id,a.league,a.strategy_tag,a.status,a.match_date," +
  "a.prediction,a.market_type,f.snapshot_json,f.created_at " +
  "FROM ai_forward_test a JOIN calcio_final_market_contract_audit_log f " +
  "ON f.bet_id=a.id AND f.prediction=a.prediction " +
  "AND UPPER(f.market_type)=UPPER(a.market_type) " +
  "WHERE a.sport_type='CALCIO' AND a.stake=0 " +
  "AND a.status IN ('WON','LOST') " +
  "AND a.settlement_contract_status='VERIFIED' " +
  "AND COALESCE(a.paper_result_active,1)=1 " +
  "AND COALESCE(a.paper_result_conflict,0)=0 " +
  "ORDER BY a.id,f.created_at DESC,f.id DESC"
).all();

const seen = new Set();

for (const r of football) {
  if (seen.has(r.id)) {
    state.calcio.versions++;
    continue;
  }

  const st = ts(r.match_date);
  const cap = ts(r.created_at);
  if (st === null || cap === null || cap >= st) {
    state.calcio.noTime++;
    continue;
  }

  seen.add(r.id);
  state.calcio.rows++;

  let j;
  try {
    j = JSON.parse(r.snapshot_json);
  } catch (e) {
    state.calcio.badJson++;
    continue;
  }

  const generated = ts(j.generatedAt);
  if (
    generated === null || generated >= st ||
    String(j.prediction) !== String(r.prediction) ||
    String(j.marketType).toUpperCase() !== String(r.market_type).toUpperCase()
  ) {
    state.calcio.coherenceMismatch++;
    continue;
  }

  const odd = num(j.odd);
  const prob = num(j.probabilityPct);
  if (odd === null || odd <= 1 || prob === null || prob <= 0 || prob >= 100) {
    state.calcio.invalidOdd++;
    continue;
  }

  state.calcio.valid++;

  const qualityStrong =
    j.dataQuality?.blocking === false &&
    j.coverageMode === 'HISTORY_PROXY_STRONG';

  const operational = j.decisionState?.operational === true;
  const blocked = !qualityStrong || !operational;

  state.calcio.qualityBlocked += Number(!qualityStrong);
  state.calcio.qualityStrong += Number(qualityStrong);
  state.calcio.operationalAuthorized += Number(operational);

  add({
    sport: 'CALCIO',
    league: r.league,
    strategy: r.strategy_tag,
    market: j.marketType || r.market_type,
    model: 'CONTRACT_' + String(j.version || 'UNKNOWN'),
    cohort: 'retrospective',
    odd,
    prob: prob / 100,
    won: r.status === 'WON' ? 1 : 0,
    deep: false,
    approved: !blocked,
    blocked
  });
}

function metrics(a) {
  if (!a.length) return null;
  const returns = a.map(x => x.won ? x.odd - 1 : -1);
  const mean = returns.reduce((x, y) => x + y, 0) / a.length;
  const brier = a.reduce((x, y) => x + (x.prob - x.won) ** 2, 0) / a.length;
  const marketBrier = a.reduce((x, y) => x + (1 / x.odd - x.won) ** 2, 0) / a.length;

  return {
    n: a.length,
    roiPct: +(mean * 100).toFixed(2),
    brier: +brier.toFixed(4),
    rawMarketBrier: +marketBrier.toFixed(4)
  };
}

const out = [];

for (const g of state.groups.values()) {
  const dev = metrics(g.development);
  const ho = metrics(g.holdout);
  const ret = metrics(g.retrospective);

  out.push({
    gruppo: g.key,
    dev: dev?.n || 0,
    roiDev: dev?.roiPct ?? null,
    holdout: ho?.n || 0,
    roiHoldout: ho?.roiPct ?? null,
    retro: ret?.n || 0,
    roiRetro: ret?.roiPct ?? null,
    deep: g.deep,
    approved: g.approved,
    blocked: g.blocked,
    decision: 'NO_PROMOTION_SHADOW_ONLY'
  });
}

console.log('PAPER PROMOTION V2.1 - SHADOW AUDIT');
console.log('CLV FACOLTATIVO - STORICO SOLA LETTURA');
console.log(JSON.stringify({
  tennis: state.tennis,
  calcio: state.calcio,
  tennisHashChain: true,
  groups: out.length
}, null, 2));

console.table(out.sort((a, b) =>
  b.dev + b.retro - a.dev - a.retro
));

console.log('AUTORITA_STAKE=NO');
console.log('AUTORITA_PROMOZIONE=NO');
console.log('DATABASE_INVARIATO');

db.close();
