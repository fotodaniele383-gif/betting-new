#!/usr/bin/env node
'use strict';
const path=require('node:path');
const rootArgIndex=process.argv.indexOf('--root');
const root=rootArgIndex>=0&&process.argv[rootArgIndex+1]?path.resolve(process.argv[rootArgIndex+1]):path.resolve(__dirname,'..');
const M=require(path.join(root,'backend','adaptiveLearningShadowAudit16d.js'));
const checks=[];function ck(name,ok,details=null){checks.push({name,ok:Boolean(ok),details});}
function baseRow(id,{sport='CALCIO',stake=0,start='2026-10-10T12:00:00.000Z',action='VALUE CONFERMATO / MICRO',risk=20,status='PENDING',won=true,edge=1.5,ev=1,clv=0.02}={}){
  return {id,status,sport_type:sport,data_quality:'CURRENT',paper_result_active:1,paper_result_conflict:0,bet_type:'SINGLE',match_date:start,home_team:`H${id}`,away_team:`A${id}`,prediction:'HOME',strategy_tag:sport==='CALCIO'?'SERIE_A_1X2_ANALYSIS_ONLY':'TENNIS_ATP_MONEYLINE',league:sport==='CALCIO'?'Serie A':'[ATP] ATP500',market_type:'1X2',model_version:sport==='CALCIO'?'FOOTBALL_TEST':'TENNIS_TEST',estimated_prob:62,odd:1.8,stake,edge_pp:edge,ev_pct:ev,calcio_prediction_confidence_score:40,calcio_analysis_maturity_score:40,calcio_deepscan_final_state_action:sport==='CALCIO'?action:null,calcio_deepscan_final_state_score:sport==='CALCIO'?risk:null,tennis_deepscan_canonical_action:sport==='TENNIS'?action:null,deep_scan_risk_score:sport==='TENNIS'?risk:null,deepscan_gate_multiplier:risk<=30?0.8:0.2,settlement_contract_status:status==='PENDING'?null:'VERIFIED',settlement_source:status==='PENDING'?null:'OFFICIAL_TEST',settlement_evidence_hash:status==='PENDING'?null:`e${id}`.padEnd(64,'0'),settlement_source_event_id:status==='PENDING'?null:`EV-${id}`,settled_at:status==='PENDING'?null:'2027-01-02T00:00:00.000Z',clv_verified:status==='PENDING'?0:1,clv_pct:status==='PENDING'?null:clv};
}
const now=Date.parse('2026-09-25T00:00:00.000Z');
ck('Version',M.VERSION==='AUDIT16D_ADAPTIVE_LEARNING_SHADOW_V1');
ck('Authority shadow-only',M.AUTHORITY.productionAuthorized===false&&M.AUTHORITY.deepScanWeightMutation===false&&M.AUTHORITY.tradingPromotion===false);
ck('Profile weights normalized',M.PROFILES.every(p=>Math.abs(p.analysisWeight+p.deepScanWeight-1)<1e-12));
const good=baseRow(1,{action:'VALUE CONFERMATO / MICRO',risk:20});const bad=baseRow(2,{action:'ALTO RISCHIO',risk:80});
const fg=M.featureVector(good),fb=M.featureVector(bad);ck('DeepScan quality discriminates risk',fg.deepScanQuality>fb.deepScanQuality,{good:fg.deepScanQuality,bad:fb.deepScanQuality});
const dg=M.profileDecisions(fg),db=M.profileDecisions(fb);ck('Analysis-only independent of DeepScan',Math.abs(dg.ANALYSIS_ONLY.score-db.ANALYSIS_ONLY.score)<1e-12,{score:dg.ANALYSIS_ONLY.score});
ck('Blended profile can reject high-risk while accepting value',dg.ANALYSIS_80_DEEPSCAN_20.accepted===true&&db.ANALYSIS_80_DEEPSCAN_20.accepted===false,{good:dg.ANALYSIS_80_DEEPSCAN_20,bad:db.ANALYSIS_80_DEEPSCAN_20});
let s=M.fresh();s=M.advance([good],s,now);ck('Future pending captured',Object.keys(s.anchors).length===1&&s.resolvedForward===0,s);
const changed={...good,edge_pp:2,ev_pct:3};const beforeHash=s.anchors[1].hash;s=M.advance([changed],s,now+3600000);ck('Pre-match refresh creates audited revision',s.anchors[1].hash!==beforeHash&&s.anchors[1].revisions.length===1,{revisions:s.anchors[1].revisions.length});
let tampered=JSON.parse(JSON.stringify(s));tampered.anchors[1].payload.features.analysisQuality=0.999;let threw=false;try{M.advance([changed],tampered,now+7200000);}catch(e){threw=e.message==='AUDIT16D_ANCHOR_HASH_INVALID';}ck('Tampered anchor fails closed',threw);
let noAnchor=M.advance([baseRow(99,{status:'WON'})],M.fresh(),Date.parse('2027-01-03T00:00:00.000Z'));ck('Historical resolved row without prospective anchor excluded',noAnchor.resolvedForward===0&&noAnchor.exclusions.noAnchor===1,noAnchor.exclusions);
// Build 200 prospective Studio events. Analysis quality is identical; DeepScan separates 120 good from 80 poor.
const pending=[];const resolved=[];const capture=Date.parse('2026-09-01T00:00:00.000Z');
for(let i=0;i<200;i++){
  const day=1+(i%60),month=10+Math.floor((i%60)/31);const d=new Date(Date.UTC(2026,9,1)+i*8*3600000);const start=d.toISOString();
  const positive=i<120;const win=positive?(i%4!==0):(i%4===0);const p=baseRow(1000+i,{start,action:positive?'VALUE CONFERMATO / MICRO':'ALTO RISCHIO',risk:positive?20:80,status:'PENDING'});pending.push(p);
  resolved.push({...p,status:win?'WON':'LOST',settlement_contract_status:'VERIFIED',settlement_source:'OFFICIAL_TEST',settlement_evidence_hash:String(1000+i).padStart(64,'a'),settlement_source_event_id:`EV-${1000+i}`,settled_at:'2027-01-02T00:00:00.000Z',clv_verified:1,clv_pct:0.02});
}
let st=M.advance(pending,M.fresh(),capture);ck('Prospective batch captured',st.anchorCount===200,{anchorCount:st.anchorCount});
st=M.advance(resolved,st,Date.parse('2027-02-01T00:00:00.000Z'));
const seg=st.segments['CALCIO:STUDIO'];ck('Certified forward outcomes evaluated',seg.resolvedForward===200,{resolvedForward:seg.resolvedForward,exclusions:st.exclusions});
ck('Shadow leader can be identified without production authority',seg.status==='SHADOW_LEADER_IDENTIFIED'&&seg.shadowLeader&&seg.productionAuthorized===false&&seg.promotionEligible===false,{status:seg.status,leader:seg.shadowLeader});
ck('Shadow leader improves hit rate vs analysis-only',seg.shadowLeader.metrics.hitRatePct>seg.control.hitRatePct,{leader:seg.shadowLeader.metrics.hitRatePct,control:seg.control.hitRatePct});
ck('CLV guardrail enforced',seg.shadowLeader.metrics.clvCoveragePct===100&&seg.shadowLeader.metrics.meanClv>=0,seg.shadowLeader.metrics);
// Unverified settlement cannot enter forward sample.
let uv=M.advance([baseRow(5000,{start:'2026-10-01T00:00:00.000Z'})],M.fresh(),capture);const unresolved={...baseRow(5000,{start:'2026-10-01T00:00:00.000Z',status:'WON'}),settlement_contract_status:'PENDING',settlement_evidence_hash:null,settlement_source_event_id:null};uv=M.advance([unresolved],uv,Date.parse('2027-01-01T00:00:00.000Z'));ck('Uncertified settlement excluded',uv.resolvedForward===0&&uv.exclusions.uncertifiedSettlement===1,uv.exclusions);
const failures=checks.filter(x=>!x.ok);const out={success:failures.length===0,patch:'AUDIT16D',checks:checks.length,failures,details:checks};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
