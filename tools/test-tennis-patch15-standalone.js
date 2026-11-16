'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
const registry = require('../backend/tennisPatchRegistry');
const progression = require('../backend/tennisProgramProgressionAudit');

(async () => {
  assert.ok(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 15);
  assert.strictEqual(registry.TENNIS_PATCH_REGISTRY_VERSION, `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`);
  assert.ok(registry.PATCHES.some(item => item.version === '15' && String(item.status).startsWith('ACTIVE')));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch15-standalone-'));
  const cacheDir = path.join(root, 'cache_news');
  fs.mkdirSync(cacheDir, { recursive: true });
  const now = Date.now();
  for (const player of ['jannik_sinner', 'carlos_alcaraz']) {
    fs.writeFileSync(path.join(cacheDir, `${player}.json`), JSON.stringify({ timestamp: now, articles: [{ title: player.replace('_', ' ') + ' tennis update', fullText: player.replace('_', ' ') + ' tennis update', pubDate: new Date(now - 3600000).toUTCString() }] }));
  }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE ai_forward_test (
      id INTEGER PRIMARY KEY, bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT,
      prediction TEXT, odd REAL, stake REAL, status TEXT, profit REAL, estimated_prob REAL,
      edge REAL, edge_pp REAL, ev_pct REAL, league TEXT, strategy_tag TEXT, sport_type TEXT,
      ds_action TEXT, ds_suggestion TEXT, deep_scan_risk_level TEXT,
      reference_odd1 REAL, reference_odd2 REAL, reference_market_source TEXT,
      market_type TEXT, surface TEXT, tennis_canonical_match_key TEXT,
      provider_event_id TEXT, settlement_contract_status TEXT, settlement_source TEXT
    );`);
    db.prepare(`INSERT INTO ai_forward_test (id,bet_type,match_date,home_team,away_team,prediction,odd,stake,status,profit,estimated_prob,edge,edge_pp,ev_pct,league,strategy_tag,sport_type,ds_action,ds_suggestion,deep_scan_risk_level,reference_odd1,reference_odd2,reference_market_source,market_type,surface,tennis_canonical_match_key,provider_event_id,settlement_contract_status,settlement_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      1, 'SINGLE_TENNIS', '2026-07-20T12:00:00Z', 'Jannik Sinner', 'Carlos Alcaraz', '1', 1.8, 2, 'PENDING', null, 62, 6, 6, 11.6, 'ATP Test', 'TENNIS_ATP_MONEYLINE', 'TENNIS', 'VALUE CONFERMATO', 'Conferma', 'OK', 1.8, 2.1, 'ODDS_API', 'moneyline', 'Hard', 'event-key', 'evt-1', null, null
    );
    retrieval.ensureInformationRetrievalSchema(db);
    const playerDataHealth = { status: 'CURRENT', latestMatchAt: '2026-07-14T12:00:00Z', dataAgeDays: 1, engine: { matchCount: 10, playerCount: 4, temporalLeakageGuard: true } };
    const health = retrieval.buildInformationRetrievalHealth(db, { cacheDir, playerDataHealth });
    assert.notStrictEqual(health.status, 'FAIL');
    assert.strictEqual(health.stakeAuthority, false);
    const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
    const receipt = retrieval.persistPredictionEvidenceReceipt(db, row, row, { betId: 1, snapshotId: 'SNAP15', phase: retrieval.RECEIPT_PHASES.PREDICTION_CAPTURE, cacheDir, playerDataHealth });
    assert.strictEqual(receipt.inserted, true);
    assert.throws(() => db.prepare(`DELETE FROM ${retrieval.TABLE_RECEIPTS}`).run(), /IMMUTABLE/);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const projectRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(projectRoot, 'backend/server.tennis.js'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
  assert.ok(server.includes("router.get('/information-retrieval-health'") && server.includes("router.post('/information-retrieval-probe'"));
  assert.ok(app.includes('loadTennisInformationRetrieval') && app.includes('runTennisInformationRetrievalProbe'));
  assert.ok(html.includes('tennisInformationRetrievalPanel') && html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`));
  assert.deepStrictEqual(progression.duplicateHtmlIds(html), []);
  assert.strictEqual(app, fs.readFileSync(path.join(projectRoot, 'backend/public/app.js'), 'utf8'));
  assert.strictEqual(html, fs.readFileSync(path.join(projectRoot, 'backend/public/index.html'), 'utf8'));
  console.log('PATCH15 standalone PASS: DeepScan, AI Analysis, Paper Trading source certification, immutable receipts, local-only probe and compact UI.');
})().catch(error => { console.error(error.stack || error.message); process.exit(2); });
