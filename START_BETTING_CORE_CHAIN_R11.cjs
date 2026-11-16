"use strict";
// MAIN R5 = trusted successor of MAIN R4 for exactly approved Tennis V6.2 R3 UI assets.
// This is a NEW chain. Original R3 and R4 historical helpers/receipts are never modified.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='BETTINGAPP_MAIN_R6_PROMPT_CALCIO_V63_NO_MINIMAX_WIDGET_20261110';
const OLD_LAUNCHER_SHA='e13f659a0623c23d5fd53aa87dde1242af987ff4d0334c8dad860980db926864';
const PINNED_R3_HELPER_SHA='705f13d05eafc95624f28a244175badfb7b479af893503e4e389f485b9938542';
const PINNED_R4_HELPER_SHA='a716aab42d8863ddb1c9e67e67fbb7e54fcadfce3c93582cfd6a85d3cacb5dc5';
const R2_LAUNCHER_HASH='e9f24e067157199d6dffbdae9f465dc37f311bc32dbde4fd863ec103b6c9d1a0';
const R2_HELPER_HASH='a09a8a84a5bdd988895c178b7c6b4e23f1afb895cd0b8962e8f01241a382fb58';
const OLD_CORE='01592301b41839ffc6ec1de53f7b909d07d31c90f3157e797fca6d46f0150718';
const TENNIS_CORE='b35154f10c7a2dcccdfc62d1c8212e9ffa54fb2c43bac3229965206380fc5da5';
const R10_FILES={
  'backend/reliability10/common.js':'3fffd90d3db542ea3d340c18aab958996e833dc9856dbf97fb97cd7b5f04fe9e',
  'backend/reliability10/calcioEventAudit.js':'642861d174c86e2f317b1ccaf44204cf2b986aeda174e2385eff11149b046991',
  'backend/reliability10/calcioSourceAudit.js':'bab03c01625ff6f45c3c7fa46b9148fd586af213311da945e49f9217b8d9cb4f',
  'backend/reliability10/calcioProbabilityAudit.js':'6be42dcb7272d8ea9c874ccd5c6e79970409ee4be761a8970ca5da99325738dd',
  'backend/reliability10/calcioPayoffAudit.js':'b115f3f9458de3246c4269a5c114db0806dcb39faee80530c2b0fb356437ff50',
  'backend/reliability10/calcioDecisionAudit.js':'b7d94cbc6f2a368ceca744e781c78c5a6c4965e893bb0385d2e41863e9ecc1f7',
  'backend/reliability10/tennisEventAudit.js':'e2979c168c237d44a97125cd55623db8ef205c8f79557b6de440e005c6b1a59e',
  'backend/reliability10/tennisSourceAudit.js':'470c91b5aae421e55c28c42bb398ce17e31dd65c9714132295bc09bc2eacca34',
  'backend/reliability10/tennisProbabilityAudit.js':'f98b9d3c98742690b6211ba6011328c0b142dace86ae465edbd3b1de7e878192',
  'backend/reliability10/tennisPayoffAudit.js':'c83423cd274d14c765b24893c7af4f97cff8b45f8afcc7ef678e42336b7928ab',
  'backend/reliability10/tennisDecisionAudit.js':'aa165672fd28e84888c17ca3b92954eed37fb3a529e3707b18b3c4cdeb7abcb9',
  'backend/calcioDecisionCertification.js':'30b2fd548b55c4f6f925cbd2b7ff2b925bd1193aae76eeecb00444f64e075e53',
  'backend/calcioAiFinalization.js':'af8cffe7b240f94c1ef681aa9177fdb34a6fe57b50a27fc93e921f713976a5e0',
  'backend/tennisValueEvaluator.js':'9147551247bdd12d9037ca21c01918883045328aea5731958637dee66297e17d',
  'backend/public/quantMatchPromptBridgeV4.js':'18a55dbe8fef3fad09cde2d2521e42e10ca857c31b47707dc27bedc16d1f5feb'
};
const TENNIS_V62_R3_APPROVED = Object.freeze({
  "backend/public/TENNIS_V6_2_MASTER.txt": "9548fd10fe9a777cda11e8b2f90d0ec45f4f18314fab05561595c108e478dea5",
  "backend/public/app.js": "1ecf2d3b73c54a6bf9ff6163872e190380fb1dbb449a823fba615ae63d813023",
  "backend/public/calcioEditorMainR3.js": "2d93295a829a7076aca1650ec8b7be13e0b91e44583463e5198e1cfd068a5674",
  "backend/public/index.html": "0105538787f8ea2b10193d223e161a0f3b0aae1a09cad6eab64ff3feaa393ee0",
  "backend/public/quantMatchPromptBridgeV4.js": "63ad336f42ea141a0bfaa16df24d238c7b8eb570fe81535f63e3ca119d3647cd",
  "backend/public/tennisDualSinglesV5UI.js": "34e97042ac9423a664eca142b09fcbe9c3df4a4f6f1b53429ab687cdfacf607f",
  "backend/public/tennisPromptV62.js": "788623e14f9a57e95167efa58d3c5b4801e03d51c29d17d9e615baa7d18d5dec",
  "backend/tennisCoreContractAudit.js": "0d982e6911eb64b29cb6fbdc3c6dacefc30f0efdee7588cfd1406f6f38942a97",
  "prompts/TENNIS_V6_2_MASTER.txt": "9548fd10fe9a777cda11e8b2f90d0ec45f4f18314fab05561595c108e478dea5",
  "public/TENNIS_V6_2_MASTER.txt": "9548fd10fe9a777cda11e8b2f90d0ec45f4f18314fab05561595c108e478dea5",
  "public/app.js": "1ecf2d3b73c54a6bf9ff6163872e190380fb1dbb449a823fba615ae63d813023",
  "public/calcioEditorMainR3.js": "2d93295a829a7076aca1650ec8b7be13e0b91e44583463e5198e1cfd068a5674",
  "public/index.html": "0105538787f8ea2b10193d223e161a0f3b0aae1a09cad6eab64ff3feaa393ee0",
  "public/quantMatchPromptBridgeV4.js": "63ad336f42ea141a0bfaa16df24d238c7b8eb570fe81535f63e3ca119d3647cd",
  "public/tennisDualSinglesV5UI.js": "34e97042ac9423a664eca142b09fcbe9c3df4a4f6f1b53429ab687cdfacf607f",
  "public/tennisPromptV62.js": "788623e14f9a57e95167efa58d3c5b4801e03d51c29d17d9e615baa7d18d5dec"
});

