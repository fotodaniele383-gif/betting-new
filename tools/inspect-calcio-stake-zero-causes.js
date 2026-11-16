'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const audit = require('../backend/calcioStakePortfolioAudit');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new DatabaseSync(path.join(root, 'backend', 'database_betting.db'), { readOnly:true });
const rows = db.prepare(`
 SELECT * FROM ai_forward_test
 WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='CALCIO'
   AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0
   AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
 ORDER BY match_date, home_team, away_team
`).all();
db.close();
const diagnostics = audit.buildStakeDiagnostics(rows);
const details = rows.map(row => ({
 id:row.id, date:row.match_date, match:`${row.home_team} - ${row.away_team}`, prediction:row.prediction,
 deepScan:audit.normalizeDeepScan(row), qualityGate:audit.normalizeQualityGate(row),
 theoreticalStake:audit.theoreticalStake(row), operationalStake:audit.operationalStake(row),
 cause:audit.classifyStakeCause(row), timing:row.calcio_timing_status || '',
 reliabilityScore:row.calcio_prediction_reliability_score, stageReason:row.calcio_analysis_stage_reason || '', lifecycleReason:row.calcio_stake_lifecycle_reason || ''
}));
console.log(JSON.stringify({ success:true, version:audit.CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION, diagnostics, details }, null, 2));
