#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const arg=process.argv.indexOf('--root'); const ROOT=path.resolve(arg>=0&&process.argv[arg+1]?process.argv[arg+1]:path.join(__dirname,'..'));
const helper=require(path.join(ROOT,'backend','calcioUnderstatAnalysisPrefetchAudit16dR1.js'));
function readJson(rel){try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));}catch(_){return null;}}
function sha(rel){const f=path.join(ROOT,rel);return fs.existsSync(f)?crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null;}
const config=readJson('backend/calcio_cron_config.json');
const state=readJson('backend/.scheduler_patch58_runtime/calcio_scheduler_state.json');
const app=fs.readFileSync(path.join(ROOT,'public/app.js'),'utf8');
const out={
 success:true, patch:'AUDIT16D_R1', readOnly:true,
 scheduler:{configEnabled:config?.enabled===true,state:state?.state||null,stateConfigEnabled:state?.configEnabled===true,coherent:Boolean(config)&&Boolean(state)&&(config.enabled===true)===(state.configEnabled===true)},
 frontend:{step94ExplicitEnableBridge:app.includes('AUDIT16D_R1_STEP94_CALCIO_EXPLICIT_ENABLE_BRIDGE'),mirrorsIdentical:sha('public/app.js')===sha('backend/public/app.js')},
 understat:{version:helper.VERSION,...helper.resolveOptions()},
 adaptiveLearning:{modulePresent:fs.existsSync(path.join(ROOT,'backend','adaptiveLearningShadowAudit16d.js')),shadowOnly:true},
 databaseSha256:sha('backend/database_betting.db')
};
console.log(JSON.stringify(out,null,2));