const R6_REPLACEMENTS=Object.freeze({
  "backend/public/index.html": "9fcd327f06ae5f8d23316f2851b9bb6598587213962a421e525274e860188bd7",
  "public/index.html": "9fcd327f06ae5f8d23316f2851b9bb6598587213962a421e525274e860188bd7",
  "backend/public/quantMatchPromptBridgeV4.js": "4440253cfc40645c8a7f1c5802d6039760e92ff4a9e7fcd8fa4a0da049952c06",
  "public/quantMatchPromptBridgeV4.js": "4440253cfc40645c8a7f1c5802d6039760e92ff4a9e7fcd8fa4a0da049952c06",
  "addons/calcio-editor/prompts/CALCIO_H_V2.md": "529db810600ec7c37f2194c5effedbf63530e635cb3d8dc6a0e3ba5dde0b92ec"
});
const R7_VERSION='BETTINGAPP_MAIN_R7_PROMPT_CALCIO_V7_DATA_ONLY_20261114';
const R19_UI_VERSION='BETTINGAPP_R19_CALCIO_MICRO_PAPER_UI_20261115';
const R19_UI_FILES=Object.freeze({
  'public/app.js': '7ea406f0a4c812c05b350b77c327225cddd860a399dac127e0f5bc6fff1ad4fc',
  'backend/public/app.js': '7ea406f0a4c812c05b350b77c327225cddd860a399dac127e0f5bc6fff1ad4fc'
});


