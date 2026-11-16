#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend','database_betting.db');const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');const before=sha(dbPath);
const db=new DatabaseSync(dbPath,{readOnly:true});const mod=require(path.join(root,'backend','unifiedCrossSportPortfolioRiskAuthorityPatch56'));let report,t,c,columns,decisionRows;
try{
 report=mod.buildAuthorityReport(db,{projectRoot:root});
 t=mod.decide({sport:'TENNIS',proposedStake:10,bankrollSnapshot:1000},{db,projectRoot:root});
 c=mod.decide({sport:'CALCIO',proposedStake:10,bankrollSnapshot:1000},{db,projectRoot:root});
 columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name));
 decisionRows=Number(db.prepare(`SELECT COUNT(*) n FROM ${mod.DECISION_TABLE}`).get().n||0);
}finally{db.close();}
const after=sha(dbPath);const checks=[];const ck=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
ck('Report success read-only',report.success===true&&report.readOnly===true,report.status);
ck('Current readiness blocked',report.readiness.gateStatus==='BLOCKED_STATISTICAL_READINESS',report.readiness);
ck('Tennis real exposure blocked',t.realExecutableStake===0&&t.status==='BLOCKED_STATISTICAL_READINESS',t.status);
ck('Calcio real exposure blocked',c.realExecutableStake===0&&c.status==='BLOCKED_STATISTICAL_READINESS',c.status);
ck('Paper evidence preserved Tennis',t.paperStakePreserved===true&&t.candidatePaperStake===10);
ck('Paper evidence preserved Calcio',c.paperStakePreserved===true&&c.candidatePaperStake===10);
ck('Real exposure current zero',Number(report.exposure.total||0)===0,report.exposure);
ck('Schema real stake presente',columns.has('cross_sport_portfolio_real_executable_stake'));
ck('Schema status presente',columns.has('cross_sport_portfolio_risk_status'));
ck('Decision table presente',Number.isFinite(decisionRows));
ck('Authority finale real money',report.authority.finalRealMoneyExposureAuthority===true);
ck('Cannot increase stake',report.authority.canIncreaseStake===false);
ck('Cannot bypass Patch55',report.authority.canBypassPatch55===false);
ck('Cannot self activate production',report.authority.canSelfActivateProduction===false);
ck('Database byte-identico in lettura',before===after,{before,after});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'56',checks:checks.length,report,tennisDecision:t,calcioDecision:c,databaseByteIdentical:before===after,details:checks},null,2));process.exit(failed.length?1:0);
