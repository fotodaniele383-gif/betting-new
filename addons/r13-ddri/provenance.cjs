'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const validTime=(s)=>typeof s==='string'&&/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/.test(s)&&Number.isFinite(Date.parse(s));
function strictTime(s,code='TIMESTAMP_INVALID'){if(!validTime(s))throw Error(code);return Date.parse(s);}
function evidenceReview(obj,{decisionAsOf,maxAgeDays=21,requireBookmaker=false}={}){
 const reasons=[]; if(!obj||typeof obj!=='object')return {ok:false,reasons:['EVIDENCE_MISSING']};
 if(!obj.provider||typeof obj.provider!=='string')reasons.push('PROVIDER_MISSING');
 if(!obj.sourceUrl||!/^https:\/\//i.test(obj.sourceUrl))reasons.push('HTTPS_SOURCE_URL_MISSING');
 if(!obj.licenseId||!['PERMISSION_DOCUMENTED','PUBLIC_DOMAIN','CC_BY_4_0','CC_BY_NC_SA_4_0','OWNER_CONSENT','OFFICIAL_PUBLIC_FREE_PRIVATE_USE'].includes(obj.licenseId))reasons.push('LICENSE_UNASSESSED');
 if(obj.usageApproved!==true)reasons.push('RIGHTS_USE_NOT_APPROVED');
 if(!obj.artifactSha256||!/^[0-9a-f]{64}$/i.test(obj.artifactSha256))reasons.push('ARTIFACT_HASH_MISSING');
 if(obj.independentlyVerified!==true)reasons.push('INDEPENDENT_VALIDATION_NOT_PROVED');
 if(requireBookmaker&&(!obj.bookmaker||!obj.originalMarketId||obj.originalQuoteVerified!==true))reasons.push('BOOKMAKER_ORIGINAL_QUOTE_NOT_VERIFIED');
 try{const asOf=strictTime(decisionAsOf,'DECISION_ASOF_INVALID'),seen=strictTime(obj.observedAt,'EVIDENCE_TIMESTAMP_INVALID');if(seen>asOf)reasons.push('AFTER_DECISION_LOOKAHEAD');if(asOf-seen>maxAgeDays*86400000)reasons.push('EVIDENCE_TOO_OLD');}catch(e){reasons.push(e.message);}
 if(obj.teamScope&& !['MEN_FIRST_TEAM','WOMEN_FIRST_TEAM','YOUTH','NOT_APPLICABLE'].includes(obj.teamScope))reasons.push('TEAM_SCOPE_UNCLEAR');
 if(obj.teamScope==='YOUTH'||obj.teamScope==='WOMEN_FIRST_TEAM'&&obj.requestedScope==='MEN_FIRST_TEAM')reasons.push('WRONG_TEAM_SCOPE');
 return {ok:reasons.length===0,reasons};
}
function joinReview(match,candidate){
 const fail=[];if(!match||!candidate) return {ok:false,reasons:['MATCH_JOIN_INPUT_REQUIRED']};
 // Names alone are never a sufficient join key. Same player pair can recur multiple times.
 for(const key of ['eventId','startAt','competition','marketId'])if(!match[key]||!candidate[key]||match[key]!==candidate[key])fail.push('JOIN_'+key.toUpperCase()+'_MISMATCH');
 if(match.sport!==candidate.sport)fail.push('JOIN_SPORT_MISMATCH');
 if(!match.sideAId||!match.sideBId||match.sideAId!==candidate.sideAId||match.sideBId!==candidate.sideBId)fail.push('JOIN_PARTICIPANTS_MISMATCH');
 return {ok:fail.length===0,reasons:fail};
}
function calibrationReview(proof,{decisionAsOf,minHoldout=100}={}){
 const r=[];if(!proof||typeof proof!=='object')return {ok:false,reasons:['CALIBRATION_PROOF_MISSING']};
 if(!Number.isInteger(proof.holdoutN)||proof.holdoutN<minHoldout)r.push('HOLDOUT_SAMPLE_LOW');
 if(!Number.isFinite(proof.brier)||proof.brier<0||proof.brier>1)r.push('BRIER_UNVERIFIED');
 if(!Number.isFinite(proof.logLoss)||proof.logLoss<0)r.push('LOGLOSS_UNVERIFIED');
 if(!Number.isFinite(proof.ece)||proof.ece<0||proof.ece>1)r.push('ECE_UNVERIFIED');
 if(proof.temporalSplit!=='WALK_FORWARD_PRIOR_ONLY')r.push('TEMPORAL_SPLIT_NOT_VERIFIED');
 if(proof.dataLeakageAudited!==true)r.push('DATA_LEAKAGE_AUDIT_MISSING');
 if(!proof.segmentId)r.push('MARKET_SEGMENT_MISSING');
 try{
  const trainEnd=strictTime(proof.trainEnd),calStart=strictTime(proof.calibrationStart),calEnd=strictTime(proof.calibrationEnd),testStart=strictTime(proof.holdoutStart),testEnd=strictTime(proof.holdoutEnd),asOf=strictTime(decisionAsOf);
  if(!(trainEnd<calStart&&calStart<=calEnd&&calEnd<testStart&&testStart<=testEnd&&testEnd<asOf))r.push('TEMPORAL_LEAKAGE_OR_OVERLAP');
 }catch(e){r.push('CALIBRATION_TIME_INVALID');}
 return {ok:r.length===0,reasons:r};
}
const sha256File=async f=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const s=fs.createReadStream(f);s.on('data',b=>h.update(b));s.on('error',reject);s.on('end',()=>resolve(h.digest('hex')));});
module.exports={strictTime,evidenceReview,joinReview,calibrationReview,sha256File};
