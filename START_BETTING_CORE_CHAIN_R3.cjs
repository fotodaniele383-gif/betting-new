'use strict';
// Explicit upgrade chain from R2; pins every changed core/UI file, refuses unknown bytes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='BETTINGAPP_MAIN_UI_R3_STRICT_CORE_CHAIN_20261109';
const R2_LAUNCHER_HASH='e9f24e067157199d6dffbdae9f465dc37f311bc32dbde4fd863ec103b6c9d1a0';
const R2_HELPER_HASH='a09a8a84a5bdd988895c178b7c6b4e23f1afb895cd0b8962e8f01241a382fb58';
const OLD_CORE='01592301b41839ffc6ec1de53f7b909d07d31c90f3157e797fca6d46f0150718';
const TENNIS_CORE='b35154f10c7a2dcccdfc62d1c8212e9ffa54fb2c43bac3229965206380fc5da5';
const R17_WITNESS='91b4cf894556be2ce7614a38c5208dd1bc5b801ef4790fb866993d16c7919bd3';
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
const BASE_REMAINING={
  'backend/server.tennis.js':TENNIS_CORE,
  'backend/safe13ManualRouteGuard.js':'d7b7dcddc0ef61bc8afb0cc1a7482cdf1010488f2b6c2f9d37cfdb90e15b8b92',
  'backend/realManualMode.js':'7c7deaf9d3f1a2ff2d0bcc7c5dd85afdf8ec7589c527cb1e0a2f4564d9d93dc9',
  'backend/public/real-manual.js':'337d7d7b9fb220b55a5b985ba16484c02e001b4d8ab2e700567c5fde853f24a9',
  'backend/public/real-manual.html':'3f860b760f8593d7eafd835530ffdfecc0219956ab7ececc37e4e9f6b6a4e7db',
  'AVVIA_REALE_MANUALE.cmd':'baeefe63cc0afce4939b0036c24484e29b1abd0ff3b0d3be02b35d96c71a18fb',
  'backend/calcioDeepScanEvidenceR17.js':R17_WITNESS,
  'backend/calcioDecisionCertification.js':'30b2fd548b55c4f6f925cbd2b7ff2b925bd1193aae76eeecb00444f64e075e53',
  'backend/calcioAiFinalization.js':'af8cffe7b240f94c1ef681aa9177fdb34a6fe57b50a27fc93e921f713976a5e0',
  'backend/tennisValueEvaluator.js':'9147551247bdd12d9037ca21c01918883045328aea5731958637dee66297e17d',
  'backend/public/quantMatchPromptBridgeV4.js':'18a55dbe8fef3fad09cde2d2521e42e10ca857c31b47707dc27bedc16d1f5feb',
  'START_BETTING_CORE_CHAIN_R1.cjs':R2_HELPER_HASH,
  'addons/calcio-editor/deepscan-worker.cjs':'45a2f9b48e487d0596e7c1824213f357221377b0754f658632151a613b5e89ee',
  'addons/calcio-editor/prompts/CALCIO_H_V2.md':'1224942163bba33982c26922fb526d15cc79cfff82e3e2018e155420fbc7c6e1',
  'addons/calcio-editor/prompts/TENNIS_H_V2.md':'a161973a7c1fbbc6fc4117f31b90e835f898d02ff9bdb756127bc9757d1548f8',
  'addons/calcio-editor/public/style.css':'c766876c156411855a60e5f05883cc3fe4c20a9dcce5ffd3226a28a050848e6e',
  'addons/calcio-editor/server.cjs':'3f51ffa5caf97b56ac4802fe55ac2c19c0bfcb5f217aaddec7cf5fbdd7467252',
  ...R10_FILES
};
const R3_FILES={
  "START_BETTING.cjs": "4f099de82ffdb70994b0607b7080a0213368dbb81539cf29be3046c7cf205539",
  "backend/server.js": "a6c86049cd1439e0a744cd5c1d7f5c75d3568273f7614f6668119c13dd927769",
  "backend/public/index.html": "74a0e5768aec153c5f2edb171e39873a7c40a11b9a7487d7a35ccd2f28ed851e",
  "backend/public/app.js": "27c53435a0c142b399993b39933496d7865b33d38f6af2cc3b4277a6e6182e6a",
  "backend/public/calcioEditorMainR3.js": "7527145c72288b3d462e8d300a9ac9241b152001eebed0b21a1367247b06a4f1",
  "addons/calcio-editor/main-router-r3.cjs": "bf7afe8213b59e050867b828145fd094ea1fd0f4ba32e053b375b01693875dd3",
  "addons/calcio-editor/core.js": "36cbf8c6c6f587b4f21865abf2cd987d9c5303469110ebd2f7bf717422ac2c88",
  "addons/calcio-editor/math.js": "7d0a8ef2f8ecb96518d248fe729034cbcf4f7b1fe173a77874fce0ca92539b06",
  "addons/calcio-editor/public/index.html": "c3d067bc6a42b0b19cea0110e59db74b644c446dd721730dc17cd2bb5e97a757",
  "addons/calcio-editor/public/app.js": "ded51a86ee156c5ad252ba832b287756860e18986364a35c3e268edba93b4ae9"
};
function fail(reason){throw Error('MAIN_UI_R3_CORE_'+reason);}
function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function file(root,rel){const p=path.join(root,...rel.split('/'));let st;try{st=fs.lstatSync(p);}catch{fail('MISSING:'+rel)};if(!st.isFile()||st.isSymbolicLink())fail('UNSAFE_FILE:'+rel);return p;}
function load(root,rel){let x;try{x=JSON.parse(fs.readFileSync(file(root,rel),'utf8'));}catch{fail('BAD_JSON:'+rel)};return x;}
function checkMap(root,map,label){for(const [rel,expected] of Object.entries(map))if(sha(file(root,rel))!==expected)fail(label+'_HASH:'+rel);}
function assertTrustedCore({root,state}){
 if(state.version!=='BETTINGAPP_MANUALE_PULITO_R1_20261105'||state.mode!=='SAFE13_MANUAL_PAPER_ONLY'||state.server_sha256!==OLD_CORE||state.tennis_sha256!==TENNIS_CORE)fail('LEGACY_STATE');
 const r17=load(root,'.bettingapp_r17_state.json');if(r17.version!=='BETTINGAPP_R17_CALCIO_DEEPSCAN_QUALITATIVE_MEDICAL_CLEAN_20261108')fail('R17_STATE');
 const r10=load(root,'.bettingapp_reliability10/state.json');if(r10.version!=='BETTINGAPP_RELIABILITY10_V1_20261109'||r10.baseVersion!=='21.46.0'||r10.r17Version!==r17.version||!Array.isArray(r10.stages)||r10.stages.map(x=>x.id).join(',')!=='C01,C02,C03,C04,C05,T01,T02,T03,T04,T05')fail('R10_STATE');
 const actualR10=new Map((r10.files||[]).map(x=>[x.rel,x.installed]));
 if(actualR10.size!==Object.keys(R10_FILES).length)fail('R10_FILE_COUNT');
 for(const [rel,expected] of Object.entries(R10_FILES))if(actualR10.get(rel)!==expected)fail('R10_MANIFEST:'+rel);
 const manual=load(root,'.bettingapp_real_manual_patch/state.json');if(manual.version!=='BETTINGAPP_REAL_MANUAL_V1_20261109'||manual.historicalDbChanged!==false)fail('MANUAL_STATE');
 const r2=load(root,'.bettingapp_startup_r2_fix/state.json');if(r2.version!=='BETTINGAPP_STARTUP_R2_MANUAL_CMD_HASHFIX_20261109'||r2.afterLauncher!==R2_LAUNCHER_HASH||r2.afterHelper!==R2_HELPER_HASH)fail('R2_STATE');
 const r3=load(root,'.bettingapp_main_ui_r3/state.json');if(r3.version!=='BETTINGAPP_CALCIO_MAIN_UI_R3_20261109'||r3.dbChanged!==false)fail('R3_STATE');
 const expect=[...Object.keys(R3_FILES),'START_BETTING_CORE_CHAIN_R3.cjs'].sort(),got=Object.keys(r3.installed||{}).sort();if(JSON.stringify(expect)!==JSON.stringify(got))fail('R3_MANIFEST_FILES');
 for(const [rel,expected] of Object.entries(R3_FILES))if(r3.installed[rel]!==expected)fail('R3_STATE_SHA:'+rel);
 checkMap(root,BASE_REMAINING,'UNCHANGED');checkMap(root,R3_FILES,'R3');
 return {mode:'RELIABILITY10_PLUS_REAL_MANUAL_PLUS_CALCIO_MAIN_R3',serverHash:sha(file(root,'backend/server.js'))};
}
module.exports={VERSION,assertTrustedCore,R3_FILES,BASE_REMAINING};
