'use strict';
/* Static same-origin reader. No POST, no credential storage, no automatic trading. */
(()=>{
 const $=id=>document.getElementById(id), FIN=window.R13CoreFinance;
 let selected=null, selectionSeq=0, quoted=[];
 const el=(t,text='',className='')=>{const e=document.createElement(t);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;};
 const txt=(id,v)=>{$(id).textContent=v;};
 const parseOdd=(text)=>{const s=String(text??'').trim().replace(',','.');if(!/^(?:\d+)(?:\.\d{1,5})?$/.test(s))throw Error('QUOTA_DECIMALE_OBBLIGATORIA');const n=Number(s);if(n<=1||n>1000)throw Error('QUOTA_FUORI_RANGE');return n;};
 async function getJson(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{cache:'no-store',signal:controller.signal,credentials:'same-origin'});if(!r.ok)throw Error('HTTP_'+r.status);const x=await r.json();return x;}finally{clearTimeout(timer);}}
 function setResult(target,report,bets,scenarios,foot){const wrap=$(target);wrap.replaceChildren();
  const root=el('div','','result'),heading=el('h3','Simulazione economica · NON una raccomandazione');root.appendChild(heading);
  const row=el('div','','kpis');for(const [title,value] of [['Budget','€ '+report.budgetEuro.toFixed(2)],['Singola 1','€ '+report.stakesEuro[0].toFixed(2)],['Singola 2','€ '+report.stakesEuro[1].toFixed(2)],['Peggiore negli scenari','€ '+report.worstNetEuro.toFixed(2)]]){const box=el('div');box.appendChild(el('small',title));box.appendChild(el('strong',value));row.appendChild(box);}root.appendChild(row);
  const note=foot?'Calcio: 81 punteggi 0–8 per squadra, NON copre risultati oltre 8 gol.':'Tennis: BO3 completato; non copre ritiri o variazioni del regolamento.';
  root.appendChild(el('p','Due singole, nessuna multipla. '+note+' Il limite teorico assoluto di perdita sul budget è € '+Math.abs(report.globalLossBoundEuro).toFixed(2)+'. Quote, probabilità e qualità dati NON validate qui.','small'));
  const sorted=[...report.scenarioResults].sort((a,b)=>a.netEuro-b.netEuro);
  const detail=el('details');const summary=el('summary','Apri gli scenari ('+sorted.length+') · peggiori prima');detail.appendChild(summary);
  const table=el('table'),tr=el('tr');for(const name of ['Scenario','Netto'])tr.appendChild(el('th',name));table.appendChild(tr);
  for(const item of sorted){const r=el('tr');r.appendChild(el('td',item.scenario));r.appendChild(el('td','€ '+item.netEuro.toFixed(2)));table.appendChild(r);}detail.appendChild(table);root.appendChild(detail);wrap.appendChild(root);
 }
 function errorAt(target,e){const r=$(target);r.replaceChildren(el('p',String(e?.message||e),'error'));}
 function labelQuote(q,i){return (i+1)+'. '+q.market+' '+q.side+' '+q.line+' @'+q.odd+' · '+q.bookmaker+' · '+q.capturedAt;}
 function fillQuoteSelector(){for(const id of ['q1','q2'])$(id).replaceChildren();if(!quoted.length){for(const id of ['q1','q2'])$(id).appendChild(new Option('Nessuna quota manuale salvata',''));return;}
  for(const id of ['q1','q2']){const sel=$(id);sel.appendChild(new Option('Scegli quota', ''));quoted.forEach((q,i)=>sel.appendChild(new Option(labelQuote(q,i),String(i))));}
  if(quoted.length>=2){$('q1').value='0';$('q2').value='1';}
 }
 async function selectMatch(id){const seq=++selectionSeq;selected=null;quoted=[];fillQuoteSelector();txt('matchDetail','');txt('temporal','');txt('evidence','');$('calcioResult').replaceChildren();
  if(!id)return;
  txt('matchDetail','Caricamento dati della partita selezionata…');
  try{const x=await getJson('/calcio-editor/api/state?id='+encodeURIComponent(id));if(seq!==selectionSeq||$('matches').value!==id)return;
   if(x.match?.id!==id)throw Error('IDENTITA_MATCH_NON_COINCIDENTE');selected=x.match;
   const r=x.revision,missing=Array.isArray(x.missing)?x.missing:[];
   quoted=(r?.quotes||[]).filter(q=>q&&['AH','TOTAL'].includes(q.market)&&Number.isFinite(Number(q.odd))&&Number.isFinite(Number(q.line)));
   fillQuoteSelector();txt('matchDetail',selected.home+' – '+selected.away+' · '+selected.kickoff+' · '+selected.rows.length+' righe del DB · revisione '+(r?.revision||0));
   const t=Date.parse(r?.match?.kickoff||selected.kickoff),now=Date.now();
   if(!Number.isFinite(t))txt('temporal','Kickoff non verificato con fuso: impossibile certificare analisi PREMATCH.');
   else if(t<=now)txt('temporal','INCONTRO GIÀ INIZIATO: solo studio retrospettivo; nessuna nuova valutazione prematch.');
   else txt('temporal','Incontro futuro al momento della consultazione; verificare comunque l’ora ufficiale di inizio.');
   txt('evidence','Evidenze manuali da validare: '+missing.filter(m=>m.status!=='AUTOMATICO_DA_VALIDARE').map(m=>m.code+': '+m.status).join(' · '));
   $('editorLink').href='/calcio-editor/?rowId='+encodeURIComponent(selected.rows[0]?.id||'')+'&match='+encodeURIComponent(selected.home+' - '+selected.away);
  }catch(e){if(seq!==selectionSeq)return;errorAt('matchDetail',e);}
 }
 async function loadCalcio(){txt('load','Ricerca partite su server locale…');try{
  const m=await getJson('/calcio-editor/api/matches?sport=CALCIO');if(!Array.isArray(m.matches))throw Error('RISPOSTA_MATCH_INVALIDA');
  const select=$('matches'),prior=select.value;select.replaceChildren(new Option('Seleziona partita',''));for(const x of m.matches)select.appendChild(new Option(x.home+' – '+x.away+' · '+x.kickoff,x.id));if(m.matches.some(x=>x.id===prior))select.value=prior;
  txt('load','API locale raggiungibile · '+m.matches.length+' incontri. Usa l’editor originale per aggiungere quote.');
 }catch(e){txt('load','API non disponibile: '+(e.message||e)+'. Avvia BettingApp e verifica http://127.0.0.1:3188/calcio-editor/api/health');}}
 function simulateCalcio(){try{
  if(!selected)throw Error('SELEZIONA_MATCH');const i=Number($('q1').value),j=Number($('q2').value);if($('q1').value===''||$('q2').value===''||i===j||!quoted[i]||!quoted[j])throw Error('SELEZIONA_DUE_QUOTE_DISTINTE');
  const t=Date.parse(selected.kickoff);for(const q of [quoted[i],quoted[j]]){
   if(!q.bookmaker||!q.capturedAt||!Number.isFinite(Date.parse(q.capturedAt)))throw Error('BOOKMAKER_E_TIMESTAMP_RICHIESTI');
   if(Number.isFinite(t)&&Date.parse(q.capturedAt)>=t)throw Error('QUOTA_POST_KICKOFF_NON_PREMATCH');
   if(Date.parse(q.capturedAt)>Date.now()+1000)throw Error('QUOTA_FUTURA_NON_VERIFICABILE');
  }
  const b=[quoted[i],quoted[j]].map(FIN.quoteBet),scores=FIN.footballScores(8),r=FIN.optimize(b,scores,10);setResult('calcioResult',r,b,scores,true);
 }catch(e){errorAt('calcioResult',e);}}
 function simulateTennis(){try{
  const rule=$('rules').value;if(rule!=='PINNACLE_2026_05')throw Error('SELEZIONA_UN_CONTRATTO_DI_LIQUIDAZIONE_VERIFICATO');
  const a=parseOdd($('oddA').value),b=parseOdd($('oddB').value),bets=[{type:'tennis_match_winner',side:'A',odds:a,settlementRuleId:rule},{type:'tennis_set_handicap',side:'B',line:1.5,odds:b,settlementRuleId:rule}];
  const scenarios=FIN.tennisBO3(),r=FIN.optimize(bets,scenarios,10);setResult('tennisResult',r,bets,scenarios,false);
 }catch(e){errorAt('tennisResult',e);}}
 function switchTab(tennis){$('panelCalcio').hidden=tennis;$('panelTennis').hidden=!tennis;$('tabCalcio').classList.toggle('active',!tennis);$('tabTennis').classList.toggle('active',tennis);}
 $('tabCalcio').addEventListener('click',()=>switchTab(false));$('tabTennis').addEventListener('click',()=>switchTab(true));$('matches').addEventListener('change',e=>void selectMatch(e.target.value));$('simCalcio').addEventListener('click',simulateCalcio);$('simTennis').addEventListener('click',simulateTennis);
 void loadCalcio();
 window.BETTINGAPP_R13_CORE_BRIDGE={version:'R13_CORE_BRIDGE_V1',readOnly:true,automaticStake:false};
})();
