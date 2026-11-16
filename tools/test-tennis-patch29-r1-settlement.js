'use strict';
const assert=require('assert'),path=require('path'); const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),official=require('../backend/tennisOfficialSettlementResolver'),contract=require('../backend/tennisSettlementContract');
const db=new DatabaseSync(path.join(root,'backend','database_betting.db')); const rows={};
try{for(const id of [2421,2422,2423,2424,2425,2426,2430,2431,2432,2433])rows[id]=db.prepare('select * from ai_forward_test where id=?').get(id);}finally{db.close()}
const checks=[];const check=(name,fn)=>{try{fn();checks.push({name,ok:true})}catch(e){checks.push({name,ok:false,error:e.message})}};
const seed=official.loadSeed(),retirement=official.loadRetirementEvidence(),health=official.health();
check('seed totale 21',()=>assert.equal(seed.records.length,21));
check('seed WTA almeno 9',()=>assert(Number(health.seedByTour.WTA)>=9));
check('seed hash valido',()=>assert.equal(health.seedHash,seed.seedHash));
check('ritiro evidence unico',()=>assert.equal(retirement.records.length,1));
check('ritiro hash valido',()=>assert.equal(health.retirementEvidenceHash,retirement.evidenceHash));
check('parser WTA attivo',()=>assert.equal(health.wtaDrawParserActive,true));
check('zero Odds API',()=>assert.equal(health.zeroOddsApiCalls,true));
check('retirement auto settlement false',()=>assert.equal(health.retirementAutoSettlement,false));
for(const id of [2421,2422,2423,2424,2425,2426,2430,2432]){
  check(`seed risolve ${id}`,()=>assert(official.resolveFromSeed(rows[id])));
}
const r=official.resolveRetirementEvidence(rows[2431]);
check('ritiro Krueger Osaka rilevato',()=>assert(r&&r.requiresBookmakerRule===true&&r.automaticSettlement===false));
check('contratto ritiro manual review',()=>assert.equal(contract.evaluateTennisSettlementContract(rows[2431],r,{operationId:'R1_TEST'}).status,'MANUAL_REVIEW'));
const normal=official.resolveFromSeed(rows[2421]);
check('contratto WTA ufficiale VERIFIED',()=>assert.equal(contract.evaluateTennisSettlementContract(rows[2421],normal,{operationId:'R1_TEST'}).status,'VERIFIED'));
check('contratto WTA ufficiale auto settle',()=>assert.equal(contract.evaluateTennisSettlementContract(rows[2421],normal,{operationId:'R1_TEST'}).autoSettleAllowed,true));
const fixture='R32 Cristina Bucsa faces Polina Kudermetova';
check('parser WTA non inventa senza struttura sufficiente',()=>assert.equal(official.parseWtaOfficialDrawText(fixture,rows[2421],official.OFFICIAL_TOURNAMENTS.wta_500_washington),null));
check('future/no seed non promosso',()=>assert.equal(official.resolveFromSeed({home_team:'Future A',away_team:'Future B',match_date:'2026-08-01',league:'[WTA] WTA500'}),null));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_29_R1',checks:checks.length,passed:checks.length-failed.length,failed:failed.length,results:checks},null,2));process.exit(failed.length?1:0);
