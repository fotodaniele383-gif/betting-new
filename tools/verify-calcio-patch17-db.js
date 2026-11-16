'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');
const src = path.resolve(__dirname,'../backend/database_betting.db');
const tmp = path.join(os.tmpdir(),`betting-p17-${process.pid}-${Date.now()}.db`); fs.copyFileSync(src,tmp);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const db = new DatabaseSync(tmp);
try {
  const tennisBefore = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) s FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get();
  const resolvedBefore = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) s, COALESCE(SUM(profit),0) p FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get();
  const first = reconciler.reconcilePendingRows(db);
  const inter = db.prepare("SELECT * FROM ai_forward_test WHERE home_team='Inter' AND away_team='Genoa' ORDER BY id DESC LIMIT 1").get();
  const newcastle = db.prepare("SELECT * FROM ai_forward_test WHERE home_team='Newcastle' AND away_team='Liverpool' ORDER BY id DESC LIMIT 1").get();
  assert(inter.calcio_prediction_index_score >= 45 && inter.calcio_prediction_index_score < 60);
  assert.strictEqual(Number(inter.stake),0);
  assert(newcastle.calcio_prediction_index_score >= 60);
  assert(Number(newcastle.stake) >= 2);
  assert(first.operationalPositive > 0);
  const second = reconciler.reconcilePendingRows(db);
  assert.strictEqual(second.updated,0,'Reconciliation must be idempotent');
  const tennisAfter = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) s FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get();
  const resolvedAfter = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) s, COALESCE(SUM(profit),0) p FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get();
  assert.deepStrictEqual({...tennisAfter},{...tennisBefore}); assert.deepStrictEqual({...resolvedAfter},{...resolvedBefore});
  console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_STAKE_AUTHORITY',sourceSha256:sha(src),first:{updated:first.updated,operationalPositive:first.operationalPositive},second:{updated:second.updated},focus:{inter:{score:inter.calcio_prediction_index_score,stake:inter.stake,label:inter.calcio_prediction_index_label},newcastle:{score:newcastle.calcio_prediction_index_score,stake:newcastle.stake,label:newcastle.calcio_prediction_index_label}},tennisUnchanged:true,resolvedCalcioUnchanged:true},null,2));
} finally { db.close(); try{fs.unlinkSync(tmp)}catch(_){} }
