'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const reconciler = require('../backend/calcioStakeReconciler');
const db = new DatabaseSync(path.resolve(__dirname, '../backend/database_betting.db'));
try {
  const report = reconciler.reconcilePendingRows(db, { dryRun: true });
  const focus = report.decisions.filter(x => ['Inter - Genoa','Newcastle - Liverpool'].includes(x.event));
  const bands = {};
  for (const d of report.decisions) bands[d.label] = (bands[d.label] || 0) + 1;
  console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_STAKE_AUTHORITY', summary: { scanned: report.scanned, operationalPositive: report.operationalPositive, bands }, focus }, null, 2));
} finally { db.close(); }
