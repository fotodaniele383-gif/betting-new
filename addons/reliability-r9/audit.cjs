 'use strict';
const path=require('node:path');
function collect(root){
 const r7=require(path.join(root,'addons','reliability-r7','core.cjs'));
 const snapshot=r7.report(root),summary={};
 const groups=['CALCIO_SETTLEMENT','TENNIS_SCHEDULE','TENNIS_FORWARD'];
 for(const kind of groups){const list=snapshot.cases.filter(c=>c.kind===kind);
  const documentation=list.filter(c=>c.review?.status==='EVIDENCE_SUBMITTED_REQUIRES_INDEPENDENT_VERIFICATION');
  summary[kind]={total:list.length,noEvidence:list.length-documentation.length,documentedUnverified:documentation.length,independentlyCertifiedByR9:0,
   samples:list.filter(c=>c.review?.status!=='EVIDENCE_SUBMITTED_REQUIRES_INDEPENDENT_VERIFICATION').slice(0,6).map(c=>({id:c.id,match:c.match,required:kind==='CALCIO_SETTLEMENT'?'risultato ufficiale e termini liquidazione':kind==='TENNIS_SCHEDULE'?'identificativo evento e calendario ufficiale':'riconciliazione contratto originale e ricevuta contabile'}))};
 }
 return {version:'BETTINGAPP_R9_RECONCILIATION_AUDIT_V1',dbQuickCheck:snapshot.dbQuickCheck,legacyDbWrites:false,readOnly:true,
  generatedAt:new Date().toISOString(),counts:snapshot.counts,forwardCaptureHealth:snapshot.health,groups:summary,
  ledgerEvidenceEntries:snapshot.ledgerEntries,unresolved:snapshot.unresolved,
  expectedFollowup:'Inserisci le evidenze tramite AVVIA_R7_RECONCILIAZIONE.cmd (porta 3191). R9 non cambia lo status legacy.',
  status:'DOCUMENTAZIONE_POSSIBILE_MA_SETTLEMENT_E_CERTIFICAZIONE_NON_AUTOMATICI',
  safeguards:['NO_AUTO_SETTLEMENT','NO_STAKE_REWRITE','NO_FAKE_OFFICIAL_SCHEDULE','NO_DB_WRITES','SAFE13_UNCHANGED']};
}
if(require.main===module){try{const root=path.resolve(process.argv[2]||process.cwd());console.log(JSON.stringify(collect(root),null,2));}catch(e){console.error('R9_AUDIT_FAIL='+String(e.message||e));process.exitCode=1;}}
module.exports={collect};
