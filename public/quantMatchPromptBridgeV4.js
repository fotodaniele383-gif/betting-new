/* BETTINGAPP_CALCIO_PROMPT_V8_DATA_ONLY_20261115
   Calcio UI prompt only. No DB writes, no trading authority, no API writes.
   Dynamic payload only: allowlisted present observable data. No app verdict or missing placeholders.
*/
(function(){
 'use strict';
 const VERSION='BETTINGAPP_CALCIO_PROMPT_V8_DATA_ONLY_20261115';
 const URL='/CALCIO_V8_MASTER.txt?v=r21';
 const KEY_PREFIX='bettingapp:calcioPromptV8:notes:';
 const banned=/(?:\bNO\s*BET\b|\bBET\s*READY\b|\bBET\b|\bVALUE\s*(?:CONFERMATO|CONFIRM|CANDIDATE)\b|\bSTAKE\b|UNIFIED_INDEX|QUALITY\s*GATE|SCARTA|BLOCCAT[OA]|PENDING_BATCH|COMMITTED_BATCH|R9_|HTTP\s*423)/i;
 const absent=/^(?:|\s*[-–—]+\s*|N\/?D|N\/?A|NON\s+(?:DISPONIBILE|FORNIT[OA]|PRESENTE|VERIFICAT[OA]|STIMABILE|CALCOLABILE|OSSERVAT[OA])|MANCANTE|MISSING|UNKNOWN|NULL|UNDEFINED|\[.*\]|\.\.\.)$/i;
 const norm=x=>String(x??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
 const good=x=>{const v=norm(x);return v.length>0&&v.length<700&&!absent.test(v)&&!banned.test(v);};
 const number=x=>{const v=norm(x).replace(',','.');if(!/^\d+(?:\.\d+)?$/.test(v))return null;const n=Number(v);return Number.isFinite(n)?n:null;};
 const odds=x=>{const n=number(x);return n!==null&&n>1&&n<=100?String(x).trim():null;};
 const scalar=x=>good(x)?norm(x):null;
 const line=(out,label,value)=>{if(value!==null&&value!==undefined&&good(value))out.push(label+': '+norm(value));};
 function collect(btn,match,league,prediction,odd,odd1,oddX,odd2){
  const tr=btn&&typeof btn.closest==='function'?btn.closest('tr'):null;
  const tds=tr?Array.from(tr.children||[]).filter(x=>x.tagName==='TD'):[];
  const cell=i=>norm(tds[i]?.innerText||tds[i]?.textContent||'');
  const p=cell(7).match(/(?:^|\s)(\d{1,3}(?:[.,]\d{1,3})?)\s*%/);
  const rawQuote=cell(6);
  const bm=rawQuote.match(/(?:^|\s)Fonte:\s*([^\n]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+QUOTA\s|$)/i);
  const timestamp=rawQuote.match(/\b\d{2}\/\d{2}\/\d{4}[, ]+\d{2}:\d{2}(?::\d{2})?\b/);
  const output={match:scalar(match),league:scalar(league),kickoff:scalar(cell(0)),prediction:scalar(prediction),selectedOdd:odds(odd),odd1:odds(odd1),oddX:odds(oddX),odd2:odds(odd2),probabilityPct:p&&Number(p[1].replace(',','.'))<=100?p[1]+'%':null,bookmaker:bm?scalar(bm[1]):null,quoteCapturedAt:timestamp?timestamp[0]:null};
  return Object.freeze(output);
 }
 // All values absent from the match are OMITTED, never rendered as blanks or placeholder lines.
 function context(d,notes='',extraQuotes=''){
  const out=[];
  line(out,'Partita',d.match);
  line(out,'Competizione (feed)',d.league);
  line(out,'Data e ora visualizzate',d.kickoff);
  line(out,'Mercato selezionato (feed)',d.prediction);
  line(out,'Quota del mercato selezionato (feed)',odds(d.selectedOdd));
  line(out,'Bookmaker visualizzato',d.bookmaker);
  line(out,'Timestamp visualizzato della quota',d.quoteCapturedAt);
  line(out,'Probabilità stimata visualizzata (feed)',d.probabilityPct);
  line(out,'Quota 1 visualizzata',odds(d.odd1));
  line(out,'Quota X visualizzata',odds(d.oddX));
  line(out,'Quota 2 visualizzata',odds(d.odd2));
  // User notes are not trusted analysis labels. Suppress blank/placeholder and app decision lines.
  const cleanLines=s=>String(s??'').split(/\r?\n/).map(v=>v.trim()).filter(v=>v&&v.length<1500&&!absent.test(v)&&!banned.test(v)&&!/(?:^|\s)(?:n\/d|n\/a|non disponibile|mancante|unknown)(?:\s|$)/i.test(v));
  const n=cleanLines(notes),q=cleanLines(extraQuotes);
  if(n.length)out.push('Osservazioni fornite manualmente:\n'+n.join('\n'));
  if(q.length)out.push('Quote fornite manualmente:\n'+q.join('\n'));
  return out.join('\n');
 }
 function composeFullText(methodology,data,notes='',extraQuotes=''){
  const ctx=context(data,notes,extraQuotes);
  const start='1. INPUT AUTOMATICO, TIMESTAMP E TEMPLATE RIUTILIZZABILE';
  const end='2. QUATTRO GATE SEQUENZIALI — REQUISITI V7 PRESERVATI';
  const a=methodology.indexOf(start),b=methodology.indexOf(end,a+start.length);
  if(a<0||b<a)throw Error('TEMPLATE_V8_SECTION_MARKERS_MISSING');
  // Replace the template INPUT placeholders with only real values. Preserve all other methodological sections.
  return methodology.slice(0,a)+start+'\n\n'+ctx+'\n\n'+methodology.slice(b);
 }
 const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
 function style(e,css){Object.assign(e.style,css);return e;}
 function btn(label,fn){const e=el('button',label);e.type='button';style(e,{padding:'10px 13px',background:'#2563eb',color:'white',border:'0',borderRadius:'8px',cursor:'pointer'});e.addEventListener('click',fn);return e;}
 async function copy(text){try{await navigator.clipboard.writeText(text);return true}catch(_){return false}}
 let templatePromise=null;
 async function template(){if(!templatePromise)templatePromise=fetch(URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('V8_TEMPLATE_HTTP_'+r.status);return r.text()});return templatePromise;}
 function modal(data){
  document.getElementById('quant-v8-overlay')?.remove();
  const overlay=el('section');overlay.id='quant-v8-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Prompt Calcio V8 — dati osservati');overlay.setAttribute('aria-modal','true');
  style(overlay,{position:'fixed',inset:0,zIndex:999999,background:'rgba(4,10,24,.96)',color:'#e6edf7',overflowY:'auto',padding:'14px',fontFamily:'system-ui,sans-serif'});
  const panel=el('div');style(panel,{maxWidth:'1050px',margin:'auto',padding:'20px',border:'1px solid #475569',borderRadius:'12px',background:'#101c2d'});
  const title=el('h2','⚽ Prompt Calcio V8.0 · dati presenti');
  const subtitle=el('p','I dati automatici sono limitati a partita, calendario, mercato, quote e probabilità visualizzate. Nessuna decisione dell’applicazione viene trasferita all’analisi esterna.');style(subtitle,{color:'#afc8e6'});
  const dataBox=el('textarea');dataBox.readOnly=true;dataBox.value=context(data);style(dataBox,{width:'100%',minHeight:'135px',background:'#071323',color:'#cbd5e1',border:'1px solid #334155',padding:'10px',boxSizing:'border-box',fontFamily:'ui-monospace,monospace'});
  const notes=el('textarea');notes.placeholder='Solo informazioni osservate con data e fonte';
  const quotes=el('textarea');quotes.placeholder='Solo quote effettivamente osservate, mercato, lato, linea, bookmaker e ora';
  for(const t of [notes,quotes])style(t,{width:'100%',minHeight:'75px',padding:'10px',marginTop:'9px',boxSizing:'border-box',border:'1px solid #475569',background:'#071323',color:'#fff'});
  const key=KEY_PREFIX+(data.match||'anonimo').toLowerCase().slice(0,120);
  try{const old=JSON.parse(localStorage.getItem(key)||'{}');notes.value=String(old.notes||'');quotes.value=String(old.quotes||'')}catch(_){ }
  const preview=el('textarea');preview.readOnly=true;style(preview,{width:'100%',minHeight:'270px',boxSizing:'border-box',background:'#071323',color:'#e2e8f0',border:'1px solid #475569',padding:'12px',fontFamily:'ui-monospace,monospace',fontSize:'12px'});
  const info=el('p','Anteprima pronta per la copia.');style(info,{color:'#a7f3d0'});
  const update=async(full)=>{const ctx=context(data,notes.value,quotes.value);if(full){const source=await template();return composeFullText(source,data,notes.value,quotes.value);}return ctx;};
  const choose=async full=>{try{const result=await update(full);preview.value=result;preview.focus();preview.select();info.textContent=await copy(result)?'Testo copiato negli appunti.':'Testo pronto: seleziona e premi Ctrl+C.';}catch(e){info.textContent='Impossibile caricare il testo V8: '+e.message}};
  const bar=el('div');style(bar,{display:'flex',flexWrap:'wrap',gap:'8px',margin:'12px 0'});
  bar.append(btn('Copia prompt V8 + dati presenti',()=>void choose(true)),btn('Copia soltanto i dati presenti',()=>void choose(false)),btn('Salva appunti locali',()=>{try{localStorage.setItem(key,JSON.stringify({notes:notes.value.slice(0,30000),quotes:quotes.value.slice(0,30000)}));info.textContent='Appunti salvati in questo browser.'}catch(e){info.textContent='Salvataggio locale non riuscito.'}}),btn('Chiudi',()=>overlay.remove()));
  panel.append(title,subtitle,el('h3','Dati letti da BettingApp'),dataBox,el('h3','Osservazioni aggiuntive'),notes,el('h3','Quote aggiuntive'),quotes,bar,info,el('h3','Anteprima testo'),preview);
  overlay.appendChild(panel);document.body.appendChild(overlay);
  // Populate full template on opening; errors are shown in-place.
  update(true).then(t=>{preview.value=t}).catch(e=>{info.textContent='Caricamento prompt non riuscito: '+e.message;preview.value=context(data)});
 }
 function install(){
  if(window.__calcioPromptV8Installed)return;
  const previous=window.copyAIPrompt;
  if(typeof previous!=='function')return;
  window.copyAIPrompt=function(button,match,league,prediction,odd,odd1,oddX,odd2){
   if((typeof activeSport!=='undefined'&&String(activeSport).toLowerCase()==='tennis')||/\b(atp|wta|itf|challenger|grand slam|masters 1000|tennis)\b/i.test(String(league||''))){return previous.apply(this,arguments)}
   return modal(collect(button,match,league,prediction,odd,odd1,oddX,odd2));
  };
  window.__calcioPromptV8Installed=true;
  const relabel=()=>{if(typeof activeSport!=='undefined'&&String(activeSport).toLowerCase()==='tennis')return;document.querySelectorAll('#analysisTable tbody button[onclick*="copyAIPrompt"]').forEach(b=>{if(b.dataset.calcioPromptV8)return;b.dataset.calcioPromptV8='1';b.textContent='⚽ Prompt Calcio V8';b.title='V8.0: esclusivamente dati osservati, nessun verdetto passato dal programma';});};
  relabel();const tb=document.getElementById('valueBetsTable');if(tb&&typeof MutationObserver==='function')new MutationObserver(relabel).observe(tb,{childList:true,subtree:true});
  console.info(VERSION+' DATA_ONLY_PROMPT NO_BETTING_ACTION');
 }
 // Expose only pure diagnostics for regression test. Does not expose monetary actions.
 window.BETTINGAPP_CALCIO_PROMPT_V8={version:VERSION,collect,context,composeFullText};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
