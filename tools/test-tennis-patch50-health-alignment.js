#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const assert=require('assert');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const backend=path.join(root,'backend');
const alignment=require(path.join(backend,'tennisTechnicalHealthAlignmentPatch50'));
const modules={
 runtimeDiagnostics:require(path.join(backend,'runtimeDiagnostics')),
 tennisForwardLifecycle:require(path.join(backend,'tennisForwardLifecycle')),
 tennisPlayerEvidence:require(path.join(backend,'tennisPlayerEvidence')),
 tennisProgramProgressionAudit:require(path.join(backend,'tennisProgramProgressionAudit')),
 tennisMultiProviderData:require(path.join(backend,'tennisMultiProviderData'))
};
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
const actual=alignment.buildAlignedTechnicalChecks(modules);
const names=Object.keys(alignment.CHECK_SPECS);
add('contratto allineamento Patch50',alignment.TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION==='TENNIS_TECHNICAL_HEALTH_ALIGNMENT_V1_PATCH50');
add('cinque check coperti',names.length===5,{names});
for(const name of names){const item=actual[name];add(`${name} attivo`,item?.ok===true&&item?.status==='OK'&&item?.semanticLabel==='ACTIVE_COMPATIBLE',item);add(`${name} versione reale esposta`,Boolean(item?.actualVersion)&&item?.actualVersion===modules[name.replace(/Active$/,'')]?.[alignment.CHECK_SPECS[name].versionKey],item?.actualVersion);}
const missing=alignment.evaluateTechnicalModule({RUNTIME_DIAGNOSTICS_VERSION:'RUNTIME_DIAGNOSTICS_V2_PATCH26FD',installProcessDiagnostics(){},readRecentDiagnostics(){}},alignment.CHECK_SPECS.runtimeDiagnosticsActive);
add('capability mancante resta ERROR',missing.ok===false&&missing.status==='ERROR'&&missing.missingCapabilities.includes('buildDiagnosticsSummary'),missing);
const incompatible=alignment.evaluateTechnicalModule({RUNTIME_DIAGNOSTICS_VERSION:'UNRELATED_VERSION',installProcessDiagnostics(){},readRecentDiagnostics(){},buildDiagnosticsSummary(){}},alignment.CHECK_SPECS.runtimeDiagnosticsActive);
add('famiglia versione incompatibile resta ERROR',incompatible.ok===false&&incompatible.reason.includes('VERSION_FAMILY_INCOMPATIBLE'),incompatible);
const server=fs.readFileSync(path.join(backend,'server.tennis.js'),'utf8');
add('server usa contratto semantico',server.includes("require('./tennisTechnicalHealthAlignmentPatch50')")&&server.includes('buildAlignedTechnicalChecks'));
for(const obsolete of ['RUNTIME_DIAGNOSTICS_V1_PATCH5','TENNIS_FORWARD_LIFECYCLE_V1_PATCH8','TENNIS_PLAYER_EVIDENCE_V5_PATCH22','TENNIS_PROGRAM_PROGRESSION_AUDIT_V28_PATCH35','TENNIS_MULTI_PROVIDER_DATA_V1_PATCH21']) add(`confronto rigido rimosso ${obsolete}`,!server.includes(`=== '${obsolete}'`));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_50_TECHNICAL_HEALTH_CHECK_ALIGNMENT_COLLAPSIBLE_PREDICTION_INDEX_BANDS',checks:checks.length,errors:failed.length,details:checks,actual},null,2));if(failed.length)process.exit(1);
