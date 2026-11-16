(function(){
'use strict';
const S=window.TradingScopes,$=id=>document.getElementById(id);
let tradingMode='TRADING',portfolioMode='TRADING';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=m=>m==='STUDIO'?'Trading Studio':'Trading';
const sport=()=>activeSport===SPORT.TENNIS?'TENNIS':'CALCIO';
const fmt=(v,d=2)=>v===null?'N/D':Number(v).toLocaleString('it-IT',{minimumFractionDigits:d,maximumFractionDigits:d});
function buttons(mode){return `<div class="scope-switch" role="group" aria-label="Categoria del portafoglio"><button type="button" data-mode="TRADING" aria-pressed="${mode==='TRADING'}">Trading · stake &gt; 0 €</button><button type="button" data-mode="STUDIO" aria-pressed="${mode==='STUDIO'}">Trading Studio · stake 0 €</button></div>`;}
function top(rows,mode){const m=S.metrics(rows.filter(r=>['WON','LOST'].includes(r.status)),mode);for(const [id,value]of Object.entries({displayRoi:mode==='STUDIO'?'Non applicabile':m.roi===null?'N/D':fmt(m.roi)+'%',displayYield:mode==='STUDIO'?'Non applicabile':m.decisive&&m.profit!==null?fmt(m.profit/m.decisive)+' €':'N/D',displayBrier:fmt(m.brier,4),displayClvBeat:m.clvPositiveRate===null?'N/D':fmt(m.clvPositiveRate)+'%'})){if($(id)){$(id).textContent=value;$(id).title=label(mode)+' · '+sport()+' · campione selezionato';}}}
function prepareTrading(rows){
 const eligible=rows.filter(r=>S.visible(r,sport())),invalid=eligible.filter(r=>S.scope(r)==='INVALID').length;
 let box=$('scopeTradingSwitch');if(!box){box=document.createElement('div');box.id='scopeTradingSwitch';box.className='scope-panel';$('forwardTestSummaryBox').before(box);}
 box.innerHTML=`<h2>${label(tradingMode)} · ${sport()==='TENNIS'?'Tennis':'Calcio'}</h2><p>Analisi IA → stake registrato → Trading oppure Trading Studio.</p><p class="scope-muted">${invalid} righe con stake mancante, negativo o non valido escluse. I gate di esecuzione restano attivi.</p>`;
 const title=document.querySelector('.step42-trading-title-text');if(title)title.textContent=label(tradingMode);
 if(typeof selectedForwardBetIds!=='undefined')selectedForwardBetIds.clear();
 $('forwardTestBtn')?.setAttribute('aria-pressed',String(tradingMode==='TRADING'));
 $('tradingStudioBtn')?.setAttribute('aria-pressed',String(tradingMode==='STUDIO'));
 return S.projectRows(S.filter(eligible,tradingMode),tradingMode); // AUDIT16D_R3_T12_CURRENT_SCOPE_PNL_PROJECTION
}
function ensurePortfolioSwitch(invalid){
 $('portfolioSection')?.setAttribute('aria-busy','true');
 let box=$('scopePortfolioSwitch');if(!box){box=document.createElement('div');box.id='scopePortfolioSwitch';box.className='scope-panel';$('portfolioSection').prepend(box);}
 box.innerHTML=`<strong>Portfolio · ${sport()==='TENNIS'?'Tennis':'Calcio'} · ${label(portfolioMode)}</strong>${buttons(portfolioMode)}<p class="scope-muted">${invalid===undefined?'Caricamento…':invalid+' stake non validi esclusi.'} I filtri qui sotto si applicano alla categoria selezionata.</p><p id="scopePortfolioError" role="status"></p>`;
 box.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{portfolioMode=b.dataset.mode;loadPortfolioData();}));
}
const portfolioIncludes=r=>S.visible(r,sport())&&S.scope(r)===portfolioMode;
const studioPortfolio=()=>portfolioMode==='STUDIO';
function portfolioDescription(){return portfolioMode==='STUDIO'?'Trading Studio: stake registrato pari a 0 €. Esiti e qualità descrittiva; metriche monetarie non applicabili.':'Trading: stake registrato maggiore di 0 €. Il filtro non costituisce autorizzazione a eseguire puntate; i gate restano invariati.';}
// Adapt monetary cells in the ORIGINAL panels, keeping sections, columns and controls.
// The map is tied to existing visible labels and is regression-tested against those templates.
function maskMoney(root){
 if(!root)return;
 root.querySelectorAll('table').forEach(table=>{
  const heads=[...table.querySelectorAll('thead tr:last-child th')];
  const cols=heads.map((h,i)=>/^(stake(?: operativo.*)?|profit(?:to)?|roi(?: reale)?|flat teorico)$/i.test(h.textContent.trim())?i:-1).filter(i=>i>=0);
  table.querySelectorAll('tbody tr').forEach(tr=>cols.forEach(i=>{const cell=tr.children[i];if(cell&&(!cell.colSpan||cell.colSpan===1))cell.textContent='Non applicabile';}));
  // AUDIT16D_R3_T12_STUDIO_SEMANTIC_LABELS: stake=0 rows are observations, never operative bets.
  const opIdx=heads.findIndex(h=>h.textContent.trim()==='Operative W/L');
  const wrIdx=heads.findIndex(h=>h.textContent.trim()==='Win rate');
  if(opIdx>=0){heads[opIdx].textContent='Esiti Studio W/L';table.querySelectorAll('tbody tr').forEach(tr=>{const cell=tr.children[opIdx];const small=cell?.querySelector('small');if(small)small.textContent=small.textContent.replace(/operative/i,'esiti Studio');});}
  if(wrIdx>=0)heads[wrIdx].textContent='Hit Studio';
 });
 const names=/^(profitto realizzato|equity finale trading reale|equity del campione da 1[.,]000 €|max dd da peak|roi|stake totale|profitto|profit|roi reale|esposizione aperta)$/i; // AUDIT16D_R3_T12_STUDIO_MONEY_MASK
 root.querySelectorAll('div,span').forEach(el=>{
  if(el.children.length||!names.test(el.textContent.trim()))return;
  const parent=el.parentElement,value=parent?.querySelector('strong');if(value)value.textContent='Non applicabile';
 });
 root.querySelectorAll('.step55-primary-kpi').forEach(el=>el.textContent='Non applicabile');
}
function maskStudioMoney(root){if(studioPortfolio())maskMoney(root);}
function equityNotice(show){let el=$('scopeEquityNotice');if(!el){el=document.createElement('p');el.id='scopeEquityNotice';el.className='scope-muted';$('chartDrawdown')?.before(el);}el.textContent=show?'Non applicabile: Trading Studio non investe capitale e non genera una curva monetaria.':'';}
function finishPortfolio(rows){
 $('portfolioSection')?.removeAttribute('data-scope-stale');$('portfolioSection')?.setAttribute('aria-busy','false');
 top(rows,portfolioMode);maskStudioMoney($('portfolioSection'));
 if(studioPortfolio())for(const id of ['portDrawdown','portSharpe'])if($(id))$(id).textContent='Non applicabile';
 if($('scopePortfolioError'))$('scopePortfolioError').textContent='';
}
function finishTrading(rows){top(rows,tradingMode);if(tradingMode==='STUDIO')maskMoney($('forwardTestSummaryBox'));}
function portfolioError(error){
 $('portfolioSection')?.setAttribute('aria-busy','false');
 if($('scopePortfolioError'))$('scopePortfolioError').textContent='Caricamento fallito: '+error.message+'. Premere Aggiorna; i pannelli precedenti non sono aggiornati.';
 // Do not remove previous panels or silently present them as the new selection.
 $('portfolioSection')?.setAttribute('data-scope-stale','true');
 for(const id of ['portDrawdown','portSharpe','portSteam','portAvgClv','displayRoi','displayYield','displayBrier','displayClvBeat'])if($(id))$(id).textContent='N/D · errore caricamento';
}
window.TradingScopeUI={prepareTrading,ensurePortfolioSwitch,finishTrading,finishPortfolio,portfolioError,portfolioIncludes,portfolioDescription,studioPortfolio,maskStudioMoney,equityNotice,mode:()=>tradingMode,portfolioMode:()=>portfolioMode};
// Dedicated buttons: synthetic clicks used by refresh must retain the active category.
$('forwardTestBtn')?.addEventListener('click',e=>{if(e.isTrusted)tradingMode='TRADING';},true);
$('tradingStudioBtn')?.addEventListener('click',()=>{tradingMode='STUDIO';$('forwardTestBtn').click();});
})();
