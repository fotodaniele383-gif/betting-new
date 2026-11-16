'use strict';

const VERSION = 'TENNIS_FINAL_STAKE_AUTHORITY_V1_PATCH35';
const MIN_OPERATIONAL_SAMPLE = 5;
const MIN_STANDARD_SAMPLE = 30;
const LOW_SAMPLE_CAP = 2;

function number(value, fallback = 0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
function upper(value){ return String(value==null?'':value).toUpperCase(); }
function round(value,d=2){ const m=10**d; return Math.round(number(value,0)*m)/m; }
function sampleFrom(input={}){ const e=input.historicalEvidence||{}; return Math.max(0,Math.trunc(number(e.resolved ?? input.historical_combo_resolved ?? input.pre_match_historical_sample,0))); }
function reliabilityFrom(sample, explicit=''){ if(sample===0)return 'NO_SAMPLE'; if(sample<5)return 'VERY_LOW'; if(sample<12)return 'LOW'; if(sample<30)return 'MEDIUM'; return upper(explicit)||'HIGH'; }
function isHardBlocked(input={}){ const t=upper([input.qualityCode,input.qualityLabel,input.professionalGateStatus,input.operationalAction,input.operationalStatus].join(' ')); return t.includes('HARD')||t.includes('NO_BET_HARD')||t.includes('BLOCKED_HARD'); }
function decide(input={}){
  const proposed=Math.max(0,round(input.proposedStake,2));
  const sample=sampleFrom(input);
  const reliability=reliabilityFrom(sample,input.historicalEvidence?.reliability||input.historical_combo_reliability);
  const quality=upper(`${input.qualityCode||''} ${input.qualityLabel||''}`);
  let finalStake=proposed,status='AUTHORIZED',reason='Stake proposto dal Quality Gate confermato dalla final authority.';
  if(isHardBlocked(input)){finalStake=0;status='BLOCKED_HARD_GATE';reason='Veto hard: nessuna autorità stake può riabilitare la selezione.';}
  else if(proposed<=0){finalStake=0;status='NO_PROPOSED_STAKE';reason='Nessuno stake proposto dal Quality Gate.';}
  else if(sample===0){finalStake=0;status='PAPER_ONLY_NO_SAMPLE';reason='Campione DS×Gate assente: evidenza osservativa, nessuna autorità stake.';}
  else if(sample<MIN_OPERATIONAL_SAMPLE){finalStake=0;status='PAPER_ONLY_INSUFFICIENT_SAMPLE';reason=`Campione DS×Gate n=${sample} inferiore a ${MIN_OPERATIONAL_SAMPLE}: frequenza grezza non utilizzabile per stake.`;}
  else if(sample<MIN_STANDARD_SAMPLE){finalStake=Math.min(proposed,LOW_SAMPLE_CAP);status='AUTHORIZED_MICRO_SAMPLE_CAP';reason=`Campione DS×Gate n=${sample}: solo micro-stake massimo €${LOW_SAMPLE_CAP.toFixed(2)}.`;}
  if(quality.includes('WATCHLIST') && finalStake>LOW_SAMPLE_CAP){finalStake=LOW_SAMPLE_CAP;status='AUTHORIZED_WATCHLIST_CAP';reason='WATCHLIST MICRO: cap operativo finale applicato.';}
  return { version:VERSION,status,proposedStake:proposed,finalStake:round(finalStake,2),sample,reliability,minOperationalSample:MIN_OPERATIONAL_SAMPLE,minStandardSample:MIN_STANDARD_SAMPLE,smallSampleHeadline:sample<MIN_OPERATIONAL_SAMPLE?'INSUFFICIENT_SAMPLE':null,reason,modelAuthority:false,qualityAuthority:false,settlementAuthority:false,clvAuthority:false,soleFinalStakeAuthority:true };
}
function toPersistenceFields(d={},at=new Date().toISOString()){return {tennis_stake_authority_version:d.version||VERSION,tennis_stake_authority_status:d.status||'UNKNOWN',tennis_stake_authority_proposed_stake:number(d.proposedStake,0),tennis_stake_authority_final_stake:number(d.finalStake,0),tennis_stake_authority_sample:number(d.sample,0),tennis_stake_authority_reliability:d.reliability||'NO_SAMPLE',tennis_stake_authority_reason:d.reason||'',tennis_stake_authority_decided_at:at};}
function health(){return {version:VERSION,minOperationalSample:MIN_OPERATIONAL_SAMPLE,minStandardSample:MIN_STANDARD_SAMPLE,lowSampleCap:LOW_SAMPLE_CAP,soleFinalStakeAuthority:true,n0AndN1Protected:true,modelAuthority:false,qualityAuthority:false};}
module.exports={VERSION,MIN_OPERATIONAL_SAMPLE,MIN_STANDARD_SAMPLE,LOW_SAMPLE_CAP,decide,toPersistenceFields,health};
