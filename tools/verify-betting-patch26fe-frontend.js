'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const root=path.resolve(__dirname,'..');
const pub=fs.readFileSync(path.join(root,'public/app.js'),'utf8');const back=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
const idx=fs.readFileSync(path.join(root,'public/index.html'),'utf8');const idxBack=fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const checks=[
 ['frontend copies byte-identical',sha(pub)===sha(back)],
 ['index copies byte-identical',sha(idx)===sha(idxBack)],
 ['Tennis Quality Gate has dedicated renderer',pub.includes('function renderTennisQualityGateCell')&&pub.includes('quality-gate-cell-${index}')],
 ['Analysis row uses unified quality renderer',pub.includes('const unifiedQualityCell = renderUnifiedQualityGateCell(bet)')],
 ['Tennis prediction index renderer exists',pub.includes('function renderTennisPredictionIndexCell')&&pub.includes('TPI diagnostico · ranking sportivo')],
 ['Analysis row uses unified prediction index',pub.includes('${renderUnifiedPredictionIndexCell(bet)}')],
 ['DeepScan refreshes Tennis quality and index cells',pub.includes('bet.tennisPredictionIndex = result.tennisPredictionIndex')&&pub.includes('predictionIndexCell.innerHTML = renderUnifiedPredictionIndexCell(bet)')],
 ['Trading AI reliability column is shown for both sports',!pub.includes("if (activeSport !== SPORT.TENNIS) {\n        columns.push({ key: 'ai_reliability'")&&pub.includes("columns.push({ key: 'ai_reliability'")],
 ['Trading row renders unified AI reliability',pub.includes('${renderUnifiedAiReliabilityCell(row)}')],
 ['Header documents sport-specific authority',idx.includes('Calcio: IPM autoritativo. Tennis: TPI diagnostico')]
].map(([name,ok])=>({name,ok}));
if(checks.some(x=>!x.ok)){console.error(JSON.stringify({success:false,checks},null,2));process.exit(1);}console.log(JSON.stringify({success:true,checks},null,2));
