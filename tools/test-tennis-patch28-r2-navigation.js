'use strict';
const fs=require('fs'),path=require('path'); const root=path.resolve(__dirname,'..'); const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const tests=[
 ['Analisi apre epoch dedicata',app.includes("const viewEpoch = enterPrimaryView('ANALYSIS')")],
 ['Analisi ignora risposta obsoleta',app.includes("if (!isPrimaryViewCurrent('ANALYSIS', viewEpoch)) return")],
 ['Trading cambia schermata subito',app.includes("const viewEpoch = enterPrimaryView('TRADING')")&&app.includes("$('forwardTestLogSection')?.classList.remove('hidden');\n    showLoading();")],
 ['Trading ignora risposta obsoleta',app.includes("if (!isPrimaryViewCurrent('TRADING', viewEpoch)) return")],
 ['Portfolio usa epoch vista',app.includes("const viewEpoch = enterPrimaryView('PORTFOLIO')")&&app.includes('loadPortfolioData(viewEpoch)')],
 ['Portfolio usa sequenza richiesta',app.includes('const requestSequence = ++portfolioRequestSequence')],
 ['Portfolio ignora render obsoleto',app.includes('if (!isPortfolioRenderCurrent(requestSequence, viewEpoch)) return')],
 ['Fetch Portfolio abortibili',app.includes("{ signal: requestSignal }")],
 ['Step89 non duplica navigazione',app.includes('PATCH28_R2_SINGLE_NAVIGATION_AUTHORITY')&&!app.includes("bindClick('portfolioBtn'" )],
 ['Diagnostica navigazione read-only',app.includes('getPatch28R2NavigationState')]
];
const results=tests.map(([name,ok])=>({name,ok:Boolean(ok)}));const bad=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:!bad.length,checks:results.length,patch:'TENNIS_PATCH_28_R2',results},null,2));process.exit(bad.length?1:0);
