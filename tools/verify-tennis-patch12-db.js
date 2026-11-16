'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const evidence = require('../backend/tennisPlayerEvidence');
const intelligence = require('../backend/tennisMatchupIntelligence');
const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch12'); fs.mkdirSync(auditDir, { recursive: true });
const db = new Database(dbPath, { fileMustExist: true });
const count = table => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
try {
  evidence.init(path.join(root, 'backend', 'sackmann_data'));
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const tables = ['tennis_player_evidence_snapshots','tennis_matchup_feature_snapshots','tennis_challenger_predictions'];
  const tableCount = Object.fromEntries(tables.map(t => [t, Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t).n)]));
  const triggers = ['trg_tennis_player_evidence_no_update','trg_tennis_player_evidence_no_delete','trg_tennis_matchup_features_no_update','trg_tennis_matchup_features_no_delete','trg_tennis_challenger_no_update','trg_tennis_challenger_no_delete'];
  const triggerCount = Object.fromEntries(triggers.map(t => [t, Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name=?").get(t).n)]));
  const before = Object.fromEntries(tables.map(t => [t, tableCount[t] ? count(t) : null]));
  let canary = { success: false, rollback: false, immutable: false };
  if (Object.values(tableCount).every(v => v === 1)) {
    try {
      db.exec('BEGIN');
      const result = intelligence.persistMatchupIntelligenceForBet(db,
        { id: 912012, home_team: 'Jannik Sinner', away_team: 'Novak Djokovic', match_date: '2026-07-10T12:00:00Z', surface: 'Grass', tour_type: 'ATP', prediction: '1', estimated_prob: 68, market_implied_prob: 65, market_type: 'h2h', reference_odd1: 1.50, reference_odd2: 3.00 },
        { home: 'Jannik Sinner', away: 'Novak Djokovic', date: '2026-07-10T12:00:00Z', surface: 'Grass', tour_type: 'ATP', prediction: '1', estimatedProb: 68, marketImpliedProbability: 65, marketType: 'h2h', referenceOdd1: 1.50, referenceOdd2: 3.00 },
        { snapshotId: 'PATCH12_DB_VERIFY_SNAPSHOT', operationId: 'PATCH12_DB_VERIFY', dataDir: path.join(root, 'backend', 'sackmann_data'), cohort: { cohort_id: 'PATCH12_VERIFY_COHORT', cohort_role: 'DEVELOPMENT' } }
      );
      let updateBlocked = false; let deleteBlocked = false;
      try { db.prepare('UPDATE tennis_challenger_predictions SET challenger_status=? WHERE challenger_id=?').run('MUTATED', result.challengerId); } catch (error) { updateBlocked = /PATCH12_CHALLENGER_IMMUTABLE/.test(error.message); }
      try { db.prepare('DELETE FROM tennis_player_evidence_snapshots WHERE evidence_id=?').run(result.p1EvidenceId); } catch (error) { deleteBlocked = /PATCH12_PLAYER_EVIDENCE_IMMUTABLE/.test(error.message); }
      canary = { success: Boolean(result.persisted), challengerStatus: result.intelligence?.challenger?.status, updateBlocked, deleteBlocked, immutable: updateBlocked && deleteBlocked };
    } finally {
      db.exec('ROLLBACK');
      canary.rollback = true;
    }
  }
  const after = Object.fromEntries(tables.map(t => [t, tableCount[t] ? count(t) : null]));
  const health = intelligence.getIntelligenceHealth(db, { limit: 20 });
  const sourceRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
  const tennisRows = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n);
  const countsRestored = tables.every(t => before[t] === after[t]);
  const result = {
    success: integrity === 'ok' && Object.values(tableCount).every(v => v === 1) && Object.values(triggerCount).every(v => v === 1) && canary.success && canary.rollback && canary.immutable && countsRestored && health.integrity?.orphanMatchups === 0 && health.integrity?.orphanChallengers === 0,
    patch: '12', integrity, sourceRows, tennisRows, tableCount, triggerCount, before, after, countsRestored, canary, health, historicalBackfill: false
  };
  fs.writeFileSync(path.join(auditDir, 'patch12_db_verification_report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
} finally { db.close(); }
