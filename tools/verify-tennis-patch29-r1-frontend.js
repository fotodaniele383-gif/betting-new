'use strict';const fs=require('fs'),path=require('path'),crypto=require('crypto');const root=path.resolve(__dirname,'..'),read=r=>fs.readFileSync(path.join(root,r),'utf8'),h=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');
const app=read('public/app.js'),index=read('public/index.html');const checks=[
['app copie sincronizzate',h('public/app.js')===h('backend/public/app.js')],
['index copie sincronizzate',h('public/index.html')===h('backend/public/index.html')],
['style copie preservate',h('public/style.css')===h('backend/public/style.css')],
['cache buster R1',index.includes('app.js?v=patch29-r1-wta-settlement-diagnostic-clarity')],
['body marker R1',index.includes('data-patch29-r1-wta-settlement-diagnostic-clarity="true"')],
['marker JS R1',app.includes('PATCH29_R1_WTA_SETTLEMENT_DIAGNOSTIC_CLARITY')],
['titolo evidenza numerico',app.includes('risultati attendono evidenza ufficiale')],
['titolo ritiro',app.includes('Ritiro ufficiale · verifica regola bookmaker')],
['titolo identità',app.includes('Risultato ufficiale · revisione identità evento')],
['titolo CLV separato',app.includes('Settlement verificati · CLV non disponibile')],
['manual review non ERROR automatico',app.includes("const hardBlocked = safeNumber(evidence.sourceConflict,0) + safeNumber(evidence.contractInvalid,0)")],
['dettagli leggibili',app.includes('REVISIONE IDENTITÀ EVENTO')&&app.includes('SETTLEMENT OK · CLV MANCANTE')],
['nessun nuovo chart',!app.includes('PATCH29_R1_CHART')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
