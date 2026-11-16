#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const mod=require(path.join(root,'backend','tennisWtaSourceDiscoveryPatch43.js'));
const sourceFile=path.join(root,'backend','sackmann_data','wta_matches_2026.csv');
const localText=fs.readFileSync(sourceFile,'utf8');
function newerCsv(text){const lines=text.trimEnd().split(/\r?\n/);const cols=lines[0].split(',');const dateIndex=cols.indexOf('tourney_date');const row=lines[1].split(',');row[dateIndex]='20260803';row[0]='2026-P43-NEW';row[1]='Patch43 Fixture';lines[1]=row.join(',');return lines.join('\n')+'\n';}
const remoteText=newerCsv(localText);
const checks=[];function check(name,ok,details={}){checks.push({name,ok:Boolean(ok),details});if(!ok)throw new Error(name);}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p43-'));
 try{
  check('versione modulo',mod.VERSION==='TENNIS_WTA_SOURCE_DISCOVERY_V1_PATCH43',{version:mod.VERSION});
  const personal=mod.sourceRegistry(2026,{usageMode:'PERSONAL_RESEARCH'});
  check('registry sorgenti separato',personal.map(x=>x.id).join('|')==='TENNISDATA_APP_LOCAL_IMPORT|JEFF_SACKMANN_GITHUB_DISCOVERY|HUGGINGFACE_SACKMANN_ARCHIVE|LAST_KNOWN_GOOD');
  const commercial=mod.sourceRegistry(2026,{usageMode:'COMMERCIAL'});
  check('guard licenza commerciale',commercial.find(x=>x.id==='JEFF_SACKMANN_GITHUB_DISCOVERY').enabled===false&&commercial.find(x=>x.id==='HUGGINGFACE_SACKMANN_ARCHIVE').enabled===false);
  let blocked=false;try{mod.requestText('https://example.com/file.csv')}catch(e){blocked=/HOST_BLOCKED/.test(e.message)}
  check('allowlist host',blocked);
  const calls=[];
  async function requester(url){calls.push(url);if(url==='https://api.github.com/repos/JeffSackmann/tennis_wta')return{statusCode:200,text:JSON.stringify({default_branch:'main'}),headers:{},url};if(url.includes('/contents/wta_matches_2026.csv'))return{statusCode:200,text:JSON.stringify({download_url:'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/main/wta_matches_2026.csv',path:'wta_matches_2026.csv'}),headers:{},url};if(url.includes('raw.githubusercontent.com'))return{statusCode:200,text:remoteText,headers:{etag:'fixture-etag'},url};if(url.includes('huggingface.co'))return{statusCode:200,text:remoteText,headers:{},url};throw new Error('UNEXPECTED_URL:'+url)}
  const github=await mod.fetchGithubCandidate(2026,{dataDir:temp,requester,force:true});
  check('discovery GitHub branch dinamico',github.branch==='main'&&github.discoveredPath==='wta_matches_2026.csv',{branch:github.branch});
  check('download GitHub risolto',github.text.includes('2026-P43-NEW')&&calls.some(x=>x.includes('/contents/wta_matches_2026.csv')));
  const inspection=mod.inspect(remoteText,2026,'FIXTURE',{now:'2026-08-04T12:00:00Z'});
  const localInspection=mod.inspect(localText,2026,'LKG',{now:'2026-08-04T12:00:00Z'});
  const comparison=mod.compare(inspection,localInspection,2026);
  check('candidato più recente accettato',comparison.accepted&&inspection.latestMatchAt>localInspection.latestMatchAt,{before:localInspection.latestMatchAt,after:inspection.latestMatchAt});
  const dataDir=path.join(temp,'data');fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(path.join(dataDir,'wta_matches_2026.csv'),localText);
  const beforeHash=crypto.createHash('sha256').update(localText).digest('hex');
  const result=await mod.refresh({dataDir,projectRoot:temp,year:2026,now:'2026-08-04T12:00:00Z',force:true,requester,playerEvidence:{init(){return{initialized:true,matchCount:1300}}}});
  check('attivazione atomica',result.success&&result.status==='WTA_REFRESH_ACTIVATED'&&result.dataChanged===true,{status:result.status,provider:result.selectedProvider});
  const after=fs.readFileSync(path.join(dataDir,'wta_matches_2026.csv'),'utf8');
  check('file candidato attivato',after.includes('2026-P43-NEW'));
  check('backup LKG creato',Boolean(result.backup)&&fs.existsSync(result.backup),{backup:result.backup});
  const second=await mod.refresh({dataDir,projectRoot:temp,year:2026,now:'2026-08-04T13:00:00Z',force:false,requester,playerEvidence:{init(){return{initialized:true,matchCount:1300}}}});
  check('throttle 12 ore',second.status==='SKIPPED_RECENT_ATTEMPT');
  const failDir=path.join(temp,'fail');fs.mkdirSync(failDir,{recursive:true});fs.writeFileSync(path.join(failDir,'wta_matches_2026.csv'),localText);
  const failed=await mod.refresh({dataDir:failDir,projectRoot:temp,year:2026,now:'2026-08-04T12:00:00Z',force:true,requester,playerEvidence:{init(){throw new Error('PLAYER_EVIDENCE_FAIL')}}});
  const restored=crypto.createHash('sha256').update(fs.readFileSync(path.join(failDir,'wta_matches_2026.csv'))).digest('hex');
  check('rollback LKG su failure',failed.success===false&&failed.status==='FAILED_LKG_PRESERVED'&&restored===beforeHash,{status:failed.status});
  const offline=await mod.probe({dataDir,projectRoot:temp,year:2026,skipNetwork:true,usageMode:'COMMERCIAL'});
  check('probe offline senza attivazione',offline.noActivation===true&&offline.selectedProvider==='LAST_KNOWN_GOOD');
  check('nessuna autorità production',offline.authority.probability===false&&offline.authority.stake===false&&offline.authority.settlement===false);
  console.log(JSON.stringify({success:true,patch:'43',checks,checksCount:checks.length},null,2));
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(error=>{console.log(JSON.stringify({success:false,patch:'43',error:error.message,checks},null,2));process.exit(1)});
