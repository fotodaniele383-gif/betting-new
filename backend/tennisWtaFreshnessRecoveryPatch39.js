'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'TENNIS_WTA_FRESHNESS_RECOVERY_V1_PATCH39';
const STATE_FILE = 'tennis_wta_patch39_refresh_state.json';
const MIN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function writeJsonAtomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,file);}
function usageAllowed(options={}){const mode=String(options.usageMode||process.env.TENNIS_DATA_USAGE_MODE||'PERSONAL_RESEARCH').toUpperCase();return{allowed:!['COMMERCIAL','PRODUCTION_COMMERCIAL'].includes(mode),mode};}
async function refreshWtaOnly(options={}){
  const dataDir=path.resolve(options.dataDir);const now=new Date(options.now||Date.now());const statePath=path.join(dataDir,STATE_FILE);const prior=readJson(statePath,{});const use=usageAllowed(options);
  if(!use.allowed)return{success:false,status:'DISABLED_LICENSE_MODE',version:VERSION,usageMode:use.mode,dataChanged:false,authority:false};
  if(!options.force&&prior.lastAttemptAt&&now.getTime()-new Date(prior.lastAttemptAt).getTime()<MIN_REFRESH_INTERVAL_MS)return{success:true,status:'SKIPPED_RECENT_ATTEMPT',version:VERSION,usageMode:use.mode,state:prior,dataChanged:false};
  const multi=options.multiProvider||require('./tennisMultiProviderData');const refresh=options.refreshModule||require('./tennisPlayerDataRefresh');const playerEvidence=options.playerEvidence||require('./tennisPlayerEvidence');const target=multi.targetRegistry(now.getUTCFullYear()).find(x=>x.id==='WTA_MAIN');const file=path.join(dataDir,target.localFile);const beforeBytes=fs.existsSync(file)?fs.readFileSync(file):null;const beforeInspection=beforeBytes?refresh.inspectCsvText(beforeBytes.toString('utf8'),target,{now}):null;const operationId=options.operationId||`WTA39_${Date.now()}`;
  try{
    const candidate=await multi.githubWtaCandidate(target,{...options,dataDir,year:now.getUTCFullYear(),now,force:options.force===true});
    const inspection=refresh.inspectCsvText(candidate.text,target,{now});
    const comparison=refresh.compareRemoteToLocal(inspection,beforeInspection,target);
    if(!comparison.accepted){const result={success:true,status:'CANDIDATE_REJECTED_LKG_PRESERVED',version:VERSION,operationId,usageMode:use.mode,dataChanged:false,before:beforeInspection?{latestMatchAt:beforeInspection.latestMatchAt,validRows:beforeInspection.validRows,sha256:beforeInspection.sha256}:null,candidate:{latestMatchAt:inspection.latestMatchAt,validRows:inspection.validRows,sha256:inspection.sha256},comparison,networkCalls:candidate.networkCalls||0,fromCache:candidate.fromCache===true};writeJsonAtomic(statePath,{...result,lastAttemptAt:now.toISOString()});return result;}
    const tmp=`${file}.patch39-new`;fs.writeFileSync(tmp,candidate.text,'utf8');const staged=refresh.inspectCsvText(fs.readFileSync(tmp,'utf8'),target,{now});if(staged.sha256!==inspection.sha256)throw new Error('PATCH39_WTA_STAGED_HASH_MISMATCH');fs.renameSync(tmp,file);let active;try{active=playerEvidence.init(dataDir,{force:true});}catch(error){if(beforeBytes)fs.writeFileSync(file,beforeBytes);throw error;}
    const afterBytes=fs.readFileSync(file);const result={success:true,status:'WTA_REFRESH_ACTIVATED',version:VERSION,operationId,usageMode:use.mode,dataChanged:!beforeBytes||sha(beforeBytes)!==sha(afterBytes),before:beforeInspection?{latestMatchAt:beforeInspection.latestMatchAt,validRows:beforeInspection.validRows,sha256:beforeInspection.sha256}:null,after:{latestMatchAt:inspection.latestMatchAt,validRows:inspection.validRows,sha256:inspection.sha256},networkCalls:candidate.networkCalls||0,fromCache:candidate.fromCache===true,activeStatus:{latestMatchAt:active?.latestMatchAt,matchCount:active?.matchCount,playerCount:active?.playerCount},probabilityAuthority:false,stakeAuthority:false};writeJsonAtomic(statePath,{...result,lastAttemptAt:now.toISOString(),lastSuccessAt:now.toISOString()});return result;
  }catch(error){if(beforeBytes&&!fs.existsSync(file))fs.writeFileSync(file,beforeBytes);const result={success:false,status:'FAILED_LKG_PRESERVED',version:VERSION,operationId,usageMode:use.mode,error:error.message,dataChanged:false,lastKnownGoodPreserved:Boolean(beforeBytes),probabilityAuthority:false,stakeAuthority:false};writeJsonAtomic(statePath,{...result,lastAttemptAt:now.toISOString(),previousSuccessAt:prior.lastSuccessAt||null});return result;}
}
function schedule(options={}){if(String(process.env.TENNIS_PATCH39_WTA_AUTO_REFRESH||'1')==='0')return{enabled:false,reason:'ENV_DISABLED'};const delay=Math.max(5000,Number(options.delayMs||45000));const timer=setTimeout(()=>{refreshWtaOnly(options).then(result=>options.onResult?.(result)).catch(error=>options.onError?.(error));},delay);timer.unref?.();return{enabled:true,delayMs:delay,version:VERSION};}
function health(options={}){const dataDir=path.resolve(options.dataDir);const state=readJson(path.join(dataDir,STATE_FILE),null);return{version:VERSION,usage:usageAllowed(options),state,autoRefreshEnabled:String(process.env.TENNIS_PATCH39_WTA_AUTO_REFRESH||'1')!=='0',minimumRefreshIntervalHours:MIN_REFRESH_INTERVAL_MS/3600000,provider:'JEFF_SACKMANN_GITHUB',license:'CC_BY_NC_SA_4_0',probabilityAuthority:false,stakeAuthority:false};}
const legacyRefreshWtaOnly = refreshWtaOnly;
function patch52Module(){ return require('./tennisWtaInformationRecoveryPatch52'); }
async function refreshWtaOnlyPatch52(options={}) { return patch52Module().refresh(options); }
function schedulePatch52(options={}) { return patch52Module().schedule(options); }
function healthPatch52(options={}) { return { legacyVersion:VERSION, supersededBy:patch52Module().VERSION, ...patch52Module().health(options) }; }
module.exports={VERSION,STATE_FILE,MIN_REFRESH_INTERVAL_MS,usageAllowed,legacyRefreshWtaOnly,refreshWtaOnly:refreshWtaOnlyPatch52,schedule:schedulePatch52,health:healthPatch52};
