'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');const moduleSource=fs.readFileSync(path.join(root,'backend/tennisUnifiedPredictionIndex.js'),'utf8');
const checks=[
 ['server imports Tennis prediction index',server.includes("require('./tennisUnifiedPredictionIndex')")],
 ['analysis response builds provisional Tennis index',server.includes("phase: 'PRE_DEEPSCAN_PROVISIONAL'")&&server.includes('tennisPredictionIndex,')],
 ['DeepScan response builds final Tennis index',server.includes("phase: 'POST_DEEPSCAN_FINAL'")&&server.includes('informationRetrievalEvidence,\n                tennisPredictionIndex')],
 ['index authority is display only',moduleSource.includes("DISPLAY_ONLY_NO_STAKE_AUTHORITY")&&moduleSource.includes('stakeAuthority: false')],
 ['PT no-sample has no active component',moduleSource.includes('resolved > 0 && score !== null')],
 ['score weights mirror unified diagnostic structure',moduleSource.includes('qualityGate: 0.30')&&moduleSource.includes('value: 0.25')&&moduleSource.includes('paperTrading: 0.10')],
 ['no probability mutation code in index module',!moduleSource.includes('estimated_prob =')&&!moduleSource.includes('UPDATE ai_forward_test')],
 ['no Odds API calls added',!moduleSource.includes('axios')&&!moduleSource.includes('fetch(')]
].map(([name,ok])=>({name,ok}));
if(checks.some(x=>!x.ok)){console.error(JSON.stringify({success:false,checks},null,2));process.exit(1);}console.log(JSON.stringify({success:true,checks},null,2));
