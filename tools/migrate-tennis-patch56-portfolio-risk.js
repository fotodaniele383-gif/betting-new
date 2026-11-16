#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const dbPath=path.join(root,'backend','database_betting.db');const mod=require(path.join(root,'backend','unifiedCrossSportPortfolioRiskAuthorityPatch56'));
function stable(v){if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;return JSON.stringify(v);}
function fingerprint(db){const rows=db.prepare(`SELECT id,status,profit,stake,estimated_prob,odd,clv,clv_edge,closing_odd,clv_verified,settlement_contract_status,settlement_contract_reason,settlement_source,settlement_score FROM ai_forward_test ORDER BY id`).all();return crypto.createHash('sha256').update(stable(rows)).digest('hex');}
const db=new DatabaseSync(dbPath);let result;
try{
  const before=fingerprint(db);const countBefore=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
  const first=mod.ensureSchema(db);const second=mod.ensureSchema(db);
  const after=fingerprint(db);const countAfter=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();
  const real=Number(db.prepare('SELECT COALESCE(SUM(cross_sport_portfolio_real_executable_stake),0) n FROM ai_forward_test').get().n||0);
  const decisionRows=Number(db.prepare(`SELECT COUNT(*) n FROM ${mod.DECISION_TABLE}`).get().n||0);
  result={success:before===after&&countBefore===countAfter&&String(integrity).toLowerCase()==='ok'&&fk.length===0&&second.addedColumns.length===0,
    patch:'TENNIS_PATCH_56_UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY',version:mod.VERSION,firstPass:first,secondPass:second,
    businessValuesUnchanged:before===after,rowCountsUnchanged:countBefore===countAfter,rows:countAfter,realMoneyExposureAfterMigration:real,decisionRows,
    database:{integrity,foreignKeyViolations:fk.length,businessFingerprintBefore:before,businessFingerprintAfter:after}};
}finally{db.close();}
console.log(JSON.stringify(result,null,2));process.exit(result.success?0:1);
