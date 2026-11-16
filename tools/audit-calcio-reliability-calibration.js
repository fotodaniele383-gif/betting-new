'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const calibration = require('../backend/calcioReliabilityCalibration');
const root = path.resolve(__dirname, '..');
const db = new DatabaseSync(path.join(root, 'backend', 'database_betting.db'), { readOnly:true });
const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS') AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%'`).all().filter(row => {
  const text = [row.sport_type,row.bet_type,row.strategy_tag,row.league].map(v=>String(v||'').toUpperCase()).join(' ');
  return text.includes('CALCIO') || text.includes('SERIE_') || text.includes('PREMIER') || text.includes('BUNDESLIGA') || text.includes('LA_LIGA') || text.includes('LIGUE_1');
});
const report = calibration.buildReliabilityCalibration(rows);
db.close();
console.log(JSON.stringify({ success:true, readOnly:true, patch:'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2', report, safeguards:{ reliabilityIsNotWinProbability:true, noStakeAuthority:true, noProbabilityMutation:true } }, null, 2));
