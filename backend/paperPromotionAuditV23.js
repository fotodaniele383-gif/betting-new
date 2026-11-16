
'use strict';

// V2.3 SHADOW - No DB, stake, V1, V2.1 or V2.2 mutation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const base = __dirname;
const output = path.join(base, 'paper-promotion-v23-shadow');
const snapshotPath = path.join(output, 'status.json');
const ledgerPath = path.join(output, 'transitions.jsonl');
const v22Path = path.join(base, 'paper-promotion-v22-shadow', 'status.json');
const v21Path = path.join(base, 'paperPromotionAuditV2.js');

const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const hash = x => sha(JSON.stringify(x));

const iso = x =>
  typeof x === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(x) &&
  Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;

const finite = x =>
  x !== null && x !== undefined && x !== '' &&
  Number.isFinite(Number(x)) ? Number(x) : null;

function check(x, msg) {
  if (!x) throw Error(msg);
}

function readV22() {
  const wrap = JSON.parse(fs.readFileSync(v22Path, 'utf8'));

  check(wrap.payload && wrap.sha256 === hash(wrap.payload),
    'V22_INTEGRITY');

  const p = wrap.payload;

  check(
    p.version === 'PAPER_PROMOTION_V22_SHADOW' &&
    p.executionIntegrated === false &&
    p.futureStakeAuthority === false,
    'V22_AUTHORITY'
  );

  check(
    p.auditSourceSha256 === sha(fs.readFileSync(v21Path)),
    'V21_SOURCE_CHANGED'
  );

  check(
    Array.isArray(p.groups) && p.tennisHashChain === true,
    'V22_CONTRACT'
  );

  const age = Date.now() - Date.parse(p.at);

  check(
    Number.isFinite(age) && age >= -60000 && age < 25 * 60000,
    'V22_STALE'
  );

  return p;
}

function blank() {
  return {
    dev: [], holdout: [], retro: [],
    anchorApproved: 0,
    anchorBlocked: 0,
    deepAtAnchor: 0,
    deepLater: 0,
    calcioQualityBlocked: 0,
    calcioOperational: 0,
    events: new Set()
  };
}

function add(map, key, role, record, extra) {
  if (!map.has(key)) map.set(key, blank());

  const g = map.get(key);
  g[role].push(record);

  for (const k of [
    'anchorApproved', 'anchorBlocked',
    'deepAtAnchor', 'deepLater',
    'calcioQualityBlocked', 'calcioOperational'
  ]) {
    g[k] += Number(Boolean(extra[k]));
  }

  if (extra.event) g.events.add(extra.event);
}

function stats(rows) {
  if (!rows.length) return null;

  let sum = 0, brier = 0, ll = 0, ev = 0;

  for (const x of rows) {
    sum += x.won ? x.odd - 1 : -1;
    brier += (x.p - x.won) ** 2;

    ll -= x.won * Math.log(x.p) +
      (1 - x.won) * Math.log(1 - x.p);

    ev += x.p * x.odd - 1;
  }

  const round = x => Number(x.toFixed(4));

  return {
    n: rows.length,
    roiPct: round(100 * sum / rows.length),
    brier: round(brier / rows.length),
    logLoss: round(ll / rows.length),
    modelEvPct: round(100 * ev / rows.length)
  };
}

