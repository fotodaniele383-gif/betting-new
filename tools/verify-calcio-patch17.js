'use strict';
const { spawnSync }=require('child_process'); const path=require('path'); const root=path.resolve(__dirname,'..');
const files=['test-calcio-patch17-standalone.js','verify-calcio-patch17-frontend.js','verify-calcio-patch17-db.js','verify-calcio-patch17-regression.js','audit-calcio-patch17.js'];
for(const f of files){const p=spawnSync(process.execPath,[path.join(root,'tools',f)],{cwd:root,stdio:'inherit',timeout:180000}); if(p.status!==0)process.exit(p.status||1);} console.log('BETTING PATCH 17 VERIFY: PASS');
