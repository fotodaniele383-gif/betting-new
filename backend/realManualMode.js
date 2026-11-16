'use strict';
/** REAL_MANUAL_V1: read existing analyses, journal ONLY user-confirmed real wagers.
 * No bookmaker integration, no money movement and no mutation of BettingApp historical DB.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VERSION = 'BETTINGAPP_REAL_MANUAL_V1_20261109';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const round = x => Math.round((x + Number.EPSILON) * 100) / 100;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const money = x => Number.isFinite(Number(x)) ? round(Number(x)) : null;
const safeText = (s,limit=180) => String(s ?? '').trim().slice(0,limit);

function italianDateToUtc(s) {
    if(typeof s !== 'string') return null;
    const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d{2}:\d{2})$/i.test(s) ? Date.parse(s) : NaN;
    if (Number.isFinite(iso)) return new Date(iso).toISOString();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
    if(!m) return null;
    const [,dd,mm,yy,hh,mi,ss='0'] = m;
    const p = [Number(yy),Number(mm),Number(dd),Number(hh),Number(mi),Number(ss)];
    if(p[1]<1||p[1]>12||p[2]<1||p[2]>31||p[3]>23||p[4]>59||p[5]>59)return null;
    const approximate=Date.UTC(p[0],p[1]-1,p[2],p[3],p[4],p[5]);
    const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts=Object.fromEntries(fmt.formatToParts(new Date(approximate)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    const asUtc=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
    const actual=approximate-(asUtc-approximate);
    const verify=Object.fromEntries(fmt.formatToParts(new Date(actual)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    if(verify.year!==p[0]||verify.month!==p[1]||verify.day!==p[2]||verify.hour!==p[3]||verify.minute!==p[4]) return null;
    return new Date(actual).toISOString();
}
function binaryMarket(m,pick){
  const market=String(m||'').toUpperCase();const x=String(pick||'').toUpperCase().replace(/\s+/g,'');
  return ['1X2','MONEYLINE','MATCH_WINNER','MATCH WINNER','WINNER'].includes(market) || (/^(?:U|O|OVER|UNDER)\d+(?:\.5)?$/.test(x));
}
function classifyRow(r, now=Date.now()) {
    const date = italianDateToUtc(r.match_date);
    const odd=Number(r.odd), p=Number(r.estimated_prob);
    const hasEstimate = Number.isFinite(p)&&p>0&&p<100;
    const quoteOk = Number.isFinite(odd)&&odd>1;
    const diagnosticEv = quoteOk && hasEstimate && binaryMarket(r.market_type,r.prediction) ? round((p/100*odd-1)*100) : null;
    const quality = r.sport_type==='CALCIO' ? safeText(r.calcio_data_quality_status||r.calcio_gate_status||'N/D') : safeText(r.tennis_operational_status||r.tennis_stake_calibration_status||'N/D');
    const bookmaker=safeText(r.calcio_odds_bookmaker_title||r.reference_market_source||'NON VERIFICATO');
    const quotation=safeText(r.calcio_odds_last_update||'');
    const isFuture=Boolean(date && Date.parse(date)>now);
    const concerns=[];
    if(!date) concerns.push('DATA NON PARSABILE');
    if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(String(r.match_date)))concerns.push('FUSO EUROPE/ROME ASSUNTO, NON CERTIFICATO');
    if(!isFuture) concerns.push('EVENTO NON FUTURO');
    if(!hasEstimate) concerns.push('PROBABILITÀ NON VALIDA');
    if(!quoteOk) concerns.push('QUOTA NON VALIDA');
    if(/BLOCK|NO_STAKE|NO_BET|NOT_READY|INSUFFICIENT/i.test(quality)) concerns.push('GATE MODELLO NON IDONEO');
    if(!quotation) concerns.push('TIMESTAMP QUOTA NON DISPONIBILE');
    if(!binaryMarket(r.market_type,r.prediction)) concerns.push('EV CALCOLABILE SOLO CON PAYOFF COMPLETO');
    if(quotation && !Number.isFinite(Date.parse(quotation))) concerns.push('TIMESTAMP QUOTA NON PARSABILE');
    if(quotation && Number.isFinite(Date.parse(quotation)) && (now-Date.parse(quotation))>30*60*1000) concerns.push('QUOTA NON AGGIORNATA (OLTRE 30 MIN)');
    if(quotation && Date.parse(quotation)>now) concerns.push('QUOTA FUTURA NON VERIFICABILE');
    return {
      id:r.id, sport:r.sport_type, event:safeText(r.home_team)+' — '+safeText(r.away_team), matchDate:date,
      league:safeText(r.league), selection:safeText(r.prediction),market:safeText(r.market_type),
      observedOdd:quoteOk?odd:null, estimatedProbabilityPct:hasEstimate?round(p):null,
      theoreticalEvPct:diagnosticEv, quoteSource:bookmaker, quoteTime:quotation||null,
      modelStatus:quality, dataQuality:safeText(r.data_quality),
      analyticalVerdict:concerns.length?'RICHIEDE VERIFICA':'CANDIDATA DA VALUTARE', concerns,
      note:'Probabilità e EV originano dal sistema e non sono certificati da questa pagina. L’utente decide liberamente.'
    };
}
function createStore(folder) {
  const file=path.join(folder,'journal.jsonl');
  function load(){
    if(!fs.existsSync(file))return [];
    const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);
    let previous='GENESIS';
    return lines.map((line,i)=>{
      const e=JSON.parse(line);const {hash,...body}=e;
      if(e.previousHash!==previous||hash!==sha(JSON.stringify(body)))throw new Error('REAL_MANUAL_LEDGER_INTEGRITY_ERROR: event '+(i+1));
      previous=hash;return e;
    });
  }
  function append(obj) {
    const events=load();const previousHash=events.length?events[events.length-1].hash:'GENESIS';
    const body={seq:events.length+1,previousHash,createdAt:new Date().toISOString(),...obj};
    const event={...body,hash:sha(JSON.stringify(body))};
    fs.mkdirSync(folder,{recursive:true});
    fs.appendFileSync(file,JSON.stringify(event)+'\n',{encoding:'utf8',flag:'a',mode:0o600});
    return event;
  }
  function tickets(){
    const byId=new Map();
    for(const e of load()){
      if(e.type==='TICKET')byId.set(e.ticketId,{...e,settlement:null});
      if(e.type==='SETTLEMENT'&&byId.has(e.ticketId))byId.get(e.ticketId).settlement=e;
    }
    const out=[...byId.values()].reverse();
    const settled=out.filter(x=>x.settlement);
    const staked=round(settled.reduce((a,x)=>a+x.stake,0));
    const net=round(settled.reduce((a,x)=>a+x.settlement.netProfit,0));
    return {tickets:out,metrics:{total:out.length,pending:out.length-settled.length,settled:settled.length,settledStake:staked,netProfit:net,settledROI:staked>0?round(100*net/staked):null}};
  }
  return {file,load,append,tickets};
}
function validateTicket(x) {
  if(!x||x.confirmed!==true)throw Error('CONFIRMA_ESPLICITA_RICHIESTA');
  const stake=Number(x.stake), odd=Number(x.actualOdd),candidateId=Number(x.candidateId);
  if(!Number.isSafeInteger(candidateId)||candidateId<=0)throw Error('ID_ANALISI_NON_VALIDO');
  if(!finite(stake)||stake<0.01||stake>100000000||Math.abs(stake*100-Math.round(stake*100))>1e-6)throw Error('IMPORTO_NON_VALIDO: euro positivi, massimo 2 decimali');
  if(!finite(odd)||odd<=1||odd>100000)throw Error('QUOTA_REALE_NON_VALIDA');
  return {candidateId,stake:round(stake),actualOdd:odd,bookmaker:safeText(x.bookmaker,100),ticketRef:safeText(x.ticketRef,100),notes:safeText(x.notes,1000)};
}
function validateSettlement(ticket,x){
  if(!ticket || ticket.settlement)throw Error('TICKET_INESISTENTE_O_GIA_CHIUSO');
  const status=safeText(x.result,20).toUpperCase();
  const allowed=new Set(['WON','LOST','VOID','HALF_WON','HALF_LOST','CUSTOM']);
  if(!allowed.has(status))throw Error('ESITO_NON_VALIDO');
  let profit;
  if(status==='WON')profit=round(ticket.stake*(ticket.actualOdd-1));
  else if(status==='LOST')profit=-ticket.stake;
  else if(status==='VOID')profit=0;
  else if(status==='HALF_WON')profit=round(ticket.stake*(ticket.actualOdd-1)/2);
  else if(status==='HALF_LOST')profit=-round(ticket.stake/2);
  else {profit=money(x.netProfit);if(profit===null||Math.abs(profit)>1000000000)throw Error('PROFITTO_MANUALE_NON_VALIDO');}
  return {result:status,netProfit:profit,settlementNote:safeText(x.notes,500)};
}
function install(app,db,{projectRoot=path.resolve(__dirname,'..')}={}){
 const store=createStore(path.join(projectRoot,'.bettingapp_real_manual'));
 const columns='id,sport_type,home_team,away_team,match_date,prediction,odd,estimated_prob,league,market_type,status,data_quality,calcio_data_quality_status,calcio_gate_status,tennis_operational_status,tennis_stake_calibration_status,calcio_odds_bookmaker_title,reference_market_source,calcio_odds_last_update';
 const local=(req)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(req.socket?.remoteAddress||''));
 function getCandidate(id){return db.prepare(`SELECT ${columns} FROM ai_forward_test WHERE id=? AND UPPER(status)='PENDING' AND UPPER(sport_type) IN ('CALCIO','TENNIS')`).get(id);}
 app.get('/api/real-manual/overview',(req,res)=>{
   try{
     const sport=String(req.query.sport||'ALL').toUpperCase();if(!['ALL','CALCIO','TENNIS'].includes(sport))return res.status(400).json({error:'SPORT_NON_VALIDO'});
     const now=Date.now();const rows=db.prepare(`SELECT ${columns} FROM ai_forward_test WHERE UPPER(status)='PENDING' AND UPPER(sport_type) IN ('CALCIO','TENNIS') ORDER BY id DESC LIMIT 1200`).all();
     const candidates=rows.map(r=>classifyRow(r,now)).filter(r=>r.matchDate&&Date.parse(r.matchDate)>now&&Date.parse(r.matchDate)<now+45*86400000&&(sport==='ALL'||r.sport===sport)).slice(0,150);
     return res.json({version:VERSION,mode:'REAL_MANUAL',manualOnly:true,automaticBookmakerOrders:false,available:candidates.length,candidates,journal:store.tickets().metrics});
   }catch(e){return res.status(500).json({error:e.message});}
 });
 app.get('/api/real-manual/tickets',(req,res)=>{try{return res.json({version:VERSION,...store.tickets()});}catch(e){return res.status(500).json({error:e.message});}});
 app.post('/api/real-manual/tickets',(req,res)=>{
   if(!local(req))return res.status(403).json({error:'SOLO_LOCALE'});
   try{
     const input=validateTicket(req.body),row=getCandidate(input.candidateId);
     if(!row)throw Error('ANALISI_NON_DISPONIBILE_O_NON_PENDING');
     const snapshot=classifyRow(row);if(!snapshot.matchDate||Date.parse(snapshot.matchDate)<=Date.now())throw Error('INCONTRO_GIA_INIZIATO_O_NON_VERIFICATO');
     const event=store.append({type:'TICKET',ticketId:crypto.randomUUID(),...input,snapshot,source:'USER_CONFIRMED_REAL_WORLD_TICKET',autoPlaced:false});
     return res.status(201).json({success:true,ticket:event});
   }catch(e){return res.status(400).json({success:false,error:e.message});}
 });
 app.post('/api/real-manual/settle',(req,res)=>{
   if(!local(req))return res.status(403).json({error:'SOLO_LOCALE'});
   try{
     const tid=safeText(req.body?.ticketId,100);
     const ticket=store.tickets().tickets.find(x=>x.ticketId===tid);
     const s=validateSettlement(ticket,req.body||{});
     const event=store.append({type:'SETTLEMENT',ticketId:tid,...s,source:'USER_ENTERED_RESULT',autoSettled:false});
     return res.json({success:true,settlement:event});
   }catch(e){return res.status(400).json({success:false,error:e.message});}
 });
 return {version:VERSION,ledgerPath:store.file};
}
module.exports={VERSION,italianDateToUtc,binaryMarket,classifyRow,createStore,validateTicket,validateSettlement,install};
