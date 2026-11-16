#!/usr/bin/env node
'use strict';
const path=require('path');const {createRequire}=require('module');
function root(){const i=process.argv.indexOf('--root');return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');}
const projectRoot=root();const mod=require(path.join(projectRoot,'backend','clvCrossSportCoveragePatch53.js'));const details=[];const check=(name,ok,extra=null)=>{details.push({name,ok:Boolean(ok),details:extra});if(!ok)throw new Error(name)};
function openDb(file){try{const req=createRequire(path.join(projectRoot,'package.json'));const B=req('better-sqlite3');return new B(file,{readonly:true});}catch(_){const {DatabaseSync}=require('node:sqlite');return new DatabaseSync(file,{readOnly:true});}}
try{
 const rows=[
  {id:1,sport_type:'CALCIO',league:'Serie A',status:'PENDING',bet_type:'SINGLE',clv_verified:0,stake:0},
  {id:2,sport_type:'CALCIO',league:'Premier',status:'WON',bet_type:'SINGLE',clv_verified:1,closing_odd:1.8,clv_edge:2.1,clv_source:'LIVE_API',stake:10},
  {id:3,sport_type:'TENNIS',league:'[ATP] Masters 1000',tournament_name:'Canada Masters (Toronto/Montreal)',status:'LOST',bet_type:'TENNIS_ATP_MONEYLINE',clv_verified:0,clv:1.9,clv_source:'STALE_VAULT_SNAPSHOT',stake:5},
  {id:4,sport_type:'TENNIS',league:'[ATP] Grand Slam',status:'WON',bet_type:'TENNIS_ATP_MONEYLINE',clv_verified:0,clv_retry_eligible:1,stake:5},
  {id:5,sport_type:'CALCIO',league:'Serie B',status:'VOID',bet_type:'SINGLE',clv_verified:1,closing_odd:2.0},
  {id:6,sport_type:'CALCIO',league:'Serie A',status:'WON',bet_type:'MULTI',clv_verified:1,closing_odd:2.0}
 ];
 const report=mod.buildCoverageReportFromRows(rows,mod.DEFAULT_FOOTBALL_LEAGUES);
 check('Denominatore esclude VOID e MULTI',report.overall.eligibleRows===4,report.overall);
 check('Verified separato',report.overall.verifiedClvRows===1,report.overall);
 check('Unverified disponibile separato',report.overall.availableUnverifiedRows===1,report.overall);
 check('Missing separato',report.overall.missingEvidenceRows===2,report.overall);
 check('Calcio routing completo fixture',report.bySport.CALCIO.sportKeyResolvedRows===2&&report.bySport.CALCIO.sportKeyUnresolvedRows===0,report.bySport.CALCIO);
 check('Tennis generico non inventato',report.bySport.TENNIS.sportKeyUnresolvedRows===1,report.bySport.TENNIS);
 check('Nessuna closing sintetica',report.invariants.noSyntheticClosingOdds===true&&report.invariants.noProbabilityAuthority===true,report.invariants);
 const db=openDb(path.join(projectRoot,'backend','database_betting.db'));
 try{
  const actual=mod.buildCoverageReport(db,mod.DEFAULT_FOOTBALL_LEAGUES);
  check('Database con campione CLV',actual.overall.eligibleRows>0,actual.overall);
  check('Calcio corrente sport-key 100%',actual.bySport.CALCIO.eligibleRows>0&&actual.bySport.CALCIO.sportKeyUnresolvedRows===0,actual.bySport.CALCIO);
  check('Calcio CLV osservata senza requisiti artificiali',actual.bySport.CALCIO.verifiedClvRows>=0&&actual.bySport.CALCIO.availableUnverifiedRows>=0&&(actual.bySport.CALCIO.verifiedClvRows+actual.bySport.CALCIO.availableUnverifiedRows)<=actual.bySport.CALCIO.eligibleRows,actual.bySport.CALCIO);
  check('Tennis CLV verificata presente',actual.bySport.TENNIS.verifiedClvRows>0,actual.bySport.TENNIS);
 }finally{try{db.close()}catch(_){}}
 console.log(JSON.stringify({success:true,checks:details.length,details},null,2));
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message,details},null,2));process.exit(1);}
