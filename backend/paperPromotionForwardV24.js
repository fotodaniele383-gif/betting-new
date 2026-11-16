
'use strict';

// V2.4 - Prospective shadow evidence.
// No DB writes. No operational stake authority.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'paper-promotion-v24-shadow');
const LEDGER = path.join(OUT, 'forward-ledger.jsonl');
const STATUS = path.join(OUT, 'status.json');
const V23 = path.join(ROOT, 'paper-promotion-v23-shadow', 'status.json');

const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const hash = x => digest(JSON.stringify(x));
const check = (ok, why) => { if (!ok) throw Error(why); };

const time = x =>
  typeof x === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(x) &&
  Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;

const val = x =>
  x !== null && x !== undefined && x !== '' &&
  Number.isFinite(Number(x)) ? Number(x) : null;

const norm = x => String(x || '').trim();
const nonempty = x => typeof x === 'string' && x.trim().length > 0;

function readV23() {
  const wrap = JSON.parse(fs.readFileSync(V23, 'utf8'));
  check(wrap.payload && wrap.sha256 === hash(wrap.payload), 'V23_HASH_INVALID');

  const p = wrap.payload;
  check(
    p.version === 'PAPER_PROMOTION_V23_SHADOW' &&
    p.futureStakeAuthority === false &&
    p.executionIntegrated === false &&
    p.tennisHashChain === true &&
    Array.isArray(p.groups),
    'V23_POLICY_INVALID'
  );

  const age = Date.now() - time(p.at);
  check(
    Number.isFinite(age) && age >= -60000 && age < 25 * 60000,
    'V23_STALE_RUN_V23_FIRST'
  );

  const ledgerFile = path.join(
    ROOT, 'paper-promotion-v23-shadow', 'transitions.jsonl'
  );
  const raw = fs.readFileSync(ledgerFile, 'utf8');
  check(raw.endsWith('\n'), 'V23_LEDGER_TRUNCATED');

  let previous = 'GENESIS', count = 0;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);

    check(
      r.previous === previous &&
      r.sha256 === hash({
        previous: r.previous,
        key: r.key,
        from: r.from,
        to: r.to,
        at: r.at
      }),
      'V23_LEDGER_INVALID'
    );

    previous = r.sha256;
    count++;
  }

  check(
    p.ledgerHead === previous && p.ledgerEntries === count,
    'V23_LEDGER_NOT_RECONCILED'
  );

  return p;
}

function loadLedger() {
  const captures = new Map();
  const settles = new Map();
  const eventKeys = new Set();
  let head = 'GENESIS', lines = 0;

  if (!fs.existsSync(LEDGER))
    return { captures, settles, eventKeys, head, lines };

  const raw = fs.readFileSync(LEDGER, 'utf8');
  check(raw === '' || raw.endsWith('\n'), 'LEDGER_TRUNCATED');

  for (const line of raw.split('\n')) {
    if (!line) continue;

    const r = JSON.parse(line);
    const body = {
      prev: r.prev,
      type: r.type,
      id: r.id,
      at: r.at,
      data: r.data
    };

    check(
      r.prev === head && r.sha256 === hash(body),
      'LEDGER_CHAIN_INVALID'
    );

    check(
      ['CAPTURE', 'SETTLE'].includes(r.type) &&
      nonempty(r.id) && time(r.at) !== null,
      'LEDGER_RECORD_INVALID'
    );

    if (r.type === 'CAPTURE') {
      check(
        !captures.has(r.id) &&
        !eventKeys.has(r.data.eventKey) &&
        time(r.data.firstSeen) === time(r.at),
        'LEDGER_DUPLICATE_CAPTURE'
      );
      captures.set(r.id, r.data);
      eventKeys.add(r.data.eventKey);
    } else {
      check(
        captures.has(r.id) &&
        !settles.has(r.id) &&
        ['WON', 'LOST'].includes(r.data.result) &&
        nonempty(r.data.settlementHash),
        'LEDGER_SETTLE_ORDER'
      );
      settles.set(r.id, r.data);
    }

    head = r.sha256;
    lines++;
  }

  return { captures, settles, eventKeys, head, lines };
}

