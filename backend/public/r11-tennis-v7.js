/* BETTINGAPP_R11_TENNIS_PROMPT_V7_1_READONLY_UI · DOES NOT SEND STAKE OR ALTER ENGINE */
(function(){
 'use strict';
 const VERSION='BETTINGAPP_R11_TENNIS_V7_1_MINIMAX_20261113';
 const URL='/TENNIS_V7_1_MINIMAX_INDIPENDENTE.txt?v=r11-20261113';
 const ID='betting-r11-tennis-v7-dialog';
 const prior=window.copyAIPrompt;
 if(typeof prior!=='function') { console.warn('R10_TENNIS_PROMPT_PREVIOUS_HANDLER_MISSING'); return; }
 function txt(x,limit=240){return String(x===undefined||x===null?'N/D':x).replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,limit)||'N/D';}
 function isTennis(){try{return typeof activeSport!=='undefined'&&String(activeSport).toLowerCase()==='tennis';}catch(_){return false;}}
 function getRowContext(button,match,league,prediction,odd,odd1,odd2){
  const row=button&&button.closest?button.closest('tr'):null;
  const cells=row?Array.from(row.children).filter(x=>x.tagName==='TD'):[];
  const c=i=>cells[i]?txt(cells[i].innerText||cells[i].textContent,500):'N/D';
  return ['=== BETTINGAPP: SEGNALI DELLA RIGA (NON FONTE INDIPENDENTE) ===',
   'Sport: TENNIS','Match: '+txt(match),'Competizione feed: '+txt(league),
   'Data/ora feed: '+c(0),'Pred.: '+txt(prediction),'Quota: '+txt(odd),
   'Prob.: '+c(7),'Storico DS×Gate: '+c(8),'Edge / EV: '+c(9),
   'Bookmaker, quota avversario +1,5 SET e timestamp: DA VERIFICARE IN AUTONOMIA',
   'Avvertenza: non trasformare una moneyline P2 in +1,5 set.',
   '=== FINE INPUT BETTINGAPP ===',''].join('\n');
 }
 let loadToken=0;
 async function open(button,context){
  let d=document.getElementById(ID);
  if(d){d.remove();}
  d=document.createElement('section');d.id=ID;d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
  Object.assign(d.style,{position:'fixed',inset:'0',background:'rgba(3,8,20,.96)',zIndex:'2147483640',padding:'15px',overflowY:'auto',color:'#e2e8f0'});
  const panel=document.createElement('div');Object.assign(panel.style,{maxWidth:'1050px',margin:'0 auto',padding:'16px',borderRadius:'12px',background:'#111827',border:'1px solid #64748b',fontFamily:'system-ui,sans-serif'});
  const header=document.createElement('h2');header.textContent='🎾 Prompt Tennis V7.1 — AI indipendente e minimax · 10 €';header.style.fontSize='20px';
  const note=document.createElement('p');note.textContent='La simulazione è sempre richiesta, ma senza due quote verificabili deve risultare NON CALCOLABILE. Nessuna modifica a BettingApp.';
  const tools=document.createElement('div');Object.assign(tools.style,{display:'flex',gap:'10px',flexWrap:'wrap',paddingBottom:'10px'});
  const area=document.createElement('textarea');area.readOnly=true;area.spellcheck=false;area.setAttribute('aria-label','Prompt Tennis V7 completo');Object.assign(area.style,{width:'100%',height:'68vh',minHeight:'360px',background:'#020617',color:'#e2e8f0',border:'1px solid #475569',borderRadius:'6px',padding:'10px',boxSizing:'border-box',fontFamily:'ui-monospace,monospace',fontSize:'13px'});
  const status=document.createElement('p');status.textContent='Caricamento prompt…';status.setAttribute('role','status');
  function addButton(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;Object.assign(b.style,{padding:'9px 13px',border:'1px solid #64748b',borderRadius:'7px',background:'#1e40af',color:'white',cursor:'pointer'});b.addEventListener('click',fn);tools.appendChild(b);return b;}
  addButton('Copia prompt',async()=>{try{await navigator.clipboard.writeText(area.value);status.textContent='Prompt V7 copiato.';}catch(_){area.focus();area.select();status.textContent='Seleziona e premi Ctrl+C.';}});
  addButton('Seleziona tutto',()=>{area.focus();area.select();});
  addButton('Chiudi',()=>{loadToken++;d.remove();});
  panel.append(header,note,tools,status,area);d.append(panel);document.body.append(d);
  if(button)button.setAttribute('aria-controls',ID);
  const tok=++loadToken;
  try{const res=await fetch(URL,{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);const body=await res.text();
   if(!body.includes('TENNIS_V7_1_DATA_FIRST_MINIMAX_20261113')||!body.includes('## 4. SIMULAZIONE MINIMAX'))throw Error('File prompt incompleto');
   if(tok===loadToken&&d.isConnected){area.value=context+'\n'+body;status.textContent='Prompt V7 pronto — usa Copia prompt; nessun dato viene salvato.';area.focus({preventScroll:true});}
  }catch(e){if(tok===loadToken&&d.isConnected){area.value='ERRORE: '+txt(e.message)+'. Verificare installazione R11; nessun dato modificato.';status.textContent='Prompt non disponibile';}}
 }
 window.copyAIPrompt=function(button,match,league,prediction,odd,odd1,oddX,odd2){
  if(!isTennis())return prior.apply(this,arguments);
  return open(button,getRowContext(button,match,league,prediction,odd,odd1,odd2));
 };
 function relabel(){
  const tennis=isTennis();
  for(const b of document.querySelectorAll('#analysisTable button[onclick*="copyAIPrompt"], #valueBetsTable button[onclick*="copyAIPrompt"]')){
   if(tennis){b.setAttribute('data-r11-prompt','1');b.setAttribute('aria-label','Prompt Tennis V7 minimax 10 euro');
    b.title='AI indipendente · due singole · payoff BO3 · nessuno stake automatico';}
   else {b.removeAttribute('data-r11-prompt');}
  }
 }
 function boot(){
  if(!document.getElementById('r11-tennis-prompt-style')){
   const st=document.createElement('style');st.id='r11-tennis-prompt-style';
   st.textContent='button[data-r11-prompt="1"]{font-size:0!important} button[data-r11-prompt="1"]:after{content:"🎾 Prompt Tennis V7 · Minimax 10 €";font-size:12px!important;white-space:normal}';
   document.head.appendChild(st);
  }
  relabel();const table=document.getElementById('valueBetsTable')||document.getElementById('analysisTable');
  if(table&&typeof MutationObserver!=='undefined'){let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;relabel();},140);}).observe(table,{subtree:true,childList:true});}
  window.BettingTennisPromptR11=Object.freeze({version:VERSION,readOnly:true,operationalStakeAuthority:false,source:URL});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
