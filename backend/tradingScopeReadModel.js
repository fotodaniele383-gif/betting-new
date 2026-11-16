'use strict';
const scopes=require('./public/tradingScopes');
function select(rows,sport,mode){
 if(mode===undefined)return rows; // Existing callers retain their original behavior.
 if(!['TRADING','STUDIO'].includes(mode))throw Error('Categoria non valida');
 return scopes.filter(rows.filter(r=>scopes.visible(r,sport)),mode);
}
const transportOmissions=new Set(['calcio_market_selection_audit','calcio_market_finalization_audit','calcio_deepscan_final_report_json','calcio_odds_provenance_json','tennis_canonical_player_evidence_json']);
// Large raw audit documents are not read by Portfolio. Keep them in the DB and in server computations.
const compact=rows=>rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>v!==null&&v!==''&&!transportOmissions.has(k))));
function install(app,db,buildReport){
 const read=sport=>db.prepare('SELECT * FROM ai_forward_test WHERE UPPER(sport_type)=? ORDER BY id DESC').all(sport).filter(r=>scopes.visible(r,sport));
 const valid=sport=>['TENNIS','CALCIO'].includes(sport);
 app.get('/api/trading-scopes/history',(req,res)=>{
  const sport=String(req.query.sport||'').toUpperCase();
  if(!valid(sport))return res.status(400).json({success:false,error:'Sport non valido'});
  try {const rows=read(sport);res.set('Cache-Control','no-store');return res.json({success:true,sport,history:compact(rows),counts:{trading:scopes.filter(rows,'TRADING').length,studio:scopes.filter(rows,'STUDIO').length,invalid:rows.filter(r=>scopes.scope(r)==='INVALID').length},readOnly:true});}
  catch(e){return res.status(500).json({success:false,error:e.message});}
 });
 app.post('/api/trading-scopes/portfolio',(req,res)=>{
  try {
   const {sport,scope,ids,bankroll}=req.body||{};
   if(!valid(sport)||!['TRADING','STUDIO'].includes(scope)||!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length||typeof bankroll!=='number'||!Number.isFinite(bankroll)||bankroll<0)return res.status(400).json({success:false,error:'Parametri Portfolio non validi'});
   const wanted=new Set(ids),rows=select(read(sport),sport,scope).filter(r=>wanted.has(r.id));
   if(rows.length!==wanted.size)return res.status(409).json({success:false,error:'Storico cambiato durante il caricamento: premere Aggiorna.'});
   // AUDIT16D_R3_T12_CURRENT_SCOPE_PNL_PROJECTION: view-only, raw DB remains unchanged.
   const projectedRows=scopes.projectRows(rows,scope);
   const singles=projectedRows.filter(r=>!String(r.bet_type||'').toUpperCase().includes('MULTI'));
   const report=buildReport(singles,sport,1000);
   const account=require('./public/portfolioAccounting').portfolioLedger(read(sport),sport);
   res.set('Cache-Control','no-store');return res.json({success:true,sport,scope,history:compact(projectedRows),...report,account,readOnly:true,portfolioProjection:'CURRENT_REGISTERED_STAKE_STATUS_ODD'});
  } catch(e){return res.status(500).json({success:false,error:e.message});}
 });
}
module.exports={install,select};
