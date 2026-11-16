'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { sanitizeDatabase, triggerSchemaHash, listUserTriggers } = require('./create-tennis-safe-support-bundle');

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function readState(file) {
  const db = new DatabaseSync(file);
  try {
    return {
      payload: db.prepare('SELECT payload FROM tennis_information_retrieval_runs WHERE id = 1').get().payload,
      triggers: listUserTriggers(db),
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check
    };
  } finally { db.close(); }
}

function assertImmutable(file, expectedCode) {
  const db = new DatabaseSync(file);
  try {
    let blocked = false;
    try { db.prepare('UPDATE tennis_information_retrieval_runs SET payload=? WHERE id=1').run('mutated'); }
    catch (error) { blocked = String(error && error.message || error).includes(expectedCode); }
    assert(blocked, 'IMMUTABLE_TRIGGER_NOT_ACTIVE');
  } finally { db.close(); }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch22-r2-safe-support-'));
  const source = path.join(root, 'source.db');
  const destination = path.join(root, 'sanitized.db');
  try {
    const db = new DatabaseSync(source);
    try {
      db.exec(`
        CREATE TABLE tennis_information_retrieval_runs (
          id INTEGER PRIMARY KEY,
          payload TEXT NOT NULL
        );
        INSERT INTO tennis_information_retrieval_runs(id, payload)
        VALUES (1, '{"authorization":"Bearer abcdefghijklmnopqrstuvwxyz123456","token":"sk-ABCDEFGHIJKLMNOPQRSTUVWX"}');
        CREATE TRIGGER trg_tennis_info_runs_no_update
        BEFORE UPDATE ON tennis_information_retrieval_runs
        BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_RUN_IMMUTABLE'); END;
        CREATE TRIGGER trg_tennis_info_runs_no_delete
        BEFORE DELETE ON tennis_information_retrieval_runs
        BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_RUN_IMMUTABLE'); END;
      `);
    } finally { db.close(); }

    const sourceBefore = readState(source);
    assertImmutable(source, 'PATCH15_RETRIEVAL_RUN_IMMUTABLE');
    const report = await sanitizeDatabase(source, destination);
    const sourceAfter = readState(source);
    const sanitized = readState(destination);

    assert(sourceAfter.payload === sourceBefore.payload, 'SOURCE_DATABASE_MUTATED');
    assert(triggerSchemaHash(sourceAfter.triggers) === triggerSchemaHash(sourceBefore.triggers), 'SOURCE_TRIGGER_SCHEMA_CHANGED');
    assert(sanitized.payload.includes('[REDACTED]'), 'SANITIZED_VALUE_MISSING');
    assert(!sanitized.payload.includes('abcdefghijklmnopqrstuvwxyz123456'), 'BEARER_SECRET_NOT_REDACTED');
    assert(!sanitized.payload.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWX'), 'API_SECRET_NOT_REDACTED');
    assert(sanitized.integrity === 'ok', 'SANITIZED_DB_INTEGRITY_FAILED');
    assert(report.cellsRedacted === 1, 'EXPECTED_ONE_REDACTED_CELL');
    assert(report.immutableTriggerCompatibility === true, 'IMMUTABLE_COMPATIBILITY_NOT_REPORTED');
    assert(report.triggersTemporarilySuspended === 2 && report.triggersRestored === 2, 'TRIGGER_RESTORE_COUNT_MISMATCH');
    assert(triggerSchemaHash(sanitized.triggers) === triggerSchemaHash(sourceBefore.triggers), 'SANITIZED_TRIGGER_SCHEMA_CHANGED');
    assertImmutable(destination, 'PATCH15_RETRIEVAL_RUN_IMMUTABLE');

    console.log(JSON.stringify({
      success: true,
      patch: '22',
      revision: '22.0.2-R2',
      sourceUntouched: true,
      cellsRedacted: report.cellsRedacted,
      triggersTemporarilySuspended: report.triggersTemporarilySuspended,
      triggersRestored: report.triggersRestored,
      triggerSchemaHash: report.triggerSchemaHash,
      integrity: sanitized.integrity
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`PATCH22_R2_SAFE_SUPPORT_TEST_ERROR: ${error.stack || error.message}`);
  process.exit(2);
});