// R21 only: UI prompt replacements and new text assets, plus source-provider hashes retained from R20.

// R22 UI-only anti-stale snapshot and non-monotonic change audit.
const R22_VERSION='BETTINGAPP_R22_DEEPSCAN_COHERENCE_V1_20261115';
const R22_UI_FILES=Object.freeze({
  "public/calcioR22SnapshotGuard.js": "b114fb40a340d3ec979a4b77d19309dbb832d360c5250cb487a315d96c036bd3",
  "backend/public/calcioR22SnapshotGuard.js": "b114fb40a340d3ec979a4b77d19309dbb832d360c5250cb487a315d96c036bd3",
  "public/app.js": "6895d298bd0f16ae765df2b133d2822f46ff9539708ed8e3cdec6ffed10db5aa",
  "backend/public/app.js": "6895d298bd0f16ae765df2b133d2822f46ff9539708ed8e3cdec6ffed10db5aa",
  "public/index.html": "33c860677e9daad43e3e750580bf2068178bc675e574c7dc4abad8db12d1cf9a",
  "backend/public/index.html": "33c860677e9daad43e3e750580bf2068178bc675e574c7dc4abad8db12d1cf9a"
});
// R23 backend/UI split: qualitative DeepScan cannot be promoted by stake authority.
const R23_VERSION='BETTINGAPP_R23_QUALITATIVE_AUTHORITY_SEPARATION_V1_20261115';
const R23_APPROVED=Object.freeze({
  "backend/calcioDeepScanFinalState.js": "cf87c43d7151926753ffbfdf15a3a8461640bbe1edb46b3cc3f476bc1494eccc",
  "public/app.js": "58d6f4ac8821a92a4eb32245f0c23e39facd0a08093b1b0162e91b0f510617e7",
  "backend/public/app.js": "58d6f4ac8821a92a4eb32245f0c23e39facd0a08093b1b0162e91b0f510617e7",
  "public/index.html": "fbbd4c0e30f0e0ea859c58399984bd8969347754a0e988d52bae18cc1aede7eb",
  "backend/public/index.html": "fbbd4c0e30f0e0ea859c58399984bd8969347754a0e988d52bae18cc1aede7eb"
});
const PINNED_R10_HELPER_SHA='7c38f4da55d5c3bab526da66d586a3db3c5f54feeb2863fe265f8b236440e343';
const R11_LAUNCHER_TEMPLATE_SHA='9956476fbcc06ad612db61e1ee5403c93084f89b75cc5e9dc2c75304f74ace8c';
const PINNED_R9_HELPER_SHA='efb7532f30dfb9ab9b9fbfd4b050406ceb5f6a0f5cb7001b5c35815e91595d04';
const R10_LAUNCHER_TEMPLATE_SHA='4ee968647271490de3c794afc70d03fb423e1755b2788331f872bc3dbe38ecda';

