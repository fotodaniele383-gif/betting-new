'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const mod=require(path.join(root,'backend/aiPredictionIndexBandPerformance'));
const rows=[
 {sport_type:'CALCIO',status:'WON',bet_type:'SINGLE_1X2',league:'Serie A',calcio_prediction_index_score:84,calcio_prediction_reliability_score:81,stake:2,paper_result_active:1,paper_result_conflict:0},
 {sport_type:'CALCIO',status:'LOST',bet_type:'SINGLE_1X2',league:'Serie A',calcio_prediction_index_score:86,calcio_prediction_reliability_score:73,stake:0,paper_result_active:1,paper_result_conflict:0},
 {sport_type:'CALCIO',status:'PENDING',bet_type:'SINGLE_1X2',league:'Serie A',calcio_prediction_index_score:85,stake:2},
 {sport_type:'TENNIS',status:'WON',bet_type:'TENNIS_ATP_MONEYLINE',league:'[ATP] Masters 1000',quality_final_score:90,model_confidence_score:75,edge_pp:7,ev_pct:10,ds_action:'VALUE_CONFIRMED',historical_combo_resolved:23,historical_combo_adjusted_rate_pct:69,data_sufficiency_score:80,stake:2,paper_result_active:1,paper_result_conflict:0},
 {sport_type:'TENNIS',status:'LOST',bet_type:'TENNIS_ATP_MONEYLINE',league:'[ATP] Masters 1000',quality_final_score:70,model_confidence_score:60,edge_pp:3,ev_pct:5,ds_action:'MODEL_RISK',historical_combo_resolved:23,historical_combo_adjusted_rate_pct:55,data_sufficiency_score:60,stake:0,paper_result_active:1,paper_result_conflict:0},
 {sport_type:'TENNIS',status:'WON',bet_type:'MULTI_TENNIS',quality_final_score:90,model_confidence_score:90,stake:2,paper_result_active:1,paper_result_conflict:0}
];
const calcio=mod.buildAiPredictionIndexBandPerformance(rows,{sport:'CALCIO'}), tennis=mod.buildAiPredictionIndexBandPerformance(rows,{sport:'TENNIS'});
assert.strictEqual(calcio.scopes.AI_SIGNALS.overall.summary.resolved,2); assert.strictEqual(calcio.scopes.AI_SIGNALS.overall.summary.won,1); assert.strictEqual(calcio.scopes.REAL_STAKE.overall.summary.resolved,1);
const cBand=calcio.scopes.AI_SIGNALS.overall.bands.find(x=>x.key==='80_90'); assert.strictEqual(cBand.won,1); assert.strictEqual(cBand.lost,1);
assert.strictEqual(tennis.scopes.AI_SIGNALS.overall.summary.resolved,2); assert.strictEqual(tennis.scopes.REAL_STAKE.overall.summary.resolved,1);
assert(tennis.scopes.AI_SIGNALS.overall.summary.averagePredictionIndex>=0&&tennis.scopes.AI_SIGNALS.overall.summary.averagePredictionIndex<=100);
assert.strictEqual(calcio.safeguards.outcomeUsedOnlyForAggregation,true); assert.strictEqual(calcio.safeguards.indexDoesNotAuthorizeStake,true);
const dbPath=path.join(root,'backend/database_betting.db'); const before=crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(dbPath,{readOnly:true}); const dbRows=db.prepare("SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND UPPER(COALESCE(bet_type,'')) NOT LIKE '%MULTI%'").all(); db.close();
const realTennis=mod.buildAiPredictionIndexBandPerformance(dbRows,{sport:'TENNIS'}); const realCalcio=mod.buildAiPredictionIndexBandPerformance(dbRows,{sport:'CALCIO'});
const after=crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex'); assert.strictEqual(after,before); assert(realTennis.scopes.AI_SIGNALS.overall.summary.resolved>0); assert(realCalcio.scopes.AI_SIGNALS.overall.summary.resolved>0);
console.log(JSON.stringify({success:true,patch:'PATCH49',checks:14,calcioResolved:realCalcio.scopes.AI_SIGNALS.overall.summary.resolved,tennisResolved:realTennis.scopes.AI_SIGNALS.overall.summary.resolved,dbByteIdentical:true},null,2));
