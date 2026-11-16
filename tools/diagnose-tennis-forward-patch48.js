#!/usr/bin/env node
'use strict';
const path=require('path');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const db=new DatabaseSync(path.join(root,'backend','database_betting.db'),{readOnly:true,open:true});
const capture=require(path.join(root,'backend','tennisForwardCaptureHealth.js'));
const cohort=require(path.join(root,'backend','tennisForwardCohorts.js'));
try{
 const forward=capture.scanForwardCaptureHealth(db,{limit:1000});const cohorts=cohort.scanForwardCohorts(db,{limit:1000});
 const blocked=forward.details.filter(x=>x.status==='BLOCKED').map(x=>({betId:x.betId,blockClass:x.blockClass,reasons:x.reasons,warnings:x.warnings,expectedTemporalExclusion:x.expectedTemporalExclusion,clvDegradedState:x.clvDegradedState,finalStakeStatus:x.finalStakeStatus||null}));
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_48_OPERATIONAL_AUTHORITY_ALIGNMENT_FORWARD_QUARANTINE_CANONICAL_DEEPSCAN',revision:'R5_WINDOWS_NODE_CONTINUOUS_CLV_LEDGER_ONBOARDING',forward:{trackedBets:forward.trackedBets,pipelineAvailable:forward.pipelineAvailable,activeStructuralFaults:forward.activeStructuralFaults,decisionContractBlocked:forward.decisionContractBlocked,evidenceOverdue:forward.evidenceOverdue,expectedTemporalExclusions:forward.expectedTemporalExclusions,counts:forward.counts,diagnosticSummary:forward.diagnosticSummary,blocked},cohorts:{tracked:cohorts.tracked,activeLeakageFaults:cohorts.activeLeakageFaults,expectedTemporalExclusions:cohorts.expectedTemporalExclusions}},null,2));
}finally{db.close();}
