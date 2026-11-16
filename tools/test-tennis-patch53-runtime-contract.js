#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');function root(){const i=process.argv.indexOf('--root');return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');}const r=root();const details=[];const check=(n,o,e=null)=>{details.push({name:n,ok:Boolean(o),details:e});if(!o)throw new Error(n)};
try{
 const clv=fs.readFileSync(path.join(r,'backend','clvTracker.js'),'utf8');
 const server=fs.readFileSync(path.join(r,'backend','server.js'),'utf8');
 const tennis=fs.readFileSync(path.join(r,'backend','server.tennis.js'),'utf8');
 const registry=fs.readFileSync(path.join(r,'backend','tennisPatchRegistry.js'),'utf8');
 const pkg=JSON.parse(fs.readFileSync(path.join(r,'package.json'),'utf8'));
 const publicIndex=fs.readFileSync(path.join(r,'public','index.html'),'utf8');
 const backendIndex=fs.readFileSync(path.join(r,'backend','public','index.html'),'utf8');
 check('Tracker importa Patch53',clv.includes("require('./clvCrossSportCoveragePatch53')"));
 check('Step103 riceve LEAGUES_CONFIG',clv.includes('buildStep103ClvRuntimeAudit(db, now = new Date(), LEAGUES_CONFIG = {})'));
 check('Log NON_DETERMINATO rimosso',!clv.includes("row.sportKey || 'NON_DETERMINATO'"));
 check('Planner usa resolver unico',clv.includes('resolveSportKeyForBet(bet, LEAGUES_CONFIG'));
 check('Planner espone decisioni cross-sport',clv.includes('crossSportSportKeyResolution'));
 check('Runtime persiste metadata routing',clv.includes('persistenceFields({'));
 check('Status CLV passa config',server.includes('buildStep103ClvRuntimeAudit(db, new Date(), LEAGUES_CONFIG)'));
 check('Endpoint coverage disponibile',server.includes("app.get('/api/clv/coverage'"));
 check('Report CLV include coverage',server.includes('coverageVersion: clvCrossSportCoveragePatch53.VERSION'));
 check('Health main espone versioni Patch53',server.includes('sportKeyResolutionVersion: clvCrossSportCoveragePatch53.SPORT_KEY_RESOLUTION_VERSION'));
 check('Health Tennis espone componente',tennis.includes('clvCrossSportCoveragePatch53')&&tennis.includes("'/clv-cross-sport-coverage-health'"));
 check('Registry 53',registry.includes("const TENNIS_CURRENT_PATCH_VERSION = '53'")&&registry.includes('CLV coverage authority and cross-sport sport-key resolution'));
 check('Package Patch53 future-compatible',Number(pkg.version.split('.')[1])>=40,{actual:pkg.version});
 check('Script Patch53 registrati',Boolean(pkg.scripts?.['verify:tennis:patch53']&&pkg.scripts?.['audit:tennis:patch53']&&pkg.scripts?.['migrate:tennis:patch53']));
 check('Frontend revision future-compatible Patch53',publicIndex.includes('app.js?v=patch53-clv-cross-sport-coverage')||/app\.js\?v=patch(?:5[4-9]|[6-9]\d)-/.test(publicIndex),{frontendScope:'CAPABILITY_PRESERVED'});
 check('Frontend index mirror',publicIndex===backendIndex);
 console.log(JSON.stringify({success:true,checks:details.length,details},null,2));
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message,details},null,2));process.exit(1);}
