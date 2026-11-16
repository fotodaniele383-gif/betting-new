#!/usr/bin/env node
'use strict';
const assert=require('assert');
const capture=require('../backend/tennisForwardCaptureHealth');
const policy=require('../backend/tennisForwardCapturePolicyPatch48R2');
const guard=require('../backend/tennisProbabilityCalibrationGuardPatch39');
let checks=0; function ok(v,m){assert.ok(v,m);checks++;}
const canonical={
 tennis_stake_contract_version:'TENNIS_STAKE_EXECUTION_CONTRACT_V1_PATCH46',tennis_stake_final_authority:'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT',
 tennis_stake_quality_authority_status:'QUALITY_GATE_AUTHORIZED_PROPOSAL',tennis_stake_risk_authority_status:'AUTHORIZED_MICRO_SAMPLE_CAP',
 tennis_stake_calibration_status:'SHADOW_OVERCONFIDENCE_MICRO_CAP',tennis_stake_final_execution_status:'EXECUTABLE_MICRO_STAKE',
 tennis_stake_model_suggested:3,tennis_stake_quality_cap:3,tennis_stake_risk_cap:2,tennis_stake_calibration_cap:2,tennis_stake_final_executable:2,stake:2
};
ok(capture.qualityDecisionIsComplete(canonical));ok(capture.qualityStakeIsCoherent(canonical));
ok(!capture.qualityStakeIsCoherent({...canonical,stake:0}));ok(!capture.qualityStakeIsCoherent({...canonical,tennis_stake_final_executable:3}));
const c1=policy.classify(['SETTLEMENT_SLA_CRITICAL']);ok(c1.class===policy.CLASSES.EVIDENCE_OVERDUE);
const c2=policy.classify(['QUALITY_STAKE_INCOHERENT']);ok(c2.class===policy.CLASSES.DECISION_CONTRACT);
const c3=policy.classify(['LIFECYCLE_LEDGER_MISMATCH_STAKE']);ok(c3.class===policy.CLASSES.STRUCTURAL_INTEGRITY);
const c4=policy.classify(['COHORT_BLOCKED'],{expectedTemporalExclusion:true});ok(c4.class===policy.CLASSES.EXPECTED_POLICY_EXCLUSION);
const report={windows:[{requestedWindow:100,sample:100,brierScore:.25,bands:[{bandId:'P65_75',sample:23,posteriorMeanPct:50,hitRatePct:50,averageProbabilityPct:70,calibrationGapPp:15}]}]};
const d=guard.decide({estimated_prob:70,proposedStake:3},report);ok(d.status==='SHADOW_OVERCONFIDENCE_MICRO_CAP');ok(d.finalStake===2);ok(d.authority==='PATCH48_SHADOW_DIAGNOSTIC_MICRO_CAP');
console.log(JSON.stringify({success:true,checks,policy:policy.VERSION,calibrationStatus:d.status}));
