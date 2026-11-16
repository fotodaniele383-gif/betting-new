#!/usr/bin/env node
'use strict';

const path = require('path');
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : '.');
const checks = [];
function check(name, condition, details = null) { checks.push({ name, ok: Boolean(condition), details }); }
function italianDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

(async () => {
  const originalLoad = Module._load;
  let axiosCalls = 0;
  Module._load = function patch45ModuleLoad(request) {
    if (request === 'axios') return { get: async () => { axiosCalls += 1; throw new Error('PATCH45_TEST_NETWORK_FORBIDDEN'); } };
    return originalLoad.apply(this, arguments);
  };
  const lifecycle = require(path.join(root, 'backend', 'tennisForwardLifecycle.js'));
  const diagnostics = require(path.join(root, 'backend', 'runtimeDiagnostics.js'));
  const originalTransition = lifecycle.executeAtomicLifecycleTransition;
  const originalCaptureError = diagnostics.captureError;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  diagnostics.captureError = () => ({ captured: true });
  console.log = () => {};
  console.warn = () => {};
  const raw = new DatabaseSync(':memory:');
  const db = {
    prepare: sql => raw.prepare(sql),
    exec: sql => raw.exec(sql),
    get inTransaction() { return raw.isTransaction; },
    transaction(fn) {
      return () => {
        raw.exec('BEGIN IMMEDIATE');
        try { const result = fn(); raw.exec('COMMIT'); return result; }
        catch (error) { try { raw.exec('ROLLBACK'); } catch (_) {} throw error; }
      };
    }
  };

  try {
    delete require.cache[require.resolve(path.join(root, 'backend', 'clvTracker.js'))];
    const tracker = require(path.join(root, 'backend', 'clvTracker.js'));
    lifecycle.executeAtomicLifecycleTransition = (database, config, mutator) => database.transaction(() => ({ success: true, mutationResult: mutator(), config }))();

    raw.exec(`
      CREATE TABLE ai_forward_test (
        id INTEGER PRIMARY KEY,
        bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT, prediction TEXT,
        odd REAL, sport_type TEXT, strategy_tag TEXT, league TEXT, data_quality TEXT,
        provider_event_id TEXT, tennis_event_fingerprint TEXT, tennis_market_fingerprint TEXT,
        canonical_match_datetime TEXT, created_at TEXT, point_line REAL, model_version TEXT, metric_version TEXT
      );
    `);
    tracker.ensureClvColumns(db);
    raw.exec(`
      CREATE TABLE internal_odds_vault (
        id TEXT PRIMARY KEY, sport TEXT, sport_group TEXT, home_team TEXT, away_team TEXT,
        commence_time TEXT, opening_odds TEXT, opening_ts INTEGER, closing_odds TEXT,
        closing_ts INTEGER, tracker_version TEXT
      );
    `);

    const now = new Date();
    const matchAt = new Date(now.getTime() + 60 * 60 * 1000);
    const openingTs = now.getTime() - 45 * 60 * 1000;
    const closingTs = now.getTime();
    const bookmakers = [{ key: 'betfair_ex_eu', title: 'Betfair', markets: [{ key: 'h2h', outcomes: [{ name: 'Vault Player A', price: 1.91 }, { name: 'Vault Player B', price: 2.05 }] }] }];

    raw.prepare(`INSERT INTO ai_forward_test (
      id, bet_type, match_date, home_team, away_team, prediction, odd, sport_type, strategy_tag, league,
      data_quality, provider_event_id, tennis_event_fingerprint, tennis_market_fingerprint,
      canonical_match_datetime, created_at, point_line, model_version, metric_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(45045, 'SINGLE_TENNIS_CR', italianDate(matchAt), 'Vault Player A', 'Vault Player B', '1', 2.10,
        'TENNIS', 'TENNIS_ATP_MONEYLINE', '[ATP] Test', 'CURRENT_BOOTSTRAP', 'PROVIDER_VAULT_45',
        'EVT_VAULT_45', 'MKT_VAULT_45', matchAt.toISOString(), new Date(openingTs).toISOString(), null, 'MODEL45', 'METRIC45');

    raw.prepare(`INSERT INTO internal_odds_vault (
      id, sport, sport_group, home_team, away_team, commence_time, opening_odds, opening_ts,
      closing_odds, closing_ts, tracker_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('VAULT_RECORD_45', 'tennis_atp_test', 'TENNIS', 'Vault Player A', 'Vault Player B', matchAt.toISOString(),
        JSON.stringify(bookmakers), openingTs, JSON.stringify(bookmakers), closingTs, 'PATCH45_TEST');

    const updatedCount = await tracker.updateBetsFromVault(db, [{ id: 45045 }], 'INTERNAL_VAULT');
    const row = raw.prepare('SELECT * FROM ai_forward_test WHERE id = 45045').get();
    check('Vault aggiorna una sola riga', updatedCount === 1, { updatedCount });
    check('Quota Vault persistita', row.closing_odd === 1.91 && row.clv === 1.91, { closingOdd: row.closing_odd, clv: row.clv });
    check('Timestamp apertura proviene dal Vault', row.clv_opening_ts === openingTs, { expected: openingTs, actual: row.clv_opening_ts });
    check('Timestamp chiusura proviene dal Vault', row.clv_closing_ts === closingTs, { expected: closingTs, actual: row.clv_closing_ts });
    check('Identità provider conservata', row.clv_source_event_id === 'PROVIDER_VAULT_45', { sourceEventId: row.clv_source_event_id });
    check('Fingerprint canonici conservati', row.clv_event_fingerprint === 'EVT_VAULT_45' && row.clv_market_fingerprint === 'MKT_VAULT_45');
    check('Contratto Vault verificato prima del match', row.clv_contract_status === 'VERIFIED' && row.clv_verified === 1, { status: row.clv_contract_status, reason: row.clv_contract_reason });
    check('Nessuna API usata dal percorso Vault', axiosCalls === 0, { axiosCalls });
  } catch (error) {
    checks.push({ name: 'Eccezione suite', ok: false, details: error.stack || error.message });
  } finally {
    try { raw.close(); } catch (_) {}
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
    suite: 'PATCH45_VAULT_CANONICAL_METADATA_NO_API',
    checks: checks.length,
    details: checks,
    failures: failed
  }, null, 2));
  if (failed.length) process.exit(1);
})();
