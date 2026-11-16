#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const vm=require('vm');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
function extract(name){const token=`function ${name}`;const start=app.indexOf(token);if(start<0)throw new Error(`FUNCTION_NOT_FOUND:${name}`);const brace=app.indexOf('{',start);let depth=0,quote=null,escaped=false,template=0;for(let n=brace;n<app.length;n++){const ch=app[n];if(quote){if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(quote==='`'&&ch==='$'&&app[n+1]==='{'){template++;n++;continue}if(quote==='`'&&ch==='}'&&template>0){template--;continue}if(ch===quote&&template===0)quote=null;continue}if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue}if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0)return app.slice(start,n+1)}}throw new Error('UNTERMINATED')}
const ctx=vm.createContext({});vm.runInContext(extract('predictionIndexBandsVisibilityState'),ctx);
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
const expanded=ctx.predictionIndexBandsVisibilityState(false),collapsed=ctx.predictionIndexBandsVisibilityState(true);
add('default espanso',expanded.collapsed===false&&expanded.ariaExpanded==='true'&&expanded.buttonLabel.includes('Comprimi'),expanded);
add('stato compresso',collapsed.collapsed===true&&collapsed.ariaExpanded==='false'&&collapsed.buttonLabel.includes('Espandi'),collapsed);
add('pulsante accessibile presente',app.includes('id="predictionIndexBandsCollapseBtn"')&&app.includes('aria-controls="predictionIndexBandsTableRegion"'));
add('regione tabella identificata',app.includes('id="predictionIndexBandsTableRegion"'));
add('hidden applicato solo se compresso',app.includes("${visibility.collapsed?'hidden':''}"));
add('click inverte stato',app.includes('predictionIndexBandsState.collapsed=!predictionIndexBandsState.collapsed'));
add('filtri non azzerano collapse',app.includes("predictionIndexBandsState.scope=btn.dataset.piBandScope")&&!app.includes("predictionIndexBandsState.scope=btn.dataset.piBandScope==='REAL_STAKE'?'REAL_STAKE':'AI_SIGNALS';predictionIndexBandsState.collapsed=false"));
add('nuovo sport riparte espanso',app.includes("predictionIndexBandsState={sport:normalized,scope:'AI_SIGNALS',competition:'ALL',payload:null,requestId,collapsed:false}"));
add('cache buster Patch50',/app\.js\?v=patch(?:50-health-check-alignment-prediction-index-collapse|51-settlement-exception-queue-idempotent-notifications|52-wta-information-recovery|53-clv-cross-sport-coverage)/.test(html));
add('stile hidden certificato',html.includes('#predictionIndexBandsTableRegion[hidden]{display:none!important;}'));
add('frontend mirror app',hash('public/app.js')===hash('backend/public/app.js'));
add('frontend mirror html',hash('public/index.html')===hash('backend/public/index.html'));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_50_TECHNICAL_HEALTH_CHECK_ALIGNMENT_COLLAPSIBLE_PREDICTION_INDEX_BANDS',checks:checks.length,errors:failed.length,details:checks},null,2));if(failed.length)process.exit(1);
