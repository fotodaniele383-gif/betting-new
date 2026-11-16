'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const refresh = require('../backend/tennisPlayerDataRefresh');
const registry = require('../backend/tennisPatchRegistry');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(__dirname, '..');
function csv(dates) { return ['tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_name,loser_name,score,best_of', ...dates.map((date, i) => `T${i},Test,Hard,A,${date},${i},A${i},B${i},6-4 6-4,3`)].join('\n') + '\n'; }
function sources() { return refresh.defaultSources(2026).map(source => ({ ...source, minRows: 1 })); }
(async () => {
  assert.ok(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 14);
  assert.strictEqual(registry.TENNIS_PATCH_REGISTRY_VERSION, `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`);
  assert.ok(registry.PATCHES.some(item => item.version === '14' && String(item.status).startsWith('ACTIVE')));
  assert.strictEqual(refresh.assertAllowedSource(sources()[0]), true);
  assert.throws(() => refresh.assertAllowedSource({ ...sources()[0], url: 'https://example.com/file.csv' }), /HOST_BLOCKED/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch14-standalone-'));
  try {
    for (const source of sources()) fs.writeFileSync(path.join(dir, source.localFile), csv(['20260501']));
    const evidence = { init(dataDir) { const inspections = sources().map(source => refresh.inspectCsvFile(path.join(dataDir, source.localFile), source)); return { initialized: true, fileCount: 3, matchCount: inspections.reduce((sum, item) => sum + item.validRows, 0), playerCount: 6, rejectedRows: 0, duplicateRows: 0, earliestMatchAt: inspections.map(item => item.earliestMatchAt).sort()[0], latestMatchAt: inspections.map(item => item.latestMatchAt).sort().slice(-1)[0] }; }, getStatus() { return { initialized: true, matchCount: 6, playerCount: 6, latestMatchAt: '2026-07-02T12:00:00.000Z' }; } };
    const result = await refresh.refreshPlayerData({ dataDir: dir, sources: sources(), downloader: async () => ({ statusCode: 200, text: csv(['20260501', '20260702']), headers: {} }), playerEvidence: evidence, now: new Date('2026-07-15T00:00:00Z'), operationId: 'PATCH14_STANDALONE' });
    assert.strictEqual(result.success, true); assert.strictEqual(result.stakePolicyChanged, false); assert.ok(fs.existsSync(path.join(dir, refresh.MANIFEST_FILE)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const server = fs.readFileSync(path.join(root, 'backend/server.tennis.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(server.includes("router.get('/player-data-freshness'") && server.includes("router.post('/player-data-refresh'"));
  assert.ok(app.includes('executeTennisPlayerDataRefresh') && html.includes('tennisPlayerDataPanel'));
  assert.deepStrictEqual(progression.duplicateHtmlIds(html), []);
  assert.strictEqual(app, fs.readFileSync(path.join(root, 'backend/public/app.js'), 'utf8'));
  console.log('PATCH14 standalone PASS: allowlist, CSV validation, staged activation, last-known-good, freshness UI and no stake authority.');
})().catch(error => { console.error(error.stack || error.message); process.exit(2); });
