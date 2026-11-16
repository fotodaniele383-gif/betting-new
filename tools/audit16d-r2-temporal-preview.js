#!/usr/bin/env node
'use strict';
const path=require('path'),fs=require('fs'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const temporal=require(path.join(root,'backend','calcioTemporalAnalysisPolicyAudit16dR2'));
const dbPath=path.join(root,'backend','database_betting.db');
function sha(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}
function upper(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();}
const before=sha(dbPath); const db=new DatabaseSync(dbPath,{readOnly:true});
let rows=[];try{rows=db.prepare(`SELECT id,match_date,status,ds_action,calcio_deepscan_raw_action,calcio_deepscan_final_state_action,calcio_timing_status,calcio_prediction_reliability_score,calcio_prediction_reliability_label,calcio_prediction_index_score,calcio_prediction_index_label,calcio_quality_final_label FROM ai_forward_test WHERE UPPER(sport_type)='CALCIO' ORDER BY id`).all();}finally{db.close();}
const active=rows.filter(r=>upper(r.status)==='PENDING');
const stages={}; const rawActions={}; const finalActions={}; let divergent=0,preliminary=0,preliminaryHighRisk=0;
const examples=[];
for(const r of active){const t=temporal.evaluate({matchDate:r.match_date});stages[t.stage]=(stages[t.stage]||0)+1;const raw=String(r.calcio_deepscan_raw_action||'').trim(),fin=String(r.calcio_deepscan_final_state_action||r.ds_action||'').trim();if(raw)rawActions[raw]=(rawActions[raw]||0)+1;if(fin)finalActions[fin]=(finalActions[fin]||0)+1;if(raw&&fin&&upper(raw)!==upper(fin)){divergent++;if(examples.length<12)examples.push({id:r.id,matchDate:r.match_date,stage:t.stage,rawAction:raw,operationalAction:fin,reliability:r.calcio_prediction_reliability_score,predictionIndex:r.calcio_prediction_index_score,quality:r.calcio_quality_final_label});}if(temporal.isPreliminary(t.stage)){preliminary++;if(upper(fin).includes('ALTO RISCHIO'))preliminaryHighRisk++;}}
const after=sha(dbPath);const out={success:before===after,patch:'AUDIT16D_R2',readOnly:true,version:temporal.VERSION,calcio:{total:rows.length,pending:active.length,stages,preliminary,preliminaryHighRisk,rawVsOperationalDivergent:divergent,rawActions,operationalActions:finalActions,examples},authority:{databaseMutation:false,probabilityMutation:false,stakeMutation:false,deepScanProductionMutation:false,automaticTradingPromotion:false},database:{before,after,unchanged:before===after}};
console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
