#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'); const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?(process.argv[process.argv.indexOf('--root')+1]||'.'):process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend','database_betting.db'); const official=require(path.join(root,'backend','tennisOfficialSettlementResolver')); const a13=require(path.join(root,'backend','certifiedTradingOutcomeSearchAudit13'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); const before=sha(dbPath); const db=new DatabaseSync(dbPath,{readOnly:true});
(async()=>{let rows;try{rows=db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id").all();}finally{db.close();}
 const out={success:true,patch:'AUDIT14',readOnly:true,scanned:0,mapped:0,resolvedOfficial:0,unresolvedOfficial:0,networkErrors:0,details:[]};
 for(const r of rows){const plan=a13.buildSearchPlan(r,'TENNIS');if(!plan.archiveRecoveryRequired)continue;out.scanned++;const meta=official.getOfficialProviderMetadata(r);if(!meta){out.unresolvedOfficial++;out.details.push({id:r.id,status:'UNMAPPED'});continue;}out.mapped++;try{const res=await official.resolveOfficialSettlement(r,{allowNetwork:true,timeoutMs:10000});if(res&&res.providerCompleted===true){out.resolvedOfficial++;out.details.push({id:r.id,status:'OFFICIAL_RESULT_ACQUIRED',source:res.source,sourceEventId:res.sourceEventId||null,evidenceHash:res.evidenceHash||res.settlement_evidence_hash||null});}else{out.unresolvedOfficial++;out.details.push({id:r.id,status:'OFFICIAL_PAGE_NO_CERTIFIABLE_RESULT',officialUrl:meta.url});}}catch(e){out.networkErrors++;out.unresolvedOfficial++;out.details.push({id:r.id,status:'OFFICIAL_NETWORK_ERROR',error:e.message,officialUrl:meta.url});}}
 const after=sha(dbPath);out.database={before,after,unchanged:before===after};out.success=out.success&&before===after;console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
