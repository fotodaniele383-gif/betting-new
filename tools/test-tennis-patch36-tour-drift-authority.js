#!/usr/bin/env node
'use strict';
const assert=require('assert');
const drift=require('../backend/tennisTourDriftAuthorityPatch36');
const stage=require('../backend/tennisTournamentStageModel');
const checks=[];function c(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
function rows(mode,tour,count,prob,pattern='bad',offset=0){const out=[];for(let i=0;i<count;i++){const predicted=prob>=.5?1:2;const correct=pattern==='good'||(pattern==='bad'&&i%4===0);const actual=correct?predicted:(predicted===1?2:1);out.push({bet_id:offset+i+1,evaluation_mode:mode,tour,match_start_at:new Date(Date.UTC(2025,0,1+offset+i)).toISOString(),production_probability_p1:prob,actual_winner_side:actual});}return out;}
const retro=[...rows('RETROSPECTIVE_AS_OF_SAFE','WTA',120,.78,'good',0),...rows('RETROSPECTIVE_AS_OF_SAFE','WTA',60,.78,'bad',120)];
const report=drift.buildReport(retro,{generatedAt:'2026-08-03T00:00:00Z'});
c('retrospective degradation detected',()=>assert.equal(report.retrospective.overall.degradationActive,true));
c('retrospective has no probability authority',()=>assert.equal(report.probabilityAdjustmentAuthority,false));
c('retrospective confidence authority active',()=>assert.equal(report.confidenceAdjustmentAuthority,true));
c('diagnostic channel explicit',()=>assert.equal(report.diagnosticChannel,'RETROSPECTIVE_AS_OF_SAFE'));
c('forward rows zero',()=>assert.equal(report.forward.rows,0));
const adjusted=stage.applyTournamentStageAdjustment({baseProbabilityP1:.8,round:'R32',tour:'WTA',recentPerformance:report});
c('retrospective drift does not shrink probability',()=>assert.equal(adjusted.adjustedProbabilityP1,.8));
c('retrospective drift still lowers confidence',()=>assert(adjusted.confidencePenalty>=3));
c('probability mutation policy diagnostic only',()=>assert.equal(adjusted.probabilityMutationPolicy,'RETROSPECTIVE_DIAGNOSTIC_CONFIDENCE_ONLY'));
const mature=[...retro,...rows('FORWARD_CERTIFIED','WTA',60,.75,'good',1000),...rows('FORWARD_CERTIFIED','WTA',30,.75,'bad',1060),...rows('FORWARD_CERTIFIED','ATP',60,.7,'good',2000),...rows('FORWARD_CERTIFIED','ATP',30,.7,'bad',2060)];
const matureReport=drift.buildReport(mature);
c('mature forward rows counted',()=>assert.equal(matureReport.forward.rows,180));
c('mature forward authority can activate',()=>assert.equal(matureReport.probabilityAdjustmentAuthority,true));
const matureAdjustment=stage.applyTournamentStageAdjustment({baseProbabilityP1:.8,round:'F',tour:'WTA',recentPerformance:matureReport});
c('mature forward bounded shrink active',()=>assert(matureAdjustment.degradationShrink>0));
c('shrink remains bounded',()=>assert(matureAdjustment.adjustedProbabilityP1>.7&&matureAdjustment.adjustedProbabilityP1<.8));
c('no hard exclusion',()=>assert.equal(matureAdjustment.hardExclusion,false));
c('authority health safe',()=>assert.equal(drift.health(report).authority.productionProbability,false));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length,report:{retrospective:report.retrospective.overall,forwardRows:report.forward.rows,authority:report.authority}},null,2));process.exit(failed.length?1:0);
