'use strict';
const path=require('path');const cp=require('child_process');const root=path.resolve(__dirname,'..');
const suites=['tools/test-tennis-patch26-all.js','tools/test-tennis-patch26-deepscan-runtime.js','tools/verify-tennis-patch26-server.js','tools/verify-tennis-patch26-frontend.js','tools/verify-tennis-patch26-db.js','tools/verify-tennis-patch26-regression.js'];
const out=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});return{file,ok:r.status===0,exitCode:r.status,stdout:r.status===0?undefined:r.stdout,stderr:r.status===0?undefined:r.stderr};});
const failed=out.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_26_CANONICAL_PLAYER_EVIDENCE_BRIDGE_WTA_CURRENT_PROFILE_RECOVERY',verification:`${out.length-failed.length}/${out.length} PASS`,functionalChecks:26,suites:out.map(({stdout,stderr,...x})=>x)},null,2));if(failed.length)process.exit(1);
