'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const read=r=>fs.readFileSync(path.join(root,r),'utf8');
const sha=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');
const app=read('public/app.js'), backApp=read('backend/public/app.js'), idx=read('public/index.html'), backIdx=read('backend/public/index.html');
const pkg=JSON.parse(read('package.json'));
const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
const checks=[
 ['registry Tennis 28 preservato',String(registry.TENNIS_CURRENT_PATCH_VERSION)==='28'],
 ['package 21.13.0 preservato',pkg.version==='21.13.0'],
 ['marker navigazione R2 presente',app.includes('PATCH28_R2_UI_NAVIGATION_STABILITY')],
 ['token vista presente',app.includes('primaryViewEpoch')&&app.includes('isPrimaryViewCurrent')],
 ['abort Portfolio presente',app.includes('portfolioAbortController')&&app.includes('PORTFOLIO_REFRESH_REPLACED')],
 ['grafici distrutti in uscita',app.includes('destroyPortfolioChartsForNavigation')],
 ['handler Portfolio unico',((app.match(/\$\('portfolioBtn'\)\?\.addEventListener/g)||[]).length===1)&&!app.includes("bindClick('portfolioBtn'" )],
 ['frontend app sincronizzati',sha('public/app.js')===sha('backend/public/app.js')],
 ['frontend index sincronizzati',sha('public/index.html')===sha('backend/public/index.html')],
 ['cache buster R2 attivo',idx.includes('app.js?v=patch28-r2-ui-navigation-stability')&&!idx.includes('app.js?v=patch28-r1-lifecycle-atp-ledger-recovery')],
 ['progression guard revision-aware',read('backend/tennisProgramProgressionAudit.js').includes('frontendRevisionPattern')],
 ['script verifica R2 presenti',Boolean(pkg.scripts?.['verify:tennis:patch28:r2']&&pkg.scripts?.['audit:tennis:patch28:r2'])]
];
const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})); const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_28_R2_UI_NAVIGATION_STABILITY',checks:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2));
process.exit(failed.length?1:0);
