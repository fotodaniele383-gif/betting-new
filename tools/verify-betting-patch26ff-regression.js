
'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const registry=require('../backend/calcioPatchRegistry');const tennis=require('../backend/tennisPatchRegistry');
const required=['backend/calcioQuantEngine.js','backend/calcioUnifiedStakeAuthority.js','backend/calcioBatchPortfolioAllocator.js','backend/aiOutcomeBandPerformance.js','backend/server.js','backend/server.tennis.js'];
const checks=required.map(file=>({name:`capability file ${file}`,ok:fs.existsSync(path.join(root,file))}));
checks.push({name:'Patch26FE preservata',ok:registry.PATCHES.some(p=>p.version==='37'&&p.id.includes('26F_E')&&p.status==='ACTIVE')});
checks.push({name:'Patch26FF preservata',ok:registry.PATCHES.some(p=>p.version==='38'&&p.id==='BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS'&&p.status==='ACTIVE')});
checks.push({name:'registry Calcio future-compatible',ok:Number(registry.CALCIO_CURRENT_PATCH_VERSION)>=38});
checks.push({name:'registry Tennis future-compatible',ok:Number(tennis.TENNIS_CURRENT_PATCH_VERSION)>=28});
checks.push({name:'Patch26FF senza migrazione',ok:registry.PATCHES.find(p=>p.version==='38')?.databaseMutation===false});
checks.push({name:'nuove Odds API zero',ok:registry.PATCHES.find(p=>p.version==='38')?.newOddsApiCalls===0});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
