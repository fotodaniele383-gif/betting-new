'use strict';
const { DatabaseSync } = require('node:sqlite');
const challenger = require('../backend/tennisStatisticalChallenger');
const results=[];function test(name,fn){try{fn();results.push({name,success:true});}catch(e){results.push({name,success:false,error:e.message});}}
function assert(ok,msg){if(!ok)throw new Error(msg);}
function fixture(count=100){return Array.from({length:count},(_,i)=>({
  evaluationId:`E${String(i+1).padStart(3,'0')}`,betId:i+1,tour:i%2?'WTA':'ATP',matchStartAt:new Date(Date.UTC(2026,0,1+i)).toISOString(),actualWinnerSide:i%3===0?2:1,
  productionProbabilityP1:i%3===0?0.60:0.55,historicalProbabilityP1:i%3===0?0.40:0.65,confidenceScore:i%4*30,agreementStatus:'AGREES_WITH_PRODUCTION',seasonP1:2025,seasonP2:2025,sourceEvaluationHash:`H${i}`
}));}
test('griglia peso limitata a 0.50',()=>{const g=challenger.weightGrid();assert(g[0]===0 && g.at(-1)===0.5 && g.length===11,JSON.stringify(g));});
test('blend convesso',()=>assert(challenger.blendProbability(0.6,0.4,0.5)===0.5,'blend'));
test('boundary cinque fold',()=>assert(JSON.stringify(challenger.temporalBoundaries(100,5))==='[0,20,40,60,80,100]','boundaries'));
test('selezione minimizza Brier e tie preferisce peso minore',()=>{const r=challenger.selectBlendWeight(fixture(20));assert(r.weight>=0&&r.weight<=0.5,'weight');});
test('cross-fit usa solo righe precedenti',()=>{const r=challenger.temporalCrossFit(fixture(100), { minTrainRows: 20 });assert(r.warmupRows===20,'warmup');assert(r.folds.every((f,i)=>f.trainingRows===[20,40,60,80][i]),JSON.stringify(r.folds));assert(r.predictions.length===80,'predictions');});
test('bootstrap deterministico',()=>{const p=challenger.temporalCrossFit(fixture(100), { minTrainRows: 20 }).predictions;const a=challenger.deterministicBootstrap(p),b=challenger.deterministicBootstrap(p);assert(JSON.stringify(a)===JSON.stringify(b),'nondeterministic');});
test('schema append-only',()=>{const db=new DatabaseSync(':memory:');const s=challenger.ensureStatisticalChallengerSchema(db);assert(s.tables.length===2,'tables');let blocked=false;db.prepare(`INSERT INTO ${challenger.TABLE_RUNS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('R','a','b',1,0,0,0,null,null,null,null,null,null,'X','{}','H','V');try{db.prepare(`UPDATE ${challenger.TABLE_RUNS} SET stability_status='Y'`).run();}catch(e){blocked=/IMMUTABLE/.test(e.message);}assert(blocked,'update not blocked');db.close();});
test('guard non concede autorità',()=>{const report=challenger.buildTemporalCrossFitReport(fixture(100),{generatedAt:'2026-01-01T00:00:00Z',minTrainRows:20});assert(report.stabilityGuard.eligible===false,'eligible');assert(report.authority.modelProbability===false,'authority');});
const report={success:results.every(x=>x.success),patch:'18',tests:results.length,passed:results.filter(x=>x.success).length,results};console.log(JSON.stringify(report,null,2));if(!report.success)process.exit(2);
