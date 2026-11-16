'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const files = ['tools/test-calcio-patch26ec-standalone.js','tools/test-calcio-patch26ec-allocator.js'];
const results = files.map(file => {
  const r = spawnSync(process.execPath,[path.join(root,file)],{cwd:root,env:process.env,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});
  if (r.status !== 0) { console.error(r.stdout||''); console.error(r.stderr||''); return {file,ok:false}; }
  return {file,ok:true};
});
const success=results.every(r=>r.ok);
console.log(JSON.stringify({success,checks:'51',results},null,2));
if(!success) process.exit(1);
