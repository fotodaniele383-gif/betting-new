#!/usr/bin/env node
'use strict';

const path = require('path');
const Module = require('module');

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : '.');
const checks = [];
function check(name, condition, details = null) { checks.push({ name, ok: Boolean(condition), details }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const columns = [
  'id','odd','sport_type','strategy_tag','model_version','metric_version','data_quality','prediction','home_team','away_team',
  'tennis_event_fingerprint','tennis_market_fingerprint','provider_event_id','canonical_match_datetime','created_at','point_line',
  'opening_odd','closing_odd','clv_pct','closing_line_available','clv_method','clv','clv_edge','market_efficiency','steam_move',
  'steam_intensity','sharp_consensus','clv_quality','engine_version','clv_source','clv_verified','closing_odd_side','clv_last_attempt_ts',
  'clv_last_attempt_result','clv_pending_reason','clv_next_retry_ts','clv_contract_status','clv_contract_reason','clv_contract_version',
  'clv_opening_ts','clv_closing_ts','clv_bookmaker','clv_source_event_id','clv_event_fingerprint','clv_market_fingerprint','clv_point_line'
];

function createMockDb(initialRow) {
  let row = clone(initialRow);
  const db = {
    exec() {},
    transaction(fn) {
      return () => {
        const before = clone(row);
        try { return fn(); }
        catch (error) { row = before; throw error; }
      };
    },
    prepare(sql) {
      if (/PRAGMA\s+table_info\(ai_forward_test\)/i.test(sql)) {
        return { all: () => columns.map(name => ({ name })) };
      }
      if (/UPDATE\s+ai_forward_test/i.test(sql)) {
        const match = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\?/i);
        if (!match) throw new Error('PATCH45_TEST_UPDATE_SQL_UNPARSABLE');
        const names = match[1].split(',').map(part => part.trim().split(/\s*=\s*/)[0].trim());
        return {
          run(...args) {
            const id = args.at(-1);
            if (Number(id) !== Number(row.id)) return { changes: 0 };
            names.forEach((name, index) => { row[name] = args[index]; });
            return { changes: 1 };
          }
        };
      }
      throw new Error(`PATCH45_TEST_UNEXPECTED_SQL:${sql}`);
    },
    getRow: () => clone(row)
  };
  return db;
}

(async () => {
  const originalLoad = Module._load;
  let axiosCalls = 0;
  Module._load = function patch45ModuleLoad(request) {
    if (request === 'axios') return { get: async () => { axiosCalls += 1; throw new Error('PATCH45_TEST_NETWORK_FORBIDDEN'); } };
    return originalLoad.apply(this, arguments);
  };

  const lifecyclePath = path.join(root, 'backend', 'tennisForwardLifecycle.js');
  const diagnosticsPath = path.join(root, 'backend', 'runtimeDiagnostics.js');
  const trackerPath = path.join(root, 'backend', 'clvTracker.js');
  const lifecycle = require(lifecyclePath);
  const diagnostics = require(diagnosticsPath);
  const originalTransition = lifecycle.executeAtomicLifecycleTransition;
  const originalCaptureError = diagnostics.captureError;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  diagnostics.captureError = () => ({ captured: true });
  console.log = () => {};
  console.warn = () => {};

  try {
    delete require.cache[require.resolve(trackerPath)];
    const tracker = require(trackerPath);
    lifecycle.executeAtomicLifecycleTransition = (db, config, mutator) => db.transaction(() => ({ success: true, mutationResult: mutator(), config }))();

    const verifiedBet = {
      id: 45001, odd: 2.0, sport_type: 'TENNIS', strategy_tag: 'TENNIS_ATP_MONEYLINE', data_quality: 'CURRENT_BOOTSTRAP',
      prediction: '1', home_team: 'Player A', away_team: 'Player B', tennis_event_fingerprint: 'EVT45',
      tennis_market_fingerprint: 'MKT45', provider_event_id: 'PROVIDER45', canonical_match_datetime: '2026-08-04T12:00:00.000Z',
      created_at: '2026-08-04T09:00:00.000Z', point_line: null
    };
    const verifiedDb = createMockDb(verifiedBet);
    const verifiedUpdated = tracker.updateClvLock(
      verifiedDb,
      verifiedBet,
      1.8,
      [{ key: 'betfair_ex_eu', title: 'Betfair', markets: [] }],
      'LIVE_API',
      { openingTimestamp: '2026-08-04T09:00:00.000Z', closingTimestamp: '2026-08-04T11:00:00.000Z', sourceEventId: 'PROVIDER45' }
    );
    const verifiedRow = verifiedDb.getRow();
    check('Lock verificato completato', verifiedUpdated === true);
    check('Campi canonici quote persistiti', verifiedRow.opening_odd === 2 && verifiedRow.closing_odd === 1.8 && Number.isFinite(verifiedRow.clv_pct), verifiedRow);
    check('Contratto VERIFIED', verifiedRow.clv_contract_status === 'VERIFIED' && verifiedRow.clv_verified === 1, { status: verifiedRow.clv_contract_status, reason: verifiedRow.clv_contract_reason });
    check('Versione contratto nell engine', String(verifiedRow.engine_version).includes('TENNIS_CLV_CONTRACT_V1_PATCH4'), { engineVersion: verifiedRow.engine_version });
    check('Timestamp contratto conservati', verifiedRow.clv_opening_ts === Date.parse('2026-08-04T09:00:00.000Z') && verifiedRow.clv_closing_ts === Date.parse('2026-08-04T11:00:00.000Z'));
    check('Esito runtime lock verificato', verifiedRow.clv_last_attempt_result === 'CLV_LOCKED_LIVE_API' && verifiedRow.clv_pending_reason === 'CLV_LOCKED');

    const unverifiedBet = { ...verifiedBet, id: 45002, provider_event_id: 'PROVIDER46' };
    const unverifiedDb = createMockDb(unverifiedBet);
    const unverifiedUpdated = tracker.updateClvLock(
      unverifiedDb,
      unverifiedBet,
      6.8,
      [{ key: 'betfair_ex_eu', title: 'Betfair', markets: [] }],
      'POST_MATCH_VAULT',
      { openingTimestamp: '2026-08-04T09:00:00.000Z', closingTimestamp: '2026-08-04T13:00:00.000Z', sourceEventId: 'PROVIDER46' }
    );
    const unverifiedRow = unverifiedDb.getRow();
    check('Evidenza post-match persistita senza crash', unverifiedUpdated === true);
    check('Evidenza post-match non promossa', unverifiedRow.clv_contract_status === 'AVAILABLE_UNVERIFIED' && unverifiedRow.clv_verified === 0);
    check('Motivo temporale esplicito', String(unverifiedRow.clv_contract_reason).includes('CLOSING_AFTER_MATCH_START'), { reason: unverifiedRow.clv_contract_reason });
    check('Stato runtime non dichiara lock certificato', unverifiedRow.clv_last_attempt_result === 'CLV_CAPTURED_UNVERIFIED_AVAILABLE_UNVERIFIED');
    check('Pending reason conserva il contratto', String(unverifiedRow.clv_pending_reason).includes('CLOSING_AFTER_MATCH_START'));

    const rollbackBet = { ...verifiedBet, id: 45003 };
    const rollbackDb = createMockDb(rollbackBet);
    const rollbackBefore = rollbackDb.getRow();
    lifecycle.executeAtomicLifecycleTransition = (db, config, mutator) => db.transaction(() => { mutator(); throw new Error('PATCH45_TEST_FORCED_LIFECYCLE_FAILURE'); })();
    const rollbackUpdated = tracker.updateClvLock(
      rollbackDb,
      rollbackBet,
      1.8,
      [{ key: 'betfair_ex_eu', title: 'Betfair', markets: [] }],
      'LIVE_API',
      { openingTimestamp: '2026-08-04T09:00:00.000Z', closingTimestamp: '2026-08-04T11:00:00.000Z', sourceEventId: 'PROVIDER45' }
    );
    check('Errore lifecycle restituisce false', rollbackUpdated === false);
    check('Rollback atomico ripristina la riga', JSON.stringify(rollbackDb.getRow()) === JSON.stringify(rollbackBefore));
    check('Nessuna chiamata API nei test di lock', axiosCalls === 0, { axiosCalls });
  } catch (error) {
    checks.push({ name: 'Eccezione suite', ok: false, details: error.stack || error.message });
  } finally {
    lifecycle.executeAtomicLifecycleTransition = originalTransition;
    diagnostics.captureError = originalCaptureError;
    Module._load = originalLoad;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }

  const failed = checks.filter(item => !item.ok);
  originalConsoleLog(JSON.stringify({
    success: failed.length === 0,
    patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
    suite: 'PATCH45_CLV_RUNTIME_ATOMIC_LOCK',
    checks: checks.length,
    details: checks,
    failures: failed
  }, null, 2));
  if (failed.length) process.exit(1);
})();
