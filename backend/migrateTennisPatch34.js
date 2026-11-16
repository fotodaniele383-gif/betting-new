#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const schedule = require('./tennisOfficialScheduleAuthority');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(value => /\.db$/i.test(value));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');

function openDb() {
  try { const BetterSqlite3 = require('better-sqlite3'); return new BetterSqlite3(dbPath); }
  catch (_) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(dbPath); }
}
function cols(db, table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(table)); }

const AI_COLUMNS = [
  ['official_schedule_contract_version','TEXT'],
  ['official_schedule_receipt_id','TEXT'],
  ['official_schedule_source_kind','TEXT'],
  ['official_schedule_source_id','TEXT'],
  ['official_schedule_status','TEXT'],
  ['official_schedule_transition_type','TEXT'],
  ['official_schedule_effective_start_at_utc','TEXT'],
  ['official_schedule_capture_disposition','TEXT'],
  ['official_schedule_observation_hash','TEXT'],
  ['official_schedule_checked_at','TEXT']
];
const REJECTED_COLUMNS = [
  ['schedule_contract_version','TEXT'],
  ['schedule_receipt_id','TEXT'],
  ['schedule_status','TEXT'],
  ['schedule_transition_type','TEXT'],
  ['schedule_capture_disposition','TEXT'],
  ['schedule_block_reason','TEXT']
];

if (!fs.existsSync(dbPath)) {
  console.log(JSON.stringify({ success: false, code: 'DATABASE_NOT_FOUND', dbPath }, null, 2));
  process.exit(1);
}

const db = openDb();
let output;
try {
  const beforeAi = cols(db, 'ai_forward_test');
  const missingAi = AI_COLUMNS.filter(([name]) => !beforeAi.has(name));
  const rejectedExists = tableExists(db, 'tennis_rejected_capture_ledger');
  const beforeRejected = rejectedExists ? cols(db, 'tennis_rejected_capture_ledger') : new Set();
  const missingRejected = REJECTED_COLUMNS.filter(([name]) => !beforeRejected.has(name));
  const scheduleTableExists = tableExists(db, 'tennis_schedule_receipts');
  const rowsBefore = scheduleTableExists ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n || 0) : 0;

  if (apply) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [name, type] of missingAi) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
      if (rejectedExists) for (const [name, type] of missingRejected) db.exec(`ALTER TABLE tennis_rejected_capture_ledger ADD COLUMN ${name} ${type}`);
      schedule.ensureSchema(db);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  const afterAi = cols(db, 'ai_forward_test');
  const afterRejected = rejectedExists ? cols(db, 'tennis_rejected_capture_ledger') : new Set();
  const rowsAfter = tableExists(db, 'tennis_schedule_receipts') ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n || 0) : null;
  output = {
    success: true,
    patch: 'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE',
    mode: preview ? 'PREVIEW' : 'APPLY',
    dbPath,
    migration: 'ADDITIVE_FORWARD_ONLY_OFFICIAL_SCHEDULE_RECEIPT_LEDGER',
    aiForwardColumns: {
      required: AI_COLUMNS.map(item => item[0]),
      missingBefore: missingAi.map(item => item[0]),
      missingAfter: AI_COLUMNS.map(item => item[0]).filter(name => !afterAi.has(name))
    },
    rejectedLedgerColumns: {
      tableExists: rejectedExists,
      required: REJECTED_COLUMNS.map(item => item[0]),
      missingBefore: missingRejected.map(item => item[0]),
      missingAfter: rejectedExists ? REJECTED_COLUMNS.map(item => item[0]).filter(name => !afterRejected.has(name)) : []
    },
    scheduleReceiptLedger: {
      existedBefore: scheduleTableExists,
      rowsBefore,
      rowsAfter,
      noHistoricalBackfill: rowsAfter === rowsBefore
    },
    businessRowsChanged: false,
    schemaChanged: apply && (missingAi.length > 0 || missingRejected.length > 0 || !scheduleTableExists)
  };
} finally {
  db.close();
}

console.log(JSON.stringify(output, null, 2));
