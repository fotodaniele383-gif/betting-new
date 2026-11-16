'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const patchDir=path.join(root,'TENNIS_PATCH_28_R2_UI_NAVIGATION_STABILITY');
const targetsPath=path.join(patchDir,'TARGETS.txt');
const targets=fs.existsSync(targetsPath)?fs.readFileSync(targetsPath,'utf8').split(/\r?\n/).filter(Boolean):[];
const forbidden=['backend/tennisValueEvaluator.js','backend/tennisStakePolicy.js','backend/paperTrading.tennis.js','backend/deepScanTennis.js','backend/database_betting.db','backend/calcioQuantEngine.js'];
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const checks=[
 ['nessun file modello/stake target',forbidden.every(x=>!targets.includes(x))],
 ['database non target',!targets.some(x=>x.includes('database_betting.db'))],
 ['registry invariato',String(require(path.join(root,'backend','tennisPatchRegistry.js')).TENNIS_CURRENT_PATCH_VERSION)==='28'],
 ['R1 verifica preservata',Boolean(pkg.scripts?.['verify:tennis:patch28:r1'])]
];
const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
