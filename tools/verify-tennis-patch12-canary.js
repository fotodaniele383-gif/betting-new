'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const evidence = require('../backend/tennisPlayerEvidence');
const intelligence = require('../backend/tennisMatchupIntelligence');
const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const outDir = path.join(root, 'audit_patch12'); fs.mkdirSync(outDir, { recursive: true });
const db = new Database(dbPath, { fileMustExist: true });
const tables = ['tennis_player_evidence_snapshots','tennis_matchup_feature_snapshots','tennis_challenger_predictions'];
const counts = () => Object.fromEntries(tables.map(t => [t, Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n)]));
try {
  evidence.init(path.join(root, 'backend', 'sackmann_data'));
  intelligence.ensureMatchupIntelligenceSchema(db);
  const before = counts();
  let inside; let ids;
  try {
    db.exec('BEGIN');
    ids = intelligence.persistMatchupIntelligenceForBet(db,
      { id: 912099, home_team: 'Coco Gauff', away_team: 'Jessica Pegula', match_date: '2026-07-18T12:00:00Z', surface: 'Hard', tour_type: 'WTA', prediction: '1', estimated_prob: 55, market_implied_prob: 52, market_type: 'h2h', reference_odd1: 1.90, reference_odd2: 2.05 },
      { home: 'Coco Gauff', away: 'Jessica Pegula', date: '2026-07-18T12:00:00Z', surface: 'Hard', tour_type: 'WTA', prediction: '1', estimatedProb: 55, marketImpliedProbability: 52, marketType: 'h2h', referenceOdd1: 1.90, referenceOdd2: 2.05 },
      { snapshotId: 'PATCH12_CANARY_SNAPSHOT', operationId: 'PATCH12_CANARY', dataDir: path.join(root, 'backend', 'sackmann_data'), cohort: { cohort_id: 'PATCH12_CANARY_COHORT', cohort_role: 'HOLDOUT' } }
    );
    inside = counts();
  } finally { db.exec('ROLLBACK'); }
  const after = counts();
  const result = { success: Boolean(ids?.persisted) && tables.every(t => before[t] === after[t]), patch: '12', rollbackGuaranteed: true, before, inside, after, noPermanentRows: tables.every(t => before[t] === after[t]), challengerStatus: ids?.intelligence?.challenger?.status, matchupLabel: ids?.intelligence?.matchup?.matchupLabel, mode: intelligence.MODE, stakeAuthority: false };
  fs.writeFileSync(path.join(outDir, 'patch12_canary_report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); if (!result.success) process.exitCode = 2;
} finally { db.close(); }
