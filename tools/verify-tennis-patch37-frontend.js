#!/usr/bin/env node
'use strict';const fs=require('fs');const crypto=require('crypto');
const files=['public/app.js','backend/public/app.js','public/index.html','backend/public/index.html'];const t=files.map(f=>fs.readFileSync(f));const checks=[
 {name:'app mirrors',ok:t[0].equals(t[1])},{name:'index mirrors',ok:t[2].equals(t[3])},
 {name:'cache marker',ok:(t[2].toString().includes('patch37-external-match-intelligence-h2h-weather-ranking')||t[2].toString().includes('patch38-forward-health-decision-truth-evidence-integrity'))},
 {name:'panel',ok:t[2].toString().includes('tennisPatch37ExternalIntelligencePanel')},
 {name:'loader',ok:t[0].toString().includes('loadTennisPatch37ExternalIntelligence')},
 {name:'health endpoint binding',ok:t[0].toString().includes('/api/tennis/external-match-intelligence-health')}
];const ids=[...t[2].toString().matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);const dup=ids.filter((v,i)=>ids.indexOf(v)!==i);checks.push({name:'unique ids',ok:dup.length===0,duplicates:[...new Set(dup)]});const bad=checks.filter(c=>!c.ok);console.log(JSON.stringify({success:bad.length===0,checks,hashes:Object.fromEntries(files.map((f,i)=>[f,crypto.createHash('sha256').update(t[i]).digest('hex')]))},null,2));if(bad.length)process.exit(1);