const R21_VERSION='BETTINGAPP_R21_DUAL_GABBIA_PROMPTS_V1_20261115';
const R21_UI_FILES=Object.freeze({
  "public/CALCIO_V8_MASTER.txt": "bbec2bee59ff731aa69c68b36270902ca4b924b2a732869fca1dbbf279a51c76",
  "backend/public/CALCIO_V8_MASTER.txt": "bbec2bee59ff731aa69c68b36270902ca4b924b2a732869fca1dbbf279a51c76",
  "public/TENNIS_V7_MASTER.txt": "f1c2da3d4c63718932569e05778961a8cc3c938c01f33b1c971ab7712a33fad5",
  "backend/public/TENNIS_V7_MASTER.txt": "f1c2da3d4c63718932569e05778961a8cc3c938c01f33b1c971ab7712a33fad5",
  "public/quantMatchPromptBridgeV4.js": "7db5eb1f58f55783f91c00850e75feec6c8d51f9633a4093000aaaf54837b2f6",
  "backend/public/quantMatchPromptBridgeV4.js": "7db5eb1f58f55783f91c00850e75feec6c8d51f9633a4093000aaaf54837b2f6",
  "public/tennisPromptV62.js": "39c9e3b0996e01a3e4a67909b8c240f8ffc11889d73243de3d8d6c49672e2bb6",
  "backend/public/tennisPromptV62.js": "39c9e3b0996e01a3e4a67909b8c240f8ffc11889d73243de3d8d6c49672e2bb6",
  "backend/public/index.html": "66bf05507850b1de4c7c68d6dcd266114ef58bf51bacf4963fe2a7bd9bab12ef",
  "public/index.html": "66bf05507850b1de4c7c68d6dcd266114ef58bf51bacf4963fe2a7bd9bab12ef"
});
const R20_MODULE_FILES=Object.freeze({
  "backend/calcioSourceIntelligence.js": "f45501965b81b9112e106503df185df56e63138a21a34891ad814cb61f55c8d6",
  "backend/tennisQualityGateV2.js": "ee5ed61a3d5dad2ec024f3f8e094baf7c71e069bfe7273c2c94b1cdbfc715347",
  "backend/tennisCanonicalPlayerEvidenceBridge.js": "45893f3d771ea8ae74af5088aee24340b40e4979c6335b87fea4c18c45715117"
});
const PINNED_R8_HELPER_SHA='a5e38831971fd65744989881d694db07f05b9ecdec00058a9e396d85c881d62b';
const R9_LAUNCHER_TEMPLATE_SHA='13bc9717a12066b9b4d3f75f522a6fcb6e194a1ea89a5699f9e15040cf590831';

const PINNED_R6_HELPER_SHA='f3e3fd0d39f45b50177f1b2ad76ddf6a7c12c7e0cd1d7caeabbd5a00b97a4c83';
const R7_NEW_FILES=Object.freeze({
  "public/quantMatchPromptBridgeV4.js": "1ae0ac3f3a5efc2ef50b379fdbcd7376a8980018a59f7de4956bbf39459e3c18",
  "backend/public/quantMatchPromptBridgeV4.js": "1ae0ac3f3a5efc2ef50b379fdbcd7376a8980018a59f7de4956bbf39459e3c18",
  "public/CALCIO_V7_MASTER.txt": "67e9b33b95db8578c3b39217bb0318eeda8750395c945bf2bf2c3ca1f66efc8b",
  "backend/public/CALCIO_V7_MASTER.txt": "67e9b33b95db8578c3b39217bb0318eeda8750395c945bf2bf2c3ca1f66efc8b"
});
const R7_LAUNCHER_TEMPLATE_SHA='ca882ea992a80e99af394ab38df939842d7c3c5f2076ca9e0953ac82645da926';
const R8_LAUNCHER_TEMPLATE_SHA='8805458596c1f570b78d239992ffe5d2e3917999af5943784cb9332b2e486cde';
const R6_BEFORE=Object.freeze({
  "backend/public/index.html": "0105538787f8ea2b10193d223e161a0f3b0aae1a09cad6eab64ff3feaa393ee0",
  "public/index.html": "0105538787f8ea2b10193d223e161a0f3b0aae1a09cad6eab64ff3feaa393ee0",
  "backend/public/quantMatchPromptBridgeV4.js": "63ad336f42ea141a0bfaa16df24d238c7b8eb570fe81535f63e3ca119d3647cd",
  "public/quantMatchPromptBridgeV4.js": "63ad336f42ea141a0bfaa16df24d238c7b8eb570fe81535f63e3ca119d3647cd",
  "addons/calcio-editor/prompts/CALCIO_H_V2.md": "1224942163bba33982c26922fb526d15cc79cfff82e3e2018e155420fbc7c6e1"
});
const R5_HELPER_SHA="f615cefdbae154c4500f7b2e765fb1cf9546039d97fc4bb1344c6dcd7369018e";
const R5_LAUNCHER_SHA="710eedfbab7b7675d51c11913f8154c1734cfa86ab5bf118881f35b63fe7b1bd";
const R6_LAUNCHER_TEMPLATE_SHA='66963aa32ad82d886d8fbf17064528effac32864c086666975571585a379e99f';
function shaBytes(data){return crypto.createHash('sha256').update(data).digest('hex')}

