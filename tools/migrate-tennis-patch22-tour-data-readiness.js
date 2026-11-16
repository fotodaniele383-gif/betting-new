'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const matchup = require('../backend/tennisMatchupIntelligence');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch22');
const reportPath = path.join(auditDir, 'patch22_migration_report.json');
const TABLES = ['tennis_player_evidence_snapshots', 'tennis_matchup_feature_snapshots', 'tennis_challenger_predictions'];
const EXPECTED = {
  tennis_player_evidence_snapshots: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_status','activity_days','source_freshness_penalty','activity_penalty'],
  tennis_matchup_feature_snapshots: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_risk_status'],
  tennis_challenger_predictions: ['source_target_id','source_provider_id','source_freshness_status','source_freshness_days','activity_risk_status']
};
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function count(db, table){try{return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n||0);}catch(_){return 0;}}
function columns(db, table){return db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);}
if (!fs.existsSync(dbPath)) throw new Error(`PATCH22_DB_MISSING:${dbPath}`);
fs.mkdirSync(auditDir,{recursive:true});
const db = new Database(dbPath,{fileMustExist:true});
const operationId = `PATCH22_TOUR_DATA_${new Date().toISOString().replace(/\D/g,'').slice(0,14)}_${crypto.randomBytes(4).toString('hex')}`;
try {
  const integrityBefore = db.pragma('integrity_check',{simple:true});
  const sourceRowsBefore = count(db,'ai_forward_test');
  const tennisRowsBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
  const tableRowsBefore = Object.fromEntries(TABLES.map(t=>[t,count(db,t)]));
  const columnsBefore = Object.fromEntries(TABLES.map(t=>[t,columns(db,t)]));
  const tx = db.transaction(()=>matchup.ensureMatchupIntelligenceSchema(db));
  const schema = tx();
  const columnsAfter = Object.fromEntries(TABLES.map(t=>[t,columns(db,t)]));
  const tableRowsAfter = Object.fromEntries(TABLES.map(t=>[t,count(db,t)]));
  const sourceRowsAfter = count(db,'ai_forward_test');
  const tennisRowsAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
  const integrityAfter = db.pragma('integrity_check',{simple:true});
  const missingColumns = Object.fromEntries(Object.entries(EXPECTED).map(([t,cols])=>[t,cols.filter(c=>!columnsAfter[t].includes(c))]));
  const columnsAdded = Object.fromEntries(Object.entries(EXPECTED).map(([t,cols])=>[t,cols.filter(c=>!columnsBefore[t].includes(c)&&columnsAfter[t].includes(c))]));
  const success = integrityBefore==='ok' && integrityAfter==='ok' && sourceRowsBefore===sourceRowsAfter && tennisRowsBefore===tennisRowsAfter && TABLES.every(t=>tableRowsBefore[t]===tableRowsAfter[t]) && Object.values(missingColumns).every(x=>x.length===0);
  const report = {success,patch:'22',version:'TENNIS_TOUR_DATA_READINESS_V1_PATCH22',operationId,dbPath,sourceRowsBefore,sourceRowsAfter,tennisRowsBefore,tennisRowsAfter,tableRowsBefore,tableRowsAfter,columnsAdded,missingColumns,historicalBackfill:false,sourceRowsModified:0,schema,integrityBefore,integrityAfter,dbHashAfter:sha(dbPath),timestamp:new Date().toISOString()};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!success) process.exitCode=2;
} finally { db.close(); }
