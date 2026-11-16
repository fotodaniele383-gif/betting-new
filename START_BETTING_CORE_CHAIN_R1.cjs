// STARTUP R1: allow only audited, exact revisions. No disabled hash checks.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const VERSION='BETTINGAPP_STARTUP_R1_PATCH_CHAIN_20261109';
const LEGACY_SERVER='01592301b41839ffc6ec1de53f7b909d07d31c90f3157e797fca6d46f0150718';
const TENNIS_SERVER='b35154f10c7a2dcccdfc62d1c8212e9ffa54fb2c43bac3229965206380fc5da5';
const MANUAL_SERVER='0b971e1807d2cc1aaff633b753136cf861a499f653c90d97dd1782e4f86a3fce';
const RELIABILITY_FILES={
  "backend/reliability10/common.js": "3fffd90d3db542ea3d340c18aab958996e833dc9856dbf97fb97cd7b5f04fe9e",
  "backend/reliability10/calcioEventAudit.js": "642861d174c86e2f317b1ccaf44204cf2b986aeda174e2385eff11149b046991",
  "backend/reliability10/calcioSourceAudit.js": "bab03c01625ff6f45c3c7fa46b9148fd586af213311da945e49f9217b8d9cb4f",
  "backend/reliability10/calcioProbabilityAudit.js": "6be42dcb7272d8ea9c874ccd5c6e79970409ee4be761a8970ca5da99325738dd",
  "backend/reliability10/calcioPayoffAudit.js": "b115f3f9458de3246c4269a5c114db0806dcb39faee80530c2b0fb356437ff50",
  "backend/reliability10/calcioDecisionAudit.js": "b7d94cbc6f2a368ceca744e781c78c5a6c4965e893bb0385d2e41863e9ecc1f7",
  "backend/reliability10/tennisEventAudit.js": "e2979c168c237d44a97125cd55623db8ef205c8f79557b6de440e005c6b1a59e",
  "backend/reliability10/tennisSourceAudit.js": "470c91b5aae421e55c28c42bb398ce17e31dd65c9714132295bc09bc2eacca34",
  "backend/reliability10/tennisProbabilityAudit.js": "f98b9d3c98742690b6211ba6011328c0b142dace86ae465edbd3b1de7e878192",
  "backend/reliability10/tennisPayoffAudit.js": "c83423cd274d14c765b24893c7af4f97cff8b45f8afcc7ef678e42336b7928ab",
  "backend/reliability10/tennisDecisionAudit.js": "aa165672fd28e84888c17ca3b92954eed37fb3a529e3707b18b3c4cdeb7abcb9",
  "backend/calcioDecisionCertification.js": "30b2fd548b55c4f6f925cbd2b7ff2b925bd1193aae76eeecb00444f64e075e53",
  "backend/calcioAiFinalization.js": "af8cffe7b240f94c1ef681aa9177fdb34a6fe57b50a27fc93e921f713976a5e0",
  "backend/tennisValueEvaluator.js": "9147551247bdd12d9037ca21c01918883045328aea5731958637dee66297e17d",
  "backend/public/quantMatchPromptBridgeV4.js": "18a55dbe8fef3fad09cde2d2521e42e10ca857c31b47707dc27bedc16d1f5feb"
};
const MANUAL_EDITED={
  "backend/server.js": {
    "before": "01592301b41839ffc6ec1de53f7b909d07d31c90f3157e797fca6d46f0150718",
    "after": "0b971e1807d2cc1aaff633b753136cf861a499f653c90d97dd1782e4f86a3fce"
  },
  "backend/safe13ManualRouteGuard.js": {
    "before": "749c6860d9d963269e1588ea4644ebadad165a79ad218593b599fbb51d7fe8bc",
    "after": "d7b7dcddc0ef61bc8afb0cc1a7482cdf1010488f2b6c2f9d37cfdb90e15b8b92"
  },
  "backend/public/index.html": {
    "before": "206c5373cea83f21f7974b93b1e3662734eda9fc58ca908fdeb92629507323c8",
    "after": "8ff5d733330226719147db0964d31c8e43e28764623749c73467f02cbed76185"
  }
};
const MANUAL_ADDED={
  "backend/realManualMode.js": "7c7deaf9d3f1a2ff2d0bcc7c5dd85afdf8ec7589c527cb1e0a2f4564d9d93dc9",
  "backend/public/real-manual.js": "337d7d7b9fb220b55a5b985ba16484c02e001b4d8ab2e700567c5fde853f24a9",
  "backend/public/real-manual.html": "3f860b760f8593d7eafd835530ffdfecc0219956ab7ececc37e4e9f6b6a4e7db",
  "AVVIA_REALE_MANUALE.cmd": "baeefe63cc0afce4939b0036c24484e29b1abd0ff3b0d3be02b35d96c71a18fb"
};
const R17_WITNESS={file:'backend/calcioDeepScanEvidenceR17.js',sha:'91b4cf894556be2ce7614a38c5208dd1bc5b801ef4790fb866993d16c7919bd3'};
function fail(code){throw Error('CORE_CHAIN_'+code);}
function hashFile(root,rel){
  const file=path.join(root,rel);
  let st;try{st=fs.lstatSync(file);}catch{fail('MISSING:'+rel)}
  if(!st.isFile()||st.isSymbolicLink())fail('NOT_REGULAR_FILE:'+rel);
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function readJSON(root,rel){
  const f=path.join(root,rel);let st;try{st=fs.lstatSync(f);}catch{fail('STATE_MISSING:'+rel)}
  if(!st.isFile()||st.isSymbolicLink())fail('STATE_NOT_REGULAR:'+rel);
  try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{fail('STATE_INVALID:'+rel)}
}
function sameKeys(obj,expect,label){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))fail('STATE_KEYS_INVALID:'+label);
  const actual=Object.keys(obj).sort().join('|'),required=Object.keys(expect).sort().join('|');
  if(actual!==required)fail('STATE_KEYS_DIFFER:'+label);
}
function assertTrustedCore({root,state}){
  if(!root||!state)fail('INVALID_ARGUMENTS');
  const legacyStateOk=state.version==='BETTINGAPP_MANUALE_PULITO_R1_20261105'&&
    state.mode==='SAFE13_MANUAL_PAPER_ONLY'&&state.server_sha256===LEGACY_SERVER&&state.tennis_sha256===TENNIS_SERVER;
  if(!legacyStateOk)fail('LEGACY_STATE_CHANGED');
  if(hashFile(root,'backend/server.tennis.js')!==TENNIS_SERVER)fail('TENNIS_CORE_CHANGED');
  const currentServer=hashFile(root,'backend/server.js');
  const rmStatePath=path.join(root,'.bettingapp_real_manual_patch','state.json');
  if(currentServer===LEGACY_SERVER){
    if(fs.existsSync(rmStatePath))fail('REAL_MANUAL_INCOMPLETE');
    return {mode:'ORIGINAL_BASE',serverHash:currentServer};
  }
  if(currentServer!==MANUAL_SERVER)fail('SERVER_CORE_UNRECOGNIZED');
  const r17=readJSON(root,'.bettingapp_r17_state.json');
  if(r17.version!=='BETTINGAPP_R17_CALCIO_DEEPSCAN_QUALITATIVE_MEDICAL_CLEAN_20261108')fail('R17_VERSION_UNKNOWN');
  if(hashFile(root,R17_WITNESS.file)!==R17_WITNESS.sha)fail('R17_WITNESS_CHANGED');
  const r10=readJSON(root,'.bettingapp_reliability10/state.json');
  if(r10.version!=='BETTINGAPP_RELIABILITY10_V1_20261109'||r10.baseVersion!=='21.46.0'||
     r10.r17Version!==r17.version||!Array.isArray(r10.stages)||r10.stages.length!==10||
     r10.stages.map(s=>s.id).join(',')!=='C01,C02,C03,C04,C05,T01,T02,T03,T04,T05')fail('RELIABILITY10_VERSION_OR_STAGE');
  if(!Array.isArray(r10.files)||r10.files.length!==Object.keys(RELIABILITY_FILES).length)fail('RELIABILITY10_FILE_COUNT');
  const r10Lookup={};
  for(const f of r10.files){if(!f||typeof f.rel!=='string'||Object.prototype.hasOwnProperty.call(r10Lookup,f.rel))fail('RELIABILITY10_FILE_DUPLICATE');r10Lookup[f.rel]=f.installed;}
  sameKeys(r10Lookup,RELIABILITY_FILES,'RELIABILITY10');
  for(const [rel,expected] of Object.entries(RELIABILITY_FILES)){
    if(r10Lookup[rel]!==expected||hashFile(root,rel)!==expected)fail('RELIABILITY10_HASH:'+rel);
  }
  const manual=readJSON(root,'.bettingapp_real_manual_patch/state.json');
  if(manual.version!=='BETTINGAPP_REAL_MANUAL_V1_20261109'||manual.historicalDbChanged!==false)fail('REAL_MANUAL_VERSION');
  sameKeys(manual.edited,MANUAL_EDITED,'MANUAL_EDITED');
  sameKeys(manual.added,MANUAL_ADDED,'MANUAL_ADDED');
  for(const [rel,expected] of Object.entries(MANUAL_EDITED)){
    const record=manual.edited[rel];
    if(!record||record.before!==expected.before||record.after!==expected.after||hashFile(root,rel)!==expected.after)fail('REAL_MANUAL_EDITED_HASH:'+rel);
  }
  for(const [rel,expected] of Object.entries(MANUAL_ADDED)){
    if(manual.added[rel]!==expected||hashFile(root,rel)!==expected)fail('REAL_MANUAL_ADDED_HASH:'+rel);
  }
  return {mode:'RELIABILITY10_PLUS_REAL_MANUAL',serverHash:currentServer};
}
module.exports={VERSION,assertTrustedCore};