const R3_RECEIPT_VERSION='BETTINGAPP_SAFE_TENNIS_V62_R3_CUMULATIVA';
function fail(s){throw Error('MAIN_R5_INTEGRITY_'+s)}
function f(root,rel){
 const parts=rel.replace(/\\/g,'/').split('/');
 if(!rel||path.isAbsolute(rel)||parts.some(s=>!s||s==='.'||s==='..'))fail('UNSAFE_PATH:'+rel);
 const base=path.resolve(root);let cur=base;
 for(const part of parts){cur=path.join(cur,part);if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())fail('SYMLINK:'+rel);}
 const full=path.resolve(base,...parts);
 if(!full.startsWith(base+path.sep))fail('OUTSIDE_ROOT:'+rel);
 let st;try{st=fs.lstatSync(full)}catch{fail('MISSING:'+rel)}
 if(!st.isFile()||st.isSymbolicLink())fail('NOT_FILE:'+rel);
 return full;
}
function hash(root,rel){return crypto.createHash('sha256').update(fs.readFileSync(f(root,rel))).digest('hex')}
function check(root,rel,expected){if(hash(root,rel)!==expected)fail('HASH:'+rel)}
function load(root,rel){try{return JSON.parse(fs.readFileSync(f(root,rel),'utf8'))}catch{fail('BAD_JSON:'+rel)}}
function mapCheck(root,obj,except=new Set()){
 for(const [rel,sha] of Object.entries(obj))if(!except.has(rel))check(root,rel,sha);
}
function assertTrustedCore({root,state,phase='final'}){
 if(!state||state.version!=='BETTINGAPP_MANUALE_PULITO_R1_20261105'||state.mode!=='SAFE13_MANUAL_PAPER_ONLY'||state.server_sha256!==OLD_CORE||state.tennis_sha256!==TENNIS_CORE)fail('STANDALONE_STATE');
 // Unchanged trusted R3/R4 source code remains pinned exactly as it was on 10 Nov.
 check(root,'START_BETTING_CORE_CHAIN_R3.cjs',PINNED_R3_HELPER_SHA);
 check(root,'START_BETTING_CORE_CHAIN_R4.cjs',PINNED_R4_HELPER_SHA);
 const R3=require(f(root,'START_BETTING_CORE_CHAIN_R3.cjs'));
 const R4=require(f(root,'START_BETTING_CORE_CHAIN_R4.cjs'));
 if(!R3||!R4||R3.VERSION!=='BETTINGAPP_MAIN_UI_R3_STRICT_CORE_CHAIN_20261109'||R4.VERSION!=='BETTINGAPP_CALCIO_EDITOR_R4_MATCH_AND_DEEPSCAN_20261109')fail('CHAIN_VERSION');
 // Preserve R3 chain's signature checks on prior R17/R10/manual/R2/R3 receipts.
 const r17=load(root,'.bettingapp_r17_state.json');
 if(r17.version!=='BETTINGAPP_R17_CALCIO_DEEPSCAN_QUALITATIVE_MEDICAL_CLEAN_20261108')fail('R17_STATE');
 const r10=load(root,'.bettingapp_reliability10/state.json');
 if(r10.version!=='BETTINGAPP_RELIABILITY10_V1_20261109'||r10.baseVersion!=='21.46.0'||r10.r17Version!==r17.version||!Array.isArray(r10.stages)||r10.stages.map(x=>x.id).join(',')!=='C01,C02,C03,C04,C05,T01,T02,T03,T04,T05')fail('R10_STATE');
 const map=new Map((r10.files||[]).map(x=>[x.rel,x.installed]));
 if(map.size!==Object.keys(R10_FILES).length)fail('R10_FILE_COUNT');
 for(const [rel,sha] of Object.entries(R10_FILES))if(map.get(rel)!==sha)fail('R10_MANIFEST:'+rel);
 const manual=load(root,'.bettingapp_real_manual_patch/state.json');
 if(manual.version!=='BETTINGAPP_REAL_MANUAL_V1_20261109'||manual.historicalDbChanged!==false)fail('REAL_MANUAL_STATE');
 const r2=load(root,'.bettingapp_startup_r2_fix/state.json');
 if(r2.version!=='BETTINGAPP_STARTUP_R2_MANUAL_CMD_HASHFIX_20261109'||r2.afterLauncher!==R2_LAUNCHER_HASH||r2.afterHelper!==R2_HELPER_HASH)fail('R2_STATE');
 const r3=load(root,'.bettingapp_main_ui_r3/state.json');
 if(r3.version!=='BETTINGAPP_CALCIO_MAIN_UI_R3_20261109'||r3.dbChanged!==false)fail('R3_STATE');
 const exp=[...Object.keys(R3.R3_FILES),'START_BETTING_CORE_CHAIN_R3.cjs'].sort();
 if(JSON.stringify(exp)!==JSON.stringify(Object.keys(r3.installed||{}).sort()))fail('R3_MANIFEST_FILES');
 for(const [rel,sha] of Object.entries(R3.R3_FILES))if(r3.installed[rel]!==sha)fail('R3_MANIFEST:'+rel);
 if(r3.installed['START_BETTING_CORE_CHAIN_R3.cjs']!==PINNED_R3_HELPER_SHA)fail('R3_HELPER_RECEIPT');
 const r4=load(root,'.bettingapp_main_ui_r4/state.json');
 if(r4.version!==R4.VERSION||r4.dbChanged!==false||r4.from!==r3.version)fail('R4_STATE');
 for(const [rel,sha] of Object.entries(R4.R3_BEFORE))if(r4.before?.[rel]!==sha)fail('R4_BEFORE:'+rel);
 for(const [rel,sha] of Object.entries(R4.R4_FILES))if(r4.installed?.[rel]!==sha)fail('R4_MANIFEST:'+rel);
 if(r4.installed?.['START_BETTING.cjs']!==OLD_LAUNCHER_SHA||r4.installed?.['START_BETTING_CORE_CHAIN_R4.cjs']!==PINNED_R4_HELPER_SHA)fail('R4_LAUNCH_RECEIPT');
 const pr3=load(root,'.bettingapp_safe_tennis_v62_r3/last-install.json');
 if(pr3.version!==R3_RECEIPT_VERSION||pr3.modifiedDatabase!==false||pr3.modifiedStake!==false)fail('TENNIS_R3_RECEIPT');
 const entries=new Map((pr3.entries||[]).map(x=>[x.path,x.newSha256]));
 if(entries.size!==Object.keys(TENNIS_V62_R3_APPROVED).length)fail('TENNIS_R3_RECEIPT_COUNT');
 for(const [rel,sha] of Object.entries(TENNIS_V62_R3_APPROVED))if(entries.get(rel)!==sha)fail('TENNIS_R3_RECEIPT_HASH:'+rel);
 // Crucial change: approved V6.2 R3 files replace only explicitly enumerated old R3/R4 hashes.
 // Every other core file retains its previously pinned R3/R4 SHA-256 (no weak fallback).
 const replaced=new Set(Object.keys(TENNIS_V62_R3_APPROVED));
 const skipLaunch=new Set(['START_BETTING.cjs']);
 const noOverride=(rel,original)=>R23_APPROVED[rel]||R22_UI_FILES[rel]||R21_UI_FILES[rel]||R19_UI_FILES[rel]||R7_NEW_FILES[rel]||R6_REPLACEMENTS[rel]||TENNIS_V62_R3_APPROVED[rel]||R4.R4_FILES[rel]||original;
 for(const [rel,sha] of Object.entries(R3.R3_FILES)){
  if(skipLaunch.has(rel))continue;
  check(root,rel,noOverride(rel,sha));
 }
 for(const [rel,sha] of Object.entries(R3.BASE_REMAINING))check(root,rel,noOverride(rel,sha));
 for(const [rel,sha] of Object.entries(R4.R4_FILES))check(root,rel,noOverride(rel,sha));
 // Still reject changed files, even when they are only UI assets.
 mapCheck(root,TENNIS_V62_R3_APPROVED,new Set([...Object.keys(R6_REPLACEMENTS),...Object.keys(R19_UI_FILES),...Object.keys(R21_UI_FILES),...Object.keys(R22_UI_FILES)]));
 mapCheck(root,R6_REPLACEMENTS,new Set([...Object.keys(R7_NEW_FILES),...Object.keys(R21_UI_FILES),...Object.keys(R22_UI_FILES)]));
 mapCheck(root,R7_NEW_FILES,new Set([...Object.keys(R21_UI_FILES),...Object.keys(R22_UI_FILES)]));
 mapCheck(root,R19_UI_FILES,new Set(Object.keys(R22_UI_FILES)));
 mapCheck(root,R21_UI_FILES,new Set(Object.keys(R22_UI_FILES)));
 mapCheck(root,R22_UI_FILES,new Set(Object.keys(R23_APPROVED)));
 mapCheck(root,R23_APPROVED);
 mapCheck(root,R20_MODULE_FILES);
 if(phase==='preflight'){
  check(root,'START_BETTING.cjs',OLD_LAUNCHER_SHA);
  try{fs.lstatSync(path.join(root,'START_BETTING_CORE_CHAIN_R5.cjs'));fail('R5_ALREADY_PRESENT_WITHOUT_RECEIPT')}catch(e){if(e.code!=='ENOENT')throw e}
  try{fs.lstatSync(path.join(root,'.bettingapp_main_ui_r5/state.json'));fail('R5_RECEIPT_ALREADY_PRESENT')}catch(e){if(e.code!=='ENOENT')throw e}
  return {mode:'RELIABILITY10_PLUS_REAL_MANUAL_PLUS_CALCIO_MAIN_R4_PLUS_TENNIS_R3_PRECHECK',dbWrites:false};
 }
 if(phase!=='final')fail('UNKNOWN_PHASE');
 const r5=load(root,'.bettingapp_main_ui_r5/state.json');
 if(r5.version!=="BETTINGAPP_MAIN_R5_TENNIS_V62_INTEGRITY_REBASE_20261110"||r5.from!==R4.VERSION||r5.dbChanged!==false||r5.stakeChanged!==false||r5.previousLauncherSha256!==OLD_LAUNCHER_SHA)fail('R5_STATE');
 if(!/^[a-f0-9]{64}$/.test(String(r5.installed?.['START_BETTING.cjs']||'')))fail('R5_LAUNCHER_RECEIPT');
 if(r5.installed['START_BETTING.cjs']!==R5_LAUNCHER_SHA)fail('R5_LAUNCHER_RECEIPT');
 if(r5.installed?.['START_BETTING_CORE_CHAIN_R5.cjs']!==R5_HELPER_SHA)fail('R5_HELPER_RECEIPT');
 check(root,'START_BETTING_CORE_CHAIN_R5.cjs',R5_HELPER_SHA);
 const r6=load(root,'.bettingapp_main_ui_r6/state.json');
 if(r6.version!==VERSION||r6.from!=='BETTINGAPP_MAIN_R5_TENNIS_V62_INTEGRITY_REBASE_20261110'||r6.dbChanged!==false||r6.stakeChanged!==false)fail('R6_STATE');
 for(const [rel,expected] of Object.entries(R6_BEFORE))if(r6.before?.[rel]!==expected)fail('R6_BEFORE:'+rel);
 for(const [rel,expected] of Object.entries(R6_REPLACEMENTS))if(r6.installed?.[rel]!==expected)fail('R6_RECEIPT:'+rel);
 const receipt=load(root,'.bettingapp_calcio_prompt_v7/state.json');
 if(receipt.version!==R7_VERSION||receipt.from!==VERSION||receipt.dbChanged!==false||receipt.authorityChanged!==false)fail('R7_STATE');
 for(const [rel,expected] of Object.entries(R7_NEW_FILES))if(receipt.installed?.[rel]!==expected)fail('R7_RECEIPT:'+rel);
 check(root,'START_BETTING_CORE_CHAIN_R6.cjs',PINNED_R6_HELPER_SHA);
 const r19ui=load(root,'.bettingapp_r19_ui/state.json');
 if(r19ui.version!==R19_UI_VERSION||r19ui.dbChanged!==false||r19ui.realExecutionEnabled!==false)fail('R19_UI_STATE');
 for(const [rel,expected] of Object.entries(R19_UI_FILES))if(r19ui.files?.[rel]!==expected)fail('R19_UI_RECEIPT:'+rel);

 // The original R8 helper is immutable, so historic signed startup integrity remains auditable.
 check(root,'START_BETTING_CORE_CHAIN_R8.cjs',PINNED_R8_HELPER_SHA);
 const r21=load(root,'.bettingapp_prompt_dual_r21/state.json');
 if(r21.version!==R21_VERSION||r21.dbChanged!==false||r21.authorityChanged!==false||r21.realMoneyAuthorization!==false)fail('R21_RECEIPT');
 for(const [rel,expected] of Object.entries(R21_UI_FILES))if(r21.files?.[rel]!==expected)fail('R21_RECEIPT_HASH:'+rel);
 // R22 extends R9 but never overwrites the trusted historical R9 helper.
 check(root,'START_BETTING_CORE_CHAIN_R9.cjs',PINNED_R9_HELPER_SHA);
 const r22=load(root,'.bettingapp_r22_deepscan/state.json');
 if(r22.version!==R22_VERSION||r22.dbChanged!==false||r22.authorityChanged!==false||r22.realMoneyAuthorization!==false)fail('R22_STATE');
 for(const [rel,expected] of Object.entries(R22_UI_FILES))if(r22.files?.[rel]!==expected)fail('R22_RECEIPT:'+rel);
 // R23 successor: retain the R10 signed helper and every R22 signed receipt.
 check(root,'START_BETTING_CORE_CHAIN_R10.cjs',PINNED_R10_HELPER_SHA);
 const r23=load(root,'.bettingapp_r23_deepscan/state.json');
 if(r23.version!==R23_VERSION||r23.dbChanged!==false||r23.authorityChanged!==false||r23.realMoneyAuthorization!==false)fail('R23_STATE');
 for(const [rel,expected] of Object.entries(R23_APPROVED))if(r23.files?.[rel]!==expected)fail('R23_RECEIPT:'+rel);
 const launchText=fs.readFileSync(f(root,'START_BETTING.cjs'),'utf8');
 const literal=/sha\(path\.join\(ROOT,'START_BETTING_CORE_CHAIN_R11\.cjs'\)\)===('[a-f0-9]{64}')/;
 if(!literal.test(launchText))fail('R23_LAUNCHER_LINK_FORMAT');
 const normalized=launchText.replace(literal,"sha(path.join(ROOT,'START_BETTING_CORE_CHAIN_R11.cjs'))==='R11_HELPER_HASH_PLACEHOLDER'");
 if(shaBytes(Buffer.from(normalized,'utf8'))!==R11_LAUNCHER_TEMPLATE_SHA)fail('R11_LAUNCHER_HASH');
 return {mode:'MAIN_R11_R23_QUALITATIVE_DEEPSCAN_AUTHORITY_SEPARATION',dbWrites:false};
}
module.exports={VERSION:R23_VERSION,TENNIS_V62_R3_APPROVED,R6_REPLACEMENTS,R7_NEW_FILES,R19_UI_FILES,R21_UI_FILES,R22_UI_FILES,R23_APPROVED,R20_MODULE_FILES,assertTrustedCore};
