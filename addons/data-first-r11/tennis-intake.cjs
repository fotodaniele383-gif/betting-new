'use strict';
/** Conservative full-year CSV staging and opt-in activation through BettingApp's existing Patch21 multi-provider. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const VERSION='BETTINGAPP_R11_TENNIS_CANONICAL_INTAKE_V1';
const DEFAULT='C:\\Users\\pc-user\\Documents\\Personale\\BettingApp\\BettingApp v2';
const TARGETS={WTA_MAIN:{file:'wta_matches_2026.csv',min:500},ATP_MAIN:{file:'atp_matches_2026.csv',min:500},ATP_QUAL_CHALL:{file:'atp_matches_challenger_2026.csv',min:900}};
const sh=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function error(code){throw Error('R11_'+code)}
function assertFile(f){if(!fs.existsSync(f)||!fs.statSync(f).isFile()||fs.lstatSync(f).isSymbolicLink())error('INPUT_MISSING_OR_UNSAFE');let s=fs.statSync(f).size;if(s<500||s>25*1024*1024)error('CSV_SIZE_INVALID');return f;}
function readFormat(root,target,input,now=new Date()){
 const spec=TARGETS[target];if(!spec)error('TARGET_UNSUPPORTED:'+target);
 const refresh=require(path.join(root,'backend','tennisPlayerDataRefresh.js'));
 const src=refresh.inspectCsvFile(assertFile(input),{id:target,localFile:spec.file,minRows:spec.min},{now,maxInvalidRatePct:2});
 if(src.rejectedRows>0)error('CSV_INVALID_OR_FUTURE_ROWS_NEED_CLEAN_INPUT:'+src.rejectedRows);
 const local=path.join(root,'backend','sackmann_data',spec.file);const prev=fs.existsSync(local)?refresh.inspectCsvFile(local,{id:target,localFile:spec.file,minRows:spec.min},{now,maxInvalidRatePct:5}):null;
 const cmp=refresh.compareRemoteToLocal(src,prev,{id:target,minRows:spec.min});
 const age=(now-new Date(src.latestMatchAt))/86400000;
 if(!Number.isFinite(age)||age < -1)error('CSV_CONTAINS_FUTURE_MATCHES');
 if(age>21)error('CSV_NOT_CURRENT_LAST_MATCH_AGE_DAYS='+age.toFixed(1));
 if(!cmp.accepted)error('CSV_REGRESSION:'+cmp.reasons.join(','));
 if(prev&&src.latestMatchAt<=prev.latestMatchAt)error('CSV_NOT_NEWER_THAN_ACTIVE_DATA');
 const text=fs.readFileSync(input,'utf8'),headers=text.replace(/^\uFEFF/,'').split(/\r?\n/,1)[0];
 for(const required of ['tourney_date','winner_name','loser_name','score','best_of','surface'])if(!headers.split(',').includes(required))error('CSV_REQUIRED_COLUMN_'+required);
 return{target,src,previous:prev&&{validRows:prev.validRows,latestMatchAt:prev.latestMatchAt,sha256:prev.sha256},ageDays:Number(age.toFixed(2)),inputHash:sh(input),inputSize:fs.statSync(input).size};
}
function stage(root,target,input,source,license,{now=new Date(),commit=false}={}){
 root=path.resolve(root);input=path.resolve(input);const d=readFormat(root,target,input,now);
 if(!/^https:\/\/[^\s]{5,300}$/.test(String(source||'')))error('PROVENANCE_HTTPS_SOURCE_REQUIRED');
 if(!/^(?:CC-BY-4\.0|CC-BY-NC-SA-4\.0|USER_LICENSED|RIGHTS_VERIFIED|UNKNOWN_REVIEW_REQUIRED)$/.test(String(license||'')))error('LICENSE_LABEL_REQUIRED');
 const name=TARGETS[target].file,imports=path.join(root,'data','tennis_provider_imports'),dest=path.join(imports,'canonical',name);
 const report={version:VERSION,target,source,license,sha256:d.inputHash,validRows:d.src.validRows,rejectedRows:d.src.rejectedRows,latestMatchAt:d.src.latestMatchAt,ageDays:d.ageDays,previous:d.previous,mode:commit?'STAGED_NOT_ACTIVATED':'DRY_RUN',origin:'USER_PROVIDED_CSV_NOT_INDEPENDENTLY_CERTIFIED',noAutomaticStake:true};
 if(commit){fs.mkdirSync(path.dirname(dest),{recursive:true});const metaDir=path.join(imports,'r11-provenance');fs.mkdirSync(metaDir,{recursive:true});if(fs.existsSync(dest)&&sh(dest)!==d.inputHash){const backup=path.join(metaDir,name+'.previous-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.copyFileSync(dest,backup);report.previousCandidateBackup=backup;}
  const tmp=dest+'.r11-new-'+process.pid;fs.copyFileSync(input,tmp);if(sh(tmp)!==d.inputHash){fs.rmSync(tmp,{force:true});error('STAGE_HASH_MISMATCH');}
  if(fs.existsSync(dest)&&sh(dest)===d.inputHash)fs.rmSync(tmp,{force:true});
  else{try{if(fs.existsSync(dest))fs.rmSync(dest,{force:true});fs.renameSync(tmp,dest);}catch(e){fs.rmSync(tmp,{force:true});if(report.previousCandidateBackup&&fs.existsSync(report.previousCandidateBackup))fs.copyFileSync(report.previousCandidateBackup,dest);throw e;}}
  if(sh(dest)!==d.inputHash)error('STAGED_HASH_MISMATCH');
  const meta=path.join(metaDir,name+'.json'),t=meta+'.new-'+process.pid;fs.writeFileSync(t,JSON.stringify({...report,stagedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});fs.renameSync(t,meta);
 }
 return report;
}
async function portClosed(port){return new Promise((resolve,reject)=>{const s=new net.Socket();let ended=false;const done=up=>{if(ended)return;ended=true;s.destroy();up?reject(Error('R11_STOP_SERVER_BEFORE_ACTIVATION_PORT_'+port)):resolve();};s.setTimeout(1000);s.once('connect',()=>done(true));s.once('error',()=>done(false));s.once('timeout',()=>done(false));s.connect(port,'127.0.0.1');});}
async function activate(root,{now=new Date(),refreshModule=null}={}){
 await Promise.all([portClosed(3188),portClosed(3191)]);
 const importRoot=path.join(root,'data','tennis_provider_imports');const staged=[];
 for(const [target,spec] of Object.entries(TARGETS)){
  const input=path.join(importRoot,'canonical',spec.file);if(!fs.existsSync(input))continue;
  const m=path.join(importRoot,'r11-provenance',spec.file+'.json');if(!fs.existsSync(m))error('PROVENANCE_MISSING_'+target);
  const meta=JSON.parse(fs.readFileSync(m,'utf8'));if(meta.version!==VERSION||meta.sha256!==sh(input)||meta.target!==target)error('PROVENANCE_INVALID_'+target);
  if(meta.license==='UNKNOWN_REVIEW_REQUIRED')error('LICENSE_NOT_REVIEWED_'+target);
  const check=readFormat(root,target,input,now);staged.push({target,hash:check.inputHash,latestMatchAt:check.src.latestMatchAt});
 }
 if(!staged.length)error('NO_STAGED_CANDIDATES');
 // The original Patch21 engine owns backup/rollback and data activation; R11 never writes active CSV directly.
 const provider=refreshModule||require(path.join(root,'backend','tennisMultiProviderData.js'));
 const result=await provider.refreshMultiProvider({dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root,importDir:importRoot,now,apiEnabled:false,operationId:'R11_MANUAL_'+Date.now()});
 const used=(result.selected||[]).filter(x=>x.providerId==='LOCAL_CANONICAL_IMPORT');
 if(!staged.every(x=>used.some(y=>y.targetId===x.target)))error('STAGED_CANDIDATE_NOT_SELECTED_CHECK_LKG_BACKUP');
 return{version:VERSION,status:'R11_DATA_ACTIVATED_BY_EXISTING_PATCH21',staged,selected:result.selected,dataChanged:result.dataChanged,originalBackup:result.manifest?.lastKnownGoodBackup||null,noStakeOrSqlWrites:true};
}
(async()=>{if(require.main!==module)return;try{
 const argv=process.argv.slice(2),action=argv[0],root=path.resolve(argv[1]||DEFAULT);
 if(action==='check'||action==='stage'){
  const target=argv[2],input=argv[3],source=argv[4],license=argv[5];if(!target||!input)error('USAGE_CHECK_OR_STAGE_TARGET_CSV_SOURCE_LICENSE');
  const report=stage(root,target,input,source,license,{commit:action==='stage'});console.log('R11_TENNIS_'+(action==='stage'?'STAGED':'CHECK')+'_PASS '+JSON.stringify(report));
 }else if(action==='activate'){activate(root).then(x=>console.log('R11_TENNIS_ACTIVATE_PASS '+JSON.stringify(x))).catch(e=>{console.error('R11_TENNIS_ACTIVATE_FAIL='+e.message);process.exitCode=1;});}
 else error('UNKNOWN_ACTION');
 }catch(e){console.error('R11_TENNIS_ERROR='+e.message);process.exitCode=1;}})();
module.exports={VERSION,TARGETS,readFormat,stage,activate};
