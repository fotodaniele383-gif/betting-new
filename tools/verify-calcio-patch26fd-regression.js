'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const registry=require('../backend/calcioPatchRegistry');
const required=['backend/runtimeDiagnostics.js','backend/calcioReliabilityCalibration.js','backend/calcioUnifiedStakeAuthority.js','backend/calcioBatchPortfolioAllocator.js','backend/server.js','backend/server.tennis.js','public/app.js','public/index.html'];
const checks=required.map(file=>({name:`capability file ${file}`,ok:fs.existsSync(path.join(root,file))}));
checks.push({name:'Patch26FD preservata',ok:registry.PATCHES.some(p=>p.version==='36'&&p.id==='BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2'&&p.status==='ACTIVE')});
checks.push({name:'registry future-compatible',ok:Number(registry.CALCIO_CURRENT_PATCH_VERSION)>=36});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
