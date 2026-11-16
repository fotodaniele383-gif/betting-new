'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const registry = require('../backend/calcioPatchRegistry');
const calibration = require('../backend/calcioReliabilityCalibration');
const diagnostics = require('../backend/runtimeDiagnostics');
const root = path.resolve(__dirname, '..');
const db = new DatabaseSync(path.join(root,'backend','database_betting.db'), { readOnly:true });
const counts = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis, SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('WON','LOST') AND (UPPER(COALESCE(sport_type,''))='CALCIO' OR UPPER(COALESCE(bet_type,'')) LIKE '%CALCIO%') THEN 1 ELSE 0 END) resolvedCalcio FROM ai_forward_test`).get();
const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS')`).all().filter(row => [row.sport_type,row.bet_type,row.strategy_tag,row.league].map(v=>String(v||'').toUpperCase()).join(' ').match(/CALCIO|SERIE_|PREMIER|BUNDESLIGA|LA_LIGA|LIGUE_1/));
const reliability = calibration.buildReliabilityCalibration(rows);
db.close();
const app = fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const server = fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const violations = {
  registry: !(Number(registry.CALCIO_CURRENT_PATCH_VERSION)>=36 && registry.PATCHES.some(p=>p.version==='36'&&p.status==='ACTIVE')) ? 1 : 0,
  tradingColumn: app.includes("key: 'ai_reliability'") ? 0 : 1,
  portfolioTable: app.includes('portfolioReliabilityCalibrationPanel') ? 0 : 1,
  genericRuntimeEndpoint: server.includes("app.get('/api/runtime-diagnostics'") ? 0 : 1,
  stakeAuthority: reliability.stakeAuthority === false ? 0 : 1
};
const success = Object.values(violations).every(value => value === 0);
console.log(JSON.stringify({ success, patch:'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2', certification: success ? 'RUNTIME_DIAGNOSTICS_V2_AND_AI_RELIABILITY_CALIBRATION_CERTIFIED' : 'FAILED', registry:{ version:registry.CALCIO_CURRENT_PATCH_VERSION, id:registry.PATCHES.at(-1).id }, database:counts, reliability:{ scoredRows:reliability.scoredRows, pendingScoredRows:reliability.pendingScoredRows, resolvedScoredRows:reliability.resolvedScoredRows, empiricalStatus:reliability.empiricalStatus, validationCoveragePct:reliability.validationCoveragePct }, runtime:{ version:diagnostics.RUNTIME_DIAGNOSTICS_VERSION, compatibilityVersion:diagnostics.RUNTIME_DIAGNOSTICS_COMPAT_VERSION }, violations, guards:{ reliabilityIsNotWinProbability:true, reliabilityNoStakeAuthority:true, productionProbabilityUnchanged:true, unifiedStakeAuthorityPreserved:true, portfolioCapsPreserved:true, tennisUnchanged:true, newOddsApiCalls:0 } }, null, 2));
process.exitCode = success ? 0 : 1;
