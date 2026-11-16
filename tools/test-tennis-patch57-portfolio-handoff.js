#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));const dbp=path.join(root,'backend','database_betting.db');const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(dbp)).digest('hex');const before=sha();const db=new DatabaseSync(dbp,{readOnly:true});const p56=require(path.join(root,'backend','unifiedCrossSportPortfolioRiskAuthorityPatch56'));const sec=require(path.join(root,'backend','productionSecuritySafeReleasePatch57'));let h,integrity,fk,real;try{h=p56.health(db,{projectRoot:root});integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];fk=db.prepare('PRAGMA foreign_key_check').all();real=Number(db.prepare("SELECT COALESCE(SUM(cross_sport_portfolio_real_executable_stake),0) n FROM ai_forward_test WHERE UPPER(COALESCE(status,'PENDING'))='PENDING'").get().n||0)}finally{db.close()}const after=sha();const checks=[];const c=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
c('Patch57 runtime security ready',sec.portfolioSecurityReady({env:{}})===true);
c('Patch56 consumes Patch57',h.downstream?.patch57SecurityReady===true,h.downstream);
c('Patch58 remains required',h.downstream?.patch58SchedulerStateMachineReady===false);
c('Patch59 remains required',h.downstream?.patch59ControlledCanaryAuthorized===false);
c('All downstream not ready',h.downstream?.allRequired===false);
c('Real money remains blocked',h.status==='REAL_MONEY_EXPOSURE_BLOCKED');
c('Tennis real stake zero',h.sportAuthority?.TENNIS?.realExecutableStake===0);
c('Calcio real stake zero',h.sportAuthority?.CALCIO?.realExecutableStake===0);
c('Persisted real exposure zero',real===0,{real});
c('Database integrity',String(integrity).toLowerCase()==='ok'&&fk.length===0,{integrity,fk:fk.length});
c('Read-only test leaves DB byte-identical',before===after,{before,after});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'57',suite:'PORTFOLIO_HANDOFF',checks:checks.length,details:checks,portfolio:h},null,2));process.exit(failed.length?1:0);
