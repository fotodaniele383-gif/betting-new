#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
const dbPath=path.join(ROOT,'backend','database_betting.db');const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');const before=sha();
const db=new DatabaseSync(dbPath,{readOnly:true});
function has(c){return db.prepare("PRAGMA table_info(ai_forward_test)").all().some(x=>x.name===c);}
const required=['opening_odd','clv_opening_ts','clv_bookmaker','clv_source_event_id','clv_event_fingerprint','clv_market_fingerprint','clv_sport_key_resolved','clv_verified','closing_odd'];const missing=required.filter(c=>!has(c));
let metrics={};if(!missing.length){metrics=db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN opening_odd>1 THEN 1 ELSE 0 END) openingOdd, SUM(CASE WHEN clv_opening_ts IS NOT NULL THEN 1 ELSE 0 END) openingTs, SUM(CASE WHEN TRIM(COALESCE(clv_bookmaker,''))<>'' THEN 1 ELSE 0 END) bookmaker, SUM(CASE WHEN TRIM(COALESCE(clv_source_event_id,''))<>'' THEN 1 ELSE 0 END) sourceEventId, SUM(CASE WHEN TRIM(COALESCE(clv_event_fingerprint,''))<>'' THEN 1 ELSE 0 END) eventFingerprint, SUM(CASE WHEN TRIM(COALESCE(clv_market_fingerprint,''))<>'' THEN 1 ELSE 0 END) marketFingerprint, SUM(CASE WHEN TRIM(COALESCE(clv_sport_key_resolved,''))<>'' THEN 1 ELSE 0 END) sportKey, SUM(CASE WHEN clv_verified=1 THEN 1 ELSE 0 END) verified, SUM(CASE WHEN closing_odd>1 THEN 1 ELSE 0 END) closingOdd FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'`).get();}
let vault=null;try{vault=db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN TRIM(COALESCE(sport,''))<>'' THEN 1 ELSE 0 END) withSport, SUM(CASE WHEN TRIM(COALESCE(opening_odds,''))<>'' THEN 1 ELSE 0 END) withOpening FROM internal_odds_vault`).get();}catch(_){vault={total:0,withSport:0,withOpening:0};}db.close();const after=sha();
const out={success:missing.length===0&&before===after,patch:'AUDIT16C',readOnly:true,missingColumns:missing,calcio:metrics,vault,database:{before,after,unchanged:before===after}};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
