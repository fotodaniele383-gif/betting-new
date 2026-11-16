/* BETTINGAPP R9: Presentation-only consistency for generated Calcio/Tennis table rows. */
(function(){'use strict';
 var VERSION='BETTINGAPP_R9_UI_CONSISTENCY_20261111';
 var labelMap=[[/\bPAPER[_ -]*ONLY\b/gi,'SOLO SIMULAZIONE'],[/\bSHADOW\s+ONLY\b/gi,'DIAGNOSTICO · NON OPERATIVO'],[/\bSHADOW\b/gi,'DIAGNOSTICO'],[/\bSTAKE\s+OPERATIVO\b/gi,'IMPORTO AUTORIZZATO DAL MODELLO']];
 function translated(s){if(typeof s!=='string')return s;for(var i=0;i<labelMap.length;i++)s=s.replace(labelMap[i][0],labelMap[i][1]);return s;}
 function skip(n){var p=n.nodeType===1?n:n.parentElement;while(p){if(/^(SCRIPT|STYLE|PRE|CODE|TEXTAREA|INPUT|OPTION|NOSCRIPT)$/i.test(p.tagName||'')||p.isContentEditable)return true;p=p.parentElement;}return false;}
 function cleanText(n){if(!n||skip(n))return;if(n.nodeType===3){var a=n.nodeValue||'',v=translated(a);if(v!==a)n.nodeValue=v;return;}if(n.nodeType!==1)return;
  if(n.hasAttribute('title')){var a=n.getAttribute('title'),v=translated(a);if(v!==a)n.setAttribute('title',v);}
  var walk=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),t;while(t=walk.nextNode())if(!skip(t))cleanText(t);
 }
 function editRow(row){if(!row||!row.id||row.id.indexOf('row-')!==0)return;
  var cells=row.querySelectorAll(':scope > td');if(cells.length<14)return;
  /* Text-only semantics: the final stake/quality/NO BET gates win over the early signal. */
  var decision=(cells[12]?.textContent||'')+' '+(cells[13]?.textContent||'');
  var early=cells[2];if(early && /\bSCARTA\b|NO BET|NON IDONE[AO]/i.test(decision)){
   var walk=document.createTreeWalker(early,NodeFilter.SHOW_TEXT),t;
   while(t=walk.nextNode())if(/\bVALUE CANDIDATE\b/i.test(t.nodeValue||'')){
    var v=t.nodeValue.replace(/\bVALUE CANDIDATE\b/gi,'SEGNALE PRELIMINARE · NON IDONEO');if(t.nodeValue!==v)t.nodeValue=v;
   }
   if(!row.dataset.r9Coherence){row.dataset.r9Coherence='1';early.setAttribute('data-r9-early-only','1');}
  }
  /* Same cell may contain two identical Prompt + fonti buttons (duplicate handlers). Hide only the extras. */
  var hits=Array.from(cells[1].querySelectorAll('button')).filter(function(b){return /^🧠?\s*Prompt\s*\+\s*fonti$/i.test((b.textContent||'').trim());});
  hits.forEach(function(btn,i){if(i>0){btn.hidden=true;btn.setAttribute('aria-hidden','true');btn.tabIndex=-1;btn.dataset.r9Duplicate='1';}});
 }
 function process(){var table=document.getElementById('valueBetsTable');if(!table)return;
  cleanText(table);for(var r of table.querySelectorAll('tr[id^="row-"]'))editRow(r);
  window.__BETTINGAPP_R9_UI__={version:VERSION,active:true,readOnly:true};
 }
 function start(){var table=document.getElementById('valueBetsTable');if(!table){setTimeout(start,350);return;}
  var queued=false;function schedule(){if(queued)return;queued=true;setTimeout(function(){queued=false;process();},90);}
  new MutationObserver(function(){schedule();}).observe(table,{childList:true,subtree:true,characterData:true});process();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
