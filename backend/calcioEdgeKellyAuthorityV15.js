'use strict';
// Strict manual-PAPER-only Calcio edge + uncertainty-adjusted fractional Kelly authority.
// Does not change Tennis, old decisions, the betting DB or real-money execution.
const VERSION='CALCIO_EDGE_KELLY_AUTHORITY_V15_20261108';
const finalAuthority=require('./stakeUnifiedAuthorityDecisionR18');
const POLICY='EDGE_KELLY_MANUAL_PAPER_V15';
// R19 paper-only accounting: one cent is the minimum *simulation* unit.
// It is NOT a bookmaker minimum and it does not authorize placing a bet.
const MIN_STAKE=0.01, MIN_REAL_BOOKMAKER_STAKE=1, MAX_STAKE=10, MAX_BANKROLL_PCT=1;
const f=x=>x==null||x===''||typeof x==='boolean'||!Number.isFinite(Number(x))?null:Number(x);
const rnd=(n,d=3)=>Number(n.toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const reasonsUnique=a=>[...new Set(a.filter(Boolean))];
function evaluate(input={}) {
  const reasons=[], warnings=[];
  const bank=f(input.bankrollSnapshot ?? input.bankroll);
  const odd=f(input.netExecutableOdd ?? input.odd);
  const prod=f(input.productionProbabilityPct),robust=f(input.robustProbabilityPct ?? input.reliabilityAssessment?.robustProbabilityPct);
  const reported=f(input.robustEvPct ?? input.reliabilityAssessment?.robustEvPct);
  const gap=f(input.crossMarketGapPp ?? input.reliabilityAssessment?.crossMarketGapPp);
  const unct=f(input.epistemicUncertaintyScore ?? input.reliabilityAssessment?.epistemicUncertaintyScore);
  const days=f(input.daysToKickoff ?? input.reliabilityAssessment?.daysToKickoff);
  const quality=input.dataQualityAssessment || {}, evidence=quality.evidence || {};
  const history=input.historicalCalibration || {status:'NO_MATCHABLE_HISTORY',sample:0,calibrationAdjustmentPp:0};
  const risk=input.reliabilityAssessment || {};
  const classCode=String(evidence.dataClass||'').toUpperCase();
  const coverage=String(evidence.coverageMode||'').toUpperCase();
  const sourceCount=f(evidence.oddsSourceCount);
  const quoteAge=f(evidence.quoteAgeMinutes);
  const sourceProof=evidence.oddsCertified===true && evidence.oddsOperationalEligible===true && (sourceCount??0)>=2 && evidence.identityCertified===true && quoteAge!==null && quoteAge>=0 && quoteAge<=30;
  if (process.env.SAFE13_MANUAL_PAPER!=='1') reasons.push('V15_REQUIRES_SAFE13_MANUAL_PAPER');
  if (!(bank>0)) reasons.push('BANKROLL_UNAVAILABLE');
  if (!(odd>1.01&&odd<=25)) reasons.push('NET_ODD_INVALID');
  if (!sourceProof) reasons.push('QUOTE_OR_IDENTITY_NOT_VERIFIED');
  if (prod===null||prod<=0||prod>=100||robust===null||robust<=0||robust>=100) reasons.push('PROBABILITY_UNAVAILABLE');
  if (reported===null) reasons.push('ROBUST_EV_NOT_REPORTED');
  if (days===null||days<0) reasons.push('MATCH_STARTED_OR_TIME_UNKNOWN');
  // A tested old snapshot's stored coverage may be 'HISTORY_THIN'; no prior-only bets.
  if (!['HISTORY_PROXY','HISTORY_PROXY_STRONG','STRONG_REAL_XG'].includes(coverage)) reasons.push('HISTORY_COVERAGE_NOT_USABLE');
  if (!['DATA_QUALITY_CERTIFIED','DATA_QUALITY_LIMITED','DATA_QUALITY_BLOCKED'].includes(String(quality.status||''))) reasons.push('UNKNOWN_DATA_QUALITY');
  // R15: a qualitative BLOCKED flag is never a substitute for quantitative proof.
  if (quality.blocking === true || String(quality.status)==='DATA_QUALITY_BLOCKED' || classCode==='INATTENDIBILE') reasons.push('DATA_QUALITY_HARD_BLOCK');
  if (unct===null||unct>80) reasons.push('EPISTEMIC_UNCERTAINTY_TOO_HIGH');
  if (gap===null||Math.abs(gap)>25) reasons.push('CROSS_MARKET_GAP_TOO_HIGH');
  const replay=odd!==null&&robust!==null?(odd*robust/100-1)*100:null;
  if(replay===null||replay<=0) reasons.push('ROBUST_NET_EV_NON_POSITIVE');
  if(reported!==null&&(reported<=0||replay!==null&&Math.abs(reported-replay)>0.25)) reasons.push('REPORTED_EV_INVALID_OR_MISMATCH');
  const histAdj=clamp(Math.min(0,f(history.calibrationAdjustmentPp)??0),-8,0);
  const safeP=robust!==null&&prod!==null?clamp(Math.min(robust,prod)+histAdj,0,100):null;
  const robustNetEv=safeP!==null&&odd!==null?(odd*safeP/100-1)*100:null;
  // Positive margin *after* historical shrinkage, not an artificial 55/60% win threshold.
  if (robustNetEv===null||robustNetEv<1.5) reasons.push('HISTORICAL_ADJUSTED_EV_BELOW_1_5PCT');
  let frac=0.10; // tenth Kelly is the uncertain-model default, not 100% Kelly.
  const sample=f(history.sample)||0;
  if(sample<30){frac*=0.75;warnings.push('Storico calibrabile insufficiente: Kelly ridotto.');}
  if(sample>=80 && (f(history.calibrationGapPp)??-999)>=-3 && (f(history.brier)??1)<0.24)frac=0.15;
  if (uctOver(unct,60)) frac*=0.7;
  if (Math.abs(gap??100)>12)frac*=0.7;
  if (days!==null && days>7)frac*=0.6;
  if (String(quality.status)==='DATA_QUALITY_BLOCKED'||classCode==='INATTENDIBILE')frac*=0.5;
  // DeepScan is advisory ONLY if independently observed and substantial. Missing = neutral.
  const report=input.deepScanReport || {};
  const pillars=Array.isArray(report.pillars)?report.pillars:[];
  const observed=pillars.filter(p=>p&&p.status!=='NOT_OBSERVED'&&f(p.risk)!==null);
  const coverageRatio=pillars.length?observed.length/pillars.length:0;
  const deepScanUsed=observed.length>=4&&coverageRatio>=0.65;
  const meanRisk=deepScanUsed?observed.reduce((s,p)=>s+Number(p.risk),0)/observed.length:null;
  const deepScanMultiplier=deepScanUsed&&meanRisk>60?0.8:1;
  frac*=deepScanMultiplier;
  const p=safeP===null?0:safeP/100;
  const kelly=odd!==null&&odd>1?Math.max(0,(odd*p-1)/(odd-1)):0;
  const fullKellyPct=kelly*100;
  const cap=Math.min(MAX_STAKE,(bank||0)*MAX_BANKROLL_PCT/100);
  const amount=rnd(Math.min(cap,(bank||0)*kelly*frac),2);
  if (amount<MIN_STAKE) reasons.push('KELLY_PAPER_STAKE_BELOW_0_01_EUR');
  if(quality.status!=='DATA_QUALITY_CERTIFIED') warnings.push('Dati incompleti: Kelly prudenziale e quote verificate richiesti.');
  const eligible=reasons.length===0;
  const amountFinal=eligible?amount:0;
  const unifiedDecision=finalAuthority.decide({sport:'CALCIO',approved:eligible,proposedStake:amountFinal,
    minimumStake:MIN_STAKE,expectedValuePct:robustNetEv,hasVerifiedValue:sourceProof&&robustNetEv!==null&&robustNetEv>=1.5,
    hardReasons:reasons,stage:'POST_EVIDENCE_PRE_PORTFOLIO'});
  if(unifiedDecision.eligible!==eligible)throw Error('R18_AUTHORITY_CONTRACT_INCOHERENT');
  const proof={policy:POLICY,manualPaperOnly:true,modelProbabilityPct:prod,robustProbabilityPct:robust,netOdd:odd,sourceCount,quoteAgeMinutes:quoteAge,identityCertified:evidence.identityCertified===true,oddsCertified:evidence.oddsCertified===true,oddsOperationalEligible:evidence.oddsOperationalEligible===true,coverageMode:coverage,referenceAsOf:input.asOf||null,checkedExpectedValuePct:replay===null?null:rnd(replay),historicalSample:sample,quantitativeReliabilityGuardStatus:risk.status||null};
  const label=eligible?'VALUE EDGE · PAPER KELLY':'ANALISI · NESSUNO STAKE';
  const explanation=eligible?`Value Paper: €${amountFinal.toFixed(2)} di Kelly frazionato ${rnd(frac*100,2)}%; EV aggiustato ${rnd(robustNetEv,2)}%, probabilità prudenziale ${rnd(safeP,2)}%.`:`Value Paper €0: ${reasonsUnique(reasons).join(' · ')}`;
  return {
    version:VERSION,policy:POLICY,status:eligible?'EDGE_KELLY_PAPER_AUTHORIZED':'EDGE_KELLY_PAPER_NO_STAKE',eligible,allowBet:eligible,
    paperOnly:true,realMoney:false,automaticExecution:false,pfEvidenceGatePassed:false,
    bankrollSnapshot:rnd(bank||0,2),bankrollSource:input.bankrollSource||'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT',
    netExecutableOdd:odd,productionProbabilityPct:prod,robustProbabilityPct:robust,stakeProbabilityPct:safeP,
    robustEvPct:reported,robustNetEvAfterCalibrationPct:robustNetEv===null?null:rnd(robustNetEv),
    epistemicUncertaintyScore:unct,productionFullKellyPct:prod!==null&&odd!==null?rnd(Math.max(0,((prod/100*odd-1)/(odd-1))*100)):0,
    stakeFullKellyPct:rnd(fullKellyPct),fractionalKelly:rnd(frac,5),
    predictionIndexScore:f(input.predictionIndexScore),predictionIndexBand:{label:'EDGE_FIRST_NO_IPM_GATE',multiplier:1,maxBankrollPct:MAX_BANKROLL_PCT},
    modelStake:eligible?amount:0,reliabilityStake:amountFinal,prePortfolioCapStake:amountFinal,finalOperationalStake:amountFinal,
    eventCapPct:MAX_BANKROLL_PCT,eventCapStake:rnd(cap,2),minimumOperationalStake:MIN_STAKE,
    minimumRealBookmakerStake:MIN_REAL_BOOKMAKER_STAKE,paperStakeOnly:true,
    unroundedPrePortfolioStakeEur:rnd(Math.min(cap,(bank||0)*kelly*frac),6),
    timingPolicy:{code:'V15_ASOF_MATCH_FRESH_ODDS'},dataQualityStatus:quality.status||null,dataQualityScore:f(quality.score),
    effectiveAction:eligible?'VALUE CONFERMATO / MICRO':'WATCHLIST LOW EDGE',qualityFinalLabel:label,
    hardVetoes:reasonsUnique(reasons),cautions:warnings,reason:explanation,
    operationalAuthority:'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY',legacyStakeWritersAllowed:false,
    unifiedAuthorityDecision:unifiedDecision, authorityDecisionCode:unifiedDecision.code,
    r15RiskProof:proof,historicalCalibration:history,deepScanUsed,deepScanObservedPillars:observed.length,deepScanMultiplier,calculatedAt:new Date().toISOString()
  };
}
function uctOver(v,max){return v!==null&&v>max;}
module.exports={VERSION,POLICY,MIN_STAKE,MIN_REAL_BOOKMAKER_STAKE,MAX_STAKE,evaluate};
