#!/usr/bin/env node
'use strict';
const path=require('path');const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const mod=require(path.join(root,'backend','unifiedCrossSportPortfolioRiskAuthorityPatch56'));
const fakeDb={prepare(){throw new Error('unexpected db query');}};
const blocked={evidenceHash:'a'.repeat(64),gateStatus:'BLOCKED_STATISTICAL_READINESS',statisticalGatePass:false,
 tennis:{gateStatus:'BLOCKED_STATISTICAL_READINESS',statisticalGatePass:false,blockingFailures:['TENNIS_WTA_DATA_CURRENT']},
 calcio:{gateStatus:'BLOCKED_STATISTICAL_READINESS',statisticalGatePass:false,blockingFailures:['CALCIO_CLV_VERIFIED_COVERAGE']}};
const pass={evidenceHash:'b'.repeat(64),gateStatus:'MANUAL_CANARY_REVIEW_ELIGIBLE',statisticalGatePass:true,
 tennis:{gateStatus:'MANUAL_CANARY_REVIEW_ELIGIBLE',statisticalGatePass:true,blockingFailures:[]},
 calcio:{gateStatus:'MANUAL_CANARY_REVIEW_ELIGIBLE',statisticalGatePass:true,blockingFailures:[]}};
const exposure={total:40,bySport:{TENNIS:25,CALCIO:15},event:0,rows:2};
const allDownstream={securityReady:true,schedulerStateMachineReady:true,controlledCanaryAuthorized:true,canaryAuthority:'CONTROLLED_CANARY_ACTIVATION_V1_PATCH59'};
const checks=[];const c=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
const tb=mod.decide({sport:'TENNIS',proposedStake:10,bankroll:1000},{db:fakeDb,readinessReport:blocked,exposureSnapshot:exposure,decidedAt:'2026-08-07T12:00:00.000Z'});
const cb=mod.decide({sport:'CALCIO',proposedStake:10,bankroll:1000},{db:fakeDb,readinessReport:blocked,exposureSnapshot:exposure,decidedAt:'2026-08-07T12:00:00.000Z'});
const noDown=mod.decide({sport:'TENNIS',proposedStake:10,bankroll:1000},{db:fakeDb,readinessReport:pass,exposureSnapshot:exposure});
const canary=mod.decide({sport:'TENNIS',proposedStake:20,bankroll:1000},{db:fakeDb,readinessReport:pass,exposureSnapshot:exposure,downstreamState:allDownstream});
const below=mod.decide({sport:'CALCIO',proposedStake:1.5,bankroll:1000},{db:fakeDb,readinessReport:pass,exposureSnapshot:{total:0,bySport:{TENNIS:0,CALCIO:0},event:0},downstreamState:allDownstream});
c('Version Patch56',mod.VERSION==='UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY_V1_PATCH56');
c('Policy Patch56',mod.POLICY_VERSION==='UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_POLICY_V1_PATCH56');
c('Mode preserva Paper Trading',mod.MODE==='REAL_MONEY_FAIL_CLOSED_SHADOW_PAPER_PRESERVED');
c('Tennis blocked -> real 0',tb.status==='BLOCKED_STATISTICAL_READINESS'&&tb.realExecutableStake===0,tb);
c('Calcio blocked -> real 0',cb.status==='BLOCKED_STATISTICAL_READINESS'&&cb.realExecutableStake===0,cb);
c('Paper stake candidato preservato',tb.candidatePaperStake===10&&tb.paperStakePreserved===true);
c('Patch55 non bypassabile',tb.blockingFailures.includes('TENNIS_WTA_DATA_CURRENT'));
c('Gate statistico solo non basta',noDown.status==='BLOCKED_DOWNSTREAM_PRODUCTION_GATES'&&noDown.realExecutableStake===0);
c('Patch57-59 obbligatorie',noDown.downstream.allRequired===false);
c('Controlled canary richiede Patch59 authority',mod.downstreamState({downstreamState:allDownstream}).allRequired===true);
c('Cap singola <=1%',canary.caps.singleBetCap===10);
c('Cap sport residuo applicato',canary.caps.remainingSportCap===5);
c('Canary finale cap €5',canary.realExecutableStake===5,canary);
c('Nessun incremento stake',canary.noStakeIncrease===true&&canary.realExecutableStake<=canary.candidatePaperStake);
c('Stake sotto minimo -> zero',below.realExecutableStake===0&&below.status==='BLOCKED_PORTFOLIO_CAP_OR_MINIMUM');
c('Limite totale 5%',mod.LIMITS.totalExposurePct===5);
c('Limite sport 3%',mod.LIMITS.sportExposurePct===3);
c('Limite evento 1%',mod.LIMITS.eventExposurePct===1);
c('Limite singola 1%',mod.LIMITS.singleBetExposurePct===1);
c('No probability authority',tb.probabilityAuthority===false);
c('No DeepScan authority',tb.deepScanAuthority===false);
c('No settlement authority',tb.settlementAuthority===false);
c('No auto production activation',tb.automaticProductionActivation===false);
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'56',checks:checks.length,details:checks},null,2));process.exit(failed.length?1:0);
