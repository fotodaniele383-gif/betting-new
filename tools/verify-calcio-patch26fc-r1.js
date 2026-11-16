'use strict';
const cp = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const commands = [
  ['node', ['--check', path.join(root, 'backend', 'server.js')]],
  ['node', [path.join(root, 'tools', 'test-calcio-patch26fc-r1-runtime-scope.js')]],
  ['node', [path.join(root, 'tools', 'verify-calcio-patch26fc.js')]]
];
const results = commands.map(([cmd,args]) => { const r=cp.spawnSync(cmd,args,{cwd:root,encoding:'utf8'}); return {command:[cmd,...args].join(' '),ok:r.status===0,exitCode:r.status,stdout:r.stdout,stderr:r.stderr}; });
const success=results.every(r=>r.ok);
console.log(JSON.stringify({success,patch:'BETTING_PATCH_26F_C_R1_DEEPSCAN_RUNTIME_SCOPE_RECOVERY',verification: success?'6/6 PASS':'FAILED',results},null,2));
if(!success) process.exit(1);
