#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto'); const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root'); const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const read=p=>fs.readFileSync(path.join(root,p),'utf8'); const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const details=[]; const check=(name,ok,extra=null,severity='error')=>details.push({name,ok:Boolean(ok),severity,details:extra});
try{
 const pkg=JSON.parse(read('package.json')); const lock=JSON.parse(read('package-lock.json')); const registry=require(path.join(root,'backend/tennisPatchRegistry'));
 check('Package Patch49 o successivo',Number(pkg.version.split('.')[1])>=36,{actual:pkg.version}); check('Package lock Patch49 o successivo',lock.version===pkg.version&&lock.packages?.['']?.version===pkg.version);
 check('Registry Patch49 o successivo',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=49&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`,registry.getTennisPatchStatus());
 check('Voce Patch48 preservata',registry.PATCHES.some(p=>String(p.title).includes('Operational authority alignment')));
 check('Voce Patch49 registrata',registry.PATCHES.some(p=>String(p.title).includes('Cross-sport analysis memory')));
 const app=read('public/app.js'), html=read('public/index.html'), server=read('backend/server.js'), analytics=read('backend/aiPredictionIndexBandPerformance.js'), canonicalSource=read('backend/tennisDeepScanCanonicalOnboardingPatch49.js');
 check('Cache analisi 180 secondi',app.includes('ANALYSIS_MEMORY_TTL_MS = 180000')&&app.includes('getLatestAnalysisMemory'));
 check('Cache precede fetch',app.indexOf('const memoryEntry = forcedRefresh')<app.indexOf('const response = await fetch(apiUrl'));
 check('Cache evita DeepScan replay',app.includes('if (!options.reuseCached) setTimeout(() => {'));
 check('Cache Tennis e Calcio separata',app.includes('analysisMemoryFingerprint')&&app.includes("'TENNIS' ? 'TENNIS' : 'CALCIO'"));
 check('Affidabilita AI in Analisi',html.includes('>Affidabilità AI</th>')&&app.includes('ai-reliability-cell-${index}'));
 check('Indice Predizione in Trading',app.includes("key: 'prediction_index', label: 'Indice Predizione'")&&app.includes('renderUnifiedPredictionIndexCell(row)'));
 check('Matrice indice disponibile',server.includes("app.get('/api/analytics/prediction-index-bands'")&&app.includes('predictionIndexBandsPanel')&&analytics.includes('outcomeUsedOnlyForAggregation'));
 check('Onboarding DeepScan continuo',server.includes('PATCH49_SERVER_STARTUP_ONBOARDING')&&canonicalSource.includes('reconcileCanonicalCoverage')&&canonicalSource.includes('TENNIS_DEEPSCAN_CANONICAL_ONBOARDING_V1_PATCH49'));
 check('Frontend mirror',hash('public/app.js')===hash('backend/public/app.js')&&hash('public/index.html')===hash('backend/public/index.html'));
 check('Cache buster Patch49 o successivo',/app\.js\?v=patch(?:49-analysis-memory-prediction-index-bands-ai-reliability|50-health-check-alignment-prediction-index-collapse|51-settlement-exception-queue-idempotent-notifications)/.test(html));
 check('Script npm Patch49',Boolean(pkg.scripts?.['verify:tennis:patch49']&&pkg.scripts?.['audit:tennis:patch49']&&pkg.scripts?.['rollback:tennis:patch49']));
 check('Settlement debole invariato',hash('backend/tennisSettlementContract.js')==='fcec1f815cead92d9919c92d0c34cbd79d232c91d3ac4bf6301f7788391f3856'&&(hash('backend/paperTrading.tennis.js')==='1fa4a638d4d96eceaab4520b78dc34afb16c01408432c48e48889d3cbfbd4684'||read('backend/paperTrading.tennis.js').includes('TENNIS_PATCH51_SETTLEMENT_EXCEPTION_QUEUE')),{paperTrading:hash('backend/paperTrading.tennis.js'),contract:hash('backend/tennisSettlementContract.js')});
 check('Weak evidence non auto-promossa',read('backend/paperTrading.tennis.js').includes('classificato PROPOSED')&&read('backend/paperTrading.tennis.js').includes('BLOCKED_CONTRACT')&&read('backend/paperTrading.tennis.js').includes('settlement non certificato'));
 const dbPath=path.join(root,'backend/database_betting.db'); const db=new DatabaseSync(dbPath,{readOnly:true}); const integrity=db.prepare('PRAGMA integrity_check').get(); const fk=db.prepare('PRAGMA foreign_key_check').all(); const counts=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis FROM ai_forward_test").get(); const canonical=require(path.join(root,'backend/tennisDeepScanCanonicalOnboardingPatch49.js')).getCoverage(db); db.close();
 check('Database integro',integrity.integrity_check==='ok'&&fk.length===0,{integrity:integrity.integrity_check,foreignKeyViolations:fk.length,...counts});
 check('DeepScan canonico copertura completa',canonical.success&&canonical.covered===canonical.tennisRows&&canonical.coverageGap===0,canonical);
 const errors=details.filter(x=>!x.ok&&x.severity==='error').length,warnings=details.filter(x=>!x.ok&&x.severity==='warning').length;
 const out={success:errors===0,patch:'TENNIS_PATCH_49_CROSS_SPORT_ANALYSIS_MEMORY_PREDICTION_INDEX_BANDS_AI_RELIABILITY',revision:'R1_WINDOWS_NODE_CROSS_SPORT_ANALYSIS_MEMORY_ANALYTICS',checks:details.length,errors,warnings,details}; console.log(JSON.stringify(out,null,2)); if(errors)process.exit(1);
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message},null,2));process.exit(1);}
