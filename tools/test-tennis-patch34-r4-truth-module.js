#!/usr/bin/env node
'use strict';
const assert=require('assert');
const truth=require('../backend/tennisSettlementTruthPatch34R4');
const checks=[]; function check(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
const health=truth.health();
check('health READY',()=>assert.equal(health.status,'READY'));
check('5 risultati completati firmati',()=>assert.equal(health.completedRecords,5));
check('5 evidenze lifecycle firmate',()=>assert.equal(health.lifecycleRecords,5));
check('ritiro non auto-settle',()=>assert.equal(health.retirementAutoSettlement,false));
check('non-final non auto-settle',()=>assert.equal(health.nonFinalAutoSettlement,false));
const rows=[
 {id:2433,home_team:'Anna Kalinskaya',away_team:'Janice Tjen',match_date:'2026-07-30',prediction:'2',predicted_player_name:'Janice Tjen',outcome:'LOST'},
 {id:2439,home_team:'Anna Kalinskaya',away_team:'Jessica Pegula',match_date:'2026-07-31',prediction:'2',predicted_player_name:'Jessica Pegula',outcome:'WON'},
 {id:2440,home_team:'Alexandra Eala',away_team:'Elina Svitolina',match_date:'2026-08-01',prediction:'1',predicted_player_name:'Alexandra Eala',outcome:'WON'},
 {id:2465,home_team:'Sara Bejlek',away_team:'Xiyu Wang',match_date:'2026-08-02',prediction:'1',predicted_player_name:'Sara Bejlek',outcome:'WON'},
 {id:2466,home_team:'Aoi Ito',away_team:'Katherine Sebov',match_date:'2026-08-02',prediction:'1',predicted_player_name:'Aoi Ito',outcome:'LOST'}
];
for(const row of rows){ const r=truth.resolve(row); check(`risultato ${row.id} risolto`,()=>assert(r&&!r.nonFinal)); check(`outcome snapshot ${row.id} ${row.outcome}`,()=>assert.equal(truth.expectedOutcome(row,r),row.outcome)); check(`identità ${row.id} bypass legacy sicuro`,()=>assert.equal(truth.canBypassFingerprintMismatch(row,r),true)); }
for(const id of [2431,2441,2442,2469,2484]){ const base={2431:['Ashlyn Krueger','Naomi Osaka','2026-07-30'],2441:['Michael Zheng','Miomir Kecmanovic','2026-08-02'],2442:['Aleksandar Kovacevic','Nuno Borges','2026-08-02'],2469:['Leolia Jeanjean','Magdalena Frech','2026-08-02'],2484:['Alexandra Eala','Jessica Pegula','2026-08-02']}[id]; const r=truth.resolve({id,home_team:base[0],away_team:base[1],match_date:base[2]}); check(`lifecycle ${id} non-final`,()=>assert(r&&r.nonFinal&&r.automaticSettlement===false)); }
const failed=checks.filter(x=>!x.ok); console.log(JSON.stringify({success:!failed.length,patch:'PATCH34_R4',checks,passed:checks.length-failed.length,failed:failed.length},null,2)); process.exit(failed.length?1:0);