function calc() {
  const Database = require('better-sqlite3');

  const db = new Database(
    path.join(base, 'database_betting.db'),
    { readonly: true, fileMustExist: true }
  );

  db.pragma('query_only=ON');

  try {
    const verify = require('./tennisPredictionSnapshots')
      .verifyPredictionSnapshotRows(
        db.prepare(
          'SELECT * FROM tennis_prediction_snapshots ORDER BY bet_id,snapshot_sequence'
        ).all()
      );

    check(verify.valid === true, 'TENNIS_HASH_CHAIN');

    const groups = new Map();

    const counts = {
      tennis: 0,
      calcio: 0,
      excludedNoValidPrematchAnchor: 0
    };

    const snapshotRows = db.prepare(
      'SELECT bet_id,snapshot_sequence,is_calibration_anchor,' +
      'snapshot_status,captured_at,match_start_at,event_fingerprint,' +
      'market_fingerprint,predicted_side,opening_odd,' +
      'model_probability_pct,model_version,deep_scan_status,gate_status ' +
      'FROM tennis_prediction_snapshots ORDER BY bet_id,snapshot_sequence'
    ).all();

    const snap = new Map();

    for (const s of snapshotRows) {
      if (!snap.has(s.bet_id)) snap.set(s.bet_id, []);
      snap.get(s.bet_id).push(s);
    }

    const tennis = db.prepare(
      "SELECT a.id,a.league,a.strategy_tag,a.status," +
      "c.cohort_role,c.holdout_locked " +
      "FROM ai_forward_test a " +
      "JOIN tennis_forward_cohort_members c ON c.bet_id=a.id " +
      "WHERE a.sport_type='TENNIS' AND a.stake=0 " +
      "AND a.status IN ('WON','LOST') " +
      "AND a.settlement_contract_status='VERIFIED' " +
      "AND COALESCE(a.paper_result_active,1)=1 " +
      "AND COALESCE(a.paper_result_conflict,0)=0 " +
      "AND c.cohort_role IN ('DEVELOPMENT','HOLDOUT') " +
      "AND c.leakage_status='CLEAR'"
    ).all();

    for (const r of tennis) {
      check(
        (r.cohort_role === 'HOLDOUT') === (r.holdout_locked === 1),
        'HOLDOUT_NOT_LOCKED'
      );

      const ss = snap.get(r.id) || [];

      const a = ss.find(s =>
        s.is_calibration_anchor === 1 &&
        s.snapshot_status === 'VALID_PREMATCH' &&
        iso(s.captured_at) !== null &&
        iso(s.match_start_at) !== null &&
        iso(s.captured_at) < iso(s.match_start_at)
      );

      if (!a) {
        counts.excludedNoValidPrematchAnchor++;
        continue;
      }

      const o = finite(a.opening_odd);
      const p = finite(a.model_probability_pct);

      if (o === null || o <= 1 ||
          p === null || p <= 0 || p >= 100) continue;

      const key = [
        'TENNIS', r.league, r.strategy_tag,
        r.strategy_tag, a.model_version || 'MODEL_UNKNOWN'
      ].join(' / ');

      const deep = ss.filter(s =>
        s.snapshot_status === 'VALID_PREMATCH' &&
        s.event_fingerprint === a.event_fingerprint &&
        s.market_fingerprint === a.market_fingerprint &&
        s.predicted_side === a.predicted_side &&
        s.deep_scan_status &&
        iso(s.captured_at) !== null &&
        iso(s.captured_at) < iso(a.match_start_at)
      );

      const before = deep.some(s =>
        iso(s.captured_at) <= iso(a.captured_at)
      );

      const later = deep.some(s =>
        iso(s.captured_at) > iso(a.captured_at)
      );

      add(
        groups,
        key,
        r.cohort_role === 'DEVELOPMENT' ? 'dev' : 'holdout',
        {
          won: r.status === 'WON' ? 1 : 0,
          odd: o,
          p: p / 100
        },
        {
          anchorApproved: String(a.gate_status || '')
            .startsWith('APPROVED'),
          anchorBlocked: String(a.gate_status || '')
            .startsWith('BLOCKED'),
          deepAtAnchor: before,
          deepLater: later,
          event: a.event_fingerprint
        }
      );

      counts.tennis++;
    }

    const football = db.prepare(
      "SELECT a.id,a.league,a.strategy_tag,a.status," +
      "a.match_date,a.prediction,a.market_type," +
      "f.snapshot_json,f.created_at " +
      "FROM ai_forward_test a " +
      "JOIN calcio_final_market_contract_audit_log f " +
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
      if (seen.has(r.id)) continue;

      if (iso(r.match_date) === null ||
          iso(r.created_at) === null ||
          iso(r.created_at) >= iso(r.match_date)) continue;

      seen.add(r.id);

      const j = JSON.parse(r.snapshot_json);

      if (iso(j.generatedAt) === null ||
          iso(j.generatedAt) >= iso(r.match_date) ||
          String(j.prediction) !== String(r.prediction) ||
          String(j.marketType).toUpperCase() !==
          String(r.market_type).toUpperCase()) continue;

      const o = finite(j.odd);
      const p = finite(j.probabilityPct);

      if (o === null || o <= 1 ||
          p === null || p <= 0 || p >= 100) continue;

      const key = [
        'CALCIO',
        r.league,
        r.strategy_tag,
        j.marketType || r.market_type,
        'CONTRACT_' + String(j.version || 'UNKNOWN')
      ].join(' / ');

      const blocked = !(
        j.dataQuality?.blocking === false &&
        j.coverageMode === 'HISTORY_PROXY_STRONG'
      );

      const operational = j.decisionState?.operational === true;

      add(
        groups, key, 'retro',
        {
          won: r.status === 'WON' ? 1 : 0,
          odd: o,
          p: p / 100
        },
        {
          calcioQualityBlocked: blocked,
          calcioOperational: operational,
          event: j.eventKey || r.id
        }
      );

      counts.calcio++;
    }

    return { groups, counts };

  } finally {
    db.close();
  }
}

