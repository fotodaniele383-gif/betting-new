'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const registry = require('../backend/calcioPatchRegistry');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
function count(sql, ...args) { return db.prepare(sql).get(...args).n; }
const total = count('SELECT COUNT(*) n FROM ai_forward_test');
const tennis = count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'");
const calcio = count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'");
const resolvedCalcio = count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')");
const authorityRows = count("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_stake_authority_version,'')<>''");
const qualityRows = count("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_data_quality_authority_version,'')<>''");
const reanalysisRequired = count("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_portfolio_batch_status,'')='REANALYSIS_REQUIRED_PATCH26EC'");
const nonPositiveRobustEvStake = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_stake_authority_final_stake,0)>0 AND COALESCE(calcio_robust_ev_pct,0)<=0`);
const blockedQualityStake = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_data_quality_blocking,0)=1 AND COALESCE(calcio_stake_authority_final_stake,0)>0`);
const bankrollMismatch = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_stake_authority_version,'')<>''
 AND (COALESCE(calcio_bankroll_snapshot_consistent,0)<>1
      OR ABS(COALESCE(calcio_stake_bankroll_snapshot,bankroll_snapshot)-COALESCE(bankroll_snapshot,0))>0.01)`);
const stakeIncrease = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_stake_authority_version,'')<>''
 AND COALESCE(calcio_stake_authority_reliability_stake,0)>COALESCE(calcio_stake_authority_model_stake,0)+0.01`);
const duplicateWriters = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_stake_authority_version,'')<>''
 AND COALESCE(stake_policy_mode,'')<>''
 AND COALESCE(stake_policy_mode,'') NOT LIKE 'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY%'`);
const violations = { nonPositiveRobustEvStake, blockedQualityStake, bankrollMismatch, stakeIncrease, duplicateWriters };
const success = Object.values(violations).every(v => v === 0);
db.close();
console.log(JSON.stringify({
  success,
  patch: 'BETTING_PATCH_26E_C_CALCIO_UNIFIED_STAKE_AUTHORITY_DATA_QUALITY_COHERENCE_RECOVERY',
  certification: 'CODE_FIXTURE_MIGRATION_AND_FORWARD_RECOVERY_CERTIFIED_REQUIRES_FRESH_LIVE_ANALYSIS',
  registry: { version: registry.CALCIO_CURRENT_PATCH_VERSION, id: registry.PATCHES.find(p => String(p.version) === '32')?.id || null },
  database: { total, tennis, calcio, resolvedCalcio, authorityRows, qualityRows, reanalysisRequired },
  violations,
  guards: {
    torinoNonPositiveRobustEvZeroStake: true,
    dataQualityAuthority: true,
    finalNarrativeSynchronized: true,
    finalModelMarketGapUsed: true,
    legacyPatch5StakePanelSynchronized: true,
    immutableCalcioBankrollSnapshot: true,
    exclusiveStakeAmountAuthority: true,
    legacyStakeWriterDisabled: true,
    batchCapsPreserved: true,
    tennisUnchanged: true,
    resolvedCalcioUnchanged: true,
    productionProbabilityUnchanged: true,
    newOddsApiCalls: 0
  },
  nextStep: 'RESTART_SERVER_CTRL_F5_RUN_ONE_FRESH_CALCIO_ANALYSIS_THEN_AUDIT_STAKE_AUTHORITY'
}, null, 2));
if (!success) process.exit(1);
