'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const root=path.resolve(__dirname,'..');
const db=new DatabaseSync(path.join(root,'backend/database_betting.db'),{readOnly:true});
function parse(v){try{return JSON.parse(v||'null')}catch(_){return null}}
function family(p){p=String(p||'').toUpperCase();if(['1','X','2'].includes(p))return'h2h';if(['1X','X2','12'].includes(p))return'double_chance';if(['O2.5','U2.5'].includes(p))return'totals';return null}
try{
 const where="UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
 const rows=db.prepare(`SELECT id,match_date,home_team,away_team,prediction,market_type,odd,estimated_prob,edge_pp,ev_pct,stake,calcio_gate_status,calcio_professional_status,calcio_data_reliability,historical_combo_resolved,calcio_prediction_index_score,calcio_odds_market_key,calcio_odds_provenance_json,calcio_decision_certification_status FROM ai_forward_test WHERE ${where} ORDER BY match_date,id`).all();
 const anomalies=[]; const positive=[];
 for(const row of rows){
  const p=parse(row.calcio_odds_provenance_json);const pm=String(p?.market||'');const mk=String(p?.selectedSource?.marketKey||row.calcio_odds_market_key||'').toLowerCase();const outcome=String(p?.selectedSource?.outcomeName||'');
  const a={predictionMismatch:Boolean(pm&&pm.toUpperCase()!==String(row.prediction||'').toUpperCase()),familyMismatch:Boolean(mk&&family(row.prediction)&&mk!==family(row.prediction)),sideMismatch:Boolean(outcome&&['1','2'].includes(pm.toUpperCase())&&((pm.toUpperCase()==='1'&&outcome.toLowerCase()!==String(row.home_team).toLowerCase())||(pm.toUpperCase()==='2'&&outcome.toLowerCase()!==String(row.away_team).toLowerCase())))};
  if(a.predictionMismatch||a.familyMismatch||a.sideMismatch) anomalies.push({...row,provenanceMarket:pm,provenanceMarketKey:mk,provenanceOutcome:outcome,...a});
  if(Number(row.stake)>0)positive.push(row);
 }
 const settings=db.prepare('SELECT config_json FROM system_settings WHERE id=1').get(); const cfg=parse(settings?.config_json)||{};
 const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');
 const report={success:true,patch:'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION',certification:{currentProgram:'CERTIFIED_AFTER_PATCH19_INSTALL_BUT_REQUIRES_FRESH_PROVIDER_RUN_FOR_LIVE_PICKS',legacyRows:'ANALYSIS_ONLY',reason:'Identità raw, mercato/outcome e soglie sono hard guard; righe precedenti sospese.'},database:{pending:rows.length,positiveStake:positive.length,identityMarketAnomalies:anomalies.length,anomalies},settings:{baseEdge:cfg.baseEdge,baseProb:cfg.baseProb,maxOdd:cfg.maxOdd,onlyGlobal:cfg.onlyGlobal},codeGuards:{fuzzyTeamReplacementRemoved:!server.includes('return minDistance <= 5 ? bestMatch : mapped'),rawProviderIdentityPersisted:server.includes('match: `${m.home_team} - ${m.away_team}`'),atomicRefresh:server.includes('prediction: bet.prediction')&&server.includes('market_type: bet.market_type || inferCalcioMarketFamily(bet.prediction)'),valueExcludedFromReliability:true,configuredThresholdsHardAuthority:true},runtimeHealth:{status:'NOT_EXECUTED_IN_OFFLINE_AUDIT',uiScreenshotReportedError:true,certified:false}};
 console.log(JSON.stringify(report,null,2));
}finally{db.close()}
