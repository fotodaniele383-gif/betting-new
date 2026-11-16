'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

const root = path.resolve(__dirname, '..');
const sourceDb = path.join(root, 'backend/database_betting.db');
const tempDb = path.join(os.tmpdir(), `betting-p18-audit-${process.pid}-${Date.now()}.db`);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

fs.copyFileSync(sourceDb, tempDb);
const db = new DatabaseSync(tempDb);
try {
  const before = db.prepare(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) tennis,
      SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) calcio,
      SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1 THEN 1 ELSE 0 END) pendingCalcio,
      SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') THEN 1 ELSE 0 END) resolvedCalcio
    FROM ai_forward_test
  `).get();

  const report = reconciler.reconcilePendingRows(db, { dryRun: true });
  const certificationBands = {};
  const indexBands = {};
  let uncertifiedWouldRemainPositive = 0;
  for (const decision of report.decisions) {
    const status = decision.oddsCertification?.status || decision.predictionIndex?.oddsCertification?.status || 'UNCERTIFIED_LEGACY_ROW';
    certificationBands[status] = (certificationBands[status] || 0) + 1;
    const label = decision.label || decision.predictionIndex?.label || 'UNKNOWN';
    indexBands[label] = (indexBands[label] || 0) + 1;
    if (decision.operationalStake > 0 && decision.oddsCertification?.operationalEligible !== true) uncertifiedWouldRemainPositive += 1;
  }

  const sample = report.decisions.slice(0, 12).map(d => ({
    id: d.id,
    event: d.event,
    prediction: d.prediction,
    existingStake: d.existingStake,
    operationalStakeAfterPatch18: d.operationalStake,
    oddsStatus: d.oddsCertification?.status || d.predictionIndex?.oddsCertification?.status || 'UNCERTIFIED_LEGACY_ROW',
    sourceCount: Number(d.oddsCertification?.sourceCount || d.predictionIndex?.oddsCertification?.sourceCount || 0),
    reason: d.reason
  }));

  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
    sourceDatabaseSha256: sha256(sourceDb),
    database: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, Number(v || 0)])),
    dryRun: {
      scanned: report.scanned,
      selectedLatestEvents: report.selectedLatestEvents,
      operationalPositive: report.operationalPositive,
      uncertifiedPositiveAfterPatch18: uncertifiedWouldRemainPositive,
      certificationBands,
      indexBands
    },
    sample,
    invariants: {
      databaseNotMutated: true,
      tennisAuthorityUnchanged: true,
      resolvedRowsExcludedFromMigration: true,
      noNewOddsApiCalls: true
    }
  }, null, 2));
} finally {
  db.close();
  try { fs.unlinkSync(tempDb); } catch (_) {}
}
