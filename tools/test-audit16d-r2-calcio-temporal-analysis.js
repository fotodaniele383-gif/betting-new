#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const temporal=require(path.join(root,'backend','calcioTemporalAnalysisPolicyAudit16dR2'));
const finalState=require(path.join(root,'backend','calcioDeepScanFinalState'));
const adaptive=require(path.join(root,'backend','adaptiveLearningShadowAudit16d'));
const checks=[]; const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
(async()=>{
  try{
    const now=new Date('2026-09-25T10:00:00.000Z');
    const early=temporal.evaluate({matchDate:'2026-10-16T18:45:00.000Z'},now);
    const mid=temporal.evaluate({matchDate:'2026-09-30T10:00:00.000Z'},now);
    const full=temporal.evaluate({matchDate:'2026-09-26T10:00:00.000Z'},now);
    const past=temporal.evaluate({matchDate:'2026-09-24T10:00:00.000Z'},now);
    add('Version temporal policy',temporal.VERSION==='AUDIT16D_R2_CALCIO_TEMPORAL_ANALYSIS_POLICY_V1');
    add('Early >7d classified preview',early.stage==='EARLY_PREVIEW'&&early.shouldDeferNews===true&&early.liveNewsMode==='DEFERRED',early);
    add('Mid 2-7d classified bounded',mid.stage==='MID_PREMATCH'&&mid.liveNewsMode==='BOUNDED'&&mid.providerTimeoutMs===2500,mid);
    add('Full <=48h classified full',full.stage==='FULL_PREMATCH'&&full.liveNewsMode==='FULL',full);
    add('Past closes prematch news',past.stage==='LIVE_OR_PAST'&&past.shouldDeferNews===true,past);
    const def=temporal.deferredTeamProfile('Test FC');
    add('Deferred news is UNKNOWN not positive',def.score===0&&def.tactics.keyPlayerOut===false&&def.sourceError===null&&def.sourceIntelligence.status==='DEFERRED_TEMPORAL',def);

    const deepScanSource=fs.readFileSync(path.join(root,'backend','deepScanCalcio.js'),'utf8');
    add('DeepScan imports temporal policy',deepScanSource.includes("require('./calcioTemporalAnalysisPolicyAudit16dR2')"));
    add('Early DeepScan defers live news',deepScanSource.includes('temporalAnalysis.shouldDeferNews')&&deepScanSource.includes('deferredTeamProfile(home)')&&deepScanSource.includes("liveNewsMode === 'DEFERRED'"));
    add('Early missing news penalty removed only when deferred',deepScanSource.includes('if (!temporalNewsDeferred && (homeData.sourceError || awayData.sourceError))')&&deepScanSource.includes('News live differite per maturita temporale'));
    add('DeepScan exposes signal and temporal metadata',deepScanSource.includes('signalAction: classification.action')&&deepScanSource.includes('temporalAnalysis,')&&deepScanSource.includes('newsCollectionMode: temporalAnalysis.liveNewsMode'));
    const earlyScan={success:true,action:'🟢 VIA LIBERA / VALUE',signalAction:'🟢 VIA LIBERA / VALUE',operationalAction:'🟢 VIA LIBERA / VALUE',temporalAnalysis:early,newsCollectionMode:'DEFERRED',pillars:[]};
    const rawReport={...earlyScan,action:'🟢 VIA LIBERA / VALUE',signalAction:'🟢 VIA LIBERA / VALUE',riskScore:18,pillars:earlyScan.pillars};
    const finalized=finalState.finalizeCandidateReport(rawReport,{edgePp:2.5,evPct:4,odd:2.1,reliabilityScore:31,predictionIndexScore:40,dataClass:'INATTENDIBILE',timingStatus:'EARLY_WATCHLIST',xgEvidenceMode:'GOAL_SHOT_PROXY',finalizationCertified:true});
    add('Signal separated from final operational gate',String(finalized.signalAction).includes('VIA LIBERA')&&finalized.action==='ALTO RISCHIO'&&finalized.operationalAction==='ALTO RISCHIO',{signal:finalized.signalAction,operational:finalized.action});
    add('Safety gate not weakened',finalized.finalStateDeepScan?.class==='HIGH_RISK'&&finalized.finalStateDeepScan?.qualityLabel==='BLOCCATA HARD',finalized.finalStateDeepScan);
    const compact=finalState.compactReport(finalized,{});
    add('Compact report persists signal + operational + temporal',compact.signalAction&&compact.operationalAction&&compact.temporalAnalysis?.stage==='EARLY_PREVIEW',{signal:compact.signalAction,operational:compact.operationalAction,temporal:compact.temporalAnalysis});

    const row={id:999,sport_type:'CALCIO',stake:0,paper_result_active:1,paper_result_conflict:0,bet_type:'SINGLE',status:'PENDING',match_date:'2026-10-16T18:45:00.000Z',home_team:'Home FC',away_team:'Away FC',prediction:'1',odd:2.1,estimated_prob:52,model_version:'TEST',strategy_tag:'TEST',calcio_deepscan_raw_action:'🟢 VIA LIBERA / VALUE',calcio_deepscan_final_state_action:'ALTO RISCHIO',calcio_deepscan_final_state_score:80,calcio_prediction_index_score:40,calcio_prediction_reliability_score:31,edge_pp:2.5,ev_pct:4};
    const fv=adaptive.featureVector(row);
    add('Adaptive SHADOW learns raw signal not collapsed gate',fv.deepScanQuality>0.5&&String(fv.deepScanAction).includes('VIA LIBERA')&&fv.deepScanOperationalAction==='ALTO RISCHIO',fv);
    add('Adaptive authority remains shadow-only',adaptive.AUTHORITY.productionAuthorized===false&&adaptive.AUTHORITY.deepScanWeightMutation===false&&adaptive.AUTHORITY.stakeMutation===false,adaptive.AUTHORITY);

    const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
    const mirror=fs.readFileSync(path.join(root,'backend','public','app.js'),'utf8');
    add('Frontend mirrors identical',app===mirror);
    add('Frontend uses raw signal cell',app.includes('renderCalcioDeepScanSignalCell(row)')&&app.includes('calcio_deepscan_raw_action'));
    add('Frontend marks preliminary reliability',app.includes("displayLabel = preliminary ? 'PRELIMINARE'"));
    add('Frontend marks early prediction non-operational',app.includes("'EARLY · NON OPERATIVO'"));
    add('R1 Step94 explicit enable retained',app.includes('AUDIT16D_R1_STEP94_CALCIO_EXPLICIT_ENABLE_BRIDGE'));
    const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
    add('R1 bounded Understat retained',server.includes('calcioUnderstatAnalysisPrefetchAudit16dR1.prefetch'));
    add('No production threshold lowering marker',!fs.readFileSync(path.join(root,'backend','calcioDeepScanFinalState.js'),'utf8').includes('AUDIT16D_R2_LOWER_THRESHOLD'));
  }catch(e){add('Unhandled test exception',false,{message:e.message,stack:e.stack});}
  const failures=checks.filter(x=>!x.ok); const out={success:failures.length===0,patch:'AUDIT16D_R2',version:temporal.VERSION,checks:checks.length,failures,details:checks};
  console.log(JSON.stringify(out,null,2)); process.exit(out.success?0:1);
})();