function journal() {
  const states = new Map();
  let previous = 'GENESIS', count = 0;

  if (!fs.existsSync(ledgerPath))
    return { states, previous, count };

  for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line) continue;

    const j = JSON.parse(line);

    check(
      j.previous === previous &&
      j.sha256 === hash({
        previous: j.previous,
        key: j.key,
        from: j.from,
        to: j.to,
        at: j.at
      }),
      'LEDGER_INTEGRITY'
    );

    const before = states.get(j.key) || null;

    check(
      j.from === before &&
      j.to !== before &&
      typeof j.key === 'string' &&
      typeof j.to === 'string',
      'LEDGER_SEQUENCE'
    );

    states.set(j.key, j.to);
    previous = j.sha256;
    count++;
  }

  return { states, previous, count };
}

function run() {
  fs.mkdirSync(output, { recursive: true });

  const lock = path.join(output, '.run.lock');
  const fd = fs.openSync(lock, 'wx');

  try {
    const v22 = readV22();
    const { groups, counts } = calc();

    check(
      counts.tennis === v22.tennis.valid &&
      counts.calcio === v22.calcio.valid,
      'COUNTS_NOT_RECONCILED'
    );

    check(groups.size === v22.groups.length,
      'GROUPS_NOT_RECONCILED');

    const result = [];

    for (const old of v22.groups) {
      const x = groups.get(old.key);

      check(
        x &&
        x.dev.length === old.dev &&
        x.holdout.length === old.holdout &&
        x.retro.length === old.retro,
        'GROUP_DRIFT'
      );

      result.push({
        key: old.key,
        state: old.stato,
        dev: stats(x.dev),
        holdout: stats(x.holdout),
        retro: stats(x.retro),
        anchorApproved: x.anchorApproved,
        anchorBlocked: x.anchorBlocked,
        deepAtAnchor: x.deepAtAnchor,
        deepLater: x.deepLater,
        calcioQualityBlocked: x.calcioQualityBlocked,
        calcioOperational: x.calcioOperational,
        uniqueEvents: x.events.size,
        promotionAuthorized: false
      });
    }

    const prior = journal();
    let prev = prior.previous;
    const entries = [];

    const sorted = result.sort((a, b) =>
      a.key.localeCompare(b.key)
    );

    const current = new Set(sorted.map(r => r.key));

    const changed = [
      ...sorted.map(g => ({ key: g.key, to: g.state })),
      ...[...prior.states.keys()]
        .filter(x => !current.has(x))
        .map(x => ({ key: x, to: 'GROUP_REMOVED_SHADOW' }))
    ];

    const at = new Date().toISOString();

    for (const e of changed) {
      const from = prior.states.get(e.key) || null;

      if (from === e.to) continue;

      const payload = {
        previous: prev,
        key: e.key,
        from,
        to: e.to,
        at
      };

      const row = {
        ...payload,
        sha256: hash(payload)
      };

      entries.push(row);
      prev = row.sha256;
    }

    if (entries.length) {
      const ledFd = fs.openSync(ledgerPath, 'a');

      try {
        fs.writeSync(
          ledFd,
          entries.map(x => JSON.stringify(x)).join('\n') + '\n'
        );
        fs.fsyncSync(ledFd);
      } finally {
        fs.closeSync(ledFd);
      }
    }

    const payload = {
      version: 'PAPER_PROMOTION_V23_SHADOW',
      at,
      sourceV22Hash: sha(fs.readFileSync(v22Path)),
      tennisHashChain: true,
      counts,
      groups: sorted,
      ledgerEntries: prior.count + entries.length,
      ledgerHead: prev,
      clvRequired: false,
      executionIntegrated: false,
      futureStakeAuthority: false,
      historyModified: false
    };

    const temp = snapshotPath + '.tmp-' + process.pid;

    try {
      fs.writeFileSync(
        temp,
        JSON.stringify({
          payload,
          sha256: hash(payload)
        }, null, 2),
        { flag: 'wx' }
      );

      fs.renameSync(temp, snapshotPath);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }

    console.log('V2.3 SHADOW OK', JSON.stringify({
      at,
      counts,
      groups: sorted.length,
      transitionsAdded: entries.length,
      ledgerHead: prev
    }));

    console.table(sorted.map(x => ({
      group: x.key.slice(0, 60),
      state: x.state,
      nDev: x.dev?.n || 0,
      nHold: x.holdout?.n || 0,
      roiDev: x.dev?.roiPct ?? null,
      brierDev: x.dev?.brier ?? null,
      logLossDev: x.dev?.logLoss ?? null,
      evDev: x.dev?.modelEvPct ?? null,
      anchorApproved: x.anchorApproved,
      deepAtAnchor: x.deepAtAnchor,
      deepLater: x.deepLater
    })));

    console.log(
      'CLV_REQUIRED=NO; STAKE_AUTHORITY=NO; DB_READ_ONLY=YES'
    );

  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function tests() {
  assert.equal(iso('2026-10-16T12:30:00'), null);
  assert.equal(typeof iso('2026-10-16T12:30:00Z'), 'number');
  assert.equal(finite(null), null);
  assert.equal(finite(2.3), 2.3);

  assert.equal(
    stats([
      { won: 1, odd: 2, p: .5 },
      { won: 0, odd: 2, p: .5 }
    ]).roiPct,
    0
  );

  assert.equal(
    stats([{ won: 1, odd: 2, p: .5 }]).modelEvPct,
    0
  );

  assert.notEqual(hash({ x: 1 }), hash({ x: 2 }));

  console.log('V2.3 SELF-TEST: 7 OK');
}

if (require.main === module) {
  try {
    if (process.argv.includes('--test')) {
      tests();
    } else if (process.argv.includes('--watch')) {
      run();
      console.log('V2.3 watching every 10m; CTRL+C to stop');

      setInterval(() => {
        try {
          run();
        } catch (e) {
          console.error('V2.3 FAIL-CLOSED:', e.message);
          process.exit(2);
        }
      }, 600000);

    } else {
      run();
    }

  } catch (e) {
    console.error('V2.3 FAIL-CLOSED:', e.message);
    process.exitCode = 2;
  }
}
