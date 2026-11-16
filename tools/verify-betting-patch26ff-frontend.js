'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const root=path.resolve(__dirname,'..');const read=r=>fs.readFileSync(path.join(root,r),'utf8');const hash=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');const app=read('public/app.js'),style=read('public/style.css'),index=read('public/index.html');
const checks=[
 ['titolo chiaro',app.includes('Vinte e perse per fascia di probabilità')],
 ['fasce sempre visibili',app.includes('Le fasce senza campione restano visibili')],
 ['percentuali WON e LOST separate',app.includes('aiOutcomeBandPct(band.winRatePct)')&&app.includes('aiOutcomeBandPct(band.lossRatePct)')],
 ['campionato tipologia torneo',app.includes('Campionato / tipologia torneo')],
 ['scope segnali e stake',app.includes('Tutti i segnali AI')&&app.includes('Solo stake reale')],
 ['spiegazione probabilita corretta',app.includes('Affidabilità AI, TPI e quota implicita sono esclusi')],
 ['desktop table responsive',style.includes('.ai-outcome-table {')&&style.includes('table-layout: fixed')],
 ['mobile card responsive',style.includes('.ai-outcome-band-card-grid')&&style.includes('@media (max-width: 390px)')],
 ['nessun grafico pesante',!app.includes('chartAiOutcomeBands')],
 ['cache buster revision-aware',/app\.js\?v=[a-z0-9-]+/i.test(index)],
 ['app sync',hash('public/app.js')===hash('backend/public/app.js')],
 ['index sync',hash('public/index.html')===hash('backend/public/index.html')],
 ['style sync',hash('public/style.css')===hash('backend/public/style.css')]
].map(([name,ok])=>({name,ok:Boolean(ok)}));const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
