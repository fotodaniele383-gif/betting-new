'use strict';

const VERSION = 'AUDIT16D_R2_CALCIO_TEMPORAL_ANALYSIS_POLICY_V1';
const POLICY_VERSION = 'AUDIT16D_R2_TEMPORAL_EVIDENCE_MATURITY_POLICY_V1';

const STAGES = Object.freeze({
  EARLY: 'EARLY_PREVIEW',
  MID: 'MID_PREMATCH',
  FULL: 'FULL_PREMATCH',
  LIVE: 'LIVE_OR_PAST',
  UNKNOWN: 'TIMING_UNKNOWN'
});

function text(v){ return String(v ?? '').trim(); }
function parseTime(v){
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s=text(v); if(!s) return null;
  const t=Date.parse(s); return Number.isFinite(t) ? t : null;
}
function evaluate(input={}, now=new Date()){
  const raw = input.matchDate || input.match_date || input.commenceTime || input.commence_time || input.kickoff || input.date || input.start;
  const kickoffMs=parseTime(raw), nowMs=parseTime(now) ?? Date.now();
  if(kickoffMs===null){
    return {version:VERSION,policyVersion:POLICY_VERSION,stage:STAGES.UNKNOWN,hoursToKickoff:null,daysToKickoff:null,liveNewsMode:'BOUNDED',providerTimeoutMs:2500,operationalMaturity:'UNKNOWN',presentationLabel:'TIMING NON DISPONIBILE',shouldDeferNews:false,reason:'Kickoff non determinabile: nessuna inferenza temporale.'};
  }
  const hours=(kickoffMs-nowMs)/3600000, days=hours/24;
  if(hours<0){
    return {version:VERSION,policyVersion:POLICY_VERSION,stage:STAGES.LIVE,hoursToKickoff:Number(hours.toFixed(2)),daysToKickoff:Number(days.toFixed(2)),liveNewsMode:'DISABLED',providerTimeoutMs:0,operationalMaturity:'CLOSED',presentationLabel:'LIVE / MATCH CONCLUSO',shouldDeferNews:true,reason:'Kickoff passato: niente nuova scansione pre-match.'};
  }
  if(hours<=48){
    return {version:VERSION,policyVersion:POLICY_VERSION,stage:STAGES.FULL,hoursToKickoff:Number(hours.toFixed(2)),daysToKickoff:Number(days.toFixed(2)),liveNewsMode:'FULL',providerTimeoutMs:5000,operationalMaturity:'FINAL_WINDOW',presentationLabel:'FULL PRE-MATCH',shouldDeferNews:false,reason:'Entro 48h: news/medical e lineup hanno rilevanza operativa crescente.'};
  }
  if(hours<=168){
    return {version:VERSION,policyVersion:POLICY_VERSION,stage:STAGES.MID,hoursToKickoff:Number(hours.toFixed(2)),daysToKickoff:Number(days.toFixed(2)),liveNewsMode:'BOUNDED',providerTimeoutMs:2500,operationalMaturity:'PRELIMINARY',presentationLabel:'PRE-MATCH IN AGGIORNAMENTO',shouldDeferNews:false,reason:'2-7 giorni: scansione news bounded, decisione ancora preliminare.'};
  }
  return {version:VERSION,policyVersion:POLICY_VERSION,stage:STAGES.EARLY,hoursToKickoff:Number(hours.toFixed(2)),daysToKickoff:Number(days.toFixed(2)),liveNewsMode:'DEFERRED',providerTimeoutMs:0,operationalMaturity:'PREVIEW_ONLY',presentationLabel:'EARLY PREVIEW · DATI NON MATURI',shouldDeferNews:true,reason:'Oltre 7 giorni: news/lineup live differite; nessuna assenza di news viene interpretata come segnale negativo o positivo.'};
}
function deferredTeamProfile(teamName=''){
  return {
    score:0, confidence:35, report:'News live differite dalla policy temporale · nessuna inferenza su assenze/formazione.', color:'#94a3b8',
    tactics:{isEmergency:false,keyPlayerOut:false,defenseOut:false,attackOut:false,mentions:0},
    sourceError:null, sourceVersion:VERSION,
    sourceIntelligence:{
      version:VERSION,status:'DEFERRED_TEMPORAL',deferred:true,teamName:text(teamName),coverageConfidence:0,matchImpactConfidence:0,confidence:35,
      counts:{rawArticles:0,uniqueArticles:0,usableArticles:0,officialArticles:0},articles:[],providers:[],contradictions:[],
      warnings:['Acquisizione news live differita: il match e oltre la finestra di 7 giorni.']
    },
    teamName:text(teamName)
  };
}
function isPreliminary(stage){ return stage===STAGES.EARLY || stage===STAGES.MID; }
module.exports={VERSION,POLICY_VERSION,STAGES,evaluate,deferredTeamProfile,isPreliminary};
