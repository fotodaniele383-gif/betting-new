'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['tools/test-calcio-patch26fb-standalone.js'];
const results=[];
for (const file of files) {
 const r=spawnSync(process.execPath,[path.join(__dirname,'..',file)],{encoding:'utf8',env:process.env});
 if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
 results.push({file,ok:r.status===0,exitCode:r.status});
}
const success=results.every(r=>r.ok);
console.log(JSON.stringify({success,results},null,2));
process.exit(success?0:1);