function saveEntries(state, items) {
  if (!items.length) return state;

  let head = state.head;
  const rows = [];

  for (const item of items) {
    const body = {
      prev: head,
      type: item.type,
      id: item.id,
      at: item.at,
      data: item.data
    };
    const r = { ...body, sha256: hash(body) };
    rows.push(r);
    head = r.sha256;
  }

  const fd = fs.openSync(LEDGER, 'a');
  try {
    fs.writeSync(
      fd,
      rows.map(r => JSON.stringify(r)).join('\n') + '\n'
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return loadLedger();
}

function openingValid(odd, prob) {
  return odd !== null && odd > 1 && odd <= 15 &&
    prob !== null && prob > 0 && prob < 1;
}

function tennisPending(db, now) {
  const by = new Map(), seenAnchors = new Set();

  const rows = db.prepare(
    "SELECT a.id,a.league,a.strategy_tag," +
    "s.snapshot_id,s.snapshot_hash,s.snapshot_status," +
    "s.is_calibration_anchor,s.snapshot_sequence," +
    "s.captured_at,s.match_start_at,s.event_fingerprint," +
    "s.market_fingerprint,s.predicted_side,s.opening_odd," +
    "s.model_probability_pct,s.model_version,s.gate_status," +
    "s.deep_scan_status " +
    "FROM ai_forward_test a " +
    "JOIN tennis_prediction_snapshots s ON s.bet_id=a.id " +
    "WHERE a.sport_type='TENNIS' AND a.stake=0 " +
    "AND a.status='PENDING' ORDER BY a.id,s.snapshot_sequence"
  ).all();

  const holdouts = new Set(
    db.prepare(
      "SELECT bet_id FROM tennis_forward_cohort_members " +
      "WHERE cohort_role='HOLDOUT'"
    ).all().map(x => String(x.bet_id))
  );

  for (const r of rows) {
    if (
      holdouts.has(String(r.id)) ||
      r.is_calibration_anchor !== 1 ||
      seenAnchors.has(r.id)
    ) continue;

    seenAnchors.add(r.id);

    if (r.snapshot_status !== 'VALID_PREMATCH') continue;

    const cap = time(r.captured_at);
    const start = time(r.match_start_at);
    const odd = val(r.opening_odd);
    const p = val(r.model_probability_pct);

    if (
      cap === null || start === null ||
      cap >= start || cap > now || start <= now ||
      !openingValid(odd, p === null ? null : p / 100) ||
      !nonempty(r.snapshot_hash) ||
      !nonempty(r.event_fingerprint) ||
      !nonempty(r.market_fingerprint)
    ) continue;

    const group = [
      'TENNIS', r.league, r.strategy_tag,
      r.strategy_tag, r.model_version || 'MODEL_UNKNOWN'
    ].join(' / ');

    by.set(r.id, {
      id: 'TENNIS:' + r.id,
      betId: r.id,
      sport: 'TENNIS',
      group,
      eventKey: [
        'TENNIS', r.event_fingerprint, r.market_fingerprint
      ].join('|'),
      sourceId: r.snapshot_id,
      sourceHash: r.snapshot_hash,
      firstSeen: new Date(now).toISOString(),
      anchorAt: r.captured_at,
      matchAt: r.match_start_at,
      odd,
      p: p / 100,
      gateAtAnchor: norm(r.gate_status),
      deepAtAnchor: nonempty(r.deep_scan_status),
      calibratedProbabilityVerified: false
    });
  }

  return [...by.values()];
}

function calcioPending(db, now) {
  const by = new Map(), seenContracts = new Set();

  const rows = db.prepare(
    "SELECT a.id,a.league,a.strategy_tag,a.match_date," +
    "a.prediction,a.market_type,f.id AS contract_id," +
    "f.created_at,f.snapshot_json FROM ai_forward_test a " +
    "JOIN calcio_final_market_contract_audit_log f " +
    "ON f.bet_id=a.id AND f.prediction=a.prediction " +
    "AND UPPER(f.market_type)=UPPER(a.market_type) " +
    "WHERE a.sport_type='CALCIO' AND a.stake=0 " +
    "AND a.status='PENDING' " +
    "ORDER BY a.id,f.created_at DESC,f.id DESC"
  ).all();

  for (const r of rows) {
    if (seenContracts.has(r.id)) continue;
    seenContracts.add(r.id);

    const cap = time(r.created_at);
    const start = time(r.match_date);

    if (
      cap === null || start === null ||
      cap >= start || cap > now || start <= now
    ) continue;

    let j;
    try {
      j = JSON.parse(r.snapshot_json);
    } catch {
      continue;
    }

    const gen = time(j.generatedAt);
    const o = val(j.odd);
    const prob = val(j.probabilityPct);

    if (
      gen === null || gen > cap || gen >= start ||
      !openingValid(o, prob === null ? null : prob / 100) ||
      norm(j.prediction) !== norm(r.prediction) ||
      norm(j.marketType).toUpperCase() !==
        norm(r.market_type).toUpperCase() ||
      !nonempty(j.eventKey)
    ) continue;

    const group = [
      'CALCIO', r.league, r.strategy_tag, j.marketType,
      'CONTRACT_' + String(j.version || 'UNKNOWN')
    ].join(' / ');

    by.set(r.id, {
      id: 'CALCIO:' + r.id,
      betId: r.id,
      sport: 'CALCIO',
      group,
      eventKey: [
        'CALCIO', j.eventKey, j.marketType
      ].join('|'),
      sourceId: r.contract_id,
      sourceHash: digest(r.snapshot_json),
      firstSeen: new Date(now).toISOString(),
      anchorAt: r.created_at,
      matchAt: r.match_date,
      odd: o,
      p: prob / 100,
      gateAtAnchor: norm(j.decisionState?.code),
      deepAtAnchor: false,
      calibratedProbabilityVerified: false,
      qualityBlocked: j.dataQuality?.blocking !== false,
      operationalAtAnchor: j.decisionState?.operational === true
    });
  }

  return [...by.values()];
}

function evidenceIndex(db) {
  const tennis = new Map(
    db.prepare(
      'SELECT bet_id,snapshot_id,snapshot_hash ' +
      'FROM tennis_prediction_snapshots'
    ).all().map(r => [
      r.bet_id + '|' + r.snapshot_id, r.snapshot_hash
    ])
  );

  const calcio = new Map(
    db.prepare(
      'SELECT id,bet_id,snapshot_json ' +
      'FROM calcio_final_market_contract_audit_log'
    ).all().map(r => [
      r.bet_id + '|' + r.id, digest(r.snapshot_json)
    ])
  );

  const bets = new Map(
    db.prepare(
      "SELECT id,sport_type,status,stake," +
      "settlement_contract_status,settlement_evidence_hash," +
      "settlement_source_event_id,settlement_observed_at," +
      "paper_result_active,paper_result_conflict " +
      "FROM ai_forward_test " +
      "WHERE sport_type IN ('TENNIS','CALCIO')"
    ).all().map(r => [
      r.sport_type + ':' + r.id, r
    ])
  );

  return { tennis, calcio, bets };
}

function outcome(index, c, now) {
  const proof = c.sport === 'TENNIS'
    ? index.tennis.get(c.betId + '|' + c.sourceId)
    : index.calcio.get(c.betId + '|' + c.sourceId);

  if (proof !== c.sourceHash)
    return { reason: 'SOURCE_CHANGED' };

  const r = index.bets.get(c.sport + ':' + c.betId);
  if (!r) return { reason: 'BET_MISSING' };

  if (!['WON', 'LOST'].includes(r.status))
    return { reason: 'NOT_SETTLED' };

  const observed = time(r.settlement_observed_at);

  if (
    r.stake !== 0 ||
    r.settlement_contract_status !== 'VERIFIED' ||
    r.paper_result_active === 0 ||
    r.paper_result_conflict === 1 ||
    !nonempty(r.settlement_evidence_hash) ||
    !nonempty(r.settlement_source_event_id) ||
    observed === null ||
    observed < time(c.firstSeen) ||
    observed > now
  ) return { reason: 'SETTLEMENT_NOT_ELIGIBLE' };

  return {
    result: r.status,
    settlementHash: r.settlement_evidence_hash,
    observedAt: r.settlement_observed_at
  };
}

function metric(items) {
  if (!items.length) return null;

  const n = items.length;
  const rewards = items.map(x =>
    x.result === 'WON' ? x.capture.odd - 1 : -1
  );

  const avg = rewards.reduce((a, b) => a + b, 0) / n;

  const sd = n > 1
    ? Math.sqrt(
        rewards.reduce((a, b) => a + (b - avg) ** 2, 0) /
        (n - 1)
      )
    : null;

  const brier = items.reduce(
    (a, x) => a +
      (x.capture.p - (x.result === 'WON' ? 1 : 0)) ** 2,
    0
  ) / n;

  const logLoss = items.reduce(
    (a, x) => a -
      (x.result === 'WON'
        ? Math.log(x.capture.p)
        : Math.log(1 - x.capture.p)),
    0
  ) / n;

  const meanEv = items.reduce(
    (a, x) => a + x.capture.p * x.capture.odd - 1,
    0
  ) / n;

  return {
    n,
    roiPct: +(100 * avg).toFixed(2),
    brier: +brier.toFixed(4),
    logLoss: +logLoss.toFixed(4),
    rawModelEvPct: +(100 * meanEv).toFixed(2),
    roiLowerNormal95Pct: sd === null ? null :
      +(100 * (avg - 1.96 * sd / Math.sqrt(n))).toFixed(2),
    calibrationCertified: false
  };
}

function classify(items, m) {
  if (!items.length)
    return 'NESSUN_FORWARD_VERIFICATO';

  if (items.length < 30)
    return 'FORWARD_CAMPIONE_INSUFFICIENTE';

  if (m.roiPct < 0)
    return 'REVISIONE_RETROCESSIONE_SHADOW';

  if (items.some(x =>
    !x.capture.deepAtAnchor && x.capture.sport === 'TENNIS'
  )) return 'DEEPSCAN_NON_CERTIFICATO_ALL_ANCHOR';

  if (items.some(x =>
    x.capture.qualityBlocked ||
    x.capture.operationalAtAnchor === false
  )) return 'GATE_STORICO_BLOCCATO';

  return 'REVISIONE_STATISTICA_SHADOW_NON_AUTORIZZATA';
}

function run() {
  fs.mkdirSync(OUT, { recursive: true });

  const lock = path.join(OUT, '.run.lock');
  const fd = fs.openSync(lock, 'wx');

  try {
    const v23 = readV23();
    const Database = require('better-sqlite3');

    const db = new Database(
      path.join(ROOT, 'database_betting.db'),
      { readonly: true, fileMustExist: true }
    );

    db.pragma('query_only=ON');

    let state, skips = {};
    let newCaptures = 0, newSettles = 0;

    try {
      const proof = require('./tennisPredictionSnapshots')
        .verifyPredictionSnapshotRows(
          db.prepare(
            'SELECT * FROM tennis_prediction_snapshots ' +
            'ORDER BY bet_id,snapshot_sequence'
          ).all()
        );

      check(
        proof.valid === true,
        'TENNIS_SNAPSHOT_CHAIN_INVALID'
      );

      state = loadLedger();

      const now = Date.now();
      const captures = [];

      for (const c of [
        ...tennisPending(db, now),
        ...calcioPending(db, now)
      ].sort((a, b) => a.id.localeCompare(b.id))) {
        if (
          state.captures.has(c.id) ||
          state.eventKeys.has(c.eventKey)
        ) continue;

        captures.push({
          type: 'CAPTURE',
          id: c.id,
          at: c.firstSeen,
          data: c
        });

        state.captures.set(c.id, c);
        state.eventKeys.add(c.eventKey);
      }

      newCaptures = captures.length;
      state = saveEntries(loadLedger(), captures);

      const settled = [];
      const index = evidenceIndex(db);

      for (const [id, c] of state.captures) {
        if (state.settles.has(id)) continue;

        const res = outcome(index, c, now);

        if (res.result) {
          settled.push({
            type: 'SETTLE',
            id,
            at: new Date(now).toISOString(),
            data: res
          });
        } else {
          skips[res.reason] = (skips[res.reason] || 0) + 1;
        }
      }

      newSettles = settled.length;
      state = saveEntries(state, settled);

    } finally {
      db.close();
    }

    const evaluated = new Map();

    for (const [id, s] of state.settles) {
      const c = state.captures.get(id);
      if (!evaluated.has(c.group))
        evaluated.set(c.group, []);

      evaluated.get(c.group).push({
        capture: c,
        ...s
      });
    }

    const keys = new Set([
      ...v23.groups.map(x => x.key),
      ...[...state.captures.values()].map(x => x.group)
    ]);

    const groups = [...keys].sort().map(key => {
      const settled = evaluated.get(key) || [];
      const m = metric(settled);

      const captured = [...state.captures.values()]
        .filter(c => c.group === key);

      return {
        key,
        baseline: v23.groups.find(x => x.key === key)?.state ||
          'NUOVO_GRUPPO',
        captured: captured.length,
        settled: settled.length,
        metrics: m,
        proposal: classify(settled, m),
        stakeAuthority: false
      };
    });

    const payload = {
      version: 'PAPER_PROMOTION_V24_SHADOW',
      at: new Date().toISOString(),
      v23StatusHash: hash(v23),
      groups,
      ledgerEntries: state.lines,
      ledgerHead: state.head,
      newCaptures,
      newSettles,
      pendingReasons: skips,
      clvRequired: false,
      calibrationCertified: false,
      stakeAuthority: false,
      historyModified: false
    };

    const tmp = STATUS + '.tmp-' + process.pid;

    try {
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          payload,
          sha256: hash(payload)
        }, null, 2),
        { flag: 'wx' }
      );

      fs.renameSync(tmp, STATUS);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }

    console.log('V2.4 SHADOW OK', JSON.stringify({
      groups: groups.length,
      ledgerEntries: state.lines,
      newCaptures,
      newSettles,
      forwardSettled: state.settles.size,
      pendingReasons: skips
    }));

    console.table(groups.map(g => ({
      group: g.key.slice(0, 56),
      captured: g.captured,
      settled: g.settled,
      roi: g.metrics?.roiPct ?? null,
      proposal: g.proposal
    })));

    console.log(
      'CLV_REQUIRED=NO; CALIBRATED_EV=NOT_CERTIFIED; ' +
      'STAKE_AUTHORITY=NO; DB_READ_ONLY=YES'
    );

  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function tests() {
  assert.equal(time('2026-10-16T18:00:00'), null);
  assert.equal(
    time('2026-10-16T18:00:00Z'),
    Date.parse('2026-10-16T18:00:00Z')
  );
  assert.equal(openingValid(2, .5), true);
  assert.equal(openingValid(2, 0), false);
  assert.equal(val(null), null);

  const c = {
    odd: 2, p: .5,
    sport: 'TENNIS', deepAtAnchor: false
  };

  assert.equal(
    metric([
      { capture: c, result: 'WON' },
      { capture: c, result: 'LOST' }
    ]).roiPct,
    0
  );

  assert.equal(
    classify([], null),
    'NESSUN_FORWARD_VERIFICATO'
  );

  assert.equal(
    classify(
      [{ capture: c, result: 'WON' }],
      metric([{ capture: c, result: 'WON' }])
    ),
    'FORWARD_CAMPIONE_INSUFFICIENTE'
  );

  assert.notEqual(hash({ x: 1 }), hash({ x: 2 }));
  console.log('V2.4 SELF-TEST: 9 OK');
}

if (require.main === module) {
  try {
    if (process.argv.includes('--test')) {
      tests();
    } else if (process.argv.includes('--watch')) {
      run();
      console.log('V2.4 WATCH 10 MIN; CTRL+C');

      setInterval(() => {
        try {
          run();
        } catch (e) {
          console.error('V2.4 FAIL-CLOSED:', e.message);
          process.exit(2);
        }
      }, 600000);
    } else {
      run();
    }
  } catch (e) {
    console.error('V2.4 FAIL-CLOSED:', e.message);
    process.exitCode = 2;
  }
}
