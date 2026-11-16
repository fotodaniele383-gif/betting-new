#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const src=fs.readFileSync(path.join(ROOT,'backend','server.tennis.js'),'utf8');
const checks=[];const add=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
add('Auto lock conflict classified INFO',src.includes("level: lockConflict ? 'INFO'")&&src.includes('PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE'));
add('Auto lock message is skip not failure',src.includes('Refresh aggiuntivo saltato: un refresh player-data è già in esecuzione'));
add('Manual lock conflict remains HTTP 409',src.includes("return res.status(conflict ? 409 : 502).json"));
add('Manual lock response exposes skipped/retryable',src.includes('skipped: conflict')&&src.includes('retryable: conflict'));
add('True failures still emit PLAYER_DATA_REFRESH_FAILED',src.includes("phase: conflict ? 'PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE' : 'PLAYER_DATA_REFRESH_FAILED'"));
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'TENNIS_REFRESH_LOCK_CLASSIFICATION',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);
