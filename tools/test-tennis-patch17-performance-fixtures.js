'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const historical = require('../backend/tennisHistoricalPlayerStats');
const perf = require('../backend/tennisHistoricalValidationPerformance');
const datasetPath = path.resolve(__dirname, '..', 'data', 'tennisdb_historical_player_stats.json');
historical.loadDataset(datasetPath, { force:true });
const results=[];function test(name,fn){try{fn();results.push({name,success:true});}catch(e){results.push({name,success:false,error:e.message});}}
function assert(ok,msg){if(!ok)throw new Error(msg);}
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE ai_forward_test (id INTEGER PRIMARY KEY,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,league TEXT,tour_type TEXT,market_type TEXT,match_date TEXT,canonical_match_datetime TEXT,home_team TEXT,away_team TEXT,prediction TEXT,status TEXT,winner_side INTEGER,estimated_prob REAL);`);
db.prepare(`INSERT INTO ai_forward_test VALUES (1,'TENNIS','SINGLE_TENNIS_CR','TENNIS_ATP_MONEYLINE','ATP Test','ATP','moneyline','01/07/2026, 12:00:00',NULL,'Jannik Sinner','Carlos Alcaraz','1','WON',1,60)`).run();
db.prepare(`INSERT INTO ai_forward_test VALUES (2,'TENNIS','SINGLE_TENNIS_CR','TENNIS_ATP_MONEYLINE','ATP Test','ATP','moneyline','02/07/2026, 12:00:00',NULL,'Jannik Sinner','Novak Djokovic','2','LOST',1,58)`).run();
test('schema immutabile',()=>{const s=perf.ensureHistoricalValidationPerformanceSchema(db);assert(s.tables.length===2,'tables');});
test('benchmark as-of-safe',()=>{const r=perf.runRetrospectiveAudit(db,{datasetPath,persist:true});assert(r.coveredRows===2,`covered ${r.coveredRows}`);assert(r.performanceGate.status==='NOT_ELIGIBLE_RETROSPECTIVE_ONLY','gate');});
test('nessuna modifica sorgente',()=>assert(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n===2,'source rows'));
test('deduplica valutazioni',()=>{const r=perf.runRetrospectiveAudit(db,{datasetPath,persist:true});assert(r.persistence.duplicateEvaluations===2,'duplicates');});
test('trigger blocca update',()=>{let blocked=false;try{db.prepare(`UPDATE ${perf.TABLE_EVALUATIONS} SET tour='X'`).run();}catch(e){blocked=/IMMUTABLE/.test(e.message);}assert(blocked,'not blocked');});
test('forward senza snapshot resta no sample',()=>{const r=perf.refreshForwardPerformance(db,{persist:true});assert(r.coveredRows===0,'forward rows');assert(r.performanceGate.status==='NO_FORWARD_SAMPLE','forward gate');});
test('health non promuove',()=>{const h=perf.getPerformanceHealth(db);assert(h.authority.automaticPromotion===false,'promotion');assert(h.retrospectiveEvaluations===2,'retro count');});
db.close();
const report={success:results.every(x=>x.success),patch:'17',tests:results.length,passed:results.filter(x=>x.success).length,results};console.log(JSON.stringify(report,null,2));if(!report.success)process.exit(2);
