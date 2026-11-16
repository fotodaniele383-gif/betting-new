#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));const s=require(path.join(root,'backend','productionSecuritySafeReleasePatch57'));const legacy=require(path.join(root,'backend','tennisReleaseSecurity'));const plan=s.buildStrictReleasePlan(root,{withHashes:false});const scan=s.scanStrictReleaseSurface(root,plan);const inc=new Set(plan.included.map(x=>x.path));const checks=[];const c=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
c('Strict allowlist active',plan.summary.strictAllowlist===true);
c('Release within size guard',plan.summary.withinSizeGuard===true,{miB:plan.summary.totalMiB,maxMiB:plan.summary.maxMiB});
c('Core server included',inc.has('backend/server.js'));
c('Package included',inc.has('package.json')&&inc.has('package-lock.json'));
c('Frontend included',inc.has('public/app.js')&&inc.has('public/index.html'));
c('Database excluded',![...inc].some(x=>/\.db(?:-|$)|\.sqlite/i.test(x)));
c('Environment excluded',![...inc].some(x=>/(^|\/)\.env$|\.env\.(?!example)/i.test(x)));
c('Backups excluded',![...inc].some(x=>/(^|\/)(?:backup|backups|\.betting_patch_backups)(\/|$)/i.test(x)));
c('Executables excluded',![...inc].some(x=>/\.(?:exe|dll|msi)$/i.test(x)));
c('Archives excluded',![...inc].some(x=>/\.(?:zip|7z|rar|gz|tar)$/i.test(x)));
c('Patch state excluded',![...inc].some(x=>/^\.(?:tennis|calcio)_patch.*_state\.json$/i.test(path.basename(x))));
c('Release secret scan clean',scan.healthy===true&&scan.findings.length===0,{scannedFiles:scan.scannedFiles});
c('Synthetic Telegram token detected',legacy.scanText('token=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi','synthetic.txt').length>0);
c('Sensitive source risk only boolean',Object.values(s.sourceRiskSummary(root)).every(v=>typeof v==='boolean'||typeof v==='string'));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'57',suite:'RELEASE_POLICY',checks:checks.length,details:checks,summary:plan.summary,secretFindings:scan.findings.length},null,2));process.exit(failed.length?1:0);
