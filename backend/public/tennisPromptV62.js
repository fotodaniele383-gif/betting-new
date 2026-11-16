/* BETTINGAPP_PROMPT_STABLE_V62_R2 - UI only, persistent read-only prompt viewer, SAFE13 unchanged. */
(function () {
  'use strict';
  const VERSION = 'TENNIS_V7_0_GABBIA_CONGIUNTA_5PLUS5_2026-11-15';
  const PATCH = 'R21_TENNIS_V7_DATA_ONLY_PERSISTENT_DIALOG';
  const PROMPT_URL = '/TENNIS_V7_MASTER.txt?v=r21';
  const DIALOG_ID = 'bettingapp-tennis-v7-persistent-prompt';
  const prior = window.copyAIPrompt;
  if (typeof prior !== 'function') return;
  // The dynamic match context is observational only. Missing values are omitted.
  const norm = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
  const missing = /^(?:|[-–—]+|N\/?D|N\/?A|NON\s+(?:DISPONIBIL\w*|FORNIT\w*|VERIFICAT\w*|CALCOLABIL\w*|PRESENT\w*)|UNKNOWN|MISSING|NULL|UNDEFINED|\[.*\]|\.\.\.)$/i;
  const verdict = /\b(?:NO\s*BET|BET\s*READY|VALUE\s*(?:CONFERMATO|CONFIRM|CANDIDATE)|STAKE\s*OPERATIVO|UNIFIED_INDEX|QUALITY\s*GATE|BLOCKED|BLOCCAT[OA]|SCARTA|PENDING_BATCH|COMMITTED_BATCH|HTTP\s*423)\b/i;
  const acceptable = v => {const x=norm(v);return x.length>0&&x.length<550&&!missing.test(x)&&!verdict.test(x);};
  const number = v => {const x=norm(v).replace(',','.');if(!/^\d+(?:\.\d+)?$/.test(x))return null;const n=Number(x);return Number.isFinite(n)?n:null;};
  const quote = v => {const n=number(v);return n!==null&&n>1&&n<=100?String(n):null;};
  const out = (lines,name,value) => {if(value!==null&&value!==undefined&&acceptable(value))lines.push(name+': '+norm(value));};
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const apply = (element, styles) => { Object.assign(element.style,styles);return element; };
  function contextForRow(button,match,league,prediction,odd,odd1,odd2) {
    const tr=button&&typeof button.closest==='function'?button.closest('tr'):null;
    const cells=tr?Array.from(tr.children||[]).filter(n=>n.tagName==='TD'):[];
    const cell=i=>String(cells[i]?.innerText||cells[i]?.textContent||'');
    const data=cell(6), percentage=cell(7).match(/(?:^|\s)(\d{1,3}(?:[.,]\d{1,3})?)\s*%/);
    const bm=data.match(/(?:^|\s)Fonte:\s*([^\n]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+QUOTA\s|$)/i);
    const ts=data.match(/\b\d{2}\/\d{2}\/\d{4}[, ]+\d{2}:\d{2}(?::\d{2})?\b/);
    const lines=[];
    out(lines,'Match (feed)',match);
    out(lines,'Circuito e torneo (feed)',league);
    out(lines,'Data e ora visualizzate',cell(0));
    out(lines,'Mercato selezionato (feed)',prediction);
    out(lines,'Quota selezione (feed)',quote(odd));
    out(lines,'Quota riferimento P1 (feed)',quote(odd1));
    out(lines,'Quota riferimento P2 (feed)',quote(odd2));
    if(bm)out(lines,'Bookmaker visualizzato',bm[1]);
    if(ts)out(lines,'Timestamp quota visualizzato',ts[0]);
    if(percentage&&Number(percentage[1].replace(',','.'))<=100)out(lines,'Probabilità modello visualizzata (feed)',percentage[1]+'%');
    return lines.join('\n');
  }
  function composeFullText(template,context) {
    const start='1. BLOCCO INPUT PER MATCH — COMPILARE / SOSTITUIRE PRIMA DELL\'USO';
    const end='2. ARCHITETTURA — QUATTRO GATE SEQUENZIALI, PER MATCH E PER MERCATO';
    const a=template.indexOf(start),b=template.indexOf(end,a+start.length);
    if(a<0||b<=a)throw Error('TENNIS_V7_SECTION_MARKERS_MISSING');
    return template.slice(0,a)+start+'\n\n'+context+'\n\n'+template.slice(b);
  }
  async function copyText(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText==='function') {
      try { await navigator.clipboard.writeText(value);return true; } catch(_) {}
    }
    const area=el('textarea');area.value=value;area.readOnly=true;
    apply(area,{position:'fixed',top:'0',left:'-20000px'});
    document.body.appendChild(area);area.select();
    let copied=false;
    try { copied=Boolean(document.execCommand && document.execCommand('copy')); }
    finally { area.remove(); }
    return copied;
  }
  let generation=0;
  // Only an explicit Close action removes this dialog. Backdrop, ESC, rerenders and timers do not.
  function dialog() {
    const previous=document.getElementById(DIALOG_ID);
    if(previous) return previous;
    const overlay=el('section');overlay.id=DIALOG_ID;
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','Prompt Tennis V7.0 completo');
    overlay.setAttribute('data-prompt-patch',PATCH);
    apply(overlay,{position:'fixed',inset:'0',zIndex:'2147483600',background:'rgba(3,8,20,.94)',
      color:'#e2e8f0',padding:'min(3vw,20px)',overflowY:'auto',boxSizing:'border-box'});
    const panel=el('div');
    apply(panel,{maxWidth:'1100px',margin:'0 auto',minHeight:'min(85vh,830px)',background:'#0f172a',
      border:'1px solid #64748b',borderRadius:'12px',padding:'16px',boxSizing:'border-box',
      font:'14px/1.45 system-ui, sans-serif',boxShadow:'0 12px 50px rgba(0,0,0,.65)'});
    const heading=el('h2','🎾 Prompt Tennis V7.0 — lettura completa');
    apply(heading,{margin:'0 0 6px',fontSize:'20px',color:'#f1f5f9'});
    const info=el('p','La finestra resta aperta finché non premi Chiudi. Nessun dato viene salvato o giocato.');
    apply(info,{fontSize:'12px',color:'#cbd5e1',margin:'0 0 10px'});
    const actions=el('div');apply(actions,{display:'flex',flexWrap:'wrap',gap:'10px',marginBottom:'12px'});
    function button(label) {const b=el('button',label);b.type='button';
      apply(b,{padding:'9px 15px',background:'#1d4ed8',border:'1px solid #60a5fa',color:'#fff',
      fontSize:'14px',cursor:'pointer',borderRadius:'7px'});actions.appendChild(b);return b;}
    const copy=button('Copia prompt completo');
    const select=button('Seleziona tutto');
    const close=button('Chiudi');
    apply(close,{background:'#334155',borderColor:'#94a3b8',marginLeft:'auto'});
    const status=el('p','Caricamento del prompt V7.0…');
    status.setAttribute('role','status');apply(status,{margin:'4px 0 10px',color:'#93c5fd'});
    const viewer=el('textarea');viewer.readOnly=true;viewer.spellcheck=false;
    viewer.setAttribute('aria-label','Testo integrale del prompt Tennis V7.0');
    viewer.value='Caricamento del prompt Tennis V7.0…';
    apply(viewer,{display:'block',width:'100%',height:'min(68vh,680px)',minHeight:'350px',resize:'vertical',
      background:'#020617',border:'1px solid #64748b',color:'#e2e8f0',font:'12px/1.5 Consolas,monospace',
      padding:'12px',boxSizing:'border-box',whiteSpace:'pre-wrap'});
    panel.append(heading,info,actions,status,viewer);overlay.appendChild(panel);document.body.appendChild(overlay);
    // No overlay click listener and no Escape shortcut: cannot accidentally auto-close.
    close.addEventListener('click',function(event){event.stopPropagation();generation++;overlay.remove();});
    select.addEventListener('click',function(){viewer.focus();viewer.select();status.textContent='Testo selezionato: premi Ctrl+C per copiare.';});
    copy.addEventListener('click',async function(){const ok=await copyText(viewer.value);status.textContent=ok?'Prompt completo copiato negli appunti.':'Copia non disponibile: premi Seleziona tutto, poi Ctrl+C.';});
    overlay._bettingPromptViewer=viewer;overlay._bettingPromptStatus=status;
    return overlay;
  }
  async function openViewer(context,opener) {
    const overlay=dialog(), viewer=overlay._bettingPromptViewer,status=overlay._bettingPromptStatus;
    const token=++generation;
    viewer.value='Caricamento del prompt Tennis V7.0…';
    status.textContent='Caricamento del testo completo…';
    if(opener)opener.setAttribute('aria-controls',DIALOG_ID);
    try {
      const response=await fetch(PROMPT_URL,{cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status+' durante il caricamento');
      const base=await response.text();
      if(!base.includes(VERSION)||!base.includes('RELIABILITY 30'))throw Error('Testo V7.0 assente o incompleto');
      if(token!==generation||!overlay.isConnected)return;
      viewer.value=composeFullText(base,context||'');
      viewer.scrollTop=0;
      status.textContent='Prompt completo disponibile ('+viewer.value.length+' caratteri). Scorri per leggerlo o premi Copia.';
      viewer.focus({preventScroll:true});
    } catch(error) {
      if(token!==generation||!overlay.isConnected)return;
      status.textContent='Errore caricamento: '+(error.message||String(error))+'. La finestra resta aperta.';
      viewer.value='ERRORE: prompt non disponibile. Verifica file statico e riprova. Nessun dato modificato.';
    }
    return overlay;
  }
  // Call wrapper from the existing inline app button; Calcio keeps the V4 modal.
  window.copyAIPrompt=function safeV62ReadPrompt(button,match,league,prediction,odd,odd1,oddX,odd2) {
    if(typeof activeSport==='undefined'||String(activeSport).toLowerCase()!=='tennis')
      return prior.apply(this,arguments);
    return openViewer(contextForRow(button,match,league,prediction,odd,odd1,odd2),button);
  };
  function relabel() {
    if(typeof activeSport==='undefined')return;
    const tennis=String(activeSport).toLowerCase()==='tennis';
    if(!tennis)return; // R21: do not overwrite Calcio V8 labels.
    document.querySelectorAll('#analysisTable tbody button[onclick*="copyAIPrompt"], #valueBetsTable button[onclick*="copyAIPrompt"]').forEach(b=>{
      if(b.textContent === '✅ Copiato!' || b.textContent==='✅ V7.0 copiato')return;
      const target='🎾 Leggi / copia prompt V7.0';
      if(b.textContent!==target)b.textContent=target;
      if(tennis)b.title='Finestra persistente con quattro gate, serve/return e minimax teorico';
    });
  }
  const boot=()=>{relabel();
    if(typeof MutationObserver==='function'){
      const container=document.getElementById('valueBetsTable')||document.getElementById('analysisTable');
      if(container)new MutationObserver(relabel).observe(container,{childList:true,subtree:true});
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.BettingTennisPromptV7=Object.freeze({version:VERSION,patch:PATCH,readOnly:true,contextForRow,composeFullText,
    operationalStakeAuthority:false,source:PROMPT_URL,openViewer:openViewer});
})();
