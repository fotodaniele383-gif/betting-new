'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('./sqlite-compat');

const RETRYABLE_SQLITE_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_IOERR',
  'SQLITE_PROTOCOL'
]);

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function removeSnapshotArtifacts(target) {
  for (const file of [target, `${target}-wal`, `${target}-shm`]) {
    try { fs.rmSync(file, { force: true }); } catch (_) {}
  }
}

function createConsistentSqliteSnapshot(source, target, options = {}) {
  if (!source || !fs.existsSync(source)) {
    const error = new Error(`Database sorgente non disponibile: ${source || 'N/D'}`);
    error.code = 'PATCH26FA_SNAPSHOT_SOURCE_MISSING';
    throw error;
  }
  const attempts = Number.isFinite(options.attempts) ? Math.max(1, Number(options.attempts)) : 6;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? Math.max(25, Number(options.retryDelayMs)) : 150;
  fs.mkdirSync(path.dirname(target), { recursive: true });

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    removeSnapshotArtifacts(target);
    let sourceDb = null;
    try {
      sourceDb = new Database(source, { readonly: true });
      sourceDb.exec(`VACUUM INTO ${sqlString(target)}`);
      sourceDb.close();
      sourceDb = null;
      if (!fs.existsSync(target) || fs.statSync(target).size <= 0) {
        const error = new Error('VACUUM INTO non ha prodotto uno snapshot valido.');
        error.code = 'PATCH26FA_SNAPSHOT_EMPTY';
        throw error;
      }
      return {
        success: true,
        mode: 'SQLITE_VACUUM_INTO_WAL_AWARE',
        attempts: attempt,
        source,
        target,
        sizeBytes: fs.statSync(target).size
      };
    } catch (error) {
      lastError = error;
      try { sourceDb?.close(); } catch (_) {}
      const code = String(error?.code || '');
      const message = String(error?.message || '');
      const retryable = RETRYABLE_SQLITE_CODES.has(code)
        || /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
      if (!retryable || attempt >= attempts) break;
      sleepSync(retryDelayMs * attempt);
    }
  }

  removeSnapshotArtifacts(target);
  const wrapped = new Error(`Snapshot SQLite coerente fallito: ${lastError?.message || 'errore sconosciuto'}`);
  wrapped.code = 'PATCH26FA_SQLITE_SNAPSHOT_FAILED';
  wrapped.cause = lastError;
  throw wrapped;
}

module.exports = {
  createConsistentSqliteSnapshot,
  removeSnapshotArtifacts,
  sqlString
};
