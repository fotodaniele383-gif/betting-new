#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const cp=require('child_process');const root=path.resolve(__dirname,'..');
const a=fs.readFileSync(path.join(root,'public/app.js'));const b=fs.readFileSync(path.join(root,'backend/public/app.js'));assert.deepEqual(a,b);
const s=a.toString('utf8');assert.ok(s.includes('Dati giocatori: vantaggio'));assert.ok(s.includes('Stima dati giocatori'));assert.ok(s.includes('sport === SPORT.TENNIS ? 150 : 4000'));
for(const rel of ['public/app.js','backend/public/app.js']){const r=cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
console.log(JSON.stringify({success:true,checks:6},null,2));
