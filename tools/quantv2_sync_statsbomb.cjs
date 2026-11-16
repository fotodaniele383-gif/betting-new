#!/usr/bin/env node
'use strict';
const s=require('../backend/quantv2OpenSources');
const id=process.argv.slice(2).map(Number);
if(!(id.length===2||id.length===3)||id.some(n=>!Number.isInteger(n)||n<=0)){
 console.error('Uso: node tools/quantv2_sync_statsbomb.cjs <competition_id> <season_id> [match_id]');process.exitCode=2;
}else s.syncStatsBomb(id[0],id[1],id[2]).then(v=>console.log(JSON.stringify(v,null,2)))
 .catch(e=>{console.error(e.message);process.exitCode=2});
