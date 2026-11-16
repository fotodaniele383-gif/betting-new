#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const dbPath=path.join(ROOT,'backend','database_betting.db');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=sha(dbPath);let db;
try{
  db=new DatabaseSync(dbPath,{readOnly:true});
  const audit=require(path.join(ROOT,'backend','calcioSettlementDebtAudit16dR3'));
  const report=audit.buildReport(db,{staleHours:Number(process.env.AUDIT16D_R3_STALE_PENDING_HOURS||24)});
  const after=sha(dbPath);
  const out={...report,database:{before,after,unchanged:before===after}};
  console.log(JSON.stringify(out,null,2));process.exit(after===before?0:1);
}catch(e){const after=fs.existsSync(dbPath)?sha(dbPath):null;console.log(JSON.stringify({success:false,readOnly:true,error:e.message,database:{before,after,unchanged:before===after}},null,2));process.exit(1);}finally{try{db?.close()}catch(_){}}
