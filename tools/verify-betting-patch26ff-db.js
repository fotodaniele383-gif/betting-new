'use strict';
const fs=require('fs');const crypto=require('crypto');const path=require('path');const {DatabaseSync}=require('node:sqlite');const mod=require('../backend/aiOutcomeBandPerformance');const root=path.resolve(__dirname,'..');const dbPath=path.join(root,'backend/database_betting.db');const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');const before=sha();const db=new DatabaseSync(dbPath,{readOnly:true});
const rows=db.prepare(`SELECT id,status,sport_type,bet_type,strategy_tag,league,tournament_category,tournament_level,tournament_name,tour_type,estimated_prob,stake,data_quality,paper_result_active,paper_result_conflict FROM ai_forward_test WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST')`).all();
const calcio=mod.buildAiOutcomeBandPerformance(rows,{sport:'CALCIO'});const tennis=mod.buildAiOutcomeBandPerformance(rows,{sport:'TENNIS'});const after=sha();
const checks=[
 ['database byte identico',before===after],
 ['calcio dispone di esiti',calcio.scopes.AI_SIGNALS.overall.summary.resolved>0],
 ['tennis dispone di esiti',tennis.scopes.AI_SIGNALS.overall.summary.resolved>0],
 ['calcio competizioni differenziate',calcio.scopes.AI_SIGNALS.competitions.length>1],
 ['tennis tornei differenziati',tennis.scopes.AI_SIGNALS.competitions.length>1],
 ['somma fasce calcio coerente',calcio.scopes.AI_SIGNALS.overall.bands.reduce((s,b)=>s+b.resolved,0)===calcio.scopes.AI_SIGNALS.overall.summary.resolved],
 ['somma fasce tennis coerente',tennis.scopes.AI_SIGNALS.overall.bands.reduce((s,b)=>s+b.resolved,0)===tennis.scopes.AI_SIGNALS.overall.summary.resolved],
 ['stake reale non supera segnali',tennis.scopes.REAL_STAKE.overall.summary.resolved<=tennis.scopes.AI_SIGNALS.overall.summary.resolved]
].map(([name,ok])=>({name,ok:Boolean(ok)}));const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,readOnly:true,checks:checks.length,database:{before,after,totalRows:db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n},calcio:calcio.scopes.AI_SIGNALS.overall.summary,tennis:tennis.scopes.AI_SIGNALS.overall.summary,results:checks},null,2));process.exit(failed.length?1:0);
