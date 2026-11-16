'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('./sqlite-compat');
const { createConsistentSqliteSnapshot } = require('./patch26fa-sqlite-snapshot');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fa-wal-snapshot-'));
const liveDbPath = path.join(tempDir, 'live.db');
const rawCopyPath = path.join(tempDir, 'raw-copy.db');
const snapshotPath = path.join(tempDir, 'snapshot.db');
let liveDb = null;
let rawCopyRows = null;
try {
  liveDb = new Database(liveDbPath);
  liveDb.pragma?.('journal_mode = WAL');
  liveDb.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  liveDb.exec('CREATE TABLE patch26fa_wal_fixture(id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  const insert = liveDb.prepare('INSERT INTO patch26fa_wal_fixture(value) VALUES (?)');
  liveDb.exec('BEGIN IMMEDIATE');
  try {
    for (let i = 1; i <= 10; i += 1) insert.run(`row-${i}`);
    liveDb.exec('COMMIT');
  } catch (error) {
    try { liveDb.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }

  fs.copyFileSync(liveDbPath, rawCopyPath);
  try {
    const rawDb = new Database(rawCopyPath, { readonly: true });
    try { rawCopyRows = Number(rawDb.prepare('SELECT COUNT(*) n FROM patch26fa_wal_fixture').get().n); }
    finally { rawDb.close(); }
  } catch (_) {
    rawCopyRows = 0;
  }

  const snapshot = createConsistentSqliteSnapshot(liveDbPath, snapshotPath);
  const snapshotDb = new Database(snapshotPath, { readonly: true });
  let snapshotRows;
  try { snapshotRows = Number(snapshotDb.prepare('SELECT COUNT(*) n FROM patch26fa_wal_fixture').get().n); }
  finally { snapshotDb.close(); }

  assert.strictEqual(snapshotRows, 10);
  assert(snapshot.mode === 'SQLITE_VACUUM_INTO_WAL_AWARE');
  console.log(JSON.stringify({
    success: true,
    check: 'WAL_AWARE_SQLITE_SNAPSHOT',
    rawCopyRows,
    snapshotRows,
    snapshotMode: snapshot.mode,
    attempts: snapshot.attempts
  }, null, 2));
} finally {
  try { liveDb?.close(); } catch (_) {}
  try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); } catch (_) {}
}
