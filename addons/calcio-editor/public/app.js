'use strict';
// R4: match selection survives API failure, visible DeepScan inputs, side-by-side navigation.
(()=>{
 const $=id=>document.getElementById(id);
 let matches=[],selected=null,revision=null,analysis=null,tennis=[],comparison=null,missing=[],calcioLoaded=false;
 const FIELDS={homeXg:'xG casa',awayXg:'xG trasferta',marketReference:'Mercato di riferimento',lineups:'Formazioni',medicalHome:'News casa',medicalAway:'News ospite',formHome:'Forma casa',formAway:'Forma ospite',clubEloHome:'Elo casa',clubEloAway:'Elo ospite',notes:'Contesto'};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function elt(tag,attrs={},text){const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')el.className=v;else el.setAttribute(k,v);}if(text!==undefined)el.textContent=text;return el;}
 function status(message,error=false){const p=$('status');if(p){p.textContent=message;p.className=error?'bad':'good';}const top=$('loadState');if(error&&top){top.textContent=message;top.className='bad';}}
 function setLoad(message,error=false){const el=$('loadState');el.textContent=message;el.className=error?'bad':'good';}
 async function api(path,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
  try{const res=await fetch('/calcio-editor'+path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),cache:'no-store',signal:controller.signal});
    const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{throw Error('RISPOSTA_NON_JSON HTTP '+res.status+' (verifica server 3188)');}
    if(!res.ok)throw Error(data.error||'HTTP '+res.status);return data;
  }catch(e){if(e.name==='AbortError')throw Error('TIMEOUT_API_16S: server occupato o richiesta bloccata');throw e;}
  finally{clearTimeout(timer);}
 }
 const normalize=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 function matching(m,q){const str=normalize([m.home,m.away,m.league,m.kickoff].join(' '));return str.includes(normalize(q));}
 function selection(choices,value){const el=elt('select');for(const [v,label] of choices)el.appendChild(elt('option',{value:v},label));el.value=value;return el;}
 function quoteRow(q={market:'AH',side:'HOME',line:'-0.25',odd:'',bookmaker:'',capturedAt:'',url:''}){
  const tr=elt('tr'),f={};const pairs=[['market',selection([['AH','Asian Handicap'],['TOTAL','Asian Total']],q.market)],['side',selection([['HOME','Casa'],['AWAY','Ospite'],['OVER','Over'],['UNDER','Under']],q.side)]];
  for(const name of ['line','odd','bookmaker','capturedAt','url'])pairs.push([name,elt('input',{placeholder:name==='capturedAt'?'ISO con fuso':name})]);
  for(const [name,input] of pairs){if(!['market','side'].includes(name))input.value=q[name]??'';f[name]=input;const td=elt('td');td.appendChild(input);tr.appendChild(td);}
  const remove=elt('button',{type:'button',class:'remove','aria-label':'Elimina quota'},'×');remove.addEventListener('click',()=>tr.remove());const td=elt('td');td.appendChild(remove);tr.appendChild(td);tr._fields=f;$('quoteBody').appendChild(tr);
 }
 function quoteValues(){return [...$('quoteBody').children].filter(tr=>tr._fields).map(tr=>Object.fromEntries(Object.entries(tr._fields).map(([k,v])=>[k,v.value.trim()]))).filter(q=>q.odd||q.bookmaker||q.url||q.capturedAt);}
 function evidenceValues(){const data={};for(const field of $('evidence').querySelectorAll('input[data-field][data-attr]')){(data[field.dataset.field]??={})[field.dataset.attr]=field.value.trim();}return Object.fromEntries(Object.entries(data).filter(([,v])=>v.value));}
 function fillEvidence(e){for(const input of $('evidence').querySelectorAll('input[data-field][data-attr]'))input.value=e?.[input.dataset.field]?.[input.dataset.attr]||'';}
 function renderMissing(items){missing=Array.isArray(items)?items:[];const root=$('missingFields');root.replaceChildren();
  const label=elt('strong',{},'Disponibilità evidenze per questa partita: ');root.appendChild(label);
  for(const item of missing){const box=elt('div',{class:'missing-row'}),mark=elt('span',{class:item.status==='MANCANTE'?'bad':item.status==='MANUALE_DA_VERIFICARE'?'warn':'sub'},item.status==='MANCANTE'?'MANCANTE':item.status==='MANUALE_DA_VERIFICARE'?'MANUALE, DA VERIFICARE':item.status==='CALCOLO_AUTOMATICO'?'SOLO AUTOMATICO':'FONTE AUTO DA VERIFICARE');
   box.appendChild(elt('span',{},item.code+' · '+item.label));box.appendChild(mark);root.appendChild(box);
   for(const field of item.fields||[]){const card=$('evidence').querySelector('[data-evidence="'+field+'"]');if(card){card.classList.toggle('needs-data',item.status==='MANCANTE');const tag=card.querySelector('.source-state');if(tag)tag.textContent=item.status==='MANCANTE'?'MANCANTE':item.status==='MANUALE_DA_VERIFICARE'?'DA VERIFICARE':item.status==='AUTOMATICO_DA_VALIDARE'?'AUTO DA VALIDARE':'VERIFICA';}}
  }
 }
 function fillOptions(list){const select=$('matches'),old=select.value;select.replaceChildren(elt('option',{value:''},'Seleziona partita...'));for(const m of list){const item=elt('option',{value:m.id},m.home+' – '+m.away+' · '+(m.league||'')+' · '+m.kickoff);select.appendChild(item);}if(list.some(m=>m.id===old))select.value=old;}
 function renderMatchList(){if(!calcioLoaded)return;const query=$('search').value.trim();const filtered=query?matches.filter(m=>matching(m,query)):matches;fillOptions(filtered);setLoad('Calcio: '+filtered.length+' partite trovate su '+matches.length+(filtered.length===0?' · prova a cercare una sola squadra':''));}
 async function loadCalcio(){setLoad('Carico l’elenco partite Calcio…');try{const response=await api('/api/matches?sport=CALCIO');if(!Array.isArray(response.matches))throw Error('RISPOSTA_SENZA_ARRAY_MATCHES');matches=response.matches;calcioLoaded=true;renderMatchList();if(!matches.length)setLoad('Nessun incontro nel database: non invento partite.',true);return true;}
 catch(e){setLoad('Impossibile recuperare elenco API: '+e.message+'. Le partite precaricate dal server rimangono selezionabili.',true);return false;}}
 async function loadTennis(){try{const response=await api('/api/matches?sport=TENNIS');tennis=Array.isArray(response.matches)?response.matches:[];$('tennisMatches').replaceChildren(elt('option',{value:''},'Prompt generico...'));for(const m of tennis)$('tennisMatches').appendChild(elt('option',{value:m.id},m.home+' – '+m.away+' · '+m.kickoff));}catch(e){$('tennisMatches').replaceChildren(elt('option',{value:''},'Tennis non disponibile: '+e.message.slice(0,80)));}}
 async function pick(id){if(!id)return;setLoad('Carico dettagli e dati mancanti del match…');const response=await api('/api/state?id='+encodeURIComponent(id));
  selected=response.match;revision=response.revision;analysis=response.analysis;comparison=response.comparison;$('matches').value=id;
  $('matchInfo').textContent=(selected.league||'')+' · '+selected.home+' – '+selected.away+' · '+selected.kickoff+' · '+selected.rows.length+' pronostici registrati';
  $('selectedBanner').textContent='PARTITA SELEZIONATA: '+selected.home+' – '+selected.away+' · '+(selected.league||'')+' · '+selected.kickoff;
  $('kickoffOverride').value=revision?.match?.kickoff||selected.kickoff||'';
  $('quoteBody').replaceChildren();for(const q of revision?.quotes||[])quoteRow(q);if(!revision?.quotes?.length)quoteRow();
  fillEvidence(revision?.evidence||{});renderMissing(response.missing||[]);drawResult(analysis,comparison);
  $('deepResults').textContent='Completa i campi mancanti, salva la revisione e poi visualizza il nuovo DeepScan qualitativo.';
  setLoad('Match caricato: '+selected.home+' – '+selected.away+' · compilazione pronta.');
 }
 function metric(label,value){const el=elt('span',{class:'metric'});el.appendChild(elt('small',{},label));el.appendChild(elt('strong',{},value));return el;}
 function number(v){return v===null||v===undefined||!Number.isFinite(Number(v))?'N/D':Number(v).toFixed(2);}
 function drawResult(a,cmp){const root=$('results');root.replaceChildren();if(!a){root.textContent='Nessuna analisi.';return;}
  const b=elt('div');for(const [k,v] of [['BRS',(a.brs?.total??'N/D')+'/100'],['Verdetto',a.verdict||'NO BET'],['Robustezza',a.robustness||'NON_STIMABILE'],['Revisione',a.revision||0]])b.appendChild(metric(k,String(v)));root.appendChild(b);
  root.appendChild(elt('p',{class:'warn'},`Modello: ${a.model} · Probabilità NON calibrate da questa schermata. Probabilità che il verdetto cambi: ${a.verdictChangeProbability}.`));
  const wrap=elt('div',{class:'scroll'}),table=elt('table'),head=elt('tr');for(const name of ['Mercato','Lato','Linea','Quota','EV diagnostico','Payoff (win/loss)','Bookmaker'])head.appendChild(elt('th',{},name));const thead=elt('thead');thead.appendChild(head);table.appendChild(thead);const tbody=elt('tbody');for(const q of a.quotes||[]){const tr=elt('tr'),pr=q.probabilities;for(const val of [q.market,q.side,q.line,number(q.odd),q.evPct===null?'NON STIMABILE':number(q.evPct)+'%',pr?number(100*(pr.fullWin+pr.halfWin))+'% / '+number(100*(pr.fullLoss+pr.halfLoss))+'%':'N/D',q.bookmaker])tr.appendChild(elt('td',{},String(val)));tbody.appendChild(tr);}table.appendChild(tbody);wrap.appendChild(table);root.appendChild(wrap);
  root.appendChild(elt('p',{class:'warn'},'Mancano per una certificazione: '+(a.missing||[]).join('; ')));
  if(cmp){root.appendChild(elt('h3',{},'Confronto con revisione precedente'));root.appendChild(elt('p',{},'Verdetto: '+cmp.oldVerdict+' → '+cmp.newVerdict+' · BRS '+(cmp.oldBRS??'N/D')+' → '+cmp.newBRS+' · Δ '+(cmp.deltaBRS??'N/D')));for(const r of cmp.markets||[])root.appendChild(elt('p',{class:'sub'},r.market+' · ranking '+(r.oldRank??'N/D')+' → '+r.newRank+' · EV '+number(r.oldEvPct)+'% → '+number(r.newEvPct)+'%'));}
 }
 async function save(){if(!selected){status('Seleziona prima una partita.',true);return;}
  $('save').disabled=true;try{status('Salvataggio e ricalcolo in corso…');const result=await api('/api/save',{eventId:selected.id,baseRevision:revision?.revision??0,kickoffOverride:$('kickoffOverride').value.trim(),quotes:quoteValues(),evidence:evidenceValues()});revision=result.revision;analysis=result.analysis;comparison=result.comparison;renderMissing(result.missing||[]);drawResult(analysis,comparison);status('Salvata revisione '+revision.revision+'. Calcolo probabilità/EV diagnostico aggiornato.');if(result.deepScan?.status==='RUNNING')void pollDeepScan(revision.revision);}catch(e){status('Salvataggio non riuscito: '+e.message,true);}finally{$('save').disabled=false;}
 }
 async function pollDeepScan(number){const root=$('deepResults');root.textContent='DeepScan qualitativo in esecuzione…';for(let i=0;i<32;i++){await sleep(1000);if(!selected||revision?.revision!==number)return;let r;try{r=await api('/api/deepscan-status?id='+encodeURIComponent(selected.id));}catch(e){root.textContent='Errore lettura DeepScan: '+e.message;return;}const d=r.deepScan;if(!d||d.revision!==number)return;if(d.status==='RUNNING')continue;root.replaceChildren(elt('p',{class:d.status==='COMPLETE'?'good':'bad'},d.status==='COMPLETE'?'DeepScan aggiornato (qualitativo)':'DeepScan non completato'));root.appendChild(elt('pre',{},JSON.stringify(d.result,null,2)));return;}root.textContent='DeepScan non concluso nel tempo previsto; il salvataggio rimane disponibile.';}
 async function deepScan(){if(!selected||!revision){status('Salva prima i dati del match.',true);return;}try{const response=await api('/api/deepscan',{eventId:selected.id});status('DeepScan avviato in asincrono');void pollDeepScan(response.revision);}catch(e){status('DeepScan: '+e.message,true);}}
 async function promptFor(sport){const response=await fetch('/calcio-editor/prompts/'+sport,{cache:'no-store'});if(!response.ok)throw Error('PROMPT_HTTP_'+response.status);const prompt=await response.text();const m=sport==='calcio'?selected:tennis.find(x=>x.id===$('tennisMatches').value);return prompt.replaceAll('{{MATCH}}',m?m.home+' – '+m.away:'MATCH NON SELEZIONATO').replaceAll('{{KICKOFF}}',(sport==='calcio'?revision?.match?.kickoff:null)||m?.kickoff||'NON DISPONIBILE').replaceAll('{{QUOTE}}',sport==='calcio'?JSON.stringify(revision?.quotes||[],null,2):'NON DISPONIBILI').replaceAll('{{EVIDENZE}}',sport==='calcio'?JSON.stringify(revision?.evidence||{},null,2):'NON DISPONIBILI').replaceAll('{{SNAPSHOT}}',JSON.stringify(m?.rows||[],null,2));}
 async function copyPrompt(sport){try{const prompt=await promptFor(sport);if(sport==='tennis')$('tennisPreview').value=prompt;else{let box=$('calcioPreview');if(!box){box=elt('textarea',{id:'calcioPreview',rows:'14',readOnly:'readonly'});$('copyPrompt').parentNode.after(box);}box.value=prompt;}try{await navigator.clipboard.writeText(prompt);status('Prompt '+sport+' copiato. Anteprima disponibile sotto i pulsanti.');}catch{status('Clipboard non autorizzato: seleziona il testo nell’anteprima.');}}catch(e){status('Prompt non disponibile: '+e.message,true);}}
 async function resolveQuery(){const u=new URLSearchParams(location.search),rowId=u.get('rowId')||'',match=u.get('match')||'';if(!rowId&&!match)return;
  try{const result=await api('/api/resolve?rowId='+encodeURIComponent(rowId)+'&match='+encodeURIComponent(match));const m=result.match;if(!m)throw Error('MATCH_SENZA_RECORD');
   if(![...$('matches').options].some(x=>x.value===m.id))$('matches').appendChild(elt('option',{value:m.id},m.home+' – '+m.away+' · '+m.kickoff));$('matches').value=m.id;await pick(m.id);
  }catch(e){if(match){$('search').value=match;renderMatchList();}setLoad('La riga richiesta non è stata collegata automaticamente: '+e.message+'. Cerca o seleziona dall’elenco.',true);}
 }
 function importQuoteRows(){
  if(!selected){status('Seleziona prima il match per identificare CASA e TRASFERTA.',true);return;}
  const text=$('pasteQuotes').value;const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const commonBook=$('defaultBookmaker').value.trim(),commonTime=$('defaultCapturedAt').value.trim();
  const base={bookmaker:commonBook,capturedAt:commonTime,url:''};let added=0,ignored=0;
  const num=x=>String(x||'').replace(',','.');
  function identify(label){const l=normalize(label);
   if(/^(under|u)\b/.test(l))return {market:'TOTAL',side:'UNDER'};
   if(/^(over|o)\b/.test(l))return {market:'TOTAL',side:'OVER'};
   if(l==='home'||l===normalize(selected.home)||l.includes(normalize(selected.home)))return {market:'AH',side:'HOME'};
   if(l==='away'||l===normalize(selected.away)||l.includes(normalize(selected.away)))return {market:'AH',side:'AWAY'};
   return null;
  }
  function add(q){quoteRow({...base,...q});added++;}
  for(let i=0;i<lines.length;i++){
   const line=lines[i],separator=line.includes('\t')?'\t':line.includes('|')?'|':line.includes(';')?';':null;
   if(separator){const columns=line.split(separator).map(x=>x.trim());
    if(columns.length===7){const [market,side,level,odd,bookmaker,capturedAt,url]=columns;add({market:market.toUpperCase(),side:side.toUpperCase(),line:num(level),odd:num(odd),bookmaker:bookmaker||commonBook,capturedAt:capturedAt||commonTime,url});continue;}
    if(columns.length===4){const [market,side,level,odd]=columns;add({market:market.toUpperCase(),side:side.toUpperCase(),line:num(level),odd:num(odd)});continue;}
   }
   const three=/^(.+?)\s+([+-]?\d+(?:[.,]\d+)?)\s+([1-9]\d*(?:[.,]\d+)?)$/.exec(line);
   if(three){const type=identify(three[1]);if(type){add({...type,line:num(three[2]),odd:num(three[3])});continue;}}
   const two=/^(.+?)\s+([+-]?\d+(?:[.,]\d+)?)$/.exec(line);
   if(two){const type=identify(two[1]);if(type){let odd=null,j=i+1;
     while(j<lines.length&&j<=i+3){const candidate=lines[j].match(/^([1-9]\d*(?:[.,]\d+)?)$/);if(candidate){odd=num(candidate[1]);break;}
      if(/logo|bookie|image|img/i.test(lines[j])){j++;continue;}break;}
     if(odd){add({...type,line:num(two[2]),odd});i=j;continue;}
   }}
   // Never fabricate a market, bookmaker, or timestamp from unlabeled fragments.
   ignored++;
  }
  if(!added){status('Nessuna quota riconosciuta. Incolla 7 colonne oppure "Bologna -2 6.25" / "Under 3.25 1.95".',true);return;}
  status('Importate '+added+' quote; righe non interpretate '+ignored+'. Verifica lato, bookmaker e timestamp prima di salvare.');
 }
 function activate(){for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>{document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.page').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.page));});}
 async function init(){try{$('jsState').textContent='Interfaccia R4 caricata: campi DeepScan disponibili anche prima della selezione.';$('jsState').className='good';$('search').addEventListener('input',renderMatchList);
  $('matches').addEventListener('change',e=>{if(e.target.value)void pick(e.target.value).catch(x=>status('Match non caricabile: '+x.message,true));});
  $('reload').addEventListener('click',()=>{void loadCalcio();});$('addQuote').addEventListener('click',()=>quoteRow());$('importQuotes').addEventListener('click',importQuoteRows);
  $('save').addEventListener('click',save);$('scan').addEventListener('click',deepScan);$('copyPrompt').addEventListener('click',()=>void copyPrompt('calcio'));
  $('copyTennis').addEventListener('click',()=>void copyPrompt('tennis'));$('tennisMatches').addEventListener('change',()=>void promptFor('tennis').then(p=>$('tennisPreview').value=p).catch(e=>status(e.message,true)));
  activate();const query=new URLSearchParams(location.search);if(query.get('sport')==='tennis')document.querySelector('[data-page="tennis"]')?.click();
  // Separate the two sources: a failing Tennis endpoint must not block Football selection.
  await loadCalcio();await resolveQuery();void loadTennis().then(()=>promptFor('tennis')).then(p=>$('tennisPreview').value=p).catch(()=>{});
  if(query.get('focus')==='deepscan')$('deepscanSection')?.scrollIntoView({block:'start'});
  if(query.get('focus')==='prompt')$('copyPrompt')?.focus();
 }catch(e){status('Errore inizializzazione editor: '+e.message,true);}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});else void init();
 window.BETTINGAPP_CALCIO_EDITOR_R4={version:'R4_MATCH_BOOTSTRAP_DEEPSCAN',getSelected:()=>selected?.id||null};
})();
