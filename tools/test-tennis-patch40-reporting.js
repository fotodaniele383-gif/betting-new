'use strict';
const assert=require('assert');
const r=require('../backend/tennisTradingReportingPatch40');
const base={sport_type:'TENNIS',bet_type:'SINGLE_TENNIS_CR',strategy_tag:'TENNIS_ATP_MONEYLINE',data_quality:'CURRENT_BOOTSTRAP',paper_result_active:1,paper_result_conflict:0};
const rows=[
 {...base,id:1,status:'WON',stake:2,profit:2,odd:2,estimated_prob:70,ds_action:'🟠 RISCHIO MODELLO',quality_final_label:'WATCHLIST MICRO',clv_verified:1,closing_line_available:1,closing_odd:1.8,clv_edge:10},
 {...base,id:2,status:'LOST',stake:2,profit:-2,odd:1.8,estimated_prob:70,ds_action:'RISCHIO_MODELLO',quality_final_label:'WATCHLIST MICRO',clv_verified:0,closing_line_available:0,closing_odd:null,clv_edge:null},
 {...base,id:3,status:'WON',stake:0,profit:0,odd:2.5,estimated_prob:60,ds_action:'VALUE_CONFIRMED',quality_final_label:'BLOCCATA SOFT',clv_verified:1,closing_line_available:1,closing_odd:2.2,clv_edge:4},
 {...base,id:4,status:'PENDING',stake:0,profit:0,odd:1.6,estimated_prob:80,ds_action:'EDGE TECNICO'},
 {...base,id:5,status:'WON',stake:2,profit:1.2,odd:1.6,estimated_prob:80,paper_result_active:0,ds_action:'EDGE TECNICO'},
 {...base,id:6,status:'WON',stake:2,profit:1.2,odd:1.6,estimated_prob:80,paper_result_conflict:1,ds_action:'EDGE TECNICO'}
];
const report=r.buildReporting(rows,{rollingLimit:2,generatedAt:'2026-08-04T00:00:00Z'});
let checks=0;const eq=(a,b)=>{assert.deepStrictEqual(a,b);checks++};
eq(report.full.rowCount,4);
eq(report.full.signal.placed,3);
eq(report.full.operational.placed,2);
eq(report.full.paperAudit.rows,1);
eq(report.full.operational.stake,4);
eq(report.full.operational.profit,0);
eq(report.full.operational.roiPct,0);
eq(report.full.clv.eligible,3);
eq(report.full.clv.verified,2);
eq(report.full.clv.missing,1);
eq(report.full.clv.beaten,2);
eq(report.full.clv.coveragePct,66.67);
eq(report.full.clv.beatenPct,100);
eq(report.rolling.rowCount,2);
eq(report.full.deepScan.find(x=>x.category==='RISCHIO MODELLO').signalPlaced,2);
eq(report.full.theoreticalFlat.placed,3);
assert.ok(report.full.calibrationBands.some(x=>x.code==='65_75'&&x.sample===2));checks++;
assert.equal(r.strictNumber(null),null);checks++;
console.log(JSON.stringify({success:true,checks,version:r.VERSION,full:report.full,rolling:report.rolling}));
