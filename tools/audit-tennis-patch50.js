#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const read=p=>fs.readFileSync(path.join(root,p),'utf8'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const details=[];const check=(name,ok,extra=null,severity='error')=>details.push({name,ok:Boolean(ok),severity,details:extra});
try{
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json')),registry=require(path.join(root,'backend/tennisPatchRegistry'));
 check('Package Patch50',Number(pkg.version.split('.')[1])>=37,{actual:pkg.version});check('Package lock Patch50',lock.version===pkg.version&&lock.packages?.['']?.version===pkg.version);
 check('Registry corrente 50',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=50&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`,registry.getTennisPatchStatus());
 check('Voce Patch49 preservata',registry.PATCHES.some(p=>String(p.title).includes('Cross-sport analysis memory')));
 check('Voce Patch50 registrata',registry.PATCHES.some(p=>String(p.title).includes('Technical health check semantic alignment')));
 const alignment=require(path.join(root,'backend/tennisTechnicalHealthAlignmentPatch50'));
 const aligned=alignment.buildAlignedTechnicalChecks({runtimeDiagnostics:require(path.join(root,'backend/runtimeDiagnostics')),tennisForwardLifecycle:require(path.join(root,'backend/tennisForwardLifecycle')),tennisPlayerEvidence:require(path.join(root,'backend/tennisPlayerEvidence')),tennisProgramProgressionAudit:require(path.join(root,'backend/tennisProgramProgressionAudit')),tennisMultiProviderData:require(path.join(root,'backend/tennisMultiProviderData'))});
 check('Cinque checks semanticamente allineati',Object.keys(aligned).length===5&&Object.values(aligned).every(x=>x.ok&&x.status==='OK'),aligned);
 const st=read('backend/server.tennis.js'),app=read('public/app.js'),html=read('public/index.html');
 check('Server health usa Patch50',st.includes('TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION')&&st.includes('alignedTechnicalChecksPatch50'));
 check('Confronti rigidi obsoleti assenti',!['RUNTIME_DIAGNOSTICS_V1_PATCH5','TENNIS_FORWARD_LIFECYCLE_V1_PATCH8','TENNIS_PLAYER_EVIDENCE_V5_PATCH22','TENNIS_PROGRAM_PROGRESSION_AUDIT_V28_PATCH35','TENNIS_MULTI_PROVIDER_DATA_V1_PATCH21'].some(v=>st.includes(`=== '${v}'`)));
 check('UI espone dettaglio semantico',app.includes('tennis-health-check-detail')&&app.includes('data-health-check-status'));
 check('Pulsante comprimi espandi',app.includes('predictionIndexBandsCollapseBtn')&&app.includes('predictionIndexBandsVisibilityState'));
 check('Stato collapse preservato nei filtri',app.includes('predictionIndexBandsState.collapsed=!predictionIndexBandsState.collapsed'));
 check('Frontend mirror',hash('public/app.js')===hash('backend/public/app.js')&&hash('public/index.html')===hash('backend/public/index.html'));
 check('Cache buster Patch50',html.includes('app.js?v=patch50-health-check-alignment-prediction-index-collapse')||html.includes('app.js?v=patch51-settlement-exception-queue-idempotent-notifications'));
 check('Script npm Patch50',Boolean(pkg.scripts?.['verify:tennis:patch50']&&pkg.scripts?.['audit:tennis:patch50']&&pkg.scripts?.['rollback:tennis:patch50']));
 check('Settlement debole invariato',hash('backend/tennisSettlementContract.js')==='fcec1f815cead92d9919c92d0c34cbd79d232c91d3ac4bf6301f7788391f3856'&&(hash('backend/paperTrading.tennis.js')==='1fa4a638d4d96eceaab4520b78dc34afb16c01408432c48e48889d3cbfbd4684'||read('backend/paperTrading.tennis.js').includes('TENNIS_PATCH51_SETTLEMENT_EXCEPTION_QUEUE')));
 const db=new DatabaseSync(path.join(root,'backend/database_betting.db'),{readOnly:true});const integrity=db.prepare('PRAGMA integrity_check').get();const fk=db.prepare('PRAGMA foreign_key_check').all();const counts=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis FROM ai_forward_test").get();db.close();
 check('Database integro',integrity.integrity_check==='ok'&&fk.length===0,{integrity:integrity.integrity_check,foreignKeyViolations:fk.length,...counts});
 const errors=details.filter(x=>!x.ok&&x.severity==='error').length,warnings=details.filter(x=>!x.ok&&x.severity==='warning').length;const out={success:errors===0,patch:'TENNIS_PATCH_50_TECHNICAL_HEALTH_CHECK_ALIGNMENT_COLLAPSIBLE_PREDICTION_INDEX_BANDS',revision:'R1_WINDOWS_NODE_HEALTH_SEMANTIC_ALIGNMENT_COLLAPSIBLE_ANALYTICS',checks:details.length,errors,warnings,details};console.log(JSON.stringify(out,null,2));if(errors)process.exit(1);
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message},null,2));process.exit(1)}
