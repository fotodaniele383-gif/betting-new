'use strict';
// R4 pinned upgrade. Verifies R3 receipt, R10/R2/base, and exact R4 asset hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='BETTINGAPP_CALCIO_EDITOR_R4_MATCH_AND_DEEPSCAN_20261109';
const R3_HELPER_HASH='705f13d05eafc95624f28a244175badfb7b479af893503e4e389f485b9938542';
const R4_FILES=Object.freeze({
  "addons/calcio-editor/server.cjs": "c8dbafc73ee1374c4918306e61a779aa2d0c334c0d8b0bdc42210c593343415b",
  "addons/calcio-editor/core.js": "fb5c5f7358409707e697af9a21fd08d9d4c926f69126c12d065ec8787a760872",
  "addons/calcio-editor/main-router-r3.cjs": "228d583deec4b419a8a0198dba7f6b80191ada3c6757805811c68c2d5d20e89a",
  "addons/calcio-editor/public/app.js": "4a4b961c698c977a9e1cd4b046c34c0f3879b930209b29e464d5a59b57c26927",
  "addons/calcio-editor/public/index.html": "17d754596e4bfb4de26f8868a4a5ef94171a9536572618f1b16970ba09947920",
  "backend/public/calcioEditorMainR3.js": "2d93295a829a7076aca1650ec8b7be13e0b91e44583463e5198e1cfd068a5674"
});
const R3_BEFORE=Object.freeze({
  "addons/calcio-editor/server.cjs": "3f51ffa5caf97b56ac4802fe55ac2c19c0bfcb5f217aaddec7cf5fbdd7467252",
  "addons/calcio-editor/core.js": "36cbf8c6c6f587b4f21865abf2cd987d9c5303469110ebd2f7bf717422ac2c88",
  "addons/calcio-editor/main-router-r3.cjs": "bf7afe8213b59e050867b828145fd094ea1fd0f4ba32e053b375b01693875dd3",
  "addons/calcio-editor/public/app.js": "ded51a86ee156c5ad252ba832b287756860e18986364a35c3e268edba93b4ae9",
  "addons/calcio-editor/public/index.html": "c3d067bc6a42b0b19cea0110e59db74b644c446dd721730dc17cd2bb5e97a757",
  "backend/public/calcioEditorMainR3.js": "7527145c72288b3d462e8d300a9ac9241b152001eebed0b21a1367247b06a4f1"
});
const R3=require('./START_BETTING_CORE_CHAIN_R3.cjs');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fail(s){throw Error('MAIN_R4_INTEGRITY_'+s)}
function file(root,rel){const p=path.join(root,...rel.split('/'));try{let x=fs.lstatSync(p);if(!x.isFile()||x.isSymbolicLink())fail('UNSAFE:'+rel);}catch(e){fail('MISSING:'+rel)}return p}
function check(root,rel,expected){if(sha(file(root,rel))!==expected)fail('HASH:'+rel)}
function json(root,rel){try{return JSON.parse(fs.readFileSync(file(root,rel),'utf8'))}catch{fail('BAD_STATE:'+rel)}}
function assertTrustedCore({root,state}){
 if(!state||state.version!=='BETTINGAPP_MANUALE_PULITO_R1_20261105'||state.mode!=='SAFE13_MANUAL_PAPER_ONLY')fail('STANDALONE_BASE');
 check(root,'START_BETTING_CORE_CHAIN_R3.cjs',R3_HELPER_HASH);
 const r3=json(root,'.bettingapp_main_ui_r3/state.json');
 if(r3.version!=='BETTINGAPP_CALCIO_MAIN_UI_R3_20261109'||r3.dbChanged!==false)fail('R3_STATE');
 const r4=json(root,'.bettingapp_main_ui_r4/state.json');
 if(r4.version!==VERSION||r4.dbChanged!==false||r4.from!=='BETTINGAPP_CALCIO_MAIN_UI_R3_20261109')fail('R4_STATE');
 for(const [rel,hash] of Object.entries(R3.R3_FILES)){if(r3.installed?.[rel]!==hash)fail('R3_RECEIPT:'+rel);if(!(rel in R4_FILES)&&rel!=='START_BETTING.cjs')check(root,rel,hash);}
 for(const [rel,hash] of Object.entries(R3.BASE_REMAINING)){if(!(rel in R4_FILES))check(root,rel,hash);}
 for(const [rel,hash] of Object.entries(R3_BEFORE)){if(r4.before?.[rel]!==hash)fail('R4_BEFORE:'+rel);}
 for(const [rel,hash] of Object.entries(R4_FILES)){if(r4.installed?.[rel]!==hash)fail('R4_MANIFEST:'+rel);check(root,rel,hash);}
 if(!/^[a-f0-9]{64}$/.test(String(r4.installed?.['START_BETTING.cjs']||'')))fail('R4_LAUNCHER_MANIFEST');
 check(root,'START_BETTING.cjs',r4.installed['START_BETTING.cjs']);
 if(!/^[a-f0-9]{64}$/.test(String(r4.installed?.['START_BETTING_CORE_CHAIN_R4.cjs']||'')))fail('R4_CHAIN_MANIFEST');
 check(root,'START_BETTING_CORE_CHAIN_R4.cjs',r4.installed['START_BETTING_CORE_CHAIN_R4.cjs']);
 return {mode:'RELIABILITY10_PLUS_REAL_MANUAL_PLUS_CALCIO_MAIN_R4',dbWrites:false};
}
module.exports={VERSION,R4_FILES,R3_BEFORE,assertTrustedCore};
