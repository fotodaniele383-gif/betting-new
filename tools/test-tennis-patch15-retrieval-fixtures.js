'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const retrieval = require('../backend/tennisInformationRetrievalCertification');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch15-retrieval-'));
  const cacheDir = path.join(root, 'cache_news'); fs.mkdirSync(cacheDir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(cacheDir, 'jannik_sinner.json'), JSON.stringify({ timestamp: now, articles: [{ title: 'Jannik Sinner wins tennis match', fullText: 'Jannik Sinner wins tennis match after strong form', pubDate: new Date(now - 3600000).toUTCString() }] }));
  fs.writeFileSync(path.join(cacheDir, 'carlos_alcaraz.json'), JSON.stringify({ timestamp: now, articles: [{ title: 'Carlos Alcaraz fit for tennis', fullText: 'Carlos Alcaraz fit for tennis event', pubDate: new Date(now - 7200000).toUTCString() }] }));
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ai_forward_test (
    id INTEGER PRIMARY KEY, bet_type TEXT, match_date TEXT, home_team TEXT, away_team TEXT,
    prediction TEXT, odd REAL, stake REAL, status TEXT, profit REAL, estimated_prob REAL,
    edge REAL, edge_pp REAL, ev_pct REAL, league TEXT, strategy_tag TEXT, sport_type TEXT,
    ds_action TEXT, ds_suggestion TEXT, deep_scan_risk_level TEXT,
    reference_odd1 REAL, reference_odd2 REAL, reference_market_source TEXT,
    market_type TEXT, surface TEXT, tennis_canonical_match_key TEXT, provider_event_id TEXT,
    settlement_contract_status TEXT, settlement_source TEXT
  );`);
  db.prepare(`INSERT INTO ai_forward_test (id,bet_type,match_date,home_team,away_team,prediction,odd,stake,status,profit,estimated_prob,edge,edge_pp,ev_pct,league,strategy_tag,sport_type,ds_action,ds_suggestion,deep_scan_risk_level,reference_odd1,reference_odd2,reference_market_source,market_type,surface,tennis_canonical_match_key,provider_event_id,settlement_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    1,'SINGLE_TENNIS','2026-07-20T12:00:00Z','Jannik Sinner','Carlos Alcaraz','1',1.8,2,'PENDING',null,62,6,6,11.6,'ATP Wimbledon','TENNIS_ATP_MONEYLINE','TENNIS','VALUE CONFERMATO','Conferma contestuale','OK',1.8,2.1,'ODDS_API','moneyline','Grass','2026-07-20|ATP|SINNER|ALCARAZ','evt-1',null
  );
  db.prepare(`INSERT INTO ai_forward_test (id,bet_type,match_date,home_team,away_team,prediction,odd,stake,status,profit,estimated_prob,edge,edge_pp,ev_pct,league,strategy_tag,sport_type,ds_action,reference_odd1,reference_odd2,market_type,surface,tennis_canonical_match_key,settlement_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    2,'SINGLE_TENNIS','2026-07-01T12:00:00Z','Player A','Player B','1',1.9,2,'WON',1.8,60,5,5,14,'ATP Test','TENNIS_ATP_MONEYLINE','TENNIS','RISCHIO MODELLO',1.9,2.0,'moneyline','Hard','2026-07-01|ATP|A|B','TENNISMYLIFE'
  );
  retrieval.ensureInformationRetrievalSchema(db);
  const playerDataHealth = { status: 'CURRENT', latestMatchAt: '2026-07-14T12:00:00Z', dataAgeDays: 1, engine: { matchCount: 100, playerCount: 20, temporalLeakageGuard: true } };
  const health = retrieval.buildInformationRetrievalHealth(db, { cacheDir, playerDataHealth });
  assert.ok(['PASS','WARN'].includes(health.status));
  assert.ok(health.channels.deepScan.score >= 70);
  assert.ok(health.channels.aiAnalysis.score > 50);
  assert.strictEqual(health.stakeAuthority, false);
  const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
  const first = retrieval.persistPredictionEvidenceReceipt(db, row, row, { betId: 1, snapshotId: 'SNAP1', phase: retrieval.RECEIPT_PHASES.PREDICTION_CAPTURE, cacheDir, playerDataHealth });
  const second = retrieval.persistPredictionEvidenceReceipt(db, row, row, { betId: 1, snapshotId: 'SNAP1', phase: retrieval.RECEIPT_PHASES.PREDICTION_CAPTURE, cacheDir, playerDataHealth });
  assert.strictEqual(first.inserted, true);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RECEIPTS}`).get().n, 1);
  assert.throws(() => db.prepare(`UPDATE ${retrieval.TABLE_RECEIPTS} SET status='X'`).run(), /IMMUTABLE/);
  const paper = retrieval.buildPaperTradingExecutionCertification({ pendingTennisRows: 1, tennisMyLifeRowsLoaded: 10, apiScoresLoaded: 2, contractVerified: 1, operationId: 'OP15' });
  assert.strictEqual(paper.status, 'PASS');

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('news.google.com') || value.includes('bing.com')) return { ok: true, status: 200, url: value, text: async () => `<rss><channel><item><title>Jannik Sinner tennis update</title></item></channel></rss>` };
    if (value.includes('duckduckgo.com')) return { ok: true, status: 200, url: value, text: async () => `<html>${'x'.repeat(600)} Jannik Sinner Carlos Alcaraz tennis</html>` };
    if (value.includes('tennismylife.org')) return { ok: true, status: 200, url: value, text: async () => `<html>${'tennis '.repeat(300)}</html>` };
    throw new Error('UNEXPECTED_URL');
  };
  try {
    const live = await retrieval.runLiveRetrievalProbe(db, { players: ['Jannik Sinner','Carlos Alcaraz'], cacheDir, playerDataHealth, persist: true, timeoutMs: 1000 });
    assert.strictEqual(live.networkUsed, true);
    assert.ok(live.sourceChecks.some(item => item.sourceId === 'DEEPSCAN_GOOGLE_NEWS_RSS' && item.status === 'PASS'));
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_RUNS}`).get().n, 1);
    assert.ok(db.prepare(`SELECT COUNT(*) n FROM ${retrieval.TABLE_CHECKS}`).get().n >= 8);
  } finally { global.fetch = originalFetch; }
  db.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log('PATCH15 retrieval fixtures PASS: DeepScan, AI Analysis, Paper Trading, immutable receipts and live source probe.');
})().catch(error => { console.error(error.stack || error.message); process.exit(2); });
