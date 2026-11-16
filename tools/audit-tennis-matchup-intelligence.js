'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const evidence = require('../backend/tennisPlayerEvidence');
const intelligence = require('../backend/tennisMatchupIntelligence');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '../backend/database_betting.db');
try { evidence.init(path.resolve(__dirname, '../backend/sackmann_data')); } catch (_) {}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const report = intelligence.getIntelligenceHealth(db, { limit: 100 });
  console.log(JSON.stringify({ ...report, readOnly: true }, null, 2));
  if (['SCHEMA_MISSING','INTEGRITY_ERROR'].includes(report.status)) process.exitCode = 2;
} finally { db.close(); }
