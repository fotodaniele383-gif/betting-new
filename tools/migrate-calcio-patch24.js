'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const reconciler = require('../backend/calcioStakeReconciler');
const PATCH = 'BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
function arg(name, fallback=null) { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : fallback; }
const dbPath = path.resolve(arg('--db', path.resolve(__dirname,'../backend/database_betting.db')));
const db = new Database(dbPath);
try {
  const before = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));
  db.exec('BEGIN IMMEDIATE');
  try { reconciler.ensurePredictionIndexColumns(db); db.exec('COMMIT'); } catch(e) { try{db.exec('ROLLBACK');}catch(_){} throw e; }
  const after = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));
  const added=[...after].filter(x=>!before.has(x));
  const counts=db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) tennis,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) calcio,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' THEN 1 ELSE 0 END) pendingCalcio
    FROM ai_forward_test`).get();
  console.log(JSON.stringify({success:true,patch:PATCH,dbPath,addedColumns:added,addedCount:added.length,dataRowsUpdated:0,counts},null,2));
} finally { db.close(); }
