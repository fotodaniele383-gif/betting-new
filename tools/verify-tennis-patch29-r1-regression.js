'use strict';const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),read=r=>fs.readFileSync(path.join(root,r),'utf8');const migration=read('backend/migrateTennisPatch29R1.js'),resolver=read('backend/tennisOfficialSettlementResolver.js'),contract=read('backend/tennisSettlementContract.js');
const globalReg=require('../backend/calcioPatchRegistry'),tennisReg=require('../backend/tennisPatchRegistry'),pkg=JSON.parse(read('package.json'));
const checks=[
['global registry 38',String(globalReg.CALCIO_CURRENT_PATCH_VERSION)==='38'],['Tennis registry 29',String(tennisReg.TENNIS_CURRENT_PATCH_VERSION)==='29'],['package 21.15.0',pkg.version==='21.15.0'],
['resolver no DB mutation',!resolver.includes('UPDATE ai_forward_test')&&!resolver.includes('stake =')],['migration no ALTER',!migration.includes('ALTER TABLE')],
['probabilità authority invariata',migration.includes('probabilityAuthorityChanged: false')],['Quality Gate authority invariata',migration.includes('qualityGateAuthorityChanged: false')],
['stake authority invariata',migration.includes('stakeAuthorityChanged: false')],['CLV non ricostruito',migration.includes('clvFieldsUnchanged')],
['righe risolte precedenti protette',migration.includes('preExistingResolvedRowsUnchanged')],['futuri non chiusi',migration.includes('FUTURE_MATCH')],
['ritiri manuali',resolver.includes('retirementAutoSettlement: false')],['weak web non promosso',contract.includes('PROPOSE_ONLY')||contract.includes('WEAK_WEB')],
['nuove Odds API zero',!resolver.includes('api.the-odds-api.com')],['Calcio non toccato',!migration.includes("sport_type='CALCIO'")&&!migration.includes('calcio')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
