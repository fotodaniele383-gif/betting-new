'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const index = require('../backend/tennisUnifiedPredictionIndex');
const root = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail = null) { results.push({ name, ok: Boolean(ok), ...(detail === null ? {} : { detail }) }); if (!ok) throw new Error(name + (detail ? `: ${detail}` : '')); }

const riskFixture = {
  quality_final_code: 'WATCHLIST_MICRO', quality_final_label: 'WATCHLIST MICRO', quality_final_score: 65,
  model_confidence_score: 57.93, data_sufficiency_score: 14,
  edge_pp: 6.73, ev_pct: 8.68, ds_action: '🟠 RISCHIO MODELLO',
  historical_combo_adjusted_rate_pct: 63.25, historical_combo_resolved: 42, historical_combo_reliability: 'HIGH', stake: 2
};
const risk = index.calculateTennisPredictionIndex(riskFixture, { phase: 'POST_DEEPSCAN_FINAL' });
check('Tennis index version is current', risk.version === index.TENNIS_UNIFIED_PREDICTION_INDEX_VERSION);
check('Tennis index is finite', Number.isFinite(risk.score), risk.score);
check('Risk-model micro fixture lands in MICRO band', risk.label === 'MICRO', `${risk.score} ${risk.label}`);
check('Tennis index never has stake authority', risk.stakeAuthority === false && risk.eligible === false && risk.authority === 'DISPLAY_ONLY_NO_STAKE_AUTHORITY');
check('Operational stake is observed but not authorized', risk.operationalStake === 2 && risk.displayOnly === true);
check('All six components available on final fixture', Object.values(risk.components).every(c => c.available === true));
check('Weights normalize to one', Math.abs(Object.values(risk.components).reduce((s,c)=>s+c.effectiveWeight,0)-1) < 0.001);

const technical = index.calculateTennisPredictionIndex({ ...riskFixture, quality_final_score: 52, model_confidence_score: 66.89, data_sufficiency_score: 24, edge_pp: 12.57, ev_pct: 20.99, ds_action: '📊 EDGE TECNICO', historical_combo_adjusted_rate_pct: 58.52, historical_combo_resolved: 166 }, { phase: 'POST_DEEPSCAN_FINAL' });
check('Technical-edge fixture has a populated index', Number.isFinite(technical.score));
check('Technical-edge fixture is not N/D', technical.label !== 'N/D');
check('Value score is capped safely', technical.components.value.score <= 100 && technical.components.value.score >= 0);

const noPt = index.calculateTennisPredictionIndex({ ...riskFixture, historical_combo_adjusted_rate_pct: null, historical_combo_resolved: 0 }, { phase: 'POST_DEEPSCAN_FINAL' });
check('PT n=0 is unavailable, not neutral 50', noPt.components.paperTrading.available === false && noPt.components.paperTrading.effectiveWeight === 0);
check('Missing PT renormalizes active weights', Math.abs(Object.values(noPt.components).reduce((s,c)=>s+c.effectiveWeight,0)-1) < 0.001);

const missing = index.calculateTennisPredictionIndex({ edge_pp: 5, ev_pct: 7 }, { phase: 'PRE_DEEPSCAN_PROVISIONAL' });
check('Partial input remains explicitly provisional', missing.phase === 'PRE_DEEPSCAN_PROVISIONAL');
check('Missing data is listed instead of invented', missing.missingComponents.includes('qualityGate') && missing.missingComponents.includes('paperTrading'));

const highRisk = index.calculateTennisPredictionIndex({ ...riskFixture, ds_action: '🔴 ALTO RISCHIO', quality_final_score: 30 }, { phase: 'POST_DEEPSCAN_FINAL' });
check('High risk lowers the diagnostic index', highRisk.score < risk.score, `${highRisk.score} !< ${risk.score}`);

const db = new Database(path.join(root, 'backend', 'database_betting.db'), { readonly: true });
const rows = db.prepare(`SELECT id, home_team, away_team, estimated_prob, edge_pp, ev_pct, model_confidence_score,
 data_sufficiency_score, quality_final_code, quality_final_label, quality_final_score,
 quality_base_code, quality_base_label, quality_base_score, historical_combo_adjusted_rate_pct,
 historical_combo_resolved, historical_combo_reliability, ds_action, stake
 FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'
 AND edge_pp IS NOT NULL AND ev_pct IS NOT NULL ORDER BY id DESC LIMIT 50`).all();
check('Live Tennis rows are available', rows.length >= 10, rows.length);
const live = rows.map(row => ({ row, index: index.calculateTennisPredictionIndex(row, { phase: row.ds_action ? 'POST_DEEPSCAN_FINAL' : 'PRE_DEEPSCAN_PROVISIONAL' }) }));
check('Every recent Tennis row has a display index', live.every(x => Number.isFinite(x.index.score)), live.filter(x=>!Number.isFinite(x.index.score)).map(x=>x.row.id));
check('No live Tennis index acquires stake authority', live.every(x => x.index.stakeAuthority === false && x.index.eligible === false));
check('Live index scores stay in 0-100', live.every(x => x.index.score >= 0 && x.index.score <= 100));

console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_26F_E_UNIFIED_ANALYSIS_TABLE_SPORT_PARITY', checks:results.length, fixture:{ riskModelScore:risk.score, riskModelLabel:risk.label, technicalScore:technical.score, technicalLabel:technical.label, noPtScore:noPt.score }, liveRows:rows.length, liveIndexMin:Math.min(...live.map(x=>x.index.score)), liveIndexMax:Math.max(...live.map(x=>x.index.score)), results }, null, 2));
