#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend','database_betting.db');const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');const before=sha(dbPath);
const db=new DatabaseSync(dbPath,{readOnly:true});const mod=require(path.join(root,'backend','unifiedCrossSportPortfolioRiskAuthorityPatch56'));let report,integrity,fk,cols,counts,decisionRows,realExposure;
try{
 report=mod.health(db,{projectRoot:root});
 integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];fk=db.prepare('PRAGMA foreign_key_check').all();cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name));
 counts=db.prepare(`SELECT COUNT(*) total,
   SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis,
   SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) calcio,
   SUM(CASE WHEN UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(stake,0)>0 THEN 1 ELSE 0 END) pendingPositivePaper
   FROM ai_forward_test`).get();
 decisionRows=Number(db.prepare(`SELECT COUNT(*) n FROM ${mod.DECISION_TABLE}`).get().n||0);
 realExposure=Number(db.prepare(`SELECT COALESCE(SUM(cross_sport_portfolio_real_executable_stake),0) n FROM ai_forward_test WHERE UPPER(COALESCE(status,'PENDING'))='PENDING'`).get().n||0);
}finally{db.close();}
const after=sha(dbPath);const pkg=require(path.join(root,'package.json'));const tennis=require(path.join(root,'backend','tennisPatchRegistry'));const calcio=require(path.join(root,'backend','calcioPatchRegistry'));const tinv=require(path.join(root,'backend','tennis_patch_inventory.json'));const cinv=require(path.join(root,'backend','calcio_patch_inventory.json'));const cron=require(path.join(root,'backend','calcio_cron_config.json'));const idx=fs.readFileSync(path.join(root,'public','index.html'),'utf8'),bidx=fs.readFileSync(path.join(root,'backend','public','index.html'),'utf8');
const details=[];const c=(name,ok,d=null,severity='error')=>details.push({name,ok:Boolean(ok),severity,details:d});
c('Package Patch56 future-compatible',Number(pkg.version.split('.')[1])>=43,{actual:pkg.version});
c('Tennis registry >=56',Number(tennis.TENNIS_CURRENT_PATCH_VERSION)>=56,{registryVersion:tennis.TENNIS_PATCH_REGISTRY_VERSION});
c('Tennis inventory >=56',Number(tinv.registry?.currentPatchVersion)>=56&&String(tinv.registry?.registryVersion||'').startsWith('TENNIS_PATCH_REGISTRY_V'));
c('Patch55 preservata',tennis.PATCHES.some(x=>String(x.version)==='55'&&x.status==='ACTIVE'));
c('Patch56 registrata',tennis.PATCHES.some(x=>String(x.version)==='56'&&x.status==='ACTIVE'));
c('Calcio registry 38 preservato',String(calcio.CALCIO_CURRENT_PATCH_VERSION)==='38');
c('Calcio inventory V38 preservato',cinv.schemaVersion==='CALCIO_PATCH_INVENTORY_V38_PATCH54');
c('Authority version',mod.VERSION==='UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY_V1_PATCH56');
c('Policy version',mod.POLICY_VERSION==='UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_POLICY_V1_PATCH56');
c('Mode paper preserved',mod.MODE==='REAL_MONEY_FAIL_CLOSED_SHADOW_PAPER_PRESERVED');
c('Report success',report.success===true&&report.healthy===true);
c('Current gate real money blocked',report.status==='REAL_MONEY_EXPOSURE_BLOCKED',report.status);
c('Readiness Patch55 blocked',report.readiness?.gateStatus==='BLOCKED_STATISTICAL_READINESS',report.readiness);
c('Tennis authority zero',report.sportAuthority?.TENNIS?.realExecutableStake===0,report.sportAuthority?.TENNIS);
c('Calcio authority zero',report.sportAuthority?.CALCIO?.realExecutableStake===0,report.sportAuthority?.CALCIO);
c('Current real exposure zero',realExposure===0,{realExposure});
c('Paper positive rows preservate',Number(counts.pendingPositivePaper||0)>0,{pendingPositivePaper:Number(counts.pendingPositivePaper||0)});
c('Paper stake authority false',report.authority?.paperStakeAuthority===false);
c('Paper stake preserved',report.authority?.paperStakePreserved===true);
c('No stake increase',report.authority?.canIncreaseStake===false);
c('Patch55 non bypassabile',report.authority?.canBypassPatch55===false);
c('Patch56 non auto-attiva production',report.authority?.canSelfActivateProduction===false);
c('Cap totale 5%',mod.LIMITS.totalExposurePct===5);
c('Cap sport 3%',mod.LIMITS.sportExposurePct===3);
c('Cap evento 1%',mod.LIMITS.eventExposurePct===1);
c('Cap singola 1%',mod.LIMITS.singleBetExposurePct===1);
c('Schema Patch56 presente',cols.has('cross_sport_portfolio_real_executable_stake')&&cols.has('cross_sport_portfolio_risk_status'));
c('Decision table disponibile',Number.isFinite(decisionRows),{decisionRows});
c('Scheduler Calcio disabilitato',cron.enabled===false);
c('Frontend marker Patch56',idx.includes('data-patch56-cross-sport-portfolio-risk="true"'));
c('Frontend current revision future-compatible Patch56',idx.includes('data-patch56-cross-sport-portfolio-risk="true"')&&(idx.includes('app.js?v=patch56-cross-sport-portfolio-risk-authority')||idx.includes('app.js?v=patch57-production-security-safe-release')||idx.includes('app.js?v=patch58-scheduler-reliability-state-machine')||idx.includes('data-patch59-controlled-canary="true"')));
c('Frontend mirror',idx===bidx);
c('SQLite integrity',String(integrity).toLowerCase()==='ok',{integrity});
c('Foreign key violations zero',fk.length===0,{count:fk.length});
c('Database byte-identico durante audit read-only',before===after,{before,after});
c('Dataset non vuoto',Number(counts.total||0)>0&&Number(counts.tennis||0)>0&&Number(counts.calcio||0)>0,counts);
const failed=details.filter(x=>!x.ok&&x.severity==='error');console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_56_UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY',revision:'R1_WINDOWS_NODE_FAIL_CLOSED_REAL_MONEY_PORTFOLIO',checks:details.length,errors:failed.length,warnings:0,details,portfolioRisk:report,database:{integrity,foreignKeyViolations:fk.length,total:Number(counts.total||0),tennis:Number(counts.tennis||0),calcio:Number(counts.calcio||0),pendingPositivePaper:Number(counts.pendingPositivePaper||0),realMoneyPendingExposure:realExposure,sha256:after}},null,2));process.exit(failed.length?1:0);
