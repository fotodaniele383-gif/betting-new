'use strict';
const {spawnSync}=require('child_process'); const path=require('path');
const suites=['tools/test-calcio-patch26fb-all.js','tools/verify-calcio-patch26fb-server.js','tools/verify-calcio-patch26fb-frontend.js','tools/verify-calcio-patch26fb-db.js','tools/verify-calcio-patch26fb-regression.js']; const results=[];
for(const file of suites){const r=spawnSync(process.execPath,[path.join(__dirname,'..',file)],{encoding:'utf8',env:process.env}); if(r.stdout)process.stdout.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr); results.push({file,ok:r.status===0,exitCode:r.status});}
const success=results.every(r=>r.ok); console.log(JSON.stringify({success,patch:'BETTING_PATCH_26F_B_CALCIO_HISTORICAL_COVERAGE_ENTITY_RESOLUTION',verification:`${results.filter(r=>r.ok).length}/${results.length} PASS`,suites:results},null,2)); process.exit(success?0:1);
