'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const capture = require('../backend/tennisForwardCaptureHealth');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '../backend/database_betting.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const totalRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
  const report = capture.scanForwardCaptureHealth(db, { limit: 100 });
  const result = { success: integrity === 'ok', patch: '11', integrity, totalRows, capture: report, captureBlocked: report.status === 'BLOCKED', readOnly: true };
  const out = path.resolve(__dirname, '../audit_patch11'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'patch11_db_verification_report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
} finally { db.close(); }
