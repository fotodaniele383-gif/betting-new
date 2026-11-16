'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');
const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../backend/database_betting.db');
const db = new DatabaseSync(dbPath);
try {
  const report = reconciler.reconcilePendingRows(db);
  console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_STAKE_AUTHORITY', dbPath, ...report }, null, 2));
} finally { db.close(); }
