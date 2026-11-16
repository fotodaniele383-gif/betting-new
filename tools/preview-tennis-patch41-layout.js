#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const outDir=path.join(root,'audit_patch41');fs.mkdirSync(outDir,{recursive:true});
const out=path.join(outDir,'TRADING_LAYOUT_PATCH41_PREVIEW.txt');
const text=`PATCH41 TRADING LAYOUT\n\n1. Storico attivo completo — full width\n2. Ultime 200 righe attive — tabella orizzontale full width\n3. Calibrazione per fascia | Resa per Campionato — tabelle verticali affiancate\n4. Resa Deep Scan IA — matrice orizzontale full width\n5. Resa Qualità / Gate finale — matrice orizzontale full width\n\nMobile: tutte le sezioni in colonna; le matrici restano scorribili orizzontalmente.\n`;
fs.writeFileSync(out,text);console.log(JSON.stringify({success:true,preview:out},null,2));
