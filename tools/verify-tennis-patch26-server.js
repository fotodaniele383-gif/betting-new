'use strict';
const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.resolve(__dirname,'..');const files=['backend/tennisCanonicalPlayerEvidenceBridge.js','backend/tennisHistoricalPlayerStats.js','backend/tennisPlayerEvidence.js','backend/sackmann.js','backend/deepScanTennis.js','backend/server.tennis.js','backend/tennisProgramProgressionAudit.js','backend/tennisPatchRegistry.js','backend/migrateTennisPatch26.js'];
const results=files.map(file=>{const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});return{file,ok:r.status===0,error:String(r.stderr||'').trim()};});
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');results.push({file:'server routes',ok:server.includes('/canonical-player-evidence-health')&&server.includes('/canonical-player-evidence-matchup')});
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,results},null,2));if(failed.length)process.exit(1);
