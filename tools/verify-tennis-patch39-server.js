#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(process.argv[process.argv.indexOf('--root')+1]||'.');
const server=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');
const clv=fs.readFileSync(path.join(root,'backend','clvTracker.js'),'utf8');
const ext=fs.readFileSync(path.join(root,'backend','tennisExternalMatchIntelligencePatch37.js'),'utf8');
const checks=[];function ok(name,condition){checks.push({name,ok:Boolean(condition)});assert.ok(condition,name);}
ok('calibration import',server.includes("require('./tennisProbabilityCalibrationGuardPatch39')"));
ok('clv checkpoint import',clv.includes("require('./tennisClvSnapshotCoveragePatch39')"));
ok('evidence agent import',server.includes("require('./tennisEvidenceVerificationAgentPatch39')"));
ok('receipt link import',server.includes("require('./tennisExternalReceiptLinkPatch39')"));
ok('WTA recovery schedule',server.includes('patch39WtaRefreshSchedule'));
ok('governance endpoint',server.includes("router.get('/patch39-governance-health'"));
ok('calibration applied after final stake',server.indexOf('patch39ProbabilityGuardDecision =')>server.indexOf('patch35StakeAuthorityDecision ='));
ok('raw probability preserved',server.includes("tennis_probability_raw_pct"));
ok('receipt linked to row',server.includes('tennisExternalReceiptLinkPatch39.link'));
ok('agent abstention runtime',server.includes('tennisEvidenceVerificationAgentPatch39.verify'));
ok('event identity quorum',ext.includes('CERTIFIED_EVENT_IDENTITY')&&ext.includes('ABSTAIN_AMBIGUOUS_EVENT_IDENTITY'));
ok('unverified ranking no penalty',ext.includes('unverifiedRankingDisplayOnly'));
ok('canonical venue registry',ext.includes("require('./tennisVenueRegistryPatch39')"));
ok('CLV tracker version',clv.includes('6.8_PATCH39_CHECKPOINT_SNAPSHOT_COVERAGE'));
ok('no hardcoded complete source',!ext.includes('sourceReceiptComplete: true'));
console.log(JSON.stringify({success:true,checks:checks.length,details:checks},null,2));
