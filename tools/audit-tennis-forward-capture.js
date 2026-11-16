'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const capture = require('../backend/tennisForwardCaptureHealth');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '../backend/database_betting.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const report = capture.scanForwardCaptureHealth(db, { limit: 100 });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === capture.CAPTURE_STATUS.BLOCKED && process.argv.includes('--strict')) process.exitCode = 2;
} finally { db.close(); }
