#!/usr/bin/env node
'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const assert=require('assert');
const mod=require('../backend/tennisExternalMatchIntelligencePatch37');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'patch37-h2h-'));
const headers='tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round,minutes,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced,winner_rank,winner_rank_points,loser_rank,loser_rank_points'.split(',');
function row(date,surface,winner,loser,score,round){const a=Array(headers.length).fill('');const set=(k,v)=>a[headers.indexOf(k)]=v;set('tourney_id','x');set('tourney_name','Test Open');set('surface',surface);set('tourney_date',date);set('winner_name',winner);set('loser_name',loser);set('score',score);set('round',round);return a.join(',');}
const rows=[row('20260101','Hard','Alpha Player','Beta Player','6-3 6-4','R1'),row('20260201','Hard','Alpha Player','Beta Player','6-4 6-4','R2'),row('20260301','Clay','Beta Player','Alpha Player','6-2 6-2','QF'),row('20270101','Hard','Beta Player','Alpha Player','6-0 6-0','F')];
fs.writeFileSync(path.join(dir,'atp_matches_2026.csv'),[headers.join(','),...rows].join('\n'));
const h=mod.buildH2H('Alpha Player','Beta Player',{tour:'ATP',surface:'Hard',asOf:'2026-08-03T00:00:00Z',dataDir:dir});
assert.equal(h.status,'VERIFIED_LOCAL_STRUCTURED');assert.equal(h.overall.matches,3);assert.equal(h.overall.p1Wins,2);assert.equal(h.onSurface.matches,2);
const d=mod.h2hAdjustment(h,'1');assert(d.adjustmentPp<=2.5&&d.adjustmentPp>=-2.5);assert.equal(d.status,'BAYES_SHRUNK_BOUNDED');
const one={...h,overall:{matches:1,p1Wins:1,p2Wins:0}};assert.equal(mod.h2hAdjustment(one,'1').adjustmentPp,0);
const no=mod.buildH2H('Nobody','Missing',{tour:'ATP',surface:'Hard',asOf:'2026-08-03',dataDir:dir});assert.equal(no.status,'NO_MEETINGS');
console.log(JSON.stringify({success:true,checks:10,h2h:h.overall,onSurface:h.onSurface,decision:d},null,2));
