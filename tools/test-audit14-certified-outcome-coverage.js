#!/usr/bin/env node
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const root = path.resolve(process.argv.includes('--root') ? (process.argv[process.argv.indexOf('--root')+1]||'.') : path.join(__dirname,'..'));
const mod = require(path.join(root,'backend','certifiedTradingOutcomeCoverageAudit14'));
const provider = require(path.join(root,'backend','calcioFootballDataProvider'));
const dbPath = path.join(root,'backend','database_betting.db');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); const before = fs.existsSync(dbPath)?sha(dbPath):null;
let checks=0; const failures=[]; function ok(name, cond, value=null){checks++; if(!cond) failures.push({name,value});}
(async()=>{
  ok('version', mod.VERSION==='AUDIT14_CERTIFIED_OUTCOME_COVERAGE_RECOVERY_V1');
  ok('explicit alias Tottenham', mod.canonicalTeam('Tottenham Hotspur')===mod.canonicalTeam('Tottenham'));
  ok('explicit alias Espanyol', mod.canonicalTeam('Espanyol')===mod.canonicalTeam('Espanol'));
  ok('explicit alias Roma', mod.canonicalTeam('AS Roma')===mod.canonicalTeam('Roma'));
  const csv='Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n23/08/2026,Tottenham,Brighton,2,1,H\n';
  const snap={valid:true,csvData:csv,metadata:{fetchedAt:'2026-08-24T00:00:00Z',url:'fixture'},inspection:{sha256:'a'.repeat(64),latestMatchAt:'2026-08-23T00:00:00Z'}};
  const row={league:'Premier League',home_team:'Tottenham Hotspur',away_team:'Brighton and Hove Albion',match_date:'23/08/2026, 15:00',prediction:'1',odd:2};
  const classified=mod._private.classifySnapshot(row,snap,{now:new Date('2026-09-01T00:00:00Z')});
  ok('same date explicit aliases resolve',classified.resolvable===true && classified.status==='CERTIFIED_CANONICAL_MATCH',classified);
  const resolved=await mod.resolveFootballCertified(row,{now:new Date('2026-09-01T00:00:00Z'),readLocalLeagueSnapshot:()=>snap});
  ok('resolution has certified evidence',resolved.resolution?.evidenceHash?.length===64 && resolved.resolution?.sourceTier==='CERTIFIED_ARCHIVE',resolved);
  const swapped={...row,home_team:'Brighton and Hove Albion',away_team:'Tottenham Hotspur'};
  const sw=mod._private.classifySnapshot(swapped,snap,{now:new Date('2026-09-01T00:00:00Z')});
  ok('home away swapped fails closed',sw.status==='IDENTITY_CONFLICT_HOME_AWAY_SWAPPED' && sw.resolvable===false,sw);
  const missSnap={valid:true,csvData:'Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n22/08/2026,Arsenal,Chelsea,1,0,H\n',metadata:{fetchedAt:'2026-08-23T00:00:00Z'},inspection:{latestMatchAt:'2026-08-22T00:00:00Z'}};
  const newSnap={valid:true,csvData:'Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n23/08/2026,Tottenham,Brighton,2,1,H\n',metadata:{fetchedAt:'2026-08-24T00:00:00Z'},inspection:{sha256:'b'.repeat(64),latestMatchAt:'2026-08-23T00:00:00Z'}};
  let reads=0,refreshes=0;
  const rr=await mod.resolveFootballCertified(row,{allowNetworkRefresh:true,now:new Date('2026-09-01T00:00:00Z'),readLocalLeagueSnapshot:()=> (++reads<=2?missSnap:newSnap),getLeagueCsv:async()=>{refreshes++;return {success:true};}});
  ok('missing date triggers one controlled refresh',refreshes===1 && rr.resolution?.homeGoals===2 && rr.trace?.refreshed===true,{refreshes,rr});
  const noFuzzy=mod._private.classifySnapshot({...row,home_team:'Torino',away_team:'Juventus'}, {valid:true,csvData:'Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n23/08/2026,Frosinone,Juventus,0,2,A\n',metadata:{},inspection:{}},{now:new Date('2026-09-01T00:00:00Z')});
  ok('generic fuzzy is not accepted',noFuzzy.status==='TEAM_IDENTITY_MISMATCH' && !noFuzzy.resolvable,noFuzzy);
  ok('provider exports refresh API',typeof provider.getLeagueCsv==='function');
  const paper=fs.readFileSync(path.join(root,'backend','paperTrading.js'),'utf8');
  ok('paper trading uses AUDIT14 async resolver',paper.includes('resolveFootballCertified(bet, { allowNetworkRefresh: true })'));
  ok('pending reason is reason-specific',paper.includes('PENDING_AUDIT14_${audit14Reason}'));
  const after=fs.existsSync(dbPath)?sha(dbPath):null; ok('DB read-only during test',before===after,{before,after});
  console.log(JSON.stringify({success:failures.length===0,patch:'AUDIT14',checks,failures,version:mod.VERSION},null,2));
  process.exit(failures.length?1:0);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
