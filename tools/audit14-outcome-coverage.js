#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'); const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?(process.argv[process.argv.indexOf('--root')+1]||'.'):process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend','database_betting.db'); const m=require(path.join(root,'backend','certifiedTradingOutcomeCoverageAudit14')); const a13=require(path.join(root,'backend','certifiedTradingOutcomeSearchAudit13')); const tennis=require(path.join(root,'backend','tennisOfficialSettlementResolver'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); const before=sha(dbPath); const db=new DatabaseSync(dbPath,{readOnly:true});
const add=(o,k)=>o[k]=(o[k]||0)+1;
let output; try {
 const calcio=db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='CALCIO' ORDER BY id").all();
 const tr=db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id").all();
 const c={pending:calcio.length,recentProviderEligible:0,archiveEligible:0,certifiedNow:0,byStatus:{},byLeague:{},samples:[]};
 for(const r of calcio){const p=a13.buildSearchPlan(r,'CALCIO'); if(p.recentProviderEligible)c.recentProviderEligible++; if(!p.archiveRecoveryRequired)continue; c.archiveEligible++; const x=m.classifyFootballPending(r); add(c.byStatus,x.status); const code=x.code||'UNMAPPED'; c.byLeague[code] ||= {archiveEligible:0,certifiedNow:0,byStatus:{}}; c.byLeague[code].archiveEligible++; add(c.byLeague[code].byStatus,x.status); if(x.resolvable){c.certifiedNow++;c.byLeague[code].certifiedNow++; if(c.samples.length<20)c.samples.push({id:r.id,league:r.league,match:`${r.home_team} - ${r.away_team}`,status:x.status});}}
 const t={pending:tr.length,archiveEligible:0,officialMapped:0,cacheParseable:0,byTournament:{},samples:[]};
 for(const r of tr){const p=a13.buildSearchPlan(r,'TENNIS'); if(!p.archiveRecoveryRequired)continue;t.archiveEligible++;const meta=tennis.getOfficialProviderMetadata(r);const key=meta?.tournamentId||'UNMAPPED';add(t.byTournament,key);if(!meta)continue;t.officialMapped++;let cacheResult=false;const cached=tennis.readCachedPage(meta.url);if(cached){try{cacheResult=Boolean(tennis.parseOfficialResultText(cached.text,r,meta));}catch(_){}}if(cacheResult)t.cacheParseable++;if(t.samples.length<20)t.samples.push({id:r.id,match:`${r.home_team} - ${r.away_team}`,tournamentId:key,officialUrl:meta.url,cacheParseable:cacheResult});}
 output={success:true,patch:'AUDIT14',version:m.VERSION,readOnly:true,calcio:c,tennis:t,authority:{databaseMutation:false,settlementMutation:false,probabilityMutation:false,stakeMutation:false,automaticProductionActivation:false}};
} finally {db.close();}
const after=sha(dbPath); output.database={before,after,unchanged:before===after}; output.success=output.success&&before===after; console.log(JSON.stringify(output,null,2)); process.exit(output.success?0:1);
