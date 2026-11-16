#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const rootArgIndex=process.argv.indexOf('--root');
const root=rootArgIndex>=0&&process.argv[rootArgIndex+1]?path.resolve(process.argv[rootArgIndex+1]):path.resolve(__dirname,'..');
const M=require(path.join(root,'backend','adaptiveLearningShadowAudit16d.js'));
const dbPath=path.join(root,'backend','database_betting.db');const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');const before=hash();
const db=new DatabaseSync(dbPath,{readOnly:true});const names=db.prepare('PRAGMA table_info(ai_forward_test)').all().map(x=>x.name);const omit=new Set(['calcio_market_selection_audit','calcio_market_finalization_audit','calcio_deepscan_final_report_json']);const cols=names.filter(x=>!omit.has(x)).map(x=>'"'+x.replace(/"/g,'""')+'"').join(',');const rows=db.prepare(`SELECT ${cols} FROM ai_forward_test WHERE UPPER(sport_type) IN ('CALCIO','TENNIS')`).all();db.close();
const now=Date.now();const state=M.advance(rows,M.fresh(),now);const anchors=Object.values(state.anchors).map(x=>x.payload);const bySport={};
for(const sport of ['CALCIO','TENNIS']){const xs=anchors.filter(x=>x.identity.sport===sport);const p={};for(const pr of M.PROFILES)p[pr.id]={accepted:xs.filter(x=>x.profiles[pr.id].accepted).length,total:xs.length};bySport[sport]={prospectiveAnchors:xs.length,studio:xs.filter(x=>x.identity.scope==='STUDIO').length,trading:xs.filter(x=>x.identity.scope==='TRADING').length,avgAnalysisQuality:xs.length?Number((xs.reduce((s,x)=>s+x.features.analysisQuality,0)/xs.length).toFixed(4)):null,avgDeepScanQuality:xs.length?Number((xs.reduce((s,x)=>s+x.features.deepScanQuality,0)/xs.length).toFixed(4)):null,profiles:p};}
const stateFile=path.join(root,'backend','audit16d-runtime','adaptive-shadow-state.json');let runtime=null;try{const d=JSON.parse(fs.readFileSync(stateFile,'utf8'));runtime={exists:true,version:d.version,updatedAt:d.updatedAt,anchorCount:d.anchorCount,resolvedForward:d.resolvedForward,segments:d.segments,authority:d.authority};}catch(_){runtime={exists:false};}
const after=hash();const out={success:before===after,patch:'AUDIT16D',version:M.VERSION,readOnly:true,policy:M.POLICY,prospectiveCaptureNow:bySport,runtime,database:{before,after,unchanged:before===after},authority:M.AUTHORITY};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
