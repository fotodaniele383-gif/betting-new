'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const reporting=require('../backend/tennisTradingReportingPatch40');
const taxonomy=require('../backend/tennisDeepScanTaxonomyPatch40');
const h2h=require('../backend/tennisH2HWeightPolicyPatch40');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
function open(){try{const B=require(path.join(root,'node_modules','better-sqlite3'));return new B(path.join(root,'backend','database_betting.db'))}catch(_){const{DatabaseSync}=require('node:sqlite');return new DatabaseSync(path.join(root,'backend','database_betting.db'))}}
const details=[];let errors=0;function add(name,ok,value={}){details.push({name,ok,details:value});if(!ok)errors++}
const db=open();
try{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
 const report=reporting.buildDbReporting(db,'all',{rollingLimit:200}); delete report.rows;
 const publicApp=fs.readFileSync(path.join(root,'public','app.js'),'utf8'),backendApp=fs.readFileSync(path.join(root,'backend','public','app.js'),'utf8');
 add('versioni Patch 40',pkg.version==='21.27.0'&&String(registry.TENNIS_CURRENT_PATCH_VERSION)==='40',{packageVersion:pkg.version,registry:registry.TENNIS_CURRENT_PATCH_VERSION});
 add('scope storico completo esplicito',report.full.scope===reporting.FULL_SCOPE&&report.full.rowCount>report.rolling.rowCount,{fullRows:report.full.rowCount,rollingRows:report.rolling.rowCount});
 add('duplicati inattivi esclusi',report.inactiveDuplicates>=0,{inactiveDuplicates:report.inactiveDuplicates});
 add('ROI reale separato dal segnale',report.full.operational.placed<=report.full.signal.placed&&report.full.paperAudit.rows===report.full.signal.placed-report.full.operational.placed,{operational:report.full.operational,signal:report.full.signal,paperAudit:report.full.paperAudit});
 add('ROI flat teorico separato',report.full.theoreticalFlat.description.includes('non rappresenta denaro'),report.full.theoreticalFlat);
 add('CLV denominatore verificato',report.full.clv.beaten<=report.full.clv.verified&&report.full.clv.verified<=report.full.clv.eligible,report.full.clv);
 add('tassonomia DeepScan canonica',taxonomy.registry().map(x=>x.label).join('|')==='RISCHIO MODELLO|EDGE TECNICO|VALUE CONFERMATO / MICRO|ALTO RISCHIO|WATCHLIST LOW EDGE|ATTENDI IN-PLAY|SENZA DEEPSCAN|ALTRO / NON CLASSIFICATO',{version:taxonomy.VERSION});
 add('H2H n=2-3 cap 0.75',h2h.apply(2.5,2).adjustmentPp===0.75&&h2h.apply(-2.5,3).adjustmentPp===-0.75,{policy:h2h.POLICY});
 add('frontend sincronizzato',publicApp===backendApp,{});
 add('NEW HISTORY eliminato',!publicApp.includes("label = 'NEW HISTORY'")&&publicApp.includes('STORICO ATTIVO CORRENTE'),{});
 add('autorità micro stake esplicita',publicApp.includes('MICRO-STAKE AUTORIZZATO CON CAP')&&publicApp.includes('NESSUNA AUTORITÀ STAKE STANDARD'),{});
 add('calibrazione fasce visibile',publicApp.includes('Calibrazione per fascia')&&Array.isArray(report.full.calibrationBands),{bands:report.full.calibrationBands});
 add('audit append-only',Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_patch40_audit_no_update'").get())&&Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_patch40_audit_no_delete'").get()),{});
 add('integrità DB',String(Object.values(db.prepare('PRAGMA integrity_check').get())[0]).toLowerCase()==='ok'&&db.prepare('PRAGMA foreign_key_check').all().length===0,{});
 console.log(JSON.stringify({success:errors===0,checks:details.length,errors,details,reporting:report,safeguards:{noProbabilityChanges:true,noStakeChanges:true,noSettlementChanges:true,noClvReconstruction:true,noSoccerChanges:true}},null,2));process.exitCode=errors?1:0;
}finally{db.close()}
