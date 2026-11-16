'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const refresh = require('../backend/tennisPlayerDataRefresh');

function csv(dates) {
  return ['tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_name,loser_name,score,best_of', ...dates.map((date, i) => `T${i},Test,Hard,A,${date},${i},Player A ${i},Player B ${i},6-4 6-4,3`)].join('\n') + '\n';
}
function sources() { return refresh.defaultSources(2026).map(source => ({ ...source, minRows: 1 })); }
function seed(dir, dates = ['20260501', '20260502']) { fs.mkdirSync(dir, { recursive: true }); for (const source of sources()) fs.writeFileSync(path.join(dir, source.localFile), csv(dates)); }
function statusFromDir(dir) {
  const inspections = sources().map(source => refresh.inspectCsvFile(path.join(dir, source.localFile), source));
  return { initialized: true, fileCount: 3, matchCount: inspections.reduce((sum, item) => sum + item.validRows, 0), playerCount: 12, rejectedRows: 0, duplicateRows: 0, earliestMatchAt: inspections.map(item => item.earliestMatchAt).sort()[0], latestMatchAt: inspections.map(item => item.latestMatchAt).sort().slice(-1)[0] };
}
function evidence(options = {}) {
  let activeFailed = false;
  return {
    init(dir) {
      const stage = path.basename(dir).startsWith('.patch14_stage_');
      if (options.failActiveOnce && !stage && !activeFailed && fs.readFileSync(path.join(dir, sources()[0].localFile), 'utf8').includes('20260702')) { activeFailed = true; throw new Error('FORCED_ACTIVE_RELOAD_FAILURE'); }
      return statusFromDir(dir);
    },
    getStatus() { return { ...statusFromDir(options.dir), latestMatchAt: options.latestMatchAt || statusFromDir(options.dir).latestMatchAt }; }
  };
}
function bytes(dir) { return new Map(sources().map(source => [source.localFile, fs.readFileSync(path.join(dir, source.localFile))])); }
function assertBytes(dir, expected) { for (const source of sources()) assert(fs.readFileSync(path.join(dir, source.localFile)).equals(expected.get(source.localFile)), `${source.localFile} modificato`); }

(async () => {
  assert.strictEqual(refresh.assertAllowedSource(sources()[0]), true);
  assert.throws(() => refresh.assertAllowedSource({ ...sources()[0], url: 'https://example.com/file.csv' }), /HOST_BLOCKED/);
  assert.strictEqual(refresh.freshnessStatus('2026-07-10T00:00:00Z', '2026-07-15T00:00:00Z').status, 'CURRENT');
  assert.strictEqual(refresh.freshnessStatus('2026-06-10T00:00:00Z', '2026-07-15T00:00:00Z').status, 'AGING');
  assert.strictEqual(refresh.freshnessStatus('2026-05-01T00:00:00Z', '2026-07-15T00:00:00Z').status, 'STALE');

  const successDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch14-fixture-success-'));
  try {
    seed(successDir);
    const result = await refresh.refreshPlayerData({ dataDir: successDir, sources: sources(), downloader: async () => ({ statusCode: 200, text: csv(['20260501', '20260701', '20260702']), headers: { etag: 'fixture' } }), playerEvidence: evidence({ dir: successDir }), now: new Date('2026-07-15T00:00:00Z'), operationId: 'PATCH14_FIXTURE_SUCCESS' });
    assert.strictEqual(result.success, true); assert.strictEqual(result.stakePolicyChanged, false); assert.strictEqual(result.probabilityWeightsChanged, false);
    assert.strictEqual(refresh.inspectCsvFile(path.join(successDir, sources()[0].localFile), sources()[0]).validRows, 3);
    assert(fs.existsSync(result.manifest.lastKnownGoodBackup));
  } finally { fs.rmSync(successDir, { recursive: true, force: true }); }

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch14-fixture-download-failure-'));
  try {
    seed(downloadDir); const before = bytes(downloadDir); let call = 0; let failed = false;
    try { await refresh.refreshPlayerData({ dataDir: downloadDir, sources: sources(), downloader: async () => { call += 1; if (call === 2) throw new Error('FORCED_DOWNLOAD_FAILURE'); return { statusCode: 200, text: csv(['20260501', '20260702']), headers: {} }; }, playerEvidence: evidence({ dir: downloadDir }), now: new Date('2026-07-15T00:00:00Z'), operationId: 'PATCH14_FIXTURE_DOWNLOAD_FAIL' }); } catch (error) { failed = /FORCED_DOWNLOAD_FAILURE/.test(error.message); }
    assert.strictEqual(failed, true); assertBytes(downloadDir, before);
  } finally { fs.rmSync(downloadDir, { recursive: true, force: true }); }

  const activeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch14-fixture-active-failure-'));
  try {
    seed(activeDir); const before = bytes(activeDir); let caught = null;
    try { await refresh.refreshPlayerData({ dataDir: activeDir, sources: sources(), downloader: async () => ({ statusCode: 200, text: csv(['20260501', '20260702']), headers: {} }), playerEvidence: evidence({ dir: activeDir, failActiveOnce: true }), now: new Date('2026-07-15T00:00:00Z'), operationId: 'PATCH14_FIXTURE_ACTIVE_FAIL' }); } catch (error) { caught = error; }
    assert(caught && /FORCED_ACTIVE_RELOAD_FAILURE/.test(caught.message)); assert.strictEqual(caught.patch14.restoredLastKnownGood, true); assertBytes(activeDir, before);
  } finally { fs.rmSync(activeDir, { recursive: true, force: true }); }

  console.log('PATCH14 deterministic refresh fixtures PASS: allowlist, freshness, success, download rollback and active-reload LKG restore.');
})().catch(error => { console.error(error.stack || error.message); process.exit(2); });
